"""Game/Discipline routes."""
from fastapi import APIRouter, HTTPException, Depends
from database import get_db
from auth import get_optional_user, require_admin
from services import game_id_keys, game_maps, game_modes, game_usage, league_result_rules, mode_icons
from services.slug_utils import apply_slug_history, find_by_slug_or_history, slugify, unique_slug
from models import GameCreate, GameUpdate, normalize_rule, now_utc, new_id

router = APIRouter(prefix="/api/games", tags=["games"])


def _effective_identity_source(game: dict, by_id: dict[str, dict]) -> dict:
    if game.get("identity_source_game_id"):
        return by_id.get(game["identity_source_game_id"]) or game
    if game.get("inherit_player_ids") is not False and game.get("parent_game_id"):
        return by_id.get(game["parent_game_id"]) or game
    return game


def _merge_player_id_fields(source: dict, game: dict) -> list[dict]:
    merged: list[dict] = []
    seen = set()
    for field in (source.get("player_id_fields") or []) + (game.get("player_id_fields") or []):
        if not isinstance(field, dict) or not field.get("key") or field["key"] in seen:
            continue
        seen.add(field["key"])
        merged.append(field)
    return merged


def _game_display_name(game: dict, parent: dict | None = None) -> str:
    name = (game.get("name") or "").strip()
    parent_name = (parent or {}).get("name") or ""
    parent_name = parent_name.strip()
    if game.get("kind") != "edition" or not parent_name or not name:
        return name
    lower_name = name.lower()
    lower_parent = parent_name.lower()
    if lower_name == lower_parent or lower_name.startswith(f"{lower_parent}:"):
        return name
    return f"{parent_name}: {name}"


def _readable_mode(mode):
    """Ein Modus im heutigen Vertrag: Zeitlimit in Sekunden, Einstellungen und Regeltext ohne Zeichen des Zwischenformats der Bausteine
    (Altbestand, #2271) - beim Lesen, ohne Migration."""
    if not isinstance(mode, dict):
        return mode
    out = dict(mode)
    if isinstance(out.get("result_rule"), dict):
        out["result_rule"] = normalize_rule(out["result_rule"])
    if "settings" in out or "rules_text" in out:
        entry = league_result_rules.settings_entry(out) or {}
        if "settings" in out:
            out["settings"] = entry.get("settings") or []
        if "rules_text" in out:
            out["rules_text"] = entry.get("rules_text")
    return out


def _readable_modes(game: dict) -> None:
    """Altbestand beim Lesen umrechnen (#2271), siehe ``_readable_mode``."""
    modes = game.get("match_modes")
    if isinstance(modes, list):
        game["match_modes"] = [_readable_mode(mode) for mode in modes]


async def _check_icons(db, modes: list | None, me: dict, current: dict | None = None) -> None:
    """Symbole je Modus (#2266): nur eigene Uploads - was ein Modus schon trägt, bleibt an diesem Modus speicherbar."""
    try:
        await mode_icons.check(db, modes, me, mode_icons.icons_of(current))
    except mode_icons.IconProblem as problem:
        raise HTTPException(status_code=422, detail=str(problem)) from None


def _enrich_games(games: list[dict]) -> list[dict]:
    by_id = {game.get("id"): game for game in games if game.get("id")}
    for game in games:
        _readable_modes(game)
        parent = by_id.get(game.get("parent_game_id"))
        source = _effective_identity_source(game, by_id)
        game["display_name"] = _game_display_name(game, parent)
        if parent:
            game["parent_game"] = {
                "id": parent.get("id"),
                "name": parent.get("name"),
                "display_name": parent.get("display_name") or _game_display_name(parent),
                "slug": parent.get("slug"),
                "short_name": parent.get("short_name"),
            }
        if source and source.get("id") != game.get("id"):
            game["identity_source_game"] = {
                "id": source.get("id"),
                "name": source.get("name"),
                "display_name": source.get("display_name") or _game_display_name(source, by_id.get(source.get("parent_game_id"))),
                "slug": source.get("slug"),
                "short_name": source.get("short_name"),
            }
        game["identity_game_slug"] = source.get("slug") or game.get("slug")
        game["identity_game_name"] = source.get("name") or game.get("name")
        game["effective_player_id_fields"] = _merge_player_id_fields(source, game)
    return games


