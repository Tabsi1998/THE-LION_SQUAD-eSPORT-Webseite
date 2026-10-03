"""Teilnahmen in der Mitgliederakte (#847, Vereine 1.8.0).

Besuchte Vereinsevents (Check-in) und gespielte Turniere stehen beim Mitglied in Dolibarr - für Ehrungen, den
Jahresbericht und „aktive Mitglieder“. Die Website meldet sie mit ``POST /vereine/members/{id}/participations``.
Bestätigte Helferdienste trägt das Vereinsmodul selbst ein (Quelle „shift“); die meldet die Website nicht noch einmal.

- Nur Konten mit bestätigter Zuordnung oder Bindung, also mit bekannter Mitgliedsnummer. Gäste und Konten ohne
  Zuordnung bleiben außen vor.
- Ein Abgleich alle zehn Minuten schaut auf die letzten 30 Tage, frühestens ab dem Einschalten. Er fängt jeden Weg
  ein: Check-in und Turnierabschluss per Hand genauso wie den automatischen Abschluss durch den Zeitplan.
- Der Nachzug (Knopf unter Dolibarr → Funktionen) schaut zwölf Monate zurück, in Portionen.
- Jede Meldung trägt eine stabile Kennung (``ev.{event}.{mitglied}``, ``tn.{turnier}.{mitglied}``): dieselbe Meldung
  zweimal ist im Modul ein Eintrag. Ändert sich der Inhalt (Event umbenannt), ersetzt die Website ihre Meldung.
- Zurückgenommen wird nur, was die Website ausdrücklich widerruft: Check-in aufgehoben, Anmeldung abgelehnt oder
  Turnier wieder geöffnet. Ein gelöschtes Event oder ein Teamwechsel nimmt nichts aus der Akte.
"""
from __future__ import annotations

import hashlib
import re
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from models import now_utc
from services import dolibarr_identity
from services.dolibarr_client import DolibarrClient, DolibarrError, instance_key, load_settings

COLLECTION = "dolibarr_participations"
STATE_ID = "dolibarr_participations_state"
MIN_VERSION = (1, 8, 0)
WINDOW_DAYS = 30
BACKFILL_DAYS = 365
BATCH = 60
RETRY_HOURS = 6
VIENNA = ZoneInfo("Europe/Vienna")
EXTERNAL_ID = re.compile(r"^[A-Za-z0-9._:-]{1,64}$")
SKIPPED_EVENTS = ("draft", "cancelled")
DONE_TOURNAMENTS = ("completed", "results_published", "archived")
PLAYED = ("approved", "checked_in")
RIGHT_LABEL = "Teilnahmen von Mitgliedern erfassen und lesen"
FIELD_TEXTS = {
    "kind": "Diese Art ist im Wörterbuch „Vereine: Arten von Teilnahmen“ nicht eingeschaltet.",
    "day": "Dolibarr nimmt den Tag nicht an (liegt er in der Zukunft?).",
    "title": "Dolibarr nimmt den Titel nicht an.",
    "hours": "Dolibarr nimmt die Stunden nicht an.",
    "external_id": "Dolibarr nimmt die Kennung der Meldung nicht an.",
}
KIND_LABELS = {"event": "Vereinsevent", "competition": "Turnier"}


class _Stop(Exception):
    """Dolibarr hat für alle Meldungen Nein gesagt (Recht, Modul, Netz) - der Lauf hört auf, der nächste versucht es wieder."""

    def __init__(self, kind: str, text: str):
        super().__init__(text)
        self.kind = kind
        self.text = text


def current_day() -> date:
    return datetime.now(VIENNA).date()


def day_of(value) -> str:
    """Kalendertag in Wien zu einem gespeicherten Zeitpunkt (ISO-Text oder datetime); leer ohne Zeitpunkt."""
    if not value:
        return ""
    if isinstance(value, datetime):
        moment = value
    else:
        try:
            moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return ""
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(VIENNA).date().isoformat()


