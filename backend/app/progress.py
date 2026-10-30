"""Each person's own status and mark on a deadline, joined onto the shared deadline for the API.

A deadline in a shared course is one row everyone sees; whether it's done, and the mark, live in
assignment_progress, one row per (deadline, person). No row means "to do, not marked", so a new
member starts with a clean slate and nobody has to pre-create anything.
"""

from collections.abc import Iterable
from datetime import datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Assignment, AssignmentProgress, Status, User
from app.schemas.assignment import AssignmentRead

PROGRESS_FIELDS = frozenset({"status", "score", "out_of"})


def progress_of(
    db: Session, user: User, assignment_ids: Iterable[int]
) -> dict[int, AssignmentProgress]:
    ids = list(assignment_ids)
    if not ids:
        return {}
    rows = db.scalars(
        select(AssignmentProgress).where(
            AssignmentProgress.user_id == user.id, AssignmentProgress.assignment_id.in_(ids)
        )
    )
    return {row.assignment_id: row for row in rows}


def progress_row(db: Session, user: User, assignment: Assignment) -> AssignmentProgress:
    """This user's progress on `assignment`, created (unsaved) if they don't have one yet."""
    row = db.get(AssignmentProgress, (assignment.id, user.id))
    if row is None:
        row = AssignmentProgress(assignment_id=assignment.id, user_id=user.id, status=Status.TODO)
        db.add(row)
    return row


def apply_progress(row: AssignmentProgress, changes: dict) -> str | None:
    """Set status/score/out_of from `changes`; returns an error message if the mark is half-set."""
    for field in PROGRESS_FIELDS & changes.keys():
        setattr(row, field, changes[field])
    if (row.score is None) != (row.out_of is None):
        return "A mark needs both a score and what it's out of (e.g. 18 out of 20)"
    return None


def _mark(row: AssignmentProgress | None) -> tuple[Status, Decimal | None, Decimal | None]:
    if row is None:
        return Status.TODO, None, None
    return row.status, row.score, row.out_of


def to_read(assignment: Assignment, row: AssignmentProgress | None) -> AssignmentRead:
    status, score, out_of = _mark(row)
    # Last change to anything this person sees: the deadline itself, or their own progress on it.
    updated: datetime = max(assignment.updated_at, row.updated_at) if row else assignment.updated_at
    return AssignmentRead(
        id=assignment.id,
        course_id=assignment.course_id,
        title=assignment.title,
        description=assignment.description,
        kind=assignment.kind,
        due_at=assignment.due_at,
        priority=assignment.priority,
        status=status,
        series_id=assignment.series_id,
        weight=assignment.weight,
        score=score,
        out_of=out_of,
        created_at=assignment.created_at,
        updated_at=updated,
    )


def to_reads(db: Session, user: User, assignments: list[Assignment]) -> list[AssignmentRead]:
    rows = progress_of(db, user, (a.id for a in assignments))
    return [to_read(a, rows.get(a.id)) for a in assignments]
