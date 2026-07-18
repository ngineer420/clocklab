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
      ctx.resume();
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

  // The alarm: an urgent repeating triple-beep pattern that continues
  // until stop() is called. Returns { stop }.
  function startAlarm() {
    var c = getCtx();
    if (!c) return { stop: function () {} };
    var stopped = false;
    var patternDur = 1.1;

    function schedule(baseTime) {
      if (stopped) return;
      tone(1568, baseTime, 0.12, 0.22, "square");
      tone(1568, baseTime + 0.18, 0.12, 0.22, "square");
      tone(1975.5, baseTime + 0.36, 0.22, 0.24, "square");
    }

    var next = c.currentTime + 0.02;
    schedule(next);
    var interval = global.setInterval(function () {
      if (stopped) return;
      next = getCtx().currentTime + 0.02;
      schedule(next);
    }, patternDur * 1000);

    return {
      stop: function () {
        stopped = true;
        global.clearInterval(interval);
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
