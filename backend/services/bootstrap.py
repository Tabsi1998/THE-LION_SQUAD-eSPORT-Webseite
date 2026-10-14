"""Verdrahtung beim Start (#1420, nach Codex-Prüfung): lädt alle Module, die sich beim Import anmelden.

- ``badges`` meldet die Erfolge-Auswertung an (``services.achievement_core.evaluator``) - die Warteschlange und der
  nächtliche Abgleich im Scheduler brauchen sie.
- ``services.discord_bot`` meldet Ereignisse und Slash-Befehle an (``services.discord_runtime.wiring``).
- Team-, Turnier- und Match-Chat-Route melden ihre Zugriffsprüfung für Chat-Anhänge an
  (``services.chat_attachments.register_chat_access``).

Der Stand des Schedulers (``services.scheduler_state``) ist kein Import, sondern Laufzeit: ``start_scheduler`` setzt ihn
selbst; ohne gestarteten Scheduler heißt er zu Recht „läuft nicht“.

Jeder Einstiegspunkt ruft ``ensure_wiring`` auf: der Server beim Start, ``start_scheduler``, der Bot beim Verbinden
(über ``discord_runtime.wiring``) und die Kommandozeilen-Skripte. Nichts aus den unteren Modulen importiert dieses Modul
statisch - sie holen es im Notfall über ``services.wiring.ensure``.
"""
from __future__ import annotations

_done = False


def ensure_wiring() -> None:
    """Idempotent: beim ersten Aufruf die Module laden, die sich beim Import anmelden."""
    global _done
    if _done:
        return
    import badges  # noqa: F401 - meldet die Erfolge-Auswertung an
    from routes import match_routes, team_routes, tournament_chat_routes  # noqa: F401 - Zugriff auf Chat-Anhänge
    from services import discord_bot  # noqa: F401 - Ereignisse und Befehle des Bots

    _done = True
