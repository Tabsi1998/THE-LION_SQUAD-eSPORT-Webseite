"""Selbstanmeldung in der Liga (docs/LIGA.md, Abschnitt 12, B.4, #2205).

- Unter ``/api/leagues/{liga}/{season}``: die eigene Sicht, Einreichen und Zurückziehen. Sichtbar nach der Season, unsichtbar heißt 404.
- ``/api/me/league-applications``: der Stand der eigenen Co-Teams für die Team-Seite.
- ``/api/admin/leagues/seasons/{id}/applications``: der Eingang der Leitung. Zuständigkeit ``applications``, die Liga kommt aus der gespeicherten Season.

Die Logik steht in ``services/league_applications.py``.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from auth import get_current_user
from database import get_db
from models import LeagueApplicationDecision, LeagueApplicationSubmit
from routes.tournament_registration_routes import _refresh_tournament_previews_after_registration
from services import league_applications as applications
from services import league_service as leagues
from services.league_permissions import require_league
from services.league_service import LeagueProblem

router = APIRouter(prefix="/api/leagues", tags=["league-applications"])
me_router = APIRouter(prefix="/api/me", tags=["league-applications"])
admin_router = APIRouter(prefix="/api/admin/leagues/seasons", tags=["league-applications-admin"])


async def _call(coroutine):
    try:
        return await coroutine
    except LeagueProblem as problem:
        raise HTTPException(status_code=problem.status, detail=problem.message) from None


async def _visible(league_slug: str, season_slug: str, user: dict) -> tuple[dict, dict]:
    return await _call(leagues.visible_season(get_db(), league_slug, season_slug, user))


async def _scope(season_id: str) -> tuple[dict, dict]:
    db = get_db()
    season = await _call(leagues.get_season(db, season_id))
    return await _call(leagues.get_league(db, season["league_id"])), season


def _answer(application: dict) -> dict:
    return {key: value for key, value in application.items() if key != "_id"}


@router.get("/{league_slug}/{season_slug}/application")
async def my_application_page(league_slug: str, season_slug: str, me: dict = Depends(get_current_user)):
    league, season = await _visible(league_slug, season_slug, me)
    return await applications.my_view(get_db(), league, season, me)


@router.post("/{league_slug}/{season_slug}/applications")
async def submit_application(league_slug: str, season_slug: str, body: LeagueApplicationSubmit, me: dict = Depends(get_current_user)):
    league, season = await _visible(league_slug, season_slug, me)
    done = await _call(applications.submit(get_db(), league, season, body.model_dump(), me, refresh_previews=_refresh_tournament_previews_after_registration))
    return await applications.team_answer(get_db(), done)


@router.post("/{league_slug}/{season_slug}/applications/{application_id}/withdraw")
async def withdraw_application(league_slug: str, season_slug: str, application_id: str, me: dict = Depends(get_current_user)):
    league, season = await _visible(league_slug, season_slug, me)
    done = await _call(applications.withdraw(get_db(), league, season, application_id, me, refresh_previews=_refresh_tournament_previews_after_registration))
    return await applications.team_answer(get_db(), done)


@me_router.get("/league-applications")
async def my_league_applications(me: dict = Depends(get_current_user)):
    return {"items": await applications.my_applications(get_db(), me)}


require_applications = require_league("applications", via="season_id")


@admin_router.get("/{season_id}/applications")
async def application_inbox(season_id: str, me: dict = Depends(require_applications)):
    league, season = await _scope(season_id)
    return await applications.inbox(get_db(), league, season, me)


@admin_router.post("/{season_id}/applications/{application_id}/review")
async def review_application(season_id: str, application_id: str, body: LeagueApplicationDecision | None = None,
                             me: dict = Depends(require_applications)):
    league, season = await _scope(season_id)
    return _answer(await _call(applications.review(get_db(), league, season, application_id, me,
                                                  conflict_reason=body.conflict_reason if body else None)))


@admin_router.post("/{season_id}/applications/{application_id}/accept")
async def accept_application(season_id: str, application_id: str, body: LeagueApplicationDecision, me: dict = Depends(require_applications)):
    league, season = await _scope(season_id)
    return _answer(await _call(applications.accept(get_db(), league, season, application_id, body.tournament_id, me,
                                                  refresh_previews=_refresh_tournament_previews_after_registration,
                                                  conflict_reason=body.conflict_reason)))


@admin_router.post("/{season_id}/applications/{application_id}/reject")
async def reject_application(season_id: str, application_id: str, body: LeagueApplicationDecision, me: dict = Depends(require_applications)):
    league, season = await _scope(season_id)
    return _answer(await _call(applications.reject(get_db(), league, season, application_id, body.reason, me, conflict_reason=body.conflict_reason,
                                                  refresh_previews=_refresh_tournament_previews_after_registration)))


@admin_router.post("/{season_id}/applications/{application_id}/waitlist")
async def waitlist_application(season_id: str, application_id: str, body: LeagueApplicationDecision, me: dict = Depends(require_applications)):
    league, season = await _scope(season_id)
    return _answer(await _call(applications.waitlist(get_db(), league, season, application_id, body.reason, me, conflict_reason=body.conflict_reason,
                                                    refresh_previews=_refresh_tournament_previews_after_registration)))


@admin_router.post("/{season_id}/applications/{application_id}/assign")
async def assign_application(season_id: str, application_id: str, body: LeagueApplicationDecision, me: dict = Depends(require_applications)):
    league, season = await _scope(season_id)
    return _answer(await _call(applications.assign(get_db(), league, season, application_id, body.tournament_id, me,
                                                  refresh_previews=_refresh_tournament_previews_after_registration,
                                                  conflict_reason=body.conflict_reason)))
