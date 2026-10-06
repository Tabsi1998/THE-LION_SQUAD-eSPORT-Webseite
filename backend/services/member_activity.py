"""Kleine Spuren für Erfolge aus Katalog D (#615), die es vorher nicht gab.

- **Papierkram:** das erste Öffnen eines Vereinsdokuments je Person (``document_opens``, eindeutig je Person und
  Dokument) - jedes Dokument zählt einmal, egal wie oft man es öffnet.
- **Sprinter:** der Moment, in dem das Profil vollständig wurde (``users.profile_completed_at``), einmal gesetzt und
  nie wieder überschrieben.
- **Mitgliederstimme, Versammlungsbesucher, Helfer, Helferstunden:** Abstimmungen und Helferdienste führt das
  Vereinsmodul. Die Website fragt dafür nicht eigens nach, sondern zählt mit, wo sie die Daten der Person ohnehin liest:
  die Abstimmungen auf „Versammlungen“ und im Abstimmungs-Popup, die Teilnahmen im Reiter „Ehrungen & Teilnahmen“.
  Weil diesen Reiter nicht jeder öffnet, liest der stündliche Lauf die Teilnahmen nach - je Mitglied höchstens einmal
  am Tag und höchstens ``REFRESH_BATCH`` Abrufe je Lauf. Behalten werden nur Zahlen und Zeitpunkte, im Stand der Zähler
  selbst (``user_achievement_stats.club``): **dass** jemand abgestimmt hat, nie wie. Antwortet Dolibarr nicht, bleibt
  der letzte Stand.

Alle stoßen danach die Auswertung der Erfolge dieser Person an.
"""
from __future__ import annotations

import logging
from datetime import timedelta

from pymongo.errors import DuplicateKeyError

from models import new_id, now_utc

logger = logging.getLogger("tls.member_activity")

# Unterdokument im Stand der Zähler: votes, meetings, shifts, hours - und wann zuletzt gelesen (votes_at, shifts_at).
RECORD = "club"
# Die Art „Helferdienst“ im Wörterbuch des Vereinsmoduls: bestätigte Schichten (Quelle ``shift``) tragen sie immer,
# ein von Hand in Dolibarr eingetragener Helferdienst ebenso.
HELPER_KIND = "shift"
# Ein Einlass am Eingang zählt erst nach ein paar Minuten - ein Versehen („falscher Ausweis“) ist bis dahin zurückgenommen.
ADMISSION_SETTLE_MINUTES = 5
REFRESH_HOURS = 24
REFRESH_BATCH = 25
PARTICIPATIONS_MIN_VERSION = (1, 8, 0)


async def note_document_open(db, user: dict | None, doc_id: str) -> bool:
    """Das erste Öffnen eines Dokuments merken - True, wenn es neu war. Ohne Anmeldung nichts."""
    if not user or not user.get("id") or not doc_id:
        return False
    key = {"user_id": user["id"], "doc_id": str(doc_id)}
    try:
        result = await db.document_opens.update_one(key, {"$setOnInsert": {**key, "id": new_id(), "first_at": now_utc().isoformat()}}, upsert=True)
    except DuplicateKeyError:
        # Zwei Aufrufe gleichzeitig: der eindeutige Index lässt nur den ersten durch.
        return False
    if not result.upserted_id:
        return False
    await _evaluate(user["id"], "document_open", "club")
    return True


async def note_profile_completion(db, user_id: str) -> bool:
    """Ist das Profil jetzt vollständig und war es das noch nie, den Zeitpunkt festhalten - True, wenn gerade gesetzt."""
    from badges import PROFILE_FIELDS, compute_profile_completeness

    projection = {"_id": 0, "id": 1, "profile_completed_at": 1, **{key: 1 for key, _weight in PROFILE_FIELDS}}
    user = await db.users.find_one({"id": user_id}, projection)
    if not user or user.get("profile_completed_at") or compute_profile_completeness(user) < 100:
        return False
    result = await db.users.update_one({"id": user_id, "profile_completed_at": {"$in": [None, ""]}}, {"$set": {"profile_completed_at": now_utc().isoformat()}})
    if not result.modified_count:
        return False
    await _evaluate(user_id, "profile_completed", "profile")
    return True


async def _evaluate(user_id: str, reason: str, source: str) -> None:
    try:
        from services.achievement_queue import request_evaluation
        await request_evaluation([user_id], reason, sources={source})
    except Exception:  # noqa: BLE001 - eine Spur darf nie das Öffnen oder Speichern verhindern
        logger.warning("[member_activity] evaluation request failed", exc_info=True)


# ---------------------------------------------------------------- Zahlen aus der Vereinsakte (#615)

