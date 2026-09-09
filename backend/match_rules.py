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
    raw_ids.extend(
        slot.get("registration_id")
        for slot in (match.get("slots") or [])
        if slot.get("registration_id")
    )
    out = []
    seen = set()
    for raw in raw_ids:
        if not raw or raw in seen:
            continue
        seen.add(raw)
        out.append(raw)
    return out


# Wo ein Spiel unentschieden enden darf. Im klassischen Speicher steht das in
# `bracket`, im Graph-Speicher in `section` - dieselbe Frage, zwei Feldnamen.
DRAW_SECTIONS = {"round_robin", "swiss", "liga", "league"}


def match_allows_draw(match: dict) -> bool:
    """Whether this match may end level.

    A knockout match may not: somebody has to advance. Everything played in a
    table - league, round robin, groups, Swiss - may, and until now could not,
    which silently turned every draw into a win for whoever was listed first.
    """
    for field in ("bracket", "section"):
        value = str(match.get(field) or "").strip().lower()
        if value in DRAW_SECTIONS or value.startswith("group_"):
            return True
    return False


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
