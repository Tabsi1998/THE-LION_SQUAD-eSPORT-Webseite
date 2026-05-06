"""Match/Score/Dispute routes."""
from fastapi import APIRouter, HTTPException, Depends
from database import get_db
from auth import get_current_user, require_admin, require_role, get_optional_user
from services.visibility import user_can_see
from models import MatchUpdate, MatchScoreReport, MatchDispute, now_utc, new_id
from bracket_engine import advance_match_winner

router = APIRouter(prefix="/api/matches", tags=["matches"])
STAFF_ROLES = {"moderator", "tournament_admin", "club_admin", "superadmin"}
USER_PUBLIC_PROJECTION = {
    "_id": 0,
    "id": 1,
    "username": 1,
    "display_name": 1,
    "avatar_url": 1,
}


def _is_staff(user: dict | None) -> bool:
    return bool(user and user.get("role") in STAFF_ROLES)


async def _user_registration_for_match(match: dict, user: dict | None) -> dict | None:
    if not user:
        return None
    reg_ids = [x for x in [match.get("participant_a_id"), match.get("participant_b_id")] if x]
    if not reg_ids:
        return None
    db = get_db()
    return await db.tournament_registrations.find_one(
        {"id": {"$in": reg_ids}, "user_id": user["id"]},
        {"_id": 0},
    )


