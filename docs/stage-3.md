# Stage 3: Study timer + stats

**Goal:** a Pomodoro timer that logs focused study time per course, and a weekly stats page with charts.

```
backend/
├── app/models/study_session.py     StudySession(course_id, started_at, ended_at) + CHECK constraint
├── app/schemas/study.py            create/read schemas, cross-field validation, WeekStats shape
├── app/routers/study_sessions.py   POST / GET / DELETE /api/study-sessions (+ overlap check)
├── app/routers/stats.py            GET /api/stats/week?start=YYYY-MM-DD&tz=America/Toronto
├── alembic/versions/…_0002_add_study_sessions.py
└── tests/test_study.py             25 tests: validation, overlaps, privacy, cascade, timezone buckets, DST
frontend/src/
├── lib/pomodoro.ts      timer as pure functions of (state, now) + localStorage persistence
├── lib/week.ts          Monday-based weeks, durations, browser time zone
├── lib/colors.ts        validated course palette, OKLab distance, dark-mode steps
├── lib/chart.ts         "nice" axis ticks, rounded-top column path
├── lib/chime.ts         Web Audio chime (no sound file)
├── timer/TimerContext.tsx   app-wide timer: transitions, logging, tab title
├── components/WeekChart.tsx hand-built SVG stacked columns + tooltip
└── pages/StudyPage.tsx, StatsPage.tsx
```

---

## 1. Data model: store facts, derive everything else

A study session is two timestamps and a course: `started_at`, `ended_at`, `course_id`. There is deliberately **no `duration` column**. Duration is computed (`ended_at - started_at`) in the response schema with Pydantic's `@computed_field`, and in SQL for the stats. A stored duration could disagree with the timestamps; a derived one can't.

The same pattern as Stage 1 continues:
- **Ownership through the course** (no `user_id`), so every query joins `courses` and filters by the current user. `get_owned_session()` joins the `ownership.py` family.
- **`ON DELETE CASCADE`**: deleting a course deletes its study time (tested), and the frontend invalidates sessions + stats when a course is deleted.
- **A `CHECK (ended_at > started_at)` constraint** named via the naming convention. The API validates this too, but the database is the last line of defence against any code path, including a future bug, that bypasses the API.
- **Composite index `(course_id, started_at)`** serves both "this course's sessions in a range" and the stats query.

**Migration workflow, done properly this time:** with the database running, `alembic revision --autogenerate` produced the migration; I **reviewed it** (autogenerate can miss things like renamed columns or server defaults), then tested it both directions (`upgrade → downgrade → upgrade`), then ran `alembic check` to confirm no drift. Migrations that have never been downgraded are migrations you can't trust to roll back in an incident.

> **Interview Q:** *"Should you store derived values?"* Only as a measured optimisation (a cache or materialised view), and then you own keeping it consistent. Default to deriving.

## 2. Validation that spans fields

Single-field rules (`AwareDatetime`, `course_id: int`) live on fields. Rules that compare fields need a **`@model_validator(mode="after")`**, which sees the whole object:

- at least 1 minute, at most 12 hours
- not ending in the future, **with a 2-minute allowance for clock skew** (the client's clock is never exactly the server's)

### Overlap detection

You can't study two things at once, so a new session that overlaps *any* of your sessions (on any course) gets **409 Conflict**. The classic interval-overlap test:

```
A and B overlap  ⇔  A.start < B.end  AND  A.end > B.start
```

Strict `<` means back-to-back Pomodoros (one ends 10:25, the next starts 10:25) are fine; there's a test for exactly that. This rule also makes logging **naturally idempotent**: if the timer ever tried to log the same block twice (two tabs, a retry), the second attempt is a harmless 409, not a duplicate.

**Honest limitation:** it's check-then-insert, so two simultaneous requests could both pass the check. The airtight version is a Postgres **exclusion constraint** (`EXCLUDE USING gist (user_id WITH =, tstzrange(started_at, ended_at) WITH &&)`), which needs `user_id` on the row and the `btree_gist` extension, i.e. the denormalisation we avoided in Stage 1. For one student's timer, the race is theoretical, so I documented the trade-off rather than paying for it.

> **Interview Q:** *"How would you prevent overlapping bookings?"* Interval overlap condition → app-level check → exclusion constraint for true concurrency safety. Knowing the third option is what makes the answer senior.

## 3. Weekly stats: whose Monday?

