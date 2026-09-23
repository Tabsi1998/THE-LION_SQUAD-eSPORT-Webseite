"""Vereinsdaten und Vorstand aus Dolibarr (#326, Teil 1): eine Quelle für Impressum, Kontakt und
Datenschutzerklärung statt doppelter Pflege.

Das Vereinsmodul liefert ``/vereine/organization`` (Name, ZVR, Vereinsbehörde, Anschrift, Kontakt,
Gründung, Zweck) und ``/vereine/board`` (Funktionen mit heutigen Inhabern; Namen nur, wo die Person
eingewilligt hat - sonst ``null``). Die Website liest beides stündlich (Job ``dolibarr_public``) und
auf Knopfdruck und hält den Stand mit Zeitpunkt in ``dolibarr_public``. Ein Ausfall ändert nichts:
der letzte gute Stand bleibt, der Fehler steht daneben - nie werden „andere“ Vereinsdaten gezeigt,
weil Dolibarr gerade nicht antwortet.

Übernommen werden die Werte nur, wenn der Betreiber den Schalter „Vereinsdaten aus Dolibarr
übernehmen“ gesetzt hat (``legal_from_dolibarr`` in den Branding-Einstellungen); von Hand gepflegte
Felder bleiben Rückfall, und alles Redaktionelle (Datenschutz-E-Mail, inhaltlich Verantwortlicher,
Hosting, UID, Zusatztexte) bleibt von Hand. Namen: ``null`` heißt keine Einwilligung - dann bleibt
die vertretungsbefugte Person, wie sie von Hand eingetragen ist; nie aus anderen Quellen
rekonstruieren. Vorstandsnamen aus einem Stand, der älter ist als ``NAME_MAX_AGE_HOURS``, werden
zurückgehalten, damit ein Widerruf zeitnah wirkt.
"""
from __future__ import annotations

from datetime import datetime, timezone

from models import now_utc
from services.dolibarr_client import DolibarrClient, DolibarrError

COLLECTION = "dolibarr_public"
STATE_ID = "state"
NAME_MAX_AGE_HOURS = 48
COUNTRY_NAMES = {"AT": "Österreich", "DE": "Deutschland", "CH": "Schweiz", "IT": "Italien", "LI": "Liechtenstein"}
# Wer den Verein nach außen vertritt: bevorzugt der Obmann / die Obfrau (Funktionscode beginnt so).
REPRESENTATIVE_CODES = ("obmann", "obfrau", "praesident", "vorsitz")
# Felder, die der Schalter aus Dolibarr übernimmt - alles andere bleibt von Hand.
OVERLAY_FIELDS = ("legal_name", "zvr_number", "register_authority", "street_address", "postal_code", "city", "country", "phone",
                  "representative_name", "representative_role")


def _age_hours(value, now: datetime | None = None) -> float | None:
    if not value:
        return None
    try:
        moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return ((now or datetime.now(timezone.utc)) - moment).total_seconds() / 3600


def names_withheld(fetched_at, now: datetime | None = None) -> bool:
    """Zu alt für Personennamen: ein Widerruf in Dolibarr muss zeitnah auf der Website wirken."""
    age = _age_hours(fetched_at, now)
    return age is None or age > NAME_MAX_AGE_HOURS


def representative(board: list[dict] | None, *, fetched_at=None, now: datetime | None = None) -> dict | None:
    """Die vertretungsbefugte Person: eine Vorstandsfunktion mit `represents`, bevorzugt Obmann/Obfrau,
    nur mit freigegebenem Namen (sonst None - dann bleibt der Eintrag von Hand)."""
    if names_withheld(fetched_at, now):
        return None
    candidates = [f for f in board or [] if f.get("represents") and f.get("board")]
    candidates.sort(key=lambda f: 0 if str(f.get("code") or "").lower().startswith(REPRESENTATIVE_CODES) else 1)
    for function in candidates:
        for holder in function.get("holders") or []:
            if holder.get("name"):
                return {"name": str(holder["name"]).strip(), "role": str(function.get("label") or "").strip(), "code": function.get("code"), "since": holder.get("since")}
    return None


def legal_overlay(organization: dict | None, board: list[dict] | None, *, fetched_at=None, now: datetime | None = None) -> dict:
    """Was aus Dolibarr ins Impressum kommt - nur belegte Felder, nie Leerstrings."""
    org = organization or {}
    address = org.get("address") or {}
    register = org.get("register") or {}
    values = {
        "legal_name": org.get("name"),
        "zvr_number": register.get("number") if str(register.get("kind") or "ZVR").upper() == "ZVR" else None,
        "register_authority": org.get("authority"),
        "street_address": address.get("street"),
        "postal_code": address.get("zip"),
        "city": address.get("town"),
        "country": COUNTRY_NAMES.get(str(address.get("country_code") or "").upper()),
        "phone": org.get("phone"),
    }
    person = representative(board, fetched_at=fetched_at, now=now)
    if person:
        values["representative_name"] = person["name"]
        values["representative_role"] = person["role"]
    return {key: str(value).strip() for key, value in values.items() if value not in (None, "") and str(value).strip()}


