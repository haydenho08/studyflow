from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, StringConstraints, field_validator

from app.schemas.common import reject_null

CourseName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
# "eecs 2030 " -> "EECS 2030", so codes compare (and stay unique) regardless of how they were typed.
CourseCode = Annotated[
    str, StringConstraints(strip_whitespace=True, to_upper=True, min_length=1, max_length=20)
]
HexColor = Annotated[
    str, StringConstraints(strip_whitespace=True, to_upper=True, pattern=r"^#[0-9A-Fa-f]{6}$")
]


class CourseCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: CourseName
    code: CourseCode
    color: HexColor = "#3B82F6"


class CourseUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: CourseName | None = None
    code: CourseCode | None = None
    color: HexColor | None = None

    _no_nulls = field_validator("name", "code", "color")(reject_null)


class CourseRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    code: str
    color: str
    created_at: datetime
    updated_at: datetime
