"""Station routes."""
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Depends
from database import get_db
from auth import get_current_user, get_optional_user, require_admin
from models import StationCreate, StationUpdate, now_utc, new_id
from routes.tournament_common import tournament_hidden_reason
from services.access_links import validate_access_link
from services.change_events import reset_scope_cache
from services.heat_rebuild import evaluate_after_write, reevaluate_after_release
from services.tournament_permissions import (
    READ_STAFF_ROLES,
    STATION_ASSIGN_ROLES,
    has_tournament_staff_permission,
    is_global_tournament_admin,
    is_global_tournament_staff,
    require_tournament_staff_permission,
)
from services.tv_display import DISPLAY_GRANT, event_on_tv, key_expired, listed_station, shown_on_event_tv
from services.visibility import lead_can_see
from services.match_calls import notify_match_called
from services.station_runtime import notify_match_started
from services.competition_read import find_match_source, load_competition_read_model, load_matches_by_query
from services.match_scheduler import DONE_STATUSES, plan_for_tournament
from services.mutation_lock import MutationLockBusy, mutation_lock, tournament_write_resource

router = APIRouter(prefix="/api/stations", tags=["stations"])
TOURNAMENT_MUTATION_LOCKED_DETAIL = "Turnier ist gesperrt und kann nur noch angesehen oder geloescht werden."


async def _ensure_tournament_unlocked(db, tournament_id: str) -> None:
    tournament = await db.tournaments.find_one({"id": tournament_id}, {"_id": 0, "locked_at": 1})
    if tournament and tournament.get("locked_at"):
        raise HTTPException(status_code=423, detail=TOURNAMENT_MUTATION_LOCKED_DETAIL)


async def _require_station_permission(user: dict, tournament_id: str, station_id: str | None = None) -> None:
    allowed = (
        await has_tournament_staff_permission(user, tournament_id, STATION_ASSIGN_ROLES, "tournament")
        or (station_id and await has_tournament_staff_permission(user, tournament_id, STATION_ASSIGN_ROLES, "station", station_id))
    )
    if not allowed:
        raise HTTPException(status_code=403, detail="Keine Turnierberechtigung für diese Station")


class _tournament_lock:
    """Aufruf, Start, Freigeben und Umlegen laufen unter demselben Turnier-Lock wie das Übernehmen des Spielplans
    (#1552): so startet kein Spiel, während der Planer es gerade schreibt - und umgekehrt."""

    def __init__(self, db, tournament_id: str):
        self._lease = mutation_lock(db, tournament_write_resource(tournament_id))

    async def __aenter__(self):
        try:
            return await self._lease.__aenter__()
        except MutationLockBusy:
            raise HTTPException(status_code=409, detail="Eine Turnieraktion wird bereits verarbeitet. Bitte erneut versuchen.")

    async def __aexit__(self, *exc):
        return await self._lease.__aexit__(*exc)


async def _find_match_for_station(db, match_id: str) -> tuple[str, dict | None]:
    source = await find_match_source(db, match_id)
    return (source.collection, source.match) if source else ("", None)


def _station_match_status(match: dict, start_now: bool) -> str:
    if start_now:
        return "in_progress"
    if match.get("scheduled_at"):
        return "scheduled"
    if match.get("status") in {"pending", "preview"}:
        return "ready"
    return match.get("status") or "ready"


def _match_sort_key(match: dict) -> tuple:
    scheduled = match.get("scheduled_at") or "9999-12-31T23:59:59+00:00"
    try:
        scheduled_dt = datetime.fromisoformat(str(scheduled).replace("Z", "+00:00"))
    except Exception:
        scheduled_dt = datetime.max.replace(tzinfo=timezone.utc)
    return (
        scheduled_dt,
        int(match.get("stage_number") or 0),
        match.get("section") or match.get("bracket") or "",
        int(match.get("round") or 0),
        int(match.get("order") or match.get("position") or 0),
        int(match.get("match_index") or 0),
        match.get("match_key") or match.get("id") or "",
    )


def _match_participant_count(match: dict) -> int:
    if match.get("slots"):
        return len([slot for slot in match.get("slots") or [] if slot.get("registration_id")])
    return int(bool(match.get("participant_a_id"))) + int(bool(match.get("participant_b_id")))


