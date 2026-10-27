"""Small, ordered MongoDB migration runner for idempotent schema/data changes.

Eine Migration, die nur teilweise fertig wird, wirft ``MigrationIncomplete``: sie wird nicht als erledigt vermerkt und
läuft beim nächsten Start erneut, der Start selbst geht weiter. Lange Migrationen verlängern die Sperre des Laufs
zwischen ihren Schritten (``extend_migration_lease``)."""
from __future__ import annotations

import contextvars
import logging
import os
import socket
from datetime import datetime, timedelta, timezone

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from models import new_id
from services.secret_migration import migrate_plaintext_secrets
from services.shop_motifs import migrate_motif_variants
from services.shop_schema import migrate_shop_data_model

logger = logging.getLogger("tls.migrations")
# So lange gilt die Sperre eines Migrationslaufs ab dem Holen bzw. ab der letzten Verlängerung.
LEASE_MINUTES = 10
_LEASE_OWNER: contextvars.ContextVar[str | None] = contextvars.ContextVar("migration_lease_owner", default=None)


class MigrationIncomplete(RuntimeError):
    """Eine Migration ist nur teilweise durchgelaufen: sie bleibt offen und läuft beim nächsten Start erneut. Der Start
    geht weiter - ``run_pending_migrations`` protokolliert sie und fährt mit den übrigen fort."""


async def extend_migration_lease(db) -> bool:
    """Die Sperre des laufenden Migrationslaufs um ``LEASE_MINUTES`` verlängern - für lange Migrationen zwischen zwei
    Schritten. Ohne laufenden Lauf (Tests, Aufruf von Hand) ``True``; gehört die Sperre nicht mehr diesem Lauf,
    ``False`` - dann hört die Migration auf."""
    owner = _LEASE_OWNER.get()
    if owner is None:
        return True
    now = datetime.now(timezone.utc)
    result = await db.schema_migration_lock.update_one(
        {"_id": "global", "owner": owner},
        {"$set": {"locked_until": now + timedelta(minutes=LEASE_MINUTES), "updated_at": now}})
    return getattr(result, "matched_count", 0) == 1


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


TEAM_BACKFILL_REASON = "#1960 leeres Team heißt kein Team"


def _sheet_updates(sheets, defaults: dict, rules: dict) -> list[tuple[dict, dict, int, str | None]]:
    """Je Blatt mit etwas zu füllen (Blatt und Entwurf daneben): Filter mit ``version``, Änderung, Zahl der Zeilen,
    Termin. Der Versionsfilter sorgt dafür, dass nie über ein Blatt geschrieben wird, das sich seit dem Lesen geändert
    hat."""
    out = []
    for sheet in sheets:
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
            out.append(({"id": sheet["id"], "version": sheet.get("version")}, {"$set": changes}, count,
                        sheet.get("round_id")))
    return out


async def _backfill_series(db, series_id: str, now: str) -> tuple[int, bool]:
    """Eine Saison unter ihrer Sperre (``reference_series.series_write``) füllen. Vor dem ersten Schreiben merkt sich die
    Saison ``team_backfill_pending``; erst nach Neurechnen und Protokoll gilt sie als fertig (``team_backfill_at``).
    Bricht etwas dazwischen ab, rechnet der nächste Lauf sie neu und protokolliert, auch wenn nichts mehr zu füllen ist.
    Liefert (gefüllte Zeilen, neu gerechnet)."""
    from services import reference_series
    from services.scoring_rules import normalize_rules

    async with reference_series.series_write(db, series_id):
        series = await db.reference_series.find_one({"id": series_id}, {"_id": 0})
        if not series or series.get("team_backfill_at"):
            return 0, False
        rules = normalize_rules(series.get("rules"))
        defaults = {person["id"]: person.get("default_team") async for person in db.reference_participants.find(
            {"series_id": series_id}, {"_id": 0, "id": 1, "default_team": 1})}
        sheets = await db.reference_round_results.find(
            {"series_id": series_id}, {"_id": 0, "id": 1, "round_id": 1, "version": 1, "rows": 1,
                                       "pending_draft": 1}).to_list(None) if defaults else []
        updates = _sheet_updates(sheets, defaults, rules)
        filled, round_ids = 0, []
        if updates:
            await db.reference_series.update_one({"id": series_id}, {"$set": {"team_backfill_pending.started_at": now}})
            try:
                for selector, change, count, round_id in updates:
                    result = await db.reference_round_results.update_one(selector, change)
                    if getattr(result, "matched_count", 0) != 1:
                        raise RuntimeError(f"Ergebnisblatt {selector['id']} hat sich beim Füllen geändert")
                    filled += count
                    round_ids.append(round_id)
            finally:
                if filled:
                    await db.reference_series.update_one({"id": series_id}, {
                        "$inc": {"team_backfill_pending.rows": filled},
                        "$addToSet": {"team_backfill_pending.round_ids": {"$each": round_ids}}})
        pending = (await db.reference_series.find_one(
            {"id": series_id}, {"_id": 0, "team_backfill_pending": 1}) or {}).get("team_backfill_pending")
        if pending:
            await reference_series.recompute_standings(db, series)
            await db.audit_logs.insert_one({
                "id": new_id(), "action": "reference_series.team_backfill", "actor_id": "migration",
                "target_id": series_id, "created_at": now,
                "data": {"rows": pending.get("rows", 0), "round_ids": pending.get("round_ids", []),
                         "reason": TEAM_BACKFILL_REASON}})
        await db.reference_series.update_one({"id": series_id}, {"$set": {"team_backfill_at": now},
                                                                 "$unset": {"team_backfill_pending": ""}})
        return filled, bool(pending)


