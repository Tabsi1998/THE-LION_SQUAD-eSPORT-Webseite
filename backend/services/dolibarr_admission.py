"""Einlass bei der Generalversammlung (#845, Vereine 1.7.0): Mitgliedskarte am Eingang scannen, Anwesenheit in Dolibarr.

Am Eingang scannt ein Vorstandsmitglied den QR-Code der Mitgliedskarte. Die Website löst den fünf Minuten gültigen
Prüfcode in das Konto auf, über die bestätigte Zuordnung in die Mitgliedsnummer, und setzt im Vereinsmodul „anwesend“
(``PUT /vereine/meetings/{id}/attendance/{member}``) - **im Namen des scannenden Vorstandsmitglieds**: über dessen
Zuordnung (der API-Benutzer braucht das Recht „Mitglieder bei einer Generalversammlung einlassen“) oder seine Bindung
mit der Fähigkeit ``attendance``. Wer am Tag keine Vorstandsfunktion hat, bekommt vom Modul ein Nein; das prüft das
Modul, nicht die Website. Damit gelten Stimmrecht und Beschlussfähigkeit sofort, und das Abstimmen erscheint bei den
Anwesenden.

- Dieselbe Karte noch einmal ändert nichts: Die Kennung hängt an Versammlung, Mitglied und Einlass-Runde.
- Rücknahme („war ein Versehen“) mit Grund: ``DELETE`` - danach beginnt für dieses Mitglied eine neue Runde.
- Ohne Karte: die Mitgliedsnummer eintippen (``members/lookup``).
- Die Zahlen (anwesend, stimmberechtigt, beschlussfähig ab) kommen mit jeder Antwort; die Website merkt sich die
  letzten je Versammlung, damit alle Geräte am Eingang denselben Stand sehen.
"""
from __future__ import annotations

import re

from models import now_utc
from services import dolibarr_identity, dolibarr_policy
from services.dolibarr_client import DolibarrClient, DolibarrError, load_settings
from services.member_card import VERIFY_PATH, card_status

COLLECTION = "meeting_admissions"
STATE_COLLECTION = "meeting_admission_counts"
GENERAL_KINDS = ("general", "extraordinary")
RIGHT_LABEL = "Mitglieder bei einer Generalversammlung einlassen"
REASON_TEXTS = {
    "own": "stimmberechtigt",
    "proxy": "stimmberechtigt, mit Vollmacht",
    "no_voting_right": "ohne Stimmrecht (laut Einladung)",
    "not_member": "am Versammlungstag kein Mitglied – ohne Stimmrecht",
    "absent": "nicht anwesend",
}
NOT_READY_TEXTS = {
    "not_connected": "Die Mitgliederverwaltung ist nicht live angebunden.",
    "not_bound": "Dein Konto ist keinem Mitglied zugeordnet – Einlass geht nur im Namen eines Vorstandsmitglieds mit Zuordnung.",
    "no_capability": "Deine Verbindung zur Vereinsakte erlaubt den Einlass nicht – in Dolibarr die Fähigkeit „Einlass bei der Generalversammlung“ einschalten.",
}
TOKEN = re.compile(r"[A-Za-z0-9_-]{8,40}")


class AdmissionError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


def token_from(code: str) -> str:
    """Der Prüfcode aus dem QR-Inhalt: die Adresse …/karte/pruefen/<code> oder der Code allein."""
    text = str(code or "").strip()
    if VERIFY_PATH in text:
        text = text.split(VERIFY_PATH, 1)[1].strip("/").split("/")[0].split("?")[0]
    return text if TOKEN.fullmatch(text) else ""


def short_name(firstname: str, lastname: str, fallback: str = "Mitglied") -> str:
    first, last = str(firstname or "").strip(), str(lastname or "").strip()
    if first and last:
        return f"{first} {last[0]}."
    return first or last or fallback


async def _scanner(db, user: dict):
    """Wie die Website für das scannende Vorstandsmitglied beim Modul auftritt - oder warum nicht."""
    settings = await load_settings(db)
    if settings.get("mode") != "live":
        return None, None, "not_connected"
    access = await dolibarr_identity.access_for(db, settings, user["id"])
    if not access:
        return None, None, "not_bound"
    if access["mode"] == "subject" and "attendance" not in access["capabilities"]:
        return access, None, "no_capability"
    try:
        client = DolibarrClient(settings)
    except DolibarrError as exc:
        raise AdmissionError(503, exc.text) from exc
    return access, client, None


def _meeting_today(row: dict, today: str) -> bool:
    return str(row.get("kind") or "") in GENERAL_KINDS and str(row.get("status") or "") == "invited" and str(row.get("day") or "") == today


