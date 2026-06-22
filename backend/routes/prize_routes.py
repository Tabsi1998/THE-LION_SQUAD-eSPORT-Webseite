"""Phase 9: PrizePickup admin + user routes."""
from datetime import timedelta
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, Literal

from database import get_db
from auth import require_admin, get_current_user
from models import now_utc, new_id
from services.prize_service import DEFAULT_PICKUP_WINDOW_DAYS, mark_ready, mark_picked_up
from services.visibility import user_can_see

router = APIRouter(prefix="/api/prizes", tags=["prizes"])

PrizeStatus = Literal["pending", "ready", "picked_up", "expired"]
RESULT_CERTIFICATE_STATUSES = {"completed", "results_published", "archived"}


class PrizeUpdate(BaseModel):
    status: Optional[PrizeStatus] = None
    notes: Optional[str] = None
    pickup_deadline: Optional[str] = None
    prize_label: Optional[str] = None
    prize_value: Optional[str] = None


async def _hydrate_pickups(pickups: list[dict]) -> list[dict]:
    """Attach safe recipient context for admin and user prize views."""
    if not pickups:
        return pickups
    db = get_db()
    user_ids = list({p.get("user_id") for p in pickups if p.get("user_id")})
    team_ids = list({p.get("team_id") for p in pickups if p.get("team_id")})
    users = await db.users.find(
        {"id": {"$in": user_ids}},
        {"_id": 0, "id": 1, "display_name": 1, "username": 1, "email": 1, "avatar_url": 1},
    ).to_list(500) if user_ids else []
    teams = await db.teams.find(
        {"id": {"$in": team_ids}},
        {"_id": 0, "id": 1, "name": 1, "tag": 1, "logo_url": 1, "member_ids": 1},
    ).to_list(500) if team_ids else []
    user_map = {u["id"]: u for u in users}
    team_map = {t["id"]: t for t in teams}
    for p in pickups:
        user = user_map.get(p.get("user_id")) or {}
        team = team_map.get(p.get("team_id")) or {}
        if team:
            p["recipient_type"] = "team"
            p["recipient_label"] = team.get("tag") or team.get("name") or "Team"
            p["recipient_subtitle"] = team.get("name") or f"{len(team.get('member_ids') or [])} Mitglieder"
            p["recipient_url"] = f"/teams/{team.get('id')}"
            p["team"] = {k: team.get(k) for k in ("id", "name", "tag", "logo_url", "member_ids")}
        else:
            p["recipient_type"] = "user"
            p["recipient_label"] = user.get("display_name") or user.get("username") or "Unbekannter User"
            p["recipient_subtitle"] = user.get("email") or user.get("username") or ""
            p["recipient_url"] = f"/u/{user.get('username')}" if user.get("username") else None
        p["display_name"] = p["recipient_label"]
        p["email"] = user.get("email")
        if user:
            p["user"] = {k: user.get(k) for k in ("id", "display_name", "username", "avatar_url")}
    return pickups


@router.get("")
async def list_prizes(
    status: Optional[PrizeStatus] = None,
    tournament_id: Optional[str] = None,
    source_type: Optional[Literal["tournament", "fastlap"]] = None,
    me: dict = Depends(require_admin()),
):
    db = get_db()
    q: dict = {}
    if status:
        q["status"] = status
    if tournament_id:
        q["tournament_id"] = tournament_id
    if source_type == "fastlap":
        q["source_type"] = "fastlap"
    elif source_type == "tournament":
        q["$or"] = [{"source_type": {"$exists": False}}, {"source_type": "tournament"}]
    pickups = await db.prize_pickups.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    return await _hydrate_pickups(pickups)


