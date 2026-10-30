from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.course import Course


class StudySession(TimestampMixin, Base):
    """A block of focused study time on one course (e.g. one completed Pomodoro)."""

    __tablename__ = "study_sessions"
    __table_args__ = (
        # The database refuses zero-length or backwards sessions, whatever code inserts them.
        CheckConstraint("ended_at > started_at", name="ended_after_started"),
        # Serves "this course's sessions in a date range" and the weekly stats query.
        Index("ix_study_sessions_course_id_started_at", "course_id", "started_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # Who studied. Not implied by the course: in a shared course, everyone logs their own time.
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    course: Mapped["Course"] = relationship(back_populates="study_sessions")
