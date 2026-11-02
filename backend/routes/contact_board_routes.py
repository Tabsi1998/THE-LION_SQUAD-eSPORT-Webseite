"""Contact + Board Position routes (Phase D refinements).

- /api/contact: public submission with rich topic enum, auto-reply via mail-queue,
  admin notification, full inbox CRUD.
- /api/board: dynamic vorstand positions (defaults seeded, admin can add/disable
  /assign members).
"""
import re

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, EmailStr, Field, field_validator
from pymongo import ReturnDocument
from datetime import timedelta
from typing import Optional, Literal

from database import get_db
from auth import get_optional_user as get_current_user_optional, require_area
from models import now_utc, new_id
from services import contact_retention, spam_guard
from services.slug_utils import apply_slug_history, slug_source_for_update, slugify, unique_slug
from services.usernames import profile_path

# ---------- Contact ----------
contact_router = APIRouter(prefix="/api/contact", tags=["contact"])

ContactTopic = Literal[
    "general", "membership", "invoice", "volunteer", "tournament", "fastlap",
    "sponsorship", "press", "report_bug", "abuse", "other",
]

TOPIC_LABELS = {
    "general": "Allgemeine Anfrage",
    "membership": "Mitgliedschaft",
    # Aus „Meine Rechnungen“: stimmt etwas nicht, gibt es jetzt einen Weg zum Kassier (#2131).
    "invoice": "Rechnung",
    # „Interesse melden“ an einer offenen Vorstandsfunktion (#1252).
    "volunteer": "Mitarbeit im Verein",
    "tournament": "Turnier-Anfrage",
    "fastlap": "Fast-Lap-Anfrage",
    "sponsorship": "Sponsoring",
    "press": "Presse / Kooperation",
    "report_bug": "Fehler melden",
    "abuse": "Missbrauch / Beschwerde",
    "other": "Sonstiges",
}

ContactStatus = Literal["new", "in_progress", "answered", "closed", "spam"]
# „Kein Spam“ (#2067): so lange gilt eine laufende Freigabe als in Arbeit; danach darf sie neu angestoßen werden.
RELEASE_STALE_MINUTES = 5
# Standardansicht der Inbox (#2131): was noch jemanden braucht.
OPEN_STATUSES = ("new", "in_progress")
InboxView = Literal["open", "all", "new", "in_progress", "answered", "closed", "spam"]
INBOX_SEARCH_FIELDS = ("name", "email", "subject", "message")
REPLY_MAX = 4000
# Eine Antwort geht nur an eine Adresse, die aussieht wie eine: ohne Leerzeichen, Umbruch oder eine zweite Adresse dahinter.
DELIVERABLE_ADDRESS = re.compile(r"[^\s@<>,;\"']+@[^\s@<>,;\"']+\.[^\s@<>,;\"']+")
_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def _plain_text(value: str | None) -> str:
    """Text, wie ihn jemand getippt hat: Zeilenumbrüche bleiben, Steuerzeichen nicht."""
    return _CONTROL_CHARS.sub("", str(value or "").replace("\r\n", "\n").replace("\r", "\n")).strip()


class ContactContext(BaseModel):
    """„Fehler melden“ (#2131): wo es passiert ist. Die Person sieht vor dem Absenden, was mitgeht."""
    page: Optional[str] = Field(default=None, max_length=300)
    device: Optional[str] = Field(default=None, max_length=300)
    version: Optional[str] = Field(default=None, max_length=40)


