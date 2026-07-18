#!/usr/bin/env python3
"""
One-off generator for clocklab.net's static pages. Produces plain HTML
files with zero templating at request time — the shipped site has no
build step at all. This script itself is deleted after the output is
committed.

Clean-path implementation: GitHub Pages serves a truly extensionless file
(no directory, no extension) with Content-Type: application/octet-stream,
which real browsers treat as a forced download on navigation. The correct
static-host pattern for clean URLs is a directory containing index.html —
GitHub Pages 301-redirects "/slug" -> "/slug/" and serves that index.html
with the correct "text/html" content type. So every tool/legal page ships
as BOTH "<slug>/index.html" (the true clean path, trailing slash) and
"<slug>.html" (a flat, real .html alias, also correctly text/html).
"""
import os
import json

ROOT = os.path.dirname(os.path.abspath(__file__))
SITE = "https://clocklab.net"
TODAY = "2026-07-18"

# ---------------------------------------------------------------- tools --

TOOLS = [
    dict(
        slug="countdown-timer",
        name="Countdown Timer",
        tagline="Set it, start it, get an alarm when it hits zero.",
        description="Free browser-based countdown timer. Set hours, minutes and seconds, start/pause/reset, and get an audible alarm at zero. No install, works offline.",
        icon='<path d="M6 3h12M6 21h12M6 3c0 6 5 7 6 9-1 2-6 3-6 9M18 3c0 6-5 7-6 9 1 2 6 3 6 9"/>',
        intro="Dial in hours, minutes and seconds and clocklab counts down to zero, sweeping the bezel ring around the display as it goes. When time runs out, it rings an alarm built from oscillator tones — no audio file, no download — until you tap Stop.",
        how_to=[
            "Set Hours, Minutes and Seconds with the number fields under the dial.",
            "Tap Start — the ring sweeps down from full as time elapses, and the readout counts down.",
            "Tap Pause to hold at the current time, then Start again to resume from exactly where you left off.",
            "When it reaches zero, the display flashes red and an alarm sounds — tap Stop Alarm to dismiss it, or Reset to set a new time.",
        ],
        faq=[
            ("Does the timer drift if my laptop is busy or the tab is in the background?", "No — clocklab reads the actual elapsed time from a timestamp each time it renders, rather than counting down once per interval tick. Even if the browser throttles a backgrounded tab, the next render catches up to the correct remaining time instead of losing seconds."),
            ("Why can't I hear the alarm?", "Browsers require a user gesture before they'll play audio. Tapping Start unlocks sound for the page, so as long as you've interacted with the timer at least once and your device isn't muted, the alarm will play."),
            ("Can I pause partway through and come back later?", "Yes — Pause holds the exact remaining time. The tab needs to stay open, but you can switch to another tool or tab and the countdown won't lose its place."),
            ("Is there a maximum duration?", "Up to 23 hours, 59 minutes and 59 seconds in one countdown — plenty for cooking, workouts, presentations or focus blocks."),
        ],
        related=["pomodoro-timer", "interval-timer", "alarm-clock"],
        workspace="""
    <div class="instrument">
      <div class="nameplate">
        <span class="nameplate-label">Countdown Timer</span>
        <span class="status-led" id="cd-status" data-state="idle">Idle</span>
      </div>
      <div class="dial-wrap">
        <div class="dial-mount" id="cd-dial"></div>
        <div class="screen">
          <div class="readout" id="cd-readout">00:05:00</div>
          <div class="readout-sub">HH&nbsp;:&nbsp;MM&nbsp;:&nbsp;SS</div>
        </div>
      </div>
      <div class="set-row">
        <div class="set-field"><label for="cd-h">Hours</label><input type="number" id="cd-h" min="0" max="23" value="0" inputmode="numeric"></div>
        <div class="set-field"><label for="cd-m">Min</label><input type="number" id="cd-m" min="0" max="59" value="5" inputmode="numeric"></div>
        <div class="set-field"><label for="cd-s">Sec</label><input type="number" id="cd-s" min="0" max="59" value="0" inputmode="numeric"></div>
      </div>
      <div class="controls-row">
        <button type="button" class="ctrl-btn primary" id="cd-start">Start</button>
        <button type="button" class="ctrl-btn" id="cd-pause" disabled>Pause</button>
        <button type="button" class="ctrl-btn ghost" id="cd-reset">Reset</button>
        <button type="button" class="ctrl-btn stop" id="cd-stop-alarm" hidden>Stop Alarm</button>
      </div>
      <p class="hint">Ends with an audible alarm — keep this tab's sound unmuted.</p>
    </div>
""",
    ),
    dict(
        slug="stopwatch",
        name="Stopwatch",
        tagline="Start, stop, lap — with a clean split table.",
        description="Free browser-based stopwatch with lap timing. Start, stop and record laps with a tabular, millisecond-accurate readout. No install, works offline.",
        icon='<path d="M10 2h4"/><path d="M12 2v3"/><circle cx="12" cy="14" r="8"/><path d="M12 14V9.5"/><path d="M17.7 8.3l1.1-1.1"/>',
        intro="A running chronograph hand sweeps the bezel once a minute while the readout counts up in hundredths of a second. Tap Lap while it's running to record a split — clocklab keeps every lap in a table with the gap from the previous one, and highlights your fastest and slowest.",
        how_to=[
            "Tap Start to begin timing — the sweep hand and readout start moving immediately.",
            "Tap Lap at any point to record a split; it's added to the table below with its own time and the delta from the previous lap.",
            "Tap Stop to freeze the readout, or Start again (now labelled Resume) to keep adding to the same run.",
            "Tap Reset once stopped to clear the time and lap table and start fresh.",
        ],
        faq=[
            ("How accurate is the timing?", "The stopwatch reads the actual elapsed time from a timestamp on every render rather than incrementing a counter, so pausing, resuming, or a slow/busy browser tab never causes drift — the displayed time is always the real elapsed time."),
            ("What do the highlighted lap rows mean?", "The lap with the shortest gap from the one before it is highlighted in cyan (your best split); the longest gap is highlighted in red (your slowest) — useful for spotting your fastest and slowest reps at a glance."),
            ("Can I lap without stopping the clock?", "Yes — Lap only records a split, it never pauses or resets the running time."),
            ("Does it show hours for long runs?", "Yes, the readout is always HH:MM:SS.CS, so multi-hour sessions still read correctly."),
        ],
        related=["interval-timer", "countdown-timer", "pomodoro-timer"],
        workspace="""
    <div class="instrument">
      <div class="nameplate">
        <span class="nameplate-label">Stopwatch</span>
        <span class="status-led" id="sw-status" data-state="idle">Idle</span>
      </div>
      <div class="dial-wrap">
        <div class="dial-mount" id="sw-dial"></div>
        <div class="screen">
          <div class="readout is-cyan" id="sw-readout">00:00:00.00</div>
          <div class="readout-sub">HH&nbsp;:&nbsp;MM&nbsp;:&nbsp;SS&nbsp;.&nbsp;CS</div>
        </div>
      </div>
      <div class="controls-row">
        <button type="button" class="ctrl-btn primary" id="sw-start">Start</button>
        <button type="button" class="ctrl-btn" id="sw-lap" disabled>Lap</button>
        <button type="button" class="ctrl-btn ghost" id="sw-reset" disabled>Reset</button>
      </div>
      <div class="lap-table">
        <table>
          <thead><tr><th>Lap</th><th>Split</th><th class="delta">+/-</th></tr></thead>
          <tbody id="sw-laps"></tbody>
        </table>
        <div class="lap-table-empty" id="sw-laps-empty">No laps yet — press Lap while running.</div>
      </div>
    </div>
""",
    ),
    dict(
        slug="pomodoro-timer",
        name="Pomodoro Timer",
        tagline="Focus blocks and breaks, on an honest cycle.",
        description="Free browser-based Pomodoro timer. Configurable focus and break lengths, automatic cycling, and a session dial. No install, works offline.",
        icon='<circle cx="12" cy="13" r="8"/><path d="M12 13V9"/><path d="M12 13l3 2"/><path d="M9 3.2c1.4-1 4.6-1 6 0"/>',
        intro="clocklab runs the classic Pomodoro cycle — a focus block, a short break, repeat, then a longer break after a set number of sessions — and moves between them automatically with a soft two-note chime, so you never have to reset a timer mid-flow. The dots above the dial track exactly where you are in the current cycle.",
        how_to=[
            "Set your Focus, Short break and Long break lengths in minutes, and how many focus sessions happen before a long break.",
            "Tap Start — clocklab counts down the current phase and switches automatically when it ends, with a soft chime.",
            "Watch the dots above the dial: filled means done, the glowing one is the current focus session.",
            "Use Skip phase to jump straight to the next phase, or Pause/Reset as needed.",
        ],
        faq=[
            ("What happens when a phase ends — does it wait for me?", "No — clocklab plays a soft chime and moves straight into the next phase automatically, so a full work session never needs you to restart a timer."),
            ("Can I change the lengths mid-session?", "The number fields are editable any time the timer isn't running; changes take effect the next time you start or on the next phase change. They're locked while a phase is actively counting down to avoid accidentally resetting your progress."),
            ("What's the difference between a short and long break?", "Short breaks happen after every focus session; the long break replaces a short break once you've completed the configured number of sessions (4, by default) — the classic Pomodoro rhythm."),
            ("Does Skip phase count against my session total?", "Yes — skipping advances the cycle exactly like a natural phase completion, just without waiting out the clock or playing the completion chime."),
        ],
        related=["interval-timer", "countdown-timer", "stopwatch"],
        workspace="""
    <div class="instrument">
      <div class="nameplate">
        <span class="nameplate-label">Pomodoro Timer</span>
        <span class="status-led" id="pd-status" data-state="idle">Idle</span>
      </div>
      <div class="dial-wrap">
        <div class="dial-mount" id="pd-dial"></div>
        <div class="screen">
          <div class="readout" id="pd-readout">25:00</div>
          <div class="readout-phase" id="pd-phase">Focus</div>
        </div>
      </div>
      <div class="pip-row" id="pd-pips"></div>
      <div class="field-row">
        <div class="field"><label for="pd-work">Focus (min)</label><input type="number" id="pd-work" min="1" max="90" value="25"></div>
        <div class="field"><label for="pd-break">Short break (min)</label><input type="number" id="pd-break" min="1" max="60" value="5"></div>
        <div class="field"><label for="pd-long-break">Long break (min)</label><input type="number" id="pd-long-break" min="1" max="60" value="15"></div>
        <div class="field"><label for="pd-sessions">Sessions before long break</label><input type="number" id="pd-sessions" min="1" max="12" value="4"></div>
      </div>
      <div class="controls-row">
        <button type="button" class="ctrl-btn primary" id="pd-start">Start</button>
        <button type="button" class="ctrl-btn" id="pd-pause" disabled>Pause</button>
        <button type="button" class="ctrl-btn ghost" id="pd-skip">Skip phase</button>
        <button type="button" class="ctrl-btn ghost" id="pd-reset">Reset</button>
      </div>
      <p class="hint">Chimes softly between focus and break — nothing to dismiss.</p>
    </div>
""",
    ),
    dict(
        slug="alarm-clock",
        name="Alarm Clock",
        tagline="Set a time on the dial, it rings when you get there.",
        description="Free browser-based alarm clock. Set a wall-clock time, watch the analog dial track it, and get an alarm when the time arrives — with an optional daily repeat.",
        icon='<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2"/><path d="M5 4L3 6"/><path d="M19 4l2 2"/>',
        intro="Pick a time and clocklab arms an alarm for it — a small red marker appears on the bezel showing exactly where on the clock face it will ring, while the hour and minute hands keep tracking the real current time. When the clock reaches that mark, it rings until you dismiss it.",
        how_to=[
            "Pick a time in the Alarm time field — it defaults to five minutes from now.",
            "Tap Set Alarm — a red marker appears on the dial at that position, and the status line confirms the armed time.",
            "Leave the tab open. When the current time reaches the alarm, the display flashes and an alarm sounds.",
            "Tap Stop Alarm to dismiss it — check Repeat daily first if you want it to automatically re-arm for the same time tomorrow.",
        ],
        faq=[
            ("Does the alarm ring if I close the tab?", "No — like any browser-based tool, clocklab needs the tab to stay open (it can be in the background) to check the time and ring the alarm. It doesn't run as a background service or send notifications when closed."),
            ("What if I set a time that's already passed today?", "clocklab automatically arms it for that time tomorrow instead, so you never accidentally set an alarm in the past."),
            ("What does the red dot on the dial mean?", "It marks where your alarm time falls on the 12-hour clock face — a quick visual check that you've set the time you meant to, at a glance."),
            ("Can I have more than one alarm?", "This tool arms one alarm at a time, kept simple on purpose. Use the Countdown Timer alongside it if you need a second, independent alert."),
        ],
        related=["countdown-timer", "world-clock", "pomodoro-timer"],
        workspace="""
    <div class="instrument">
      <div class="nameplate">
        <span class="nameplate-label">Alarm Clock</span>
        <span class="status-led" id="al-status" data-state="idle">No alarm set</span>
      </div>
      <div class="dial-wrap">
        <div class="dial-mount" id="al-dial"></div>
        <div class="screen">
          <div class="readout" id="al-readout">--:--:--</div>
          <div class="readout-sub">Current time</div>
        </div>
      </div>
      <div class="field-row">
        <div class="field"><label for="al-time">Alarm time</label><input type="time" id="al-time"></div>
        <div class="field checkbox-field" style="align-self:flex-end;padding-bottom:10px">
          <input type="checkbox" id="al-repeat"><label for="al-repeat" style="text-transform:none;letter-spacing:normal;font-weight:400;color:var(--fg)">Repeat daily</label>
        </div>
      </div>
      <div class="controls-row">
        <button type="button" class="ctrl-btn primary" id="al-arm">Set Alarm</button>
        <button type="button" class="ctrl-btn ghost" id="al-cancel" hidden>Cancel Alarm</button>
        <button type="button" class="ctrl-btn stop" id="al-stop" hidden>Stop Alarm</button>
      </div>
      <p class="hint" id="al-hint">Set a time and tap Set Alarm — this tab must stay open for the alarm to ring.</p>
    </div>
""",
    ),
    dict(
        slug="interval-timer",
        name="Interval Timer",
        tagline="Work, rest, repeat — HIIT rounds on a dial.",
        description="Free browser-based HIIT interval timer. Configurable work/rest lengths and round count, with a get-ready countdown and round dots. No install, works offline.",
        icon='<rect x="3" y="10" width="3" height="10" rx="1"/><rect x="8.5" y="5" width="3" height="15" rx="1"/><rect x="14" y="12" width="3" height="8" rx="1"/><rect x="19" y="3" width="3" height="17" rx="1" fill="currentColor" stroke="none" opacity="0.55"/>',
        intro="Set a work length, a rest length and a number of rounds, and clocklab alternates them automatically with a chime at every switch — a 5-second get-ready countdown gives you time to get into position before round one. The dots above the dial track exactly which round you're on.",
        how_to=[
            "Set Work and Rest lengths in seconds, and how many Rounds to run.",
            "Tap Start — a 5-second get-ready countdown runs first, then work and rest alternate automatically with a chime at each switch.",
            "Watch the round dots: filled dots are completed rounds, the glowing dot is the round in progress.",
            "When the last round's work phase ends, the display reads Done — tap Start again (now labelled Restart) to run it again.",
        ],
        faq=[
            ("What's the get-ready countdown for?", "A fixed 5-second buffer after you tap Start, before round one's work phase begins — enough time to get off your phone and into position."),
            ("Does Rest count as part of the round?", "Yes — each round is one Work phase followed by one Rest phase (except the very last round, which ends after Work with no trailing rest)."),
            ("Can I pause mid-round?", "Yes — Pause holds the exact remaining time in the current phase; Start resumes it from exactly there."),
            ("How is this different from the Pomodoro Timer?", "Pomodoro is built around longer focus/break cycles (minutes) with a long-break rhythm for deep work; the Interval Timer is built around short work/rest bursts (seconds) for a fixed number of rounds — classic HIIT structure."),
        ],
        related=["pomodoro-timer", "stopwatch", "countdown-timer"],
        workspace="""
    <div class="instrument">
      <div class="nameplate">
        <span class="nameplate-label">Interval Timer</span>
        <span class="status-led" id="iv-status" data-state="idle">Idle</span>
      </div>
      <div class="dial-wrap">
        <div class="dial-mount" id="iv-dial"></div>
        <div class="screen">
          <div class="readout" id="iv-readout">00:20</div>
          <div class="readout-phase" id="iv-phase">Work</div>
        </div>
      </div>
      <div class="pip-row" id="iv-pips"></div>
      <div class="field-row">
        <div class="field"><label for="iv-work">Work (sec)</label><input type="number" id="iv-work" min="1" max="600" value="20"></div>
        <div class="field"><label for="iv-rest">Rest (sec)</label><input type="number" id="iv-rest" min="1" max="600" value="10"></div>
        <div class="field"><label for="iv-rounds">Rounds</label><input type="number" id="iv-rounds" min="1" max="50" value="8"></div>
      </div>
      <div class="controls-row">
        <button type="button" class="ctrl-btn primary" id="iv-start">Start</button>
        <button type="button" class="ctrl-btn" id="iv-pause" disabled>Pause</button>
        <button type="button" class="ctrl-btn ghost" id="iv-reset">Reset</button>
      </div>
      <p class="hint">Starts with a 5-second get-ready countdown, then alternates work and rest.</p>
    </div>
""",
    ),
    dict(
        slug="world-clock",
        name="World Clock",
        tagline="Every timezone you track, ticking at once.",
        description="Free browser-based world clock. Track the current time across any selection of timezones at once, with day/night position at a glance.",
        icon='<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c3 3 3 15 0 18"/><path d="M12 3c-3 3-3 15 0 18"/>',
        intro="A row of cards, each ticking the real current time in a timezone you choose — with the date, the UTC offset, and a small day/night strip showing whereabouts in its day that city currently sits. Add or remove cities freely; your selection is remembered for next time.",
        how_to=[
            "Pick a city from the dropdown and tap Add city to add its card to the grid.",
            "Tap the ✕ on any card to remove it.",
            "Each card updates every second — no need to refresh.",
            "Your chosen cities are saved in this browser, so they're still there next time you open clocklab.",
        ],
        faq=[
            ("Why do some cities show unusual offsets like +5:30?", "Not every timezone sits on a whole hour from UTC — India Standard Time, for example, is UTC+5:30. clocklab reads each timezone's real offset directly, including those half- and quarter-hour cases."),
            ("What does the moving dot on the strip mean?", "It marks how far that city is through its current day, from midnight (far left) to the next midnight (far right) — a fast way to tell if it's the middle of the night somewhere before you call."),
            ("Does this account for daylight saving time?", "Yes — times are computed from the IANA timezone database via the browser's own Intl API, which already knows each region's daylight saving rules and transition dates."),
            ("Where is my city list saved?", "In this browser's local storage, on this device only — nothing is sent anywhere or synced across devices."),
        ],
        related=["alarm-clock", "countdown-timer", "stopwatch"],
        workspace="""
    <div class="instrument">
      <div class="nameplate">
        <span class="nameplate-label">World Clock</span>
        <span class="status-led" data-state="running">Live</span>
      </div>
      <div class="world-grid" id="wc-grid"></div>
      <div class="add-city-row">
        <select id="wc-add-select" aria-label="Choose a city to add"></select>
        <button type="button" class="ctrl-btn ghost" id="wc-add-btn">+ Add city</button>
      </div>
    </div>
""",
    ),
]

