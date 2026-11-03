"""Wo die Spieler-IDs eines Spiels liegen und wer sie verliert (#2249, Codex-Prüfungen zu den Spiel-ID-Schlüsseln).

**Speicherort.** Das Profil speichert alle ID-Felder, die für ein Spiel gelten (die der ID-Quelle und die eigenen), unter dem
Slug der **effektiven ID-Quelle**: ``users.game_ids.<quelle>.<schlüssel>`` (``ProfilePage`` und ``RegistrationSheet`` gruppieren
nach ``identity_game_slug``). Gelesen wird Quelle plus eigener Slug (``tournament_common._profile_player_ids``). Effektive Quelle:
``identity_source_game_id``, sonst bei ``inherit_player_ids`` das Hauptspiel, sonst das Spiel selbst - dieselbe Regel wie
``game_routes._effective_identity_source``. Der Liga-Kader hält festgehaltene IDs je Eintrag in ``league_rosters.player_ids``,
``game_id`` ist das Spiel der Staffel.

**Verlust.** Ein Schlüssel geht einem Spiel verloren, wenn er nach dem Speichern nicht mehr zu seinen effektiven Feldern gehört
(Feld entfernt, anderer Schlüssel, andere ID-Quelle, anderes Hauptspiel, Erben aus) - dann zählt jede Person mit einem Wert im
Profil (alte Quelle, eigener Slug, Spiele, die ihre IDs von diesem Spiel nehmen) oder im Kader dieser Spiele. Bleibt der Schlüssel,
wechselt aber die Quelle, zählt, wer den Wert nur unter der alten Quelle hat. Anonymisierte Konten zählen nie.

Gezählt wird mit ``distinct`` auf genau dem Pfad (Wert mit mindestens einem Nicht-Leerzeichen), nicht über ganze Profile.
"""
from __future__ import annotations

GAME_FIELDS = {"_id": 0, "id": 1, "slug": 1, "identity_source_game_id": 1, "parent_game_id": 1, "inherit_player_ids": 1,
               "player_id_fields": 1}
HAS_TEXT = {"$regex": r"\S"}


async def games_by_id(db) -> dict[str, dict]:
    return {row["id"]: row for row in await db.games.find({}, GAME_FIELDS).to_list(None) if row.get("id")}


def source_of(game: dict, by_id: dict[str, dict]) -> dict:
    """Die effektive ID-Quelle - wie ``game_routes._effective_identity_source``."""
    source_id = game.get("identity_source_game_id")
    if not source_id and game.get("inherit_player_ids") is not False:
        source_id = game.get("parent_game_id")
    if source_id and source_id != game.get("id"):
        return by_id.get(source_id) or game
    return game


def own_keys(game: dict | None) -> list[str]:
    keys = [str(item.get("key") or "") for item in (game or {}).get("player_id_fields") or [] if isinstance(item, dict)]
    return [key for key in dict.fromkeys(keys) if key]


def effective_keys(game: dict, by_id: dict[str, dict]) -> list[str]:
    source = source_of(game, by_id)
    inherited = own_keys(source) if source.get("id") != game.get("id") else []
    return list(dict.fromkeys([*inherited, *own_keys(game)]))


def readers(game: dict, by_id: dict[str, dict]) -> list[dict]:
    """Spiele, die ihre IDs von diesem Spiel nehmen (ID-Quelle oder geerbt)."""
    return [row for row in by_id.values() if row.get("id") != game.get("id") and source_of(row, by_id).get("id") == game.get("id")]


def _path_safe(part: str) -> bool:
    return bool(part) and "." not in part and not part.startswith("$") and "\x00" not in part


async def _active(db, user_ids: set[str]) -> set[str]:
    if not user_ids:
        return set()
    gone = set(await db.users.distinct("id", {"id": {"$in": sorted(user_ids)}, "anonymized_at": {"$ne": None}}))
    return user_ids - gone


