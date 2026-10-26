"""Create (or reset) a demo account with realistic data around the current week.

Used for README screenshots and for a public demo login. Dates are relative to *today* in the
given time zone, so the calendar and stats always look lived-in.

Usage (from backend/):
    python -m scripts.seed_demo                      # demo@studyflow.app, America/Toronto
    python -m scripts.seed_demo --tz Europe/London --password "something-long"
"""

import argparse
import datetime as dt
from zoneinfo import ZoneInfo

from sqlalchemy import delete

from app.db import SessionLocal
from app.models import Assignment, Course, StudySession, User
from app.security import hash_password

DEMO_EMAIL = "demo@studyflow.app"
DEMO_PASSWORD = "studyflow-demo"  # public on purpose: it's a throwaway showcase account

COURSES = [
    # code, name, colour (the app's default palette, in order)
    ("EECS 2030", "Advanced Object-Oriented Programming", "#2A78D6"),
    ("EECS 2021", "Computer Organization", "#EB6834"),
    ("MATH 1090", "Introduction to Logic for Computer Science", "#1BAF7A"),
    ("PHYS 1800", "Engineering Mechanics", "#6250D6"),
]

# (course index, title, kind, day offset from this week's Monday, "HH:MM", priority, status)
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
]

# (course index, days ago, "HH:MM", minutes). Relative to today rather than to Monday, so the
# last 14 days are always full of study whatever weekday the script runs on.
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


def at(monday: dt.date, offset: int, hhmm: str, zone: ZoneInfo) -> dt.datetime:
    hour, minute = map(int, hhmm.split(":"))
    return dt.datetime.combine(monday + dt.timedelta(days=offset), dt.time(hour, minute), zone)


def seed(tz: str, password: str) -> None:
    zone = ZoneInfo(tz)
    now = dt.datetime.now(zone)
    monday = now.date() - dt.timedelta(days=now.weekday())

    with SessionLocal() as db:
        # Start clean: ON DELETE CASCADE removes the old demo's courses, assignments and sessions.
        db.execute(delete(User).where(User.email == DEMO_EMAIL))
        user = User(email=DEMO_EMAIL, hashed_password=hash_password(password))
        db.add(user)
        db.flush()

        courses = [Course(user_id=user.id, code=c, name=n, color=col) for c, n, col in COURSES]
        db.add_all(courses)
        db.flush()

        for ci, title, kind, offset, hhmm, priority, status in ASSIGNMENTS:
            db.add(
                Assignment(
                    course_id=courses[ci].id,
                    title=title,
                    kind=kind,
                    due_at=at(monday, offset, hhmm, zone),
                    priority=priority,
                    status=status,
                )
            )

        today = now.date()
        logged = 0
        for ci, days_ago, hhmm, minutes in SESSIONS:
            start = at(today, -days_ago, hhmm, zone)
            end = start + dt.timedelta(minutes=minutes)
            if end > now:  # the API never accepts future sessions; neither does the seed
                continue
            db.add(StudySession(course_id=courses[ci].id, started_at=start, ended_at=end))
            logged += 1

        db.commit()
    print(
        f"Seeded {DEMO_EMAIL}: {len(COURSES)} courses, "
        f"{len(ASSIGNMENTS)} deadlines, {logged} study sessions"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--tz", default="America/Toronto", help="IANA time zone for 'this week'")
    parser.add_argument("--password", default=DEMO_PASSWORD)
    args = parser.parse_args()
    seed(args.tz, args.password)
