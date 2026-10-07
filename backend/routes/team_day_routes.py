"""Team am Spieltag (#1192): Aufstellung wählen und „Wer ist da“ - nur bei Team-Turnieren.

- ``GET    /api/team-day/{tid}``           dein Team in diesem Turnier: Aufstellung, Mitglieder, wer da ist
- ``PUT    /api/team-day/{tid}/lineup``    Aufstellung speichern (Kapitän, Co-Kapitän; bis zum Ende des Check-ins)
- ``DELETE /api/team-day/{tid}/lineup``    Aufstellung zurücknehmen - dann gilt wieder das ganze Team
- ``POST   /api/team-day/{tid}/presence``  „Ich bin da“ (jedes Mitglied, am Turniertag)
- ``DELETE /api/team-day/{tid}/presence``  doch noch nicht da
- ``POST   /api/team-day/{tid}/nudge``     Fehlende anstupsen (Kapitän, Co-Kapitän; höchstens alle 10 Minuten)
- ``GET    /api/team-day/{tid}/lineups``   für die Turnierleitung beim Check-in: Aufstellung und „da“ je Team
"""
from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import get_current_user
from database import get_db
from models import now_utc
from routes.tournament_common import _is_staff, _resolve_tid
from services import team_lineup
from services.tournament_permissions import CHECKIN_STAFF_ROLES, has_tournament_staff_permission
from services.user_notifications import create_user_notification

router = APIRouter(prefix="/api/team-day", tags=["tournaments"])


class LineupBody(BaseModel):
    lineup: list[str] = Field(default_factory=list, max_length=12)


def _role(team: dict, user_id: str) -> str:
    if team.get("leader_id") == user_id:
        return "captain"
    if user_id in (team.get("co_leader_ids") or []):
        return "co_captain"
    return "player"


async def _my_team_registration(db, tid: str, me: dict) -> tuple[dict, dict | None, dict | None]:
    tournament = await db.tournaments.find_one({"id": tid}, {"_id": 0})
    if not tournament:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    if not team_lineup.is_team_tournament(tournament):
        return tournament, None, None
    team_ids = {row.get("team_id") for row in await db.team_members.find({"user_id": me["id"]}, {"_id": 0, "team_id": 1}).to_list(100)}
    team_ids.update(row["id"] for row in await db.teams.find({"member_ids": me["id"]}, {"_id": 0, "id": 1}).to_list(100))
    team_ids.discard(None)
    if not team_ids:
        return tournament, None, None
    reg = await db.tournament_registrations.find_one(
        {"tournament_id": tid, "team_id": {"$in": sorted(team_ids)}, "status": {"$nin": ["rejected"]}}, {"_id": 0, "identity_key": 0},
    )
    if not reg:
        return tournament, None, None
    team = await db.teams.find_one({"id": reg["team_id"]}, {"_id": 0})
    if not team or me["id"] not in (team.get("member_ids") or []):
        return tournament, None, None
    return tournament, reg, team


async def _payload(db, tournament: dict, reg: dict, team: dict, me: dict) -> dict:
    now = now_utc()
    member_ids = list(team.get("member_ids") or [])
    users = {u["id"]: u for u in await db.users.find(
        {"id": {"$in": member_ids}}, {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1},
    ).to_list(len(member_ids) or 1)}
    members = [{
        "id": uid,
        "username": (users.get(uid) or {}).get("username"),
        "display_name": (users.get(uid) or {}).get("display_name") or (users.get(uid) or {}).get("username") or "Spieler",
        "avatar_url": (users.get(uid) or {}).get("avatar_url"),
        "role": _role(team, uid),
    } for uid in member_ids if uid in users]
    counted = team_lineup.counted_members(team, reg)
    present = {uid: at for uid, at in (reg.get("presence") or {}).items() if uid in member_ids}
    day = team_lineup.is_tournament_day(tournament, now)
    leads = team_lineup.can_lead(team, me)
    available_at = team_lineup.nudge_available_at(reg)
    deadline = team_lineup.lineup_deadline(tournament)
    return {
        "applicable": True,
        "registration_id": reg["id"],
        "registration_status": reg.get("status"),
        "team": {"id": team["id"], "name": team.get("name"), "tag": team.get("tag")},
        "team_size": team_lineup.team_size(tournament),
        "substitutes_allowed": bool(tournament.get("substitutes_allowed")),
        "members": members,
        "lineup": list(reg.get("lineup") or []),
        "substitutes": list(reg.get("substitutes") or []),
        "lineup_set": bool(reg.get("lineup")),
        "can_edit": leads and team_lineup.lineup_open(tournament, reg, now),
        "is_lead": leads,
        "editable_until": deadline.isoformat() if deadline else None,
        "presence": {
            "enabled": day,
            "days": list(team_lineup.tournament_days(tournament) or []),
            "present": present,
            "counted": counted,
            "count": len([uid for uid in counted if uid in present]),
            "total": len(counted),
            "me_present": me["id"] in present,
            "can_mark": day,
        },
        "can_nudge": leads and day,
        "nudge_available_at": available_at if available_at and available_at > now.isoformat() else None,
    }


