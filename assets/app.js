/*!
 * clocklab.net — shared app behaviour + every tool's timer engine.
 * Loaded on every page. Every init function is defensive (bails if its
 * elements aren't on the page), so the same file runs unmodified on the
 * homepage (all six tool panels present at once, hidden) and on every
 * standalone tool page (exactly one panel).
 *
 * Accuracy note: every timer here is driven from wall-clock timestamps
 * (Date.now()), never by counting setInterval ticks. Each render reads
 * "how much time has actually passed" from a stored start timestamp +
 * accumulated offset, so drift from tab throttling, GC pauses, or a slow
 * frame never accumulates — pausing and resuming repeatedly, or
 * backgrounding the tab for a while, still yields the correct
 * remaining/elapsed time on the next render.
 *
 * Date.now() rather than performance.now() specifically because
 * performance.now() is measured from *this page load* and is therefore
 * meaningless to a page that has since been reloaded. An absolute epoch
 * timestamp survives a refresh, which is what lets a running timer be
 * written to localStorage and picked back up mid-flight.
 *
 * Ticking comes from ClockLabTicker (a shared Web Worker pulse) rather
 * than requestAnimationFrame alone, because rAF stops dead in a hidden
 * tab and a countdown that only notices zero when you look at it is not
 * a countdown.
 */
