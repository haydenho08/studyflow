# Stage 12: Rate limiting and login lockout

**Goal:** make guessing passwords, mass sign-ups and flooding someone's inbox with reset emails impractical, without letting the limits leak information or lock people out of logins they already have.

```
backend/app/ratelimit.py                  limits, the atomic counter, check / consume / clear
backend/app/models/rate_limit.py          rate_limit_counters (hashed key, window, count)
backend/alembic/versions/…_0009_…         the table
backend/app/routers/auth.py               login lockout, sign-ups per address
backend/app/routers/account.py            reset emails, email changes, password checks
```

---

## 1. The limits

| What | Per | Limit | Window |
|---|---|---|---|
| Failed logins | **account** (the email typed) | 10 | 15 min |
| Failed logins | IP address | 50 | 15 min |
| Sign-ups | IP address | 20 | 1 hour |
| Reset emails | **email address** | 3 | 1 hour |
| Reset emails | IP address | 10 | 1 hour |
| Email-change requests | **user** | 5 | 1 hour |
| Wrong "current password" in Settings | **user** | 10 | 15 min |

Going over gives **429 Too Many Requests**, a `Retry-After` header in seconds, and a message the login page shows as it is: "Too many failed logins for this account. Try again in 10 minutes."

## 2. Counters in the database

The counters are rows in Postgres, not a dictionary in the server's memory:

- **They survive a restart.** A deploy or a free-tier sleep doesn't hand an attacker a fresh set of guesses.
- **They'd work with more than one instance**, because every instance sees the same table. An in-memory limiter run on N servers quietly allows N times the limit.

Each attempt is **one atomic statement**:

```sql
INSERT INTO rate_limit_counters (key, window_start, count) VALUES (…, …, 1)
ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limit_counters.count + 1
RETURNING count
```

Postgres serializes the updates to that row, so two requests at the same moment can't both read "9" and both slip in as the 10th, which a read-then-write would allow.

- **Keys are hashed:** `sha256("login-account:alice@example.com")`. The table can be read without seeing anyone's email or IP address.
- **Old windows are tidied up** on roughly 1 in 100 hits: anything older than a day is deleted. That's cheap, and needs no scheduled job.
- **Fixed windows** (10:00–10:15, 10:15–10:30…) are simpler than sliding ones. The known cost is that a burst at a boundary can get up to twice the limit through: 20 guesses in a few minutes instead of 10. For guessing a password that's still hopeless. The tests pin the clock mid-window, so a run that happens to cross a boundary can't flake.

## 3. Login lockout, carefully

- **Checked before bcrypt.** A locked account is refused without hashing anything, so a flood of guesses doesn't cost the server a bcrypt hash each. A test replaces `verify_password` with one that fails if it's ever called.
- **Keyed on the email typed, whether or not the account exists.** Nine guesses against `nobody@example.com` get the same 401s, and the tenth the same 429, as against a real account. The lockout can't be used to find out who's registered. The same goes for reset emails.
- **A successful login resets the account's count.** A real user who mistypes a few times isn't one step from a lockout for the rest of the window.
- **Only password login is locked.** Logins you already have keep working: access tokens, and refreshing them from the cookie. So an attacker who deliberately locks someone out (the classic downside of lockouts) only stops *new* password logins for 15 minutes, and the person can still reset their password by email.
- **Per account and per IP.** The per-account limit stops someone guessing one person's password from many machines. The per-IP limit stops one machine trying a common password against many accounts ("password spraying").

## 4. Settings and email

- **Wrong "current password" attempts are limited per user.** Someone who has a stolen, logged-in session mustn't be able to use the change-password, change-email or delete-account forms to guess the password.
- **Reset emails are limited per address.** That protects the *recipient*: nobody can make StudyFlow send someone 500 emails.

## 5. What the IP limits can and can't do

Behind Render's proxy, the container runs uvicorn with `--forwarded-allow-ips='*'`, and uvicorn then takes the **leftmost** `X-Forwarded-For` entry as the client's address. A client can put anything there, so a determined attacker can give every request a different "IP".

That's why the per-IP limits are the *second* layer: they slow down casual abuse and scripts. The limits that matter (per account, per email address, per user) are keyed on things the client can't change by editing a header. The fix for the IP layer would be to trust only Render's proxy addresses, or to read a header that Render's edge sets itself, once that's confirmed for this hosting setup.

## 6. Tests

- **Backend (21 new):**
  - The counter: counting within a window, a new window starting from zero, separate subjects and limits, case-insensitive subjects, hashed keys, old windows tidied.
  - Login: 10 failures lock the account even for the right password, with the exact `Retry-After`; unknown emails lock identically; other accounts aren't affected; the lock runs out; a success resets the count; bcrypt is never reached while locked; existing logins and refresh keep working; one address trying many accounts.
  - The rest: sign-ups per address; reset emails per address (only 3 delivered), the same for unknown addresses, and per IP; guessing the current password in Settings; email changes per user; and the limits switched off.
- **All 328 earlier tests pass with limiting switched on.**
- **The browser tests run with `RATE_LIMIT_ENABLED=false`:** each one signs up its own account from 127.0.0.1, which the sign-up limit would otherwise stop. The limits themselves are covered by the backend tests above.
