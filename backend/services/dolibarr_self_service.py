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

from models import now_utc
from services import dolibarr_identity
from services.dolibarr_client import DolibarrClient, DolibarrError, load_settings

CHANGEABLE = ("address", "zip", "town", "country_code", "phone", "phone_mobile", "email")
PROFILE_FIELDS = ("member_id", "ref", "firstname", "lastname", "birth", "address", "zip", "town", "country_code", "phone", "phone_mobile", "email",
                  "member_type", "status", "version", "direct", "exit")
REQUEST_FIELDS = ("external_id", "kind", "changes", "status", "reason", "received_at", "decided_at", "notice_day", "last_day", "wished_last_day", "wished_too_early")
STATUS_LABELS = {"received": "beim Vorstand", "applied": "übernommen", "rejected": "abgelehnt"}
WEBSITE_FIELDS = {"gamertag": 40, "bio": 2000, "games": 255, "platforms": 255}
WEBSITE_LISTS = ("games", "platforms")
WEBSITE_LABELS = {"gamertag": "Gamertag", "bio": "Kurztext", "games": "Spiele", "platforms": "Plattformen"}
REASON_TEXTS = {
    "not_connected": "Die Mitgliederverwaltung ist nicht live angebunden.",
    "module_too_old": "Das Vereinsmodul kennt das eigene Website-Profil noch nicht (ab Vereine 1.2).",
    "not_bound": "Dafür muss dein Konto mit der Vereinsakte verbunden sein (Einladungscode unter Meine Mitgliedschaft).",
    "no_capability": "Deine Verbindung erlaubt das Ändern eigener Daten noch nicht – der Vorstand schaltet die Fähigkeit „eigene Daten“ in Dolibarr ein.",
}


class SelfServiceError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


async def _access(db, user: dict):
    """Anbindung live, Bindung gültig, Fähigkeit ``profile`` - sonst der Grund."""
    settings = await load_settings(db)
    if settings.get("mode") != "live":
        return settings, None, None, "not_connected"
    binding = await dolibarr_identity.binding_for(db, settings, user["id"])
    if not binding or binding.get("status") != "bound":
        return settings, binding, None, "not_bound"
    if "profile" not in (binding.get("capabilities") or []):
        return settings, binding, None, "no_capability"
    try:
        client = DolibarrClient(settings)
    except DolibarrError as exc:
        return settings, binding, None, exc.kind
    return settings, binding, client, None


def _request_view(row: dict) -> dict:
    view = {key: row.get(key) for key in REQUEST_FIELDS}
    view["status_label"] = STATUS_LABELS.get(str(row.get("status") or ""), row.get("status") or "")
    return view


