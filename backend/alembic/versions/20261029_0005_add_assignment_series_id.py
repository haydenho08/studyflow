"""add assignments.series_id for repeating deadlines

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("assignments", sa.Column("series_id", sa.Uuid(), nullable=True))
    op.create_index(op.f("ix_assignments_series_id"), "assignments", ["series_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_assignments_series_id"), table_name="assignments")
    op.drop_column("assignments", "series_id")