class ContactSubmit(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    topic: ContactTopic = "general"
    subject: str = Field(min_length=2, max_length=200)
    message: str = Field(min_length=5, max_length=4000)
    related_id: Optional[str] = None  # tournament_id / event_id / etc.
    context: Optional[ContactContext] = None
    accept_privacy: bool = Field(..., description="Must be explicitly true")
    # Spamschutz (#2067): Formular-Token, das unsichtbare Feld und - falls eingeschaltet - die Antwort von Turnstile.
    form_token: Optional[str] = Field(default=None, max_length=300)
    hp_fax: Optional[str] = Field(default=None, max_length=300)
    turnstile_token: Optional[str] = Field(default=None, max_length=4096)

    @field_validator("name", "subject", "message")
    @classmethod
    def clean_required_text(cls, value: str, info):
        cleaned = value.strip()
        minimum = {"name": 2, "subject": 2, "message": 5}[info.field_name]
        if len(cleaned) < minimum:
            # Das Wort fürs Feld setzt services/validation_messages davor: „Nachricht: mindestens 5 Zeichen.“
            raise ValueError(f"mindestens {minimum} Zeichen")
        return cleaned


@contact_router.post("/submit")
async def submit_contact(body: ContactSubmit, request: Request, me=Depends(get_current_user_optional)):
    if not body.accept_privacy:
        raise HTTPException(400, "Datenschutz-Zustimmung erforderlich.")
    db = get_db()
    name = body.name.strip()
    email = str(body.email).lower()
    subject = body.subject.strip().replace("\r", " ").replace("\n", " ")
    message = body.message.strip()
    # Spamschutz (#2067): Limits je IP und E-Mail, Honeypot, Formular-Token, ggf. Turnstile, Inhalt.
    verdict = await spam_guard.screen(request, "contact", token=body.form_token, honeypot=body.hp_fax,
                                      turnstile_token=body.turnstile_token, email=email,
                                      fields={"name": name, "subject": subject, "message": message}, db=db)
    if verdict.dropped:
        # Sicher ein Bot: nichts speichern, nichts senden - die Antwort sieht aus wie ein Erfolg.
        return {"ok": True, "id": new_id()}
    doc = {
        "id": new_id(),
        "name": name,
        "email": email,
        "topic": body.topic,
        "subject": subject,
        "message": message,
        "related_id": body.related_id,
        "status": "new",
        "user_id": me.get("id") if me else None,
        "created_at": now_utc().isoformat(),
        "answered_at": None,
        "answered_by": None,
        "internal_note": "",
        "assigned_to": None,
    }
    doc["status_changed_at"] = doc["created_at"]
    if body.topic == "report_bug" and body.context:
        context = {key: _plain_text(value) for key, value in body.context.model_dump().items() if _plain_text(value)}
        if context:
            doc["context"] = context
    if verdict.suspect:
        # Nur der Inhalt ist verdächtig: in die Inbox als „Spam“, ohne Mail und ohne Hinweis an den Vorstand.
        # „Kein Spam“ in der Inbox holt beides nach.
        doc["status"] = "spam"
        doc["spam"] = verdict.record()
    await db.contact_messages.insert_one(doc)
    if not verdict.suspect:
        await _notify_contact(db, doc)
    return {"ok": True, "id": doc["id"]}


async def _notify_contact(db, doc: dict, *, claim_board_hint: bool = False) -> None:
    """Bestätigung an den Absender, Mail an die Vereinsadresse und Hinweis im Vorstands-Kanal.

    Die Mails tragen einen Schlüssel je Nachricht und Mail-Art (``dedupe_key``): ein zweiter Durchlauf - etwa ein
    wiederholtes „Kein Spam“ nach einem Absturz - reiht keine Mail doppelt ein. Der Discord-Hinweis kommt zuletzt."""
    name, email, subject, message, topic = doc["name"], doc["email"], doc["subject"], doc["message"], doc["topic"]
    # Auto-reply via mail queue (uses render_template if admin customised it)
    from email_service import _wrap
    from services import mail_outbox
    from services.email_delivery import fill_placeholders
    from routes.phase_ef_routes import render_template
    topic_label = TOPIC_LABELS.get(topic, topic)
    first_name = name.split()[0] if name else "dort"
    # Werte nur als {{…}}: render_template und fill_placeholders setzen sie als Text ein, im Betreff einzeilig.
    fallback_user_html = _wrap(
        "Wir haben deine Nachricht erhalten",
        "<p>Hallo {{name}},</p>"
        "<p>danke für deine Nachricht zum Thema <strong>{{topic}}</strong>. Wir melden uns so bald wie möglich.</p>"
        "<p>Falls dein Anliegen dringend ist, findest du uns auch auf Discord.</p>"
        "<hr style='border:0;border-top:1px solid #1F2937;margin:20px 0;'/>"
        "<p style='color:#6B7280;font-size:12px'>Deine Nachricht (Kopie):</p>"
        "<blockquote style='margin:8px 0;padding:8px 12px;border-left:3px solid #29B6E8;color:#9CA3AF;font-size:13px'>{{message}}</blockquote>",
    )
    user_subj, user_html = await render_template(
        "contact_auto_reply",
        {"name": first_name, "topic": topic_label, "subject": subject[:80], "message": message[:1000]},
        fallback_subject="Bestätigung: Wir haben deine Nachricht erhalten — {{subject}}",
        fallback_html=fallback_user_html,
    )
    await mail_outbox.enqueue_mail(
        to=email,
        subject=user_subj,
        html=user_html,
        template_key="contact_autoreply",
        meta={"contact_id": doc["id"]},
        dedupe_key=f"contact:{doc['id']}:autoreply",
    )
    # Admin notification
    admin_to = await spam_guard.inbox_recipient(db)
    if admin_to:
        admin_html = fill_placeholders(_wrap(
            "Neue Nachricht: {{topic}}",
            "<p><strong>Name:</strong> {{name}}<br/><strong>E-Mail:</strong> {{email}}<br/><strong>Thema:</strong> {{topic}}</p>"
            "<p><strong>Betreff:</strong> {{subject}}</p>"
            "<blockquote style='margin:8px 0;padding:8px 12px;border-left:3px solid #29B6E8;color:#D1D5DB'>{{message}}</blockquote>"
            "<p style='color:#6B7280;font-size:12px'>ID: {{id}}</p>",
        ), {"topic": topic_label, "name": name, "email": email, "subject": subject, "message": message, "id": doc["id"]}, as_html=True)
        await mail_outbox.enqueue_mail(
            to=admin_to,
            subject=f"[TLS Kontakt] {topic_label}: {subject[:60]}",
            html=admin_html,
            template_key="contact_admin_notify",
            meta={"contact_id": doc["id"]},
            dedupe_key=f"contact:{doc['id']}:admin",
        )
    # Bei „Kein Spam“ ist der Hinweis per bedingtem Update vorgemerkt - nur wer ihn vormerkt, sendet ihn. Ein
    # Neuversuch nach einem Absturz schickt ihn so nicht doppelt (lieber einmal zu wenig als doppelt).
    if claim_board_hint:
        claimed = await db.contact_messages.update_one(
            {"id": doc["id"], "spam.release.discord_at": {"$exists": False}},
            {"$set": {"spam.release.discord_at": now_utc().isoformat()}})
        if claimed.modified_count != 1:
            return
    # Vorstands-Kanal (#300): Thema ja, Absender und Text nein - die stehen in der Kontakt-Inbox.
    from services.discord_announcements import notify_board
    await notify_board("contact.request", f"Thema: {TOPIC_LABELS.get(topic, topic)}")


@contact_router.get("/topics")
async def list_topics():
    return [{"value": k, "label": v} for k, v in TOPIC_LABELS.items()]


def _reply_key(cid: str, reply: dict) -> str:
    return f"contact:{cid}:reply:{reply.get('request_id')}"


# Der Stand des Mail-Auftrags in dem, was die Inbox unterscheidet.
REPLY_DELIVERY = {"pending": "waiting", "sending": "waiting", "sent": "sent", "failed": "failed", "skipped": "skipped"}


async def _with_names(db, docs: list[dict]) -> list[dict]:
    """Wer zuständig ist, wer geantwortet hat: Namen werden beim Lesen aufgelöst - nach einer Kontolöschung steht dort
    der Name des gelöschten Kontos, nie eine Kopie (#2131)."""
    wanted = {doc.get("assigned_to") for doc in docs} | {doc.get("answered_by") for doc in docs}
    wanted |= {reply.get("by") for doc in docs for reply in doc.get("replies") or []}
    names: dict[str, str] = {}
    ids = sorted(value for value in wanted if value)
    if ids:
        async for user in db.users.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "display_name": 1, "username": 1}):
            names[user["id"]] = user.get("display_name") or user.get("username") or ""
    # Ob die Antwort hinausging, weiß der Auftrag in der Warteschlange: „beantwortet“ allein täuscht, wenn die Mail scheitert.
    keys = {_reply_key(doc["id"], reply) for doc in docs for reply in doc.get("replies") or []}
    jobs = {row["dedupe_key"]: row.get("status") for row in await db.mail_jobs.find({"dedupe_key": {"$in": sorted(keys)}}, {"_id": 0, "dedupe_key": 1, "status": 1}).to_list(None)} if keys else {}
    for doc in docs:
        doc["assigned_to_name"] = names.get(doc.get("assigned_to") or "")
        doc["answered_by_name"] = names.get(doc.get("answered_by") or "")
        for reply in doc.get("replies") or []:
            reply["by_name"] = names.get(reply.get("by") or "")
            # Versendete Aufträge räumt die Warteschlange nach einiger Zeit weg: dann steht hier nichts mehr.
            reply["delivery"] = REPLY_DELIVERY.get(jobs.get(_reply_key(doc["id"], reply)))
    return docs


