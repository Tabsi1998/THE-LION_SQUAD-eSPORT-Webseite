"""Ergebnistabelle je Runde und Lauf, Saison-Statistik und Teamfarben der Rennliga (#1950).

**Öffentlich** (Sichtbarkeit wie die Serienseite, nur Spuren der Art ``racing``, sonst 404):

- ``GET /api/reference-series/public/<spur>/<saison>/rounds/<nummer>`` - eine Runde als eigene Seite: Kopf mit voriger
  und nächster Runde, je Lauf ein Reiter mit der Ergebnistabelle wie beim Veranstalter, die Zusammenfassung und das
  Hauptrennen als Vorgabe. Aufbau in ``services/round_page.py``.
- ``GET /api/reference-series/public/<spur>/<saison>/statistics`` - der Reiter „Statistik“ der Serienseite: je Fahrer
  und Team die Kennzahlen, die in der Saison vorkommen (``services/season_statistics.py``).

Fremde Namen kommen nur wie in den Tabellen der Serienseite (``_people``): ein ausgeblendeter Name gar nicht, dann auch
keine Startnummer; mit ``hide_name_tags`` der Saison ohne Tag der Spielkennung (#1961). Wer außerhalb der Tabelle mit
Namen stehen darf, nennt ``club_drivers``.

**Verwaltung - Teamfarben** (je Team und Saison, für Startnummer und Teamname wie in den Veranstalter-Grafiken):

- ``GET /api/reference-series/admin/series/<id>/team-colors`` (Vorstand): die Teams der Saison (eigene Teams,
  Standard-Teams der Teilnehmer, Teams aus den Ergebnisblättern) mit Farbe und Vorschlag aus dem Ergebnis-Bild.
- ``PUT …/team-colors`` (Vorstand, unter der Sperre der Saison): ``{colors: {Team: "#rrggbb" | null}}`` ersetzt die
  Farben der Saison; leer heißt neutral.
- ``POST …/team-colors/suggestions`` (Vorstand und Captains der Saison): ``{colors: {Team: "#rrggbb"}}`` merkt sich
  den Vorschlag der Bild-Erkennung (#1756, ``team_colors``) - übernommen wird er erst in der Verwaltung.
"""
from __future__ import annotations

from typing import Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from auth import get_optional_user, require_area
from database import get_db
from models import now_utc
from routes.reference_round_routes import _calendar, visible_series
from routes.reference_series_public_routes import _people
from services import reference_series
from services.own_teams import own_team_names
from services.reference_series_access import SeriesAccess, require_series_editor
from services.round_page import clean, clean_hex, color_key, load_round
from services.season_statistics import load_statistics

router = APIRouter(prefix="/api/reference-series", tags=["reference-series"])

MAX_COLORS = 60
NOT_FOUND = "Runde nicht gefunden."


async def _racing(db, user: dict | None, lineage_slug: str, season_slug: str) -> tuple[dict, dict]:
    lineage, series = await visible_series(db, user, lineage_slug, season_slug)
    if lineage.get("kind") != "racing":
        raise HTTPException(404, "Serie nicht gefunden.")
    return lineage, series


def _head(lineage: dict, series: dict) -> dict:
    return {
        "lineage": {key: lineage.get(key) for key in ("title", "slug", "kind", "label", "organizer", "game_name")},
        "series": {key: series.get(key) for key in ("season", "tier", "title", "season_slug", "status")},
        "own_teams": own_team_names(series),
    }


@router.get("/public/{lineage_slug}/{season_slug}/rounds/{number}")
async def public_round(lineage_slug: str, season_slug: str, number: int,
                       user: dict | None = Depends(get_optional_user)):
    """Eine Runde der Rennliga mit allen Läufen - 404 für eine Runde, die es nicht gibt."""
    db = get_db()
    lineage, series = await _racing(db, user, lineage_slug, season_slug)
    calendar = await _calendar(db, series["id"])
    people = await _people(db, series["id"], hide_tags=bool(series.get("hide_name_tags")))  # #1961: wie die Serienseite
    view = await load_round(db, series, calendar["rounds"], number, people)
    if view is None:
        raise HTTPException(404, NOT_FOUND)
    return {**_head(lineage, series), "today": calendar["today"], **view}


@router.get("/public/{lineage_slug}/{season_slug}/statistics")
async def public_statistics(lineage_slug: str, season_slug: str, user: dict | None = Depends(get_optional_user)):
    """Statistik der Saison: je Fahrer und Team die Kennzahlen, die vorkommen."""
    db = get_db()
    lineage, series = await _racing(db, user, lineage_slug, season_slug)
    calendar = await _calendar(db, series["id"])
    people = await _people(db, series["id"], hide_tags=bool(series.get("hide_name_tags")))  # #1961: wie die Serienseite
    return {**_head(lineage, series), **await load_statistics(db, series, calendar["rounds"], people)}


