"""Check-in der Liga - die Regeln ohne Datenbank (docs/LIGA.md, „D.2 Check-in und Start“, #1652; Regelwerk § 8).

Blatt-Modul: Fenster um den Termin, Stand eines Spiels, Vorschlag an die Leitung - reine Rechnung aus ``checkin_rules`` der Staffel und
``matches_v2.flow``. ``league_service`` (Vorgabe neuer Seasons), ``match_deadlines`` (Regel ``check_in``) und ``league_rule_blocks``
(Baustein) lesen nur hier; alles mit Datenbank steht in ``services/match_flow.py``. Kein Wert eines Titels steht hier.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from models import now_utc
from services import league_veto_rules
from services.league_scope import is_league_staffel

# Wiener Zeit nur für Texte (wie matchday_schedule.LOCAL_TZ) - hier eigens, damit dieses Modul ein Blatt bleibt und der
# Spieltag-Plan es importieren kann.
LOCAL_TZ = ZoneInfo("Europe/Vienna")

logger = logging.getLogger("tls.checkin_rules")

DEFAULTS: dict = {
    "opens_minutes_before": 15,
    "closes_minutes_after": 15,
    "min_present": 3,
    "remind_minutes_before_close": 5,
}
# Ganze Zahlen: (kleinster, größter Wert, Name in der Meldung).
NUMBERS: dict[str, tuple[int, int, str]] = {
    "opens_minutes_before": (1, 240, "Check-in öffnet (Minuten vor dem Termin)"),
    "closes_minutes_after": (0, 240, "Check-in schließt (Minuten nach dem Termin)"),
    "min_present": (1, 50, "Mindestens Anwesende je Seite"),
    "remind_minutes_before_close": (0, 60, "Erinnerung vor Schluss (Minuten)"),
}

# Die Stände (docs/LIGA.md D.2) - abgeleitet, nie gespeichert.
NONE, NO_TIME, WAITING, OPEN, CLOSED, VETO, READY, RUNNING, FINISHED = (
    "none", "no_time", "waiting", "open", "closed", "veto", "ready", "running", "finished")
# Ein Spiel, das noch einen Check-in nimmt: beide Seiten stehen fest, nichts hat begonnen.
OPEN_MATCH_STATUSES = frozenset({"ready", "scheduled"})
RUNNING_STATUSES = frozenset({"in_progress", "running", "waiting_result"})
FINISHED_STATUSES = frozenset({"completed", "archived", "forfeit", "bye", "no_show", "cancelled", "disputed"})
WEEKDAYS = ("Mo", "Di", "Mi", "Do", "Fr", "Sa", "So")


class FlowProblem(Exception):
    """Eine Aktion geht nicht - mit deutscher Meldung und HTTP-Status (Vorgabe 409)."""

    def __init__(self, detail: str, status_code: int = 409):
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


# ---------------------------------------------------------------- Zeiten

def moment(value) -> datetime | None:
    """Ein Zeitpunkt aus ISO-Text oder ``datetime``, immer mit Zeitzone - ``None`` für leer oder unlesbar."""
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def iso(value) -> str | None:
    parsed = moment(value)
    return parsed.astimezone(timezone.utc).isoformat() if parsed else None


def when_text(value) -> str:
    """„Sa 14.11. 20:00“ in Wiener Zeit - für Meldungen und Nachrichten (wie ``league_schedule.when_text``)."""
    parsed = moment(value)
    if not parsed:
        return "ohne Termin"
    local = parsed.astimezone(LOCAL_TZ)
    return f"{WEEKDAYS[local.weekday()]} {local.strftime('%d.%m. %H:%M')}"


def clock_text(value) -> str:
    """„20:15“ in Wiener Zeit."""
    parsed = moment(value)
    return parsed.astimezone(LOCAL_TZ).strftime("%H:%M") if parsed else ""


# ---------------------------------------------------------------- Regeln

def normalize(raw) -> dict:
    """Die Regeln aus einer Eingabe der Verwaltung - fehlende Felder mit Vorgabe, Falsches mit deutscher Meldung (422)."""
    if not isinstance(raw, dict):
        raise FlowProblem("Die Check-in-Regeln fehlen.", 422)
    if set(raw) - set(DEFAULTS):
        raise FlowProblem("Die Check-in-Regeln enthalten ein unbekanntes Feld.", 422)
    out = dict(DEFAULTS)
    for key, (low, high, label) in NUMBERS.items():
        value = raw.get(key)
        if value is None:
            continue
        if isinstance(value, bool) or not isinstance(value, int):
            raise FlowProblem(f"{label}: bitte eine ganze Zahl.", 422)
        if not low <= value <= high:
            raise FlowProblem(f"{label}: erlaubt sind {low} bis {high}.", 422)
        out[key] = value
    return out


def _positive(value) -> int | None:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if number >= 1 else None


def defaults_for_season(season: dict | None) -> dict:
    """Die Vorgabe einer neuen Season: Mindestzahl aus der Teilnehmerliste (``lineup_min_players``), sonst Teamgröße − 1, mindestens 1 -
    bei 4 gegen 4 also 3 (Regelwerk Nr. 46)."""
    season = season or {}
    minimum = None
    if season.get("lineup_mode") == "series":
        minimum = _positive(season.get("lineup_min_players"))
    if minimum is None:
        team_size = _positive(season.get("team_size"))
        minimum = max(1, team_size - 1) if team_size else DEFAULTS["min_present"]
    return {**DEFAULTS, "min_present": max(NUMBERS["min_present"][0], min(NUMBERS["min_present"][1], minimum))}


def rules_of(tournament: dict | None) -> dict | None:
    """Die geltenden Regeln einer Staffel - ``None`` für Staffeln ohne ``checkin_rules`` und alle anderen Turniere."""
    if not is_league_staffel(tournament):
        return None
    raw = tournament.get("checkin_rules")
    if not isinstance(raw, dict):
        return None
    try:
        return normalize({key: value for key, value in raw.items() if key in DEFAULTS})
    except FlowProblem:
        # Ein von Hand verbogener Wert sperrt die Staffel nicht - es gelten die Vorgaben.
        logger.warning("[checkin_rules] Check-in-Regeln von %s ungültig, Vorgaben gelten", tournament.get("id"))
        return dict(DEFAULTS)


def new_time_unset(tournament: dict | None) -> dict:
    """Für ``$unset`` auf jedem Weg zu einem neuen Termin (Einigung, Verschiebung, 72-h-Regel, Leitung, Spieltag-Plan, Stationsplan):
    Eine Verlängerung der Leitung (``no_show_extended_until``) gehört zum alten Fenster - in Staffeln mit Check-in-Regeln fällt sie
    mit dem neuen Termin, überall sonst bleibt alles, wie es ist (leeres Dict)."""
    return {"no_show_extended_until": ""} if rules_of(tournament) else {}


# ---------------------------------------------------------------- Fenster und Stand

def window_of(match: dict | None, rules: dict) -> tuple[datetime, datetime] | None:
    """Das Check-in-Fenster um den Termin - ``None`` ohne Termin. Eine Verlängerung der Leitung schiebt das Ende."""
    scheduled = moment((match or {}).get("scheduled_at"))
    if not scheduled:
        return None
    opens = scheduled - timedelta(minutes=int(rules["opens_minutes_before"]))
    closes = scheduled + timedelta(minutes=int(rules["closes_minutes_after"]))
    extended = moment((match or {}).get("no_show_extended_until"))
    if extended and extended > closes:
        closes = extended
    return opens, closes


def filled(match: dict | None) -> list[str]:
    return [slot.get("registration_id") for slot in (match or {}).get("slots") or []
            if isinstance(slot, dict) and slot.get("registration_id")]


def checkins(match: dict | None) -> dict[str, dict]:
    """Die Check-ins je Seite - nur die, deren Seite noch im Spiel steht und die zum geltenden Termin gehören (``for_at``): Setzt
    die Leitung einen neuen Termin (auch nach „Neu ansetzen“, E.1), zählt ein Check-in von früher nicht mehr."""
    raw = ((match or {}).get("flow") or {}).get("checkin") or {}
    seated = set(filled(match))
    current = iso((match or {}).get("scheduled_at"))
    return {key: value for key, value in raw.items()
            if isinstance(value, dict) and key in seated and ("for_at" not in value or value.get("for_at") == current)}


def missing_sides(match: dict | None) -> list[str]:
    """Die Seiten ohne Check-in, in Platzreihenfolge."""
    done = checkins(match)
    return [registration_id for registration_id in filled(match) if registration_id not in done]


def is_running(match: dict | None) -> bool:
    return bool((match or {}).get("started_at")) or str((match or {}).get("status") or "") in RUNNING_STATUSES


def is_finished(match: dict | None) -> bool:
    return str((match or {}).get("status") or "") in FINISHED_STATUSES


def has_report(match: dict | None) -> bool:
    match = match or {}
    return bool(match.get("reports")) or isinstance(match.get("pending_result"), dict)


def veto_pending(match: dict | None, tournament: dict | None) -> bool:
    """Ist zwischen „beide eingecheckt“ und dem Start ein Veto offen (D.3, #1618)? Ohne Vorlage an der Staffel nie; mit Vorlage, solange
    zum geltenden Termin keins da ist (es beginnt beim nächsten Lesen oder Zug) oder es läuft bzw. pausiert."""
    return league_veto_rules.veto_pending(match, tournament)


def state(match: dict | None, tournament: dict | None, now: datetime | None = None) -> str:
    """Der abgeleitete Stand (docs/LIGA.md D.2) - ``none`` für Spiele ohne Check-in."""
    rules = rules_of(tournament)
    if not rules or len(filled(match)) < 2 or (match or {}).get("is_preview"):
        return NONE
    if is_finished(match):
        return FINISHED
    if is_running(match):
        return RUNNING
    if not missing_sides(match):
        return VETO if veto_pending(match, tournament) else READY
    window = window_of(match, rules)
    if not window:
        return NO_TIME
    now = now or now_utc()
    if now < window[0]:
        return WAITING
    if now < window[1]:
        return OPEN
    return CLOSED


def no_show_info(match: dict | None, tournament: dict | None) -> dict | None:
    """Für ``match_deadlines.no_show_deadline``: nach Fensterende mit einer fehlenden Seite der Vorschlag an die Leitung - nie eine
    Wertung. ``None``, solange das Fenster offen ist, alle da sind oder es keinen Check-in gibt."""
    rules = rules_of(tournament)
    if not rules:
        return None
    window = window_of(match, rules)
    missing = missing_sides(match)
    if not window or not missing:
        return None
    return {"rule": "check_in", "minutes": int(rules["closes_minutes_after"]), "base_at": moment(match.get("scheduled_at")),
            "due_at": window[1], "missing": missing}