async def _contact_view(db, cid: str) -> dict:
    doc = await db.contact_messages.find_one({"id": cid}, {"_id": 0})
    return (await _with_names(db, [doc]))[0]


async def _audit_contact(db, action: str, me: dict, cid: str, data: dict) -> None:
    """Das Protokoll nennt Vorgang und Person der Verwaltung - nie Adresse oder Wortlaut der Anfrage."""
    await db.audit_logs.insert_one({"id": new_id(), "action": action, "actor_id": me["id"], "target_id": cid, "data": data, "created_at": now_utc().isoformat()})


@contact_router.get("")
async def list_contact_messages(status: InboxView = "open", q: Optional[str] = Query(None, max_length=120), assigned: Optional[Literal["me", "none"]] = None,
                                page: int = Query(1, ge=1, le=100000), limit: int = Query(50, ge=1, le=100), me: dict = Depends(require_area("club"))):
    """Die Inbox (#2131): zuerst, was noch jemanden braucht. Suche in Name, Adresse, Betreff und Text als reiner Text;
    die Zähler gelten immer für alle Anfragen, damit sie beim Filtern nicht springen."""
    db = get_db()
    query: dict = {}
    if status == "open":
        query["status"] = {"$in": list(OPEN_STATUSES)}
    elif status == "all":
        query["status"] = {"$ne": "spam"}
    else:
        query["status"] = status
    if q and q.strip():
        pattern = re.compile(re.escape(q.strip()), re.IGNORECASE)
        query["$or"] = [{field: pattern} for field in INBOX_SEARCH_FIELDS]
    if assigned == "me":
        query["assigned_to"] = me["id"]
    elif assigned == "none":
        query["assigned_to"] = None
    total = await db.contact_messages.count_documents(query)
    docs = await db.contact_messages.find(query, {"_id": 0}).sort("created_at", -1).skip((page - 1) * limit).limit(limit).to_list(limit)
    counts = {row["_id"]: int(row["n"]) async for row in db.contact_messages.aggregate([{"$group": {"_id": "$status", "n": {"$sum": 1}}}])}
    suspicious = await db.contact_messages.count_documents({"status": "spam", "spam.reasons": {"$exists": True}, "spam.cleared_at": {"$exists": False}})
    from services.ops_alerts import load_alert_settings

    retention = (await load_alert_settings(db))["retention_days"]
    return {"items": await _with_names(db, docs), "total": int(total), "page": page, "limit": limit, "counts": counts, "suspicious": int(suspicious),
            "retention": {"done_days": retention["contact_done"], "spam_days": retention["contact_spam"]}}


@contact_router.get("/assignees")
async def list_contact_assignees(me: dict = Depends(require_area("club"))):
    """Wer zuständig sein kann: alle mit der Vereinsverwaltung, dieselbe Regel wie der Wächter der Inbox."""
    from services.member_announcements import club_area_user_ids

    db = get_db()
    ids = sorted(await club_area_user_ids(db))
    rows = await db.users.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "display_name": 1, "username": 1}).to_list(500)
    people = [{"id": row["id"], "name": row.get("display_name") or row.get("username") or "Ohne Namen"} for row in rows]
    return sorted(people, key=lambda row: row["name"].casefold())


class ContactPatch(BaseModel):
    status: Optional[ContactStatus] = None
    internal_note: Optional[str] = Field(default=None, max_length=4000)
    # Leer = niemand zuständig.
    assigned_to: Optional[str] = Field(default=None, max_length=64)


@contact_router.put("/{cid}")
@contact_router.patch("/{cid}")
async def patch_contact_message(cid: str, body: ContactPatch, me: dict = Depends(require_area("club"))):
    db = get_db()
    existing = await db.contact_messages.find_one({"id": cid}, {"_id": 0, "status": 1, "assigned_to": 1})
    if not existing:
        raise HTTPException(404, "Nachricht nicht gefunden.")
    data = body.model_dump(exclude_unset=True)
    updates = {key: data[key] for key in ("status", "internal_note") if data.get(key) is not None}
    now = now_utc().isoformat()
    if updates.get("status") and updates["status"] != existing.get("status"):
        # Ab hier läuft die Aufbewahrung (services/contact_retention.py).
        updates["status_changed_at"] = now
        if updates["status"] == "answered":
            updates["answered_at"] = now
            updates["answered_by"] = me["id"]
    if "assigned_to" in data:
        target = str(data["assigned_to"] or "").strip() or None
        if target and target != existing.get("assigned_to"):
            from services.member_announcements import club_area_user_ids

            if target not in await club_area_user_ids(db):
                raise HTTPException(400, "Zuständig kann nur sein, wer die Vereinsverwaltung hat.")
        updates["assigned_to"] = target
    if not updates:
        raise HTTPException(400, "Keine Änderungen.")
    await db.contact_messages.update_one({"id": cid}, {"$set": updates})
    if "assigned_to" in updates and updates["assigned_to"] != existing.get("assigned_to"):
        await _audit_contact(db, "contact.assign", me, cid, {"to": updates["assigned_to"]})
    return await _contact_view(db, cid)


class ContactReply(BaseModel):
    text: str = Field(min_length=2, max_length=REPLY_MAX)
    # Kennung dieses einen Absendens: kommt es noch einmal an (Antwort verloren, Doppelklick), geht keine zweite Mail hinaus.
    request_id: str = Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")


