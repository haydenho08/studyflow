"""Weekly repeating deadlines ("Lab every Friday at 23:59 for 10 weeks"), as pure functions.

A series is expanded into ordinary assignment rows when it's created. Each one keeps its own
status, and filters, the calendar, the feed and the stats need no special cases. The rule is
only needed at creation, so it isn't stored.

All the date arithmetic happens in the student's own time zone, on wall-clock times: "Friday at
23:59" stays 23:59 when the clocks change, even though its UTC time moves by an hour.
"""

from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

MAX_OCCURRENCES = 52  # a year of weekly deadlines
MAX_SPAN = timedelta(days=366)
NUMBER_PLACEHOLDER = "{n}"


class RecurrenceError(ValueError):
    pass


def weekly_due_dates(
    first: datetime,
    zone: ZoneInfo,
    weekdays: set[int],
    every_weeks: int = 1,
    count: int | None = None,
    until: date | None = None,
) -> list[datetime]:
    """Every due date of a weekly series, in UTC, starting with `first` itself.

    weekdays: Monday = 0 … Sunday = 6, as in date.weekday(). Weeks run Monday to Sunday and are
    counted from the week that contains `first`, so "every 2 weeks on Tue and Thu" means both
    days of every other week.
    """
    local = first.astimezone(zone)
    start, wall_clock = local.date(), local.time().replace(tzinfo=None)
    if start.weekday() not in weekdays:
        raise RecurrenceError("The first due date must be on one of the repeat days")
    if until is not None and until < start:
        raise RecurrenceError("The series can't end before its first due date")
    if until is not None and until - start > MAX_SPAN:
        raise RecurrenceError("A series can last at most a year")

    first_monday = start - timedelta(days=start.weekday())
    dates: list[datetime] = []
    day = start
    while day - start <= MAX_SPAN:
        if until is not None and day > until:
            break
        week = (day - first_monday).days // 7
        if day.weekday() in weekdays and week % every_weeks == 0:
            # Same wall-clock time on a new date. A time the clocks skip over (2:30 on the
            # spring-forward night) comes out an hour later, which is what clocks do too.
            dates.append(datetime.combine(day, wall_clock, tzinfo=zone).astimezone(UTC))
            if len(dates) > MAX_OCCURRENCES:
                raise RecurrenceError(f"A series can have at most {MAX_OCCURRENCES} deadlines")
            if count is not None and len(dates) == count:
                break
        day += timedelta(days=1)
    return dates


def number_title(title: str, n: int) -> str:
    """Number a title: "Lab {n}" becomes "Lab 3" for the third deadline. Others stay as they are."""
    return title.replace(NUMBER_PLACEHOLDER, str(n))


def shift_wall_clock(due: datetime, old: datetime, new: datetime, zone: ZoneInfo) -> datetime:
    """Move `due` the way `old` was moved to `new`, measured on the wall clock in `zone`.

    Moving one deadline from Friday 23:59 to Monday 09:00 moves the later ones from their
    Fridays at 23:59 to the following Mondays at 09:00, whatever DST does in between.
    """

    def wall(moment: datetime) -> datetime:
        return moment.astimezone(zone).replace(tzinfo=None)

    moved = wall(due) + (wall(new) - wall(old))
    return moved.replace(tzinfo=zone).astimezone(UTC)
