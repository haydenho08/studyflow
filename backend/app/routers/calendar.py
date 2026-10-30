import datetime as dt

from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import select

from app.deps import CurrentUser, DbSession
from app.ics import build_calendar
from app.models import Assignment, Course, User
from app.ownership import visible_course_ids
from app.progress import to_reads
from app.schemas.calendar import CalendarFeed
from app.security import is_url_token, new_url_token

router = APIRouter(tags=["calendar"])

# Older deadlines are left out, so a feed doesn't grow forever.
HISTORY = dt.timedelta(days=180)


def _feed(user: User) -> CalendarFeed:
    token = user.calendar_token
    return CalendarFeed(path=f"/api/calendar/{token}.ics" if token else None)


@router.get("/calendar-feed", response_model=CalendarFeed)
def read_feed(user: CurrentUser) -> CalendarFeed:
    return _feed(user)


@router.post("/calendar-feed", response_model=CalendarFeed)
def create_feed(user: CurrentUser, db: DbSession) -> CalendarFeed:
    """Turn the feed on, or replace its URL with a new one: the old URL stops working at once."""
    # 32 random bytes (256 bits): far too many to guess, and URL-safe.
    user.calendar_token = new_url_token()
    db.commit()
    return _feed(user)


@router.delete("/calendar-feed", status_code=status.HTTP_204_NO_CONTENT)
def delete_feed(user: CurrentUser, db: DbSession) -> None:
    user.calendar_token = None
    db.commit()


@router.get(
    "/calendar/{token}.ics",
    response_class=Response,
    responses={200: {"content": {"text/calendar": {}}, "description": "An iCalendar feed"}},
)
def calendar_feed(token: str, db: DbSession) -> Response:
    """The user's deadlines as iCalendar, for Google, Apple or Outlook calendar to subscribe to.

    No login: calendar apps can't send one, so the secret in the URL is the credential. An
    unknown, replaced or switched-off token gets a 404, like a feed that never existed.
    """
    found = select(User).where(User.calendar_token == token)
    user = db.scalar(found) if is_url_token(token) else None
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Calendar not found")

    now = dt.datetime.now(dt.UTC)
    rows = db.execute(
        select(Assignment, Course.code)
        .join(Assignment.course)
        .where(
            Assignment.course_id.in_(visible_course_ids(user)),  # shared courses included
            Assignment.due_at >= now - HISTORY,
        )
        .order_by(Assignment.due_at, Assignment.id)
    ).all()
    # Each deadline with *this* user's status on it.
    reads = to_reads(db, user, [assignment for assignment, _ in rows])
    codes = [code for _, code in rows]
    return Response(
        build_calendar(zip(reads, codes, strict=True), now),
        media_type="text/calendar; charset=utf-8",
        headers={
            # Always revalidated, never kept by a shared cache; and keep the secret out of search.
            "Cache-Control": "private, no-cache",
            "X-Robots-Tag": "noindex",
        },
    )
