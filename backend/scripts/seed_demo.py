"""Reset the demo account now, with data around the current week.

The live site does this by itself (POST /api/auth/demo rebuilds stale demo data), so this is
mainly for local development and the screenshot tool, which logs in with a known password.

Usage (from backend/):
    python -m scripts.seed_demo                      # America/Toronto, password studyflow-demo
    python -m scripts.seed_demo --tz Europe/London --password "something-long"
"""

import argparse
from zoneinfo import ZoneInfo

from sqlalchemy import select

from app.db import SessionLocal
from app.demo import ASSIGNMENTS, COURSES, DEMO_EMAIL, reset_demo_data
from app.models import User
from app.security import hash_password

LOCAL_PASSWORD = "studyflow-demo"


def seed(tz: str, password: str) -> None:
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == DEMO_EMAIL))
        if user is None:
            user = User(email=DEMO_EMAIL, hashed_password=hash_password(password))
            db.add(user)
            db.flush()
        sessions = reset_demo_data(db, user, ZoneInfo(tz), password=password)
        db.commit()
    print(
        f"Seeded {DEMO_EMAIL}: {len(COURSES)} courses, "
        f"{len(ASSIGNMENTS)} deadlines, {sessions} study sessions"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--tz", default="America/Toronto", help="IANA time zone for 'this week'")
    parser.add_argument("--password", default=LOCAL_PASSWORD)
    args = parser.parse_args()
    seed(args.tz, args.password)
