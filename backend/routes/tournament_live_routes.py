"""Live vor Ort (#1556): Warteschlange je Station, Aufruf und Start vom Handy, Spieler-Sicht.

- ``GET /tournaments/{tid}/live-queue``: öffentlich wie der Turnierbaum (sichtbares Turnier, Freigabe-Link oder
  TV-Anzeige-Schlüssel ``key``). Je Station läuft/als Nächstes/danach, je Spiel Prognose und Verzug. Angemeldete mit
  Stations-Recht bekommen dazu ``operate`` (alle Stationen oder ihre eigenen).
- ``GET /tournaments/{tid}/live-queue/me``: die eigenen Spiele - „Du bist als Nächstes an Station 2“.
- ``POST /tournaments/{tid}/live-queue/call`` und ``.../start``: Organisation, Schiedsrichter, Stationsleitung - fürs
  ganze Turnier oder für genau diese Station.

Zwei Helfer zugleich: Aufruf und Start laufen unter dem Turnier-Lock wie Zuweisen und „Übernehmen“ (#1552), dazu prüft
diese Stelle, was der Helfer gesehen hat, frisch nach: Ein Spiel, das schon an einer anderen Station aufgerufen ist,
wird nicht still umgelegt; eine belegte Station nimmt kein zweites Spiel. Derselbe Aufruf noch einmal ist ein
harmloses Wiederholen (``idempotent_replay``) - „aufgerufen um“ bleibt, es geht keine zweite Nachricht hinaus.
"""
from fastapi import Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from auth import get_current_user, get_optional_user
from database import get_db
from models import new_id, now_utc
from routes.station_routes import _assign_match_to_station, _match_has_minimum_participants, _tournament_lock
from routes.tournament_common import _ensure_tournament_unlocked, _get_visible_tournament, _resolve_tid
from routes.tournament_router import router
from services.access_links import touch_access_link, validate_access_link
from services.live_queue import load_live_queue, my_entries
from services.match_calls import CALL_OPEN_STATUSES
from services.match_scheduler import RUNNING_STATUSES, _unresolved
from services.station_labels import station_text
from services.tournament_permissions import STATION_ASSIGN_ROLES, has_tournament_staff_permission
from services.tournament_rules import match_policy
from services.tv_display import DISPLAY_GRANT, KEY_EXPIRED, KEY_INVALID, key_expired

NOT_READY_DETAIL = "Die Spieler stehen noch nicht fest – aufrufen geht erst nach den Vorspielen."
ONLINE_DETAIL = "Online gibt es keine Stationen und keinen Aufruf – es gelten die Fristen."


async def _queue_tournament(db, tid: str, user: dict | None, access: str | None, key: str | None) -> dict:
    if key:
        link = await validate_access_link(db, key, "tournament", tid, None, DISPLAY_GRANT)
        if not link:
            raise HTTPException(status_code=403, detail=KEY_INVALID)
        tournament = await db.tournaments.find_one({"id": tid}, {"_id": 0})
        if not tournament:
            raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
        if key_expired(tournament, now_utc()):
            raise HTTPException(status_code=403, detail=KEY_EXPIRED)
        await touch_access_link(db, link)
        return tournament
    if await validate_access_link(db, access, "tournament", tid, user, "view"):
        tournament = await db.tournaments.find_one({"id": tid}, {"_id": 0})
        if not tournament:
            raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
        return tournament
    return await _get_visible_tournament(tid, user)


async def _operate(user: dict | None, tournament_id: str, stations: list[dict]) -> dict | None:
    """Welche Stationen diese Person bedienen darf - ``None`` ohne Recht (dann zeigt keine Seite Knöpfe)."""
    if not user:
        return None
    if await has_tournament_staff_permission(user, tournament_id, STATION_ASSIGN_ROLES, "tournament"):
        return {"all": True, "station_ids": []}
    own = [row["id"] for row in stations
           if await has_tournament_staff_permission(user, tournament_id, STATION_ASSIGN_ROLES, "station", row["id"])]
    return {"all": False, "station_ids": own} if own else None


