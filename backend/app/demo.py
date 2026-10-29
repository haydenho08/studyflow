"""The public demo account: realistic data that is always about *the current* week.

Visitors get in with one click (POST /api/auth/demo). If the demo data is more than an hour old,
it is rebuilt first, relative to today in the visitor's time zone. So the calendar never shows a
stale week, and whatever an earlier visitor typed in is cleared out within the hour.
"""

import datetime as dt
import secrets
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Assignment, Course, StudySession, User
from app.security import hash_password

DEMO_EMAIL = "demo@studyflow.app"
REFRESH_AFTER = dt.timedelta(hours=1)

COURSES = [
    # code, name, colour (the app's default palette, in order)
    ("EECS 2030", "Advanced Object-Oriented Programming", "#2A78D6"),
    ("EECS 2021", "Computer Organization", "#EB6834"),
    ("MATH 1090", "Introduction to Logic for Computer Science", "#1BAF7A"),
    ("PHYS 1800", "Engineering Mechanics", "#6250D6"),
]

# (course index, title, kind, days from today, "HH:MM", priority, status). Relative to *today*,
# not Monday: anchored to Monday, a Sunday visitor would see almost every deadline overdue.
# This way, any day of the week: two done, one overdue, the rest coming up over ten days.
ASSIGNMENTS = [
    (2, "Problem set 5", "assignment", -3, "23:59", "medium", "done"),
    (0, "Lab 4: Inheritance", "lab", -2, "17:00", "high", "done"),
    (1, "Quiz 3: Assembly", "quiz", -1, "10:00", "medium", "todo"),  # overdue
    (0, "Lab 5: Interfaces", "lab", 1, "17:00", "high", "in_progress"),
    (2, "Problem set 6", "assignment", 2, "23:59", "medium", "todo"),
    (3, "Midterm", "exam", 3, "19:00", "high", "todo"),
    (1, "Lab 3 report", "lab", 4, "12:00", "medium", "todo"),
    (0, "Project milestone 1", "project", 4, "23:59", "high", "todo"),
    (3, "Problem set 4", "assignment", 6, "23:59", "low", "todo"),
    (2, "Quiz 4", "quiz", 8, "10:00", "medium", "todo"),
    (0, "Midterm", "exam", 10, "18:00", "high", "todo"),
    # Earlier in the term (already marked) and the finals, for the Grades page.
    (0, "Lab 1: Classes", "lab", -24, "17:00", "medium", "done"),
    (0, "Lab 2: Collections", "lab", -17, "17:00", "medium", "done"),
    (0, "Lab 3: Recursion", "lab", -10, "17:00", "medium", "done"),
    (0, "Final exam", "exam", 45, "09:00", "high", "todo"),
    (1, "Quiz 1: Binary", "quiz", -20, "10:00", "medium", "done"),
    (1, "Quiz 2: Logic gates", "quiz", -13, "10:00", "medium", "done"),
    (1, "Midterm", "exam", -15, "19:00", "high", "done"),
    (1, "Final exam", "exam", 48, "14:00", "high", "todo"),
]

# Grades: (course index, title) -> (weight %, score, out of). EECS 2030 and 2021 add up to 100%;
# MATH 1090 only has some weights entered (the page says so); PHYS 1800 has none yet.
GRADES = {
    (0, "Lab 1: Classes"): ("5", "9", "10"),
    (0, "Lab 2: Collections"): ("5", "10", "10"),
    (0, "Lab 3: Recursion"): ("5", "8", "10"),
    (0, "Lab 4: Inheritance"): ("5", "17", "20"),
    (0, "Lab 5: Interfaces"): ("5", None, None),
    (0, "Project milestone 1"): ("15", None, None),
    (0, "Midterm"): ("25", None, None),
    (0, "Final exam"): ("35", None, None),
    (1, "Quiz 1: Binary"): ("5", "8", "10"),
    (1, "Quiz 2: Logic gates"): ("5", "7", "10"),
    (1, "Quiz 3: Assembly"): ("5", None, None),
    (1, "Midterm"): ("30", "41", "50"),
    (1, "Lab 3 report"): ("15", None, None),
    (1, "Final exam"): ("40", None, None),
    (2, "Problem set 5"): ("10", "17", "20"),
    (2, "Problem set 6"): ("10", None, None),
    (2, "Quiz 4"): ("10", None, None),
}

