from datetime import UTC, datetime, timedelta
from functools import cache

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


def create_access_token(user_id: int) -> str:
    settings = get_settings()
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),  # JWT spec: "sub" is a string
        "iat": now,
        "exp": now + timedelta(minutes=settings.access_token_expire_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> int | None:
    """Return the user id from a valid token, or None if it is invalid, tampered with or expired."""
    settings = get_settings()
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret_key,
            # Pin the algorithm: never let the token's own header choose it (e.g. "none").
            algorithms=[settings.jwt_algorithm],
            options={"require": ["exp", "sub"]},
        )
        return int(payload["sub"])
    except (jwt.InvalidTokenError, ValueError):
        return None
