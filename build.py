#!/usr/bin/env python3
"""
One-off generator for clocklab.net's static pages. Produces plain HTML
files with zero templating at request time — the shipped site has no
build step at all. Every HTML file in the repo is written by this script and
none of them should ever be hand-edited: run `python3 build.py` and commit
what changes. Re-running it is idempotent — a second run produces no diff.

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
TODAY = "2026-08-10"

# ---------------------------------------------------------------- tools --

def countdown_workspace(seconds=300, preset=False, label="Countdown Timer",
                        presets=None, hint=None, chips=""):
    """The countdown instrument's markup, in one place.

    The preset-duration pages (/5-minute-timer/, /egg-timer/ and the rest) are
    this same instrument with the time already dialled in, so they share the
    markup rather than forking it — the engine underneath is untouched either
    way. Two things differ on a preset page:

      * the number fields and the readout are written out already set, so the
        page is correct before a line of JavaScript runs, and correct with none
        at all. Reset re-reads those fields, so it returns here rather than to
        the generic five minutes;
      * `data-duration` marks the page as a preset page, which is how app.js
        knows an idle value left in local storage must not override the
        duration the visitor came for, and what `?autostart=1` starts.

    The plain /countdown-timer/ page passes neither, so it keeps restoring
    whatever you last set there.

    `chips` is the preset-duration sibling row (see duration_chips). It sits
    inside the instrument, below its own controls, because a duration is a
    parameter of this tool rather than a peer of it. It is passed in rather
    than built here so the homepage's copy of the instrument can go without:
    that panel ships `hidden` until its card is picked, and links inside a
    load-gated container are display:none on arrival.
    """
    h, m, s = seconds // 3600, (seconds % 3600) // 60, seconds % 60
    preset_html = ""
    if presets:
        buttons = "\n".join(
            '        <button type="button" class="ctrl-btn preset-btn" data-preset-seconds="{secs}" aria-pressed="false">{name}<span class="preset-time">{time}</span></button>'.format(
                secs=p["seconds"], name=p["name"],
                time="%d:%02d" % (p["seconds"] // 60, p["seconds"] % 60),
            )
            for p in presets
        )
        preset_html = """      <div class="preset-row" role="group" aria-label="Presets">
{buttons}
      </div>
