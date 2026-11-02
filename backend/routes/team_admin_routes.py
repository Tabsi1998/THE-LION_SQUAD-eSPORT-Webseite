"""Teamverwaltung im Admin (#2128, TM7, TM8, TM10): alle Teams mit Suche, aufgelöste Teams, „Alle Beitrittscodes erneuern“.

- ``GET  /api/admin/teams``                      aktive oder aufgelöste Teams - Turnierleitung und Vereinsverwaltung
- ``POST /api/admin/teams/join-codes/renew``     alle Beitrittscodes neu, auf Wunsch auch alle Einladungs-Links - Club-Admin und
  Superadmin, mit Rückfrage und Protokoll

Verwaltet wird ein einzelnes Team auf seiner Teamseite; die Liste führt dorthin. In keiner Antwort und keinem Protokoll
steht ein Beitrittscode: die Teamleitung findet den neuen auf der Teamseite unter „Einladen“."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import require_area
from database import get_db
from routes.team_routes import TEAM_OWNER_ADMIN_ROLES, _account_gone, _is_member, _is_staff, _public_user, _refuse, _team_admin, _team_audit, _tell
from services import team_page
from services.query_filters import safe_regex
from services.team_dissolve import DISSOLVED_TEAM_RETENTION_DAYS, dissolved_view, is_restorable

router = APIRouter(prefix="/api/admin/teams", tags=["team-admin"])

LIST_LIMIT = 200
RENEW_ALL_LIMIT = 5000


class RenewAllBody(BaseModel):
    confirm: bool = False
    # Auch alle Einladungs-Links: der nächste Aufruf unter „Einladen“ legt je Team einen neuen an (``team_page.ensure_invite``).
    # Nur auf ausdrücklichen Wunsch - das Häkchen der Seite ist vorgewählt und wird immer mitgeschickt.
    renew_links: bool = False


def _search(q: str | None) -> dict:
    if not (q or "").strip():
        return {}
    pattern = safe_regex(q.strip())
    return {"$or": [{"name": {"$regex": pattern, "$options": "i"}}, {"tag": {"$regex": pattern, "$options": "i"}}]}


def _page(limit: int, offset: int) -> tuple[int, int]:
    return max(1, min(int(limit or 50), LIST_LIMIT)), max(0, int(offset or 0))


async def _active_rows(db, query: dict, limit: int, offset: int, me: dict) -> list[dict]:
    teams = await db.teams.find(query, {"_id": 0, "join_code": 0}).sort("name", 1).skip(offset).limit(limit).to_list(limit)
    leaders = {row["id"]: row for row in await db.users.find(
        {"id": {"$in": sorted({team.get("leader_id") for team in teams if team.get("leader_id")})}},
        {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1, "is_active": 1, "anonymized_at": 1},
    ).to_list(limit)}
    squads: dict[str, int] = {}
    async for row in db.team_squads.find({"team_id": {"$in": [team["id"] for team in teams]}}, {"_id": 0, "team_id": 1}):
        squads[row["team_id"]] = squads.get(row["team_id"], 0) + 1
    rows = []
    for team in teams:
        leader = leaders.get(team.get("leader_id"))
        rows.append({
            "id": team["id"], "name": team.get("name"), "tag": team.get("tag"), "logo_url": team.get("logo_url"),
            "is_public": team.get("is_public", True), "member_count": len(team.get("member_ids") or []),
            "squad_count": squads.get(team["id"], 0), "created_at": team.get("created_at"),
            "leader": _public_user(leader),
            # Ohne aktive Teamleitung sitzt das Team fest - das steht in der Liste, der Admin übergibt auf der Teamseite.
            "leader_gone": _account_gone(leader),
            # Ein privates Team zeigt seine Seite nur Mitgliedern und ``TEAM_ADMIN_ROLES`` - sonst führte die Zeile auf „nicht gefunden“.
            "can_open": team.get("is_public") is not False or _is_staff(me) or _is_member(team, me),
        })
    return rows


@router.get("")
async def list_teams(
    q: str | None = None,
    state: Literal["active", "dissolved"] = "active",
    limit: int = 50,
    offset: int = 0,
    me: dict = Depends(require_area("tournaments", "club")),
):
    db = get_db()
    limit, offset = _page(limit, offset)
    rights = {"can_restore": _team_admin(me, TEAM_OWNER_ADMIN_ROLES), "can_renew_all": _team_admin(me, TEAM_OWNER_ADMIN_ROLES),
              "restore_days": DISSOLVED_TEAM_RETENTION_DAYS}
    if state == "dissolved":
        query = {**_search(q), "purged_at": {"$exists": False}}
        rows = await db.dissolved_teams.find(query, {"_id": 0}).sort("dissolved_at", -1).to_list(LIST_LIMIT * 5)
        rows = [dissolved_view(row) for row in rows if is_restorable(row)]
        return {"items": rows[offset:offset + limit], "total": len(rows), "limit": limit, "offset": offset, **rights}
    query = _search(q)
    return {
        "items": await _active_rows(db, query, limit, offset, me),
        "total": await db.teams.count_documents(query),
        "limit": limit, "offset": offset, **rights,
    }


@router.post("/join-codes/renew")
async def renew_all_join_codes(body: RenewAllBody, me: dict = Depends(require_area("club"))):
    """Einmal alle neu - etwa nach einer Bereinigung. Die alten Codes gelten sofort nicht mehr, auf Wunsch auch die alten
    Einladungs-Links samt QR-Codes."""
    if not _team_admin(me, TEAM_OWNER_ADMIN_ROLES):
        _refuse(me, "Alle Beitrittscodes erneuern dürfen Club-Admin und Superadmin.", TEAM_OWNER_ADMIN_ROLES)
    if not body.confirm:
        raise HTTPException(status_code=400, detail="Bitte die Rückfrage bestätigen.")
    db = get_db()
    teams = await db.teams.find({}, {"_id": 0, "id": 1, "name": 1, "tag": 1, "leader_id": 1}).to_list(RENEW_ALL_LIMIT)
    renewed = 0
    links_removed = (await db.team_invite_links.delete_many({})).deleted_count if body.renew_links else 0
    links_text = " Auch der Einladungs-Link ist neu – schon geteilte Links und QR-Codes gelten nicht mehr." if body.renew_links else ""
    for team in teams:
        await team_page.renew_join_code(db, team["id"])
        renewed += 1
        await _tell(
            team.get("leader_id"),
            title=f"Neuer Beitrittscode: [{team.get('tag')}]",
            body=f"Die Vereinsverwaltung hat alle Beitrittscodes erneuert. Den neuen Code von {team.get('name')} findest du auf der "
                 f"Teamseite unter „Einladen“; der alte gilt nicht mehr.{links_text}",
            url=f"/teams/{team['id']}",
            kind="team_join_code_renewed",
            meta={"team_id": team["id"]},
        )
    await _team_audit(db, "team.join_code.renew_all", None, me["id"], {"teams": renewed, "invite_links_renewed": body.renew_links,
                                                                       "invite_links_removed": links_removed})
    from services.change_events import publish_user_change
    await publish_user_change([team["leader_id"] for team in teams if team.get("leader_id")], "teams")
    return {"ok": True, "renewed": renewed, "links_renewed": body.renew_links}
