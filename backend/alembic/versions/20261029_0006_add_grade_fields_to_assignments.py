"""add grade fields to assignments: weight, score, out_of

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# (name, condition). Autogenerate doesn't detect CHECK constraints, so they're listed by hand.
CHECKS = [
    ("weight_is_a_percentage", "weight > 0 AND weight <= 100"),
    ("score_not_negative", "score >= 0"),
    ("out_of_positive", "out_of > 0"),
    ("score_has_out_of", "(score IS NULL) = (out_of IS NULL)"),
]


def upgrade() -> None:
    op.add_column("assignments", sa.Column("weight", sa.Numeric(5, 2), nullable=True))
    op.add_column("assignments", sa.Column("score", sa.Numeric(7, 2), nullable=True))
    op.add_column("assignments", sa.Column("out_of", sa.Numeric(7, 2), nullable=True))
    for name, condition in CHECKS:
        op.create_check_constraint(op.f(f"ck_assignments_{name}"), "assignments", condition)


def downgrade() -> None:
    for name, _ in CHECKS:
        op.drop_constraint(op.f(f"ck_assignments_{name}"), "assignments", type_="check")
    op.drop_column("assignments", "out_of")
    op.drop_column("assignments", "score")
    op.drop_column("assignments", "weight")
