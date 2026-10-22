from datetime import UTC, datetime
from typing import Any


def reject_null(value: Any) -> Any:
    """For PATCH schemas: a field may be omitted, but not sent as an explicit null.

    Pydantic only runs validators on values that were actually sent, so omitted fields
    (left at their None default) pass, while {"name": null} is rejected with a 422.
    """
    if value is None:
        raise ValueError("may not be null")
    return value


def to_utc(value: datetime | None) -> datetime | None:
    return value.astimezone(UTC) if value is not None else None
