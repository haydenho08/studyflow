# Stage 4: Calendar / week view

**Goal:** a calendar week view of deadlines (the app's new home page), with an overdue panel and one-click "done".

```
backend/app/routers/assignments.py   ?status= is now repeatable (todo OR in_progress)
frontend/src/
├── api/types.ts             query-filter types now GENERATED from the OpenAPI schema
├── api/client.ts            arrays become repeated query params
├── lib/calendar.ts          week days, group deadlines by *local* day, overdue (+ tests)
├── pages/CalendarPage.tsx   7-column week, overdue panel, checkboxes, week navigation
└── hooks/useElementWidth.ts measure a container so the SVG chart draws at real pixels
```

---

## 1. Good API design pays off later

The calendar needed almost nothing new from the backend. `GET /api/assignments?due_from=…&due_to=…` from Stage 1 already answers "what's due this week?", because the range was designed **half-open** (`[from, to)`): consecutive weeks tile perfectly, and a deadline at exactly midnight Monday belongs to exactly one week. The UI just asks for `[Monday 00:00 local, next Monday 00:00 local)`.

The one backend change was for the overdue panel, which needs "not done", meaning `todo` **or** `in_progress`. The options were:
- a special `?not_status=done` parameter (one-off, doesn't generalise),
- fetching everything and filtering in the browser (wasteful, and grows with history),
- **making `status` repeatable**: `?status=todo&status=in_progress` → `WHERE status IN (…)`.

The third is the standard REST convention, and it's **backwards-compatible**: every existing single-`status` request and test still works unchanged. That's the property you want from any change to a public API.

Two FastAPI details worth knowing (both verified with a tiny test app):
- A `list[...]` query parameter must be declared with `Query()`. Without it, FastAPI treats it as a request body, and the parameter is silently `None`.
- If a parameter is declared as a **single** value and the client repeats it, FastAPI silently keeps the **last** one.

### A debugging story that came out of that second point

The first time I loaded the calendar, the overdue panel was empty even though an overdue item existed. The browser's request was correct, and the same request from a terminal returned the item. The uvicorn log explained it: the dev server had started reloading after my `assignments.py` edit but hadn't brought up the new process yet, and a process still running the **old** code answered the request. The old code declared `status` as a single value, so `?status=todo&status=in_progress` quietly became `status=in_progress`: nothing overdue was in progress, so it returned `[]` with a `200`.

Lessons: (1) "works after a refresh" is a symptom to explain, not to ignore; (2) server logs with timestamps are how you explain it; (3) silent coercion (last value wins) turns version skew into wrong answers instead of errors. In production the same thing happens during a rolling deploy, when old and new servers briefly run side by side. That's why API changes should be backwards-compatible.

## 2. Generated types, one level further

In Stage 2 we generated *body* types from OpenAPI. Now the *query* types are generated too:

```ts
type QueryOf<Op extends keyof operations> = NonNullable<operations[Op]["parameters"]["query"]>;
export type AssignmentFilters = QueryOf<"list_assignments_api_assignments_get">;
```

Before, `AssignmentFilters` was hand-written and would have silently gone stale when `status` became a list. Now the compiler told me exactly which line (`toApiFilters`) needed updating. `client.ts` turns arrays into repeated parameters (`URLSearchParams.append`) and skips `null` and `undefined`.

> **Interview Q:** *"How do you evolve an API without breaking clients?"* Additive changes only (new optional params, widen a scalar to a list that still accepts one value), generated client types so mismatches fail at compile time, and backwards-compatibility tests.

## 3. Dates: the calendar half of the time-zone story

**Which day is a deadline on?** `due_at` is a UTC instant. "Lab due 23:59 Nov 2" is stored as `2026-11-03T04:59Z`; grouping by the UTC date would put it on the wrong day. `groupByLocalDay()` converts each instant to the **local calendar date** (`getFullYear/getMonth/getDate`, not `toISOString().slice(0, 10)`, which is the UTC date and a very common bug).

The tests use the week of **Oct 26–Nov 1, 2026**, which contains the end of daylight saving:
- 23:59 on Sun Nov 1 (after clocks fall back, UTC−5) stays on Sunday;
- exactly **00:00 Mon Nov 2** belongs to *next* week, which is the half-open rule again;
- `weekDays()` uses calendar arithmetic, so the 25-hour Sunday doesn't shift anything.

**Overdue without an infinite loop.** "Overdue" naively means `due_to = now`. But React Query keys include the filters, and `now` changes every render, so that would mean a new cache key on every render, which means a refetch, a re-render, and a new key again. The overdue query uses **start of today** instead, which changes once a day. Items due earlier *today* are still flagged overdue by `isOverdue(a, now)` in the day columns, computed at render time without any request.

> **Interview Q:** *"What should a React Query key contain?"* Exactly the inputs that change the result, and values that are stable across renders. Never a fresh timestamp or object identity.

## 4. The page

- **URL state again:** `?week=2026-10-26` (absent = this week), so the back button, refresh and bookmarks work. Any date is snapped to its Monday.
- **Home page:** `/` now redirects to `/calendar`, the "what's due?" view a student wants first.
- **One-click done:** each deadline's checkbox PATCHes `status`. React Query invalidation (Stage 2) refreshes the week, the overdue panel and the Assignments page together. The overdue panel vanishing when its last item is ticked needed no extra code.
- **Edit by deep link:** a deadline's title links to `/assignments?course=5&from=2026-10-27&to=2026-10-27`, reusing Stage 2's URL-driven filters instead of building a second edit form.
- **Visual priorities:** today's column is outlined; past days are dimmed; exams get a red edge and tag (the deadlines you least want to miss); done items are struck through; each day shows a count of *open* deadlines.
- **Semantics:** the week is an `<ol>` of days (it's an ordered sequence) and each day has an `aria-label` like "Tuesday, October 27: 1 deadlines, 1 open". Checkboxes are labelled "Mark "Lab 3 prelab" as done".

### Responsive: a different layout, not a squashed one

Seven columns need about 1100px. Below that, each column was about 100px and tags spilled out of their cards. So under 1100px the grid becomes a vertical **agenda** (one day per row), and on a phone, empty past days are hidden (`:has()` selector) because they're just scrolling.

Checking the phone width exposed two older bugs:
1. **The nav overflowed.** Stage 3 added two links and the top bar ran off the screen, making every page scroll sideways. On small screens the nav now gets its own wrapping row. I verified `scrollWidth == clientWidth` (375px) on all five pages.
2. **The study chart's text shrank to ~6px.** The SVG used a fixed `viewBox` and scaled to fit, so *everything* scaled, including 12px labels. Now the chart **measures its container** and lays out in real pixels, so text stays 12px at any width. When the columns get too narrow for their value labels ("1h 40m" needs about 46px), the labels are **dropped rather than allowed to collide**; the values remain in the tooltip and the table.

The measuring hook (`useElementWidth`) has two subtleties:
- It measures **synchronously in `useLayoutEffect`** (after layout, before paint) and then follows changes with a `ResizeObserver`. With `useEffect` alone, the first frame painted at the fallback width and then jumped. I saw exactly that state in testing (a 640px chart in an 870px box) before switching.
- **No feedback loop:** a child with a fixed pixel width can sometimes prop its container open so it can never shrink. I tested growing 301 → 870px and shrinking 870 → 301px without a reload.

> **Interview Q:** *"`useEffect` vs `useLayoutEffect`?"* `useLayoutEffect` runs synchronously after DOM mutation, before paint: use it to measure layout and avoid a visible flicker. Everything else belongs in `useEffect`, because layout effects block painting.

## 5. Testing summary

- **Backend:** 94 tests. The new one covers repeated `status` (OR) and status + date bound ("overdue"); every existing single-status test still passes, which is the backwards-compatibility check.
- **Frontend:** 57 unit tests. The new ones cover local-day grouping across the DST change, the midnight boundary, order within a day, and overdue/open counts.
- **In the browser:**
  - The calendar is the landing page; the DST week puts Sunday-night and Monday-midnight deadlines on the right days.
  - The overdue panel appears and disappears; checkboxes update the counts, the summary and the panel.
  - Deep links to Assignments work.
  - Week navigation uses the URL.
  - The agenda layout below 1100px.
  - No horizontal scroll on any page at 375px.
  - The chart re-measures when resized, with value labels dropped on phones.

## 6. Things deliberately left for later

- **Calendar subscription (.ics feed)** so deadlines show in Google/Apple Calendar. This needs a per-user secret feed URL, because calendar apps can't send our JWT. It would be a good security discussion: a capability URL, revocable, read-only scope.
- Month view, and drag-to-reschedule (PATCH `due_at` on drop).
- Showing study sessions as blocks in the day columns.
- Optimistic checkbox updates (it currently waits for the refetch; fast enough locally).
