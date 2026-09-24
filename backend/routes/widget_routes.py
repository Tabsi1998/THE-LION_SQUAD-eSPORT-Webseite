"""Public read-only widgets for brackets, standings and challenge summaries."""

from fastapi import APIRouter, HTTPException
from typing import Optional

from database import get_db
from services.visibility import user_can_see
from services.slug_utils import find_by_slug_or_history
from services.access_links import validate_access_link
from services.competition_read import load_competition_read_model, observe_structure_read

widget_router = APIRouter(prefix="/api/widgets", tags=["widgets"])


async def _public_f1_challenge_or_404(slug_or_id: str, access: str | None = None) -> dict:
    db = get_db()
    c, _ = await find_by_slug_or_history(db.f1_challenges, slug_or_id, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404)
    access_link = await validate_access_link(db, access, "fastlap", c["id"], None, "view")
    if not access_link and (c.get("status") == "draft" or (c.get("visibility") or "public") != "public"):
        raise HTTPException(status_code=404)
    return c


async def _public_tournament_or_404(slug_or_id: str) -> dict:
    db = get_db()
    t, _ = await find_by_slug_or_history(db.tournaments, slug_or_id, {"_id": 0})
    if (
        not t
        or t.get("status") == "draft"
        or t.get("is_public") is False
        or not await user_can_see(None, t.get("visibility") or "public")
    ):
        raise HTTPException(status_code=404)
    return t


def _public_registration(reg: dict) -> dict:
    return {
        "id": reg.get("id"),
        "tournament_id": reg.get("tournament_id"),
        "status": reg.get("status"),
        "display_name": reg.get("display_name") or reg.get("ingame_name"),
        "ingame_name": reg.get("ingame_name"),
        "team_id": reg.get("team_id"),
        "seed": reg.get("seed"),
    }



def _public_widget_stage_match(match: dict) -> dict:
    public_fields = {
        "id", "tournament_id", "stage_id", "stage_number", "stage_type",
        "match_type", "match_key", "section", "round", "round_name", "order",
        "slots", "results", "advancement", "status", "is_preview",
        "generation_mode", "scheduled_at", "duration_minutes", "station_id",
        "station_label", "station_name", "map", "best_of",
    }
    return {key: value for key, value in match.items() if key in public_fields}


def _public_challenge_summary(challenge: dict) -> dict:
    return {
        "id": challenge.get("id"),
        "slug": challenge.get("slug"),
        "title": challenge.get("title"),
        "status": challenge.get("status"),
    }


@widget_router.get("/tournament/{slug_or_id}/bracket")
async def widget_bracket(slug_or_id: str):
    """Read-only bracket data for widget embed."""
    db = get_db()
    t = await _public_tournament_or_404(slug_or_id)
    read_model = await load_competition_read_model(db, t["id"])
    structure = read_model.structure_snapshot()
    observe_structure_read(structure, surface="widget")
    regs = await db.tournament_registrations.find(
        {"tournament_id": t["id"]},
        {"_id": 0},
    ).to_list(500)
    return {
        "tournament": {"id": t["id"], "title": t["title"], "format": t["format"], "status": t["status"]},
        "matches": [],
        "matches_v2": [_public_widget_stage_match(match) for match in read_model.stage_matches],
        "stages": read_model.stages,
        "engine": "stage",
        "structure": structure,
        "registrations": [_public_registration(r) for r in regs],
    }


@widget_router.get("/f1/{slug_or_id}/leaderboard")
async def widget_f1(slug_or_id: str, track_id: Optional[str] = None):
    db = get_db()
    c = await _public_f1_challenge_or_404(slug_or_id)
    if not track_id:
        first = await db.f1_tracks.find_one({"challenge_id": c["id"]}, {"_id": 0}, sort=[("order_index", 1)])
        if not first:
            return {"challenge": _public_challenge_summary(c), "track": None, "entries": []}
        track_id = first["id"]
    # reuse f1 leaderboard logic (inline-light)
    track = await db.f1_tracks.find_one({"id": track_id}, {"_id": 0})
    times = await db.f1_lap_times.find(
        {"challenge_id": c["id"], "track_id": track_id, "is_invalid": {"$ne": True}},
        {"_id": 0, "admin_note": 0, "proof_url": 0},
    ).to_list(5000)
    best_per_user = {}
    for t in times:
        eff = t["time_ms"] + int(t.get("penalty_seconds", 0) * 1000)
        if t["user_id"] not in best_per_user or eff < best_per_user[t["user_id"]]["effective_ms"]:
            best_per_user[t["user_id"]] = {**t, "effective_ms": eff}
    user_ids = list(best_per_user.keys())
    users = {u["id"]: u for u in await db.users.find(
        {"id": {"$in": user_ids}}, {"_id": 0, "password_hash": 0, "email": 0, "mfa_secret": 0, "mfa_pending_secret": 0, "mfa_recovery_code_hashes": 0}).to_list(500)}
    entries = []
    for uid, tr in best_per_user.items():
        u = users.get(uid, {})
        m = tr["effective_ms"]
        entries.append({"display_name": u.get("display_name") or u.get("username") or "—",
                         "time_ms": m,
                         "time_str": f"{m//60000}:{(m%60000)//1000:02d}.{m%1000:03d}"})
    entries.sort(key=lambda e: e["time_ms"])
    for i, e in enumerate(entries):
        e["rank"] = i + 1
        e["gap_ms"] = e["time_ms"] - entries[0]["time_ms"] if i > 0 else 0
        e["gap_str"] = f"+{e['gap_ms']/1000:.3f}s" if i > 0 else ""
    return {"challenge": _public_challenge_summary(c),
            "track": track, "entries": entries}