async def migrate_result_row_teams(db) -> str:
    """Leeres Team heißt kein Team (#1960): bisher zählte eine Ergebniszeile ohne Team still für das Standard-Team ihres
    Teilnehmers. Damit keine Saison Punkte verliert, bekommen solche Zeilen dieses Standard-Team einmal als echten Wert -
    in allen Saisons mit Teilnehmern (auch ohne Teamwertung: wird sie später eingeschaltet, stimmen die Teams schon),
    im Blatt und im Entwurf daneben. Je Saison unter ihrer Sperre, mit Versionsfilter je Blatt; neu gerechnet und
    protokolliert (``reference_series.team_backfill`` mit der Zahl) wird nur, wo sich etwas geändert hat.

    Fehler: eine Saison, die scheitert (besetzt, Blatt geändert, Neurechnen), hält die anderen nicht auf. Am Ende wirft
    die Migration ``MigrationIncomplete`` - sie bleibt offen, und der nächste Start nimmt sich die Saisons ohne
    ``team_backfill_at`` erneut vor. Last: je Blatt mit etwas zu füllen ein kurzes ``update_one``, je Saison wenige
    Dutzend; die Sperre des Laufs wird vor jeder Saison verlängert, die 10 Minuten gelten also je Saison."""
    now = datetime.now(timezone.utc).isoformat()
    series_ids = [item["id"] async for item in db.reference_series.find(
        {"team_backfill_at": {"$exists": False}}, {"_id": 0, "id": 1}) if item.get("id")]
    rows = recomputed = checked = 0
    failed: list[str] = []
    for series_id in series_ids:
        if not await extend_migration_lease(db):
            raise MigrationIncomplete("lease lost - the next start continues")
        try:
            filled, changed = await _backfill_series(db, series_id, now)
        except Exception:
            logger.exception("Migration 10: Saison %s nicht fertig - der nächste Start versucht es erneut", series_id)
            failed.append(series_id)
            continue
        rows += filled
        recomputed += int(changed)
        checked += 1
    if failed:
        raise MigrationIncomplete(f"{len(failed)} series not finished: {', '.join(failed[:20])}")
    return f"{rows} result rows filled, {recomputed} series recomputed, {checked} series checked"


DOUBLE_UP_SHEETS = ({"double_up": True}, {"pending_draft.double_up": True},
                    {"rows.partner_id": {"$exists": True, "$nin": [None, ""]}})


DOUBLE_UP_REASON = "#2015 Double Up bleibt nach Team-Platz"


async def _double_up_series(db, series_id: str, now: str) -> bool:
    """Eine Saison unter ihrer Sperre: hat sie ein Double-Up-Blatt und noch keine Regel, erst die Stände mit
    ``team_place`` neu rechnen, dann die Regel speichern und protokollieren. So bleibt nach einem Abbruch nie eine
    Saison mit Regel, aber 2k−1-Ständen stehen - der nächste Lauf macht sie fertig. Liefert, ob sie geändert wurde."""
    from services import reference_series

    async with reference_series.series_write(db, series_id):
        series = await db.reference_series.find_one({"id": series_id}, {"_id": 0})
        rules = (series or {}).get("rules")
        if not series or not isinstance(rules, dict) or rules.get("double_up_points"):
            return False
        sheet = await db.reference_round_results.find_one({"series_id": series_id, "$or": list(DOUBLE_UP_SHEETS)},
                                                          {"_id": 1})
        if sheet is None:
            return False
        kept = {**rules, "double_up_points": "team_place"}
        await reference_series.recompute_standings(db, {**series, "rules": kept})
        result = await db.reference_series.update_one(
            {"id": series_id, "rules.double_up_points": {"$exists": False}}, {"$set": {"rules": kept}})
        if getattr(result, "matched_count", 0) != 1:
            raise RuntimeError(f"Saison {series_id} hat sich beim Setzen der Regel geändert")
        await db.audit_logs.insert_one({
            "id": new_id(), "action": "reference_series.double_up_points", "actor_id": "migration",
            "target_id": series_id, "created_at": now,
            "data": {"double_up_points": "team_place", "reason": DOUBLE_UP_REASON}})
        return True