@router.get("/{tid}/live-queue")
async def live_queue(tid: str, access: str | None = None, key: str | None = None, user: dict | None = Depends(get_optional_user)):
    db = get_db()
    tournament_id = await _resolve_tid(tid)
    tournament = await _queue_tournament(db, tournament_id, None if key else user, access, key)
    view, _keys = await load_live_queue(db, tournament)
    if user and not key:
        view["operate"] = await _operate(user, tournament_id, view["stations"])
    return view


@router.get("/{tid}/live-queue/me")
async def my_live_queue(tid: str, me: dict = Depends(get_current_user)):
    db = get_db()
    tournament_id = await _resolve_tid(tid)
    tournament = await _get_visible_tournament(tournament_id, me)
    view, keys = await load_live_queue(db, tournament)
    return {"applies": view["applies"], "reason": view["reason"], "now": view["now"], "summary": view["summary"],
            "entries": my_entries(view, keys, me.get("id"))}


class QueueAction(BaseModel):
    """Aufrufen oder Starten: welches Spiel an welcher Station."""
    model_config = ConfigDict(extra="forbid")

    station_id: str = Field(min_length=1, max_length=120)
    match_id: str = Field(min_length=1, max_length=120)


async def _context(tid: str, body: QueueAction, me: dict) -> tuple:
    """Recht, Turnier, Station und Spiel - erst das Recht, dann was es gibt."""
    db = get_db()
    tournament_id = await _resolve_tid(tid)
    allowed = (await has_tournament_staff_permission(me, tournament_id, STATION_ASSIGN_ROLES, "tournament")
               or await has_tournament_staff_permission(me, tournament_id, STATION_ASSIGN_ROLES, "station", body.station_id))
    if not allowed:
        raise HTTPException(status_code=403, detail="Keine Turnierberechtigung für diese Station")
    tournament = await db.tournaments.find_one({"id": tournament_id}, {"_id": 0, "creation_key": 0, "billing": 0})
    if not tournament:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    await _ensure_tournament_unlocked(db, tournament_id)
    station = await db.stations.find_one({"id": body.station_id}, {"_id": 0})
    own_station = station and (station.get("tournament_id") == tournament_id or (
        not station.get("tournament_id") and tournament.get("event_id") and station.get("event_id") == tournament.get("event_id")))
    if not own_station:
        raise HTTPException(status_code=404, detail="Station nicht gefunden")
    match = await db.matches_v2.find_one({"id": body.match_id, "tournament_id": tournament_id}, {"_id": 0})
    if not match or match.get("is_preview"):
        raise HTTPException(status_code=404, detail="Spiel nicht gefunden")
    stage = await db.tournament_stages.find_one({"id": match.get("stage_id")}, {"_id": 0}) if match.get("stage_id") else None
    if match_policy(match, tournament, stage)["event_mode"] != "local":
        raise HTTPException(status_code=409, detail=ONLINE_DETAIL)
    return db, tournament_id, station


async def _fresh(db, station_id: str, match_id: str) -> tuple[dict, dict]:
    station = await db.stations.find_one({"id": station_id}, {"_id": 0}) or {}
    match = await db.matches_v2.find_one({"id": match_id}, {"_id": 0}) or {}
    return station, match


async def _held_elsewhere(db, station_id: str, match: dict) -> dict | None:
    """Hält eine andere Station dieses Spiel schon (aufgerufen oder reserviert)?"""
    return await db.stations.find_one({"current_match_id": match["id"], "id": {"$ne": station_id}}, {"_id": 0})


def _running(match: dict) -> bool:
    return bool(match.get("started_at")) or str(match.get("status") or "") in RUNNING_STATUSES


