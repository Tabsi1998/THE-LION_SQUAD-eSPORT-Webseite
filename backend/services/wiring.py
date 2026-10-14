"""Sicherheitsnetz für die Verdrahtung beim Import (#1420, nach Codex-Prüfung).

Seit #1420 melden sich einige Module beim Import an, statt dass die unteren Module sie importieren: die
Erfolge-Auswertung (``badges``), die Ereignisse des Discord-Bots (``services.discord_bot``) und die Zugriffsprüfung der
Chat-Anhänge (Team-, Turnier- und Match-Chat-Route). Jeder Einstiegspunkt ruft dafür ``services.bootstrap.ensure_wiring``.

Fehlt eine Anmeldung trotzdem (ein neuer Einstiegspunkt, der den Aufruf vergisst), rufen die Getter einmal
``ensure`` auf. Das lädt ``services.bootstrap`` über seinen Namen - bewusst kein ``import``-Statement: Die unteren
Module dürfen nicht statisch auf die oberen zeigen, sonst wäre der Import-Kreis wieder da.
"""
from __future__ import annotations

import importlib

BOOTSTRAP_MODULE = "services.bootstrap"


def ensure() -> None:
    """Alle Anmeldungen nachholen - idempotent, billig ab dem zweiten Aufruf."""
    importlib.import_module(BOOTSTRAP_MODULE).ensure_wiring()
