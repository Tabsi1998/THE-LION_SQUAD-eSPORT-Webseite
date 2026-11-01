"""Ein Event, wie es öffentliche Antworten zeigen (#2127): ohne die Felder, die nur die Verwaltung braucht.

Website, App, Startseite und das Event am Turnier bekommen dieselbe Fassung. Bleibt die Preisangabe (``offer``), die das
Anmeldeformular braucht; die Abrechnung selbst (``billing``) sieht nur, wer Finanzen hat. Die Turnierleitung bekommt in
ihren eigenen Ansichten weiter alle Felder (``keep_internal``).
"""
from __future__ import annotations

from services import pricing

INTERNAL_EVENT_FIELDS = frozenset({
    "created_by", "updated_by",
    "newsletter_sent_at", "newsletter_sent_count", "newsletter_sent_by", "newsletter_skipped_reason", "newsletter_checked_at",
    "discord_checked_at", "discord_outcome", "discord_skip",
    "discord_scheduled_event", "discord_scheduled_guilds", "discord_scheduled_days", "discord_scheduled_day_guilds",
    "members_notified_at", "members_notified_count",
    "slug_history", "cancel_round",
})


def public_event(event: dict, *, keep_internal: bool = False, finance: bool = False) -> dict:
    """Eine neue Fassung des Events für die Antwort; das übergebene Dokument bleibt, wie es ist."""
    source = event or {}
    out = dict(source) if keep_internal else {key: value for key, value in source.items() if key not in INTERNAL_EVENT_FIELDS}
    if "billing" in out:
        out.setdefault("offer", pricing.public_offer(out.get("billing")))
        if not finance:
            del out["billing"]
    return out


# Turniere und Fast Laps auf der Startseite und an der Event-Seite: Web und App lesen dort Titel, Termine, Status, Spielart
# und Plätze. Der Stand der Hintergrund-Jobs (Discord, Newsletter, Meldungen, Umplanen) und die Abrechnung gehören nicht dazu;
# das Startgeld zeigen die Turnierseite und „Spielst du auch mit?“ über ihre eigenen Wege. Den Link zum Discord-Server eines
# Turniers liest die Turnierseite - er bleibt.
INTERNAL_COMPETITION_FIELDS = frozenset({"billing", "created_by", "updated_by", "creation_key", "locked_by", "slug_history", "participant_removal_plan"})
INTERNAL_COMPETITION_PREFIXES = ("discord_", "newsletter_", "members_notified_", "heat_rebuild_")
PUBLIC_DISCORD_FIELDS = frozenset({"discord_link"})


def _internal_competition_field(key: str) -> bool:
    if key in PUBLIC_DISCORD_FIELDS:
        return False
    return key in INTERNAL_COMPETITION_FIELDS or key.startswith(INTERNAL_COMPETITION_PREFIXES)


def public_competition(doc: dict) -> dict:
    """Ein Turnier oder eine Fast Lap für diese öffentlichen Wege; das übergebene Dokument bleibt, wie es ist."""
    return {key: value for key, value in (doc or {}).items() if not _internal_competition_field(key)}
