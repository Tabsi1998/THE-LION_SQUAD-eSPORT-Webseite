"""Sperrliste der Ausrüstung je Season (docs/LIGA.md, C.4 #2218) - Verwaltung unter ``/api/admin/leagues/seasons/{id}/loadout-bans``.

Lesen: jede Zuständigkeit der Liga. Schreiben: Zuständigkeit ``season`` (wie der Map-Pool), unter derselben Sperre der Season wie Pool und
neue Staffel. Jede Änderung steht im Protokoll (``league.season.loadout_bans.*``). Logik in ``services/loadout_bans.py``; öffentlich
erscheint die Liste nur über die Ligaseite der Season und den Baustein im Regelwerk.
"""
from __future__ import annotations

from contextlib import nullcontext

from fastapi import APIRouter, Depends, HTTPException

from database import get_db
from models import new_id, now_utc
from services import game_equipment, game_modes, league_rules, loadout_bans
from services import league_service as leagues
from services.game_equipment import EquipmentProblem
from services.league_permissions import ANY, capabilities_of, require_league
from services.league_scope import ONLY_LEAGUE
from services.league_service import LeagueProblem
from services.loadout_bans import LoadoutBansSave
from services.mutation_lock import MutationLockBusy, game_equipment_resource, league_season_pool_resource, mutation_lock

router = APIRouter(prefix="/api/admin/leagues", tags=["leagues-admin"])
BUSY = "Die Season wird gerade bearbeitet – bitte gleich noch einmal."
BLOCK = "loadout_bans"


async def _context(db, season_id: str) -> tuple[dict, dict, dict | None]:
    try:
        season = await leagues.get_season(db, season_id)
        league = await leagues.get_league(db, season["league_id"])
    except LeagueProblem as problem:
        raise HTTPException(status_code=problem.status, detail=problem.message) from None
    game = await db.games.find_one({"id": league.get("game_id")}, {"_id": 0}) if league.get("game_id") else None
    return season, league, game


async def _audit(db, action: str, me: dict, season_id: str, data: dict) -> None:
    await db.audit_logs.insert_one({"id": new_id(), "action": action, "actor_id": me.get("id"), "target_id": season_id,
                                    "data": data, "created_at": now_utc().isoformat()})


async def _staffel_count(db, season_id: str) -> int:
    return await db.tournaments.count_documents({"league_context.season_id": season_id, **ONLY_LEAGUE})


@router.get("/seasons/{season_id}/loadout-bans")
async def season_loadout_bans(season_id: str, me: dict = Depends(require_league(ANY, via="season_id"))):
    """Alles für den Editor: Spiel mit Modi, Kategorien, die Bibliothek (aktiv und inaktiv), die geltende Version, die Versionen und ob
    das Regelwerk die Liste schon zeigt."""
    db = get_db()
    season, league, game = await _context(db, season_id)
    doc = await loadout_bans.current(db, loadout_bans.SEASON, season_id)
    categories = await game_equipment.categories_of(db, game["id"]) if game else []
    rows = await game_equipment.items_of(db, game["id"], usable_only=True, categories=categories) if game else []
    library = [{**{key: row.get(key) for key in ("id", "category", "name", "image_url", "weapon_ids")},
                # Unterkategorie und Waffenklassen (#2287): Gruppen, Klassensperre und „passt zu“ im Editor.
                "subcategory": row.get("subcategory") or None, "weapon_class_ids": list(row.get("weapon_class_ids") or []),
                "status": game_equipment.status_of(row)}
               for row in rows]
    return {
        "capabilities": sorted(await capabilities_of(db, me, league["id"])),
        "game": {"id": game["id"], "name": game.get("name"), "modes": game_modes.entries(game)} if game else None,
        "categories": categories,
        "library": library,
        "list": await loadout_bans.admin_entry(db, doc, league.get("game_id"), loadout_bans.SEASON),
        # Nr. 81 (Codex Runde 1): Aufsätze, die nach der geltenden Liste an keiner erlaubten Waffe passen - sie fehlen in der erlaubten
        # Ausrüstung, der Editor nennt sie.
        "unusable_attachments": loadout_bans.unusable_attachments(categories, rows, loadout_bans.valid_for(doc, league.get("game_id"))),
        "versions": await loadout_bans.versions(db, loadout_bans.SEASON, season_id),
        "rules": await league_rules.block_state(db, league, season, BLOCK),
        "staffeln": await _staffel_count(db, season_id),
    }


@router.put("/seasons/{season_id}/loadout-bans")
async def save_season_loadout_bans(season_id: str, body: LoadoutBansSave,
                                   me: dict = Depends(require_league("season", via="season_id"))):
    db = get_db()
    season, league, game = await _context(db, season_id)
    try:
        # Dieselbe Sperre wie Map-Pool und neue Staffel: Eine Staffel entsteht nie mitten in einem Speichern. Danach die der Bibliothek
        # (#2287): Eine ganze Klasse wird nie gespeichert, während jemand genau diese Unterkategorie entfernt.
        async with mutation_lock(db, league_season_pool_resource(season_id)):
            async with (mutation_lock(db, game_equipment_resource(game["id"])) if game else nullcontext()):
                doc = await loadout_bans.save(db, scope=loadout_bans.SEASON, scope_id=season_id, game=game, body=body, user=me)
    except MutationLockBusy:
        raise HTTPException(status_code=409, detail=BUSY) from None
    except EquipmentProblem as problem:
        raise HTTPException(status_code=problem.status, detail=problem.message) from None
    await _audit(db, "league.season.loadout_bans.save", me, season_id,
                 {"version": doc["version"], "list_id": doc["id"], "entries": len(doc["entries"])})
    return {**loadout_bans.view(doc, loadout_bans.SEASON, admin=True), "staffeln_to_sync": await _staffel_count(db, season_id),
            "rules": await league_rules.block_state(db, league, season, BLOCK)}


@router.delete("/seasons/{season_id}/loadout-bans")
async def clear_season_loadout_bans(season_id: str, me: dict = Depends(require_league("season", via="season_id"))):
    db = get_db()
    await _context(db, season_id)
    try:
        async with mutation_lock(db, league_season_pool_resource(season_id)):
            doc = await loadout_bans.clear(db, scope=loadout_bans.SEASON, scope_id=season_id, user=me)
    except MutationLockBusy:
        raise HTTPException(status_code=409, detail=BUSY) from None
    except EquipmentProblem as problem:
        raise HTTPException(status_code=problem.status, detail=problem.message) from None
    if doc:
        await _audit(db, "league.season.loadout_bans.clear", me, season_id, {"version": doc["version"]})
    return {"ok": True, "staffeln_to_sync": await _staffel_count(db, season_id) if doc else 0}


@router.get("/seasons/{season_id}/loadout-bans/compare")
async def compare_season_loadout_bans(season_id: str, base: int, target: int,
                                      _me: dict = Depends(require_league(ANY, via="season_id"))):
    """Zwei Versionen der Season gegenübergestellt: hinzu, weg, geändert."""
    db = get_db()
    await _context(db, season_id)
    docs = {}
    for number in (base, target):
        docs[number] = await db.loadout_bans.find_one({"scope": loadout_bans.SEASON, "scope_id": season_id, "version": number}, {"_id": 0})
        if not docs[number]:
            raise HTTPException(status_code=404, detail=f"Version {number} gibt es nicht.")
    return loadout_bans.compare(docs[base], docs[target])