TOOLS_BY_SLUG = {t["slug"]: t for t in TOOLS}


def clean_url(slug):
    return "/" + slug + "/"


# --------------------------------------------------------------- shared --

NO_FLASH = """<script>(function(){try{var r=document.documentElement;var t=localStorage.getItem("clocklab-theme");if(!t){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}r.setAttribute("data-theme",t);}catch(e){}})();</script>"""

ADSENSE = '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-7560786263587509" crossorigin="anonymous"></script>'

ERABBIT = '<a href="https://erabb.it" class="erabbit-mark" aria-label="erabb.it"><img src="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>\U0001F407</text></svg>" width="10" height="10" alt=""></a>'

THEME_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'


def nav_items(current):
    items = []
    home_current = current is None
    items.append(
        '<li><a href="/" data-panel-link=""{cur}>Home</a></li>'.format(
            cur=' aria-current="page"' if home_current else ""
        )
    )
    for t in TOOLS:
        cur = current == t["slug"]
        items.append(
            '<li><a href="{url}" data-panel-link="{slug}"{cur}>{name}</a></li>'.format(
                url=clean_url(t["slug"]), slug=t["slug"], name=t["name"],
                cur=' aria-current="page"' if cur else ""
            )
        )
    return "\n      ".join(items)


def header(current):
    return """  <header class="site-header">
    <div class="wrap">
      <a href="/" class="wordmark" data-panel-link=""><span class="tick">[</span>clocklab<span class="tick">]</span></a>
      <button type="button" class="nav-toggle" id="nav-toggle" aria-expanded="false" aria-controls="tool-nav" aria-label="Toggle menu">☰</button>
      <ul class="tool-nav" id="tool-nav">
      {nav}
      </ul>
      <div class="header-controls">
        <button type="button" class="theme-toggle" id="theme-toggle" aria-label="Toggle light and dark theme">{icon}</button>
      </div>
    </div>
  </header>""".format(nav=nav_items(current), icon=THEME_ICON)