def _match_has_minimum_participants(match: dict) -> bool:
    minimum = 2
    if match.get("slots"):
        try:
            minimum = max(1, int((match.get("settings") or {}).get("min_players") or 2))
        except (TypeError, ValueError):
            minimum = 2
    return _match_participant_count(match) >= minimum


class _StationView:
    """Wer welche Stationen wie sieht (#1822): ``"full"`` (vollständig, wie bisher), ``"listed"`` (die Anzeige-Felder aus
    ``tv_display.STATION_LIST_FIELDS``) oder ``None`` (gar nicht). Je Turnier und Event einmal entschieden.

    - Admins mit dem Bereich Turniere: alles vollständig.
    - Turnier- und Stationsleitung eines Turniers: dessen Stationen vollständig.
    - Sonst die Anzeige-Felder, wenn die Person das Turnier sieht (dieselbe Regel wie die Turnierseite) bzw. das Event
      (kein Entwurf, Sichtbarkeit) - oder wenn ``key`` ein gültiger Anzeige-Schlüssel dieses Turniers oder seines Events
      ist (wie Turnierbaum- und Event-TV). Stationen ohne Turnier und Event sieht nur die Leitung.
    """

    def __init__(self, db, user: dict | None, key: str | None):
        self.db, self.user, self.key = db, user, (key or "").strip() or None
        self.lead = is_global_tournament_staff(user)
        self.tournaments: dict[str, str | None] = {}
        self.events: dict[str, bool] = {}

    async def _event_key_opens(self, event: dict | None) -> bool:
        # Wie die Event-Tafel: Entwürfe und interne Events öffnet kein Schlüssel.
        if not self.key or not event_on_tv(event):
            return False
        link = await validate_access_link(self.db, self.key, "event", event["id"], None, DISPLAY_GRANT)
        return bool(link) and not key_expired(event, now_utc())

    async def for_event(self, event_id: str) -> bool:
        if event_id not in self.events:
            event = await self.db.events.find_one({"id": event_id}, {"_id": 0})
            seen = bool(event) and event.get("status") != "draft" and await lead_can_see(self.user, event.get("visibility") or "public")
            self.events[event_id] = seen or await self._event_key_opens(event)
        return self.events[event_id]

    async def for_tournament(self, tournament_id: str) -> str | None:
        if tournament_id not in self.tournaments:
            self.tournaments[tournament_id] = await self._tournament(tournament_id)
        return self.tournaments[tournament_id]

    async def _tournament(self, tournament_id: str) -> str | None:
        tournament = await self.db.tournaments.find_one({"id": tournament_id}, {"_id": 0})
        if not tournament:
            return None
        if await has_tournament_staff_permission(self.user, tournament_id, READ_STAFF_ROLES):
            return "full"
        if await tournament_hidden_reason(self.db, tournament, self.user) is None:
            return "listed"
        if self.key:
            link = await validate_access_link(self.db, self.key, "tournament", tournament_id, None, DISPLAY_GRANT)
            if link and not key_expired(tournament, now_utc()):
                return "listed"
            if tournament.get("event_id") and shown_on_event_tv(tournament):
                event = await self.db.events.find_one({"id": tournament["event_id"]}, {"_id": 0})
                if await self._event_key_opens(event):
                    return "listed"
        return None

    async def rows(self, stations: list[dict]) -> list[dict]:
        if self.lead:
            return stations
        shown = []
        for station in stations:
            if station.get("tournament_id"):
                view = await self.for_tournament(station["tournament_id"])
            elif station.get("event_id"):
                view = "listed" if await self.for_event(station["event_id"]) else None
            else:
                view = None
            if view == "full":
                shown.append(station)
            elif view == "listed":
                shown.append(listed_station(station))
        return shown


