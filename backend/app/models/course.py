from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.assignment import Assignment
    from app.models.study_session import StudySession
    from app.models.user import User


class Course(TimestampMixin, Base):
    __tablename__ = "courses"
    # One user can't have two courses with the same code; different users can.
    __table_args__ = (UniqueConstraint("user_id", "code"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    code: Mapped[str] = mapped_column(String(20))
    color: Mapped[str] = mapped_column(String(7))  # "#RRGGBB"
    # Secret for the invite link (/join/<token>); None while sharing is off. Like the calendar
    # feed, the URL itself is the credential, and replacing it stops the old link at once.
    invite_token: Mapped[str | None] = mapped_column(String(64), unique=True)

    user: Mapped["User"] = relationship(back_populates="courses")
    assignments: Mapped[list["Assignment"]] = relationship(
        back_populates="course", cascade="all, delete-orphan", passive_deletes=True
    )
    study_sessions: Mapped[list["StudySession"]] = relationship(
        back_populates="course", cascade="all, delete-orphan", passive_deletes=True
    )