@router.get("/{tid}")
async def team_day(tid: str, me: dict = Depends(get_current_user)):
    db = get_db()
    tid = await _resolve_tid(tid)
    tournament, reg, team = await _my_team_registration(db, tid, me)
    if not reg or not team:
        return {"applicable": False}
    return await _payload(db, tournament, reg, team, me)


@router.put("/{tid}/lineup")
async def save_lineup(tid: str, body: LineupBody, me: dict = Depends(get_current_user)):
    db = get_db()
    tid = await _resolve_tid(tid)
    tournament, reg, team = await _my_team_registration(db, tid, me)
    if not reg or not team:
        raise HTTPException(status_code=404, detail="Dein Team ist für dieses Turnier nicht angemeldet.")
    if not team_lineup.can_lead(team, me):
        raise HTTPException(status_code=403, detail="Die Aufstellung wählen Kapitän und Co-Kapitän.")
    if not team_lineup.lineup_open(tournament, reg):
        raise HTTPException(status_code=409, detail="Die Aufstellung lässt sich nur bis zum Ende des Check-ins ändern.")
    lineup, substitutes = team_lineup.validate_lineup(team, tournament, body.lineup)
    await db.tournament_registrations.update_one({"id": reg["id"]}, {"$set": {
        "lineup": lineup, "substitutes": substitutes, "lineup_updated_at": now_utc().isoformat(), "lineup_updated_by": me["id"],
    }})
    reg.update({"lineup": lineup, "substitutes": substitutes})
    from services.change_events import publish_user_change
    await publish_user_change(list(team.get("member_ids") or []), "tournaments")
    return await _payload(db, tournament, reg, team, me)


@router.delete("/{tid}/lineup")
async def clear_lineup(tid: str, me: dict = Depends(get_current_user)):
    db = get_db()
    tid = await _resolve_tid(tid)
    tournament, reg, team = await _my_team_registration(db, tid, me)
    if not reg or not team:
        raise HTTPException(status_code=404, detail="Dein Team ist für dieses Turnier nicht angemeldet.")
    if not team_lineup.can_lead(team, me):
        raise HTTPException(status_code=403, detail="Die Aufstellung wählen Kapitän und Co-Kapitän.")
    if not team_lineup.lineup_open(tournament, reg):
        raise HTTPException(status_code=409, detail="Die Aufstellung lässt sich nur bis zum Ende des Check-ins ändern.")
    await db.tournament_registrations.update_one({"id": reg["id"]}, {"$unset": {"lineup": "", "substitutes": ""},
                                                                    "$set": {"lineup_updated_at": now_utc().isoformat(), "lineup_updated_by": me["id"]}})
    reg.pop("lineup", None)
    reg.pop("substitutes", None)
    return await _payload(db, tournament, reg, team, me)


async def _presence(tid: str, me: dict, here: bool) -> dict:
    db = get_db()
    tid = await _resolve_tid(tid)
    tournament, reg, team = await _my_team_registration(db, tid, me)
    if not reg or not team:
        raise HTTPException(status_code=404, detail="Dein Team ist für dieses Turnier nicht angemeldet.")
    if not team_lineup.is_tournament_day(tournament):
        raise HTTPException(status_code=409, detail="„Ich bin da“ gibt es am Turniertag.")
    if here:
        stamp = now_utc().isoformat()
        await db.tournament_registrations.update_one({"id": reg["id"]}, {"$set": {f"presence.{me['id']}": stamp}})
        reg.setdefault("presence", {})[me["id"]] = stamp
    else:
        await db.tournament_registrations.update_one({"id": reg["id"]}, {"$unset": {f"presence.{me['id']}": ""}})
        (reg.get("presence") or {}).pop(me["id"], None)
    from services.change_events import publish_user_change
    await publish_user_change(list(team.get("member_ids") or []), "tournaments")
    return await _payload(db, tournament, reg, team, me)


@router.post("/{tid}/presence")
async def mark_present(tid: str, me: dict = Depends(get_current_user)):
    return await _presence(tid, me, True)


@router.delete("/{tid}/presence")
async def unmark_present(tid: str, me: dict = Depends(get_current_user)):
    return await _presence(tid, me, False)


