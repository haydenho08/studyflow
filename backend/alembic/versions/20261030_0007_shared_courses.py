"""shared courses: members, invite links, and each person's own progress

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-30

Status and marks move off assignments (shared by everyone in a course) into assignment_progress
(one row per deadline and person), and study sessions get the user who studied. Existing data
is copied over: until now every course had one user, its owner, so that's whose progress it is.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

MARK_CHECKS = [
    ("score_not_negative", "score >= 0"),
    ("out_of_positive", "out_of > 0"),
    ("score_has_out_of", "(score IS NULL) = (out_of IS NULL)"),
]
STATUS_CHECK = ("status", "status IN ('todo', 'in_progress', 'done')")


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column(name, sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False)
        for name in ("created_at", "updated_at")
    ]


def upgrade() -> None:
    op.create_table(
        "course_members",
        sa.Column("course_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column(
            "joined_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["course_id"],
            ["courses.id"],
            name=op.f("fk_course_members_course_id_courses"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_course_members_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("course_id", "user_id", name=op.f("pk_course_members")),
    )
    op.create_index(op.f("ix_course_members_user_id"), "course_members", ["user_id"])

    op.add_column("courses", sa.Column("invite_token", sa.String(length=64), nullable=True))
    op.create_unique_constraint(op.f("uq_courses_invite_token"), "courses", ["invite_token"])

    op.create_table(
        "assignment_progress",
        sa.Column("assignment_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=20), server_default="todo", nullable=False),
        sa.Column("score", sa.Numeric(7, 2), nullable=True),
        sa.Column("out_of", sa.Numeric(7, 2), nullable=True),
        *_timestamps(),
        sa.CheckConstraint(STATUS_CHECK[1], name=op.f("ck_assignment_progress_status")),
        *(
            sa.CheckConstraint(condition, name=op.f(f"ck_assignment_progress_{name}"))
            for name, condition in MARK_CHECKS
        ),
        sa.ForeignKeyConstraint(
            ["assignment_id"],
            ["assignments.id"],
            name=op.f("fk_assignment_progress_assignment_id_assignments"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_assignment_progress_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("assignment_id", "user_id", name=op.f("pk_assignment_progress")),
    )
    op.create_index(op.f("ix_assignment_progress_user_id"), "assignment_progress", ["user_id"])

    # Copy each deadline's status and mark to its course owner. Rows that say only "todo, not
    # marked" aren't needed: no row means exactly that.
    op.execute(
        """
        INSERT INTO assignment_progress (assignment_id, user_id, status, score, out_of)
        SELECT a.id, c.user_id, a.status, a.score, a.out_of
        FROM assignments a JOIN courses c ON c.id = a.course_id
        WHERE a.status <> 'todo' OR a.score IS NOT NULL
        """
    )
    for name, _ in [STATUS_CHECK, *MARK_CHECKS]:
        op.drop_constraint(op.f(f"ck_assignments_{name}"), "assignments", type_="check")
    for column in ("status", "score", "out_of"):
        op.drop_column("assignments", column)

    # Study sessions: whoever owns the course studied (the only person who could, until now).
    op.add_column("study_sessions", sa.Column("user_id", sa.Integer(), nullable=True))
    op.execute(
        "UPDATE study_sessions s SET user_id = c.user_id FROM courses c WHERE c.id = s.course_id"
    )
    op.alter_column("study_sessions", "user_id", nullable=False)
    op.create_index(op.f("ix_study_sessions_user_id"), "study_sessions", ["user_id"])
    op.create_foreign_key(
        op.f("fk_study_sessions_user_id_users"),
        "study_sessions",
        "users",
        ["user_id"],
        ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    # Back to one user per course: members' sessions and progress have nowhere to go.
    op.drop_constraint(
        op.f("fk_study_sessions_user_id_users"), "study_sessions", type_="foreignkey"
    )
    op.drop_index(op.f("ix_study_sessions_user_id"), table_name="study_sessions")
    op.execute(
        "DELETE FROM study_sessions s USING courses c WHERE c.id = s.course_id AND s.user_id <> c.user_id"
    )
    op.drop_column("study_sessions", "user_id")

    op.add_column(
        "assignments",
        sa.Column("status", sa.String(length=20), server_default="todo", nullable=False),
    )
    op.add_column("assignments", sa.Column("score", sa.Numeric(7, 2), nullable=True))
    op.add_column("assignments", sa.Column("out_of", sa.Numeric(7, 2), nullable=True))
    op.execute(
        """
        UPDATE assignments a SET status = p.status, score = p.score, out_of = p.out_of
        FROM assignment_progress p JOIN courses c ON c.user_id = p.user_id
        WHERE p.assignment_id = a.id AND c.id = a.course_id
        """
    )
    for name, condition in [STATUS_CHECK, *MARK_CHECKS]:
        op.create_check_constraint(op.f(f"ck_assignments_{name}"), "assignments", condition)
    op.drop_index(op.f("ix_assignment_progress_user_id"), table_name="assignment_progress")
    op.drop_table("assignment_progress")

    op.drop_constraint(op.f("uq_courses_invite_token"), "courses", type_="unique")
    op.drop_column("courses", "invite_token")
    op.drop_index(op.f("ix_course_members_user_id"), table_name="course_members")
    op.drop_table("course_members")
