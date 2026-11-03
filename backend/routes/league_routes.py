"""Liga (docs/LIGA.md, P1): Verwaltung von Liga, Season, Liga N und Staffel, dazu die öffentliche Lese-API.

- Verwaltung unter ``/api/admin/leagues``: Bereich Ligen oder die passende Zuständigkeit dieser Liga
  (``services/league_permissions.py``, Rechte-Matrix in docs/LIGA.md), mit bestätigter Zwei-Faktor-Anmeldung. Jede Änderung
  steht im Protokoll (``league.*``).
- Öffentlich unter ``/api/leagues``: Ligen, Seasons, Liga N und Staffeln (mit Turnier-Kennungen) nach der Sichtbarkeit
  der Season - ``off`` sieht niemand, ``admins`` nur wer Liga-Rechte hat, ``members`` wie „Nur Mitglieder“ bei
  Turnieren, ``public`` alle. Unsichtbar antwortet wie „gibt es nicht“ (404).

Die Logik steht in ``services/league_service.py``.
"""
from __future__ import annotations

from contextlib import AsyncExitStack

from fastapi import APIRouter, Depends, HTTPException
from pymongo.errors import DuplicateKeyError

from auth import get_optional_user, require_area
from database import get_db
from models import (
    LeagueCreate,
    LeagueDelete,
    LeagueDivisionCreate,
    LeagueDivisionUpdate,
    LeagueMapRemove,
    LeagueSeasonCreate,
    LeagueSeasonUpdate,
    LeagueStaffUpdate,
    LeagueStaffelCreate,
    LeagueUpdate,
    new_id,
    now_utc,
)
from services import game_maps
from services import league_applications
from services import league_look
from services import league_platform
from services import league_pool_check
from services import league_readiness
from services import league_service as leagues
from services.league_permissions import (
    ANY,
    CAPABILITIES,
    CAPABILITY_LABELS,
    NO_LEAGUE_RIGHT,
    capabilities_of,
    clean_capabilities,
    has_leagues_area,
    require_any_league,
    require_league,
    staffed_league_ids,
)
from services import map_pools
from services.change_events import reset_scope_cache
from services.game_maps import MapProblem
from services.league_scope import ONLY_LEAGUE
from services.league_service import LeagueProblem
from services.map_pools import MapPoolSave
from services.mutation_lock import MutationLockBusy, league_season_pool_resource, mutation_lock, tournament_write_resource

admin_router = APIRouter(prefix="/api/admin/leagues", tags=["leagues-admin"])
router = APIRouter(prefix="/api/leagues", tags=["leagues"])

# Bereich Ligen: Liga anlegen und löschen; alles andere prüft ``require_league`` gegen die Liga aus der Adresse.
require_leagues_area = require_area("leagues")


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
async def admin_list_leagues(me: dict = Depends(require_any_league)):
    """Die Ligen dieser Person mit ihren Seasons - mit dem Bereich alle, sonst die, in denen sie zuständig ist. Dazu die Spiele
    zur Auswahl und die Vorgaben einer neuen Season. Je Liga ``capabilities``: Danach richten sich die Knöpfe."""
    db = get_db()
    area = has_leagues_area(me)
    only = {} if area else {"id": {"$in": sorted(await staffed_league_ids(db, me))}}
    rows = await db.leagues.find(only, {"_id": 0}).sort("name", 1).to_list(200)
    seasons = await db.league_seasons.find({} if area else {"league_id": only["id"]}, {"_id": 0}).sort("number", -1).to_list(2000)
    games = await db.games.find({}, {"_id": 0, "id": 1, "name": 1, "slug": 1, "status": 1}).sort("name", 1).to_list(500)
    names = {game["id"]: game.get("name") for game in games}
    return {
        "can_create": area,
        "leagues": [{**row, "game_name": names.get(row.get("game_id")),
                     "capabilities": sorted(await capabilities_of(db, me, row["id"])),
                     # Bearbeiten (#2106): Spiel nur ohne Staffel, Adresse nur vor der ersten Veröffentlichung.
                     **await leagues.league_admin_flags(db, row),
                     "seasons": [_season_head(season) for season in seasons if season["league_id"] == row["id"]]}
                    for row in rows],
        "games": games,
        "season_defaults": {key: value for key, value in leagues.new_season_settings({}).items()
                            if key not in ("scoring_rules",)},
    }


@admin_router.get("/seasons/{season_id}")
async def admin_season(season_id: str, me: dict = Depends(require_league(ANY, via="season_id"))):
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
        "capabilities": sorted(await capabilities_of(db, me, league["id"])),
        "league": league, "season": season, "game": map_pools.game_summary(game),
        # Gestaltung (#2107): was die Ligaseite zeigt - für die Vorschau mit dem Erbe der Liga.
        "look": league_look.effective(league, season),
        "calendar": leagues.calendar_summary(season),
        "library": await map_pools.library(db, game),
        "default_pool": await map_pools.default_pool(db, game),
        "map_pool": await map_pools.admin_entry(db, pool, league.get("game_id"), "league_season"),
        "divisions": rows,
    }