async def people_with(db, key: str, slugs, game_ids=()) -> set[str]:
    """Wer unter ``key`` eine ID hat: im Profil unter einem der Slugs oder im Kader eines der Spiele."""
    slugs = [slug for slug in dict.fromkeys(slugs) if slug]
    game_ids = [game_id for game_id in dict.fromkeys(game_ids) if game_id]
    found: set[str] = set()
    if not key:
        return found
    if slugs:
        if _path_safe(key) and all(_path_safe(slug) for slug in slugs):
            found |= set(await db.users.distinct("id", {"anonymized_at": None,
                                                         "$or": [{f"game_ids.{slug}.{key}": HAS_TEXT} for slug in slugs]}))
        else:
            # Ein Schlüssel mit Punkt oder $ lässt sich nicht als Pfad abfragen: nur die betroffenen Teilprofile laden.
            safe = [slug for slug in slugs if _path_safe(slug)]
            rows = await db.users.find({"anonymized_at": None, "$or": [{f"game_ids.{slug}": {"$exists": True}} for slug in safe]},
                                       {"_id": 0, "id": 1, **{f"game_ids.{slug}": 1 for slug in safe}}).to_list(None) if safe else []
            for row in rows:
                stored = row.get("game_ids") or {}
                if any(str((stored.get(slug) or {}).get(key) or "").strip() for slug in safe):
                    found.add(row["id"])
    if game_ids:
        if _path_safe(key):
            in_roster = set(await db.league_rosters.distinct("user_id", {"game_id": {"$in": game_ids}, f"player_ids.{key}": HAS_TEXT}))
        else:
            rows = await db.league_rosters.find({"game_id": {"$in": game_ids}}, {"_id": 0, "user_id": 1, "player_ids": 1}).to_list(None)
            in_roster = {row["user_id"] for row in rows if str((row.get("player_ids") or {}).get(key) or "").strip()}
        found |= await _active(db, {user_id for user_id in in_roster if user_id})
    return found


async def lost_keys(db, before: dict, after: dict, by_id: dict[str, dict] | None = None) -> dict[str, int]:
    """Je Schlüssel, wie viele Personen ihre ID für dieses Spiel verlieren, wenn ``before`` zu ``after`` wird."""
    by_id = dict(by_id or await games_by_id(db))
    by_id[before["id"]] = before
    after_by_id = {**by_id, after["id"]: after}
    source_before, source_after = source_of(before, by_id), source_of(after, after_by_id)
    keys_after = set(effective_keys(after, after_by_id))
    reading = readers(before, by_id)
    result: dict[str, int] = {}
    for key in effective_keys(before, by_id):
        if key not in keys_after:
            people = await people_with(db, key, [source_before.get("slug"), before.get("slug"), *[row.get("slug") for row in reading]],
                                       [before["id"], *[row["id"] for row in reading]])
        elif source_before.get("slug") != source_after.get("slug") and source_before.get("slug") != before.get("slug"):
            people = (await people_with(db, key, [source_before.get("slug")])
                      - await people_with(db, key, [source_after.get("slug"), after.get("slug")]))
        else:
            continue
        if people:
            result[key] = len(people)
    return result


async def usage_by_key(db, game: dict) -> dict[str, int]:
    """Je eigenem Schlüssel die Personen mit einer ID - für die Rückfrage beim Entfernen eines Felds."""
    by_id = await games_by_id(db)
    without = {key: 0 for key in own_keys(game)}
    lost = await lost_keys(db, game, {**game, "player_id_fields": []}, by_id)
    return {key: lost.get(key, 0) for key in without}


async def deletion_people(db, game: dict) -> int:
    """Personen, deren ID am Spiel hängt, wenn es gelöscht würde: eigene Schlüssel (dort, wo das Profil sie wirklich speichert)
    und jeder Kader-Eintrag des Spiels."""
    by_id = await games_by_id(db)
    source = source_of(game, by_id)
    people: set[str] = set()
    if _path_safe(game.get("slug") or ""):
        people |= set(await db.users.distinct("id", {"anonymized_at": None, f"game_ids.{game['slug']}": {"$exists": True}}))
    for key in own_keys(game):
        people |= await people_with(db, key, [source.get("slug"), game.get("slug")])
    people |= await _active(db, set(await db.league_rosters.distinct("user_id", {"game_id": game["id"]})) - {None})
    return len(people)


def in_use_detail(fields: list | None, used: dict[str, int]) -> dict:
    """Die Antwort (409), wenn Schlüssel mit gespeicherten IDs ohne Bestätigung wegfallen sollen - mit Text und Zählung."""
    labels = {str(item.get("key") or ""): item.get("label") or item.get("key") for item in fields or [] if isinstance(item, dict)}
    parts = [f"„{labels.get(key) or key}“ ({count} {'Person' if count == 1 else 'Personen'})" for key, count in used.items()]
    return {"code": "id_keys_in_use", "keys": used,
            "message": (f"Unter {', '.join(parts)} sind schon Spieler-IDs gespeichert. Danach findet die Seite sie für dieses Spiel "
                        "nicht mehr – bitte bestätigen oder die Änderung lassen.")}
