# Stage 5: Polish, CI, and going public

**Goal:** make the project safe to publish, automatically checked on every push, and presentable to a recruiter in 30 seconds.

```
.github/workflows/ci.yml         two parallel jobs: backend + frontend
backend/ruff.toml                lint + format rules
frontend/eslint.config.js        typescript-eslint + React Hooks rules
backend/scripts/seed_demo.py     demo account with data relative to "this week"
frontend/scripts/screenshots.mjs Playwright (driving the installed Edge) → docs/screenshots/
README.md                        screenshots, highlights, architecture, setup
```

---

## 1. Before publishing: what actually goes public

A public repo is effectively permanent: it gets cloned, forked and indexed quickly, so "delete it later" doesn't work. Before the first push I scanned what would be published:

- **Secrets.** `.env` was never committed (checked across *all* history, not just the current tree: `git log --all --name-only`). Only `.env.example` is tracked, with obvious dev placeholders. CI uses its own throwaway `JWT_SECRET_KEY` defined in the workflow, which is fine because it protects nothing real.
- **Test credentials.** Not in any tracked file (`git grep`).
- **Identity.** Every commit carries its author email, publicly and permanently. GitHub offers a private `…@users.noreply.github.com` address that still counts on the contribution graph; you must decide before the first push, because changing it afterwards means rewriting published history.

> **Interview Q:** *"What would you do if you committed a secret?"* Rotate it immediately (assume it's compromised the moment it's pushed), *then* clean history (`git filter-repo`) and force-push. Cleaning history alone isn't enough, because clones and caches already have it.

## 2. Continuous integration

`ci.yml` runs on every push to `main` and every pull request, as two **parallel jobs**:

| Backend job | Frontend job |
|---|---|
| Real **Postgres 16** as a service container (with a health check) | `npm ci`: install *exactly* the lockfile, fail if it's out of sync |
| `ruff check` + `ruff format --check` | Regenerate `schema.ts` → `git diff --exit-code` (stale types fail) |
| Create the test DB | ESLint |
| `alembic upgrade head` → `alembic check` → `downgrade base` → `upgrade head` | Vitest (60 tests) |
| pytest (94 tests) | `tsc --noEmit` + `vite build` |
| Re-export `openapi.json` → `git diff --exit-code` | |

Design points worth explaining:
- **Same database as production, not SQLite.** The tests rely on `timestamptz`, CHECK constraints and FK cascades; a different engine would let the bugs that matter through.
- **Migrations are tested both directions** on every push. A down-migration that's never run is a down-migration that won't work in an incident.
- **Generated-file freshness checks.** The API contract flows Pydantic → `openapi.json` → `schema.ts`. CI regenerates both and fails on any diff, so the committed contract can't silently drift from the code.
- **`concurrency` with `cancel-in-progress`:** a new push cancels the now-pointless run for the previous commit.
- **`permissions: contents: read`:** least privilege for the workflow token.
- **Dependency caching** keyed on `requirements*.txt` / `package-lock.json`, so cache invalidation follows the lockfiles.

The first run on GitHub passed (backend 35 s), which is what dry-running every step locally before pushing buys you.

> **Interview Q:** *"What does your CI check, and why each step?"* Walk through the table: each step catches a specific class of bug that has a story behind it in the earlier stages.

## 3. Linters, and what they found

**Ruff** (Python lint + format) reformatted 10 files and flagged long lines and import order. One configuration lesson: Ruff guessed `alembic` was *our* package because the repo has a local `alembic/` folder, and sorted the library import in with ours. `known-third-party = ["alembic"]` fixed it. Hand-aligned data tables use `# fmt: off/on`, the standard escape hatch.

**ESLint** with the React Hooks rules found a **real design smell** in the timer. "Focus finished → log it → start the break" lived in an effect that *reacted to* state (`now`) and then set more state. That's an extra render pass per transition, and exactly what React's "You might not need an effect" warns about. The fix moved the transition into the **interval callback**: the clock tick is the external event, and subscribing to external events is what effects are for. The guard against double-logging (`handledRef`) stayed, because two ticks can still land before React re-renders.

> **Interview Q:** *"When should you use `useEffect`?"* To synchronise with something *outside* React (timers, subscriptions, the DOM, the network). Not to derive state from other state, and not to respond to events you could handle in the event handler itself.

## 4. A bug found by accident: the expiring token

While re-testing the timer refactor in the browser, my 60-minute JWT **expired**. The app correctly logged out, and logout correctly cleared the running timer (Stage 3 added that so the next person on a shared computer can't log time to your courses). Put together, though: **a Pomodoro that crosses the token's expiry was silently thrown away.**

The fix makes the policy precise:
- the timer is tagged with its owner's `userId`;
- **token expiry** (a 401) keeps it; after logging back in, *the same user* gets it back, and a block that finished meanwhile is logged with its planned times;
- **pressing "Log out"** (deliberate) clears it;
- `loadTimer(userId)` ignores a timer belonging to anyone else, or in an older format.

Verified in the browser: a dead token → `/login` with the timer kept → log in → exactly one `POST` (`1500 s`, the planned start and end) → break. Another user's timer is ignored, and Log out clears it.

Fixing that exposed one more thing: after logout the **tab title stayed** "23:59 · Focus". The effect that sets `document.title` had no cleanup, so unmounting the timer left it behind. Effects that change something outside React must undo it in their cleanup.

> **Interview Q:** *"Tell me about a bug you found."* This one is good because it's an *interaction* between two individually correct features (token expiry, logout clearing state), found by testing realistically rather than by a unit test.

## 5. Making the project presentable

- **Demo seed** (`python -m scripts.seed_demo`): resets a `demo@studyflow.app` account with 4 courses, deadlines around *this* week (one overdue, one exam, some done) and two weeks of study sessions. Deadlines are relative to this week's Monday; sessions are relative to *today* ("days ago"), so the last 7 days are full whatever weekday it runs on. It was first written relative to Monday, and running it on a Monday produced an empty week. It never creates a future session, matching the API's own rule.
- **Screenshots as code** (`npm run screenshots`): Playwright logs in through the API, plants the token (and, for the Study page, a running timer) with `addInitScript`, and captures six views at 2× in a fixed time zone and locale. It uses `playwright-core` with `channel: "msedge"`, i.e. the Edge already installed on Windows, so there's no extra browser download. When the UI changes, screenshots are one command away instead of a manual chore. Two small fixes along the way: Playwright wants a string path, not a `URL` (`fileURLToPath`), and the stats shot navigates straight to last week's URL, because on a Monday this week is empty.
- **README** written for a 30-second skim: CI badge, a hero screenshot, a grid of the other views, then features, engineering highlights (each linking to its walkthrough), an architecture diagram (Mermaid, rendered by GitHub), testing summary, and setup.

## 6. Deployment

*To be decided together. See the end of this stage's conversation for the options.*
