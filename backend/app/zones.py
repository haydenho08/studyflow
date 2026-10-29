from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException, status


def parse_timezone(name: str) -> ZoneInfo:
    """An IANA time zone from client input, or a 422. Rejects junk like "../../etc/passwd"."""
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, f"Unknown time zone: {name!r}"
        ) from None