(function () {
  "use strict";

  var Dial = window.ClockLabDial;
  var Audio = window.ClockLabAudio;
  var Store = window.ClockLabStore;
  var Ticker = window.ClockLabTicker;
  var Notify = window.ClockLabNotify;

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
    return Date.now();
  }

  /* ========================== SCREEN WAKE LOCK ==========================
   * A timer that a phone puts to sleep halfway through is not a timer.
   * navigator.wakeLock keeps the display awake, and the whole contract of
   * this module is that the lock is *given back*: every acquire is keyed by
   * the instrument that asked for it, and the moment the last instrument
   * stops running the sentinel is released. A gym phone left lit until the
   * battery is flat would be a worse defect than the one this fixes.
   *
   * Browsers drop a wake lock on their own whenever the page stops being
   * visible, and the sentinel does not come back by itself — so
   * visibilitychange re-requests it if somebody still wants it. A request
   * made while the page is hidden always rejects, hence the visibility
   * guard rather than a blind retry.
   *
   * Everything here no-ops silently where the API is missing (iOS Safari
   * before 16.4, and any browser with the page in an insecure context).
   * The visible affordance below is driven off the *sentinel*, not off the
   * request, so the badge only ever claims the screen is being held awake
   * when it actually is. */

  var WakeLock = (function () {
    var api = null;
    try {
      api = navigator.wakeLock && typeof navigator.wakeLock.request === "function"
        ? navigator.wakeLock
        : null;
    } catch (e) {
      api = null;
    }

    var sentinel = null;
    var holders = {};
    var holderCount = 0;
    var listeners = [];

    function wanted() {
      return holderCount > 0;
    }

    function emit() {
      var active = !!sentinel;
      listeners.forEach(function (fn) {
        try {
          fn(active);
        } catch (e) {}
      });
    }

    function acquire() {
      if (!api || sentinel || !wanted()) return;
      if (document.visibilityState !== "visible") return;
      var pending;
      try {
        pending = api.request("screen");
      } catch (e) {
        return;
      }
      pending.then(
        function (s) {
          // Nobody is running any more by the time the promise settled.
          if (!wanted()) {
            s.release().catch(function () {});
            return;
          }
          sentinel = s;
          s.addEventListener("release", function () {
            if (sentinel === s) sentinel = null;
            emit();
          });
          emit();
        },
        function () {
          sentinel = null;
          emit();
        }
      );
    }

    function release() {
      var s = sentinel;
      sentinel = null;
      if (s) {
        try {
          var p = s.release();
          if (p && p.catch) p.catch(function () {});
        } catch (e) {}
      }
      emit();
    }

    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") acquire();
    });

    return {
      supported: !!api,
      /* Idempotent per key, so a start handler firing twice cannot leak a
         holder that never gets freed. */
      hold: function (key) {
        if (holders[key]) return;
        holders[key] = true;
        holderCount++;
        acquire();
      },
      free: function (key) {
        if (!holders[key]) return;
        delete holders[key];
        holderCount--;
        if (holderCount <= 0) {
          holderCount = 0;
          release();
        }
      },
      onChange: function (fn) {
        listeners.push(fn);
        fn(!!sentinel);
      },
    };
  })();

  /* Every instrument ships one <p data-wake-note> next to its controls. It
     is hidden until a sentinel is genuinely held, so the power draw is
     never silent. */
  function initWakeNotes() {
    var notes = [].slice.call(document.querySelectorAll("[data-wake-note]"));
    if (!notes.length) return;
    WakeLock.onChange(function (active) {
      notes.forEach(function (note) {
        note.hidden = !active;
      });
    });
  }

  /* ============================= ROOM MODE =============================
   * Deliberately a class on <body> rather than a :fullscreen rule.
   * Element.requestFullscreen() has never worked on iOS Safari for
   * anything but <video>, and a phone propped against a water bottle at
   * the side of a gym is the case this exists for — a layout keyed off
   * :fullscreen would simply never match there. So the layout is driven by
   * `body.room-mode` plus `data-room-panel`, which needs no API at all,
   * and requestFullscreen is layered on top as pure enhancement: if it
   * takes, the browser chrome goes too; if it throws or no-ops, nothing
   * about the layout changes.
   *
   * `.room-ancestor` is painted up the chain from the instrument to <main>
   * so the CSS can hide every sibling of the thing being shown without a
   * per-page selector list and without :has().
   *
   * Returns a small handle: init functions call `.alert(true)` when their
   * instrument hits its finish state, which floods the screen with the
   * alert colour — the point being that a muted room still sees zero. */
  function roomMode(instrument) {
    if (!instrument) return null;
    var btn = instrument.querySelector("[data-room-mode]");
    if (!btn) return null;

    var kind = btn.getAttribute("data-room-mode") || "timer";
    var active = false;
    var wentFullscreen = false;
    var ancestors = [];

    function fullscreenEl() {
      return document.fullscreenElement || document.webkitFullscreenElement || null;
    }

    function requestFullscreen() {
      var el = document.documentElement;
      var fn = el.requestFullscreen || el.webkitRequestFullscreen;
      if (!fn) return;
      try {
        var p = fn.call(el);
        if (p && p.then) {
          p.then(
            function () {
              wentFullscreen = true;
            },
            function () {}
          );
        } else {
          wentFullscreen = true;
        }
      } catch (e) {}
    }

    function dropFullscreen() {
      if (!wentFullscreen) return;
      wentFullscreen = false;
      var fn = document.exitFullscreen || document.webkitExitFullscreen;
      if (!fn || !fullscreenEl()) return;
      try {
        var p = fn.call(document);
        if (p && p.catch) p.catch(function () {});
      } catch (e) {}
    }

    function enter() {
      if (active) return;
      active = true;
      ancestors = [];
      var node = instrument.parentElement;
      while (node && node !== document.body) {
        node.classList.add("room-ancestor");
        ancestors.push(node);
        node = node.parentElement;
      }
      instrument.classList.add("is-room");
      document.body.classList.add("room-mode");
      document.body.setAttribute("data-room-panel", kind);
      btn.setAttribute("aria-pressed", "true");
      btn.textContent = "Exit room mode";
      requestFullscreen();
    }

    function exit() {
      if (!active) return;
      active = false;
      ancestors.forEach(function (node) {
        node.classList.remove("room-ancestor");
      });
      ancestors = [];
      instrument.classList.remove("is-room");
      document.body.classList.remove("room-mode");
      document.body.removeAttribute("data-room-panel");
      btn.setAttribute("aria-pressed", "false");
      btn.textContent = "Room mode";
      dropFullscreen();
      btn.focus();
    }

    btn.addEventListener("click", function () {
      if (active) exit();
      else enter();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && active) exit();
    });

    // Leaving fullscreen by the browser's own affordance (F11, the Esc
    // overlay) should leave room mode with it, or the visitor is stuck in
    // a chrome-less page with no obvious way out.
    ["fullscreenchange", "webkitfullscreenchange"].forEach(function (evt) {
      document.addEventListener(evt, function () {
        if (!fullscreenEl() && wentFullscreen && active) {
          wentFullscreen = false;
          exit();
        }
      });
    });

    return {
      alert: function (on) {
        instrument.classList.toggle("is-room-alert", !!on);
      },
      exit: exit,
    };
  }

  /* ========================== NOTIFICATIONS ==========================
   * One shared "alert me" preference across every timer — it is the same
   * question ("may I interrupt you?"), so answering it once on the
   * countdown should not have to be answered again on the pomodoro. The
   * permission prompt is only ever raised from the click that ticks the
   * box, never on page load. */

  var NOTIFY_KEY = "notify";
  var notifyOn = false;

  function notifyEnabled() {
    return notifyOn && Notify && Notify.permission() === "granted";
  }

  function notify(title, body, tag) {
    if (!notifyEnabled()) return;
    Notify.send(title, body, tag);
  }

  function initNotifyToggles() {
    var boxes = [].slice.call(document.querySelectorAll("[data-notify-toggle]"));
    if (!boxes.length || !Notify) return;

    var stored = Store ? Store.load(NOTIFY_KEY) : null;
    notifyOn = !!(stored && stored.on) && Notify.permission() === "granted";

    function paint() {
      boxes.forEach(function (box) {
        box.checked = notifyOn;
        var state = document.getElementById(box.id + "-state");
        if (!state) return;
        if (!Notify.supported()) {
          state.textContent = "This browser has no notification support.";
        } else if (Notify.permission() === "denied") {
          state.textContent = "Blocked — allow notifications for this site in your browser settings.";
        } else if (notifyOn) {
          state.textContent = "On — you'll get a system notification even in another tab.";
        } else {
          state.textContent = "";
        }
      });
    }

    function setOn(value) {
      notifyOn = value;
      if (Store) Store.save(NOTIFY_KEY, { on: value });
      paint();
    }

    boxes.forEach(function (box) {
      box.addEventListener("change", function () {
        if (!box.checked) {
          setOn(false);
          return;
        }
        // Asking here, inside the click, is the only place a browser will
        // reliably show the prompt.
        Notify.request(function (permission) {
          setOn(permission === "granted");
        });
      });
    });

    paint();
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

  /* ============================ PANEL SWITCHING ============================ */
  // Homepage only: instant tool switching with pushState, no reload.
  function initPanelSwitching() {
    var panels = document.querySelectorAll("[data-panel]");
    var overview = document.getElementById("overview-panel");
    if (!panels.length || !overview) return;

    var navLinks = document.querySelectorAll("[data-panel-link]");
    var hero = document.querySelector(".hero");

    function show(slug, push, initial) {
      // On arrival the homepage drops straight into the primary tool, so the
      // first thing on screen is a usable timer rather than a menu. But an
      // explicit "Home" or "← All tools" click is a request for the grid, and
      // answering that with the countdown timer made both links a lie: the
      // tool grid could not be reached at all. Back/forward (push=false, but
      // not the initial load) returns to whichever of the two you were on.
      if (!slug && initial) slug = "countdown-timer";
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

      // The toolbar is static markup stamped at build time, and it is right on
      // all 25 other pages. Here it is not: switching a panel rewrites the URL
      // without a reload, so without this the rail sits with nothing selected
      // on a page that is plainly showing a tool.
      var here = slug ? "/" + slug + "/" : "/";
      document.querySelectorAll(".toolbar a").forEach(function (a) {
        if (a.getAttribute("href") === here) {
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

    show(null, false, true);
  }

  /* ============================ SETUP IN THE URL ============================ */
  /* A timer setup travels as query parameters, so one link reproduces it:
       /countdown-timer/?t=25m&start=1
       /interval-timer/?work=20s&rest=10s&rounds=8
       /pomodoro-timer/?focus=25m&short=5m&long=15m
     Each page writes its current setup back with replaceState on every
     change, so the address bar is always a link that reproduces the setup.
     The homepage owns its own URL (panel switching), so it never writes one. */

  var onHomepage = !!document.getElementById("overview-panel");

  function urlParams() {
    try {
      return new URLSearchParams(location.search);
    } catch (e) {
      return null;
    }
  }

  // "1h30m" -> 5400, "25m" -> 1500, "90s" -> 90. A bare number counts in
  // `unitSeconds`: seconds on the countdown and interval pages, minutes on
  // the pomodoro page, because that is the unit of the field it fills.
  function parseDuration(raw, unitSeconds) {
    if (raw === null || raw === undefined) return NaN;
    var s = String(raw).toLowerCase().replace(/\s+/g, "");
    if (!s) return NaN;
    if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s) * unitSeconds);
    var total = 0;
    var matched = false;
    var rest = s.replace(/(\d+(?:\.\d+)?)(h|m|s)/g, function (_, n, unit) {
      matched = true;
      total += Number(n) * (unit === "h" ? 3600 : unit === "m" ? 60 : 1);
      return "";
    });
    if (!matched || rest) return NaN;
    return Math.round(total);
  }

  // 5400 -> "1h30m", 1500 -> "25m", 90 -> "1m30s", 45 -> "45s".
  function fmtDuration(seconds) {
    var total = Math.max(0, Math.round(seconds));
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    var out = "";
    if (h) out += h + "h";
    if (m) out += m + "m";
    if (s || !out) out += s + "s";
    return out;
  }

  // 1500 -> "25:00", 5400 -> "1:30:00". The tab title, not the readout.
  function fmtClock(seconds) {
    var total = Math.max(0, Math.round(seconds));
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    return (h ? h + ":" + pad2(m) : String(m)) + ":" + pad2(s);
  }

  function buildShareUrl(path, setup) {
    var qs = new URLSearchParams();
    Object.keys(setup).forEach(function (k) {
      qs.set(k, setup[k]);
    });
    return location.origin + path + "?" + qs.toString();
  }

  // Rewrites the address bar in place. `start` is dropped: a link that was
  // opened with start=1 must not start again on a plain reload after the
  // visitor changed the setup.
  function writeSetupUrl(setup) {
    if (onHomepage || !window.history || !history.replaceState) return;
    try {
      var qs = new URLSearchParams(location.search);
      Object.keys(setup).forEach(function (k) {
        qs.set(k, setup[k]);
      });
      qs.delete("start");
      qs.delete("autostart");
      history.replaceState(history.state, "", location.pathname + "?" + qs.toString() + location.hash);
    } catch (e) {}
  }

  function wantsStart() {
    return /(^|[?&])(start|autostart)=1(&|$)/.test(location.search);
  }

  // Audio cannot be unlocked without a gesture, and following a link is not
  // one. So the timer starts, and the first interaction of any kind
  // afterwards unlocks sound in time for the alarm.
  function startFromLink(startBtn) {
    var unlockOnce = function () {
      if (Audio) Audio.unlock();
      document.removeEventListener("pointerdown", unlockOnce, true);
      document.removeEventListener("keydown", unlockOnce, true);
    };
    document.addEventListener("pointerdown", unlockOnce, true);
    document.addEventListener("keydown", unlockOnce, true);
    startBtn.click();
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try {
        ok = document.execCommand("copy");
      } catch (e) {}
      document.body.removeChild(ta);
      if (ok) resolve();
      else reject(new Error("copy failed"));
    });
  }

  // "Copy link" buttons. `buildUrl` runs at click time, so the link always
  // carries the setup on screen at that moment.
  function initCopyLink(btn, buildUrl) {
    if (!btn) return;
    var label = btn.textContent;
    var timer = null;
    function flash(text) {
      btn.textContent = text;
      window.clearTimeout(timer);
      timer = window.setTimeout(function () {
        btn.textContent = label;
      }, 1600);
    }
    btn.addEventListener("click", function () {
      var url = buildUrl();
      copyText(url).then(
        function () {
          flash("Copied");
        },
        function () {
          flash("Copy failed");
          window.prompt("Copy this link", url);
        }
      );
    });
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
    var room = roomMode(startBtn.closest(".instrument"));

    var STORE_KEY = "countdown";
    var WAKE_KEY = "countdown";

    var totalMs = 0;
    var accumulatedMs = 0;
    var startTs = 0;
    var running = false;
    var ringing = false;
    var alarmHandle = null;

    var ticker = Ticker.create(tick);

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

    // Deliberately stores startTs + totalMs rather than a remaining time:
    // remaining time computed at save is already wrong by the time the page
    // comes back, whereas an epoch timestamp stays true no matter how long
    // the tab was shut.
    function persist() {
      if (!Store) return;
      if (!running && !ringing && accumulatedMs === 0) {
        Store.clear(STORE_KEY);
        return;
      }
      Store.save(STORE_KEY, {
        h: hInput.value,
        m: mInput.value,
        s: sInput.value,
        totalMs: totalMs,
        accumulatedMs: accumulatedMs,
        startTs: startTs,
        running: running,
        ringing: ringing,
      });
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

    function tick() {
      render();
      if (running && remainingMs() <= 0) finish(true);
    }

    // `live` is false when we are only discovering, on load, that the
    // countdown expired while the tab was closed.
    function finish(live) {
      running = false;
      ticker.stop();
      accumulatedMs = totalMs;
      ringing = true;
      statusEl.textContent = live ? "Ringing" : "Finished";
      statusEl.setAttribute("data-state", "ringing");
      startBtn.hidden = true;
      pauseBtn.hidden = true;
      resetBtn.hidden = true;
      stopAlarmBtn.hidden = false;
      stopAlarmBtn.textContent = live ? "Stop Alarm" : "Dismiss";
      // Zero is reached: the screen no longer has to be held awake, and
      // the room-mode layout floods with the alert colour instead.
      WakeLock.free(WAKE_KEY);
      if (room) room.alert(true);
      render();
      persist();
      if (live) {
        alarmHandle = Audio ? Audio.startAlarm() : null;
        notify("Countdown finished", fmtHMS(totalMs / 1000) + " is up.", "clocklab-countdown");
      }
    }

    function setRunningUi() {
      statusEl.textContent = "Running";
      statusEl.setAttribute("data-state", "running");
      startBtn.disabled = true;
      pauseBtn.disabled = false;
      setInputsDisabled(true);
      WakeLock.hold(WAKE_KEY);
      if (room) room.alert(false);
    }

    function setPausedUi() {
      statusEl.textContent = "Paused";
      statusEl.setAttribute("data-state", "paused");
      startBtn.disabled = false;
      pauseBtn.disabled = true;
      setInputsDisabled(true);
      WakeLock.free(WAKE_KEY);
    }

    function clearToIdle() {
      ringing = false;
      WakeLock.free(WAKE_KEY);
      if (room) room.alert(false);
      if (alarmHandle) alarmHandle.stop();
      alarmHandle = null;
      accumulatedMs = 0;
      totalMs = readInputsMs();
      statusEl.textContent = "Idle";
      statusEl.setAttribute("data-state", "idle");
      startBtn.hidden = false;
      pauseBtn.hidden = false;
      resetBtn.hidden = false;
      stopAlarmBtn.hidden = true;
      stopAlarmBtn.textContent = "Stop Alarm";
      startBtn.disabled = false;
      pauseBtn.disabled = true;
      setInputsDisabled(false);
      if (Store) Store.clear(STORE_KEY);
      render();
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
      setRunningUi();
      persist();
      ticker.start();
    });

    pauseBtn.addEventListener("click", function () {
      if (!running) return;
      accumulatedMs += now() - startTs;
      running = false;
      ticker.stop();
      setPausedUi();
      persist();
      render();
    });

    resetBtn.addEventListener("click", function () {
      running = false;
      ticker.stop();
      clearToIdle();
    });

    stopAlarmBtn.addEventListener("click", clearToIdle);

    [hInput, mInput, sInput].forEach(function (input) {
      input.addEventListener("input", function () {
        if (running || ringing) return;
        totalMs = readInputsMs();
        accumulatedMs = 0;
        persist();
        render();
        syncUrl();
      });
    });

    function restore() {
      var s = Store ? Store.load(STORE_KEY) : null;
      if (!s || !Number(s.totalMs)) return false;

      if (s.h !== undefined) hInput.value = s.h;
      if (s.m !== undefined) mInput.value = s.m;
      if (s.s !== undefined) sInput.value = s.s;
      totalMs = Number(s.totalMs);
      accumulatedMs = Number(s.accumulatedMs) || 0;
      startTs = Number(s.startTs) || 0;

      if (s.running && startTs > 0) {
        running = true;
        if (remainingMs() > 0) {
          setRunningUi();
          ticker.start();
          render();
          return true;
        }
        // Expired while we were gone. Show it, silently — audio without a
        // user gesture is blocked anyway, and an alarm that starts mid-blast
        // on page load is worse than a clear label.
        finish(false);
        return true;
      }

      if (s.ringing) {
        running = false;
        finish(false);
        return true;
      }

      running = false;
      if (accumulatedMs > 0) {
        setPausedUi();
      } else {
        pauseBtn.disabled = true;
      }
      render();
      return true;
    }

    /* ---- preset pages: /5-minute-timer/, /egg-timer/ and the rest ---- */
    /* Someone arriving from a search for "5 minute timer" should be one tap
       from a running timer, not editing three number fields. The page states
       its duration on the workspace element; the fields are already written
       out to match, so this only has to agree with them. */

    var workspace = startBtn.closest(".instrument");
    var presetSeconds = workspace ? Math.max(0, Number(workspace.dataset.duration) || 0) : 0;

    /* ---- shared links: /countdown-timer/?t=25m&start=1 ---- */
    /* A duration in the URL is a preset that arrived by link. It takes the
       same path as a preset page: it is dialled in unless the saved countdown
       is this very setup mid-flight, and start=1 runs it without a tap. */
    var params = urlParams();
    var sharedSeconds = params ? parseDuration(params.get("t"), 1) : NaN;
    var sharedVisit = sharedSeconds > 0;
    if (sharedVisit) presetSeconds = Math.min(sharedSeconds, 23 * 3600 + 59 * 60 + 59);

    function currentSeconds() {
      return Math.round(readInputsMs() / 1000);
    }

    function syncUrl() {
      var secs = currentSeconds();
      writeSetupUrl({ t: fmtDuration(secs) });
      if (sharedVisit) document.title = fmtClock(secs) + " countdown \u2014 clocklab.net";
    }

    initCopyLink(document.getElementById("cd-copy-link"), function () {
      return buildShareUrl("/countdown-timer/", { t: fmtDuration(currentSeconds()) });
    });

    function applyDuration(seconds) {
      var total = Math.max(0, Math.min(23 * 3600 + 59 * 60 + 59, Math.floor(seconds)));
      hInput.value = Math.floor(total / 3600);
      mInput.value = Math.floor((total % 3600) / 60);
      sInput.value = total % 60;
      totalMs = readInputsMs();
      accumulatedMs = 0;
    }

    // Egg timer and anything else offering named presets: one tap sets the
    // time and starts it, because two taps to boil an egg is one too many.
    if (workspace) {
      var presetBtns = workspace.querySelectorAll("[data-preset-seconds]");
      Array.prototype.forEach.call(presetBtns, function (btn) {
        btn.addEventListener("click", function () {
          running = false;
          ticker.stop();
          clearToIdle();
          applyDuration(Number(btn.dataset.presetSeconds));
          render();
          syncUrl();
          Array.prototype.forEach.call(presetBtns, function (other) {
            other.classList.toggle("is-active", other === btn);
            other.setAttribute("aria-pressed", String(other === btn));
          });
          startBtn.click(); // inside a real gesture, so this also unlocks audio
        });
      });
    }

    var stored = Store ? Store.load(STORE_KEY) : null;
    // Whether the saved countdown is one of *this* page's own.
    //
    // Every page shares one storage key, so a preset page has to tell "I
    // started this here and then reloaded" apart from "something else is
    // running elsewhere". Duration is what tells them apart. A reload or a
    // pause on this page resumes exactly as it does on the countdown timer;
    // a twenty-minute timer left running in another tab does not get to
    // greet a visitor who came looking for five minutes.
    var pageDurations = [presetSeconds];
    if (workspace) {
      Array.prototype.forEach.call(
        workspace.querySelectorAll("[data-preset-seconds]"),
        function (btn) { pageDurations.push(Number(btn.dataset.presetSeconds)); }
      );
    }
    var storedIsThisPage = !!(
      stored && Number(stored.totalMs) &&
      pageDurations.indexOf(Math.round(Number(stored.totalMs) / 1000)) !== -1
    );

    if (presetSeconds > 0 && !storedIsThisPage) {
      applyDuration(presetSeconds);
      pauseBtn.disabled = true;
      render();

      if (wantsStart()) startFromLink(startBtn);
    } else if (!restore()) {
      totalMs = readInputsMs();
      pauseBtn.disabled = true;
      render();
    }
    if (sharedVisit) document.title = fmtClock(currentSeconds()) + " countdown \u2014 clocklab.net";
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
    var room = roomMode(startBtn.closest(".instrument"));
    var WAKE_KEY = "stopwatch";
    var dialMount = document.getElementById("sw-dial");
    var dial = Dial ? Dial.mount(dialMount, "sweep") : null;

    var STORE_KEY = "stopwatch";

    var accumulatedMs = 0;
    var startTs = 0;
    var running = false;
    var laps = []; // elapsed ms at each lap, in order

    var ticker = Ticker.create(render);

    function elapsedMs() {
      return accumulatedMs + (running ? now() - startTs : 0);
    }

    function persist() {
      if (!Store) return;
      if (!running && accumulatedMs === 0 && !laps.length) {
        Store.clear(STORE_KEY);
        return;
      }
      Store.save(STORE_KEY, {
        accumulatedMs: accumulatedMs,
        startTs: startTs,
        running: running,
        laps: laps,
      });
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

    function setState(state) {
      // One funnel for every transition, so the wake lock can never be
      // held by a stopwatch that is not moving.
      if (state === "running") WakeLock.hold(WAKE_KEY);
      else WakeLock.free(WAKE_KEY);
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
        ticker.stop();
        render();
        setState("stopped");
      } else {
        running = true;
        startTs = now();
        setState("running");
        ticker.start();
      }
      persist();
    });

    lapBtn.addEventListener("click", function () {
      if (!running) return;
      if (Audio) Audio.tick();
      laps.push(elapsedMs());
      renderLaps();
      persist();
    });

    resetBtn.addEventListener("click", function () {
      if (running) return;
      accumulatedMs = 0;
      laps = [];
      renderLaps();
      render();
      setState("idle");
      persist();
    });

    function restore() {
      var s = Store ? Store.load(STORE_KEY) : null;
      if (!s) return false;
      accumulatedMs = Number(s.accumulatedMs) || 0;
      startTs = Number(s.startTs) || 0;
      laps = Array.isArray(s.laps) ? s.laps : [];
      running = !!s.running && startTs > 0;

      if (running) {
        setState("running");
        ticker.start();
      } else if (accumulatedMs > 0 || laps.length) {
        setState("stopped");
      } else {
        setState("idle");
      }
      render();
      renderLaps();
      return true;
    }

    if (!restore()) {
      setState("idle");
      render();
      renderLaps();
    }
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
    var room = roomMode(startBtn.closest(".instrument"));

    var STORE_KEY = "pomodoro";
    var WAKE_KEY = "pomodoro";

    var phase = "work"; // work | break | longbreak
    var sessionIndex = 0; // completed work sessions in current cycle
    var totalMs = 0;
    var accumulatedMs = 0;
    var startTs = 0;
    var running = false;

    var ticker = Ticker.create(tick);

    function persist() {
      if (!Store) return;
      if (!running && accumulatedMs === 0 && sessionIndex === 0 && phase === "work") {
        Store.clear(STORE_KEY);
        return;
      }
      Store.save(STORE_KEY, {
        phase: phase,
        sessionIndex: sessionIndex,
        totalMs: totalMs,
        accumulatedMs: accumulatedMs,
        startTs: startTs,
        running: running,
        work: workInput.value,
        brk: breakInput.value,
        longBrk: longBreakInput.value,
        sessions: sessionsInput.value,
      });
    }

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

    function phaseTitle(p) {
      return p === "work" ? "Focus" : p === "break" ? "Short break" : "Long break";
    }

    function render() {
      var rem = remainingMs();
      readout.textContent = fmtMinSec(rem / 1000);
      readout.classList.toggle("is-cyan", phase !== "work");
      phaseLabel.textContent = phaseTitle(phase);
      if (dial) dial.setProgress(totalMs > 0 ? rem / totalMs : 0, phase !== "work" ? "break" : "normal");
    }

    function setInputsDisabled(disabled) {
      [workInput, breakInput, longBreakInput, sessionsInput].forEach(function (i) {
        i.disabled = disabled;
      });
    }

    function advancePhase(natural) {
      var c = cfg();
      // Carry the overshoot into the next phase. Resetting the clock to
      // "now" at every switch would shed a tick's worth of time per phase,
      // and after a reload the overshoot is the entire interval we were
      // away for — which is exactly what has to be replayed to land on the
      // phase the user should actually be in.
      var overshoot = Math.max(0, accumulatedMs + (running ? now() - startTs : 0) - totalMs);
      var from = phase;

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
      accumulatedMs = running ? overshoot : 0;
      startTs = now();
      if (natural) {
        if (Audio) Audio.chime();
        notify(
          phaseTitle(from) + " done",
          "Next up: " + phaseTitle(phase).toLowerCase() + ", " + Math.round(totalMs / 60000) + " min.",
          "clocklab-pomodoro"
        );
      }
      renderPips();
      render();
    }

    function tick() {
      // A loop, not an `if`: after a reload or a long stretch in a hidden
      // tab, several phases may have come and gone at once.
      var guard = 0;
      while (running && remainingMs() <= 0 && guard++ < 500) {
        var overshoot = accumulatedMs + (now() - startTs) - totalMs;
        // Only a switch that happened just now deserves a chime. The ones
        // being replayed after the fact already went unheard.
        advancePhase(overshoot < 1500);
      }
      render();
      if (guard > 0) persist();
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
      WakeLock.hold(WAKE_KEY);
      persist();
      ticker.start();
    });

    pauseBtn.addEventListener("click", function () {
      if (!running) return;
      accumulatedMs += now() - startTs;
      running = false;
      statusEl.textContent = "Paused";
      statusEl.setAttribute("data-state", "paused");
      startBtn.disabled = false;
      pauseBtn.disabled = true;
      ticker.stop();
      WakeLock.free(WAKE_KEY);
      persist();
      render();
    });

    skipBtn.addEventListener("click", function () {
      // advancePhase already folds the running time in; adding it here too
      // would count the current phase twice.
      advancePhase(false);
      persist();
    });

    resetBtn.addEventListener("click", function () {
      running = false;
      ticker.stop();
      WakeLock.free(WAKE_KEY);
      phase = "work";
      sessionIndex = 0;
      accumulatedMs = 0;
      totalMs = phaseDurationMs("work");
      statusEl.textContent = "Idle";
      statusEl.setAttribute("data-state", "idle");
      startBtn.disabled = false;
      pauseBtn.disabled = true;
      setInputsDisabled(false);
      if (Store) Store.clear(STORE_KEY);
      renderPips();
      render();
    });

    [workInput, breakInput, longBreakInput, sessionsInput].forEach(function (input) {
      input.addEventListener("input", function () {
        if (running) return;
        totalMs = phaseDurationMs(phase);
        renderPips();
        render();
        persist();
        syncUrl();
      });
    });

    function restore() {
      var s = Store ? Store.load(STORE_KEY) : null;
      if (!s || !Number(s.totalMs)) return false;

      if (s.work !== undefined) workInput.value = s.work;
      if (s.brk !== undefined) breakInput.value = s.brk;
      if (s.longBrk !== undefined) longBreakInput.value = s.longBrk;
      if (s.sessions !== undefined) sessionsInput.value = s.sessions;

      phase = s.phase === "break" || s.phase === "longbreak" ? s.phase : "work";
      sessionIndex = Number(s.sessionIndex) || 0;
      totalMs = Number(s.totalMs);
      accumulatedMs = Number(s.accumulatedMs) || 0;
      startTs = Number(s.startTs) || 0;
      running = !!s.running && startTs > 0;

      if (running) {
        statusEl.textContent = "Running";
        statusEl.setAttribute("data-state", "running");
        startBtn.disabled = true;
        pauseBtn.disabled = false;
        setInputsDisabled(true);
        WakeLock.hold(WAKE_KEY);
        renderPips();
        // Replays every phase boundary crossed while we were away, then
        // renders the phase the clock says we are actually in.
        tick();
        ticker.start();
      } else {
        statusEl.textContent = "Paused";
        statusEl.setAttribute("data-state", "paused");
        startBtn.disabled = false;
        pauseBtn.disabled = true;
        setInputsDisabled(true);
        renderPips();
        render();
      }
      return true;
    }

    /* ---- shared links: /pomodoro-timer/?focus=25m&short=5m&long=15m ---- */
    var params = urlParams();
    var shared = params && (params.has("focus") || params.has("short") || params.has("long") || params.has("sessions"))
      ? {
          focus: parseDuration(params.get("focus"), 60),
          brk: parseDuration(params.get("short"), 60),
          longBrk: parseDuration(params.get("long"), 60),
          sessions: Math.round(Number(params.get("sessions"))),
        }
      : null;

    function minutes(seconds, max) {
      return Math.max(1, Math.min(max, Math.round(seconds / 60)));
    }

    function setupForUrl() {
      var c = cfg();
      return { focus: fmtDuration(c.work * 60), short: fmtDuration(c.brk * 60), long: fmtDuration(c.longBrk * 60), sessions: c.sessions };
    }

    function syncUrl() {
      writeSetupUrl(setupForUrl());
      if (shared) {
        var c = cfg();
        document.title = c.work + "/" + c.brk + " pomodoro \u2014 clocklab.net";
      }
    }

    initCopyLink(document.getElementById("pd-copy-link"), function () {
      return buildShareUrl("/pomodoro-timer/", setupForUrl());
    });

    if (shared) {
      if (shared.focus > 0) workInput.value = minutes(shared.focus, 90);
      if (shared.brk > 0) breakInput.value = minutes(shared.brk, 60);
      if (shared.longBrk > 0) longBreakInput.value = minutes(shared.longBrk, 60);
      if (shared.sessions > 0) sessionsInput.value = Math.min(12, shared.sessions);
      // A saved cycle with this exact setup is a reload mid-session, and it
      // resumes. Any other saved cycle loses to the link.
      var saved = Store ? Store.load(STORE_KEY) : null;
      var sameSetup = !!(
        saved && Number(saved.totalMs) &&
        String(saved.work) === String(workInput.value) &&
        String(saved.brk) === String(breakInput.value) &&
        String(saved.longBrk) === String(longBreakInput.value) &&
        String(saved.sessions) === String(sessionsInput.value)
      );
      if (!sameSetup && Store) Store.clear(STORE_KEY);
    }

    if (!restore()) {
      totalMs = phaseDurationMs("work");
      pauseBtn.disabled = true;
      renderPips();
      render();
      if (shared && wantsStart()) startFromLink(startBtn);
    }
    if (shared) {
      var sc = cfg();
      document.title = sc.work + "/" + sc.brk + " pomodoro \u2014 clocklab.net";
    }
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

    var STORE_KEY = "alarm";
    var IDLE_HINT = "Set a time and tap Set Alarm — this tab must stay open for the alarm to ring.";

    var targetTs = null;
    var armed = false;
    var ringing = false;
    var alarmHandle = null;

    // smooth:false — this readout changes once a second and the hands once
    // a minute; a frame-rate pulse would buy nothing but battery drain.
    var ticker = Ticker.create(tick, { smooth: false });

    function defaultTimeString() {
      var d = new Date(Date.now() + 5 * 60000);
      return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
    }
    timeInput.value = defaultTimeString();

    function persist() {
      if (!Store) return;
      if (!armed) {
        Store.clear(STORE_KEY);
        return;
      }
      Store.save(STORE_KEY, {
        targetTs: targetTs,
        time: timeInput.value,
        repeat: !!repeatInput.checked,
      });
    }

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
        ring(true);
      }
    }

    // `live` is false when we are only discovering, on load, that the alarm
    // time went by while the tab was shut.
    function ring(live) {
      ringing = true;
      statusEl.textContent = live ? "Ringing" : "Alarm passed";
      statusEl.setAttribute("data-state", "ringing");
      readout.classList.add("is-ringing");
      armBtn.hidden = true;
      cancelBtn.hidden = true;
      stopBtn.hidden = false;
      if (live) {
        stopBtn.textContent = "Stop Alarm";
        hintEl.textContent = "Alarm! Tap Stop to dismiss.";
        alarmHandle = Audio ? Audio.startAlarm() : null;
        var d = new Date(targetTs);
        notify("Alarm — " + pad2(d.getHours()) + ":" + pad2(d.getMinutes()), "clocklab alarm clock.", "clocklab-alarm");
      } else {
        stopBtn.textContent = "Dismiss";
        hintEl.textContent = "This alarm came due while the page was closed, so it could not ring.";
      }
    }

    function setArmed(h, m) {
      statusEl.textContent = "Armed for " + pad2(h) + ":" + pad2(m);
      statusEl.setAttribute("data-state", "armed");
      armBtn.hidden = true;
      cancelBtn.hidden = false;
      cancelBtn.disabled = false;
      stopBtn.hidden = true;
      timeInput.disabled = true;
      if (dial) dial.setMarker(((h % 12) + m / 60) * 30);
    }

    function disarm() {
      armed = false;
      ringing = false;
      targetTs = null;
      statusEl.textContent = "No alarm set";
      statusEl.setAttribute("data-state", "idle");
      armBtn.hidden = false;
      cancelBtn.hidden = true;
      stopBtn.hidden = true;
      stopBtn.textContent = "Stop Alarm";
      timeInput.disabled = false;
      readout.classList.remove("is-ringing");
      hintEl.textContent = IDLE_HINT;
      if (dial) dial.clearMarker();
      if (Store) Store.clear(STORE_KEY);
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
      setArmed(h, m);
      hintEl.textContent = "Armed. Leave this tab open — turn on notifications above to be told even from another tab.";
      persist();
    });

    cancelBtn.addEventListener("click", disarm);

    stopBtn.addEventListener("click", function () {
      ringing = false;
      if (alarmHandle) alarmHandle.stop();
      alarmHandle = null;
      readout.classList.remove("is-ringing");
      if (repeatInput.checked && targetTs !== null) {
        // Roll forward past however many days went by, not just one.
        var dayMs = 24 * 60 * 60 * 1000;
        do {
          targetTs += dayMs;
        } while (targetTs <= Date.now());
        var d = new Date(targetTs);
        setArmed(d.getHours(), d.getMinutes());
        hintEl.textContent = "Repeats daily — this tab must stay open for the alarm to ring.";
        persist();
      } else {
        disarm();
      }
    });

    repeatInput.addEventListener("change", persist);

    function restore() {
      var s = Store ? Store.load(STORE_KEY) : null;
      if (!s || !Number(s.targetTs)) return false;
      if (s.time) timeInput.value = s.time;
      repeatInput.checked = !!s.repeat;
      targetTs = Number(s.targetTs);
      armed = true;

      if (targetTs > Date.now()) {
        var d = new Date(targetTs);
        setArmed(d.getHours(), d.getMinutes());
        hintEl.textContent = "Still armed from earlier — this tab must stay open for the alarm to ring.";
        return true;
      }

      if (repeatInput.checked) {
        var dayMs = 24 * 60 * 60 * 1000;
        do {
          targetTs += dayMs;
        } while (targetTs <= Date.now());
        var next = new Date(targetTs);
        setArmed(next.getHours(), next.getMinutes());
        hintEl.textContent = "Repeats daily — re-armed for the next occurrence.";
        persist();
        return true;
      }

      ring(false);
      return true;
    }

    restore();
    tick();
    ticker.start();
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
    var room = roomMode(startBtn.closest(".instrument"));

    var STORE_KEY = "interval";
    var WAKE_KEY = "interval";
    var PREP_MS = 5000;
    var phase = "work"; // prep | work | rest | done
    var round = 1;
    var totalMs = 0;
    var accumulatedMs = 0;
    var startTs = 0;
    var running = false;
    var everStarted = false;

    var ticker = Ticker.create(tick);

    function persist() {
      if (!Store) return;
      if (!everStarted) {
        Store.clear(STORE_KEY);
        return;
      }
      Store.save(STORE_KEY, {
        phase: phase,
        round: round,
        totalMs: totalMs,
        accumulatedMs: accumulatedMs,
        startTs: startTs,
        running: running,
        everStarted: everStarted,
        work: workInput.value,
        rest: restInput.value,
        rounds: roundsInput.value,
      });
    }

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

    function advance(natural) {
      var c = cfg();
      // Same overshoot-carrying rule as the pomodoro: the leftover past
      // zero belongs to the next phase, so a 20-second round stays a
      // 20-second round however coarse the pulse driving it is.
      var overshoot = Math.max(0, accumulatedMs + (running ? now() - startTs : 0) - totalMs);

      if (phase === "prep") {
        phase = "work";
        if (natural) {
          if (Audio) Audio.chime();
          notify("Round 1 — work", cfg().work + " seconds. Go.", "clocklab-interval");
        }
      } else if (phase === "work") {
        if (round >= c.rounds) {
          phase = "done";
          if (natural) {
            if (Audio) {
              Audio.chime();
              window.setTimeout(function () {
                Audio.chime();
              }, 260);
            }
            notify("Interval workout done", c.rounds + " rounds complete.", "clocklab-interval");
          }
        } else {
          phase = "rest";
          if (natural) {
            if (Audio) Audio.chime();
            notify("Rest", c.rest + " seconds before round " + (round + 1) + ".", "clocklab-interval");
          }
        }
      } else if (phase === "rest") {
        round++;
        phase = "work";
        if (natural) {
          if (Audio) Audio.chime();
          notify("Round " + round + " — work", c.work + " seconds. Go.", "clocklab-interval");
        }
      }
      totalMs = phaseDurationMs(phase);
      accumulatedMs = running && phase !== "done" ? overshoot : 0;
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
        ticker.stop();
        WakeLock.free(WAKE_KEY);
        if (room) room.alert(true);
      }
    }

    function tick() {
      var guard = 0;
      while (running && remainingMs() <= 0 && guard++ < 500) {
        var overshoot = accumulatedMs + (now() - startTs) - totalMs;
        advance(overshoot < 1500);
      }
      render();
      if (guard > 0) persist();
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
      WakeLock.hold(WAKE_KEY);
      if (room) room.alert(false);
      renderPips();
      persist();
      ticker.start();
    });

    pauseBtn.addEventListener("click", function () {
      if (!running) return;
      accumulatedMs += now() - startTs;
      running = false;
      statusEl.textContent = "Paused";
      statusEl.setAttribute("data-state", "paused");
      startBtn.disabled = false;
      pauseBtn.disabled = true;
      ticker.stop();
      WakeLock.free(WAKE_KEY);
      persist();
      render();
    });

    resetBtn.addEventListener("click", function () {
      running = false;
      ticker.stop();
      WakeLock.free(WAKE_KEY);
      if (room) room.alert(false);
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
      if (Store) Store.clear(STORE_KEY);
      renderPips();
      render();
    });

    [workInput, restInput, roundsInput].forEach(function (input) {
      input.addEventListener("input", function () {
        if (running) return;
        if (phase === "work" && !everStarted) totalMs = phaseDurationMs("work");
        renderPips();
        render();
        persist();
        syncUrl();
      });
    });

    function restore() {
      var s = Store ? Store.load(STORE_KEY) : null;
      if (!s || !s.everStarted) return false;

      if (s.work !== undefined) workInput.value = s.work;
      if (s.rest !== undefined) restInput.value = s.rest;
      if (s.rounds !== undefined) roundsInput.value = s.rounds;

      phase = ["prep", "work", "rest", "done"].indexOf(s.phase) !== -1 ? s.phase : "work";
      round = Number(s.round) || 1;
      totalMs = Number(s.totalMs) || phaseDurationMs(phase);
      accumulatedMs = Number(s.accumulatedMs) || 0;
      startTs = Number(s.startTs) || 0;
      everStarted = true;
      running = !!s.running && startTs > 0 && phase !== "done";

      if (running) {
        statusEl.textContent = "Running";
        statusEl.setAttribute("data-state", "running");
        startBtn.disabled = true;
        pauseBtn.disabled = false;
        setInputsDisabled(true);
        WakeLock.hold(WAKE_KEY);
        renderPips();
        tick();
        if (running) ticker.start();
      } else if (phase === "done") {
        statusEl.textContent = "Done";
        statusEl.setAttribute("data-state", "idle");
        startBtn.textContent = "Restart";
        pauseBtn.disabled = true;
        renderPips();
        render();
      } else {
        statusEl.textContent = "Paused";
        statusEl.setAttribute("data-state", "paused");
        pauseBtn.disabled = true;
        setInputsDisabled(true);
        renderPips();
        render();
      }
      return true;
    }

    /* ---- shared links: /interval-timer/?work=20s&rest=10s&rounds=8 ---- */
    var params = urlParams();
    var shared = params && (params.has("work") || params.has("rest") || params.has("rounds"))
      ? {
          work: parseDuration(params.get("work"), 1),
          rest: parseDuration(params.get("rest"), 1),
          rounds: Math.round(Number(params.get("rounds"))),
        }
      : null;

    function setupForUrl() {
      var c = cfg();
      return { work: fmtDuration(c.work), rest: fmtDuration(c.rest), rounds: c.rounds };
    }

    function syncUrl() {
      writeSetupUrl(setupForUrl());
      if (shared) {
        var c = cfg();
        document.title = c.rounds + " \u00d7 " + fmtDuration(c.work) + " interval \u2014 clocklab.net";
      }
    }

    initCopyLink(document.getElementById("iv-copy-link"), function () {
      return buildShareUrl("/interval-timer/", setupForUrl());
    });

    if (shared) {
      if (shared.work > 0) workInput.value = Math.min(600, shared.work);
      if (shared.rest > 0) restInput.value = Math.min(600, shared.rest);
      if (shared.rounds > 0) roundsInput.value = Math.min(50, shared.rounds);
      // A saved session with this exact setup is a reload mid-workout, and it
      // resumes. Any other saved session loses to the link.
      var saved = Store ? Store.load(STORE_KEY) : null;
      var sameSetup = !!(
        saved && saved.everStarted &&
        String(saved.work) === String(workInput.value) &&
        String(saved.rest) === String(restInput.value) &&
        String(saved.rounds) === String(roundsInput.value)
      );
      if (!sameSetup && Store) Store.clear(STORE_KEY);
    }

    if (!restore()) {
      totalMs = phaseDurationMs("work");
      pauseBtn.disabled = true;
      renderPips();
      render();
      if (shared && wantsStart()) startFromLink(startBtn);
    }
    if (shared) {
      var sc = cfg();
      document.title = sc.rounds + " \u00d7 " + fmtDuration(sc.work) + " interval \u2014 clocklab.net";
    }
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
    initNotifyToggles();
    initWakeNotes();
    initPanelSwitching();
    initCountdown();
    initStopwatch();
    initPomodoro();
    initAlarmClock();
    initInterval();
    initWorldClock();
  });
})();