async def _send_reply(doc: dict, reply: dict) -> None:
    """Die Antwort über die Warteschlange - nur an die Adresse der Anfrage. Wortlaut und Name gehen als Text in die Mail."""
    from email_service import _wrap
    from services import mail_outbox
    from services.mail_templates import render_template

    subject, html = await render_template(
        "contact_reply",
        {"name": (doc.get("name") or "").split()[0] if (doc.get("name") or "").split() else "dort", "reply": reply["text"], "subject": doc.get("subject") or "", "message": doc.get("message") or ""},
        fallback_subject="Antwort auf deine Nachricht: {{subject}}",
        fallback_html=_wrap(
            "Antwort auf deine Nachricht",
            "<p>Hallo {{name}},</p>"
            "<div style='white-space:pre-line'>{{reply}}</div>"
            "<hr style='border:0;border-top:1px solid #1F2937;margin:20px 0;'/>"
            "<p style='color:#6B7280;font-size:12px'>Deine Nachricht:</p>"
            "<blockquote style='margin:8px 0;padding:8px 12px;border-left:3px solid #29B6E8;color:#9CA3AF;font-size:13px'>{{message}}</blockquote>",
        ),
    )
    await mail_outbox.enqueue_mail(to=doc["email"], subject=subject, html=html, template_key="contact_reply", meta={"contact_id": doc["id"]},
                                   dedupe_key=_reply_key(doc["id"], reply))


@contact_router.post("/{cid}/reply")
async def reply_to_contact_message(cid: str, body: ContactReply, me: dict = Depends(require_area("club"))):
    """Antwort aus der Website (#2131): geht über die Mail-Queue an die Adresse der Anfrage, der Wortlaut steht im Verlauf,
    der Status ist danach „beantwortet“. Nie an Spam: dort ist die Adresse nicht geprüft, erst „Kein Spam“ ordnet ein."""
    db = get_db()
    text = _plain_text(body.text)
    if len(text) < 2:
        raise HTTPException(400, "Die Antwort ist leer.")
    doc = await db.contact_messages.find_one({"id": cid}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Nachricht nicht gefunden.")
    if doc.get("status") == "spam":
        raise HTTPException(409, "Spam bekommt keine Antwort – erst „Kein Spam“ ordnet die Nachricht ein.")
    if not DELIVERABLE_ADDRESS.fullmatch(str(doc.get("email") or "")):
        raise HTTPException(409, "Zu dieser Nachricht gibt es keine Adresse mehr.")
    now = now_utc().isoformat()
    reply = {"id": new_id(), "request_id": body.request_id, "text": text, "by": me["id"], "at": now}
    # Erst der Verlauf (bedingt, einmal je Absenden), dann die Mail mit eigenem Schlüssel: ein Neuversuch nach einem
    # Absturz dazwischen holt die Mail nach, ohne einen zweiten Eintrag oder eine zweite Mail.
    updated = await db.contact_messages.update_one(
        {"id": cid, "status": {"$ne": "spam"}, "replies.request_id": {"$ne": body.request_id}},
        {"$push": {"replies": reply}, "$set": {"status": "answered", "answered_at": now, "answered_by": me["id"], "status_changed_at": now}},
    )
    if updated.modified_count != 1:
        current = await db.contact_messages.find_one({"id": cid}, {"_id": 0, "status": 1, "replies": 1})
        earlier = next((row for row in (current or {}).get("replies") or [] if row.get("request_id") == body.request_id), None)
        if not earlier:
            raise HTTPException(409, "Die Nachricht wurde gerade geändert – bitte neu laden.")
        reply = earlier
    else:
        await _audit_contact(db, "contact.reply", me, cid, {"reply_id": reply["id"], "chars": len(text)})
    await _send_reply(doc, reply)
    return await _contact_view(db, cid)


@contact_router.post("/{cid}/not-spam")
async def mark_contact_not_spam(cid: str, me: dict = Depends(require_area("club"))):
    """„Kein Spam“ (#2067): die Nachricht normal einordnen und die Mails nachholen, die beim Eingang unterblieben.

    Nur für Nachrichten, die der Spamschutz beim Eingang markiert hat (von Hand auf „Spam“ gesetzte hatten ihre Mails
    schon). Zweistufig, damit ein Absturz nichts verliert und nichts doppelt schickt:

    1. ``spam.release.state = "releasing"`` - bedingt gesetzt, auch neu, wenn ein früherer Versuch länger als
       ``RELEASE_STALE_MINUTES`` hängt.
    2. Mails einreihen - mit Schlüssel je Nachricht und Mail-Art, ein zweiter Versuch reiht nichts doppelt ein.
    3. ``released``: Status „Neu“. Erst danach antwortet ein weiterer Klick mit 409.
    """
    db = get_db()
    now = now_utc()
    stale = (now - timedelta(minutes=RELEASE_STALE_MINUTES)).isoformat()
    doc = await db.contact_messages.find_one_and_update(
        {"id": cid, "status": "spam", "spam.reasons": {"$exists": True},
         "$or": [{"spam.release": {"$exists": False}},
                 {"spam.release.state": "releasing", "spam.release.started_at": {"$lt": stale}}]},
        # Einzelne Felder statt des ganzen Unterdokuments: eine Vormerkung des Discord-Hinweises bleibt erhalten.
        {"$set": {"spam.release.state": "releasing", "spam.release.started_at": now.isoformat(), "spam.release.by": me["id"]}},
        return_document=ReturnDocument.AFTER)
    if not doc:
        current = await db.contact_messages.find_one({"id": cid}, {"_id": 0, "status": 1, "spam": 1})
        if not current:
            raise HTTPException(404, "Nachricht nicht gefunden.")
        if (current.get("spam") or {}).get("release", {}).get("state") == "releasing" and current.get("status") == "spam":
            raise HTTPException(423, "Die Freigabe läuft gerade - bitte in ein paar Minuten noch einmal versuchen.")
        raise HTTPException(409, "Diese Nachricht ist nicht als Spam markiert oder wurde schon freigegeben.")
    doc.pop("_id", None)
    await _notify_contact(db, doc, claim_board_hint=True)
    done = now_utc().isoformat()
    await db.contact_messages.update_one({"id": cid}, {"$set": {
        "status": "new", "status_changed_at": done, "spam.cleared_at": done, "spam.cleared_by": me["id"], "spam.release.state": "released",
        "spam.release.finished_at": done}})
    return await _contact_view(db, cid)


@contact_router.delete("/{cid}")
async def delete_contact_message(cid: str, me: dict = Depends(require_area("club"))):
    db = get_db()
    res = await db.contact_messages.delete_one({"id": cid})
    if res.deleted_count == 0:
        raise HTTPException(404, "Nachricht nicht gefunden.")
    # Endgültig heißt auch: keine Kopie in Warteschlange oder Versandlog (#2131).
    await contact_retention.forget_copies(db, [cid])
    return {"ok": True}


# ---------- Vorstand / Board ----------
board_router = APIRouter(prefix="/api/board", tags=["board"])


DEFAULT_BOARD_POSITIONS = [
    {"slug": "obmann", "title_male": "Obmann", "title_female": "Obfrau", "is_default": True, "allow_deputy": True, "order_index": 1, "description": "Vereinsleitung, Strategie, externe Vertretung."},
    {"slug": "kassier", "title_male": "Kassier", "title_female": "Kassierin", "is_default": True, "allow_deputy": True, "order_index": 2, "description": "Finanzen, Mitgliedsbeiträge, Sponsoren-Abrechnung."},
    {"slug": "schriftfuehrer", "title_male": "Schriftführer", "title_female": "Schriftführerin", "is_default": True, "allow_deputy": True, "order_index": 3, "description": "Protokolle, Kommunikation, Vereinsregister."},
]


async def _ensure_default_board_positions():
    db = get_db()
    for p in DEFAULT_BOARD_POSITIONS:
        existing = await db.board_positions.find_one({"slug": p["slug"]})
        if not existing:
            await db.board_positions.insert_one({
                "id": new_id(), "is_active": True, "user_id": None, "deputy_user_id": None,
                "created_at": now_utc().isoformat(), **p,
            })
        elif existing.get("order_index") != p["order_index"]:
            await db.board_positions.update_one({"slug": p["slug"]}, {"$set": {"order_index": p["order_index"]}})


class BoardPositionCreate(BaseModel):
    title_male: str
    title_female: Optional[str] = None
    slug: Optional[str] = None
    description: Optional[str] = ""
    allow_deputy: bool = False
    order_index: int = 99
    is_active: bool = True


class BoardPositionUpdate(BaseModel):
    title_male: Optional[str] = None
    title_female: Optional[str] = None
    description: Optional[str] = None
    allow_deputy: Optional[bool] = None
    order_index: Optional[int] = None
    is_active: Optional[bool] = None
    user_id: Optional[str] = None  # None = unassigned, "" = clear
    deputy_user_id: Optional[str] = None


def _slugify(value: str) -> str:
    return slugify(value, fallback="position", max_length=80)


def _board_person_from_profile(profile: dict) -> dict:
    gamertag = profile.get("gamertag") or profile.get("display_name")
    return {
        "id": profile["id"],
        "username": profile.get("slug"),
        "slug": profile.get("slug"),
        "display_name": profile.get("display_name"),
        "gamertag": gamertag,
        "real_name": profile.get("real_name") or (profile.get("display_name") if profile.get("display_name") != gamertag else None),
        "avatar_url": profile.get("photo_url"),
        "photo_url": profile.get("photo_url"),
        "cover_url": profile.get("cover_url"),
        "gender": profile.get("gender"),
        "role_title": profile.get("role_title"),
        "profile_url": f"/members/{profile.get('slug')}",
        "source": "member_profile",
    }


def _board_person_from_user(user: dict) -> dict:
    return {
        **user,
        "profile_url": profile_path(user.get('username')),
        "source": "user",
    }


async def _normalize_board_assignee(db, assignee_id: str | None) -> str | None:
    """Prefer editable club member profile ids, even when an old user id is submitted."""
    if not assignee_id:
        return None
    profile = await db.club_member_profiles.find_one(
        {"$or": [{"id": assignee_id}, {"user_id": assignee_id}]},
        {"_id": 0, "id": 1},
    )
    return profile["id"] if profile else assignee_id


BOARD_FROM_DOLIBARR_DETAIL = "Den Vorstand führt Dolibarr – hier lässt sich nichts ändern. Funktionen und Inhaber pflegst du in Dolibarr."
BOARD_MEMBERS_ONLY_DETAIL = "Einen Vorstandsposten besetzen nur Vereinsmitglieder – diese Person hat keine aktive Mitgliedschaft."
# Diese Felder stehen als eigene Einträge im Protokoll (`board.assign`, `board.status`) oder ergeben sich daraus.
BOARD_LOGGED_APART = {"user_id", "deputy_user_id", "user_since", "deputy_since", "is_active", "slug_history"}


async def _board_led_by_dolibarr(db) -> bool:
    """Führt Dolibarr den Vorstand (#326 Teil 2)? Dann ist die Liste hier nur zum Lesen (#1355)."""
    from services import club_facts

    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0, "legal_from_dolibarr": 1}) or {}
    return bool((await club_facts.board_source(db, branding)).get("dolibarr"))


