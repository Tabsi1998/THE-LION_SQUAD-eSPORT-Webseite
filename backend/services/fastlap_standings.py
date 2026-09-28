"""Fast Lap (#613): Bestzeiten je Strecke und die Championship-Wertung einer Challenge - eine Rechnung für die
Route ``/f1/challenges/{id}/championship`` und für die Zähler der Erfolge (Meisterschafts-Top, Streckenrekord).

Eine „gültige“ Zeit ist nicht ungültig markiert und keine Vereins-Referenzzeit; die wirksame Zeit ist die
Rundenzeit plus Strafsekunden.
"""
from __future__ import annotations

DEFAULT_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]


def official_query(extra: dict | None = None) -> dict:
    return {
        **(extra or {}),
        "is_invalid": {"$ne": True},
        "$or": [{"score_scope": {"$exists": False}}, {"score_scope": {"$ne": "club_reference"}}],
    }


def effective_ms(row: dict) -> int:
    return int(row.get("time_ms") or 0) + int(float(row.get("penalty_seconds") or 0) * 1000)


def best_per_user(times: list[dict]) -> dict[str, int]:
    """Die beste wirksame Zeit je Person."""
    best: dict[str, int] = {}
    for row in times:
        uid = row.get("user_id")
        if not uid:
            continue
        ms = effective_ms(row)
        if uid not in best or ms < best[uid]:
            best[uid] = ms
    return best


def track_ranking(times: list[dict]) -> list[tuple[str, int]]:
    """Rangfolge einer Strecke: (Person, Zeit), schnellste zuerst."""
    return sorted(best_per_user(times).items(), key=lambda item: item[1])


def championship_totals(tracks: list[dict], times_by_track: dict[str, list[dict]], points_system: list[int] | None = None) -> tuple[list[dict], dict]:
    """Punkte je Strecke nach Platz, aufsummiert; Reihenfolge nach Punkten, dann Siegen. Liefert (Wertung, je Strecke)."""
    points = list(points_system or DEFAULT_POINTS)
    totals: dict[str, dict] = {}
    per_track: dict[str, dict] = {}
    for track in tracks:
        results = []
        for pos, (uid, ms) in enumerate(track_ranking(times_by_track.get(track["id"]) or [])):
            pts = points[pos] if pos < len(points) else 0
            entry = totals.setdefault(uid, {"user_id": uid, "points": 0, "wins": 0, "races": 0})
            entry["points"] += pts
            entry["races"] += 1
            if pos == 0:
                entry["wins"] += 1
            results.append({"user_id": uid, "rank": pos + 1, "time_ms": ms, "points": pts})
        per_track[track["id"]] = {"track": track, "results": results}
    standings = sorted(totals.values(), key=lambda entry: (entry["points"], entry["wins"]), reverse=True)
    for index, entry in enumerate(standings):
        entry["rank"] = index + 1
    return standings, per_track


async def official_times(db, challenge_id: str, track_id: str) -> list[dict]:
    return await db.f1_lap_times.find(official_query({"challenge_id": challenge_id, "track_id": track_id}), {"_id": 0}).to_list(5000)


async def challenge_standings(db, challenge: dict, tracks: list[dict] | None = None) -> tuple[list[dict], dict, list[dict]]:
    """Die Championship einer Challenge aus der Datenbank: (Wertung, je Strecke, Strecken)."""
    cid = challenge["id"]
    if tracks is None:
        tracks = await db.f1_tracks.find({"challenge_id": cid}, {"_id": 0}).sort("order_index", 1).to_list(100)
    times_by_track = {track["id"]: await official_times(db, cid, track["id"]) for track in tracks}
    standings, per_track = championship_totals(tracks, times_by_track, challenge.get("points_per_position"))
    return standings, per_track, tracks
