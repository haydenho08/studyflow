# Stage 1: Backend core

**Goal:** a working, tested REST API for user accounts, courses and assignments, backed by PostgreSQL.

```
studyflow/
├── docker-compose.yml          Postgres 16 container (+ init script that creates studyflow_test)
├── .env.example                every setting the app reads, with safe dev defaults
└── backend/
    ├── requirements*.txt       pinned dependencies
    ├── alembic/                schema migrations (versions/20261022_0001_initial_schema.py)
    ├── app/
    │   ├── config.py           pydantic-settings: typed config from env vars / .env
    │   ├── db.py               engine, session-per-request, Base with naming convention
    │   ├── models/             SQLAlchemy 2.0 typed models (User, Course, Assignment)
    │   ├── schemas/            Pydantic models: what the API accepts and returns
    │   ├── security.py         bcrypt hashing + JWT create/verify
    │   ├── deps.py             FastAPI dependencies: DbSession, CurrentUser
    │   ├── ownership.py        the only way routes load a course/assignment
    │   ├── routers/            auth, courses, assignments
    │   └── main.py             app factory, CORS, /api prefix
    └── tests/                  pytest + TestClient against a real Postgres test DB
```

---

## 1. Layers, and why they're separate

A request flows: **router → schema validation → dependency (auth, DB session) → ownership lookup → model → database**.

- **Models** (`app/models`) describe *tables*. **Schemas** (`app/schemas`) describe *API payloads*. They look similar but are deliberately separate: `User` has `hashed_password`; `UserRead` does not, so it is impossible to accidentally return a hash. `AssignmentCreate` has no `user_id`/`id`; clients can't set them.
- **Dependencies** (`deps.py`) are FastAPI's dependency injection. `CurrentUser = Annotated[User, Depends(get_current_user)]` means any route that declares `user: CurrentUser` is authenticated, and in tests we swap `get_db` for a test database with `app.dependency_overrides`, without touching route code.

> **Interview Q:** *"Why not return your ORM objects directly?"* Because the DB shape and the API contract change for different reasons. A response schema is an allow-list of fields, which prevents data leaks and lets you rename a column without breaking clients.

## 2. Configuration (`config.py`, `.env.example`)

`Settings(BaseSettings)` reads environment variables, falling back to the repo-root `.env`. Values are type-checked at startup: `ACCESS_TOKEN_EXPIRE_MINUTES=abc` crashes immediately instead of at the first login.

