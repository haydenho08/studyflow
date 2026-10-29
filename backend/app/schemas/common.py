from datetime import UTC, datetime
from decimal import Decimal
from typing import Annotated, Any

from pydantic import AfterValidator, PlainSerializer


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


# For response models: whatever offset the database session hands back, the API always answers
# in UTC ("...Z"). Doing this in the schema, not the DB connection, keeps it host-independent.
UtcDatetime = Annotated[datetime, AfterValidator(to_utc)]


# For response models: exact Decimal inside, a plain JSON number on the wire (7.5, not "7.50"),
# so the frontend gets numbers it can format directly.
JsonDecimal = Annotated[Decimal, PlainSerializer(float, return_type=float)]
