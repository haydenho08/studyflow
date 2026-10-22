"""initial schema: users, courses, assignments

Revision ID: 0001
Revises:
Create Date: 2026-10-22
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("hashed_password", sa.String(length=255), nullable=False),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_users")),
        sa.UniqueConstraint("email", name=op.f("uq_users_email")),
    )

    op.create_table(
        "courses",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("code", sa.String(length=20), nullable=False),
        sa.Column("color", sa.String(length=7), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"],
            name=op.f("fk_courses_user_id_users"), ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_courses")),
        sa.UniqueConstraint("user_id", "code", name=op.f("uq_courses_user_id_code")),
    )
    op.create_index(op.f("ix_courses_user_id"), "courses", ["user_id"])

    op.create_table(
        "assignments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("course_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "kind",
            sa.Enum("assignment", "quiz", "exam", "lab", "project",
                    name="assignment_kind", native_enum=False, create_constraint=True, length=20),
            server_default="assignment", nullable=False,
        ),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "priority",
            sa.Enum("low", "medium", "high",
                    name="priority", native_enum=False, create_constraint=True, length=20),
            server_default="medium", nullable=False,
        ),
        sa.Column(
            "status",
            sa.Enum("todo", "in_progress", "done",
                    name="status", native_enum=False, create_constraint=True, length=20),
            server_default="todo", nullable=False,
        ),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["course_id"], ["courses.id"],
            name=op.f("fk_assignments_course_id_courses"), ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_assignments")),
    )
    op.create_index(
        "ix_assignments_course_id_due_at", "assignments", ["course_id", "due_at"]
    )


def downgrade() -> None:
    # Reverse order of creation: children before parents.
    op.drop_index("ix_assignments_course_id_due_at", table_name="assignments")
    op.drop_table("assignments")
    op.drop_index(op.f("ix_courses_user_id"), table_name="courses")
    op.drop_table("courses")
    op.drop_table("users")