- `jwt_secret_key` has **no default** and must be ≥ 32 chars. A forgotten secret should stop the app, not silently fall back to `"secret"`.
- `.env` is git-ignored; `.env.example` is committed as documentation. This is the [12-factor](https://12factor.net/config) "config in the environment" rule.

> **Interview Q:** *"How do you manage secrets?"* Never in git; inject via environment (`.env` locally, the host's secret store in production); fail fast if missing.

## 3. Database design

### Schema

```
users (id, email UNIQUE, hashed_password, created_at, updated_at)
  └─< courses (id, user_id FK→users ON DELETE CASCADE, name, code, color, …)
        UNIQUE (user_id, code)
        └─< assignments (id, course_id FK→courses ON DELETE CASCADE, title, description,
                          kind, due_at timestamptz, priority, status, …)
              INDEX (course_id, due_at)
```

**Ownership through the course, no `user_id` on assignments.** This is *normalization*: the owner of an assignment is a fact about its course, so storing it twice could let the two copies disagree (an assignment "owned" by Bob inside Alice's course). The cost is a JOIN on every assignment query, which is cheap on indexed integer keys.

> **Interview Q:** *"When would you denormalize?"* When you measure that the join is a bottleneck. Then you'd add `user_id` *with* a constraint or trigger to keep it consistent. Correctness first, optimize with evidence.

**`ON DELETE CASCADE` in the database**, plus `passive_deletes=True` in the ORM. The database guarantees no orphaned assignments regardless of *who* deletes the course (our API, a psql session, a future background job). `passive_deletes` tells SQLAlchemy not to load every child just to delete it one by one. `test_cascade_is_enforced_by_the_database` proves this with raw SQL that bypasses the ORM.

**Enums as `VARCHAR` + `CHECK`**, not native Postgres `ENUM`. Adding a value to a native enum needs `ALTER TYPE`, which has historically been awkward inside transactional migrations. A CHECK constraint is just dropped and re-created. Either way the database rejects `status = 'finished'`.

**Indexes:** `ix_courses_user_id` serves "my courses". `(course_id, due_at)` serves "this course's work by deadline", and because it's a *composite* index whose first column is `course_id`, it also serves plain `WHERE course_id = ?` lookups (the leftmost-prefix rule), so no separate `course_id` index is needed.

**Naming convention** on `Base.metadata` gives every constraint a predictable name (`fk_assignments_course_id_courses`). Without it Postgres generates names, and a future migration that needs to drop a constraint can't know what it's called.

### Time

- Columns are `timestamptz` (`DateTime(timezone=True)`). Postgres stores an absolute instant (internally UTC).
- Each connection sets `timezone=utc` (`make_engine`), so values come back as UTC-aware Python datetimes and the JSON always ends in `Z`.
- The API **requires** an offset on `due_at` (`AwareDatetime`). `"2026-11-02T23:59:00"` is ambiguous (Toronto? the server's zone?) so it gets a 422 rather than a guess. Accepted values are converted to UTC before storage.

> **Interview Q:** *"How do you handle time zones?"* Store instants in UTC, reject ambiguous input at the boundary, and convert to local time only for display (that's the frontend's job, in Stage 2).

### Migrations (Alembic)

`alembic upgrade head` applies `versions/*_initial_schema.py`, creating the tables and recording revision `0001` in `alembic_version`. Each future schema change becomes a new revision file, reviewed in git like any other code. `env.py` reads the DB URL from `Settings`, so there's one source of truth and no credentials in `alembic.ini`.

The tests use `Base.metadata.create_all` instead (faster, and they start from scratch each run). The risk is the migration drifting from the models; Stage 5's CI will run `alembic upgrade head` + `alembic check` against a fresh database to catch that.

## 4. Authentication

### Passwords: bcrypt

- bcrypt is **slow on purpose** (cost factor 12 ≈ 2¹² rounds) and **salted** (each hash embeds a random salt), so identical passwords produce different hashes and precomputed rainbow tables are useless.
- bcrypt only reads the first **72 bytes**. Rather than silently truncating, `UserCreate` rejects longer passwords. It counts *bytes* (`len(p.encode("utf-8"))`), not characters: `"é"` is 1 character but 2 bytes (see `test_password_limit_counts_bytes_not_characters`).
- Tests set `BCRYPT_ROUNDS=4` so the suite runs in seconds; production keeps 12.

### Login: OAuth2 password flow + JWT

- `POST /api/auth/login` takes **form data** (`username`, `password`) via `OAuth2PasswordRequestForm`. That's what the OAuth2 spec defines, and it's what makes Swagger's **Authorize** button work. `username` holds the email.
- **Same error for unknown email and wrong password** (`401 Incorrect email or password`). Different messages would let anyone check which emails have accounts (*user enumeration*).
- **Timing matters too:** with an unknown email we still run `bcrypt.checkpw` against a dummy hash, so both failures take the same ~200 ms. Otherwise "fast failure = no such account".
- On success we return a **JWT**: `{"sub": "<user id>", "iat": …, "exp": …}` signed with HS256 and our secret. The client sends `Authorization: Bearer <token>`. `get_current_user` verifies the signature and expiry and loads the user.
- `jwt.decode(..., algorithms=[settings.jwt_algorithm])` **pins the algorithm**. A classic JWT attack sets the header to `"alg": "none"`; if the server trusts the header, unsigned tokens pass.

> **Interview Qs:**
> - *"JWT vs server-side sessions?"* JWTs are stateless (no session lookup per request, which scales horizontally) but **can't be revoked** before `exp`. Hence short expiry. Sessions are revocable but need shared storage. A common middle ground is a short-lived access token plus a revocable refresh token.
> - *"Where should the frontend store the token?"* We'll discuss trade-offs (memory vs `localStorage` vs httpOnly cookie, i.e. XSS vs CSRF) in Stage 2.
> - *"Is user enumeration fully prevented?"* Not quite: `register` returns 409 for a taken email, which is inherent to sign-up UX. Real mitigations are rate limiting and email-verification flows.

### Emails

Normalized with `.lower()` on register *and* login, so `Alice@x.com` and `alice@x.com` are one account, and the `UNIQUE` constraint enforces that. Duplicate registration is detected by catching `IntegrityError` from the constraint, **not** by "SELECT then INSERT", which has a race: two simultaneous requests could both see "no such email" and both insert.

## 5. Authorization: every query scoped to the user

Authentication = *who are you*. Authorization = *what may you touch*.

The most common API vulnerability is **IDOR / Broken Object Level Authorization** (OWASP API Top 10 #1): `GET /api/courses/42` returns course 42 because it exists, never checking who owns it. Our defence:

- Routes never call `db.get(Course, id)`. They call `get_owned_course(db, user, id)` / `get_owned_assignment(...)` in `ownership.py`, whose `WHERE` clause includes `user_id = current user` (assignments: `JOIN courses … WHERE courses.user_id = …`).
- List endpoints start from the same ownership filter, and the optional filters only *narrow* it.
- `user_id` is taken from the token, never the request body (`extra="forbid"` even rejects a body that tries).
- Creating or **moving** an assignment checks the *destination* course is yours too.

**404, not 403.** A 403 says "this exists, but it's not yours", which confirms the id is valid and leaks information. 404 treats "someone else's" exactly like "doesn't exist".

> **Interview Q:** *"How do you prevent users accessing each other's data?"* Centralize object lookups so the ownership check can't be forgotten, take identity only from the verified token, and test it: `test_users_cannot_see_or_touch_each_others_*` tries every verb as Bob on Alice's data.

## 6. API design details

| Endpoint | Notes |
|---|---|
| `POST /api/auth/register` | JSON → 201 `UserRead`; 409 duplicate; 422 invalid |
| `POST /api/auth/login` | form → `{access_token, token_type}`; 401 bad credentials |
| `GET /api/auth/me` | current user |
| `GET/POST /api/courses`, `GET/PATCH/DELETE /api/courses/{id}` | 409 on duplicate code per user |
| `GET/POST /api/assignments`, `GET/PATCH/DELETE /api/assignments/{id}` | list filters: `course_id`, `status`, `priority`, `kind`, `due_from`, `due_to` |

- **`/api` prefix.** It keeps API routes apart from frontend routes when both are served from one domain later, and gives one place for a reverse proxy rule.
- **PATCH semantics.** `model_dump(exclude_unset=True)` gives only the fields the client *sent*, so `{"color": "#222222"}` changes nothing else. That's the difference between PATCH (partial) and PUT (full replacement).
- **Omitted vs null.** In the Update schemas every field is `X | None = None`, so it can be omitted. A `reject_null` validator then rejects an *explicit* `null` for columns that are `NOT NULL`. Pydantic only validates values that were actually provided, which is what makes this distinction possible. `description` is nullable, so `{"description": null}` legitimately clears it.
- **Half-open date ranges** `[due_from, due_to)`: an assignment due exactly at midnight belongs to exactly one week, never both. The calendar in Stage 4 depends on this.
- **Status codes:** 201 + body on create, 204 no body on delete, 404 not yours / not found, 409 uniqueness conflict, 422 validation.
- **Normalization at the boundary:** emails lowercased, course codes stripped + uppercased (`" eecs 2030 "` → `"EECS 2030"`), colors uppercased, titles stripped.

## 7. Testing strategy

- **Real Postgres, not SQLite.** SQLite doesn't enforce our `timestamptz` semantics or behave the same with constraints, and it would hide exactly the bugs we care about (cascade, CHECK, unique). Tests run against `studyflow_test`, created by the Docker init script.
- **Safety guard:** `conftest.py` refuses to run unless the database name ends in `_test`, because the suite drops tables.
- **Isolation:** schema created once per session; every table `TRUNCATE … RESTART IDENTITY CASCADE`d after each test, so tests can run in any order.
- **Fixtures** (`alice`, `bob`, `make_course`, `make_assignment`) keep each test focused on the behaviour it checks.
- **Parametrized validation tests** cover many bad inputs without duplicate code.
- Tests go through HTTP with `TestClient` (more integration than unit), because the behaviour we care about (auth, ownership, status codes) lives across layers.

> **Interview Q:** *"What do your tests cover?"* Auth (register, login, token expiry/forgery), per-user isolation across every verb, filtering (course, status, priority, kind, date range edges), PATCH semantics, cascade delete at the DB level, and validation errors.

> **Do the tests actually test anything?** A quick sanity check: delete `Course.user_id == user.id` from `get_owned_course` and re-run. 3 isolation tests fail. A test suite that stays green when you break the thing it protects is worthless. (Doing this systematically is called *mutation testing*.)

## 8. Debugging story: `localhost` vs `127.0.0.1`

We bound Postgres to `127.0.0.1:5432` (instead of `5432:5432`, which listens on every network interface) so nobody else on campus Wi-Fi can reach a database whose password is `studyflow`. Right after that, `alembic upgrade head` **hung with no output**.

Diagnosis, step by step:
1. Port check: `Get-NetTCPConnection -LocalPort 5432` showed only Docker listening, on `127.0.0.1`. No conflicting local Postgres.
2. Connecting by hand with a timeout: `127.0.0.1` connected in 0.07 s; `localhost` took 8 s.
3. Cause: Windows resolves `localhost` to IPv6 `::1` **first**. Nothing listens there, but the attempt stalls instead of being refused, so the client only falls back to IPv4 after a timeout. Without a timeout, that's "forever".

Fixes: use `127.0.0.1` in the URLs, and add `connect_timeout=5`, so an unreachable database is now a clear error in 5 seconds, not a silent hang.

> **Interview Q:** *"Tell me about a bug you debugged."* This is a good one: a security hardening change caused a hang. You narrowed it down by checking the port, then reproducing in isolation with a timeout, then comparing hostnames. The fix also included a guardrail (the timeout) so the same failure would be loud next time.

## 9. Things deliberately left for later

- Rate limiting on login (Stage 5 / deployment).
- Refresh tokens and logout/revocation.
- Pagination on list endpoints (fine at student scale; would add `limit`/`offset` or keyset pagination).
- Running the backend itself in Docker (only the DB is containerized for now, so the dev loop stays fast with `--reload`).

## How to run it

```powershell
Copy-Item .env.example .env
docker compose up -d db
cd backend
python -m venv .venv; .\.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
alembic upgrade head
pytest
uvicorn app.main:app --reload    # http://localhost:8000/docs
```