# ---------------------------------------------------------------- Verwaltung: Liga

@admin_router.post("")
async def admin_create_league(body: LeagueCreate, me: dict = Depends(require_leagues_area)):
    db = get_db()
    doc = await _call(leagues.create_league(db, body.model_dump(), me))
    await _audit(db, "league.create", me, doc["id"], {"game_id": doc["game_id"]})
    return doc


@admin_router.patch("/{league_id}")
async def admin_update_league(league_id: str, body: LeagueUpdate, me: dict = Depends(require_league("manage"))):
    db = get_db()
    league = await _call(leagues.get_league(db, league_id))
    doc, changed = await _call(leagues.update_league(db, league, body.model_dump(exclude_unset=True)))
    if changed:
        await _audit(db, "league.update", me, league_id, {"fields": changed})
    return {**doc, "changed": changed, **await leagues.league_admin_flags(db, doc)}


# ---------------------------------------------------------------- Verwaltung: Zuständige (#2203)

def _staff_view(row: dict, person: dict | None) -> dict:
    return {"user_id": row["user_id"], "capabilities": clean_capabilities(row.get("capabilities")),
            "display_name": (person or {}).get("display_name") or (person or {}).get("username") or "Unbekannt",
            "username": (person or {}).get("username"), "avatar_url": (person or {}).get("avatar_url"),
            # Zuständige brauchen Zwei-Faktor: Die Verwaltung sagt, wenn sie noch fehlt.
            "second_factor": bool((person or {}).get("mfa_enabled")),
            "updated_at": row.get("updated_at") or row.get("created_at")}


PERSON_FIELDS = {"_id": 0, "id": 1, "display_name": 1, "username": 1, "avatar_url": 1, "mfa_enabled": 1, "is_banned": 1, "is_active": 1}


@admin_router.get("/{league_id}/staff")
async def admin_league_staff(league_id: str, me: dict = Depends(require_league("manage"))):
    """Die Zuständigen dieser Liga. Lesen darf auch „Liga verwalten“, vergeben nur der Bereich (``can_grant``)."""
    db = get_db()
    await _call(leagues.get_league(db, league_id))
    rows = await db.league_staff.find({"league_id": league_id}, {"_id": 0}).to_list(500)
    ids = sorted({row["user_id"] for row in rows})
    people = {person["id"]: person for person in await db.users.find({"id": {"$in": ids}}, PERSON_FIELDS).to_list(len(ids) + 1)}
    views = [_staff_view(row, people.get(row["user_id"])) for row in rows]
    return {"staff": sorted(views, key=lambda row: str(row["display_name"]).casefold()), "can_grant": has_leagues_area(me),
            "capabilities": [{"key": key, "label": CAPABILITY_LABELS[key]} for key in CAPABILITIES]}


async def _tell_staff_change(db, user_id: str, me: dict, league: dict, sentence: str) -> None:
    from services.rights_notices import tell_rights_change

    if user_id != me.get("id"):
        await tell_rights_change(db, user_id, f"{sentence} (Liga „{league.get('name')}“)", set(), set())


def _capability_words(capabilities: list[str]) -> str:
    return ", ".join(CAPABILITY_LABELS[key] for key in capabilities)


@admin_router.put("/{league_id}/staff/{user_id}")
async def admin_set_league_staff(league_id: str, user_id: str, body: LeagueStaffUpdate, me: dict = Depends(require_leagues_area)):
    """Zuständigkeiten einer Person in dieser Liga setzen - mit Protokoll, die Person bekommt eine Meldung."""
    db = get_db()
    league = await _call(leagues.get_league(db, league_id))
    unknown = sorted(set(body.capabilities) - set(CAPABILITIES))
    if unknown:
        raise HTTPException(status_code=422, detail="Unbekannte Zuständigkeit.")
    capabilities = clean_capabilities(body.capabilities)
    if not capabilities:
        raise HTTPException(status_code=422, detail="Bitte mindestens eine Zuständigkeit wählen - oder die Person entfernen.")
    person = await db.users.find_one({"id": user_id}, PERSON_FIELDS)
    if not person or person.get("is_active") is False or person.get("is_banned"):
        raise HTTPException(status_code=404, detail="Dieses Konto gibt es nicht oder es ist gesperrt.")
    now = now_utc().isoformat()
    before = await db.league_staff.find_one({"league_id": league_id, "user_id": user_id}, {"_id": 0})
    if before and clean_capabilities(before.get("capabilities")) == capabilities:
        return {**_staff_view(before, person), "idempotent_replay": True}
    try:
        await db.league_staff.update_one(
            {"league_id": league_id, "user_id": user_id},
            {"$set": {"capabilities": capabilities, "updated_at": now, "updated_by": me.get("id")},
             "$setOnInsert": {"id": new_id(), "created_at": now, "created_by": me.get("id")}},
            upsert=True)
    except DuplicateKeyError:
        # Zwei Vergaben gleichzeitig: Die zweite setzt die Zuständigkeiten auf die schon angelegte Zeile.
        await db.league_staff.update_one({"league_id": league_id, "user_id": user_id},
                                          {"$set": {"capabilities": capabilities, "updated_at": now, "updated_by": me.get("id")}})
    previous = clean_capabilities((before or {}).get("capabilities"))
    await _audit(db, "league.staff.update" if before else "league.staff.grant", me, league_id,
                 {"user_id": user_id, "capabilities": capabilities, "from": previous})
    await _tell_staff_change(db, user_id, me, league, f"Du bist jetzt zuständig für: {_capability_words(capabilities)}.")
    row = await db.league_staff.find_one({"league_id": league_id, "user_id": user_id}, {"_id": 0})
    return {**_staff_view(row, person), "idempotent_replay": False}