def external_id(prefix: str, source_id: str, member_id: int) -> str:
    """Stabile Kennung je Quelle und Mitglied - eine fremde Quell-ID, die nicht ins Muster passt, wird zum Hash."""
    plain = f"{prefix}.{source_id}.{int(member_id)}"
    if EXTERNAL_ID.match(plain):
        return plain
    return f"{prefix}.{hashlib.sha256(str(source_id).encode('utf-8')).hexdigest()[:24]}.{int(member_id)}"


def _entry(kind: str, prefix: str, source: dict, member_id: int, user_id: str, title: str, day: str) -> dict:
    return {"external_id": external_id(prefix, source["id"], member_id), "member_id": int(member_id), "user_id": user_id,
            "kind": kind, "title": (str(title or "").strip() or KIND_LABELS[kind])[:255], "day": day, "source": source}


def _same(row: dict, entry: dict) -> bool:
    return all(row.get(key) == entry.get(key) for key in ("kind", "title", "day", "member_id"))


async def load_state(db) -> dict:
    return await db.settings.find_one({"id": STATE_ID}, {"_id": 0}) or {"id": STATE_ID}


async def members_by_user(db, settings: dict) -> dict[str, int]:
    """Konto → Mitgliedsnummer, nur mit bestätigter Zuordnung oder Bindung dieser Installation."""
    instance = instance_key(settings)
    found: dict[str, int] = {}
    async for row in db[dolibarr_identity.COLLECTION].find({"instance": instance, "status": "bound", "member_id": {"$ne": None}},
                                                           {"_id": 0, "user_id": 1, "member_id": 1}):
        if row.get("user_id") and row.get("member_id"):
            found[row["user_id"]] = int(row["member_id"])
    async for row in db.dolibarr_links.find({"instance": instance, "status": "verified", "member_id": {"$ne": None}},
                                            {"_id": 0, "user_id": 1, "member_id": 1}):
        if row.get("user_id") and row.get("member_id"):
            found[row["user_id"]] = int(row["member_id"])   # die bestätigte Zuordnung geht vor
    return found


def _checked_in(reg: dict) -> bool:
    return reg.get("status") == "checked_in" or (reg.get("checked_in") is True and reg.get("status") not in ("cancelled", "no_show"))


async def _event_entries(db, members: dict[str, int], start: str, today: str) -> dict[str, dict]:
    events: dict[str, tuple[dict, str]] = {}
    async for event in db.events.find({"status": {"$nin": list(SKIPPED_EVENTS)}}, {"_id": 0, "id": 1, "name": 1, "start_date": 1}):
        day = day_of(event.get("start_date"))
        if event.get("id") and day and start <= day <= today:
            events[event["id"]] = (event, day)
    entries: dict[str, dict] = {}
    if not events:
        return entries
    query = {"event_id": {"$in": list(events)}, "$or": [{"status": "checked_in"}, {"checked_in": True}]}
    async for reg in db.event_registrations.find(query, {"_id": 0, "id": 1, "event_id": 1, "user_id": 1, "status": 1, "checked_in": 1}):
        member_id = members.get(reg.get("user_id") or "")
        if not member_id or not _checked_in(reg):
            continue
        event, day = events[reg["event_id"]]
        entry = _entry("event", "ev", {"type": "event", "id": event["id"], "registration_id": reg.get("id")}, member_id, reg["user_id"], event.get("name"), day)
        entries[entry["external_id"]] = entry
    return entries