/* ================================================================== *
 * toolbar v1 — the portfolio navigation pattern.                      *
 * Spec: github.com/ngineer420/ngineer420.github.io/issues/13          *
 *                                                                     *
 * Copy this block verbatim into any site in the portfolio. It is pure *
 * enhancement: with JS off, <details>/<summary> still discloses the   *
 * sheet, the rail is still a native scroll container of real links,   *
 * the edge fades are still CSS and the scrim is still CSS. Only the   *
 * active-chip centring, Escape and click-outside are lost.            *
 * ================================================================== */
(function toolbar() {
  const bar = document.querySelector(".toolbar");
  if (!bar) return;
  const rail = bar.querySelector(".tb-rail");
  const menu = bar.querySelector("details.tb-menu");

  if (rail) {
    // js-on hands the right-hand fade over to measurement. Until then the
    // CSS keeps it on, so a JS-disabled visitor never gets a chip clipped
    // mid-word with nothing to say there is more of the row.
    rail.classList.add("js-on");
    const fades = () => {
      const max = rail.scrollWidth - rail.clientWidth;
      rail.classList.toggle("can-l", rail.scrollLeft > 1);
      rail.classList.toggle("can-r", rail.scrollLeft < max - 1);
    };
    // Assigning scrollLeft, never scrollIntoView: that also scrolls every
    // ancestor and the document, which on a phone drops the visitor below
    // the header on arrival.
    const current = rail.querySelector("[aria-current]");
    if (current) {
      rail.scrollLeft = Math.max(
        0,
        current.offsetLeft - (rail.clientWidth - current.offsetWidth) / 2
      );
    }
    rail.addEventListener("scroll", fades, { passive: true });
    window.addEventListener("resize", fades);
    fades();
  }

  if (menu) {
    // A disclosure, not a modal: focus is deliberately not trapped, Tab
    // walks the links and straight out the other side.
    window.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !menu.open) return;
      menu.open = false;
      const summary = menu.querySelector("summary");
      if (summary) summary.focus();
    });
    document.addEventListener("click", (e) => {
      if (menu.open && !menu.contains(e.target)) menu.open = false;
    });
  }
})();

/* ================================================================== *
 * Offline. build.py writes /sw.js with a precache of every page and every
 * same-origin script and stylesheet. Registration waits for the load event
 * so that the worker install never competes with the page for bandwidth.
 * ================================================================== */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("/sw.js");
  });
}
