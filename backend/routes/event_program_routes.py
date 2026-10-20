"""Event als Klammer in der Verwaltung (#1371): der Abschnitt „Programm“ im Event - eigene Routen neben ``event_routes``.

- ``GET /api/events/{id}/program``: Turniere und Fast Laps des Events, was sich noch hinzufügen lässt, die Vorbelegung
  für Neues und die Sponsoren, die beim Event erscheinen.
- ``POST /api/events/{id}/program``: ein bestehendes Turnier oder eine Fast Lap zum Event hinzufügen.
- ``DELETE /api/events/{id}/program/{kind}/{item_id}``: wieder lösen.
- ``POST /api/events/{id}/tournaments`` und ``/fastlaps``: „+ Turnier in diesem Event“ und „+ Fast Lap“ - mit Ort, Tag,
  Partnern und Discord-Einstellungen des Events, sofern das Formular nichts anderes sagt.

Alles nur für die Turnierleitung (Bereich „Turniere“ mit Zwei-Faktor) - wie das Bearbeiten des Events selbst.
Die Regeln stehen in ``services/event_program.py``.
"""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import require_admin
from database import get_db
from models import F1ChallengeCreate, TournamentCreate, now_utc
from services import event_program
from services.change_events import reset_scope_cache
from services.slug_utils import find_by_slug_or_history

router = APIRouter(prefix="/api/events", tags=["events"])

ENDED = {"completed", "results_published", "archived", "cancelled"}
# Wer so angemeldet ist, hängt am Event (Event-Pflicht #875) - solange es solche Anmeldungen gibt, wird nicht gelöst.
ACTIVE_REGISTRATIONS = ("pending", "approved", "checked_in", "waitlist")
FREE = {"$in": [None, ""]}
ITEM_FIELDS = {"_id": 0, "id": 1, "title": 1, "slug": 1, "status": 1, "start_date": 1, "end_date": 1, "event_id": 1}


class ProgramLink(BaseModel):
    kind: Literal["tournament", "fastlap"]
    item_id: str


async def _event(event_id: str) -> dict:
    event, _ = await find_by_slug_or_history(get_db().events, event_id, {"_id": 0})
    if not event:
        raise HTTPException(404, "Event nicht gefunden.")
    return event


def _collection(db, kind: str):
    """Die Sammlung je Art - fest benannt, damit die Karte der Personendaten jeden Zugriff kennt."""
    return db.tournaments if kind == "tournament" else db.f1_challenges


def _row(item: dict) -> dict:
    return {key: item.get(key) for key in ("id", "title", "slug", "status", "start_date", "end_date")}


async def _sponsors(event: dict) -> dict:
    """Wer beim Event erscheint - aus den Angaben beim Sponsor. Eine alte Auswahl am Event gilt bis zum Aufheben."""
    from routes.event_routes import _attach_event_sponsors

    preview = {**event, "owned_by_club": True, "show_sponsors": True}
    await _attach_event_sponsors(preview)
    return {
        "items": [{"id": row.get("id"), "name": row.get("name") or ""} for row in preview.get("sponsors") or []],
        "own_choice": bool([sid for sid in event.get("sponsor_ids") or [] if sid]),
    }


@router.get("/{event_id}/program")
async def event_program_view(event_id: str, me: dict = Depends(require_admin())):
    db = get_db()
    event = await _event(event_id)
    lists = {}
    for kind in event_program.KINDS:
        own = await _collection(db, kind).find({"event_id": event["id"]}, ITEM_FIELDS).sort("start_date", 1).to_list(200)
        free = await _collection(db, kind).find(
            {"event_id": FREE, "status": {"$nin": list(ENDED)}}, ITEM_FIELDS,
        ).sort("start_date", 1).to_list(200)
        lists[kind] = ([_row(item) for item in own], [_row(item) for item in free])
    return {
        "event": {
            "id": event["id"], "name": event.get("name"), "slug": event.get("slug"),
            "start_date": event.get("start_date"), "end_date": event.get("end_date"),
            "window": event_program.window_text(event), "location": event_program.location_line(event),
        },
        "tournaments": lists["tournament"][0],
        "fastlaps": lists["fastlap"][0],
        "candidates": {"tournaments": lists["tournament"][1], "fastlaps": lists["fastlap"][1]},
        "defaults": {"tournament": event_program.tournament_defaults(event), "fastlap": event_program.fastlap_defaults(event)},
        "sponsors": await _sponsors(event),
    }


