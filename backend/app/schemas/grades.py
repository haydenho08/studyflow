from pydantic import BaseModel, Field

from app.grades import TargetStatus
from app.schemas.common import JsonDecimal


class GradeTarget(BaseModel):
    letter: str
    minimum: JsonDecimal = Field(description="Lowest final percentage for this letter")
    status: TargetStatus
    needed: JsonDecimal | None = Field(
        description="Average needed on what isn't graded yet (rounded up); null if nothing is left"
    )


class CourseGrades(BaseModel):
    course_id: int
    total_weight: JsonDecimal = Field(description="Sum of the weights entered (ideally 100)")
    graded_weight: JsonDecimal
    current: JsonDecimal | None = Field(description="Average on what's graded so far")
    current_letter: str | None
    lowest: JsonDecimal | None = Field(description="Final grade with zero on everything left")
    highest: JsonDecimal | None = Field(description="Final grade with full marks on the rest")
    targets: list[GradeTarget]