async def _tournament_entries(db, members: dict[str, int], start: str, today: str) -> dict[str, dict]:
    tournaments: dict[str, tuple[dict, str]] = {}
    async for row in db.tournaments.find({"status": {"$in": list(DONE_TOURNAMENTS)}}, {"_id": 0, "id": 1, "title": 1, "start_date": 1, "end_date": 1}):
        day = day_of(row.get("start_date")) or day_of(row.get("end_date"))
        if row.get("id") and day and start <= day <= today:
            tournaments[row["id"]] = (row, day)
    entries: dict[str, dict] = {}
    if not tournaments:
        return entries
    regs = await db.tournament_registrations.find({"tournament_id": {"$in": list(tournaments)}, "status": {"$in": list(PLAYED)}},
                                                  {"_id": 0, "id": 1, "tournament_id": 1, "user_id": 1, "team_id": 1}).to_list(None)
    # Teams: wer zum Turniertag im Team war - wer später dazukam, hat nicht mitgespielt.
    team_ids = list({reg["team_id"] for reg in regs if reg.get("team_id")})
    roster: dict[str, list[tuple[str, str]]] = {}
    if team_ids:
        async for row in db.team_members.find({"team_id": {"$in": team_ids}}, {"_id": 0, "team_id": 1, "user_id": 1, "joined_at": 1}):
            if row.get("user_id"):
                roster.setdefault(row["team_id"], []).append((row["user_id"], day_of(row.get("joined_at"))))
    for reg in regs:
        tournament, day = tournaments[reg["tournament_id"]]
        if reg.get("team_id") and roster.get(reg["team_id"]):
            players = [user_id for user_id, joined in roster[reg["team_id"]] if not joined or joined <= day]
        else:
            players = [reg.get("user_id")] if reg.get("user_id") else []
        for user_id in players:
            member_id = members.get(user_id or "")
            if not member_id:
                continue
            entry = _entry("competition", "tn", {"type": "tournament", "id": tournament["id"], "registration_id": reg.get("id")},
                           member_id, user_id, tournament.get("title"), day)
            entries[entry["external_id"]] = entry
    return entries


async def entries_between(db, settings: dict, start: str, today: str) -> dict[str, dict]:
    """Was in diesem Zeitraum in die Akten gehört - je Kennung ein Eintrag."""
    members = await members_by_user(db, settings)
    if not members:
        return {}
    return {**await _event_entries(db, members, start, today), **await _tournament_entries(db, members, start, today)}


async def _withdrawn(db, rows: list[dict]) -> set[str]:
    """Welche gemeldeten Teilnahmen die Website ausdrücklich widerruft. Fehlt die Quelle, bleibt die Meldung."""
    gone: set[str] = set()
    by_type: dict[str, list[dict]] = {"event": [], "tournament": []}
    for row in rows:
        source = row.get("source") or {}
        if source.get("type") in by_type:
            by_type[source["type"]].append(row)
    if by_type["event"]:
        events = {doc["id"]: doc async for doc in db.events.find({"id": {"$in": list({r["source"]["id"] for r in by_type["event"]})}}, {"_id": 0, "id": 1, "status": 1})}
        regs = {doc["id"]: doc async for doc in db.event_registrations.find(
            {"id": {"$in": [r["source"].get("registration_id") for r in by_type["event"] if r["source"].get("registration_id")]}},
            {"_id": 0, "id": 1, "status": 1, "checked_in": 1})}
        for row in by_type["event"]:
            event = events.get(row["source"]["id"])
            reg = regs.get(row["source"].get("registration_id"))
            if (event and event.get("status") in SKIPPED_EVENTS) or (reg and not _checked_in(reg)):
                gone.add(row["external_id"])
    if by_type["tournament"]:
        tournaments = {doc["id"]: doc async for doc in db.tournaments.find({"id": {"$in": list({r["source"]["id"] for r in by_type["tournament"]})}}, {"_id": 0, "id": 1, "status": 1})}
        regs = {doc["id"]: doc async for doc in db.tournament_registrations.find(
            {"id": {"$in": [r["source"].get("registration_id") for r in by_type["tournament"] if r["source"].get("registration_id")]}},
            {"_id": 0, "id": 1, "status": 1})}
        for row in by_type["tournament"]:
            tournament = tournaments.get(row["source"]["id"])
            reg = regs.get(row["source"].get("registration_id"))
            if (tournament and tournament.get("status") not in DONE_TOURNAMENTS) or (reg and reg.get("status") not in PLAYED):
                gone.add(row["external_id"])
    return gone


