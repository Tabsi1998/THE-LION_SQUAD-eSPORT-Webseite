"""Doppelte Jahrespunkte je Turnier bereinigen (#2123, TA22) - Migration 18.

Bis #2123 legte „Ergebnisse veröffentlicht“ Jahrespunkte nur neu an, mit dem Typ aus dem Gewicht (Mini, Normal, Major)
im Schlüssel. Wer das Gewicht zwischen zwei Veröffentlichungen änderte, gab Personen bzw. Teams einen zweiten Eintrag
für dasselbe Turnier. Seither gilt je Turnier, Person und Team genau ein Eintrag
(``season_service.sync_tournament_points``).

Die Bereinigung: je Turnier, Person und Team bleibt ein Eintrag - der mit dem Typ des aktuellen Turniergewichts, sonst
der jüngste -, die übrigen werden entfernt. Was entfernt wird, steht je Turnier im Protokoll
(``season_points.duplicates_removed``), mit Punkten und Saison, damit es sich nachvollziehen lässt. Idempotent: ein
zweiter Lauf findet nichts mehr. ``plan`` zählt nur (Trockenlauf), ``apply`` führt aus.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone

from models import new_id
from services.season_service import TOURNAMENT_SOURCE_TYPES, season_weight_of, tournament_source_type

REASON = "#2123 je Turnier, Person und Team ein Eintrag"


async def _groups(db) -> list[dict]:
    """Je Turnier, Person und Team mit mehr als einem Eintrag: was bleibt, was weg soll."""
    rows = await db.season_points.find(
        {"source_type": {"$in": list(TOURNAMENT_SOURCE_TYPES)}, "source_id": {"$nin": [None, ""]}},
        {"_id": 0, "id": 1, "season_id": 1, "source_type": 1, "source_id": 1, "user_id": 1, "team_id": 1,
         "total_points": 1, "created_at": 1}).to_list(None)
    grouped: dict[tuple, list[dict]] = defaultdict(list)
    for row in rows:
        grouped[(row.get("source_id"), row.get("user_id"), row.get("team_id"))].append(row)
    doubled = {key: items for key, items in grouped.items() if len(items) > 1}
    if not doubled:
        return []
    tournament_ids = sorted({key[0] for key in doubled})
    tournaments = {t["id"]: t for t in await db.tournaments.find(
        {"id": {"$in": tournament_ids}}, {"_id": 0, "id": 1, "season_weight": 1}).to_list(None)}
    out = []
    for (source_id, user_id, team_id), items in sorted(doubled.items(), key=lambda pair: tuple(str(v) for v in pair[0])):
        tournament = tournaments.get(source_id)
        expected = tournament_source_type(season_weight_of(tournament)) if tournament else None
        ordered = sorted(items, key=lambda row: (row.get("source_type") == expected, str(row.get("created_at") or "")),
                         reverse=True)
        out.append({"source_id": source_id, "user_id": user_id, "team_id": team_id, "keep": ordered[0],
                    "remove": ordered[1:]})
    return out


async def plan(db) -> dict:
    """Trockenlauf: wie viele Turniere, Personen/Teams und Einträge betroffen sind und wie viele Punkte wegfallen."""
    groups = await _groups(db)
    removed = [row for group in groups for row in group["remove"]]
    return {
        "tournaments": len({group["source_id"] for group in groups}),
        "recipients": len(groups),
        "rows_to_remove": len(removed),
        "points_to_remove": round(sum(float(row.get("total_points") or 0) for row in removed), 1),
    }


async def apply(db) -> str:
    """Bereinigen und je Turnier protokollieren. Gibt eine Zusammenfassung für ``schema_migrations`` zurück."""
    groups = await _groups(db)
    by_tournament: dict[str, list[dict]] = defaultdict(list)
    removed = 0
    for group in groups:
        for row in group["remove"]:
            result = await db.season_points.delete_one({"id": row["id"]})
            if getattr(result, "deleted_count", 0):
                removed += 1
                by_tournament[group["source_id"]].append(row)
    now = datetime.now(timezone.utc).isoformat()
    for tournament_id, rows in by_tournament.items():
        await db.audit_logs.insert_one({
            "id": new_id(), "action": "season_points.duplicates_removed", "actor_id": "migration",
            "target_id": tournament_id, "created_at": now,
            "data": {"reason": REASON, "removed": [
                {key: row.get(key) for key in ("id", "season_id", "source_type", "user_id", "team_id", "total_points")}
                for row in rows]},
        })
    if removed:
        from services.discord_embed_queue import request_refresh
        request_refresh("ranking")
    return f"{removed} duplicate season points removed in {len(by_tournament)} tournaments"


def render_text(report: dict) -> str:
    return (f"Doppelte Jahrespunkte (#2123): {report['rows_to_remove']} Einträge zu entfernen "
            f"({report['points_to_remove']} Punkte) bei {report['recipients']} Personen/Teams "
            f"in {report['tournaments']} Turnieren.\n")