"How much did I study on Monday?" depends on **where you are**. 22:00 Monday in Toronto is 02:00 Tuesday in UTC. So the client sends its IANA time zone (`Intl.DateTimeFormat().resolvedOptions().timeZone` → `America/Toronto`) and the server buckets in that zone:

```python
local_day = cast(func.timezone(tz, StudySession.started_at), Date)      # SQL: timezone('America/Toronto', started_at)::date
seconds   = func.sum(func.extract("epoch", StudySession.ended_at - StudySession.started_at))
... .group_by(local_day, StudySession.course_id)
```

- **Aggregation happens in SQL** (`SUM`, `COUNT`, `GROUP BY`); Python only reshapes the rows and fills in zero days, so every response has exactly 7 days and the chart has no gaps. Pulling every session into Python to add them up would work at student scale and fall over at real scale.
- **The time zone is validated** with Python's `zoneinfo` before it reaches SQL: unknown zones and junk like `../../etc/passwd` get a 422 (tested). It's also passed to Postgres as a bound parameter, never formatted into the SQL string.
- **`tzdata` is now a dependency**, because Windows has no system time zone database and `zoneinfo` needs one.
- A session is counted on the day it **started** (a 23:30 to 00:20 session counts toward the earlier day), a simplification that's documented in the endpoint's docstring.

### The DST test, and a lesson about my own test

The week window is local midnight to local midnight, built with `datetime.combine(day, time.min, tzinfo=ZoneInfo(tz))`. The week of 2–8 March 2026 contains the spring-forward change, so it's 167 hours long. The test logs one session late Sunday (inside the week) and one at 00:30 Monday (outside it).

Then I checked that the test actually *catches* the bug it's meant to catch (mutation testing again):
- First I swapped in `week_start + timedelta(hours=168)` and **the test still passed**. That surprised me until I remembered that in Python, adding a `timedelta` to a ZoneInfo-aware datetime is **wall-clock arithmetic**: it lands on local midnight anyway. My "bug" wasn't a bug.
- The real bug is doing the arithmetic in UTC: `week_start.astimezone(UTC) + timedelta(hours=168)`. With that, the test failed as it should. The test comment now names exactly which mistake it guards against.

