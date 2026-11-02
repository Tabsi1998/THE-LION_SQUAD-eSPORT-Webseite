"""GDPR-safe competition exports and registration-reference anonymization."""

from __future__ import annotations

from copy import deepcopy

from services.competition_read import load_registration_matches


TERMINAL_MATCH_STATUSES = {"completed", "forfeit", "cancelled", "archived", "bye"}


def _privacy_match_projection(match: dict) -> dict:
    projected = deepcopy(match)
    for slot in projected.get("slots") or []:
        slot["user_id"] = None
    for result in projected.get("results") or []:
        result["note"] = None
    return projected


def _own_side(row: dict, user_id: str) -> str | None:
    """Die Seite, auf der die Person steht: Teilnehmerliste, Aufstellungen je Map (Altbestand), offene Meldungen, gehaltenes Ergebnis. Nie die
    Gegenseite und keine andere Person."""
    held = row.get("pending_result") if isinstance(row.get("pending_result"), dict) else {}
    lists = [row.get("lineups"), held.get("lineups")]
    for games in (row.get("games"), held.get("games")):
        lists += [(game or {}).get("lineups") for game in games or []]
    for report in row.get("reports") or []:
        lists.append({report.get("registration_id"): report.get("lineup")})
        lists += [(game or {}).get("lineups") for game in report.get("games") or []]
    for lineups in lists:
        for side, people in (lineups or {}).items():
            if user_id in (people or []):
                return side
    return None


async def league_appearance_snapshot(db, user_id: str) -> list[dict]:
    """Für die Auskunft (#2204): Spiele, in denen die Person auf einer Aufstellung oder Teilnehmerliste steht - nur ihre eigene Seite, keine anderen
    Personen. Gültiger Altbestand steht nur in ``games[].lineups`` und braucht ``lineup_user_ids`` nicht zu tragen. Die Schlüssel dort sind Kennungen
    der Seiten, also lässt sich nicht danach suchen: Gelesen werden die Spiele der Staffeln mit Maps, die Auswahl trifft ``_own_side``."""
    staffeln = await db.tournaments.find({"league_context": {"$type": "object"}}, {"_id": 0, "id": 1}).to_list(5000)
    query: dict = {"lineup_user_ids": user_id}
    if staffeln:
        query = {"$or": [query, {"tournament_id": {"$in": [row["id"] for row in staffeln]}, "games.0": {"$exists": True}}]}
    rows = await db.matches_v2.find(query, {"_id": 0, "id": 1, "tournament_id": 1, "status": 1, "completed_at": 1, "lineups": 1, "lineup_user_ids": 1,
                                            "games.lineups": 1, "reports.registration_id": 1, "reports.lineup": 1, "reports.games.lineups": 1,
                                            "pending_result.lineups": 1, "pending_result.games.lineups": 1}).to_list(None)
    out = []
    for row in rows:
        side = _own_side(row, user_id)
        if side or user_id in (row.get("lineup_user_ids") or []):
            out.append({"match_id": row.get("id"), "tournament_id": row.get("tournament_id"), "status": row.get("status"),
                        "completed_at": row.get("completed_at"), "registration_id": side})
    return out


async def registration_match_snapshot(db, registration_ids: list[str], *, limit: int = 5000) -> list[dict]:
    """Export every canonical match that references one of the registrations."""

    return [
        _privacy_match_projection(match)
        for match in await load_registration_matches(db, registration_ids, limit=limit)
    ]


def anonymized_stage_match(match: dict, registration_ids: set[str], updated_at: str) -> dict | None:
    slots = deepcopy(match.get("slots") or [])
    results = deepcopy(match.get("results") or [])
    changed = False
    for slot in slots:
        if slot.get("registration_id") in registration_ids:
            slot["registration_id"] = None
            slot["user_id"] = None
            slot["status"] = "anonymized"
            changed = True
    for result in results:
        if result.get("registration_id") in registration_ids:
            result["registration_id"] = None
            result["note"] = None
            changed = True
    if not changed:
        return None
    updates = {"slots": slots, "results": results, "updated_at": updated_at}
    if match.get("status") not in TERMINAL_MATCH_STATUSES:
        updates["status"] = "waiting_result"
    return updates


async def anonymize_registration_match_references(
    db,
    registration_ids: list[str],
    *,
    updated_at: str,
) -> dict:
    ids = {registration_id for registration_id in registration_ids if registration_id}
    if not ids:
        return {"stage_matches": 0}
    query_ids = sorted(ids)
    stage = await db.matches_v2.find({"$or": [
        {"slots.registration_id": {"$in": query_ids}},
        {"results.registration_id": {"$in": query_ids}},
    ]}).to_list(5000)
    stage_count = 0
    for match in stage:
        updates = anonymized_stage_match(match, ids, updated_at)
        if updates:
            await db.matches_v2.update_one({"id": match["id"]}, {"$set": updates})
            stage_count += 1
    return {"stage_matches": stage_count}
