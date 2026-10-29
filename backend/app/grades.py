"""Course grades from weighted marks: so far, the possible range, and what you need on the rest.

All of it is Decimal arithmetic, not float: 0.1 + 0.2 is exactly 0.3 here, so "you need 70.00%"
is never secretly 69.999999. Results are rounded only at the very end, and always in the
cautious direction: grades round *down* (89.996% shows as 89.99%, not a misleading 90.00%), and
"needed" rounds *up* (if the app says 72.34%, getting 72.34% really is enough).
"""

from collections.abc import Iterable
from dataclasses import dataclass
from decimal import ROUND_CEILING, ROUND_FLOOR, Decimal
from enum import StrEnum

HUNDRED = Decimal(100)
CENT = Decimal("0.01")

# York University's undergraduate scale: the lowest percentage for each letter grade.
YORK_SCALE: list[tuple[str, Decimal]] = [
    ("A+", Decimal(90)),
    ("A", Decimal(80)),
    ("B+", Decimal(75)),
    ("B", Decimal(70)),
    ("C+", Decimal(65)),
    ("C", Decimal(60)),
    ("D+", Decimal(55)),
    ("D", Decimal(50)),
    ("E", Decimal(40)),
    ("F", Decimal(0)),
]


class TargetStatus(StrEnum):
    SECURED = "secured"  # reached even with zero on everything left
    POSSIBLE = "possible"
    OUT_OF_REACH = "out_of_reach"  # not even with full marks on everything left


@dataclass(frozen=True)
class GradedItem:
    weight: Decimal  # percent of the course
    score: Decimal | None = None
    out_of: Decimal | None = None


@dataclass(frozen=True)
class Target:
    letter: str
    minimum: Decimal
    status: TargetStatus
    # The average needed on everything not graded yet. None when nothing is left to grade.
    needed: Decimal | None


@dataclass(frozen=True)
class GradeSummary:
    total_weight: Decimal
    graded_weight: Decimal
    current: Decimal | None  # average on what's graded so far
    current_letter: str | None
    lowest: Decimal | None  # final grade with zero on everything left
    highest: Decimal | None  # final grade with full marks on everything left
    targets: list[Target]


def letter_for(percent: Decimal) -> str:
    return next(letter for letter, minimum in YORK_SCALE if percent >= minimum)


def _round(value: Decimal, rounding: str = ROUND_FLOOR) -> Decimal:
    return value.quantize(CENT, rounding=rounding)


def summarize(items: Iterable[GradedItem]) -> GradeSummary:
    """Weights needn't add up to 100: everything is relative to the weight entered so far, so a
    half-set-up course still gives sensible numbers (the UI says the weights don't add up)."""
    items = list(items)
    total = sum((i.weight for i in items), Decimal(0))
    graded = [i for i in items if i.score is not None and i.out_of is not None]
    graded_weight = sum((i.weight for i in graded), Decimal(0))
    # Percentage points of the course already earned: an 8/10 on a 20% item earns 16 points.
    earned = sum((i.weight * i.score / i.out_of for i in graded), Decimal(0))  # type: ignore[operator]
    remaining = total - graded_weight

    current = earned / graded_weight * HUNDRED if graded_weight else None
    lowest = earned / total * HUNDRED if total else None
    highest = (earned + remaining) / total * HUNDRED if total else None

    targets = []
    for letter, minimum in YORK_SCALE[:-1]:  # F needs nothing
        if total == 0:
            break
        points_needed = minimum * total / HUNDRED - earned
        if remaining == 0:
            reached = points_needed <= 0
            status = TargetStatus.SECURED if reached else TargetStatus.OUT_OF_REACH
            targets.append(Target(letter, minimum, status, None))
            continue
        needed = points_needed / remaining * HUNDRED
        if needed <= 0:
            status = TargetStatus.SECURED
        elif needed > HUNDRED:
            status = TargetStatus.OUT_OF_REACH
        else:
            status = TargetStatus.POSSIBLE
        targets.append(
            Target(letter, minimum, status, _round(max(needed, Decimal(0)), ROUND_CEILING))
        )

    return GradeSummary(
        total_weight=total,
        graded_weight=graded_weight,
        current=_round(current) if current is not None else None,
        # From the unrounded average, so it always agrees with the rounded-down number shown.
        current_letter=letter_for(current) if current is not None else None,
        lowest=_round(lowest) if lowest is not None else None,
        highest=_round(highest) if highest is not None else None,
        targets=targets,
    )
