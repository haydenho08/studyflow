import pytest


def test_course_crud_round_trip(client, alice, make_course):
    created = make_course(alice, code=" eecs 2030 ", name="Advanced OOP", color="#ff8800")
    assert created["code"] == "EECS 2030"  # stripped and uppercased
    assert created["color"] == "#FF8800"

    listed = client.get("/api/courses", headers=alice).json()
    assert [c["id"] for c in listed] == [created["id"]]

    fetched = client.get(f"/api/courses/{created['id']}", headers=alice)
    assert fetched.json() == created

    deleted = client.delete(f"/api/courses/{created['id']}", headers=alice)
    assert deleted.status_code == 204
    assert client.get(f"/api/courses/{created['id']}", headers=alice).status_code == 404


def test_courses_are_listed_by_code(client, alice, make_course):
    for code in ["MATH 1090", "EECS 1012", "EECS 1019"]:
        make_course(alice, code=code)

    codes = [c["code"] for c in client.get("/api/courses", headers=alice).json()]

    assert codes == ["EECS 1012", "EECS 1019", "MATH 1090"]


def test_patch_only_changes_fields_that_were_sent(client, alice, make_course):
    course = make_course(alice, name="Intro to CS", color="#111111")

    response = client.patch(f"/api/courses/{course['id']}", json={"color": "#222222"}, headers=alice)

    assert response.status_code == 200
    updated = response.json()
    assert updated["color"] == "#222222"
    assert updated["name"] == "Intro to CS"  # untouched
    assert updated["code"] == course["code"]


def test_patch_with_empty_body_is_a_no_op(client, alice, make_course):
    course = make_course(alice)
    response = client.patch(f"/api/courses/{course['id']}", json={}, headers=alice)
    assert response.status_code == 200
    assert response.json()["name"] == course["name"]


@pytest.mark.parametrize(
    "patch",
    [{"name": None}, {"code": None}, {"color": None}, {"name": "   "}, {"color": "red"}, {"nme": "typo"}],
    ids=["null-name", "null-code", "null-color", "blank-name", "bad-color", "unknown-field"],
)
def test_patch_validation_errors(client, alice, make_course, patch):
    course = make_course(alice)
    response = client.patch(f"/api/courses/{course['id']}", json=patch, headers=alice)
    assert response.status_code == 422


@pytest.mark.parametrize(
    "body",
    [
        {"code": "EECS 1012"},
        {"name": "Intro", "code": ""},
        {"name": "Intro", "code": "EECS 1012", "color": "#12345"},
        {"name": "x" * 101, "code": "EECS 1012"},
    ],
    ids=["missing-name", "empty-code", "short-color", "name-too-long"],
)
def test_create_validation_errors(client, alice, body):
    assert client.post("/api/courses", json=body, headers=alice).status_code == 422


def test_duplicate_code_conflicts_for_same_user_only(client, alice, bob, make_course):
    make_course(alice, code="EECS 1012")

    duplicate = client.post(
        "/api/courses", json={"name": "Again", "code": "eecs 1012"}, headers=alice
    )
    assert duplicate.status_code == 409

    # A different user can use the same code.
    make_course(bob, code="EECS 1012")


def test_patch_into_duplicate_code_conflicts(client, alice, make_course):
    make_course(alice, code="EECS 1012")
    other = make_course(alice, code="EECS 1019")

    response = client.patch(f"/api/courses/{other['id']}", json={"code": "EECS 1012"}, headers=alice)

    assert response.status_code == 409


def test_courses_require_authentication(client):
    assert client.get("/api/courses").status_code == 401
    assert client.post("/api/courses", json={"name": "x", "code": "y"}).status_code == 401


def test_users_cannot_see_or_touch_each_others_courses(client, alice, bob, make_course):
    course = make_course(alice)
    url = f"/api/courses/{course['id']}"

    assert client.get("/api/courses", headers=bob).json() == []
    # 404, not 403: Bob can't tell whether this id exists at all.
    assert client.get(url, headers=bob).status_code == 404
    assert client.patch(url, json={"name": "Hacked"}, headers=bob).status_code == 404
    assert client.delete(url, headers=bob).status_code == 404

    # ...and Alice's course is unchanged.
    assert client.get(url, headers=alice).json() == course


def test_unknown_course_id_is_404(client, alice):
    assert client.get("/api/courses/999999", headers=alice).status_code == 404