""".format(buttons=buttons)

    return """
    <div class="instrument"{duration}>
      <div class="nameplate">
        <span class="nameplate-label">{label}</span>
        <span class="status-led" id="cd-status" data-state="idle">Idle</span>
      </div>
      <div class="dial-wrap">
        <div class="dial-mount" id="cd-dial"></div>
        <div class="screen">
          <div class="readout" id="cd-readout">{readout}</div>
          <div class="readout-sub">HH&nbsp;:&nbsp;MM&nbsp;:&nbsp;SS</div>
        </div>
      </div>
{presets}      <div class="set-row">
        <div class="set-field"><label for="cd-h">Hours</label><input type="number" id="cd-h" min="0" max="23" value="{h}" inputmode="numeric"></div>
        <div class="set-field"><label for="cd-m">Min</label><input type="number" id="cd-m" min="0" max="59" value="{m}" inputmode="numeric"></div>
        <div class="set-field"><label for="cd-s">Sec</label><input type="number" id="cd-s" min="0" max="59" value="{s}" inputmode="numeric"></div>
      </div>
      <div class="controls-row">
        <button type="button" class="ctrl-btn primary" id="cd-start">Start</button>
        <button type="button" class="ctrl-btn" id="cd-pause" disabled>Pause</button>
        <button type="button" class="ctrl-btn ghost" id="cd-reset">Reset</button>
        <button type="button" class="ctrl-btn stop" id="cd-stop-alarm" hidden>Stop Alarm</button>
      </div>
      <div class="notify-row">
        <input type="checkbox" id="cd-notify" data-notify-toggle>
        <label for="cd-notify">Notify me when it's done</label>
      </div>
      <p class="notify-state" id="cd-notify-state" role="status"></p>
      <p class="hint">{hint}</p>
{chips}    </div>
""".format(
        duration=' data-duration="{}"'.format(seconds) if preset else "",
        label=label,
        readout="%02d:%02d:%02d" % (h, m, s),
        presets=preset_html,
        chips=chips,
        h=h, m=m, s=s,
        hint=hint or "Ends with an audible alarm — keep this tab's sound unmuted. A running countdown keeps counting in a background tab and picks itself back up if you reload.",
    )


# The six tier-1 tools, and the single source of truth for the toolbar.
#
# A page is tier 1 only if it answers a different question (portfolio nav
# spec, ngineer420.github.io#13). Everything in this list qualifies; the
# fifteen preset-duration pages below do not, because they are this same
# countdown with the time baked in, so they never take a rail or a sheet slot.
#
#   nav_label -> the rail chip, <= 18 characters. `name` is the anchor text in
#                the sheet, the tool cards and the related-tool blocks.
#   nav_group -> which sheet group this tool would sit in. Unused while the
#                site has <= 8 tier-1 tools, because the sheet renders flat at
#                that size and group headings are noise; kept so the
#                arrangement is already decided the day a ninth arrives.
#
# Rail order is this list's order, which is also the homepage grid's order.
TOOLS = [
    dict(
        slug="countdown-timer",
        name="Countdown Timer",
        nav_label="Countdown",
        nav_group="timers",
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
            ("Does the timer drift if my laptop is busy or the tab is in the background?", "No — clocklab reads the actual elapsed time from a timestamp each time it renders, rather than counting down once per interval tick. The ticking itself runs in a Web Worker, which browsers throttle far less aggressively than a hidden tab's normal timers, so a backgrounded countdown still notices zero and rings on time."),
            ("Why can't I hear the alarm?", "Browsers require a user gesture before they'll play audio. Tapping Start unlocks sound for the page, so as long as you've interacted with the timer at least once and your device isn't muted, the alarm will play. If you're likely to be in another tab or another app when it ends, tick “Notify me when it's done” — that posts a system notification, which reaches you even when the sound doesn't."),
            ("What happens if I reload the page mid-countdown?", "It resumes. clocklab saves the countdown's start timestamp and its total duration to your browser's local storage, so on reload it works out the remaining time against the real clock rather than from wherever the on-screen counter had got to. If the countdown ran out while the page was closed, it says so on load instead of pretending it's still going."),
            ("Can I pause partway through and come back later?", "Yes — Pause holds the exact remaining time, and it survives a reload or a browser restart too. Switching to another tool, another tab or another app doesn't lose the countdown's place."),
            ("Is there a maximum duration?", "Up to 23 hours, 59 minutes and 59 seconds in one countdown — plenty for cooking, workouts, presentations or focus blocks."),
        ],
        related=["pomodoro-timer", "interval-timer", "alarm-clock"],
        workspace=countdown_workspace(),
    ),
    dict(
        slug="stopwatch",
        name="Stopwatch",
        nav_label="Stopwatch",
        nav_group="timers",
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
        nav_label="Pomodoro",
        nav_group="timers",
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
            ("Will it keep going if I switch tabs or reload?", "Both. The countdown runs in a Web Worker, so a hidden tab keeps switching phases on time rather than freezing until you look at it, and ticking “Notify me at every phase change” posts a system notification so you actually hear about it. The running cycle is also saved to local storage — reload mid-session and clocklab works out from the clock which phase you should be in now, and drops you there."),
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
      <div class="notify-row">
        <input type="checkbox" id="pd-notify" data-notify-toggle>
        <label for="pd-notify">Notify me at every phase change</label>
      </div>
      <p class="notify-state" id="pd-notify-state" role="status"></p>
      <p class="hint">Chimes softly between focus and break — nothing to dismiss. The cycle keeps running in a background tab and resumes where the clock says it should if you reload.</p>
    </div>
""",
    ),
    dict(
        slug="alarm-clock",
        name="Alarm Clock",
        nav_label="Alarm",
        nav_group="clocks",
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
            ("Does the alarm ring if I close the tab?", "No — like any browser-based tool, clocklab needs the tab to stay open to ring. It can be in the background, though: the time check runs in a Web Worker so a hidden tab keeps checking, and if you tick “Notify me when it rings” you'll get a system notification from whatever you've switched to. If you do close the tab, the alarm is remembered and still armed when you come back."),
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
      <div class="notify-row">
        <input type="checkbox" id="al-notify" data-notify-toggle>
        <label for="al-notify">Notify me when it rings</label>
      </div>
      <p class="notify-state" id="al-notify-state" role="status"></p>
      <p class="hint" id="al-hint">Set a time and tap Set Alarm — this tab must stay open for the alarm to ring.</p>
    </div>
""",
    ),
    dict(
        slug="interval-timer",
        name="Interval Timer",
        nav_label="Interval",
        nav_group="timers",
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
            ("What if I lock my phone or switch apps mid-workout?", "The rounds are driven by a Web Worker reading the real clock, so the timer keeps advancing rather than freezing when the tab goes to the background, and it picks up mid-workout if the page reloads. Tick “Notify me at every round change” to get a system notification at each switch — useful when the screen is off."),
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
      <div class="notify-row">
        <input type="checkbox" id="iv-notify" data-notify-toggle>
        <label for="iv-notify">Notify me at every round change</label>
      </div>
      <p class="notify-state" id="iv-notify-state" role="status"></p>
      <p class="hint">Starts with a 5-second get-ready countdown, then alternates work and rest. Keeps running in a background tab and picks itself back up if you reload.</p>
    </div>
""",
    ),
    dict(
        slug="world-clock",
        name="World Clock",
        nav_label="World Clock",
        nav_group="clocks",
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

# The tab mark. People leave a countdown running in a background tab and find it
# again by its icon, so the shape has to survive 16px: a bare ring at that size
# is a smudge, and a thin hand disappears. An amber face carrying a dark V of
# hands keeps one strong asymmetry that still reads when it's four pixels wide.
# --panel for the housing so it has an edge against a light and a dark tab strip
# alike; --amber for the face, the site's "running" signal colour.
# Written from here rather than kept by hand in assets/ so the mark and the
# <link> in head() below can never drift apart.
FAVICON_PATH = "assets/favicon.svg"
FAVICON_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#15181c"/>
  <circle cx="32" cy="32" r="22" fill="#ffab2e"/>
  <path d="M32 32 L32 15" stroke="#15181c" stroke-width="7" stroke-linecap="round"/>
  <path d="M32 32 L45 39" stroke="#15181c" stroke-width="7" stroke-linecap="round"/>
</svg>
"""

ERABBIT = '<a href="https://erabb.it" class="erabbit-mark" aria-label="erabb.it"><img src="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>\U0001F407</text></svg>" width="10" height="10" alt=""></a>'

THEME_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'


# ---------------------------------------------------------------- nav --
# The portfolio toolbar (ngineer420.github.io#13): one <nav class="toolbar">,
# a direct child of <body> immediately after </header> and always above
# <main>. A labelled, counted <details> trigger pinned left that never
# scrolls, and one non-wrapping row of tool chips that does.
#
# It is not sticky and neither is the header, so nothing in the chrome can
# overlay an AdSense anchor unit or an in-content placement. The block is
# byte-identical on all 26 pages bar a single aria-current, which is what
# makes regenerating the whole site from one list safe.

NAV_NOUN = "tools"

# Sheet groups, in order. Unused while there are <= 8 tier-1 destinations —
# the sheet renders flat at that size because group headings are noise there
# — but kept so the arrangement is decided before a ninth tool arrives.
NAV_GROUPS = [
    ("timers", "Timers & stopwatch"),
    ("clocks", "Clocks & alarms"),
]

# The tier-1 tool the preset-duration pages are a parameter of. It owns their
# URLs and the /timers/ hub for the purposes of the rail's selected state.
VARIANT_PARENT = "countdown-timer"

SKIP_LINK = '  <a class="skip-link" href="#main">Skip to the tool</a>'


def esc(text):
    """Anchor and label text is data, so it gets escaped on the way out."""
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def nav_anchor(href, text, current, owns=()):
    """One toolbar anchor, carrying the page's only per-page difference.

    `aria-current="page"` is reserved for a link that really does point at the
    page being rendered. On a preset-duration page nothing in the rail does,
    so the countdown timer — the tool those pages are a baked-in parameter of
    — takes `aria-current="true"` instead: "the current item in this set".
    The CSS matches the bare attribute so both render selected. Without this
    the rail would sit with nothing selected on 16 of the 26 pages.
    """
    if href == current:
        mark = ' aria-current="page"'
    elif current in owns:
        mark = ' aria-current="true"'
    else:
        mark = ""
    return '<a href="{href}"{mark}>{text}</a>'.format(
        href=esc(href), mark=mark, text=esc(text)
    )


def countdown_family():
    """Every URL the countdown timer owns: its presets, and their hub."""
    return tuple([clean_url(d["slug"]) for d in DURATION_PAGES] + ["/timers/"])


def toolbar(current):
    """The toolbar for the page whose canonical path is `current`.

    Home is the brand, so it never takes a slot here; Privacy and Terms live
    in the footer. The sheet lists every rail destination — the rail is never
    the only route to anything — and closes with one hub link per tier-2
    family, which is how fifteen preset timers reach the chrome without
    fifteen chips.
    """
    owns = countdown_family()
    rail = TOOLS[:8]  # the spec's cap; this site has six

    def entry(tool, text):
        return nav_anchor(
            clean_url(tool["slug"]), text, current,
            owns=owns if tool["slug"] == VARIANT_PARENT else (),
        )

    # Flat at <= 8 destinations, grouped at 9+. Automatic, never hand-forced.
    flat = len(TOOLS) <= 8
    lines = []
    if flat:
        lines.append("        <ul>")
        lines += ["          <li>{}</li>".format(entry(t, t["name"])) for t in TOOLS]
        lines.append("        </ul>")
    else:
        for i, (key, title) in enumerate(NAV_GROUPS, start=1):
            members = [t for t in TOOLS if t["nav_group"] == key]
            if not members:
                continue
            gid = "tb-g{}".format(i)
            # <p>, not <h2>: these are SEO landing pages and a chrome heading
            # would pollute the document outline. AT still announces the list.
            lines.append(
                '        <p class="tb-grouplabel" id="{id}">{t}</p>'.format(id=gid, t=esc(title))
            )
            lines.append('        <ul aria-labelledby="{id}">'.format(id=gid))
            lines += ["          <li>{}</li>".format(entry(t, t["name"])) for t in members]
            lines.append("        </ul>")
    hub = nav_anchor(
        "/timers/", "All {n} preset timers →".format(n=len(DURATION_PAGES)), current
    )
    lines.append('        <p class="tb-hub">{}</p>'.format(hub))

    chips = "\n".join(
        "      <li>{}</li>".format(entry(t, t["nav_label"])) for t in rail
    )

    return """  <nav class="toolbar" aria-label="Tools">
    <details class="tb-menu">
      <summary class="tb-trigger" aria-label="All {count} {noun}">
        <span class="tb-glyph" aria-hidden="true">&#9636;</span>
        <span class="tb-label">All {count}<span class="tb-label-long"> {noun}</span></span>
      </summary>
      <div class="tb-sheet{flat}">
{sheet}
      </div>
    </details>
    <div class="tb-scrim"></div>
    <ul class="tb-rail">
{chips}
    </ul>
  </nav>""".format(
        count=len(TOOLS),
        noun=esc(NAV_NOUN),
        flat=" is-flat" if flat else "",
        sheet="\n".join(lines),
        chips=chips,
    )


def header():
    """Brand and the theme toggle. Zero links, no hamburger, not sticky.

    Everything that used to live here is in the toolbar underneath it, which
    shows the peers a collapsed panel hid: the old menu was 122px of links
    wrapped across three rows behind a JS toggle.
    """
    return """  <header class="site-header">
    <div class="wrap">
      <a href="/" class="wordmark" data-panel-link=""><span class="tick">[</span>clocklab<span class="tick">]</span></a>
      <div class="header-controls">
        <button type="button" class="theme-toggle" id="theme-toggle" aria-label="Toggle light and dark theme">{icon}</button>
      </div>
    </div>
  </header>""".format(icon=THEME_ICON)


def chrome(current):
    """Everything between <body> and <main>, in order, on every page."""
    return "\n".join([SKIP_LINK, header(), toolbar(current)])


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
  <link rel="icon" href="/{favicon}" type="image/svg+xml">
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
        favicon=FAVICON_PATH,
        title=title,
        description=description,
        canonical=canonical,
        json_ld=json_ld,
        adsense=ADSENSE,
    )


def scripts_tail():
    return (
        '  <script src="/assets/dial.js"></script>\n'
        '  <script src="/assets/audio.js"></script>\n'
        '  <script src="/assets/timer-core.js"></script>\n'
        '  <script src="/assets/app.js"></script>'
    )


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
{chrome}
  <main id="main">
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
        chrome=chrome(canonical_path),
        name=tool["name"],
        intro=tool["intro"],
        workspace=tool.get("page_workspace") or tool["workspace"],
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


# The tool pages are written further down, after the preset-duration family
# exists: the toolbar's hub link counts it, and the countdown timer's own page
# carries a chip for every member.

# ------------------------------------------------- preset duration pages --
# One page per duration people actually type into a search box. The countdown
# timer answers all of them from a single URL, which is exactly the problem:
# "5 minute timer" is a different query from "1 hour timer", and neither of
# them is "countdown timer".
#
# Sixteen near-identical pages would be a doorway farm, so the rule here is
# that a duration only gets a page if there is something true and specific to
# say about why *that* number gets searched. Every intro, second paragraph and
# FAQ below is about its own duration; none of it is one paragraph with the
# number swapped in. A duration with nothing to say does not get a page.

EGG_EXTRA = """
    <section class="content-section">
      <div class="wrap">
        <h2>Timings, from the moment the water boils</h2>
        <p>Every figure below assumes an egg taken straight from the fridge and lowered into water that is already at a rolling boil. Change either of those and the numbers move, which is why no two recipes agree: they are usually describing different starting conditions rather than disagreeing about eggs.</p>
        <div class="data-table">
          <table>
            <thead>
              <tr><th scope="col">Egg size</th><th scope="col">Soft, runny yolk</th><th scope="col">Medium, jammy</th><th scope="col">Hard, fully set</th></tr>
            </thead>
            <tbody>
              <tr><td>Medium</td><td>5:00</td><td>7:00</td><td>10:00</td></tr>
              <tr><td>Large</td><td>6:00</td><td>8:00</td><td>11:00</td></tr>
              <tr><td>Extra large</td><td>7:00</td><td>9:00</td><td>12:00</td></tr>
            </tbody>
          </table>
        </div>
        <p>An egg at room temperature runs roughly a minute ahead of a fridge-cold one of the same size. Altitude runs the other way: water boils below 100°C the higher you are, so the egg cooks more slowly and needs longer, not less.</p>
        <h3>Why a cold-water start throws all of this off</h3>
        <p>If you put the eggs in cold water and bring the pan up together, the timer has no idea how long your hob takes to get there — a fast induction ring and a tired electric plate can differ by several minutes, and those minutes are cooking time. Time from the boil, not from switching the heat on. If you prefer the cold-water method, watch for the rolling boil and start the timer then, or take the pan off the heat at the boil and use the covered standing time your own recipe specifies rather than the figures above.</p>
        <h3>Stopping the cooking</h3>
        <p>An egg left in its shell keeps cooking after it comes out of the water, and a soft yolk turns medium while it sits on the draining board. Lift them straight into cold or iced water for a couple of minutes. It halts the residual heat, and the sudden contraction makes the shell easier to get off.</p>
      </div>
    </section>
"""

DURATION_PAGES = [
    dict(
        slug='30-second-timer',
        name='30 Second Timer',
        short='30 seconds',
        seconds=30,
        tagline='Half a minute, read off a clock instead of a headcount',
        description='A free 30 second timer that runs entirely in your browser. The duration arrives preset, so one tap starts the countdown and a tone marks zero.',
        intro='Thirty seconds is the shortest interval most people can feel going wrong. It is the hold length taught for static stretching, because a muscle needs a few seconds of steady tension before it stops resisting and lengthens. It is the scrub time in handwashing guidance, the rinse printed on mouthwash bottles, and the work phase in most HIIT circuits. Counted in your head it tends to come out short, and always in the direction of less effort. Read off a clock instead, every round is the same length, which is the entire reason the interval gets specified at all.',
        second='At this length the start matters more than the finish. A circuit running twenty rounds of thirty seconds loses a full minute if each round begins three seconds late, so the page arrives with the duration already set and starts on a single tap. Every tick is derived from a real timestamp rather than counted by hand, which is why round nineteen is the same length as round one.',
        uses=[
            'Timed handwashing at the sink',
            'Holding a static stretch',
            'Work intervals in a HIIT circuit',
            'A mouthwash rinse',
            'Plank and wall-sit holds',
            'Watching an espresso shot pull',
        ],
        faq=[
            ('Why do so many instructions land on thirty seconds?',
             'It is the shortest interval long enough for a physical process to finish and short enough to repeat without planning. Soap needs friction time, a stretched muscle needs a few seconds to release, and a circuit needs a work phase that can be run twenty times over. Anything shorter is hard to hold to consistently, and anything longer starts to need a rest of its own.'),
            ('Can I count thirty seconds accurately in my head?',
             'Rarely, and the error runs one way. Counting speeds up under exertion, which is exactly when thirty seconds tends to get counted, so the plank or the wall sit ends early. Saying one thousand between the numbers helps a little and still drifts. If the interval is the point of the exercise, read it off something external.'),
            ('Will the countdown keep running if I switch to another tab?',
             'Yes. Browsers throttle background JavaScript, which is how naive timers quietly lose seconds while you are elsewhere. This one runs its countdown in a Web Worker and derives each tick from a real timestamp, so the tab can sit in the background for the whole interval and the alarm still sounds at the right moment.'),
        ],
    ),
    dict(
        slug='90-second-timer',
        name='90 Second Timer',
        short='90 seconds',
        seconds=90,
        tagline='The rest interval between sets, held to the second',
        description='A free 90 second timer for rest between sets, tea, noodles or a timed pitch. It runs in your browser, needs no install, and starts on one tap.',
        intro='A boxing rest is a flat sixty seconds, which makes ninety the training variant: long enough for breathing to settle, short enough that the next set still costs something. In the weight room it is the classic hypertrophy rest, sitting between the thirty seconds that turns lifting into conditioning and the three minutes that heavy strength work needs. The same number is printed on instant noodle packets and used as the ceiling on a spoken pitch, so it gets typed into a timer far more often than its neighbours at sixty and one hundred and twenty seconds.',
        second='Spoken aloud, ninety seconds runs to roughly two hundred words at a conversational pace, which is why it survives as a pitch limit and a rehearsal length. Rehearsing against a visible countdown rather than a felt sense of pace changes what you learn from the run: you find out which sentence went long instead of whether you felt rushed. The countdown here survives a page reload, so refreshing between attempts costs nothing.',
        uses=[
            'Rest between hypertrophy sets',
            'Instant noodles that say ninety seconds',
            'An elevator pitch rehearsal run',
            'Timed speaking exercises',
            'Rest rounds in boxing training',
        ],
        faq=[
            ('Why do lifting programmes keep landing on ninety seconds between sets?',
             'It is the compromise rest for hypertrophy work. Much under a minute and fatigue accumulates faster than the working muscle recovers, so the later sets fall apart. Past two or three minutes the session stretches out and the emphasis shifts towards pure strength. Ninety seconds keeps the reps achievable while the next set still arrives before recovery is complete.'),
            ('Is ninety seconds the same as one and a half minutes?',
             'Yes, the same interval written two ways, and the page counts down through one minute thirty. Gym programmes and packet instructions tend to write it in seconds, which is why it gets searched that way, while clocks and calendars prefer the fraction. Nothing about the countdown or the alarm changes either way.'),
            ('What happens if I reload the page part way through?',
             'The countdown survives it. Timer state is kept in the browser rather than on a server, so a refresh, an accidental back button or a closed lid picks up where the clock actually is, not where the page last drew it. Nothing is uploaded and nothing is fetched back to make that work.'),
        ],
    ),
    dict(
        slug='2-minute-timer',
        name='2 Minute Timer',
        short='2 minutes',
        seconds=120,
        tagline='The brushing standard, the two-minute rule, one tap to start',
        description='A free 2 minute timer that runs in your browser, preset and ready. Built for brushing teeth, steeping green tea and quick two-minute tasks.',
        intro='Most people meet this duration through a toothbrush. Two minutes is the brushing time dental guidance has broadly settled on, and it is why electric brushes pulse at thirty-second quadrant marks and cut out at the end: left to their own judgement, most people stop well before it. The same number carries the two-minute rule for small tasks, the idea that anything taking less than two minutes should be done now rather than written down. Both uses depend on the interval being enforced from outside, because two minutes of doing something dull does not feel like two minutes.',
        second='Green tea is the other common two-minute job, and the one where overshooting is punished immediately. Leaves left past the mark turn bitter, and there is no coasting period to absorb the mistake the way an oven has. Start the countdown as the water goes in rather than once you remember, and treat the tone as the moment to lift the leaves out.',
        uses=[
            'Brushing teeth, quadrant by quadrant',
            'Two-minute rule tasks',
            'Steeping green tea',
            'A plank progression hold',
            'Holding a longer stretch',
        ],
        faq=[
            ('Where does the two-minute brushing figure come from?',
             'It is the number dental guidance and toothbrush makers converged on long ago, and it stuck partly because it divides neatly: thirty seconds for each quadrant of the mouth. That is why electric brushes pulse four times and then stop. Precision matters less than the interval here, since the usual error is stopping at half the time.'),
            ('What is the two-minute rule?',
             'A habit borrowed from task management: if something takes less than two minutes, do it immediately instead of adding it to a list, because tracking it costs more than finishing it. Running an actual countdown alongside the work is a useful calibration exercise, since most people are wrong about which jobs qualify.'),
            ('Can I run this as a silent timer?',
             'You can mute the tab and simply watch the countdown, and nothing else on the page makes noise. The reverse catches people out more often: the alarm cannot be heard through a muted tab, and on a phone the hardware silent switch will suppress it too. If the tone matters, check both before you start.'),
        ],
    ),
    dict(
        slug='3-minute-timer',
        name='3 Minute Timer',
        short='3 minutes',
        seconds=180,
        tagline='A boxing round, a brisk cup of tea, a very runny egg',
        description='A free 3 minute timer for rounds, black tea and soft-boiled eggs. It runs in your browser, works offline once loaded, and starts with a single tap.',
        intro='The three-minute round is the unit professional boxing is built on, and it outlives the sport in gym clocks, bag work and round-based conditioning. Away from the ring the number belongs mostly to tea and eggs. Black tea is usually given three to five minutes, and three is the brisk end of that range rather than the stewed one. A soft-boiled egg at three minutes is the runny extreme, the point where thirty seconds either way decides whether the yolk pours or holds its shape.',
        second='A spoken piece often gets the same ceiling: a competition slot, a lightning talk, a rehearsal target, all short enough to run again immediately. In the kitchen, treat the alarm as a cue rather than a finish line. Food carries on cooking once it leaves the heat, so an egg lifted at three minutes keeps setting inside its shell while you are peeling it.',
        uses=[
            'A boxing or bag-work round',
            'Steeping black tea briefly',
            'A very runny soft-boiled egg',
            'Resting meat off the heat',
            'A three-minute talk or pitch',
        ],
        faq=[
            ('Why are boxing rounds three minutes?',
             'It is the long-standing professional convention, three minutes of work against one minute of rest, and gyms inherited it for bag and pad work. It is not universal: amateur bouts and most professional bouts between women use two-minute rounds. As a conditioning interval, three minutes is simply long enough that pacing becomes part of the exercise.'),
            ('Is three minutes enough for black tea?',
             'It is the short end of the usual three to five minute range and gives a lighter, less tannic cup. Larger pots and stronger leaves want longer, while a single bag in a mug at three minutes is already assertive. Tea keeps extracting until the leaves come out, so lift them at the tone rather than after the first sip.'),
            ('Does the alarm need a download or a connection?',
             'No. The tone is generated live in the browser from oscillators, so there is no sound file to fetch and nothing to install. Once the page has loaded it also runs offline, which matters in a gym basement or a kitchen with poor signal. Losing reception mid-round has no effect on the countdown.'),
        ],
    ),
    dict(
        slug='5-minute-timer',
        name='5 Minute Timer',
        short='5 minutes',
        seconds=300,
        tagline='Five minutes that stay five minutes',
        description='A free 5 minute timer that runs in your browser and does not drift. The duration is already set, so one tap starts it and a tone marks the end.',
        intro='Nobody has ever meant five more minutes literally, which is half the reason the number gets typed into a timer at all. Said out loud it is a negotiating position, and set on a clock it becomes a fact both people in the room can see. Elsewhere the same five minutes does honest work. It is a standard steep for herbal infusions, a realistic plank target for anyone who has been training a while, and the short break between work blocks in most timeboxing schemes, including the one most people know from Pomodoro.',
        second='It is also the rest a steak wants before it is cut, long enough for the juices to settle and not so long that the plate goes cold, and the length short meditation or journaling sessions default to: past the point of being a token gesture, well short of an excuse to skip it. As a break it has one reliable failure mode, which is starting the clock after the phone is already in hand.',
        uses=[
            'Steeping herbal tea',
            'A five-minute plank goal',
            'A journaling or meditation block',
            'Resting a steak before slicing',
            'A break between study blocks',
            'Five more minutes for a child',
        ],
        faq=[
            ('Why does five minutes feel longer than it is?',
             'Because attention has nowhere else to go. Five minutes of waiting with nothing happening gets estimated far more generously than five minutes spent doing something, which is why the same interval feels short as a break and endless as a plank hold. Reading the number off a clock takes the estimate out of the question entirely.'),
            ('Can I use this for the short break in a Pomodoro cycle?',
             'Yes, five minutes is the standard short break in that method, taken after each working block, with a longer break after several cycles. The break is the part people skip or overrun, so timing it rather than estimating it is the whole point. Start it as you leave the desk, not once you have settled somewhere else.'),
            ('How accurate is this timer?',
             'Each tick is computed by comparing the current timestamp against the moment you started, so it cannot accumulate error the way a counter that adds one second per frame does. A busy machine or a throttled background tab may draw the display a fraction late, but the elapsed time it reports stays correct and the alarm lands on the real second.'),
        ],
    ),
    dict(
        slug='10-minute-timer',
        name='10 Minute Timer',
        short='10 minutes',
        seconds=600,
        tagline='Long enough to finish something small, short enough to commit to',
        description='A free 10 minute timer for meditation, oven timing and short focused blocks. It runs entirely in your browser and starts with a single tap.',
        intro='A tray in the oven, a guided meditation and a break called in a meeting all land on the same number. Ten minutes is where a duration stops being an interval and starts being a boundary: long enough to complete something small, short enough that nobody reorganises an afternoon around it. It is the usual beginner length for sitting practice, the first checkpoint on a bake, and the cooling-off period people impose on themselves before answering something that annoyed them. It is also the block most often used to start postponed work, because agreeing to ten minutes costs nothing.',
        second='The tidying sprint is the clearest case. Ten minutes against a visible clock is a different job from tidying until the room looks better, because the end is fixed before the work starts and nothing has to be finished. The same structure suits a decision that keeps being circled: one interval, one task, and an alarm that ends the block whether the drawer is done or not.',
        uses=[
            'A short guided meditation',
            'A ten-minute tidying sprint',
            'First checkpoint on an oven bake',
            'A break called in a meeting',
            'A cooling-off period before replying',
            'A short bodyweight workout',
        ],
        faq=[
            ('What makes ten minutes the default meditation length?',
             'It is about the shortest length that still contains a settling period. The first minutes of a sitting session tend to go on fidgeting and getting comfortable, so anything much shorter is mostly setup. Ten leaves a usable stretch after that while staying easy to fit into a day, which is why it became the common default for beginner sessions.'),
            ('Is one ten-minute block better than two five-minute ones?',
             'It depends on whether the task has a setup cost. Tidying, writing and cooking all lose time to restarting, so a single block wins. Stretching, breaks and anything that gets uncomfortable are easier split in two. If a job is being avoided outright, the shorter block is easier to agree to and can simply be repeated.'),
            ('Does the page store anything about me?',
             'No. The countdown runs entirely in your browser, nothing is uploaded, and no account, email or sign-in is involved anywhere. The only thing kept is the timer state itself, held locally so that a reload does not lose your place. Closing the tab discards it, and there is nothing on a server to delete.'),
        ],
    ),
    dict(
        slug='15-minute-timer',
        name='15 Minute Timer',
        short='15 minutes',
        seconds=900,
        tagline='A quarter hour, boxed off and enforced',
        description='A free 15 minute timer for study blocks, tidying sprints and standing meetings. It runs in your browser with nothing to install or sign up for.',
        intro='The quarter hour is a unit people already think in. Clocks are quartered, school periods break on it, and calendar software snaps appointments to fifteen-minute increments, so the number arrives with a shape already attached to it. That makes it the default block for work being avoided: short enough to agree to, long enough that something real happens inside it. It is also a common checkpoint partway through a longer bake, and the length of the standing meeting, which runs a quarter hour because that is roughly how long a room of people will stay on their feet.',
        second='Domestically the same block covers a kitchen reset or a room that has drifted, and it behaves differently from the shorter settings in one respect. At fifteen minutes people stop watching the countdown, which is the point of setting one, but it also means the alarm has to carry from another room. Volume is worth checking here in a way it never is at thirty seconds.',
        uses=[
            'A quarter-hour tidying block',
            'A short study interval',
            'A fifteen-minute standing meeting',
            'Checking on an oven bake',
            'Timeboxing a task being avoided',
            'A break between school periods',
        ],
        faq=[
            ('Why does fifteen minutes work on a task being avoided?',
             'Because the commitment is small enough to accept and the end is defined before you start. Avoidance is usually about the open-ended size of a job rather than its difficulty, so putting a boundary around it removes the part being avoided. Whether the work carries on after the tone is then a separate decision, made from inside the task.'),
            ('How does fifteen minutes compare with a twenty-five-minute work block?',
             'Twenty-five is the familiar timeboxing length and suits work that needs a run-up before it becomes productive. Fifteen is better for starting, for tasks with a clear stopping point, and for anyone whose attention gives out before the longer block does. Two fifteens with a gap between them is not the same thing as one thirty-minute stretch.'),
            ('Will it still be running when I unlock my phone?',
             'The remaining time will be right, because it is recalculated from the moment you started rather than counted while the screen was off. A locked phone can suspend the page altogether, though, so the tone may arrive late or not at all. If the alarm is doing real work, keep the screen awake.'),
        ],
    ),
    dict(
        slug='20-minute-timer',
        name='20 Minute Timer',
        short='20 minutes',
        seconds=1200,
        tagline='The nap length, the eye-break interval, the ice pack',
        description='Free 20 minute timer that runs in your browser. One tap starts a 20:00 countdown with an alarm at zero, for naps, eye breaks and ice packs.',
        intro='A nap that ends before deep sleep sets in tends to leave you clear-headed, and one that runs past it usually does not, which is why twenty minutes is the length most nap advice settles on. How quickly anyone gets there varies with the person and with how tired they are, so treat it as a ceiling rather than a measurement. The same number does other work: the 20-20-20 eye rule asks for a twenty-second look at something distant every twenty minutes, so this is the reminder interval rather than the break itself. Ice on a fresh injury is usually capped around here too.',
        second='In a kitchen, twenty minutes is the middle rung, long enough for a tray of vegetables to take colour and short enough that wandering off is a bad idea. It is also the standard length for a cleaning burst: one room, one timer, stop when it rings. The page arrives with 20:00 already loaded, so there is nothing to dial and one tap starts it.',
        uses=[
            'A power nap before deep sleep',
            '20-20-20 eye break reminders',
            'Ice packs on a fresh injury',
            'A single-room cleaning burst',
            'Roasting and reheating in the oven',
        ],
        faq=[
            ('Why is twenty minutes the usual limit for a nap?',
             'Sleep gets deeper the longer it goes on, and waking out of the deeper stages produces the heavy, disoriented feeling usually called sleep inertia. Twenty minutes is the common compromise: enough to take the edge off, short enough that most people surface easily. How fast anyone reaches deep sleep varies, so the number is a ceiling rather than a guarantee.'),
            ('Can I use this for the 20-20-20 eye rule?',
             'Yes, as long as you keep track of which twenty is which. The rule asks for a twenty-second look at something roughly twenty feet away, every twenty minutes. This timer covers the twenty-minute part: start it, work, and when it rings, look up and away for a slow count of twenty, then start it again. The break is short enough to count in your head.'),
            ('Will the alarm wake me if I am asleep?',
             'Only if the sound can reach you. The alarm is generated live from oscillator tones in the page, so there is no file to download and nothing to load, but a muted tab produces silence and a phone with its silent switch on will stay quiet whatever the page does. Check the volume before you lie down rather than after.'),
        ],
    ),
    dict(
        slug='25-minute-timer',
        name='25 Minute Timer',
        short='25 minutes',
        seconds=1500,
        tagline='One Pomodoro interval, without the cycle around it',
        description='Free 25 minute timer running entirely in your browser. One tap starts a single Pomodoro-length interval with an alarm at zero. No install, no account.',
        intro="The Pomodoro technique fixed its work interval at twenty-five minutes, followed by a five-minute break, and took its name from the tomato-shaped kitchen timer Francesco Cirillo used as a student. That is the whole reason this particular number gets typed so often. It is not a natural unit of anything: it is one method's chosen block, long enough to reach something and short enough that starting feels cheap. This page is the plain interval on its own, twenty-five minutes and one alarm with nothing after it. For the full cycle, with breaks and session counts handled automatically, the Pomodoro timer on this site does that job instead.",
        second='A single interval suits work that does not repeat: one email you have been avoiding, one chapter, one difficult phone call. There is no break waiting at the end and no session count to satisfy, so when the alarm sounds you are simply finished. Twenty-five also works as a shared unit. Two people can hold attention on the same problem for that long before anyone needs to stand up.',
        uses=[
            'One Pomodoro work interval',
            'A focused writing sprint',
            'A single study block',
            'Clearing an avoided task',
            'Timed practice on an instrument',
        ],
        faq=[
            ('How is this different from the Pomodoro timer on this site?',
             'This page runs one interval and stops. The Pomodoro timer runs the method: a focus block, a short break, another block, and a longer break after a set number of sessions, moving between them on its own. Use this page when you want a single twenty-five-minute stretch and nothing afterwards, and that one when you want the whole cycle managed for you.'),
            ('Why twenty-five minutes rather than thirty?',
             'Because the technique specified twenty-five and the number stuck. There is a tidy argument for it as well: twenty-five plus a five-minute break comes to exactly half an hour, so two intervals fit inside an hour with no arithmetic. A thirty-minute block with a break attached overruns the hour, which makes it awkward to line up against anything on a calendar.'),
            ('What happens if I reload the page partway through?',
             'The countdown survives it. Timer state is kept in the browser, so a refresh, a stray back button, or a tab the browser decided to restart picks up the same countdown instead of resetting to 25:00. Time remaining is worked out from a real timestamp rather than counted tick by tick, so nothing is quietly lost while the page reloads.'),
        ],
    ),
    dict(
        slug='30-minute-timer',
        name='30 Minute Timer',
        short='30 minutes',
        seconds=1800,
        tagline='Half an hour, for the oven, the gym and the calendar',
        description='Free 30 minute timer that runs in the browser with no install. One tap starts a 30:00 countdown with an alarm at zero, for cooking, workouts and study.',
        intro='A tray goes in the oven and someone says thirty minutes. The number is so ordinary that it barely registers as a choice, which is exactly why it gets set more than almost anything else. It is the default slot in calendar software, the usual cap on a screen-time deal, a common first proving stage for dough, and the length of a workout that has to happen before work. Half an hour is short enough that nobody argues about it and long enough for something to actually finish inside it. The risk sits in that same ordinariness: thirty minutes judged by memory has a habit of becoming forty.',
        second='Thirty also splits cleanly, which is where a lot of its use comes from. Two fifteens make a warm-up and a working set, three tens make a rotation of exercises or subjects, six fives make a drill. This page counts the whole block down in one run and rings once at the end. If you want the internal switches marked as well, the interval timer alternates work and rest rounds for you.',
        uses=[
            'A half-hour workout',
            'Roasting and baking stages',
            'Boxing a meeting to its slot',
            'A homework or revision block',
            'Screen-time limits for children',
            'A first proving stage for dough',
        ],
        faq=[
            ('Can I split thirty minutes into two halves?',
             'Not on this page, which counts one continuous block down to zero. Run it twice for two fifteen-minute halves, or use the interval timer, which alternates a work length and a rest length for a set number of rounds and sounds a chime at every switch. For a plain half hour with a single alarm at the end, this page is the simpler option.'),
            ('Why not just use the oven timer?',
             'Oven timers only count for the oven, and most of them only run one thing at a time. A browser timer sits wherever you already are, can be started from a phone propped against the counter, and leaves the appliance dial free for whatever it was already timing. Nothing is installed and nothing is stored on a server, so any device that opens the page has it.'),
            ('Is it suitable for a child screen-time limit?',
             'It works for that, with one caveat: the alarm sounds in the tab running it, so a muted or closed tab rings nothing. On the other hand, nothing about the session is uploaded or kept on a server, so there is no account to make, no history to manage and nothing to sign into. It is a countdown that anyone can start with one tap.'),
        ],
    ),
    dict(
        slug='45-minute-timer',
        name='45 Minute Timer',
        short='45 minutes',
        seconds=2700,
        tagline='Longer than a study block, shorter than the hour',
        description='Free 45 minute timer, browser-based and ready to run. One tap starts a 45:00 countdown with an alarm at zero, for classes, gym sessions and study.',
        intro='Most people who set forty-five minutes have already rejected an hour as too long to hold and half an hour as too short to get anywhere. Institutions landed in the same place. A school period, a gym session and the so-called therapeutic hour all run to roughly this length, the last of those traditionally forty-five to fifty minutes rather than sixty. The missing ten or fifteen minutes are not lost, they are the changeover: the corridor, the notes, the next person arriving. Putting the work at forty-five and leaving the remainder of the hour unclaimed is the entire trick, and it survives well outside the places that invented it.',
        second='For study, forty-five is commonly treated as the outer edge of one unbroken pass through difficult material, long enough for a full problem set and short enough that the final ten minutes are still worth something. In the kitchen it covers a slow roast stage or the point where a braise wants checking. The useful habit either way is to set it before starting, since what you want from it is the boundary rather than the count.',
        uses=[
            'A school class period',
            'A gym session with warm-up',
            'A therapy or coaching session',
            'A long unbroken study pass',
            'Slow roasting and braising',
        ],
        faq=[
            ('Why are class periods and therapy sessions forty-five minutes?',
             'Both are built around what comes immediately after them. A timetable needs corridor time between periods, so the teaching block is cut short of the hour. The therapeutic hour has traditionally run forty-five to fifty minutes, leaving the practitioner room to write notes and reset before the next appointment. In both cases the hour is the slot and forty-five is the work inside it.'),
            ('Should a coaching session be set to forty-five or fifty?',
             'Either is conventional, and the difference is what you want the remainder for. Fifty gives a longer session and about ten minutes of turnaround. Forty-five leaves a full quarter of an hour, enough for notes, a message and a short break between clients. Set whichever length you actually run to, and let the alarm end it rather than the clock on the wall.'),
            ('Does it work without an internet connection?',
             'Once the page has loaded, yes. Everything runs in the browser: the countdown, the display, and the alarm, which is generated live from oscillator tones instead of fetched as an audio file. A gym basement or a classroom with no signal makes no difference to a timer that is already loaded, and nothing is sent anywhere while it runs.'),
        ],
    ),
    dict(
        slug='1-hour-timer',
        name='1 Hour Timer',
        short='1 hour',
        seconds=3600,
        tagline='Sixty minutes, counted from a real clock',
        description='Free 1 hour timer that runs entirely in your browser. One tap starts a 60:00 countdown with an alarm at zero, for parking, exams, cooking and work.',
        intro='The usual way to get an hour wrong is to start counting from the moment you remembered rather than the moment the hour began. A parking session starts when the ticket is issued, a paper starts when the invigilator says so, a wash started when the door locked. By the time the timer goes on, several minutes have already gone, and a display reading 1:00:00 is quietly telling you something untrue. The fix is unglamorous: subtract whatever has passed before you start, or set fifty-five and take the margin back deliberately instead of discovering later that you never had it.',
        second='An hour is also the unit almost everything is booked and billed in, which makes it the one duration people time for the record rather than for a reminder. A work block, a lesson, a consultation, a rehearsal: the alarm marks the end of something that gets written down afterwards. That is a fair reason to run it from a page that computes every second from the system clock rather than counting ticks and hoping.',
        uses=[
            'Parking limits and meter windows',
            'A timed exam paper',
            'One billable hour',
            'Slow cooking and braising',
            'A full uninterrupted work block',
            'Laundry and dishwasher cycles',
        ],
        faq=[
            ('How accurate is a one hour countdown?',
             'It does not drift. Each tick works the remaining time out from a real timestamp rather than counting intervals, so a slow frame or a busy machine cannot shave seconds off across sixty minutes. A Web Worker keeps it running while the tab is in the background, which is where a naive browser timer gets throttled and comes back short.'),
            ('When should the hour start against a parking meter?',
             'From the time printed on the ticket, not from when you got back to your phone. If five minutes have already gone, set fifty-five. It is worth ending a few minutes early as well, because the alarm tells you the hour is up rather than that you are back at the car, and the walk counts against you rather than the meter.'),
            ('Why use a countdown instead of an alarm at a set time?',
             'A countdown removes the arithmetic. You know the hour started now, but you do not necessarily know off-hand that now plus sixty is 3:47, and a countdown survives being wrong about the current time. If the thing you are working from is a wall-clock moment instead, the alarm clock on this site takes the time itself and rings when the clock reaches it.'),
        ],
    ),
    dict(
        slug='90-minute-timer',
        name='90 Minute Timer',
        short='90 minutes',
        seconds=5400,
        tagline='The length of a match, a film, a lecture, a cycle',
        description='Free 90 minute timer running in the browser, no install needed. One tap starts a 1:30:00 countdown with an alarm at zero, for deep work, naps and films.',
        intro='One sleep cycle, one feature film, one university lecture, one football match. Ninety minutes keeps turning up as the length of something you sit through in a single go. Sleep is the loosest of those: cycles are commonly described as roughly ninety minutes, but the length varies between people and between cycles across the same night, so timing a wake-up to one is an estimate rather than a calculation. The rest are conventions that hardened into standards. What they share is that ninety minutes is about the longest stretch most people will commit to without expecting an interval in the middle.',
        second='As a work block it holds for the same reason. Ninety minutes is long enough to get past the setting-up phase and finish something, and short enough to schedule twice in one morning. It is also long enough that the timer has to survive being ignored, and this one keeps counting in a background tab through a Web Worker, where a plain browser timer would be throttled and come back several minutes short.',
        uses=[
            'A deep-work block',
            'One approximate sleep cycle',
            'A feature film',
            'A lecture or seminar',
            'A football match with half-time',
            'Long-form exam practice',
        ],
        faq=[
            ('Is a sleep cycle really ninety minutes?',
             'Roughly, on average, and not reliably. Ninety minutes is the figure usually quoted, but cycle length differs from person to person and shifts across a night, so a nap set to end at exactly one cycle can still land in the middle of one. Treat it as a sensible guess for a long nap rather than a way to guarantee an easy wake-up.'),
            ('Does the countdown keep running when the tab is in the background?',
             'Yes. It runs in a Web Worker and every tick is derived from a real timestamp, so a backgrounded or throttled tab costs it nothing, which matters most over a long timer where a naive script can return several minutes short. What no page can survive is the machine sleeping, since a sleeping laptop is not running anything at all.'),
            ('Does a football match actually last ninety minutes?',
             'The playing time does, as two halves of forty-five. Elapsed time is always longer, because of a half-time interval of around fifteen minutes and stoppage time added at the end of each half. A ninety-minute timer measures the football rather than the afternoon, so allow closer to two hours if you are timing the whole thing.'),
        ],
    ),
    dict(
        slug='2-hour-timer',
        name='2 Hour Timer',
        short='2 hours',
        seconds=7200,
        tagline='Two hours, for the things you walk away from',
        description='Free 2 hour timer that runs in your browser with no install. One tap starts a 2:00:00 countdown and an alarm at zero, for exams, roasts and parking.',
        intro='Nothing gets a two-hour timer if you intend to sit and watch it. This is the length of the things you deliberately leave: a shoulder in the oven, a marinade in the fridge, a parking bay two streets back, a stretch of motorway before the next stop. The exam is the exception, since there you are stuck in the room with it, and two hours is the standard length of a great many papers. Either way the number is set once and then trusted for a long time, which puts more weight on the timer than any short countdown ever has to carry.',
        second='Over two hours the failure mode is the device rather than the count. A laptop that goes to sleep stops running the page, and although the display catches up from the real clock when it wakes, the alarm will have fired late or not at all. For anything with a consequence at the end, an oven or a meter or a train, keep the machine awake, leave the tab unmuted, and look at it once in the middle.',
        uses=[
            'A two-hour exam paper',
            'A slow roast in the oven',
            'A long marinating window',
            'A parking meter session',
            'A driving stint before a break',
            'A film with the credits',
        ],
        faq=[
            ('What happens if the laptop sleeps during a two hour timer?',
             'The page stops running while the machine is asleep. On waking, the countdown recalculates from the real clock, so the figure on screen is right, but the alarm will have sounded late or not at all, because nothing was running when it came due. For a timer with a consequence attached, keep the device awake or run it on a phone.'),
            ('Is two hours the standard length for an exam paper?',
             'It is one of the common ones, alongside ninety minutes and three hours. Real papers often add reading time before the writing clock starts, so a two-hour paper can occupy two hours and ten minutes of the room. If you are timing practice at home, run the reading period as its own countdown rather than folding it into this one.'),
            ('Why does the page open with the two hours already set?',
             'Because dialling 2:00:00 by hand is the tedious part of a long timer, and mistyping it by a factor of ten is easy to do and slow to notice. This page arrives preset, so starting takes a single tap and there is nothing to enter. For a length that is not on the list, the countdown timer accepts any combination of hours, minutes and seconds.'),
        ],
    ),
    dict(
        slug='egg-timer',
        name='Egg Timer',
        short='an egg timer',
        seconds=480,
        tagline='Soft, medium or hard — timed from the boil, not from the hob',
        description='Free browser egg timer with soft, medium and hard-boiled presets, timings by egg size, and the reason a cold-water start makes every recipe disagree.',
        intro='Three buttons, three yolks: six minutes for runny, eight for jammy, eleven for fully set. Tapping one sets the clock and starts it in the same motion, because the moment you want a timer is the moment your hands are wet and an egg is already going into the pan. Every figure here assumes a large, fridge-cold egg lowered into water that has reached a rolling boil, which is the condition most recipes leave unsaid and the reason they appear to contradict each other.',
        second='The difference between a runny yolk and a chalky one is about ninety seconds, so this is one of the few kitchen jobs where guessing does not work and a minute of inattention is visible on the plate. It is also the reason the mechanical egg timer outlived almost every other single-purpose kitchen gadget.',
        faq=[
            ('Do I start the timer before or after the water boils?',
             'After. The clock only means something once the water is at a rolling boil and the eggs are in it. Timing from the moment you switch the hob on measures your cooker rather than your eggs, and cookers vary by several minutes — which is most of the gap between a soft egg and a hard one.'),
            ('My eggs crack as they go in. What am I doing wrong?',
             'Usually the drop rather than the heat. Lower them in on a spoon rather than tipping them from the carton, and let very cold eggs sit out for a few minutes first so the shock is smaller. A cracked egg still cooks, it just leaks a white plume; a splash of vinegar in the water helps that set quickly.'),
            ('Why is the yolk grey around the edge?',
             'That ring is iron and sulphur reacting, and it means the egg was in the water too long or cooled too slowly. It is harmless and it is a timing signal: shorten the boil by a minute and get the eggs into cold water as soon as they come out.'),
            ('Does this work for a fried or poached egg?',
             'The timer does, the numbers do not. Poaching is roughly three minutes for a set white and a soft yolk, and frying depends on the pan more than the clock. Set those on the countdown timer rather than using the boiled-egg presets here.'),
        ],
        extra=EGG_EXTRA,
        presets=[
            dict(name='Soft', seconds=360),
            dict(name='Medium', seconds=480),
            dict(name='Hard', seconds=660),
        ],
        hint='Tap a preset and it starts immediately. Ends with an audible alarm, so keep this tab unmuted — and lift the eggs into cold water as soon as it rings.',
    ),
]


def duration_url(entry):
    return clean_url(entry["slug"])


# Chip text for the in-panel sibling row. Taken from the slug rather than
# computed from the seconds, because the slug is what the page is named for:
# 90-second-timer is ninety seconds, not a minute and a half.
_CHIP_UNITS = (("-second-timer", " sec"), ("-minute-timer", " min"), ("-hour-timer", " hr"))


def duration_chip(entry):
    for suffix, unit in _CHIP_UNITS:
        if entry["slug"].endswith(suffix):
            return entry["slug"][: -len(suffix)] + unit
    return "Egg"


def duration_chips(current_slug):
    """The preset family as real links, inside the countdown's own controls.

    A preset duration is a parameter of the countdown timer rather than a peer
    of it, so the fifteen pages cross-link from here and from one hub link in
    the toolbar sheet — never from the rail, and never from the sheet body.

    "Any length" leads back to the parent tool, so the row is a complete
    switcher from any member of the family including the tool itself.
    """
    items = [("/countdown-timer/", "Any length", current_slug is None)]
    items += [
        (duration_url(d), duration_chip(d), d["slug"] == current_slug)
        for d in DURATION_PAGES
    ]
    links = "\n".join(
        '          <li><a href="{url}"{cur}>{label}</a></li>'.format(
            url=url, label=label, cur=' aria-current="page"' if cur else ""
        )
        for url, label, cur in items
    )
    return """      <nav class="preset-chips" aria-label="Preset durations">
        <span class="preset-chips-label" id="preset-chips-label">Preset lengths</span>
        <ul aria-labelledby="preset-chips-label">
{links}
        </ul>
      </nav>
""".format(links=links)


def sibling_row(current_slug, limit=None):
    """Every other duration in the family, so the set cross-links itself."""
    others = [d for d in DURATION_PAGES if d["slug"] != current_slug]
    if limit:
        others = others[:limit]
    links = "\n".join(
        '        <a href="{url}">{short} →</a>'.format(url=duration_url(d), short=d["short"])
        for d in others
    )
    return links


def duration_page(entry):
    canonical_path = clean_url(entry["slug"])
    title = "{name} — Free Online Countdown, One Tap | clocklab.net".format(name=entry["name"])
    json_ld = (
        '{{"@context":"https://schema.org","@type":"WebApplication","name":{name},'
        '"url":{url},"applicationCategory":"UtilitiesApplication","operatingSystem":"Any (runs in browser)",'
        '"description":{desc},"offers":{{"@type":"Offer","price":"0","priceCurrency":"USD"}},'
        '"publisher":{{"@type":"Organization","name":"clocklab.net"}}}}'
    ).format(
        name=jstr(entry["name"] + " — clocklab.net"),
        url=jstr(SITE + canonical_path),
        desc=jstr(entry["description"]),
    )
    faq_ld = '{{"@context":"https://schema.org","@type":"FAQPage","mainEntity":{e}}}'.format(
        e=render_faq_jsonld(entry["faq"])
    )

    uses_html = ""
    if entry.get("uses"):
        uses_html = (
            "        <h3>What people set it for</h3>\n        <ul class=\"use-list\">\n"
            + "\n".join("          <li>{}</li>".format(u) for u in entry["uses"])
            + "\n        </ul>\n"
        )
    faq_html = "\n".join(
        "        <dt>{}</dt>\n        <dd>{}</dd>".format(q, a) for q, a in entry["faq"]
    )
    extra_html = entry.get("extra", "")

    body = """<body>
{chrome}
  <main id="main">
    <section class="panel">
      <div class="wrap">
        <div class="panel-head">
          <h1 tabindex="-1">{name}</h1>
          <a class="back-to-tools" href="/timers/">← All preset timers</a>
        </div>
        <p>{intro}</p>
{workspace}
        <p class="hint" style="margin-top:12px"><a href="?autostart=1">Open this page with the timer already running →</a> — handy as a bookmark, though your device only lets a page make a sound after you have tapped it at least once.</p>
      </div>
    </section>

    <section class="content-section" id="how-it-works">
      <div class="wrap">
        <h2>Why {short}</h2>
        <p>{second}</p>
{uses}      </div>
    </section>
{extra}
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
        <h2>Other preset timers</h2>
        <div class="related-links">
{siblings}
        </div>
        <div class="related-links" style="margin-top:12px">
          <a href="/timers/">All preset timers →</a>
          <a href="/countdown-timer/">Set any duration →</a>
          <a href="/pomodoro-timer/">Pomodoro timer →</a>
        </div>
      </div>
    </section>
  </main>
{footer}
  <script type="application/ld+json">{faq_ld}</script>
{scripts}
</body>""".format(
        chrome=chrome(canonical_path),
        name=entry["name"],
        short=entry["short"],
        intro=entry["intro"],
        second=entry["second"],
        workspace=countdown_workspace(
            seconds=entry["seconds"], preset=True, label=entry["name"],
            presets=entry.get("presets"), hint=entry.get("hint"),
            chips=duration_chips(entry["slug"]),
        ),
        uses=uses_html,
        extra=extra_html,
        faq=faq_html,
        siblings=sibling_row(entry["slug"]),
        footer=footer(),
        faq_ld=faq_ld,
        scripts=scripts_tail(),
    )

    html = "<!doctype html>\n<html lang=\"en\">\n" + head(
        title, entry["description"], canonical_path, json_ld
    ) + "\n" + body + "\n</html>\n"
    write_clean(entry["slug"], html)


def timers_hub():
    canonical_path = "/timers/"
    title = "Preset Timers — 5, 10, 20 Minutes and More | clocklab.net"
    description = "Every common timer length on its own page, already set and one tap from running: 30 seconds to 2 hours, plus a proper egg timer. Free and browser-only."
    json_ld = (
        '{{"@context":"https://schema.org","@type":"CollectionPage","name":{name},"url":{url},'
        '"description":{desc}}}'
    ).format(name=jstr("Preset Timers — clocklab.net"), url=jstr(SITE + canonical_path),
             desc=jstr(description))

    cards = "\n".join(
        """          <a class="tool-card" href="{url}">
            <span class="chip"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9.5V13l2.5 1.5"/><path d="M9 2h6"/></svg></span>
            <h3>{name}</h3>
            <p>{tagline}</p>
          </a>""".format(url=duration_url(d), name=d["name"], tagline=d["tagline"])
        for d in DURATION_PAGES
    )

    body = """<body>
{chrome}
  <main id="main">
    <section class="panel">
      <div class="wrap">
        <div class="panel-head">
          <h1 tabindex="-1">Preset timers</h1>
          <a class="back-to-tools" href="/" data-panel-link="">← All tools</a>
        </div>
        <p>The same countdown instrument, arriving with the time already dialled in. Each page is one tap from a running timer, keeps counting when the tab is in the background, and rings an alarm generated on the spot rather than downloaded. Nothing you set here leaves the tab.</p>
        <div class="tool-grid">
{cards}
        </div>
      </div>
    </section>

    <section class="content-section">
      <div class="wrap">
        <h2>Need a length that is not here?</h2>
        <p>The <a href="/countdown-timer/">countdown timer</a> takes anything up to 23 hours, 59 minutes and 59 seconds. These pages exist for the handful of durations common enough that typing them in every time is a nuisance — and because a page that already knows it is a five minute timer can say something useful about five minutes.</p>
        <p>For work intervals with breaks built in, the <a href="/pomodoro-timer/">Pomodoro timer</a> runs the whole cycle rather than a single stretch. For repeating rounds, the <a href="/interval-timer/">interval timer</a> handles work and rest phases with a set number of rounds.</p>
      </div>
    </section>
  </main>
{footer}
{scripts}
</body>""".format(chrome=chrome(canonical_path), cards=cards, footer=footer(), scripts=scripts_tail())

    html = "<!doctype html>\n<html lang=\"en\">\n" + head(
        title, description, canonical_path, json_ld
    ) + "\n" + body + "\n</html>\n"
    write_clean("timers", html)


# The countdown timer's own page carries the preset chips; the homepage's copy
# of the same instrument does not, because that panel ships `hidden` until its
# card is picked and links inside a load-gated container are display:none on
# arrival — a breakpoint-free way to hide fifteen URLs from a visitor.
TOOLS_BY_SLUG[VARIANT_PARENT]["page_workspace"] = countdown_workspace(
    chips=duration_chips(None)
)

for t in TOOLS:
    tool_page(t)

for d in DURATION_PAGES:
    duration_page(d)

timers_hub()

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
    cards.append(
        """          <a class="tool-card" href="/timers/">
            <span class="chip"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9.5V13l2.5 1.5"/><path d="M9 2h6"/></svg></span>
            <h3>Preset Timers</h3>
            <p>Five minutes, twenty minutes, an hour — already set, one tap.</p>
          </a>"""
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
{chrome}
  <main id="main">
    <section class="hero">
      <div class="wrap">
        <p class="eyebrow">Six instruments · one bench</p>
        <h1>Time, measured precisely.</h1>
        <p class="lede">A countdown timer, stopwatch, Pomodoro timer, alarm clock, interval timer and world clock — each built like a real instrument, with a tick-marked dial and a lit readout. Every second is computed from a real timestamp, not counted by hand, so nothing drifts. Nothing you set here ever leaves this tab. The countdown also comes ready-set on its own <a href="/timers/">preset timer pages</a> — five minutes, twenty minutes, an hour, a boiled egg.</p>
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
        chrome=chrome("/"),
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
{chrome}
  <main id="main">
    <section class="doc-page">
      <div class="wrap">
{content}
      </div>
    </section>
  </main>
{footer}
{scripts}
</body>""".format(chrome=chrome(canonical_path), content=body_html, footer=footer(), scripts=scripts_tail())
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
{chrome}
  <main id="main">
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
</body>""".format(chrome=chrome("/404.html"), footer=footer(), scripts=scripts_tail())
    html = "<!doctype html>\n<html lang=\"en\">\n" + head(title, description, "/404.html", json_ld) + "\n" + body + "\n</html>\n"
    write("404.html", html)


not_found_page()

# --------------------------------------------------------- root files --

write(FAVICON_PATH, FAVICON_SVG)
write("CNAME", "clocklab.net\n")
write("ads.txt", "google.com, pub-7560786263587509, DIRECT, f08c47fec0942fa0\n")
write(".nojekyll", "")
write(
    "robots.txt",
    "User-agent: *\nAllow: /\nSitemap: {}/sitemap.xml\n".format(SITE),
)

sitemap_urls = (
    ["/"]
    + [clean_url(t["slug"]) for t in TOOLS]
    + [clean_url("timers")]
    + [clean_url(d["slug"]) for d in DURATION_PAGES]
    + [clean_url("privacy"), clean_url("terms")]
)
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

print(
    "Generated {} tool pages + {} preset timer pages + the /timers/ hub "
    "(each dir + .html alias) + homepage + legal + meta files.".format(
        len(TOOLS), len(DURATION_PAGES)
    )
)
