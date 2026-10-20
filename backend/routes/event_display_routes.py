"""Hallen-Tafel und Aufruf-Tafel eines Events mit Anzeige-Schlüssel (#1822).

Am Event läuft der TV ohne Anmeldung. Ohne Schlüssel zeigen die Tafeln, was öffentlich ist (Event-Seite, Baum je
Turnier) - ein Turnier „Nur Mitglieder“ fehlt dort. Mit einem Event-Schlüssel aus TV & Beamer holt die Tafel hier in
einer Antwort das Event mit Tagesplan, die Stationen und je Turnier die TV-Daten wie der Turnierbaum-TV - auch für
„Nur Mitglieder“, nur die Felder, die die Tafeln zeigen (``services.tv_display``). Ohne gültigen Schlüssel: 403, nichts
weiter - dieser Weg ist kein öffentlicher Endpunkt.

Mehrere Bildschirme laden nach jeder Änderung zugleich nach: Die Antwort je Event wird kurz zwischengespeichert
(``CACHE_SECONDS``, verfällt mit jeder Änderungsmeldung), der Schlüssel aber bei jedem Abruf geprüft. Dazu ein
großzügiges Limit je Adresse und je Schlüssel.
"""
import asyncio
import hashlib
import time

from fastapi import APIRouter, HTTPException, Request

from database import get_db
from models import now_utc
from routes.tournament_view_routes import _build_bracket_payload
from services import change_events, event_days
from services.access_links import touch_access_link, validate_access_link
from services.public_phase import derive_public_phase
from services.rate_limit import enforce_rate_limit, get_client_ip
from services.slug_utils import find_by_slug_or_history
from services.tv_display import (
    DISPLAY_GRANT,
    KEY_EXPIRED,
    KEY_INVALID,
    display_bracket_payload,
    display_event_payload,
    event_on_tv,
    key_expired,
    shown_on_event_tv,
)

router = APIRouter(prefix="/api/events", tags=["events"])

# Zwischenspeicher je Event: so lange gilt eine Antwort höchstens - jede Änderungsmeldung (change_events) macht sie
# sofort ungültig. Höchstens so viele Events auf einmal.
CACHE_SECONDS = 5
CACHE_EVENTS = 64
# Großzügig: ein TV lädt nach jeder Änderung (über den Strom) und ohne Strom alle 15 s - auch mehrere Bildschirme mit
# demselben Schlüssel hinter einer Adresse in der Halle bleiben weit darunter.
RATE_LIMIT = 600
RATE_WINDOW_SECONDS = 60
RATE_MESSAGE = "Zu viele Abrufe für diesen Bildschirm. Bitte warte noch {wait}."

_cache: dict[str, tuple[float, int, dict]] = {}
_building: dict[str, asyncio.Lock] = {}


def _clock() -> float:
    return time.monotonic()


def _key_subject(key: str) -> str:
    """Der Zähler je Schlüssel nennt den Schlüssel nie - nur einen eigenen Hash davon."""
    return hashlib.sha256(f"tv-event-display:{key}".encode("utf-8")).hexdigest()[:32]


def _cached(event_id: str) -> dict | None:
    entry = _cache.get(event_id)
    if entry and entry[0] > _clock() and entry[1] == change_events.current_version():
        return entry[2]
    return None


def _remember(event_id: str, version: int, payload: dict) -> None:
    _cache.pop(event_id, None)
    while len(_cache) >= CACHE_EVENTS:
        _cache.pop(next(iter(_cache)))
    _cache[event_id] = (_clock() + CACHE_SECONDS, version, payload)


async def _build(db, event: dict) -> dict:
    tournaments = [row for row in await db.tournaments.find({"event_id": event["id"]}, {"_id": 0}).to_list(200) if shown_on_event_tv(row)]
    challenges = [row for row in await db.f1_challenges.find({"event_id": event["id"]}, {"_id": 0}).to_list(200) if shown_on_event_tv(row)]
    brackets = []
    for tournament in tournaments:
        brackets.append(display_bracket_payload(await _build_bracket_payload(db, dict(tournament), None, False)))
        tournament["public_phase"] = derive_public_phase(tournament, "tournament")
    for row in (*tournaments, *challenges):
        row["event_day"] = event_days.day_of(event, row.get("start_date"))
    # Die Stationen der gezeigten Turniere und die nur am Event - eine Station, die an beidem hängt, nur einmal. Hängt
    # eine Station an einem Turnier, entscheidet das Turnier: eines, das die Tafel nicht zeigt, nimmt sie mit hinaus.
    shown_ids = {row["id"] for row in tournaments}
    station_query = {"$or": [{"event_id": event["id"]}, {"tournament_id": {"$in": sorted(shown_ids)}}]}
    stations = {
        row["id"]: row for row in await db.stations.find(station_query, {"_id": 0}).to_list(500)
        if row.get("id") and (row["tournament_id"] in shown_ids if row.get("tournament_id") else True)
    }
    return display_event_payload(event, tournaments, challenges, event_days.schedule_view(event), brackets, list(stations.values()))


async def _payload(db, event: dict) -> dict:
    """Aus dem Zwischenspeicher oder frisch gebaut - laden mehrere Bildschirme zugleich, baut nur einer."""
    hit = _cached(event["id"])
    if hit is not None:
        return hit
    async with _building.setdefault(event["id"], asyncio.Lock()):
        hit = _cached(event["id"])
        if hit is not None:
            return hit
        # Die Nummer vor dem Bauen: kommt währenddessen eine Änderung, gilt das Gebaute schon als alt.
        version = change_events.current_version()
        payload = await _build(db, event)
        _remember(event["id"], version, payload)
        return payload


@router.get("/{slug_or_id}/display")
async def get_event_display(slug_or_id: str, request: Request, key: str | None = None):
    """Die Tafeln eines Events mit Anzeige-Schlüssel - ein Schlüssel öffnet nur die TV-Daten genau dieses Events.

    Wie beim Turnierbaum-TV zählt nur der Schlüssel, auch für Angemeldete. Ein unbekanntes Event und ein falscher,
    widerrufener oder fremder Schlüssel sehen gleich aus (403): die Antwort verrät nicht, welche Events es gibt.
    """
    await enforce_rate_limit(request, "tv_event_display_address", RATE_LIMIT, RATE_WINDOW_SECONDS, subject=get_client_ip(request),
                             message=RATE_MESSAGE)
    if key:
        await enforce_rate_limit(request, "tv_event_display_key", RATE_LIMIT, RATE_WINDOW_SECONDS, subject=_key_subject(key),
                                 message=RATE_MESSAGE)
    db = get_db()
    event, _ = await find_by_slug_or_history(db.events, slug_or_id, {"_id": 0})
    link = await validate_access_link(db, key, "event", event["id"], None, DISPLAY_GRANT) if event and key else None
    # Wie die Event-Seite: ein Entwurf oder ein internes Event zeigt die Tafel nie - auch mit Schlüssel nicht.
    if not link or not event_on_tv(event):
        raise HTTPException(status_code=403, detail=KEY_INVALID)
    if key_expired(event, now_utc()):
        raise HTTPException(status_code=403, detail=KEY_EXPIRED)
    await touch_access_link(db, link)
    return await _payload(db, event)
