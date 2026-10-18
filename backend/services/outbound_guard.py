"""Versand nach außen sperren (#1609): im lokalen Abnahme-Stand laufen einzelne Hintergrund-Jobs mit (gehaltene
Ergebnisse, Show-Auslosung). Was sie an Benachrichtigungen anstoßen, bleibt in der App - kein Push an Expo, keine
Discord-Direktnachricht, kein Discord-Bot.

``OUTBOUND_DISABLED=true`` sperrt das hart, egal was in der Datenbank eingestellt ist. Mit einer Job-Auswahl
(``SCHEDULER_JOBS``) startet der Discord-Bot nur, wenn ``discord_bot`` dabei ist.
"""
import os


def outbound_disabled() -> bool:
    return os.environ.get("OUTBOUND_DISABLED", "").strip().lower() == "true"


def scheduler_job_selection() -> set[str] | None:
    """Die Auswahl aus ``SCHEDULER_JOBS``; leer oder nicht gesetzt: ``None`` (alle Jobs)."""
    names = {part.strip() for part in os.environ.get("SCHEDULER_JOBS", "").split(",") if part.strip()}
    return names or None


def discord_bot_allowed() -> bool:
    selection = scheduler_job_selection()
    return not outbound_disabled() and (selection is None or "discord_bot" in selection)