def ballot_numbers(rows) -> tuple[int, set[int]]:
    """Aus den Abstimmungen einer Person (``me/ballots``): bei wie vielen sie eine Stimme abgegeben hat, und in welchen
    Versammlungen das war. Gelesen wird nur, **ob** ein Stimmrecht genutzt ist (eigenes oder Vollmacht) - nie die
    Antwort. Jede Abstimmung zählt einmal; abgesagte zählen nicht. Bei einer geheimen Wahl auf Papier heißt „genutzt“:
    Stimmzettel erhalten."""
    count = 0
    meetings: set[int] = set()
    for row in rows or []:
        if not isinstance(row, dict) or str(row.get("status") or "") == "cancelled":
            continue
        if not any(isinstance(right, dict) and str(right.get("state") or "") == "used" for right in row.get("rights") or []):
            continue
        count += 1
        try:
            meeting_id = int(row.get("meeting_id") or 0)
        except (TypeError, ValueError):
            meeting_id = 0
        if meeting_id > 0:
            meetings.add(meeting_id)
    return count, meetings


def helper_numbers(rows, today: str | None = None) -> tuple[int, float]:
    """Aus den Teilnahmen einer Person (``me/participations``): Helferdienste und ihre Stunden. Das Vereinsmodul führt
    eine bestätigte Schicht schon ab dem Morgen ihres Tages als Teilnahme - hier zählt sie erst, wenn der Tag vorbei
    ist: bis dahin kann der Vorstand sie noch absagen, und einen Erfolg gibt es nicht im Voraus. Was der Vorstand von
    Hand als Helferdienst einträgt, ist schon geschehen und zählt sofort. Ohne erfasste Stunden zählt der Dienst, aber
    keine Zeit."""
    from services import dolibarr_policy

    today = today or dolibarr_policy.club_today()
    count, hours = 0, 0.0
    for row in rows or []:
        if not isinstance(row, dict) or HELPER_KIND not in (str(row.get("kind") or ""), str(row.get("source") or "")):
            continue
        if str(row.get("source") or "") == HELPER_KIND and str(row.get("day") or "") >= today:
            continue
        count += 1
        value = row.get("hours")
        if isinstance(value, (int, float)) and not isinstance(value, bool) and value > 0:
            hours += float(value)
    return count, round(hours, 2)


async def member_id_of(db, user_id: str) -> int | None:
    """Die Mitgliedsnummer des Kontos in der Mitgliederverwaltung - aus der bestätigten Zuordnung, sonst aus der Bindung
    per Einladungscode. Ohne beides None. Fragt Dolibarr nicht."""
    from services import dolibarr_identity
    from services.dolibarr_client import instance_key, load_settings

    instance = instance_key(await load_settings(db))
    for collection, status in (("dolibarr_links", "verified"), (dolibarr_identity.COLLECTION, "bound")):
        row = await db[collection].find_one({"user_id": user_id, "instance": instance, "status": status}, {"_id": 0, "member_id": 1})
        if row and row.get("member_id"):
            return int(row["member_id"])
    return None


async def admitted_meetings(db, user_id: str, member_id: int | None = None) -> set[int]:
    """Generalversammlungen, bei denen die Person am Eingang eingelassen wurde (#845) und es geblieben ist - über das
    Konto (Karte gescannt) oder die Mitgliedsnummer (ohne Karte eingelassen). Ganz frische Einlässe zählen noch nicht."""
    who: list[dict] = [{"user_id": user_id}]
    if member_id:
        who.append({"member_id": int(member_id)})
    settled = (now_utc() - timedelta(minutes=ADMISSION_SETTLE_MINUTES)).isoformat()
    rows = await db.meeting_admissions.find({"state": "present", "updated_at": {"$lte": settled}, "$or": who}, {"_id": 0, "meeting_id": 1}).to_list(1000)
    return {int(row["meeting_id"]) for row in rows if row.get("meeting_id")}


async def _keep(db, user_id: str, numbers: dict, stamp: str, reason: str, *, always: bool = False) -> bool:
    """Zahlen in den Stand der Zähler schreiben - True, wenn sich eine geändert hat; dann wird ausgewertet. Ohne
    Änderung wird nichts geschrieben, außer ``always``: dann wandert nur der Zeitpunkt „zuletzt gelesen“ weiter."""
    from services.achievement_counters import STATS

    doc = await db[STATS].find_one({"user_id": user_id}, {"_id": 0, RECORD: 1}) or {}
    current = doc.get(RECORD) or {}
    changed = any(float(current.get(key) or 0) != float(value) for key, value in numbers.items())
    if not changed and not always:
        return False
    fields: dict = {f"{RECORD}.{key}": value for key, value in numbers.items()} if changed else {}
    fields[f"{RECORD}.{stamp}"] = now_utc().isoformat()
    await db[STATS].update_one({"user_id": user_id}, {"$set": fields, "$setOnInsert": {"user_id": user_id}}, upsert=True)
    if changed:
        await _evaluate(user_id, reason, "club")
    return changed


