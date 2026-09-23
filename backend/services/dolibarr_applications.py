"""Beitrittsantrag über Dolibarr (#328): ein Antrag, eine Entscheidung, ein Stand.

Solange der Schalter „Anträge nach Dolibarr senden“ aus ist (oder die Anbindung nicht auf „live“
steht), bleibt alles wie bisher: Antrag auf der Website, Entscheidung durch den Vorstand im Admin.
Mit Schalter fragt „Mitglied werden“ Dolibarr, was der Antrag verlangt (``/vereine/applicationform``),
welche Mitgliedsarten es gibt (``/vereine/membershipfees``) und welche Einwilligungstexte gerade
gelten (``/vereine/consents``), schickt den Antrag als Mitglied im Entwurf (``POST
/vereine/applications``) und liest seinen Stand nach (``GET /vereine/applications/{external_id}``).
Aufgenommen oder abgelehnt wird **nur in Dolibarr**; die Website zeigt den Stand und schaltet bei
der Aufnahme das gebundene Konto frei (bestätigte Zuordnung + Abgleich, #295).

Regeln, die hier durchgesetzt werden:
- Jeder Antrag trägt eine feste ``external_id`` (``web-<Antrags-ID>``). Ein zweites Senden - nach
  Netzwerkfehler, Neustart oder Doppelklick - legt nie ein zweites Mitglied an: Dolibarr antwortet
  ``duplicate``, und die Website verschickt denselben Antrag nie mit anderem Inhalt.
- Ein technischer Fehler beim Senden ist kein Antragsstand: der Antrag bleibt ``submitting`` und
  wird vom Job wieder versucht; die Person sieht „wird übermittelt“, nicht „abgelehnt“.
- Ein fachliches Nein von Dolibarr (400, etwa fehlende Pflichtangabe oder veraltete
  Einwilligungsversion) wird ``failed`` - die Person stellt den Antrag neu, nichts hängt.
- Den Ablehnungsgrund sieht nur die Person selbst; interne Anmerkungen liefert Dolibarr nie.
- E-Mails zur Entscheidung schickt die Website genau einmal je Stand.
"""
from __future__ import annotations

import logging
from datetime import timedelta

from models import new_id, now_utc
from services.dolibarr_client import DolibarrClient, DolibarrError

logger = logging.getLogger("tls.dolibarr.applications")

SETTING_KEY = "applications_enabled"
STATUS_MAP = {"received": "pending", "in_review": "pending", "accepted": "approved", "rejected": "rejected", "withdrawn": "withdrawn"}
CHECK_INTERVAL_SECONDS = 120          # so oft liest die eigene Seite höchstens nach
JOB_CHECK_INTERVAL_SECONDS = 600      # der Job liest offene Anträge alle zehn Minuten nach
RETRY_DELAYS = (60, 300, 900, 3600)   # Sendeversuche nach einem technischen Fehler
RETRY_MAX = 24
FORM_FIELDS = ("firstname", "lastname", "phone", "birth", "address", "zip", "town")
FIELD_LABELS = {"firstname": "Vorname", "lastname": "Nachname", "email": "E-Mail", "phone": "Telefon", "birth": "Geburtsdatum", "address": "Straße und Hausnummer", "zip": "PLZ", "town": "Ort"}
DURATION_LABELS = {"y": ("je Jahr", "Jahre"), "m": ("je Monat", "Monate"), "w": ("je Woche", "Wochen"), "d": ("je Tag", "Tage")}


def coupled(settings: dict | None) -> bool:
    """Anträge gehen nach Dolibarr, wenn die Anbindung live ist und der Betreiber es eingeschaltet hat."""
    return bool(settings) and settings.get("mode") == "live" and bool(settings.get(SETTING_KEY))


def external_id_for(application_id: str) -> str:
    return f"web-{application_id}"


def _text(value) -> str:
    return str(value or "").strip()


def period_label(fee: dict) -> str:
    duration = fee.get("duration") or {}
    value, unit = int(duration.get("value") or 1), str(duration.get("unit") or "y")
    single, plural = DURATION_LABELS.get(unit, ("je Periode", "Perioden"))
    return single if value == 1 else f"je {value} {plural}"


def public_fee(fee: dict) -> dict:
    """Die Mitgliedsart, wie „Mitglied werden“ sie zeigt - nichts Internes, nichts Gerechnetes."""
    return {
        "id": int(fee.get("id") or 0), "label": _text(fee.get("label")), "description": _text(fee.get("description")),
        "amount": fee.get("amount"), "currency": fee.get("currency") or "EUR", "period_label": period_label(fee),
        "amount_editable": bool(fee.get("amount_editable")), "subscription_required": bool(fee.get("subscription_required")),
        "admission_fee": fee.get("admission_fee") or 0, "prorated": bool(fee.get("prorated")), "proration": fee.get("proration") or "none",
        "year_starts_month": fee.get("year_starts_month") or 0,
    }