def _stop_for(exc: DolibarrError) -> _Stop:
    if exc.kind == "forbidden":
        return _Stop("right_missing", f"Dem API-Benutzer der Website fehlt in Dolibarr das Recht „{RIGHT_LABEL}“.")
    return _Stop(exc.kind, exc.text)


async def _report(client: DolibarrClient, entry: dict) -> None:
    payload = {key: entry[key] for key in ("kind", "title", "day", "external_id")}
    try:
        await client.report_participation(entry["member_id"], payload)
    except DolibarrError as exc:
        if exc.kind != "conflict":
            raise
        # Unter dieser Kennung steht unsere eigene, ältere Meldung (Event umbenannt) - zurücknehmen, neu melden.
        try:
            await client.withdraw_participation(entry["member_id"], entry["external_id"])
        except DolibarrError as again:
            if again.kind != "not_found":
                raise
        await client.report_participation(entry["member_id"], payload)


def window(settings: dict, state: dict, today: date) -> str:
    """Erster Tag, auf den der Lauf schaut: 30 Tage, frühestens ab dem Einschalten - beim Nachzug zwölf Monate."""
    start = (today - timedelta(days=WINDOW_DAYS)).isoformat()
    since = str(settings.get("participations_since") or "")[:10]
    if since > start:
        start = since
    backfill = str(state.get("backfill_from") or "")[:10]
    if backfill and backfill < start:
        start = backfill
    return start


def _switched_off(settings: dict) -> dict | None:
    if settings.get("mode") != "live":
        return {"ok": False, "skipped": "not_live", "text": "Die Mitgliederverwaltung ist nicht live angebunden."}
    if not settings.get("participations_enabled"):
        return {"ok": False, "skipped": "switched_off", "text": "Der Schalter „Teilnahmen in die Mitgliederakte“ ist aus."}
    return None


async def _save(db, last_run: dict, **fields) -> None:
    await db.settings.update_one({"id": STATE_ID}, {"$set": {"id": STATE_ID, "last_run": last_run, **fields}}, upsert=True)


