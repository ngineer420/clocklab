# clocklab.net

Browser-only timers: a countdown timer, a stopwatch, a Pomodoro timer, an alarm
clock, an interval timer and a world clock. The site is static HTML on GitHub
Pages with no build step at request time.

`build.py` writes every HTML file, `sitemap.xml`, `manifest.webmanifest` and
`sw.js`. Do not edit those files by hand. Change `build.py` or a file under
`assets/`, then run `python3 build.py` and commit the result. A second run
produces no diff.

`assets/app.js` is the shared script. Every page loads it.

## Offline

`sw.js` is a service worker. At install time it caches every page in
`sitemap.xml`, plus every same-origin stylesheet and script that those pages
load, plus the tick worker script. The list is the `PRECACHE` array at the top
of `sw.js`. `build.py` generates that list from its own sitemap URL list and
from the page HTML. Nothing in it is hand-typed.

The cache name is `"clocklab-" + VERSION`. `VERSION` is the first 12 hex
characters of a SHA-256 over every precached file. A deploy that changes one
byte of one precached file gets a new cache name. The worker then deletes every
older `clocklab-*` cache when it activates. To rewrite `sw.js` after a change,
run:

    python3 build.py

The worker handles same-origin `GET` requests only. It never intercepts and
never caches the AdSense script or any other third-party request. It also never
writes a network response into the cache. The precache is the whole offline set.

## Checks

Run these before a deploy:

1. `python3 build.py --check` exits 1 when a generated file, `sw.js`
   included, is stale.
2. `python3 -m http.server 8818` from the repo root, then
   `node tools/check_timer_pages.mjs http://localhost:8818` proves that the
   preset timer pages count correctly in real Chrome.