async def overview(db, user: dict, *, today: str | None = None) -> dict:
    """Die Generalversammlungen von heute, ihre letzten Zahlen und wer zuletzt eingelassen wurde."""
    day = today or dolibarr_policy.club_today()
    access, client, reason = await _scanner(db, user)
    if reason:
        return {"ready": False, "reason": reason, "text": NOT_READY_TEXTS[reason], "meetings": []}
    try:
        rows = await client.my_meetings(access["params"])
    except DolibarrError as exc:
        if exc.kind == "forbidden":
            await dolibarr_identity.forbidden(db, access)
            return {"ready": False, "reason": "right_missing", "text": dolibarr_identity.MEMBER_RIGHT_TEXT, "meetings": []}
        return {"ready": False, "reason": exc.kind, "text": f"Dolibarr antwortet gerade nicht ({exc.text}).", "meetings": []}
    meetings = []
    for row in rows:
        if not _meeting_today(row, day):
            continue
        meeting_id = int(row.get("id") or 0)
        counts = await db[STATE_COLLECTION].find_one({"meeting_id": meeting_id}, {"_id": 0}) or None
        recent = await db[COLLECTION].find({"meeting_id": meeting_id}, {"_id": 0}).sort("updated_at", -1).to_list(20)
        meetings.append({"id": meeting_id, "title": row.get("title") or "", "kind": row.get("kind"), "day": row.get("day"), "time": row.get("time") or "",
                         "place": row.get("place") or "", "counts": counts, "recent": [_admission_view(item) for item in recent]})
    text = "" if meetings else "Heute ist keine Generalversammlung, zu der du eingeladen bist – Einlass geht nur am Versammlungstag."
    return {"ready": bool(meetings), "reason": None if meetings else "no_meeting", "text": text, "meetings": meetings}


def _admission_view(row: dict) -> dict:
    return {"member_id": row.get("member_id"), "name": row.get("name") or "", "state": row.get("state"), "voting": bool(row.get("voting")),
            "reason_text": REASON_TEXTS.get(str(row.get("reason") or ""), ""), "arrived": row.get("arrived") or "", "by_name": row.get("by_name") or "",
            "updated_at": row.get("updated_at"), "undo_reason": row.get("undo_reason") or ""}


async def _member_from_card(db, settings: dict, code: str) -> tuple[int, str, str | None]:
    """Prüfcode → Konto → Mitgliedsnummer. Unbekannt, abgelaufen, beendet: klare Ablehnung, kein Rätselraten."""
    token = token_from(code)
    if not token:
        raise AdmissionError(400, "Das ist kein QR-Code einer Mitgliedskarte.")
    row = await db.member_card_tokens.find_one({"token": token, "expires_at": {"$gt": now_utc()}}, {"_id": 0})
    if not row:
        raise AdmissionError(409, "Die Karte ist abgelaufen oder unbekannt – bitte die Karte in der App neu öffnen lassen.")
    user = await db.users.find_one({"id": row["user_id"], "is_active": True, "is_banned": {"$ne": True}},
                                   {"_id": 0, "id": 1, "display_name": 1, "username": 1, "first_name": 1, "last_name": 1}) or {}
    membership = await db.memberships.find_one({"user_id": row["user_id"]}, {"_id": 0})
    if not user or card_status(membership) != "valid":
        raise AdmissionError(409, "Diese Mitgliedskarte ist nicht gültig.")
    access = await dolibarr_identity.access_for(db, settings, row["user_id"])
    member_id = (access or {}).get("member_id")
    if not member_id:
        raise AdmissionError(409, "Dieses Konto ist keinem Mitglied in der Mitgliederverwaltung zugeordnet – bitte die Mitgliedsnummer eintippen.")
    name = short_name((membership or {}).get("first_name") or user.get("first_name"), (membership or {}).get("last_name") or user.get("last_name"),
                      user.get("display_name") or user.get("username") or "Mitglied")
    return int(member_id), name, row["user_id"]


async def _member_from_number(client: DolibarrClient, number: str) -> tuple[int, str, None]:
    ref = str(number or "").strip()
    if not ref or len(ref) > 40:
        raise AdmissionError(400, "Bitte die Mitgliedsnummer eintragen.")
    try:
        found = await client.lookup_by_ref(ref)
    except DolibarrError as exc:
        if exc.kind == "not_found":
            raise AdmissionError(404, f"Keine Mitgliedsnummer {ref} in der Mitgliederverwaltung.") from exc
        if exc.kind == "conflict":
            raise AdmissionError(409, f"Die Mitgliedsnummer {ref} passt auf mehrere Mitglieder – bitte in Dolibarr klären.") from exc
        raise AdmissionError(503, f"Dolibarr antwortet gerade nicht ({exc.text}).") from exc
    return int(found["id"]), short_name(found.get("firstname"), found.get("lastname"), f"Mitglied {ref}"), None