async def migrate_double_up_points(db) -> str:
    """Double-Up-Punkte (#2015): neue Saisons rechnen ein Team auf Platz k wie Einzelplatz 2k−1 (wie PineApps). Damit
    sich bestehende Tabellen nicht still ändern, bekommen Saisons, die schon ein Double-Up-Blatt haben (veröffentlicht
    oder Entwurf), ausdrücklich die bisherige Rechnung ``team_place`` in ihre Regeln - ohne neue Regel-Version, aber
    neu gerechnet (falls schon ein Stand mit der neuen Vorgabe gespeichert wurde) und protokolliert. Umstellen auf 2k−1
    ist danach eine Regeländerung in der Verwaltung. Eine Saison, die die Regel schon trägt, bleibt.

    Wie Migration 10: je Saison unter ihrer Sperre, eine Saison mit Fehler hält die anderen nicht auf; am Ende wirft die
    Migration ``MigrationIncomplete``, und der nächste Start holt die fehlenden nach. Die Sperre des Laufs wird vor
    jeder Saison verlängert."""
    now = datetime.now(timezone.utc).isoformat()
    series_ids = [item["id"] async for item in db.reference_series.find(
        {"rules.double_up_points": {"$exists": False}}, {"_id": 0, "id": 1}) if item.get("id")]
    kept, failed = 0, []
    for series_id in series_ids:
        if not await extend_migration_lease(db):
            raise MigrationIncomplete("lease lost - the next start continues")
        try:
            kept += int(await _double_up_series(db, series_id, now))
        except Exception:
            logger.exception("Migration 11: Saison %s nicht fertig - der nächste Start versucht es erneut", series_id)
            failed.append(series_id)
    if failed:
        raise MigrationIncomplete(f"{len(failed)} series not finished: {', '.join(failed[:20])}")
    return f"{kept} series keep double up points by team place"


async def migrate_kind_templates(db) -> str:
    """Art-Profil (#2024): die neue Vorlage „TFT-Turniertag“ anlegen und „Formel 1“ auf die Rennliga beschränken - nur,
    solange sie unverändert ist. Bestehende Saisons behalten ihre Regeln; die Vorlage wird nur beim Anlegen kopiert."""
    from services import reference_series

    added = await reference_series.add_missing_templates(db)
    narrowed = await reference_series.narrow_formula_1(db)
    return f"{added} points scheme templates added, formula 1 {'narrowed' if narrowed else 'kept'}"


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
    (11, "reference_double_up_points", migrate_double_up_points),  # #2015: bestehende Double-Up-Saisons bleiben bei k
    (12, "reference_kind_templates", migrate_kind_templates),  # #2024: TFT-Vorlage, „Formel 1“ nur für die Rennliga
    # #1703: Shop-Datenmodell; Trockenlauf und Rückweg in services/shop_schema.py bzw. backend/scripts/shop_schema.py
    (13, "shop_data_model", migrate_shop_data_model),
    # #2069: Designs werden Motive (Fassung für dunkle bzw. helle Shirts); Trockenlauf und Rückweg in
    # services/shop_motifs.py bzw. backend/scripts/shop_motifs.py
    (14, "shop_motif_variants", migrate_motif_variants),
)


async def run_pending_migrations(db) -> list[dict]:
    """Run each migration once. A short lease avoids startup-worker races. Eine Migration, die ``MigrationIncomplete``
    wirft, wird nicht vermerkt und läuft beim nächsten Start erneut; die übrigen laufen weiter."""
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
            {"$set": {"owner": owner, "locked_until": now + timedelta(minutes=LEASE_MINUTES), "updated_at": now}},
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
    except DuplicateKeyError:
        return []
    if not lease or lease.get("owner") != owner:
        return []

    applied: list[dict] = []
    token = _LEASE_OWNER.set(owner)
    try:
        completed = set(await db.schema_migrations.distinct("version"))
        for version, name, migration in MIGRATIONS:
            if version in completed:
                continue
            try:
                result = await migration(db)
            except MigrationIncomplete as exc:
                logger.error("[migration] %s %s ist noch nicht fertig und läuft beim nächsten Start erneut: %s",
                             version, name, exc)
                continue
            finished_at = datetime.now(timezone.utc)
            record = {"version": version, "name": name, "result": result, "applied_at": finished_at}
            await db.schema_migrations.update_one(
                {"version": version}, {"$setOnInsert": record}, upsert=True,
            )
            applied.append(record)
        return applied
    finally:
        _LEASE_OWNER.reset(token)
        await db.schema_migration_lock.update_one(
            {"_id": "global", "owner": owner},
            {"$set": {"locked_until": datetime.now(timezone.utc)}, "$unset": {"owner": ""}},
        )
