"""Phase E + F + Discord-Counter — Bundled routes.

Endpoints:
  GET  /api/streams/live                            — public list of live streams
  POST /api/admin/streams/refresh                   — admin force-poll Twitch

  GET  /api/pages/{slug}                            — public CMS page
  GET  /api/admin/pages                             — admin list
  POST /api/admin/pages                             — create
  PATCH /api/admin/pages/{slug}                     — update
  DELETE /api/admin/pages/{slug}                    — delete (only admin-created)

  GET  /api/admin/email-templates                   — list templates
  PATCH /api/admin/email-templates/{key}            — update template

  POST /api/admin/discord/counter/{user_id}         — bump discord_messages_count (+N)
  GET  /api/admin/discord/counters                  — list users with counter
"""
import html as html_lib
import re
from typing import Optional, Literal
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field

from database import get_db
from auth import get_current_user, require_admin, require_area
from models import now_utc, new_id
from services.content_embed_service import resolve_content_embeds
from services.permissions import user_has_area
from services.slug_utils import unique_slug
from services.stream_visibility import homepage_visibility, reason_text


# ============= Streams (public + admin) =============
streams_router = APIRouter(prefix="/api/streams", tags=["streams"])


@streams_router.get("/live")
async def list_live_streams():
    # Startseiten-Slider: nur aktive Vereinsmitglieder mit verknüpftem
    # Mitgliederprofil. Die Regel steht in services/stream_visibility.py; der
    # Admin zeigt mit derselben Regel, woran ein Kanal scheitert.
    db = get_db()
    streams = await db.live_streams.find({}, {"_id": 0}).sort("viewer_count", -1).to_list(50)
    verdicts = await homepage_visibility(db, [stream.get("user_id") for stream in streams])
    linked_streams = []
    for stream in streams:
        verdict = verdicts.get(stream.get("user_id"))
        if not verdict or not verdict["visible"]:
            continue
        stream["member_profile"] = verdict["member_profile"]
        stream["public_profile_url"] = verdict["public_profile_url"]
        linked_streams.append(stream)
    return linked_streams


admin_streams_router = APIRouter(prefix="/api/admin/streams", tags=["streams-admin"])


@admin_streams_router.post("/refresh")
async def admin_streams_refresh(me: dict = Depends(require_area("content"))):
    from services.twitch_service import fetch_live_streams
    return await fetch_live_streams()


@admin_streams_router.get("/status")
async def admin_streams_status(me: dict = Depends(require_area("content"))):
    db = get_db()
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0}) or {}
    token = await db.settings.find_one({"id": "twitch_app_token"}, {"_id": 0}) or {}
    twitch_user_query = {
        "$or": [
            {"twitch_handle": {"$nin": [None, ""]}},
            {"twitch_channel": {"$nin": [None, ""]}},
        ]
    }
    checked_users = await db.users.count_documents(twitch_user_query)
    live_streams = await db.live_streams.find({}, {"_id": 0}).sort("viewer_count", -1).limit(10).to_list(10)

    # Je Kanal: käme er auf die Startseite, und wenn nein, warum nicht (#310).
    # Mitgliedschaft und Kontostatus sind Vereinsdaten - den genauen Grund
    # sieht nur, wer die Vereinsverwaltung hat.
    from services.secret_store import decrypt_secret
    from services.twitch_service import poll_state

    detailed = await user_has_area(me, "club")
    twitch_users = await db.users.find(
        twitch_user_query,
        {"_id": 0, "id": 1, "username": 1, "display_name": 1, "twitch_handle": 1, "twitch_channel": 1},
    ).sort("username", 1).to_list(200)
    verdicts = await homepage_visibility(db, [user["id"] for user in twitch_users])
    live_user_ids = {
        stream.get("user_id")
        for stream in await db.live_streams.find({}, {"_id": 0, "user_id": 1}).to_list(500)
    }
    channels = []
    for user in twitch_users:
        verdict = verdicts.get(user["id"]) or {"visible": False, "reason": "account_inactive"}
        channels.append({
            "user_id": user["id"],
            "username": user.get("username"),
            "display_name": user.get("display_name"),
            "twitch_login": (user.get("twitch_handle") or user.get("twitch_channel") or "").strip().lstrip("@").lower(),
            "is_live": user["id"] in live_user_ids,
            "homepage_visible": verdict["visible"],
            "reason": verdict["reason"] if detailed or verdict["visible"] else "restricted",
            "reason_text": reason_text(verdict["reason"], detailed=detailed),
        })
    try:
        decrypt_secret(branding.get("twitch_client_secret"))
        secret_readable = True
    except RuntimeError:
        secret_readable = False
    latest_session = await db.twitch_stream_sessions.find_one(
        {},
        {"_id": 0, "last_seen_at": 1, "started_at": 1, "ended_at": 1, "twitch_login": 1},
        sort=[("last_seen_at", -1)],
    )
    return {
        "configured": bool(branding.get("twitch_client_id") and branding.get("twitch_client_secret")),
        "enabled": bool(branding.get("twitch_live_detection", True)),
        "client_id_configured": bool(branding.get("twitch_client_id")),
        "client_secret_configured": bool(branding.get("twitch_client_secret")),
        "client_secret_masked": "********" if branding.get("twitch_client_secret") else "",
        "client_secret_readable": secret_readable,
        "poll": await poll_state(),
        "channels": channels,
        "channels_visible": sum(1 for channel in channels if channel["homepage_visible"]),
        "channels_detailed": detailed,
        "channel": branding.get("twitch_channel"),
        "checked_users": checked_users,
        "live_count": len(live_streams),
        "live_streams": live_streams,
        "latest_session": latest_session,
        "token_expires_at": token.get("expires_at"),
    }


