# Stage 6: Calendar feed and end-to-end tests

**Goal:** get deadlines into the calendar students already check (Google, Apple, Outlook), and test the whole app the way a user meets it: in a real browser, against the real server and database.

```
backend/app/ics.py                      iCalendar rendering: escaping, folding, events
backend/app/routers/calendar.py         turn the feed on / replace / off, and serve it
backend/alembic/versions/…_0003_…       users.calendar_token (unique, nullable)
frontend/src/components/CalendarFeedButton.tsx   "Subscribe" dialog on the Calendar page
frontend/playwright.config.ts           starts FastAPI serving the built app, runs e2e/
frontend/e2e/*.spec.ts                  12 browser tests (two also on a phone layout)
.github/workflows/ci.yml                new "End-to-end (Playwright)" job
```

---

## 1. The calendar feed

Calendar apps subscribe to a URL and re-fetch it every few hours. That shapes everything else.

### The URL is the credential

A calendar app can't log in or send an `Authorization` header, so the feed URL carries a secret: `/api/calendar/<token>.ics`. It works the same way as Google Calendar's own "secret address in iCal format".

- **Unguessable:** `secrets.token_urlsafe(32)`, 256 bits from the OS's secure random source. Guessing one is not a realistic attack.
- **Revocable:** "Make a new link" replaces the token, and the old URL stops working at once. "Turn off" deletes it. This is the answer to "what if the link leaks?".
- **Read-only, and separate from the login token.** A leaked feed URL shows deadlines; it can't change anything or log anyone in. The JWT is never put in a URL, where it would end up in server logs and browser history.
- **404 for every bad token**: unknown, replaced or switched off all look the same, like a feed that never existed. This follows the API's "404, not 403" rule.
- **Off by default.** Nothing is exposed until the student asks for it.
- **Response headers:** `Cache-Control: private, no-cache` (no shared cache keeps a copy; apps always revalidate) and `X-Robots-Tag: noindex` (if the URL ever gets posted somewhere, it stays out of search results).
- **The demo account** clears its token whenever its data is rebuilt, so one visitor's feed URL doesn't keep showing the next visitor's changes.

*Considered:* storing only a hash of the token, as for passwords. Then the URL can be shown only once, and adding the calendar on a second device would mean replacing the link and breaking the first. For a read-only, revocable link to a list of deadlines, I chose being able to show the URL again. The trade-off is that someone who could read the database could read deadlines through it, but they could read the deadlines table directly anyway.

### A bug pytest caught: a NUL byte

One test requested `/api/calendar/%00.ics`, and it crashed with a 500: Postgres refuses strings containing a NUL character, and the token went straight into the query. The route now looks up only strings shaped like real tokens (43 base64url characters) and returns a 404 for everything else without touching the database. Same lesson as Stage 1's validation: decide what valid input looks like at the edge.

### Writing iCalendar by hand (`app/ics.py`)

RFC 5545 is long, but a deadline feed needs only a few properties. The rules that actually break feeds are small enough to own and unit-test:

- **Escaping:** `\`, `;`, `,` and newlines in TEXT values. Backslashes are escaped first, otherwise the backslashes added for the others get doubled.
- **CRLF line endings**, on every line, including the last one.
- **Folding at 75 *bytes*, not characters.** A long title is wrapped onto continuation lines that start with a space. "é" is two bytes in UTF-8, so counting characters would produce lines that are too long, and a character must never be split across two lines. A test folds a title of 100 "é"s and checks both rules.
- **Times in UTC** (`DTSTART:20261102T220000Z`). The database already stores UTC, so the feed has no time zone definitions, and each calendar app shows the time in its user's zone.
- **A deadline is a moment, not a block:** `DTSTART` with no `DTEND` means "ends when it starts". `TRANSP:TRANSPARENT` keeps it from showing the student as busy.
- **Stable `UID`s** (`assignment-42@studyflow`): when a deadline moves, apps update the existing event instead of adding a second one.
- Done deadlines get a ✓ in the title instead of disappearing, so the calendar still shows what was due.
- **Deadlines older than 180 days** are left out, so a feed doesn't grow forever.

### The dialog

"Subscribe" on the Calendar page opens a native `<dialog>`, like the delete confirmations. It shows the link with Copy (falling back to selecting the text if the clipboard isn't available), plus **Add to Google Calendar** (Google's "add by URL" page, already filled in) and **Add to Apple or Outlook** (a `webcal://` link, which opens the system calendar app's subscribe prompt). Replacing or turning off the link asks first, because either one breaks existing subscriptions. The feed's state is fetched only when the dialog opens, and the mutations write their result straight into React Query's cache, so nothing refetches.

