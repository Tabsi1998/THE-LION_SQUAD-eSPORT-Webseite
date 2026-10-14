"""Die Spieldauer eines Spiels - eine Funktion für das ganze Backend (#1552).

Reihenfolge: Spiel → Spiel.settings → Phase → Turnier → 30 Minuten. Die Ebene „Spiel“ im Sinne des Games
(Dauer je Modus, Gerät; #1554) kommt zwischen Phase und Turnier dazu, sobald es die Felder gibt.

Bewusst ohne Importe aus dem Rest des Backends: Generatoren, Planer, Routen und Anzeigen rufen diese Funktion,
und ein Wächtertest (``test_match_duration_unit``) hält neue Kopien der Kette fern.
"""
from __future__ import annotations

DEFAULT_MATCH_DURATION_MINUTES = 30


def _minutes(value) -> int | None:
    """Eine brauchbare Minutenzahl, sonst None - damit die nächste Ebene drankommt."""
    if value is None or value == "" or isinstance(value, bool):
        return None
    try:
        minutes = int(value)
    except (TypeError, ValueError):
        return None
    return minutes if minutes >= 1 else None


def _settings(doc: dict | None) -> dict:
    settings = (doc or {}).get("settings")
    return settings if isinstance(settings, dict) else {}


def effective_match_duration(match: dict | None = None, *, stage: dict | None = None, tournament: dict | None = None,
                             updates: dict | None = None, default: int = DEFAULT_MATCH_DURATION_MINUTES) -> int:
    """Wie lange dieses Spiel geplant wird, in Minuten.

    ``updates`` sind Änderungen, die gerade gespeichert werden: steht dort ``duration_minutes``, zählt das -
    auch leer (dann gilt wieder die Kette darunter, nicht der alte Wert am Spiel).
    """
    match = match or {}
    if updates is not None and "duration_minutes" in updates:
        own = _minutes(updates.get("duration_minutes"))
    else:
        own = _minutes(match.get("duration_minutes"))
    for candidate in (
        own,
        _minutes(_settings(match).get("duration_minutes")),
        _minutes(_settings(stage).get("duration_minutes")),
        # Hier kommt die Ebene „Spiel“ (Game: Dauer je Modus, #1554) dazu.
        _minutes((tournament or {}).get("match_duration_minutes")),
    ):
        if candidate is not None:
            return candidate
    return max(1, int(default))