async def _require_local_board(db) -> None:
    if await _board_led_by_dolibarr(db):
        raise HTTPException(409, BOARD_FROM_DOLIBARR_DETAIL)


async def _board_candidate(db, assignee_id: str) -> dict:
    """Wer einen Posten besetzen darf (#1355): Vereinsmitglieder - ein Konto mit aktiver Mitgliedschaft oder ein
    gepflegtes Mitgliederprofil ohne Konto. Gibt Name und ob ein Konto dahinter steht zurück."""
    from services.membership_service import get_membership, is_active_member

    profile = await db.club_member_profiles.find_one({"$or": [{"id": assignee_id}, {"user_id": assignee_id}]},
                                                     {"_id": 0, "id": 1, "user_id": 1, "display_name": 1})
    user_id = (profile or {}).get("user_id") or (None if profile else assignee_id)
    if profile and not user_id:
        return {"name": profile.get("display_name") or "Mitglied", "user_id": None}
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1, "display_name": 1, "username": 1})
    if not user:
        raise HTTPException(404, "Person nicht gefunden.")
    if not is_active_member(await get_membership(user_id)):
        raise HTTPException(400, BOARD_MEMBERS_ONLY_DETAIL)
    return {"name": user.get("display_name") or user.get("username") or "Mitglied", "user_id": user_id}


async def _audit_board(db, action: str, me: dict, pid: str, data: dict) -> None:
    await db.audit_logs.insert_one({"id": new_id(), "action": action, "actor_id": me.get("id"), "target_id": pid, "data": data,
                                    "created_at": now_utc().isoformat()})


