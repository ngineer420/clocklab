/*!
 * clocklab.net — the three things a timer needs to be trustworthy when you
 * are not watching it: a pulse that survives a backgrounded tab, state that
 * survives a reload, and an alert that reaches you in another window.
 *
 * ClockLabTicker  — one shared Web Worker pulse for the whole page, plus a
 *                   requestAnimationFrame pass while the tab is visible so
 *                   dials stay smooth. Both call the same handler; every
 *                   handler derives its numbers from Date.now(), so calling
 *                   it twice, late, or not for a minute all produce the same
 *                   correct answer.
 * ClockLabStore   — tiny localStorage wrapper. Engines persist a start
 *                   timestamp plus a duration, never a remaining time, so a
 *                   reload resumes against the real clock rather than
 *                   against wherever the interval happened to stop.
 * ClockLabNotify  — system notifications, so an alarm reaches someone who
 *                   has switched tabs. Web Audio alone does not.
 */
(function (global) {
  "use strict";

  /* =============================== STORE =============================== */

  var PREFIX = "clocklab-";

  var Store = {
    load: function (key) {
      try {
        var raw = global.localStorage.getItem(PREFIX + key);
        if (!raw) return null;
        var parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : null;
      } catch (e) {
        return null;
      }
    },
    save: function (key, value) {
      try {
        global.localStorage.setItem(PREFIX + key, JSON.stringify(value));
      } catch (e) {}
    },
    clear: function (key) {
      try {
        global.localStorage.removeItem(PREFIX + key);
      } catch (e) {}
    },
  };

  /* =============================== TICKER =============================== */

  var TICK_MS = 200;

  // Handlers that want a frame-rate pulse while visible (moving dials,
  // hundredths-of-a-second readouts) are in both lists; handlers that only
  // need to notice the passage of time are in `pulse` alone.
  var pulse = [];
  var smooth = [];

  var worker = null;
  var workerBroken = false;
  var fallbackId = null;
  var rafId = null;

  function fire(list) {
    // Copy first: a handler may stop itself (or another) mid-pass.
    var snapshot = list.slice();
    for (var i = 0; i < snapshot.length; i++) {
      try {
        snapshot[i]();
      } catch (e) {}
    }
  }

  function startPulse() {
    if (workerBroken) {
      if (fallbackId === null) {
        fallbackId = global.setInterval(function () {
          fire(pulse);
        }, TICK_MS);
      }
      return;
    }
    if (!worker) {
      try {
        worker = new global.Worker("/assets/tick-worker.js");
        worker.onmessage = function () {
          fire(pulse);
        };
        worker.onerror = function () {
          // A blocked or missing worker must not stop the clock: fall back
          // to a main-thread interval, which is throttled in a hidden tab
          // but still correct whenever it does fire.
          workerBroken = true;
          worker = null;
          startPulse();
        };
      } catch (e) {
        workerBroken = true;
        worker = null;
        startPulse();
        return;
      }
    }
    worker.postMessage({ type: "start", interval: TICK_MS });
  }

  function stopPulse() {
    if (worker) worker.postMessage({ type: "stop" });
    if (fallbackId !== null) {
      global.clearInterval(fallbackId);
      fallbackId = null;
    }
  }

  function rafPass() {
    rafId = global.requestAnimationFrame(rafPass);
    fire(smooth);
  }

  function startRaf() {
    if (rafId === null && smooth.length && !global.document.hidden) {
      rafId = global.requestAnimationFrame(rafPass);
    }
  }

  function stopRaf() {
    if (rafId !== null) {
      global.cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function sync() {
    if (pulse.length) startPulse();
    else stopPulse();
    if (smooth.length && !global.document.hidden) startRaf();
    else stopRaf();
  }

  function drop(list, fn) {
    var i = list.indexOf(fn);
    if (i !== -1) list.splice(i, 1);
  }

  global.document.addEventListener("visibilitychange", function () {
    // Coming back into view: pay off whatever the throttled pulse owes
    // before the next paint, so the readout is never briefly stale.
    if (!global.document.hidden) fire(pulse);
    sync();
  });

  /**
   * create(handler, options) -> { start, stop, running }
   * options.smooth (default true) — also run the handler every animation
   * frame while the tab is visible.
   */
  function create(handler, options) {
    var wantsFrames = !options || options.smooth !== false;
    var active = false;
    return {
      start: function () {
        if (active) return;
        active = true;
        pulse.push(handler);
        if (wantsFrames) smooth.push(handler);
        sync();
      },
      stop: function () {
        if (!active) return;
        active = false;
        drop(pulse, handler);
        if (wantsFrames) drop(smooth, handler);
        sync();
      },
      running: function () {
        return active;
      },
    };
  }

  /* ============================== NOTIFY ============================== */

  function supported() {
    return typeof global.Notification !== "undefined";
  }

  var Notify = {
    supported: supported,

    permission: function () {
      return supported() ? global.Notification.permission : "unsupported";
    },

    /**
     * Must be called from a user gesture — browsers reject (and some
     * permanently block) permission prompts that appear unprompted on load.
     * Calls back with "granted", "denied", "default" or "unsupported".
     */
    request: function (callback) {
      function done(state) {
        if (!callback) return;
        var cb = callback;
        callback = null;
        cb(state);
      }
      if (!supported()) return done("unsupported");
      if (global.Notification.permission !== "default") {
        return done(global.Notification.permission);
      }
      try {
        var result = global.Notification.requestPermission(done);
        if (result && typeof result.then === "function") {
          result.then(done, function () {
            done("denied");
          });
        }
      } catch (e) {
        done("denied");
      }
    },

    /** Fire-and-forget. Silently does nothing unless permission is granted. */
    send: function (title, body, tag) {
      if (!supported() || global.Notification.permission !== "granted") return null;
      try {
        var n = new global.Notification(title, {
          body: body || "",
          tag: tag || "clocklab",
          // The user asked to be interrupted; a silent notification would
          // defeat the whole point of the feature.
          requireInteraction: false,
        });
        n.onclick = function () {
          try {
            global.focus();
          } catch (e) {}
          n.close();
        };
        return n;
      } catch (e) {
        // Android Chrome throws here: it only permits notifications via a
        // ServiceWorkerRegistration. Nothing to do but stay quiet.
        return null;
      }
    },
  };

  global.ClockLabStore = Store;
  global.ClockLabTicker = { create: create };
  global.ClockLabNotify = Notify;
})(window);
