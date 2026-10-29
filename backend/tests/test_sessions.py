"""Refresh tokens: the httpOnly cookie, rotation, theft detection, logging out, and CSRF."""

from datetime import UTC, datetime, timedelta

import jwt
import pytest
from sqlalchemy import func, select

from app.config import Settings, get_settings
from app.models import AuthSession
from app.routers.auth import REFRESH_COOKIE
from app.security import hash_refresh_token

PASSWORD = "correct-horse-battery"


def sign_up(client, email="alice@example.com"):
    assert client.post("/api/auth/register", json={"email": email, "password": PASSWORD}).is_success


def log_in(client, email="alice@example.com", **kwargs):
    return client.post("/api/auth/login", data={"username": email, "password": PASSWORD}, **kwargs)


def bearer(response) -> dict[str, str]:
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def me(client, headers) -> int:
    return client.get("/api/auth/me", headers=headers).status_code


def use_cookie(client, token):
    """Put `token` in the client's cookie jar, where the server's own cookie would be."""
    client.cookies.set(REFRESH_COOKIE, token, domain="testserver.local", path="/api/auth")


def refresh(client, token=None, **kwargs):
    """Refresh with the client's own cookie, or with `token` in its place (another device)."""
    if token is not None:
        use_cookie(client, token)
    return client.post("/api/auth/refresh", **kwargs)


def cookie_header(response) -> str:
    return response.headers["set-cookie"]


@pytest.fixture
def logged_in(client):
    """Alice, logged in once: the response carries her access token and refresh cookie."""
    sign_up(client)
    response = log_in(client)
    assert response.status_code == 200
    return response


# --- the cookie ---------------------------------------------------------------------------------


def test_login_sets_a_locked_down_refresh_cookie(logged_in):
    header = cookie_header(logged_in).lower()

    assert header.startswith(f"{REFRESH_COOKIE}=")
    assert "httponly" in header  # JavaScript can't read it
    assert "secure" in header  # HTTPS only
    assert "samesite=strict" in header  # other sites can't make the browser send it
    assert "path=/api/auth" in header  # sent to the auth routes only, not every API call
    assert f"max-age={30 * 24 * 60 * 60}" in header


def test_the_refresh_token_is_not_in_the_body(logged_in):
    assert set(logged_in.json()) == {"access_token", "token_type"}


def test_access_tokens_are_short_lived(logged_in):
    claims = jwt.decode(logged_in.json()["access_token"], options={"verify_signature": False})
    assert claims["exp"] - claims["iat"] == get_settings().access_token_expire_minutes * 60
    assert Settings.model_fields["access_token_expire_minutes"].default == 15


def test_only_a_hash_of_the_refresh_token_is_stored(client, logged_in, db):
    token = logged_in.cookies[REFRESH_COOKIE]
    stored = db.scalars(select(AuthSession.refresh_token_hash)).all()

    assert stored == [hash_refresh_token(token)]
    assert token not in stored


def test_the_demo_login_gets_a_cookie_too(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "demo_enabled", True)
    response = client.post("/api/auth/demo")
    assert REFRESH_COOKIE in response.cookies


# --- refreshing ---------------------------------------------------------------------------------


def test_refresh_gives_a_working_access_token(client, logged_in):
    response = refresh(client)

    assert response.status_code == 200
    assert me(client, bearer(response)) == 200


def test_refresh_rotates_the_cookie(client, logged_in):
    first = logged_in.cookies[REFRESH_COOKIE]
    response = refresh(client)

    second = response.cookies[REFRESH_COOKIE]
    assert second != first
    assert refresh(client).status_code == 200  # the new one works, again and again


def test_refreshing_keeps_the_login_alive(client, logged_in, db):
    session = db.scalar(select(AuthSession))
    session.expires_at = datetime.now(UTC) + timedelta(days=1)
    db.commit()

    refresh(client)

    db.refresh(session)
    assert session.expires_at > datetime.now(UTC) + timedelta(days=29)


@pytest.mark.parametrize("token", [None, "", "garbage", "\x00", "a" * 5000])
def test_refresh_without_a_valid_cookie_is_401(client, token):
    if token is not None:
        use_cookie(client, token)
    response = client.post("/api/auth/refresh")

    assert response.status_code == 401
    assert response.json() == {"detail": "Not logged in"}


def test_a_failed_refresh_clears_the_cookie(client):
    use_cookie(client, "garbage")
    response = client.post("/api/auth/refresh")
    assert f'{REFRESH_COOKIE}=""' in cookie_header(response)
    assert "max-age=0" in cookie_header(response).lower()


def test_an_expired_login_cant_be_refreshed(client, logged_in, db):
    session = db.scalar(select(AuthSession))
    session.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    db.commit()

    assert refresh(client).status_code == 401
    assert me(client, bearer(logged_in)) == 401  # its access token dies with it


# --- theft detection ----------------------------------------------------------------------------


