import uuid
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response, status
from pydantic import AwareDatetime
from sqlalchemy import and_, func, select

from app.deps import CurrentUser, DbSession
from app.models import Assignment, AssignmentKind, AssignmentProgress, Priority, Status
from app.ownership import get_assignment, get_course, visible_course_ids
from app.progress import PROGRESS_FIELDS, apply_progress, progress_row, to_read, to_reads
from app.recurrence import RecurrenceError, number_title, shift_wall_clock, weekly_due_dates
from app.schemas.assignment import (
    AssignmentCreate,
    AssignmentRead,
    AssignmentSeriesCreate,
    AssignmentUpdate,
)
from app.zones import parse_timezone

router = APIRouter(prefix="/assignments", tags=["assignments"])


def _unprocessable(message: str) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, message)


@router.get("", response_model=list[AssignmentRead])
def list_assignments(
    db: DbSession,
    user: CurrentUser,
    course_id: int | None = None,
    # Repeatable: ?status=todo&status=in_progress means "todo OR in_progress" (i.e. not done).
    status_: Annotated[list[Status] | None, Query(alias="status")] = None,
    priority: Priority | None = None,
    kind: AssignmentKind | None = None,
    due_from: Annotated[
        AwareDatetime | None, Query(description="Inclusive lower bound on due_at")
    ] = None,
    due_to: Annotated[
        AwareDatetime | None, Query(description="Exclusive upper bound on due_at")
    ] = None,
) -> list[AssignmentRead]:
    if due_from is not None and due_to is not None and due_from >= due_to:
        raise _unprocessable("due_from must be before due_to")

    query = (
        select(Assignment)
        .where(Assignment.course_id.in_(visible_course_ids(user)))  # the access filter
        .order_by(Assignment.due_at, Assignment.id)
    )
    if course_id is not None:
        query = query.where(Assignment.course_id == course_id)
    if status_:
        # Status is per person: join *this user's* progress, where no row means "todo".
        mine = and_(
            AssignmentProgress.assignment_id == Assignment.id,
            AssignmentProgress.user_id == user.id,
        )
        their_status = func.coalesce(AssignmentProgress.status, Status.TODO.value)
        query = query.outerjoin(AssignmentProgress, mine).where(their_status.in_(status_))
    if priority is not None:
        query = query.where(Assignment.priority == priority)
    if kind is not None:
        query = query.where(Assignment.kind == kind)
    # Half-open range [due_from, due_to): consecutive weeks never double-count a deadline.
    if due_from is not None:
        query = query.where(Assignment.due_at >= due_from)
    if due_to is not None:
        query = query.where(Assignment.due_at < due_to)
    return to_reads(db, user, list(db.scalars(query)))


@router.post("", response_model=AssignmentRead, status_code=status.HTTP_201_CREATED)
def create_assignment(
    payload: AssignmentCreate, db: DbSession, user: CurrentUser
) -> AssignmentRead:
    get_course(db, user, payload.course_id)  # 404 unless it's yours or you've joined it
    assignment = Assignment(**payload.model_dump(exclude=PROGRESS_FIELDS))
    db.add(assignment)
    db.flush()
    row = None
    if payload.status != Status.TODO or payload.score is not None:
        row = progress_row(db, user, assignment)
        apply_progress(row, payload.model_dump(include=PROGRESS_FIELDS))
    db.commit()
    db.refresh(assignment)
    if row is not None:
        db.refresh(row)
    return to_read(assignment, row)


@router.post("/series", response_model=list[AssignmentRead], status_code=status.HTTP_201_CREATED)
def create_series(
    payload: AssignmentSeriesCreate, db: DbSession, user: CurrentUser
) -> list[AssignmentRead]:
    """Create a weekly repeating deadline: one row per due date, all sharing a series_id."""
    get_course(db, user, payload.course_id)
    rule = payload.repeat
    zone = parse_timezone(rule.time_zone)
    try:
        due_dates = weekly_due_dates(
            payload.due_at, zone, set(rule.weekdays), rule.every_weeks, rule.count, rule.until
        )
    except RecurrenceError as error:
        raise _unprocessable(str(error)) from None

    series_id = uuid.uuid4()
    shared = payload.model_dump(exclude={"repeat", "title", "due_at", *PROGRESS_FIELDS})
    rows = [
        Assignment(**shared, title=number_title(payload.title, n), due_at=due, series_id=series_id)
        for n, due in enumerate(due_dates, start=1)
    ]
    db.add_all(rows)
    db.flush()
    if payload.status != Status.TODO:
        for row in rows:
            progress_row(db, user, row).status = payload.status
    db.commit()
    return to_reads(db, user, rows)