@admin_router.delete("/{league_id}/staff/{user_id}")
async def admin_remove_league_staff(league_id: str, user_id: str, me: dict = Depends(require_leagues_area)):
    db = get_db()
    league = await _call(leagues.get_league(db, league_id))
    before = await db.league_staff.find_one_and_delete({"league_id": league_id, "user_id": user_id}, projection={"_id": 0})
    if not before:
        return {"ok": True, "idempotent_replay": True}
    await _audit(db, "league.staff.revoke", me, league_id,
                 {"user_id": user_id, "from": clean_capabilities(before.get("capabilities"))})
    await _tell_staff_change(db, user_id, me, league, "Du bist hier nicht mehr zuständig.")
    return {"ok": True, "idempotent_replay": False}


# ---------------------------------------------------------------- Verwaltung: Löschen (#2106)

async def _delete_target(db, kind: str, target_id: str) -> dict:
    loader = {"league": leagues.get_league, "season": leagues.get_season, "division": leagues.get_division}[kind]
    return await _call(loader(db, target_id))


async def _delete_plan(kind: str, target_id: str) -> dict:
    db = get_db()
    return await _call(leagues.deletion_plan(db, kind, await _delete_target(db, kind, target_id)))


async def _delete(kind: str, target_id: str, body: LeagueDelete, me: dict) -> dict:
    """Löschen mit Grund: erst prüfen (sonst 409 „Archivieren statt löschen“), dann samt leerer Entwurfs-Staffeln
    löschen und protokollieren - mit den Kennungen dessen, was mitging."""
    db = get_db()
    reason = _reason(body)
    target = await _delete_target(db, kind, target_id)
    action = {"league": "league.delete", "season": "league.season.delete", "division": "league.division.delete"}[kind]

    async def staffel_deleted(row: dict) -> None:
        # Jede Staffel einzeln (Review #2106) - auch wenn das Löschen darüber danach abbricht.
        await _audit(db, "league.staffel.delete", me, row["tournament_id"], {
            "reason": reason, "title": row.get("title"), "staffel": row.get("staffel"), "with": action,
            "with_id": target_id})

    try:
        plan = await _call(leagues.delete_tree(db, kind, target, on_staffel_deleted=staffel_deleted))
    finally:
        reset_scope_cache()
    if kind == "league":
        # Mit der Liga enden ihre Zuständigkeiten - sonst hätte niemand mehr den Weg, sie zu entfernen.
        await db.league_staff.delete_many({"league_id": target_id})
    await _audit(db, action, me, target_id, {
        "reason": reason, "name": plan["name"],
        "seasons": [row["id"] for row in plan["seasons"]], "divisions": [row["id"] for row in plan["divisions"]],
        "staffeln": [row["tournament_id"] for row in plan["staffeln"]],
        **({"league_id": target.get("league_id")} if kind != "league" else {}),
    })
    return {"ok": True, "deleted": plan}


def _reason(body: LeagueDelete) -> str:
    try:
        return leagues.delete_reason(body.reason)
    except LeagueProblem as problem:
        raise _refuse(problem) from None


@admin_router.get("/{league_id}/delete-plan")
async def admin_league_delete_plan(league_id: str, _me: dict = Depends(require_leagues_area)):
    """Was mit der Liga ginge - oder warum sie archiviert statt gelöscht wird."""
    return await _delete_plan("league", league_id)


@admin_router.delete("/{league_id}")
async def admin_delete_league(league_id: str, body: LeagueDelete, me: dict = Depends(require_leagues_area)):
    return await _delete("league", league_id, body, me)


# ---------------------------------------------------------------- Verwaltung: Season

def _readiness_gate(db, league: dict, before: dict | None, me: dict, reason, passed: dict):
    """Prüfung vor der Veröffentlichung (#2207) als Schritt vor dem Schreiben - merkt sich eine Notausnahme fürs Protokoll."""
    async def check(after: dict) -> None:
        try:
            override = await league_readiness.gate(db, league, before, after, me, reason)
        except league_readiness.ReadinessBlocked as blocked:
            raise LeagueProblem(blocked.message, blocked.status) from None
        if override:
            passed.update(override)
    return check


