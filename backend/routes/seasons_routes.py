"""Jahreszeiten (#632): die öffentliche Abfrage „was ist gerade aktiv“ und der Jahreskalender.

Ohne Anmeldung, ohne personenbezogene Daten, eine Minute gecacht (ETag). Mit einem gültigen
Vorschau-Token (Admin-Seite, 60 Sekunden) rechnet der Server die gewählte Saison als aktiv - nur
für die Person, die das Token mitschickt, deshalb dann ohne Cache.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel

from auth import get_current_user, get_optional_user, require_area
from database import get_db
from models import new_id, now_utc
from services import club_birthday, founding, nikolaus, seasons, weather

router = APIRouter(prefix="/api/seasonal", tags=["seasonal"])  # /api/seasons gehört den Wettkampf-Saisonen


async def load_context(db) -> tuple[dict, str | None]:
    """Gespeicherte Saison-Einstellungen und das Gründungsdatum (Dolibarr oder Verein → Über uns, #644)."""
    stored = await db.settings.find_one({"id": seasons.SETTINGS_ID}, {"_id": 0}) or {}
    return stored, (await founding.founding(db))["founded_on"]


async def with_calendar(db, payload: dict) -> dict:
    """Adventkalender (#641): ``ready`` sagt, ob für dieses Jahr Türchen angelegt sind - ohne sie zeigen Web und
    App keinen Einstieg in einen Kalender, den es nicht gibt. In der Vorschau (#963) steht der Einstieg immer da:
    der Kalender zeigt dann Platzhalter, bis Türchen angelegt sind."""
    for season in payload.get("seasons") or []:
        if season.get("key") == "advent_calendar":
            year = int(str(season.get("starts_at") or "0000")[:4] or 0)
            ready = bool(payload.get("preview")) or bool(await db.advent_doors.find_one({"year": year}, {"_id": 0, "id": 1}))
            season["data"] = {**(season.get("data") or {}), "ready": ready}
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


async def running_season(db, key: str) -> dict | None:
    """Läuft diese Saison gerade - nach derselben Rechnung wie die öffentliche Abfrage (Admin: an, aus, erzwungen)?"""
    stored, founded = await load_context(db)
    return next((season for season in seasons.active(None, stored, founded)["seasons"] if season["key"] == key), None)


async def preview_season(db, token: str | None, key: str) -> dict | None:
    """Die Saison aus einem gültigen Vorschau-Token für genau diese Saison - sonst None."""
    preview = seasons.read_preview_token(token)
    if not preview or preview[0] != key:
        return None
    stored, founded = await load_context(db)
    payload = seasons.active(preview[1], stored, founded, preview_key=key)
    return next((season for season in payload["seasons"] if season["key"] == key), None)


async def nikolaus_season(db) -> dict | None:
    return await running_season(db, nikolaus.SEASON)


async def nikolaus_preview(db, token: str | None) -> dict | None:
    return await preview_season(db, token, nikolaus.SEASON)


@router.get("/nikolaus")
async def nikolaus_boot(response: Response, preview: str | None = Query(None), user: dict = Depends(get_current_user)):
    """Der Stiefel für diese Person (#736): da oder nicht, schon geöffnet, und welcher Sticker drin war. In der
    Vorschau steht er geschlossen da - man kann ihn so oft öffnen, wie man will."""
    response.headers["Cache-Control"] = "private, no-store"
    db = get_db()
    demo = await nikolaus_preview(db, preview)
    if demo:
        return {"active": True, "year": nikolaus.season_year(demo), "opened": False, "sticker": None, "preview": True}
    return await nikolaus.boot_state(db, user, await nikolaus_season(db))


@router.post("/nikolaus/open")
async def nikolaus_open(response: Response, preview: str | None = Query(None), user: dict = Depends(get_current_user)):
    """Den Stiefel öffnen: einmal je Person und Jahr ein Sticker aus „Vom Nikolaus“, danach derselbe noch einmal. In
    der Vorschau zeigt er den Sticker nur - vergeben und gespeichert wird nichts."""
    response.headers["Cache-Control"] = "private, no-store"
    db = get_db()
    demo = await nikolaus_preview(db, preview)
    if demo:
        return nikolaus.preview_open(user, demo)
    season = await nikolaus_season(db)
    if not season:
        raise HTTPException(status_code=409, detail="Der Nikolaus kommt am 6. Dezember.")
    return await nikolaus.open_boot(db, user, season)


@router.get("/birthday")
async def birthday_state(response: Response, preview: str | None = Query(None), user: dict = Depends(get_current_user)):
    """Der Vereinsgeburtstag für diese Person (#644): läuft er, wie viele Jahre, und - für Mitglieder - ob der
    Jahres-Sticker schon abgeholt ist. Die Vorschau zeigt den Gruß, wie ihn ein Mitglied sieht."""
    response.headers["Cache-Control"] = "private, no-store"
    db = get_db()
    demo = await preview_season(db, preview, club_birthday.SEASON)
    if demo:
        return club_birthday.preview_state(demo)
    return await club_birthday.sticker_state(db, user, await running_season(db, club_birthday.SEASON))


@router.post("/birthday/sticker")
async def birthday_sticker(response: Response, preview: str | None = Query(None), user: dict = Depends(get_current_user)):
    """Den Jahres-Sticker abholen: einmal je Vereinsmitglied und Jahr aus „Zum Vereinsgeburtstag“, danach derselbe
    noch einmal. In der Vorschau nur zeigen - vergeben und gespeichert wird nichts."""
    response.headers["Cache-Control"] = "private, no-store"
    db = get_db()
    demo = await preview_season(db, preview, club_birthday.SEASON)
    if demo:
        return club_birthday.preview_sticker(user, demo)
    if not user.get("is_club_member"):
        raise HTTPException(status_code=403, detail="Den Jahres-Sticker bekommen Vereinsmitglieder.")
    season = await running_season(db, club_birthday.SEASON)
    if not season:
        raise HTTPException(status_code=409, detail="Den Jahres-Sticker gibt es am Vereinsgeburtstag.")
    return await club_birthday.claim_sticker(db, user, season)


# ---------------------------------------------------------------- Schalter auf der eigenen Seite (#1360)
# Wer den Adventkalender oder die Ostereiersuche füllt, schaltet sie auch selbst ein - oben auf der Seite, mit Zeitraum
# und wo sie erscheint. Nur diese zwei Jahreszeiten; Deko, Wetter und alle anderen bleiben unter Auftritt → Jahreszeiten
# beim System. Jede Änderung steht im Protokoll.
SWITCHABLE_SEASONS = {"advent_calendar": "Adventkalender", "easter_hunt": "Ostereiersuche"}


class SeasonSwitchBody(BaseModel):
    enabled: bool | None = None
    channels: list[Literal["web", "app"]] | None = None


def _switchable(key: str) -> None:
    if key not in SWITCHABLE_SEASONS:
        raise HTTPException(400, "Hier lassen sich nur Adventkalender und Ostereiersuche schalten – alle anderen Jahreszeiten unter Auftritt → Jahreszeiten.")


async def _switch_view(db, key: str) -> dict:
    stored, founded = await load_context(db)
    view = seasons.admin_view(stored, founded=founded)
    row = next((season for season in view["seasons"] if season["key"] == key), {})
    return {
        "key": key, "label": SWITCHABLE_SEASONS[key], "enabled": bool(row.get("enabled")), "channels": row.get("channels") or [],
        "supported_channels": row.get("supported_channels") or list(seasons.CHANNELS), "mode": row.get("mode") or "auto", "until": row.get("until"),
        "active_now": bool(row.get("active_now")), "next_start": row.get("next_start"), "next_end": row.get("next_end"),
        "seasons_enabled": bool(view.get("enabled")),
    }


@router.get("/switch/{key}")
async def season_switch(key: str, me: dict = Depends(require_area("content", "club", "system"))):
    _switchable(key)
    return await _switch_view(get_db(), key)


@router.put("/switch/{key}")
async def update_season_switch(key: str, body: SeasonSwitchBody, me: dict = Depends(require_area("content", "club", "system"))):
    _switchable(key)
    db = get_db()
    stored = (await load_context(db))[0]
    current = seasons.merge_settings(stored)["seasons"][key]
    cfg = {**current, "texts": dict(current.get("texts") or {})}
    data = body.model_dump(exclude_unset=True)
    if data.get("enabled") is not None:
        cfg["enabled"] = bool(data["enabled"])
    if data.get("channels") is not None:
        cfg["channels"] = [channel for channel in seasons.supported_channels(key) if channel in data["channels"]]
    changed = sorted(name for name in ("enabled", "channels") if cfg.get(name) != current.get(name))
    if changed:
        await db.settings.update_one(
            {"id": seasons.SETTINGS_ID},
            {"$set": {f"seasons.{key}": {**cfg, "channels_known": list(seasons.supported_channels(key))}, "updated_at": now_utc().isoformat()},
             "$setOnInsert": {"id": seasons.SETTINGS_ID}},
            upsert=True,
        )
        await db.audit_logs.insert_one({"id": new_id(), "action": "seasons.switch", "actor_id": me["id"], "target_id": key,
                                        "data": {"changed": changed, "enabled": cfg.get("enabled"), "channels": cfg.get("channels")},
                                        "created_at": now_utc().isoformat()})
    return await _switch_view(db, key)
