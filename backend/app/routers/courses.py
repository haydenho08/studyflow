from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.deps import CurrentUser, DbSession
from app.models import Course
from app.ownership import get_owned_course
from app.schemas.course import CourseCreate, CourseRead, CourseUpdate

router = APIRouter(prefix="/courses", tags=["courses"])


def _commit_or_conflict(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "You already have a course with this code"
        ) from None


@router.get("", response_model=list[CourseRead])
def list_courses(db: DbSession, user: CurrentUser) -> list[Course]:
    return list(db.scalars(select(Course).where(Course.user_id == user.id).order_by(Course.code)))


@router.post("", response_model=CourseRead, status_code=status.HTTP_201_CREATED)
def create_course(payload: CourseCreate, db: DbSession, user: CurrentUser) -> Course:
    # user_id comes from the token, never from the request body.
    course = Course(user_id=user.id, **payload.model_dump())
    db.add(course)
    _commit_or_conflict(db)
    return course


@router.get("/{course_id}", response_model=CourseRead)
def get_course(course_id: int, db: DbSession, user: CurrentUser) -> Course:
    return get_owned_course(db, user, course_id)


@router.patch("/{course_id}", response_model=CourseRead)
def update_course(
    course_id: int, payload: CourseUpdate, db: DbSession, user: CurrentUser
) -> Course:
    course = get_owned_course(db, user, course_id)
    # exclude_unset: only touch fields the client actually sent.
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(course, field, value)
    _commit_or_conflict(db)
    db.refresh(course)  # pick up the new updated_at from the database
    return course


@router.delete("/{course_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_course(course_id: int, db: DbSession, user: CurrentUser) -> Response:
    course = get_owned_course(db, user, course_id)
    db.delete(course)  # the database's ON DELETE CASCADE removes its assignments
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
