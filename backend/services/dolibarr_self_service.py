"""Meine Mitgliedschaft: eigene Daten und Austritt über die Vereinsakte (#329 Teil 2).

Baut auf der persönlichen Bindung (#324 Teil 1, ``dolibarr_identity``) auf: nur ein Konto, das per
Einladungscode an sein Mitglied gebunden ist **und** dessen Bindung die Fähigkeit ``profile`` trägt,
sieht seine Daten aus Dolibarr und darf Änderungen einreichen. Die Website führt dabei keine zweite
Wahrheit: Was übernommen ist, sagt ``GET /vereine/me/profile`` (mit ``version``, dem Stand der
Kontaktdaten, und ``direct``, den Feldern, die der Verein sofort übernimmt); was eingereicht ist, sagt
``GET /vereine/me/profile/changes``. Eine Änderung nennt die ``version``, die die Person gesehen hat -
hat sich der Stand seither geändert, antwortet das Modul 409, und die Website überschreibt nichts still.
Der Austritt geht mit heutigem Eingang ein; den letzten Tag ergibt die Kündigungsregel des Vereins,
ein früherer Wunsch wird nicht übernommen (``wished_too_early``). Jede Einreichung trägt eine
``external_id`` aus Konto und Inhalt: dieselbe Einreichung noch einmal ist derselbe Auftrag.
"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import date

from models import now_utc
from services import dolibarr_identity
from services.dolibarr_client import DolibarrClient, DolibarrError, load_settings

CHANGEABLE = ("address", "zip", "town", "country_code", "phone", "phone_mobile", "email")
PROFILE_FIELDS = ("member_id", "ref", "firstname", "lastname", "birth", "address", "zip", "town", "country_code", "phone", "phone_mobile", "email",
                  "member_type", "status", "version", "direct", "exit")
REQUEST_FIELDS = ("external_id", "kind", "changes", "status", "reason", "received_at", "decided_at", "notice_day", "last_day", "wished_last_day", "wished_too_early")
STATUS_LABELS = {"received": "beim Vorstand", "applied": "übernommen", "rejected": "abgelehnt"}
WEBSITE_TYPES = ("text", "textarea", "number", "date", "boolean", "select", "multi")
REASON_TEXTS = {
    "not_connected": "Die Mitgliederverwaltung ist nicht live angebunden.",
    "module_too_old": "Das Vereinsmodul kennt das eigene Website-Profil noch nicht (ab Vereine 1.2).",
    "not_bound": "Dafür muss dein Konto mit deinem Mitgliedseintrag verbunden sein – das passiert von selbst über die bestätigte "
                 "E-Mail-Adresse oder durch den Vorstand (Dolibarr → Zuordnungen); alternativ mit einem Einladungscode unter Meine Mitgliedschaft.",
    "right_missing": dolibarr_identity.MEMBER_RIGHT_TEXT,
    "no_capability": "Deine Verbindung erlaubt das Ändern eigener Daten noch nicht – der Vorstand schaltet die Fähigkeit „eigene Daten“ in Dolibarr ein.",
}


class SelfServiceError(Exception):
    def __init__(self, status: int, detail: str, reason: str | None = None):
        super().__init__(detail)
        self.status = status
        self.detail = detail
        self.reason = reason


async def _access(db, user: dict):
    """Anbindung live und ein Weg zur Akte: ab Vereine 1.4.0 die bestätigte Zuordnung (``member_id``, #531), sonst
    die Bindung per Einladungscode mit Fähigkeit ``profile`` - sonst der Grund."""
    settings = await load_settings(db)
    if settings.get("mode") != "live":
        return settings, None, None, "not_connected"
    access = await dolibarr_identity.access_for(db, settings, user["id"])
    if not access:
        return settings, None, None, "not_bound"
    if access["mode"] == "subject" and "profile" not in access["capabilities"]:
        return settings, access, None, "no_capability"
    try:
        client = DolibarrClient(settings)
    except DolibarrError as exc:
        return settings, access, None, exc.kind
    return settings, access, client, None


async def _denied(db, access: dict) -> str:
    """403 vom Modul: über die Bindung ist sie widerrufen, über die Mitgliedsnummer fehlt das Recht."""
    await dolibarr_identity.forbidden(db, access)
    return "right_missing" if access["mode"] == "member" else "not_bound"


def _request_view(row: dict) -> dict:
    view = {key: row.get(key) for key in REQUEST_FIELDS}
    view["status_label"] = STATUS_LABELS.get(str(row.get("status") or ""), row.get("status") or "")
    return view


def _external_id(prefix: str, user_id: str, *parts) -> str:
    digest = hashlib.sha256(json.dumps(parts, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()[:16]
    return f"web-{prefix}-{str(user_id)[:8]}-{digest}"[:64]


def _raise_for(exc: DolibarrError, *, conflict: str, denied: str = "not_bound") -> None:
    if exc.kind == "conflict":
        raise SelfServiceError(409, conflict) from exc
    if exc.kind == "forbidden":
        text = REASON_TEXTS["right_missing"] if denied == "right_missing" else "Die Verbindung zur Vereinsakte gilt nicht mehr – bitte einen neuen Einladungscode einlösen."
        raise SelfServiceError(403, text, reason=denied) from exc
    if exc.kind == "bad_request":
        raise SelfServiceError(400, "Die Mitgliederverwaltung hat das abgewiesen (Feld oder Wert passt nicht).") from exc
    raise SelfServiceError(503, f"Dolibarr antwortet gerade nicht ({exc.text}).") from exc


async def overview(db, user: dict) -> dict:
    """Die eigenen Daten und alle Einreichungen - oder warum es hier nichts gibt."""
    settings, access, client, reason = await _access(db, user)
    if reason:
        return {"available": False, "reason": reason, "text": REASON_TEXTS.get(reason, "")}
    try:
        profile = await client.my_profile(access["params"])
        requests = await client.my_profile_requests(access["params"])
    except DolibarrError as exc:
        if exc.kind == "forbidden":
            reason = await _denied(db, access)
            return {"available": False, "reason": reason, "text": REASON_TEXTS[reason]}
        return {"available": False, "reason": exc.kind, "text": f"Dolibarr antwortet gerade nicht ({exc.text})."}
    await dolibarr_identity.member_call_ok(db, access)
    return {
        "available": True, "profile": {key: profile.get(key) for key in PROFILE_FIELDS}, "changeable": list(CHANGEABLE),
        "requests": [_request_view(row) for row in requests if isinstance(row, dict)], "status_labels": dict(STATUS_LABELS),
    }


async def request_change(db, user: dict, version: str, changes: dict) -> dict:
    """Kontaktdaten ändern lassen: nur die erlaubten Felder, nur mit dem gesehenen Stand."""
    settings, access, client, reason = await _access(db, user)
    if reason:
        raise SelfServiceError(409 if reason == "no_capability" else 403, REASON_TEXTS.get(reason, "Nicht möglich."), reason=reason)
    clean: dict[str, str] = {}
    for key, value in (changes or {}).items():
        if key not in CHANGEABLE:
            raise SelfServiceError(400, f"Das Feld „{key}“ lässt sich hier nicht ändern – dafür ist der Vorstand da.")
        if not isinstance(value, str):
            raise SelfServiceError(400, f"„{key}“ braucht einen Text.")
        clean[key] = value.strip()[:200]
    if not clean:
        raise SelfServiceError(400, "Nichts geändert.")
    version = str(version or "").strip()
    if not version:
        raise SelfServiceError(400, "Der Stand der Daten fehlt – bitte die Seite neu laden.")
    payload = {"external_id": _external_id("change", user["id"], version, clean), "version": version, "changes": clean}
    try:
        row = await client.request_profile_change(access["params"], payload)
    except DolibarrError as exc:
        denied = await _denied(db, access) if exc.kind == "forbidden" else "not_bound"
        _raise_for(exc, denied=denied, conflict="Deine Daten haben sich in der Mitgliederverwaltung inzwischen geändert – bitte neu laden und noch einmal prüfen.")
    return _request_view(row)


async def request_exit(db, user: dict, wished_last_day: str | None) -> dict:
    """Den Austritt erklären. Den letzten Tag rechnet der Verein; ein früherer Wunsch wird nicht übernommen."""
    wished = str(wished_last_day or "").strip()
    if wished and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", wished):
        raise SelfServiceError(400, "Das Wunschdatum braucht die Form JJJJ-MM-TT.")
    settings, access, client, reason = await _access(db, user)
    if reason:
        raise SelfServiceError(409 if reason == "no_capability" else 403, REASON_TEXTS.get(reason, "Nicht möglich."), reason=reason)
    payload: dict = {"external_id": _external_id("exit", user["id"], now_utc().date().isoformat(), wished)}
    if wished:
        payload["wished_last_day"] = wished
    try:
        row = await client.request_exit(access["params"], payload)
    except DolibarrError as exc:
        denied = await _denied(db, access) if exc.kind == "forbidden" else "not_bound"
        _raise_for(exc, denied=denied, conflict="Ein Austritt ist schon geplant – der Stand steht bei deinen Daten.")
    return _request_view(row)


# ---------------------------------------------------------------- Eigenes Website-Profil (#260, Vereine 1.2): Felder, die der Verein wählt

def _website_view(data: dict) -> dict:
    fields = []
    for raw in data.get("fields") or []:
        if not isinstance(raw, dict) or not raw.get("code"):
            continue
        row = {"code": str(raw["code"]), "label": str(raw.get("label") or raw["code"]), "type": raw.get("type") if raw.get("type") in WEBSITE_TYPES else "text",
               "editable": bool(raw.get("editable")), "value": raw.get("value")}
        if raw.get("max_length"):
            row["max_length"] = int(raw["max_length"])
        if isinstance(raw.get("options"), list):
            row["options"] = [{"code": str(o["code"]), "label": str(o.get("label") or o["code"])} for o in raw["options"] if isinstance(o, dict) and o.get("code")]
        fields.append(row)
    return {"available": True, "consent": str(data.get("consent") or ""), "given": bool(data.get("given")), "fields": fields}


def _clean_field_value(field: dict, value):
    """Ein Wert in der Form, die das Modul erwartet: Text, Zahl, Ja/Nein, Tag, Options-Kürzel oder Liste von
    Kürzeln; leer heißt None. Passt er nicht, 400 mit dem Feldnamen - nie stilles Abschneiden."""
    label, kind = field["label"], field["type"]
    if value is None or (isinstance(value, str) and not value.strip()) or (isinstance(value, list) and not value):
        return None
    if kind in ("text", "textarea"):
        text = str(value).strip()
        limit = field.get("max_length")
        if limit and len(text) > limit:
            raise SelfServiceError(400, f"{label}: höchstens {limit} Zeichen.")
        return text
    if kind == "number":
        try:
            number = float(str(value).replace(",", "."))
        except ValueError as exc:
            raise SelfServiceError(400, f"{label}: bitte eine Zahl.") from exc
        return int(number) if number.is_integer() else number
    if kind == "date":
        text = str(value).strip()
        try:
            date.fromisoformat(text)
        except ValueError as exc:
            raise SelfServiceError(400, f"{label}: bitte ein Datum als JJJJ-MM-TT.") from exc
        return text
    if kind == "boolean":
        if isinstance(value, bool):
            return value
        return str(value).strip().casefold() in ("1", "true", "ja", "yes", "on")
    codes = [o["code"] for o in field.get("options") or []]
    if kind == "select":
        text = str(value).strip()
        if text not in codes:
            raise SelfServiceError(400, f"{label}: keine gültige Auswahl.")
        return text
    items = value if isinstance(value, list) else re.split(r"[,;\n]+", str(value))
    chosen: list[str] = []
    for item in items:
        code = str(item or "").strip()
        if code and code not in chosen:
            if code not in codes:
                raise SelfServiceError(400, f"{label}: „{code}“ ist keine gültige Auswahl.")
            chosen.append(code)
    return chosen or None


def clean_website_fields(fields: dict, known: list[dict]) -> dict:
    """Nur bekannte Felder, nur änderbare, Werte je Art geprüft; nichts gesendet heißt 400."""
    by_code = {f["code"]: f for f in known}
    out: dict = {}
    for code, value in (fields or {}).items():
        field = by_code.get(str(code))
        if field is None:
            raise SelfServiceError(400, f"Das Feld „{code}“ gibt es im Website-Profil nicht.")
        if not field["editable"]:
            raise SelfServiceError(400, f"„{field['label']}“ kannst du hier nicht ändern - das pflegt der Verein.")
        out[field["code"]] = _clean_field_value(field, value)
    if not out:
        raise SelfServiceError(400, "Nichts geändert.")
    return out


async def _website_current(db, client, access: dict) -> dict:
    try:
        view = _website_view(await client.my_website_profile(access["params"]))
    except DolibarrError as exc:
        if exc.kind == "forbidden":
            reason = await _denied(db, access)
            raise SelfServiceError(403, REASON_TEXTS[reason], reason=reason) from exc
        if exc.kind in ("not_found", "module_off"):
            raise SelfServiceError(503, REASON_TEXTS["module_too_old"], reason="module_too_old") from exc
        raise SelfServiceError(503, f"Dolibarr antwortet gerade nicht ({exc.text}).") from exc
    await dolibarr_identity.member_call_ok(db, access)
    return view


async def website_profile(db, user: dict) -> dict:
    """Das eigene Website-Profil aus Dolibarr - oder warum es hier nichts gibt."""
    settings, access, client, reason = await _access(db, user)
    if reason:
        return {"available": False, "reason": reason, "text": REASON_TEXTS.get(reason, "")}
    try:
        return await _website_current(db, client, access)
    except SelfServiceError as exc:
        if exc.reason:
            return {"available": False, "reason": exc.reason, "text": exc.detail}
        if exc.detail == REASON_TEXTS["module_too_old"]:
            return {"available": False, "reason": "module_too_old", "text": REASON_TEXTS["module_too_old"]}
        return {"available": False, "reason": "unavailable", "text": exc.detail}


async def save_website_profile(db, user: dict, fields: dict) -> dict:
    """Die gesendeten Felder nach Dolibarr schreiben (nur was das Mitglied ändern darf); danach das Mitglied
    zum Nachlesen einreihen, damit das Verzeichnis der Website den neuen Stand gleich übernimmt."""
    settings, access, client, reason = await _access(db, user)
    if reason:
        raise SelfServiceError(409 if reason == "no_capability" else 403, REASON_TEXTS.get(reason, "Nicht möglich."), reason=reason)
    current = await _website_current(db, client, access)
    clean = clean_website_fields(fields, current["fields"])
    labels = {f["code"]: f["label"] for f in current["fields"]}
    try:
        data = await client.put_website_profile(access["params"], {"fields": clean})
    except DolibarrError as exc:
        denied = await _denied(db, access) if exc.kind == "forbidden" else "not_bound"
        if exc.kind in ("not_found", "module_off"):
            raise SelfServiceError(503, REASON_TEXTS["module_too_old"]) from exc
        if exc.kind == "bad_request":
            field = (exc.detail or {}).get("field")
            message = str((exc.detail or {}).get("message") or "Wert passt nicht.")
            raise SelfServiceError(400, f"{labels.get(field, field)}: {message}" if field else f"Die Mitgliederverwaltung hat das abgewiesen: {message}") from exc
        _raise_for(exc, denied=denied, conflict="Das Profil wurde gerade anderswo geändert – bitte neu laden.")
    if access.get("member_id"):
        from services import dolibarr_sync
        await dolibarr_sync.queue_member(db, settings, int(access["member_id"]))
    return _website_view(data)
