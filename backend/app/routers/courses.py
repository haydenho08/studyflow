from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.deps import CurrentUser, DbSession
from app.models import Assignment, AssignmentProgress, Course, CourseMember, StudySession, User
from app.ownership import get_course, visible_course_ids
from app.schemas.course import (
    CourseCreate,
    CourseInvite,
    CourseMemberRead,
    CourseRead,
    CourseUpdate,
    InvitePreview,
)
from app.security import is_url_token, new_url_token

router = APIRouter(prefix="/courses", tags=["courses"])
invites = APIRouter(prefix="/invites", tags=["courses"])


def _commit_or_conflict(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "You already have a course with this code"
        ) from None


def _member_counts(db: Session, course_ids: list[int]) -> dict[int, int]:
    rows = db.execute(
        select(CourseMember.course_id, func.count())
        .where(CourseMember.course_id.in_(course_ids))
        .group_by(CourseMember.course_id)
    )
    return dict(rows.tuples().all())


def _reads(db: Session, user: User, courses: list[Course]) -> list[CourseRead]:
    counts = _member_counts(db, [c.id for c in courses])
    owners = dict(
        db.execute(select(User.id, User.email).where(User.id.in_({c.user_id for c in courses})))
        .tuples()
        .all()
    )
    return [
        CourseRead(
            id=c.id,
            name=c.name,
            code=c.code,
            color=c.color,
            role="owner" if c.user_id == user.id else "member",
            owner_email=owners[c.user_id],
            member_count=counts.get(c.id, 0),
            created_at=c.created_at,
            updated_at=c.updated_at,
        )
        for c in courses
    ]


@router.get("", response_model=list[CourseRead])
def list_courses(db: DbSession, user: CurrentUser) -> list[CourseRead]:
    """Your own courses and the ones you've joined."""
    query = select(Course).where(Course.id.in_(visible_course_ids(user)))
    return _reads(db, user, list(db.scalars(query.order_by(Course.code, Course.id))))


@router.post("", response_model=CourseRead, status_code=status.HTTP_201_CREATED)
def create_course(payload: CourseCreate, db: DbSession, user: CurrentUser) -> CourseRead:
    # user_id comes from the token, never from the request body.
    course = Course(user_id=user.id, **payload.model_dump())
    db.add(course)
    _commit_or_conflict(db)
    db.refresh(course)
    return _reads(db, user, [course])[0]


@router.get("/{course_id}", response_model=CourseRead)
def read_course(course_id: int, db: DbSession, user: CurrentUser) -> CourseRead:
    return _reads(db, user, [get_course(db, user, course_id)])[0]


@router.patch("/{course_id}", response_model=CourseRead)
def update_course(
    course_id: int, payload: CourseUpdate, db: DbSession, user: CurrentUser
) -> CourseRead:
    course = get_course(db, user, course_id, owner_only=True)
    # exclude_unset: only touch fields the client actually sent.
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(course, field, value)
    _commit_or_conflict(db)
    db.refresh(course)  # pick up the new updated_at from the database
    return _reads(db, user, [course])[0]


