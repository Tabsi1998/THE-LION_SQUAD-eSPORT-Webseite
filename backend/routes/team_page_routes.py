"""Team-Seite (#1191): Termine, letzte Spiele und Einladungs-Link mit QR-Code.

- ``GET  /api/teams/{id}/overview``            „Angemeldet für“ und „Letzte Spiele“ - für alle, die das Team sehen dürfen
- ``GET  /api/teams/{id}/invite-link``         der aktuelle Link (wird beim ersten Mal angelegt) - Kapitän und Co-Kapitän
- ``POST /api/teams/{id}/invite-link``         neuer Link, der alte gilt nicht mehr
- ``GET  /api/teams/{id}/invite-link/check``   gilt dieser Schlüssel? Mit Kurzinfo zum Team - auch für private Teams
- ``POST /api/teams/{id}/join-link``           mit gültigem Schlüssel beitreten (nur noch „Beitreten“ tippen)
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import get_current_user, get_optional_user
from database import get_db
from models import new_id, now_utc
from routes.team_routes import _add_team_member, _can_manage, _is_member, _is_staff, _user_label
from services import team_page
from services.user_notifications import build_public_url, create_user_notification

router = APIRouter(prefix="/api/teams", tags=["teams"])

INVITE_GONE = "Dieser Einladungs-Link gilt nicht mehr. Frag im Team nach einem neuen Link oder gib den Join-Code ein."


class JoinLinkBody(BaseModel):
    token: str = Field(min_length=4, max_length=120)


async def _team_or_404(db, team_id: str) -> dict:
    team = await db.teams.find_one({"id": team_id}, {"_id": 0})
    if not team:
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    return team


def _insider(team: dict, user: dict | None) -> bool:
    return bool(user and (_is_member(team, user) or _can_manage(team, user) or _is_staff(user)))


def _team_card(team: dict) -> dict:
    return {
        "id": team.get("id"),
        "name": team.get("name"),
        "tag": team.get("tag"),
        "logo_url": team.get("logo_url"),
        "description": team.get("description"),
        "is_public": team.get("is_public", True),
        "member_count": len(team.get("member_ids") or []),
    }


async def _invite_payload(row: dict) -> dict:
    return {
        "token": row["token"],
        "url": await build_public_url(team_page.invite_path(row["team_id"], row["token"])),
        "created_at": row.get("created_at"),
    }


@router.get("/{team_id}/overview")
async def team_overview(team_id: str, user: dict | None = Depends(get_optional_user)):
    db = get_db()
    team = await _team_or_404(db, team_id)
    insider = _insider(team, user)
    if team.get("is_public") is False and not insider:
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    return await team_page.team_overview(db, team, user, insider=insider)


@router.get("/{team_id}/invite-link")
async def get_invite_link(team_id: str, me: dict = Depends(get_current_user)):
    db = get_db()
    team = await _team_or_404(db, team_id)
    if not _can_manage(team, me):
        raise HTTPException(status_code=403, detail="Einladen dürfen Kapitän und Co-Kapitän.")
    return await _invite_payload(await team_page.ensure_invite(db, team_id, me["id"]))


@router.post("/{team_id}/invite-link")
async def renew_invite_link(team_id: str, me: dict = Depends(get_current_user)):
    db = get_db()
    team = await _team_or_404(db, team_id)
    if not _can_manage(team, me):
        raise HTTPException(status_code=403, detail="Einladen dürfen Kapitän und Co-Kapitän.")
    row = await team_page.renew_invite(db, team_id, me["id"])
    await db.audit_logs.insert_one({
        "id": new_id(), "action": "team.invite_link.renew", "target_id": team_id,
        "actor_id": me["id"], "data": {}, "created_at": now_utc().isoformat(),
    })
    return await _invite_payload(row)


@router.get("/{team_id}/invite-link/check")
async def check_invite_link(team_id: str, token: str = "", user: dict | None = Depends(get_optional_user)):
    db = get_db()
    team = await db.teams.find_one({"id": team_id}, {"_id": 0})
    valid = bool(team) and await team_page.invite_valid(db, team_id, token)
    if not team or (not valid and team.get("is_public") is False and not _insider(team, user)):
        # Ein privates Team verrät ohne gültigen Schlüssel nicht einmal, dass es existiert.
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    return {"valid": valid, "team": _team_card(team), "already_member": _is_member(team, user)}


@router.post("/{team_id}/join-link")
async def join_with_link(team_id: str, body: JoinLinkBody, me: dict = Depends(get_current_user)):
    db = get_db()
    team = await db.teams.find_one({"id": team_id}, {"_id": 0})
    if not team or not await team_page.invite_valid(db, team_id, body.token.strip()):
        raise HTTPException(status_code=403, detail=INVITE_GONE)
    if me["id"] in (team.get("member_ids") or []):
        return {"ok": True, "already_member": True}
    await _add_team_member(db, team_id, me["id"])
    # Eine offene persönliche Einladung ins selbe Team ist damit erledigt.
    await db.team_invites.update_many(
        {"team_id": team_id, "user_id": me["id"], "status": "pending"},
        {"$set": {"status": "accepted", "acted_at": now_utc().isoformat(), "updated_at": now_utc().isoformat()}},
    )
    if team.get("leader_id") and team.get("leader_id") != me["id"]:
        await create_user_notification(
            team["leader_id"],
            title=f"{_user_label(me)} ist [{team.get('tag')}] beigetreten",
            body=f"Über den Einladungs-Link von {team.get('name')}.",
            url=f"/teams/{team_id}",
            kind="team_invite_accepted",
            meta={"team_id": team_id, "via": "invite_link"},
        )
    from services.change_events import publish_user_change
    await publish_user_change([*(team.get("member_ids") or []), me["id"]], "teams")
    return {"ok": True, "already_member": False}
