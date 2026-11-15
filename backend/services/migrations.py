"""Small, ordered MongoDB migration runner for idempotent schema/data changes.

Startablauf (#1006, ``ensure_migrations``): Genau ein Start holt die Sperre ``schema_migration_lock`` (atomar, mit
Bedingung und eigenem Token) und arbeitet die offenen Migrationen ab. Jeder andere Start wartet, bis der Halter fertig
ist bzw. der Stand komplett ist - höchstens ``MIGRATION_WAIT_SECONDS``, dann bricht er mit klarer Meldung ab. Bis dahin
bedient er nichts, und ``/api/health/ready`` meldet erst nach dem Lauf bereit (``migrations_ready``).

Die Sperre gilt ``MIGRATION_LEASE_SECONDS`` und wird im Takt ``MIGRATION_LEASE_RENEW_SECONDS`` verlängert. Stirbt der
Halter, läuft sie ab, und ein anderer Start übernimmt. Gelingt die Verlängerung nicht rechtzeitig oder gehört die Sperre
inzwischen einem anderen, gilt sie als verloren: Die laufende Migration hört auf (Migrationen mit Schritten am nächsten
Schritt über ``extend_migration_lease``, sonst wird sie abgebrochen), wird nicht vermerkt und läuft beim nächsten Halter
von vorn - jede Migration ist darum so geschrieben, dass ein zweiter Lauf nur das Fehlende nachzieht.

Eine Migration, die nur teilweise fertig wird, wirft ``MigrationIncomplete``: sie wird nicht als erledigt vermerkt und
läuft beim nächsten Start erneut, der Start selbst geht weiter."""
from __future__ import annotations

import asyncio
import contextvars
import logging
import os
import socket
from datetime import datetime, timedelta, timezone
from time import monotonic

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError, PyMongoError

from models import new_id
from services.log_safe import log_safe
from services.secret_migration import migrate_plaintext_secrets
from services.shop_motifs import migrate_motif_variants
from services.shop_schema import migrate_shop_data_model

logger = logging.getLogger("tls.migrations")
LOCK_ID = "global"
# So oft sieht ein wartender Start nach, ob die Sperre frei bzw. der Stand komplett ist.
WAIT_POLL_SECONDS = 2.0
# So oft meldet ein wartender Start höchstens, auf wen er wartet.
WAIT_LOG_SECONDS = 30.0
# In diesen Zuständen ist der Migrationslauf dieses Prozesses abgeschlossen und die Anwendung bereit.
READY_STATES = frozenset({"done", "incomplete"})
# Lange Migrationen melden nach so vielen Einträgen ihren Stand ins Protokoll.
PROGRESS_EVERY = 100


class MigrationIncomplete(RuntimeError):
    """Eine Migration ist nur teilweise durchgelaufen: sie bleibt offen und läuft beim nächsten Start erneut. Der Start
    geht weiter - ``run_pending_migrations`` protokolliert sie und fährt mit den übrigen fort."""


class MigrationLeaseLost(RuntimeError):
    """Die Sperre gehört nicht mehr diesem Lauf: die laufende Migration ist abgebrochen und nicht vermerkt."""


class MigrationWaitTimeout(RuntimeError):
    """Ein anderer Start hielt die Sperre länger als ``MIGRATION_WAIT_SECONDS``."""


def _seconds_env(name: str, default: float, low: float, high: float) -> float:
    raw = os.environ.get(name, "").strip()
    try:
        value = float(raw) if raw else float(default)
    except ValueError:
        value = float(default)
    if value != value:  # NaN
        value = float(default)
    return min(max(value, low), high)


def lease_seconds() -> float:
    """Wie lange die Sperre ab dem Holen bzw. der letzten Verlängerung gilt (``MIGRATION_LEASE_SECONDS``, 30 bis 3600,
    Standard 180). So lange dauert es nach einem abgestürzten Halter höchstens, bis ein anderer Start übernimmt."""
    return _seconds_env("MIGRATION_LEASE_SECONDS", 180, 30, 3600)