@router.post("/{event_id}/program")
async def add_to_event_program(event_id: str, body: ProgramLink, me: dict = Depends(require_admin())):
    db = get_db()
    event = await _event(event_id)
    collection = _collection(db, body.kind)
    item = await collection.find_one({"id": body.item_id}, ITEM_FIELDS)
    if not item:
        raise HTTPException(404, "Turnier nicht gefunden." if body.kind == "tournament" else "Fast Lap nicht gefunden.")
    current = item.get("event_id") or None
    if current == event["id"]:
        return {"ok": True, "item": _row(item)}
    if current:
        other = await db.events.find_one({"id": current}, {"_id": 0, "name": 1})
        name = (other or {}).get("name") or "einem anderen Event"
        raise HTTPException(409, f"Gehört schon zu „{name}“ – erst dort im Programm lösen.")
    if item.get("status") in ENDED:
        raise HTTPException(400, "Beendete, archivierte oder abgesagte Turniere und Fast Laps kommen nicht mehr ins Programm.")
    problem = event_program.fits(event, body.kind, item)
    if problem:
        raise HTTPException(400, problem)
    # Nur verbinden, solange es noch frei ist - kommen zwei Anfragen gleichzeitig, gewinnt eine, die andere hört 409.
    result = await collection.update_one(
        {"id": item["id"], "event_id": FREE, "status": {"$nin": list(ENDED)}},
        {"$set": {"event_id": event["id"], "updated_at": now_utc().isoformat()}},
    )
    if not result.matched_count:
        raise HTTPException(409, "Inzwischen gehört es schon zu einem Event – lade das Programm neu.")
    reset_scope_cache()  # Live-Meldungen (#1801): Turnier und Event neu nachschlagen
    return {"ok": True, "item": _row(item)}


@router.delete("/{event_id}/program/{kind}/{item_id}")
async def remove_from_event_program(event_id: str, kind: Literal["tournament", "fastlap"], item_id: str,
                                    me: dict = Depends(require_admin())):
    db = get_db()
    event = await _event(event_id)
    if kind == "tournament" and await db.tournament_registrations.count_documents(
        {"tournament_id": item_id, "status": {"$in": list(ACTIVE_REGISTRATIONS)}}, limit=1,
    ):
        raise HTTPException(409, "Das Turnier hat schon Anmeldungen – lösen geht erst, wenn niemand mehr angemeldet ist.")
    result = await _collection(db, kind).update_one(
        {"id": item_id, "event_id": event["id"]}, {"$set": {"event_id": None, "updated_at": now_utc().isoformat()}},
    )
    if not result.matched_count:
        raise HTTPException(404, "Gehört nicht zu diesem Event.")
    reset_scope_cache()  # Live-Meldungen (#1801): Turnier und Event neu nachschlagen
    return {"ok": True}


def _with_defaults(body: BaseModel, defaults: dict, event_id: str):
    """Was das Formular nicht ausdrücklich setzt, kommt vom Event. Neu geprüft, damit nur Gesetztes als gesetzt gilt
    (Kosten zum Beispiel prüft der Bereich Finanzen nur, wenn sie mitkommen)."""
    data = body.model_dump(exclude_unset=True)
    data.update({key: value for key, value in defaults.items() if key not in data and value is not None})
    data["event_id"] = event_id
    return type(body).model_validate(data)


@router.post("/{event_id}/tournaments")
async def create_tournament_in_event(event_id: str, body: TournamentCreate, me: dict = Depends(require_admin())):
    from routes.tournament_crud_routes import create_tournament_doc

    event = await _event(event_id)
    body = _with_defaults(body, event_program.tournament_defaults(event), event["id"])
    problem = event_program.fits(event, "tournament", body.model_dump())
    if problem:
        raise HTTPException(400, problem)
    return await create_tournament_doc(body, me)


@router.post("/{event_id}/fastlaps")
async def create_fastlap_in_event(event_id: str, body: F1ChallengeCreate, me: dict = Depends(require_admin())):
    from routes.f1_routes import create_challenge_doc

    event = await _event(event_id)
    body = _with_defaults(body, event_program.fastlap_defaults(event), event["id"])
    problem = event_program.fits(event, "fastlap", body.model_dump())
    if problem:
        raise HTTPException(400, problem)
    return await create_challenge_doc(body, me)
