"""Gemeinsame Bausteine der privaten Bot-Antworten (#573, #885): die Form einer Antwort und die Sätze zur Verknüpfung.

Ein Blatt ohne eigene Importe aus ``services`` - die Befehle (``discord_commands``) und die Anmeldung im Discord
(``discord_registration``) nutzen es beide, ohne einander zu importieren (sonst entstünde ein Import-Zyklus).
"""
from __future__ import annotations

LINK_PATH = "/profile?tab=socials"
NOT_LINKED = "Dein Discord-Konto ist nicht mit der Website verknüpft – mit `/verknuepfen` steht, wie es geht."


def answer(content: str | None = None, *, embed: dict | None = None, buttons: list[dict] | None = None) -> dict:
    """Eine Antwort ist ``{"content", "embed", "buttons"}``; ``discord_bot.answer_kwargs`` macht daraus die Nachricht."""
    return {"content": content, "embed": embed, "buttons": list(buttons or [])}
