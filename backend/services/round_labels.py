"""Runden in Alltagsworten (#1191, #1193): „Viertelfinale“ statt „Runde 2“, „Spieltag 3“ in Liga und Gruppe.

Der Turnierbaum nennt seine Runden „Runde 1“, „Runde 2“ … (so baut ``custom_bracket`` sie). Wer auf der Team-Seite
oder im Profil seinen Weg liest, will wissen, wie weit er kam: die letzte Runde im Hauptbaum ist das Finale, davor
Halbfinale, Viertelfinale und Achtelfinale. Beim Doppel-K.-o. bleiben Winner und Loser Bracket englisch (wie überall
auf der Seite), das letzte Spiel ist das Grand Final. Eigene Namen aus dem Baum-Text („Spiel um Platz 3“, „Finale
Nord“) bleiben, wie sie sind.

Die Nummer, die man liest, zählt je Phase und Baumteil fortlaufend ab 1 (#1792) - wie der Web-Baum
(``frontend/src/lib/bracketNames.js``). Das Loser Bracket beginnt zur Zeit der zweiten Runde (``round`` 2), heißt aber
„Loser Runde 1“. Gemeinsame Fälle für Server und Web: ``frontend/src/lib/roundLabelCases.json``.
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


def rounds_by_section(matches: list[dict]) -> dict[tuple, list[int]]:
    """Die Runden je Stufe und Baumteil, aufsteigend - daraus folgen die Nummer, die man liest (fortlaufend ab 1), und
    welche Runde das Finale ist. Nur gültige Rundennummern (ab 1) zählen - ein Alt-Spiel ohne Runde verschiebt nichts."""
    seen: dict[tuple, set[int]] = {}
    for match in matches or []:
        key = (match.get("stage_id"), section_kind(match.get("section")))
        number = _int(match.get("round"))
        if number > 0:
            seen.setdefault(key, set()).add(number)
    return {key: sorted(values) for key, values in seen.items()}


def round_label(match: dict, *, rounds: dict[tuple, list[int]] | None = None, kind: str = "knockout") -> str:
    """Die Runde eines Spiels in Alltagsworten. ``rounds`` aus ``rounds_by_section`` (alle Spiele des Turniers)."""
    name = str(match.get("round_name") or "").strip()
    number = max(0, _int(match.get("round")))
    section = section_kind(match.get("section"))
    if section == "bronze":
        return "Spiel um Platz 3"
    if section == "grand_final":
        return "Grand Final Reset" if "reset" in name.lower() else "Grand Final"
    if kind == "table":
        if name and not GENERIC_ROUND.match(name):
            return name
        if match.get("matchday_label"):
            return str(match["matchday_label"])
        return f"Spieltag {number}" if number else "Spieltag"
    order = (rounds or {}).get((match.get("stage_id"), section)) or []
    last = order[-1] if order else 0
    # Die Nummer im Abschnitt (#1792): die wievielte Runde dieses Baumteils - nicht ``round`` des Spiels.
    shown = order.index(number) + 1 if number in order else number
    side = SIDE_ROUND.match(name)
    if side:
        label = "Winner" if side.group(1).lower() == "winner" else "Loser"
        if last and _int(side.group(2)) == last:
            return f"{label} Final"
        return f"{label} Runde {shown if number in order else side.group(2)}"
    if name and not GENERIC_ROUND.match(name):
        return name.replace("Round ", "Runde ").replace("Bronze Match", "Spiel um Platz 3")
    if section == "loser":
        return f"Loser Runde {shown}" if shown else "Loser Bracket"
    if order and shown:
        from_end = len(order) - shown
        if kind == "heats":
            return "Finale" if from_end == 0 else f"Runde {shown}"
        if from_end in KO_FROM_END:
            return KO_FROM_END[from_end]
    return f"Runde {shown}" if shown else "Runde"


def attach_round_labels(matches: list[dict], stages: list[dict] | None = None, tournament: dict | None = None) -> list[dict]:
    """Schreibt je Spiel ``round_label`` (#1259, #1561) - für die Baum-Antwort, damit Website, App und TV gleich heißen."""
    stage_types = {stage.get("id"): stage.get("stage_type") for stage in stages or [] if isinstance(stage, dict)}
    rounds = rounds_by_section(matches)
    tournament_format = (tournament or {}).get("format")
    for match in matches or []:
        if not isinstance(match, dict):
            continue
        kind = stage_kind(stage_types.get(match.get("stage_id")) or match.get("stage_type"), tournament_format, match.get("match_type"))
        match["round_label"] = round_label(match, rounds=rounds, kind=kind)
    return matches
