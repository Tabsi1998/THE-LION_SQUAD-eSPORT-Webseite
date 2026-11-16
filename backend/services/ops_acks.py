"""Quittieren und von selbst Erledigtes im Betrieb (#2447).

Bisher zeigte „Neueste Probleme“ jede Warnung der letzten sieben Tage, und die Kacheln „X auffällig“ zählten alles -
nichts ließ sich wegklicken. Jetzt hat jeder Eintrag einen Stand:

- **offen**: ein Problem (Fehler oder Warnung), weder quittiert noch behoben.
- **quittiert**: jemand mit dem Bereich System hat es gesehen (``acknowledged_at``/``acknowledged_by`` an der Zeile,
  bei Serverfehlern ``resolved_at``/``resolved_by`` - quittieren heißt dort „gelöst“). Der Name wird erst beim Lesen
  aus der Kennung aufgelöst.
- **behoben**: von selbst erledigt - ein Auto-Check ist wieder grün, ein Alarm hat sein Gegenstück (Prüfung wieder
  grün, Fehlergruppe gelöst, Dolibarr-Abgleich wieder grün, Discord-Bot wieder verbunden).

„Dasselbe Problem“ heißt: gleiche **Quelle + Art + Schlüssel** (``SPECS``). Quittieren trifft alle offenen Zeilen mit
diesem Schlüssel. Tritt es danach wieder auf - eine neue Zeile oder eine Zeile, deren Zeitpunkt nach der Quittierung
liegt (App-Log wiederholt sich, Mail-Job scheitert erneut, Fehlergruppe tritt wieder auf) -, ist es wieder offen.
Die Regel steht nur hier (``ack_valid``); Ereignisliste und Zähler fragen beide sie.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from models import now_utc

ACK_SCAN_LIMIT = 5000


@dataclass(frozen=True)
class Spec:
    collection: str
    problem: dict
    time_keys: tuple[str, ...]
    # Art + Schlüssel: diese Felder gleich heißt „dasselbe Problem“; leer = nur diese eine Zeile.
    group: tuple[str, ...]
    label: str
    # Ohne einen dieser Werte (oder mit einem Sammelwert wie „custom“) ist der Schlüssel zu grob - dann nur die Zeile.
    anchor: tuple[str, ...] = ()


# Quelle -> Sammlung, was dort ein Problem ist, wann es (zuletzt) auftrat, und was „dasselbe“ heißt.
SPECS: dict[str, Spec] = {
    "checks": Spec("ops_check_episodes", {"open": True, "status": {"$ne": "ok"}}, ("since",), ("status", "signature"),
                   "Auto-Checks: Ampel (gelb/rot) + betroffene Prüfungen", ("signature",)),
    "alerts": Spec("ops_alert_log", {"kind": {"$ne": "test"}}, ("at",), ("kind", "key"), "Alarme: Ereignisart + Alarmschlüssel", ("key",)),
    "client": Spec("mobile_client_logs", {"status": "open"}, ("received_at", "created_at"), ("level", "fingerprint"),
                   "App-Logs: Stufe + Fingerabdruck", ("fingerprint",)),
    # Fehler bzw. Grund gehören dazu (Review #2447): eine andere Ursache ist ein anderes Problem; Discord je Server und Ziel.
    "email": Spec("email_logs", {"status": {"$in": ["failed", "skipped"]}}, ("created_at",),
                  ("status", "channel", "template_key", "event_key", "guild_id", "target", "reason", "error"),
                  "E-Mail-Versand: Stand + Weg + Vorlage bzw. Anlass + Discord-Server und Ziel + Grund/Fehlertext; freie Mails (custom) einzeln",
                  ("template_key", "event_key")),
    "mail_queue": Spec("mail_jobs", {"status": "failed"}, ("updated_at", "created_at"), (), "Mail-Queue: der einzelne Auftrag"),
    # Nur echte Fehlschläge - ein laufender oder unbekannter Stand ist kein Problem.
    "uploads": Spec("upload_events", {"status": {"$in": ["failed", "client_failed"]}}, ("created_at",), (), "Uploads: der einzelne Upload"),
}
# Sammelwerte, die keinen Anlass benennen: so eine Zeile wird nur einzeln quittiert.
GENERIC_KEYS = frozenset({"custom"})
# Serverfehler (Fehlergruppe = Art + Fingerabdruck), Dolibarr-Abgleich und Discord-Bot haben ihren Stand anderswo.
STATE_SOURCES = ("server", "sync", "bot")
ACKABLE_SOURCES = (*SPECS, *STATE_SOURCES)
SYNC_STATE_ID = "dolibarr_sync_state"
BOT_STATE_ID = "discord_bot_state"


def moment(value) -> datetime | None:
    """ISO-Text oder datetime als Zeitpunkt mit Zone - Vergleiche sind so unabhängig von „Z“ und „+00:00“."""
    if not value:
        return None
    if isinstance(value, datetime):
        result = value
    else:
        try:
            result = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    return result if result.tzinfo else result.replace(tzinfo=timezone.utc)


def occurrence(row: dict, time_keys: tuple[str, ...]) -> datetime | None:
    for key in time_keys:
        found = moment(row.get(key))
        if found:
            return found
    return None


def ack_valid(row: dict, time_keys: tuple[str, ...]) -> bool:
    """Quittiert gilt, solange das Problem seitdem nicht wieder aufgetreten ist."""
    acked = moment(row.get("acknowledged_at"))
    if not acked:
        return False
    seen = occurrence(row, time_keys)
    return seen is None or seen <= acked


def _occurrence_expr(spec: Spec):
    """Der erste vorhandene Zeitschlüssel; ohne jeden ein leerer Text (so vergleicht MongoDB ein fehlendes Feld -
    mongomock bräche sonst ab)."""
    expr = ""
    for key in reversed(spec.time_keys):
        expr = {"$ifNull": [f"${key}", expr]}
    return expr


def open_filter(spec: Spec) -> dict:
    """Die Regel von ``ack_valid`` als Mongo-Bedingung (#2447): nie quittiert oder danach wieder aufgetreten. Die
    Zeitpunkte sind ISO-Texte aus ``now_utc().isoformat()`` - gleich geschrieben, also als Text vergleichbar."""
    return {"$or": [{"acknowledged_at": None}, {"$expr": {"$gt": [_occurrence_expr(spec), "$acknowledged_at"]}}]}


def until_filter(spec: Spec, until: str | None) -> dict:
    """Nur, was spätestens ``until`` auftrat - was nach dem Laden der Seite neu kam, bleibt offen."""
    return {"$expr": {"$lte": [_occurrence_expr(spec), str(until)]}} if until else {}


def _and(*parts: dict) -> dict:
    parts = tuple(part for part in parts if part)
    if not parts:
        return {}
    return parts[0] if len(parts) == 1 else {"$and": list(parts)}


# ---------------------------------------------------------------- Lesen

async def problem_rows(db, source: str, query: dict, sort, limit: int, *, projection: dict | None = None) -> list[dict]:
    """Nur offene Probleme einer Quelle, neueste zuerst: unquittierte und wieder aufgetretene. Zwei Abfragen, damit
    viele quittierte Zeilen die offenen nicht aus dem Fenster drängen."""
    spec = SPECS[source]
    collection = getattr(db, spec.collection)
    rows = await collection.find(_and(query, spec.problem, open_filter(spec)), projection or {"_id": 0}).sort(sort).limit(limit).to_list(limit)
    rows.sort(key=lambda row: occurrence(row, spec.time_keys) or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    return rows


async def _count_open_rows(db, source: str) -> int:
    """Gezählt in der Datenbank (Review #2447, N6) - keine Zeilen nach Python."""
    spec = SPECS[source]
    return await getattr(db, spec.collection).count_documents(_and(spec.problem, open_filter(spec)))


def sync_open(state: dict) -> bool:
    """Dolibarr-Abgleich: rot und nicht quittiert. Ein grüner Lauf nach der Quittierung macht den nächsten Fehler neu."""
    error = state.get("last_error") if isinstance(state.get("last_error"), dict) else None
    if not error:
        return False
    ack = state.get("ack") if isinstance(state.get("ack"), dict) else None
    if not ack:
        return True
    same = ack.get("kind") == error.get("kind") and ack.get("text") == error.get("text")
    ok_after = moment(state.get("last_ok_at")) and moment(ack.get("at")) and moment(state.get("last_ok_at")) > moment(ack.get("at"))
    return not same or bool(ok_after)


def bot_error(state: dict) -> str:
    return str(state.get("last_error") or state.get("error") or "")


def bot_open(state: dict) -> bool:
    """Discord-Bot: Fehler und nicht quittiert. Verbindet er wieder (Fehler leer), fällt die Quittierung weg
    (``discord_runtime.record_state``)."""
    error = bot_error(state)
    if not error:
        return False
    ack = state.get("ack") if isinstance(state.get("ack"), dict) else None
    return not ack or ack.get("error") != error


async def alert_resolutions(db, rows: list[dict]) -> dict[str, str]:
    """Alarme mit Gegenstück: Kennung -> „behoben um“ (leer, wenn der Zeitpunkt unbekannt ist). Fehlt eine Kennung,
    ist der Alarm noch offen.

    - ``check:<Prüfung>``: die Prüfung ist im letzten Lauf nach dem Alarm nicht mehr rot (``resolved_at`` schreibt
      ``ops_alerts.alert_red_checks`` beim Wechsel).
    - ``error:<Fingerabdruck>``: die Fehlergruppe ist gelöst (oder abgelaufen).
    - ``dolibarr:sync``: ein grüner Abgleich nach dem Alarm.
    - ``discord:bot``: der Bot ist danach wieder verbunden."""
    resolved: dict[str, str] = {}
    pending = [row for row in rows if row.get("id")]
    for row in pending:
        if row.get("resolved_at"):
            resolved[row["id"]] = str(row["resolved_at"])
    pending = [row for row in pending if row["id"] not in resolved]
    if not pending:
        return resolved
    keys = {str(row.get("key") or "") for row in pending}
    latest = None
    if any(key.startswith("check:") for key in keys):
        latest = await db.ops_check_runs.find_one({}, {"_id": 0, "at": 1, "checks.key": 1, "checks.status": 1}, sort=[("at", -1)])
    statuses = {check.get("key"): check.get("status") for check in (latest or {}).get("checks") or []}
    fingerprints = [key[len("error:"):] for key in keys if key.startswith("error:")]
    groups = {}
    if fingerprints:
        async for group in db.ops_errors.find({"fingerprint": {"$in": fingerprints}}, {"_id": 0, "fingerprint": 1, "resolved_at": 1}):
            groups[group["fingerprint"]] = group
    sync_state: dict = {}
    if "dolibarr:sync" in keys:
        sync_state = await db.settings.find_one({"id": SYNC_STATE_ID}, {"_id": 0}) or {}
    bot_state: dict = {}
    if "discord:bot" in keys:
        bot_state = await db.settings.find_one({"id": BOT_STATE_ID}, {"_id": 0}) or {}
    for row in pending:
        key = str(row.get("key") or "")
        at = moment(row.get("at"))
        if key.startswith("check:") and latest:
            status = statuses.get(key[len("check:"):])
            if status and status != "crit" and (not at or (moment(latest.get("at")) or at) >= at):
                resolved[row["id"]] = ""
        elif key.startswith("error:"):
            group = groups.get(key[len("error:"):])
            if group is None:
                resolved[row["id"]] = ""
            elif group.get("resolved_at") and (not at or (moment(group["resolved_at"]) or at) >= at):
                resolved[row["id"]] = str(group["resolved_at"])
        elif key == "dolibarr:sync":
            ok_at = moment(sync_state.get("last_ok_at"))
            if sync_state.get("ok") and ok_at and (not at or ok_at >= at):
                resolved[row["id"]] = str(sync_state["last_ok_at"])
        elif key == "discord:bot":
            seen = moment(bot_state.get("updated_at"))
            if bot_state.get("connected") and not bot_error(bot_state) and seen and (not at or seen >= at):
                resolved[row["id"]] = ""
    return resolved


async def _open_alerts(db, *, limit: int = ACK_SCAN_LIMIT, until: str | None = None) -> list[dict]:
    """Offene Alarme: nicht quittiert und nicht behoben. Das Gegenstück prüft Python (``alert_resolutions``); die
    Sammlung ist klein (ein Eintrag je gesendetem Alarm, nach einem Jahr gelöscht)."""
    spec = SPECS["alerts"]
    rows = await db.ops_alert_log.find(_and(spec.problem, {"resolved_at": None}, open_filter(spec), until_filter(spec, until)),
                                       {"_id": 0, "id": 1, "key": 1, "at": 1, "resolved_at": 1}).sort("at", -1).to_list(limit)
    resolved = await alert_resolutions(db, rows)
    return [row for row in rows if row.get("id") not in resolved]


async def open_count(db, source: str) -> int:
    """„X auffällig“ (#2447): nur Offenes, nicht Quittiertes, nicht Behobenes."""
    if source == "server":
        return await db.ops_errors.count_documents({"resolved_at": None})
    if source == "sync":
        return int(sync_open(await db.settings.find_one({"id": SYNC_STATE_ID}, {"_id": 0}) or {}))
    if source == "bot":
        return int(bot_open(await db.settings.find_one({"id": BOT_STATE_ID}, {"_id": 0}) or {}))
    if source == "alerts":
        return len(await _open_alerts(db))
    if source in SPECS:
        return await _count_open_rows(db, source)
    return 0


async def actor_names(db, ids) -> dict[str, str]:
    """Kennung -> Anzeigename; wer sein Konto gelöscht hat, heißt „Gelöschter User“."""
    wanted = sorted({str(value) for value in ids if value})
    if not wanted:
        return {}
    names = {}
    async for user in db.users.find({"id": {"$in": wanted}}, {"_id": 0, "id": 1, "display_name": 1, "username": 1}):
        names[user["id"]] = user.get("display_name") or user.get("username") or "Admin"
    return {value: names.get(value, "Gelöschter User") for value in wanted}


# ---------------------------------------------------------------- Quittieren

class NotOpen(Exception):
    """Der Eintrag ist kein offenes Problem (kein Fehler, schon quittiert oder erledigt) - 409, kein Protokoll."""


def _group_filter(spec: Spec, row: dict) -> dict:
    """Art + Schlüssel dieser Zeile. Fehlt der Anker oder ist er ein Sammelwert („custom“), zählt nur die Zeile selbst."""
    anchored = any(row.get(field) and str(row.get(field)) not in GENERIC_KEYS for field in spec.anchor)
    if not spec.group or not anchored:
        return {"id": row["id"]}
    return {field: row.get(field) for field in spec.group}


def _stamp(actor: dict) -> dict:
    return {"acknowledged_at": now_utc().isoformat(), "acknowledged_by": actor.get("id")}


def _modified(result) -> int:
    return int(getattr(result, "modified_count", 0) or 0)


async def _resolve_server(db, query: dict, actor: dict) -> int:
    result = await db.ops_errors.update_many(_and(query, {"resolved_at": None}),
                                             {"$set": {"resolved_at": now_utc().isoformat(), "resolved_by": actor.get("id")}})
    return _modified(result)


async def acknowledge(db, source: str, item_id: str, actor: dict) -> dict:
    """Einen Eintrag quittieren - und alle offenen mit demselben Schlüssel. Nur Offenes wird geschrieben: wer schon
    gültig quittiert hat, bleibt stehen (Review #2447, M3). ``LookupError``: gibt es nicht; ``NotOpen``: kein offenes
    Problem (nichts geschrieben)."""
    if source == "server":
        row = await db.ops_errors.find_one({"$or": [{"fingerprint": item_id}, {"id": item_id}]}, {"_id": 0, "fingerprint": 1, "error_type": 1, "resolved_at": 1})
        if not row:
            raise LookupError(source)
        if row.get("resolved_at"):
            raise NotOpen(source)
        count = await _resolve_server(db, {"fingerprint": row["fingerprint"]}, actor)
        return {"count": count, "kind": row.get("error_type") or "", "key": row["fingerprint"]}
    if source in ("sync", "bot"):
        return await _acknowledge_state(db, source, actor)
    spec = SPECS.get(source)
    if spec is None:
        raise LookupError(source)
    collection = getattr(db, spec.collection)
    row = await collection.find_one({"id": item_id}, {"_id": 0})
    if not row:
        raise LookupError(source)
    if not await collection.count_documents(_and({"id": item_id}, spec.problem, open_filter(spec))):
        raise NotOpen(source)
    group = _group_filter(spec, row)
    result = await collection.update_many(_and(group, spec.problem, open_filter(spec)), {"$set": _stamp(actor)})
    key = " · ".join(str(group[field] or "") for field in spec.group[1:] if group.get(field)) if "id" not in group else item_id
    return {"count": _modified(result), "kind": str(row.get(spec.group[0] if spec.group else "status") or ""), "key": key}


def _state_occurrence(source: str, state: dict) -> str:
    if source == "sync":
        error = state.get("last_error") if isinstance(state.get("last_error"), dict) else {}
        return str(state.get("last_run_at") or error.get("at") or "")
    return str(state.get("updated_at") or "")


async def _acknowledge_state(db, source: str, actor: dict, until: str | None = None) -> dict:
    state_id = SYNC_STATE_ID if source == "sync" else BOT_STATE_ID
    state = await db.settings.find_one({"id": state_id}, {"_id": 0}) or {}
    stamp = _stamp(actor)
    if source == "sync":
        error = state.get("last_error") if isinstance(state.get("last_error"), dict) else None
        if not error:
            raise LookupError(source)
        if not sync_open(state):
            raise NotOpen(source)
        ack = {"at": stamp["acknowledged_at"], "by": stamp["acknowledged_by"], "kind": error.get("kind"), "text": error.get("text")}
        kind, key = str(error.get("kind") or ""), "dolibarr:sync"
    else:
        error = bot_error(state)
        if not error:
            raise LookupError(source)
        if not bot_open(state):
            raise NotOpen(source)
        ack = {"at": stamp["acknowledged_at"], "by": stamp["acknowledged_by"], "error": error}
        kind, key = "error", "discord:bot"
    seen, bound = moment(_state_occurrence(source, state)), moment(until)
    if bound and seen and seen > bound:
        raise NotOpen(source)
    await db.settings.update_one({"id": state_id}, {"$set": {"ack": ack}})
    return {"count": 1, "kind": kind, "key": key}


async def _ack_source(db, source: str, actor: dict, *, until: str | None, ids: list[str] | None = None) -> int:
    """Alles Offene einer Quelle bis ``until`` - mit ``ids`` nur diese Einträge. Gibt die geschriebenen Zeilen zurück."""
    if source == "server":
        query = _and({"last_seen_at": {"$lte": until}} if until else {}, {"$or": [{"fingerprint": {"$in": ids}}, {"id": {"$in": ids}}]} if ids is not None else {})
        return await _resolve_server(db, query, actor)
    if source in ("sync", "bot"):
        try:
            return (await _acknowledge_state(db, source, actor, until))["count"]
        except (LookupError, NotOpen):
            return 0
    if source == "alerts":
        open_ids = [row["id"] for row in await _open_alerts(db, until=until) if row.get("id")]
        if ids is not None:
            open_ids = [value for value in open_ids if value in set(ids)]
        if not open_ids:
            return 0
        return _modified(await db.ops_alert_log.update_many({"id": {"$in": open_ids}}, {"$set": _stamp(actor)}))
    spec = SPECS[source]
    query = _and(spec.problem, open_filter(spec), until_filter(spec, until), {"id": {"$in": ids}} if ids is not None else {})
    return _modified(await getattr(db, spec.collection).update_many(query, {"$set": _stamp(actor)}))


async def acknowledge_all(db, sources, actor: dict, *, until: str | None = None) -> dict[str, int]:
    """„Alle quittieren“ ohne Filter (Überblick): alles Offene der Quellen (leer = alle), das spätestens ``until``
    auftrat. Liefert je Quelle die wirklich geschriebenen Einträge."""
    wanted = [source for source in (sources or ACKABLE_SOURCES) if source in ACKABLE_SOURCES]
    done = {source: await _ack_source(db, source, actor, until=until) for source in wanted}
    return {source: count for source, count in done.items() if count}


async def acknowledge_items(db, items: list[dict], actor: dict, *, until: str | None = None) -> dict[str, int]:
    """„Alle quittieren“ mit Filter (Ereignisse): genau die gezeigten Einträge (Quelle + ``ack_id``), ohne Gleiche
    außerhalb der Auswahl, und nur, was seit dem Laden nicht wieder auftrat (Review #2447, M2)."""
    by_source: dict[str, list[str]] = {}
    for item in items:
        source, value = str(item.get("source") or ""), str(item.get("id") or "")
        if source in ACKABLE_SOURCES and value:
            by_source.setdefault(source, []).append(value)
    done = {source: await _ack_source(db, source, actor, until=until, ids=list(dict.fromkeys(ids))) for source, ids in by_source.items()}
    return {source: count for source, count in done.items() if count}


def episode_resolution(row: dict) -> tuple[str, str] | None:
    """Ein beendeter Zustand der Auto-Checks: (Zeitpunkt, Wort). „behoben“, wenn danach alles grün war, „abgelöst“,
    wenn ein anderer gelber/roter Stand folgte (der steht dann selbst in der Liste)."""
    if row.get("open") or not row.get("closed_at"):
        return None
    after = row.get("closed_by_status")
    label = "behoben" if after == "ok" else "abgelöst" if after else "beendet"
    return str(row["closed_at"]), label
