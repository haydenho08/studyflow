from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response, status
from pydantic import AwareDatetime
from sqlalchemy import select

from app.deps import CurrentUser, DbSession
from app.models import Assignment, AssignmentKind, Course, Priority, Status
from app.ownership import get_owned_assignment, get_owned_course
from app.schemas.assignment import AssignmentCreate, AssignmentRead, AssignmentUpdate

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
