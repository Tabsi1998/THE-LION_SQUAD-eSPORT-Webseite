"""Small, ordered MongoDB migration runner for idempotent schema/data changes."""
from __future__ import annotations

import os
import socket
from datetime import datetime, timedelta, timezone

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from models import new_id
from services.secret_migration import migrate_plaintext_secrets


async def migrate_team_leader_role(db) -> str:
    """Die globale Rolle team_leader gab es nur in der Auswahl, geprüft hat sie nichts;
    Teamleitung läuft pro Team (#292). Bestehende Konten werden Spieler, mit Audit-Eintrag."""
    from datetime import datetime, timezone

    ids = [u["id"] async for u in db.users.find({"role": "team_leader"}, {"_id": 0, "id": 1})]
    if not ids:
        return "no team_leader accounts"
    now = datetime.now(timezone.utc).isoformat()
    await db.users.update_many({"id": {"$in": ids}}, {"$set": {"role": "player", "roles": ["player"], "updated_at": now}})
    await db.audit_logs.insert_many([
        {"id": new_id(), "action": "user.role_change", "target_id": uid, "actor_id": "migration",
         "data": {"role": "player", "from": "team_leader", "reason": "#292"}, "created_at": now}
        for uid in ids
    ])
    return f"{len(ids)} team_leader accounts set to player"


async def migrate_discord_webhooks_to_bot(db) -> str:
    """Discord III (#566): Meldungen gehen nur noch über den Bot. Gespeicherte Webhook-Adressen,
    Absendername und Avatar je Ziel werden verworfen - Bot-Einstellungen und Schalter bleiben."""
    doc = await db.settings.find_one({"id": "discord"}, {"_id": 0}) or {}
    unset = {key: "" for key in ("webhook_url", "ops_webhook_url", "username", "avatar_url", "targets") if key in doc}
    if not unset:
        return "nothing to remove"
    await db.settings.update_one({"id": "discord"}, {"$unset": unset})
    return f"removed {', '.join(sorted(unset))}"


async def migrate_deleted_account_leftovers(db) -> str:
    """Konto löschen (#928): Konten, die vor diesem Stand gelöscht wurden, haben Reste hinterlassen - Eintrag im
    Mitgliederverzeichnis, Anträge, Kopien in Anmeldungen, XP, Bilder. Einmal nachziehen, auf demselben Weg wie
    beim Löschen selbst. (Die frühere E-Mail-Adresse ist schon überschrieben; gesucht wird über die Kennung.)"""
    from services import account_erasure

    now = datetime.now(timezone.utc).isoformat()
    accounts = images = 0
    # Nur, was wirklich gelöscht ist: Zeitpunkt, abgeschaltet, überschriebener Name und Ersatzadresse - ein lebendes
    # Konto, bei dem zufällig ``anonymized_at`` steht, bleibt unberührt (#1029).
    deleted = {"anonymized_at": {"$exists": True, "$ne": None}, "is_active": False, "display_name": "Gelöschter User",
               "email": {"$regex": r"^deleted_[^@]*@deleted\.(invalid|local)$"}}
    async for user in db.users.find(deleted, {"_id": 0, "id": 1, "anonymized_at": 1}):
        # Die Frist der Nachweise (drei Jahre) zählt ab der damaligen Löschung.
        result = await account_erasure.erase_related(db, user, now, erased_at=user["anonymized_at"])
        accounts += 1
        images += result["images"]
    return f"{accounts} deleted accounts cleaned, {images} images removed"


async def migrate_points_scheme_templates(db) -> str:
    """Externe Serien (#1741): die Punkteschema-Vorlagen als Daten in den Einstellungen (``points_schemes``). Angelegt
    wird nur, was fehlt - eine bearbeitete Vorlage bleibt; Serien, Termine oder Ergebnisse legt die Migration nie an."""
    from services import reference_series

    added = await reference_series.add_missing_templates(db)
    return f"{added} points scheme templates added"


