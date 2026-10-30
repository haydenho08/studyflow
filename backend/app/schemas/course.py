from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

from app.schemas.common import UtcDatetime, reject_null

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


Role = Literal["owner", "member"]


class CourseRead(BaseModel):
    id: int
    name: str
    code: str
    color: str
    role: Role = Field(description="Yours (owner), or joined through an invite link (member)")
    owner_email: str
    member_count: int = Field(description="People who joined, not counting the owner")
    created_at: UtcDatetime
    updated_at: UtcDatetime


class CourseInvite(BaseModel):
    path: str | None = Field(
        description="The invite link's path on this site (/join/<secret>), or null while off."
    )


class InvitePreview(BaseModel):
    """What someone holding the link sees before joining."""

    course_id: int
    code: str
    name: str
    color: str
    owner_email: str
    member_count: int
    role: Role | None = Field(description="Your role if you're already in it, else null")


class CourseMemberRead(BaseModel):
    user_id: int
    email: str
    role: Role
    joined_at: UtcDatetime | None = Field(description="Null for the owner")