def _check_open(match: dict) -> None:
    if str(match.get("status") or "pending") not in CALL_OPEN_STATUSES:
        raise HTTPException(status_code=409, detail="Das Spiel ist nicht mehr offen.")
    if not _match_has_minimum_participants(match) or _unresolved(match):
        raise HTTPException(status_code=409, detail=NOT_READY_DETAIL)


def _check_station(station: dict, match: dict) -> None:
    if station.get("status") == "broken":
        raise HTTPException(status_code=409, detail="Station ist als defekt markiert.")
    if station.get("current_match_id") and station.get("current_match_id") != match["id"]:
        raise HTTPException(status_code=409, detail="Die Station hält inzwischen ein anderes Spiel. Bitte neu laden.")


async def _audit(db, action: str, tournament_id: str, match: dict, station_id: str, actor_id: str) -> None:
    await db.audit_logs.insert_one({
        "id": new_id(), "action": action, "target_id": tournament_id, "actor_id": actor_id,
        "data": {"match_id": match.get("id"), "match_key": match.get("match_key"), "station_id": station_id},
        "created_at": now_utc().isoformat(),
    })


@router.post("/{tid}/live-queue/call")
async def call_next(tid: str, body: QueueAction, me: dict = Depends(get_current_user)):
    """Aufrufen: Station reservieren, „aufgerufen um“ setzen, „Du bist dran“ an die Spieler (einmal je Aufruf)."""
    db, tournament_id, _station = await _context(tid, body, me)
    async with _tournament_lock(db, tournament_id):
        station, match = await _fresh(db, body.station_id, body.match_id)
        if _running(match):
            raise HTTPException(status_code=409, detail="Das Spiel läuft schon.")
        _check_open(match)
        if match.get("called_at") and station.get("current_match_id") == match["id"]:
            return {"ok": True, "idempotent_replay": True, "called_at": match["called_at"]}
        elsewhere = await _held_elsewhere(db, station["id"], match)
        if elsewhere:
            where = station_text(elsewhere.get("name") or elsewhere.get("label"), elsewhere.get("device_type")) or "einer anderen Station"
            raise HTTPException(status_code=409, detail=f"Das Spiel ist schon an {where} aufgerufen.")
        _check_station(station, match)
        await _assign_match_to_station(db, station, match, "matches_v2", start_now=False)
    stored = await db.matches_v2.find_one({"id": match["id"]}, {"_id": 0, "called_at": 1}) or {}
    await _audit(db, "match.called", tournament_id, match, station["id"], me["id"])
    return {"ok": True, "idempotent_replay": False, "called_at": stored.get("called_at")}


@router.post("/{tid}/live-queue/start")
async def start_match(tid: str, body: QueueAction, me: dict = Depends(get_current_user)):
    """Gestartet: die echte Startzeit setzen - ab hier läuft die Spielzeit-Uhr und zählt „Ergebnis fehlt“."""
    db, tournament_id, _station = await _context(tid, body, me)
    async with _tournament_lock(db, tournament_id):
        station, match = await _fresh(db, body.station_id, body.match_id)
        if _running(match):
            if match.get("station_id") == station.get("id"):
                return {"ok": True, "idempotent_replay": True, "started_at": match.get("started_at")}
            raise HTTPException(status_code=409, detail="Das Spiel läuft schon an einer anderen Station.")
        _check_open(match)
        if await _held_elsewhere(db, station["id"], match):
            raise HTTPException(status_code=409, detail="Das Spiel ist an einer anderen Station aufgerufen. Bitte neu laden.")
        _check_station(station, match)
        await _assign_match_to_station(db, station, match, "matches_v2", start_now=True)
    stored = await db.matches_v2.find_one({"id": match["id"]}, {"_id": 0, "started_at": 1}) or {}
    await _audit(db, "match.started", tournament_id, match, station["id"], me["id"])
    return {"ok": True, "idempotent_replay": False, "started_at": stored.get("started_at")}
