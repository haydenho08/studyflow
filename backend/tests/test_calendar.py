"""The calendar feed: a secret URL that calendar apps subscribe to, and the iCalendar it serves."""

import datetime as dt

import pytest

from app.ics import MAX_LINE_OCTETS, escape_text, fold


@pytest.fixture
def feed_path(client):
    """Turn on the feed for `headers` and return its path."""

    def _feed_path(headers):
        response = client.post("/api/calendar-feed", headers=headers)
        assert response.status_code == 200, response.text
        return response.json()["path"]

    return _feed_path


def unfold(body: str) -> list[str]:
    """Undo line folding, so assertions can look at whole properties."""
    return body.replace("\r\n ", "").split("\r\n")


# --- managing the feed ------------------------------------------------------------------------


def test_feed_is_off_until_turned_on(client, alice):
    assert client.get("/api/calendar-feed", headers=alice).json() == {"path": None}


def test_turning_it_on_gives_a_secret_url(client, alice, feed_path):
    path = feed_path(alice)

    assert path.startswith("/api/calendar/") and path.endswith(".ics")
    assert len(path.removeprefix("/api/calendar/").removesuffix(".ics")) >= 43  # 256 bits
    assert client.get("/api/calendar-feed", headers=alice).json() == {"path": path}
    assert client.get(path).status_code == 200  # no login: calendar apps can't send one


def test_each_user_gets_a_different_url(alice, bob, feed_path):
    assert feed_path(alice) != feed_path(bob)


def test_a_new_url_replaces_the_old_one(client, alice, feed_path):
    old = feed_path(alice)
    new = feed_path(alice)

    assert new != old
    assert client.get(old).status_code == 404
    assert client.get(new).status_code == 200


def test_turning_it_off_kills_the_url(client, alice, feed_path):
    path = feed_path(alice)

    assert client.delete("/api/calendar-feed", headers=alice).status_code == 204
    assert client.get(path).status_code == 404
    assert client.get("/api/calendar-feed", headers=alice).json() == {"path": None}


@pytest.mark.parametrize("method", ["get", "post", "delete"])
def test_managing_the_feed_needs_a_login(client, method):
    assert getattr(client, method)("/api/calendar-feed").status_code == 401


@pytest.mark.parametrize("token", ["not-a-real-token", "x" * 43, "%00"])
def test_unknown_tokens_are_404(client, alice, feed_path, token):
    feed_path(alice)
    response = client.get(f"/api/calendar/{token}.ics")
    assert response.status_code == 404
    assert response.headers["content-type"] == "application/json"  # not the SPA's index.html


# --- what the feed contains -------------------------------------------------------------------


def test_feed_lists_only_that_users_deadlines(
    client, alice, bob, make_course, make_assignment, feed_path
):
    mine = make_assignment(alice, make_course(alice)["id"], title="Mine")
    make_assignment(bob, make_course(bob)["id"], title="Not mine")

    body = client.get(feed_path(alice)).text

    assert f"UID:assignment-{mine['id']}@studyflow" in body
    assert "Mine" in body
    assert "Not mine" not in body


def test_event_has_the_deadline_in_utc(client, alice, make_course, make_assignment, feed_path):
    course = make_course(alice, code="EECS 2030")
    make_assignment(
        alice, course["id"], title="Lab 5", kind="lab", due_at="2026-11-02T17:00:00-05:00"
    )

    response = client.get(feed_path(alice))
    lines = unfold(response.text)

    assert response.headers["content-type"] == "text/calendar; charset=utf-8"
    assert response.headers["cache-control"] == "private, no-cache"
    assert lines[0] == "BEGIN:VCALENDAR" and lines[-2] == "END:VCALENDAR" and lines[-1] == ""
    assert "DTSTART:20261102T220000Z" in lines
    assert "SUMMARY:EECS 2030: Lab 5" in lines
    assert "DESCRIPTION:Lab · Medium priority · To do" in lines
    assert "CATEGORIES:Lab" in lines
    assert "DTEND" not in response.text  # a deadline is a moment


def test_done_deadlines_are_ticked(client, alice, make_course, make_assignment, feed_path):
    make_assignment(alice, make_course(alice)["id"], title="Quiz", status="done")

    assert "SUMMARY:✓ EECS 1012: Quiz" in unfold(client.get(feed_path(alice)).text)


def test_text_is_escaped(client, alice, make_course, make_assignment, feed_path):
    make_assignment(
        alice,
        make_course(alice)["id"],
        title="Read ch. 3, 4; notes",
        description="Line one\nC:\\path",
    )

    lines = unfold(client.get(feed_path(alice)).text)

    assert "SUMMARY:EECS 1012: Read ch. 3\\, 4\\; notes" in lines
    assert any(line.endswith("To do\\n\\nLine one\\nC:\\\\path") for line in lines)


def test_long_lines_are_folded(client, alice, make_course, make_assignment, feed_path):
    title = " ".join(["Révision"] * 20)
    make_assignment(alice, make_course(alice)["id"], title=title)

    raw = client.get(feed_path(alice)).content

    assert all(len(line) <= MAX_LINE_OCTETS for line in raw.split(b"\r\n"))
    assert b"\n" not in raw.replace(b"\r\n", b"")  # every line ends in CRLF
    assert f"SUMMARY:EECS 1012: {title}" in unfold(raw.decode("utf-8"))


def test_old_deadlines_are_left_out(client, alice, make_course, make_assignment, feed_path):
    course_id = make_course(alice)["id"]
    long_ago = (dt.datetime.now(dt.UTC) - dt.timedelta(days=200)).isoformat()
    make_assignment(alice, course_id, title="Ancient", due_at=long_ago)
    make_assignment(alice, course_id, title="Current")

    body = client.get(feed_path(alice)).text

    assert "Current" in body
    assert "Ancient" not in body


def test_deleted_course_leaves_the_feed(client, alice, make_course, make_assignment, feed_path):
    course = make_course(alice)
    make_assignment(alice, course["id"], title="Gone soon")
    path = feed_path(alice)

    client.delete(f"/api/courses/{course['id']}", headers=alice)

    assert "VEVENT" not in client.get(path).text


# --- the pieces -------------------------------------------------------------------------------


def test_escape_text_escapes_backslash_first():
    assert escape_text("a\\;b,c\r\nd") == "a\\\\\\;b\\,c\\nd"


def test_fold_never_splits_a_character():
    line = "SUMMARY:" + "é" * 100
    folded = fold(line)

    assert all(len(part.encode("utf-8")) <= MAX_LINE_OCTETS for part in folded.split("\r\n"))
    assert folded.replace("\r\n ", "") == line


def test_short_lines_are_not_folded():
    assert fold("SUMMARY:short") == "SUMMARY:short"
