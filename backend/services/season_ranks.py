"""Saison-Ränge (#613): die Rangliste einer Saison als Platz je Person.

Bis hierher gab es die Sammlung ``season_standings`` nur als Leser - geschrieben hat sie niemand, „Saisonspitze“
und „Saisonmeister“ blieben deshalb immer bei 0. Jetzt wird die Rangliste beim Abschluss einer Saison
festgeschrieben (``write_standings``), und ein täglicher Schnappschuss (``snapshot_ranks``,
``season_rank_snapshots``) hält den Verlauf fest - daraus zählt „Aufsteiger“ (zehn Plätze in einer Saison gut
gemacht).
"""
from __future__ import annotations

from models import now_utc

SNAPSHOTS = "season_rank_snapshots"


async def ranks_for_season(db, season_id: str) -> list[dict]:
    """Platz je Person aus der Punktewertung - dieselbe Rechnung wie die Rangliste auf der Seite."""
    from services.season_service import aggregate_leaderboard
    rows = await aggregate_leaderboard(season_id=season_id, limit=5000)
    out = []
    for index, row in enumerate(rows):
        uid = row.get("id") or row.get("user_id")
        if not uid:
            continue
        out.append({"season_id": season_id, "user_id": uid, "rank": index + 1, "total_points": float(row.get("total_points") or 0)})
    return out


async def write_standings(db, season_id: str) -> list[dict]:
    """Die Rangliste einer Saison festschreiben (ersetzt einen alten Stand derselben Saison)."""
    ranks = await ranks_for_season(db, season_id)
    stamp = now_utc().isoformat()
    await db.season_standings.delete_many({"season_id": season_id})
    if ranks:
        await db.season_standings.insert_many([{**row, "written_at": stamp} for row in ranks])
    return ranks


async def snapshot_ranks(db, day: str | None = None) -> int:
    """Täglich: Platz je Person in jeder laufenden Saison, ein Eintrag je Saison, Person und Tag."""
    day = day or now_utc().date().isoformat()
    written = 0
    async for season in db.seasons.find({"status": "active"}, {"_id": 0, "id": 1}):
        for row in await ranks_for_season(db, season["id"]):
            await db[SNAPSHOTS].update_one(
                {"season_id": season["id"], "user_id": row["user_id"], "day": day},
                {"$set": {"rank": row["rank"], "total_points": row["total_points"]}},
                upsert=True,
            )
            written += 1
    return written


def climbs(snapshots: list[dict], places: int = 10) -> int:
    """Wie viele Saisons jemand um mindestens ``places`` Plätze aufgestiegen ist: vom schlechtesten bisherigen Platz
    zu einem späteren besseren, je Saison einmal."""
    by_season: dict[str, list[dict]] = {}
    for row in snapshots:
        if isinstance(row.get("rank"), int) and row.get("season_id"):
            by_season.setdefault(row["season_id"], []).append(row)
    count = 0
    for rows in by_season.values():
        worst = None
        for row in sorted(rows, key=lambda item: str(item.get("day") or "")):
            if worst is not None and row["rank"] <= worst - places:
                count += 1
                break
            worst = row["rank"] if worst is None else max(worst, row["rank"])
    return count
