"""Lookups that only ever return rows owned by the current user.

Every route goes through these instead of db.get(Model, id), so a missing ownership check
can't slip in. A row that exists but belongs to someone else gets the same 404 as a row that
doesn't exist, so the API never confirms that another user's id is real.
"""

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Assignment, Course, StudySession, User


def get_owned_course(db: Session, user: User, course_id: int) -> Course:
    course = db.scalar(select(Course).where(Course.id == course_id, Course.user_id == user.id))
    if course is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Course not found")
    return course


def get_owned_assignment(db: Session, user: User, assignment_id: int) -> Assignment:
    # Assignments have no user_id: ownership is checked by joining through their course.
    assignment = db.scalar(
        select(Assignment)
        .join(Assignment.course)
        .where(Assignment.id == assignment_id, Course.user_id == user.id)
    )
    if assignment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Assignment not found")
    return assignment


def get_owned_session(db: Session, user: User, session_id: int) -> StudySession:
    study_session = db.scalar(
        select(StudySession)
        .join(StudySession.course)
        .where(StudySession.id == session_id, Course.user_id == user.id)
    )
    if study_session is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Study session not found")
    return study_session
