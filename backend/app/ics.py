"""Render deadlines as an iCalendar (RFC 5545) feed that calendar apps can subscribe to.

Hand-written rather than a library: the feed needs a handful of properties, and the rules that
matter (escaping, CRLF line endings, folding long lines at 75 bytes) fit in a few functions.
"""

import datetime as dt
from collections.abc import Iterable

from app.models import Assignment, Status

STATUS_LABELS = {Status.TODO: "To do", Status.IN_PROGRESS: "In progress", Status.DONE: "Done"}
MAX_LINE_OCTETS = 75


def escape_text(value: str) -> str:
    """Escape a TEXT value. Backslashes go first, so the escapes added after aren't doubled."""
    value = value.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,")
    return value.replace("\r\n", "\\n").replace("\n", "\\n").replace("\r", "\\n")


def fold(line: str) -> str:
    """Split a content line into lines of at most 75 *bytes*, continuations starting with a space.

    Bytes, not characters: "é" is 2 bytes in UTF-8. A character is never split in half.
    """
    parts: list[str] = []
    current, size = "", 0
    for char in line:
        width = len(char.encode("utf-8"))
        if size + width > MAX_LINE_OCTETS:
            parts.append(current)
            current, size = " ", 1  # the leading space counts towards the next line's 75
        current += char
        size += width
    parts.append(current)
    return "\r\n".join(parts)


def format_utc(value: dt.datetime) -> str:
    return value.astimezone(dt.UTC).strftime("%Y%m%dT%H%M%SZ")


def _event(assignment: Assignment, course_code: str, stamp: str) -> list[str]:
    done = assignment.status == Status.DONE
    summary = f"{'✓ ' if done else ''}{course_code}: {assignment.title}"
    kind = assignment.kind.value.capitalize()
    priority = f"{assignment.priority.value.capitalize()} priority"
    details = " · ".join([kind, priority, STATUS_LABELS[assignment.status]])
    if assignment.description:
        details += f"\n\n{assignment.description}"
    # A deadline is a moment, not a block of time: DTSTART alone means "ends when it starts".
    # TRANSPARENT keeps it from showing the student as busy.
    return [
        "BEGIN:VEVENT",
        f"UID:assignment-{assignment.id}@studyflow",
        f"DTSTAMP:{stamp}",
        f"LAST-MODIFIED:{format_utc(assignment.updated_at)}",
        f"DTSTART:{format_utc(assignment.due_at)}",
        f"SUMMARY:{escape_text(summary)}",
        f"DESCRIPTION:{escape_text(details)}",
        f"CATEGORIES:{escape_text(kind)}",
        "TRANSP:TRANSPARENT",
        "END:VEVENT",
    ]


def build_calendar(rows: Iterable[tuple[Assignment, str]], now: dt.datetime) -> str:
    """The whole feed. `rows` are (assignment, its course code) pairs."""
    stamp = format_utc(now)
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//StudyFlow//Deadlines//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:StudyFlow deadlines",
        # Hints for how often to re-fetch. Apps decide for themselves (Google: every few hours).
        "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
        "X-PUBLISHED-TTL:PT1H",
    ]
    for assignment, code in rows:
        lines.extend(_event(assignment, code, stamp))
    lines.append("END:VCALENDAR")
    return "".join(fold(line) + "\r\n" for line in lines)
