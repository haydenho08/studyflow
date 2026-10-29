# Stage 7: Safer login (refresh tokens in an httpOnly cookie)

**Goal:** stop keeping the login somewhere a script could steal it, make "Log out" take effect at once, and add **Log out everywhere**.

```
backend/app/models/auth_session.py      one row per login: refresh token hash, expiry, revoked
backend/app/sessions.py                 start, rotate (with theft detection), revoke
backend/app/routers/auth.py             /login and /demo set the cookie; /refresh, /logout, /logout-all
backend/app/deps.py                     access tokens must belong to a live session; Origin check
backend/alembic/versions/…_0004_…       the auth_sessions table
frontend/src/auth/session.ts            the access token, in memory only
frontend/src/api/client.ts              refresh on load and on a 401, then retry; one refresh at a time
frontend/src/components/Layout.tsx      account menu: Log out, Log out everywhere
frontend/e2e/session.spec.ts            6 browser tests of all of the above
```

---

## 1. What was wrong before

The login was one JWT, valid for an hour, kept in `localStorage` so a page refresh didn't log you out. Two problems:

- **Anything that can run JavaScript on the page can read `localStorage`.** One XSS bug, or one compromised npm package, and the token leaves the browser and works from anywhere for up to an hour.
- **Logging out only deleted the browser's copy.** The token itself stayed valid until it expired. Nothing on the server could end a login early.

## 2. The design: two tokens

| | Access token | Refresh token |
|---|---|---|
| What | JWT, signed | 256 random bits (`secrets.token_urlsafe(32)`) |
| Lives | 15 minutes | 30 days since last use |
| Kept in | **page memory only** (a JS variable) | **httpOnly cookie** |
| Sent | `Authorization: Bearer …` on API calls | only to `/api/auth/*` (cookie `Path`) |
| Stored on the server | nothing (it's self-contained) | SHA-256 hash, in `auth_sessions` |

- **httpOnly** means `document.cookie` can't see the refresh token, so an injected script can't copy it out. **Secure** means HTTPS only. **SameSite=Strict** means the browser leaves it off any request another site starts.
- The access token is in memory, so a script can't read it **from storage** either. An XSS bug could still make requests while the page is open, and nothing client-side can stop that. But it can't take a credential away and use it from somewhere else for a month. That's the realistic gain, and it's the reason this design is the usual recommendation.
- **On page load** the app has no access token. If localStorage holds the hint `studyflow.session` (just `"1"`, not a secret), it calls `POST /api/auth/refresh`; the browser attaches the cookie, and the app gets a new access token. Without the hint (a visitor who never logged in), it skips the request.
- **When an access token expires**, the API answers 401. The client refreshes once and retries the request. That's safe even for a POST, because a 401 means the server refused before doing anything. The user never notices.

*Why not put the access token in a cookie too?* Then every API route would need CSRF protection, not just the four auth routes. With a Bearer header, a forged cross-site request simply has no token to send.

## 3. Sessions, so logging out really logs out

Each login creates an `auth_sessions` row, and its access tokens carry the row's id (`"sid"`). `get_current_user` checks that the session is **still live**, not just that the signature is valid. So:

- **Log out** revokes this device's session. Its access token stops working **immediately**, not in 15 minutes. That's checked by a test.
- **Log out everywhere** revokes every session the account has: for a lost laptop or a login on a library computer. The menu asks first, because it logs this device out too.
- The extra lookup is one primary-key query per request, and `get_current_user` was already loading the user.

*Trade-off:* this gives up the "stateless JWT" property. For an app with one database that's no loss, and it buys instant revocation.

## 4. Rotation and theft detection

Every refresh **rotates** the refresh token: the cookie gets a new one, and the old one stops working. The row keeps the hash of the token it replaced, so the server can tell "an old token" apart from "a made-up one".

If an old token comes back, two copies of it exist: someone copied the cookie. The server can't tell which party is the real user, so it **revokes the whole session** and both are logged out. The real user logs in again; the attacker can't. The theft test walks through exactly this, and another checks that the user's other devices aren't affected.

Supporting details:

- **Only hashes are stored.** A database leak doesn't give anyone a working cookie. SHA-256 is enough here (bcrypt's slowness protects *guessable* passwords; 256 random bits can't be guessed), and it's fast, which matters because every refresh does a lookup.
- **Hashing first** also means odd input (the NUL byte from Stage 6) never reaches Postgres.
- **The row is locked** (`SELECT … FOR UPDATE`) while it rotates, so two simultaneous refreshes with the same token can't both succeed.
- **Refreshes never overlap in the browser.** Two tabs loading at once would otherwise both send the same cookie, and the second would look like theft. Within a tab, refreshes share one promise. Across tabs, a **Web Lock** (`navigator.locks`) makes the second tab wait, and by then the browser holds the rotated cookie.
- **Dead sessions are tidied away** when the same user next logs in, so the table doesn't grow forever.
- *Known edge case:* if the network drops after the server rotates but before the new cookie arrives, the next refresh uses the old token and the session is revoked. The failure is "logged out", which is the safe direction.

## 5. CSRF

The routes that read or set the cookie (`/login`, `/demo`, `/refresh`, `/logout`) have two layers:

1. **SameSite=Strict:** browsers don't send the cookie on requests that another site starts. `onrender.com` is on the Public Suffix List, so even another Render app counts as a different site.
2. **An Origin check:** browsers send `Origin` on every POST. If it names a different site (or `null`, from a sandboxed frame), the route returns 403. A request with no Origin header isn't from a browser (curl, the tests), so there's no logged-in victim to trick. The Vite dev server's origin is allowed, because it's a configured CORS origin.

The Bearer-token routes need neither, for the reason in section 2.

## 6. Across tabs

The localStorage hint doubles as a signal between tabs. Log out in one tab and the hint is removed, so a `storage` event tells every other tab to drop its access token and go to the login page. Log in in one tab and the others see the hint appear and get their own access token from the shared cookie. An e2e test opens two tabs and checks the first case.

## 7. Tests

- **Backend (36 new):** cookie flags (`HttpOnly`, `Secure`, `SameSite=Strict`, `Path`, `Max-Age`); the refresh token isn't in the response body and only its hash is stored; refresh works, rotates and extends the session; bad, empty, NUL-byte and over-long cookies are rejected and cleared; expired sessions fail; reuse revokes the session (and only that session); logout is immediate and leaves other devices alone; logout everywhere covers every device of one user only; tokens without a `sid`, or with another user's `sid`, are refused; cross-site Origins get 403 on all three cookie routes, and the cookie is left untouched.
- The test client now uses `https://testserver`: like a browser, it won't send a Secure cookie over plain http.
- **End-to-end (6 new):**
  - a reload keeps you logged in, while `localStorage` holds no JWT and `document.cookie` can't see the refresh cookie;
  - a forced 401 is silently refreshed and retried;
  - logging out survives a reload (also on a phone);
  - logging out in one tab logs out the other;
  - **Log out everywhere** logs out a second browser profile;
  - the API refuses a cross-site refresh.
- Existing e2e tests now start logged in the way a returning user does: with the refresh cookie already in the browser.

## 8. Deploying it

- Migration `0004` creates the table; the container runs migrations on start, as before.
- Anyone logged in with an old one-hour token is logged out once: those tokens have no `sid`. A test covers this, on purpose.
- The Secure cookie works on `http://localhost` and `127.0.0.1` in development, because browsers treat those as secure. `AUTH_COOKIE_SECURE=false` exists for anything else.
