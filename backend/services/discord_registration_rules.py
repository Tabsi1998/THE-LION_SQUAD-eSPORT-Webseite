"""Regeln der Anmeldung im Discord (#885), die auch die Ankündigungen brauchen: Schalter, Gründe ohne Knopf, Kennung
der Knöpfe und der Knopf „Anmelden“ unter einer Ankündigung.

Ein Blatt ohne Importe aus ``services`` oder ``routes`` - ``discord_announcements`` und ``discord_registration`` nutzen
es beide, ohne einander zu importieren (sonst entstünde ein Import-Zyklus).
"""
from __future__ import annotations

import re

SETTINGS_KEY = "registration"
CUSTOM_ID_PATTERN = re.compile(r"^tls:(?P<action>show|reg|unreg):(?P<kind>event|tournament):(?P<id>[A-Za-z0-9_-]+)(?::(?P<then>[A-Za-z0-9_-]+))?$")


def custom_id(action: str, kind: str, item_id: str, then: str | None = None) -> str:
    """Die Kennung eines Knopfs: ``tls:<aktion>:<art>:<id>[:<weiter>]`` - Discord schickt sie mit jedem Klick."""
    return f"tls:{action}:{kind}:{item_id}" + (f":{then}" if then else "")


async def enabled(db) -> bool:
    """Der Schalter unter Verbindungen → Discord (Vorgabe an)."""
    doc = await db.settings.find_one({"id": "discord"}, {"_id": 0, SETTINGS_KEY: 1}) or {}
    return bool((doc.get(SETTINGS_KEY) or {}).get("enabled", True))


def event_blocker(event: dict) -> str | None:
    """Warum es dieses Event nicht im Discord gibt - als Satz, nie als stummer Knopf. Ein fehlender Schalter heißt an."""
    if not event.get("has_registration"):
        return "Dieses Event hat keine Anmeldung."
    if event.get("discord_registration") is False:
        return "Für dieses Event ist die Anmeldung über Discord ausgeschaltet."
    if event.get("registration_url"):
        return "Die Anmeldung zu diesem Event läuft über einen externen Link."
    if event.get("allow_companions"):
        return "Dieses Event hat Begleitpersonen – die Anmeldung geht auf der Website."
    return None


def tournament_blocker(tournament: dict) -> str | None:
    if tournament.get("discord_registration") is False:
        return "Für dieses Turnier ist die Anmeldung über Discord ausgeschaltet."
    if tournament.get("is_invite_only"):
        return "Dieses Turnier ist nur auf Einladung."
    if tournament.get("registration_enabled") is False:
        return "Die öffentliche Anmeldung zu diesem Turnier ist aus."
    return None


async def announcement_button(db, kind: str, doc: dict, status: str | None = None) -> dict | None:
    """„Anmelden“ unter der Ankündigung (und im Turnier-Thread): zeigt die private Zusammenfassung. Nur, wenn der Schalter
    an ist und nichts dagegen spricht; bei Turnieren nur zur offenen Anmeldung."""
    if not await enabled(db):
        return None
    if kind == "event":
        if event_blocker(doc):
            return None
    elif tournament_blocker(doc) or status != "registration_open":
        return None
    return {"label": "Anmelden", "custom_id": custom_id("show", kind, doc["id"]), "style": "primary"}
