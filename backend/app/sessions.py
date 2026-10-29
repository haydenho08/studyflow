"""Logins as database rows: start one, swap its refresh token for a new one, or revoke it.

The browser holds two tokens:
- a short-lived **access token** (JWT, 15 minutes), kept in the page's memory and sent as a Bearer
  header. Not in localStorage, so a malicious script can't read it out of storage;
- a long-lived **refresh token** in an httpOnly cookie that no script can read at all. Its only
  use is getting a new access token from POST /api/auth/refresh.

Every refresh **rotates** the refresh token: the old one stops working. If an old one turns up
again, two copies exist and one of them was stolen, so the whole session is revoked.
"""

from datetime import UTC, datetime, timedelta
from typing import NamedTuple

from sqlalchemy import delete, or_, select, update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import AuthSession, User
from app.security import create_access_token, hash_refresh_token, new_refresh_token


class IssuedTokens(NamedTuple):
    access_token: str
    refresh_token: str


def _lifetime() -> timedelta:
    return timedelta(days=get_settings().refresh_token_expire_days)


def start_session(db: Session, user: User) -> IssuedTokens:
    now = datetime.now(UTC)
    # Tidy up this user's dead logins while we're here, so the table doesn't grow forever.
    db.execute(
        delete(AuthSession).where(
            AuthSession.user_id == user.id,
            or_(AuthSession.revoked_at.is_not(None), AuthSession.expires_at <= now),
        )
    )
    refresh_token = new_refresh_token()
    session = AuthSession(
        user_id=user.id,
        refresh_token_hash=hash_refresh_token(refresh_token),
        expires_at=now + _lifetime(),
    )
    db.add(session)
    db.commit()
    return IssuedTokens(create_access_token(user.id, session.id), refresh_token)


def rotate_session(db: Session, refresh_token: str) -> IssuedTokens | None:
    """Swap a refresh token for a new pair of tokens, or None if it no longer works."""
    now = datetime.now(UTC)
    # Hashing first also means odd input (a NUL byte, say) never reaches the database.
    digest = hash_refresh_token(refresh_token)
    session = db.scalar(
        select(AuthSession)
        .where(
            or_(AuthSession.refresh_token_hash == digest, AuthSession.previous_token_hash == digest)
        )
        # Lock the row: two refreshes racing with one token must not both succeed.
        .with_for_update()
    )
    if session is None or not session.is_active(now):
        return None
    if session.refresh_token_hash != digest:
        # Already swapped for a newer token, yet here it is again: whoever holds the other copy
        # isn't who it was issued to. Log the session out everywhere it's in use.
        session.revoked_at = now
        db.commit()
        return None

    new_token = new_refresh_token()
    session.previous_token_hash = digest
    session.refresh_token_hash = hash_refresh_token(new_token)
    session.expires_at = now + _lifetime()  # in use, so it stays alive
    db.commit()
    return IssuedTokens(create_access_token(session.user_id, session.id), new_token)


def revoke_session(db: Session, refresh_token: str) -> None:
    digest = hash_refresh_token(refresh_token)
    db.execute(
        update(AuthSession)
        .where(AuthSession.refresh_token_hash == digest, AuthSession.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC))
    )
    db.commit()


def revoke_all_sessions(db: Session, user: User) -> None:
    db.execute(
        update(AuthSession)
        .where(AuthSession.user_id == user.id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC))
    )
    db.commit()