async def _check_discord_guild(db, doc: dict, current: dict | None = None) -> None:
    """Discord-Server eines Spiels (#626): leer heißt erben; sonst ein Server aus dem Verzeichnis, den der Bot nicht
    verlassen hat. Geprüft wird nur eine Änderung - ein inzwischen verlassener Server blockiert kein anderes Speichern."""
    if "discord_guild_id" not in doc:
        return
    guild_id = str(doc.get("discord_guild_id") or "").strip()
    doc["discord_guild_id"] = guild_id or None
    if guild_id and guild_id != str((current or {}).get("discord_guild_id") or ""):
        row = await db.discord_guilds.find_one({"guild_id": guild_id}, {"_id": 0, "left_at": 1})
        if not row:
            raise HTTPException(status_code=404, detail="Diesen Discord-Server kennt die Website nicht (Verbindungen → Discord → Server).")
        if row.get("left_at"):
            raise HTTPException(status_code=400, detail="Der Bot ist nicht mehr auf diesem Discord-Server.")


@router.get("")
async def list_games():
    db = get_db()
    games = await db.games.find({}, {"_id": 0}).sort("name", 1).to_list(200)
    return sorted(_enrich_games(games), key=lambda game: (game.get("display_name") or game.get("name") or "").lower())


@router.get("/discord-servers")
async def game_discord_choices(me: dict = Depends(require_admin())):
    """Die Server zur Auswahl im Spielformular (#626) - für die Turnierleitung, ohne Zugriff auf die Einstellungen."""
    from services import discord_guilds

    rows = await discord_guilds.list_guilds(get_db())
    return [{"guild_id": row["guild_id"], "name": row.get("name"), "role": row.get("role"), "enabled": bool(row.get("enabled")),
             "left": bool(row.get("left_at"))} for row in rows]


@router.get("/{slug_or_id}")
async def get_game(slug_or_id: str):
    db = get_db()
    game, _ = await find_by_slug_or_history(db.games, slug_or_id, {"_id": 0})
    if not game:
        raise HTTPException(status_code=404, detail="Spiel nicht gefunden")
    games = await db.games.find({}, {"_id": 0}).to_list(200)
    enriched = _enrich_games(games)
    return next((row for row in enriched if row.get("id") == game.get("id")), game)


@router.get("/{slug_or_id}/discord")
async def game_discord_server(slug_or_id: str, me: dict | None = Depends(get_optional_user)):
    """Der Discord-Server eines Spiels (#626) für die Kachel auf Spielkarte und Turnierseite: eigener Server, sonst
    der des Hauptspiels, sonst der Hauptserver. Ausgeschaltete erscheinen nie; „du bist dabei“ nur für die eigene Person."""
    from services import discord_guilds

    db = get_db()
    game, _ = await find_by_slug_or_history(db.games, slug_or_id, {"_id": 0})
    if not game:
        raise HTTPException(status_code=404, detail="Spiel nicht gefunden")
    row = await discord_guilds.guild_for_game(db, game)
    out = await discord_guilds.public_server(db, row)
    if not out.get("available"):
        return out
    out["for_game"] = row.get("inherited_from") != "main"
    if me:
        status = await discord_guilds.own_status(db, me["id"], [out["guild_id"]])
        out["linked"] = status["linked"]
        out["member"] = status["statuses"].get(out["guild_id"]) if status["linked"] else None
    return out


@router.get("/{game_id}/usage")
async def game_usage_route(game_id: str, me: dict = Depends(require_admin())):
    """Wo das Spiel verwendet wird (#2129) - für die Rückfragen vor dem Löschen und vor dem Entfernen eines Modus."""
    db = get_db()
    game = await db.games.find_one({"id": game_id}, {"_id": 0})
    if not game:
        raise HTTPException(status_code=404, detail="Spiel nicht gefunden")
    return await game_usage.usage(db, game)


def _check_id_fields(fields: list | None, current: list | None = None) -> None:
    """Format und Auswahl der Spiel-IDs (#2204): Ein kaputtes Muster fällt beim Speichern auf, nicht erst bei den Spielern.
    Dazu eindeutige, nicht leere Schlüssel (#2249); ``current`` hält Altbestand speicherbar."""
    from services.league_roster import id_fields_problem

    problem = id_fields_problem(fields, current)
    if problem:
        raise HTTPException(status_code=422, detail=problem)


