"""Aufbewahrung der Kontaktanfragen (#2131): erledigt und Spam laufen ab, offene nie.

Die Fristen stehen bei den übrigen unter Betrieb → Alarme (``ops_alerts.DEFAULT_RETENTION``: 12 Monate für erledigte,
30 Tage für Spam) und laufen im täglichen Job ``ops_retention``. Gelöscht wird wirklich: die Zeile samt Verlauf und die
Kopien der Mails in Warteschlange und Versandlog - dort stehen Name, Adresse, Betreff und Text.

„Beantwortet“ zählt wie „geschlossen“: nach einer Antwort schließt sonst niemand mehr, und die Anfrage bliebe für immer.
Die Frist läuft ab dem letzten Statuswechsel; wer eine Anfrage wieder öffnet, hält sie an. Zeilen von vor dieser Regel
kennen ihren Statuswechsel nicht und bekommen beim ersten Lauf den heutigen Tag - lieber eine volle Frist als eine
Löschung gleich nach dem Update.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from models import now_utc

DONE_STATUSES = ("answered", "closed")
SPAM_STATUSES = ("spam",)


async def forget_copies(db, contact_ids: list[str]) -> None:
    """Die Mails zu diesen Anfragen, über die Kennung der Anfrage: Betreff und Adresse können bei einer anderen, offenen
    Anfrage genauso lauten. Log-Zeilen von vor dieser Kennung laufen über die Frist des Versandlogs aus."""
    if not contact_ids:
        return
    ids = list(contact_ids)
    await db.email_logs.delete_many({"contact_id": {"$in": ids}})
    await db.mail_jobs.delete_many({"meta.contact_id": {"$in": ids}})


async def purge_expired(db, *, done_days: int, spam_days: int, now: datetime | None = None) -> int:
    """Der tägliche Lauf: liefert die Zahl der gelöschten Anfragen."""
    current = now or now_utc()
    everything = [*DONE_STATUSES, *SPAM_STATUSES]
    await db.contact_messages.update_many({"status": {"$in": everything}, "status_changed_at": {"$exists": False}}, {"$set": {"status_changed_at": current.isoformat()}})
    removed = 0
    for statuses, days in ((DONE_STATUSES, done_days), (SPAM_STATUSES, spam_days)):
        cutoff = (current - timedelta(days=int(days))).isoformat()
        # Eine laufende „Kein Spam“-Freigabe holt gerade Mails nach - die wird nicht weggeräumt.
        rows = await db.contact_messages.find(
            {"status": {"$in": list(statuses)}, "status_changed_at": {"$lt": cutoff}, "spam.release.state": {"$ne": "releasing"}}, {"_id": 0, "id": 1},
        ).to_list(None)
        ids = [row["id"] for row in rows]
        if not ids:
            continue
        await forget_copies(db, ids)
        removed += int((await db.contact_messages.delete_many({"id": {"$in": ids}})).deleted_count)
    return removed