Also: my own first expectation in the UTC-bucketing test was wrong. A session at 23:00 Sunday Toronto moves *into* the week when bucketed in UTC (it's 03:00 Monday UTC). The test failure taught me the data was right and I was wrong, which is the best kind of failing test.

> **Interview Q:** *"How do you handle aggregating time-series data across time zones?"* Store UTC; bucket in the viewer's zone at query time; validate the zone; test a DST week.

## 4. The timer: timestamps, not ticks

The naive timer is `setInterval(() => setSeconds(s => s - 1), 1000)`. It's wrong in three ways:
1. **Drift.** Intervals fire late, never early, and the error accumulates.
2. **Background throttling.** Browsers slow timers in hidden tabs, so a 25-minute Pomodoro in a background tab could take much longer.
3. **Sleep and refresh.** Close the laptop or reload, and the countdown is gone.

StudyFlow stores **when the block started** and computes `remaining = startedAt + duration − now` on every render. The interval only triggers re-renders; if it fires late, the display catches up instantly and never drifts. All of this is pure functions in `lib/pomodoro.ts`, so it's unit-tested without fake timers.

Consequences of that one decision:
- **Survives refresh.** The state (`phase`, `courseId`, `startedAt`, `durationMs`) is saved to localStorage and validated when it's read back. Stored data is untrusted input, same as URL parameters in Stage 2.
- **Logs the *planned* block.** If you come back an hour late, the session is logged as exactly 25:00 from the true start, and the break starts when focus was *due* to end, not when it was noticed.
- **Tested in the browser:** I rewound a running timer's `startedAt` to 4 seconds before its end and reloaded. It finished on its own, the API received exactly one `POST` with `duration_seconds = 1500`, and it moved into a 5-minute break.

### React details worth knowing

- **App-wide provider.** The timer lives in `TimerProvider`, above the routes, so it keeps running, logging and updating the **tab title** (`"12:34 · Focus · StudyFlow"`) on any page. A pill in the top bar links back to it.
- **Effects must be idempotent.** In development, React StrictMode deliberately runs effects twice to expose bugs. The "focus finished → log it" effect remembers which block it handled (`handledRef = startedAt`), so it can never log the same block twice. (And if it somehow did, the server's overlap check would return 409.)
- **Cross-tab sync.** The `storage` event keeps two open tabs showing the same timer.
- **Logout clears the timer,** like the query cache, so the next person on that browser can't log time against the previous user's courses.
- **Failure is visible.** If saving fails (offline, or a 409), the session is kept and the card offers *Retry saving* / *Dismiss* instead of silently losing your study time.
- **Browser autoplay policy.** Audio only plays after a user gesture, so the `AudioContext` is created in the *Start* click handler and reused for the chime 25 minutes later. The chime is two Web Audio oscillator notes, so there's no sound file to ship.
- No pause button: deliberate. Pomodoro discourages pausing, and pause would turn one interval into a list of intervals. *Finish early* (saves if ≥ 1 min) and *Discard* cover the real needs.

## 5. Charts: built by hand, checked by numbers

The stats page is stat tiles (Total, Daily average, Best day, Most studied), a **stacked column chart** of minutes per day by course, per-course bars, and a **table view** of the same numbers.

**Why hand-rolled SVG instead of a chart library?** One chart type, full control over the details below, about 150 lines I can explain line by line, and no extra 100 kB dependency. With a dozen chart types I'd reach for a library.

Design rules applied (from a data-viz checklist, with the colour part *computed*, not eyeballed):
- **Thin columns** (≤ 24px) with a **4px rounded data end** and a square baseline; a **2px surface-coloured gap** between stacked segments instead of outlines; **hairline gridlines**; "nice" tick values (0 / 30m / 1h / 1h 30m, from `timeTicks()`).
- **Stack order and colour follow the course, never its rank.** A course sits in the same position with the same colour every day.
- **Colour is never the only cue.** There's a legend, the day total on each column cap, a per-day tooltip listing every course, and a full **table view** readable without colour, hover or sight. Columns are keyboard-focusable with `aria-label`s ("Tuesday 20 Oct: 1h 40m"), and focus shows the same tooltip as hover. The hover target is the whole day band, not the thin bar.
- **Text is never drawn in the series colour,** only in text colours; the colour lives on the marks.
- The tooltip sits **beside** the column so it doesn't hide the bar you're asking about. (The first version covered it; I fixed that after looking at a screenshot.)

### Course colours: a bug the chart exposed

Every course used to default to the same blue, which makes a stacked chart useless. Now:
1. New courses default to an **8-colour categorical palette**, in fixed order. I ran a validator over it against *our* surfaces: light mode passes colour-blind separation and lightness checks (three colours are under 3:1 contrast, which is why the labels and table matter); in dark mode the same light values **failed** the lightness band, so dark mode shows each palette colour's **dark-surface step** (`displayColor()`), which passes everything.
2. Then the real chart showed my test user's EECS (old default `#3B82F6`) and PHYS (palette `#2A78D6`) as **near-identical blues**. "Skip colours already in use" wasn't enough. Two different hex values can look the same. The fix measures **perceptual distance in OKLab** (a colour space where straight-line distance ≈ perceived difference) and skips any palette colour within ΔE 15 of a colour in use. For that user, it now suggests aqua: blue is too close to EECS, and orange too close to MATH's red.

> **Interview Q:** *"How do you make charts accessible?"* Never colour alone (labels, legend, table); keyboard and screen-reader access to the values; colours checked for colour-blind separation and contrast against the actual background, in both themes.

## 6. Testing summary

- **Backend:** 93 pytest tests (25 new). Session validation (naive, backwards, zero, < 1 min, > 12 h, future), overlaps incl. across courses and back-to-back, privacy (Bob can't see, delete or overlap-collide with Alice), cascade, stats totals, local-day bucketing, UTC vs Toronto, DST week, empty week, bad zones.
- **Frontend:** 52 Vitest tests (31 new). Pomodoro maths, clock formatting edge cases, Monday-of-week across month and DST boundaries, tick generation, palette selection including the near-duplicate case.
- **In the browser:** start → countdown/title/pill; a reloaded, rewound timer completes and logs exactly once; skip break; finish early (the 409 overlap shown with Retry/Dismiss); log a past session, then the same again → 409; new courses get distinct colours; minimal PATCH on recolour; chart, tooltip (hover and keyboard), table, week navigation via URL; light and dark themes.

## 7. Things deliberately left for later

- Exclusion constraint for concurrency-proof overlap prevention (§2).
- Splitting sessions that cross midnight across both days.
- Browser notifications when a block ends (needs a permission prompt; title + chime cover it for now).
- Streaks, goals, longer-range trends (the weekly endpoint is the building block).
- Automated end-to-end tests of the timer (Stage 5, Playwright with a mocked clock).
