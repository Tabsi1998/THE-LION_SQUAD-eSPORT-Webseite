"""Liga (docs/LIGA.md, P1): Verwaltung von Liga, Season, Liga N und Staffel, dazu die öffentliche Lese-API.

- Verwaltung unter ``/api/admin/leagues``: nur Turnierleitung (``require_area("tournaments")``, mit bestätigter
  Zwei-Faktor-Anmeldung). Jede Änderung steht im Protokoll (``league.*``).
- Öffentlich unter ``/api/leagues``: Ligen, Seasons, Liga N und Staffeln (mit Turnier-Kennungen) nach der Sichtbarkeit
  der Season - ``off`` sieht niemand, ``admins`` nur die Turnierleitung, ``members`` wie „Nur Mitglieder“ bei
  Turnieren, ``public`` alle. Unsichtbar antwortet wie „gibt es nicht“ (404).

Die Logik steht in ``services/league_service.py``.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from auth import get_optional_user, require_area
from database import get_db
from models import (
    LeagueCreate,
    LeagueDivisionCreate,
    LeagueDivisionUpdate,
    LeagueSeasonCreate,
    LeagueSeasonUpdate,
    LeagueStaffelCreate,
    LeagueUpdate,
    new_id,
    now_utc,
)
from services import league_service as leagues
from services import map_pools
from services.change_events import reset_scope_cache
from services.game_maps import MapProblem
from services.league_service import LeagueProblem
from services.map_pools import MapPoolSave
from services.mutation_lock import MutationLockBusy, mutation_lock, tournament_write_resource

admin_router = APIRouter(prefix="/api/admin/leagues", tags=["leagues-admin"])
router = APIRouter(prefix="/api/leagues", tags=["leagues"])

require_league_admin = require_area("tournaments")


def _refuse(problem: LeagueProblem | MapProblem) -> HTTPException:
    return HTTPException(status_code=problem.status, detail=problem.message)


async def _audit(db, action: str, me: dict, target_id: str, data: dict | None = None) -> None:
    """Protokoll ``league.*``: wer, was, welche Felder - keine Werte aus der Anfrage."""
    await db.audit_logs.insert_one({"id": new_id(), "action": action, "actor_id": me.get("id"),
                                    "target_id": target_id, "data": data or {},
                                    "created_at": now_utc().isoformat()})


async def _call(coroutine):
    try:
        return await coroutine
    except (LeagueProblem, MapProblem) as problem:
        raise _refuse(problem) from None


# ---------------------------------------------------------------- Verwaltung: Lesen

SEASON_HEAD = ("id", "number", "name", "slug", "status", "visibility", "start_date", "weeks_total")


def _season_head(season: dict) -> dict:
    return {key: season.get(key) for key in SEASON_HEAD}


@admin_router.get("")
async def admin_list_leagues(_me: dict = Depends(require_league_admin)):
    """Alle Ligen mit ihren Seasons - der Einstieg der Verwaltung. Dazu die Spiele zur Auswahl und die Vorgaben einer
    neuen Season."""
    db = get_db()
    rows = await db.leagues.find({}, {"_id": 0}).sort("name", 1).to_list(200)
    seasons = await db.league_seasons.find({}, {"_id": 0}).sort("number", -1).to_list(2000)
    games = await db.games.find({}, {"_id": 0, "id": 1, "name": 1, "slug": 1}).sort("name", 1).to_list(500)
    names = {game["id"]: game.get("name") for game in games}
    return {
        "leagues": [{**row, "game_name": names.get(row.get("game_id")),
                     "seasons": [_season_head(season) for season in seasons if season["league_id"] == row["id"]]}
                    for row in rows],
        "games": games,
        "season_defaults": {key: value for key, value in leagues.SEASON_DEFAULTS.items()
                            if key not in ("scoring_rules",)},
    }


@admin_router.get("/seasons/{season_id}")
async def admin_season(season_id: str, _me: dict = Depends(require_league_admin)):
    """Eine Season für die Verwaltung: Vorgaben, Kalender (Wochen, Sperrwochen, größte Staffel), Map-Pool mit
    Bibliothek, Liga N mit geltenden Vorgaben und ihren Staffeln."""
    db = get_db()
    season = await _call(leagues.get_season(db, season_id))
    league = await _call(leagues.get_league(db, season["league_id"]))
    game = await db.games.find_one({"id": league.get("game_id")}, {"_id": 0}) if league.get("game_id") else None
    divisions = await db.league_divisions.find({"season_id": season_id}, {"_id": 0}).sort("level", 1).to_list(50)
    staffeln = await leagues.staffeln_of(db, season_id)
    pool = await map_pools.current(db, "league_season", season_id)
    rows = []
    for division in divisions:
        settings = leagues.effective_settings(season, division)
        rows.append({
            **division, "label": leagues.division_label(division),
            "settings": {key: settings[key] for key in leagues.OVERRIDE_FIELDS},
            "calendar": leagues.calendar_summary(season, settings),
            "staffeln": [leagues.staffel_summary(row) for row in staffeln
                         if row["league_context"].get("division_id") == division["id"]],
        })
    return {
        "league": league, "season": season, "game": map_pools.game_summary(game),
        "calendar": leagues.calendar_summary(season),
        "library": await map_pools.library(db, game),
        "map_pool": await map_pools.admin_entry(db, pool, league.get("game_id"), "league_season"),
        "divisions": rows,
    }


# ---------------------------------------------------------------- Verwaltung: Liga

@admin_router.post("")
async def admin_create_league(body: LeagueCreate, me: dict = Depends(require_league_admin)):
    db = get_db()
    doc = await _call(leagues.create_league(db, body.model_dump(), me))
    await _audit(db, "league.create", me, doc["id"], {"game_id": doc["game_id"]})
    return doc


@admin_router.patch("/{league_id}")
async def admin_update_league(league_id: str, body: LeagueUpdate, me: dict = Depends(require_league_admin)):
    db = get_db()
    league = await _call(leagues.get_league(db, league_id))
    doc, changed = await _call(leagues.update_league(db, league, body.model_dump(exclude_unset=True)))
    if changed:
        await _audit(db, "league.update", me, league_id, {"fields": changed})
    return doc


# ---------------------------------------------------------------- Verwaltung: Season

@admin_router.post("/{league_id}/seasons")
async def admin_create_season(league_id: str, body: LeagueSeasonCreate, me: dict = Depends(require_league_admin)):
    db = get_db()
    league = await _call(leagues.get_league(db, league_id))
    doc = await _call(leagues.create_season(db, league, body.model_dump(exclude_unset=True), me))
    await _audit(db, "league.season.create", me, doc["id"], {"league_id": league_id, "number": doc["number"]})
    return doc


@admin_router.patch("/seasons/{season_id}")
async def admin_update_season(season_id: str, body: LeagueSeasonUpdate, me: dict = Depends(require_league_admin)):
    db = get_db()
    season = await _call(leagues.get_season(db, season_id))
    doc, changed = await _call(leagues.update_season(db, season, body.model_dump(exclude_unset=True)))
    if changed:
        await _audit(db, "league.season.update", me, season_id, {"fields": changed})
    staffeln = await db.tournaments.count_documents({"league_context.season_id": season_id})
    # Die Staffeln tragen ihre Werte selbst: Änderungen wirken erst über „Vorgaben auf Staffeln übertragen“.
    return {**doc, "changed": changed, "staffeln_to_sync": staffeln if changed else 0}


async def _season_game(db, season: dict) -> dict | None:
    league = await _call(leagues.get_league(db, season["league_id"]))
    return await db.games.find_one({"id": league.get("game_id")}, {"_id": 0}) if league.get("game_id") else None


@admin_router.put("/seasons/{season_id}/map-pool")
async def admin_save_season_pool(season_id: str, body: MapPoolSave, me: dict = Depends(require_league_admin)):
    db = get_db()
    season = await _call(leagues.get_season(db, season_id))
    game = await _season_game(db, season)
    doc = await _call(map_pools.save(db, scope="league_season", scope_id=season_id, game=game, body=body, user=me))
    await _audit(db, "league.season.map_pool.save", me, season_id, {"version": doc["version"], "pool_id": doc["id"]})
    return map_pools.saved_view(doc, "league_season", admin=True)


@admin_router.delete("/seasons/{season_id}/map-pool")
async def admin_clear_season_pool(season_id: str, me: dict = Depends(require_league_admin)):
    db = get_db()
    await _call(leagues.get_season(db, season_id))
    doc = await _call(map_pools.clear(db, scope="league_season", scope_id=season_id, user=me))
    if doc:
        await _audit(db, "league.season.map_pool.clear", me, season_id, {"version": doc["version"]})
    return {"ok": True}


@admin_router.post("/seasons/{season_id}/sync")
async def admin_sync_season(season_id: str, me: dict = Depends(require_league_admin)):
    """„Vorgaben auf Staffeln übertragen“: je Staffel, was noch darf - der Rest kommt mit Grund zurück."""
    from routes.tournament_common import _is_tournament_locked

    db = get_db()
    season = await _call(leagues.get_season(db, season_id))
    league = await _call(leagues.get_league(db, season["league_id"]))
    divisions = {row["id"]: row for row in await db.league_divisions.find({"season_id": season_id},
                                                                          {"_id": 0}).to_list(50)}
    results = []
    for row in await leagues.staffeln_of(db, season_id):
        tournament = await db.tournaments.find_one({"id": row["id"]}, {"_id": 0})
        division = divisions.get(tournament["league_context"].get("division_id"))
        if not division:
            continue
        if _is_tournament_locked(tournament):
            results.append({"tournament_id": tournament["id"], "title": tournament.get("title"), "applied": [],
                            "changed": [], "skipped": [{"group": "all", "label": "Alles",
                                                        "reason": "Die Staffel ist gesperrt."}]})
            continue
        try:
            async with mutation_lock(db, tournament_write_resource(tournament["id"])):
                result = await leagues.sync_staffel(db, tournament, league, season, division, me)
        except MutationLockBusy:
            results.append({"tournament_id": tournament["id"], "title": tournament.get("title"), "applied": [],
                            "changed": [], "skipped": [{"group": "all", "label": "Alles",
                                                        "reason": "Die Staffel wird gerade bearbeitet - bitte "
                                                                  "gleich noch einmal."}]})
            continue
        except (LeagueProblem, MapProblem) as problem:
            raise _refuse(problem) from None
        await _audit(db, "league.staffel.sync", me, tournament["id"],
                     {"season_id": season_id, "applied": result.applied, "changed": result.changed,
                      "skipped": [item["group"] for item in result.skipped]})
        results.append(result.as_dict())
    if results:
        reset_scope_cache()
    return {"staffeln": results}


# ---------------------------------------------------------------- Verwaltung: Liga N und Staffel

@admin_router.post("/seasons/{season_id}/divisions")
async def admin_create_division(season_id: str, body: LeagueDivisionCreate,
                                me: dict = Depends(require_league_admin)):
    db = get_db()
    season = await _call(leagues.get_season(db, season_id))
    payload = body.model_dump(exclude_unset=True)
    if body.overrides is not None:
        payload["overrides"] = body.overrides.model_dump(exclude_none=True)
    doc = await _call(leagues.create_division(db, season, payload, me))
    await _audit(db, "league.division.create", me, doc["id"], {"season_id": season_id, "level": doc["level"]})
    return doc


@admin_router.patch("/divisions/{division_id}")
async def admin_update_division(division_id: str, body: LeagueDivisionUpdate,
                                me: dict = Depends(require_league_admin)):
    db = get_db()
    division = await _call(leagues.get_division(db, division_id))
    payload = body.model_dump(exclude_unset=True)
    if "overrides" in payload:
        payload["overrides"] = body.overrides.model_dump(exclude_none=True) if body.overrides else {}
    doc, changed = await _call(leagues.update_division(db, division, payload))
    if changed:
        await _audit(db, "league.division.update", me, division_id, {"fields": changed})
    return doc


@admin_router.post("/divisions/{division_id}/staffeln")
async def admin_create_staffel(division_id: str, body: LeagueStaffelCreate, me: dict = Depends(require_league_admin)):
    """Staffel anlegen: ein Liga-Turnier (Entwurf) mit allen Vorgaben - danach Co-Teams in der Turnierverwaltung
    zuteilen."""
    from routes.tournament_common import _create_initial_stage_bracket_preview

    db = get_db()
    division = await _call(leagues.get_division(db, division_id))
    doc = await _call(leagues.create_staffel(db, division, body.staffel, me))
    reset_scope_cache()
    await _create_initial_stage_bracket_preview(db, doc, me.get("id"))
    await _audit(db, "league.staffel.create", me, doc["id"],
                 {"season_id": doc["league_context"]["season_id"], "division_id": division_id,
                  "staffel": doc["league_context"]["staffel"]})
    return {"tournament_id": doc["id"], "slug": doc["slug"], "title": doc["title"],
            "staffel": doc["league_context"]["staffel"], "status": doc["status"]}


# ---------------------------------------------------------------- Öffentlich

@router.get("")
async def public_leagues(user: dict | None = Depends(get_optional_user)):
    """Ligen mit den für die Person sichtbaren Seasons - leer heißt: die Navigation zeigt „Liga“ nicht."""
    return {"leagues": await leagues.visible_leagues(get_db(), user)}


@router.get("/{league_slug}/{season_slug}")
async def public_season(league_slug: str, season_slug: str, user: dict | None = Depends(get_optional_user)):
    """Eine Season: Vorgaben, Map-Pool, Liga N mit ihren Staffeln (Turnier-Kennungen für Tabelle und Spielplan)."""
    return await _call(leagues.public_season_view(get_db(), league_slug, season_slug, user))
