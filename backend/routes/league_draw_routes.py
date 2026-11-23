"""Los auf mehrere Staffeln einer Liga N in der Verwaltung (docs/LIGA.md, „B.4 Los auf mehrere Staffeln“, #1623).

Alle unter ``/api/admin/leagues/seasons/{season_id}/draws``, Zuständigkeit ``applications`` (wie das Zuteilen im Eingang):

- ``GET …/draws``: je aktiver Liga N wer auf eine Staffel wartet, die Staffeln, der Vorschlag der Staffelzahl und das Los (Vorschau).
- ``POST …/draws/{division_id}``: auslosen - legt den Entwurf an oder gibt den vorhandenen zur selben Eingabe zurück (``replay``).
- ``POST …/draws/{division_id}/redraw`` ``{reason}``: neu auslosen mit neuem Seed.
- ``POST …/draws/{division_id}/swap`` ``{squad_id, other_squad_id, reason}``: zwei Co-Teams tauschen die Staffel.
- ``POST …/draws/{division_id}/discard`` ``{reason}``: den Entwurf verwerfen.
- ``POST …/draws/{division_id}/apply`` ``{fingerprint, confirm}``: übernehmen - erst hier entstehen Anmeldungen und Nachrichten.

Wer zu einem Team im Los gehört, bekommt 403; der Superadmin geht mit ``conflict_reason`` durch. Logik in ``services/league_draw.py``.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from database import get_db
from models import LeagueDrawRequest
from routes.tournament_registration_routes import _refresh_tournament_previews_after_registration
from services import league_draw
from services import league_service as leagues
from services.league_permissions import require_league
from services.league_service import LeagueProblem

admin_router = APIRouter(prefix="/api/admin/leagues/seasons", tags=["league-draws-admin"])

require_applications = require_league(league_draw.CAPABILITY, via="season_id")


async def _call(coroutine):
    try:
        return await coroutine
    except LeagueProblem as problem:
        raise HTTPException(status_code=problem.status, detail=problem.message) from None


async def _scope(season_id: str) -> tuple[dict, dict]:
    db = get_db()
    season = await _call(leagues.get_season(db, season_id))
    return await _call(leagues.get_league(db, season["league_id"])), season


def _body(body: LeagueDrawRequest | None) -> dict:
    return body.model_dump(exclude_none=True) if body else {}


@admin_router.get("/{season_id}/draws")
async def draw_overview(season_id: str, me: dict = Depends(require_applications)):
    _league, season = await _scope(season_id)
    return await league_draw.overview(get_db(), season, me)


@admin_router.post("/{season_id}/draws/{division_id}")
async def create_draw(season_id: str, division_id: str, body: LeagueDrawRequest | None = None, me: dict = Depends(require_applications)):
    league, season = await _scope(season_id)
    return await _call(league_draw.create(get_db(), league, season, division_id, _body(body), me))


@admin_router.post("/{season_id}/draws/{division_id}/redraw")
async def redraw(season_id: str, division_id: str, body: LeagueDrawRequest | None = None, me: dict = Depends(require_applications)):
    league, season = await _scope(season_id)
    return await _call(league_draw.redraw(get_db(), league, season, division_id, _body(body), me))


@admin_router.post("/{season_id}/draws/{division_id}/swap")
async def swap_draw(season_id: str, division_id: str, body: LeagueDrawRequest, me: dict = Depends(require_applications)):
    league, season = await _scope(season_id)
    return await _call(league_draw.swap(get_db(), league, season, division_id, _body(body), me))


@admin_router.post("/{season_id}/draws/{division_id}/discard")
async def discard_draw(season_id: str, division_id: str, body: LeagueDrawRequest | None = None, me: dict = Depends(require_applications)):
    league, season = await _scope(season_id)
    return await _call(league_draw.discard(get_db(), league, season, division_id, _body(body), me))


@admin_router.post("/{season_id}/draws/{division_id}/apply")
async def apply_draw(season_id: str, division_id: str, body: LeagueDrawRequest, me: dict = Depends(require_applications)):
    league, season = await _scope(season_id)
    return await _call(league_draw.apply(get_db(), league, season, division_id, _body(body), me,
                                         refresh_previews=_refresh_tournament_previews_after_registration))