async def _record_readiness_override(db, me: dict, season_id: str, passed: dict) -> None:
    if passed:
        await _audit(db, "league.season.readiness_override", me, season_id,
                     {"reason": passed["reason"], "problems": passed["codes"]})


@admin_router.post("/{league_id}/seasons")
async def admin_create_season(league_id: str, body: LeagueSeasonCreate, me: dict = Depends(require_league("manage"))):
    db = get_db()
    league = await _call(leagues.get_league(db, league_id))
    payload = body.model_dump(exclude_unset=True)
    reason = payload.pop("readiness_override_reason", None)
    passed: dict = {}
    doc = await _call(leagues.create_season(db, league, payload, me,
                                            before_write=_readiness_gate(db, league, None, me, reason, passed)))
    await _audit(db, "league.season.create", me, doc["id"], {"league_id": league_id, "number": doc["number"]})
    await _record_readiness_override(db, me, doc["id"], passed)
    await leagues.mark_published(db, league_id, doc.get("visibility"))
    return doc


@admin_router.patch("/seasons/{season_id}")
async def admin_update_season(season_id: str, body: LeagueSeasonUpdate,
                              me: dict = Depends(require_league(("season", "rules"), via="season_id"))):
    db = get_db()
    season = await _call(leagues.get_season(db, season_id))
    payload = body.model_dump(exclude_unset=True)
    reason = payload.pop("readiness_override_reason", None)
    # Der Regeltext gehört „Regeln veröffentlichen“, alles andere „Season konfigurieren“.
    capabilities = await capabilities_of(db, me, season["league_id"])
    if ("rules" if "rules_text" in payload else "season") not in capabilities or (set(payload) - {"rules_text"} and "season" not in capabilities):
        raise HTTPException(status_code=403, detail=NO_LEAGUE_RIGHT)
    league = await _call(leagues.get_league(db, season["league_id"]))
    passed: dict = {}
    warnings: list[str] = []
    doc, changed = await _call(leagues.update_season(db, season, payload, warnings=warnings,
                                                     before_write=_readiness_gate(db, league, season, me, reason, passed)))
    await _record_readiness_override(db, me, season_id, passed)
    if changed:
        await _audit(db, "league.season.update", me, season_id, {"fields": changed})
    visibility_applied = 0
    if "visibility" in changed:
        # „Aus“ heißt sofort aus: die Sichtbarkeit geht ohne „Übertragen“ auf alle Staffeln, auch gesperrte.
        visibility_applied = await leagues.apply_visibility(db, doc)
        await leagues.mark_published(db, season["league_id"], doc.get("visibility"))
        reset_scope_cache()
        await _audit(db, "league.staffel.sync", me, season_id,
                     {"season_id": season_id, "visibility": doc.get("visibility"), "staffeln": visibility_applied})
    staffeln = await db.tournaments.count_documents({"league_context.season_id": season_id, **ONLY_LEAGUE})
    # Alle übrigen Werte tragen die Staffeln selbst: sie wirken erst über „Vorgaben auf Staffeln übertragen“.
    needs_sync = bool(set(changed) & leagues.STAFFEL_SOURCE_FIELDS)
    return {**doc, "changed": changed, "staffeln_to_sync": staffeln if needs_sync else 0,
            "visibility_applied": visibility_applied, "warnings": warnings}


@admin_router.get("/seasons/{season_id}/delete-plan")
async def admin_season_delete_plan(season_id: str, _me: dict = Depends(require_league("manage", via="season_id"))):
    return await _delete_plan("season", season_id)


@admin_router.delete("/seasons/{season_id}")
async def admin_delete_season(season_id: str, body: LeagueDelete, me: dict = Depends(require_league("manage", via="season_id"))):
    """Season löschen (#2106): nur als Entwurf, ohne Staffel mit Co-Teams oder Spielen - leere Entwürfe gehen mit."""
    return await _delete("season", season_id, body, me)


async def _season_game(db, season: dict) -> dict | None:
    league = await _call(leagues.get_league(db, season["league_id"]))
    return await db.games.find_one({"id": league.get("game_id")}, {"_id": 0}) if league.get("game_id") else None


