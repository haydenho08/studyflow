from typing import TYPE_CHECKING

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.course import Course


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Always stored lowercased (see schemas.auth), so the unique constraint is case-insensitive in practice.
    email: Mapped[str] = mapped_column(String(320), unique=True)
    hashed_password: Mapped[str] = mapped_column(String(255))

    # passive_deletes: let the database's ON DELETE CASCADE remove children instead of the ORM.
    courses: Mapped[list["Course"]] = relationship(
        back_populates="user", cascade="all, delete-orphan", passive_deletes=True
    )
