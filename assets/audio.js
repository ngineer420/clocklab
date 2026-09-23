/*!
 * clocklab.net — audible alerts via the Web Audio API. No audio files.
 * The AudioContext is created lazily on the first user gesture (a Start
 * button click always fires before any sound is needed) so autoplay
 * policies never block it.
 */
(function (global) {
  "use strict";

  var ctx = null;

  function getCtx() {
    if (!ctx) {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") {
      // Safari rejects this outright when there has been no user gesture
      // yet; an unhandled rejection would show up as a console error on a
      // page that restored a finished timer on load.
      var resumed = ctx.resume();
      if (resumed && typeof resumed.catch === "function") resumed.catch(function () {});
    }
    return ctx;
  }

  // Single tone with a short attack/release envelope so it doesn't click.
  function tone(freq, startAt, dur, gainPeak, type) {
    var c = getCtx();
    if (!c) return;
    var osc = c.createOscillator();
    var gain = c.createGain();
    osc.type = type || "sine";
    osc.frequency.setValueAtTime(freq, startAt);
    gain.gain.setValueAtTime(0, startAt);
    gain.gain.linearRampToValueAtTime(gainPeak, startAt + 0.008);
    gain.gain.linearRampToValueAtTime(gainPeak, startAt + dur - 0.03);
    gain.gain.linearRampToValueAtTime(0, startAt + dur);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(startAt);
    osc.stop(startAt + dur + 0.02);
  }

  function unlock() {
    getCtx();
  }

  // A short, pleasant two-note chime — used for phase changes (interval
  // work/rest switch, pomodoro session change) where the user isn't meant
  // to stop anything, just notice.
  function chime() {
    var c = getCtx();
    if (!c) return;
    var t = c.currentTime;
    tone(880, t, 0.14, 0.18, "sine");
    tone(1318.5, t + 0.12, 0.18, 0.16, "sine");
  }

  // A single sharper beep — used for lap marks / small confirmations.
  function tick() {
    var c = getCtx();
    if (!c) return;
    tone(1046.5, c.currentTime, 0.06, 0.14, "square");
  }

  // The alarm: an urgent repeating triple-beep pattern.
  //
  // A kitchen timer rings in a tab you are not looking at. That is the normal
  // case, not the edge case. A main-thread setInterval cannot drive this,
  // because browsers clamp timers in a hidden tab to roughly one call per
  // minute, and the alarm then degrades to one burst per minute.
  //
  // So no timer drives it at all. The whole burst sequence goes onto the Web
  // Audio clock in a single pass. That clock runs on the audio thread, it
  // keeps its own time, and the main thread cannot throttle or stall it.
  //
  // One oscillator and one gain carry every beep, rather than three fresh
  // nodes per burst. The oscillator runs without interruption. The gain sits
  // at zero between beeps and the frequency changes while it is silent, so
  // nothing clicks. Scheduling 273 bursts this way costs two nodes, not 819,
  // and there is nothing to clean up per burst.
  var ALARM_PERIOD = 1.1; // seconds between the start of one burst and the next
  // One row per beep inside a burst: [offset, duration, frequency, peak gain].
  var ALARM_PATTERN = [
    [0, 0.12, 1568, 0.22],
    [0.18, 0.12, 1568, 0.22],
    [0.36, 0.22, 1975.5, 0.24],
  ];
  // The alarm rings for five minutes and then stops by itself, the way a phone
  // alarm does. An unbounded schedule is not possible in one pass, and an
  // oscillator that never ends is a leak.
  var ALARM_MAX_SECONDS = 300;

  // Returns { stop }.
  function startAlarm() {
    var c = getCtx();
    if (!c) return { stop: function () {} };

    var osc = c.createOscillator();
    var gain = c.createGain();
    osc.type = "square";

    var t0 = c.currentTime + 0.02;
    var bursts = Math.ceil(ALARM_MAX_SECONDS / ALARM_PERIOD);
    gain.gain.setValueAtTime(0, t0);
    // Events go on in strictly rising time order, which is the cheap path for
    // an AudioParam timeline: every event appends instead of being inserted.
    for (var i = 0; i < bursts; i++) {
      var base = t0 + i * ALARM_PERIOD;
      for (var j = 0; j < ALARM_PATTERN.length; j++) {
        var beep = ALARM_PATTERN[j];
        var at = base + beep[0];
        var dur = beep[1];
        var peak = beep[3];
        osc.frequency.setValueAtTime(beep[2], at);
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(peak, at + 0.008);
        gain.gain.linearRampToValueAtTime(peak, at + dur - 0.03);
        gain.gain.linearRampToValueAtTime(0, at + dur);
      }
    }

    osc.connect(gain);
    gain.connect(c.destination);
    osc.onended = function () {
      osc.onended = null;
      try {
        osc.disconnect();
        gain.disconnect();
      } catch (e) {}
    };
    osc.start(t0);
    osc.stop(t0 + bursts * ALARM_PERIOD);

    var stopped = false;
    return {
      stop: function () {
        if (stopped) return;
        stopped = true;
        // Drop the rest of the schedule and fade out over 20 ms. A hard cut
        // on a square wave at full amplitude is an audible click.
        var at = c.currentTime;
        try {
          var current = gain.gain.value;
          gain.gain.cancelScheduledValues(at);
          gain.gain.setValueAtTime(current, at);
          gain.gain.linearRampToValueAtTime(0, at + 0.02);
          osc.stop(at + 0.04);
        } catch (e) {}
      },
    };
  }

  global.ClockLabAudio = {
    unlock: unlock,
    chime: chime,
    tick: tick,
    startAlarm: startAlarm,
  };
})(window);
