"""Gemeinsame Bausteine des Turnierbaums im Discord: für die Einbettung (``discord_bracket``, #571) und das Bild
(``bracket_image``, #575) - welche Partien laufen oder fertig sind, welche Phasen eine Tabelle zeigen, wie Runde
und Abschnitt heißen, Wiener Zeit.

Ein Blatt ohne Importe aus ``services`` - beide nutzen es, ohne einander dafür zu importieren (sonst entstünde ein
Import-Zyklus, #1408).
"""
from __future__ import annotations

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

DONE = {"completed", "forfeit"}
LIVE = {"live", "in_progress", "running"}
TABLE_STAGE_TYPES = {"round_robin_groups", "round_robin", "league", "swiss"}
SECTION_LABELS = {"wb": "Winner Bracket", "winner": "Winner Bracket", "main": "", "lb": "Loser Bracket", "loser": "Loser Bracket",
                  "gf": "Grand Final", "grand_final": "Grand Final", "final": "Finale", "bronze": "Spiel um Platz 3"}
VIENNA = ZoneInfo("Europe/Vienna")


def _dt(value) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _safe_int(value, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def section_label(section) -> str:
    key = str(section or "").strip()
    if not key:
        return ""
    if key.lower() in SECTION_LABELS:
        return SECTION_LABELS[key.lower()]
    if key.lower().startswith("group_"):
        return f"Gruppe {key[6:].upper()}"
    return key


def round_label(match: dict) -> str:
    name = str(match.get("round_name") or "").strip()
    if name:
        return name.replace("Round ", "Runde ").replace("Bronze Match", "Spiel um Platz 3")
    number = _safe_int(match.get("round"))
    return f"Runde {number}" if number else "Runde"


def _score(result: dict | None):
    if not result:
        return None
    for key in ("score", "points"):
        if result.get(key) is not None:
            return result[key]
    return None
