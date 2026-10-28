"""Öffentliche Ligaseite (docs/LIGA.md, P5, #1625): je Staffel Spielwochen mit Pause, Spiele mit Ergebnis und Maps,
Teilnehmende mit Teamseite - und für die Teamseite die Liga-Staffeln eines Teams.

Reine Aufbereitung aus Turnier, Spielen und Anmeldungen; welche Staffel jemand sehen darf, entscheidet die Route
(Sichtbarkeit der Season und die Regel der Turnierseite). Personenbezogenes bleibt draußen: keine Aufstellungen
(``games[].lineups``), keine Meldungen, nur Anzeigenamen.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from services.matchday_schedule import (
    LOCAL_TZ,
    blocked_weeks_of,
    build_matchday_plan,
    calendar_week_of,
    matchday_number_of,
    matchday_settings,
    matchday_window,
)

PUBLIC_GAME_FIELDS = ("position", "mode", "map_id", "map_name", "map_image_url", "winner_registration_id", "scores")
DONE_STATUSES = frozenset({"completed", "forfeit"})
PUBLIC_REGISTRATION_STATUSES = ("approved", "checked_in")


def registration_view(registration: dict) -> dict:
    """Eine Anmeldung, wie die Seite sie zeigt: Anzeigename (beim Co-Team „Lions · Lions B“), Teamseite."""
    name = registration.get("display_name") or registration.get("team_name") or registration.get("squad_name")
    return {"id": registration.get("id"), "display_name": name or "Team", "team_id": registration.get("team_id"),
            "squad_name": registration.get("squad_name")}


def _side(match: dict, index: int, names: dict, results: dict) -> dict | None:
    slots = match.get("slots") or []
    if index >= len(slots):
        return None
    registration_id = (slots[index] or {}).get("registration_id")
    if not registration_id:
        return {"registration_id": None, "name": "offen", "score": None, "team_id": None}
    result = results.get(registration_id) or {}
    score = result.get("score")
    info = names.get(registration_id) or {}
    return {"registration_id": registration_id, "name": info.get("display_name") or "Team",
            "team_id": info.get("team_id"), "score": score if isinstance(score, (int, float)) else None}


def public_match(match: dict, names: dict, scheduled: dict | None = None) -> dict:
    """Ein Spiel für die Ligaseite: Heim/Auswärts, Termin, Ergebnis, Maps (sobald P4 sie liefert) - ohne Aufstellungen."""
    results = {row.get("registration_id"): row for row in match.get("results") or [] if row.get("registration_id")}
    winner = next((key for key, row in results.items() if row.get("outcome") == "winner"), None)
    done = match.get("status") in DONE_STATUSES
    entry = scheduled or {}
    return {
        "id": match.get("id"),
        "matchday": matchday_number_of(match),
        "status": match.get("status"),
        "done": done,
        "scheduled_at": entry.get("scheduled_at") or match.get("scheduled_at"),
        "schedule_source": entry.get("schedule_source") or match.get("schedule_source"),
        "home": _side(match, 0, names, results if done else {}),
        "away": _side(match, 1, names, results if done else {}),
        "winner_registration_id": winner if done else None,
        "forfeit": bool(match.get("forfeit_registration_id")) or match.get("status") == "forfeit",
        "games": [{key: game.get(key) for key in PUBLIC_GAME_FIELDS}
                  for game in sorted(match.get("games") or [], key=lambda game: game.get("position") or 0)
                  if isinstance(game, dict)] if done else [],
    }


def _days(period: dict) -> tuple[date, date] | None:
    try:
        return date.fromisoformat(str(period["start_date"])[:10]), date.fromisoformat(str(period["end_date"])[:10])
    except (KeyError, TypeError, ValueError):
        return None


def _pause_label(tournament: dict, first: date, last: date) -> str:
    for period in tournament.get("blocked_periods") or []:
        days = _days(period or {})
        if days and days[0] <= last and first <= days[1]:
            return (period or {}).get("label") or "Pause"
    return "Pause"


def staffel_weeks(tournament: dict, matches: list[dict], names: dict, proposals: list[dict] | None = None,
                  now: datetime | None = None) -> dict:
    """Der Spielplan einer Staffel in Kalenderwochen: Spieltage, Sperrwochen als „Pause“, freie Wochen als Reserve.
    ``current``: die Kalenderwoche, in der wir gerade sind (sonst die nächste bzw. letzte)."""
    start = tournament.get("start_date")
    matches = [match for match in matches if not match.get("is_preview")]
    if not start:
        return {"weeks": [], "current": None}
    plan = build_matchday_plan(tournament, matches, proposals or [])
    scheduled = {entry["match_id"]: entry for day in plan.get("matchdays") or [] for entry in day.get("matches") or []}
    by_day: dict[int, list[dict]] = {}
    for match in matches:
        number = matchday_number_of(match)
        if number:
            by_day.setdefault(number, []).append(match)
    blocked = blocked_weeks_of(tournament)
    last_day = max(by_day) if by_day else 0
    total = max(int(tournament.get("matchday_weeks_total") or 0), calendar_week_of(tournament, last_day) if last_day else 0)
    days = matchday_settings(tournament)["days"]
    weeks = []
    matchday = 0
    for week in range(1, total + 1):
        window = matchday_window(start, week, days=days)
        first = window.start.astimezone(LOCAL_TZ).date()
        last = (window.end - timedelta(seconds=1)).astimezone(LOCAL_TZ).date()
        row = {"week": week, "starts_at": window.start.isoformat(), "ends_at": window.end.isoformat(),
               "first_day": first.isoformat(), "last_day": last.isoformat()}
        if week in blocked:
            weeks.append({**row, "kind": "pause", "label": _pause_label(tournament, first, last), "matches": []})
            continue
        matchday += 1
        games = sorted(by_day.get(matchday, []), key=lambda match: (match.get("order") or 0, match.get("match_key") or ""))
        weeks.append({**row, "kind": "matchday" if games else "reserve", "matchday": matchday,
                      "label": f"Spieltag {matchday}" if games else "Reserve",
                      "matches": [public_match(match, names, scheduled.get(match.get("id"))) for match in games]})
    moment = now or datetime.now(timezone.utc)
    current = None
    for row in weeks:
        if datetime.fromisoformat(row["starts_at"]) <= moment < datetime.fromisoformat(row["ends_at"]):
            current = row["week"]
    if current is None and weeks:
        current = weeks[0]["week"] if moment < datetime.fromisoformat(weeks[0]["starts_at"]) else weeks[-1]["week"]
    return {"weeks": weeks, "current": current}