async def form_bundle(client: DolibarrClient) -> dict:
    """Was das Formular braucht: Pflichtfelder, eigene Felder, Mitgliedsarten für Personen, Einwilligungstexte."""
    form = await client.application_form()
    fees = [public_fee(fee) for fee in await client.membership_fees() if fee.get("for") in ("natural", "both", None)]
    consents = [{"code": _text(c.get("code")), "label": _text(c.get("label")), "version": int(c.get("version") or 1), "text": _text(c.get("text"))}
                for c in await client.consent_texts() if _text(c.get("code"))]
    return {
        "form": {
            "required": [f for f in (form.get("required") or []) if isinstance(f, str)],
            "fields": [{"code": _text(f.get("code")), "label": _text(f.get("label")) or _text(f.get("code")), "required": bool(f.get("required"))}
                       for f in (form.get("fields") or []) if isinstance(f, dict) and _text(f.get("code"))],
        },
        "fees": fees,
        "consents": consents,
    }


def validate_submission(bundle: dict, person: dict, type_id: int | None, consents: list[dict], fields: dict) -> list[str]:
    """Die Prüfung vor dem Senden - dieselbe Liste, mit der Dolibarr ablehnen würde, nur in Worten."""
    problems = []
    required = set(bundle["form"]["required"]) | {"firstname", "lastname", "email"}
    for key in required:
        if not _text(person.get(key)):
            problems.append(f"{FIELD_LABELS.get(key, key)} fehlt.")
    if not type_id or not any(fee["id"] == type_id for fee in bundle["fees"]):
        problems.append("Bitte eine Mitgliedsart wählen.")
    known_fields = {f["code"]: f for f in bundle["form"]["fields"]}
    for code, meta in known_fields.items():
        if meta["required"] and not _text(fields.get(code)):
            problems.append(f"{meta['label']} fehlt.")
    for code in fields:
        if code not in known_fields:
            problems.append(f"Unbekanntes Feld „{code}“.")
    current = {c["code"]: c["version"] for c in bundle["consents"]}
    for consent in consents:
        code = consent.get("code")
        if code not in current:
            problems.append(f"Einwilligung „{code}“ gibt es nicht mehr - bitte die Seite neu laden.")
        elif int(consent.get("version") or 0) != current[code]:
            problems.append(f"Der Text zu „{code}“ hat sich geändert - bitte die Seite neu laden und noch einmal lesen.")
    return problems


def build_payload(doc: dict) -> dict:
    """Der Antrag, wie er nach Dolibarr geht - immer gleich für dieselbe external_id."""
    person = doc.get("person") or {}
    payload = {
        "external_id": doc["external_id"],
        "firstname": _text(person.get("firstname")), "lastname": _text(person.get("lastname")), "email": _text(person.get("email")),
        "type_id": int(doc.get("type_id") or 0),
    }
    for key in ("phone", "birth", "address", "zip", "town", "country_code"):
        if _text(person.get(key)):
            payload[key] = _text(person.get(key))
    if _text(doc.get("motivation")):
        payload["note"] = _text(doc.get("motivation"))[:2000]
    if doc.get("fields"):
        payload["fields"] = {code: _text(value) for code, value in doc["fields"].items() if _text(value)}
    payload["consents"] = [
        {"code": c["code"], "version": int(c["version"]), "granted_at": c.get("granted_at") or doc.get("created_at"), "form": "Website: Mitglied werden", "reference": doc["external_id"]}
        for c in doc.get("consents") or []
    ]
    return payload


