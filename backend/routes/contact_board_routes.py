"""Contact + Board Position routes (Phase D refinements).

- /api/contact: public submission with rich topic enum, auto-reply via mail-queue,
  admin notification, full inbox CRUD.
- /api/board: dynamic vorstand positions (defaults seeded, admin can add/disable
  /assign members).
"""
from html import escape

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field
from typing import Optional, Literal, List

from database import get_db
from auth import require_admin, get_optional_user as get_current_user_optional
from models import now_utc, new_id
from services.rate_limit import enforce_rate_limit
from services.slug_utils import slug_source_for_update, slugify, unique_slug

# ---------- Contact ----------
contact_router = APIRouter(prefix="/api/contact", tags=["contact"])

ContactTopic = Literal[
    "general", "membership", "tournament", "fastlap",
    "sponsorship", "press", "report_bug", "abuse", "other",
]

TOPIC_LABELS = {
    "general": "Allgemeine Anfrage",
    "membership": "Mitgliedschaft",
    "tournament": "Turnier-Anfrage",
    "fastlap": "Fast-Lap-Anfrage",
    "sponsorship": "Sponsoring",
    "press": "Presse / Kooperation",
    "report_bug": "Fehler melden",
    "abuse": "Missbrauch / Beschwerde",
    "other": "Sonstiges",
}

ContactStatus = Literal["new", "in_progress", "answered", "closed", "spam"]


class ContactSubmit(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    topic: ContactTopic = "general"
    subject: str = Field(min_length=2, max_length=200)
    message: str = Field(min_length=5, max_length=4000)
    related_id: Optional[str] = None  # tournament_id / event_id / etc.
    accept_privacy: bool = True


@contact_router.post("/submit")
async def submit_contact(body: ContactSubmit, request: Request, me=Depends(get_current_user_optional)):
    if not body.accept_privacy:
        raise HTTPException(400, "Datenschutz-Zustimmung erforderlich.")
    await enforce_rate_limit(request, "contact:submit:ip", limit=5, window_seconds=900)
    db = get_db()
    name = body.name.strip()
    email = str(body.email).lower()
    subject = body.subject.strip().replace("\r", " ").replace("\n", " ")
    message = body.message.strip()
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
    }
    await db.contact_messages.insert_one(doc)
    # Auto-reply via mail queue (uses render_template if admin customised it)
    from email_service import _wrap
    from services.mail_queue import enqueue_mail
    from routes.phase_ef_routes import render_template
    topic_label = escape(TOPIC_LABELS.get(body.topic, body.topic))
    first_name = name.split()[0] if name else "dort"
    safe_name = escape(name)
    safe_email = escape(email)
    safe_subject = escape(subject)
    safe_message = escape(message)
    safe_message_preview = escape(message[:1000])
    safe_first_name = escape(first_name)
    safe_topic_label = escape(topic_label)
    fallback_user_html = _wrap(
        "Wir haben deine Nachricht erhalten",
        f"<p>Hallo {safe_first_name},</p>"
        f"<p>danke für deine Nachricht zum Thema <strong>{safe_topic_label}</strong>. Wir melden uns so bald wie möglich.</p>"
        "<p>Falls dein Anliegen dringend ist, findest du uns auch auf Discord.</p>"
        "<hr style='border:0;border-top:1px solid #1F2937;margin:20px 0;'/>"
        "<p style='color:#6B7280;font-size:12px'>Deine Nachricht (Kopie):</p>"
        f"<blockquote style='margin:8px 0;padding:8px 12px;border-left:3px solid #29B6E8;color:#9CA3AF;font-size:13px'>{safe_message_preview}</blockquote>",
    )
    user_subj, user_html = await render_template(
        "contact_auto_reply",
        {"name": first_name, "topic": topic_label},
        fallback_subject=f"Bestätigung: Wir haben deine Nachricht erhalten — {subject[:80]}",
        fallback_html=fallback_user_html,
    )
    await enqueue_mail(
        to=email,
        subject=user_subj,
        html=user_html,
        template_key="contact_autoreply",
        meta={"contact_id": doc["id"]},
    )
    # Admin notification
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0}) or {}
    admin_to = branding.get("contact_email") or branding.get("sender_email")
    if not admin_to:
        admin = await db.users.find_one({"role": "superadmin"}, {"email": 1, "_id": 0})
        admin_to = admin.get("email") if admin else None
    if admin_to:
        admin_html = _wrap(
            f"Neue Nachricht: {safe_topic_label}",
            f"<p><strong>Name:</strong> {safe_name}<br/><strong>E-Mail:</strong> {safe_email}<br/><strong>Thema:</strong> {safe_topic_label}</p>"
            f"<p><strong>Betreff:</strong> {safe_subject}</p>"
            f"<blockquote style='margin:8px 0;padding:8px 12px;border-left:3px solid #29B6E8;color:#D1D5DB'>{safe_message}</blockquote>"
            f"<p style='color:#6B7280;font-size:12px'>ID: {doc['id']}</p>",
        )
        await enqueue_mail(
            to=admin_to,
            subject=f"[TLS Kontakt] {topic_label}: {subject[:60]}",
            html=admin_html,
            template_key="contact_admin_notify",
            meta={"contact_id": doc["id"]},
        )
    return {"ok": True, "id": doc["id"]}