# ---------------------------------------------------------------- Teamfarben
class TeamColorsBody(BaseModel):
    colors: Dict[str, Optional[str]] = Field(default_factory=dict)

    @field_validator("colors")
    @classmethod
    def _colors(cls, value: dict) -> dict:
        if len(value) > MAX_COLORS:
            raise ValueError(f"Höchstens {MAX_COLORS} Teams.")
        out = {}
        for team, color in value.items():
            name = clean(team)
            if not name or len(name) > 120:
                raise ValueError("Teamname mit 1 bis 120 Zeichen.")
            if color in (None, ""):
                out[name] = None
                continue
            hexed = clean_hex(color)
            if not hexed:
                raise ValueError(f"Farbe für „{name}“ als #rrggbb, etwa #29b6e8.")
            out[name] = hexed
        return out


async def _series(db, series_id: str) -> dict:
    series = await db.reference_series.find_one({"id": series_id}, {"_id": 0})
    if not series:
        raise HTTPException(404, "Serie nicht gefunden.")
    return series


async def _season_teams(db, series: dict) -> list[str]:
    """Alle Teams der Saison: eigene Teams, Standard-Teams der Teilnehmer und Teams aus den Ergebnisblättern."""
    found: dict[str, str] = {}
    for name in own_team_names(series):
        found.setdefault(color_key(name), name)
    async for person in db.reference_participants.find(
            {"series_id": series["id"], "default_team": {"$nin": [None, ""]}}, {"_id": 0, "default_team": 1}):
        found.setdefault(color_key(person["default_team"]), clean(person["default_team"]))
    async for sheet in db.reference_round_results.find({"series_id": series["id"]}, {"_id": 0, "rows.team": 1}):
        for row in sheet.get("rows") or []:
            if clean(row.get("team")):
                found.setdefault(color_key(row["team"]), clean(row["team"]))
    for name in (series.get("team_colors") or {}):
        found.setdefault(color_key(name), clean(name))
    return sorted(found.values(), key=str.casefold)


def _by_key(raw: dict | None) -> dict[str, str]:
    return {color_key(team): hexed for team, color in (raw or {}).items() if (hexed := clean_hex(color))}


async def _colors_view(db, series: dict) -> dict:
    colors = _by_key(series.get("team_colors"))
    suggestions = _by_key(series.get("team_color_suggestions"))
    own = {color_key(name) for name in own_team_names(series)}
    return {"teams": [{"team": team, "color": colors.get(color_key(team)),
                       "suggestion": suggestions.get(color_key(team)), "own": color_key(team) in own}
                      for team in await _season_teams(db, series)]}


@router.get("/admin/series/{series_id}/team-colors")
async def admin_team_colors(series_id: str, me: dict = Depends(require_area("content"))):
    db = get_db()
    return await _colors_view(db, await _series(db, series_id))


@router.put("/admin/series/{series_id}/team-colors")
@reference_series.series_locked
async def save_team_colors(series_id: str, body: TeamColorsBody, me: dict = Depends(require_area("content"))):
    db = get_db()
    await _series(db, series_id)
    colors = {team: color for team, color in body.colors.items() if color}
    await db.reference_series.update_one({"id": series_id}, {"$set": {
        "team_colors": colors, "updated_at": now_utc().isoformat(), "updated_by": me["id"]}})
    return await _colors_view(db, await _series(db, series_id))


@router.post("/admin/series/{series_id}/team-colors/suggestions")
async def suggest_team_colors(series_id: str, body: TeamColorsBody,
                              access: SeriesAccess = Depends(require_series_editor)):
    """Vorschlag aus dem Ergebnis-Bild: neue Werte ersetzen alte je Team, sonst bleibt alles."""
    db = get_db()
    series = await _series(db, series_id)
    merged = {**(series.get("team_color_suggestions") or {})}
    for team, color in body.colors.items():
        if not color:
            continue
        for existing in [name for name in merged if color_key(name) == color_key(team)]:
            merged.pop(existing)
        merged[team] = color
    # Höchstens MAX_COLORS Vorschläge - die jüngsten bleiben.
    merged = dict(list(merged.items())[-MAX_COLORS:])
    await db.reference_series.update_one({"id": series_id}, {"$set": {"team_color_suggestions": merged}})
    return {"suggestions": len(merged)}