async def submit(db, client: DolibarrClient, doc: dict) -> dict:
    """Senden - oder ehrlich festhalten, warum nicht. Technisch = später wieder, fachlich = neu stellen."""
    now = now_utc()
    attempts = int((doc.get("dolibarr") or {}).get("attempts") or 0) + 1
    try:
        result = await client.submit_application(build_payload(doc))
    except DolibarrError as exc:
        if exc.kind in ("bad_request", "conflict", "forbidden", "unauthorized"):
            update = {"status": "failed", "dolibarr.error": exc.kind, "dolibarr.error_text": exc.text, "dolibarr.failed_at": now.isoformat(), "dolibarr.attempts": attempts}
        else:
            delay = RETRY_DELAYS[min(attempts - 1, len(RETRY_DELAYS) - 1)]
            update = {"status": "submitting", "dolibarr.error": exc.kind, "dolibarr.error_text": exc.text, "dolibarr.attempts": attempts,
                      "dolibarr.next_try_at": (now + timedelta(seconds=delay)).isoformat()}
            if attempts >= RETRY_MAX:
                update["status"] = "failed"
        await db.membership_applications.update_one({"id": doc["id"]}, {"$set": update})
        logger.warning("[dolibarr] Antrag %s nicht gesendet: %s", doc["external_id"], exc.kind)
        return await db.membership_applications.find_one({"id": doc["id"]}, {"_id": 0})
    application_status = str(result.get("application_status") or "received")
    update = {
        "status": STATUS_MAP.get(application_status, "pending"),
        "dolibarr": {
            "member_id": int(result.get("id") or 0), "member_ref": str(result.get("ref") or ""), "member_status": result.get("status"),
            "application_status": application_status, "duplicate": bool(result.get("duplicate")), "document": bool(result.get("document")),
            "submitted_at": now.isoformat(), "checked_at": now.isoformat(), "attempts": attempts, "reason": "",
        },
    }
    await db.membership_applications.update_one({"id": doc["id"]}, {"$set": update})
    return await db.membership_applications.find_one({"id": doc["id"]}, {"_id": 0})


async def _notify_decision(db, doc: dict, status: str, reason: str) -> None:
    """Die Person erfährt die Entscheidung genau einmal - über die Vorlagen, die es schon gibt."""
    from services.notification_preferences import send_user_template

    user = await db.users.find_one({"id": doc["user_id"]}, {"_id": 0, "id": 1, "email": 1, "display_name": 1, "username": 1, "newsletter_consent": 1, "notification_preferences": 1})
    if not user:
        return
    template = "membership_approve" if status == "approved" else "membership_reject"
    try:
        await send_user_template(user, template, display_name=user.get("display_name") or user.get("username") or "Spieler", note=reason or "")
    except Exception:  # noqa: BLE001 - eine Mail darf den Stand nie blockieren
        logger.warning("[dolibarr] Entscheidungsmail nicht gesendet", exc_info=True)


async def _accept(db, settings: dict, doc: dict, state: dict) -> None:
    """Aufnahme: das Konto an das Mitglied binden und den Stand gleich nachlesen lassen (#295)."""
    from services.dolibarr_links import LinkConflict, verify_link
    from services.dolibarr_sync import queue_member

    member_id = int(state.get("member_id") or 0)
    if not member_id:
        return
    try:
        await verify_link(db, settings, user_id=doc["user_id"], member_id=member_id, member_ref=state.get("member_ref") or None, source="application", actor_id="dolibarr")
    except LinkConflict as exc:
        await db.membership_applications.update_one({"id": doc["id"]}, {"$set": {"dolibarr.link_conflict": str(exc)}})
        logger.warning("[dolibarr] Antrag %s aufgenommen, aber Zuordnung strittig: %s", doc["external_id"], exc)
        return
    await queue_member(db, settings, member_id)


async def refresh(db, settings: dict, client: DolibarrClient, doc: dict, *, force: bool = False) -> dict:
    """Den Stand eines offenen Antrags nachlesen; Entscheidungen einmal verarbeiten."""
    if doc.get("status") != "pending" or not doc.get("external_id"):
        return doc
    state_info = doc.get("dolibarr") or {}
    checked = state_info.get("checked_at")
    if not force and checked and (now_utc() - _parse(checked)).total_seconds() < CHECK_INTERVAL_SECONDS:
        return doc
    now = now_utc().isoformat()
    try:
        state = await client.application_state(doc["external_id"])
    except DolibarrError as exc:
        await db.membership_applications.update_one({"id": doc["id"]}, {"$set": {"dolibarr.checked_at": now, "dolibarr.error": exc.kind, "dolibarr.error_text": exc.text}})
        return await db.membership_applications.find_one({"id": doc["id"]}, {"_id": 0})
    application_status = str(state.get("status") or "received")
    status = STATUS_MAP.get(application_status, "pending")
    update = {
        "status": status, "dolibarr.application_status": application_status, "dolibarr.checked_at": now,
        "dolibarr.reason": _text(state.get("reason")), "dolibarr.received_at": state.get("received_at"), "dolibarr.decided_at": state.get("decided_at") or None,
    }
    unset = {"dolibarr.error": "", "dolibarr.error_text": ""}
    if int(state.get("member_id") or 0):
        update["dolibarr.member_id"] = int(state["member_id"])
        update["dolibarr.member_ref"] = str(state.get("member_ref") or "")
    if status in ("approved", "rejected"):
        update["decided_at"] = state.get("decided_at") or now
        update["decided_by"] = "dolibarr"
        update["decision_note"] = _text(state.get("reason")) if status == "rejected" else None
    await db.membership_applications.update_one({"id": doc["id"]}, {"$set": update, "$unset": unset})
    fresh = await db.membership_applications.find_one({"id": doc["id"]}, {"_id": 0})
    if status in ("approved", "rejected") and not fresh.get("notified_at"):
        if status == "approved":
            await _accept(db, settings, fresh, state)
        await _notify_decision(db, fresh, status, fresh.get("decision_note") or "")
        await db.membership_applications.update_one({"id": doc["id"]}, {"$set": {"notified_at": now}})
        fresh = await db.membership_applications.find_one({"id": doc["id"]}, {"_id": 0})
    return fresh


