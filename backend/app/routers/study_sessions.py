from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response, status
from pydantic import AwareDatetime
from sqlalchemy import select

from app.deps import CurrentUser, DbSession
from app.models import Course, StudySession
from app.ownership import get_owned_course, get_owned_session
from app.schemas.study import StudySessionCreate, StudySessionRead

router = APIRouter(prefix="/study-sessions", tags=["study sessions"])


@router.post("", response_model=StudySessionRead, status_code=status.HTTP_201_CREATED)
def create_session(payload: StudySessionCreate, db: DbSession, user: CurrentUser) -> StudySession:
    get_owned_course(db, user, payload.course_id)

    # You can't study two things at once: reject a session overlapping any of yours, on any course.
    # Two intervals overlap exactly when each one starts before the other ends.
    # Sessions that merely touch (one ends 10:25, the next starts 10:25) are fine.
    overlapping = db.scalar(
        select(StudySession.id)
        .join(StudySession.course)
        .where(
            Course.user_id == user.id,
            StudySession.started_at < payload.ended_at,
            StudySession.ended_at > payload.started_at,
        )
        .limit(1)
    )
    if overlapping is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "This overlaps a session you already logged")

    study_session = StudySession(**payload.model_dump())
    db.add(study_session)
    db.commit()
    return study_session


@router.get("", response_model=list[StudySessionRead])
def list_sessions(
    db: DbSession,
    user: CurrentUser,
    course_id: int | None = None,
    started_from: Annotated[AwareDatetime | None, Query(description="Inclusive")] = None,
    started_to: Annotated[AwareDatetime | None, Query(description="Exclusive")] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> list[StudySession]:
    query = (
        select(StudySession)
        .join(StudySession.course)
        .where(Course.user_id == user.id)
        .order_by(StudySession.started_at.desc(), StudySession.id.desc())  # newest first
        .limit(limit)
    )
    if course_id is not None:
        query = query.where(StudySession.course_id == course_id)
    if started_from is not None:
        query = query.where(StudySession.started_at >= started_from)
    if started_to is not None:
        query = query.where(StudySession.started_at < started_to)
    return list(db.scalars(query))


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(session_id: int, db: DbSession, user: CurrentUser) -> Response:
    study_session = get_owned_session(db, user, session_id)
    db.delete(study_session)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
