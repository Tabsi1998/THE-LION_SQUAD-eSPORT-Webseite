"""Eine Mail in die Warteschlange stellen (#1420: aus services/mail_queue.py herausgelöst).

Nur das Einreihen - der Versand mit Wiederholungen bleibt in services/mail_queue.py. Die Betriebsalarme
(services/ops_alerts.py) reihen ihre Mails hier ein; der Versand meldet umgekehrt nicht zustellbare Mails als Alarm.
So importieren sich Alarme und Versand nicht gegenseitig. Alle anderen nutzen weiter ``mail_queue.enqueue_mail``.
"""
from datetime import datetime
from typing import Optional

from database import get_db
from models import new_id, now_utc
from services.email_delivery import header_text


async def enqueue_mail(
    to: str,
    subject: str,
    html: str,
    template_key: str = "custom",
    scheduled_at: Optional[datetime] = None,
    meta: Optional[dict] = None,
    dedupe_key: Optional[str] = None,
) -> dict:
    """Enqueue a mail. If dedupe_key is set, will not re-queue if already exists."""
    db = get_db()
    if dedupe_key:
        existing = await db.mail_jobs.find_one({"dedupe_key": dedupe_key})
        if existing:
            return {"ok": True, "id": existing["id"], "deduped": True}
    job = {
        "id": new_id(),
        "to": to,
        # Jede Mail der Website kommt hier vorbei: der Betreff bleibt eine Zeile - kein Wert hängt eine Kopfzeile an.
        "subject": header_text(subject),
        "html": html,
        "template_key": template_key,
        "status": "pending",
        "attempts": 0,
        "next_attempt_at": (scheduled_at or now_utc()).isoformat(),
        "scheduled_at": (scheduled_at or now_utc()).isoformat(),
        "last_error": None,
        "message_id": None,
        "meta": meta or {},
        "dedupe_key": dedupe_key,
        "created_at": now_utc().isoformat(),
        "updated_at": now_utc().isoformat(),
    }
    await db.mail_jobs.insert_one(job)
    return {"ok": True, "id": job["id"]}
