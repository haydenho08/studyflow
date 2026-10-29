# Import every model here so Base.metadata knows all tables (Alembic and tests rely on this).
from app.models.assignment import Assignment
from app.models.auth_session import AuthSession
from app.models.course import Course
from app.models.enums import AssignmentKind, Priority, Status
from app.models.study_session import StudySession
from app.models.user import User

__all__ = [
    "Assignment",
    "AssignmentKind",
    "AuthSession",
    "Course",
    "Priority",
    "Status",
    "StudySession",
    "User",
]
