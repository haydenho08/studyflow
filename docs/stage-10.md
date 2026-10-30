# Stage 10: Shared courses

**Goal:** a study group shares a course. Everyone sees the same deadlines and can add to them, but each person ticks off, marks and times **their own** work, and nobody sees anyone else's progress.

```
backend/app/ownership.py                  access rules: owner, member, outsider (one module)
backend/app/models/course_member.py       who joined which course
backend/app/models/assignment_progress.py each person's status and mark on each deadline
backend/app/progress.py                   joins "my progress" onto shared deadlines for the API
backend/app/routers/courses.py            invite link, preview/join, members, leave/remove
backend/alembic/versions/…_0007_…         the schema change, copying existing data across
frontend/src/components/ShareCourseDialog.tsx   Share (owner) / People (member)
frontend/src/pages/JoinPage.tsx           /join/<token>
```

---

## 1. The model change

Until now, every course had one user, so "the deadline's status" and "my status" were the same thing. Sharing splits them:

| Belongs to the **course** (shared) | Belongs to the **person** |
|---|---|
| deadline title, due date, type, priority, notes, weight | status (to do / in progress / done) |
| the repeating-series link | mark (score / out of) |
| | study sessions |

- **`course_members (course_id, user_id, joined_at)`:** the owner isn't listed; the owner is `courses.user_id`, so a course always has exactly one.
- **`assignment_progress (assignment_id, user_id, status, score, out_of)`:** one row per deadline per person. **No row means "to do, not marked"**, so joining costs nothing, a new member starts with a clean slate, and nobody has to pre-create rows for everyone. The mark `CHECK` constraints moved here from `assignments`.
- **`study_sessions.user_id`:** a session belongs to whoever studied, not to the course. The overlap rule ("you can't study two things at once") is now per person, so two classmates studying at the same time isn't an overlap. There's a test for that.

The API keeps its shape. `AssignmentRead` still has `status`, `score` and `out_of`, now filled in from *your* progress row (`app/progress.py`). `updated_at` is the later of the deadline's change and your own, so the calendar feed's `LAST-MODIFIED` still moves when you tick something off. The frontend needed no changes for any of this.

## 2. The migration moves data, not just columns

Autogenerate saw "drop `assignments.status`, `score`, `out_of`; add a table". Running that would have deleted every status and mark. The migration is hand-written:

1. Create the new tables.
2. Copy each deadline's status and mark to its course owner (the only user it could have belonged to). Only non-default rows are copied, since no row already means "to do".
3. Drop the old constraints and columns.
4. Add `study_sessions.user_id` as nullable, fill it from each course's owner, then make it `NOT NULL` and add the foreign key.

It was checked against the local database with real demo data: 47 progress rows, 36 done and 483 marks before the upgrade, the same after, and the same again after downgrading. The downgrade copies owners' progress back; members' data has nowhere to go in the old schema, so it's dropped.

## 3. Access rules, in one place

`app/ownership.py` is still the only place that decides access. Every list query filters on `visible_course_ids(user)`, a subquery of courses you own *or* have joined, and every single-row lookup goes through `get_course` / `get_assignment` / `get_own_session`.

| | Outsider | Member | Owner |
|---|---|---|---|
| See the course and its deadlines | 404 | ✓ | ✓ |
| Add, edit, delete deadlines | 404 | ✓ | ✓ |
| Their own status, marks, study time | | ✓ | ✓ |
| See who's in it | 404 | ✓ | ✓ |
| Rename or recolour the course, delete it for everyone | 404 | **403** | ✓ |
| Invite link: see, replace, turn off | 404 | **403** | ✓ |
| Remove someone | 404 | **403** (can leave) | ✓ (can't leave) |

**"404, not 403" still holds for outsiders:** a course you aren't in is indistinguishable from one that doesn't exist. A member asking for an owner-only action already knows the course exists, so they get an honest **403**, which also lets the UI say "only the owner can do that" instead of "not found".

Members can add and edit deadlines because that's the point of a study group: whoever sees the email about the moved lab updates it for everyone. Destructive actions on the course itself stay with the owner.

## 4. Invite links

Same design as the calendar feed (Stage 6): `courses.invite_token` holds 256 random bits, only well-formed tokens are ever looked up, and unknown, replaced or switched-off links all give the same 404.

- **Owner:** `POST /courses/{id}/invite` turns it on or replaces it, and `DELETE` turns it off. Replacing it stops the old link at once, but people who already joined stay in.
- **`GET /invites/{token}`** previews the course (code, name, owner, size, and your role if you're already in) before you join. **`POST`** joins.
  - Joining twice is harmless: the second call is a no-op, and an `IntegrityError` from a race between two tabs is treated as success.
  - The owner joining their own course is a 409.
- **Invites need a login.** On the frontend, `/join/<token>` is behind `RequireAuth`, so a visitor without an account is sent to log in, can switch to sign-up (the "where to go next" state now survives that switch), and lands straight back on the invite. The e2e test does exactly this.

## 5. Leaving and removing

`DELETE /courses/{id}/members/{user_id}`: your own id means you leave; the owner may remove anyone else. Either way, that person's progress rows and study sessions for the course are deleted in the same transaction, because they're about a course they can no longer see. The owner can't leave (409): deleting the course is the owner's way out, and the confirmation says it removes it for all N people.

## 6. The UI

- **Courses page:** a people button on every course. For the owner it opens **Share**: the invite link with Copy, Make a new link and Turn off, plus the member list with Remove. For a member it opens **People**: who's in it, and Leave. Members' course cards say "Shared by alice@…", and their edit and delete buttons are hidden.
- **Join page:** who shared it, the course code and name, how many people are in it, a short "your progress stays yours" note, and **Join**, which lands you on that course's assignments.
- Native `<dialog>`s stack, so the confirm dialog opens over the share dialog without any extra work.
- Leaving or removing someone refreshes courses, assignments, grades, sessions and stats, since all of them change.

## 7. Tests

- **Backend (40 new):**
  - The invite lifecycle: off by default, secret path, preview, login required, bad tokens including `%00`, joining twice, the owner joining, a replaced link with members kept, turning it off.
  - Members: they see deadlines and can add and edit them for everyone, and can log study time.
  - Five owner-only actions return 403 for members; five routes return 404 for outsiders.
  - Per-person status (including the status filter), marks and grades, study time and overlap, and the calendar feed's ✓.
  - The members list, leaving (your progress goes, the owner's stays), removal (study time included), members not removing each other, the owner not leaving, removing a non-member, deleting a course for everyone, and the same course code as a joined course.
- **All 249 existing tests passed unchanged** after the refactor. The API contract didn't move, and those tests are what proved it.
- **End-to-end (2 new):**
  - Alice shares a course. Bob opens the link logged out, signs up, joins, and marks a deadline done; it's still "to do" for Alice. Alice sees "Shared with 1", and Bob leaves.
  - A replaced invite link shows "This invite link doesn't work".