def footer():
    return """  <footer class="site-footer">
    <div class="wrap">
      <p class="footer-tag">clocklab.net — browser-only timers. Nothing you set here ever leaves this tab.</p>
      <ul class="footer-links">
        <li><a href="/privacy/">Privacy</a></li>
        <li><a href="/terms/">Terms</a></li>
      </ul>
    </div>
  </footer>
{erabbit}""".format(erabbit=ERABBIT)


def head(title, description, canonical_path, json_ld):
    canonical = SITE + canonical_path
    return """<head>
  {no_flash}
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title}</title>
  <meta name="description" content="{description}">
  <link rel="canonical" href="{canonical}">
  <meta name="theme-color" content="#15181c">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="clocklab.net">
  <meta property="og:title" content="{title}">
  <meta property="og:description" content="{description}">
  <meta property="og:url" content="{canonical}">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="{title}">
  <meta name="twitter:description" content="{description}">
  <link rel="stylesheet" href="/assets/style.css">
  <script type="application/ld+json">{json_ld}</script>
  {adsense}
</head>""".format(
        no_flash=NO_FLASH,
        title=title,
        description=description,
        canonical=canonical,
        json_ld=json_ld,
        adsense=ADSENSE,
    )


def scripts_tail():
    return '  <script src="/assets/dial.js"></script>\n  <script src="/assets/audio.js"></script>\n  <script src="/assets/app.js"></script>'


