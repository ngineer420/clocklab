/*!
 * clocklab.net — the heartbeat, running off the main thread.
 *
 * Browsers throttle setTimeout/setInterval hard in a hidden tab (Chrome
 * clamps to roughly once a minute after a few minutes of "intensive
 * throttling") and stop requestAnimationFrame outright. A timer that only
 * ticks while you are looking at it is not a timer. Timer callbacks inside
 * a dedicated worker are throttled far less aggressively — and never
 * stopped — so the page keeps getting a pulse while backgrounded, which is
 * when it needs to notice that a countdown has hit zero.
 *
 * The worker deliberately knows nothing about time arithmetic. It posts an
 * empty "tick" and the page derives every displayed value from wall-clock
 * timestamps, so even a badly throttled pulse produces correct output on
 * whatever tick does arrive.
 */
var tickId = null;

self.onmessage = function (event) {
  var msg = event.data || {};
  if (msg.type === "start") {
    if (tickId !== null) clearInterval(tickId);
    tickId = setInterval(function () {
      self.postMessage({ type: "tick" });
    }, msg.interval || 200);
  } else if (msg.type === "stop") {
    if (tickId !== null) clearInterval(tickId);
    tickId = null;
  }
};
