from collections.abc import Iterator
from datetime import datetime

from sqlalchemy import DateTime, Engine, MetaData, create_engine, func
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from app.config import get_settings

# Deterministic constraint names, so Alembic migrations can refer to (and later drop) them.
NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


class TimestampMixin:
    """created_at / updated_at columns, stored as timestamptz and set by the database."""

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


def make_engine(url: str, **connect_args: object) -> Engine:
    # connect_timeout: fail fast with an error instead of hanging if the database is unreachable.
    # No session time zone is set here: connection poolers (e.g. Neon's) may reject startup
    # options. API responses are converted to UTC by the schemas (schemas.common.UtcDatetime).
    return create_engine(
        url,
        pool_pre_ping=True,
        connect_args={"connect_timeout": 5, **connect_args},
    )


engine = make_engine(get_settings().database_url)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    """FastAPI dependency: one session per request, always closed afterwards."""
    with SessionLocal() as session:
        yield session