def renew_seconds() -> float:
    """Takt der Verlängerung (``MIGRATION_LEASE_RENEW_SECONDS``, Standard ein Viertel der Sperre, höchstens die
    Hälfte). Bleibt die Verlängerung bis einen Takt vor Ablauf aus, gibt der Halter selbst auf."""
    lease = lease_seconds()
    return _seconds_env("MIGRATION_LEASE_RENEW_SECONDS", lease / 4, 1, lease / 2)


def wait_seconds() -> float:
    """So lange wartet ein Start ohne Sperre auf den Halter (``MIGRATION_WAIT_SECONDS``, 30 bis 86400, Standard 1800),
    dann bricht er ab; Docker startet ihn neu, und er wartet bzw. übernimmt von vorn."""
    return _seconds_env("MIGRATION_WAIT_SECONDS", 1800, 30, 86400)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class _Lease:
    """Die gehaltene Sperre eines Laufs. ``valid_until`` zählt auf der eigenen Uhr ab dem Absenden der letzten
    erfolgreichen Verlängerung - also nie später als das, was in der Datenbank steht."""

    def __init__(self, db, owner: str, ttl: float, renew_every: float, valid_until: float):
        self.db = db
        self.owner = owner
        self.ttl = ttl
        self.renew_every = renew_every
        self.valid_until = valid_until
        self.lost = asyncio.Event()
        self.reason = ""
        self.taken = False

    def remaining(self) -> float:
        return self.valid_until - monotonic()

    def expiring(self) -> bool:
        """Einen Takt vor Ablauf gibt der Halter auf - bevor ein anderer Start übernehmen darf."""
        return self.remaining() <= self.renew_every

    def mark_lost(self, reason: str, *, taken: bool = False) -> None:
        if self.lost.is_set():
            return
        self.reason, self.taken = reason, taken
        self.lost.set()
        logger.error("[migration] Sperre verloren (%s): die laufende Migration hört auf und wird nicht vermerkt",
                     reason)

    def grace_seconds(self) -> float:
        """So lange darf die laufende Migration nach dem Verlust noch bis zu ihrem nächsten Schritt laufen: bis kurz vor
        dem Ablauf, nie, wenn schon ein anderer die Sperre hat."""
        if self.taken:
            return 0.0
        return max(0.0, self.remaining() - 1.0)

    async def renew(self) -> bool:
        """Verlängern - nur mit eigenem Token und nur, solange die Sperre noch gilt. ``False``: sie ist verloren."""
        if self.lost.is_set():
            return False
        if self.expiring():
            self.mark_lost("nicht rechtzeitig verlängert")
            return False
        sent = monotonic()
        now = _utcnow()
        try:
            result = await asyncio.wait_for(self.db.schema_migration_lock.update_one(
                {"_id": LOCK_ID, "owner": self.owner, "locked_until": {"$gt": now}},
                {"$set": {"locked_until": now + timedelta(seconds=self.ttl), "updated_at": now}}),
                timeout=max(0.05, self.remaining() - self.renew_every))
        except (asyncio.TimeoutError, PyMongoError) as exc:
            logger.warning("[migration] Sperre nicht verlängert (%s), nächster Versuch im Takt", type(exc).__name__)
            if self.expiring():
                self.mark_lost("nicht rechtzeitig verlängert")
            return not self.lost.is_set()
        if getattr(result, "matched_count", 0) == 1:
            self.valid_until = sent + self.ttl
            return True
        self.mark_lost("abgelaufen oder von einem anderen Start übernommen", taken=True)
        return False

    async def keep_alive(self) -> None:
        """Im Takt verlängern, bis der Lauf endet oder die Sperre verloren ist."""
        while not self.lost.is_set():
            await asyncio.sleep(max(0.0, min(self.renew_every, self.remaining() - self.renew_every)))
            await self.renew()


_LEASE: contextvars.ContextVar[_Lease | None] = contextvars.ContextVar("migration_lease", default=None)
_STATUS: dict = {"state": "not_started"}


def _set_status(state: str, **extra) -> None:
    _STATUS.clear()
    _STATUS.update({"state": state, "since": _utcnow().isoformat(timespec="seconds"), **extra})


