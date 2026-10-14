"""Welche angehefteten Einbettungen neu müssen (#569; #1420: aus services/discord_embeds.py herausgelöst).

Wer etwas ändert (Saison, Events), merkt hier nur die Art vor; der Job alle 60 s baut die Nachricht in
services/discord_embeds.py neu. Ein Blatt ohne Rück-Importe - die Saison-Wertung meldet sich hier, ohne die
Einbettungen zu importieren (die lesen die Wertung selbst).
"""
from __future__ import annotations

KINDS = {
    "ranking": {"label": "Rangliste", "hint": "Die Jahreswertung der laufenden Saison: Top 10 mit Punkten und Link."},
    "events": {"label": "Nächste Events", "hint": "Die nächsten fünf Events und Turniere mit Wiener Zeit und Stand der Anmeldung."},
    # Erfolge II (#622): einmal je Woche neu, nur Personen mit öffentlichem Profil und öffentlichen Erfolgen.
    "achievement_week": {"label": "Erfolg der Woche", "hint": "Die seltenste Freischaltung der letzten Woche – mit Person (nur öffentliche Profile), Material und Seltenheit."},
}
# Was geändert wurde und noch nicht in der Nachricht steht (ein API-Prozess, siehe change_events).
_dirty: set[str] = set()


def request_refresh(*kinds: str) -> None:
    """Merken, dass sich etwas geändert hat; der Job alle 60 s bearbeitet dann die Nachricht."""
    _dirty.update(kind for kind in kinds if kind in KINDS)


def pending() -> set[str]:
    return set(_dirty)