def _external_id(prefix: str, user_id: str, *parts) -> str:
    digest = hashlib.sha256(json.dumps(parts, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()[:16]
    return f"web-{prefix}-{str(user_id)[:8]}-{digest}"[:64]


def _raise_for(exc: DolibarrError, *, conflict: str) -> None:
    if exc.kind == "conflict":
        raise SelfServiceError(409, conflict) from exc
    if exc.kind == "forbidden":
        raise SelfServiceError(403, "Die Verbindung zur Vereinsakte gilt nicht mehr – bitte einen neuen Einladungscode einlösen.") from exc
    if exc.kind == "bad_request":
        raise SelfServiceError(400, "Die Mitgliederverwaltung hat das abgewiesen (Feld oder Wert passt nicht).") from exc
    raise SelfServiceError(503, f"Dolibarr antwortet gerade nicht ({exc.text}).") from exc


async def overview(db, user: dict) -> dict:
    """Die eigenen Daten und alle Einreichungen - oder warum es hier nichts gibt."""
    settings, binding, client, reason = await _access(db, user)
    if reason:
        return {"available": False, "reason": reason, "text": REASON_TEXTS.get(reason, "")}
    try:
        profile = await client.my_profile(binding["subject"])
        requests = await client.my_profile_requests(binding["subject"])
    except DolibarrError as exc:
        if exc.kind == "forbidden":
            await dolibarr_identity.mark_revoked(db, binding)
            return {"available": False, "reason": "not_bound", "text": REASON_TEXTS["not_bound"]}
        return {"available": False, "reason": exc.kind, "text": f"Dolibarr antwortet gerade nicht ({exc.text})."}
    return {
        "available": True, "profile": {key: profile.get(key) for key in PROFILE_FIELDS}, "changeable": list(CHANGEABLE),
        "requests": [_request_view(row) for row in requests if isinstance(row, dict)], "status_labels": dict(STATUS_LABELS),
    }


async def request_change(db, user: dict, version: str, changes: dict) -> dict:
    """Kontaktdaten ändern lassen: nur die erlaubten Felder, nur mit dem gesehenen Stand."""
    settings, binding, client, reason = await _access(db, user)
    if reason:
        raise SelfServiceError(409 if reason == "no_capability" else 403, REASON_TEXTS.get(reason, "Nicht möglich."))
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
        row = await client.request_profile_change(binding["subject"], payload)
    except DolibarrError as exc:
        if exc.kind == "forbidden":
            await dolibarr_identity.mark_revoked(db, binding)
        _raise_for(exc, conflict="Deine Daten haben sich in der Mitgliederverwaltung inzwischen geändert – bitte neu laden und noch einmal prüfen.")
    return _request_view(row)


async def request_exit(db, user: dict, wished_last_day: str | None) -> dict:
    """Den Austritt erklären. Den letzten Tag rechnet der Verein; ein früherer Wunsch wird nicht übernommen."""
    wished = str(wished_last_day or "").strip()
    if wished and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", wished):
        raise SelfServiceError(400, "Das Wunschdatum braucht die Form JJJJ-MM-TT.")
    settings, binding, client, reason = await _access(db, user)
    if reason:
        raise SelfServiceError(409 if reason == "no_capability" else 403, REASON_TEXTS.get(reason, "Nicht möglich."))
    payload: dict = {"external_id": _external_id("exit", user["id"], now_utc().date().isoformat(), wished)}
    if wished:
        payload["wished_last_day"] = wished
    try:
        row = await client.request_exit(binding["subject"], payload)
    except DolibarrError as exc:
        if exc.kind == "forbidden":
            await dolibarr_identity.mark_revoked(db, binding)
        _raise_for(exc, conflict="Ein Austritt ist schon geplant – der Stand steht bei deinen Daten.")
    return _request_view(row)


# ---------------------------------------------------------------- Eigenes Website-Profil (#260): das Mitglied pflegt es selbst

def _website_view(data: dict) -> dict:
    return {
        "available": True, "consent": str(data.get("consent") or ""), "given": bool(data.get("given")),
        "gamertag": str(data.get("gamertag") or ""), "bio": str(data.get("bio") or ""),
        "games": [str(v) for v in data.get("games") or [] if str(v).strip()], "platforms": [str(v) for v in data.get("platforms") or [] if str(v).strip()],
    }


def clean_website_fields(fields: dict) -> dict:
    """Nur die vier Felder, Listen als Liste (Text mit Komma oder Zeile geht auch), Längen wie im Modul - zu lang
    heißt 400 mit dem Feldnamen, nie stilles Abschneiden."""
    out: dict = {}
    for key, value in (fields or {}).items():
        if key not in WEBSITE_FIELDS:
            raise SelfServiceError(400, f"Das Feld „{key}“ gibt es im Website-Profil nicht.")
        limit = WEBSITE_FIELDS[key]
        if key in WEBSITE_LISTS:
            raw = value if isinstance(value, list) else re.split(r"[,;\n]+", str(value or ""))
            items: list[str] = []
            for item in raw:
                text = str(item or "").strip()
                if text and text not in items:
                    items.append(text)
            if len(", ".join(items)) > limit:
                raise SelfServiceError(400, f"{WEBSITE_LABELS[key]}: zusammen höchstens {limit} Zeichen.")
            out[key] = items
        else:
            text = str(value or "").strip()
            if len(text) > limit:
                raise SelfServiceError(400, f"{WEBSITE_LABELS[key]}: höchstens {limit} Zeichen.")
            out[key] = text
    if not out:
        raise SelfServiceError(400, "Nichts geändert.")
    return out


async def website_profile(db, user: dict) -> dict:
    """Das eigene Website-Profil aus Dolibarr - oder warum es hier nichts gibt."""
    settings, binding, client, reason = await _access(db, user)
    if reason:
        return {"available": False, "reason": reason, "text": REASON_TEXTS.get(reason, "")}
    try:
        data = await client.my_website_profile(binding["subject"])
    except DolibarrError as exc:
        if exc.kind == "forbidden":
            await dolibarr_identity.mark_revoked(db, binding)
            return {"available": False, "reason": "not_bound", "text": REASON_TEXTS["not_bound"]}
        if exc.kind in ("not_found", "module_off"):
            return {"available": False, "reason": "module_too_old", "text": REASON_TEXTS["module_too_old"]}
        return {"available": False, "reason": exc.kind, "text": f"Dolibarr antwortet gerade nicht ({exc.text})."}
    return _website_view(data)


async def save_website_profile(db, user: dict, fields: dict) -> dict:
    """Die gesendeten Felder nach Dolibarr schreiben; danach das Mitglied zum Nachlesen einreihen, damit das
    Verzeichnis der Website den neuen Stand gleich übernimmt."""
    clean = clean_website_fields(fields)
    settings, binding, client, reason = await _access(db, user)
    if reason:
        raise SelfServiceError(409 if reason == "no_capability" else 403, REASON_TEXTS.get(reason, "Nicht möglich."))
    try:
        data = await client.put_website_profile(binding["subject"], clean)
    except DolibarrError as exc:
        if exc.kind == "forbidden":
            await dolibarr_identity.mark_revoked(db, binding)
        if exc.kind in ("not_found", "module_off"):
            raise SelfServiceError(503, REASON_TEXTS["module_too_old"]) from exc
        if exc.kind == "bad_request":
            raise SelfServiceError(400, "Die Mitgliederverwaltung hat das abgewiesen (zu lang oder unbekanntes Feld).") from exc
        _raise_for(exc, conflict="Das Profil wurde gerade anderswo geändert – bitte neu laden.")
    if binding.get("member_id"):
        from services import dolibarr_sync
        await dolibarr_sync.queue_member(db, settings, int(binding["member_id"]))
    return _website_view(data)
