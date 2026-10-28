"""Hat ein Turnier einen Turnierbaum, den Spieler ansehen können? (#2124, TP14)

Jeder gegen jeden, Liga, Zeitfahren und Rennserie haben von sich aus keinen Baum - die Turnierseite zeigt dort keinen
Reiter „Turnierbaum“ und im laufenden Turnier die Rangliste als Hauptaktion. Über die Phasen der Turnierleitung kann
aber auch so ein Turnier eine K.-o.-Phase bekommen (Playoffs); dann gibt es den Baum doch. Die Webseite liest das Feld
``has_bracket_tree`` und nimmt das Format nur als Rückfall (``frontend/src/lib/tournamentLabels.js``).
"""
from __future__ import annotations

NO_TREE_FORMATS = frozenset({"round_robin", "league", "time_trial", "grand_prix"})
# Phasen mit Baum: K.-o., Doppel-K.-o., freie Bäume - auch für Mehrspieler. ``ffa_league`` (Rennserie) ist eine
# Wertung über Rennen, kein Baum.
TREE_STAGE_TYPES = frozenset({
    "single_elimination", "double_elimination", "custom_bracket", "ffa_single_elimination", "ffa_custom_bracket",
})


def format_has_tree(tournament: dict | None) -> bool:
    return str((tournament or {}).get("format") or "") not in NO_TREE_FORMATS


def has_bracket_tree(tournament: dict | None, stages: list[dict] | None) -> bool:
    """Mit bekannten Phasen: Format mit Baum oder eine Phase mit Baum."""
    if format_has_tree(tournament):
        return True
    return any(isinstance(stage, dict) and stage.get("stage_type") in TREE_STAGE_TYPES for stage in stages or [])


async def attach_has_bracket_tree(db, tournaments: list[dict]) -> None:
    """``has_bracket_tree`` an jedes Turnier - eine Abfrage für alle ohne Baum im Format."""
    without = [t["id"] for t in tournaments if t.get("id") and not format_has_tree(t)]
    with_tree_stage: set[str] = set()
    if without:
        rows = await db.tournament_stages.find(
            {"tournament_id": {"$in": without}, "stage_type": {"$in": sorted(TREE_STAGE_TYPES)}},
            {"_id": 0, "tournament_id": 1},
        ).to_list(len(without) * 10 + 10)
        with_tree_stage = {row.get("tournament_id") for row in rows}
    for t in tournaments:
        t["has_bracket_tree"] = format_has_tree(t) or t.get("id") in with_tree_stage
