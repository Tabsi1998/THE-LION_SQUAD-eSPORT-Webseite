"""Doppelte Jahrespunkte je Turnier bereinigen (#2123, TA22) - Migration 18.

Bis #2123 legte „Ergebnisse veröffentlicht“ Jahrespunkte nur neu an, mit dem Typ aus dem Gewicht (Mini, Normal, Major)
im Schlüssel. Wer das Gewicht zwischen zwei Veröffentlichungen änderte, gab Personen bzw. Teams einen zweiten Eintrag
für dasselbe Turnier. Seither gilt je Turnier, Person und Team genau ein Eintrag
(``season_service.sync_tournament_points``).

Die Bereinigung je Turnier, Person und Team mit mehr als einem Eintrag:

- **Alles in einer offenen Wertung** (Entwurf oder aktiv): es bleibt der Eintrag mit dem Typ des aktuellen
  Turniergewichts, bei gleichem Typ der älteste (der ursprüngliche); die übrigen werden entfernt.
- **Über mehrere Wertungen verteilt oder in einer abgeschlossenen bzw. archivierten**: nichts wird gelöscht - die Gruppe
  wird nur gemeldet (Protokoll ``season_points.duplicates_reported`` und Ausgabe des Werkzeugs). Abgeschlossene Ranglisten
  bleiben, wie sie festgeschrieben sind; welche Saison die richtige ist, entscheidet die Turnierleitung.

Das Protokoll ``season_points.duplicates_removed`` je Turnier steht **vor** dem Löschen - bricht ein Lauf ab, ist
nachvollziehbar, was gelöscht werden sollte; der nächste Lauf macht weiter (idempotent: entfernte Einträge fehlen dann
in der Liste). ``plan`` zählt nur (Trockenlauf, je Saison), ``apply`` führt aus.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone

from models import new_id
from services.season_service import OPEN_SEASON_STATUSES, TOURNAMENT_SOURCE_TYPES, season_weight_of, tournament_source_type

REASON = "#2123 je Turnier, Person und Team ein Eintrag"
ROW_FIELDS = ("id", "season_id", "source_type", "user_id", "team_id", "total_points", "created_at")


async def _groups(db) -> tuple[list[dict], dict[str, dict]]:
    """Je Turnier, Person und Team mit mehr als einem Eintrag: was bleibt, was weg soll - oder ``report_only``."""
    rows = await db.season_points.find(
        {"source_type": {"$in": list(TOURNAMENT_SOURCE_TYPES)}, "source_id": {"$nin": [None, ""]}},
        {"_id": 0, **{field: 1 for field in ROW_FIELDS}, "source_id": 1}).to_list(None)
    grouped: dict[tuple, list[dict]] = defaultdict(list)
    for row in rows:
        grouped[(row.get("source_id"), row.get("user_id"), row.get("team_id"))].append(row)
    doubled = {key: items for key, items in grouped.items() if len(items) > 1}
    if not doubled:
        return [], {}
    tournament_ids = sorted({key[0] for key in doubled})
    tournaments = {t["id"]: t for t in await db.tournaments.find(
        {"id": {"$in": tournament_ids}}, {"_id": 0, "id": 1, "season_weight": 1}).to_list(None)}
    season_ids = sorted({row.get("season_id") for items in doubled.values() for row in items if row.get("season_id")})
    seasons = {s["id"]: s for s in await db.seasons.find(
        {"id": {"$in": season_ids}}, {"_id": 0, "id": 1, "name": 1, "status": 1}).to_list(None)}
    out = []
    for (source_id, user_id, team_id), items in sorted(doubled.items(), key=lambda pair: tuple(str(v) for v in pair[0])):
        tournament = tournaments.get(source_id)
        expected = tournament_source_type(season_weight_of(tournament)) if tournament else None
        in_seasons = sorted({str(row.get("season_id")) for row in items})
        closed = sorted(sid for sid in in_seasons
                        if sid in seasons and seasons[sid].get("status") not in OPEN_SEASON_STATUSES)
        # Erwarteter Typ zuerst, dann der älteste Eintrag (der ursprüngliche).
        ordered = sorted(items, key=lambda row: (row.get("source_type") != expected, str(row.get("created_at") or "")))
        out.append({"source_id": source_id, "user_id": user_id, "team_id": team_id, "keep": ordered[0],
                    "remove": ordered[1:], "seasons": in_seasons, "closed_seasons": closed,
                    "report_only": len(in_seasons) > 1 or bool(closed)})
    return out, seasons


def _row(row: dict) -> dict:
    return {key: row.get(key) for key in ROW_FIELDS}


async def plan(db) -> dict:
    """Trockenlauf: was entfernt würde und was nur gemeldet wird - insgesamt und je Saison."""
    groups, seasons = await _groups(db)
    removable = [group for group in groups if not group["report_only"]]
    reported = [group for group in groups if group["report_only"]]
    removed = [row for group in removable for row in group["remove"]]
    per_season: dict[str, dict] = {}

    def season_entry(season_id: str) -> dict:
        season = seasons.get(season_id) or {}
        return per_season.setdefault(season_id, {
            "season_id": season_id, "name": season.get("name") or season_id,
            "status": season.get("status") or "unbekannt",
            "closed": bool(season) and season.get("status") not in OPEN_SEASON_STATUSES,
            "rows_to_remove": 0, "points_to_remove": 0.0, "reported_groups": 0})

    for row in removed:
        entry = season_entry(str(row.get("season_id")))
        entry["rows_to_remove"] += 1
        entry["points_to_remove"] = round(entry["points_to_remove"] + float(row.get("total_points") or 0), 1)
    for group in reported:
        for season_id in group["seasons"]:
            season_entry(season_id)["reported_groups"] += 1
    return {
        "tournaments": len({group["source_id"] for group in removable}),
        "recipients": len(removable),
        "rows_to_remove": len(removed),
        "points_to_remove": round(sum(float(row.get("total_points") or 0) for row in removed), 1),
        "reported_groups": len(reported),
        "reported_tournaments": len({group["source_id"] for group in reported}),
        "seasons": sorted(per_season.values(), key=lambda item: item["season_id"]),
        "reported": [{"source_id": group["source_id"], "user_id": group["user_id"], "team_id": group["team_id"],
                      "seasons": group["seasons"], "closed_seasons": group["closed_seasons"]} for group in reported],
    }


async def apply(db) -> str:
    """Bereinigen: je Turnier erst protokollieren, dann löschen; Gruppen über mehrere bzw. abgeschlossene Wertungen nur
    melden. Gibt eine Zusammenfassung für ``schema_migrations`` zurück."""
    groups, _seasons = await _groups(db)
    now = datetime.now(timezone.utc).isoformat()
    removable: dict[str, list[dict]] = defaultdict(list)
    reported: dict[str, list[dict]] = defaultdict(list)
    for group in groups:
        (reported if group["report_only"] else removable)[group["source_id"]].append(group)

    for tournament_id, items in reported.items():
        await db.audit_logs.insert_one({
            "id": new_id(), "action": "season_points.duplicates_reported", "actor_id": "migration",
            "target_id": tournament_id, "created_at": now,
            "data": {"reason": REASON, "note": "mehrere oder abgeschlossene Wertungen - nicht automatisch bereinigt",
                     "groups": [{"user_id": g["user_id"], "team_id": g["team_id"], "seasons": g["seasons"],
                                 "closed_seasons": g["closed_seasons"],
                                 "rows": [_row(g["keep"]), *(_row(row) for row in g["remove"])]} for g in items]},
        })

    removed = 0
    for tournament_id, items in removable.items():
        rows = [row for group in items for row in group["remove"]]
        # Erst das Protokoll, dann löschen (#2123): bricht der Lauf ab, steht fest, was weg sollte.
        await db.audit_logs.insert_one({
            "id": new_id(), "action": "season_points.duplicates_removed", "actor_id": "migration",
            "target_id": tournament_id, "created_at": now,
            "data": {"reason": REASON, "removed": [_row(row) for row in rows]},
        })
        for row in rows:
            result = await db.season_points.delete_one({"id": row["id"]})
            removed += int(getattr(result, "deleted_count", 0) or 0)
    if removed:
        from services.discord_embed_queue import request_refresh
        request_refresh("ranking")
    reported_count = sum(len(items) for items in reported.values())
    return (f"{removed} duplicate season points removed in {len(removable)} tournaments, "
            f"{reported_count} groups in {len(reported)} tournaments only reported")


def render_text(report: dict) -> str:
    lines = [f"Doppelte Jahrespunkte (#2123): {report['rows_to_remove']} Einträge zu entfernen "
             f"({report['points_to_remove']} Punkte) bei {report['recipients']} Personen/Teams "
             f"in {report['tournaments']} Turnieren."]
    if report.get("reported_groups"):
        lines.append(f"Nur gemeldet (mehrere oder abgeschlossene Wertungen, nichts gelöscht): {report['reported_groups']} "
                     f"Personen/Teams in {report['reported_tournaments']} Turnieren.")
    for season in report.get("seasons") or []:
        state = " – abgeschlossen, bleibt unverändert" if season["closed"] else ""
        lines.append(f"  {season['name']} ({season['status']}{state}): {season['rows_to_remove']} zu entfernen "
                     f"({season['points_to_remove']} Punkte), {season['reported_groups']} gemeldet")
    for item in report.get("reported") or []:
        who = item.get("user_id") or f"Team {item.get('team_id')}"
        closed = f", abgeschlossen: {', '.join(item['closed_seasons'])}" if item.get("closed_seasons") else ""
        lines.append(f"  gemeldet: Turnier {item['source_id']}, {who}, Wertungen {', '.join(item['seasons'])}{closed}")
    return "\n".join(lines) + "\n"
