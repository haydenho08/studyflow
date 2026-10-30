"""Rate limits: how many times something may happen per subject (an email, an IP) per window.

Counters live in Postgres, not in the server's memory, so they survive restarts and would hold
across several instances. Each hit is one atomic statement:

    INSERT … ON CONFLICT (key, window_start) DO UPDATE SET count = count + 1 RETURNING count

so two requests at the same moment can't both read "9" and both slip in as the 10th.

Windows are fixed (10:00–10:15, 10:15–10:30). That's simpler than a sliding window, at the cost
that a burst straddling a boundary can get up to twice the limit through. For slowing down
password guessing, that's fine: 20 guesses in 15 minutes instead of 10 is still hopeless.
"""

import hashlib
import math
import random
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, Request, status
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import RateLimitCounter

KEEP_FOR = timedelta(days=1)  # old windows are deleted now and then


def _now() -> datetime:
    return datetime.now(UTC)  # one place to read the clock, so tests can pin it mid-window


@dataclass(frozen=True)
class Limit:
    name: str
    max: int
    window: timedelta
    message: str = "Too many attempts"


# Failed logins. Per account: the real defence against guessing one person's password. It's the
# same whether or not the account exists, so a lockout reveals nothing. Per IP: a looser cap on
# one machine trying many accounts.
LOGIN_FAILURES_PER_ACCOUNT = Limit(
    "login-account", 10, timedelta(minutes=15), "Too many failed logins for this account"
)
LOGIN_FAILURES_PER_IP = Limit("login-ip", 50, timedelta(minutes=15), "Too many failed logins")
SIGN_UPS_PER_IP = Limit("register-ip", 20, timedelta(hours=1), "Too many sign-ups from here")
# Reset emails: also stops anyone using the form to flood someone's inbox.
RESETS_PER_EMAIL = Limit("reset-email", 3, timedelta(hours=1), "Too many reset emails")
RESETS_PER_IP = Limit("reset-ip", 10, timedelta(hours=1), "Too many reset emails")
EMAIL_CHANGES_PER_USER = Limit("email-change", 5, timedelta(hours=1), "Too many email changes")
# Wrong "current password" in Settings: a stolen, logged-in session mustn't be a way to guess it.
PASSWORD_CHECKS_PER_USER = Limit(
    "password-check", 10, timedelta(minutes=15), "Too many wrong passwords"
)


def client_ip(request: Request) -> str:
    """The client's address as uvicorn reports it (behind a proxy, from X-Forwarded-For).

    Behind a proxy that's trusted wholesale (--forwarded-allow-ips='*'), a client can put a fake
    address at the front of that header, so per-IP limits are a speed bump, not a wall. The
    per-account limits don't depend on it.
    """
    return request.client.host if request.client else "unknown"


def _key(limit: Limit, subject: str) -> str:
    return hashlib.sha256(f"{limit.name}:{subject.lower()}".encode()).hexdigest()


def _window(limit: Limit, now: datetime) -> datetime:
    seconds = limit.window.total_seconds()
    return datetime.fromtimestamp(now.timestamp() // seconds * seconds, UTC)


def _too_many(limit: Limit, now: datetime) -> HTTPException:
    retry = math.ceil((_window(limit, now) + limit.window - now).total_seconds())
    minutes = math.ceil(retry / 60)
    return HTTPException(
        status.HTTP_429_TOO_MANY_REQUESTS,
        f"{limit.message}. Try again in {minutes} minute{'s' if minutes != 1 else ''}.",
        headers={"Retry-After": str(retry)},
    )


def count(db: Session, limit: Limit, subject: str, now: datetime | None = None) -> int:
    now = now or _now()
    found = db.scalar(
        select(RateLimitCounter.count).where(
            RateLimitCounter.key == _key(limit, subject),
            RateLimitCounter.window_start == _window(limit, now),
        )
    )
    return found or 0


def hit(db: Session, limit: Limit, subject: str, now: datetime | None = None) -> int:
    """Count one more, and return the new total for this window. Doesn't commit."""
    now = now or _now()
    statement = insert(RateLimitCounter).values(
        key=_key(limit, subject), window_start=_window(limit, now), count=1
    )
    statement = statement.on_conflict_do_update(
        index_elements=[RateLimitCounter.key, RateLimitCounter.window_start],
        set_={"count": RateLimitCounter.count + 1},
    ).returning(RateLimitCounter.count)
    total = db.execute(statement).scalar_one()
    if random.random() < 0.01:  # now and then, tidy up windows nobody will ask about again
        db.execute(delete(RateLimitCounter).where(RateLimitCounter.window_start < now - KEEP_FOR))
    return total


def check(db: Session, limit: Limit, subject: str) -> None:
    """429 if `subject` has already used up `limit` this window (without counting this one)."""
    if not get_settings().rate_limit_enabled:
        return
    now = _now()
    if count(db, limit, subject, now) >= limit.max:
        raise _too_many(limit, now)


def consume(db: Session, limit: Limit, subject: str) -> None:
    """Count this attempt and commit it; 429 if it goes over the limit."""
    if not get_settings().rate_limit_enabled:
        return
    now = _now()
    total = hit(db, limit, subject, now)
    db.commit()  # counted even if the request then fails
    if total > limit.max:
        raise _too_many(limit, now)


def record_failure(db: Session, limit: Limit, subject: str) -> None:
    """Count a failure (a wrong password), committed. The caller then answers as usual."""
    if get_settings().rate_limit_enabled:
        hit(db, limit, subject)
        db.commit()


def clear(db: Session, limit: Limit, subject: str) -> None:
    """Forget this window's count (a successful login resets the account's failures)."""
    now = _now()
    db.execute(
        delete(RateLimitCounter).where(
            RateLimitCounter.key == _key(limit, subject),
            RateLimitCounter.window_start == _window(limit, now),
        )
    )
