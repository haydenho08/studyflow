"""Account settings: change password and email, reset a forgotten password, delete the account."""

import re
from datetime import UTC, datetime, timedelta
from email import message_from_bytes

import pytest
from sqlalchemy import select

from app.config import get_settings
from app.models import EmailToken

PASSWORD = "correct-horse-battery"
NEW_PASSWORD = "a-brand-new-passphrase"
LINK = re.compile(r"(https?://\S+/([a-z-]+)#token=([A-Za-z0-9_-]{43}))")


@pytest.fixture
def outbox(monkeypatch, tmp_path):
    """Turn email on, writing messages to a folder; returns a function listing them."""
    settings = get_settings()
    monkeypatch.setattr(settings, "mail_backend", "file")
    monkeypatch.setattr(settings, "mail_outbox_dir", tmp_path)

    def messages() -> list[dict]:
        found = []
        for path in sorted(tmp_path.glob("*.eml"), key=lambda p: p.stat().st_mtime_ns):
            message = message_from_bytes(path.read_bytes())
            body = message.get_payload(decode=True).decode()
            link = LINK.search(body)
            found.append(
                {
                    "to": message["To"],
                    "subject": message["Subject"],
                    "body": body,
                    "link": link and link.group(1),
                    "page": link and link.group(2),
                    "token": link and link.group(3),
                }
            )
        return found

    return messages


def log_in(client, email="alice@example.com", password=PASSWORD):
    return client.post("/api/auth/login", data={"username": email, "password": password})


def bearer(response) -> dict[str, str]:
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def me(client, headers) -> int:
    return client.get("/api/auth/me", headers=headers).status_code


@pytest.fixture
def demo(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "demo_enabled", True)
    return bearer(client.post("/api/auth/demo"))


# --- what the server offers -------------------------------------------------------------------


def test_email_is_off_unless_configured(client):
    assert client.get("/api/config").json() == {"email_enabled": False, "demo_enabled": False}


def test_config_says_when_email_is_on(client, outbox):
    assert client.get("/api/config").json()["email_enabled"] is True


# --- changing the password --------------------------------------------------------------------


def change_password(client, headers, current=PASSWORD, new=NEW_PASSWORD):
    body = {"current_password": current, "new_password": new}
    return client.post("/api/account/password", json=body, headers=headers)


def test_changing_the_password(client, alice):
    assert change_password(client, alice).status_code == 204
    assert log_in(client).status_code == 401
    assert log_in(client, password=NEW_PASSWORD).status_code == 200


def test_it_needs_the_current_password(client, alice):
    response = change_password(client, alice, current="not-my-password")
    assert response.status_code == 403
    assert log_in(client).status_code == 200  # unchanged


def test_the_new_password_follows_the_sign_up_rules(client, alice):
    assert change_password(client, alice, new="short").status_code == 422
    assert change_password(client, alice, new="é" * 37).status_code == 422  # 74 bytes


def test_other_devices_are_logged_out_but_this_one_stays(client, alice):
    laptop = bearer(log_in(client))
    assert change_password(client, alice).status_code == 204
    assert me(client, alice) == 200  # the device that changed it
    assert me(client, laptop) == 401


def test_changing_the_password_needs_a_login(client):
    body = {"current_password": PASSWORD, "new_password": NEW_PASSWORD}
    assert client.post("/api/account/password", json=body).status_code == 401


def test_the_demo_password_cant_be_changed(client, demo):
    assert change_password(client, demo, current="whatever").status_code == 403


# --- forgotten password -----------------------------------------------------------------------


def request_reset(client, email="alice@example.com"):
    return client.post("/api/account/password-reset", json={"email": email})


def reset(client, token, password=NEW_PASSWORD):
    body = {"token": token, "new_password": password}
    return client.post("/api/account/password-reset/confirm", json=body)