def write(path, content):
    full = os.path.join(ROOT, path)
    d = os.path.dirname(full)
    if d:
        os.makedirs(d, exist_ok=True)
    with open(full, "w", encoding="utf-8") as f:
        f.write(content)


def write_clean(slug, content):
    write(slug + "/index.html", content)
    write(slug + ".html", content)


def jstr(s):
    return json.dumps(s)


def render_faq_jsonld(faq):
    entries = []
    for q, a in faq:
        entries.append(
            '{{"@type":"Question","name":{q},"acceptedAnswer":{{"@type":"Answer","text":{a}}}}}'.format(
                q=jstr(q), a=jstr(a)
            )
        )
    return "[" + ",".join(entries) + "]"


def tool_page(tool):
    canonical_path = clean_url(tool["slug"])
    title = "{name} — Free, Private, Browser-Only | clocklab.net".format(name=tool["name"])
    json_ld = (
        '{{"@context":"https://schema.org","@type":"WebApplication","name":{name},'
        '"url":{url},"applicationCategory":"UtilitiesApplication","operatingSystem":"Any (runs in browser)",'
        '"description":{desc},"offers":{{"@type":"Offer","price":"0","priceCurrency":"USD"}},'
        '"publisher":{{"@type":"Organization","name":"clocklab.net"}}}}'
    ).format(
        name=jstr(tool["name"] + " — clocklab.net"),
        url=jstr(SITE + canonical_path),
        desc=jstr(tool["description"]),
    )
    faq_ld = (
        '{{"@context":"https://schema.org","@type":"FAQPage","mainEntity":{entities}}}'.format(
            entities=render_faq_jsonld(tool["faq"])
        )
    )

    how_to_html = "\n".join("        <li>{}</li>".format(s) for s in tool["how_to"])
    faq_html = "\n".join(
        "        <dt>{}</dt>\n        <dd>{}</dd>".format(q, a) for q, a in tool["faq"]
    )
    related_html = "\n".join(
        '        <a href="{url}">{name} →</a>'.format(
            url=clean_url(TOOLS_BY_SLUG[s]["slug"]), name=TOOLS_BY_SLUG[s]["name"]
        )
        for s in tool["related"]
    )

    body = """<body>
{header}
  <main>
    <section class="panel">
      <div class="wrap">
        <div class="panel-head">
          <h1 tabindex="-1">{name}</h1>
          <a class="back-to-tools" href="/" data-panel-link="">← All tools</a>
        </div>
        <p>{intro}</p>
{workspace}
      </div>
    </section>

    <section class="content-section" id="how-it-works">
      <div class="wrap">
        <h2>How to use the {name}</h2>
        <div class="how-to">
          <ol>
{how_to}
          </ol>
        </div>
      </div>
    </section>

    <section class="content-section">
      <div class="wrap">
        <h2>FAQ</h2>
        <dl class="faq">
{faq}
        </dl>
      </div>
    </section>

    <section class="content-section">
      <div class="wrap">
        <h2>Related tools</h2>
        <div class="related-links">
{related}
        </div>
      </div>
    </section>
  </main>
{footer}
  <script type="application/ld+json">{faq_ld}</script>
{scripts}
</body>""".format(
        header=header(tool["slug"]),
        name=tool["name"],
        intro=tool["intro"],
        workspace=tool["workspace"],
        how_to=how_to_html,
        faq=faq_html,
        related=related_html,
        footer=footer(),
        faq_ld=faq_ld,
        scripts=scripts_tail(),
    )

    html = "<!doctype html>\n<html lang=\"en\">\n" + head(
        title, tool["description"], canonical_path, json_ld
    ) + "\n" + body + "\n</html>\n"
    write_clean(tool["slug"], html)