def board_public(board: list[dict] | None, *, fetched_at=None, now: datetime | None = None) -> list[dict]:
    """Der Vorstand für die Website: Funktion und Inhaber, Namen nur bei Einwilligung (sonst null),
    keine Rechnungsprüfer, keine Interna."""
    withheld = names_withheld(fetched_at, now)
    rows = []
    for function in board or []:
        if not function.get("board"):
            continue
        rows.append({
            "code": function.get("code"), "label": function.get("label"), "represents": bool(function.get("represents")),
            "holders": [{"name": None if withheld else (holder.get("name") or None), "since": holder.get("since")} for holder in function.get("holders") or []],
        })
    return rows


def organization_public(organization: dict | None) -> dict:
    """Was vom Verein öffentlich ist - für die Vereinsseite: Name, Gründung, Zweck, gemeinnützig, Website."""
    org = organization or {}
    return {
        "name": org.get("name") or "", "founded": org.get("founded") or None, "purpose": org.get("purpose") or "",
        "nonprofit": bool(org.get("nonprofit")), "url": org.get("url") or "", "email": org.get("email") or "",
    }


async def refresh(db, settings: dict, client: DolibarrClient) -> dict:
    """Beides neu lesen. Ein Fehler lässt den letzten Stand stehen und wird daneben vermerkt."""
    now = now_utc().isoformat()
    try:
        organization = await client.organization()
        board = await client.board()
    except DolibarrError as exc:
        await db[COLLECTION].update_one({"id": STATE_ID}, {"$set": {"error": exc.kind, "error_text": exc.text, "error_at": now}, "$setOnInsert": {"id": STATE_ID}}, upsert=True)
        return {"ok": False, "kind": exc.kind, "text": exc.text}
    await db[COLLECTION].update_one({"id": STATE_ID}, {
        "$set": {"organization": organization, "board": board, "fetched_at": now},
        "$unset": {"error": "", "error_text": "", "error_at": ""},
        "$setOnInsert": {"id": STATE_ID},
    }, upsert=True)
    return {"ok": True, "fetched_at": now, "functions": len(board)}


async def refresh_due() -> dict:
    """Der stündliche Job: nur mit Anbindung; ohne sie gibt es nichts zu lesen."""
    from database import get_db
    from services.dolibarr_client import load_settings

    db = get_db()
    settings = await load_settings(db)
    if settings.get("mode") == "off":
        return {"ok": False, "kind": "not_configured"}
    try:
        client = DolibarrClient(settings)
    except DolibarrError as exc:
        return {"ok": False, "kind": exc.kind}
    return await refresh(db, settings, client)


async def snapshot(db) -> dict:
    return await db[COLLECTION].find_one({"id": STATE_ID}, {"_id": 0}) or {}


async def public_legal_source(db, branding: dict) -> tuple[dict, dict]:
    """Der Overlay für die öffentliche Projektion und die Herkunftsangabe - leer, solange der Schalter aus ist."""
    if not branding.get("legal_from_dolibarr"):
        return {}, {"dolibarr": False}
    state = await snapshot(db)
    if not state.get("organization"):
        return {}, {"dolibarr": True, "fetched_at": None, "fields": [], "error": state.get("error")}
    overlay = legal_overlay(state.get("organization"), state.get("board"), fetched_at=state.get("fetched_at"))
    return overlay, {"dolibarr": True, "fetched_at": state.get("fetched_at"), "fields": sorted(overlay), "error": state.get("error")}


async def admin_view(db, branding: dict) -> dict:
    """Für den Reiter Rechtliches: Stand, Fehler, was übernommen würde, der Vorstand mit Einwilligungsstand."""
    state = await snapshot(db)
    has_data = bool(state.get("organization"))
    overlay = legal_overlay(state.get("organization"), state.get("board"), fetched_at=state.get("fetched_at")) if has_data else {}
    person = representative(state.get("board"), fetched_at=state.get("fetched_at")) if has_data else None
    return {
        "enabled": bool(branding.get("legal_from_dolibarr")),
        "has_data": has_data,
        "fetched_at": state.get("fetched_at"),
        "names_withheld": names_withheld(state.get("fetched_at")) if has_data else False,
        "error": state.get("error"), "error_text": state.get("error_text"), "error_at": state.get("error_at"),
        "overlay": overlay,
        "representative": person,
        "board": board_public(state.get("board"), fetched_at=state.get("fetched_at")) if has_data else [],
        "organization": organization_public(state.get("organization")) if has_data else None,
        "fields": list(OVERLAY_FIELDS),
    }