@router.get("")
async def list_stations(tournament_id: str | None = None, event_id: str | None = None, key: str | None = None,
                        user: dict | None = Depends(get_optional_user)):
    """Die Stationen - für die Leitung vollständig, sonst die Anzeige-Felder dessen, was die Person sehen darf
    (``_StationView``). ``key``: Anzeige-Schlüssel eines Turniers oder Events, wie bei Turnierbaum- und Event-TV."""
    db = get_db()
    q = {}
    if tournament_id:
        q["tournament_id"] = tournament_id
    if event_id:
        q["event_id"] = event_id
    stations = await db.stations.find(q, {"_id": 0}).to_list(500)
    return await _StationView(db, user, key).rows(stations)


@router.post("")
async def create_station(body: StationCreate, me: dict = Depends(require_admin())):
    db = get_db()
    doc = body.model_dump()
    if doc.get("tournament_id") and not await db.tournaments.find_one({"id": doc["tournament_id"]}, {"id": 1}):
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    if doc.get("tournament_id"):
        await _ensure_tournament_unlocked(db, doc["tournament_id"])
    doc["id"] = new_id()
    doc["status"] = "free"
    doc["current_match_id"] = None
    doc["queue_match_ids"] = []
    doc["created_at"] = now_utc().isoformat()
    doc["updated_at"] = now_utc().isoformat()
    await db.stations.insert_one(doc)
    reset_scope_cache()  # Live-Meldungen (#1801): Turnier und Event neu nachschlagen
    doc.pop("_id", None)
    return doc


@router.put("/{sid}")
@router.patch("/{sid}")
async def update_station(sid: str, body: StationUpdate, me: dict = Depends(require_admin())):
    db = get_db()
    nullable = {"tournament_id", "event_id", "game_id", "notes", "current_match_id", "current_match_type"}
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None or k in nullable}
    current = await db.stations.find_one({"id": sid}, {"_id": 0})
    if current and current.get("tournament_id"):
        await _ensure_tournament_unlocked(db, current["tournament_id"])
    if updates.get("tournament_id") and not await db.tournaments.find_one({"id": updates["tournament_id"]}, {"id": 1}):
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    if updates.get("tournament_id"):
        await _ensure_tournament_unlocked(db, updates["tournament_id"])
    updates["updated_at"] = now_utc().isoformat()
    # Seit wann defekt (#1160) - für „Braucht Aufmerksamkeit“; wieder frei heißt: der Zeitpunkt fällt weg.
    if updates.get("status") == "broken" and (current or {}).get("status") != "broken":
        updates["broken_at"] = updates["updated_at"]
    change: dict = {"$set": updates}
    # Ein Aufruf (#1122) gilt nur, solange die Station für genau dieses Spiel reserviert ist.
    previous_match = (current or {}).get("current_match_id")
    status_left = "status" in updates and updates["status"] != "reserved"
    match_changed = "current_match_id" in updates and updates["current_match_id"] != previous_match
    if status_left or match_changed:
        change["$unset"] = {"called_at": ""}
        if previous_match and (current or {}).get("called_at"):
            await _forget_call(db, previous_match, actor_id=me.get("id"))
    await db.stations.update_one({"id": sid}, change)
    reset_scope_cache()  # Live-Meldungen (#1801): Turnier und Event neu nachschlagen
    s = await db.stations.find_one({"id": sid}, {"_id": 0})
    return s


async def release_station(db, station_id: str, expected_match_id: str | None) -> bool:
    """Die Station freigeben - nur, wenn sie noch das Spiel hält, das der Aufrufer gesehen hat (Compare-and-Set).
    Hält sie inzwischen ein anderes, bleibt das stehen; die Antwort sagt, ob freigegeben wurde."""
    result = await db.stations.update_one(
        {"id": station_id, "current_match_id": expected_match_id},
        {"$set": {"current_match_id": None, "current_match_type": None, "status": "free", "updated_at": now_utc().isoformat()},
         "$unset": {"called_at": ""}},
    )
    return bool(result.matched_count)


