"""Dispute (#1134): wer bis wann widersprechen darf - eine Regel für Server, Website und App.

Entscheidung des Betreibers (07.10.2026): Jeder Teilnehmer des Spiels darf in jedem Modus widersprechen, auch gegen
ein von der Turnierleitung eingetragenes Ergebnis - bis 30 Minuten nach dem Ergebnis oder bis das nächste Spiel des
Siegers beginnt, was zuerst kommt. Vor dem Ergebnis geht es immer (etwa „Gegner nicht erschienen“). Die Turnierleitung
bekommt sofort Bescheid.

„Teilnehmer“ heißt hier wie bei allen Aufgaben (#1136): wer angemeldet hat, bei Teams Teamleitung und Co-Leitung.
Website und App rechnen nicht selbst: sie zeigen ``can_dispute`` und ``dispute_until`` der Matchseite.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from models import now_utc
from services.match_deadlines import matchday_end

DISPUTE_WINDOW_MINUTES = 30
DECIDED_STATUSES = {"completed", "forfeit"}
CLOSED_STATUSES = {"cancelled", "archived", "bye"}
# Das nächste Spiel hat begonnen, sobald es läuft, auf ein Ergebnis wartet, entschieden ist - oder seine Zeit da ist.
STARTED_STATUSES = {"in_progress", "running", "waiting_result", "completed", "forfeit", "disputed"}
CLOSED_DETAIL = ("Ein Dispute ist nur bis 30 Minuten nach dem Ergebnis möglich – und nur, bis das nächste Spiel "
                 "des Siegers beginnt.")
# „Problem melden“ (#1158): der Grund zum Antippen - dieselben Wörter auf Website und App.
CATEGORIES = {
    "wrong_result": "Falsches Ergebnis",
    "rule_violation": "Regelverstoß",
    "technical": "Technik",
    "other": "Sonstiges",
}


def category_label(code: str | None) -> str:
    return CATEGORIES.get(str(code or ""), CATEGORIES["other"])


PROCEDURE_KINDS = ("objection", "protest", "appeal")
PROCEDURE_WORDS = {"objection": "Beanstandung", "protest": "Protest", "appeal": "Einspruch"}


def open_procedure_rows(match: dict) -> list[dict]:
    """Die offenen Liga-Verfahren eines Spiels (#1619, E.2: Einträge mit ``id`` und ``kind``) - hier ohne Abhängigkeit zu
    ``league_procedures``, damit auch „Braucht Aufmerksamkeit“ sie lesen kann."""
    return [row for row in match.get("disputes") or []
            if isinstance(row, dict) and row.get("id") and row.get("kind") in PROCEDURE_KINDS
            and (row.get("state") or ("decided" if row.get("resolved_at") else "withdrawn" if row.get("withdrawn_at") else "open")) == "open"]


def open_dispute(match: dict) -> dict | None:
    """Der jüngste offene Dispute eines Spiels - der, über den die Turnierleitung gerade entscheidet."""
    rows = [row for row in match.get("disputes") or [] if isinstance(row, dict) and not row.get("resolved_at")]
    return rows[-1] if rows else None


def _parse(value) -> datetime | None:
    if not value:
        return None
    try:
        parsed = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def decided_at(match: dict) -> datetime | None:
    """Wann das Ergebnis feststand - eingetragen, bestätigt oder als Forfeit gewertet."""
    meta = match.get("result_meta") or {}
    return _parse(match.get("completed_at")) or _parse(meta.get("confirmed_at")) or _parse(match.get("admin_decision_at"))


def winner_ids(match: dict) -> set[str]:
    return {row.get("registration_id") for row in match.get("results") or [] if row.get("registration_id") and int(row.get("rank") or 0) == 1}


async def winner_next_matches(db, match: dict) -> list[dict]:
    """Die Spiele, in die der Sieger aus diesem Spiel weitergerückt ist."""
    winners = winner_ids(match)
    if not winners or not match.get("id"):
        return []
    candidates = await db.matches_v2.find(
        {"tournament_id": match.get("tournament_id"), "slots.source_result.from_match_id": match["id"]},
        {"_id": 0, "id": 1, "status": 1, "started_at": 1, "scheduled_at": 1, "slots": 1},
    ).to_list(20)
    return [
        candidate for candidate in candidates
        if any(
            (slot.get("source_result") or {}).get("from_match_id") == match["id"] and slot.get("registration_id") in winners
            for slot in candidate.get("slots") or []
        )
    ]


def league_window_of(match: dict, tournament: dict, protest_hours: int, now: datetime) -> dict:
    """Das Fenster in einer Liga-Staffel (#1619, E.2, Nr. 129): vor der Bestätigung immer (Beanstandung, ``objection``), danach
    ``protest_hours`` ab der Bestätigung (Protest) - Zeit in Sperrzeiten zählt nicht mit. „Nächstes Spiel des Siegers“ und „Ende der
    Spielwoche“ gelten hier nicht. Ein Spiel, das wegen eines Verfahrens ruht (``disputed``), zählt mit dem Stand von vorher."""
    from services.matchday_schedule import response_deadline

    status = str(match.get("status") or "")
    if status in CLOSED_STATUSES:
        return {"open": False, "until": None, "kind": None}
    if status == "disputed":
        status = str(match.get("status_before_dispute") or "")
    if status not in DECIDED_STATUSES:
        return {"open": True, "until": None, "kind": "objection"}
    decided = decided_at(match)
    until = response_deadline(tournament, decided, protest_hours) if decided else None
    if until is None or now >= until:
        return {"open": False, "until": None, "kind": "protest"}
    return {"open": True, "until": until.isoformat(), "kind": "protest"}


async def league_window(db, match: dict, now: datetime | None = None) -> dict | None:
    """``league_window_of`` für das Spiel - ``None`` bei jedem Turnier ohne Liga."""
    from services import league_protest_settings
    from services.league_scope import is_league_staffel

    if not match.get("tournament_id"):
        return None
    tournament = await db.tournaments.find_one({"id": match["tournament_id"]}, {"_id": 0, "creation_key": 0, "billing": 0})
    if not is_league_staffel(tournament):
        return None
    season = await db.league_seasons.find_one({"id": tournament["league_context"].get("season_id")}, {"_id": 0})
    hours = league_protest_settings.effective(tournament, season)["protest_hours"]
    return league_window_of(match, tournament, hours, now or now_utc())


async def dispute_window(db, match: dict, now: datetime | None = None) -> dict:
    """Ist ein Dispute möglich - und bis wann? ``until`` ist leer, solange es kein Ergebnis gibt."""
    now = now or now_utc()
    status = str(match.get("status") or "")
    if status in CLOSED_STATUSES:
        return {"open": False, "until": None}
    # Liga-Staffel (#1619, E.2): Protestfrist der Season ab der Bestätigung, ruhend in Sperrzeiten - Turniere bleiben bei 30 Minuten.
    league = await league_window(db, match, now)
    if league is not None:
        return {"open": league["open"], "until": league["until"]}
    if status not in DECIDED_STATUSES:
        return {"open": True, "until": None}
    decided = decided_at(match)
    if not decided:
        return {"open": False, "until": None}
    until = decided + timedelta(minutes=DISPUTE_WINDOW_MINUTES)
    # Ergebnis nach Frist (#1551): niemand hat bestätigt - der Einspruch bleibt bis zum Rundenende, in der Liga bis zum
    # Ende der Spielwoche.
    if (match.get("result_meta") or {}).get("auto_confirmed"):
        # Das ganze Turnier: Sperrwochen, Sperrzeiten und Austragung bestimmen, wo die Spielwoche liegt (#2201).
        tournament = await db.tournaments.find_one(
            {"id": match.get("tournament_id")}, {"_id": 0, "creation_key": 0, "billing": 0})
        round_end = matchday_end(match, tournament)
        if round_end and round_end > until:
            until = round_end
    for upcoming in await winner_next_matches(db, match):
        start = _parse(upcoming.get("scheduled_at"))
        if str(upcoming.get("status") or "") in STARTED_STATUSES or upcoming.get("started_at") or (start and start <= now):
            return {"open": False, "until": None}
        if start and start < until:
            until = start
    return {"open": now < until, "until": until.isoformat() if now < until else None}