# (course index, days ago, "HH:MM", minutes). Relative to today rather than to Monday, so the
# last 14 days are always full of study whatever weekday it is.
# fmt: off
SESSIONS = [
    (0, 0, "07:30", 25), (2, 0, "08:00", 25),  # earlier today: skipped if not over yet
    (0, 1, "09:00", 50), (2, 1, "13:00", 25), (3, 1, "20:00", 25),
    (1, 2, "10:00", 25), (1, 2, "10:30", 25), (0, 2, "21:00", 50),
    (3, 3, "16:00", 50), (2, 3, "18:30", 25),
    (0, 4, "08:30", 50), (1, 4, "13:00", 25), (3, 4, "22:00", 25),
    (2, 5, "11:00", 50), (2, 5, "12:00", 25),
    (0, 6, "14:00", 50),
    (1, 7, "15:00", 25), (2, 7, "16:00", 25),
    (0, 8, "09:00", 50), (2, 8, "14:00", 25), (1, 9, "10:30", 50), (3, 10, "16:00", 25),
    (0, 11, "19:00", 50), (2, 12, "11:00", 25), (2, 12, "11:30", 25), (1, 13, "15:00", 50),
]
# fmt: on


def _at(day: dt.date, offset: int, hhmm: str, zone: ZoneInfo) -> dt.datetime:
    hour, minute = map(int, hhmm.split(":"))
    return dt.datetime.combine(day + dt.timedelta(days=offset), dt.time(hour, minute), zone)


def reset_demo_data(db: Session, user: User, zone: ZoneInfo, password: str | None = None) -> int:
    """Replace the demo user's data with fresh data around today. Returns sessions created.

    Without `password`, the account gets a random one nobody knows: the demo button is the only
    way in. (The local seed script passes a known one, for the screenshot tool.)
    """
    now = dt.datetime.now(zone)
    today = now.date()

    user.hashed_password = hash_password(password or secrets.token_urlsafe(32))
    user.calendar_token = None  # an earlier visitor's feed URL stops working with their data
    # ON DELETE CASCADE takes the old assignments and study sessions with the courses.
    db.execute(delete(Course).where(Course.user_id == user.id))
    courses = [Course(user_id=user.id, code=c, name=n, color=col) for c, n, col in COURSES]
    db.add_all(courses)
    db.flush()

    for ci, title, kind, offset, hhmm, priority, status in ASSIGNMENTS:
        weight, score, out_of = (
            None if v is None else Decimal(v) for v in GRADES.get((ci, title), (None, None, None))
        )
        db.add(
            Assignment(
                course_id=courses[ci].id,
                title=title,
                kind=kind,
                due_at=_at(today, offset, hhmm, zone),
                priority=priority,
                status=status,
                weight=weight,
                score=score,
                out_of=out_of,
            )
        )

    created = 0
    for ci, days_ago, hhmm, minutes in SESSIONS:
        start = _at(today, -days_ago, hhmm, zone)
        end = start + dt.timedelta(minutes=minutes)
        if end > now:  # the API never accepts future sessions; neither does the demo
            continue
        db.add(StudySession(course_id=courses[ci].id, started_at=start, ended_at=end))
        created += 1
    return created


def _locked_demo_user(db: Session) -> User:
    """The demo user, row-locked (SELECT ... FOR UPDATE) until this transaction ends.

    Two visitors clicking at the same moment would otherwise both rebuild the data at once and
    collide on the (user_id, code) unique constraint. With the lock, the second waits, then sees
    fresh data and skips the rebuild.
    """
    query = select(User).where(User.email == DEMO_EMAIL).with_for_update()
    user = db.scalar(query)
    if user is None:
        db.add(User(email=DEMO_EMAIL, hashed_password=hash_password(secrets.token_urlsafe(32))))
        try:
            db.commit()
        except IntegrityError:  # someone else created it a moment ago: fine, use theirs
            db.rollback()
        user = db.scalar(query)
    assert user is not None
    return user


def ensure_fresh_demo(db: Session, zone: ZoneInfo, now: dt.datetime | None = None) -> User:
    """Return the demo user, rebuilding its data first if it is missing or over an hour old."""
    now = now or dt.datetime.now(dt.UTC)
    user = _locked_demo_user(db)
    # When the demo was last built = when its oldest course was created. Courses a visitor adds
    # are newer, so they don't count; a visitor deleting every course forces a rebuild.
    built_at = db.scalar(select(func.min(Course.created_at)).where(Course.user_id == user.id))
    if built_at is None or now - built_at > REFRESH_AFTER:
        reset_demo_data(db, user, zone)
    db.commit()  # also releases the row lock
    return user