def test_reusing_an_old_refresh_token_revokes_the_whole_session(client, logged_in):
    """An attacker copies the cookie; the real user then refreshes. When the attacker (or the
    user, whoever is second) presents the old token, the session is ended for both."""
    stolen = logged_in.cookies[REFRESH_COOKIE]
    rotated = refresh(client)
    current = rotated.cookies[REFRESH_COOKIE]

    assert refresh(client, token=stolen).status_code == 401

    assert refresh(client, token=current).status_code == 401  # the real user is out too
    assert me(client, bearer(rotated)) == 401  # and so is every access token from it


def test_theft_in_one_session_leaves_the_others_alone(client, logged_in):
    stolen = logged_in.cookies[REFRESH_COOKIE]
    other_device = log_in(client)  # a second login (phone), with its own cookie
    phone_token = other_device.cookies[REFRESH_COOKIE]

    refresh(client, token=stolen)
    assert refresh(client, token=stolen).status_code == 401  # reuse: laptop session revoked

    assert refresh(client, token=phone_token).status_code == 200


# --- logging out --------------------------------------------------------------------------------


def test_logout_ends_the_session_at_once(client, logged_in):
    response = client.post("/api/auth/logout")

    assert response.status_code == 204
    assert "max-age=0" in cookie_header(response).lower()  # cookie deleted
    assert me(client, bearer(logged_in)) == 401  # not "valid for another 15 minutes"
    assert refresh(client, token=logged_in.cookies[REFRESH_COOKIE]).status_code == 401


def test_logout_without_a_cookie_still_succeeds(client):
    assert client.post("/api/auth/logout").status_code == 204


def test_logout_leaves_other_devices_logged_in(client, logged_in):
    phone = log_in(client)  # the client's cookie is now the phone's
    use_cookie(client, logged_in.cookies[REFRESH_COOKIE])

    client.post("/api/auth/logout")  # log the laptop out

    assert me(client, bearer(logged_in)) == 401
    assert me(client, bearer(phone)) == 200


def test_logout_everywhere(client, logged_in, make_user):
    phone = log_in(client)
    bob = make_user("bob@example.com")

    response = client.post("/api/auth/logout-all", headers=bearer(phone))

    assert response.status_code == 204
    assert me(client, bearer(logged_in)) == 401
    assert me(client, bearer(phone)) == 401
    assert refresh(client, token=phone.cookies[REFRESH_COOKIE]).status_code == 401
    assert me(client, bob) == 200  # only Alice's sessions


def test_logout_everywhere_needs_a_login(client):
    assert client.post("/api/auth/logout-all").status_code == 401


def test_logging_in_clears_out_dead_sessions(client, logged_in, db):
    client.post("/api/auth/logout")
    log_in(client)  # one revoked + one new... but the revoked one is tidied away

    assert db.scalar(select(func.count()).select_from(AuthSession)) == 1


def test_access_token_for_another_users_session_is_refused(client, logged_in, make_user):
    """A token whose "sub" and "sid" don't belong together (only possible with the secret key,
    but checked anyway) is rejected."""
    bob = make_user("bob@example.com")
    alice_claims = jwt.decode(logged_in.json()["access_token"], options={"verify_signature": False})
    bob_claims = jwt.decode(bob["Authorization"].split()[1], options={"verify_signature": False})
    settings = get_settings()
    mixed = jwt.encode(
        {**alice_claims, "sid": bob_claims["sid"]}, settings.jwt_secret_key, settings.jwt_algorithm
    )

    assert me(client, {"Authorization": f"Bearer {mixed}"}) == 401


def test_old_tokens_without_a_session_are_refused(client, logged_in):
    """Tokens from before sessions existed (no "sid") stop working: their owners log in again."""
    claims = jwt.decode(logged_in.json()["access_token"], options={"verify_signature": False})
    del claims["sid"]
    settings = get_settings()
    old = jwt.encode(claims, settings.jwt_secret_key, settings.jwt_algorithm)

    assert me(client, {"Authorization": f"Bearer {old}"}) == 401


# --- CSRF ---------------------------------------------------------------------------------------


@pytest.mark.parametrize("path", ["/api/auth/login", "/api/auth/refresh", "/api/auth/logout"])
@pytest.mark.parametrize("origin", ["https://evil.example", "null", "https://testserver.evil"])
def test_cross_site_requests_to_cookie_routes_are_refused(client, logged_in, path, origin):
    data = {"username": "alice@example.com", "password": PASSWORD}
    response = client.post(path, data=data, headers={"Origin": origin})

    assert response.status_code == 403
    assert "set-cookie" not in response.headers
    assert refresh(client).status_code == 200  # the logout didn't happen


def test_same_origin_requests_are_allowed(client, logged_in):
    assert refresh(client, headers={"Origin": "https://testserver"}).status_code == 200


def test_the_dev_server_origin_is_allowed(client, logged_in):
    # The Vite dev server (a configured CORS origin) proxies to the API from another port.
    assert refresh(client, headers={"Origin": "http://localhost:5173"}).status_code == 200
