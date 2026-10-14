"""Discord-Ziele und Ereignisarten ohne Rück-Importe (#1420: aus discord_service.py herausgelöst).

Welche Kanäle es gibt, welches Ereignis wohin geht und wie ein Ziel auf einem Server aufgelöst wird. Das Routing
(services/discord_routing.py) braucht das, ohne discord_service zu importieren - das importiert das Routing selbst.
"""
from __future__ import annotations

PUBLIC_TARGETS = ("community", "news", "events")
# „test“ (#583): der Testkanal für die Vorschau - privat, fällt nie zurück.
PRIVATE_TARGETS = ("board", "ops", "test", "members")
TARGETS = PUBLIC_TARGETS + PRIVATE_TARGETS
TARGET_LABELS = {
    "community": "Community (Standard)", "news": "News", "events": "Events und Turniere",
    "board": "Vorstand (privat)", "ops": "Betrieb (privat)", "test": "Test (privat)", "members": "Mitglieder (privat)",
}
# Ereignis → Ziel, Beschriftung, Standard. Neue Ereignisse sind aus, bis der Betreiber sie
# einschaltet; was es vor #300 schon gab, bleibt an. Turnier-Meldungen sind an - seit #572 stehen
# sie im Thread des Turniers, der Kanal bleibt ruhig. Erfolge gehen seit #566 in keinen Kanal
# mehr - die Person selbst bekommt die Gratulation (#568).
# ``game``: die Meldung kann einen Spielbezug haben - dann gilt die Routing-Regel (#627, services/discord_routing.py).
EVENTS = {
    "news.published": {"target": "news", "label": "News veröffentlicht", "default": False, "game": True},
    "event.announced": {"target": "events", "label": "Event angekündigt", "default": False, "game": True},
    # Nur für Mitglieder (#605): in den Mitgliederkanal; Internes an den Vorstand - ohne Text, nur Titel, Zeit, Ort.
    "news.members": {"target": "members", "label": "News für Mitglieder", "default": False},
    "event.members": {"target": "members", "label": "Event für Mitglieder", "default": False},
    "news.internal": {"target": "board", "label": "News intern (Vorstand)", "default": False},
    "event.internal": {"target": "board", "label": "Event intern (Vorstand)", "default": False},
    "tournament.registration_open": {"target": "events", "label": "Turnier: Anmeldung offen", "default": True, "game": True},
    "tournament.check_in": {"target": "events", "label": "Turnier: Check-in offen", "default": True, "game": True},
    "tournament.live": {"target": "events", "label": "Turnier: jetzt live", "default": True, "game": True},
    "tournament.completed": {"target": "events", "label": "Turnier: beendet", "default": True, "game": True},
    "tournament.results_published": {"target": "events", "label": "Turnier: Ergebnisse veröffentlicht", "default": True, "game": True},
    "tournament.stream_live": {"target": "events", "label": "Turnier: Teilnehmer streamt", "default": True, "game": True},
    "f1.new_leader": {"target": "events", "label": "Fast Lap: neue Bestzeit", "default": True, "game": True},
    "membership.application": {"target": "board", "label": "Neuer Mitgliedsantrag", "default": False},
    "contact.request": {"target": "board", "label": "Neue Kontaktanfrage", "default": False},
    # Vereinsgeburtstag (#644): einmal im Jahr ab 10:00 am Gründungstag - öffentlich, ohne Personenbezug.
    "club.birthday": {"target": "community", "label": "Vereinsgeburtstag", "default": False},
}


def resolve_target(cfg: dict, target: str, guild: dict | None = None) -> dict:
    """Kanal und tatsächliches Ziel. Privat fällt nie zurück - auch nicht auf ein anderes privates Ziel.
    Mit ``guild`` (ein Unterserver, #625): nur öffentliche Ziele, der Rückfall bleibt auf diesem Server - nie auf einen
    anderen; ein privates Ziel ist dort ein Fehler. Ohne ``guild`` (oder mit dem Hauptserver): wie bisher."""
    if target not in TARGETS:
        target = "community"
    if guild is not None and guild.get("role") != "main":
        guild_id = str(guild.get("guild_id") or "")
        if target in PRIVATE_TARGETS:
            return {"target": target, "channel_id": "", "fallback": False, "guild_id": guild_id, "error": "private_on_sub"}
        own = guild.get("channels") or {}
        if target != "community" and own.get(target):
            return {"target": target, "channel_id": own[target], "fallback": False, "guild_id": guild_id}
        return {"target": "community", "channel_id": own.get("community") or "", "fallback": target != "community", "guild_id": guild_id}
    channels = cfg.get("channels") or {}
    if target in PRIVATE_TARGETS:
        return {"target": target, "channel_id": channels.get(target) or "", "fallback": False}
    if target != "community" and channels.get(target):
        return {"target": target, "channel_id": channels[target], "fallback": False}
    return {"target": "community", "channel_id": channels.get("community") or "", "fallback": target != "community"}
