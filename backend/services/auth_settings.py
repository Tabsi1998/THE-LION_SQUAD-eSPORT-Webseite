"""Centralized authentication/login configuration, editable from the admin area.

Stored as a single settings document (id="auth"). Federated login defaults to
off until an administrator has supplied a client owned by the club.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from database import get_db

AUTH_SETTINGS_DEFAULTS = {
    "password_login_enabled": True,
    "registration_enabled": True,
    "google_login_enabled": False,
    "google_registration_enabled": False,
    "google_linking_enabled": False,
    "google_client_id": "",
}

AUTH_SETTINGS_KEYS = tuple(AUTH_SETTINGS_DEFAULTS.keys())

# Grenzen je Netz-Adresse (#1802). Vor Ort teilen sich viele Handys eine öffentliche Adresse; darum einstellbar,
# aber nur innerhalb fester Schranken - eine zu kleine Grenze sperrt alle aus, eine zu große bremst nichts mehr.
# Der Schutz je Konto (Fehlversuche je E-Mail) hängt nicht daran und bleibt unverändert.
AUTH_LIMIT_FIELDS = {
    # Schlüssel: (Vorgabe, Untergrenze, Obergrenze, Bezeichnung für Fehlermeldungen)
    "login_ip_limit_per_minute": (30, 10, 300, "Anmeldungen je Minute"),
    "register_ip_limit_per_hour": (5, 3, 100, "Registrierungen je Stunde"),
    "event_login_ip_limit_per_minute": (150, 10, 1000, "Anmeldungen je Minute im Event-Zeitraum"),
    "event_register_ip_limit_per_hour": (50, 3, 500, "Registrierungen je Stunde im Event-Zeitraum"),
}
AUTH_LIMIT_WINDOW_FIELDS = ("event_limits_from", "event_limits_until")
# Ein Event-Zeitraum endet von selbst; länger als drei Tage ist kein Event mehr, sondern ein vergessener Schalter.
EVENT_WINDOW_MAX = timedelta(days=3)


def clamp_limit(key: str, value: object) -> int:
    default, low, high, _label = AUTH_LIMIT_FIELDS[key]
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return default
    return max(low, min(high, int(value)))


def parse_window_time(value: object) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def validate_limit_updates(raw: dict) -> tuple[dict, str | None]:
    """Prüft Grenzen und Event-Zeitraum aus der Verwaltung. Gibt (Änderungen, Fehlermeldung) zurück."""
    updates: dict = {}
    for key, (_default, low, high, label) in AUTH_LIMIT_FIELDS.items():
        if raw.get(key) is None:
            continue
        value = raw[key]
        if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
            return {}, f"{label}: bitte eine ganze Zahl von {low} bis {high} angeben."
        updates[key] = value
    for key in AUTH_LIMIT_WINDOW_FIELDS:
        if raw.get(key) is None:
            continue
        text = str(raw[key]).strip()
        parsed = parse_window_time(text)
        if text and parsed is None:
            return {}, "Event-Zeitraum: Datum und Uhrzeit sind ungültig."
        updates[key] = parsed.isoformat() if parsed else ""
    return updates, None


def validate_event_window(start: datetime | None, end: datetime | None) -> str | None:
    if start is None and end is None:
        return None
    if start is None or end is None:
        return "Event-Zeitraum: bitte Beginn und Ende angeben oder beide leeren."
    if end <= start:
        return "Event-Zeitraum: das Ende muss nach dem Beginn liegen."
    if end - start > EVENT_WINDOW_MAX:
        return "Event-Zeitraum: höchstens drei Tage am Stück."
    return None


def event_window_active(settings: dict, now: datetime | None = None) -> bool:
    start = parse_window_time(settings.get("event_limits_from"))
    end = parse_window_time(settings.get("event_limits_until"))
    if start is None or end is None or validate_event_window(start, end):
        return False
    moment = now or datetime.now(timezone.utc)
    return start <= moment < end


def effective_ip_limits(settings: dict, now: datetime | None = None) -> dict:
    """Die gerade geltenden Grenzen je Adresse: im Event-Zeitraum die Event-Werte, sonst die normalen."""
    active = event_window_active(settings, now)
    login_key = "event_login_ip_limit_per_minute" if active else "login_ip_limit_per_minute"
    register_key = "event_register_ip_limit_per_hour" if active else "register_ip_limit_per_hour"
    # Fehlt ein Wert oder liegt er außerhalb der Schranken, gilt die Vorgabe bzw. die nächste Schranke - nie „keine Grenze“.
    return {
        "event_active": active,
        "login_per_minute": clamp_limit(login_key, settings.get(login_key)),
        "register_per_hour": clamp_limit(register_key, settings.get(register_key)),
    }


def is_google_client_id(value: object) -> bool:
    client_id = str(value or "").strip()
    return bool(client_id and client_id.endswith(".apps.googleusercontent.com") and len(client_id) <= 255)


async def load_auth_settings(db=None) -> dict:
    if db is None:
        db = get_db()
    doc = await db.settings.find_one({"id": "auth"}, {"_id": 0}) or {}
    result = dict(AUTH_SETTINGS_DEFAULTS)
    for key in AUTH_SETTINGS_KEYS:
        default = AUTH_SETTINGS_DEFAULTS[key]
        value = doc.get(key)
        if isinstance(default, bool) and isinstance(value, bool):
            result[key] = value
        elif isinstance(default, str) and isinstance(value, str):
            result[key] = value.strip()
    for key in AUTH_LIMIT_FIELDS:
        result[key] = clamp_limit(key, doc.get(key))
    for key in AUTH_LIMIT_WINDOW_FIELDS:
        parsed = parse_window_time(doc.get(key))
        result[key] = parsed.isoformat() if parsed else ""
    result["event_limits_active"] = event_window_active(result)
    # Schranken für die Prüfung in der Verwaltung - eine Quelle, die Karte rechnet nicht mit eigenen Zahlen.
    result["limit_bounds"] = {key: {"min": low, "max": high} for key, (_d, low, high, _l) in AUTH_LIMIT_FIELDS.items()}
    result["event_window_max_hours"] = int(EVENT_WINDOW_MAX.total_seconds() // 3600)
    configured = is_google_client_id(result["google_client_id"])
    result["google_configured"] = configured
    if not configured:
        result["google_login_enabled"] = False
        result["google_registration_enabled"] = False
        result["google_linking_enabled"] = False
    return result


def public_auth_settings(settings: dict) -> dict:
    """Nur die Schalter für die öffentliche Seite - die Grenzen je Adresse gehen niemanden außer der Verwaltung an."""
    return {key: settings[key] for key in (*AUTH_SETTINGS_KEYS, "google_configured")}