for t in TOOLS:
    tool_page(t)

# -------------------------------------------------------------- homepage --

def homepage():
    title = "clocklab.net — Free Browser-Only Timers, Built Like an Instrument"
    description = "Countdown timer, stopwatch, Pomodoro timer, alarm clock, interval timer and world clock — six precise, browser-only time tools. Free, private, works offline."
    json_ld = (
        '{{"@context":"https://schema.org","@type":"WebSite","name":"clocklab.net","url":{url},'
        '"description":{desc}}}'
    ).format(url=jstr(SITE + "/"), desc=jstr(description))

    cards = []
    for t in TOOLS:
        cards.append(
            """          <a class="tool-card" href="{url}" data-panel-link="{slug}">
            <span class="chip"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{icon}</svg></span>
            <h3>{name}</h3>
            <p>{tagline}</p>
          </a>""".format(url=clean_url(t["slug"]), slug=t["slug"], icon=t["icon"], name=t["name"], tagline=t["tagline"])
        )
    cards_html = "\n".join(cards)

    panels = []
    for t in TOOLS:
        panels.append(
            """    <section class="panel" data-panel="{slug}" data-title="{name} — clocklab.net" hidden>
      <div class="wrap">
        <div class="panel-head">
          <h2 tabindex="-1">{name}</h2>
          <a class="back-to-tools" href="/" data-panel-link="">← All tools</a>
        </div>
        <p>{intro}</p>
{workspace}
        <p style="margin-top:16px;font-size:14px"><a href="{url}#how-it-works">Full guide &amp; FAQ for the {name} →</a></p>
      </div>
    </section>""".format(
                slug=t["slug"], name=t["name"], intro=t["intro"], workspace=t["workspace"],
                url=clean_url(t["slug"]),
            )
        )
    panels_html = "\n".join(panels)

    body = """<body>
{header}
  <main>
    <section class="hero">
      <div class="wrap">
        <p class="eyebrow">Six instruments · one bench</p>
        <h1>Time, measured precisely.</h1>
        <p class="lede">A countdown timer, stopwatch, Pomodoro timer, alarm clock, interval timer and world clock — each built like a real instrument, with a tick-marked dial and a lit readout. Every second is computed from a real timestamp, not counted by hand, so nothing drifts. Nothing you set here ever leaves this tab.</p>
      </div>
    </section>

    <section class="panel" id="overview-panel">
      <div class="wrap">
        <h2 class="visually-hidden">All tools</h2>
        <div class="tool-grid">
{cards}
        </div>
      </div>
    </section>

{panels}
  </main>
{footer}
{scripts}
</body>""".format(
        header=header(None),
        cards=cards_html,
        panels=panels_html,
        footer=footer(),
        scripts=scripts_tail(),
    )

    html = "<!doctype html>\n<html lang=\"en\">\n" + head(title, description, "/", json_ld) + "\n" + body + "\n</html>\n"
    write("index.html", html)