async def _forget_call(db, match_id: str | None, actor_id: str | None = None) -> None:
    """Der Aufruf eines Spiels ist vorbei (gestartet, freigegeben, umgeplant): „aufgerufen um“ fällt weg. Ohne Aufruf
    ist ein Lauf wieder umbaubar - die Lauf-Umbau-Auswertung läuft erneut, auch nach aufgegebener Warteschlange
    (#2033)."""
    if not match_id:
        return
    before = await db.matches_v2.find_one_and_update(
        {"id": match_id}, {"$unset": {"called_at": ""}}, projection={"_id": 0, "tournament_id": 1, "called_at": 1})
    if before and before.get("called_at"):
        await reevaluate_after_release(db, before.get("tournament_id"), actor_id=actor_id, trigger="uncall")


async def _assign_match_to_station(db, station: dict, match: dict, collection_name: str, start_now: bool = False) -> None:
    station_tid = station.get("tournament_id")
    if station_tid and station_tid != match.get("tournament_id"):
        raise HTTPException(status_code=400, detail="Station gehoert zu einem anderen Turnier")
    if station.get("status") == "broken":
        raise HTTPException(status_code=409, detail="Station ist als defekt markiert")
    if station.get("current_match_id") and station.get("current_match_id") != match.get("id"):
        raise HTTPException(status_code=409, detail="Station ist bereits belegt. Bitte zuerst freigeben.")
    if start_now and not _match_has_minimum_participants(match):
        raise HTTPException(status_code=409, detail="Match hat zu wenige Teilnehmer und kann nicht gestartet werden.")
    now_iso = now_utc().isoformat()
    match_updates = {
        "station_id": station["id"],
        "status": _station_match_status(match, start_now),
        "updated_at": now_iso,
    }
    station_updates = {
        "current_match_id": match["id"],
        "current_match_type": collection_name,
        "status": "busy" if start_now else "reserved",
        "updated_at": now_iso,
    }
    match_change: dict = {"$set": match_updates}
    station_change: dict = {"$set": station_updates}
    if start_now:
        match_updates["started_at"] = now_iso
        match_updates["scheduled_at"] = match.get("scheduled_at") or now_iso
        # Gestartet: der Aufruf ist vorbei.
        match_change["$unset"] = {"called_at": ""}
        station_change["$unset"] = {"called_at": ""}
    else:
        # Reservieren heißt „aufgerufen“ (#1122): die Aufruf-Tafel zählt ab jetzt bis zur geplanten Zeit, ohne Uhrzeit die
        # „Zeit zum Antreten“. Wird dasselbe Spiel an derselben Station noch einmal zugewiesen, bleibt die erste Zeit.
        same_call = station.get("current_match_id") == match.get("id") and station.get("status") == "reserved"
        called_at = station.get("called_at") if same_call and station.get("called_at") else now_iso
        match_updates["called_at"] = called_at
        station_updates["called_at"] = called_at
    # Die Station nur belegen, wenn sie jetzt noch frei (oder schon für dieses Spiel reserviert) ist - nicht gegen
    # den Stand, den der Aufrufer gelesen hat (Compare-and-Set; zwei Zuweisungen zugleich sahen beide „frei“).
    claimed = await db.stations.update_one(
        {"id": station["id"], "status": {"$ne": "broken"}, "deleting": {"$ne": True},
         "$or": [{"current_match_id": None}, {"current_match_id": {"$exists": False}}, {"current_match_id": match["id"]}]},
        station_change,
    )
    if not claimed.matched_count:
        raise HTTPException(status_code=409, detail="Station ist inzwischen belegt. Bitte zuerst freigeben.")
    await db.stations.update_many(
        {"current_match_id": match["id"], "id": {"$ne": station["id"]}, "status": {"$ne": "broken"}},
        {"$set": {"current_match_id": None, "current_match_type": None, "status": "free", "updated_at": now_utc().isoformat()},
         "$unset": {"called_at": ""}},
    )
    # Umlegen von einer defekten Station (#1160): sie gibt das Spiel ab, bleibt aber defekt.
    await db.stations.update_many(
        {"current_match_id": match["id"], "id": {"$ne": station["id"]}, "status": "broken"},
        {"$set": {"current_match_id": None, "current_match_type": None, "updated_at": now_utc().isoformat()}, "$unset": {"called_at": ""}},
    )
    await db[collection_name].update_one({"id": match["id"]}, match_change)
    if start_now:
        before = await db.tournaments.find_one({"id": match["tournament_id"]}, {"_id": 0, "status": 1}) or {}
        went_live = await db.tournaments.update_one(
            {"id": match["tournament_id"], "status": {"$in": ["scheduled", "registration_open", "registration_closed", "check_in"]}},
            {"$set": {"status": "live", "updated_at": now_iso}},
        )
        if went_live.modified_count:
            reset_scope_cache()  # Live-Meldungen (#1801): Turnier und Event neu nachschlagen
            # Das erste Match an einer Station startet das Turnier - im Discord wie über den Knopf (#572).
            from services.discord_threads import status_written
            await status_written(db, match["tournament_id"], before.get("status"))
        started_match = {**match, **match_updates}
        await notify_match_started(db, started_match, station, collection_name)
    else:
        # Der Aufruf (#1137): „Du bist dran“ an alle Spieler des Spiels - einmal je Aufruf; dieselbe Reservierung noch
        # einmal gespeichert behält „aufgerufen um“ und schickt nichts Neues.
        try:
            await notify_match_called(db, {**match, **match_updates}, station, match_updates["called_at"])
        except Exception as exc:  # noqa: BLE001 - eine Nachricht hält keine Reservierung auf
            logging.getLogger("tls.stations").warning("Aufruf für Match %s nicht verschickt type=%s", match.get("id"), type(exc).__name__)


