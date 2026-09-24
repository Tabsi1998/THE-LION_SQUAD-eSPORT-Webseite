"""Einladung zum Mitgliedsantrag (#507): Der Vorstand schaltet den Antrag für ein bestehendes Konto frei.
Das Konto bekommt eine Benachrichtigung und (nach seinen Einstellungen) eine Mail, sieht beim nächsten
Besuch auf Website und App den Hinweis „Einladung zum Verein“ und füllt den Antrag direkt aus. Stellt
es den Antrag, steht die Einladung auf „Antrag gestellt“; der Vorstand kann sie zurückziehen; nach
30 Tagen läuft sie ab. Ohne Einladung bleibt „Mitglied werden“ wie bisher erreichbar."""
from __future__ import annotations

import html
from datetime import timedelta

from models import new_id, now_utc
from services.membership_service import get_membership, is_active_member

EXPIRY_DAYS = 30
OPEN, APPLIED, WITHDRAWN, EXPIRED = "open", "applied", "withdrawn", "expired"


class InvitationError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


async def _expire_open(db, now_iso: str) -> None:
    await db.membership_invitations.update_many({"status": OPEN, "expires_at": {"$lt": now_iso}}, {"$set": {"status": EXPIRED}})


async def open_invitation_for(db, user_id: str) -> dict | None:
    await _expire_open(db, now_utc().isoformat())
    return await db.membership_invitations.find_one({"user_id": user_id, "status": OPEN}, {"_id": 0})


async def _audit(db, action: str, actor_id: str | None, user_id: str, data: dict) -> None:
    await db.audit_logs.insert_one({"id": new_id(), "action": action, "actor_id": actor_id, "target_type": "user", "target_id": user_id,
                                    "data": data, "created_at": now_utc().isoformat()})


async def create_invitation(db, user_id: str, invited_by: dict, note: str = "") -> dict:
    """Eine offene Einladung je Konto; ein aktives Mitglied oder ein gesperrtes Konto lässt sich nicht einladen."""
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1, "email": 1, "display_name": 1, "username": 1, "is_banned": 1,
                                                    "newsletter_consent": 1, "notification_preferences": 1})
    if not user:
        raise InvitationError(404, "Konto nicht gefunden.")
    if user.get("is_banned"):
        raise InvitationError(400, "Ein gesperrtes Konto kann nicht eingeladen werden.")
    if is_active_member(await get_membership(user_id)):
        raise InvitationError(409, "Dieses Konto ist schon aktives Mitglied.")
    existing = await open_invitation_for(db, user_id)
    if existing:
        return {**existing, "existing": True}
    now = now_utc()
    doc = {
        "id": new_id(), "user_id": user_id, "invited_by": invited_by.get("id"), "note": str(note or "").strip()[:500], "status": OPEN,
        "created_at": now.isoformat(), "expires_at": (now + timedelta(days=EXPIRY_DAYS)).isoformat(), "applied_at": None, "application_id": None,
    }
    await db.membership_invitations.insert_one(doc)
    await _audit(db, "membership.invite", invited_by.get("id"), user_id, {"invitation_id": doc["id"]})
    await _notify(user, doc)
    return {k: v for k, v in doc.items() if k != "_id"}


async def _notify(user: dict, doc: dict) -> None:
    """Hinweis im Konto und - wenn die Person Mitgliedschafts-Mails zulässt - eine Mail über die Queue."""
    from services.user_notifications import create_user_notification

    await create_user_notification(user["id"], "Einladung zum Verein", "Der Vorstand lädt dich ein, Mitglied zu werden – fülle den Antrag aus.",
                                   url="/membership/apply", kind="membership_invited", meta={"category": "membership_updates", "invitation_id": doc["id"]})
    from services.notification_preferences import email_allowed

    if not user.get("email") or not email_allowed(user, "membership_invited", "membership_updates"):
        return
    from routes.phase_ef_routes import render_template
    from services.mail_queue import enqueue_mail

    name = user.get("display_name") or user.get("username") or "du"
    note_html = f"<p><em>{html.escape(doc['note'])}</em></p>" if doc.get("note") else ""
    subject, body = await render_template(
        "membership_invited", {"name": name, "note": doc.get("note") or ""},
        fallback_subject="Einladung: Werde Mitglied bei uns",
        fallback_html=(f"<p>Hallo {html.escape(name)},</p><p>der Vorstand lädt dich ein, Mitglied zu werden. Melde dich auf der Website an und "
                       f"fülle den Mitgliedsantrag aus – er ist für dich freigeschaltet.</p>{note_html}"),
    )
    await enqueue_mail(user["email"], subject, body, template_key="membership_invited", dedupe_key=f"invite:{doc['id']}")


async def mark_applied(db, user_id: str, application_id: str | None = None) -> bool:
    """Der Antrag ist gestellt - die offene Einladung ist damit erledigt."""
    result = await db.membership_invitations.update_many(
        {"user_id": user_id, "status": OPEN}, {"$set": {"status": APPLIED, "applied_at": now_utc().isoformat(), "application_id": application_id}})
    return bool(getattr(result, "modified_count", 0))


async def withdraw(db, invitation_id: str, actor_id: str | None) -> dict | None:
    doc = await db.membership_invitations.find_one({"id": invitation_id}, {"_id": 0})
    if not doc:
        return None
    if doc["status"] == OPEN:
        await db.membership_invitations.update_one({"id": invitation_id}, {"$set": {"status": WITHDRAWN, "withdrawn_at": now_utc().isoformat(), "withdrawn_by": actor_id}})
        await _audit(db, "membership.invite.withdraw", actor_id, doc["user_id"], {"invitation_id": invitation_id})
        doc = await db.membership_invitations.find_one({"id": invitation_id}, {"_id": 0})
    return doc


async def list_invitations(db, status: str | None = None, limit: int = 200) -> list[dict]:
    await _expire_open(db, now_utc().isoformat())
    query = {"status": status} if status else {}
    rows = await db.membership_invitations.find(query, {"_id": 0}).sort("created_at", -1).to_list(max(1, min(int(limit), 500)))
    ids = {row["user_id"] for row in rows} | {row.get("invited_by") for row in rows if row.get("invited_by")}
    users = {u["id"]: u for u in await db.users.find({"id": {"$in": list(ids)}}, {"_id": 0, "id": 1, "username": 1, "display_name": 1, "email": 1}).to_list(max(1, len(ids)))} if ids else {}
    for row in rows:
        person = users.get(row["user_id"], {})
        row["user"] = {"id": row["user_id"], "username": person.get("username"), "display_name": person.get("display_name"), "email": person.get("email")}
        inviter = users.get(row.get("invited_by"), {})
        row["invited_by_name"] = inviter.get("display_name") or inviter.get("username") or ""
    return rows


def own_view(doc: dict | None) -> dict:
    """Was das eingeladene Konto sieht - ohne, wer eingeladen hat."""
    if not doc:
        return {"open": False}
    return {"open": True, "id": doc["id"], "note": doc.get("note") or "", "created_at": doc["created_at"], "expires_at": doc["expires_at"]}