# ============= Pages CMS =============
# ============= Email Templates =============
admin_emailt_router = APIRouter(prefix="/api/admin/email-templates", tags=["cms-admin"])

DEFAULT_EMAIL_TEMPLATES = [
    {"key": "membership_approve", "name": "Mitgliedschaft akzeptiert",
     "subject": "Willkommen im Rudel 🦁",
     "html": "<p>Hallo {{display_name}},</p><p>Deine Bewerbung wurde <strong>angenommen</strong>. Willkommen im Rudel!</p><p>{{note}}</p>",
     "vars": ["display_name", "note"]},
    {"key": "membership_reject", "name": "Mitgliedschaft abgelehnt",
     "subject": "Mitgliedsbewerbung abgelehnt",
     "html": "<p>Hallo {{display_name}},</p><p>Deine Bewerbung wurde derzeit nicht angenommen.</p><p>{{note}}</p>",
     "vars": ["display_name", "note"]},
    {"key": "contact_auto_reply", "name": "Kontakt-Auto-Reply",
     "subject": "Wir haben deine Nachricht erhalten",
     "html": "<p>Hallo {{name}},</p><p>Vielen Dank für deine Nachricht zum Thema <strong>{{topic}}</strong>. Wir melden uns zeitnah.</p>",
     "vars": ["name", "topic"]},
    {"key": "membership_application_admin", "name": "Neue Bewerbung (Admin-Notify)",
     "subject": "Neue Mitgliedsbewerbung",
     "html": "<p>{{applicant}} hat eine Mitgliedsbewerbung eingereicht. Bitte im Admin-Bereich prüfen.</p>",
     "vars": ["applicant"]},
    # Verwarnungen mit Stufen (#416): was gilt, warum, und der Weg zum Einspruch.
    {"key": "moderation_notice", "name": "Moderation: Hinweis",
     "subject": "Hinweis der Moderation",
     "html": "<p>Hallo {{display_name}},</p><p>die Moderation hat einen Vorfall festgehalten: <strong>{{reason}}</strong>.</p><p>Das ist ein Hinweis – es gilt keine Einschränkung. Beim nächsten Vorfall folgt die nächste Stufe (Verwarnung mit Chat-Sperre).</p><p>Einspruch: unter „Meine Strafen“ auf der Website ({{appeal_url}}).</p>",
     "vars": ["display_name", "reason", "appeal_url"]},
    {"key": "moderation_warning", "name": "Moderation: Verwarnung mit Chat-Sperre",
     "subject": "Verwarnung – Chat vorübergehend gesperrt",
     "html": "<p>Hallo {{display_name}},</p><p>du bist verwarnt: <strong>{{reason}}</strong>.</p><p>Dein Chat (Direktnachrichten, Team-, Turnier- und Match-Chat, Anhänge) ist gesperrt bis <strong>{{until}}</strong>.</p><p>Einspruch: unter „Meine Strafen“ auf der Website ({{appeal_url}}).</p>",
     "vars": ["display_name", "reason", "until", "appeal_url"]},
    {"key": "moderation_suspension", "name": "Moderation: Sperre bis zur Entscheidung",
     "subject": "Konto gesperrt – bis zur Entscheidung der Moderation",
     "html": "<p>Hallo {{display_name}},</p><p>dein Konto ist gesperrt: <strong>{{reason}}</strong>.</p><p>Schreiben ist nicht möglich, bis die Moderation entschieden hat. Du kannst dich weiter anmelden und unter „Meine Strafen“ Einspruch einlegen ({{appeal_url}}).</p>",
     "vars": ["display_name", "reason", "appeal_url"]},
    {"key": "moderation_lifted", "name": "Moderation: Maßnahme aufgehoben",
     "subject": "Maßnahme der Moderation aufgehoben",
     "html": "<p>Hallo {{display_name}},</p><p>die Maßnahme ({{reason}}) ist aufgehoben. {{note}}</p>",
     "vars": ["display_name", "reason", "note"]},
]


