"""Match/Score/Dispute routes."""
from fastapi import APIRouter, HTTPException, Depends
from database import get_db
from auth import get_current_user, require_admin, get_optional_user
from models import MatchUpdate, MatchScoreReport, MatchDispute, now_utc, new_id
from bracket_engine import advance_match_winner

router = APIRouter(prefix="/api/matches", tags=["matches"])


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
async def get_match(match_id: str):
    db = get_db()
    m = await db.matches.find_one({"id": match_id}, {"_id": 0})
    if not m:
        raise HTTPException(status_code=404, detail="Match nicht gefunden")
    # Enrich participants
    reg_ids = [x for x in [m.get("participant_a_id"), m.get("participant_b_id")] if x]
    regs = await db.tournament_registrations.find({"id": {"$in": reg_ids}}, {"_id": 0}).to_list(10)
    user_ids = [r["user_id"] for r in regs if r.get("user_id")]
    users = {u["id"]: u for u in await db.users.find(
        {"id": {"$in": user_ids}}, {"_id": 0, "password_hash": 0}).to_list(10)}
    regs_dict = {r["id"]: {**r, "user": users.get(r.get("user_id"))} for r in regs}
    m["participant_a"] = regs_dict.get(m.get("participant_a_id"))
    m["participant_b"] = regs_dict.get(m.get("participant_b_id"))
    return m


@router.patch("/{match_id}")
async def update_match(match_id: str, body: MatchUpdate, me: dict = Depends(require_admin())):
    db = get_db()
    m = await db.matches.find_one({"id": match_id})
    if not m:
        raise HTTPException(status_code=404)
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if updates.get("scheduled_at"):
        updates["scheduled_at"] = updates["scheduled_at"].isoformat()
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
    await db.matches.update_one({"id": match_id}, {
        "$push": {"disputes": {"user_id": me["id"], "reason": body.reason,
                                 "at": now_utc().isoformat()}},
        "$set": {"status": "disputed", "updated_at": now_utc().isoformat()},
    })
    m = await db.matches.find_one({"id": match_id}, {"_id": 0})
    return m


@router.post("/{match_id}/forfeit")
async def forfeit(match_id: str, body: dict, me: dict = Depends(require_admin())):
    """Admin forfeit - winner_id is the surviving participant."""
    db = get_db()
    m = await db.matches.find_one({"id": match_id})
    if not m:
        raise HTTPException(status_code=404)
    winner_id = body.get("winner_id")
    loser_id = m.get("participant_a_id") if winner_id == m.get("participant_b_id") else m.get("participant_b_id")
    await db.matches.update_one({"id": match_id}, {"$set": {
        "winner_id": winner_id, "loser_id": loser_id,
        "status": "forfeit", "updated_at": now_utc().isoformat(),
    }})
    m = await db.matches.find_one({"id": match_id})
    all_matches = await db.matches.find({"tournament_id": m["tournament_id"]}).to_list(2000)
    for um in advance_match_winner(m, all_matches):
        await db.matches.update_one({"id": um["id"]}, {"$set": um})
    m.pop("_id", None)
    return m