homepage()

# ------------------------------------------------------------ legal pages --

def legal_page(slug, title_text, body_html):
    canonical_path = clean_url(slug)
    title = "{t} | clocklab.net".format(t=title_text)
    description = "{t} for clocklab.net, a set of free, browser-only timer tools.".format(t=title_text)
    json_ld = '{{"@context":"https://schema.org","@type":"WebPage","name":{name},"url":{url}}}'.format(
        name=jstr(title), url=jstr(SITE + canonical_path)
    )
    body = """<body>
{header}
  <main>
    <section class="doc-page">
      <div class="wrap">
{content}
      </div>
    </section>
  </main>
{footer}
{scripts}
</body>""".format(header=header("other"), content=body_html, footer=footer(), scripts=scripts_tail())
    html = "<!doctype html>\n<html lang=\"en\">\n" + head(title, description, canonical_path, json_ld) + "\n" + body + "\n</html>\n"
    write_clean(slug, html)


PRIVACY_BODY = """        <h1>Privacy</h1>
        <p>clocklab.net is a set of timer tools that run entirely in your browser. This page explains, plainly, what that means for your data.</p>

        <h2>What we don't collect</h2>
        <p>clocklab.net has no server-side application, no account system, and no analytics beacons. Every countdown, stopwatch split, alarm time and interval you set is held in memory by JavaScript already running in your tab — none of it is ever sent to us, because there's no endpoint for it to go to.</p>

        <h2>Local storage</h2>
        <p>clocklab.net saves a couple of small preferences in your browser's local storage: your light/dark theme choice, and your World Clock's selected cities. These stay on this device only and are never transmitted anywhere. You can clear them at any time by clearing this site's data in your browser settings.</p>

        <h2>Audio</h2>
        <p>Alarm and chime sounds are synthesized locally using the Web Audio API — there are no audio files to download and nothing is recorded or transmitted.</p>

        <h2>Advertising</h2>
        <p>This site shows ads served by Google AdSense, which may use cookies to personalize ads based on your visits to this and other sites. You can control ad personalization through <a href="https://adssettings.google.com" rel="noopener">Google's Ad Settings</a>, and learn more about how Google uses data at <a href="https://policies.google.com/technologies/partner-sites" rel="noopener">policies.google.com/technologies/partner-sites</a>.</p>

        <h2>Contact</h2>
        <p>Questions about this policy can be raised via the <a href="https://erabb.it" rel="noopener">erabb.it</a> portfolio site linked in the corner of every page here.</p>"""

