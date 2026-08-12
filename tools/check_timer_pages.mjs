#!/usr/bin/env node
/* Functional check for the preset timer pages, in real Chrome over CDP.
 *
 * Screenshots prove a page looks right; this proves it counts right. Zero
 * dependencies — it drives headless Chrome over the DevTools Protocol using
 * Node's built-in WebSocket, so there is nothing to install.
 *
 *     python3 -m http.server 8818          # from the repo root
 *     node tools/check_timer_pages.mjs http://localhost:8818
 *
 * What it asserts, none of which is visible in the source:
 *   1. a preset page arrives with its duration already dialled in;
 *   2. one tap runs it;
 *   3. ?autostart=1 runs it without the tap;
 *   4. a frozen tab — the worst case of a backgrounded one — loses no time,
 *      because the countdown is computed from wall-clock timestamps;
 *   5. the alarm actually fires at zero;
 *   6. an egg preset sets and starts in a single tap;
 *   7. every page shares one storage key, so a countdown started elsewhere
 *      must not hijack a preset page, while reloading the page that started
 *      it must resume exactly where it was.
 */
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const CHROME = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
].find(p => existsSync(p))

const BASE = process.argv[2] || "http://localhost:8818"
const userDir = join(tmpdir(), "clocklab-cdp-" + Date.now())
const chrome = spawn(CHROME, [
  "--headless=new", "--remote-debugging-port=9333", "--no-first-run",
  "--user-data-dir=" + userDir, "--autoplay-policy=no-user-gesture-required",
  "about:blank",
], { stdio: "ignore" })

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function endpoint() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch("http://127.0.0.1:9333/json/version")
      return (await r.json()).webSocketDebuggerUrl
    } catch { await sleep(150) }
  }
  throw new Error("chrome never came up")
}

let id = 0
function rpc(ws, method, params, sessionId) {
  return new Promise((resolve, reject) => {
    const msgId = ++id
    const onMsg = ev => {
      const m = JSON.parse(ev.data)
      if (m.id !== msgId) return
      ws.removeEventListener("message", onMsg)
      m.error ? reject(new Error(method + ": " + m.error.message)) : resolve(m.result)
    }
    ws.addEventListener("message", onMsg)
    ws.send(JSON.stringify({ id: msgId, method, params, sessionId }))
  })
}

let failures = 0
function check(name, ok, detail) {
  console.log((ok ? "ok  " : "FAIL") + "  " + name + (detail ? "  — " + detail : ""))
  if (!ok) failures++
}

const browserWs = await endpoint()
const ws = new WebSocket(browserWs)
await new Promise(r => ws.addEventListener("open", r, { once: true }))

const { targetId } = await rpc(ws, "Target.createTarget", { url: "about:blank" })
const { sessionId } = await rpc(ws, "Target.attachToTarget", { targetId, flatten: true })
const send = (method, params) => rpc(ws, method, params, sessionId)
await send("Page.enable")
await send("Runtime.enable")

async function goto(url) {
  await send("Page.navigate", { url })
  await sleep(900)
}

async function evaluate(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " :: " + expr)
  return r.result.value
}

// ---- 1. pre-seeding ------------------------------------------------------
await goto(BASE + "/20-minute-timer/")
let state = await evaluate(`(${() => ({
  readout: document.getElementById("cd-readout").textContent,
  h: document.getElementById("cd-h").value,
  m: document.getElementById("cd-m").value,
  s: document.getElementById("cd-s").value,
  duration: document.querySelector(".instrument").dataset.duration,
  status: document.getElementById("cd-status").textContent,
})})()`)
check("/20-minute-timer/ arrives pre-seeded", state.readout === "00:20:00" && state.m === "20",
  JSON.stringify(state))
check("workspace declares its duration", state.duration === "1200", state.duration)

// ---- 2. one tap starts it ------------------------------------------------
await evaluate(`document.getElementById("cd-start").click()`)
await sleep(2200)
state = await evaluate(`(${() => ({
  readout: document.getElementById("cd-readout").textContent,
  status: document.getElementById("cd-status").getAttribute("data-state"),
})})()`)
check("one tap runs it", state.status === "running" && state.readout < "00:20:00",
  state.readout + " / " + state.status)

