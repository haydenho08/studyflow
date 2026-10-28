# Stage 2: Frontend

**Goal:** a React + TypeScript single-page app (SPA) for logging in, managing courses, and tracking assignments against the Stage 1 API.

```
frontend/
├── openapi.json           API contract, exported from FastAPI (backend/scripts/export_openapi.py)
├── vite.config.ts         dev server + /api proxy + test timezone
└── src/
    ├── main.tsx           providers: React Query → Router → Auth
    ├── App.tsx            route table
    ├── api/
    │   ├── schema.ts      GENERATED TypeScript types (npm run gen:api), never edited by hand
    │   ├── types.ts       friendly aliases: Course, Assignment, Status…
    │   ├── client.ts      fetch wrapper: token, errors, 401 handling
    │   ├── endpoints.ts   one function per API call
    │   └── queries.ts     React Query hooks + cache invalidation rules
    ├── auth/              token store, AuthContext, RequireAuth route guard
    ├── lib/               pure logic: dates, URL filters, PATCH diff, labels (+ *.test.ts)
    ├── components/        Layout, ErrorMessage
    └── pages/             AuthPage, CoursesPage, AssignmentsPage, NotFoundPage
```

**Libraries:** React 19, React Router 8, TanStack Query 5, Vite 8, TypeScript 5.9, Vitest, openapi-typescript. Styling is plain CSS with design tokens (no UI framework), so there are fewer dependencies to explain and the CSS is all ours.

---

## 1. Typed end to end: one source of truth for the API contract

```
Pydantic schemas ──FastAPI──▶ openapi.json ──openapi-typescript──▶ src/api/schema.ts
```

