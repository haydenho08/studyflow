from typing import Annotated

from fastapi import APIRouter, Body, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.config import get_settings
from app.demo import ensure_fresh_demo
from app.deps import CurrentUser, DbSession
from app.models import User
from app.schemas.auth import DemoLogin, Token, UserCreate, UserRead
from app.security import create_access_token, dummy_password_hash, hash_password, verify_password
from app.zones import parse_timezone

router = APIRouter(prefix="/auth", tags=["auth"])


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


@router.post("/login", response_model=Token)
def login(form: Annotated[OAuth2PasswordRequestForm, Depends()], db: DbSession) -> Token:
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
    return Token(access_token=create_access_token(user.id))


@router.post("/demo", response_model=Token)
def demo_login(db: DbSession, payload: Annotated[DemoLogin | None, Body()] = None) -> Token:
    """Log in as the shared demo account, rebuilding its data first if it's over an hour old."""
    if not get_settings().demo_enabled:
        # Behave exactly like a route that doesn't exist.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not Found")
    zone = parse_timezone((payload or DemoLogin()).tz)
    user = ensure_fresh_demo(db, zone)
    return Token(access_token=create_access_token(user.id))


@router.get("/me", response_model=UserRead)
def read_me(user: CurrentUser) -> User:
    return user