def _this_and_following(db: DbSession, user: CurrentUser, assignment: Assignment):
    """The assignment and the later deadlines of its series, each with its number in the series
    (1-based, counting the earlier ones too). A one-off deadline is a series of one."""
    if assignment.series_id is None:
        return [(1, assignment)]
    series = list(
        db.scalars(
            select(Assignment)
            .where(
                Assignment.course_id.in_(visible_course_ids(user)),
                Assignment.series_id == assignment.series_id,
            )
            .order_by(Assignment.due_at, Assignment.id)
        )
    )
    start = series.index(assignment)
    return list(enumerate(series, start=1))[start:]


@router.patch("/{assignment_id}/following", response_model=list[AssignmentRead])
def update_following(
    assignment_id: int,
    payload: AssignmentUpdate,
    db: DbSession,
    user: CurrentUser,
    tz: Annotated[str, Query(max_length=64, description="Time zone the due-time change is in")],
) -> list[AssignmentRead]:
    """Change this deadline and every later one in its series.

    A new due_at moves each of them by the same wall-clock change (e.g. "Fridays 23:59" to
    "Mondays 09:00"), and "{n}" in a new title is numbered by position in the series.
    """
    zone = parse_timezone(tz)
    assignment = get_assignment(db, user, assignment_id)
    changes = payload.model_dump(exclude_unset=True)
    if PROGRESS_FIELDS & changes.keys():
        raise _unprocessable("Status and marks are set one deadline at a time")
    if "course_id" in changes:
        get_course(db, user, changes["course_id"])
    title = changes.pop("title", None)
    new_due = changes.pop("due_at", None)
    old_due = assignment.due_at  # read before the loop moves it

    numbered = _this_and_following(db, user, assignment)
    targets = [member for _, member in numbered]
    for n, member in numbered:
        for field, value in changes.items():
            setattr(member, field, value)
        if title is not None:
            member.title = number_title(title, n)
        if new_due is not None:
            member.due_at = shift_wall_clock(member.due_at, old_due, new_due, zone)
    db.commit()
    for member in targets:
        db.refresh(member)
    return to_reads(db, user, targets)


@router.get("/{assignment_id}", response_model=AssignmentRead)
def read_assignment(assignment_id: int, db: DbSession, user: CurrentUser) -> AssignmentRead:
    return to_reads(db, user, [get_assignment(db, user, assignment_id)])[0]


@router.patch("/{assignment_id}", response_model=AssignmentRead)
def update_assignment(
    assignment_id: int, payload: AssignmentUpdate, db: DbSession, user: CurrentUser
) -> AssignmentRead:
    """Edit a deadline. The shared fields change for everyone in the course; status and the
    mark change only for you."""
    assignment = get_assignment(db, user, assignment_id)
    changes = payload.model_dump(exclude_unset=True)
    if "course_id" in changes:
        # Moving an assignment: the destination course must be one you can use too.
        get_course(db, user, changes["course_id"])
    for field in changes.keys() - PROGRESS_FIELDS:
        setattr(assignment, field, changes[field])
    row = None
    if PROGRESS_FIELDS & changes.keys():
        row = progress_row(db, user, assignment)
        if problem := apply_progress(row, changes):
            db.rollback()
            raise _unprocessable(problem)
    db.commit()
    db.refresh(assignment)
    if row is not None:
        db.refresh(row)
    return to_reads(db, user, [assignment])[0]


@router.delete("/{assignment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_assignment(assignment_id: int, db: DbSession, user: CurrentUser) -> Response:
    assignment = get_assignment(db, user, assignment_id)
    db.delete(assignment)  # everyone's progress on it goes too (ON DELETE CASCADE)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/{assignment_id}/following", status_code=status.HTTP_204_NO_CONTENT)
def delete_following(assignment_id: int, db: DbSession, user: CurrentUser) -> Response:
    """Delete this deadline and every later one in its series (the earlier ones stay)."""
    assignment = get_assignment(db, user, assignment_id)
    for _, member in _this_and_following(db, user, assignment):
        db.delete(member)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
