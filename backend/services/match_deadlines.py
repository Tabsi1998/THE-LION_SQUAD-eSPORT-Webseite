"""Fristen im Spiel (#1551, Entscheidung E6) - die Regeln, ohne Datenbank.

„Nicht erschienen“: vor Ort 10 Minuten ab dem Aufruf an die Station (``called_at``) - vor der Planzeit aufgerufen, die
Planzeit, wie „antreten bis“ (``appear_by``, #1791) -, online 15 Minuten ab der Öffnung
des Spiels. Geöffnet ist ein Online-Spiel, sobald beide Seiten feststehen und die Zeit da ist: die geplante Zeit, das
Weiterrücken aus dem Vorspiel, der Turnierstart, das Check-in-Ende - was zuletzt kam. Danach schlägt der Server der
Turnierleitung „kampflos verloren“ vor (services/match_deadline_sweep); sie bestätigt oder verlängert.

„Ergebnis gilt“: meldet eine Seite und die andere widerspricht nicht, gilt die Meldung online nach 15 Minuten, in der
Liga nach 48 Stunden, spätestens zum Ende der Spielwoche. Vor Ort bestätigt wie bisher die Turnierleitung.

Einstellbar je Turnier (Felder am Turnier) und je Phase (``settings`` der Phase, geht vor):
``no_show_minutes_on_site``, ``no_show_minutes_online``, ``result_confirm_minutes_online``,
``result_confirm_hours_league``.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from services.matchday_schedule import (
    MatchdayScheduleError,
    matchday_number_of,
    matchday_settings,
    matchday_window,
    plays_in_matchdays,
)
from services.v2_match_flows import latest_reports, no_show_keeps_heat_open

DEFAULTS = {
    "no_show_minutes_on_site": 10,
    "no_show_minutes_online": 15,
    "result_confirm_minutes_online": 15,
    "result_confirm_hours_league": 48,
}
LIMITS = {
    "no_show_minutes_on_site": 120,
    "no_show_minutes_online": 240,
    "result_confirm_minutes_online": 1440,
    "result_confirm_hours_league": 336,
}
NO_SHOW_RULE_TEXT = {"on_site": "ab Aufruf", "online": "ab Öffnung des Spiels"}
# Was die Turnierleitung nach der Frist tun kann: im Duell kampflos werten, im Lauf mit mehr als zwei Spielern nur die
# fehlende Person markieren - der Lauf bleibt offen (#1823). Für Karte und Nachricht.
NO_SHOW_ACTION_DUEL = "kampflos werten oder verlängern"
NO_SHOW_ACTION_HEAT = "nicht erschienen markieren (Lauf bleibt offen) oder verlängern"


def no_show_action(match: dict) -> str:
    return NO_SHOW_ACTION_HEAT if no_show_keeps_heat_open(match) else NO_SHOW_ACTION_DUEL


def no_show_candidates(match: dict) -> list[str]:
    """Für wen „nicht erschienen“ noch gilt (#1823): alle im Spiel, die noch nicht als nicht erschienen markiert sind."""
    marked = set(match.get("no_show_registration_ids") or [])
    return [registration_id for registration_id in _filled(match) if registration_id not in marked]
# Liga: so lange hat der Gegner mindestens Zeit zu widersprechen, auch über das Ende der Spielwoche hinaus.
LEAGUE_MIN_OBJECTION_HOURS = 24
# Ein Spiel, für das „nicht erschienen“ noch gilt: beide Seiten stehen fest, es hat nicht begonnen.
NO_SHOW_OPEN_STATUSES = {"ready", "scheduled"}
# Ein Spiel, dessen gemeldetes Ergebnis nach der Frist gelten kann.
AUTO_CONFIRM_STATUSES = {"ready", "scheduled", "in_progress", "running", "waiting_result"}


def _parse(value) -> datetime | None:
    if not value:
        return None
    try:
        parsed = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def setting(key: str, tournament: dict | None, stage: dict | None = None) -> int:
    """Der Wert aus der Phase, sonst aus dem Turnier, sonst die Vorgabe - nur ganze Zahlen ab 1."""
    for source in (((stage or {}).get("settings") or {}), tournament or {}):
        try:
            value = int(source.get(key))
        except (TypeError, ValueError):
            continue
        if 1 <= value <= LIMITS[key]:
            return value
    return DEFAULTS[key]


def _filled(match: dict) -> list[str]:
    return [slot.get("registration_id") for slot in match.get("slots") or [] if slot.get("registration_id")]


def opened_at(match: dict, tournament: dict | None) -> datetime | None:
    """Wann ein Online-Spiel offen ist: das Späteste aus geplanter Zeit, Weiterrücken, Turnierstart, Check-in-Ende."""
    moments = [_parse(match.get("scheduled_at")), _parse((tournament or {}).get("start_date")),
               _parse((tournament or {}).get("check_in_closed_at"))]
    for slot in match.get("slots") or []:
        source = slot.get("source_result") or {}
        moments.append(_parse(source.get("confirmed_at")))
    moments = [moment for moment in moments if moment]
    return max(moments) if moments else None


def appear_by(match: dict, called_at, minutes: int) -> datetime | None:
    """Bis wann die Spieler nach dem Aufruf an der Station sein müssen (#1791) - eine Regel für „antreten bis“
    (``match_calls.report_by``, Minuten: „Zeit zum Antreten“ des TV) und „nicht erschienen ab“ vor Ort
    (``no_show_deadline``, Minuten: ``no_show_minutes_on_site``). Liegt die geplante Zeit nach dem Aufruf, gilt sie -
    wer vor der Planzeit aufgerufen wird, hat bis zur Planzeit; sonst der Aufruf plus die Minuten. Dieselbe Rechnung wie
    ``callsOf`` in frontend/src/lib/tvCalls.js."""
    called = _parse(called_at)
    scheduled = _parse(match.get("scheduled_at"))
    if scheduled and (called is None or scheduled > called):
        return scheduled
    if called:
        return called + timedelta(minutes=max(1, int(minutes or 1)))
    return None


def no_show_deadline(match: dict, tournament: dict | None, stage: dict | None = None) -> dict | None:
    """Ab wann „nicht erschienen“ vorgeschlagen wird - ``None``, wenn die Frist hier nicht gilt. Vor Ort dieselbe Regel
    wie „antreten bis“ (``appear_by``): wer vor der Planzeit aufgerufen wird, hat bis zur Planzeit."""
    if match.get("is_preview") or str(match.get("status") or "") not in NO_SHOW_OPEN_STATUSES:
        return None
    if len(_filled(match)) < 2 or match.get("started_at") or match.get("reports"):
        return None
    if isinstance(match.get("pending_result"), dict):
        return None
    # Die Frist gilt je Person (#1823): im Lauf läuft sie für alle, die noch nicht als nicht erschienen markiert sind;
    # sind alle markiert oder ist der Vorschlag (im Duell) bestätigt, ist sie vorbei.
    proposal = match.get("no_show_proposal")
    if not no_show_candidates(match) or (isinstance(proposal, dict) and proposal.get("decision")):
        return None
    mode = (tournament or {}).get("event_mode") or "online"
    if match.get("called_at"):
        rule, base, key = "on_site", _parse(match.get("called_at")), "no_show_minutes_on_site"
    elif mode in {"online", "hybrid"} and not match.get("station_id"):
        rule, base, key = "online", opened_at(match, tournament), "no_show_minutes_online"
    else:
        return None
    if not base:
        return None
    minutes = setting(key, tournament, stage)
    due = appear_by(match, base, minutes) if rule == "on_site" else base + timedelta(minutes=minutes)
    extended = _parse(match.get("no_show_extended_until"))
    if extended and extended > due:
        due = extended
    return {"rule": rule, "minutes": minutes, "base_at": base, "due_at": due}


def _matchday_window(match: dict, tournament: dict | None):
    if not plays_in_matchdays(tournament or {}):
        return None
    number = matchday_number_of(match)
    start = (tournament or {}).get("start_date")
    if not number or not start:
        return None
    try:
        return matchday_window(start, number, days=matchday_settings(tournament)["days"])
    except MatchdayScheduleError:
        return None


def matchday_end(match: dict, tournament: dict | None) -> datetime | None:
    """Das Ende der Spielwoche dieses Spiels - nur in Formaten mit Spielwochen und mit Startdatum."""
    window = _matchday_window(match, tournament)
    return window.end if window else None


def agreed_outside_week(match: dict, tournament: dict | None) -> bool:
    """Liga: ein Termin außerhalb der Spielwoche, dem der Gegner zugestimmt hat (#1569 lässt ihn stehen). Ein von der
    Turnierleitung oder vom Spieltag-Job gesetzter Termin zählt nicht."""
    if match.get("schedule_source") != "accepted":
        return False
    window = _matchday_window(match, tournament)
    scheduled = _parse(match.get("scheduled_at"))
    return bool(window and scheduled and not window.contains(scheduled))


def single_report(match: dict) -> dict | None:
    """Die eine Meldung, die nach der Frist gilt - nur wenn genau eine Seite gemeldet hat."""
    latest = latest_reports(match.get("reports") or [])
    return next(iter(latest.values())) if len(latest) == 1 else None


def auto_confirm_due(match: dict, tournament: dict | None, stage: dict | None = None) -> datetime | None:
    """Wann die Meldung der einen Seite gilt, wenn die andere nicht widerspricht - ``None``, wenn nie von selbst."""
    if match.get("is_preview") or str(match.get("status") or "") not in AUTO_CONFIRM_STATUSES:
        return None
    if isinstance(match.get("pending_result"), dict):
        return None
    if any(isinstance(row, dict) and not row.get("resolved_at") for row in match.get("disputes") or []):
        return None
    mode = (tournament or {}).get("event_mode") or "online"
    if mode == "local" or (mode == "hybrid" and (match.get("station_id") or match.get("called_at"))):
        return None
    report = single_report(match)
    reported = _parse((report or {}).get("at"))
    if not reported:
        return None
    if plays_in_matchdays(tournament or {}):
        # Fabian (14.10.2026): 48 Stunden, spätestens zum Ende der Spielwoche - aber der Gegner hat immer mindestens
        # 24 Stunden. Ein vereinbart außerhalb der Woche gespieltes Spiel hat das Wochenende nicht als Obergrenze.
        hours = setting("result_confirm_hours_league", tournament, stage)
        due = reported + timedelta(hours=hours)
        week_end = None if agreed_outside_week(match, tournament) else matchday_end(match, tournament)
        if week_end and week_end < due:
            due = week_end
        return max(due, reported + timedelta(hours=LEAGUE_MIN_OBJECTION_HOURS))
    return reported + timedelta(minutes=setting("result_confirm_minutes_online", tournament, stage))


def no_show_due_text(match: dict, info: dict) -> str:
    """Welche Frist „nicht erschienen“ abgelaufen ist (#1832) - für Karte und Nachricht, aus derselben Regel wie die Frist
    (``appear_by``). ``info`` ist der Vorschlag oder ``no_show_deadline``: ``rule``, ``minutes``, ``due_at``.
    „Frist 23:28 (Planzeit) abgelaufen“, „3 Min. ab Aufruf (23:15) abgelaufen“, „Verlängerung bis 23:40 abgelaufen“."""
    from zoneinfo import ZoneInfo

    due = _parse(info.get("due_at"))
    clock = due.astimezone(ZoneInfo("Europe/Vienna")).strftime("%H:%M") if due else ""
    minutes = int(info.get("minutes") or 0)
    rule = info.get("rule")
    extended = _parse(match.get("no_show_extended_until"))
    if due and extended and extended == due:
        return f"Verlängerung bis {clock} abgelaufen"
    if rule == "on_site" and due and appear_by(match, match.get("called_at"), minutes) == due == _parse(match.get("scheduled_at")):
        return f"Frist {clock} (Planzeit) abgelaufen"
    return f"{minutes} Min. {NO_SHOW_RULE_TEXT.get(rule, '')} ({clock}) abgelaufen" if clock else \
        f"{minutes} Min. {NO_SHOW_RULE_TEXT.get(rule, '')} abgelaufen"
