"""Eine Mail in die Warteschlange stellen (#1420: aus services/mail_queue.py herausgelöst).

Nur das Einreihen - der Versand mit Wiederholungen bleibt in services/mail_queue.py. Die Betriebsalarme
(services/ops_alerts.py) reihen ihre Mails hier ein; der Versand meldet umgekehrt nicht zustellbare Mails als Alarm.
So importieren sich Alarme und Versand nicht gegenseitig. Alle anderen nutzen weiter ``mail_queue.enqueue_mail``.
"""
from datetime import datetime
from typing import Optional

from pymongo.errors import DuplicateKeyError

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
    """Enqueue a mail. If dedupe_key is set, will not re-queue if already exists.

    Mit Schlüssel atomar (#2067): ein Upsert mit ``$setOnInsert`` auf den Schlüssel, abgesichert durch den eindeutigen
    Index ``mail_jobs.dedupe_key_unique`` (``database.AUDIT_UNIQUE_INDEXES``). Verliert ein gleichzeitiger Aufruf den
    Wettlauf (``DuplicateKeyError``), zählt die Mail als schon eingereiht."""
    db = get_db()
    # Ein leerer Schlüssel heißt „ohne Schlüssel“ - gespeichert wird dann None, sonst fiele "" unter den eindeutigen
    # Teil-Index und die zweite solche Mail scheiterte.
    dedupe_key = dedupe_key or None
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
    if not dedupe_key:
        await db.mail_jobs.insert_one(job)
        return {"ok": True, "id": job["id"]}
    fields = {key: value for key, value in job.items() if key != "dedupe_key"}
    try:
        result = await db.mail_jobs.update_one({"dedupe_key": dedupe_key}, {"$setOnInsert": fields}, upsert=True)
        inserted = result.upserted_id is not None
    except DuplicateKeyError:
        inserted = False
    if inserted:
        return {"ok": True, "id": job["id"]}
    existing = await db.mail_jobs.find_one({"dedupe_key": dedupe_key}, {"_id": 0, "id": 1})
    return {"ok": True, "id": (existing or {}).get("id"), "deduped": True}
