from datetime import datetime
from enum import StrEnum

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, TimestampMixin
from app.models.assignment import str_enum


class EmailTokenPurpose(StrEnum):
    PASSWORD_RESET = "password_reset"
    EMAIL_CHANGE = "email_change"


class EmailToken(TimestampMixin, Base):
    """A single-use link sent by email: reset a password, or confirm a new email address.

    Like refresh tokens, only a SHA-256 hash is stored, so a database leak hands out no working
    links. Each one expires, and is spent the moment it's used.
    """

    __tablename__ = "email_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    purpose: Mapped[EmailTokenPurpose] = mapped_column(
        str_enum(EmailTokenPurpose, "email_token_purpose")
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    # For an email change: the address being confirmed. It only replaces the old one once the
    # link sent *to it* is clicked, which proves the person owns it.
    new_email: Mapped[str | None] = mapped_column(String(320))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
