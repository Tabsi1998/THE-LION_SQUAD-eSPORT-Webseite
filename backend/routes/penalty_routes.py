"""P0 — Penalty Transparency routes.

Aggregates ALL penalties from Fast Lap (penalty_seconds>0 or is_invalid) and
Tournament Matches (forfeit / disqualified / disputed) into a single user-facing
log so players can see exactly why and when they were penalized.

Endpoints:
  GET /api/penalties/me              — own penalties (auth)
  GET /api/admin/penalties           — all penalties (admin), with filters
"""
from fastapi import APIRouter, Depends, Query
from typing import Optional

from database import get_db
from auth import get_current_user, require_admin

router = APIRouter(prefix="/api/penalties", tags=["penalties"])
admin_router = APIRouter(prefix="/api/admin/penalties", tags=["penalties-admin"])


def _ms_to_time_str(ms: int | None) -> str:
    if ms is None:
        return "—"
    s = ms / 1000.0
    minutes = int(s // 60)
    seconds = s - minutes * 60
    return f"{minutes}:{seconds:06.3f}" if minutes else f"{seconds:.3f}s"


async def _collect_user_penalties(user_id: str) -> list[dict]:
    """Build a unified penalty timeline for a single user."""
    db = get_db()
    out: list[dict] = []

    # --- Fast Lap penalties / invalid laps ---
    laps = await db.f1_lap_times.find(
        {
            "user_id": user_id,
            "$or": [
                {"penalty_seconds": {"$gt": 0}},
                {"is_invalid": True},
            ],
        },
        {"_id": 0},
    ).sort("created_at", -1).to_list(500)

    track_ids = list({l["track_id"] for l in laps if l.get("track_id")})
    chal_ids = list({l["challenge_id"] for l in laps if l.get("challenge_id")})
    tracks = {t["id"]: t for t in await db.f1_tracks.find(
        {"id": {"$in": track_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(500)}
    chals = {c["id"]: c for c in await db.f1_challenges.find(
        {"id": {"$in": chal_ids}}, {"_id": 0, "id": 1, "title": 1, "slug": 1}).to_list(500)}

    for l in laps:
        chal = chals.get(l.get("challenge_id"), {})
        track = tracks.get(l.get("track_id"), {})
        kind = "lap_invalid" if l.get("is_invalid") else "lap_penalty"
        label = "Runde ungültig" if l.get("is_invalid") else f"+{l.get('penalty_seconds', 0)}s Strafzeit"
        out.append({
            "kind": kind,
            "label": label,
            "reason": l.get("admin_note") or "(keine Begründung hinterlegt)",
            "context_title": chal.get("title") or "Fast Lap",
            "context_url": f"/fastlap/{chal.get('slug') or chal.get('id') or ''}",
            "context_subtitle": track.get("name") or "",
            "raw_time_str": _ms_to_time_str(l.get("time_ms")),
            "penalty_seconds": l.get("penalty_seconds", 0),
            "is_invalid": bool(l.get("is_invalid")),
            "issued_by": l.get("created_by"),
            "issued_at": l.get("updated_at") or l.get("created_at"),
            "ref_id": l.get("id"),
        })

    # --- Tournament forfeits where this user is loser ---
    # Find tournament_registrations where user_id matches, then find matches with that registration as loser
    regs = await db.tournament_registrations.find(
        {"user_id": user_id}, {"_id": 0, "id": 1, "tournament_id": 1}
    ).to_list(500)
    reg_ids = [r["id"] for r in regs]
    if reg_ids:
        matches = await db.matches.find(
            {
                "loser_id": {"$in": reg_ids},
                "status": "forfeit",
                "admin_decision_note": {"$exists": True, "$ne": None},
            },
            {"_id": 0},
        ).sort("admin_decision_at", -1).to_list(500)
        tour_ids = list({m["tournament_id"] for m in matches if m.get("tournament_id")})
        tours = {t["id"]: t for t in await db.tournaments.find(
            {"id": {"$in": tour_ids}}, {"_id": 0, "id": 1, "title": 1, "slug": 1}).to_list(200)}
        for m in matches:
            t = tours.get(m.get("tournament_id"), {})
            out.append({
                "kind": "match_forfeit",
                "label": "Match verloren (Forfeit)",
                "reason": m.get("admin_decision_note") or "(keine Begründung)",
                "context_title": t.get("title") or "Turnier",
                "context_url": f"/tournaments/{t.get('slug') or t.get('id') or ''}",
                "context_subtitle": f"Match #{m.get('match_number') or m.get('id', '')[:6]}",
                "issued_by": m.get("admin_decision_by"),
                "issued_at": m.get("admin_decision_at") or m.get("updated_at"),
                "ref_id": m.get("id"),
            })

    # --- Negative achievement awards (admin-issued incidents) ---
    neg = await db.user_achievements.find(
        {"user_id": user_id, "is_negative": True},
        {"_id": 0},
    ).sort("awarded_at", -1).to_list(500)
    for n in neg:
        out.append({
            "kind": "incident",
            "label": n.get("name") or n.get("code") or "Vorfall",
            "reason": n.get("note") or n.get("context", {}).get("reason") or "(intern)",
            "context_title": "Verhalten / Vorfall",
            "context_url": "",
            "context_subtitle": "",
            "issued_by": n.get("awarded_by"),
            "issued_at": n.get("awarded_at"),
            "ref_id": n.get("id"),
        })

    # Enrich issuer (admin) names
    issuer_ids = list({p["issued_by"] for p in out if p.get("issued_by")})
    issuers = {u["id"]: u for u in await db.users.find(
        {"id": {"$in": issuer_ids}}, {"_id": 0, "id": 1, "username": 1, "display_name": 1}
    ).to_list(200)}
    for p in out:
        u = issuers.get(p.get("issued_by"), {})
        p["issued_by_name"] = u.get("display_name") or u.get("username") or "Admin"

    out.sort(key=lambda x: x.get("issued_at") or "", reverse=True)
    return out


@router.get("/me")
async def my_penalties(me: dict = Depends(get_current_user)):
    """Authenticated user's own penalty log."""
    items = await _collect_user_penalties(me["id"])
    return {"count": len(items), "items": items}


@admin_router.get("")
async def all_penalties(
    me: dict = Depends(require_admin()),
    user_id: Optional[str] = Query(None),
    kind: Optional[str] = Query(None, description="lap_invalid|lap_penalty|match_forfeit|incident"),
    limit: int = Query(200, le=1000),
):
    """Admin penalty inbox across all users."""
    db = get_db()
    if user_id:
        items = await _collect_user_penalties(user_id)
    else:
        # Get all users that have at least one penalty (penalty laps + forfeit losers + neg awards)
        user_ids: set[str] = set()
        async for l in db.f1_lap_times.find(
            {"$or": [{"penalty_seconds": {"$gt": 0}}, {"is_invalid": True}]},
            {"_id": 0, "user_id": 1},
        ):
            if l.get("user_id"):
                user_ids.add(l["user_id"])
        # forfeit matches → loser registration → user
        async for m in db.matches.find(
            {"status": "forfeit", "admin_decision_note": {"$exists": True}},
            {"_id": 0, "loser_id": 1},
        ):
            if m.get("loser_id"):
                reg = await db.tournament_registrations.find_one(
                    {"id": m["loser_id"]}, {"_id": 0, "user_id": 1})
                if reg and reg.get("user_id"):
                    user_ids.add(reg["user_id"])
        async for a in db.user_achievements.find({"is_negative": True}, {"_id": 0, "user_id": 1}):
            if a.get("user_id"):
                user_ids.add(a["user_id"])

        items = []
        for uid in user_ids:
            sub = await _collect_user_penalties(uid)
            for s in sub:
                s["user_id"] = uid
            items.extend(sub)
        # enrich user info
        users = {u["id"]: u for u in await db.users.find(
            {"id": {"$in": list(user_ids)}},
            {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1}
        ).to_list(2000)}
        for it in items:
            u = users.get(it.get("user_id"), {})
            it["user_username"] = u.get("username")
            it["user_display_name"] = u.get("display_name") or u.get("username")
            it["user_avatar_url"] = u.get("avatar_url")

    if kind:
        items = [i for i in items if i.get("kind") == kind]
    items.sort(key=lambda x: x.get("issued_at") or "", reverse=True)
    return {"count": len(items), "items": items[:limit]}
