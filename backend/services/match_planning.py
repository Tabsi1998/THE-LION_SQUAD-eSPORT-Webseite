"""Shared match planning guards."""
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from services.match_duration import effective_match_duration, load_duration_game


ACTIVE_PLANNING_STATUSES = {"preview", "pending", "ready", "scheduled", "in_progress", "waiting_result"}
RESULT_OPEN_TOURNAMENT_STATUSES = {"live", "paused"}
# Ergebnis-Vertrag (#1035): diese Stände entstehen und enden nur über die Ergebnis-Wege (Ergebnis, Wertung, Einspruch,
# Entscheidung, Rückgängig) - mit Prüfung, Weiterrücken im Baum und Protokoll. Die Planung setzt sie nicht.
RESULT_STATES = {"completed", "forfeit", "disputed"}


def _has_result_state(match: dict) -> bool:
    return (str(match.get("status") or "") in RESULT_STATES or bool(match.get("results"))
            or isinstance(match.get("pending_result"), dict))


def ensure_plan_keeps_result_state(match: dict, updates: dict) -> None:
    """Die Planung (Termin, Station, Dauer, Stand des Ablaufs) ändert nichts am Ergebnis-Stand eines Spiels - und
    nichts an den Regeln, nach denen ein vorhandenes Ergebnis geprüft wurde (Best-of)."""
    if "best_of" in updates and updates["best_of"] != match.get("best_of") and _has_result_state(match):
        raise HTTPException(
            status_code=409,
            detail="Best-of lässt sich nicht mehr ändern: dieses Spiel hat schon ein Ergebnis oder ist in Klärung.",
        )
    if "status" not in updates or updates["status"] == match.get("status"):
        return
    if updates["status"] in RESULT_STATES:
        raise HTTPException(status_code=422, detail="Ergebnis, Wertung und Einspruch laufen über das Ergebnis-Fenster.")
    if _has_result_state(match):
        raise HTTPException(
            status_code=409,
            detail="Dieses Spiel hat schon ein Ergebnis oder ist in Klärung - bitte über Korrigieren, Rückgängig oder die Entscheidung ändern.",
        )


def _parse_dt(value) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _duration_minutes(match: dict, updates: dict | None = None, *, tournament: dict | None = None,
                      stages: dict[str, dict] | None = None, game: dict | None = None) -> int:
    stage = (stages or {}).get(match.get("stage_id") or "")
    return effective_match_duration(match, stage=stage, tournament=tournament, game=game, updates=updates)


STATION_GONE = "Die Station gibt es nicht mehr oder sie wird gerade gelöscht. Bitte neu laden und eine andere wählen."


async def station_open_for_matches(db, station_id: str) -> bool:
    """Darf ein Spiel an diese Station? Nur wenn es sie gibt und sie nicht gerade gelöscht wird (Markierung deleting)."""
    return bool(await db.stations.find_one({"id": station_id, "deleting": {"$ne": True}}, {"_id": 0, "id": 1}))


def restore_change(before: dict, keys) -> dict:
    """Die Änderung, die ``keys`` exakt auf ``before`` zurücksetzt: was es vorher gab, per $set, was nicht, per $unset."""
    keys = set(keys)
    change: dict = {}
    if kept := {key: before[key] for key in keys if key in before}:
        change["$set"] = kept
    if gone := {key: "" for key in keys if key not in before}:
        change["$unset"] = gone
    return change


async def ensure_station_open(db, station_id: str) -> None:
    """Vor dem Zuweisen. Löschen markiert zuerst und prüft dann; wer zuweist, prüft vorher und nach dem Schreiben noch
    einmal (``station_open_for_matches``) - so sieht in jeder Reihenfolge einer den anderen."""
    if not await station_open_for_matches(db, station_id):
        raise HTTPException(status_code=409, detail=STATION_GONE)


def _overlaps(start_a: datetime, minutes_a: int, start_b: datetime, minutes_b: int) -> bool:
    end_a = start_a + timedelta(minutes=minutes_a)
    end_b = start_b + timedelta(minutes=minutes_b)
    return start_a < end_b and start_b < end_a


async def ensure_station_slot_available(db, current_match: dict, updates: dict, collection_name: str) -> None:
    station_id = updates.get("station_id") if "station_id" in updates else current_match.get("station_id")
    if not station_id:
        return
    scheduled_raw = updates.get("scheduled_at") if "scheduled_at" in updates else current_match.get("scheduled_at")
    scheduled_at = _parse_dt(scheduled_raw)
    if not scheduled_at:
        return

    tournament_id = current_match["tournament_id"]
    current_id = current_match["id"]
    # Die Dauer kennt Phase und Turnier (#1552) - vorher galt hier ohne Wert am Spiel immer 30.
    tournament = await db.tournaments.find_one({"id": tournament_id}, {"_id": 0}) or {}
    stages = {stage["id"]: stage for stage in await db.tournament_stages.find({"tournament_id": tournament_id}, {"_id": 0}).to_list(200)}
    game = await load_duration_game(db, tournament)
    duration = _duration_minutes(current_match, updates, tournament=tournament, stages=stages, game=game)
    queries = [
        ("matches_v2", {
            "tournament_id": tournament_id,
            "station_id": station_id,
            "id": {"$ne": current_id},
            "status": {"$in": list(ACTIVE_PLANNING_STATUSES)},
        }),
    ]
    for other_collection, query in queries:
        for other in await db[other_collection].find(query, {"_id": 0}).to_list(3000):
            other_start = _parse_dt(other.get("scheduled_at"))
            if not other_start:
                continue
            if _overlaps(scheduled_at, duration, other_start, _duration_minutes(other, tournament=tournament, stages=stages, game=game)):
                label = other.get("match_key") or other.get("round_name") or other.get("id")
                raise HTTPException(
                    status_code=409,
                    detail=f"Station ist in diesem Zeitraum bereits belegt ({label}).",
                )


async def ensure_tournament_accepts_results(db, tournament_id: str) -> None:
    tournament = await db.tournaments.find_one({"id": tournament_id}, {"_id": 0, "status": 1})
    if not tournament or tournament.get("status") not in RESULT_OPEN_TOURNAMENT_STATUSES:
        raise HTTPException(
            status_code=409,
            detail="Ergebnisse können erst gespeichert werden, wenn das Turnier gestartet ist.",
        )
