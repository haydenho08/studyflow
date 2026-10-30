from datetime import UTC, datetime
from typing import Annotated
from urllib.parse import urlsplit

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import AuthSession, User
from app.security import decode_access_token

# tokenUrl tells Swagger's "Authorize" button where to send the login form.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

DbSession = Annotated[Session, Depends(get_db)]


def get_current_session(
    db: DbSession, token: Annotated[str, Depends(oauth2_scheme)]
) -> AuthSession:
    """The live login this request's access token belongs to (its user is session.user)."""
    claims = decode_access_token(token)
    session = db.get(AuthSession, claims.session_id) if claims is not None else None
    # A valid signature isn't enough: the login it came from must still be live. That's what
    # makes "Log out" and "Log out everywhere" take effect immediately.
    if (
        claims is None
        or session is None
        or session.user_id != claims.user_id
        or not session.is_active(datetime.now(UTC))
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return session


CurrentSession = Annotated[AuthSession, Depends(get_current_session)]


def get_current_user(session: CurrentSession) -> User:
    return session.user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_same_origin(request: Request) -> None:
    """CSRF protection for the routes that read or set the refresh cookie.

    The cookie is SameSite=Strict, so browsers already leave it off requests started by other
    sites. As a second layer, refuse any request whose Origin header names another site.
    Browsers send Origin on every POST; a request without one (curl, a script, the tests) isn't
    coming from a browser, so there's no logged-in victim to trick.

    Bearer-token routes need none of this: a forged request can't attach the token, which lives
    only in the app's memory.
    """
    origin = request.headers.get("origin")
    if origin is None:
        return
    allowed = {
        request.headers.get("host"),
        *(urlsplit(o).netloc for o in get_settings().cors_origins),
    }
    if urlsplit(origin).netloc not in allowed:  # includes "null", from sandboxed frames
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Cross-site request refused")


SameOrigin = Depends(require_same_origin)
