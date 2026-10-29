# Stage 9: Grade tracker

**Goal:** for each course, answer the questions students actually ask: *what's my grade right now*, *what's the best and worst it can still be*, and *what do I need on the final to get an A?*

```
backend/app/grades.py                    the maths: Decimal, cautious rounding, York's letter scale
backend/app/routers/grades.py            GET /api/grades: every course's summary
backend/app/models/assignment.py         weight, score, out_of (Numeric) + CHECK constraints
backend/alembic/versions/…_0006_…        the three columns and four constraints
frontend/src/pages/GradesPage.tsx        a card per course: tiles, targets table, mark entry
frontend/src/lib/grades.ts               wording and number formatting
```

---

## 1. Grades live on deadlines

A grade item *is* a deadline: the midterm on the calendar is the midterm that's worth 30%. So instead of a separate "grade items" table, which would make students enter everything twice, each assignment gets three optional columns:

- `weight`: percent of the course (0 < w ≤ 100);
- `score` and `out_of`: the mark, e.g. 18 out of 20. Either both are set or neither is.

That fits well with Stage 8: a series of ten labs gets "5% each" in a single **This and following** edit. Marks are the exception. Like status, they're refused for a whole series (422) and entered one deadline at a time.

## 2. Exact decimals, end to end

Floats can't represent most decimals exactly: `0.1 + 0.2` is `0.30000000000000004`. For grades, a "you need 70%" that's secretly 69.9999 would be wrong in exactly the case that matters. So every step is exact:

- **Database:** `NUMERIC(5,2)` for weights and `NUMERIC(7,2)` for marks, not `REAL`.
- **Validation:** Pydantic `Decimal` fields with `decimal_places=2`, so "7.555" is a 422 instead of being silently rounded.
- **Maths:** `app/grades.py` is pure `Decimal` arithmetic.
- **Input:** the browser sends what was typed as a *string* ("18.5"), so it reaches `Decimal` without passing through a float.
- **Output:** results go out as plain JSON numbers (`81.25`), already rounded to two places, so the frontend only formats them.

## 3. The maths

For each graded item, points earned = weight × score ÷ out_of. An 18/20 on a 20% lab earns 18 points of the course.

| | Formula |
|---|---|
| So far | earned ÷ graded weight |
| Lowest final grade | earned ÷ total weight (zero on everything left) |
| Highest final grade | (earned + remaining weight) ÷ total weight (full marks on the rest) |
| Needed for a letter | (minimum × total − earned) ÷ remaining weight |

Each letter in **York's scale** (A+ 90, A 80, B+ 75, … E 40) is reported as:

- **Secured:** reached even with zero on the rest;
- **Possible**, with the average needed;
- **Out of reach:** not even with full marks.

When nothing is left to grade, there's no "needed", only secured or out of reach.

**Rounding is always cautious:**

- **Grades round down:** 89.996% shows as 89.99%, never as a misleading "90.00% · A". The letter is worked out from the unrounded value, so it always agrees with the number shown.
- **"Needed" rounds up:** two-thirds is 66.67%, not 66.66%. Getting the number the app shows is always enough.

**Weights that don't add up to 100%** (a course half set up) are scaled to what's been entered, and the page says so. That beats either crashing or pretending the missing 40% was zero.

## 4. Two layers of validation

- **Pydantic** rejects bad input with a readable 422: a weight of 0 or over 100, more than 2 decimal places, a negative score, an `out_of` of 0, or a score without what it's out of.
- **A partial `PATCH`** is checked *after* merging with what's stored. Sending only a new score is fine when `out_of` is already there, but clearing just one of the pair is refused, and the whole change is rolled back.
- **The database** has the same rules as CHECK constraints (`weight > 0 AND weight <= 100`, `(score IS NULL) = (out_of IS NULL)`, …). A test writes `weight = 150` straight through SQLAlchemy and expects Postgres to refuse it. Autogenerate doesn't detect CHECK constraints, so the migration lists them by hand.

## 5. Computed, never stored

`GET /api/grades` works the summary out from the marks on every request. There's no cached "current grade" column that could fall out of date. The frontend's query is invalidated by every assignment change (create, edit, delete, series edits) and by deleting a course.

## 6. The page

- A card per course with two tiles (**So far** "80.25% · A", and **Final grade will be** "32.1% – 92.1%"), a notice if the weights don't add up to 100%, and a table of every letter grade against what you need on the remaining X%.
- Below it, each weighted deadline with a score / out-of editor. Saving sends only the mark, and the summary refreshes.
- Weights are set where deadlines are edited (the assignment form has **Weight (% of course)**, **Mark** and **Out of**), and the assignment list shows "5% of grade".
- The demo account now has two fully weighted courses, one half set up (so the notice shows) and one with no weights.
- Adding a sixth navigation item meant the account email no longer fit on narrower laptops. Below 1120px it's hidden, and the account button keeps its icon and menu.

## 7. Tests

- **Backend (35 new):**
  - The maths: a worked example; "needed" rounding up (66.67, not 66.66); grades rounding down with the letter agreeing; exact `0.1 + 0.2`; nothing graded; everything graded; no weights; weights not adding up to 100; bonus marks; York's boundaries.
  - The API: numbers in JSON; 7 validation cases; entering, correcting and clearing a mark; a rejected change rolling back; the database refusing a bad weight; series sharing a weight but not a mark; the course summary; per-user isolation; login required.
  - The demo has grades to show.
- **Frontend (8 new unit tests):** percent formatting, target wording, and typed text to decimal.
- **End-to-end (1 new):** set a weight through the form, check "75% · B+", "30% – 90%" and an A needing 83.34% (rounded up), then enter the final's mark and watch it become "84% · A" with the A secured.
