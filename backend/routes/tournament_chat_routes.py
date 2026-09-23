"""Turnier-Chat mit Erwähnungen.
"""
import re
from fastapi import HTTPException, Depends
from pydantic import BaseModel, Field
from database import get_db
from auth import get_current_user
from models import now_utc, new_id
from services.user_notifications import create_user_notification
from services.chat_attachments import MAX_ATTACHMENTS_PER_MESSAGE, chat_message_preview, claim_attachments
from services import word_filter
from routes.tournament_common import (
    STAFF_ROLES,
    TOURNAMENT_MUTATION_LOCKED_DETAIL,
    _get_visible_tournament,
    _is_staff,
    _is_tournament_locked,
    _is_tournament_staff,
    _resolve_tid,
)
from routes.tournament_router import router


MENTION_RE = re.compile(r"@([A-Za-z0-9_.-]{2,32})")


class TournamentChatCreate(BaseModel):
    message: str = Field(default="", max_length=1000)
    attachment_ids: list[str] = Field(default_factory=list, max_length=MAX_ATTACHMENTS_PER_MESSAGE)
    sticker_id: str | None = Field(default=None, max_length=80)


async def _can_use_tournament_chat(tournament: dict, user: dict | None) -> bool:
    if not user:
        return False
    if _is_staff(user) or await _is_tournament_staff(tournament["id"], user):
        return True
    if tournament.get("show_chat") is not True:
        return False
    db = get_db()
    own_registration = await db.tournament_registrations.find_one(
        {
            "tournament_id": tournament["id"],
            "user_id": user["id"],
            "status": {"$in": ["approved", "checked_in"]},
        },
        {"id": 1},
    )
    if own_registration:
        return True
    user_team_ids = [
        row["team_id"] for row in await db.team_members.find(
            {"user_id": user["id"]},
            {"_id": 0, "team_id": 1},
        ).to_list(100)
        if row.get("team_id")
    ]
    if not user_team_ids:
        return False
    team_registration = await db.tournament_registrations.find_one(
        {
            "tournament_id": tournament["id"],
            "team_id": {"$in": user_team_ids},
            "status": {"$in": ["approved", "checked_in"]},
        },
        {"id": 1},
    )
    return bool(team_registration)


def _user_label(user: dict | None) -> str:
    return (user or {}).get("display_name") or (user or {}).get("username") or "Benutzer"


async def _tournament_chat_user_ids(db, tid: str) -> set[str]:
    regs = await db.tournament_registrations.find(
        {"tournament_id": tid, "status": {"$in": ["approved", "checked_in"]}},
        {"_id": 0, "user_id": 1, "team_id": 1},
    ).to_list(1000)
    user_ids = {row.get("user_id") for row in regs if row.get("user_id")}
    team_ids = {row.get("team_id") for row in regs if row.get("team_id")}
    if team_ids:
        teams = await db.teams.find({"id": {"$in": list(team_ids)}}, {"_id": 0, "member_ids": 1}).to_list(500)
        for team in teams:
            user_ids.update(team.get("member_ids") or [])
    staff_rows = await db.tournament_staff_assignments.find(
        {"tournament_id": tid, "is_active": {"$ne": False}},
        {"_id": 0, "user_id": 1},
    ).to_list(500)
    user_ids.update(row.get("user_id") for row in staff_rows if row.get("user_id"))
    return {user_id for user_id in user_ids if user_id}


async def _notify_tournament_mentions(db, tournament: dict, sender: dict, message: dict) -> set[str]:
    handles = {m.lower() for m in MENTION_RE.findall(message.get("message") or "")}
    if not handles:
        return set()
    candidates = await db.users.find(
        {
            "is_active": True,
            "is_banned": {"$ne": True},
            "$or": [{"username": {"$regex": f"^{re.escape(handle)}$", "$options": "i"}} for handle in handles],
        },
        {"_id": 0, "id": 1, "username": 1, "display_name": 1, "role": 1},
    ).to_list(100)
    allowed_ids = await _tournament_chat_user_ids(db, tournament["id"])
    notified_ids: set[str] = set()
    for member in candidates:
        if member.get("id") == sender.get("id"):
            continue
        if member.get("id") not in allowed_ids and member.get("role") not in STAFF_ROLES:
            continue
        await create_user_notification(
            member["id"],
            title=f"Erwähnung im Turnier-Chat: {tournament.get('title')}",
            body=f"{_user_label(sender)} hat dich erwähnt: {(message.get('message') or '')[:140]}",
            url=f"/tournaments/{tournament.get('slug') or tournament['id']}",
            kind="tournament_chat_mention",
            meta={"tournament_id": tournament["id"], "message_id": message["id"]},
        )
        notified_ids.add(member["id"])
    return notified_ids