// ---- 3. ?autostart=1 -----------------------------------------------------
// (clear the timer the previous case left running, so this is a fresh visit)
await evaluate(`document.getElementById("cd-reset").click()`)
await goto(BASE + "/30-second-timer/?autostart=1")
await sleep(1500)
state = await evaluate(`(${() => ({
  readout: document.getElementById("cd-readout").textContent,
  status: document.getElementById("cd-status").getAttribute("data-state"),
})})()`)
check("?autostart=1 starts without a tap", state.status === "running", state.readout + " / " + state.status)

// ---- 4. frozen tab: the hard one ----------------------------------------
// A backgrounded tab has its timers throttled; a frozen one has them stopped
// outright. Either way the countdown must come back reading the real clock,
// not wherever the on-screen counter had got to.
await evaluate(`document.getElementById("cd-reset").click()`)
await goto(BASE + "/30-second-timer/")
await evaluate(`
  document.getElementById("cd-m").value = "0";
  document.getElementById("cd-s").value = "8";
  document.getElementById("cd-s").dispatchEvent(new Event("input"));
  document.getElementById("cd-start").click();
`)
await sleep(500)
const before = await evaluate(`document.getElementById("cd-readout").textContent`)
await send("Page.setWebLifecycleState", { state: "frozen" })
await sleep(4000)
await send("Page.setWebLifecycleState", { state: "active" })
await sleep(700)
const after = await evaluate(`document.getElementById("cd-readout").textContent`)
const secs = t => t.split(":").reduce((a, b) => a * 60 + Number(b), 0)
const elapsed = secs(before) - secs(after)
check("a frozen tab does not lose time", elapsed >= 4 && elapsed <= 6,
  before + " -> " + after + " (" + elapsed + "s of ~4.7s wall clock)")

// ---- 5. the alarm actually fires ----------------------------------------
await sleep(4500)
state = await evaluate(`(${() => ({
  status: document.getElementById("cd-status").getAttribute("data-state"),
  label: document.getElementById("cd-status").textContent,
  stopVisible: !document.getElementById("cd-stop-alarm").hidden,
  readout: document.getElementById("cd-readout").textContent,
})})()`)
check("it rings at zero", state.status === "ringing" && state.stopVisible, JSON.stringify(state))

// ---- 6. egg presets ------------------------------------------------------
await evaluate(`document.getElementById("cd-stop-alarm").click()`)
await goto(BASE + "/egg-timer/")
await evaluate(`document.querySelector('[data-preset-seconds="660"]').click()`)
await sleep(1200)
state = await evaluate(`(${() => ({
  readout: document.getElementById("cd-readout").textContent,
  status: document.getElementById("cd-status").getAttribute("data-state"),
  active: document.querySelector(".preset-btn.is-active") &&
          document.querySelector(".preset-btn.is-active").dataset.presetSeconds,
})})()`)
check("an egg preset sets and starts in one tap",
  state.status === "running" && state.active === "660" && state.readout.startsWith("00:10:5"),
  JSON.stringify(state))

// ---- 7. the shared storage key does not let pages hijack each other ------
// Something running elsewhere must not greet a visitor who came for five
// minutes; a reload of the page that started it must resume exactly.
await evaluate(`document.getElementById("cd-reset").click()`)
await goto(BASE + "/countdown-timer/")
await evaluate(`
  document.getElementById("cd-m").value = "10";
  document.getElementById("cd-m").dispatchEvent(new Event("input"));
  document.getElementById("cd-start").click();
`)
await sleep(1200)
await goto(BASE + "/2-minute-timer/")
state = await evaluate(`(${() => ({
  status: document.getElementById("cd-status").getAttribute("data-state"),
  readout: document.getElementById("cd-readout").textContent,
})})()`)
check("a countdown from another page does not hijack a preset page",
  state.readout === "00:02:00", JSON.stringify(state))

// ---- 8. reload mid-countdown still resumes ------------------------------
await evaluate(`document.getElementById("cd-start").click()`)
await sleep(2200)
await goto(BASE + "/2-minute-timer/")
state = await evaluate(`(${() => ({
  status: document.getElementById("cd-status").getAttribute("data-state"),
  readout: document.getElementById("cd-readout").textContent,
})})()`)
check("reloading mid-countdown resumes where it was",
  state.status === "running" && state.readout.startsWith("00:01:5") && state.readout !== "00:01:59",
  JSON.stringify(state))
await evaluate(`document.getElementById("cd-reset").click()`)

console.log("\n" + (failures ? failures + " failure(s)" : "all checks passed"))
ws.close()
chrome.kill()
process.exit(failures ? 1 : 0)