async def seed_email_templates():
    db = get_db()
    for t in DEFAULT_EMAIL_TEMPLATES:
        await db.email_templates.update_one(
            {"key": t["key"]},
            {"$setOnInsert": {**t, "id": t["key"], "created_at": now_utc().isoformat(),
                              "updated_at": now_utc().isoformat()}},
            upsert=True,
        )


class TemplatePatch(BaseModel):
    subject: Optional[str] = None
    html: Optional[str] = None
    name: Optional[str] = None


class TemplateDraft(BaseModel):
    subject: Optional[str] = None
    html: Optional[str] = None


@admin_emailt_router.get("")
async def admin_list_templates(me: dict = Depends(require_area("system"))):
    """Alle Mails der Website (#437 A): Zweck, Empfänger, Variablen, Standard oder angepasst."""
    from services.mail_catalog import list_templates
    return await list_templates(get_db(), DEFAULT_EMAIL_TEMPLATES)


@admin_emailt_router.put("/{key}")
@admin_emailt_router.patch("/{key}")
async def admin_patch_template(key: str, body: TemplatePatch, me: dict = Depends(require_area("system"))):
    from services.mail_catalog import save_override
    raw = body.model_dump(exclude_unset=True)
    if not raw:
        raise HTTPException(400, "Keine Änderungen.")
    try:
        return await save_override(get_db(), key, DEFAULT_EMAIL_TEMPLATES, subject=raw.get("subject"), html=raw.get("html"), name=raw.get("name"), actor_id=me.get("id"))
    except ValueError as exc:
        raise HTTPException(404, str(exc))


@admin_emailt_router.post("/{key}/preview")
async def admin_preview_template(key: str, body: TemplateDraft, me: dict = Depends(require_area("system"))):
    """Vorschau mit Beispieldaten - eines ungespeicherten Entwurfs oder des geltenden Stands."""
    from services.mail_catalog import CATALOG, render
    if key not in CATALOG:
        raise HTTPException(404, "Diese Vorlage gibt es nicht.")
    return await render(get_db(), key, subject=body.subject, html=body.html)


@admin_emailt_router.post("/{key}/test")
async def admin_test_template(key: str, body: TemplateDraft, me: dict = Depends(require_area("system"))):
    """Testmail mit Beispieldaten an die eigene Adresse - über die Mail-Queue wie jede andere Mail."""
    from services.mail_catalog import CATALOG, render
    from services.mail_queue import enqueue_mail
    if key not in CATALOG:
        raise HTTPException(404, "Diese Vorlage gibt es nicht.")
    if not me.get("email"):
        raise HTTPException(400, "Dein Konto hat keine E-Mail-Adresse.")
    rendered = await render(get_db(), key, subject=body.subject, html=body.html)
    await enqueue_mail(me["email"], rendered["subject"] or f"Test: {key}", rendered["html"], template_key=key, meta={"test": True, "actor_id": me.get("id")})
    return {"ok": True, "to": me["email"]}


@admin_emailt_router.post("/{key}/reset")
async def admin_reset_template(key: str, me: dict = Depends(require_area("system"))):
    from services.mail_catalog import reset_template
    try:
        return await reset_template(get_db(), key, DEFAULT_EMAIL_TEMPLATES)
    except ValueError as exc:
        raise HTTPException(404, str(exc))


