from dataclasses import asdict

from fastapi import APIRouter
from sqlalchemy import select

from app.deps import CurrentUser, DbSession
from app.grades import GradedItem, summarize
from app.models import Assignment, Course
from app.schemas.grades import CourseGrades

router = APIRouter(prefix="/grades", tags=["grades"])


@router.get("", response_model=list[CourseGrades])
def course_grades(db: DbSession, user: CurrentUser) -> list[CourseGrades]:
    """Every course's grade so far, its possible range, and what's needed for each letter grade.

    Only deadlines with a weight count. Computed on request from the stored marks, so it can
    never disagree with them.
    """
    courses = db.scalars(select(Course.id).where(Course.user_id == user.id).order_by(Course.code))
    items: dict[int, list[GradedItem]] = {course_id: [] for course_id in courses}
    rows = db.execute(
        select(Assignment.course_id, Assignment.weight, Assignment.score, Assignment.out_of)
        .join(Assignment.course)
        .where(Course.user_id == user.id, Assignment.weight.is_not(None))
    )
    for course_id, weight, score, out_of in rows:
        items[course_id].append(GradedItem(weight, score, out_of))
    return [
        CourseGrades(course_id=course_id, **asdict(summarize(graded)))
        for course_id, graded in items.items()
    ]
