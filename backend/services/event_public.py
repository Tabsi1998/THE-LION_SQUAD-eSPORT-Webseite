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