@router.post("/{tid}/nudge")
async def nudge_missing(tid: str, me: dict = Depends(get_current_user)):
    db = get_db()
    tid = await _resolve_tid(tid)
    tournament, reg, team = await _my_team_registration(db, tid, me)
    if not reg or not team:
        raise HTTPException(status_code=404, detail="Dein Team ist für dieses Turnier nicht angemeldet.")
    if not team_lineup.can_lead(team, me):
        raise HTTPException(status_code=403, detail="Anstupsen dürfen Kapitän und Co-Kapitän.")
    if not team_lineup.is_tournament_day(tournament):
        raise HTTPException(status_code=409, detail="Anstupsen geht am Turniertag.")
    now = now_utc()
    available = team_lineup.nudge_available_at(reg)
    if available and available > now.isoformat():
        wait = team_lineup.minutes_until(available, now)
        raise HTTPException(status_code=429, detail=f"Angestupst ist schon – in {wait} {'Minute' if wait == 1 else 'Minuten'} wieder möglich.")
    present = reg.get("presence") or {}
    missing = [uid for uid in team_lineup.counted_members(team, reg) if uid not in present and uid != me["id"]]
    stamp = now.isoformat()
    # Erst merken, dann senden: zwei schnelle Tipps schicken nicht zweimal.
    claimed = await db.tournament_registrations.update_one(
        {"id": reg["id"], "$or": [{"presence_nudged_at": {"$exists": False}}, {"presence_nudged_at": None},
                                   {"presence_nudged_at": {"$lte": (now - timedelta(minutes=team_lineup.NUDGE_MINUTES)).isoformat()}}]},
        {"$set": {"presence_nudged_at": stamp}},
    )
    if not claimed.modified_count:
        raise HTTPException(status_code=429, detail="Angestupst ist schon - in ein paar Minuten wieder.")
    url = f"/tournaments/{tournament.get('slug') or tournament['id']}"
    for uid in missing:
        await create_user_notification(
            uid,
            title=f"Bist du schon da? [{team.get('tag')}]",
            body=f"{team.get('name')} spielt heute beim {tournament.get('title') or 'Turnier'}. Tippe „Ich bin da“, damit dein Team Bescheid weiß.",
            url=url,
            kind="team_presence_nudge",
            meta={"tournament_id": tournament["id"], "team_id": team["id"], "dedupe_key": f"nudge:{reg['id']}:{uid}:{stamp}"},
        )
    reg["presence_nudged_at"] = stamp
    payload = await _payload(db, tournament, reg, team, me)
    return {**payload, "nudged": len(missing)}


@router.get("/{tid}/lineups")
async def staff_lineups(tid: str, me: dict = Depends(get_current_user)):
    """Für die Turnierleitung beim Check-in: Aufstellung und „da“ je Team-Anmeldung."""
    db = get_db()
    tid = await _resolve_tid(tid)
    if not (_is_staff(me) or await has_tournament_staff_permission(me, tid, CHECKIN_STAFF_ROLES)):
        raise HTTPException(status_code=403, detail="Nur für die Turnierleitung.")
    tournament = await db.tournaments.find_one({"id": tid}, {"_id": 0}) or {}
    if not team_lineup.is_team_tournament(tournament):
        return {}
    regs = await db.tournament_registrations.find({"tournament_id": tid, "team_id": {"$ne": None}}, {"_id": 0}).to_list(500)
    team_ids = sorted({reg["team_id"] for reg in regs if reg.get("team_id")})
    teams = {t["id"]: t for t in await db.teams.find({"id": {"$in": team_ids}}, {"_id": 0}).to_list(len(team_ids) or 1)}
    user_ids = sorted({uid for t in teams.values() for uid in t.get("member_ids") or []})
    names = {u["id"]: u.get("display_name") or u.get("username") or "Spieler" for u in await db.users.find(
        {"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "display_name": 1, "username": 1}).to_list(len(user_ids) or 1)}
    out = {}
    for reg in regs:
        team = teams.get(reg.get("team_id"))
        if not team:
            continue
        counted = team_lineup.counted_members(team, reg)
        present = reg.get("presence") or {}
        out[reg["id"]] = {
            "team": team.get("name"),
            "lineup_set": bool(reg.get("lineup")),
            "starters": [{"id": uid, "name": names.get(uid, "Spieler")} for uid in reg.get("lineup") or []],
            "substitutes": [{"id": uid, "name": names.get(uid, "Spieler")} for uid in reg.get("substitutes") or []],
            "present": len([uid for uid in counted if uid in present]),
            "total": len(counted),
        }
    return out
