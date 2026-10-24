import datetime as dt
from collections import defaultdict
from typing import Annotated
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import Date, cast, func, select

from app.deps import CurrentUser, DbSession
from app.models import Course, StudySession
from app.schemas.study import CourseSeconds, CourseTotal, DayStats, WeekStats

router = APIRouter(prefix="/stats", tags=["stats"])


def parse_timezone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, f"Unknown time zone: {name!r}"
        ) from None


@router.get("/week", response_model=WeekStats)
def week_stats(
    db: DbSession,
    user: CurrentUser,
    start: Annotated[dt.date, Query(description="First day of the week, e.g. a Monday")],
    tz: Annotated[str, Query(description="IANA time zone, e.g. America/Toronto")],
) -> WeekStats:
    """Study time per day and per course for the 7 days starting at `start`.

    "Which day" depends on where the student is: 22:00 Monday in Toronto is already Tuesday in
    UTC. So the client sends its time zone, and days are computed in that zone. A session counts
    on the day it started.
    """
    zone = parse_timezone(tz)
    # Local midnight to local midnight. ZoneInfo applies the right UTC offset for each date,
    # so a week containing a DST change is still exactly 7 calendar days.
    week_start = dt.datetime.combine(start, dt.time.min, tzinfo=zone)
    week_end = dt.datetime.combine(start + dt.timedelta(days=7), dt.time.min, tzinfo=zone)

    # timezone(zone, timestamptz) gives the local wall-clock time; casting to DATE gives the local day.
    local_day = cast(func.timezone(tz, StudySession.started_at), Date).label("day")
    seconds = func.sum(func.extract("epoch", StudySession.ended_at - StudySession.started_at))

    rows = db.execute(
        select(
            local_day,
            StudySession.course_id,
            seconds.label("seconds"),
            func.count().label("sessions"),
        )
        .join(StudySession.course)
        .where(
            Course.user_id == user.id,
            StudySession.started_at >= week_start,
            StudySession.started_at < week_end,
        )
        .group_by(local_day, StudySession.course_id)
    ).all()

    # Aggregation happened in SQL; here we only reshape rows into the response.
    by_day: dict[dt.date, list[CourseSeconds]] = defaultdict(list)
    course_seconds: dict[int, int] = defaultdict(int)
    course_sessions: dict[int, int] = defaultdict(int)
    for row in rows:
        secs = int(row.seconds)
        by_day[row.day].append(CourseSeconds(course_id=row.course_id, seconds=secs))
        course_seconds[row.course_id] += secs
        course_sessions[row.course_id] += row.sessions

    days = []
    for offset in range(7):  # every day appears, even with zero study, so charts have no gaps
        day = start + dt.timedelta(days=offset)
        entries = sorted(by_day.get(day, []), key=lambda c: c.course_id)
        days.append(DayStats(day=day, total_seconds=sum(c.seconds for c in entries), courses=entries))

    courses = sorted(
        (
            CourseTotal(course_id=cid, seconds=secs, sessions=course_sessions[cid])
            for cid, secs in course_seconds.items()
        ),
        key=lambda c: (-c.seconds, c.course_id),
    )
    return WeekStats(
        start=start,
        timezone=tz,
        total_seconds=sum(course_seconds.values()),
        session_count=sum(course_sessions.values()),
        days=days,
        courses=courses,
    )