async def migrate_round_countries(db) -> str:
    """Flaggen (#1925): bestehende Termine bekommen ihr Land aus Ort bzw. Titel - nur, wo das Feld leer ist und niemand
    von Hand „ohne Flagge“ gewählt hat. Ein gesetztes Land bleibt, ein Termin ohne Treffer bleibt leer."""
    from services.round_countries import detect_country

    empty = {"country_code": {"$in": [None, ""]}, "country_auto": {"$ne": False}}
    filled = 0
    async for item in db.reference_rounds.find(empty, {"_id": 0, "id": 1, "venue": 1, "title": 1}):
        code = detect_country(item.get("venue"), item.get("title"))
        if code:
            await db.reference_rounds.update_one({"id": item["id"], **empty},
                                                 {"$set": {"country_code": code, "country_auto": True}})
            filled += 1
    return f"{filled} round countries filled"


async def migrate_series_own_teams(db) -> str:
    """Mehrere eigene Teams (#1926): das bisherige Feld ``team_name`` wird das erste (und einzige) eigene Team der
    Liste ``own_teams``. Eine Saison, die schon eine Liste hat, bleibt; ``team_name`` bleibt für ältere Leser stehen."""
    from services.own_teams import clean_teams

    moved = 0
    async for item in db.reference_series.find(
            {"own_teams": {"$in": [None, []]}, "team_name": {"$nin": [None, ""]}},
            {"_id": 0, "id": 1, "team_name": 1}):
        teams = clean_teams([item.get("team_name")])
        if teams:
            await db.reference_series.update_one({"id": item["id"], "own_teams": {"$in": [None, []]}},
                                                 {"$set": {"own_teams": teams}})
            moved += 1
    return f"{moved} series own teams taken over"


async def migrate_game_map_keys(db) -> str:
    """Map-Bibliothek (#1616): die Schlüssel von Name, Slug und weiteren Schreibweisen jeder Map in ``game_map_keys``
    belegen - darüber prüft die Bibliothek atomar, dass jede Schreibweise je Spiel zu genau einer Map führt. Bei einem
    Altbestand mit Doppelten gewinnt die Map, die in der Reihenfolge zuerst steht; die andere behält ihren Text."""
    from pymongo.errors import DuplicateKeyError as Duplicate

    from services.game_maps import spelling_keys

    filled = skipped = 0
    rows = await db.game_maps.find({}, {"_id": 0, "id": 1, "game_id": 1, "name": 1, "slug": 1, "aliases": 1,
                                        "order": 1}).to_list(None)
    for row in sorted(rows, key=lambda item: (str(item.get("game_id")), item.get("order") or 0)):
        for key in spelling_keys(row.get("name"), row.get("slug"), row.get("aliases")):
            if await db.game_map_keys.find_one({"game_id": row["game_id"], "key": key}, {"_id": 1}):
                skipped += 1
                continue
            try:
                await db.game_map_keys.insert_one({"game_id": row["game_id"], "key": key, "map_id": row["id"]})
                filled += 1
            except Duplicate:
                skipped += 1
    return f"{filled} map spellings reserved, {skipped} skipped"


def _row_teams_filled(rows, defaults: dict, rules: dict) -> tuple[list, int]:
    """Zeilen mit Teilnehmer und leerem Team bekommen dessen Standard-Team (Migration 10). Ein Eintrag wie
    „Ersatzfahrer“ steht schon im Feld und bleibt; ein Standard-Team aus ``no_team_names`` wird nie eingetragen."""
    from services.scoring_rules import is_no_team

    out, filled = [], 0
    for row in rows or []:
        team = " ".join(str(row.get("team") or "").split())
        default = " ".join(str(defaults.get(row.get("participant_id")) or "").split())
        if not team and row.get("participant_id") and default and not is_no_team(default, rules):
            row = {**row, "team": default}
            filled += 1
        out.append(row)
    return out, filled


