from datetime import UTC, datetime, timedelta

import jwt
import pytest

from app.config import get_settings
from app.security import create_access_token


def register(client, email="alice@example.com", password="correct-horse-battery"):
    return client.post("/api/auth/register", json={"email": email, "password": password})


def login(client, email="alice@example.com", password="correct-horse-battery"):
    return client.post("/api/auth/login", data={"username": email, "password": password})


def test_register_returns_user_without_password(client):
    response = register(client, email="Alice@Example.COM")

    assert response.status_code == 201
    body = response.json()
    assert body["email"] == "alice@example.com"  # normalized to lowercase
    assert set(body) == {"id", "email", "created_at"}  # no password or hash leaks out


def test_register_duplicate_email_is_case_insensitive(client):
    assert register(client, email="alice@example.com").status_code == 201

    response = register(client, email="ALICE@example.com")

    assert response.status_code == 409


@pytest.mark.parametrize(
    "payload",
    [
        {"email": "not-an-email", "password": "correct-horse-battery"},
        {"email": "alice@example.com", "password": "short"},
        {"email": "alice@example.com"},
        {"email": "alice@example.com", "password": "correct-horse-battery", "is_admin": True},
    ],
    ids=["bad-email", "short-password", "missing-password", "unknown-field"],
)
def test_register_validation_errors(client, payload):
    assert client.post("/api/auth/register", json=payload).status_code == 422


def test_password_limit_counts_bytes_not_characters(client):
    # "é" is 2 bytes in UTF-8: 36 of them is 72 bytes (ok), 37 is 74 bytes (too long for bcrypt).
    assert register(client, email="ok@example.com", password="é" * 36).status_code == 201
    response = register(client, email="long@example.com", password="é" * 37)
    assert response.status_code == 422
    assert "72 bytes" in response.text


def test_login_then_me(client):
    register(client)

    response = login(client, email="  ALICE@example.com ")  # case and whitespace are forgiven

    assert response.status_code == 200
    token = response.json()
    assert token["token_type"] == "bearer"
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token['access_token']}"})
    assert me.status_code == 200
    assert me.json()["email"] == "alice@example.com"


def test_wrong_password_and_unknown_email_look_identical(client):
    register(client)

    wrong_password = login(client, password="wrong-password")
    unknown_email = login(client, email="nobody@example.com")

    assert wrong_password.status_code == unknown_email.status_code == 401
    assert wrong_password.json() == unknown_email.json()


def test_login_with_over_long_password_is_401_not_500(client):
    register(client)
    assert login(client, password="x" * 100).status_code == 401


@pytest.mark.parametrize(
    "headers",
    [{}, {"Authorization": "Bearer not-a-jwt"}, {"Authorization": "Basic abc"}],
    ids=["no-header", "garbage-token", "wrong-scheme"],
)
def test_me_rejects_missing_or_invalid_token(client, headers):
    response = client.get("/api/auth/me", headers=headers)
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"


def test_me_rejects_expired_token(client):
    user_id = register(client).json()["id"]
    settings = get_settings()
    past = datetime.now(UTC) - timedelta(hours=2)
    expired = jwt.encode(
        {"sub": str(user_id), "iat": past, "exp": past + timedelta(minutes=1)},
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )

    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {expired}"}).status_code == 401


def test_me_rejects_token_signed_with_another_key(client):
    user_id = register(client).json()["id"]
    forged = jwt.encode(
        {"sub": str(user_id), "exp": datetime.now(UTC) + timedelta(hours=1)},
        "an-attacker-chosen-secret-key-of-32-chars",
        algorithm="HS256",
    )

    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {forged}"}).status_code == 401


def test_me_rejects_token_for_deleted_user(client):
    token = create_access_token(user_id=999_999)
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401
