from typing import TYPE_CHECKING

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.auth_session import AuthSession
    from app.models.course import Course


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Always stored lowercased (see schemas.auth), so the unique constraint is
    # case-insensitive in practice.
    email: Mapped[str] = mapped_column(String(320), unique=True)
    hashed_password: Mapped[str] = mapped_column(String(255))
    # Secret for the read-only calendar feed (/api/calendar/<token>.ics); None while it's off.
    # Calendar apps can't send a login header, so the URL itself is the credential.
    calendar_token: Mapped[str | None] = mapped_column(String(64), unique=True)

    # passive_deletes: let the database's ON DELETE CASCADE remove children instead of the ORM.
    courses: Mapped[list["Course"]] = relationship(
        back_populates="user", cascade="all, delete-orphan", passive_deletes=True
    )
    sessions: Mapped[list["AuthSession"]] = relationship(
        back_populates="user", cascade="all, delete-orphan", passive_deletes=True
    )
