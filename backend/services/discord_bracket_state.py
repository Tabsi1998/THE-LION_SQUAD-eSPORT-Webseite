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


def request_refresh(tournament_id: str, *, final: bool = False) -> None:
    if tournament_id:
        _dirty[tournament_id] = bool(_dirty.get(tournament_id)) or final


def pending() -> dict[str, bool]:
    return dict(_dirty)


def _state_at(tournament: dict, field: str) -> dict:
    """Der gespeicherte Stand einer Bahn - ``discord_bracket_embed`` oder ``discord_bracket_by_guild.<Server>``."""
    value = tournament
    for part in field.split("."):
        value = (value or {}).get(part) if isinstance(value, dict) else None
    return value if isinstance(value, dict) else {}
