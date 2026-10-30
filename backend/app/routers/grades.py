from dataclasses import asdict

from fastapi import APIRouter
from sqlalchemy import and_, select

from app.deps import CurrentUser, DbSession
from app.grades import GradedItem, summarize
from app.models import Assignment, AssignmentProgress, Course
from app.ownership import visible_course_ids
from app.schemas.grades import CourseGrades

router = APIRouter(prefix="/grades", tags=["grades"])


@router.get("", response_model=list[CourseGrades])
def course_grades(db: DbSession, user: CurrentUser) -> list[CourseGrades]:
    """Every course's grade so far, its possible range, and what's needed for each letter grade.

    Only deadlines with a weight count. The weights are the course's; the marks are this user's
    own (in a shared course, everyone sees their own grade). Computed on request from the stored
    marks, so it can never disagree with them.
    """
    visible = visible_course_ids(user)
    courses = db.scalars(
        select(Course.id).where(Course.id.in_(visible)).order_by(Course.code, Course.id)
    )
    items: dict[int, list[GradedItem]] = {course_id: [] for course_id in courses}
    mine = and_(
        AssignmentProgress.assignment_id == Assignment.id, AssignmentProgress.user_id == user.id
    )
    rows = db.execute(
        select(
            Assignment.course_id,
            Assignment.weight,
            AssignmentProgress.score,
            AssignmentProgress.out_of,
        )
        .outerjoin(AssignmentProgress, mine)
        .where(Assignment.course_id.in_(visible), Assignment.weight.is_not(None))
    )
    for course_id, weight, score, out_of in rows:
        items[course_id].append(GradedItem(weight, score, out_of))
    return [
        CourseGrades(course_id=course_id, **asdict(summarize(graded)))
        for course_id, graded in items.items()
    ]
