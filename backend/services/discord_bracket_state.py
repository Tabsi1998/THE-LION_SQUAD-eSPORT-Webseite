"""Wo der Bracket-Stand am Turnier steht und welche Brackets neu müssen (#571, #628; #1420: aus discord_bracket).

Die Turnier-Threads (services/discord_threads.py) lesen den Stand und merken ein Bracket vor, wenn eine neue Meldung
den Endstand verdrängt; das Bracket selbst liest die Threads. Ein Blatt ohne Rück-Importe, damit sich die beiden
nicht gegenseitig importieren.
"""
from __future__ import annotations

FIELD = "discord_bracket_embed"
# Spielserver (#628): je Server derselbe Stand wie am Hauptserver; welcher Server, sagt die Regel von „Turnier: jetzt live“.
GUILD_FIELD = "discord_bracket_by_guild"
_dirty: dict[str, bool] = {}   # Turnier-ID → letzte Fassung („Endstand“) gewünscht
# Turniere, deren stehender Endstand trotzdem nachgezogen wird (#2375): Ein Verfahren oder ein Vorfall ändert „in Klärung“ auch
# nach dem Ende. Ohne diese Marke bleibt der Endstand wie er ist (nur ein geänderter Inhalt wird bearbeitet, nichts neu gepostet).
_revise: set[str] = set()


def request_refresh(tournament_id: str, *, final: bool = False, revise: bool = False) -> None:
    """Das Bracket vormerken - der Minuten-Job bearbeitet es einmal, egal wie oft vorgemerkt wurde."""
    if tournament_id:
        _dirty[tournament_id] = bool(_dirty.get(tournament_id)) or final
        if revise:
            _revise.add(tournament_id)


def revising(tournament_id: str) -> bool:
    return tournament_id in _revise


def forget(tournament_id: str) -> None:
    """Erledigt (oder nie zu posten): aus beiden Vormerkungen nehmen."""
    _dirty.pop(tournament_id, None)
    _revise.discard(tournament_id)


def pending() -> dict[str, bool]:
    return dict(_dirty)


def _state_at(tournament: dict, field: str) -> dict:
    """Der gespeicherte Stand einer Bahn - ``discord_bracket_embed`` oder ``discord_bracket_by_guild.<Server>``."""
    value = tournament
    for part in field.split("."):
        value = (value or {}).get(part) if isinstance(value, dict) else None
    return value if isinstance(value, dict) else {}