@router.delete("/{course_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_course(course_id: int, db: DbSession, user: CurrentUser) -> Response:
    """Delete the course for everyone in it. Members who only want out should leave instead."""
    course = get_course(db, user, course_id, owner_only=True)
    db.delete(course)  # ON DELETE CASCADE: assignments, progress, sessions, memberships
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- sharing: the invite link ------------------------------------------------------------------


def _invite(course: Course) -> CourseInvite:
    token = course.invite_token
    return CourseInvite(path=f"/join/{token}" if token else None)


@router.get("/{course_id}/invite", response_model=CourseInvite)
def read_invite(course_id: int, db: DbSession, user: CurrentUser) -> CourseInvite:
    return _invite(get_course(db, user, course_id, owner_only=True))


@router.post("/{course_id}/invite", response_model=CourseInvite)
def create_invite(course_id: int, db: DbSession, user: CurrentUser) -> CourseInvite:
    """Turn the invite link on, or replace it: the old link stops working at once (people who
    already joined stay in)."""
    course = get_course(db, user, course_id, owner_only=True)
    course.invite_token = new_url_token()
    db.commit()
    return _invite(course)


@router.delete("/{course_id}/invite", status_code=status.HTTP_204_NO_CONTENT)
def delete_invite(course_id: int, db: DbSession, user: CurrentUser) -> None:
    get_course(db, user, course_id, owner_only=True).invite_token = None
    db.commit()


def _course_for_invite(db: Session, token: str) -> Course:
    course = (
        db.scalar(select(Course).where(Course.invite_token == token))
        if is_url_token(token)
        else None
    )
    if course is None:
        # Unknown, replaced and switched-off links all look the same.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invite link not found")
    return course


def _role(db: Session, user: User, course: Course) -> str | None:
    if course.user_id == user.id:
        return "owner"
    joined = db.get(CourseMember, (course.id, user.id))
    return "member" if joined else None


@invites.get("/{token}", response_model=InvitePreview)
def preview_invite(token: str, db: DbSession, user: CurrentUser) -> InvitePreview:
    """What the link is for, before you join. You must be logged in: the link isn't public."""
    course = _course_for_invite(db, token)
    read = _reads(db, user, [course])[0]
    return InvitePreview(
        course_id=course.id,
        code=course.code,
        name=course.name,
        color=course.color,
        owner_email=read.owner_email,
        member_count=read.member_count,
        role=_role(db, user, course),
    )


@invites.post("/{token}", response_model=CourseRead)
def accept_invite(token: str, db: DbSession, user: CurrentUser) -> CourseRead:
    """Join the course. Joining twice is harmless; the owner can't join their own course."""
    course = _course_for_invite(db, token)
    if course.user_id == user.id:
        raise HTTPException(status.HTTP_409_CONFLICT, "This is your own course")
    if db.get(CourseMember, (course.id, user.id)) is None:
        db.add(CourseMember(course_id=course.id, user_id=user.id))
        try:
            db.commit()
        except IntegrityError:  # joined in another tab a moment ago: same result
            db.rollback()
    return _reads(db, user, [course])[0]


# --- sharing: members --------------------------------------------------------------------------


@router.get("/{course_id}/members", response_model=list[CourseMemberRead])
def list_members(course_id: int, db: DbSession, user: CurrentUser) -> list[CourseMemberRead]:
    """Everyone in the course, owner first. Anyone in it can see who else is."""
    course = get_course(db, user, course_id)
    owner = db.get(User, course.user_id)
    assert owner is not None
    joined = db.execute(
        select(User.id, User.email, CourseMember.joined_at)
        .join(CourseMember, CourseMember.user_id == User.id)
        .where(CourseMember.course_id == course.id)
        .order_by(CourseMember.joined_at, User.id)
    )
    return [
        CourseMemberRead(user_id=owner.id, email=owner.email, role="owner", joined_at=None),
        *(
            CourseMemberRead(user_id=uid, email=email, role="member", joined_at=at)
            for uid, email, at in joined
        ),
    ]


@router.delete("/{course_id}/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(course_id: int, member_id: int, db: DbSession, user: CurrentUser) -> None:
    """Leave a course (your own id), or, as its owner, remove someone from it.

    Their status, marks and study sessions for this course go with them: they were about a
    course they can no longer see.
    """
    course = get_course(db, user, course_id)
    if member_id == course.user_id:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "The owner can't leave; delete the course instead"
        )
    if member_id != user.id and course.user_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the course's owner can remove people")
    membership = db.get(CourseMember, (course.id, member_id))
    if membership is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not a member of this course")

    in_course = select(Assignment.id).where(Assignment.course_id == course.id)
    db.execute(
        delete(AssignmentProgress).where(
            AssignmentProgress.user_id == member_id,
            AssignmentProgress.assignment_id.in_(in_course),
        )
    )
    db.execute(
        delete(StudySession).where(
            StudySession.user_id == member_id, StudySession.course_id == course.id
        )
    )
    db.delete(membership)
    db.commit()