@contact_router.get("/topics")
async def list_topics():
    return [{"value": k, "label": v} for k, v in TOPIC_LABELS.items()]


@contact_router.get("")
async def list_contact_messages(status: Optional[ContactStatus] = None,
                                 me: dict = Depends(require_admin())):
    db = get_db()
    q: dict = {}
    if status:
        q["status"] = status
    docs = await db.contact_messages.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    return docs


class ContactPatch(BaseModel):
    status: Optional[ContactStatus] = None
    internal_note: Optional[str] = None


@contact_router.put("/{cid}")
@contact_router.patch("/{cid}")
async def patch_contact_message(cid: str, body: ContactPatch, me: dict = Depends(require_admin())):
    db = get_db()
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if body.status == "answered":
        updates["answered_at"] = now_utc().isoformat()
        updates["answered_by"] = me["id"]
    if not updates:
        raise HTTPException(400, "Keine Änderungen.")
    res = await db.contact_messages.update_one({"id": cid}, {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(404, "Nachricht nicht gefunden.")
    return await db.contact_messages.find_one({"id": cid}, {"_id": 0})


@contact_router.delete("/{cid}")
async def delete_contact_message(cid: str, me: dict = Depends(require_admin())):
    db = get_db()
    res = await db.contact_messages.delete_one({"id": cid})
    if res.deleted_count == 0:
        raise HTTPException(404, "Nachricht nicht gefunden.")
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
        "profile_url": f"/u/{user.get('username')}",
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


@board_router.get("")
async def list_board_positions(active_only: bool = False, me=Depends(get_current_user_optional)):
    """Public list. By default returns active+inactive; ?active_only=true filters."""
    db = get_db()
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
        # Resolve display title based on gender
        if u and u.get("gender") == "female" and p.get("title_female"):
            p["display_title"] = p["title_female"]
        else:
            p["display_title"] = p["title_male"]
    return positions


@board_router.post("")
async def create_position(body: BoardPositionCreate, me: dict = Depends(require_admin())):
    db = get_db()
    slug = await unique_slug(db.board_positions, body.slug or body.title_male, fallback="position", max_length=80)
    doc = {
        "id": new_id(), "slug": slug, "is_default": False, "user_id": None, "deputy_user_id": None,
        "created_at": now_utc().isoformat(), **body.model_dump(),
    }
    doc["slug"] = slug
    await db.board_positions.insert_one(doc)
    doc.pop("_id", None)
    return doc


@board_router.put("/{pid}")
@board_router.patch("/{pid}")
async def update_position(pid: str, body: BoardPositionUpdate, me: dict = Depends(require_admin())):
    db = get_db()
    existing = await db.board_positions.find_one({"id": pid}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Position nicht gefunden.")
    updates = body.model_dump(exclude_unset=True)
    slug_source = slug_source_for_update(updates, existing, "title_male", fallback="position")
    if slug_source is not None:
        updates["slug"] = await unique_slug(db.board_positions, slug_source, current_id=pid, fallback="position", max_length=80)
    # Convert "" → None to clear assignments
    for k in ("user_id", "deputy_user_id"):
        if k in updates and updates[k] == "":
            updates[k] = None
        elif k in updates and updates[k]:
            updates[k] = await _normalize_board_assignee(db, updates[k])
    await db.board_positions.update_one({"id": pid}, {"$set": updates})
    return await db.board_positions.find_one({"id": pid}, {"_id": 0})


@board_router.delete("/{pid}")
async def delete_position(pid: str, me: dict = Depends(require_admin())):
    db = get_db()
    p = await db.board_positions.find_one({"id": pid})
    if not p:
        raise HTTPException(404, "Position nicht gefunden.")
    if p.get("is_default"):
        raise HTTPException(400, "Standard-Positionen können nicht gelöscht werden — deaktivieren stattdessen.")
    await db.board_positions.delete_one({"id": pid})
    return {"ok": True}


@board_router.get("/assignable-users")
async def list_assignable_users(me: dict = Depends(require_admin())):
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
