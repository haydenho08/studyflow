"""Rate limits: login lockout, sign-ups, reset emails, and password checks in Settings."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, update

import app.ratelimit as ratelimit
import app.routers.account as account
import app.routers.auth as auth
from app.config import get_settings
from app.models import RateLimitCounter
from app.ratelimit import Limit, count, hit

PASSWORD = "correct-horse-battery"


@pytest.fixture(autouse=True)
def _mid_window(monkeypatch):
    """Windows are fixed (:00, :15, :30, :45). A test that happened to run across a boundary
    would see its count reset halfway through, so the clock is pinned to 10:05."""
    monkeypatch.setattr(ratelimit, "_now", lambda: datetime(2026, 10, 30, 10, 5, tzinfo=UTC))


def log_in(client, email="alice@example.com", password=PASSWORD):
    return client.post("/api/auth/login", data={"username": email, "password": password})


def fail_logins(client, times, email="alice@example.com"):
    for _ in range(times):
        assert log_in(client, email, "wrong-password").status_code == 401


def age_counters(db, by=timedelta(hours=2)):
    """Pretend the counters' windows were a while ago (the lockout has run out)."""
    db.execute(update(RateLimitCounter).values(window_start=RateLimitCounter.window_start - by))
    db.commit()


def smaller(monkeypatch, module, name, max_):
    """Swap a limit for a smaller one, so the test doesn't need dozens of requests."""
    original = getattr(module, name)
    monkeypatch.setattr(module, name, Limit(original.name, max_, original.window, original.message))


# --- the counter itself -----------------------------------------------------------------------


LIMIT = Limit("test", 3, timedelta(minutes=15))


def test_hits_count_up_within_a_window(db):
    now = datetime(2026, 10, 30, 10, 5, tzinfo=UTC)
    assert [hit(db, LIMIT, "x", now) for _ in range(3)] == [1, 2, 3]
    assert count(db, LIMIT, "x", now + timedelta(minutes=9)) == 3  # 10:14, same window


def test_a_new_window_starts_from_zero(db):
    now = datetime(2026, 10, 30, 10, 14, tzinfo=UTC)
    hit(db, LIMIT, "x", now)
    assert count(db, LIMIT, "x", now + timedelta(minutes=1)) == 0  # 10:15: next window


def test_subjects_and_limits_are_counted_separately(db):
    hit(db, LIMIT, "x")
    assert count(db, LIMIT, "y") == 0
    assert count(db, Limit("other", 3, timedelta(minutes=15)), "x") == 0


def test_subjects_are_case_insensitive(db):
    hit(db, LIMIT, "Alice@Example.com")
    assert count(db, LIMIT, "alice@example.com") == 1


def test_only_hashes_are_stored(client, alice, db):
    fail_logins(client, 1)
    keys = db.scalars(select(RateLimitCounter.key)).all()
    assert keys and all(len(k) == 64 and "alice" not in k for k in keys)


def test_old_windows_are_cleaned_up(db, monkeypatch):
    now = ratelimit._now()
    hit(db, LIMIT, "old", now - timedelta(days=2))
    monkeypatch.setattr(ratelimit.random, "random", lambda: 0.0)  # the 1-in-100 tidy-up: now
    hit(db, LIMIT, "new", now)
    assert count(db, LIMIT, "old", now - timedelta(days=2)) == 0


# --- login lockout ----------------------------------------------------------------------------


def test_ten_wrong_passwords_lock_the_account(client, alice):
    fail_logins(client, 10)

    response = log_in(client)  # even with the right password

    assert response.status_code == 429
    assert response.json()["detail"].startswith(
        "Too many failed logins for this account. Try again in"
    )
    assert response.headers["retry-after"] == str(10 * 60)  # 10:05 -> the window ends at 10:15


def test_the_lock_doesnt_reveal_whether_an_account_exists(client):
    fail_logins(client, 10, email="nobody@example.com")
    assert log_in(client, email="nobody@example.com").status_code == 429