@router.post("/bulk")
async def bulk_create_stations(body: dict, me: dict = Depends(require_admin())):
    db = get_db()
    tournament_id = body.get("tournament_id")
    if tournament_id and not await db.tournaments.find_one({"id": tournament_id}, {"id": 1}):
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    if tournament_id:
        await _ensure_tournament_unlocked(db, tournament_id)
    count = int(body.get("count") or 0)
    if count < 1 or count > 64:
        raise HTTPException(status_code=400, detail="Anzahl muss zwischen 1 und 64 liegen")
    prefix = (body.get("prefix") or "Station").strip() or "Station"
    device_type = (body.get("device_type") or "switch").strip()
    notes = (body.get("notes") or "").strip() or None
    now = now_utc().isoformat()
    docs = []
    for index in range(1, count + 1):
        docs.append({
            "id": new_id(),
            "name": f"{prefix} {index}",
            "device_type": device_type,
            "tournament_id": tournament_id,
            "event_id": body.get("event_id"),
            "game_id": body.get("game_id"),
            "notes": notes,
            "status": "free",
            "current_match_id": None,
            "current_match_type": None,
            "queue_match_ids": [],
            "created_at": now,
            "updated_at": now,
        })
    await db.stations.insert_many(docs)
    reset_scope_cache()  # Live-Meldungen (#1801): Turnier und Event neu nachschlagen
    for doc in docs:
        doc.pop("_id", None)
    return {"created": len(docs), "stations": docs}


@router.post("/auto-assign")
async def auto_assign_stations(tournament_id: str, start_now: bool = False,
                               plan: bool = True,
                               me: dict = Depends(get_current_user)):
    db = get_db()
    tournament = await db.tournaments.find_one({"id": tournament_id}, {"_id": 0})
    if not tournament:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    await _ensure_tournament_unlocked(db, tournament_id)
    await require_tournament_staff_permission(me, tournament_id, STATION_ASSIGN_ROLES, "tournament")
    if plan and not start_now:
        # Planen heißt seit #1552: der Spielplaner rechnet Zeit und Station zusammen - hier nur als Vorschau.
        # Geschrieben wird allein über POST /tournaments/{tid}/schedule/apply mit dem Fingerabdruck der Vorschau.
        computed = await plan_for_tournament(db, tournament)
        return {"assigned": 0, "items": [], "planned": True, **computed}
    station_query = {"tournament_id": tournament_id, "status": {"$ne": "broken"}}
    station_query = {
        **station_query,
        "status": {"$in": ["free", "reserved"]},
        "$or": [{"current_match_id": None}, {"current_match_id": {"$exists": False}}],
    }
    stations = await db.stations.find(station_query, {"_id": 0}).sort("name", 1).to_list(200)
    if not stations:
        return {"assigned": 0, "items": [], "planned": False}
    status_filter = ["ready", "scheduled"] if start_now else ["preview", "pending", "ready", "scheduled"]
    station_filter = {"$in": [None, ""]} if not start_now else {"$in": [None, "", *[station["id"] for station in stations]]}
    allowed_station_ids = set(station_filter["$in"])
    read_model = await load_competition_read_model(db, tournament_id)
    candidates = [
        (match["collection"], match)
        for match in read_model.structure_snapshot()["matches"]
        if match.get("station_id") in allowed_station_ids
        and match.get("status") in status_filter
    ]
    candidates = [item for item in candidates if _match_has_minimum_participants(item[1])]
    candidates.sort(key=lambda item: _match_sort_key(item[1]))

    async with _tournament_lock(db, tournament_id):
        assigned = await _start_on_free_stations(db, stations, candidates, start_now)
    return {"assigned": len(assigned), "items": assigned, "planned": False}


