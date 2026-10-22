from datetime import datetime
from enum import StrEnum
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, TimestampMixin
from app.models.enums import AssignmentKind, Priority, Status

if TYPE_CHECKING:
    from app.models.course import Course


def _str_enum(enum_cls: type[StrEnum], name: str) -> Enum:
    """Store an enum as VARCHAR + CHECK constraint rather than a native Postgres ENUM type.

    Native enums need ALTER TYPE migrations to add values; a CHECK constraint is easier to
    evolve. values_callable stores the lowercase values ("in_progress"), not the member names.
    """
    return Enum(
        enum_cls,
        name=name,
        native_enum=False,
        create_constraint=True,
        length=20,
        values_callable=lambda members: [m.value for m in members],
    )


class Assignment(TimestampMixin, Base):
    __tablename__ = "assignments"
    # Covers "this course's assignments, ordered by due date"; also serves lookups by course_id alone.
    __table_args__ = (Index("ix_assignments_course_id_due_at", "course_id", "due_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    # Ownership comes from the course: there is deliberately no user_id column here.
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    kind: Mapped[AssignmentKind] = mapped_column(
        _str_enum(AssignmentKind, "assignment_kind"), server_default=AssignmentKind.ASSIGNMENT.value
    )
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    priority: Mapped[Priority] = mapped_column(
        _str_enum(Priority, "priority"), server_default=Priority.MEDIUM.value
    )
    status: Mapped[Status] = mapped_column(
        _str_enum(Status, "status"), server_default=Status.TODO.value
    )

    course: Mapped["Course"] = relationship(back_populates="assignments")