async def migrate_result_row_teams(db) -> str:
    """Leeres Team heißt kein Team (#1960): bisher zählte eine Ergebniszeile ohne Team still für das Standard-Team ihres
    Teilnehmers. Damit bestehende Saisons keine Punkte verlieren, bekommen solche Zeilen dieses Standard-Team einmal als
    echten Wert - nur in Saisons mit Teamwertung, im Blatt und im Entwurf daneben. Danach wird die Saison neu gerechnet;
    je Saison ein Protokolleintrag mit der Zahl. Ein zweiter Lauf findet nichts mehr (idempotent)."""
    from services import reference_series
    from services.scoring_rules import normalize_rules

    now = datetime.now(timezone.utc).isoformat()
    total = seasons = 0
    async for series in db.reference_series.find({"rules.team_scoring.enabled": True}, {"_id": 0}):
        try:
            rules = normalize_rules(series.get("rules"))
        except ValueError:
            continue
        defaults = {person["id"]: person.get("default_team") async for person in db.reference_participants.find(
            {"series_id": series["id"]}, {"_id": 0, "id": 1, "default_team": 1})}
        filled_rows, round_ids = 0, []
        async for sheet in db.reference_round_results.find({"series_id": series["id"]}, {"_id": 0}):
            changes, count = {}, 0
            rows, filled = _row_teams_filled(sheet.get("rows"), defaults, rules)
            if filled:
                changes["rows"], count = rows, count + filled
            draft = sheet.get("pending_draft")
            if isinstance(draft, dict):
                rows, filled = _row_teams_filled(draft.get("rows"), defaults, rules)
                if filled:
                    changes["pending_draft.rows"], count = rows, count + filled
            if changes:
                await db.reference_round_results.update_one({"id": sheet["id"]}, {"$set": changes})
                filled_rows += count
                round_ids.append(sheet.get("round_id"))
        if not filled_rows:
            continue
        await db.audit_logs.insert_one({
            "id": new_id(), "action": "reference_series.team_backfill", "actor_id": "migration",
            "target_id": series["id"], "created_at": now,
            "data": {"rows": filled_rows, "round_ids": round_ids, "reason": "#1960 leeres Team heißt kein Team"}})
        await reference_series.recompute_standings(db, series)
        total += filled_rows
        seasons += 1
    return f"{total} result rows in {seasons} series got their default team"


MIGRATIONS = (
    (1, "encrypt_legacy_integration_credentials", migrate_plaintext_secrets),
    (2, "team_leader_role_to_player", migrate_team_leader_role),
    (3, "discord_webhooks_to_bot", migrate_discord_webhooks_to_bot),
    (4, "deleted_account_leftovers", migrate_deleted_account_leftovers),
    # #1029: dieselben Schritte noch einmal - die Löschung räumt seither mehr Sammlungen auf (services/personal_data.py).
    (5, "deleted_account_leftovers_1029", migrate_deleted_account_leftovers),
    (6, "reference_points_schemes", migrate_points_scheme_templates),
    (7, "reference_round_countries", migrate_round_countries),
    (8, "reference_series_own_teams", migrate_series_own_teams),
    (9, "game_map_spelling_keys", migrate_game_map_keys),  # #1616
    (10, "reference_result_row_teams", migrate_result_row_teams),  # #1960: leeres Team heißt kein Team
)


async def run_pending_migrations(db) -> list[dict]:
    """Run each migration once. A short lease avoids startup-worker races."""
    now = datetime.now(timezone.utc)
    owner = f"{socket.gethostname()}:{os.getpid()}:{new_id()}"
    try:
        lease = await db.schema_migration_lock.find_one_and_update(
            {
                "_id": "global",
                "$or": [
                    {"owner": owner},
                    {"locked_until": {"$lt": now}},
                    {"locked_until": {"$exists": False}},
                ],
            },
            {"$set": {"owner": owner, "locked_until": now + timedelta(minutes=10), "updated_at": now}},
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
    except DuplicateKeyError:
        return []
    if not lease or lease.get("owner") != owner:
        return []

    applied: list[dict] = []
    try:
        completed = set(await db.schema_migrations.distinct("version"))
        for version, name, migration in MIGRATIONS:
            if version in completed:
                continue
            result = await migration(db)
            finished_at = datetime.now(timezone.utc)
            record = {"version": version, "name": name, "result": result, "applied_at": finished_at}
            await db.schema_migrations.update_one(
                {"version": version}, {"$setOnInsert": record}, upsert=True,
            )
            applied.append(record)
        return applied
    finally:
        await db.schema_migration_lock.update_one(
            {"_id": "global", "owner": owner},
            {"$set": {"locked_until": datetime.now(timezone.utc)}, "$unset": {"owner": ""}},
        )