def migration_status() -> dict:
    """Zustand des Migrationslaufs dieses Prozesses: ``not_started``, ``waiting``, ``running``, ``done``,
    ``incomplete`` (Lauf fertig, einzelne Migrationen bewusst offen), ``lost``, ``timeout`` oder ``error``."""
    return dict(_STATUS)


def migrations_ready() -> bool:
    """Für ``/api/health/ready``: der Lauf dieses Prozesses ist abgeschlossen, keine Migration läuft mehr."""
    return _STATUS.get("state") in READY_STATES


def migration_lease_ok() -> bool:
    """Ohne Datenbankzugriff: darf die laufende Migration weiterschreiben? Außerhalb eines Laufs immer ``True``."""
    lease = _LEASE.get()
    return lease is None or not lease.lost.is_set()


async def extend_migration_lease(db) -> bool:
    """Die Sperre des laufenden Migrationslaufs sofort verlängern - für lange Migrationen zwischen zwei Schritten (der
    Takt im Hintergrund verlängert ohnehin). Ohne laufenden Lauf (Tests, Aufruf von Hand) ``True``; gehört die Sperre
    nicht mehr diesem Lauf, ``False`` - dann hört die Migration auf."""
    lease = _LEASE.get()
    if lease is None:
        return True
    return await lease.renew()


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
        # Lange Läufe (#1006): je Konto ein abgeschlossener Schritt; ohne Sperre hört die Migration davor auf, der
        # nächste Lauf zieht dieselben Schritte noch einmal (sie finden nur, was noch übrig ist).
        if not migration_lease_ok():
            raise MigrationIncomplete(f"lease lost after {accounts} accounts - the next run continues")
        # Die Frist der Nachweise (drei Jahre) zählt ab der damaligen Löschung.
        result = await account_erasure.erase_related(db, user, now, erased_at=user["anonymized_at"])
        accounts += 1
        images += result["images"]
        if accounts % PROGRESS_EVERY == 0:
            logger.info("[migration] gelöschte Konten: %s bereinigt, %s Bilder entfernt", accounts, images)
    return f"{accounts} deleted accounts cleaned, {images} images removed"


async def migrate_anonymized_profile_fields(db) -> str:
    """Konto löschen (#2118): früher gelöschte Konten behielten Profilfelder (Handles, Lieblingsspiele, Plattformen,
    Datenschutz-Stufen). Einmal dasselbe Konto-Update wie beim Löschen nachziehen - Name und Ersatzadresse bleiben."""
    from services import account_erasure

    deleted = {"anonymized_at": {"$exists": True, "$ne": None}, "is_active": False,
               "display_name": account_erasure.GONE_DISPLAY_NAME,
               "email": {"$regex": r"^deleted_[^@]*@deleted\.(invalid|local)$"}}
    update = account_erasure.anonymized_account_update(datetime.now(timezone.utc).isoformat())
    # Der Zeitpunkt der Löschung bleibt der von damals.
    update["$set"].pop("anonymized_at")
    result = await db.users.update_many(deleted, update)
    return f"{result.modified_count} deleted accounts cleared"


async def migrate_league_published_at(db) -> str:
    """Liga (#2106): die Adresse einer Liga bleibt nach der ersten Veröffentlichung (``leagues.published_at``). Ligen,
    deren Season schon sichtbar ist oder lief, bekommen den Zeitpunkt nachgetragen."""
    from services import league_service

    marked = await league_service.backfill_published_at(db)
    return f"{marked} leagues marked as published"


async def migrate_league_roster_backfill(db) -> str:
    """Liga-Kader (#2108): Co-Teams, die vor dem Kader zugeteilt wurden, bekommen ihre Einträge mit Co-Team und - wo
    sie im Profil steht - festgehaltener Spiel-ID. Idempotent (``league_roster.backfill``)."""
    from services import league_roster

    recorded = await league_roster.backfill(db)
    return f"{recorded} league roster rows checked"


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


async def migrate_tournament_point_duplicates(db) -> str:
    """Jahreswertung (#2123, TA22): doppelte Jahrespunkte je Turnier, Person und Team (nach einem Wechsel von Mini,
    Normal oder Major zwischen zwei Veröffentlichungen) bereinigen - einer bleibt, der Rest steht vorher im Protokoll.
    Doppel über mehrere oder in abgeschlossenen Wertungen werden nur gemeldet, nie gelöscht.
    Trockenlauf: ``backend/scripts/season_points_duplicates.py``."""
    from services import season_points_cleanup

    return await season_points_cleanup.apply(db)


