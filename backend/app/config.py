from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/app/config.py -> repo root, where .env lives next to docker-compose.yml
REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """App configuration, read from environment variables (or the repo-root .env file).

    Real environment variables win over .env, so production and CI can override anything.
    """

    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",  # .env also holds POSTGRES_* vars meant for docker-compose
    )

    database_url: str = "postgresql+psycopg://studyflow:studyflow@127.0.0.1:5432/studyflow"
    test_database_url: str = (
        "postgresql+psycopg://studyflow:studyflow@127.0.0.1:5432/studyflow_test"
    )

    # No default: the app refuses to start without a secret instead of using a guessable one.
    jwt_secret_key: str = Field(min_length=32)
    jwt_algorithm: str = "HS256"
    # Short-lived: the app swaps its refresh cookie for a new one whenever this runs out.
    access_token_expire_minutes: int = Field(default=15, gt=0)
    # A login lasts this long without being used (each refresh restarts the clock).
    refresh_token_expire_days: int = Field(default=30, gt=0)
    # Browsers accept Secure cookies on http://localhost, so this can stay on in development too.
    auth_cookie_secure: bool = True

    # bcrypt work factor. Each +1 doubles hashing time; tests lower it to stay fast.
    bcrypt_rounds: int = Field(default=12, ge=4, le=16)

    cors_origins: list[str] = ["http://localhost:5173"]

    # Built frontend to serve (frontend/dist). Unset in development, where Vite serves it.
    static_dir: Path | None = None

    # One-click public demo login (POST /api/auth/demo). Off unless a deployment turns it on.
    demo_enabled: bool = False

    # Email (password reset, confirming a new address). "none" switches those features off;
    # "console" prints messages (development); "file" writes .eml files to mail_outbox_dir (the
    # browser tests read them); "smtp" sends through any provider (Resend, Brevo, Gmail, …).
    mail_backend: Literal["none", "console", "file", "smtp"] = "none"
    mail_from: str = "StudyFlow <no-reply@studyflow.app>"
    mail_outbox_dir: Path | None = None
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    # The site's address, for links in emails (https://studyflow-q3u0.onrender.com). Unset: the
    # address the request came in on.
    public_url: str | None = None

    @property
    def email_enabled(self) -> bool:
        return self.mail_backend != "none"

    @field_validator("database_url", "test_database_url")
    @classmethod
    def use_psycopg_driver(cls, url: str) -> str:
        """Hosts like Neon and Render hand out postgres:// or postgresql:// URLs. SQLAlchemy reads
        those as "use the psycopg2 driver"; we use psycopg 3, so name it explicitly."""
        for prefix in ("postgres://", "postgresql://"):
            if url.startswith(prefix):
                return "postgresql+psycopg://" + url.removeprefix(prefix)
        return url


@lru_cache
def get_settings() -> Settings:
    return Settings()
