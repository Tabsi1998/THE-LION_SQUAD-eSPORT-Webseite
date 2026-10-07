"""Runden in Alltagsworten (#1191, #1193): „Viertelfinale“ statt „Runde 2“, „Spieltag 3“ in Liga und Gruppe.

Der Turnierbaum nennt seine Runden „Runde 1“, „Runde 2“ … (so baut ``custom_bracket`` sie). Wer auf der Team-Seite
oder im Profil seinen Weg liest, will wissen, wie weit er kam: die letzte Runde im Hauptbaum ist das Finale, davor
Halbfinale, Viertelfinale und Achtelfinale. Beim Doppel-K.-o. bleiben Winner und Loser Bracket englisch (wie überall
auf der Seite), das letzte Spiel ist das Grand Final. Eigene Namen aus dem Baum-Text („Spiel um Platz 3“, „Finale
Nord“) bleiben, wie sie sind.
"""
from __future__ import annotations

import re

KO_FROM_END = {0: "Finale", 1: "Halbfinale", 2: "Viertelfinale", 3: "Achtelfinale"}
TABLE_STAGE_TYPES = {"round_robin_groups", "round_robin", "league", "swiss", "ffa_league"}
HEAT_STAGE_TYPES = {"ffa_single_elimination", "ffa_custom_bracket"}
TABLE_FORMATS = {"round_robin", "league", "swiss", "groups"}
HEAT_FORMATS = {"ffa", "battle_royale", "grand_prix", "time_trial", "ffa_custom_bracket"}

GENERIC_ROUND = re.compile(r"^(?:runde|round)\s*(\d+)$", re.IGNORECASE)
SIDE_ROUND = re.compile(r"^(winner|loser)\s+(?:runde|round)\s*(\d+)$", re.IGNORECASE)
MAIN_SECTIONS = {"", "main", "wb", "winner", "winners"}
LOSER_SECTIONS = {"lb", "loser", "losers", "lower", "lower_bracket", "loser bracket", "looser"}
FINAL_SECTIONS = {"gf", "grand_final", "grand final", "final"}
BRONZE_SECTIONS = {"bronze", "br", "spiel um platz 3", "platz 3"}


def _int(value) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def section_kind(section) -> str:
    """Wo im Baum ein Spiel liegt: main, loser, grand_final, bronze oder group."""
    key = str(section or "").strip().lower()
    if key in BRONZE_SECTIONS:
        return "bronze"
    if key in FINAL_SECTIONS:
        return "grand_final"
    if key in LOSER_SECTIONS:
        return "loser"
    if key.startswith("group_") or key == "round_robin":
        return "group"
    return "main"


def stage_kind(stage_type: str | None, tournament_format: str | None = None, match_type: str | None = None) -> str:
    """Wie man den Weg liest: „table“ (Bilanz), „heats“ (Plätze je Runde) oder „knockout“ (Ergebnis je Runde)."""
    if (stage_type or "") in TABLE_STAGE_TYPES:
        return "table"
    if (stage_type or "") in HEAT_STAGE_TYPES or match_type == "ffa":
        return "heats"
    if not stage_type and (tournament_format or "") in TABLE_FORMATS:
        return "table"
    if not stage_type and (tournament_format or "") in HEAT_FORMATS:
        return "heats"
    return "knockout"


def rounds_by_section(matches: list[dict]) -> dict[tuple, int]:
    """Die höchste Runde je Stufe und Baumteil - daraus folgt, welche Runde das Finale ist."""
    out: dict[tuple, int] = {}
    for match in matches or []:
        key = (match.get("stage_id"), section_kind(match.get("section")))
        out[key] = max(out.get(key, 0), _int(match.get("round")))
    return out


def round_label(match: dict, *, max_rounds: dict[tuple, int] | None = None, kind: str = "knockout") -> str:
    """Die Runde eines Spiels in Alltagsworten."""
    name = str(match.get("round_name") or "").strip()
    number = _int(match.get("round"))
    section = section_kind(match.get("section"))
    if section == "bronze":
        return "Spiel um Platz 3"
    if section == "grand_final":
        return "Grand Final"
    if kind == "table":
        if name and not GENERIC_ROUND.match(name):
            return name
        if match.get("matchday_label"):
            return str(match["matchday_label"])
        return f"Spieltag {number}" if number else "Spieltag"
    last = (max_rounds or {}).get((match.get("stage_id"), section), 0)
    side = SIDE_ROUND.match(name)
    if side:
        label = "Winner" if side.group(1).lower() == "winner" else "Loser"
        if last and _int(side.group(2)) == last:
            return f"{label} Final"
        return f"{label} Runde {side.group(2)}"
    if name and not GENERIC_ROUND.match(name):
        return name.replace("Round ", "Runde ").replace("Bronze Match", "Spiel um Platz 3")
    if section == "loser":
        return f"Loser Runde {number}" if number else "Loser Bracket"
    if last and number:
        from_end = last - number
        if kind == "heats":
            return "Finale" if from_end == 0 else f"Runde {number}"
        if from_end in KO_FROM_END:
            return KO_FROM_END[from_end]
    return f"Runde {number}" if number else "Runde"