@admin_router.put("/seasons/{season_id}/map-pool")
async def admin_save_season_pool(season_id: str, body: MapPoolSave, me: dict = Depends(require_league("season", via="season_id"))):
    db = get_db()
    season = await _call(leagues.get_season(db, season_id))
    game = await _season_game(db, season)
    # Nennt „Modus je Map“ einen Modus, der im neuen Pool fehlt, wäre für neue Spiele keine Meldung passend (#2129).
    chosen = {group.mode for group in body.modes if group.map_ids}
    missing = [mode for mode in season.get("game_mode_order") or [] if mode and mode not in chosen]
    if missing:
        labels = {mode["mode"]: mode["label"] for mode in game_maps.game_modes(game)}
        names = [f"„{labels[mode]}“" for mode in dict.fromkeys(missing) if mode in labels]
        what = ", ".join(names) if names else "ein Modus der Reihenfolge"  # dem Spiel schon entfernt: nie eine rohe Kennung
        raise HTTPException(status_code=422, detail=f"Im neuen Pool fehlt {what}. Bitte „Modus je Map“ zuerst ändern und speichern.")
    # Dieselbe Sperre wie „Map aus dem Pool nehmen“ (#2207): beide nacheinander, nie verschränkt.
    try:
        async with mutation_lock(db, league_season_pool_resource(season_id)):
            doc = await _call(map_pools.save(db, scope="league_season", scope_id=season_id, game=game, body=body, user=me))
    except MutationLockBusy:
        raise HTTPException(status_code=409, detail=POOL_BUSY) from None
    await _audit(db, "league.season.map_pool.save", me, season_id, {"version": doc["version"], "pool_id": doc["id"]})
    # Mindestgröße je Modus (#2207): nur Warnung - die Prüfung vor der Veröffentlichung nennt es als Problem.
    warnings = league_pool_check.pool_problems(season, await league_pool_check.divisions_of(db, season_id), doc, game)
    return {**map_pools.saved_view(doc, "league_season", admin=True), "warnings": warnings}


@admin_router.get("/seasons/{season_id}/map-pool/versions")
async def admin_season_pool_versions(season_id: str, _me: dict = Depends(require_league(ANY, via="season_id"))):
    """Die Versionen des Season-Pools, neueste zuerst (#2207) - für „Versionen vergleichen“."""
    db = get_db()
    await _call(leagues.get_season(db, season_id))
    return {"versions": await map_pools.versions(db, "league_season", season_id)}


@admin_router.get("/seasons/{season_id}/map-pool/compare")
async def admin_season_pool_compare(season_id: str, base: int, target: int,
                                    _me: dict = Depends(require_league(ANY, via="season_id"))):
    """Zwei Versionen des Season-Pools gegenübergestellt (#2207): je Modus hinzu, weg, geblieben."""
    db = get_db()
    await _call(leagues.get_season(db, season_id))
    docs = {}
    for number in (base, target):
        docs[number] = await db.map_pools.find_one({"scope": "league_season", "scope_id": season_id, "version": number}, {"_id": 0})
        if not docs[number]:
            raise HTTPException(status_code=404, detail=f"Version {number} gibt es nicht.")
    return map_pools.compare(docs[base], docs[target])


@admin_router.post("/seasons/{season_id}/map-pool/remove-map")
async def admin_season_pool_remove_map(season_id: str, body: LeagueMapRemove,
                                       me: dict = Depends(require_league("season", via="season_id"))):
    """Map in einem Schritt sperren (#2207): neue Version ohne die Map, übertragen auf alle Staffeln, Protokoll mit Grund.

    Alles unter den Sperren: zuerst die Turnier-Sperren aller Staffeln (feste Reihenfolge), dann die Sperre des Season-Pools - dieselbe
    wie beim Speichern. Ist eine belegt: 409, nichts geschrieben. Übertragen wird genau die neue Version, nie eine, die danach entsteht.
    Steht die Map schon nicht mehr im Pool, aber in einer früheren Version, entsteht keine neue: Dann wird nur noch übertragen, was
    einer Staffel fehlt (erneutes Ausführen nach einem Abbruch legt nichts doppelt an)."""
    db = get_db()
    reason = _reason(LeagueDelete(reason=body.reason))
    season = await _call(leagues.get_season(db, season_id))
    league = await _call(leagues.get_league(db, season["league_id"]))
    game = await _season_game(db, season)
    try:
        async with AsyncExitStack() as locks:
            staffeln = sorted(row["id"] for row in await leagues.staffeln_of(db, season_id))
            for tournament_id in staffeln:
                await locks.enter_async_context(mutation_lock(db, tournament_write_resource(tournament_id)))
            await locks.enter_async_context(mutation_lock(db, league_season_pool_resource(season_id)))
            if sorted(row["id"] for row in await leagues.staffeln_of(db, season_id)) != staffeln:
                raise HTTPException(status_code=409, detail=leagues.CHANGED_MEANWHILE)
            fresh = await _call(leagues.get_season(db, season_id))
            previous, doc, created = await _remove_map_version(db, fresh, league, game, body, me, reason)
            results = await _transfer_version(db, fresh, staffeln, doc, me)
    except MutationLockBusy:
        raise HTTPException(status_code=409, detail=f"{POOL_BUSY} Es wurde nichts geändert.") from None
    finally:
        reset_scope_cache()
    name = next((item.get("name") for group in (previous or {}).get("modes") or [] for item in group.get("maps") or []
                 if item.get("map_id") == body.map_id), None)
    await _audit(db, "league.season.map_pool.remove_map", me, season_id, {
        "reason": reason, "map_id": body.map_id, "map_name": name, "mode": body.mode, "version": doc["version"],
        "pool_id": doc["id"], "from_version": (previous or {}).get("version"), "new_version": created,
        "staffeln": [{"tournament_id": entry["tournament_id"], "applied": entry["applied"]} for entry in results]})
    divisions = await league_pool_check.divisions_of(db, season_id)
    warnings = league_pool_check.pool_problems(fresh, divisions, doc, game)
    return {"pool": map_pools.saved_view(doc, "league_season", admin=True), "staffeln": results, "warnings": warnings,
            "unchanged": not created}


