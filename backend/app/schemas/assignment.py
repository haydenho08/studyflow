from typing import Annotated

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StringConstraints, field_validator

from app.models import AssignmentKind, Priority, Status
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
    created_at: UtcDatetime
    updated_at: UtcDatetime
