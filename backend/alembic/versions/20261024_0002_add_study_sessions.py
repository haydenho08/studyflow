"""add study sessions

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-24 19:50:00.627543
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "study_sessions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("course_id", sa.Integer(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "ended_at > started_at", name=op.f("ck_study_sessions_ended_after_started")
        ),
        sa.ForeignKeyConstraint(
            ["course_id"],
            ["courses.id"],
            name=op.f("fk_study_sessions_course_id_courses"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_study_sessions")),
    )
    op.create_index(
        "ix_study_sessions_course_id_started_at",
        "study_sessions",
        ["course_id", "started_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_study_sessions_course_id_started_at", table_name="study_sessions")
    op.drop_table("study_sessions")