async def render_template(key: str, vars_: dict, fallback_subject: str = "", fallback_html: str = "") -> tuple[str, str]:
    """Helper used by mail_queue/phase_c to substitute {{var}} placeholders."""
    db = get_db()
    t = await db.email_templates.find_one({"key": key}, {"_id": 0})
    subj = (t and t.get("subject")) or fallback_subject
    html = (t and t.get("html")) or fallback_html
    for k, v in (vars_ or {}).items():
        v_str = "" if v is None else str(v)
        subject_v = v_str.replace("\r", " ").replace("\n", " ")
        safe_v = html_lib.escape(v_str, quote=True)
        subj = subj.replace("{{" + k + "}}", subject_v)
        html = html.replace("{{" + k + "}}", safe_v)
    return subj, html


# ============= Discord Counter (manual mods +1) =============
admin_discord_router = APIRouter(prefix="/api/admin/discord", tags=["discord"])


class CounterBody(BaseModel):
    delta: int = Field(default=1, ge=-1000, le=10000)


class CounterSetBody(BaseModel):
    total: int = Field(default=0, ge=0, le=1000000)


async def _evaluate_discord_counter(user_id: str):
    try:
        from badges import evaluate_user_progress
        await evaluate_user_progress(user_id)
    except Exception:
        pass


async def _discord_counter_projection(db, user_id: str):
    return await db.users.find_one(
        {"id": user_id},
        {
            "_id": 0,
            "id": 1,
            "username": 1,
            "display_name": 1,
            "email": 1,
            "avatar_url": 1,
            "discord_name": 1,
            "discord_messages_count": 1,
        },
    )


@admin_discord_router.post("/counter/{user_id}")
async def admin_bump_counter(user_id: str, body: CounterBody, me: dict = Depends(require_area("club"))):
    db = get_db()
    if not await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1}):
        raise HTTPException(404, "Nutzer nicht gefunden.")
    res = await db.users.find_one_and_update(
        {"id": user_id},
        {"$inc": {"discord_messages_count": body.delta}},
        return_document=True,
        projection={"_id": 0, "id": 1, "discord_messages_count": 1, "username": 1},
    )
    if int(res.get("discord_messages_count") or 0) < 0:
        await db.users.update_one({"id": user_id}, {"$set": {"discord_messages_count": 0}})
        res["discord_messages_count"] = 0
    await _evaluate_discord_counter(user_id)
    await db.audit_logs.insert_one({
        "id": new_id(),
        "action": "discord.counter_bump",
        "actor_id": me["id"], "target_id": user_id,
        "data": {"delta": body.delta, "new_total": res.get("discord_messages_count")},
        "created_at": now_utc().isoformat(),
    })
    return await _discord_counter_projection(db, user_id) or res


@admin_discord_router.put("/counter/{user_id}")
async def admin_set_counter(user_id: str, body: CounterSetBody, me: dict = Depends(require_area("club"))):
    db = get_db()
    if not await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1}):
        raise HTTPException(404, "Nutzer nicht gefunden.")
    await db.users.update_one(
        {"id": user_id},
        {"$set": {"discord_messages_count": body.total, "updated_at": now_utc().isoformat()}},
    )
    await _evaluate_discord_counter(user_id)
    await db.audit_logs.insert_one({
        "id": new_id(),
        "action": "discord.counter_set",
        "actor_id": me["id"], "target_id": user_id,
        "data": {"total": body.total},
        "created_at": now_utc().isoformat(),
    })
    return await _discord_counter_projection(db, user_id)


@admin_discord_router.get("/counters")
async def admin_list_counters(q: str = "", limit: int = 100, me: dict = Depends(require_area("club"))):
    db = get_db()
    safe_limit = max(1, min(limit, 500))
    query: dict = {"discord_messages_count": {"$gt": 0}}
    if q.strip():
        rx = {"$regex": re.escape(q.strip()[:80]), "$options": "i"}
        query = {"$or": [{"username": rx}, {"display_name": rx}, {"email": rx}, {"discord_name": rx}]}
    users = await db.users.find(
        query,
        {
            "_id": 0,
            "id": 1,
            "username": 1,
            "display_name": 1,
            "email": 1,
            "avatar_url": 1,
            "discord_name": 1,
            "discord_messages_count": 1,
        },
    ).sort("discord_messages_count", -1).to_list(safe_limit)
    return users