def test_a_reset_link_is_emailed(client, alice, outbox):
    assert request_reset(client, "ALICE@example.com").status_code == 202  # case-insensitive
    [mail] = outbox()
    assert mail["to"] == "alice@example.com"
    assert mail["subject"] == "Reset your StudyFlow password"
    assert mail["page"] == "reset-password"
    assert mail["link"].startswith("https://testserver/reset-password#token=")


def test_reset_doesnt_reveal_who_has_an_account(client, alice, outbox):
    known = request_reset(client)
    unknown = request_reset(client, "nobody@example.com")
    assert known.status_code == unknown.status_code == 202
    assert known.json() == unknown.json()
    assert [m["to"] for m in outbox()] == ["alice@example.com"]


def test_resetting_the_password(client, alice, outbox):
    request_reset(client)
    assert reset(client, outbox()[0]["token"]).status_code == 204
    assert log_in(client).status_code == 401
    assert log_in(client, password=NEW_PASSWORD).status_code == 200


def test_a_reset_logs_out_every_device(client, alice, outbox):
    request_reset(client)
    reset(client, outbox()[0]["token"])
    assert me(client, alice) == 401  # whoever might have had the old password is out


def test_a_reset_link_works_once(client, alice, outbox):
    request_reset(client)
    token = outbox()[0]["token"]
    assert reset(client, token).status_code == 204
    assert reset(client, token, password="yet-another-password").status_code == 404


def test_only_the_newest_reset_link_works(client, alice, outbox):
    request_reset(client)
    request_reset(client)
    first, second = (m["token"] for m in outbox())
    assert reset(client, first).status_code == 404
    assert reset(client, second).status_code == 204


def test_reset_links_expire(client, alice, outbox, db):
    request_reset(client)
    row = db.scalar(select(EmailToken))
    row.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    db.commit()
    assert reset(client, outbox()[0]["token"]).status_code == 404


def test_changing_the_password_cancels_reset_links(client, alice, outbox):
    request_reset(client)
    change_password(client, alice)
    assert reset(client, outbox()[0]["token"], password="third-password-here").status_code == 404


@pytest.mark.parametrize("token", ["x" * 43, "nope", "\x00", ""])
def test_made_up_reset_tokens_are_404(client, outbox, token):
    assert reset(client, token).status_code == 404


def test_only_hashes_of_links_are_stored(client, alice, outbox, db):
    request_reset(client)
    stored = db.scalar(select(EmailToken.token_hash))
    assert outbox()[0]["token"] not in stored and len(stored) == 64


def test_reset_needs_email_to_be_set_up(client, alice):
    assert request_reset(client).status_code == 503


def test_the_demo_account_gets_no_reset_link(client, demo, outbox):
    assert request_reset(client, "demo@studyflow.app").status_code == 202
    assert outbox() == []


def test_links_use_the_public_url_when_set(client, alice, outbox, monkeypatch):
    monkeypatch.setattr(get_settings(), "public_url", "https://studyflow.example/")
    request_reset(client)
    assert outbox()[0]["link"].startswith("https://studyflow.example/reset-password#token=")


# --- changing the email -----------------------------------------------------------------------


def change_email(client, headers, new="alice@newmail.example", password=PASSWORD):
    body = {"password": password, "new_email": new}
    return client.post("/api/account/email", json=body, headers=headers)


def confirm(client, token):
    return client.post("/api/account/email/confirm", json={"token": token})


def test_changing_the_email_waits_for_confirmation(client, alice, outbox):
    assert change_email(client, alice, new="Alice@NewMail.example").status_code == 202
    [mail] = outbox()
    assert mail["to"] == "alice@newmail.example"  # sent to the *new* address, lowercased
    assert mail["page"] == "confirm-email"
    # Nothing has changed yet.
    assert client.get("/api/auth/me", headers=alice).json()["email"] == "alice@example.com"

    response = confirm(client, mail["token"])

    assert response.status_code == 200
    assert response.json()["email"] == "alice@newmail.example"
    assert log_in(client, email="alice@newmail.example").status_code == 200
    assert log_in(client).status_code == 401