@router.post("")
async def create_game(body: GameCreate, me: dict = Depends(require_admin())):
    db = get_db()
    doc = body.model_dump()
    _check_id_fields(doc.get("player_id_fields"))
    duplicate = game_modes.duplicate_name_problem(doc.get("match_modes"))
    if duplicate:
        raise HTTPException(status_code=422, detail=duplicate)
    await _check_icons(db, doc.get("match_modes"), me)
    doc["slug"] = await unique_slug(db.games, doc.get("slug") or doc.get("name"), fallback="spiel")
    if doc.get("parent_game_id") and not await db.games.find_one({"id": doc["parent_game_id"]}, {"id": 1}):
        raise HTTPException(status_code=404, detail="Hauptspiel nicht gefunden")
    if doc.get("identity_source_game_id") and not await db.games.find_one({"id": doc["identity_source_game_id"]}, {"id": 1}):
        raise HTTPException(status_code=404, detail="ID-Quelle nicht gefunden")
    for chosen in (doc.get("parent_game_id"), doc.get("identity_source_game_id")):
        if await game_usage.chosen_is_archived(db, chosen):
            raise HTTPException(status_code=422, detail=game_usage.ARCHIVED_DETAIL)
    await _check_discord_guild(db, doc)
    doc["id"] = new_id()
    doc["created_at"] = now_utc().isoformat()
    doc["updated_at"] = now_utc().isoformat()
    await db.games.insert_one(doc)
    doc.pop("_id", None)
    return doc


async def _refuse_used_removal(db, current: dict, modes: list[dict] | None) -> None:
    """Ein verwendeter Modus lässt sich nur deaktivieren oder archivieren, nicht entfernen (#2206) - 409 mit Zählung,
    auch direkt über die API und bei ``match_modes: null``."""
    kept = {mode.get("mode") for mode in modes or []}
    gone = [mode for mode in game_maps.game_modes(current) if mode["mode"] not in kept]
    if not gone:
        return
    used = await game_usage.mode_usage(db, current, [mode["mode"] for mode in gone])
    for mode in gone:
        counts = used.get(mode["mode"]) or {}
        if counts.get("in_use"):
            raise HTTPException(status_code=409, detail=game_usage.mode_in_use_text(mode["label"], counts))


ID_SOURCE_FIELDS = ("player_id_fields", "identity_source_game_id", "parent_game_id", "inherit_player_ids", "kind", "slug")


async def _lost_id_keys(db, current: dict, updates: dict, confirmed: set[str]) -> dict[str, int]:
    """Verliert das Spiel einen Schlüssel, unter dem schon Spieler-IDs stehen (#2249)? Verglichen werden die effektiven Felder und
    die effektive ID-Quelle vor und nach dem Speichern - ein entferntes Feld, ein anderer Schlüssel („PSN-ID“ zu „psn_id“), eine
    andere ID-Quelle, ein anderes Hauptspiel oder Erben aus. Ohne Bestätigung 409 mit der Zahl der Personen; bestätigt: die
    Zählung fürs Protokoll. Ohne gespeicherte IDs fällt ein Schlüssel einfach weg."""
    if not any(key in updates for key in ID_SOURCE_FIELDS):
        return {}
    by_id = await game_id_keys.games_by_id(db)
    after = {**current, **{key: updates[key] for key in ID_SOURCE_FIELDS if key in updates}}
    used = await game_id_keys.lost_keys(db, current, after, by_id)
    open_keys = {key: count for key, count in used.items() if key not in confirmed}
    if open_keys:
        source = game_id_keys.source_of(current, {**by_id, current["id"]: current})
        fields = [*(current.get("player_id_fields") or []), *(source.get("player_id_fields") or [])]
        raise HTTPException(status_code=409, detail=game_id_keys.in_use_detail(fields, open_keys))
    return used

