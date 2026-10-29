from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.user import User


class AuthSession(TimestampMixin, Base):
    """One login on one device: the refresh token in its cookie, and whether it's still valid.

    Access tokens name their session ("sid"), so revoking a session logs that device out at once,
    not when its access token happens to expire.
    """

    __tablename__ = "auth_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    # SHA-256 of the refresh token, never the token itself: a database leak can't log anyone in.
    refresh_token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    # The token it replaced. Seeing that one again means two copies exist: one was stolen.
    previous_token_hash: Mapped[str | None] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    user: Mapped["User"] = relationship(back_populates="sessions")

    def is_active(self, now: datetime) -> bool:
        return self.revoked_at is None and self.expires_at > now
