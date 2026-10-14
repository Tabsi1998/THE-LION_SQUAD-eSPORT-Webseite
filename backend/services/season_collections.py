"""Was die Saison-Aktionen sammeln - ohne Rück-Importe (#1420).

Die Fundstücke (``COLLECTIBLES``, #678), die Sammlungen von Adventkalender und Ostereiersuche und die drei Zahlen, die
die Erfolge-Zähler daraus lesen. Die Aktionen selbst (services/advent_calendar.py, services/easter_hunt.py,
services/collectibles.py) melden über services/achievement_counters.py - stünden diese Zahlen dort, importierten sich
Zähler und Aktionen gegenseitig.
"""
from __future__ import annotations

from collections import Counter

DOORS = 24
OPENINGS = "advent_openings"
PROGRESS = "easter_progress"

# Reihenfolge wie im Jahr, beginnend mit dem Herbst. ``icon`` wählt die kleine Figur in Web und App.
COLLECTIBLES: tuple[dict, ...] = (
    {"signal": "halloween_bats_scared", "season": "halloween", "label": "Fledermäuse verscheucht", "icon": "bat"},
    {"signal": "halloween_ghosts_freed", "season": "halloween", "label": "Geister befreit", "icon": "ghost"},
    {"signal": "halloween_cat_petted", "season": "halloween", "label": "Katze angestupst", "icon": "cat"},
    {"signal": "halloween_pumpkin", "season": "halloween", "label": "Gruselnächte erlebt", "icon": "pumpkin"},
    {"signal": "snowflakes_clicked", "season": "snow", "label": "Schneeflocken gefangen", "icon": "snowflake"},
    {"signal": "advent_door", "season": "advent_calendar", "label": "Türchen geöffnet", "icon": "door"},
    {"signal": "online_at_new_year", "season": "new_year", "label": "Silvester um Mitternacht dabei", "icon": "rocket"},
    {"signal": "easter_egg", "season": "easter_hunt", "label": "Ostereier gefunden", "icon": "egg"},
)
COLLECTIBLE_SIGNALS: tuple[str, ...] = tuple(item["signal"] for item in COLLECTIBLES)


def total_of(signals: dict[str, dict]) -> int:
    """Alle Fundstücke zusammen - der Zähler für den „Sammler“."""
    return sum(int((signals.get(name) or {}).get("count") or 0) for name in COLLECTIBLE_SIGNALS)


async def doors_in_best_year(db, user_id: str) -> int:
    """Die meisten Türchen in einem Advent - „Alle Türchen“ heißt 24 von 24 im selben Jahr."""
    rows = await db[OPENINGS].find({"user_id": user_id}, {"_id": 0, "year": 1}).to_list(DOORS * 100)
    per_year = Counter(int(row.get("year") or 0) for row in rows)
    return max(per_year.values(), default=0)


async def hunts_completed(db, user_id: str) -> int:
    """Wie oft jemand den Korb voll gemacht hat - für „Eierkönig“."""
    return await db[PROGRESS].count_documents({"user_id": user_id, "completed_at": {"$ne": None}})
