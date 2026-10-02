"""Jahreszeiten (#632): die öffentliche Abfrage „was ist gerade aktiv“ und der Jahreskalender.

Ohne Anmeldung, ohne personenbezogene Daten, eine Minute gecacht (ETag). Mit einem gültigen
Vorschau-Token (Admin-Seite, 60 Sekunden) rechnet der Server die gewählte Saison als aktiv - nur
für die Person, die das Token mitschickt, deshalb dann ohne Cache.
"""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response

from auth import get_current_user, get_optional_user
from database import get_db
from services import nikolaus, seasons, weather

router = APIRouter(prefix="/api/seasonal", tags=["seasonal"])  # /api/seasons gehört den Wettkampf-Saisonen
ABOUT_SETTINGS_ID = "about_page"


async def load_context(db) -> tuple[dict, str | None]:
    """Gespeicherte Saison-Einstellungen und das Gründungsdatum aus Verein → Über uns."""
    stored = await db.settings.find_one({"id": seasons.SETTINGS_ID}, {"_id": 0}) or {}
    about = await db.settings.find_one({"id": ABOUT_SETTINGS_ID}, {"_id": 0, "founded_on": 1}) or {}
    return stored, about.get("founded_on")


async def with_calendar(db, payload: dict) -> dict:
    """Adventkalender (#641): ``ready`` sagt, ob für dieses Jahr Türchen angelegt sind - ohne sie zeigen Web und
    App keinen Einstieg in einen Kalender, den es nicht gibt."""
    for season in payload.get("seasons") or []:
        if season.get("key") == "advent_calendar":
            year = int(str(season.get("starts_at") or "0000")[:4] or 0)
            season["data"] = {**(season.get("data") or {}), "ready": bool(await db.advent_doors.find_one({"year": year}, {"_id": 0, "id": 1}))}
    return payload


@router.get("/active")
async def active_seasons(request: Request, response: Response, preview: str | None = Query(None)):
    db = get_db()
    stored, founded = await load_context(db)
    cache, location = await weather.load(db)
    token = seasons.read_preview_token(preview)
    if token:
        key, at_time = token
        conditions = weather.current(cache, location, at_time)
        if key == "weather":
            # Die Vorschau soll auch an einem trockenen Tag etwas zeigen: ein Gewitterregen, nur für diese Person.
            conditions = weather.demo(conditions)
        payload = await with_calendar(db, seasons.active(at_time, stored, founded, preview_key=key, night=conditions["night"]))
        payload["weather"] = conditions
        response.headers["Cache-Control"] = "no-store"
        return payload
    # Nacht nach der echten Sonne, Wind und Niederschlag vom Vereinsort (#666) - alles ohne Anmeldung, ohne Personenbezug.
    conditions = weather.current(cache, location)
    payload = await with_calendar(db, seasons.active(None, stored, founded, night=conditions["night"]))
    payload["weather"] = conditions
    # Silvester um Mitternacht (#741): Countdown und Show rechnen mit `now` - eine Minute alter Zwischenspeicher wäre
    # dann eine Minute falsch. In diesen Phasen kein Cache und kein ETag.
    if any(season["key"] == "new_year" and season["phase"] in seasons.NEW_YEAR_LIVE_PHASES for season in payload["seasons"]):
        response.headers["Cache-Control"] = "no-store"
        return payload
    # Die Sekunde in „now“ würde jeden ETag brechen; für den Vergleich zählt nur, was gezeigt wird.
    etag = seasons.etag_for({k: v for k, v in payload.items() if k != "now"})
    response.headers["ETag"] = etag
    response.headers["Cache-Control"] = "public, max-age=60"
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag, "Cache-Control": "public, max-age=60"})
    return payload


@router.get("/calendar")
async def seasons_calendar(response: Response, year: int | None = Query(None, ge=2000, le=2100)):
    db = get_db()
    _stored, founded = await load_context(db)
    year = year or datetime.now(tz=seasons.VIENNA).year
    response.headers["Cache-Control"] = "public, max-age=3600"
    return {"year": year, "items": seasons.calendar(year, founded)}


@router.get("/me")
async def seasonal_me(response: Response, user: dict | None = Depends(get_optional_user)):
    """Was die Saison für diese Person darf (#680): Jumpscares nur ab 18 mit Geburtsdatum im Profil. Persönlich,
    deshalb nie gecacht; ohne Anmeldung nichts."""
    response.headers["Cache-Control"] = "private, no-store"
    if not user or not user.get("id"):
        return {"scares_allowed": False}
    # Das Geburtsdatum frisch aus der Datenbank - der angemeldete Nutzer aus dem Token trägt es nicht immer mit.
    stored = await get_db().users.find_one({"id": user["id"]}, {"_id": 0, "birth_date": 1}) or {}
    return {"scares_allowed": seasons.adult_from_birth_date(stored.get("birth_date") or user.get("birth_date"))}


async def nikolaus_season(db) -> dict | None:
    """Läuft der Nikolaus gerade - nach derselben Rechnung wie die öffentliche Abfrage (Admin: an, aus, erzwungen)?"""
    stored, founded = await load_context(db)
    return next((season for season in seasons.active(None, stored, founded)["seasons"] if season["key"] == nikolaus.SEASON), None)


@router.get("/nikolaus")
async def nikolaus_boot(response: Response, user: dict = Depends(get_current_user)):
    """Der Stiefel für diese Person (#736): da oder nicht, schon geöffnet, und welcher Sticker drin war."""
    response.headers["Cache-Control"] = "private, no-store"
    db = get_db()
    return await nikolaus.boot_state(db, user, await nikolaus_season(db))


@router.post("/nikolaus/open")
async def nikolaus_open(response: Response, user: dict = Depends(get_current_user)):
    """Den Stiefel öffnen: einmal je Person und Jahr ein Sticker aus „Vom Nikolaus“, danach derselbe noch einmal."""
    response.headers["Cache-Control"] = "private, no-store"
    db = get_db()
    season = await nikolaus_season(db)
    if not season:
        raise HTTPException(status_code=409, detail="Der Nikolaus kommt am 6. Dezember.")
    return await nikolaus.open_boot(db, user, season)
