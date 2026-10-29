import uuid
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response, status
from pydantic import AwareDatetime
from sqlalchemy import select

from app.deps import CurrentUser, DbSession
from app.models import Assignment, AssignmentKind, Course, Priority, Status
from app.ownership import get_owned_assignment, get_owned_course
from app.recurrence import RecurrenceError, number_title, shift_wall_clock, weekly_due_dates
from app.schemas.assignment import (
    AssignmentCreate,
    AssignmentRead,
    AssignmentSeriesCreate,
    AssignmentUpdate,
)
from app.zones import parse_timezone

router = APIRouter(prefix="/assignments", tags=["assignments"])


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
) -> list[Assignment]:
    if due_from is not None and due_to is not None and due_from >= due_to:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "due_from must be before due_to")

    query = (
        select(Assignment)
        .join(Assignment.course)
        .where(Course.user_id == user.id)  # the ownership filter; everything else narrows it
        .order_by(Assignment.due_at, Assignment.id)
    )
    if course_id is not None:
        query = query.where(Assignment.course_id == course_id)
    if status_:
        query = query.where(Assignment.status.in_(status_))
    if priority is not None:
        query = query.where(Assignment.priority == priority)
    if kind is not None:
        query = query.where(Assignment.kind == kind)
    # Half-open range [due_from, due_to): consecutive weeks never double-count a deadline.
    if due_from is not None:
        query = query.where(Assignment.due_at >= due_from)
    if due_to is not None:
        query = query.where(Assignment.due_at < due_to)
    return list(db.scalars(query))


@router.post("", response_model=AssignmentRead, status_code=status.HTTP_201_CREATED)
def create_assignment(payload: AssignmentCreate, db: DbSession, user: CurrentUser) -> Assignment:
    get_owned_course(db, user, payload.course_id)  # 404 if the course isn't yours
    assignment = Assignment(**payload.model_dump())
    db.add(assignment)
    db.commit()
    return assignment


@router.post("/series", response_model=list[AssignmentRead], status_code=status.HTTP_201_CREATED)
def create_series(
    payload: AssignmentSeriesCreate, db: DbSession, user: CurrentUser
) -> list[Assignment]:
    """Create a weekly repeating deadline: one row per due date, all sharing a series_id."""
    get_owned_course(db, user, payload.course_id)
    rule = payload.repeat
    zone = parse_timezone(rule.time_zone)
    try:
        due_dates = weekly_due_dates(
            payload.due_at, zone, set(rule.weekdays), rule.every_weeks, rule.count, rule.until
        )
    except RecurrenceError as error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(error)) from None

    series_id = uuid.uuid4()
    shared = payload.model_dump(exclude={"repeat", "title", "due_at"})
    rows = [
        Assignment(**shared, title=number_title(payload.title, n), due_at=due, series_id=series_id)
        for n, due in enumerate(due_dates, start=1)
    ]
    db.add_all(rows)
    db.commit()
    return rows


def _this_and_following(db: DbSession, user: CurrentUser, assignment: Assignment):
    """The assignment and the later deadlines of its series, each with its number in the series
    (1-based, counting the earlier ones too). A one-off deadline is a series of one."""
    if assignment.series_id is None:
        return [(1, assignment)]
    series = list(
        db.scalars(
            select(Assignment)
            .join(Assignment.course)
            .where(Course.user_id == user.id, Assignment.series_id == assignment.series_id)
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
) -> list[Assignment]:
    """Change this deadline and every later one in its series.

    A new due_at moves each of them by the same wall-clock change (e.g. "Fridays 23:59" to
    "Mondays 09:00"), and "{n}" in a new title is numbered by position in the series.
    """
    zone = parse_timezone(tz)
    assignment = get_owned_assignment(db, user, assignment_id)
    changes = payload.model_dump(exclude_unset=True)
    if "status" in changes:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Status is set one deadline at a time"
        )
    if "course_id" in changes:
        get_owned_course(db, user, changes["course_id"])
    title = changes.pop("title", None)
    new_due = changes.pop("due_at", None)
    old_due = assignment.due_at  # read before the loop moves it

    targets = _this_and_following(db, user, assignment)
    for n, member in targets:
        for field, value in changes.items():
            setattr(member, field, value)
        if title is not None:
            member.title = number_title(title, n)
        if new_due is not None:
            member.due_at = shift_wall_clock(member.due_at, old_due, new_due, zone)
    db.commit()
    for _, member in targets:
        db.refresh(member)
    return [member for _, member in targets]


@router.get("/{assignment_id}", response_model=AssignmentRead)
def get_assignment(assignment_id: int, db: DbSession, user: CurrentUser) -> Assignment:
    return get_owned_assignment(db, user, assignment_id)


@router.patch("/{assignment_id}", response_model=AssignmentRead)
def update_assignment(
    assignment_id: int, payload: AssignmentUpdate, db: DbSession, user: CurrentUser
) -> Assignment:
    assignment = get_owned_assignment(db, user, assignment_id)
    changes = payload.model_dump(exclude_unset=True)
    if "course_id" in changes:
        # Moving an assignment: the destination course must be yours too.
        get_owned_course(db, user, changes["course_id"])
    for field, value in changes.items():
        setattr(assignment, field, value)
    db.commit()
    db.refresh(assignment)
    return assignment


@router.delete("/{assignment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_assignment(assignment_id: int, db: DbSession, user: CurrentUser) -> Response:
    assignment = get_owned_assignment(db, user, assignment_id)
    db.delete(assignment)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/{assignment_id}/following", status_code=status.HTTP_204_NO_CONTENT)
def delete_following(assignment_id: int, db: DbSession, user: CurrentUser) -> Response:
    """Delete this deadline and every later one in its series (the earlier ones stay)."""
    assignment = get_owned_assignment(db, user, assignment_id)
    for _, member in _this_and_following(db, user, assignment):
        db.delete(member)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
