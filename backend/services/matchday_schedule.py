"""Which time a matchday finally counts as, when a matchday is a whole week.

A league matchday is not a fixed slot here, it is a week. Both sides may offer
times inside that week, and the rules the operator asked for are:

* What the opponent accepts counts.
* If only one side ever offers a time, the home side's offer decides. That is
  why a league plays a return leg: `_auto_league_schema` swaps the sides, so
  everybody holds home advantage for half of their fixtures.
* If nobody offers anything, a configured default applies - Sunday 20:00 for
  example - and it has to fall inside that week. The default is Vienna wall
  time (#1552): "20:00" means 20:00 for the players, in summer and in winter.
* What both sides agreed on counts even outside the week - an agreement is
  never silently reset to the default (#1552).

Only phases that are played in weeks take part: a local one-day group phase
has rounds, not matchdays, and is left to the station planner (#1552).

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
from zoneinfo import ZoneInfo

from services.tournament_rules import match_policy

MATCHDAY_DAYS = 7
# Die Standardzeit ist Wiener Uhrzeit (#1552): die Spieler lesen „20:00“ als 20:00 bei sich, nicht als UTC.
LOCAL_TZ = ZoneInfo("Europe/Vienna")
# Sunday 20:00 Vienna, the example the operator gave. Every caller may override it.
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
    # Die Wochen laufen in Wiener Kalendertagen (#1552): über die Zeitumstellung bleibt der Wochenrand bei derselben
    # Wanduhrzeit, statt in UTC um eine Stunde zu rutschen. Gespeichert und verglichen wird in UTC.
    local_start = start.astimezone(LOCAL_TZ)
    begins = (local_start + timedelta(days=days * (number - 1))).astimezone(timezone.utc)
    ends = (local_start + timedelta(days=days * number)).astimezone(timezone.utc)
    return MatchdayWindow(number=number, start=begins, end=ends)


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
    # In Wiener Wanduhrzeit suchen: ein Tag weiter ist dort immer 24 Stunden Wanduhr, auch über die Umstellung,
    # und erst das Ergebnis wird wieder UTC - so bleibt „20:00“ im Sommer wie im Winter 20:00.
    local_start = window.start.astimezone(LOCAL_TZ)
    day = local_start.replace(hour=hour, minute=minute, second=0, microsecond=0)
    while day.weekday() != weekday or day < local_start:
        day += timedelta(days=1)
        if day.astimezone(timezone.utc) >= window.end + timedelta(days=7):
            return None
    moment = day.astimezone(timezone.utc)
    return moment if window.contains(moment) else None


def usable_proposals(proposals, window: MatchdayWindow) -> list[dict]:
    """Proposals that could still decide this matchday.

    Withdrawn or declined offers are out, and so is an open offer outside the
    week - a time in the wrong week cannot become this matchday's time. What
    both sides accepted counts wherever it lies: the agreement is theirs, and
    the run must not reset it to the default (#1552).
    """
    usable = []
    for proposal in proposals or []:
        if (proposal or {}).get("status") in {"declined", "withdrawn", "countered"}:
            continue
        moment = _parse((proposal or {}).get("scheduled_at"))
        if moment is None:
            continue
        if (proposal or {}).get("status") != "accepted" and not window.contains(moment):
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


# Only these formats play in weekly matchdays. A knockout bracket has rounds,
# but a round is not a week - saying so keeps the caller from inventing weeks
# for a single elimination tree.
MATCHDAY_FORMATS = frozenset({"league", "round_robin", "groups"})
MATCHDAY_STAGE_TYPES = frozenset({"league", "round_robin_groups", "ffa_league"})


def plays_in_matchdays(tournament: dict, stage: dict | None = None) -> bool:
    """Spielwochen gibt es nur online (#1552): vor Ort hat eine Gruppenphase Runden an einem Tag, die der
    Stationsplaner legt. Die Phase entscheidet vor dem Turnier (Vorrang wie in ``tournament_rules``)."""
    tournament = tournament or {}
    if stage is not None and stage.get("stage_type"):
        weekly_format = stage.get("stage_type") in MATCHDAY_STAGE_TYPES
    else:
        weekly_format = tournament.get("format") in MATCHDAY_FORMATS
    if not weekly_format:
        return False
    return match_policy({}, tournament, stage)["event_mode"] != "local"


def matchday_settings(tournament: dict) -> dict:
    """Week length and fallback time, with the operator's defaults filled in."""
    tournament = tournament or {}
    days = tournament.get("matchday_days")
    try:
        days = int(days)
    except (TypeError, ValueError):
        days = MATCHDAY_DAYS
    if days < 1:
        days = MATCHDAY_DAYS

    weekday = tournament.get("default_match_weekday")
    try:
        weekday = int(weekday)
    except (TypeError, ValueError):
        weekday = DEFAULT_WEEKDAY
    if not 0 <= weekday <= 6:
        weekday = DEFAULT_WEEKDAY

    hour, minute = DEFAULT_HOUR, DEFAULT_MINUTE
    raw_time = str(tournament.get("default_match_time") or "").strip()
    if raw_time:
        parts = raw_time.split(":")
        try:
            candidate_hour = int(parts[0])
            candidate_minute = int(parts[1]) if len(parts) > 1 else 0
            if 0 <= candidate_hour <= 23 and 0 <= candidate_minute <= 59:
                hour, minute = candidate_hour, candidate_minute
        except (ValueError, IndexError):
            pass

    return {"days": days, "weekday": weekday, "hour": hour, "minute": minute}


def build_matchday_plan(tournament: dict, matches, proposals=None, stages=None) -> dict:
    """Group the fixtures into weeks and say what time each one counts as.

    Returns ``applies: False`` for formats that have rounds rather than weeks,
    so the caller can fall back to its existing grouping instead of pretending
    a single elimination bracket has matchdays. With ``stages`` given, a match
    only takes part when its own phase plays in weeks.
    """
    settings = matchday_settings(tournament)
    start = _parse((tournament or {}).get("start_date"))
    if start is None:
        return {"applies": False, "settings": settings, "matchdays": []}
    stage_by_id = {(stage or {}).get("id"): stage for stage in stages or []}
    if stages:
        matches = [match for match in matches or [] if plays_in_matchdays(tournament, stage_by_id.get((match or {}).get("stage_id")))]
        if not matches:
            return {"applies": False, "settings": settings, "matchdays": []}
    elif not plays_in_matchdays(tournament):
        return {"applies": False, "settings": settings, "matchdays": []}

    by_proposal: dict[str, list] = {}
    for proposal in proposals or []:
        by_proposal.setdefault((proposal or {}).get("match_id"), []).append(proposal)

    numbered: dict[int, list] = {}
    for match in matches or []:
        number = matchday_number_of(match)
        if number is None:
            continue
        numbered.setdefault(number, []).append(match)

    plan = []
    for number in sorted(numbered):
        window = matchday_window(start, number, days=settings["days"])
        entries = []
        for match in numbered[number]:
            resolution = resolve_matchday_time(
                match, by_proposal.get(match.get("id"), []), window,
                weekday=settings["weekday"], hour=settings["hour"], minute=settings["minute"],
            )
            entries.append({
                "match_id": match.get("id"),
                "scheduled_at": resolution.scheduled_at.isoformat() if resolution else None,
                "schedule_source": resolution.source if resolution else None,
                "home_registration_id": home_registration_id(match),
            })
        plan.append({
            "number": number,
            "starts_at": window.start.isoformat(),
            "ends_at": window.end.isoformat(),
            "matches": entries,
        })
    return {"applies": True, "settings": settings, "matchdays": plan}


def current_matchday_number(plan: dict, now: datetime | None = None) -> int | None:
    """The week we are in right now, or the nearest one otherwise.

    Opening the schedule should land on the week that is being played, not on
    matchday one of a league that started in March.
    """
    matchdays = (plan or {}).get("matchdays") or []
    if not matchdays:
        return None
    moment = _aware(now or datetime.now(timezone.utc))
    for entry in matchdays:
        starts = _parse(entry.get("starts_at"))
        ends = _parse(entry.get("ends_at"))
        if starts and ends and starts <= moment < ends:
            return entry["number"]
    first = _parse(matchdays[0].get("starts_at"))
    if first and moment < first:
        return matchdays[0]["number"]
    return matchdays[-1]["number"]


# ---------------------------------------------------------------- Den geltenden Termin schreiben (#235)
#
# Bis hierher wurde der Termin nur beim Anzeigen berechnet. Erinnerungen, Stationen und die
# TV-Anzeigen lesen aber `scheduled_at` aus der Partie - sie kannten den geltenden Termin nicht.
# Entscheidung vom 15.09.: Ja, schreiben - mit der Quelle daneben, damit ein Admin sieht, warum
# die Partie dort steht. Ein von der Turnierleitung gesetzter Termin (`schedule_source`
# "manual") wird nie überschrieben, ein vereinbarter ("accepted") auch nicht (#1552); erledigte oder
# laufende Partien ebenso wenig.

SCHEDULE_SOURCES = ("accepted", "home", "default", "manual")
KEPT_SOURCES = frozenset({"manual", "accepted"})
FROZEN_MATCH_STATUSES = frozenset({"running", "in_progress", "waiting_result", "completed", "archived", "forfeit", "bye", "no_show"})


def schedule_writes(tournament: dict, matches, proposals=None, stages=None) -> list[dict]:
    """Was je Partie zu schreiben ist - reine Rechnung, ohne Datenbank, deshalb testbar."""
    plan = build_matchday_plan(tournament, matches, proposals, stages)
    if not plan.get("applies"):
        return []
    by_id = {(match or {}).get("id"): match for match in matches or []}
    writes = []
    for matchday in plan["matchdays"]:
        for entry in matchday["matches"]:
            match = by_id.get(entry["match_id"]) or {}
            if not entry.get("scheduled_at"):
                continue
            if match.get("schedule_source") in KEPT_SOURCES or match.get("status") in FROZEN_MATCH_STATUSES:
                continue
            resolved = _parse(entry["scheduled_at"])
            current = _parse(match.get("scheduled_at"))
            if current == resolved and match.get("schedule_source") == entry["schedule_source"]:
                continue
            update = {
                "scheduled_at": resolved.isoformat(),
                "schedule_source": entry["schedule_source"],
                "schedule_written_at": datetime.now(timezone.utc).isoformat(),
            }
            if match.get("status") in {"pending", "ready"}:
                update["status"] = "scheduled"
            writes.append({
                "match_id": entry["match_id"], "matchday": matchday["number"], "update": update,
                # Was die Partie beim Lesen hatte: geschrieben wird nur, wenn es noch so ist (Compare-and-Set).
                "expect": {"schedule_source": match.get("schedule_source"), "scheduled_at": match.get("scheduled_at")},
            })
    return writes


async def apply_schedule_writes(db, writes) -> int:
    """Die Termine schreiben - jeden nur, wenn die Partie noch so dasteht wie beim Lesen. Hat sich inzwischen jemand
    geeinigt oder die Turnierleitung etwas gesetzt, bleibt das stehen; der nächste Lauf sieht es dann."""
    now_iso = datetime.now(timezone.utc).isoformat()
    written = 0
    for write in writes:
        expect = write.get("expect") or {}
        result = await db.matches_v2.update_one(
            {"id": write["match_id"], "schedule_source": expect.get("schedule_source"), "scheduled_at": expect.get("scheduled_at")},
            {"$set": {**write["update"], "updated_at": now_iso}},
        )
        written += int(bool(result.matched_count))
    return written


async def persist_matchday_schedule(db, tournament: dict) -> dict:
    """Den geltenden Termin aller Spieltag-Partien eines Turniers nachtragen - und abgelaufene Fristen an die
    Turnierleitung melden (#1552)."""
    tid = tournament["id"]
    stages = await db.tournament_stages.find({"tournament_id": tid}, {"_id": 0}).to_list(200)
    if not plays_in_matchdays(tournament) and not any(plays_in_matchdays(tournament, stage) for stage in stages):
        return {"applies": False, "written": 0, "escalated": 0}
    matches = await db.matches_v2.find({"tournament_id": tid, "is_preview": {"$ne": True}}, {"_id": 0}).to_list(3000)
    proposals = await db.match_schedule_proposals.find({"tournament_id": tid}, {"_id": 0, "match_collection": 0}).to_list(3000)
    writes = schedule_writes(tournament, matches, proposals, stages)
    written = await apply_schedule_writes(db, writes)
    escalated = await escalate_overdue_proposals(db, tournament, matches)
    return {"applies": True, "written": written, "escalated": escalated}


# ---------------------------------------------------------------- Eskalation (#1552)
#
# Läuft die Antwortfrist eines Terminvorschlags ab, stand das bisher nur in der Partie („escalated“), gesetzt
# beim Öffnen der Matchseite, ohne dass jemand davon erfuhr. Jetzt meldet der Lauf es der Turnierleitung -
# einmal je Partie, festgehalten in `schedule_escalated_at`.

OPEN_SCHEDULE_STATUSES = frozenset({"proposed", "declined", "escalated"})


async def _tournament_staff_user_ids(db, tournament_id: str) -> set[str]:
    from services.permissions import tournament_lead_filter

    leads = await db.users.find({**tournament_lead_filter(), "is_active": True, "is_banned": {"$ne": True}}, {"_id": 0, "id": 1}).to_list(200)
    ids = {row.get("id") for row in leads if row.get("id")}
    assignments = await db.tournament_staff_assignments.find(
        {"tournament_id": tournament_id, "is_active": {"$ne": False}, "role": "organizer", "scope": "tournament"},
        {"_id": 0, "user_id": 1},
    ).to_list(200)
    ids.update(row.get("user_id") for row in assignments if row.get("user_id"))
    return ids


async def escalate_overdue_proposals(db, tournament: dict, matches) -> int:
    from services.user_notifications import create_user_notification

    now = datetime.now(timezone.utc)
    overdue = [
        match for match in matches or []
        if match.get("schedule_status") in OPEN_SCHEDULE_STATUSES and not match.get("schedule_escalated_at")
        and (_parse(match.get("schedule_deadline_at")) or now) < now
        and match.get("status") not in FROZEN_MATCH_STATUSES
    ]
    if not overdue:
        return 0
    staff_ids = await _tournament_staff_user_ids(db, tournament["id"])
    title = (tournament or {}).get("title") or "Turnier"
    for match in overdue:
        now_iso = now.isoformat()
        await db.matches_v2.update_one({"id": match["id"]}, {"$set": {
            "schedule_status": "escalated", "schedule_escalated_at": now_iso, "updated_at": now_iso,
        }})
        label = match.get("match_key") or match.get("round_name") or "Spiel"
        for user_id in sorted(staff_ids):
            await create_user_notification(
                user_id,
                f"Termin offen: {title}",
                f"{label}: die Antwortfrist für den Terminvorschlag ist abgelaufen. Bitte einen Termin festlegen.",
                url=f"/matches/{match.get('id')}",
                kind="schedule_escalation",
                meta={"category": "match_reminders", "dedupe_key": f"schedule_escalation:{match.get('id')}",
                      "match_id": match.get("id"), "tournament_id": tournament.get("id")},
            )
    return len(overdue)


async def persist_all_matchday_schedules(db, limit: int = 50) -> dict:
    """Der Scheduler-Lauf, Liga-Modus des Planers (#1552): alle laufenden Ligen, Round Robins und Gruppen, die
    online in Spielwochen spielen - Standardzeit, Heimrecht, abgelaufene Fristen."""
    counts = {"tournaments": 0, "written": 0}
    # Spielwochen gibt es als Turnierformat und als Phase (Liga-Phase in einem Turnier anderen Formats).
    staged = await db.tournament_stages.distinct("tournament_id", {"stage_type": {"$in": sorted(MATCHDAY_STAGE_TYPES)}})
    query = {
        "$or": [{"format": {"$in": sorted(MATCHDAY_FORMATS)}}, {"id": {"$in": [tid for tid in staged if tid]}}],
        "status": {"$nin": ["draft", "completed", "results_published", "archived", "cancelled"]},
    }
    async for tournament in db.tournaments.find(query, {"_id": 0}).limit(limit):
        result = await persist_matchday_schedule(db, tournament)
        counts["tournaments"] += 1
        counts["written"] += result["written"]
    return counts
