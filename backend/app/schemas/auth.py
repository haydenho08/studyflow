from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, EmailStr, Field

from app.schemas.common import UtcDatetime
from app.security import BCRYPT_MAX_BYTES


def _fits_bcrypt(value: str) -> str:
    # Count bytes, not characters: "é" is 1 character but 2 bytes in UTF-8.
    if len(value.encode("utf-8")) > BCRYPT_MAX_BYTES:
        raise ValueError(f"Password must be at most {BCRYPT_MAX_BYTES} bytes")
    return value


# The rules for any password being set: sign-up, change, reset.
NewPassword = Annotated[str, Field(min_length=8), AfterValidator(_fits_bcrypt)]
# Emails are stored lowercased, so the unique constraint is case-insensitive in practice.
Email = Annotated[EmailStr, AfterValidator(str.lower)]


class UserCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: Email
    password: NewPassword


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    created_at: UtcDatetime


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class DemoLogin(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # The visitor's IANA time zone, so "this week" in the demo data is *their* week.
    tz: str = Field(default="America/Toronto", max_length=64)


class PasswordChange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    current_password: str = Field(max_length=200)
    new_password: NewPassword


class EmailChange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    password: str = Field(max_length=200)  # proves it's you, not someone at your unlocked laptop
    new_email: Email


class AccountDelete(BaseModel):
    model_config = ConfigDict(extra="forbid")

    password: str = Field(max_length=200)


class PasswordResetRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: Email


class PasswordReset(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: str = Field(max_length=100)
    new_password: NewPassword


class EmailConfirm(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: str = Field(max_length=100)


class ServerConfig(BaseModel):
    """What this deployment has switched on, so the app can hide what isn't available."""

    email_enabled: bool
    demo_enabled: bool
