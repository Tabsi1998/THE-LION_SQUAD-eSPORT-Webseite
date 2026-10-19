"""Hallen-Tafel und Aufruf-Tafel eines Events mit Anzeige-Schlüssel (#1822).

Am Event läuft der TV ohne Anmeldung. Ohne Schlüssel zeigen die Tafeln, was öffentlich ist (Event-Seite, Baum je
Turnier) - ein Turnier „Nur Mitglieder“ fehlt dort. Mit einem Event-Schlüssel aus TV & Beamer holt die Tafel hier in
einer Antwort das Event mit Tagesplan, die Stationen und je Turnier die TV-Daten wie der Turnierbaum-TV - auch für
„Nur Mitglieder“, nur die Felder, die die Tafeln zeigen (``services.tv_display``). Ohne gültigen Schlüssel: 403, nichts
weiter - dieser Weg ist kein öffentlicher Endpunkt.
"""
from fastapi import APIRouter, HTTPException

from database import get_db
from models import now_utc
from routes.tournament_view_routes import _build_bracket_payload
from services import event_days
from services.access_links import touch_access_link, validate_access_link
from services.public_phase import derive_public_phase
from services.slug_utils import find_by_slug_or_history
from services.tv_display import (
    DISPLAY_GRANT,
    KEY_EXPIRED,
    KEY_INVALID,
    display_bracket_payload,
    display_event_payload,
    key_expired,
    shown_on_event_tv,
)

router = APIRouter(prefix="/api/events", tags=["events"])


@router.get("/{slug_or_id}/display")
async def get_event_display(slug_or_id: str, key: str | None = None):
    """Die Tafeln eines Events mit Anzeige-Schlüssel - ein Schlüssel öffnet nur die TV-Daten genau dieses Events.

    Wie beim Turnierbaum-TV zählt nur der Schlüssel, auch für Angemeldete. Ein unbekanntes Event und ein falscher,
    widerrufener oder fremder Schlüssel sehen gleich aus (403): die Antwort verrät nicht, welche Events es gibt.
    """
    db = get_db()
    event, _ = await find_by_slug_or_history(db.events, slug_or_id, {"_id": 0})
    link = await validate_access_link(db, key, "event", event["id"], None, DISPLAY_GRANT) if event and key else None
    if not link:
        raise HTTPException(status_code=403, detail=KEY_INVALID)
    if key_expired(event, now_utc()):
        raise HTTPException(status_code=403, detail=KEY_EXPIRED)
    await touch_access_link(db, link)

    tournaments = [row for row in await db.tournaments.find({"event_id": event["id"]}, {"_id": 0}).to_list(200) if shown_on_event_tv(row)]
    challenges = [row for row in await db.f1_challenges.find({"event_id": event["id"]}, {"_id": 0}).to_list(200) if shown_on_event_tv(row)]
    brackets = []
    for tournament in tournaments:
        brackets.append(display_bracket_payload(await _build_bracket_payload(db, dict(tournament), None, False)))
        tournament["public_phase"] = derive_public_phase(tournament, "tournament")
    for row in (*tournaments, *challenges):
        row["event_day"] = event_days.day_of(event, row.get("start_date"))
    # Die Stationen des Events und seiner Turniere - eine Station, die an beidem hängt, nur einmal.
    station_query = {"$or": [{"event_id": event["id"]}, {"tournament_id": {"$in": [row["id"] for row in tournaments]}}]}
    stations = {row["id"]: row for row in await db.stations.find(station_query, {"_id": 0}).to_list(500) if row.get("id")}
    return display_event_payload(event, tournaments, challenges, event_days.schedule_view(event), brackets, list(stations.values()))
