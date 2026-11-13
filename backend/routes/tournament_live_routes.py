"""Live vor Ort (#1556): Warteschlange je Station, Aufruf und Start vom Handy, Spieler-Sicht.

- ``GET /tournaments/{tid}/live-queue``: öffentlich wie der Turnierbaum (sichtbares Turnier, Freigabe-Link oder
  TV-Anzeige-Schlüssel ``key``). Je Station läuft/als Nächstes/danach, je Spiel Prognose und Verzug. Angemeldete mit
  Stations-Recht bekommen dazu ``operate`` (alle Stationen oder ihre eigenen).
- ``GET /tournaments/{tid}/live-queue/me``: die eigenen Spiele - „Du bist als Nächstes an Station 2“.
- ``POST /tournaments/{tid}/live-queue/call`` und ``.../start``: Organisation, Schiedsrichter, Stationsleitung - fürs
  ganze Turnier oder für genau diese Station.
- ``POST .../live-queue/release``, ``.../broken`` und ``.../move`` (#1162): Freigeben, Defekt bzw. wieder bereit und
  Umlegen vom Handy - dieselben Rollen, ohne Admin-Recht.

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
from services.change_events import reset_scope_cache
from services.heat_rebuild import evaluate_after_write
from services.live_queue import load_live_queue, my_entries
from services.match_calls import CALL_OPEN_STATUSES
from services.match_scheduler import DONE_STATUSES, RUNNING_STATUSES, _unresolved
from services.station_labels import station_text
from services.tournament_permissions import (
    STATION_ASSIGN_ROLES,
    has_tournament_staff_permission,
    is_staffel,
    leads_tournament,
)
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
    """Welche Stationen diese Person bedienen darf - ``None`` ohne Recht (dann zeigt keine Seite Knöpfe).

    Dieselbe Regel wie ``has_tournament_staff_permission`` (ganzes Turnier oder Station), aber mit einem Zugriff auf die
    Einsätze statt einem je Station (Codex zu #1595)."""
    if not user:
        return None
    if await leads_tournament(user, tournament_id, "matches"):
        return {"all": True, "station_ids": []}
    if await is_staffel(tournament_id):
        return None  # Helfer lesen in einer Staffel nur (#2203).
    assignments = await get_db().tournament_staff_assignments.find(
        {"tournament_id": tournament_id, "user_id": user.get("id"), "is_active": {"$ne": False},
         "role": {"$in": sorted(STATION_ASSIGN_ROLES)}},
        {"_id": 0, "scope": 1, "scope_id": 1},
    ).to_list(200)
    scopes = [(row.get("scope") or "tournament", row.get("scope_id")) for row in assignments]
    if any(scope == "tournament" for scope, _ in scopes):
        return {"all": True, "station_ids": []}
    station_ids = [row["id"] for row in stations]
    if any(scope == "station" and not scope_id for scope, scope_id in scopes):
        own = station_ids
    else:
        allowed = {scope_id for scope, scope_id in scopes if scope == "station"}
        own = [station_id for station_id in station_ids if station_id in allowed]
    return {"all": False, "station_ids": own} if own else None


@router.get("/{tid}/live-queue")
async def live_queue(
    tid: str, access: str | None = None, key: str | None = None, user: dict | None = Depends(get_optional_user)
):
    db = get_db()
    tournament_id = await _resolve_tid(tid)
    tournament = await _queue_tournament(db, tournament_id, None if key else user, access, key)
    view, _keys = await load_live_queue(db, tournament)
    if user and not key:
        view["operate"] = await _operate(user, tournament_id, view["stations"])
        if view["operate"]:
            # Nur für die Leitung (#1162): was eine Station hält, das nicht in diese Warteschlange passt.
            await _attach_hold_issues(db, tournament_id, view["stations"])
    return view


@router.get("/{tid}/live-queue/me")
async def my_live_queue(tid: str, me: dict = Depends(get_current_user)):
    db = get_db()
    tournament_id = await _resolve_tid(tid)
    tournament = await _get_visible_tournament(tournament_id, me)
    view, keys = await load_live_queue(db, tournament)
    return {
        "applies": view["applies"],
        "reason": view["reason"],
        "now": view["now"],
        "summary": view["summary"],
        "entries": my_entries(view, keys, me.get("id")),
    }


class QueueAction(BaseModel):
    """Aufrufen oder Starten: welches Spiel an welcher Station."""

    model_config = ConfigDict(extra="forbid")

    station_id: str = Field(min_length=1, max_length=120)
    match_id: str = Field(min_length=1, max_length=120)


async def _may_operate(me: dict, tournament_id: str, station_id: str) -> bool:
    return await has_tournament_staff_permission(
        me, tournament_id, STATION_ASSIGN_ROLES, "tournament", capability="matches"
    ) or await has_tournament_staff_permission(me, tournament_id, STATION_ASSIGN_ROLES, "station", station_id, capability="matches")


def _own_station(station: dict | None, tournament: dict) -> bool:
    """Eine Station dieses Turniers - oder eine des Events ohne eigenes Turnier (geteilte Stationen, #1801)."""
    return bool(station) and (
        station.get("tournament_id") == tournament["id"]
        or (
            not station.get("tournament_id")
            and bool(tournament.get("event_id"))
            and station.get("event_id") == tournament.get("event_id")
        )
    )


async def _station_context(tid: str, station_id: str, me: dict) -> tuple:
    """Recht, Turnier und Station - erst das Recht, dann was es gibt."""
    db = get_db()
    tournament_id = await _resolve_tid(tid)
    if not await _may_operate(me, tournament_id, station_id):
        raise HTTPException(status_code=403, detail="Keine Turnierberechtigung für diese Station")
    tournament = await db.tournaments.find_one({"id": tournament_id}, {"_id": 0, "creation_key": 0, "billing": 0})
    if not tournament:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    await _ensure_tournament_unlocked(db, tournament_id)
    station = await db.stations.find_one({"id": station_id}, {"_id": 0})
    if not _own_station(station, tournament):
        raise HTTPException(status_code=404, detail="Station nicht gefunden")
    return db, tournament, station


async def _context(tid: str, body: QueueAction, me: dict) -> tuple:
    """Recht, Turnier, Station und Spiel - erst das Recht, dann was es gibt."""
    db, tournament, station = await _station_context(tid, body.station_id, me)
    tournament_id = tournament["id"]
    match = await db.matches_v2.find_one({"id": body.match_id, "tournament_id": tournament_id}, {"_id": 0})
    if not match or match.get("is_preview"):
        raise HTTPException(status_code=404, detail="Spiel nicht gefunden")
    stage = (
        await db.tournament_stages.find_one({"id": match.get("stage_id")}, {"_id": 0})
        if match.get("stage_id")
        else None
    )
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
    await db.audit_logs.insert_one(
        {
            "id": new_id(),
            "action": action,
            "target_id": tournament_id,
            "actor_id": actor_id,
            "data": {"match_id": match.get("id"), "match_key": match.get("match_key"), "station_id": station_id},
            "created_at": now_utc().isoformat(),
        }
    )


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
            where = (
                station_text(elsewhere.get("name") or elsewhere.get("label"), elsewhere.get("device_type"))
                or "einer anderen Station"
            )
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
            raise HTTPException(
                status_code=409, detail="Das Spiel ist an einer anderen Station aufgerufen. Bitte neu laden."
            )
        _check_station(station, match)
        await _assign_match_to_station(db, station, match, "matches_v2", start_now=True)
    stored = await db.matches_v2.find_one({"id": match["id"]}, {"_id": 0, "started_at": 1}) or {}
    await _audit(db, "match.started", tournament_id, match, station["id"], me["id"])
    return {"ok": True, "idempotent_replay": False, "started_at": stored.get("started_at")}


# ---------------------------------------------------------------- Freigeben, Defekt, Umlegen (#1162)
# Dieselben Rollen wie Aufrufen und Starten (Organisation, Schiedsrichter, Stationsleitung - fürs ganze Turnier oder für
# genau diese Station), ohne Admin-Recht. Alles unter dem Turnier-Lock und mit Compare-and-Set an der Station: zwei
# Leitungen zugleich ergeben genau einen Wechsel, die andere bekommt 409 mit einer Meldung - oder, wenn sie dasselbe
# wollte, ``idempotent_replay``.

HOLDS_OTHER_DETAIL = "Die Station hält inzwischen ein anderes Spiel. Bitte neu laden."
TARGET_TAKEN_DETAIL = "Die Zielstation ist inzwischen belegt. Bitte neu laden."


async def _hold_issue(db, station: dict, tournament_id: str) -> dict | None:
    """Was eine Station hält, das nicht in die Warteschlange dieses Turniers passt (#1162):

    - ``other``: ein offenes Spiel eines anderen Turniers - eine geteilte Station des Events. Freigeben und Räumen macht
      dessen Leitung; „Defekt“ geht trotzdem (physisch stimmt es), mit Rückfrage und Bescheid an dessen Leitung.
    - ``stuck``: als belegt oder reserviert gespeichert, aber ohne offenes Spiel an genau dieser Station - etwa nach dem
      Löschen einer Phase. „Station räumen“ macht sie wieder frei.
    """
    held = station.get("current_match_id")
    if not held:
        return {"kind": "stuck", "match_id": None} if station.get("status") in {"busy", "reserved"} else None
    match = await db.matches_v2.find_one({"id": held}, {"_id": 0})
    open_match = bool(match) and str(match.get("status") or "") not in DONE_STATUSES
    if open_match and match.get("tournament_id") != tournament_id:
        other = await db.tournaments.find_one({"id": match["tournament_id"]}, {"_id": 0, "id": 1, "title": 1, "slug": 1}) or {}
        return {"kind": "other", "match": match, "tournament": {"id": match["tournament_id"], **other},
                "tournament_title": other.get("title") or "ein anderes Turnier"}
    if not open_match or match.get("station_id") != station.get("id"):
        return {"kind": "stuck", "match_id": held}
    return None


async def _attach_hold_issues(db, tournament_id: str, rows: list[dict]) -> None:
    ids = [row["id"] for row in rows if row.get("id")]
    docs = {doc["id"]: doc for doc in await db.stations.find({"id": {"$in": ids}}, {"_id": 0}).to_list(len(ids) + 1)}
    for row in rows:
        issue = await _hold_issue(db, docs.get(row["id"]) or {}, tournament_id)
        row["hold_issue"] = {"kind": issue["kind"], "tournament_title": issue.get("tournament_title")} if issue else None


def _other_text(issue: dict) -> str:
    return f"An dieser Station spielt gerade „{issue['tournament_title']}“ – dessen Leitung gibt frei."


async def _tell_other_lead(db, issue: dict, station: dict, tournament: dict, actor_id: str, broken_at: str) -> int:
    """Eine geteilte Station ist defekt, an der gerade ein anderes Turnier spielt: dessen Leitung (wer dort Ergebnisse
    einträgt) bekommt sofort Bescheid - mit demselben Schlüssel wie der Fall „Station defekt“ (keine zweite Nachricht)."""
    from services.tournament_permissions import result_staff_user_ids
    from services.user_notifications import create_user_notification

    other = issue["tournament"]
    where = _station_name(station)
    state = _held_state(issue["match"])
    what = "das laufende Spiel" if state == "running" else "der Aufruf" if state == "called" else "ein Spiel"
    body = (f"{issue['tournament_title']}: {where} wurde von der Leitung von „{tournament.get('title') or 'Turnier'}“ als "
            f"defekt gemeldet – {what} steht noch dort. Bitte umlegen.")
    sent = 0
    for user_id in sorted(await result_staff_user_ids(db, issue["match"]) - {actor_id}):
        if await create_user_notification(
            user_id, f"Station defekt: {where}", body,
            url=f"/tournaments/{other.get('slug') or other['id']}/leitung?reiter=stationen", kind="match_attention",
            meta={"category": "tournament_updates", "tournament_id": other["id"], "match_id": issue["match"].get("id"),
                  "station_id": station["id"], "reason": "station_broken",
                  "dedupe_key": f"attention:st-{station['id']}:{broken_at}"},
        ):
            sent += 1
    return sent


class StationRelease(QueueAction):
    """Freigeben: die Station gibt das Spiel ab, das die Leitung gesehen hat (``match_id``)."""


class StationBroken(BaseModel):
    """Defekt melden (``broken``) oder wieder bereit (``broken: false``)."""

    model_config = ConfigDict(extra="forbid")

    station_id: str = Field(min_length=1, max_length=120)
    broken: bool = True
    # Geteilte Station, an der gerade ein anderes Turnier spielt (#1162): erst nach Rückfrage.
    confirm_other: bool = False


class StationMove(QueueAction):
    """Umlegen: das Spiel, das ``station_id`` hält, auf die freie Station ``to_station_id``."""

    to_station_id: str = Field(min_length=1, max_length=120)


async def _station_audit(db, action: str, tournament_id: str, actor_id: str, data: dict) -> None:
    await db.audit_logs.insert_one(
        {"id": new_id(), "action": action, "target_id": tournament_id, "actor_id": actor_id,
         "data": data, "created_at": now_utc().isoformat()}
    )


def _held_state(match: dict | None) -> str | None:
    """Was die Station mit diesem Spiel hält: ``running``, ``called`` oder nichts Offenes."""
    if not match or str(match.get("status") or "") in DONE_STATUSES:
        return None
    if _running(match):
        return "running"
    return "called" if match.get("called_at") else None


@router.post("/{tid}/live-queue/release")
async def release_station_live(tid: str, body: StationRelease, me: dict = Depends(get_current_user)):
    """Freigeben: Ein Aufruf wird zurückgenommen (das Spiel rückt zurück in die Warteschlange); ein laufendes Spiel
    gibt die Station ab, das Ergebnis kommt danach unter „Ergebnisse“. Eine defekte Station bleibt defekt."""
    db, tournament, _station = await _station_context(tid, body.station_id, me)
    tournament_id = tournament["id"]
    async with _tournament_lock(db, tournament_id):
        station = await db.stations.find_one({"id": body.station_id}, {"_id": 0}) or {}
        held = station.get("current_match_id")
        if not held:
            # Doppeltipp oder eine zweite Leitung war schneller: schon frei.
            return {"ok": True, "idempotent_replay": True, "state": None}
        issue = await _hold_issue(db, station, tournament_id)
        if issue and issue["kind"] == "other":
            # Geteilte Event-Station (#1162): das Spiel eines anderen Turniers gibt nur dessen Leitung frei.
            raise HTTPException(status_code=409, detail=_other_text(issue))
        if held != body.match_id:
            raise HTTPException(status_code=409, detail=HOLDS_OTHER_DETAIL)
        match = await db.matches_v2.find_one({"id": body.match_id, "tournament_id": tournament_id}, {"_id": 0})
        state = _held_state(match)
        now_iso = now_utc().isoformat()
        station_set = {"current_match_id": None, "current_match_type": None, "updated_at": now_iso,
                       "last_match_id": body.match_id, "last_match_type": "matches_v2", "freed_at": now_iso}
        if station.get("status") != "broken":
            station_set["status"] = "free"
        freed = await db.stations.update_one(
            {"id": station["id"], "current_match_id": body.match_id},
            {"$set": station_set, "$unset": {"called_at": ""}},
        )
        if not freed.matched_count:
            raise HTTPException(status_code=409, detail=HOLDS_OTHER_DETAIL)
        before = await db.matches_v2.find_one_and_update(
            {"id": body.match_id, "tournament_id": tournament_id, "station_id": station["id"]},
            {"$set": {"station_id": None, "updated_at": now_iso}, "$unset": {"called_at": ""}},
            projection={"_id": 0, "called_at": 1},
        )
        if (before or {}).get("called_at"):
            # Aufruf zurückgenommen: der Lauf ist wieder umbaubar (#2033) - unter der gehaltenen Sperre auswerten.
            await evaluate_after_write(db, tournament_id, actor_id=me.get("id"), trigger="uncall")
    await _station_audit(db, "station.released", tournament_id, me["id"], {
        "station_id": station["id"], "match_id": body.match_id, "match_key": (match or {}).get("match_key"), "state": state,
    })
    return {"ok": True, "idempotent_replay": False, "state": state}


@router.post("/{tid}/live-queue/broken")
async def station_broken(tid: str, body: StationBroken, me: dict = Depends(get_current_user)):
    """Defekt: Die Station bekommt nichts mehr. Hält sie ein laufendes oder aufgerufenes Spiel, bleibt es dort, bis die
    Leitung es umlegt (Antwort ``holds``). „Wieder bereit“ stellt den Stand her, der zum gehaltenen Spiel passt."""
    db, tournament, _station = await _station_context(tid, body.station_id, me)
    tournament_id = tournament["id"]
    async with _tournament_lock(db, tournament_id):
        station = await db.stations.find_one({"id": body.station_id}, {"_id": 0}) or {}
        held_id = station.get("current_match_id")
        match = await db.matches_v2.find_one({"id": held_id}, {"_id": 0}) if held_id else None
        state = _held_state(match)
        issue = await _hold_issue(db, station, tournament_id)
        other = issue if issue and issue["kind"] == "other" else None
        if body.broken and other and not body.confirm_other and station.get("status") != "broken":
            raise HTTPException(status_code=409, detail=(
                f"An dieser Station spielt gerade „{other['tournament_title']}“ – trotzdem als defekt melden? "
                "Dessen Leitung bekommt Bescheid."))
        now_iso = now_utc().isoformat()
        if body.broken:
            changed = await db.stations.update_one(
                {"id": station["id"], "status": {"$ne": "broken"}},
                {"$set": {"status": "broken", "broken_at": now_iso, "updated_at": now_iso}},
            )
        else:
            status = "busy" if state == "running" else "reserved" if state == "called" else "free"
            changed = await db.stations.update_one(
                {"id": station["id"], "status": "broken"},
                {"$set": {"status": status, "updated_at": now_iso}, "$unset": {"broken_at": ""}},
            )
    holds = {"match_id": held_id, "match_key": (match or {}).get("match_key"), "state": state} if state else None
    if holds and other:
        holds["other_tournament"] = other["tournament_title"]
    if not changed.matched_count:
        return {"ok": True, "idempotent_replay": True, "holds": holds}
    reset_scope_cache()  # Live-Meldungen (#1801): wie jede Stationsänderung
    action = "station.broken" if body.broken else "station.repaired"
    data = {"station_id": station["id"], "match_id": held_id if state else None, "state": state}
    await _station_audit(db, action, tournament_id, me["id"], data)
    if other:
        # Auch im Protokoll des betroffenen Turniers - und seine Leitung erfährt es sofort.
        await _station_audit(db, action, other["tournament"]["id"], me["id"], {**data, "by_tournament_id": tournament_id})
        if body.broken:
            await _tell_other_lead(db, other, station, tournament, me["id"], now_iso)
    return {"ok": True, "idempotent_replay": False, "holds": holds}


async def _move_running(db, source: dict, target: dict, match: dict) -> None:
    """Ein laufendes Spiel wechselt die Station - Startzeit und Uhr bleiben, es geht keine Startnachricht hinaus."""
    now_iso = now_utc().isoformat()
    claimed = await db.stations.update_one(
        {"id": target["id"], "status": {"$ne": "broken"}, "deleting": {"$ne": True},
         "$or": [{"current_match_id": None}, {"current_match_id": {"$exists": False}}]},
        {"$set": {"current_match_id": match["id"], "current_match_type": "matches_v2", "status": "busy",
                  "updated_at": now_iso}, "$unset": {"called_at": ""}},
    )
    if not claimed.matched_count:
        raise HTTPException(status_code=409, detail=TARGET_TAKEN_DETAIL)
    await db.matches_v2.update_one({"id": match["id"]}, {"$set": {"station_id": target["id"], "updated_at": now_iso}})
    source_set = {"current_match_id": None, "current_match_type": None, "updated_at": now_iso}
    if source.get("status") != "broken":
        source_set["status"] = "free"
    await db.stations.update_one({"id": source["id"], "current_match_id": match["id"]},
                                 {"$set": source_set, "$unset": {"called_at": ""}})


@router.post("/{tid}/live-queue/move")
async def move_match(tid: str, body: StationMove, me: dict = Depends(get_current_user)):
    """Umlegen: ein laufendes oder aufgerufenes Spiel auf eine freie Station. Ein laufendes behält Startzeit und Uhr;
    ein aufgerufenes wird an der neuen Station aufgerufen - die Spieler bekommen „Du bist dran“ mit der neuen Station.
    Die alte Station wird frei, eine defekte bleibt defekt."""
    if body.to_station_id == body.station_id:
        raise HTTPException(status_code=422, detail="Bitte eine andere Station wählen.")
    db, tournament_id, _station = await _context(tid, body, me)
    await _station_context(tid, body.to_station_id, me)
    async with _tournament_lock(db, tournament_id):
        source, match = await _fresh(db, body.station_id, body.match_id)
        target = await db.stations.find_one({"id": body.to_station_id}, {"_id": 0}) or {}
        state = _held_state(match)
        if match.get("station_id") == target.get("id") and target.get("current_match_id") == match["id"]:
            # Doppeltipp: schon dort.
            return {"ok": True, "idempotent_replay": True, "state": state, "to": _station_name(target)}
        if source.get("current_match_id") != match["id"]:
            raise HTTPException(status_code=409, detail=HOLDS_OTHER_DETAIL)
        if state is None:
            raise HTTPException(status_code=409, detail="Umlegen geht nur für ein laufendes oder aufgerufenes Spiel.")
        if target.get("status") == "broken" or target.get("deleting"):
            raise HTTPException(status_code=409, detail="Die Zielstation ist als defekt markiert.")
        if target.get("current_match_id"):
            raise HTTPException(status_code=409, detail=TARGET_TAKEN_DETAIL)
        if state == "running":
            await _move_running(db, source, target, match)
        else:
            # Aufgerufen: an der neuen Station neu aufrufen - mit „Du bist dran“ und der neuen Station im Klartext.
            await _assign_match_to_station(db, target, match, "matches_v2", start_now=False)
    await _station_audit(db, "match.moved", tournament_id, me["id"], {
        "match_id": match["id"], "match_key": match.get("match_key"), "from_station_id": source["id"],
        "to_station_id": target["id"], "state": state,
    })
    return {"ok": True, "idempotent_replay": False, "state": state, "to": _station_name(target)}


def _station_name(station: dict) -> str:
    return station_text(station.get("name") or station.get("label"), station.get("device_type")) or "die Station"
