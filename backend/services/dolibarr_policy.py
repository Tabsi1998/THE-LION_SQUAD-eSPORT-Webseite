"""Vereinsrechte aus Dolibarr-Funktionen (#297).

Einmal legt der Superadmin fest, welcher Funktionscode welchen Bereich der
Website öffnet - mit Vorschau, versioniert, im Audit. Danach läuft die Übernahme
von selbst: beginnt eine Funktion, ist der Bereich da; endet sie, ist er beim
nächsten Abgleich weg, ohne neues Anmelden, weil Wächter die Bereiche bei jeder
Anfrage neu berechnen.

Was eine Funktion **nie** öffnet: System, Moderation, Rollenvergabe, Geheimnisse,
Geldfreigaben. Ableitbar ist allein die Vereinsverwaltung. Rechnungsprüfung ist
eine Funktion, aber kein Vorstand - sie bekommt nichts, solange die Freigabe es
nicht ausdrücklich sagt.

Ist die Freigabe aktiv, zählt der lokale Vorstandsposten nicht mehr als
Berechtigung: Ein Posten lässt sich redaktionell pflegen, eine Funktionsperiode
in Dolibarr nicht.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from models import now_utc
from services.dolibarr_client import load_settings

DERIVABLE_AREAS = ("club",)

# Dolibarr nennt Tage ohne Uhrzeit - gemeint ist der Tag am Ort des Vereins, nicht der des
# Servers (der in UTC läuft und um Mitternacht bis zu zwei Stunden hinterherhinkt).
try:
    CLUB_TZ = ZoneInfo("Europe/Vienna")
except ZoneInfoNotFoundError:  # pragma: no cover - Container ohne Zeitzonendaten
    CLUB_TZ = timezone(timedelta(hours=1), "Europe/Vienna")


def club_today() -> str:
    return now_utc().astimezone(CLUB_TZ).date().isoformat()
# Ist der letzte gelungene Abgleich älter, gibt es keine abgeleiteten Rechte -
# die Mitgliedschaft selbst bleibt davon unberührt.
MAX_STATE_AGE_HOURS = 48


def clean_policy_map(raw: dict | None) -> dict[str, list[str]]:
    cleaned: dict[str, list[str]] = {}
    for code, areas in (raw or {}).items():
        key = str(code or "").strip().lower()
        if not key or len(key) > 64:
            continue
        wanted = [area for area in DERIVABLE_AREAS if area in set(areas or [])]
        if wanted:
            cleaned[key] = wanted
    return cleaned


def policy_active(settings: dict) -> bool:
    policy = settings.get("function_policy") or {}
    return settings.get("mode") == "live" and bool(policy.get("approved_at")) and bool(policy.get("map"))


def _fresh(value: str | None) -> bool:
    if not value:
        return False
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return False
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return (now_utc() - parsed).total_seconds() <= MAX_STATE_AGE_HOURS * 3600


def areas_from_functions(functions: list[dict] | None, policy_map: dict, today: str | None = None) -> list[dict]:
    """Je abgeleitetem Bereich die Funktion, die ihn trägt. Ein Beginn in der Zukunft zählt noch nicht."""
    today = today or club_today()
    grants = []
    for fn in functions or []:
        code = str(fn.get("code") or "").lower()
        since = fn.get("since") or ""
        if since and since > today:
            continue
        for area in policy_map.get(code, []):
            if area in DERIVABLE_AREAS:
                grants.append({"area": area, "function_code": code, "function_label": fn.get("label") or code})
    return grants


async def derived_grants(db, user_id: str | None, settings: dict | None = None) -> list[dict]:
    if not user_id:
        return []
    settings = settings or await load_settings(db)
    if not policy_active(settings):
        return []
    membership = await db.memberships.find_one(
        {"user_id": user_id, "source": "dolibarr"}, {"_id": 0, "member_status": 1, "dolibarr": 1}
    )
    if not membership or membership.get("member_status") not in ("active", "honorary"):
        return []
    state = membership.get("dolibarr") or {}
    if not _fresh(state.get("synced_at")):
        return []
    policy = settings["function_policy"]
    grants = areas_from_functions(state.get("functions"), policy.get("map") or {})
    for grant in grants:
        grant["source"] = "dolibarr"
        grant["policy_version"] = policy.get("version")
    return grants


async def derived_areas(db, user_id: str | None, settings: dict | None = None) -> set[str]:
    return {grant["area"] for grant in await derived_grants(db, user_id, settings)}
