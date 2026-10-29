"""add users.calendar_token for the calendar feed

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("calendar_token", sa.String(length=64), nullable=True))
    op.create_unique_constraint(op.f("uq_users_calendar_token"), "users", ["calendar_token"])


def downgrade() -> None:
    op.drop_constraint(op.f("uq_users_calendar_token"), "users", type_="unique")
    op.drop_column("users", "calendar_token")