@router.get("/me")
async def my_prizes(me: dict = Depends(get_current_user)):
    db = get_db()
    team_ids = [
        t["id"] for t in await db.teams.find(
            {"member_ids": me["id"]}, {"_id": 0, "id": 1}
        ).to_list(100)
    ]
    q = {"$or": [{"user_id": me["id"]}]}
    if team_ids:
        q["$or"].append({"team_id": {"$in": team_ids}})
    pickups = await db.prize_pickups.find(
        q, {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    return await _hydrate_pickups(pickups)


def _top4_rank(row: dict | None) -> int | None:
    try:
        rank = int((row or {}).get("rank") or 0)
    except (TypeError, ValueError):
        return None
    return rank if 1 <= rank <= 4 else None


def _certificate_url(path: str, params: dict | None = None) -> str:
    query = urlencode({k: v for k, v in (params or {}).items() if v not in (None, "")})
    return path + (f"?{query}" if query else "")


def _certificate_label(rank: int) -> str:
    return {1: "Siegerurkunde", 2: "Urkunde zum 2. Platz", 3: "Urkunde zum 3. Platz", 4: "Urkunde zum 4. Platz"}.get(rank, "Urkunde")


async def _my_team_ids(db, user_id: str) -> list[str]:
    member_rows = await db.team_members.find({"user_id": user_id}, {"_id": 0, "team_id": 1}).to_list(200)
    ids = {row.get("team_id") for row in member_rows if row.get("team_id")}
    team_rows = await db.teams.find({"member_ids": user_id}, {"_id": 0, "id": 1}).to_list(200)
    ids.update(row.get("id") for row in team_rows if row.get("id"))
    return sorted(ids)


async def _my_tournament_certificates(db, me: dict) -> list[dict]:
    team_ids = await _my_team_ids(db, me["id"])
    query = {"$or": [{"user_id": me["id"]}]}
    if team_ids:
        query["$or"].append({"team_id": {"$in": team_ids}})
    regs = await db.tournament_registrations.find(query, {"_id": 0}).to_list(500)
    if not regs:
        return []
    tournament_ids = sorted({reg.get("tournament_id") for reg in regs if reg.get("tournament_id")})
    tournaments = await db.tournaments.find(
        {"id": {"$in": tournament_ids}, "status": {"$in": list(RESULT_CERTIFICATE_STATUSES)}},
        {"_id": 0, "id": 1, "slug": 1, "title": 1, "status": 1, "visibility": 1, "is_public": 1, "start_date": 1},
    ).to_list(500)
    tournament_map = {
        item["id"]: item
        for item in tournaments
        if item.get("is_public") is not False
        and item.get("status") in RESULT_CERTIFICATE_STATUSES
        and await user_can_see(me, item.get("visibility") or "public")
    }
    if not tournament_map:
        return []

    from routes.tournament_routes import standings as tournament_standings

    result = []
    regs_by_tournament: dict[str, list[dict]] = {}
    for reg in regs:
        if reg.get("tournament_id") in tournament_map:
            regs_by_tournament.setdefault(reg["tournament_id"], []).append(reg)
    for tournament_id, own_regs in regs_by_tournament.items():
        tournament = tournament_map.get(tournament_id)
        if not tournament:
            continue
        rows = await tournament_standings(tournament_id, user=me)
        rows_by_registration = {row.get("registration_id"): row for row in rows or [] if row.get("registration_id")}
        slug_or_id = tournament.get("slug") or tournament["id"]
        for reg in own_regs:
            row = rows_by_registration.get(reg.get("id"))
            rank = _top4_rank(row)
            if not rank:
                continue
            result.append({
                "id": f"tournament:{tournament['id']}:{reg['id']}",
                "source_type": "tournament",
                "title": tournament.get("title") or "Turnier",
                "category": "Gesamtwertung",
                "rank": rank,
                "label": _certificate_label(rank),
                "display_name": row.get("display_name") or reg.get("display_name"),
                "source_url": f"/tournaments/{slug_or_id}/standings",
                "download_url": f"/api/exports/tournaments/{slug_or_id}/certificates/{reg['id']}.pdf",
                "sort_date": tournament.get("start_date") or "",
            })
    return result


async def _my_f1_certificates(db, me: dict) -> list[dict]:
    lap_query = {
        "user_id": me["id"],
        "is_invalid": {"$ne": True},
        "$or": [{"score_scope": {"$exists": False}}, {"score_scope": {"$ne": "club_reference"}}],
    }
    laps = await db.f1_lap_times.find(lap_query, {"_id": 0, "challenge_id": 1, "track_id": 1}).to_list(2000)
    if not laps:
        return []
    challenge_ids = sorted({row.get("challenge_id") for row in laps if row.get("challenge_id")})
    challenges = await db.f1_challenges.find(
        {"id": {"$in": challenge_ids}, "status": {"$in": list(RESULT_CERTIFICATE_STATUSES)}},
        {"_id": 0, "id": 1, "slug": 1, "title": 1, "status": 1, "visibility": 1, "is_public": 1, "is_championship": 1, "start_date": 1},
    ).to_list(500)
    challenge_map = {
        item["id"]: item
        for item in challenges
        if item.get("is_public") is not False
        and item.get("status") in RESULT_CERTIFICATE_STATUSES
        and await user_can_see(me, item.get("visibility") or "public")
    }
    if not challenge_map:
        return []

    from routes.f1_routes import leaderboard as f1_leaderboard, championship_standings

    result = []
    tracks_by_challenge: dict[str, set[str]] = {}
    for lap in laps:
        if lap.get("challenge_id") in challenge_map and lap.get("track_id"):
            tracks_by_challenge.setdefault(lap["challenge_id"], set()).add(lap["track_id"])

    for challenge_id, challenge in challenge_map.items():
        slug_or_id = challenge.get("slug") or challenge["id"]
        if challenge.get("is_championship"):
            standings = await championship_standings(challenge_id, user=me)
            row = next((item for item in standings.get("standings") or [] if item.get("user_id") == me["id"]), None)
            rank = _top4_rank(row)
            if rank:
                result.append({
                    "id": f"fastlap-championship:{challenge['id']}:{me['id']}",
                    "source_type": "fastlap",
                    "title": challenge.get("title") or "Fast Lap",
                    "category": "Gesamtwertung",
                    "rank": rank,
                    "label": _certificate_label(rank),
                    "display_name": row.get("display_name") or me.get("display_name") or me.get("username"),
                    "source_url": f"/fastlap/{slug_or_id}",
                    "download_url": f"/api/exports/f1/{slug_or_id}/championship-certificates/{me['id']}.pdf",
                    "sort_date": challenge.get("start_date") or "",
                })
            continue

        for track_id in sorted(tracks_by_challenge.get(challenge_id) or []):
            board = await f1_leaderboard(challenge_id, track_id=track_id, user=me)
            row = next((item for item in board.get("entries") or [] if item.get("user_id") == me["id"]), None)
            rank = _top4_rank(row)
            if not rank:
                continue
            track = board.get("track") or {}
            result.append({
                "id": f"fastlap-track:{challenge['id']}:{track_id}:{me['id']}",
                "source_type": "fastlap",
                "title": challenge.get("title") or "Fast Lap",
                "category": track.get("name") or "Streckenwertung",
                "rank": rank,
                "label": _certificate_label(rank),
                "display_name": row.get("display_name") or me.get("display_name") or me.get("username"),
                "source_url": f"/fastlap/{slug_or_id}",
                "download_url": _certificate_url(
                    f"/api/exports/f1/{slug_or_id}/certificates/{me['id']}.pdf",
                    {"track_id": track_id},
                ),
                "sort_date": challenge.get("start_date") or "",
            })
    return result


@router.get("/me/certificates")
async def my_certificates(me: dict = Depends(get_current_user)):
    db = get_db()
    rows = [*await _my_tournament_certificates(db, me), *await _my_f1_certificates(db, me)]
    rows.sort(
        key=lambda item: (
            item.get("sort_date") or "",
            -(int(item.get("rank") or 999)),
            item.get("title") or "",
        ),
        reverse=True,
    )
    return rows[:100]


@router.get("/me/open-count")
async def my_open_prize_count(me: dict = Depends(get_current_user)):
    """Lightweight endpoint for dashboard hint badge."""
    db = get_db()
    team_ids = [
        t["id"] for t in await db.teams.find(
            {"member_ids": me["id"]}, {"_id": 0, "id": 1}
        ).to_list(100)
    ]
    q = {
        "$or": [{"user_id": me["id"]}],
        "status": {"$in": ["pending", "ready"]},
    }
    if team_ids:
        q["$or"].append({"team_id": {"$in": team_ids}})
    count = await db.prize_pickups.count_documents({
        **q,
    })
    return {"count": count}


@router.put("/{pickup_id}")
@router.patch("/{pickup_id}")
async def update_prize(pickup_id: str, body: PrizeUpdate, me: dict = Depends(require_admin())):
    db = get_db()
    pickup = await db.prize_pickups.find_one({"id": pickup_id}, {"_id": 0})
    if not pickup:
        raise HTTPException(status_code=404, detail="Gewinn nicht gefunden")
    new_status = body.status
    if new_status == "ready":
        return await mark_ready(pickup_id, me["id"]) or pickup
    if new_status == "picked_up":
        return await mark_picked_up(pickup_id, me["id"], body.notes or "") or pickup
    # generic patch
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if not updates:
        return pickup
    updates["updated_at"] = now_utc().isoformat()
    await db.prize_pickups.update_one({"id": pickup_id}, {"$set": updates})
    await db.audit_logs.insert_one({
        "id": new_id(), "actor_id": me["id"], "action": "prizes.update",
        "entity_id": pickup_id, "details": updates,
        "created_at": now_utc().isoformat(),
    })
    return await db.prize_pickups.find_one({"id": pickup_id}, {"_id": 0})


@router.delete("/{pickup_id}")
async def delete_prize(pickup_id: str, me: dict = Depends(require_admin())):
    db = get_db()
    res = await db.prize_pickups.delete_one({"id": pickup_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Gewinn nicht gefunden")
    return {"ok": True}


class PrizeCreate(BaseModel):
    tournament_id: str
    user_id: str
    place: int
    prize_label: str
    prize_value: Optional[str] = ""
    pickup_deadline: Optional[str] = None


@router.post("")
async def create_prize_manually(body: PrizeCreate, me: dict = Depends(require_admin())):
    db = get_db()
    t = await db.tournaments.find_one({"id": body.tournament_id}, {"_id": 0}) or {}
    user = await db.users.find_one({"id": body.user_id}, {"_id": 0, "id": 1})
    if not user:
        raise HTTPException(status_code=404, detail="Benutzer nicht gefunden")
    existing = await db.prize_pickups.find_one({
        "tournament_id": body.tournament_id,
        "user_id": body.user_id,
        "team_id": None,
        "place": body.place,
    })
    if existing:
        raise HTTPException(status_code=409, detail="Für diesen Benutzer und Platz existiert bereits ein Gewinn")
    deadline = body.pickup_deadline or (now_utc() + timedelta(days=DEFAULT_PICKUP_WINDOW_DAYS)).isoformat()
    doc = {
        "id": new_id(),
        "tournament_id": body.tournament_id,
        "tournament_title": t.get("title"),
        "tournament_slug": t.get("slug"),
        "user_id": body.user_id,
        "team_id": None,
        "place": body.place,
        "place_label": str(body.place),
        "prize_label": body.prize_label,
        "prize_value": body.prize_value or "",
        "status": "pending",
        "pickup_deadline": deadline,
        "ready_at": None,
        "picked_up_at": None,
        "picked_up_by": None,
        "notes": "",
        "created_at": now_utc().isoformat(),
        "updated_at": now_utc().isoformat(),
    }
    await db.prize_pickups.insert_one(doc)
    await db.audit_logs.insert_one({
        "id": new_id(), "actor_id": me["id"], "action": "prizes.create",
        "entity_id": doc["id"], "details": {"tournament_id": body.tournament_id, "user_id": body.user_id, "place": body.place},
        "created_at": now_utc().isoformat(),
    })
    return {k: v for k, v in doc.items() if k != "_id"}


@router.post("/auto-create/missing")
async def auto_create_missing(me: dict = Depends(require_admin())):
    """Backfill pickups for all published tournaments and Fast-Lap challenges.

    Useful after older events were published before prize automation understood a
    result source, or after prize definitions were corrected later.
    """
    from services.prize_service import auto_create_for_f1_challenge, auto_create_for_tournament

    db = get_db()
    tournaments = await db.tournaments.find(
        {
            "status": {"$in": ["results_published", "archived"]},
            "prize_places": {"$type": "array", "$ne": []},
        },
        {"_id": 0, "id": 1, "title": 1},
    ).to_list(500)
    fastlaps = await db.f1_challenges.find(
        {
            "status": {"$in": ["results_published", "archived"]},
            "prize_places": {"$type": "array", "$ne": []},
        },
        {"_id": 0, "id": 1, "title": 1},
    ).to_list(500)

    tournament_results = []
    fastlap_results = []
    created_total = 0
    for tournament in tournaments:
        created = await auto_create_for_tournament(tournament["id"])
        created_total += created
        tournament_results.append({
            "id": tournament["id"],
            "title": tournament.get("title"),
            "created": created,
        })
    for challenge in fastlaps:
        created = await auto_create_for_f1_challenge(challenge["id"])
        created_total += created
        fastlap_results.append({
            "id": challenge["id"],
            "title": challenge.get("title"),
            "created": created,
        })
    await db.audit_logs.insert_one({
        "id": new_id(),
        "actor_id": me["id"],
        "action": "prizes.auto_create_missing",
        "entity_id": "prize_pickups",
        "details": {
            "created": created_total,
            "tournaments": len(tournament_results),
            "fastlaps": len(fastlap_results),
        },
        "created_at": now_utc().isoformat(),
    })
    return {"created": created_total, "tournaments": tournament_results, "fastlaps": fastlap_results}


@router.post("/auto-create/{tournament_id}")
async def auto_create(tournament_id: str, me: dict = Depends(require_admin())):
    """Manual trigger to (re)create pickups for a tournament — useful when
    results were corrected after publishing."""
    from services.prize_service import auto_create_for_tournament
    n = await auto_create_for_tournament(tournament_id)
    return {"created": n}


@router.post("/auto-create/fastlap/{challenge_id}")
async def auto_create_fastlap(challenge_id: str, me: dict = Depends(require_admin())):
    """Manual trigger to create pickups for a Fast-Lap challenge."""
    from services.prize_service import auto_create_for_f1_challenge
    n = await auto_create_for_f1_challenge(challenge_id)
    return {"created": n}
