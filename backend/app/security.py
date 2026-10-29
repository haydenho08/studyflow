import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from functools import cache
from typing import NamedTuple

import bcrypt
import jwt

from app.config import get_settings

# bcrypt only looks at the first 72 bytes of a password. bcrypt>=5 raises on longer input.
BCRYPT_MAX_BYTES = 72


def hash_password(password: str) -> str:
    salt = bcrypt.gensalt(rounds=get_settings().bcrypt_rounds)
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("ascii")


def verify_password(password: str, hashed_password: str) -> bool:
    password_bytes = password.encode("utf-8")
    if len(password_bytes) > BCRYPT_MAX_BYTES:
        return False  # Could never have been registered (UserCreate rejects it).
    return bcrypt.checkpw(password_bytes, hashed_password.encode("ascii"))


@cache
def dummy_password_hash() -> str:
    """A real hash to verify against when the email is unknown.

    Login then costs one bcrypt check whether or not the account exists, so response time
    doesn't reveal which emails are registered.
    """
    return hash_password("not-a-real-password")


class AccessClaims(NamedTuple):
    user_id: int
    session_id: int


def create_access_token(user_id: int, session_id: int) -> str:
    settings = get_settings()
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),  # JWT spec: "sub" is a string
        "sid": session_id,  # the login it belongs to, so logging out revokes it at once
        "iat": now,
        "exp": now + timedelta(minutes=settings.access_token_expire_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> AccessClaims | None:
    """Return who a token is for, or None if it is invalid, tampered with or expired."""
    settings = get_settings()
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret_key,
            # Pin the algorithm: never let the token's own header choose it (e.g. "none").
            algorithms=[settings.jwt_algorithm],
            options={"require": ["exp", "sub", "sid"]},
        )
        return AccessClaims(int(payload["sub"]), int(payload["sid"]))
    except (jwt.InvalidTokenError, ValueError, TypeError):
        return None


def new_refresh_token() -> str:
    return secrets.token_urlsafe(32)  # 256 bits from the OS's secure random source


def hash_refresh_token(token: str) -> str:
    """SHA-256, not bcrypt: bcrypt is slow to make guessing *weak* passwords expensive, but a
    256-bit random token can't be guessed anyway, and every refresh has to look one up."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
