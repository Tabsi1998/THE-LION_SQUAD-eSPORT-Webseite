"""Team routes."""
import re
import secrets
from typing import Optional, Literal
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from database import get_db
from auth import get_current_user, get_optional_user, require_admin
from models import TeamCreate, TeamUpdate, now_utc, new_id
from services.notification_preferences import send_user_template
from services.user_notifications import build_public_url, create_user_notification

router = APIRouter(prefix="/api/teams", tags=["teams"])


class TeamSquadCreate(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    description: Optional[str] = None
    tournament_id: Optional[str] = None
    season_id: Optional[str] = None
    game_id: Optional[str] = None
    member_ids: list[str] = Field(default_factory=list)
    status: Literal["active", "archived"] = "active"


class TeamSquadUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=80)
    description: Optional[str] = None
    tournament_id: Optional[str] = None
    season_id: Optional[str] = None
    game_id: Optional[str] = None
    member_ids: Optional[list[str]] = None
    status: Optional[Literal["active", "archived"]] = None


class TeamInviteCreate(BaseModel):
    user_id: str


class TeamChatCreate(BaseModel):
    message: str = Field(min_length=1, max_length=1500)


MENTION_RE = re.compile(r"@([A-Za-z0-9_.-]{2,32})")


def _can_manage(team: dict, user: dict) -> bool:
    return (
        team.get("leader_id") == user["id"]
        or user["id"] in team.get("co_leader_ids", [])
        or user.get("role") in ("moderator", "tournament_admin", "club_admin", "superadmin")
    )


def _is_staff(user: dict | None) -> bool:
    return bool(user and user.get("role") in ("moderator", "tournament_admin", "club_admin", "superadmin"))


def _is_member(team: dict, user: dict | None) -> bool:
    return bool(user and user.get("id") in team.get("member_ids", []))


def _public_user(user: dict | None) -> dict | None:
    if not user:
        return None
    return {
        "id": user.get("id"),
        "username": user.get("username"),
        "display_name": user.get("display_name"),
        "avatar_url": user.get("avatar_url"),
    }


def _user_label(user: dict | None) -> str:
    return (user or {}).get("display_name") or (user or {}).get("username") or "Benutzer"


def _chat_allowed(team: dict, user: dict | None) -> bool:
    return bool(user and (_can_manage(team, user) or _is_member(team, user)))


async def _add_team_member(db, team_id: str, user_id: str, role: str = "member") -> None:
    await db.teams.update_one(
        {"id": team_id},
        {"$addToSet": {"member_ids": user_id}, "$set": {"updated_at": now_utc().isoformat()}},
    )
    await db.team_members.update_one(
        {"team_id": team_id, "user_id": user_id},
        {"$set": {
            "team_id": team_id,
            "user_id": user_id,
            "role": role,
            "joined_at": now_utc().isoformat(),
        }},
        upsert=True,
    )
    try:
        from badges import on_team_joined
        await on_team_joined(user_id, team_id)
    except Exception:
        pass


async def _hydrate_invite(invite: dict) -> dict:
    db = get_db()
    team = await db.teams.find_one(
        {"id": invite.get("team_id")},
        {"_id": 0, "id": 1, "name": 1, "tag": 1, "logo_url": 1},
    )
    inviter = await db.users.find_one(
        {"id": invite.get("invited_by")},
        {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1},
    )
    invite["team"] = team
    invite["inviter"] = _public_user(inviter)
    return invite


async def _hydrate_team(team: dict) -> dict:
    db = get_db()
    members = await db.users.find(
        {"id": {"$in": team.get("member_ids", [])}},
        {"_id": 0, "password_hash": 0, "email": 0},
    ).to_list(100)
    member_order = {uid: idx for idx, uid in enumerate(team.get("member_ids", []))}
    members.sort(key=lambda u: member_order.get(u["id"], 999))
    team["members"] = members
    team["leader"] = await db.users.find_one(
        {"id": team.get("leader_id")},
        {"_id": 0, "password_hash": 0, "email": 0},
    )
    team["squad_count"] = await db.team_squads.count_documents({"team_id": team["id"]})
    return team


async def _enrich_team_chat(messages: list[dict]) -> list[dict]:
    db = get_db()
    user_ids = list({m.get("user_id") for m in messages if m.get("user_id")})
    users = {u["id"]: u for u in await db.users.find(
        {"id": {"$in": user_ids}},
        {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1, "role": 1},
    ).to_list(300)}
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


