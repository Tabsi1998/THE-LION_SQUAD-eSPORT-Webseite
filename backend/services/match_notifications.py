"""User-facing notifications for match lifecycle events."""
from __future__ import annotations

from match_rules import participant_source_ids
from services.competition_snapshot import adapt_legacy_matches, adapt_stage_matches
from services.user_notifications import create_user_notification


def _registration_name(reg: dict | None, fallback: str = "Offen") -> str:
    if not reg:
        return fallback
    return (
        reg.get("display_name")
        or reg.get("ingame_name")
        or reg.get("team_name")
        or reg.get("id")
        or fallback
    )


async def _participant_user_ids(db, registrations: list[dict]) -> set[str]:
    user_ids = {reg.get("user_id") for reg in registrations if reg.get("user_id")}
    team_ids = list({reg.get("team_id") for reg in registrations if reg.get("team_id")})
    if team_ids:
        members = await db.team_members.find(
            {"team_id": {"$in": team_ids}},
            {"_id": 0, "user_id": 1},
        ).to_list(200)
        user_ids.update(member.get("user_id") for member in members if member.get("user_id"))
    return {user_id for user_id in user_ids if user_id}


def _canonical_match(match: dict, collection_name: str) -> dict:
    adapter = adapt_stage_matches if collection_name == "matches_v2" or match.get("slots") else adapt_legacy_matches
    return adapter([match])[0]


def _rank_sort_key(result: dict) -> tuple[int, str]:
    try:
        rank = int(result.get("rank") or 999)
    except (TypeError, ValueError):
        rank = 999
    return rank, str(result.get("registration_id") or "")


def _ranking_result_summary(match: dict, regs_by_id: dict[str, dict]) -> str:
    results = sorted(match.get("results") or [], key=_rank_sort_key)
    if not results:
        return "Das Ergebnis wurde bestätigt."
    parts = []
    for result in results[:4]:
        name = _registration_name(regs_by_id.get(result.get("registration_id")), "Teilnehmer")
        parts.append(f"{result.get('rank')}. {name}")
    suffix = f" (+{len(results) - 4} weitere)" if len(results) > 4 else ""
    return "Ergebnis bestätigt: " + ", ".join(parts) + suffix + "."


def _duel_result_summary(match: dict, regs_by_id: dict[str, dict]) -> str:
    results = match.get("results") or []
    if not results:
        return "Das Ergebnis wurde bestätigt."
    slots = sorted(match.get("slots") or [], key=lambda slot: int(slot.get("position") or 999))
    participants = [slot.get("registration_id") for slot in slots[:2]]
    while len(participants) < 2:
        participants.append(None)
    a_id, b_id = participants
    a = _registration_name(regs_by_id.get(a_id), "Teilnehmer A")
    b = _registration_name(regs_by_id.get(b_id), "Teilnehmer B")
    results_by_id = {result.get("registration_id"): result for result in results}
    score_a = results_by_id.get(a_id, {}).get("score")
    score_b = results_by_id.get(b_id, {}).get("score")
    score = f"{score_a if score_a is not None else 0}:{score_b if score_b is not None else 0}"
    winner_results = [result for result in results if result.get("outcome") == "winner"]
    winner_result = winner_results[0] if len(winner_results) == 1 else None
    winner = _registration_name(
        regs_by_id.get((winner_result or {}).get("registration_id")),
        "Unentschieden",
    )
    if match.get("status") == "forfeit" or any(result.get("forfeit") for result in results):
        return f"{a} gegen {b} wurde per Forfeit gewertet. Gewinner: {winner}."
    return f"{a} gegen {b} ist bestätigt: {score}. Gewinner: {winner}."


def _result_summary(match: dict, regs_by_id: dict[str, dict]) -> str:
    if match.get("match_type") == "duel" and len(match.get("slots") or []) <= 2:
        return _duel_result_summary(match, regs_by_id)
    return _ranking_result_summary(match, regs_by_id)


async def notify_match_result_confirmed(db, match: dict, collection_name: str = "matches", force: bool = False) -> int:
    """Create in-app notifications for all users involved in a confirmed match result."""
    source_match = match
    match = _canonical_match(source_match, collection_name)
    reg_ids = participant_source_ids(match)
    if not reg_ids:
        return 0
    registrations = await db.tournament_registrations.find(
        {"id": {"$in": reg_ids}},
        {"_id": 0},
    ).to_list(100)
    user_ids = await _participant_user_ids(db, registrations)
    if not user_ids:
        return 0

    regs_by_id = {reg["id"]: reg for reg in registrations if reg.get("id")}
    tournament = await db.tournaments.find_one(
        {"id": match.get("tournament_id")},
        {"_id": 0, "id": 1, "slug": 1, "title": 1},
    ) or {}
    title = "Ergebnis korrigiert" if force else "Ergebnis bestätigt"
    tournament_title = tournament.get("title") or "Turnier"
    body = f"{tournament_title}: {_result_summary(match, regs_by_id)}"
    meta = {
        "match_id": match.get("id"),
        "tournament_id": match.get("tournament_id"),
        "collection": collection_name,
        "force": bool(force),
    }
    result_token = (
        (source_match.get("result_meta") or {}).get("report_id")
        or source_match.get("admin_decision_at")
        or source_match.get("updated_at")
    )
    if result_token:
        meta["dedupe_key"] = f"match-result:{match.get('id')}:{result_token}"
    sent = 0
    for user_id in user_ids:
        await create_user_notification(
            user_id,
            title,
            body,
            url=f"/matches/{match.get('id')}",
            kind="match_result",
            meta=meta,
        )
        sent += 1
    return sent
