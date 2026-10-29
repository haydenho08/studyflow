# Stage 8: Repeating deadlines

**Goal:** "Lab every Friday at 23:59 for 10 weeks" as one form, not ten. Each deadline can still be ticked off on its own, and you can change or delete **only this one** or **this and following**, as in Google Calendar.

```
backend/app/recurrence.py               the weekly rule, numbering, wall-clock shifts (pure functions)
backend/app/routers/assignments.py      POST /series, PATCH and DELETE /{id}/following
backend/alembic/versions/…_0005_…       assignments.series_id (UUID, indexed)
frontend/src/lib/recurrence.ts          the form's choices -> the API's RepeatRule, and its summary
frontend/src/pages/AssignmentsPage.tsx  "Repeats weekly" on the form; scope choice on edit/delete
frontend/src/components/ConfirmDialog.tsx   useChoose(): the dialog with several answers
```

---

## 1. Store occurrences, not rules

There are two ways to model a repeating deadline:

- **Store the rule** and work out the occurrences whenever someone asks. Every feature then needs special cases. Filters and date ranges have to expand rules first; ticking off one week needs an "exceptions" table; the stats, the calendar and the .ics feed each have to learn about rules.
- **Expand the rule once, when it's created,** into ordinary assignment rows that share a `series_id`. That's what StudyFlow does.

With real rows, every existing feature just works: each deadline has its own status, filters, the week calendar, the feed and the overdue warning. Nothing about the old code changed. The price is that a series has to end, so the expansion is finite: at most **52 deadlines, within a year**. For students, whose courses are 12–14 weeks long, that's no limit at all.

The rule isn't stored, because nothing needs it later. "This and following" only needs the series id and the due-date order. A `series_id` UUID column (indexed) is the whole schema change, and nothing can be left orphaned.

## 2. The rule

`POST /api/assignments/series` takes a normal assignment (its `due_at` is the first deadline) plus:

```json
"repeat": { "weekdays": [1, 3], "every_weeks": 2, "count": 8, "time_zone": "America/Toronto" }
```

- **Weekdays** use Monday = 0, matching Python's `date.weekday()`. More than one is allowed, for Tuesday/Thursday tutorials.
- **Every 1–4 weeks.** Weeks run Monday to Sunday, counted from the week of the first deadline.
- **Ends** after `count` deadlines (2–52) or on an `until` date (inclusive). Exactly one of the two, enforced by a Pydantic `model_validator`.
- **The first deadline must be on one of the repeat days.** Otherwise `due_at` wouldn't be the first deadline, which would be surprising. The form always includes that day and shows it locked on.
- **`{n}` in the title** is numbered: "Lab {n}" becomes Lab 1, Lab 2, Lab 3…

## 3. Time zones, again

A rule like "Friday at 23:59" only means something in a particular place, which is why the request carries a `time_zone`. The expansion works on **wall-clock times in that zone**:

- Toronto's clocks go back on 1 November, so the first Friday lab is due at 03:59 UTC and the later ones at 04:59 UTC. All of them say 23:59 on the student's calendar. Adding `timedelta(weeks=1)` to a UTC time would have moved every lab after 1 November to 22:59.
- `until` is a date in the student's zone: a 23:59 deadline on the last day still counts, even though it's already the next day in UTC. There's a test for that.
- A time the clocks skip (02:30 on the spring-forward night) comes out at 03:30, which is what wall clocks do too.

## 4. This and following

- **`PATCH /api/assignments/{id}`** (unchanged) edits one deadline. It stays in its series.
- **`PATCH /api/assignments/{id}/following?tz=…`** applies the same change to this deadline and every later one in the series.
  - A new `due_at` moves each one by the same **wall-clock** change. Moving Lab 2 from Friday 23:59 to Monday 09:00 moves Lab 3 and Lab 4 to their Mondays at 09:00, even across a DST change. `tz` says which wall clock is meant.
  - A new title with `{n}` is numbered by position in the whole series, so "Lab {n}: report" from Lab 2 onwards gives "Lab 2: report", "Lab 3: report"…
  - **Status can't be set this way** (422): whether something is done is decided one deadline at a time.
  - Moving them to another course checks that the course is yours (404 otherwise), like every other route.
- **`DELETE /api/assignments/{id}/following`** deletes this deadline and the later ones; the earlier ones stay.
- On a one-off deadline, "following" means just that one deadline.
- Every lookup joins through the course to the logged-in user, so another user's series gets a 404, as everywhere else.

*Why separate routes instead of `?scope=following`?* The two return different things (one assignment, or a list), and a response shape that depends on a query parameter is hard to type. Separate routes keep the OpenAPI schema, and so the generated TypeScript types, honest.

## 5. The UI

- The new-assignment form has a **Repeats weekly** section with weekday toggles (`aria-pressed` buttons), "every N weeks", and "ends after N deadlines / on a date". A live summary reads "Every 2 weeks on Tue and Thu, until Fri, Dec 4", plus the `{n}` tip.
- Deadlines in a series show a **Repeats** tag.
- Saving an edit to one of them, or deleting one, asks **Only this one** or **This and following**. The confirm dialog grew a `useChoose()` alongside `useConfirm()`: the same native `<dialog>`, with several answers instead of one. Cancel is still focused first, so pressing Enter never deletes anything.
- The browser doesn't repeat the expansion logic. It only describes the rule; the server is the one place that turns it into dates.

## 6. Tests

- **Backend (37 new):**
  - The rule, as pure functions: wall-clock times kept through the November DST change, several days every other week, `until` inclusive and measured in the student's zone, the skipped hour in March, and every error (wrong first day, ending before starting, too long, too many).
  - Numbering and wall-clock shifting across DST.
  - The API: creating a series (titles, UTC due dates, one shared id); 10 kinds of invalid rule; another user's course; editing one deadline vs this-and-following; moving a series across DST; status refused for "following"; time zone required; course moves (yours and someone else's); deleting this-and-following; "following" on a one-off; and other users getting 404s.
- **Frontend (9 new unit tests):** weekday numbering (including late Friday, which is Saturday in UTC), the first day always included, count *or* until in the rule, and the summary text.
- **End-to-end (1 new):** create "Lab {n}" ×3 through the form, rename from Lab 2 onwards with "This and following", then delete just Lab 3.