POOL_BUSY = "Der Map-Pool oder eine Staffel wird gerade bearbeitet – bitte gleich noch einmal."


def _has_map(doc: dict | None, map_id: str, mode: str | None) -> bool:
    return any(item.get("map_id") == map_id for group in (doc or {}).get("modes") or []
               if mode is None or group.get("mode") == mode for item in group.get("maps") or [])


async def _remove_map_version(db, season: dict, league: dict, game: dict | None, body: LeagueMapRemove, me: dict,
                              reason: str) -> tuple[dict | None, dict, bool]:
    """Unter der Pool-Sperre: die neue Version ohne die Map - oder, wenn sie schon draußen ist, die geltende (``created`` False)."""
    current = map_pools.valid_for(await map_pools.current(db, "league_season", season["id"]), league.get("game_id"))
    if not current:
        raise HTTPException(status_code=404, detail="Es gibt keinen Map-Pool.")
    if not _has_map(current, body.map_id, body.mode):
        earlier = await db.map_pools.find_one({"scope": "league_season", "scope_id": season["id"],
                                               "modes.maps.map_id": body.map_id}, {"_id": 0})
        if not earlier:
            raise HTTPException(status_code=404, detail="Diese Map steht nicht im Map-Pool.")
        return earlier, current, False
    if body.expected_version is not None and int(current.get("version") or 0) != body.expected_version:
        raise HTTPException(status_code=409, detail=map_pools.CHANGED_MEANWHILE)
    # Wie beim Speichern: Ein Modus aus „Modus je Map“ darf nicht leer werden (#2129).
    left = {group.get("mode"): [item.get("map_id") for item in group.get("maps") or []
                                if body.mode not in (None, group.get("mode")) or item.get("map_id") != body.map_id]
            for group in current.get("modes") or []}
    empty = [mode for mode in dict.fromkeys(season.get("game_mode_order") or []) if mode and not left.get(mode)]
    if empty:
        labels = {mode["mode"]: mode["label"] for mode in game_maps.game_modes(game)}
        names = ", ".join(f"„{labels.get(mode) or mode}“" for mode in empty)
        raise HTTPException(status_code=422, detail=f"Ohne diese Map hätte {names} keine Map mehr, steht aber in „Modus je Map“. "
                                                    "Bitte zuerst eine andere Map aufnehmen oder „Modus je Map“ ändern.")
    previous, doc = await _call(map_pools.without_map(
        db, scope="league_season", scope_id=season["id"], map_id=body.map_id, mode=body.mode, user=me,
        note=f"Map gesperrt: {reason}", expected_version=body.expected_version))
    return previous, doc, True


async def _transfer_version(db, season: dict, staffel_ids: list[str], doc: dict, me: dict) -> list[dict]:
    """Genau ``doc`` auf jede Staffel - die Sperren hält der Aufrufer. Hat eine Staffel dieselben Maps schon, entsteht nichts."""
    from routes.tournament_common import _is_tournament_locked

    divisions = {row["id"] for row in await db.league_divisions.find({"season_id": season["id"]}, {"_id": 0, "id": 1}).to_list(50)}
    results = []
    for tournament_id in staffel_ids:
        tournament = await db.tournaments.find_one({"id": tournament_id, **ONLY_LEAGUE}, {"_id": 0})
        if not tournament or (tournament.get("league_context") or {}).get("division_id") not in divisions:
            continue
        entry = {"tournament_id": tournament_id, "title": tournament.get("title"), "applied": False, "notes": []}
        applied, skipped, changed = [], [], []
        try:
            await leagues.transfer_pool(db, tournament, season, me, pool=doc, locked=_is_tournament_locked(tournament),
                                        applied=applied, skipped=skipped, changed=changed)
        except (LeagueProblem, MapProblem) as problem:
            skipped.append({"reason": problem.message})
        entry.update({"applied": "map_pool" in applied, "notes": [item["reason"] for item in skipped]})
        results.append(entry)
    return results


@admin_router.get("/seasons/{season_id}/readiness")
async def admin_season_readiness(season_id: str, me: dict = Depends(require_league(ANY, via="season_id"))):
    """Prüfung vor der Veröffentlichung (#2207): Probleme halten das Veröffentlichen auf, Warnungen nicht."""
    db = get_db()
    season = await _call(leagues.get_season(db, season_id))
    league = await _call(leagues.get_league(db, season["league_id"]))
    return await league_readiness.season_readiness(db, league, season, me)


