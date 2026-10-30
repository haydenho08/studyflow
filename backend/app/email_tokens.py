"""Issuing and spending the single-use links that password reset and email changes send."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models import EmailToken, EmailTokenPurpose, User
from app.security import hash_token, is_url_token, new_url_token

LIFETIME = {
    EmailTokenPurpose.PASSWORD_RESET: timedelta(hours=1),
    EmailTokenPurpose.EMAIL_CHANGE: timedelta(hours=24),
}


def issue(db: Session, user: User, purpose: EmailTokenPurpose, new_email: str | None = None) -> str:
    """A fresh link token. Any earlier unused one for the same purpose stops working: only the
    newest email in someone's inbox is live."""
    now = datetime.now(UTC)
    spend_all(db, user, purpose, now)
    token = new_url_token()
    db.add(
        EmailToken(
            user_id=user.id,
            purpose=purpose,
            token_hash=hash_token(token),
            new_email=new_email,
            expires_at=now + LIFETIME[purpose],
        )
    )
    return token


def spend(db: Session, token: str, purpose: EmailTokenPurpose) -> EmailToken | None:
    """The token's row, marked used, if it's real, unused, unexpired and for this purpose."""
    if not is_url_token(token):
        return None
    now = datetime.now(UTC)
    row = db.scalar(
        select(EmailToken)
        .where(
            EmailToken.token_hash == hash_token(token),
            EmailToken.purpose == purpose,
            EmailToken.used_at.is_(None),
            EmailToken.expires_at > now,
        )
        # Two clicks at once must not both succeed.
        .with_for_update()
    )
    if row is not None:
        row.used_at = now
    return row


def spend_all(
    db: Session, user: User, purpose: EmailTokenPurpose, now: datetime | None = None
) -> None:
    db.execute(
        update(EmailToken)
        .where(
            EmailToken.user_id == user.id,
            EmailToken.purpose == purpose,
            EmailToken.used_at.is_(None),
        )
        .values(used_at=now or datetime.now(UTC))
    )