async def run(db, *, today: date | None = None, force_retry: bool = False) -> dict:
    """Ein Lauf: Neues melden, Geändertes ersetzen, Widerrufenes zurücknehmen - höchstens ``BATCH`` Aufrufe."""
    settings = await load_settings(db)
    skipped = _switched_off(settings)
    if skipped:
        return skipped
    state = await load_state(db)
    at = now_utc().isoformat()
    sync = await db.settings.find_one({"id": dolibarr_identity.STATE_ID}, {"_id": 0, "module_version": 1}) or {}
    if dolibarr_identity.parse_version(sync.get("module_version")) < MIN_VERSION:
        result = {"ok": False, "at": at, "skipped": "module_version", "text": f"Vereinsmodul {sync.get('module_version') or '–'} – Teilnahmen gibt es ab 1.8.0."}
        await _save(db, result)
        return result
    try:
        client = DolibarrClient(settings)
    except DolibarrError as exc:
        result = {"ok": False, "at": at, "error": exc.kind, "text": exc.text}
        await _save(db, result)
        return result
    day = today or current_day()
    start = window(settings, state, day)
    instance = instance_key(settings)
    wanted = await entries_between(db, settings, start, day.isoformat())
    known = {row["external_id"]: row async for row in db[COLLECTION].find({"instance": instance, "day": {"$gte": start}}, {"_id": 0})}
    counts = {"sent": 0, "replaced": 0, "retracted": 0, "failed": 0, "pending": 0}
    budget = BATCH
    retry_at = (now_utc() + timedelta(hours=RETRY_HOURS)).isoformat()
    error: _Stop | None = None
    try:
        for key, entry in sorted(wanted.items(), key=lambda item: (item[1]["day"], item[0])):
            row = known.get(key)
            if row and row.get("status") == "sent" and _same(row, entry):
                continue
            if row and row.get("status") == "failed" and _same(row, entry) and not force_retry and str(row.get("retry_after") or "") > at:
                continue
            if budget <= 0:
                counts["pending"] += 1
                continue
            budget -= 1
            doc = {**entry, "key": f"{instance}:{key}", "instance": instance, "updated_at": at}
            try:
                await _report(client, entry)
            except DolibarrError as exc:
                if exc.kind == "bad_request":
                    field = str((exc.detail or {}).get("field") or "")
                    text = FIELD_TEXTS.get(field, exc.text)
                elif exc.kind == "not_found":
                    text = "Das Mitglied gibt es in Dolibarr nicht (mehr)."
                else:
                    raise _stop_for(exc) from exc
                counts["failed"] += 1
                await db[COLLECTION].update_one({"key": doc["key"]}, {"$set": {**doc, "status": "failed", "error_text": text, "retry_after": retry_at}}, upsert=True)
                continue
            counts["replaced" if row and row.get("status") == "sent" else "sent"] += 1
            await db[COLLECTION].update_one({"key": doc["key"]}, {"$set": {**doc, "status": "sent", "sent_at": at}, "$unset": {"error_text": "", "retry_after": ""}},
                                            upsert=True)
        sent_rows = [row for key, row in known.items() if key not in wanted and row.get("status") == "sent"]
        for key in sorted(await _withdrawn(db, sent_rows)):
            if budget <= 0:
                counts["pending"] += 1
                continue
            budget -= 1
            row = known[key]
            try:
                await client.withdraw_participation(row["member_id"], key)
            except DolibarrError as exc:
                if exc.kind != "not_found":
                    raise _stop_for(exc) from exc
            counts["retracted"] += 1
            await db[COLLECTION].update_one({"key": row["key"]}, {"$set": {"status": "retracted", "retracted_at": at, "updated_at": at}})
    except _Stop as stop:
        error = stop
    result = {"ok": error is None, "at": at, "from": start, **counts}
    if error:
        result.update({"error": error.kind, "text": error.text})
    fields = {}
    if state.get("backfill_from") and not error and not counts["pending"]:
        fields["backfill_from"] = None   # der Nachzug ist durch
    await _save(db, result, **fields)
    return result


async def run_due() -> dict:
    """Der Job alle zehn Minuten."""
    from database import get_db
    return await run(get_db())


async def request_backfill(db, *, today: date | None = None) -> dict:
    """Nachzug: zwölf Monate zurück, abgelehnte Meldungen sofort neu versuchen; der erste Teil läuft gleich."""
    skipped = _switched_off(await load_settings(db))
    if skipped:
        return skipped
    day = today or current_day()
    await db.settings.update_one({"id": STATE_ID}, {"$set": {"id": STATE_ID, "backfill_from": (day - timedelta(days=BACKFILL_DAYS)).isoformat()}}, upsert=True)
    return await run(db, today=day, force_retry=True)


async def admin_view(db, settings: dict) -> dict:
    """Was die Zeile unter Dolibarr → Funktionen zeigt: letzter Lauf, Nachzug, gemeldet, abgelehnt mit Grund."""
    state = await load_state(db)
    instance = instance_key(settings)
    failed = await db[COLLECTION].find({"instance": instance, "status": "failed"}, {"_id": 0, "title": 1, "day": 1, "kind": 1, "error_text": 1}).sort("day", -1).to_list(5)
    return {
        "last_run": state.get("last_run") or None,
        "backfill_from": state.get("backfill_from") or None,
        "sent": await db[COLLECTION].count_documents({"instance": instance, "status": "sent"}),
        "failed_total": await db[COLLECTION].count_documents({"instance": instance, "status": "failed"}),
        "failed": [{"title": row.get("title"), "day": row.get("day"), "kind": KIND_LABELS.get(row.get("kind"), row.get("kind")), "text": row.get("error_text")} for row in failed],
    }
