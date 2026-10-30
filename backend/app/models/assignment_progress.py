from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, ForeignKey, Numeric
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, TimestampMixin
from app.models.assignment import str_enum
from app.models.enums import Status

if TYPE_CHECKING:
    from app.models.assignment import Assignment


class AssignmentProgress(TimestampMixin, Base):
    """One person's progress on one deadline: its status and their mark.

    A deadline in a shared course is the same for everyone (title, due date, weight), but whether
    it's done, and what you got, is yours alone. No row means "to do, not marked".
    """

    __tablename__ = "assignment_progress"
    __table_args__ = (
        CheckConstraint("score >= 0", name="score_not_negative"),
        CheckConstraint("out_of > 0", name="out_of_positive"),
        CheckConstraint("(score IS NULL) = (out_of IS NULL)", name="score_has_out_of"),
    )

    assignment_id: Mapped[int] = mapped_column(
        ForeignKey("assignments.id", ondelete="CASCADE"), primary_key=True
    )
    # Also indexed on its own (the primary key starts with assignment_id): "this user's progress".
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    status: Mapped[Status] = mapped_column(
        str_enum(Status, "status"), server_default=Status.TODO.value
    )
    score: Mapped[Decimal | None] = mapped_column(Numeric(7, 2))
    out_of: Mapped[Decimal | None] = mapped_column(Numeric(7, 2))

    assignment: Mapped["Assignment"] = relationship(back_populates="progress")