async def migrate_user_socials_to_profile(db) -> str:
    """Altdaten ``user_socials`` in die Profilfelder (#2113, L-A12) - Regeln in ``services/user_socials_migration.py``."""
    from services import user_socials_migration

    async def keep_lease() -> bool:
        return await extend_migration_lease(db)

    try:
        return await user_socials_migration.migrate(db, keep_lease)
    except RuntimeError as exc:
        raise MigrationIncomplete(str(exc)) from exc


async def migrate_squad_game_names(db) -> str:
    """Co-Teams mit altem Freitext als Spiel (#2128): Trifft der Text genau einen Spielnamen (ohne Groß/klein), wird er zur
    Kennung - sonst käme das Co-Team nicht in die Liga. Der Rest bleibt, wie er ist; die Zuteilung nennt ihn, und die
    Teamleitung wählt aus der Liste. Läuft ein zweites Mal ohne Wirkung."""
    def norm(value) -> str:
        return " ".join(str(value or "").split()).casefold()

    games = await db.games.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(5000)
    known = {game["id"] for game in games}
    by_name: dict[str, list[str]] = {}
    for game in games:
        by_name.setdefault(norm(game.get("name")), []).append(game["id"])
    moved = left = 0
    async for squad in db.team_squads.find({"game_id": {"$nin": [None, ""]}}, {"_id": 0, "id": 1, "game_id": 1}):
        if squad["game_id"] in known or not norm(squad["game_id"]):
            continue
        hits = by_name.get(norm(squad["game_id"])) or []
        if len(hits) == 1:
            await db.team_squads.update_one({"id": squad["id"], "game_id": squad["game_id"]}, {"$set": {"game_id": hits[0]}})
            moved += 1
        else:
            left += 1
    if left:
        logger.warning("[migration] %s Co-Teams haben einen alten Spielnamen, der zu keinem Spiel passt", left)
    await db.audit_logs.insert_one({
        "id": new_id(), "action": "team.squad.game_names", "target_id": None, "actor_id": None,
        "data": {"moved": moved, "left": left}, "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return f"{moved} squads moved to a game id, {left} left"


async def migrate_one_hide_field(db) -> str:
    """Je Eintrag ein Feld zum Ausblenden: ``is_active`` (#2130). Wer heute verborgen ist, bleibt es, wer sichtbar ist, auch.

    Sponsor: „Pausiert“ und „Gekündigt“ verbargen ihn in der Sponsorenliste, am TV und im PDF, also wird ``is_active`` aus;
    alle anderen Vertragsstatus wirkten nicht, die Laufzeit zählt weiter. Danach gibt es ``contract_status`` nicht mehr.
    Eine Ausnahme ist gewollt: Event-Seiten und Mails fragten den Vertragsstatus nie ab und zeigten solche Sponsoren
    weiter - mit ``is_active`` aus sind sie auch dort weg. Referenz: „Archiviert“ blendete nichts aus; solche Referenzen
    heißen jetzt „Abgeschlossen“, ``is_active`` bleibt, wie es ist.

    Das Protokoll steht je Abschnitt vor dem Schreiben, mit Namen und altem Status: Bricht der Lauf ab, ist nichts
    verloren, und der nächste Lauf nennt, was noch fehlt. Altbestand ohne ``id`` wird über ``_id`` umgestellt. Läuft ein
    zweites Mal ohne Wirkung."""
    async def log(**data) -> None:
        await db.audit_logs.insert_one({
            "id": new_id(), "action": "content.one_hide_field", "target_id": None, "actor_id": None,
            "data": data, "created_at": datetime.now(timezone.utc).isoformat(),
        })

    rows = await db.sponsors.find({"contract_status": {"$exists": True}}, {"id": 1, "name": 1, "is_active": 1, "contract_status": 1}).to_list(None)
    to_hide = {
        row["_id"]: str(row.get("contract_status") or "").strip().lower() for row in rows
        if str(row.get("contract_status") or "").strip().lower() in {"paused", "cancelled"} and row.get("is_active") is not False
    }
    hidden = [{"id": row.get("id"), "name": row.get("name"), "contract_status": to_hide[row["_id"]]} for row in rows if row["_id"] in to_hide]
    if rows:
        await log(section="sponsors", sponsors_hidden=hidden, sponsors_cleared=len(rows))
    for row in rows:
        change: dict = {"$unset": {"contract_status": ""}}
        if row["_id"] in to_hide:
            change["$set"] = {"is_active": False}
        await db.sponsors.update_one({"_id": row["_id"]}, change)

    archived = await db.references.find({"status": "archived"}, {"_id": 0, "id": 1, "title": 1}).to_list(None)
    if archived:
        await log(section="references", references_renamed=archived)
        await db.references.update_many({"status": "archived"}, {"$set": {"status": "completed"}})
    return f"{len(hidden)} sponsors hidden, {len(rows)} contract statuses cleared, {len(archived)} references renamed"


async def migrate_achievements_recount(db) -> str:
    """Stiller Modus für die Neuberechnung der Erfolge (#2340): an, bevor die korrigierten Zähler (#2337, #2338, #2339)
    kommen. Steht der Eintrag schon, bleibt er; ohne Konten gibt es nichts nachzurechnen. Abgeschlossen wird von Hand
    (Admin → Erfolge → Übersicht oder backend/scripts/achievements_recount.py)."""
    from services.achievement_recount import begin
    return await begin(db)


CATALOG_RECHECK_2339 = "2339"


async def migrate_achievements_catalog_recheck(db) -> str:
    """#2339 ändert den Erfolge-Katalog (nicht mehr Erreichbares, Kategorie-Meister, Sammler, Geheimnisträger, Hundert
    Prozent, Comeback, Streckenrekord, Eiserner Löwe): Läuft der stille Modus (#2340) noch, prüft ``recheck`` alle Konten
    still neu - sonst meldete ein Ereignis Altansprüche zu geänderten Stufen laut. Ist er schon beendet, geschieht nichts.
    Idempotent: Die Kennung landet im Eintrag des stillen Modus, ein zweiter Lauf prüft nicht noch einmal.
    Ausgewertet wird über die Warteschlange - erst nach dem Seed, der den neuen Katalog schreibt (server.py)."""
    from services.achievement_recount import SETTING_ID, recheck

    doc = await db.settings.find_one({"id": SETTING_ID, "active": True}, {"_id": 0, "id": 1, "rechecked_for": 1})
    if not doc:
        return "silent mode off - nothing to recheck"
    if CATALOG_RECHECK_2339 in (doc.get("rechecked_for") or []):
        return "already rechecked for 2339"
    result = await recheck(db)
    await db.settings.update_one({"id": SETTING_ID}, {"$addToSet": {"rechecked_for": CATALOG_RECHECK_2339}})
    return result


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
    # #2118: gelöschte Konten verlieren jedes Profilfeld (services/account_erasure.py).
    (15, "deleted_account_profile_fields", migrate_anonymized_profile_fields),
    # #2106: die Adresse einer schon veröffentlichten Liga bleibt (services/league_service.py, slug_locked).
    (16, "league_published_at", migrate_league_published_at),
    # #2108: Liga-Kader mit Spiel-ID je Season für schon zugeteilte Co-Teams nachziehen (services/league_roster.py).
    (17, "league_roster_backfill", migrate_league_roster_backfill),
    # #2123: doppelte Jahrespunkte je Turnier entfernen (services/season_points_cleanup.py, Trockenlauf
    # backend/scripts/season_points_duplicates.py).
    (18, "season_points_tournament_duplicates", migrate_tournament_point_duplicates),
    # #2113: alte Einträge aus user_socials ziehen in die Profilfelder um (services/user_socials_migration.py).
    (19, "user_socials_to_profile_fields", migrate_user_socials_to_profile),
    # #2128: alter Freitext als Spiel eines Co-Teams wird zur Kennung, wenn er genau einen Spielnamen trifft.
    (20, "squad_game_names", migrate_squad_game_names),
    # #2130: Sponsor und Referenz blenden nur noch über ``is_active`` aus; die Sichtbarkeit bleibt, wie sie war.
    (21, "one_hide_field", migrate_one_hide_field),
    # #2340: Erfolge still nachrechnen, bis die Neuberechnung abgeschlossen ist (services/achievement_recount.py).
    (22, "achievements_recount_silent", migrate_achievements_recount),
    # #2339: neuer Katalog - im stillen Modus alle still neu prüfen (services/achievement_recount.recheck), sonst nichts.
    (23, "achievements_catalog_recheck_2339", migrate_achievements_catalog_recheck),
)


async def _acquire_lease(db) -> _Lease | None:
    """Die Sperre holen - atomar: nur, wenn sie frei oder abgelaufen ist. ``None``: ein anderer Start hält sie."""
    ttl = lease_seconds()
    owner = f"{socket.gethostname()}:{os.getpid()}:{new_id()}"
    sent = monotonic()
    now = _utcnow()
    try:
        lock = await db.schema_migration_lock.find_one_and_update(
            {
                "_id": LOCK_ID,
                "$or": [
                    {"owner": owner},
                    {"locked_until": {"$lt": now}},
                    {"locked_until": {"$exists": False}},
                ],
            },
            {"$set": {"owner": owner, "locked_until": now + timedelta(seconds=ttl), "acquired_at": now,
                      "updated_at": now}},
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
    except DuplicateKeyError:
        return None
    if not lock or lock.get("owner") != owner:
        return None
    return _Lease(db, owner, ttl, renew_seconds(), sent + ttl)


async def _guarded(db, migration, lease: _Lease):
    """Eine Migration unter Aufsicht der Sperre: Geht sie verloren, darf die Migration bis kurz vor Ablauf noch zu ihrem
    nächsten Schritt kommen (``extend_migration_lease`` liefert dann ``False``), danach wird sie abgebrochen. In beiden
    Fällen ``MigrationLeaseLost`` - auch wenn sie trotzdem fertig wurde, wird sie nicht vermerkt."""
    task = asyncio.ensure_future(migration(db))
    lost = asyncio.ensure_future(lease.lost.wait())
    try:
        await asyncio.wait({task, lost}, return_when=asyncio.FIRST_COMPLETED)
        if lease.lost.is_set() and not task.done():
            await asyncio.wait({task}, timeout=lease.grace_seconds())
    except BaseException:
        task.cancel()
        raise
    finally:
        lost.cancel()
    if not task.done():
        task.cancel()
    await asyncio.gather(task, return_exceptions=True)
    if lease.lost.is_set():
        raise MigrationLeaseLost(lease.reason)
    return task.result()


async def _run_once(db) -> list[dict] | None:
    """Ein Versuch: Sperre holen und die offenen Migrationen abarbeiten. ``None``: ein anderer Start hält die Sperre."""
    lease = await _acquire_lease(db)
    if lease is None:
        return None
    _set_status("running")
    applied: list[dict] = []
    incomplete: list[int] = []
    token = _LEASE.set(lease)
    keeper = asyncio.ensure_future(lease.keep_alive())
    try:
        completed = set(await db.schema_migrations.distinct("version"))
        for version, name, migration in MIGRATIONS:
            if version in completed:
                continue
            if lease.lost.is_set():
                raise MigrationLeaseLost(lease.reason)
            logger.info("[migration] %s %s beginnt", version, name)
            started = monotonic()
            try:
                result = await _guarded(db, migration, lease)
            except MigrationIncomplete as exc:
                logger.error("[migration] %s %s ist noch nicht fertig und läuft beim nächsten Start erneut: %s",
                             version, name, exc)
                incomplete.append(version)
                continue
            finished_at = _utcnow()
            record = {"version": version, "name": name, "result": result, "applied_at": finished_at}
            await db.schema_migrations.update_one(
                {"version": version}, {"$setOnInsert": record}, upsert=True,
            )
            applied.append(record)
            logger.info("[migration] %s %s fertig nach %.1f s", version, name, monotonic() - started)
        _set_status("incomplete" if incomplete else "done", open=incomplete)
        return applied
    except MigrationLeaseLost:
        _set_status("lost", reason=lease.reason)
        logger.error("[migration] Lauf abgebrochen, die Sperre ist verloren (%s); %s Migrationen vermerkt",
                     lease.reason, len(applied))
        return applied
    except BaseException:
        _set_status("error")
        raise
    finally:
        keeper.cancel()
        await asyncio.gather(keeper, return_exceptions=True)
        _LEASE.reset(token)
        try:
            await db.schema_migration_lock.update_one(
                {"_id": LOCK_ID, "owner": lease.owner},
                {"$set": {"locked_until": _utcnow()}, "$unset": {"owner": ""}},
            )
        except PyMongoError as exc:
            # Ohne Freigabe läuft die Sperre von selbst ab (``MIGRATION_LEASE_SECONDS``).
            logger.warning("[migration] Sperre nicht freigegeben (%s), sie läuft von selbst ab", type(exc).__name__)


async def run_pending_migrations(db) -> list[dict]:
    """Ein Versuch ohne Warten: Run each migration once, under the lease. Eine Migration, die ``MigrationIncomplete``
    wirft, wird nicht vermerkt und läuft beim nächsten Start erneut; die übrigen laufen weiter. Hält ein anderer Start
    die Sperre oder geht sie verloren, kommt zurück, was bis dahin vermerkt wurde (``migration_status`` sagt, warum).
    Für den Start: ``ensure_migrations``."""
    return await _run_once(db) or []


async def _all_recorded(db) -> bool:
    done = set(await db.schema_migrations.distinct("version"))
    return all(version in done for version, _, _ in MIGRATIONS)


async def _holder(db) -> str:
    lock = await db.schema_migration_lock.find_one({"_id": LOCK_ID}, {"_id": 0, "owner": 1}) or {}
    return log_safe(str(lock.get("owner") or "-").split(":", 1)[0], 80)


async def ensure_migrations(db) -> list[dict]:
    """Startablauf (#1006): Sperre holen und migrieren - oder warten, bis der Halter fertig ist bzw. jede Migration
    vermerkt ist. Wird die Sperre frei, holt dieser Start sie selbst und zieht nach, was offen ist. Erst danach geht
    der Start weiter. Wartet er länger als ``MIGRATION_WAIT_SECONDS``: ``MigrationWaitTimeout``; verliert er die Sperre
    mitten im Lauf: ``MigrationLeaseLost`` - der Start bricht ab, nach dem Neustart beginnt alles von vorn."""
    limit = wait_seconds()
    started = monotonic()
    logged_at: float | None = None
    while True:
        applied = await _run_once(db)
        if applied is not None:
            if _STATUS.get("state") == "lost":
                raise MigrationLeaseLost(
                    f"Migrationen: die Sperre ging mitten im Lauf verloren ({_STATUS.get('reason')}). Der Start bricht "
                    "ab; die abgebrochene Migration ist nicht vermerkt und läuft beim nächsten Halter erneut.")
            return applied
        if await _all_recorded(db):
            _set_status("done", open=[])
            return []
        waited = monotonic() - started
        if waited >= limit:
            _set_status("timeout", waited_seconds=int(waited))
            message = (f"Migrationen: ein anderer Start ({await _holder(db)}) hält die Sperre seit über {int(limit)} s "
                       "(MIGRATION_WAIT_SECONDS). Dieser Start bricht ab und bedient nichts; nach dem Neustart wartet "
                       "er erneut oder übernimmt die abgelaufene Sperre.")
            logger.error("[migration] %s", message)
            raise MigrationWaitTimeout(message)
        _set_status("waiting", waited_seconds=int(waited))
        if logged_at is None or monotonic() - logged_at >= WAIT_LOG_SECONDS:
            logged_at = monotonic()
            logger.warning("[migration] Ein anderer Start (%s) migriert gerade - dieser wartet (%s s von höchstens "
                           "%s s) und meldet sich erst danach bereit", await _holder(db), int(waited), int(limit))
        await asyncio.sleep(max(0.0, min(WAIT_POLL_SECONDS, limit - waited)))
