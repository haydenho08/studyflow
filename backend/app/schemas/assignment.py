import uuid
from datetime import date
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
from app.schemas.common import UtcDatetime, reject_null, to_utc

Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Description = Annotated[str, Field(max_length=5000)]


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

    _utc = field_validator("due_at")(to_utc)


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


class AssignmentUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    course_id: int | None = None
    title: Title | None = None
    description: Description | None = None  # nullable column, so null is allowed (clears it)
    kind: AssignmentKind | None = None
    due_at: AwareDatetime | None = None
    priority: Priority | None = None
    status: Status | None = None

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
    created_at: UtcDatetime
    updated_at: UtcDatetime