def test_the_old_address_is_told(client, alice, outbox):
    change_email(client, alice)
    confirm(client, outbox()[0]["token"])
    notice = outbox()[1]
    assert notice["to"] == "alice@example.com"
    assert "alice@newmail.example" in notice["body"]


def test_email_change_needs_the_password(client, alice, outbox):
    assert change_email(client, alice, password="not-my-password").status_code == 403
    assert outbox() == []


def test_email_already_in_use(client, alice, bob, outbox):
    assert change_email(client, alice, new="BOB@example.com").status_code == 409


def test_email_unchanged(client, alice, outbox):
    assert change_email(client, alice, new="alice@example.com").status_code == 422


def test_address_taken_before_the_link_is_clicked(client, alice, outbox, make_user):
    change_email(client, alice)
    make_user("alice@newmail.example")  # someone else signs up with it in the meantime
    assert confirm(client, outbox()[0]["token"]).status_code == 409
    assert client.get("/api/auth/me", headers=alice).json()["email"] == "alice@example.com"


def test_a_confirmation_link_works_once(client, alice, outbox):
    change_email(client, alice)
    token = outbox()[0]["token"]
    assert confirm(client, token).status_code == 200
    assert confirm(client, token).status_code == 404


def test_reset_and_confirm_tokens_arent_interchangeable(client, alice, outbox):
    change_email(client, alice)
    assert reset(client, outbox()[0]["token"]).status_code == 404


def test_email_change_needs_email_to_be_set_up(client, alice):
    assert change_email(client, alice).status_code == 503


def test_the_demo_email_cant_be_changed(client, demo, outbox):
    assert change_email(client, demo, password="whatever").status_code == 403


# --- deleting the account ---------------------------------------------------------------------


def delete(client, headers, password=PASSWORD):
    return client.post("/api/account/delete", json={"password": password}, headers=headers)


def test_deleting_the_account(client, alice, make_course, make_assignment):
    make_assignment(alice, make_course(alice)["id"])

    response = delete(client, alice)

    assert response.status_code == 204
    assert "max-age=0" in response.headers["set-cookie"].lower()  # refresh cookie cleared
    assert me(client, alice) == 401
    assert log_in(client).status_code == 401
    # The address is free again.
    body = {"email": "alice@example.com", "password": PASSWORD}
    assert client.post("/api/auth/register", json=body).status_code == 201


def test_deleting_needs_the_password(client, alice):
    assert delete(client, alice, password="not-my-password").status_code == 403
    assert me(client, alice) == 200


def test_deleting_takes_owned_shared_courses_with_it(client, alice, bob, make_course):
    course = make_course(alice)
    path = client.post(f"/api/courses/{course['id']}/invite", headers=alice).json()["path"]
    client.post(f"/api/invites/{path.removeprefix('/join/')}", headers=bob)

    delete(client, alice)

    assert client.get("/api/courses", headers=bob).json() == []


def test_a_member_leaving_by_deletion_leaves_the_course(
    client, alice, bob, make_course, make_assignment
):
    course = make_course(alice)
    lab = make_assignment(alice, course["id"])
    path = client.post(f"/api/courses/{course['id']}/invite", headers=alice).json()["path"]
    client.post(f"/api/invites/{path.removeprefix('/join/')}", headers=bob)
    client.patch(f"/api/assignments/{lab['id']}", json={"status": "done"}, headers=bob)

    delete(client, bob)

    [still_there] = client.get("/api/courses", headers=alice).json()
    assert still_there["member_count"] == 0
    assert client.get(f"/api/assignments/{lab['id']}", headers=alice).json()["status"] == "todo"


def test_the_demo_account_cant_be_deleted(client, demo):
    assert delete(client, demo, password="whatever").status_code == 403