async def note_ballots(db, user_id: str, rows, member_id: int | None = None) -> bool:
    """Die Abstimmungen der Person sind gerade gelesen worden: Anzahl der abgegebenen Stimmen und der besuchten
    Versammlungen festhalten - True, wenn sich etwas geändert hat. Zu den Versammlungen mit Stimme kommen die mit
    Einlass am Eingang; jede zählt einmal."""
    try:
        votes, meetings = ballot_numbers(rows)
        meetings |= await admitted_meetings(db, user_id, member_id)
        return await _keep(db, user_id, {"votes": votes, "meetings": len(meetings)}, "votes_at", "member_votes")
    except Exception:  # noqa: BLE001 - eine Spur darf nie die Seite mit den Abstimmungen verhindern
        logger.warning("[member_activity] ballots not noted", exc_info=True)
        return False


async def note_participations(db, user_id: str, rows) -> bool:
    """Die Teilnahmen der Person sind gerade gelesen worden: Helferdienste und Stunden festhalten - True, wenn sich
    etwas geändert hat. Der Zeitpunkt wandert immer weiter, damit der stündliche Lauf nicht noch einmal fragt."""
    try:
        shifts, hours = helper_numbers(rows)
        return await _keep(db, user_id, {"shifts": shifts, "hours": hours}, "shifts_at", "helper_shifts", always=True)
    except Exception:  # noqa: BLE001 - eine Spur darf nie den Reiter mit den Teilnahmen verhindern
        logger.warning("[member_activity] participations not noted", exc_info=True)
        return False


async def refresh_due(db=None) -> dict:
    """Stündlich (Job ``dolibarr_public``): die Helferdienste aus den Teilnahmen der Mitgliederakte nachlesen - nur für
    aktive Mitglieder mit Weg zur Akte, je Konto höchstens einmal in ``REFRESH_HOURS`` Stunden, höchstens
    ``REFRESH_BATCH`` Abrufe je Lauf, die am längsten nicht gelesenen zuerst. Antwortet Dolibarr nicht oder fehlt das
    Recht, hört der Lauf auf und der letzte Stand bleibt."""
    from database import get_db
    from services import dolibarr_identity
    from services.achievement_counters import STATS
    from services.dolibarr_client import DolibarrClient, DolibarrError, load_settings
    from services.dolibarr_participations import members_by_user
    from services.membership_service import ACTIVE_STATUSES

    db = db if db is not None else get_db()
    settings = await load_settings(db)
    if settings.get("mode") != "live":
        return {"ok": False, "skipped": "not_live"}
    state = await db.settings.find_one({"id": dolibarr_identity.STATE_ID}, {"_id": 0, "module_version": 1}) or {}
    if dolibarr_identity.parse_version(state.get("module_version")) < PARTICIPATIONS_MIN_VERSION:
        return {"ok": False, "skipped": "module_version"}
    linked = sorted(await members_by_user(db, settings))
    members = [row["user_id"] async for row in db.memberships.find({"user_id": {"$in": linked}, "member_status": {"$in": sorted(ACTIVE_STATUSES)}},
                                                                   {"_id": 0, "user_id": 1})] if linked else []
    if not members:
        return {"ok": True, "refreshed": 0, "changed": 0, "pending": 0}
    seen = {row["user_id"]: str((row.get(RECORD) or {}).get("shifts_at") or "")
            async for row in db[STATS].find({"user_id": {"$in": members}}, {"_id": 0, "user_id": 1, f"{RECORD}.shifts_at": 1})}
    cutoff = (now_utc() - timedelta(hours=REFRESH_HOURS)).isoformat()
    due = sorted((user_id for user_id in members if seen.get(user_id, "") < cutoff), key=lambda user_id: (seen.get(user_id, ""), user_id))
    if not due:
        return {"ok": True, "refreshed": 0, "changed": 0, "pending": 0}
    try:
        client = DolibarrClient(settings)
    except DolibarrError as exc:
        return {"ok": False, "error": exc.kind}
    calls = changed = 0
    for index, user_id in enumerate(due):
        if calls >= REFRESH_BATCH:
            return {"ok": True, "refreshed": calls, "changed": changed, "pending": len(due) - index}
        access = await dolibarr_identity.access_for(db, settings, user_id)
        if not access or (access["mode"] == "subject" and "record" not in access["capabilities"]):
            continue   # kein Weg zu den Teilnahmen - kostet keinen Abruf
        calls += 1
        try:
            rows = await client.my_participations(access["params"])
        except DolibarrError as exc:
            if exc.kind == "not_found" or (exc.kind == "forbidden" and access["mode"] == "subject"):
                # Das Mitglied gibt es nicht mehr, oder seine Bindung erlaubt es nicht mehr: morgen wieder fragen.
                await _keep(db, user_id, {}, "shifts_at", "helper_shifts", always=True)
                continue
            if exc.kind == "forbidden":
                await dolibarr_identity.forbidden(db, access)   # das Recht fehlt für alle - steht dann unter Dolibarr → Stand
            return {"ok": False, "error": exc.kind, "refreshed": calls - 1, "changed": changed}
        await dolibarr_identity.member_call_ok(db, access)
        changed += 1 if await note_participations(db, user_id, rows) else 0
    return {"ok": True, "refreshed": calls, "changed": changed, "pending": 0}