async def _notify_tournament_chat_message(db, tournament: dict, sender: dict, message: dict, exclude_user_ids: set[str] | None = None) -> None:
    allowed_ids = await _tournament_chat_user_ids(db, tournament["id"])
    excluded = set(exclude_user_ids or set())
    excluded.add(sender.get("id"))
    recipient_ids = [uid for uid in allowed_ids if uid and uid not in excluded]
    if not recipient_ids:
        return
    title = tournament.get("title") or "Turnier"
    for recipient_id in recipient_ids:
        await create_user_notification(
            recipient_id,
            title=f"Neue Turniernachricht: {title}",
            body=f"{_user_label(sender)}: {chat_message_preview(message, 140)}",
            url=f"/tournaments/{tournament.get('slug') or tournament['id']}/chat",
            kind="tournament_chat_message",
            meta={"tournament_id": tournament["id"], "message_id": message["id"]},
        )


@router.get("/{tid}/chat")
async def list_tournament_chat(tid: str, me: dict = Depends(get_current_user)):
    db = get_db()
    tid = await _resolve_tid(tid)
    tournament = await _get_visible_tournament(tid, me)
    if not await _can_use_tournament_chat(tournament, me):
        raise HTTPException(status_code=403, detail="Turnier-Chat ist nur für Teilnehmer und Turnierleitung sichtbar")
    messages = await db.tournament_chat_messages.find(
        {"tournament_id": tid, "deleted_at": {"$exists": False}},
        {"_id": 0},
    ).sort("created_at", -1).to_list(100)
    messages.reverse()
    messages = [word_filter.public_moderation(m) for m in messages if word_filter.visible_to(m, me["id"])]
    user_ids = list({m.get("user_id") for m in messages if m.get("user_id")})
    users = {u["id"]: u for u in await db.users.find(
        {"id": {"$in": user_ids}},
        {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1, "role": 1},
    ).to_list(200)}
    for message in messages:
        author = users.get(message.get("user_id")) or {}
        message["author"] = {
            "id": author.get("id"),
            "username": author.get("username"),
            "display_name": author.get("display_name") or author.get("username") or "Benutzer",
            "avatar_url": author.get("avatar_url"),
            "role": author.get("role"),
        }
    return messages


@router.post("/{tid}/chat")
async def post_tournament_chat(tid: str, body: TournamentChatCreate, me: dict = Depends(get_current_user)):
    db = get_db()
    tid = await _resolve_tid(tid)
    tournament = await _get_visible_tournament(tid, me)
    if _is_tournament_locked(tournament):
        raise HTTPException(status_code=423, detail=TOURNAMENT_MUTATION_LOCKED_DETAIL)
    if not await _can_use_tournament_chat(tournament, me):
        raise HTTPException(status_code=403, detail="Turnier-Chat ist nur für Teilnehmer und Turnierleitung sichtbar")
    text = body.message.strip()
    if not text and not body.attachment_ids and not body.sticker_id:
        raise HTTPException(status_code=400, detail="Nachricht darf nicht leer sein")
    now = now_utc().isoformat()
    message_id = new_id()
    from services.stickers import sticker_for_message
    sticker = await sticker_for_message(db, body.sticker_id, text, body.attachment_ids)
    attachments = await claim_attachments(db, me["id"], body.attachment_ids, {
        "type": "tournament", "tournament_id": tid, "message_id": message_id,
    })
    doc = {
        "id": message_id,
        "tournament_id": tid,
        "user_id": me["id"],
        "message": text,
        "attachments": attachments,
        "sticker": sticker,
        "created_at": now,
        "updated_at": now,
    }
    verdict = await word_filter.screen_message(db, doc, kind="tournament", context={"tournament_id": tid})
    await db.tournament_chat_messages.insert_one(doc)
    if verdict != "hold":
        mentioned_user_ids = await _notify_tournament_mentions(db, tournament, me, doc)
        await _notify_tournament_chat_message(db, tournament, me, doc, mentioned_user_ids)
    try:
        from badges import evaluate_user_progress
        await evaluate_user_progress(me["id"])
    except Exception:
        pass
    doc.pop("_id", None)
    doc = word_filter.public_moderation(doc)
    doc["author"] = {
        "id": me.get("id"),
        "username": me.get("username"),
        "display_name": me.get("display_name") or me.get("username"),
        "avatar_url": me.get("avatar_url"),
        "role": me.get("role"),
    }
    return doc
