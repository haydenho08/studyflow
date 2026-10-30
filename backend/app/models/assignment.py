import uuid
from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, TimestampMixin
from app.models.enums import AssignmentKind, Priority

if TYPE_CHECKING:
    from app.models.assignment_progress import AssignmentProgress
    from app.models.course import Course


def str_enum(enum_cls: type[StrEnum], name: str) -> Enum:
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
    # Covers "this course's assignments, ordered by due date";
    # also serves lookups by course_id alone.
    __table_args__ = (
        Index("ix_assignments_course_id_due_at", "course_id", "due_at"),
        # The database refuses nonsense whatever code writes it.
        CheckConstraint("weight > 0 AND weight <= 100", name="weight_is_a_percentage"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # Access comes from the course (its owner and members): there is no user_id column here.
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    kind: Mapped[AssignmentKind] = mapped_column(
        str_enum(AssignmentKind, "assignment_kind"), server_default=AssignmentKind.ASSIGNMENT.value
    )
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    priority: Mapped[Priority] = mapped_column(
        str_enum(Priority, "priority"), server_default=Priority.MEDIUM.value
    )
    # Deadlines created together as a repeating series share this id ("Lab {n}" every Friday),
    # so they can be edited or deleted "from this one onwards". None for one-off deadlines.
    series_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, index=True)
    # How much of the course this is worth: the same for everyone taking it. (Each person's own
    # status and mark are in assignment_progress.) Numeric, not float: 7.5% is exactly 7.5.
    weight: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))  # percent of the course

    course: Mapped["Course"] = relationship(back_populates="assignments")
    progress: Mapped[list["AssignmentProgress"]] = relationship(
        back_populates="assignment", cascade="all, delete-orphan", passive_deletes=True
    )
