/*!
 * clocklab.net — shared app behaviour + every tool's timer engine.
 * Loaded on every page. Every init function is defensive (bails if its
 * elements aren't on the page), so the same file runs unmodified on the
 * homepage (all six tool panels present at once, hidden) and on every
 * standalone tool page (exactly one panel).
 *
 * Accuracy note: every timer here is driven from wall-clock timestamps
 * (performance.now() / Date.now()), never by counting setInterval ticks.
 * Each render reads "how much time has actually passed" from a stored
 * start timestamp + accumulated offset, so drift from tab throttling,
 * GC pauses, or a slow frame never accumulates — pausing and resuming
 * repeatedly, or backgrounding the tab for a while, still yields the
 * correct remaining/elapsed time on the next render.
 */
(function () {
  "use strict";

  var Dial = window.ClockLabDial;
  var Audio = window.ClockLabAudio;

  function pad2(n) {
    return n < 10 ? "0" + n : "" + n;
  }

  function fmtHMS(totalSeconds) {
    totalSeconds = Math.max(0, Math.round(totalSeconds));
    var h = Math.floor(totalSeconds / 3600);
    var m = Math.floor((totalSeconds % 3600) / 60);
    var s = totalSeconds % 60;
    return pad2(h) + ":" + pad2(m) + ":" + pad2(s);
  }

  function fmtStopwatch(ms) {
    ms = Math.max(0, ms);
    var totalCs = Math.floor(ms / 10);
    var cs = totalCs % 100;
    var totalSeconds = Math.floor(totalCs / 100);
    var s = totalSeconds % 60;
    var m = Math.floor(totalSeconds / 60) % 60;
    var h = Math.floor(totalSeconds / 3600);
    return pad2(h) + ":" + pad2(m) + ":" + pad2(s) + "." + pad2(cs);
  }

  function fmtMinSec(totalSeconds) {
    totalSeconds = Math.max(0, Math.round(totalSeconds));
    var m = Math.floor(totalSeconds / 60);
    var s = totalSeconds % 60;
    return pad2(m) + ":" + pad2(s);
  }

  function now() {
    return performance.now();
  }

  /* ============================== THEME ============================== */
  function initTheme() {
    var btn = document.getElementById("theme-toggle");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var root = document.documentElement;
      var current = root.getAttribute("data-theme");
      var isDark =
        current === "dark" ||
        (!current && window.matchMedia("(prefers-color-scheme: dark)").matches);
      var next = isDark ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try {
        localStorage.setItem("clocklab-theme", next);
      } catch (e) {}
    });
  }

  /* ============================ MOBILE NAV ============================ */
  function initMobileNav() {
    var toggle = document.getElementById("nav-toggle");
    var nav = document.getElementById("tool-nav");
    if (!toggle || !nav) return;
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(open));
    });
  }

  /* ============================ PANEL SWITCHING ============================ */
  // Homepage only: instant tool switching with pushState, no reload.
  function initPanelSwitching() {
    var panels = document.querySelectorAll("[data-panel]");
    var overview = document.getElementById("overview-panel");
    if (!panels.length || !overview) return;

    var navLinks = document.querySelectorAll("[data-panel-link]");
    var hero = document.querySelector(".hero");

    function show(slug, push) {
      slug = slug || "countdown-timer"; // homepage shows the primary tool live
      var target = slug ? document.querySelector('[data-panel="' + slug + '"]') : overview;
      if (!target) target = overview;

      panels.forEach(function (p) {
        p.hidden = true;
      });
      overview.hidden = true;
      // When a specific tool is shown, hide the marketing hero so the tool sits
      // right under the nav instead of below a tall banner.
      if (hero) hero.hidden = !!slug;
      target.hidden = false;

      navLinks.forEach(function (a) {
        var isCurrent = slug
          ? a.getAttribute("data-panel-link") === slug
          : a.getAttribute("data-panel-link") === "";
        if (isCurrent) {
          a.setAttribute("aria-current", "page");
        } else {
          a.removeAttribute("aria-current");
        }
      });

      if (push) {
        var path = slug ? "/" + slug + "/" : "/";
        var title = slug
          ? target.getAttribute("data-title") || document.title
          : "clocklab.net — browser-only timers, built like an instrument";
        document.title = title;
        history.pushState({ panel: slug || null }, "", path);
      }

      // Only scroll on user-initiated switches, never on initial load (which
      // would jump the freshly-loaded page down past the header).
      if (push) target.scrollIntoView({ behavior: "instant", block: "start" });
      var heading = target.querySelector("h1, h2");
      if (heading) heading.setAttribute("tabindex", "-1");
      if (heading) heading.focus({ preventScroll: true });
    }

    document.addEventListener("click", function (e) {
      var link = e.target.closest && e.target.closest("[data-panel-link]");
      if (!link) return;
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      show(link.getAttribute("data-panel-link") || null, true);
    });

    window.addEventListener("popstate", function (e) {
      var slug = e.state && e.state.panel ? e.state.panel : null;
      show(slug, false);
    });

    show(null, false);
  }

  /* ============================ COUNTDOWN TIMER (cd-) ============================ */
  function initCountdown() {
    var startBtn = document.getElementById("cd-start");
    if (!startBtn) return;
    var pauseBtn = document.getElementById("cd-pause");
    var resetBtn = document.getElementById("cd-reset");
    var stopAlarmBtn = document.getElementById("cd-stop-alarm");
    var readout = document.getElementById("cd-readout");
    var statusEl = document.getElementById("cd-status");
    var hInput = document.getElementById("cd-h");
    var mInput = document.getElementById("cd-m");
    var sInput = document.getElementById("cd-s");
    var dialMount = document.getElementById("cd-dial");
    var dial = Dial ? Dial.mount(dialMount, "arc") : null;

    var totalMs = 0;
    var accumulatedMs = 0;
    var startTs = 0;
    var running = false;
    var ringing = false;
    var rafId = null;
    var alarmHandle = null;

    function readInputsMs() {
      var h = Math.max(0, Math.min(23, Number(hInput.value) || 0));
      var m = Math.max(0, Math.min(59, Number(mInput.value) || 0));
      var s = Math.max(0, Math.min(59, Number(sInput.value) || 0));
      return (h * 3600 + m * 60 + s) * 1000;
    }

    function remainingMs() {
      var elapsed = accumulatedMs + (running ? now() - startTs : 0);
      return Math.max(0, totalMs - elapsed);
    }

    function render() {
      var rem = remainingMs();
      readout.textContent = fmtHMS(rem / 1000);
      readout.classList.toggle("is-ringing", ringing);
      if (dial) dial.setProgress(totalMs > 0 ? rem / totalMs : 0, ringing);
    }

    function setInputsDisabled(disabled) {
      hInput.disabled = disabled;
      mInput.disabled = disabled;
      sInput.disabled = disabled;
    }

    function loop() {
      if (!running) return;
      var rem = remainingMs();
      render();
      if (rem <= 0) {
        finish();
        return;
      }
      rafId = requestAnimationFrame(loop);
    }

    function finish() {
      running = false;
      accumulatedMs = totalMs;
      ringing = true;
      statusEl.textContent = "Ringing";
      statusEl.setAttribute("data-state", "ringing");
      startBtn.hidden = true;
      pauseBtn.hidden = true;
      resetBtn.hidden = true;
      stopAlarmBtn.hidden = false;
      render();
      alarmHandle = Audio ? Audio.startAlarm() : null;
    }

    startBtn.addEventListener("click", function () {
      if (Audio) Audio.unlock();
      if (running) return;
      if (totalMs === 0 || accumulatedMs >= totalMs) {
        totalMs = readInputsMs();
        accumulatedMs = 0;
      }
      if (totalMs <= 0) return;
      running = true;
      startTs = now();
      statusEl.textContent = "Running";
      statusEl.setAttribute("data-state", "running");
      startBtn.disabled = true;
      pauseBtn.disabled = false;
      setInputsDisabled(true);
      rafId = requestAnimationFrame(loop);
    });

    pauseBtn.addEventListener("click", function () {
      if (!running) return;
      accumulatedMs += now() - startTs;
      running = false;
      statusEl.textContent = "Paused";
      statusEl.setAttribute("data-state", "paused");
      startBtn.disabled = false;
      pauseBtn.disabled = true;
      if (rafId) cancelAnimationFrame(rafId);
      render();
    });

    resetBtn.addEventListener("click", function () {
      running = false;
      ringing = false;
      if (rafId) cancelAnimationFrame(rafId);
      if (alarmHandle) alarmHandle.stop();
      accumulatedMs = 0;
      totalMs = readInputsMs();
      statusEl.textContent = "Idle";
      statusEl.setAttribute("data-state", "idle");
      startBtn.hidden = false;
      pauseBtn.hidden = false;
      resetBtn.hidden = false;
      stopAlarmBtn.hidden = true;
      startBtn.disabled = false;
      pauseBtn.disabled = true;
      setInputsDisabled(false);
      render();
    });

    stopAlarmBtn.addEventListener("click", function () {
      ringing = false;
      if (alarmHandle) alarmHandle.stop();
      startBtn.hidden = false;
      pauseBtn.hidden = false;
      resetBtn.hidden = false;
      stopAlarmBtn.hidden = true;
      statusEl.textContent = "Idle";
      statusEl.setAttribute("data-state", "idle");
      accumulatedMs = 0;
      totalMs = readInputsMs();
      pauseBtn.disabled = true;
      setInputsDisabled(false);
      render();
    });

    [hInput, mInput, sInput].forEach(function (input) {
      input.addEventListener("input", function () {
        if (running || ringing) return;
        totalMs = readInputsMs();
        accumulatedMs = 0;
        render();
      });
    });

    totalMs = readInputsMs();
    pauseBtn.disabled = true;
    render();
  }

  /* ============================ STOPWATCH (sw-) ============================ */
  function initStopwatch() {
    var startBtn = document.getElementById("sw-start");
    if (!startBtn) return;
    var lapBtn = document.getElementById("sw-lap");
    var resetBtn = document.getElementById("sw-reset");
    var readout = document.getElementById("sw-readout");
    var statusEl = document.getElementById("sw-status");
    var lapsBody = document.getElementById("sw-laps");
    var lapsEmpty = document.getElementById("sw-laps-empty");
    var dialMount = document.getElementById("sw-dial");
    var dial = Dial ? Dial.mount(dialMount, "sweep") : null;

    var accumulatedMs = 0;
    var startTs = 0;
    var running = false;
    var rafId = null;
    var laps = []; // elapsed ms at each lap, in order

    function elapsedMs() {
      return accumulatedMs + (running ? now() - startTs : 0);
    }

    function render() {
      var ms = elapsedMs();
      readout.textContent = fmtStopwatch(ms);
      if (dial) dial.setAngle(((ms % 60000) / 60000) * 360);
    }

    function renderLaps() {
      if (!laps.length) {
        lapsEmpty.hidden = false;
        lapsBody.innerHTML = "";
        return;
      }
      lapsEmpty.hidden = true;
      var deltas = laps.map(function (t, i) {
        return i === 0 ? t : t - laps[i - 1];
      });
      var best = Math.min.apply(null, deltas);
      var worst = Math.max.apply(null, deltas);
      var rows = "";
      for (var i = laps.length - 1; i >= 0; i--) {
        var d = deltas[i];
        var cls = deltas.length > 1 ? (d === best ? "is-best" : d === worst ? "is-worst" : "") : "";
        rows +=
          '<tr class="' +
          cls +
          '"><td>' +
          (i + 1) +
          "</td><td>" +
          fmtStopwatch(laps[i]) +
          '</td><td class="delta">' +
          fmtStopwatch(d) +
          "</td></tr>";
      }
      lapsBody.innerHTML = rows;
    }

    function loop() {
      if (!running) return;
      render();
      rafId = requestAnimationFrame(loop);
    }

    function setState(state) {
      if (state === "idle") {
        statusEl.textContent = "Idle";
        statusEl.setAttribute("data-state", "idle");
        startBtn.textContent = "Start";
        lapBtn.disabled = true;
        resetBtn.disabled = true;
      } else if (state === "running") {
        statusEl.textContent = "Running";
        statusEl.setAttribute("data-state", "running");
        startBtn.textContent = "Stop";
        lapBtn.disabled = false;
        resetBtn.disabled = true;
      } else {
        statusEl.textContent = "Stopped";
        statusEl.setAttribute("data-state", "paused");
        startBtn.textContent = "Resume";
        lapBtn.disabled = true;
        resetBtn.disabled = false;
      }
    }

    startBtn.addEventListener("click", function () {
      if (Audio) Audio.unlock();
      if (running) {
        accumulatedMs += now() - startTs;
        running = false;
        if (rafId) cancelAnimationFrame(rafId);
        render();
        setState("stopped");
      } else {
        running = true;
        startTs = now();
        setState("running");
        rafId = requestAnimationFrame(loop);
      }
    });

    lapBtn.addEventListener("click", function () {
      if (!running) return;
      if (Audio) Audio.tick();
      laps.push(elapsedMs());
      renderLaps();
    });

    resetBtn.addEventListener("click", function () {
      if (running) return;
      accumulatedMs = 0;
      laps = [];
      renderLaps();
      render();
      setState("idle");
    });

    setState("idle");
    render();
    renderLaps();
  }

  /* ============================ POMODORO (pd-) ============================ */
  function initPomodoro() {
    var startBtn = document.getElementById("pd-start");
    if (!startBtn) return;
    var pauseBtn = document.getElementById("pd-pause");
    var skipBtn = document.getElementById("pd-skip");
    var resetBtn = document.getElementById("pd-reset");
    var readout = document.getElementById("pd-readout");
    var phaseLabel = document.getElementById("pd-phase");
    var statusEl = document.getElementById("pd-status");
    var pipsEl = document.getElementById("pd-pips");
    var workInput = document.getElementById("pd-work");
    var breakInput = document.getElementById("pd-break");
    var longBreakInput = document.getElementById("pd-long-break");
    var sessionsInput = document.getElementById("pd-sessions");
    var dialMount = document.getElementById("pd-dial");
    var dial = Dial ? Dial.mount(dialMount, "arc") : null;

    var phase = "work"; // work | break | longbreak
    var sessionIndex = 0; // completed work sessions in current cycle
    var totalMs = 0;
    var accumulatedMs = 0;
    var startTs = 0;
    var running = false;
    var rafId = null;

    function cfg() {
      return {
        work: Math.max(1, Math.min(90, Number(workInput.value) || 25)),
        brk: Math.max(1, Math.min(60, Number(breakInput.value) || 5)),
        longBrk: Math.max(1, Math.min(60, Number(longBreakInput.value) || 15)),
        sessions: Math.max(1, Math.min(12, Number(sessionsInput.value) || 4)),
      };
    }

    function phaseDurationMs(p) {
      var c = cfg();
      if (p === "work") return c.work * 60000;
      if (p === "break") return c.brk * 60000;
      return c.longBrk * 60000;
    }

    function renderPips() {
      var c = cfg();
      var html = "";
      for (var i = 0; i < c.sessions; i++) {
        var cls = "pip";
        if (i < sessionIndex) cls += " is-done";
        else if (i === sessionIndex && phase === "work") cls += " is-current";
        html += '<span class="' + cls + '"></span>';
      }
      pipsEl.innerHTML = html;
    }

    function remainingMs() {
      var elapsed = accumulatedMs + (running ? now() - startTs : 0);
      return Math.max(0, totalMs - elapsed);
    }

    function render() {
      var rem = remainingMs();
      readout.textContent = fmtMinSec(rem / 1000);
      readout.classList.toggle("is-cyan", phase !== "work");
      phaseLabel.textContent = phase === "work" ? "Focus" : phase === "break" ? "Short break" : "Long break";
      if (dial) dial.setProgress(totalMs > 0 ? rem / totalMs : 0, phase !== "work" ? "break" : "normal");
    }

    function setInputsDisabled(disabled) {
      [workInput, breakInput, longBreakInput, sessionsInput].forEach(function (i) {
        i.disabled = disabled;
      });
    }

    function advancePhase(natural) {
      var c = cfg();
      if (phase === "work") {
        sessionIndex++;
        phase = sessionIndex >= c.sessions ? "longbreak" : "break";
      } else if (phase === "longbreak") {
        sessionIndex = 0;
        phase = "work";
      } else {
        phase = "work";
      }
      totalMs = phaseDurationMs(phase);
      accumulatedMs = 0;
      startTs = now();
      if (natural && Audio) Audio.chime();
      renderPips();
      render();
    }

    function loop() {
      if (!running) return;
      var rem = remainingMs();
      render();
      if (rem <= 0) {
        advancePhase(true);
      }
      rafId = requestAnimationFrame(loop);
    }

    startBtn.addEventListener("click", function () {
      if (Audio) Audio.unlock();
      if (running) return;
      if (totalMs === 0) totalMs = phaseDurationMs(phase);
      running = true;
      startTs = now();
      statusEl.textContent = "Running";
      statusEl.setAttribute("data-state", "running");
      startBtn.disabled = true;
      pauseBtn.disabled = false;
      setInputsDisabled(true);
      rafId = requestAnimationFrame(loop);
    });

    pauseBtn.addEventListener("click", function () {
      if (!running) return;
      accumulatedMs += now() - startTs;
      running = false;
      statusEl.textContent = "Paused";
      statusEl.setAttribute("data-state", "paused");
      startBtn.disabled = false;
      pauseBtn.disabled = true;
      if (rafId) cancelAnimationFrame(rafId);
      render();
    });

    skipBtn.addEventListener("click", function () {
      var wasRunning = running;
      if (running) accumulatedMs += now() - startTs;
      advancePhase(false);
      if (wasRunning) {
        running = true;
        startTs = now();
        rafId = requestAnimationFrame(loop);
      }
    });

    resetBtn.addEventListener("click", function () {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      phase = "work";
      sessionIndex = 0;
      accumulatedMs = 0;
      totalMs = phaseDurationMs("work");
      statusEl.textContent = "Idle";
      statusEl.setAttribute("data-state", "idle");
      startBtn.disabled = false;
      pauseBtn.disabled = true;
      setInputsDisabled(false);
      renderPips();
      render();
    });

    [workInput, breakInput, longBreakInput, sessionsInput].forEach(function (input) {
      input.addEventListener("input", function () {
        if (running) return;
        totalMs = phaseDurationMs(phase);
        renderPips();
        render();
      });
    });

    totalMs = phaseDurationMs("work");
    pauseBtn.disabled = true;
    renderPips();
    render();
  }

  /* ============================ ALARM CLOCK (al-) ============================ */
  function initAlarmClock() {
    var armBtn = document.getElementById("al-arm");
    if (!armBtn) return;
    var cancelBtn = document.getElementById("al-cancel");
    var stopBtn = document.getElementById("al-stop");
    var timeInput = document.getElementById("al-time");
    var repeatInput = document.getElementById("al-repeat");
    var readout = document.getElementById("al-readout");
    var statusEl = document.getElementById("al-status");
    var hintEl = document.getElementById("al-hint");
    var dialMount = document.getElementById("al-dial");
    var dial = Dial ? Dial.mount(dialMount, "clock") : null;

    var targetTs = null;
    var armed = false;
    var ringing = false;
    var alarmHandle = null;
    var intervalId = null;

    function defaultTimeString() {
      var d = new Date(Date.now() + 5 * 60000);
      return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
    }
    timeInput.value = defaultTimeString();

    function updateHands(d) {
      if (!dial) return;
      var h = d.getHours() % 12;
      var m = d.getMinutes();
      var hourDeg = (h + m / 60) * 30;
      var minDeg = m * 6;
      dial.setHands(hourDeg, minDeg);
    }

    function tick() {
      var nowDate = new Date();
      readout.textContent = pad2(nowDate.getHours()) + ":" + pad2(nowDate.getMinutes()) + ":" + pad2(nowDate.getSeconds());
      updateHands(nowDate);
      if (armed && !ringing && targetTs !== null && Date.now() >= targetTs) {
        ring();
      }
    }

    function ring() {
      ringing = true;
      statusEl.textContent = "Ringing";
      statusEl.setAttribute("data-state", "ringing");
      readout.classList.add("is-ringing");
      armBtn.hidden = true;
      cancelBtn.hidden = true;
      stopBtn.hidden = false;
      hintEl.textContent = "Alarm! Tap Stop to dismiss.";
      alarmHandle = Audio ? Audio.startAlarm() : null;
    }

    armBtn.addEventListener("click", function () {
      if (Audio) Audio.unlock();
      var parts = (timeInput.value || "").split(":");
      if (parts.length !== 2) return;
      var h = Number(parts[0]),
        m = Number(parts[1]);
      if (isNaN(h) || isNaN(m)) return;
      var target = new Date();
      target.setHours(h, m, 0, 0);
      if (target.getTime() <= Date.now()) {
        target.setDate(target.getDate() + 1);
      }
      targetTs = target.getTime();
      armed = true;
      statusEl.textContent = "Armed for " + pad2(h) + ":" + pad2(m);
      statusEl.setAttribute("data-state", "armed");
      armBtn.hidden = true;
      cancelBtn.hidden = false;
      cancelBtn.disabled = false;
      timeInput.disabled = true;
      hintEl.textContent = "This tab must stay open for the alarm to ring.";
      if (dial) dial.setMarker(((h % 12) + m / 60) * 30);
    });

    cancelBtn.addEventListener("click", function () {
      armed = false;
      targetTs = null;
      statusEl.textContent = "No alarm set";
      statusEl.setAttribute("data-state", "idle");
      armBtn.hidden = false;
      cancelBtn.hidden = true;
      timeInput.disabled = false;
      hintEl.textContent = "Set a time and tap Set Alarm — this tab must stay open for the alarm to ring.";
      if (dial) dial.clearMarker();
    });

    stopBtn.addEventListener("click", function () {
      ringing = false;
      if (alarmHandle) alarmHandle.stop();
      readout.classList.remove("is-ringing");
      stopBtn.hidden = true;
      if (repeatInput.checked && targetTs !== null) {
        targetTs += 24 * 60 * 60 * 1000;
        var d = new Date(targetTs);
        statusEl.textContent = "Armed for " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
        statusEl.setAttribute("data-state", "armed");
        cancelBtn.hidden = false;
        hintEl.textContent = "Repeats daily — this tab must stay open for the alarm to ring.";
      } else {
        armed = false;
        targetTs = null;
        statusEl.textContent = "No alarm set";
        statusEl.setAttribute("data-state", "idle");
        armBtn.hidden = false;
        cancelBtn.hidden = true;
        timeInput.disabled = false;
        hintEl.textContent = "Set a time and tap Set Alarm — this tab must stay open for the alarm to ring.";
        if (dial) dial.clearMarker();
      }
    });

    tick();
    intervalId = window.setInterval(tick, 250);
  }

  /* ============================ INTERVAL TIMER (iv-) ============================ */
  function initInterval() {
    var startBtn = document.getElementById("iv-start");
    if (!startBtn) return;
    var pauseBtn = document.getElementById("iv-pause");
    var resetBtn = document.getElementById("iv-reset");
    var readout = document.getElementById("iv-readout");
    var phaseLabel = document.getElementById("iv-phase");
    var statusEl = document.getElementById("iv-status");
    var pipsEl = document.getElementById("iv-pips");
    var workInput = document.getElementById("iv-work");
    var restInput = document.getElementById("iv-rest");
    var roundsInput = document.getElementById("iv-rounds");
    var dialMount = document.getElementById("iv-dial");
    var dial = Dial ? Dial.mount(dialMount, "arc") : null;

    var PREP_MS = 5000;
    var phase = "work"; // prep | work | rest | done
    var round = 1;
    var totalMs = 0;
    var accumulatedMs = 0;
    var startTs = 0;
    var running = false;
    var rafId = null;
    var everStarted = false;

    function cfg() {
      return {
        work: Math.max(1, Math.min(600, Number(workInput.value) || 20)),
        rest: Math.max(1, Math.min(600, Number(restInput.value) || 10)),
        rounds: Math.max(1, Math.min(50, Number(roundsInput.value) || 8)),
      };
    }

    function phaseDurationMs(p) {
      var c = cfg();
      if (p === "prep") return PREP_MS;
      if (p === "work") return c.work * 1000;
      if (p === "rest") return c.rest * 1000;
      return 0;
    }

    function renderPips() {
      var c = cfg();
      var html = "";
      for (var i = 0; i < c.rounds; i++) {
        var cls = "pip";
        if (i < round - 1 || (i === round - 1 && phase === "done")) cls += " is-done";
        else if (i === round - 1 && (phase === "work" || phase === "rest")) cls += " is-current";
        html += '<span class="' + cls + '"></span>';
      }
      pipsEl.innerHTML = html;
    }

    function remainingMs() {
      var elapsed = accumulatedMs + (running ? now() - startTs : 0);
      return Math.max(0, totalMs - elapsed);
    }

    function phaseText() {
      if (phase === "prep") return "Get ready";
      if (phase === "work") return "Work";
      if (phase === "rest") return "Rest";
      return "Done";
    }

    function render() {
      var rem = remainingMs();
      readout.textContent = phase === "done" ? "00:00" : fmtMinSec(rem / 1000);
      readout.classList.toggle("is-cyan", phase === "rest" || phase === "prep");
      phaseLabel.textContent = phaseText() + (phase === "work" || phase === "rest" ? " · Round " + round + "/" + cfg().rounds : "");
      if (dial) dial.setProgress(totalMs > 0 ? rem / totalMs : phase === "done" ? 1 : 0, phase === "rest" || phase === "prep" ? "break" : "normal");
    }

    function setInputsDisabled(disabled) {
      [workInput, restInput, roundsInput].forEach(function (i) {
        i.disabled = disabled;
      });
    }

    function advance() {
      var c = cfg();
      if (phase === "prep") {
        phase = "work";
        if (Audio) Audio.chime();
      } else if (phase === "work") {
        if (round >= c.rounds) {
          phase = "done";
          if (Audio) {
            Audio.chime();
            window.setTimeout(function () {
              Audio.chime();
            }, 260);
          }
        } else {
          phase = "rest";
          if (Audio) Audio.chime();
        }
      } else if (phase === "rest") {
        round++;
        phase = "work";
        if (Audio) Audio.chime();
      }
      totalMs = phaseDurationMs(phase);
      accumulatedMs = 0;
      startTs = now();
      renderPips();
      render();
      if (phase === "done") {
        running = false;
        statusEl.textContent = "Done";
        statusEl.setAttribute("data-state", "idle");
        startBtn.disabled = false;
        startBtn.textContent = "Restart";
        pauseBtn.disabled = true;
        setInputsDisabled(false);
        if (rafId) cancelAnimationFrame(rafId);
      }
    }

    function loop() {
      if (!running) return;
      var rem = remainingMs();
      render();
      if (rem <= 0) {
        advance();
        if (!running) return;
      }
      rafId = requestAnimationFrame(loop);
    }

    startBtn.addEventListener("click", function () {
      if (Audio) Audio.unlock();
      if (running) return;
      if (!everStarted || phase === "done") {
        phase = "prep";
        round = 1;
        totalMs = PREP_MS;
        accumulatedMs = 0;
        startBtn.textContent = "Start";
      }
      everStarted = true;
      running = true;
      startTs = now();
      statusEl.textContent = "Running";
      statusEl.setAttribute("data-state", "running");
      startBtn.disabled = true;
      pauseBtn.disabled = false;
      setInputsDisabled(true);
      renderPips();
      rafId = requestAnimationFrame(loop);
    });

    pauseBtn.addEventListener("click", function () {
      if (!running) return;
      accumulatedMs += now() - startTs;
      running = false;
      statusEl.textContent = "Paused";
      statusEl.setAttribute("data-state", "paused");
      startBtn.disabled = false;
      pauseBtn.disabled = true;
      if (rafId) cancelAnimationFrame(rafId);
      render();
    });

    resetBtn.addEventListener("click", function () {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      phase = "work";
      round = 1;
      everStarted = false;
      accumulatedMs = 0;
      totalMs = phaseDurationMs("work");
      statusEl.textContent = "Idle";
      statusEl.setAttribute("data-state", "idle");
      startBtn.disabled = false;
      startBtn.textContent = "Start";
      pauseBtn.disabled = true;
      setInputsDisabled(false);
      renderPips();
      render();
    });

    [workInput, restInput, roundsInput].forEach(function (input) {
      input.addEventListener("input", function () {
        if (running) return;
        if (phase === "work" && !everStarted) totalMs = phaseDurationMs("work");
        renderPips();
        render();
      });
    });

    totalMs = phaseDurationMs("work");
    pauseBtn.disabled = true;
    renderPips();
    render();
  }

  /* ============================ WORLD CLOCK (wc-) ============================ */
  var WC_CITIES = [
    { tz: "America/Los_Angeles", name: "Los Angeles" },
    { tz: "America/Denver", name: "Denver" },
    { tz: "America/Chicago", name: "Chicago" },
    { tz: "America/New_York", name: "New York" },
    { tz: "America/Sao_Paulo", name: "São Paulo" },
    { tz: "UTC", name: "UTC" },
    { tz: "Europe/London", name: "London" },
    { tz: "Europe/Paris", name: "Paris" },
    { tz: "Europe/Berlin", name: "Berlin" },
    { tz: "Europe/Moscow", name: "Moscow" },
    { tz: "Africa/Cairo", name: "Cairo" },
    { tz: "Africa/Johannesburg", name: "Johannesburg" },
    { tz: "Asia/Dubai", name: "Dubai" },
    { tz: "Asia/Kolkata", name: "Mumbai / Delhi" },
    { tz: "Asia/Dhaka", name: "Dhaka" },
    { tz: "Asia/Bangkok", name: "Bangkok" },
    { tz: "Asia/Shanghai", name: "Shanghai" },
    { tz: "Asia/Hong_Kong", name: "Hong Kong" },
    { tz: "Asia/Tokyo", name: "Tokyo" },
    { tz: "Asia/Seoul", name: "Seoul" },
    { tz: "Australia/Perth", name: "Perth" },
    { tz: "Australia/Sydney", name: "Sydney" },
    { tz: "Pacific/Auckland", name: "Auckland" },
    { tz: "Pacific/Honolulu", name: "Honolulu" },
  ];

  var DEFAULT_CITIES = ["America/New_York", "Europe/London", "Asia/Kolkata", "Asia/Tokyo", "Australia/Sydney", "America/Los_Angeles"];

  function initWorldClock() {
    var grid = document.getElementById("wc-grid");
    if (!grid) return;
    var addSelect = document.getElementById("wc-add-select");
    var addBtn = document.getElementById("wc-add-btn");

    var selected = loadCities();

    function loadCities() {
      try {
        var raw = localStorage.getItem("clocklab-cities");
        if (raw) {
          var parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length) return parsed;
        }
      } catch (e) {}
      return DEFAULT_CITIES.slice();
    }

    function saveCities() {
      try {
        localStorage.setItem("clocklab-cities", JSON.stringify(selected));
      } catch (e) {}
    }

    function cityByTz(tz) {
      for (var i = 0; i < WC_CITIES.length; i++) {
        if (WC_CITIES[i].tz === tz) return WC_CITIES[i];
      }
      return { tz: tz, name: tz };
    }

    function offsetLabel(tz, d) {
      try {
        var parts = new Intl.DateTimeFormat("en-US", {
          timeZone: tz,
          timeZoneName: "shortOffset",
        }).formatToParts(d);
        for (var i = 0; i < parts.length; i++) {
          if (parts[i].type === "timeZoneName") return parts[i].value;
        }
      } catch (e) {}
      return "";
    }

    function localParts(tz, d) {
      var fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
      var parts = fmt.formatToParts(d);
      var h = 0,
        m = 0,
        s = 0;
      parts.forEach(function (p) {
        if (p.type === "hour") h = Number(p.value) % 24;
        if (p.type === "minute") m = Number(p.value);
        if (p.type === "second") s = Number(p.value);
      });
      return { h: h, m: m, s: s };
    }

    function dateLabel(tz, d) {
      return new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        weekday: "short",
        month: "short",
        day: "numeric",
      }).format(d);
    }

    function buildOptions() {
      addSelect.innerHTML = "";
      WC_CITIES.forEach(function (c) {
        if (selected.indexOf(c.tz) !== -1) return;
        var opt = document.createElement("option");
        opt.value = c.tz;
        opt.textContent = c.name;
        addSelect.appendChild(opt);
      });
      addBtn.disabled = !addSelect.options.length;
    }

    function renderGrid() {
      grid.innerHTML = "";
      selected.forEach(function (tz) {
        var city = cityByTz(tz);
        var card = document.createElement("div");
        card.className = "city-card";
        card.setAttribute("data-tz", tz);
        card.innerHTML =
          '<button type="button" class="remove-city" aria-label="Remove ' +
          city.name +
          '">✕</button>' +
          '<div class="city-head"><span class="city-name">' +
          city.name +
          '</span><span class="city-offset" data-role="offset"></span></div>' +
          '<div class="city-time" data-role="time"></div>' +
          '<div class="city-date" data-role="date"></div>' +
          '<div class="daynight-strip"><span class="sun" data-role="sun"></span></div>';
        grid.appendChild(card);
      });
      buildOptions();
      updateGrid();
    }

    function updateGrid() {
      var d = new Date();
      var cards = grid.querySelectorAll(".city-card");
      cards.forEach(function (card) {
        var tz = card.getAttribute("data-tz");
        var lp = localParts(tz, d);
        card.querySelector('[data-role="time"]').textContent = pad2(lp.h) + ":" + pad2(lp.m) + ":" + pad2(lp.s);
        card.querySelector('[data-role="date"]').textContent = dateLabel(tz, d);
        card.querySelector('[data-role="offset"]').textContent = offsetLabel(tz, d);
        var sun = card.querySelector('[data-role="sun"]');
        var frac = (lp.h + lp.m / 60) / 24;
        sun.style.left = (frac * 100).toFixed(2) + "%";
      });
    }

    grid.addEventListener("click", function (e) {
      var btn = e.target.closest && e.target.closest(".remove-city");
      if (!btn) return;
      var card = btn.closest(".city-card");
      var tz = card.getAttribute("data-tz");
      selected = selected.filter(function (t) {
        return t !== tz;
      });
      saveCities();
      renderGrid();
    });

    addBtn.addEventListener("click", function () {
      var tz = addSelect.value;
      if (!tz || selected.indexOf(tz) !== -1) return;
      selected.push(tz);
      saveCities();
      renderGrid();
    });

    renderGrid();
    window.setInterval(updateGrid, 1000);
  }

  /* ============================== BOOT ============================== */
  document.addEventListener("DOMContentLoaded", function () {
    initTheme();
    initMobileNav();
    initPanelSwitching();
    initCountdown();
    initStopwatch();
    initPomodoro();
    initAlarmClock();
    initInterval();
    initWorldClock();
  });
})();