def _scan_error(exc: DolibarrError, access: dict) -> AdmissionError:
    """Was das Modul zum Einlass sagt, in einem Satz für den Eingang."""
    message = str((exc.detail or {}).get("message") or "").lower()
    if exc.kind == "forbidden":
        if "board" in message:
            return AdmissionError(403, "Du hast heute keine Funktion im Vorstand – einlassen darf nur der Vorstand.")
        if access["mode"] == "member":
            return AdmissionError(403, f"Dem API-Benutzer der Website fehlt in Dolibarr das Recht „{RIGHT_LABEL}“.")
        return AdmissionError(403, "Deine Verbindung zur Vereinsakte erlaubt den Einlass nicht mehr.")
    if exc.kind == "not_found":
        return AdmissionError(404, "Dieses Mitglied ist zu dieser Versammlung nicht eingeladen.")
    if exc.kind == "conflict":
        if "external_id" in message:
            return AdmissionError(409, "Dieser Einlass wurde gerade schon anders erfasst – bitte die Liste neu laden.")
        return AdmissionError(409, "Einlass geht nur am Tag einer offenen Generalversammlung.")
    if exc.kind == "bad_request":
        return AdmissionError(400, "Dolibarr lehnt die Angabe ab.")
    return AdmissionError(503, f"Dolibarr antwortet gerade nicht ({exc.text}).")


async def _remember(db, meeting_id: int, answer: dict) -> dict:
    counts = {key: answer.get(key) for key in ("present", "eligible", "quorum_from", "quorum_reached")}
    counts.update({"meeting_id": meeting_id, "at": now_utc().isoformat()})
    await db[STATE_COLLECTION].update_one({"meeting_id": meeting_id}, {"$set": counts}, upsert=True)
    return {key: value for key, value in counts.items() if key != "meeting_id"}


async def admit(db, user: dict, meeting_id: int, *, code: str = "", number: str = "", today: str | None = None) -> dict:
    """Ein Scan (``code``) oder eine eingetippte Mitgliedsnummer (``number``) → anwesend in Dolibarr."""
    access, client, reason = await _scanner(db, user)
    if reason:
        raise AdmissionError(409, NOT_READY_TEXTS[reason])
    settings = await load_settings(db)
    if code:
        member_id, name, member_user_id = await _member_from_card(db, settings, code)
    else:
        member_id, name, member_user_id = await _member_from_number(client, number)
    key = {"meeting_id": int(meeting_id), "member_id": member_id}
    earlier = await db[COLLECTION].find_one(key, {"_id": 0}) or {}
    round_ = int(earlier.get("round") or 0)
    try:
        answer = await client.admit(int(meeting_id), member_id, access["params"], external_id=f"in-{int(meeting_id)}-{member_id}-{round_}")
    except DolibarrError as exc:
        raise _scan_error(exc, access) from exc
    at = now_utc().isoformat()
    already = earlier.get("state") == "present"
    doc = {**key, "round": round_, "name": name, "user_id": member_user_id, "state": answer.get("state"), "voting": bool(answer.get("voting")),
           "reason": answer.get("reason"), "arrived": answer.get("arrived") or "", "by": user["id"],
           "by_name": user.get("display_name") or user.get("username") or "", "updated_at": at}
    await db[COLLECTION].update_one(key, {"$set": doc, "$unset": {"undo_reason": ""}}, upsert=True)
    counts = await _remember(db, int(meeting_id), answer)
    return {"ok": True, "already": already, "admission": _admission_view(doc), "counts": counts,
            "headline": f"{'Schon anwesend' if already else 'Anwesend'}: {name}", "detail": REASON_TEXTS.get(str(answer.get("reason") or ""), "")}


async def undo(db, user: dict, meeting_id: int, member_id: int, reason: str) -> dict:
    """Rücknahme („war ein Versehen“) mit Grund. Danach beginnt eine neue Runde - ein neuer Scan ist ein neuer Einlass."""
    text = str(reason or "").strip()
    if not text:
        raise AdmissionError(400, "Bitte einen Grund angeben, etwa „falscher Ausweis“.")
    access, client, why = await _scanner(db, user)
    if why:
        raise AdmissionError(409, NOT_READY_TEXTS[why])
    key = {"meeting_id": int(meeting_id), "member_id": int(member_id)}
    earlier = await db[COLLECTION].find_one(key, {"_id": 0})
    if not earlier or earlier.get("state") != "present":
        raise AdmissionError(404, "Dieses Mitglied ist hier nicht als anwesend eingetragen.")
    round_ = int(earlier.get("round") or 0)
    try:
        answer = await client.admit_undo(int(meeting_id), int(member_id), access["params"], external_id=f"out-{int(meeting_id)}-{int(member_id)}-{round_}", reason=text[:200])
    except DolibarrError as exc:
        raise _scan_error(exc, access) from exc
    doc = {"state": answer.get("state"), "voting": bool(answer.get("voting")), "reason": answer.get("reason"), "arrived": "", "round": round_ + 1,
           "undo_reason": text[:200], "by": user["id"], "by_name": user.get("display_name") or user.get("username") or "", "updated_at": now_utc().isoformat()}
    await db[COLLECTION].update_one(key, {"$set": doc})
    counts = await _remember(db, int(meeting_id), answer)
    return {"ok": True, "admission": _admission_view({**earlier, **doc}), "counts": counts}
