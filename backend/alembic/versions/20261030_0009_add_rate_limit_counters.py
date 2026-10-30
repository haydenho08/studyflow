"""add rate_limit_counters: attempts per subject per time window

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-30
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "rate_limit_counters",
        sa.Column("key", sa.String(length=64), nullable=False),
        sa.Column("window_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("count", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("key", "window_start", name=op.f("pk_rate_limit_counters")),
    )
    # For deleting old windows.
    op.create_index(
        op.f("ix_rate_limit_counters_window_start"), "rate_limit_counters", ["window_start"]
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_rate_limit_counters_window_start"), table_name="rate_limit_counters")
    op.drop_table("rate_limit_counters")