async def _notify_team_mentions(db, team: dict, sender: dict, message: dict) -> None:
    handles = {m.lower() for m in MENTION_RE.findall(message.get("message") or "")}
    if not handles:
        return
    members = await db.users.find(
        {"id": {"$in": team.get("member_ids") or []}},
        {"_id": 0, "id": 1, "username": 1, "display_name": 1, "email": 1, "notification_preferences": 1, "newsletter_consent": 1},
    ).to_list(500)
    url = await build_public_url(f"/teams/{team['id']}")
    preferences_url = await build_public_url("/profile?tab=privacy")
    for member in members:
        if member.get("id") == sender.get("id"):
            continue
        if (member.get("username") or "").lower() not in handles:
            continue
        await create_user_notification(
            member["id"],
            title=f"Erwähnung im Team-Chat [{team.get('tag')}]",
            body=f"{_user_label(sender)} hat dich erwähnt: {(message.get('message') or '')[:140]}",
            url=f"/teams/{team['id']}",
            kind="team_chat_mention",
            meta={"team_id": team["id"], "message_id": message["id"]},
        )
        await send_user_template(
            member,
            "team_chat_mention",
            display_name=_user_label(member),
            team_name=team.get("name") or team.get("tag") or "Team",
            sender_name=_user_label(sender),
            preview=(message.get("message") or "")[:300],
            url=url,
            preferences_url=preferences_url,
            dedupe_key=f"team_chat_mention:{message['id']}:{member['id']}",
            mail_meta={
                "kind": "team_chat_mention",
                "team_id": team["id"],
                "message_id": message["id"],
                "sender_id": sender.get("id"),
                "user_id": member["id"],
            },
        )


def _team_summary(team: dict) -> dict:
    return {
        "id": team.get("id"),
        "name": team.get("name"),
        "tag": team.get("tag"),
        "description": team.get("description"),
        "logo_url": team.get("logo_url"),
        "discord_link": team.get("discord_link"),
        "is_public": team.get("is_public", True),
        "member_count": len(team.get("member_ids") or []),
        "squad_count": team.get("squad_count", 0),
        "created_at": team.get("created_at"),
        "updated_at": team.get("updated_at"),
    }


def _team_response(team: dict, user: dict | None = None) -> dict:
    can_manage = bool(user and _can_manage(team, user))
    is_member = _is_member(team, user)
    if not is_member and not can_manage:
        out = _team_summary(team)
        out["members"] = [_public_user(m) for m in team.get("members", [])]
        out["leader"] = _public_user(team.get("leader"))
        out["leader_id"] = team.get("leader_id")
        out["co_leader_ids"] = team.get("co_leader_ids", [])
        out["member_ids"] = team.get("member_ids", [])
        out["is_member"] = False
        out["can_manage"] = False
        return out

    team["member_count"] = len(team.get("member_ids") or [])
    team["is_member"] = is_member
    team["can_manage"] = can_manage
    if not can_manage:
        team.pop("join_code", None)
    return team


def _validate_squad_members(team: dict, member_ids: list[str]) -> list[str]:
    allowed = set(team.get("member_ids", []))
    clean = []
    for uid in member_ids or []:
        if uid not in allowed:
            raise HTTPException(status_code=400, detail="Squad-Mitglieder muessen im Team sein")
        if uid not in clean:
            clean.append(uid)
    return clean


@router.get("")
async def list_teams(q: str | None = None):
    db = get_db()
    query = {}
    if q:
        query["$or"] = [
            {"name": {"$regex": q, "$options": "i"}},
            {"tag": {"$regex": q, "$options": "i"}},
        ]
    query["is_public"] = {"$ne": False}
    teams = await db.teams.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [_team_summary(team) for team in teams]


