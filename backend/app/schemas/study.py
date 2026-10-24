import datetime as dt
from datetime import UTC, timedelta

from pydantic import AwareDatetime, BaseModel, ConfigDict, computed_field, field_validator, model_validator

from app.schemas.common import to_utc

MIN_SESSION = timedelta(minutes=1)
MAX_SESSION = timedelta(hours=12)
# Client clocks drift a little; don't reject a session that "ends" a few seconds from now.
CLOCK_SKEW = timedelta(minutes=2)


class StudySessionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    course_id: int
    started_at: AwareDatetime
    ended_at: AwareDatetime

    _utc = field_validator("started_at", "ended_at")(to_utc)

    @model_validator(mode="after")
    def check_times(self) -> "StudySessionCreate":
        # A model validator sees all fields at once: needed for rules that compare two of them.
        duration = self.ended_at - self.started_at
        if duration < MIN_SESSION:
            raise ValueError("A session must be at least 1 minute long")
        if duration > MAX_SESSION:
            raise ValueError("A session can be at most 12 hours long")
        if self.ended_at > dt.datetime.now(UTC) + CLOCK_SKEW:
            raise ValueError("A session can't end in the future")
        return self


class StudySessionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    course_id: int
    started_at: dt.datetime
    ended_at: dt.datetime
    created_at: dt.datetime

    @computed_field  # derived, not stored: it can never disagree with the timestamps
    @property
    def duration_seconds(self) -> int:
        return int((self.ended_at - self.started_at).total_seconds())


class CourseSeconds(BaseModel):
    course_id: int
    seconds: int


class DayStats(BaseModel):
    day: dt.date
    total_seconds: int
    courses: list[CourseSeconds]


class CourseTotal(BaseModel):
    course_id: int
    seconds: int
    sessions: int


class WeekStats(BaseModel):
    start: dt.date
    timezone: str
    total_seconds: int
    session_count: int
    days: list[DayStats]  # always 7 entries, including days with no study
    courses: list[CourseTotal]  # most-studied first