@admin_router.delete("/seasons/{season_id}/map-pool")
async def admin_clear_season_pool(season_id: str, me: dict = Depends(require_league("season", via="season_id"))):
    db = get_db()
    await _call(leagues.get_season(db, season_id))
    try:
        async with mutation_lock(db, league_season_pool_resource(season_id)):
            doc = await _call(map_pools.clear(db, scope="league_season", scope_id=season_id, user=me))
    except MutationLockBusy:
        raise HTTPException(status_code=409, detail=POOL_BUSY) from None
    if doc:
        await _audit(db, "league.season.map_pool.clear", me, season_id, {"version": doc["version"]})
    return {"ok": True}


@admin_router.post("/seasons/{season_id}/sync")
async def admin_sync_season(season_id: str, me: dict = Depends(require_league("season", via="season_id"))):
    """„Vorgaben auf Staffeln übertragen“: je Staffel, was noch darf - der Rest kommt mit Grund zurück."""
    from routes.tournament_common import _is_tournament_locked

    db = get_db()
    season = await _call(leagues.get_season(db, season_id))
    league = await _call(leagues.get_league(db, season["league_id"]))
    divisions = {row["id"]: row for row in await db.league_divisions.find({"season_id": season_id},
                                                                          {"_id": 0}).to_list(50)}
    results = []

    def nothing(row: dict, reason: str) -> dict:
        return {"tournament_id": row["id"], "title": row.get("title"), "applied": [], "changed": [],
                "skipped": [{"group": "all", "label": "Alles", "reason": reason}]}

    try:
        for row in await leagues.staffeln_of(db, season_id):
            try:
                async with mutation_lock(db, tournament_write_resource(row["id"])):
                    # Erst unter der Sperre lesen: was gleichzeitig geändert wurde (Status, Sperre), zählt mit.
                    tournament = await db.tournaments.find_one({"id": row["id"], **ONLY_LEAGUE}, {"_id": 0})
                    division = divisions.get(((tournament or {}).get("league_context") or {}).get("division_id"))
                    if not tournament or not division:
                        continue
                    # Gesperrt heißt: Termine, Kalender und Wertung bleiben - Regeltext und Map-Pool gelten trotzdem.
                    result = await leagues.sync_staffel(db, tournament, league, season, division, me,
                                                        locked=_is_tournament_locked(tournament))
            except MutationLockBusy:
                results.append(nothing(row, "Die Staffel wird gerade bearbeitet - bitte gleich noch einmal."))
                continue
            except (LeagueProblem, MapProblem) as problem:
                # Eine Staffel, die nicht geht, hält die anderen nicht auf - ihr Grund steht im Ergebnis.
                results.append(nothing(row, problem.message))
                continue
            await _audit(db, "league.staffel.sync", me, tournament["id"],
                         {"season_id": season_id, "applied": result.applied, "changed": result.changed,
                          "skipped": [item["group"] for item in result.skipped]})
            results.append(result.as_dict())
    finally:
        # Auch nach einem Abbruch: was schon geschrieben ist, soll die Live-Meldung neu nachschlagen.
        reset_scope_cache()
    return {"staffeln": results}


# ---------------------------------------------------------------- Verwaltung: Liga N und Staffel

@admin_router.post("/seasons/{season_id}/divisions")
async def admin_create_division(season_id: str, body: LeagueDivisionCreate,
                                me: dict = Depends(require_league("season", via="season_id"))):
    db = get_db()
    season = await _call(leagues.get_season(db, season_id))
    payload = body.model_dump(exclude_unset=True)
    if body.overrides is not None:
        payload["overrides"] = body.overrides.model_dump(exclude_none=True)
    warnings: list[str] = []
    doc = await _call(leagues.create_division(db, season, payload, me, warnings=warnings))
    await _audit(db, "league.division.create", me, doc["id"], {"season_id": season_id, "level": doc["level"]})
    return {**doc, "warnings": warnings}


@admin_router.patch("/divisions/{division_id}")
async def admin_update_division(division_id: str, body: LeagueDivisionUpdate,
                                me: dict = Depends(require_league("season", via="division_id"))):
    db = get_db()
    division = await _call(leagues.get_division(db, division_id))
    payload = body.model_dump(exclude_unset=True)
    if "overrides" in payload:
        payload["overrides"] = body.overrides.model_dump(exclude_none=True) if body.overrides else {}
    warnings: list[str] = []
    doc, changed = await _call(leagues.update_division(db, division, payload, warnings=warnings))
    if changed:
        await _audit(db, "league.division.update", me, division_id, {"fields": changed})
    return {**doc, "warnings": warnings}


@admin_router.get("/divisions/{division_id}/delete-plan")
async def admin_division_delete_plan(division_id: str, _me: dict = Depends(require_league("season", via="division_id"))):
    return await _delete_plan("division", division_id)


@admin_router.delete("/divisions/{division_id}")
async def admin_delete_division(division_id: str, body: LeagueDelete, me: dict = Depends(require_league("season", via="division_id"))):
    """Liga N löschen (#2106): ohne Staffel mit Co-Teams oder Spielen - leere Entwurfs-Staffeln gehen mit."""
    return await _delete("division", division_id, body, me)