@router.put("/{game_id}")
@router.patch("/{game_id}")
async def update_game(game_id: str, body: GameUpdate, me: dict = Depends(require_admin())):
    db = get_db()
    current = await db.games.find_one({"id": game_id}, {"_id": 0})
    if not current:
        raise HTTPException(status_code=404, detail="Spiel nicht gefunden")
    nullable_fields = {"short_name", "logo_url", "cover_url", "genre", "parent_game_id", "identity_source_game_id", "discord_guild_id",
                       "discord_role_name",
                       # Spiel-Daten (#1554): leer heißt „keine Vorgabe“.
                       "match_modes", "players_per_run_local", "players_per_run_online", "station_devices", "setup_minutes",
                       "points_table", "default_best_of"}
    raw = body.model_dump(exclude_unset=True)
    confirmed = set(raw.pop("confirm_removed_keys", None) or [])
    if raw.get("match_modes"):
        # Kennung bleibt (#2206): ein Eintrag ohne Kennung mit dem Namen eines bestehenden Modus behält dessen Kennung.
        try:
            raw["match_modes"] = game_modes.adopt_keys(raw["match_modes"], [mode._key_given for mode in body.match_modes], current)
        except game_modes.ModeProblem as problem:
            raise HTTPException(status_code=422, detail=str(problem)) from None
        keys = [mode["mode"] for mode in raw["match_modes"]]
        if len(keys) != len(set(keys)):
            raise HTTPException(status_code=422, detail="Jeder Modus braucht einen eigenen Namen.")
        # Gleiche Namen (#2206): neue Dubletten nie, vorhandene aus Altbestand halten das Speichern nicht auf.
        duplicate = game_modes.duplicate_name_problem(raw["match_modes"], current)
        if duplicate:
            raise HTTPException(status_code=422, detail=duplicate)
    if "match_modes" in raw:
        await _refuse_used_removal(db, current, raw["match_modes"])
        await _check_icons(db, raw["match_modes"], me, current)
    updates = {k: v for k, v in raw.items() if v is not None or k in nullable_fields}
    _check_id_fields(updates.get("player_id_fields"), current.get("player_id_fields"))
    # Die Adresse folgt dem Namen nicht mehr (#2249): Unter dem Slug stehen die Spieler-IDs (``users.game_ids.<slug>``), ein
    # neuer Name darf sie nicht unbemerkt unlesbar machen. Nur ein ausdrücklich anderer Slug ändert sie - mit Rückfrage, wenn
    # darunter schon IDs stehen (``_lost_id_keys``).
    updates.pop("slug", None)
    if raw.get("slug") and slugify(raw["slug"], "spiel") != slugify(current.get("slug"), "spiel"):
        updates["slug"] = await unique_slug(db.games, raw["slug"], current_id=game_id, fallback="spiel")
        apply_slug_history(current, updates)
    if updates.get("parent_game_id"):
        if updates["parent_game_id"] == game_id:
            raise HTTPException(status_code=400, detail="Ein Spiel kann nicht sein eigenes Hauptspiel sein")
        if not await db.games.find_one({"id": updates["parent_game_id"]}, {"id": 1}):
            raise HTTPException(status_code=404, detail="Hauptspiel nicht gefunden")
    if updates.get("identity_source_game_id"):
        if updates["identity_source_game_id"] == game_id:
            raise HTTPException(status_code=400, detail="Ein Spiel kann nicht seine eigene externe ID-Quelle sein")
        if not await db.games.find_one({"id": updates["identity_source_game_id"]}, {"id": 1}):
            raise HTTPException(status_code=404, detail="ID-Quelle nicht gefunden")
    for key in ("parent_game_id", "identity_source_game_id"):
        if await game_usage.chosen_is_archived(db, updates.get(key), current.get(key)):
            raise HTTPException(status_code=422, detail=game_usage.ARCHIVED_DETAIL)
    lost_keys = await _lost_id_keys(db, current, updates, confirmed)
    await _check_discord_guild(db, updates, current)
    status = updates.get("status")
    if status and status != (current.get("status") or "active"):
        updates["archived_at"] = now_utc().isoformat() if status == game_usage.ARCHIVED else None
    updates["updated_at"] = now_utc().isoformat()
    await db.games.update_one({"id": game_id}, {"$set": updates})
    if lost_keys:
        await db.audit_logs.insert_one({
            "id": new_id(), "action": "game.player_id_fields.remove", "target_id": game_id, "actor_id": me.get("id"),
            "data": {"keys": lost_keys}, "created_at": now_utc().isoformat()})
    game = await db.games.find_one({"id": game_id}, {"_id": 0})
    if "match_modes" not in raw:
        return game
    # Modi geändert (#2129, SP2): wer einen Modus verliert, verliert ihn auch an den Maps - gespeicherte Pools behalten
    # ihren Snapshot. Dazu die Zahl der Maps ohne Modus: die stehen in keinem Pool zur Wahl, bis jemand sie zuordnet.
    known = {mode["mode"] for mode in game_maps.game_modes(game)}
    gone = sorted({mode["mode"] for mode in game_maps.game_modes(current)} - known)
    return {**game, "maps_cleaned": await game_maps.drop_modes(db, game_id, gone, me),
            "maps_without_mode": await game_maps.count_without_mode(db, game)}


@router.delete("/{game_id}")
async def delete_game(game_id: str, me: dict = Depends(require_admin())):
    """Löschen nur, wenn nichts mehr am Spiel hängt (#2129) - sonst 409 mit Zählung; dann archivieren."""
    db = get_db()
    game = await db.games.find_one({"id": game_id}, {"_id": 0})
    if not game:
        raise HTTPException(status_code=404, detail="Spiel nicht gefunden")
    used = await game_usage.usage(db, game)
    if used["total"]:
        raise HTTPException(status_code=409, detail=game_usage.still_in_use(used["text"]))
    await db.map_pools.delete_many({"scope": game_maps.DEFAULT_POOL_SCOPE, "scope_id": game_id})
    # Kategorien der Ausrüstung (#2218) gehören zum Spiel; Einträge gibt es dann keine mehr (``usage``).
    await db.game_equipment_categories.delete_many({"game_id": game_id})
    await db.games.delete_one({"id": game_id})
    return {"ok": True}