TERMS_BODY = """        <h1>Terms</h1>
        <p>clocklab.net's timer tools are provided free, as-is, for anyone to use.</p>

        <h2>No warranty</h2>
        <p>These tools are provided without warranty of any kind. Timing logic is built to be drift-free and is tested carefully, but you're responsible for verifying results before relying on them for anything with real stakes — a race, a medical timing need, or similar.</p>

        <h2>Not a substitute for a dedicated alarm</h2>
        <p>The Alarm Clock and countdown alarms only work while this tab is open in a browser that's running. They are not a replacement for a phone alarm or a dedicated alarm clock for anything you can't afford to miss.</p>

        <h2>Acceptable use</h2>
        <p>Use clocklab.net for its intended purpose — timing things. Don't attempt to disrupt the site, scrape it abusively, or use it in a way that violates applicable law.</p>

        <h2>Your data stays yours</h2>
        <p>Any time, date or preference you set with these tools is yours. clocklab.net doesn't claim any rights to it, and as explained in the <a href="/privacy/">privacy page</a>, it never leaves your browser in the first place.</p>

        <h2>Changes</h2>
        <p>These terms may be updated occasionally as the site evolves. Continued use after a change means you accept the current version.</p>"""

legal_page("privacy", "Privacy", PRIVACY_BODY)
legal_page("terms", "Terms", TERMS_BODY)