async def withdraw(db, client: DolibarrClient, doc: dict) -> dict:
    """Zurückziehen, solange der Verein nicht entschieden hat; 409 von Dolibarr heißt: schon entschieden."""
    result = await client.withdraw_application(doc["external_id"])
    now = now_utc().isoformat()
    await db.membership_applications.update_one({"id": doc["id"]}, {"$set": {
        "status": "withdrawn", "dolibarr.application_status": "withdrawn", "dolibarr.checked_at": now, "withdrawn_at": now, "decided_at": now, "decided_by": doc["user_id"],
    }})
    logger.info("[dolibarr] Antrag %s zurückgezogen (changed=%s)", doc["external_id"], result.get("changed"))
    return await db.membership_applications.find_one({"id": doc["id"]}, {"_id": 0})


async def refresh_due(db=None) -> dict:
    """Der Job: hängende Sendungen wieder versuchen, offene Anträge nachlesen."""
    from database import get_db
    from services.dolibarr_client import load_settings

    db = db if db is not None else get_db()
    settings = await load_settings(db)
    if not coupled(settings):
        return {"ok": False, "kind": "switched_off"}
    try:
        client = DolibarrClient(settings)
    except DolibarrError as exc:
        return {"ok": False, "kind": exc.kind}
    now = now_utc().isoformat()
    sent = checked = 0
    async for doc in db.membership_applications.find({"status": "submitting", "external_id": {"$exists": True}}, {"_id": 0}):
        if (doc.get("dolibarr") or {}).get("next_try_at", "") <= now:
            await submit(db, client, doc)
            sent += 1
    due = (now_utc() - timedelta(seconds=JOB_CHECK_INTERVAL_SECONDS)).isoformat()
    async for doc in db.membership_applications.find({"status": "pending", "external_id": {"$exists": True}}, {"_id": 0}):
        if (doc.get("dolibarr") or {}).get("checked_at", "") <= due:
            await refresh(db, settings, client, doc, force=True)
            checked += 1
    return {"ok": True, "sent": sent, "checked": checked}


def _parse(value: str):
    from datetime import datetime, timezone
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def own_view(doc: dict | None) -> dict | None:
    """Was die Person über ihren Antrag sieht - Stand, Zeitpunkte, ihr Grund; nie interne Notizen."""
    if not doc:
        return None
    state = doc.get("dolibarr") or {}
    return {
        "id": doc["id"], "status": doc.get("status"), "created_at": doc.get("created_at"), "decided_at": doc.get("decided_at"),
        "decision_note": doc.get("decision_note"), "contribution_pref": doc.get("contribution_pref"), "motivation": doc.get("motivation"),
        "coupled": bool(doc.get("external_id")),
        "dolibarr": {
            "external_id": doc.get("external_id"), "application_status": state.get("application_status"), "member_ref": state.get("member_ref") or None,
            "submitted_at": state.get("submitted_at"), "checked_at": state.get("checked_at"), "next_try_at": state.get("next_try_at"),
            "error": state.get("error"), "error_text": state.get("error_text"), "reason": state.get("reason") or "",
        } if doc.get("external_id") else None,
        "person": doc.get("person") if doc.get("external_id") else None,
        "type_id": doc.get("type_id"),
    }


def admin_view(doc: dict, settings: dict) -> dict:
    """Für die Verwaltung: der Stand aus Dolibarr und der Weg zur Mitgliedskarte - keine zweite Entscheidung."""
    state = doc.get("dolibarr") or {}
    if not doc.get("external_id"):
        return {**doc, "coupled": False}
    member_id = int(state.get("member_id") or 0)
    base = str(settings.get("base_url") or "").rstrip("/")
    return {
        **doc, "coupled": True,
        "dolibarr": {**state, "member_url": f"{base}/adherents/card.php?rowid={member_id}" if base and member_id else None},
    }
