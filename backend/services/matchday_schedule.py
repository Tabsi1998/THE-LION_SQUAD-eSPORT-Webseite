"""Which time a matchday finally counts as, when a matchday is a whole week.

A league matchday is not a fixed slot here, it is a week. Both sides may offer
times inside that week, and the rules the operator asked for are:

* What the opponent accepts counts.
* If only one side ever offers a time, the home side's offer decides. That is
  why a league plays a return leg: `_auto_league_schema` swaps the sides, so
  everybody holds home advantage for half of their fixtures.
* If nobody offers anything, a configured default applies - Sunday 20:00 for
  example - and it has to fall inside that week.

Slot zero is the home side. That is not a new convention invented here: the
league generator writes each fixture as ``[home, away]`` and mirrors it for the
return leg, so the order already carries the home right.

Everything is pure computation on plain dicts and aware datetimes. The write
path decides when to ask; keeping the rules separate keeps them checkable one
by one.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

MATCHDAY_DAYS = 7
# Sunday 20:00 UTC, the example the operator gave. Every caller may override it.
DEFAULT_WEEKDAY = 6
DEFAULT_HOUR = 20
DEFAULT_MINUTE = 0


class MatchdayScheduleError(ValueError):
    """Raised when the inputs cannot describe a matchday at all."""


@dataclass(frozen=True)
class MatchdayWindow:
    """The week a matchday is played in, start inclusive, end exclusive."""

    number: int
    start: datetime
    end: datetime

    def contains(self, moment: datetime | None) -> bool:
        if moment is None:
            return False
        return self.start <= _aware(moment) < self.end


@dataclass(frozen=True)
class ScheduleResolution:
    """The time that counts, and which rule produced it.

    ``source`` is deliberately part of the result: an admin screen has to be
    able to say *why* a match sits at that time, and "nobody chose, so the
    default applied" reads very differently from "the opponent agreed".
    """

    scheduled_at: datetime
    source: str  # "accepted" | "home" | "default"
    proposal_id: str | None = None


def _aware(value: datetime) -> datetime:
    """Treat a naive datetime as UTC rather than guessing a local zone."""
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _parse(value) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return _aware(value)
    try:
        return _aware(datetime.fromisoformat(str(value).replace("Z", "+00:00")))
    except ValueError:
        return None


def matchday_window(season_start, number: int, *, days: int = MATCHDAY_DAYS) -> MatchdayWindow:
    """The week matchday ``number`` runs in, counted from the first matchday.

    Matchday one starts when the competition starts - if the league opens on a
    Tuesday, the first week runs Tuesday to Tuesday. The weeks do not snap to
    Monday, because the operator's rule is "one week from the start", not "one
    calendar week".
    """
    start = _parse(season_start)
    if start is None:
        raise MatchdayScheduleError("Ohne Startdatum lässt sich kein Spieltag berechnen")
    if number < 1:
        raise MatchdayScheduleError("Spieltage werden ab 1 gezählt")
    if days < 1:
        raise MatchdayScheduleError("Ein Spieltag muss mindestens einen Tag dauern")
    offset = timedelta(days=days * (number - 1))
    return MatchdayWindow(number=number, start=start + offset, end=start + offset + timedelta(days=days))


def matchday_number_of(match: dict) -> int | None:
    """The matchday a match belongs to, from whichever field carries it."""
    for key in ("matchday_number", "round", "round_index"):
        value = (match or {}).get(key)
        if isinstance(value, int) and value >= 1:
            return value
        if isinstance(value, str) and value.isdigit() and int(value) >= 1:
            return int(value)
    return None


def duel_sides(match: dict) -> tuple[str | None, str | None]:
    """The two registration ids as (home, away).

    Both match shapes are understood: the graph engine keeps ``slots``, the
    classic documents kept ``participant_a_id``/``participant_b_id``. In both
    the first side is the home side.
    """
    slots = (match or {}).get("slots")
    if isinstance(slots, list) and slots:
        ids = [(slot or {}).get("registration_id") for slot in slots[:2]]
        while len(ids) < 2:
            ids.append(None)
        return ids[0], ids[1]
    return (match or {}).get("participant_a_id"), (match or {}).get("participant_b_id")


def home_registration_id(match: dict) -> str | None:
    return duel_sides(match)[0]


def default_time_in(window: MatchdayWindow, *, weekday: int = DEFAULT_WEEKDAY,
                    hour: int = DEFAULT_HOUR, minute: int = DEFAULT_MINUTE) -> datetime | None:
    """The configured fallback moment inside this week, or None if it misses it.

    A full seven day week always contains each weekday exactly once. Shorter
    windows may miss the configured day entirely, and then there is no honest
    answer - saying so is better than silently moving the match.
    """
    if not 0 <= weekday <= 6:
        raise MatchdayScheduleError("Wochentag muss zwischen 0 (Montag) und 6 (Sonntag) liegen")
    if not 0 <= hour <= 23 or not 0 <= minute <= 59:
        raise MatchdayScheduleError("Uhrzeit liegt außerhalb des Tages")
    day = window.start.replace(hour=hour, minute=minute, second=0, microsecond=0)
    while day.weekday() != weekday or day < window.start:
        day += timedelta(days=1)
        if day >= window.end + timedelta(days=7):
            return None
    return day if window.contains(day) else None


def usable_proposals(proposals, window: MatchdayWindow) -> list[dict]:
    """Proposals that could still decide this matchday.

    Withdrawn or declined offers are out, and so is anything outside the week -
    a time in the wrong week cannot become this matchday's time.
    """
    usable = []
    for proposal in proposals or []:
        if (proposal or {}).get("status") in {"declined", "withdrawn", "countered"}:
            continue
        moment = _parse((proposal or {}).get("scheduled_at"))
        if moment is None or not window.contains(moment):
            continue
        usable.append({**proposal, "_moment": moment})
    return usable


def resolve_matchday_time(match: dict, proposals, window: MatchdayWindow, *,
                          weekday: int = DEFAULT_WEEKDAY, hour: int = DEFAULT_HOUR,
                          minute: int = DEFAULT_MINUTE) -> ScheduleResolution | None:
    """The time that counts for this match, and the rule that produced it.

    The order is the operator's: an accepted time wins, otherwise the home
    side's own offer, otherwise the configured default. Returns None only when
    no rule can produce a time at all - that is the case a human has to look at.
    """
    candidates = usable_proposals(proposals, window)

    accepted = [p for p in candidates if p.get("status") == "accepted"]
    if accepted:
        # The latest agreement wins: sides may re-agree after a counter offer.
        winner = max(accepted, key=lambda p: (_parse(p.get("updated_at")) or p["_moment"]))
        return ScheduleResolution(winner["_moment"], "accepted", winner.get("id"))

    home_id = home_registration_id(match)
    if home_id:
        home_offers = [p for p in candidates if p.get("actor_registration_id") == home_id]
        if home_offers:
            # Nothing was agreed, so home advantage decides - also when the away
            # side offered something of its own that nobody accepted. Anything
            # else would make the home right meaningless, and the return leg
            # hands that right to the other side anyway.
            winner = min(home_offers, key=lambda p: p["_moment"])
            return ScheduleResolution(winner["_moment"], "home", winner.get("id"))

    fallback = default_time_in(window, weekday=weekday, hour=hour, minute=minute)
    if fallback is None:
        return None
    return ScheduleResolution(fallback, "default", None)
