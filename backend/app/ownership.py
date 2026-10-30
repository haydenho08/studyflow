"""Who may see and change what. Every route goes through these, never db.get(Model, id).

A course is visible to its **owner** and its **members** (people who joined through its invite
link). Members share the course's deadlines; each person's status, marks and study sessions stay
their own.

- To someone outside the course, it doesn't exist: 404, exactly as for an id that was never
  used, so the API never confirms another user's data is real.
- A member asking for an owner-only action (rename or delete the course, manage the invite link
  or other members) already knows the course exists, so they get an honest 403.
"""

from fastapi import HTTPException, status
from sqlalchemy import Select, or_, select
from sqlalchemy.orm import Session

from app.models import Assignment, Course, CourseMember, StudySession, User


def visible_course_ids(user: User) -> Select[tuple[int]]:
    """Subquery: ids of the courses `user` owns or has joined. Every list query filters on it."""
    joined = select(CourseMember.course_id).where(CourseMember.user_id == user.id)
    return select(Course.id).where(or_(Course.user_id == user.id, Course.id.in_(joined)))


def get_course(db: Session, user: User, course_id: int, *, owner_only: bool = False) -> Course:
    course = db.scalar(
        select(Course).where(Course.id == course_id, Course.id.in_(visible_course_ids(user)))
    )
    if course is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Course not found")
    if owner_only and course.user_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the course's owner can do that")
    return course


def get_assignment(db: Session, user: User, assignment_id: int) -> Assignment:
    # Assignments have no user_id: access is checked through their course.
    assignment = db.scalar(
        select(Assignment).where(
            Assignment.id == assignment_id, Assignment.course_id.in_(visible_course_ids(user))
        )
    )
    if assignment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Assignment not found")
    return assignment


def get_own_session(db: Session, user: User, session_id: int) -> StudySession:
    # Study sessions belong to whoever studied, even in a shared course.
    study_session = db.scalar(
        select(StudySession).where(StudySession.id == session_id, StudySession.user_id == user.id)
    )
    if study_session is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Study session not found")
    return study_session
