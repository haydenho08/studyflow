# Stage 11: Account settings and password reset

**Goal:** the account flows every real app needs: change your password, change your email (proving you own the new one), reset a forgotten password by email, and delete your account.

```
backend/app/routers/account.py            password, email, reset, delete
backend/app/email_tokens.py               single-use emailed links: issue, spend
backend/app/models/email_token.py         hashed, expiring, one per purpose
backend/app/mail.py                       none / console / file / smtp backends
backend/alembic/versions/…_0008_…         the email_tokens table
frontend/src/pages/SettingsPage.tsx       Email, Password, Delete account
frontend/src/pages/AccountLinkPages.tsx   /forgot-password, /reset-password, /confirm-email
frontend/e2e/outbox.ts                    the browser tests read the emails the server "sent"
```

---

## 1. Email without locking in a provider

Password reset and email changes only work if the server can send email, and that needs an account with a mail provider. So sending is behind one function, `send_mail`, and the deployment picks a backend:

| `MAIL_BACKEND` | What happens | Used by |
|---|---|---|
| `none` (default) | nothing is sent; the features are **hidden** | a deployment that hasn't set email up |
| `console` | the message is printed | local development |
| `file` | written as an `.eml` file to `MAIL_OUTBOX_DIR` | pytest and the browser tests |
| `smtp` | sent over SMTP with STARTTLS | production (any provider) |

`GET /api/config` returns `{"email_enabled", "demo_enabled"}`, and the frontend only offers what works: no **Forgot password?** link on a server that can't send the email. The routes that need email return 503 instead of pretending.

**Sending happens after the response**, in a FastAPI background task:
- The request never waits on a slow mail server or fails because of one. An SMTP error is logged; nobody is waiting for the answer anyway.
- "Forgot password" takes the same time whether or not the account exists (see section 3).

## 2. Emailed links

A link is `https://…/reset-password#token=<43 characters>`.

- **256 random bits**, and only a **SHA-256 hash** is stored (as for refresh tokens), so a database leak gives out no working links.
- **Single use:** spending one sets `used_at`, inside a `SELECT … FOR UPDATE`, so two clicks at once can't both succeed.
- **Short-lived:** reset links last 1 hour; email-change links 24 hours.
- **Only the newest works:** asking again cancels the earlier link. Changing your password cancels any pending reset links.
- **Each purpose has its own tokens:** an email-change token can't be used as a reset token. There's a test.
- **The token is in the URL *fragment* (after `#`), not the query string.** Browsers never send the fragment to the server, so it isn't in access logs, proxy logs, or a `Referer` header sent to another site. The page reads it, then removes it from the address bar with `history.replaceState`, so it isn't left in browser history either.
- **Confirming a new email is a button, not something that happens on page load.** Some email security scanners open links to check them, and that mustn't change anyone's address.

## 3. Not revealing who has an account

`POST /account/password-reset` returns the same 202 and the same message whether or not the email is registered, and an email goes out only if it is. Combined with sending in the background, the response doesn't leak which emails have accounts, the same idea as login's "Incorrect email or password" (Stage 1).

*Remaining edge:* a known email does one more database insert than an unknown one. That's microseconds against network jitter; the next stage's rate limiting is what really stops someone probing many addresses.

## 4. What each action does to your logins

| Action | Needs | Logins afterwards |
|---|---|---|
| Change password | current password | **every other device logged out**; this one stays in |
| Reset password (emailed link) | the link | **every device logged out**: whoever knew the old password is out too |
| Change email | password, then the link sent **to the new address** | unchanged; the **old** address gets a "your email was changed" notice |
| Delete account | password (and typing your email, in the UI) | everything gone |

- **Changing your email only happens once the link sent to the new address is clicked.** That proves you own it. Until then you still log in with the old one. If someone signed up with that address in the meantime, the confirmation fails with 409 instead of creating two accounts with the same email.
- **Deleting an account** cascades through everything (`ON DELETE CASCADE` all the way down): your courses, deadlines, progress, study time, logins and links. Courses you **own** are deleted for their members too, and the UI says so. In courses you **joined**, only your own progress goes; the course stays for everyone else.
- **Wrong passwords are 403, not 401.** In this app, 401 means "your login expired", which makes the client refresh its token and retry. A wrong current password isn't that.
- **The demo account** can't have its password or email changed and can't be deleted (403), since every visitor shares it. It never gets reset links either.
- **The password rules are defined once** (`NewPassword` in `schemas/auth.py`: at least 8 characters, at most 72 *bytes* for bcrypt) and used by sign-up, change and reset alike.

## 5. A bug the browser tests found

The **Forgot password?** link never appeared in the browser test, but did when the page was opened by hand after logging in and out. The cause:

1. On a logged-out page load, the login page starts fetching `/api/config`.
2. Its parent, the auth provider, then runs `queryClient.clear()`, the "forget the previous user's data" step from Stage 2.
3. Clearing removes the config query, and in TanStack Query removing a query **cancels its fetch**, so the page waited forever.

The fix forgets only *user* data and keeps the server's feature flags, which are the same for everyone. It's a good reminder that "clear the cache" is a bigger hammer than it looks.

## 6. Tests

- **Backend (39 new):**
  - Config flags.
  - Password change: works; needs the current password; follows the sign-up rules (bytes, not characters); logs out other devices but not this one; needs a login; refused for the demo.
  - Reset: the email and its link; the same answer for unknown emails; the reset itself; every device logged out; single use; only the newest link; expiry; cancelled by a password change; made-up and malformed tokens; hashes only; 503 without email; no link for the demo; `PUBLIC_URL` used in links.
  - Email change: waits for confirmation; the old address told; password needed; address taken (now, and between sending and clicking); unchanged address; single use; tokens not interchangeable; 503 without email; refused for the demo.
  - Delete: everything goes, the cookie is cleared and the address is free again; password needed; shared courses go for their members; a member's own progress goes but the course stays; refused for the demo.
- **Frontend (7 new unit tests):** reading the token from the hash, and rejecting anything that isn't one.
- **End-to-end (4 new):** the server writes its email to a temp folder (`MAIL_BACKEND=file`), and the tests open the links the way a person would.
  - **Forgot password:** request the link, open it, set a new password, log in with it, and find that the link doesn't work twice.
  - **Change password** from the account menu's new **Settings** link.
  - **Change email:** confirm through the emailed link and see the new address.
  - **Delete account** (also on a phone): the button stays disabled until the email is typed; afterwards logging in fails.