async def _start_on_free_stations(db, stations, candidates, start_now: bool) -> list[dict]:
    assigned = []
    used_match_ids: set[str] = set()
    for station in stations:
        preferred_index = next(
            (
                index for index, (_collection_name, match) in enumerate(candidates)
                if match.get("id") not in used_match_ids and match.get("station_id") == station["id"]
            ),
            None,
        )
        fallback_index = next(
            (
                index for index, (_collection_name, match) in enumerate(candidates)
                if match.get("id") not in used_match_ids and not match.get("station_id")
            ),
            None,
        )
        candidate_index = preferred_index if preferred_index is not None else fallback_index
        if candidate_index is None:
            continue
        collection_name, match = candidates[candidate_index]
        await _assign_match_to_station(db, station, match, collection_name, start_now=start_now)
        used_match_ids.add(match["id"])
        assigned.append({"station_id": station["id"], "match_id": match["id"], "match_type": collection_name})
    return assigned


@router.post("/{sid}/assign/{match_id}")
async def assign_match(sid: str, match_id: str, start_now: bool = False,
                       me: dict = Depends(get_current_user)):
    db = get_db()
    station = await db.stations.find_one({"id": sid}, {"_id": 0})
    if not station:
        raise HTTPException(status_code=404, detail="Station nicht gefunden")
    collection_name, match = await _find_match_for_station(db, match_id)
    if not match:
        raise HTTPException(status_code=404, detail="Match nicht gefunden")
    await _ensure_tournament_unlocked(db, match["tournament_id"])
    await _require_station_permission(me, match["tournament_id"], sid)
    async with _tournament_lock(db, match["tournament_id"]):
        # Station und Spiel unter dem Lock frisch lesen - der Stand von oben kann schon überholt sein.
        station = await db.stations.find_one({"id": sid}, {"_id": 0}) or station
        _collection, current = await _find_match_for_station(db, match_id)
        await _assign_match_to_station(db, station, current or match, collection_name, start_now=start_now)
    return {"ok": True}


@router.post("/{sid}/clear")
async def clear_station(sid: str, me: dict = Depends(get_current_user)):
    db = get_db()
    s = await db.stations.find_one({"id": sid})
    if not s:
        raise HTTPException(status_code=404, detail="Station nicht gefunden")
    if s and s.get("current_match_id"):
        collection_name, match = await _find_match_for_station(db, s["current_match_id"])
        if match:
            await _ensure_tournament_unlocked(db, match["tournament_id"])
            await _require_station_permission(me, match["tournament_id"], sid)
        elif not is_global_tournament_admin(me):
            raise HTTPException(status_code=403, detail="Keine Turnierberechtigung für diese Station")
        if collection_name and match:
            # Freigeben beendet auch einen Aufruf (#1122) - Spiel und Station zusammen unter dem Turnier-Lock, und die
            # Station nur, wenn sie noch dieses Spiel hält (ein inzwischen zugewiesenes bleibt).
            async with _tournament_lock(db, match["tournament_id"]):
                held = await db.stations.find_one({"id": sid}, {"_id": 0, "current_match_id": 1}) or {}
                if held.get("current_match_id") != s["current_match_id"]:
                    raise HTTPException(status_code=409, detail="Die Station hält inzwischen ein anderes Spiel. Bitte neu laden.")
                before = await db[collection_name].find_one_and_update(
                    {"id": s["current_match_id"]},
                    {"$set": {"station_id": None, "updated_at": now_utc().isoformat()}, "$unset": {"called_at": ""}},
                    projection={"_id": 0, "called_at": 1})
                await release_station(db, sid, expected_match_id=s["current_match_id"])
                if (before or {}).get("called_at"):
                    # Aufruf zurückgenommen - nach dem Stand unter der Sperre, der von oben kann älter sein als ein
                    # Aufruf dazwischen: der Lauf ist wieder umbaubar, die Lauf-Umbau-Auswertung läuft erneut, unter
                    # der gehaltenen Sperre, auch nach aufgegebener Warteschlange (#2033).
                    await evaluate_after_write(db, match["tournament_id"], actor_id=me.get("id"), trigger="uncall")
            return {"ok": True}
    elif not is_global_tournament_admin(me):
        raise HTTPException(status_code=403, detail="Keine Turnierberechtigung für diese Station")
    await release_station(db, sid, expected_match_id=s.get("current_match_id"))
    return {"ok": True}


