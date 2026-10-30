"""Account settings: change password or email, reset a forgotten password, delete the account."""

from datetime import UTC, datetime

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, Response, status
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.demo import DEMO_EMAIL
from app.deps import CurrentSession, CurrentUser, DbSession
from app.email_tokens import issue, spend, spend_all
from app.mail import send_mail
from app.models import AuthSession, EmailTokenPurpose, User
from app.ratelimit import (
    EMAIL_CHANGES_PER_USER,
    PASSWORD_CHECKS_PER_USER,
    RESETS_PER_EMAIL,
    RESETS_PER_IP,
    check,
    client_ip,
    consume,
    record_failure,
)
from app.routers.auth import clear_refresh_cookie
from app.schemas.auth import (
    AccountDelete,
    EmailChange,
    EmailConfirm,
    PasswordChange,
    PasswordReset,
    PasswordResetRequest,
    UserRead,
)
from app.security import hash_password, verify_password
from app.sessions import revoke_all_sessions

router = APIRouter(prefix="/account", tags=["account"])


def _require_email() -> None:
    if not get_settings().email_enabled:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Email isn't set up on this server"
        )


def _not_the_demo(user: User) -> None:
    # Everyone shares the demo account: nobody gets to lock the others out of it.
    if user.email == DEMO_EMAIL:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "The demo account can't be changed")


def _check_password(db: Session, user: User, password: str) -> None:
    """403 for a wrong password, and only a few tries: someone holding a stolen, logged-in
    session mustn't be able to guess the password through these forms."""
    check(db, PASSWORD_CHECKS_PER_USER, str(user.id))
    if not verify_password(password, user.hashed_password):
        record_failure(db, PASSWORD_CHECKS_PER_USER, str(user.id))
        raise HTTPException(status.HTTP_403_FORBIDDEN, "That isn't your current password")


def _link(request: Request, page: str, token: str) -> str:
    """A link to a page of the app. The token goes after "#": a URL fragment never leaves the
    browser, so it isn't sent to the server, kept in access logs, or passed on as a Referer."""
    base = (get_settings().public_url or str(request.base_url)).rstrip("/")
    return f"{base}/{page}#token={token}"


@router.post("/password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(payload: PasswordChange, db: DbSession, session: CurrentSession) -> None:
    """New password. Every *other* login is ended (this device stays in), as are any reset links."""
    user = session.user
    _not_the_demo(user)
    _check_password(db, user, payload.current_password)
    user.hashed_password = hash_password(payload.new_password)
    db.execute(
        update(AuthSession)
        .where(
            AuthSession.user_id == user.id,
            AuthSession.id != session.id,
            AuthSession.revoked_at.is_(None),
        )
        .values(revoked_at=datetime.now(UTC))
    )
    spend_all(db, user, EmailTokenPurpose.PASSWORD_RESET)
    db.commit()


@router.post("/email", status_code=status.HTTP_202_ACCEPTED)
def change_email(
    payload: EmailChange,
    db: DbSession,
    user: CurrentUser,
    request: Request,
    background: BackgroundTasks,
) -> dict[str, str]:
    """Send a confirmation link to the new address. Nothing changes until it's clicked."""
    _require_email()
    _not_the_demo(user)
    _check_password(db, user, payload.password)
    consume(db, EMAIL_CHANGES_PER_USER, str(user.id))
    if payload.new_email == user.email:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "That's already your email")
    if db.scalar(select(User.id).where(User.email == payload.new_email)) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Another account uses that email")
    token = issue(db, user, EmailTokenPurpose.EMAIL_CHANGE, new_email=payload.new_email)
    db.commit()
    background.add_task(
        send_mail,
        payload.new_email,
        "Confirm your new StudyFlow email",
        "Someone (hopefully you) asked to use this address for their StudyFlow account.\n\n"
        f"Confirm it here: {_link(request, 'confirm-email', token)}\n\n"
        "The link works once, for 24 hours. If this wasn't you, ignore this email.",
    )
    return {"detail": f"We sent a confirmation link to {payload.new_email}"}


@router.post("/email/confirm", response_model=UserRead)
def confirm_email(payload: EmailConfirm, db: DbSession, background: BackgroundTasks) -> User:
    """The link from the email. Needs no login: the token is the proof, and it can be opened on
    whichever device the email arrived on."""
    row = spend(db, payload.token, EmailTokenPurpose.EMAIL_CHANGE)
    user = db.get(User, row.user_id) if row is not None else None
    if row is None or user is None or row.new_email is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This link has expired or was already used")
    old_email, user.email = user.email, row.new_email
    try:
        db.commit()
    except IntegrityError:  # someone signed up with that address since the link was sent
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Another account uses that email") from None
    # Tell the old address too: if this wasn't them, they hear about it.
    background.add_task(
        send_mail,
        old_email,
        "Your StudyFlow email was changed",
        f"Your StudyFlow account now uses {user.email} instead of this address.\n\n"
        "If you didn't do this, reset your password straight away.",
    )
    return user


@router.post("/password-reset", status_code=status.HTTP_202_ACCEPTED)
def request_password_reset(
    payload: PasswordResetRequest,
    db: DbSession,
    request: Request,
    background: BackgroundTasks,
) -> dict[str, str]:
    """Email a reset link. The answer is the same whether or not the account exists, so this
    can't be used to find out who has one (the limits, too, apply to any address)."""
    _require_email()
    consume(db, RESETS_PER_IP, client_ip(request))
    consume(db, RESETS_PER_EMAIL, payload.email)
    user = db.scalar(select(User).where(User.email == payload.email))
    if user is not None and user.email != DEMO_EMAIL:
        token = issue(db, user, EmailTokenPurpose.PASSWORD_RESET)
        db.commit()
        background.add_task(
            send_mail,
            user.email,
            "Reset your StudyFlow password",
            "Someone (hopefully you) asked to reset the password for this StudyFlow account.\n\n"
            f"Choose a new one here: {_link(request, 'reset-password', token)}\n\n"
            "The link works once, for an hour. If this wasn't you, ignore this email: your "
            "password hasn't changed.",
        )
    return {"detail": "If that email has an account, we've sent it a reset link"}


@router.post("/password-reset/confirm", status_code=status.HTTP_204_NO_CONTENT)
def reset_password(payload: PasswordReset, db: DbSession) -> None:
    """Set a new password from a reset link, and log out every device: if someone else had
    the old password, they're out too."""
    row = spend(db, payload.token, EmailTokenPurpose.PASSWORD_RESET)
    user = db.get(User, row.user_id) if row is not None else None
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This link has expired or was already used")
    user.hashed_password = hash_password(payload.new_password)
    revoke_all_sessions(db, user)  # commits


@router.post("/delete", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(
    payload: AccountDelete, db: DbSession, user: CurrentUser, response: Response
) -> None:
    """Delete the account and everything in it. Courses you own go for their members too; your
    progress in courses you joined goes, but those courses stay for everyone else.

    POST, not DELETE: it needs the password in a body, and DELETE bodies get dropped by some
    proxies and clients.
    """
    _not_the_demo(user)
    _check_password(db, user, payload.password)
    db.delete(user)  # ON DELETE CASCADE does the rest
    db.commit()
    clear_refresh_cookie(response)