async def _assert_match_visible(match: dict, user: dict | None) -> None:
    if _is_staff(user) or await _user_registration_for_match(match, user):
        return
    db = get_db()
    t = await db.tournaments.find_one({"id": match.get("tournament_id")}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    if t.get("status") == "draft" or t.get("is_public") is False:
        raise HTTPException(status_code=404, detail="Match nicht gefunden")
    if not await user_can_see(user, t.get("visibility") or "public"):
        raise HTTPException(status_code=403, detail="Match ist nicht sichtbar")


def _public_registration(reg: dict | None, user: dict | None) -> dict | None:
    if not reg:
        return None
    is_staff = _is_staff(user)
    is_self = bool(user and reg.get("user_id") == user.get("id"))
    if is_staff:
        return reg
    out = {
        "id": reg.get("id"),
        "tournament_id": reg.get("tournament_id"),
        "status": reg.get("status"),
        "display_name": reg.get("display_name") or reg.get("ingame_name"),
        "ingame_name": reg.get("ingame_name"),
        "team_id": reg.get("team_id"),
        "user": reg.get("user"),
    }
    if is_self:
        out["user_id"] = reg.get("user_id")
    return out


@router.get("/upcoming")
async def my_upcoming(me: dict = Depends(get_current_user)):
    db = get_db()
    regs = await db.tournament_registrations.find(
        {"user_id": me["id"]}, {"_id": 0, "id": 1, "tournament_id": 1}
    ).to_list(200)
    reg_ids = [r["id"] for r in regs]
    matches = await db.matches.find({
        "$or": [{"participant_a_id": {"$in": reg_ids}},
                {"participant_b_id": {"$in": reg_ids}}],
        "status": {"$in": ["ready", "scheduled", "in_progress", "waiting_result"]},
    }, {"_id": 0}).to_list(200)
    return matches


@router.get("/{match_id}")
async def get_match(match_id: str, user: dict | None = Depends(get_optional_user)):
    db = get_db()
    m = await db.matches.find_one({"id": match_id}, {"_id": 0})
    if not m:
        raise HTTPException(status_code=404, detail="Match nicht gefunden")
    await _assert_match_visible(m, user)
    # Enrich participants
    reg_ids = [x for x in [m.get("participant_a_id"), m.get("participant_b_id")] if x]
    regs = await db.tournament_registrations.find({"id": {"$in": reg_ids}}, {"_id": 0}).to_list(10)
    user_ids = [r["user_id"] for r in regs if r.get("user_id")]
    users = {u["id"]: u for u in await db.users.find(
        {"id": {"$in": user_ids}}, USER_PUBLIC_PROJECTION).to_list(10)}
    regs_dict = {r["id"]: {**r, "user": users.get(r.get("user_id"))} for r in regs}
    m["participant_a"] = _public_registration(regs_dict.get(m.get("participant_a_id")), user)
    m["participant_b"] = _public_registration(regs_dict.get(m.get("participant_b_id")), user)
    return m


@router.put("/{match_id}")
@router.patch("/{match_id}")
async def update_match(match_id: str, body: MatchUpdate, me: dict = Depends(require_role("moderator"))):
    db = get_db()
    m = await db.matches.find_one({"id": match_id})
    if not m:
        raise HTTPException(status_code=404)
    nullable_fields = {"winner_id", "scheduled_at", "station_id", "admin_note", "map", "best_of"}
    raw = body.model_dump(exclude_unset=True)
    updates = {k: v for k, v in raw.items() if v is not None or k in nullable_fields}
    if "scheduled_at" in updates:
        updates["scheduled_at"] = updates["scheduled_at"].isoformat() if updates["scheduled_at"] else None
    # If winner_id changed, determine loser + status
    if "winner_id" in updates and updates["winner_id"]:
        w = updates["winner_id"]
        updates["loser_id"] = m.get("participant_a_id") if w == m.get("participant_b_id") else m.get("participant_b_id")
        updates["status"] = "completed"
    updates["updated_at"] = now_utc().isoformat()
    await db.matches.update_one({"id": match_id}, {"$set": updates})
    m = await db.matches.find_one({"id": match_id})
    # If completed, advance bracket
    if m.get("status") == "completed" and m.get("winner_id"):
        all_matches = await db.matches.find({"tournament_id": m["tournament_id"]}).to_list(2000)
        updated_matches = advance_match_winner(m, all_matches)
        for um in updated_matches:
            await db.matches.update_one({"id": um["id"]}, {"$set": um})
        # Badge triggers
        try:
            from badges import on_match_completed
            regs = {r["id"]: r.get("user_id") for r in await db.tournament_registrations.find(
                {"tournament_id": m["tournament_id"]}, {"_id": 0}).to_list(500)}
            winner_uid = regs.get(m.get("winner_id"))
            loser_uid = regs.get(m.get("loser_id"))
            if winner_uid:
                await on_match_completed(winner_uid, loser_uid, m["tournament_id"], m["id"])
        except Exception:
            pass
        # Discord trigger: match completed
        try:
            from discord_service import send_discord
            regs = {r["id"]: r for r in await db.tournament_registrations.find(
                {"tournament_id": m["tournament_id"]}, {"_id": 0}).to_list(500)}
            t = await db.tournaments.find_one({"id": m["tournament_id"]}, {"_id": 0}) or {}
            a = regs.get(m.get("participant_a_id"), {})
            b = regs.get(m.get("participant_b_id"), {})
            w = regs.get(m.get("winner_id"), {})
            await send_discord(
                f"🎮 Match beendet · {t.get('title') or 'Turnier'}",
                f"**{a.get('display_name') or '?'}** vs **{b.get('display_name') or '?'}**\n"
                f"Gewinner: **{w.get('display_name') or '?'}** ({m.get('score_a',0)}:{m.get('score_b',0)})",
                color=0x29B6E8,
                url=f"/tournaments/{t.get('slug') or t.get('id')}/bracket",
                fields=[
                    {"name": "Runde", "value": m.get("round_name") or f"Runde {m.get('round','?')}", "inline": True},
                ],
                event_key="match.completed",
            )
        except Exception:
            pass
    m.pop("_id", None)
    return m


@router.post("/{match_id}/report")
async def report_score(match_id: str, body: MatchScoreReport, me: dict = Depends(get_current_user)):
    db = get_db()
    m = await db.matches.find_one({"id": match_id})
    if not m:
        raise HTTPException(status_code=404)
    # Verify user is participant
    reg_ids = [m.get("participant_a_id"), m.get("participant_b_id")]
    my_reg = await db.tournament_registrations.find_one(
        {"id": {"$in": reg_ids}, "user_id": me["id"]})
    if not my_reg:
        raise HTTPException(status_code=403, detail="Nicht Teilnehmer dieses Matches")
    report = {
        "id": new_id(),
        "user_id": me["id"],
        "registration_id": my_reg["id"],
        "score_a": body.score_a,
        "score_b": body.score_b,
        "screenshot_url": body.screenshot_url,
        "note": body.note,
        "at": now_utc().isoformat(),
    }
    await db.matches.update_one({"id": match_id}, {
        "$push": {"reports": report},
        "$set": {"status": "waiting_result", "updated_at": now_utc().isoformat()},
    })
    # Check consensus - if 2 reports match, auto-complete
    m = await db.matches.find_one({"id": match_id})
    reports = m.get("reports", [])
    if len(reports) >= 2:
        last2 = reports[-2:]
        if last2[0]["score_a"] == last2[1]["score_a"] and last2[0]["score_b"] == last2[1]["score_b"]:
            winner = None
            if body.score_a > body.score_b:
                winner = m.get("participant_a_id")
            elif body.score_b > body.score_a:
                winner = m.get("participant_b_id")
            await db.matches.update_one({"id": match_id}, {"$set": {
                "score_a": body.score_a, "score_b": body.score_b,
                "winner_id": winner,
                "loser_id": m.get("participant_b_id") if winner == m.get("participant_a_id") else m.get("participant_a_id"),
                "status": "completed", "updated_at": now_utc().isoformat(),
            }})
            # Advance bracket
            m = await db.matches.find_one({"id": match_id})
            all_matches = await db.matches.find({"tournament_id": m["tournament_id"]}).to_list(2000)
            for um in advance_match_winner(m, all_matches):
                await db.matches.update_one({"id": um["id"]}, {"$set": um})
    m = await db.matches.find_one({"id": match_id}, {"_id": 0})
    return m


@router.post("/{match_id}/dispute")
async def dispute(match_id: str, body: MatchDispute, me: dict = Depends(get_current_user)):
    db = get_db()
    m = await db.matches.find_one({"id": match_id})
    if not m:
        raise HTTPException(status_code=404, detail="Match nicht gefunden")
    if not _is_staff(me) and not await _user_registration_for_match(m, me):
        raise HTTPException(status_code=403, detail="Nicht Teilnehmer dieses Matches")
    await db.matches.update_one({"id": match_id}, {
        "$push": {"disputes": {"user_id": me["id"], "reason": body.reason,
                                 "at": now_utc().isoformat()}},
        "$set": {"status": "disputed", "updated_at": now_utc().isoformat()},
    })
    m = await db.matches.find_one({"id": match_id}, {"_id": 0})
    # Phase B v4.1: trigger negative achievement for the user who disputed
    try:
        from badges import on_dispute_opened
        await on_dispute_opened(me["id"], match_id=match_id)
    except Exception:
        pass
    return m


@router.post("/{match_id}/forfeit")
async def forfeit(match_id: str, body: dict, me: dict = Depends(require_role("moderator"))):
    """Admin forfeit - winner_id is the surviving participant.

    P0 — Penalty Transparency: a justification note (≥5 chars) is mandatory and
    will be visible to the affected player in /api/penalties/me.
    """
    db = get_db()
    m = await db.matches.find_one({"id": match_id})
    if not m:
        raise HTTPException(status_code=404)
    note = (body.get("note") or body.get("reason") or "").strip()
    if len(note) < 5:
        raise HTTPException(
            status_code=422,
            detail="Bei einem Forfeit ist eine Begründung (mind. 5 Zeichen) Pflicht.",
        )
    winner_id = body.get("winner_id")
    loser_id = m.get("participant_a_id") if winner_id == m.get("participant_b_id") else m.get("participant_b_id")
    await db.matches.update_one({"id": match_id}, {"$set": {
        "winner_id": winner_id, "loser_id": loser_id,
        "status": "forfeit",
        "admin_decision_note": note,
        "admin_decision_by": me["id"],
        "admin_decision_at": now_utc().isoformat(),
        "updated_at": now_utc().isoformat(),
    }})
    m = await db.matches.find_one({"id": match_id})
    all_matches = await db.matches.find({"tournament_id": m["tournament_id"]}).to_list(2000)
    for um in advance_match_winner(m, all_matches):
        await db.matches.update_one({"id": um["id"]}, {"$set": um})
    m.pop("_id", None)
    # Phase B v4.1: forfeit ⇒ no_show for the loser
    try:
        from badges import trigger_negative_incident
        # Resolve loser registration → user_id
        if loser_id:
            reg = await db.tournament_registrations.find_one({"id": loser_id}, {"_id": 0, "user_id": 1})
            if reg and reg.get("user_id"):
                await trigger_negative_incident(reg["user_id"], "no_show",
                    {"match_id": match_id, "reason": "forfeit"}, awarded_by=me["id"])
    except Exception:
        pass
    return m