# ---------------------------------------------------------------- 404 --

def not_found_page():
    title = "Page not found | clocklab.net"
    description = "This page doesn't exist. Find a timer tool from the clocklab.net homepage."
    json_ld = '{{"@context":"https://schema.org","@type":"WebPage","name":{name},"url":{url}}}'.format(
        name=jstr(title), url=jstr(SITE + "/404.html")
    )
    body = """<body>
{header}
  <main>
    <section class="doc-page">
      <div class="wrap">
        <h1>404 — nothing here</h1>
        <p>That page doesn't exist. Every tool lives at a clean address off the homepage.</p>
        <p><a href="/">Back to clocklab.net →</a></p>
      </div>
    </section>
  </main>
{footer}
{scripts}
</body>""".format(header=header("other"), footer=footer(), scripts=scripts_tail())
    html = "<!doctype html>\n<html lang=\"en\">\n" + head(title, description, "/404.html", json_ld) + "\n" + body + "\n</html>\n"
    write("404.html", html)


not_found_page()

# --------------------------------------------------------- root files --

write("CNAME", "clocklab.net\n")
write("ads.txt", "google.com, pub-7560786263587509, DIRECT, f08c47fec0942fa0\n")
write(".nojekyll", "")
write(
    "robots.txt",
    "User-agent: *\nAllow: /\nSitemap: {}/sitemap.xml\n".format(SITE),
)

sitemap_urls = ["/"] + [clean_url(t["slug"]) for t in TOOLS] + [clean_url("privacy"), clean_url("terms")]
sitemap_entries = "\n".join(
    "  <url><loc>{}{}</loc><lastmod>{}</lastmod></url>".format(SITE, u, TODAY)
    for u in sitemap_urls
)
sitemap = (
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + sitemap_entries
    + "\n</urlset>\n"
)
write("sitemap.xml", sitemap)

print("Generated {} tool pages (dir + .html alias) + homepage + legal + meta files.".format(len(TOOLS)))