async def _board_account_ids(db, refs) -> dict[str, str]:
    """Hinter einem Posten steht ein Mitgliederprofil oder direkt ein Konto: Verweis → Konto. Profile ohne Konto fehlen."""
    wanted = sorted({ref for ref in refs if ref})
    accounts: dict[str, str] = {}
    async for profile in db.club_member_profiles.find({"id": {"$in": wanted}}, {"_id": 0, "id": 1, "user_id": 1}):
        if profile.get("user_id"):
            accounts[profile["id"]] = profile["user_id"]
    rest = [ref for ref in wanted if ref not in accounts]
    async for user in db.users.find({"id": {"$in": rest}}, {"_id": 0, "id": 1}):
        accounts[user["id"]] = user["id"]
    return accounts


async def _tell_board_change(db, me: dict, before: dict[str, set[str]], sentences: dict[str, list[str]]) -> None:
    """Die Meldung an alle Betroffenen (#2125) - nur die Person, die es selbst geändert hat, kennt es schon."""
    from services.rights_notices import areas_snapshot, tell_rights_change

    after = await areas_snapshot(db, sentences)
    for user_id, parts in sentences.items():
        if user_id != me.get("id"):
            await tell_rights_change(db, user_id, " ".join(parts), before.get(user_id, set()), after.get(user_id, set()))


@board_router.get("/admin/state")
async def board_admin_state(me: dict = Depends(require_area("club", "system"))):
    """Für die Seite „Vorstand“ (#1355): führt Dolibarr den Vorstand, und kommen die Rechte aus Dolibarr-Funktionen
    (dann verleiht ein Posten hier nichts)?"""
    from services.dolibarr_client import load_settings
    from services.dolibarr_policy import policy_active

    db = get_db()
    return {"dolibarr_leads": await _board_led_by_dolibarr(db), "rights_from_dolibarr": policy_active(await load_settings(db))}


@board_router.get("/source")
async def board_source():
    """Führt Dolibarr den Vorstand (#326 Teil 2)? Nur Schalter und Stand - keine Personen."""
    from services import club_facts
    db = get_db()
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0, "legal_from_dolibarr": 1}) or {}
    return await club_facts.board_source(db, branding)


def statutes_switch(branding: dict) -> bool:
    """„Statuten öffentlich zeigen“ (#1252): an, solange die Verwaltung es nicht ausdrücklich ausschaltet (Wahl des Betreibers)."""
    return branding.get("statutes_public") is not False


async def statutes_document(db) -> dict | None:
    """Ohne Dolibarr: das Dokument der Kategorie „Statuten“ aus Verwaltung → Dokumente - angepinnt oder das neueste,
    nie eines, das nur intern (für Admins) ist."""
    return await db.documents.find_one({"category": "statutes", "visibility": {"$ne": "internal"}}, {"_id": 0},
                                       sort=[("pinned", -1), ("created_at", -1)])


@board_router.get("/statutes")
async def board_statutes():
    """Die geltenden Statuten für alle (#326 Teil 3, #1252): mit „Vereinsdaten aus Dolibarr“ die Fassungen, die der Verein
    im Modul für die Öffentlichkeit freigibt (die Freigabe bleibt dort), sonst das Statuten-Dokument aus Verwaltung →
    Dokumente. Ist „Statuten öffentlich zeigen“ aus, bleiben sie im Mitgliederbereich."""
    from services import club_facts
    db = get_db()
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0, "legal_from_dolibarr": 1, "statutes_public": 1}) or {}
    if not statutes_switch(branding):
        return {"available": False, "reason": "members_only"}
    if branding.get("legal_from_dolibarr"):
        view = club_facts.statutes_public(await club_facts.snapshot(db), switch_on=True)
        if view.get("available"):
            current = view.get("current")
            view.update({"source": "dolibarr", "pdf_url": f"/api/board/statutes/{current['id']}/pdf" if current else None})
        return view
    doc = await statutes_document(db)
    if not doc:
        return {"available": False, "reason": "no_document"}
    return {
        "available": True, "source": "documents", "state": "in_force", "versions": [], "pdf_url": "/api/board/statutes/document",
        "current": {"id": doc["id"], "title": doc.get("title") or "Statuten", "updated_at": doc.get("updated_at") or doc.get("created_at")},
    }


@board_router.get("/statutes/document")
async def board_statutes_document():
    """Ohne Dolibarr: das Statuten-Dokument als PDF für alle - nur mit „Statuten öffentlich zeigen“."""
    from routes.document_routes import _file_response, _safe_storage_path
    db = get_db()
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0, "legal_from_dolibarr": 1, "statutes_public": 1}) or {}
    doc = await statutes_document(db) if statutes_switch(branding) and not branding.get("legal_from_dolibarr") else None
    path = _safe_storage_path(doc) if doc else None
    if not path or not path.exists() or not path.is_file():
        raise HTTPException(404, "Die Statuten sind nicht öffentlich oder noch nicht hinterlegt.")
    return _file_response(doc, path, "inline")