@admin_router.delete("/staffeln/{tournament_id}")
async def admin_delete_staffel(tournament_id: str, body: LeagueDelete, me: dict = Depends(require_league("season", via="tournament_id"))):
    """Staffel auf der Season-Seite löschen (#2106) - mit derselben Löschsperre wie in der Turnierverwaltung (#2109)
    und mit Grund im Protokoll."""
    db = get_db()
    reason = _reason(body)
    tournament = await db.tournaments.find_one({"id": tournament_id, **ONLY_LEAGUE}, {"_id": 0})
    if not tournament:
        raise HTTPException(status_code=404, detail="Staffel nicht gefunden.")
    await _call(leagues.delete_staffel(db, tournament))
    reset_scope_cache()
    context = tournament["league_context"]
    await _audit(db, "league.staffel.delete", me, tournament_id, {
        "reason": reason, "title": tournament.get("title"), "season_id": context.get("season_id"),
        "division_id": context.get("division_id"), "staffel": context.get("staffel")})
    return {"ok": True}


@admin_router.post("/divisions/{division_id}/staffeln")
async def admin_create_staffel(division_id: str, body: LeagueStaffelCreate, me: dict = Depends(require_league("season", via="division_id"))):
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
    from routes.tournament_common import tournament_hidden_reason

    from services.league_rules import summary as rules_summary

    db = get_db()
    view = await _call(leagues.public_season_view(db, league_slug, season_slug, user, staffel_hidden=tournament_hidden_reason))
    # Selbstanmeldung (#2205): Fenster-Stand und freie Plätze für alle, ``None`` ohne Fenster. Keine Personen.
    season = await db.league_seasons.find_one({"id": view["season"]["id"]}, {"_id": 0})
    # Regelwerk (#1646): Link mit Version und Stand statt des Aufklappblocks; ``None`` - der Regeltext bleibt.
    return {**view, "rules": await rules_summary(db, view["league"]["id"], view["season"]["id"], user),
            "application": await league_applications.public_block(db, season),
            # Plattform je Season (#2270): erlaubte Plattformen, Crossplay, Eingabegerät, je Liga N; ``None`` ohne jede Angabe.
            "platform": await league_platform.season_block(db, season)}


@router.get("/{league_slug}/{season_slug}/staffeln/{staffel_ref}")
async def public_staffel(league_slug: str, season_slug: str, staffel_ref: str,
                         user: dict | None = Depends(get_optional_user)):
    """Eine Staffel auf der Ligaseite (P5, #1625): Tabelle (Punkte der Season), Spielwochen mit Pause, Spiele mit
    Ergebnis und Maps, Teams mit Teamseite. Sichtbar nur, was die Season und die Turnierseite der Person zeigen."""
    from routes.tournament_common import tournament_hidden_reason
    from routes.tournament_view_routes import standings as tournament_standings
    from services import league_page

    db = get_db()
    _league, season = await _call(leagues.visible_season(db, league_slug, season_slug, user))
    # Nur genau diese Staffel prüfen: gehört sie zu dieser Season (nie eine aus einer anderen), sieht die Person sie
    # als Turnier, und ihre Liga N ist aktiv.
    tournament = await db.tournaments.find_one(
        {"$or": [{"id": staffel_ref}, {"slug": staffel_ref}], "league_context.season_id": season["id"], **ONLY_LEAGUE},
        {"_id": 0})
    division = await db.league_divisions.find_one(
        {"id": tournament["league_context"].get("division_id"), "season_id": season["id"], "status": "active"},
        {"_id": 0}) if tournament else None
    if not tournament or not division or await tournament_hidden_reason(db, tournament, user):
        raise HTTPException(status_code=404, detail="Staffel nicht gefunden")
    staffel = {"tournament_id": tournament["id"], "slug": tournament.get("slug"), "title": tournament.get("title"),
               "staffel": tournament["league_context"].get("staffel"), "status": tournament.get("status"),
               "max_participants": tournament.get("max_participants")}
    division = {**division, "label": leagues.division_label(division)}
    registrations = await db.tournament_registrations.find(
        {"tournament_id": tournament["id"], "status": {"$in": list(league_page.PUBLIC_REGISTRATION_STATUSES)}},
        {"_id": 0, "id": 1, "display_name": 1, "team_name": 1, "squad_name": 1, "team_id": 1}).to_list(200)
    names = {row["id"]: league_page.registration_view(row) for row in registrations if row.get("id")}
    matches = await db.matches_v2.find({"tournament_id": tournament["id"], "is_preview": {"$ne": True}},
                                       {"_id": 0}).to_list(500)
    proposals = await db.match_schedule_proposals.find({"tournament_id": tournament["id"]},
                                                       {"_id": 0, "match_collection": 0}).to_list(2000)
    table = await tournament_standings(tournament["id"], None, user)
    return {
        "staffel": {**staffel, "division_label": division["label"], "division_level": division["level"]},
        "standings": table,
        "teams": sorted(names.values(), key=lambda row: str(row["display_name"]).casefold()),
        **league_page.staffel_weeks(tournament, matches, names, proposals),
    }