## 2. End-to-end tests (Playwright)

Unit tests cover the logic, and API tests cover the backend. Neither shows that the pieces work together in a browser, which is what a user actually meets.

### Production-shaped

`npm run test:e2e` builds the frontend, then Playwright's `webServer` starts **FastAPI serving the built app**, the same way the Docker image runs it, on a real Postgres. So the tests also cover routing fallbacks, asset serving and same-origin API calls, which the Vite dev server would have hidden. `E2E_BASE_URL` points the tests at servers that are already running instead.

### Independent tests

Every test **signs up its own fresh account** (`e2e/fixtures.ts`). So tests run in parallel (8 workers), in any order, against any database, with no cleanup step. Only the sign-up test signs up through the UI; the rest sign up through the API before the page loads, so each test spends its time on what it's actually testing. (Since [Stage 7](stage-7.md), that means the login's refresh cookie is already in the browser, as for a returning user.)

### What they cover

- **Sign-up** from the front page, landing on the calendar, then logging out. This one also runs on a **phone layout** (Pixel 7 viewport, bottom tab bar).
- A logged-out deep link to `/stats` sends you to log in, then back to `/stats`.
- A wrong password gets the generic error.
- The **demo button**, on desktop and phone.
- **Course → deadline → calendar**: it appears on the right day at the right time, gets ticked off, and stays ticked after a reload. The test jumps with `?week=`, so it works even when "tomorrow" is in next week.
- **Filters** live in the URL and survive a reload.
- **Deleting a course** asks first; Cancel really cancels, and confirming takes the course's assignments with it.
- **A full 25-minute Pomodoro** with a fake clock (`page.clock`): 25 minutes pass in an instant, the block is saved, and it shows in the stats. The clock starts 40 minutes in the past, because the API rejects sessions that end in the future, so a real-time fast-forward would end 25 minutes from now and be refused.
- **Finishing early** saves only the time spent.
- **The calendar feed's lifecycle**: get a link, fetch it like a calendar app would (no login), replace it (the old URL is now 404), turn it off (the new one is 404 too).

### What the first runs found

- **A real accessibility bug.** On phones the "Log out" button hides its text to save space, which left an icon-only button with **no accessible name**. A screen reader would announce just "button", and the test couldn't find it by name either. Fixed with `aria-label`.
- Two test mistakes worth knowing about:
  - `getByLabel("Due")` also matched the filter bar's "Due from" and "Due to". Locators are now scoped to the form.
  - `check()` failed because the checkbox flips only once the server confirms the save. The test now waits for the saved state, which is the more honest assertion anyway.
- The suite then passed **36 of 36** runs with `--repeat-each 3`, with no flakes.

### In CI

A fourth job, alongside backend, frontend and Docker:
1. Start Postgres 16.
2. Install the Python runtime dependencies, `npm ci`, and Playwright's Chromium.
3. Run `alembic upgrade head` on the empty database, which means the e2e tests also run on a schema built purely from migrations.
4. Run `npm run test:e2e`.

On a failure it uploads the HTML report, with a **trace** (DOM snapshots, network and console for every step) and a screenshot of each failing test. CI retries once, so a single flaky run doesn't block a deploy, and the report still flags any test that needed the retry. Locally, the tests drive the installed Edge, as the screenshot script does, so there's no extra browser download.