@router.get("/my")
async def my_teams(me: dict = Depends(get_current_user)):
    db = get_db()
    teams = await db.teams.find({"member_ids": me["id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
    for team in teams:
        await _hydrate_team(team)
        team["my_role"] = "leader" if team.get("leader_id") == me["id"] else (
            "co_leader" if me["id"] in team.get("co_leader_ids", []) else "member"
        )
        team["can_manage"] = _can_manage(team, me)
    return teams


@router.get("/invites/my")
async def my_team_invites(me: dict = Depends(get_current_user)):
    db = get_db()
    invites = await db.team_invites.find(
        {"user_id": me["id"], "status": "pending"},
        {"_id": 0},
    ).sort("created_at", -1).to_list(100)
    return [await _hydrate_invite(invite) for invite in invites]


@router.get("/{team_id}")
async def get_team(team_id: str, user: dict | None = Depends(get_optional_user)):
    db = get_db()
    team = await db.teams.find_one({"id": team_id}, {"_id": 0})
    if not team:
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    if team.get("is_public") is False and not (_is_member(team, user) or _is_staff(user)):
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    await _hydrate_team(team)
    return _team_response(team, user)


@router.get("/{team_id}/chat")
async def list_team_chat(team_id: str, me: dict = Depends(get_current_user)):
    db = get_db()
    team = await db.teams.find_one({"id": team_id}, {"_id": 0})
    if not team:
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    if not _chat_allowed(team, me):
        raise HTTPException(status_code=403, detail="Team-Chat ist nur für Teammitglieder sichtbar")
    messages = await db.team_chat_messages.find(
        {"team_id": team_id, "deleted_at": {"$exists": False}},
        {"_id": 0},
    ).sort("created_at", -1).to_list(150)
    messages.reverse()
    return await _enrich_team_chat(messages)


@router.post("/{team_id}/chat")
async def post_team_chat(team_id: str, body: TeamChatCreate, me: dict = Depends(get_current_user)):
    db = get_db()
    team = await db.teams.find_one({"id": team_id}, {"_id": 0})
    if not team:
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    if not _chat_allowed(team, me):
        raise HTTPException(status_code=403, detail="Team-Chat ist nur für Teammitglieder sichtbar")
    text = body.message.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Nachricht darf nicht leer sein")
    now = now_utc().isoformat()
    message = {
        "id": new_id(),
        "team_id": team_id,
        "user_id": me["id"],
        "message": text,
        "created_at": now,
        "updated_at": now,
    }
    await db.team_chat_messages.insert_one(message)
    await _notify_team_mentions(db, team, me, message)
    message.pop("_id", None)
    enriched = await _enrich_team_chat([message])
    return enriched[0]


@router.get("/{team_id}/invite-candidates")
async def invite_candidates(team_id: str, q: str | None = None, me: dict = Depends(get_current_user)):
    db = get_db()
    team = await db.teams.find_one({"id": team_id}, {"_id": 0})
    if not team:
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    if not _can_manage(team, me):
        raise HTTPException(status_code=403, detail="Keine Berechtigung")
    query = {
        "is_active": True,
        "is_banned": {"$ne": True},
        "id": {"$nin": team.get("member_ids") or []},
    }
    if q:
        query["$or"] = [
            {"username": {"$regex": q, "$options": "i"}},
            {"display_name": {"$regex": q, "$options": "i"}},
        ]
    users = await db.users.find(
        query,
        {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1},
    ).sort("display_name", 1).to_list(25)
    pending = await db.team_invites.find(
        {"team_id": team_id, "status": "pending", "user_id": {"$in": [u["id"] for u in users]}},
        {"_id": 0, "user_id": 1},
    ).to_list(100)
    pending_ids = {row["user_id"] for row in pending}
    for user in users:
        user["has_pending_invite"] = user["id"] in pending_ids
    return users


@router.post("/{team_id}/invites")
async def invite_team_member(team_id: str, body: TeamInviteCreate, me: dict = Depends(get_current_user)):
    db = get_db()
    team = await db.teams.find_one({"id": team_id}, {"_id": 0})
    if not team:
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    if not _can_manage(team, me):
        raise HTTPException(status_code=403, detail="Keine Berechtigung")
    if body.user_id in (team.get("member_ids") or []):
        raise HTTPException(status_code=409, detail="Nutzer ist bereits im Team")
    user = await db.users.find_one(
        {"id": body.user_id, "is_active": True, "is_banned": {"$ne": True}},
        {"_id": 0, "id": 1, "username": 1, "display_name": 1},
    )
    if not user:
        raise HTTPException(status_code=404, detail="Nutzer nicht gefunden")
    existing = await db.team_invites.find_one(
        {"team_id": team_id, "user_id": body.user_id, "status": "pending"},
        {"_id": 0},
    )
    if existing:
        return await _hydrate_invite(existing)
    now = now_utc().isoformat()
    invite = {
        "id": new_id(),
        "team_id": team_id,
        "user_id": body.user_id,
        "invited_by": me["id"],
        "status": "pending",
        "created_at": now,
        "updated_at": now,
    }
    await db.team_invites.insert_one(invite)
    await create_user_notification(
        body.user_id,
        title=f"Team-Einladung: {team.get('name')}",
        body=f"{_user_label(me)} hat dich in das Team [{team.get('tag')}] eingeladen.",
        url="/profile?tab=teams",
        kind="team_invite",
        meta={"invite_id": invite["id"], "team_id": team_id},
    )
    invite.pop("_id", None)
    return await _hydrate_invite(invite)


@router.post("/invites/{invite_id}/accept")
async def accept_team_invite(invite_id: str, me: dict = Depends(get_current_user)):
    db = get_db()
    invite = await db.team_invites.find_one({"id": invite_id, "user_id": me["id"], "status": "pending"}, {"_id": 0})
    if not invite:
        raise HTTPException(status_code=404, detail="Einladung nicht gefunden")
    team = await db.teams.find_one({"id": invite["team_id"]}, {"_id": 0})
    if not team:
        await db.team_invites.update_one({"id": invite_id}, {"$set": {"status": "cancelled", "updated_at": now_utc().isoformat()}})
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    if me["id"] not in (team.get("member_ids") or []):
        await _add_team_member(db, team["id"], me["id"])
    await db.team_invites.update_one(
        {"id": invite_id},
        {"$set": {"status": "accepted", "acted_at": now_utc().isoformat(), "updated_at": now_utc().isoformat()}},
    )
    await db.notifications.update_many(
        {"user_id": me["id"], "meta.invite_id": invite_id},
        {"$set": {"read": True}},
    )
    notify_ids = list({invite.get("invited_by"), team.get("leader_id")} - {None, me["id"]})
    for uid in notify_ids:
        await create_user_notification(
            uid,
            title=f"{_user_label(me)} ist [{team.get('tag')}] beigetreten",
            body=f"Die Team-Einladung für {team.get('name')} wurde angenommen.",
            url=f"/teams/{team['id']}",
            kind="team_invite_accepted",
            meta={"invite_id": invite_id, "team_id": team["id"]},
        )
    return {"ok": True}


@router.post("/invites/{invite_id}/decline")
async def decline_team_invite(invite_id: str, me: dict = Depends(get_current_user)):
    db = get_db()
    invite = await db.team_invites.find_one({"id": invite_id, "user_id": me["id"], "status": "pending"}, {"_id": 0})
    if not invite:
        raise HTTPException(status_code=404, detail="Einladung nicht gefunden")
    await db.team_invites.update_one(
        {"id": invite_id},
        {"$set": {"status": "declined", "acted_at": now_utc().isoformat(), "updated_at": now_utc().isoformat()}},
    )
    await db.notifications.update_many(
        {"user_id": me["id"], "meta.invite_id": invite_id},
        {"$set": {"read": True}},
    )
    return {"ok": True}


@router.post("")
async def create_team(body: TeamCreate, me: dict = Depends(get_current_user)):
    db = get_db()
    if await db.teams.find_one({"tag": body.tag}):
        raise HTTPException(status_code=409, detail="Team-Tag bereits vergeben")
    team_id = new_id()
    doc = {
        "id": team_id,
        "name": body.name,
        "tag": body.tag,
        "description": body.description,
        "logo_url": body.logo_url,
        "discord_link": body.discord_link,
        "social_links": {},
        "leader_id": me["id"],
        "co_leader_ids": [],
        "member_ids": [me["id"]],
        "join_code": secrets.token_urlsafe(6),
        "is_public": True,
        "created_at": now_utc().isoformat(),
        "updated_at": now_utc().isoformat(),
    }
    await db.teams.insert_one(doc)
    await db.team_members.update_one(
        {"team_id": team_id, "user_id": me["id"]},
        {"$set": {
            "team_id": team_id,
            "user_id": me["id"],
            "role": "leader",
            "joined_at": now_utc().isoformat(),
        }},
        upsert=True,
    )
    doc.pop("_id", None)
    try:
        from badges import on_team_created
        await on_team_created(me["id"], team_id)
    except Exception:
        pass
    return doc


@router.put("/{team_id}")
@router.patch("/{team_id}")
async def update_team(team_id: str, body: TeamUpdate, me: dict = Depends(get_current_user)):
    db = get_db()
    team = await db.teams.find_one({"id": team_id})
    if not team:
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    if team["leader_id"] != me["id"] and me["id"] not in team.get("co_leader_ids", []):
        if me["role"] not in ("moderator", "tournament_admin", "club_admin", "superadmin"):
            raise HTTPException(status_code=403, detail="Keine Berechtigung")
    if body.tag and body.tag != team.get("tag") and await db.teams.find_one({"tag": body.tag}):
        raise HTTPException(status_code=409, detail="Team-Tag bereits vergeben")
    nullable_fields = {"description", "logo_url", "discord_link", "social_links"}
    raw = body.model_dump(exclude_unset=True)
    updates = {k: v for k, v in raw.items() if v is not None or k in nullable_fields}
    updates["updated_at"] = now_utc().isoformat()
    await db.teams.update_one({"id": team_id}, {"$set": updates})
    team = await db.teams.find_one({"id": team_id}, {"_id": 0})
    return team


@router.post("/{team_id}/join")
async def join_team(team_id: str, body: dict, me: dict = Depends(get_current_user)):
    db = get_db()
    team = await db.teams.find_one({"id": team_id})
    if not team:
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    if body.get("join_code") != team.get("join_code"):
        raise HTTPException(status_code=403, detail="Falscher Join-Code")
    if me["id"] in team.get("member_ids", []):
        return {"ok": True, "already_member": True}
    await db.teams.update_one({"id": team_id}, {"$addToSet": {"member_ids": me["id"]}})
    await db.team_members.update_one(
        {"team_id": team_id, "user_id": me["id"]},
        {"$set": {
            "team_id": team_id,
            "user_id": me["id"],
            "role": "member",
            "joined_at": now_utc().isoformat(),
        }},
        upsert=True,
    )
    try:
        from badges import on_team_joined
        await on_team_joined(me["id"], team_id)
    except Exception:
        pass
    return {"ok": True}


@router.post("/{team_id}/leave")
async def leave_team(team_id: str, me: dict = Depends(get_current_user)):
    db = get_db()
    team = await db.teams.find_one({"id": team_id})
    if not team:
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    if team["leader_id"] == me["id"]:
        raise HTTPException(status_code=400, detail="Leader kann Team nicht verlassen")
    await db.teams.update_one({"id": team_id}, {"$pull": {"member_ids": me["id"], "co_leader_ids": me["id"]}})
    await db.team_members.delete_one({"team_id": team_id, "user_id": me["id"]})
    return {"ok": True}


def _is_team_leader(team: dict, user_id: str) -> bool:
    return team.get("leader_id") == user_id


def _can_manage_team(team: dict, user: dict) -> bool:
    return (
        _is_team_leader(team, user["id"])
        or user["id"] in (team.get("co_leader_ids") or [])
        or user.get("role") in ("club_admin", "superadmin")
    )


@router.delete("/{team_id}/members/{user_id}")
async def kick_member(team_id: str, user_id: str, me: dict = Depends(get_current_user)):
    """Leader/co-leader/admin can kick a member from a team. Leaders cannot be kicked."""
    db = get_db()
    team = await db.teams.find_one({"id": team_id})
    if not team:
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    if not _can_manage_team(team, me):
        raise HTTPException(status_code=403, detail="Keine Berechtigung das Team zu verwalten")
    if team.get("leader_id") == user_id:
        raise HTTPException(status_code=400, detail="Leader kann nicht gekickt werden — bitte Leader-Übergabe zuerst durchführen")
    if user_id == me["id"]:
        raise HTTPException(status_code=400, detail="Du kannst dich nicht selbst kicken — nutze 'Verlassen'")
    if user_id not in (team.get("member_ids") or []):
        raise HTTPException(status_code=404, detail="Mitglied nicht im Team")
    await db.teams.update_one(
        {"id": team_id},
        {"$pull": {"member_ids": user_id, "co_leader_ids": user_id}, "$set": {"updated_at": now_utc().isoformat()}},
    )
    await db.team_members.delete_many({"team_id": team_id, "user_id": user_id})
    await db.audit_logs.insert_one({
        "id": new_id(), "action": "team.kick", "target_id": team_id,
        "actor_id": me["id"], "data": {"kicked_user_id": user_id},
        "created_at": now_utc().isoformat(),
    })
    return {"ok": True}


@router.post("/{team_id}/members/{user_id}/role")
async def set_member_role(team_id: str, user_id: str, body: dict, me: dict = Depends(get_current_user)):
    """Set member role: 'member' (demote co-leader) or 'co_leader' (promote member).
    Only the team leader or admin can change roles."""
    role = (body.get("role") or "").strip().lower()
    if role not in ("member", "co_leader"):
        raise HTTPException(status_code=400, detail="Ungültige Rolle. Erlaubt: member, co_leader")
    db = get_db()
    team = await db.teams.find_one({"id": team_id})
    if not team:
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    if not (_is_team_leader(team, me["id"]) or me.get("role") in ("club_admin", "superadmin")):
        raise HTTPException(status_code=403, detail="Nur der Leader kann Rollen ändern")
    if user_id not in (team.get("member_ids") or []):
        raise HTTPException(status_code=404, detail="Mitglied nicht im Team")
    if team.get("leader_id") == user_id:
        raise HTTPException(status_code=400, detail="Leader hat bereits die höchste Rolle")
    if role == "co_leader":
        await db.teams.update_one(
            {"id": team_id}, {"$addToSet": {"co_leader_ids": user_id}, "$set": {"updated_at": now_utc().isoformat()}},
        )
    else:
        await db.teams.update_one(
            {"id": team_id}, {"$pull": {"co_leader_ids": user_id}, "$set": {"updated_at": now_utc().isoformat()}},
        )
    await db.team_members.update_one(
        {"team_id": team_id, "user_id": user_id},
        {"$set": {"role": role, "updated_at": now_utc().isoformat()}},
        upsert=True,
    )
    await create_user_notification(
        user_id,
        title=f"Teamrolle aktualisiert: [{team.get('tag')}]",
        body=f"Deine Rolle in {team.get('name')} ist jetzt {('Co-Leader' if role == 'co_leader' else 'Mitglied')}.",
        url=f"/teams/{team_id}",
        kind="team_role_changed",
        meta={"team_id": team_id, "role": role},
    )
    await db.audit_logs.insert_one({
        "id": new_id(), "action": "team.role_change", "target_id": team_id,
        "actor_id": me["id"], "data": {"user_id": user_id, "role": role},
        "created_at": now_utc().isoformat(),
    })
    return {"ok": True, "role": role}


@router.post("/{team_id}/transfer-leader")
async def transfer_leader(team_id: str, body: dict, me: dict = Depends(get_current_user)):
    """Hand over leadership to another team member. Old leader becomes co_leader by default."""
    new_leader_id = body.get("new_leader_id") or body.get("user_id")
    if not new_leader_id:
        raise HTTPException(status_code=400, detail="new_leader_id ist erforderlich")
    db = get_db()
    team = await db.teams.find_one({"id": team_id})
    if not team:
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    if not (_is_team_leader(team, me["id"]) or me.get("role") in ("club_admin", "superadmin")):
        raise HTTPException(status_code=403, detail="Nur der Leader (oder Admin) kann übertragen")
    if new_leader_id not in (team.get("member_ids") or []):
        raise HTTPException(status_code=404, detail="Empfänger ist kein Team-Mitglied")
    if new_leader_id == team.get("leader_id"):
        raise HTTPException(status_code=400, detail="Empfänger ist bereits Leader")
    old_leader = team.get("leader_id")
    await db.teams.update_one({"id": team_id}, {
        "$set": {"leader_id": new_leader_id, "updated_at": now_utc().isoformat()},
        # New leader cannot be a co-leader of themselves; old leader becomes co-leader
        "$pull": {"co_leader_ids": new_leader_id},
    })
    if old_leader:
        await db.teams.update_one({"id": team_id}, {"$addToSet": {"co_leader_ids": old_leader}})
        await db.team_members.update_one(
            {"team_id": team_id, "user_id": old_leader},
            {"$set": {"role": "co_leader", "updated_at": now_utc().isoformat()}},
            upsert=True,
        )
    await db.team_members.update_one(
        {"team_id": team_id, "user_id": new_leader_id},
        {"$set": {"role": "leader", "updated_at": now_utc().isoformat()}},
        upsert=True,
    )
    await create_user_notification(
        new_leader_id,
        title=f"Du bist jetzt Team-Leader: [{team.get('tag')}]",
        body=f"Die Leitung von {team.get('name')} wurde an dich übertragen.",
        url=f"/teams/{team_id}",
        kind="team_leader_transferred",
        meta={"team_id": team_id, "old_leader": old_leader},
    )
    await db.audit_logs.insert_one({
        "id": new_id(), "action": "team.transfer_leader", "target_id": team_id,
        "actor_id": me["id"], "data": {"old_leader": old_leader, "new_leader": new_leader_id},
        "created_at": now_utc().isoformat(),
    })
    fresh = await db.teams.find_one({"id": team_id}, {"_id": 0})
    return fresh


@router.delete("/{team_id}")
async def delete_team(team_id: str, me: dict = Depends(get_current_user)):
    db = get_db()
    team = await db.teams.find_one({"id": team_id})
    if not team:
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    if team["leader_id"] != me["id"] and me["role"] not in ("club_admin", "superadmin"):
        raise HTTPException(status_code=403, detail="Keine Berechtigung")
    await db.teams.delete_one({"id": team_id})
    await db.team_members.delete_many({"team_id": team_id})
    await db.team_squads.delete_many({"team_id": team_id})
    return {"ok": True}


@router.get("/{team_id}/squads")
async def list_squads(team_id: str, me: dict = Depends(get_current_user)):
    db = get_db()
    team = await db.teams.find_one({"id": team_id}, {"_id": 0})
    if not team:
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    if me["id"] not in team.get("member_ids", []) and not _can_manage(team, me):
        raise HTTPException(status_code=403, detail="Keine Berechtigung")
    squads = await db.team_squads.find({"team_id": team_id}, {"_id": 0}).sort("created_at", -1).to_list(200)
    member_map = {u["id"]: u for u in await db.users.find(
        {"id": {"$in": list({uid for s in squads for uid in s.get("member_ids", [])})}},
        {"_id": 0, "password_hash": 0, "email": 0},
    ).to_list(500)}
    for squad in squads:
        squad["members"] = [member_map[uid] for uid in squad.get("member_ids", []) if uid in member_map]
    return squads


@router.post("/{team_id}/squads")
async def create_squad(team_id: str, body: TeamSquadCreate, me: dict = Depends(get_current_user)):
    db = get_db()
    team = await db.teams.find_one({"id": team_id}, {"_id": 0})
    if not team:
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    if not _can_manage(team, me):
        raise HTTPException(status_code=403, detail="Keine Berechtigung")
    doc = body.model_dump()
    doc["member_ids"] = _validate_squad_members(team, doc.get("member_ids") or [])
    doc.update({
        "id": new_id(),
        "team_id": team_id,
        "created_by": me["id"],
        "created_at": now_utc().isoformat(),
        "updated_at": now_utc().isoformat(),
    })
    await db.team_squads.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.put("/{team_id}/squads/{squad_id}")
@router.patch("/{team_id}/squads/{squad_id}")
async def update_squad(team_id: str, squad_id: str, body: TeamSquadUpdate, me: dict = Depends(get_current_user)):
    db = get_db()
    team = await db.teams.find_one({"id": team_id}, {"_id": 0})
    if not team:
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    if not _can_manage(team, me):
        raise HTTPException(status_code=403, detail="Keine Berechtigung")
    nullable_fields = {"description", "tournament_id", "season_id", "game_id", "member_ids"}
    raw = body.model_dump(exclude_unset=True)
    updates = {k: v for k, v in raw.items() if v is not None or k in nullable_fields}
    if "member_ids" in updates:
        updates["member_ids"] = _validate_squad_members(team, updates.get("member_ids") or [])
    updates["updated_at"] = now_utc().isoformat()
    res = await db.team_squads.update_one({"id": squad_id, "team_id": team_id}, {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Squad nicht gefunden")
    return await db.team_squads.find_one({"id": squad_id}, {"_id": 0})


@router.delete("/{team_id}/squads/{squad_id}")
async def delete_squad(team_id: str, squad_id: str, me: dict = Depends(get_current_user)):
    db = get_db()
    team = await db.teams.find_one({"id": team_id}, {"_id": 0})
    if not team:
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    if not _can_manage(team, me):
        raise HTTPException(status_code=403, detail="Keine Berechtigung")
    res = await db.team_squads.delete_one({"id": squad_id, "team_id": team_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Squad nicht gefunden")
    return {"ok": True}
