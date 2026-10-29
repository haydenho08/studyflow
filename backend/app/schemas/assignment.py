import uuid
from datetime import date
from decimal import Decimal
from typing import Annotated, Self

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

from app.models import AssignmentKind, Priority, Status
from app.recurrence import MAX_OCCURRENCES
from app.schemas.common import JsonDecimal, UtcDatetime, reject_null, to_utc

Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Description = Annotated[str, Field(max_length=5000)]
# Grades. decimal_places matches the database's Numeric(…, 2), so nothing is silently rounded.
Weight = Annotated[
    Decimal, Field(gt=0, le=100, max_digits=5, decimal_places=2, description="% of the course")
]
Score = Annotated[Decimal, Field(ge=0, max_digits=7, decimal_places=2)]
OutOf = Annotated[Decimal, Field(gt=0, max_digits=7, decimal_places=2)]


def _mark_is_complete(score: Decimal | None, out_of: Decimal | None) -> None:
    if (score is None) != (out_of is None):
        raise ValueError("give score and out_of together (e.g. 18 out of 20)")


class AssignmentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    course_id: int
    title: Title
    description: Description | None = None
    kind: AssignmentKind = AssignmentKind.ASSIGNMENT
    # AwareDatetime rejects "2026-11-01T23:59:00" (no offset):
    # we can't guess which timezone it meant.
    due_at: AwareDatetime
    priority: Priority = Priority.MEDIUM
    status: Status = Status.TODO
    weight: Weight | None = None
    score: Score | None = None
    out_of: OutOf | None = None

    _utc = field_validator("due_at")(to_utc)

    @model_validator(mode="after")
    def complete_mark(self) -> Self:
        _mark_is_complete(self.score, self.out_of)
        return self


Weekday = Annotated[int, Field(ge=0, le=6, description="Monday = 0 … Sunday = 6")]


class RepeatRule(BaseModel):
    """Repeat weekly, on some days of the week, until a date or for a number of deadlines."""

    model_config = ConfigDict(extra="forbid")

    weekdays: list[Weekday] = Field(min_length=1, max_length=7)
    every_weeks: int = Field(default=1, ge=1, le=4)
    count: int | None = Field(default=None, ge=2, le=MAX_OCCURRENCES)
    until: date | None = Field(default=None, description="Last possible due date (inclusive)")
    # The calendar the rule is meant in: "Friday 23:59" depends on where you are.
    time_zone: str = Field(max_length=64)

    @field_validator("weekdays")
    @classmethod
    def no_repeats(cls, value: list[int]) -> list[int]:
        if len(set(value)) != len(value):
            raise ValueError("each weekday may appear only once")
        return sorted(value)

    @model_validator(mode="after")
    def one_end(self) -> Self:
        if (self.count is None) == (self.until is None):
            raise ValueError("give exactly one of count or until")
        return self


class AssignmentSeriesCreate(AssignmentCreate):
    """A first deadline (due_at) plus how it repeats. "{n}" in the title becomes 1, 2, 3…"""

    repeat: RepeatRule

    @model_validator(mode="after")
    def no_marks(self) -> Self:
        if self.score is not None:
            raise ValueError("marks are entered one deadline at a time, not for a whole series")
        return self


class AssignmentUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    course_id: int | None = None
    title: Title | None = None
    description: Description | None = None  # nullable column, so null is allowed (clears it)
    kind: AssignmentKind | None = None
    due_at: AwareDatetime | None = None
    priority: Priority | None = None
    status: Status | None = None
    # Nullable columns: null clears them. Score and out_of are checked as a pair once merged
    # with what's stored (sending only a new score is fine).
    weight: Weight | None = None
    score: Score | None = None
    out_of: OutOf | None = None

    _no_nulls = field_validator("course_id", "title", "kind", "due_at", "priority", "status")(
        reject_null
    )
    _utc = field_validator("due_at")(to_utc)


class AssignmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    course_id: int
    title: str
    description: str | None
    kind: AssignmentKind
    due_at: UtcDatetime
    priority: Priority
    status: Status
    series_id: uuid.UUID | None
    weight: JsonDecimal | None
    score: JsonDecimal | None
    out_of: JsonDecimal | None
    created_at: UtcDatetime
    updated_at: UtcDatetime