@board_router.get("/statutes/{version_id}/pdf")
async def board_statutes_pdf(version_id: int):
    """Das PDF einer freigegebenen Fassung, geprüft gegen die Prüfsumme der Vereinsakte."""
    from services import club_facts
    from services.dolibarr_client import DolibarrClient, DolibarrError, load_settings
    db = get_db()
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0, "legal_from_dolibarr": 1, "statutes_public": 1}) or {}
    if not statutes_switch(branding):
        raise HTTPException(404, "Diese Statutenfassung gibt es nicht oder sie ist nicht freigegeben.")
    try:
        client = DolibarrClient(await load_settings(db))
        content, row = await club_facts.statutes_pdf(db, branding, version_id, client)
    except DolibarrError as exc:
        if exc.kind == "not_found":
            raise HTTPException(404, "Diese Statutenfassung gibt es nicht oder sie ist nicht freigegeben.")
        if exc.kind == "invalid_response":
            raise HTTPException(502, "Die Datei aus Dolibarr passt nicht zur Prüfsumme der Vereinsakte – bitte im Vereinsmodul prüfen.")
        raise HTTPException(503, "Die Statuten sind gerade nicht abrufbar – Dolibarr antwortet nicht.")
    filename = f"Statuten-Fassung-{row.get('version')}.pdf"
    return Response(content=content, media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="{filename}"', "Cache-Control": "public, max-age=3600"})


# Offene Funktionen (#1252): je Funktion ein Satz zum Aufwand für „Wir suchen …“ - ein Ort für die Posten von Hand und
# die aus Dolibarr, nach dem Kürzel der Funktion (Stellvertretungen von Hand: „<kürzel>-stv“, wie Dolibarr sie nennt).
VACANCY_DOC_ID = "board_vacancies"
VACANCY_TEXT_MAX = 300
VACANCY_KEYS_MAX = 100


async def vacancy_texts(db) -> dict[str, str]:
    doc = await db.settings.find_one({"id": VACANCY_DOC_ID}, {"_id": 0, "texts": 1}) or {}
    texts = doc.get("texts") if isinstance(doc.get("texts"), dict) else {}
    return {str(key): str(value) for key, value in texts.items() if value}


class VacancyTextsBody(BaseModel):
    texts: dict[str, str] = Field(default_factory=dict)


@board_router.put("/vacancy-texts")
async def save_vacancy_texts(body: VacancyTextsBody, me: dict = Depends(require_area("club"))):
    """Sätze für offene Funktionen speichern; ein leerer Satz löscht ihn."""
    db = get_db()
    texts = await vacancy_texts(db)
    for slug, text in body.texts.items():
        key = _slugify(slug)
        clean = " ".join(str(text or "").split())[:VACANCY_TEXT_MAX]
        if clean:
            texts[key] = clean
        else:
            texts.pop(key, None)
    if len(texts) > VACANCY_KEYS_MAX:
        raise HTTPException(400, "Zu viele Funktionen.")
    await db.settings.update_one({"id": VACANCY_DOC_ID}, {"$set": {"texts": texts, "updated_at": now_utc().isoformat(), "updated_by": me.get("id")},
                                                          "$setOnInsert": {"id": VACANCY_DOC_ID}}, upsert=True)
    return {"ok": True, "texts": texts}


def _form_of(position: dict, person: dict | None) -> str:
    """Die Bezeichnung in der Form der Person (#1332): weiblich mit eigener Form, sonst die männliche."""
    if person and person.get("gender") == "female" and position.get("title_female"):
        return position["title_female"]
    return position.get("title_male") or ""


def _neutral_title(position: dict) -> str:
    """Für eine offene Funktion (#1252): „Kassier:in“, wenn die weibliche Form nur „-in“ anhängt, sonst „Obmann/Obfrau“."""
    male, female = position.get("title_male") or "", position.get("title_female") or ""
    if not female or female == male:
        return male
    if male and female == f"{male}in":
        return f"{male}:in"
    return f"{male}/{female}" if male else female


async def _decorate_positions(db, positions: list[dict]) -> list[dict]:
    """Sätze für offene Funktionen und „freigestellt“ an den Fotos (#1252, #1332) - für beide Quellen gleich."""
    from services import photo_cutout

    texts = await vacancy_texts(db)
    people = [person for position in positions for person in (position.get("user"), position.get("deputy_user")) if person]
    flags = await photo_cutout.flags_for(db, [person.get("photo_url") or person.get("avatar_url") for person in people])
    for person in people:
        person["photo_cutout"] = bool(flags.get(person.get("photo_url") or person.get("avatar_url") or ""))
    for position in positions:
        position["vacancy_text"] = texts.get(position.get("slug") or "", "")
        if position.get("allow_deputy"):
            position["deputy_vacancy_text"] = texts.get(f"{position.get('slug')}-stv", "")
    return positions


@board_router.get("")
async def list_board_positions(active_only: bool = False, manual: bool = False, me=Depends(get_current_user_optional)):
    """Public list. By default returns active+inactive; ?active_only=true filters.

    Steht „Vereinsdaten aus Dolibarr“ an und hat Dolibarr einen Vorstand geliefert, kommt die Liste
    von dort (#326 Teil 2) - ``?manual=true`` liefert die Posten von Hand (für den Admin, Rückfall)."""
    db = get_db()
    if not manual:
        from services import club_facts
        branding = await db.settings.find_one({"id": "branding"}, {"_id": 0, "legal_from_dolibarr": 1}) or {}
        from_dolibarr = await club_facts.board_positions(db, branding)
        if from_dolibarr is not None:
            return await _decorate_positions(db, from_dolibarr)
    await _ensure_default_board_positions()
    q = {"is_active": True} if active_only else {}
    positions = await db.board_positions.find(q, {"_id": 0}).sort("order_index", 1).to_list(100)
    assignment_ids = [p["user_id"] for p in positions if p.get("user_id")] + [p["deputy_user_id"] for p in positions if p.get("deputy_user_id")]
    assignment_ids = list(set(filter(None, assignment_ids)))
    people = {}
    if assignment_ids:
        async for profile in db.club_member_profiles.find(
            {"$or": [{"id": {"$in": assignment_ids}}, {"user_id": {"$in": assignment_ids}}]},
            {"_id": 0, "id": 1, "user_id": 1, "slug": 1, "display_name": 1, "gamertag": 1, "real_name": 1, "photo_url": 1, "cover_url": 1, "gender": 1, "role_title": 1},
        ):
            person = _board_person_from_profile(profile)
            people[profile["id"]] = person
            if profile.get("user_id"):
                people[profile["user_id"]] = person
        missing_ids = [pid for pid in assignment_ids if pid not in people]
        if missing_ids:
            async for u in db.users.find({"id": {"$in": missing_ids}},
                                           {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1, "gender": 1}):
                people[u["id"]] = _board_person_from_user(u)
    for p in positions:
        u = people.get(p.get("user_id")) if p.get("user_id") else None
        d = people.get(p.get("deputy_user_id")) if p.get("deputy_user_id") else None
        if u and u.get("source") == "member_profile":
            p["user_id"] = u["id"]
        if d and d.get("source") == "member_profile":
            p["deputy_user_id"] = d["id"]
        p["user"] = u
        p["deputy_user"] = d
        # Die Bezeichnung in der Form der Person - auch für die Stellvertretung (#1332).
        p["display_title"] = _form_of(p, u)
        p["deputy_title"] = _form_of(p, d)
        p["neutral_title"] = _neutral_title(p)
    return await _decorate_positions(db, positions)


@board_router.post("")
async def create_position(body: BoardPositionCreate, me: dict = Depends(require_area("club"))):
    db = get_db()
    await _require_local_board(db)
    slug = await unique_slug(db.board_positions, body.slug or body.title_male, fallback="position", max_length=80)
    doc = {
        "id": new_id(), "slug": slug, "is_default": False, "user_id": None, "deputy_user_id": None,
        "created_at": now_utc().isoformat(), **body.model_dump(),
    }
    doc["slug"] = slug
    await db.board_positions.insert_one(doc)
    await _audit_board(db, "board.create", me, doc["id"], {"position": slug, "title": _neutral_title(doc), "is_active": doc.get("is_active")})
    doc.pop("_id", None)
    return doc


@board_router.put("/{pid}")
@board_router.patch("/{pid}")
async def update_position(pid: str, body: BoardPositionUpdate, me: dict = Depends(require_area("club"))):
    db = get_db()
    existing = await db.board_positions.find_one({"id": pid}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Position nicht gefunden.")
    await _require_local_board(db)
    updates = body.model_dump(exclude_unset=True)
    slug_source = slug_source_for_update(updates, existing, "title_male", fallback="position")
    if slug_source is not None:
        updates["slug"] = await unique_slug(db.board_positions, slug_source, current_id=pid, fallback="position", max_length=80)
        apply_slug_history(existing, updates)
    # Convert "" → None to clear assignments
    for k in ("user_id", "deputy_user_id"):
        if k in updates and updates[k] == "":
            updates[k] = None
        elif k in updates and updates[k]:
            # Nur Vereinsmitglieder (#1355) - der Posten bringt die Vereinsverwaltung.
            await _board_candidate(db, updates[k])
            updates[k] = await _normalize_board_assignee(db, updates[k])
        # Vorstandsarbeit (#615): seit wann jemand das Amt hat - neu bei jedem Wechsel, weg beim Leeren.
        since_key = "user_since" if k == "user_id" else "deputy_since"
        if k in updates and updates[k] != existing.get(k):
            updates[since_key] = now_utc().isoformat() if updates[k] else None
    from services.rights_notices import areas_snapshot

    holder_refs = [existing.get("user_id"), existing.get("deputy_user_id")]
    accounts = await _board_account_ids(db, [*holder_refs, updates.get("user_id"), updates.get("deputy_user_id")])
    before = await areas_snapshot(db, accounts.values())
    await db.board_positions.update_one({"id": pid}, {"$set": updates})
    if updates.get("slug") and updates["slug"] != existing.get("slug"):
        texts = await vacancy_texts(db)
        moved = {new: texts.pop(old) for old, new in ((existing.get("slug"), updates["slug"]), (f"{existing.get('slug')}-stv", f"{updates['slug']}-stv")) if old in texts}
        if moved:
            await db.settings.update_one({"id": VACANCY_DOC_ID}, {"$set": {"texts": {**texts, **moved}}}, upsert=True)
    title = _neutral_title({**existing, **updates})
    sentences: dict[str, list[str]] = {}
    # Eine Besetzung ist eine Rechtevergabe (docs/ROLLEN.md) - jede steht im Protokoll (#1355) und die Person erfährt es (#2125).
    for k in ("user_id", "deputy_user_id"):
        if k in updates and updates[k] != existing.get(k):
            await _audit_board(db, "board.assign", me, pid, {"position": existing.get("slug"), "title": title, "field": "holder" if k == "user_id" else "deputy",
                                                             "from": existing.get(k), "to": updates[k]})
            role = title if k == "user_id" else f"Vertretung für {title}"
            if accounts.get(updates[k]):
                sentences.setdefault(accounts[updates[k]], []).append(f"Du bist jetzt {role}.")
            if accounts.get(existing.get(k)):
                sentences.setdefault(accounts[existing[k]], []).append(f"Du bist nicht mehr {role}.")
    # Aktiv oder inaktiv entscheidet, ob der Posten die Vereinsverwaltung bringt (#2125).
    if "is_active" in updates and bool(updates["is_active"]) != (existing.get("is_active") is not False):
        await _audit_board(db, "board.status", me, pid, {"position": existing.get("slug"), "title": title, "active": bool(updates["is_active"]),
                                                         "holders": [ref for ref in holder_refs if ref]})
        for ref in holder_refs:
            if accounts.get(ref):
                sentences.setdefault(accounts[ref], []).append(f"Der Posten {title} ist jetzt {'aktiv' if updates['is_active'] else 'inaktiv'}.")
    changed = sorted(key for key, value in updates.items() if key not in BOARD_LOGGED_APART and value != existing.get(key))
    if changed:
        await _audit_board(db, "board.update", me, pid, {"position": existing.get("slug"), "title": title, "fields": changed})
    await _tell_board_change(db, me, before, sentences)
    return await db.board_positions.find_one({"id": pid}, {"_id": 0})


@board_router.delete("/{pid}")
async def delete_position(pid: str, me: dict = Depends(require_area("club"))):
    db = get_db()
    p = await db.board_positions.find_one({"id": pid})
    if not p:
        raise HTTPException(404, "Position nicht gefunden.")
    await _require_local_board(db)
    if p.get("is_default"):
        raise HTTPException(400, "Standard-Positionen können nicht gelöscht werden — deaktivieren stattdessen.")
    from services.rights_notices import areas_snapshot

    title = _neutral_title(p)
    holder_refs = [ref for ref in (p.get("user_id"), p.get("deputy_user_id")) if ref]
    accounts = await _board_account_ids(db, holder_refs)
    before = await areas_snapshot(db, accounts.values())
    await db.board_positions.delete_one({"id": pid})
    await _audit_board(db, "board.delete", me, pid, {"position": p.get("slug"), "title": title, "holders": holder_refs})
    await _tell_board_change(db, me, before, {account: [f"Den Posten {title} gibt es nicht mehr."] for account in accounts.values()})
    return {"ok": True}


@board_router.get("/assignable-users")
async def list_assignable_users(me: dict = Depends(require_area("club"))):
    """Returns only editable club member profiles for board assignments."""
    db = get_db()
    profiles = await db.club_member_profiles.find(
        {"is_active": {"$ne": False}},
        {"_id": 0, "id": 1, "slug": 1, "display_name": 1, "gamertag": 1, "real_name": 1, "photo_url": 1, "cover_url": 1, "role_title": 1, "gender": 1, "user_id": 1},
    ).sort([("order_index", 1), ("display_name", 1)]).to_list(500)
    out = []
    for p in profiles:
        out.append({
            **_board_person_from_profile(p),
            "username": p.get("slug"),
            "role": "club_member_profile",
            "is_club_member": True,
        })
    return out
