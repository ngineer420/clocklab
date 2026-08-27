/* Service worker for clocklab.net. build.py writes this file. Do not edit
 * it by hand. Run `python3 build.py` after any change to a page or an asset
 * and commit the result together with that change.
 *
 * VERSION is a hash of every file in PRECACHE. A new deploy therefore gets a
 * new cache name, and the activate handler deletes every older
 * "clocklab-*" cache. */
const VERSION = "764f3a3dcbc2";
const CACHE = "clocklab-" + VERSION;
const PRECACHE = [
  "/",
  "/countdown-timer/",
  "/stopwatch/",
  "/pomodoro-timer/",
  "/alarm-clock/",
  "/interval-timer/",
  "/world-clock/",
  "/timers/",
  "/30-second-timer/",
  "/90-second-timer/",
  "/2-minute-timer/",
  "/3-minute-timer/",
  "/5-minute-timer/",
  "/10-minute-timer/",
  "/15-minute-timer/",
  "/20-minute-timer/",
  "/25-minute-timer/",
  "/30-minute-timer/",
  "/45-minute-timer/",
  "/1-hour-timer/",
  "/90-minute-timer/",
  "/2-hour-timer/",
  "/egg-timer/",
  "/privacy/",
  "/terms/",
  "/assets/style.css",
  "/assets/dial.js",
  "/assets/audio.js",
  "/assets/timer-core.js",
  "/assets/app.js",
  "/assets/tick-worker.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // {cache: "reload"} bypasses the HTTP cache, so a stale copy of a page
      // in the browser cache can never become the offline copy.
      .then((cache) =>
        cache.addAll(PRECACHE.map((url) => new Request(url, { cache: "reload" })))
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("clocklab-") && key !== CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  // Handle same-origin GET requests only. The worker returns here, without
  // respondWith, for every other request. The AdSense script and every
  // other third-party request therefore go straight to the network, and the
  // worker never intercepts them and never caches them.
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Cache first. A navigation with a query string, such as "/?t=25m", falls
  // back to the cached page at the same path, then to the directory index.
  // A miss goes to the network. The worker never writes a network response
  // into the cache: the precache is the whole offline set.
  event.respondWith(
    caches.match(request, { ignoreSearch: false }).then((hit) => {
      if (hit) return hit;
      if (request.mode !== "navigate") return fetch(request);
      return caches.match(url.pathname).then((page) => {
        if (page) return page;
        if (!url.pathname.endsWith("/")) return fetch(request);
        return caches
          .match(url.pathname + "index.html")
          .then((index) => index || fetch(request));
      });
    })
  );
});