def test_other_accounts_are_unaffected(client, alice, bob):
    fail_logins(client, 10)
    assert log_in(client, email="bob@example.com").status_code == 200


def test_the_lock_runs_out(client, alice, db):
    fail_logins(client, 10)
    age_counters(db)
    assert log_in(client).status_code == 200


def test_a_successful_login_resets_the_count(client, alice):
    fail_logins(client, 9)
    assert log_in(client).status_code == 200
    fail_logins(client, 9)  # would have been the 18th failure: still allowed
    assert log_in(client).status_code == 200


def test_a_locked_login_never_reaches_bcrypt(client, alice, monkeypatch):
    fail_logins(client, 10)

    def boom(*_):
        raise AssertionError("checked the password of a locked account")

    monkeypatch.setattr("app.routers.auth.verify_password", boom)
    assert log_in(client).status_code == 429


def test_existing_logins_keep_working_during_a_lockout(client, alice):
    fail_logins(client, 10)
    assert client.get("/api/auth/me", headers=alice).status_code == 200
    assert client.post("/api/auth/refresh").status_code == 200


def test_one_address_trying_many_accounts(client, monkeypatch):
    smaller(monkeypatch, auth, "LOGIN_FAILURES_PER_IP", 3)
    for i in range(3):
        fail_logins(client, 1, email=f"victim{i}@example.com")
    assert log_in(client, email="victim9@example.com").status_code == 429


# --- sign-ups, reset emails, Settings ----------------------------------------------------------


def test_sign_ups_per_address(client, monkeypatch):
    smaller(monkeypatch, auth, "SIGN_UPS_PER_IP", 2)

    def sign_up(i):
        body = {"email": f"user{i}@example.com", "password": PASSWORD}
        return client.post("/api/auth/register", json=body).status_code

    assert [sign_up(i) for i in range(3)] == [201, 201, 429]


@pytest.fixture
def mail_on(monkeypatch, tmp_path):
    settings = get_settings()
    monkeypatch.setattr(settings, "mail_backend", "file")
    monkeypatch.setattr(settings, "mail_outbox_dir", tmp_path)
    return tmp_path


def request_reset(client, email="alice@example.com"):
    return client.post("/api/account/password-reset", json={"email": email}).status_code


def test_reset_emails_per_address(client, alice, mail_on):
    assert [request_reset(client) for _ in range(4)] == [202, 202, 202, 429]
    assert len(list(mail_on.glob("*.eml"))) == 3  # nobody's inbox gets flooded


def test_reset_limits_dont_reveal_accounts_either(client, mail_on):
    assert [request_reset(client, "nobody@example.com") for _ in range(4)] == [202, 202, 202, 429]


def test_reset_emails_per_ip(client, mail_on, monkeypatch):
    smaller(monkeypatch, account, "RESETS_PER_IP", 2)
    results = [request_reset(client, f"user{i}@example.com") for i in range(3)]
    assert results == [202, 202, 429]


def test_guessing_the_current_password_in_settings(client, alice):
    def change(current):
        body = {"current_password": current, "new_password": "a-brand-new-passphrase"}
        return client.post("/api/account/password", json=body, headers=alice).status_code

    assert [change("wrong-guess") for _ in range(10)] == [403] * 10
    assert change(PASSWORD) == 429  # the right one too, until the window ends


def test_email_changes_per_user(client, alice, mail_on):
    def change(i):
        body = {"password": PASSWORD, "new_email": f"alice{i}@example.com"}
        return client.post("/api/account/email", json=body, headers=alice).status_code

    assert [change(i) for i in range(6)] == [202] * 5 + [429]


def test_limits_can_be_switched_off(client, alice, monkeypatch):
    monkeypatch.setattr(get_settings(), "rate_limit_enabled", False)
    fail_logins(client, 12)
    assert log_in(client).status_code == 200
