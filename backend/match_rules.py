"""Shared match helpers for current duel-style match records."""
from fastapi import HTTPException


def participant_ids(match: dict) -> list[str]:
    return [pid for pid in [match.get("participant_a_id"), match.get("participant_b_id")] if pid]


def participant_source_ids(match: dict) -> list[str]:
    raw_ids = [
        match.get("participant_a_id"),
        match.get("participant_b_id"),
        # Legacy field names kept for old imported/generated data.
        match.get("player1_id"),
        match.get("player2_id"),
        match.get("p1_registration_id"),
        match.get("p2_registration_id"),
    ]
    out = []
    seen = set()
    for raw in raw_ids:
        if not raw or raw in seen:
            continue
        seen.add(raw)
        out.append(raw)
    return out


def match_allows_draw(match: dict) -> bool:
    bracket = str(match.get("bracket") or "")
    return bracket in {"round_robin", "swiss"} or bracket.startswith("group_")


def validate_winner_id(match: dict, winner_id: str | None) -> None:
    if not winner_id:
        return
    if winner_id not in participant_ids(match):
        raise HTTPException(status_code=400, detail="Gewinner ist kein Teilnehmer dieses Matches")


def loser_for_winner(match: dict, winner_id: str | None) -> str | None:
    if not winner_id:
        return None
    a = match.get("participant_a_id")
    b = match.get("participant_b_id")
    if winner_id == a:
        return b
    if winner_id == b:
        return a
    return None