@router.delete("/{sid}")
async def delete_station(sid: str, me: dict = Depends(require_admin())):
    db = get_db()
    station = await db.stations.find_one({"id": sid}, {"_id": 0})
    if station and station.get("tournament_id"):
        await _ensure_tournament_unlocked(db, station["tournament_id"])
    # Nicht löschen, solange ein Spiel daran hängt, das nicht vorbei ist (Praxis 14.10.): sonst behielte es die Kennung
    # einer Station, die es nicht mehr gibt, samt fester Zeit - der Plan wäre nicht mehr zu lesen. Stilles Lösen wäre
    # die andere Wahl, würfe aber von Hand gesetzte Zeiten weg, ohne dass es jemand sieht. Gespielte Spiele halten die
    # Station nicht fest, sie behalten nur, wo sie gespielt wurden.
    if not station:
        return {"ok": True}
    # Atomar gegen Zuweisungen (Codex zu #1611): erst markieren - nur wenn die Station gerade kein Spiel hält -, dann
    # prüfen, dann löschen. Zuweisungen lehnen markierte Stationen ab und prüfen nach dem Schreiben nach.
    marked = await db.stations.update_one(
        {"id": sid, "deleting": {"$ne": True}, "$or": [{"current_match_id": None}, {"current_match_id": {"$exists": False}}]},
        {"$set": {"deleting": True}})
    if not marked.matched_count:
        raise HTTPException(status_code=409, detail="Die Station hält gerade ein Spiel oder wird schon gelöscht. Bitte neu laden.")
    deleted = False
    try:
        holding = sorted(
            await load_matches_by_query(db, {"station_id": sid, "status": {"$nin": list(DONE_STATUSES)}}, per_store_limit=500),
            key=lambda match: str(match.get("match_key") or ""),
        )
        if holding:
            raise HTTPException(status_code=409, detail=station_in_use_message(station.get("name"), holding))
        deleted = bool((await db.stations.delete_one({"id": sid, "deleting": True})).deleted_count)
        reset_scope_cache()  # Live-Meldungen (#1801): Turnier und Event neu nachschlagen
    finally:
        # Was nicht gelöscht wurde (Spiele gefunden, Fehler), bleibt benutzbar - sonst wäre es für immer gesperrt.
        if not deleted:
            await db.stations.update_one({"id": sid, "deleting": True}, {"$unset": {"deleting": ""}})
    return {"ok": True}


def station_in_use_message(name: str | None, matches: list[dict]) -> str:
    count = len(matches)
    keys = [str(match.get("match_key")) for match in matches if match.get("match_key")]
    named = f" ({', '.join(keys[:8])}{' …' if len(keys) > 8 else ''})" if keys else ""
    games = "1 Spiel" if count == 1 else f"{count} Spiele"
    return (f"Station „{name or 'ohne Namen'}“ ist noch für {games}{named} eingeplant, die nicht vorbei sind. "
            "Erst im Matchplan auf eine andere Station legen oder die Termine lösen, dann löschen.")
