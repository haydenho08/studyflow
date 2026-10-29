from typing import Annotated

from fastapi import APIRouter, Body, Cookie, Depends, HTTPException, Response, status
from fastapi.responses import JSONResponse
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.config import get_settings
from app.demo import ensure_fresh_demo
from app.deps import CurrentUser, DbSession, SameOrigin
from app.models import User
from app.schemas.auth import DemoLogin, Token, UserCreate, UserRead
from app.security import dummy_password_hash, hash_password, verify_password
from app.sessions import (
    IssuedTokens,
    revoke_all_sessions,
    revoke_session,
    rotate_session,
    start_session,
)
from app.zones import parse_timezone

router = APIRouter(prefix="/auth", tags=["auth"])

REFRESH_COOKIE = "studyflow_refresh"
# Sent only to the auth routes below, not with every API call.
REFRESH_COOKIE_PATH = "/api/auth"

RefreshCookie = Annotated[str | None, Cookie(alias=REFRESH_COOKIE)]


def _issue(response: Response, tokens: IssuedTokens) -> Token:
    """The access token goes in the body; the refresh token in a cookie no script can read."""
    settings = get_settings()
    response.set_cookie(
        REFRESH_COOKIE,
        tokens.refresh_token,
        max_age=settings.refresh_token_expire_days * 24 * 60 * 60,
        path=REFRESH_COOKIE_PATH,
        httponly=True,  # invisible to JavaScript, so an injected script can't steal it
        secure=settings.auth_cookie_secure,  # HTTPS only
        samesite="strict",  # never sent on requests started by another site (CSRF)
    )
    return Token(access_token=tokens.access_token)


def _clear_cookie(response: Response) -> None:
    settings = get_settings()
    response.delete_cookie(
        REFRESH_COOKIE,
        path=REFRESH_COOKIE_PATH,
        httponly=True,
        secure=settings.auth_cookie_secure,
        samesite="strict",
    )


@router.post("/register", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def register(payload: UserCreate, db: DbSession) -> User:
    user = User(email=payload.email, hashed_password=hash_password(payload.password))
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        # Rely on the unique constraint rather than a "check then insert", which would race.
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Email is already registered") from None
    return user


@router.post("/login", response_model=Token, dependencies=[SameOrigin])
def login(
    form: Annotated[OAuth2PasswordRequestForm, Depends()], db: DbSession, response: Response
) -> Token:
    # OAuth2's password flow calls the field "username"; for us it holds the email.
    email = form.username.strip().lower()
    user = db.scalar(select(User).where(User.email == email))
    hashed = user.hashed_password if user else dummy_password_hash()
    password_ok = verify_password(form.password, hashed)
    if user is None or not password_ok:
        # Same message for "no such user" and "wrong password": don't reveal which emails exist.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return _issue(response, start_session(db, user))


@router.post("/demo", response_model=Token, dependencies=[SameOrigin])
def demo_login(
    db: DbSession, response: Response, payload: Annotated[DemoLogin | None, Body()] = None
) -> Token:
    """Log in as the shared demo account, rebuilding its data first if it's over an hour old."""
    if not get_settings().demo_enabled:
        # Behave exactly like a route that doesn't exist.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not Found")
    zone = parse_timezone((payload or DemoLogin()).tz)
    user = ensure_fresh_demo(db, zone)
    return _issue(response, start_session(db, user))


@router.post("/refresh", response_model=Token, dependencies=[SameOrigin])
def refresh(
    db: DbSession, response: Response, refresh_token: RefreshCookie = None
) -> Token | JSONResponse:
    """Swap the refresh cookie for a new access token (and a new refresh cookie).

    The app calls this when it loads, and whenever its 15-minute access token runs out.
    """
    tokens = rotate_session(db, refresh_token) if refresh_token else None
    if tokens is None:
        # Not raised: an HTTPException would drop the cookie deletion along with `response`.
        failed = JSONResponse({"detail": "Not logged in"}, status.HTTP_401_UNAUTHORIZED)
        _clear_cookie(failed)
        return failed
    return _issue(response, tokens)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, dependencies=[SameOrigin])
def logout(db: DbSession, response: Response, refresh_token: RefreshCookie = None) -> None:
    """End this device's session. Its access token stops working at once, too."""
    if refresh_token:
        revoke_session(db, refresh_token)
    _clear_cookie(response)


@router.post("/logout-all", status_code=status.HTTP_204_NO_CONTENT)
def logout_everywhere(user: CurrentUser, db: DbSession, response: Response) -> None:
    """End every session this account has, on every device: for a lost laptop or a leaked token."""
    revoke_all_sessions(db, user)
    _clear_cookie(response)


@router.get("/me", response_model=UserRead)
def read_me(user: CurrentUser) -> User:
    return user
