from datetime import datetime

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class RateLimitCounter(Base):
    """How many times something happened in one fixed time window ("login failures for this
    email, 10:00–10:15"). See app/ratelimit.py.

    The key is a SHA-256 hash of the limit's name and subject, so the table holds no emails or
    IP addresses.
    """

    __tablename__ = "rate_limit_counters"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    window_start: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), primary_key=True, index=True
    )
    count: Mapped[int] = mapped_column(Integer)