The backend already describes every request and response (Stage 1's Pydantic models). `export_openapi.py` dumps that description, and `npm run gen:api` turns it into TypeScript types. If someone renames a field in Python and regenerates, **the frontend stops compiling** wherever it used the old name, so the bug is caught by the compiler, not by a user.

`lib/labels.ts` uses `Record<Status, string>`. If the backend adds a new status, the generated `Status` type changes and this file fails to compile until the UI has a label for it. That's *exhaustiveness checking*.

Two real issues came up while wiring this, and both make good stories:
- **Peer dependency conflict.** npm installed TypeScript 7 by default, but openapi-typescript is built on the TypeScript 5 compiler API (`peerDependencies: typescript ^5.x`). TS 7 is the rewritten native compiler and doesn't ship that JS API, so generation crashed with `ts.factory is undefined`. `npm ls typescript` showed the version as "invalid". The fix was to pin `typescript@5.9.3`.
- **Request vs response types.** By default, openapi-typescript treats fields with a default (like `status = "todo"`) as *always present*. That's true in responses, but wrong for request bodies, where the client may omit them. The type checker caught it: the create form wasn't sending `status`. The fix is the `--default-non-nullable false` flag, after which `status?` is optional on create and required on read.

## 2. Server state vs client state (React Query)

Most "state" in this app is really a **copy of data that lives on the server**: courses, assignments, the current user. Keeping that in `useState` means hand-writing loading flags, error handling, refetching and caching on every page. TanStack Query does it once:

```ts
useQuery({ queryKey: ["assignments", filters], queryFn: () => assignmentsApi.list(filters) })
```

- **Cache keys.** Each distinct filter combination is its own cache entry. Going back to a filter you used before shows instantly from cache.
- **Invalidation instead of manual updates.** After a mutation we don't patch the cache by hand; we mark data stale and React Query refetches it. `queries.ts` is the one place that knows what each change invalidates. The interesting case: **deleting a course also invalidates assignments**, because the database cascaded the delete (Stage 1). The frontend has to know about the backend's data model.
- **Prefix keys.** Invalidating `["assignments"]` refreshes every `["assignments", {...filters}]` list at once.
- **`keepPreviousData`.** While a new filter loads, the old list stays (dimmed with `.is-stale`) instead of flashing "Loading…".
- **Retry policy** (`main.tsx`): network errors and 5xx are retried, 4xx never are. Asking again won't fix a 404 or a 422.

Genuinely *client* state (is the edit form open? what's typed in the input?) stays in `useState`.

## 3. Authentication in a SPA

### Where the token lives

`auth/token.ts` keeps the JWT in a module variable (fast reads) mirrored to **localStorage** (survives refresh). Components subscribe with **`useSyncExternalStore`**, React's built-in hook for reading from a store that lives outside React.

| Option | Survives refresh | Readable by injected JS (XSS) | Sent automatically (CSRF risk) |
|---|---|---|---|
| Memory only | ✗ | ✗ | ✗ |
| **localStorage** (ours) | ✓ | **✓** | ✗ |
| httpOnly cookie | ✓ | ✗ | **✓** (needs SameSite/CSRF token) |

We chose localStorage for simplicity and are explicit about the trade-off: if an attacker can run JavaScript on our page, they can read the token. Our mitigation is not having XSS: React escapes everything it renders, and we never use `dangerouslySetInnerHTML`. The production upgrade is an httpOnly, `SameSite=Strict` cookie set by the API.

### The flow

- **Login** (`AuthContext.login`) posts the OAuth2 form, stores the token, and the app re-renders. `AuthPage` sees `isAuthenticated` and renders `<Navigate>`, so there's no imperative "redirect after login" code to forget.
- **Route guard.** `RequireAuth` wraps the protected routes. Logged-out visitors are sent to `/login` *with the page they wanted* in router state, and after login they land back there (tested: `/assignments?course=3` survived the round trip).
- **Expired tokens.** `client.ts` sees a 401 on a request that carried a token, clears it, and the guard sends you to /login. There's one place for this rule, not one per page.
- **Cross-tab sync.** The `storage` event fires in other tabs when localStorage changes, so logging out in one tab logs out all of them.
- **Cache wipe on logout.** `queryClient.clear()` runs whenever the token disappears. Without it, the next person to log in on a shared computer could briefly see the previous user's cached assignments. This is the frontend version of Stage 1's per-user scoping.

## 4. Talking to the API

- **Vite dev proxy.** The browser calls `http://localhost:5173/api/...` and Vite forwards it to FastAPI on `:8000`. The browser sees **one origin**, so there are no CORS preflight requests in development and no hard-coded API host in the code. For production, `VITE_API_BASE_URL` can point elsewhere (Stage 5).
- **`client.ts`** is the single `fetch` wrapper: it attaches `Authorization: Bearer …`, sends JSON or form data, builds query strings (skipping empty filters), and turns FastAPI's two error shapes (`{"detail": "text"}` and the 422 list `{"detail": [{loc, msg}]}`) into one readable message.
- **PATCH sends only what changed** (`lib/diff.ts`). The edit form compares the original and edited values *in API shape* and sends the difference. Verified in the browser: changing just the priority sent exactly `{"priority":"high"}`. Comparing in API shape matters: the form shows `2026-10-28T10:00` while the API returned `…T14:00:00Z`, which are different strings for the same instant. Without normalising, every save would resend `due_at`.

## 5. Dates and time zones, the frontend half

Stage 1 made the API strict: UTC in, UTC out, no ambiguous times. The frontend does the conversion, and **all of it lives in `lib/dates.ts`**:

- `<input type="datetime-local">` gives `"2026-11-02T23:59"`, with no offset. JavaScript parses offset-less date-times as **local time**, so `new Date(value).toISOString()` gives the UTC instant: `2026-11-03T04:59:00.000Z` in Toronto (EST, UTC−5). Verified against what Postgres stored.
- **Day filters are half-open, in local time.** "Due from Oct 28 to Nov 2" becomes `[Oct 28 00:00 local, Nov 3 00:00 local)`. The real request was `due_from=2026-10-28T04:00Z` (still EDT) and `due_to=2026-11-03T05:00Z` (now EST): the offsets differ because DST ended on Nov 1.
- **Calendar arithmetic, not milliseconds.** "Next day" uses `setDate(d + 1)`, not `+ 24h`. The day DST ends is 25 hours long, and `+24h` would land at 23:00 the same day.
- Display uses `Intl.DateTimeFormat` and `Intl.RelativeTimeFormat` ("Mon 2 Nov, 23:59 · in 9 days"), with no date library needed.

The unit tests pin `TZ=America/Toronto` (in `vite.config.ts`) so they produce the same results on any machine and in CI, and they deliberately straddle the Nov 1 DST change. While writing them, I first assumed midnight Nov 1 was already EST. It isn't (clocks change at 2 a.m.), and the test caught my wrong assumption, which is exactly why these tests exist.

## 6. URL as state

Assignment filters live in the query string (`?course=3&status=todo&from=2026-11-01`), read with `useSearchParams`:

- A refresh keeps your view; the back button works; a filtered view can be bookmarked or shared.
- `lib/filters.ts` **validates** what it reads. A URL is user input, so `?course=abc` or `?status=toString` is ignored rather than sent to the API. The `toString` test case exists because `"toString" in {}` is `true` (inherited from `Object.prototype`); the code uses `Object.hasOwn` instead.
- Filter changes use `replace: true`, so tweaking five filters doesn't add five back-button steps.

## 7. Component design

- **Pages own data, forms own input.** `CoursesPage` fetches; `CourseForm` only knows about its fields and an `onSubmit` promise. The same form is reused for **create and edit**, just with different `initial` values and handlers.
- **Controlled inputs.** Every input's value comes from state, so validation, reset and diffing are just reading state.
- **Login and register are one component** with a `mode` prop: same fields, different submit action.
- **Accessibility basics.** Every input is wrapped in a `<label>`; errors use `role="alert"` so screen readers announce them; inline status dropdowns have `aria-label`s naming their assignment; focus outlines are visible; dark mode follows the OS setting.
- **Client-side validation is UX, not security.** The register form checks the 72-byte password limit and `minLength` for instant feedback, but the API enforces the same rules, because anyone can call the API without our UI.

## 8. Testing

- **Vitest unit tests** (21) for the pure logic most likely to hide bugs: date conversion across DST, URL filter parsing and validation, and PATCH diffing. Pure functions in `lib/` are easy to test because they don't touch React or the network. That separation is the design choice that makes testing cheap.
- **Type checking** (`tsc --noEmit`, strict mode plus `noUncheckedIndexedAccess`) runs as part of `npm run build`.
- **Manual end-to-end pass in a real browser** against the real API and Postgres: route guard redirect, wrong-password error, register → auto-login, course code normalisation, duplicate-code 409 shown in the form, create assignment (UTC stored correctly), filters via URL and via controls, inline status change (PATCH reached the DB), edit sends a minimal PATCH, logout clears the token and redirects, login returns to the original filtered page.

What's missing, honestly: no automated component or end-to-end tests yet. A good Stage 5 addition is Playwright running the flow above in CI.

## 9. Things deliberately left for later

- Optimistic updates (flip the status in the UI before the server replies, roll back on error). We currently wait for the refetch, which is simpler and fast enough locally.
- httpOnly cookie auth (see §3).
- Pagination and virtualised lists (not needed at student scale).
- ESLint + Prettier and Playwright are Stage 5, alongside CI.

## How to run it

```powershell
docker compose up -d db                      # from the repo root
cd backend; .\.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload                # API on :8000

# in a second terminal
cd frontend
npm install
npm run dev                                  # app on http://localhost:5173
npm test                                     # unit tests
npm run build                                # typecheck + production build

# after changing backend schemas:
cd backend; python -m scripts.export_openapi; cd ../frontend; npm run gen:api
```
