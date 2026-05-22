"""User-facing notifications for match lifecycle events."""
from __future__ import annotations

from match_rules import participant_source_ids
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


def _classic_result_summary(match: dict, regs_by_id: dict[str, dict]) -> str:
    a = _registration_name(regs_by_id.get(match.get("participant_a_id")), "Teilnehmer A")
    b = _registration_name(regs_by_id.get(match.get("participant_b_id")), "Teilnehmer B")
    score = f"{match.get('score_a', 0)}:{match.get('score_b', 0)}"
    winner = _registration_name(regs_by_id.get(match.get("winner_id")), "Unentschieden")
    if match.get("status") == "forfeit":
        return f"{a} gegen {b} wurde per Forfeit gewertet. Gewinner: {winner}."
    return f"{a} gegen {b} ist bestätigt: {score}. Gewinner: {winner}."


def _v2_result_summary(match: dict, regs_by_id: dict[str, dict]) -> str:
    results = sorted(match.get("results") or [], key=lambda row: int(row.get("rank") or 999))
    if not results:
        return "Das Ergebnis wurde bestätigt."
    parts = []
    for result in results[:4]:
        name = _registration_name(regs_by_id.get(result.get("registration_id")), "Teilnehmer")
        parts.append(f"{result.get('rank')}. {name}")
    suffix = f" (+{len(results) - 4} weitere)" if len(results) > 4 else ""
    return "Ergebnis bestätigt: " + ", ".join(parts) + suffix + "."


async def notify_match_result_confirmed(db, match: dict, collection_name: str = "matches", force: bool = False) -> int:
    """Create in-app notifications for all users involved in a confirmed match result."""
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
    if collection_name == "matches_v2" or match.get("slots"):
        body = f"{tournament_title}: {_v2_result_summary(match, regs_by_id)}"
    else:
        body = f"{tournament_title}: {_classic_result_summary(match, regs_by_id)}"
    meta = {
        "match_id": match.get("id"),
        "tournament_id": match.get("tournament_id"),
        "collection": collection_name,
        "force": bool(force),
    }
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
