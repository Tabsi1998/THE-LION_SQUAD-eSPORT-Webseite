"""Phase 9: PrizePickup service. Auto-creates pickup tickets when tournaments
publish results, sends emails via the mail queue and tracks pickup status.

Status flow: pending  → ready → picked_up
                              → expired (after deadline reached)
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from database import get_db
from models import new_id, now_utc

logger = logging.getLogger("tls.prizes")

DEFAULT_PICKUP_WINDOW_DAYS = 90


def _log_safe(value, limit: int = 160) -> str:
    return str(value or "").replace("\r", " ").replace("\n", " ")[:limit]


def _ordinal(rank: int) -> str:
    return f"{rank}."


def _section_key(value) -> str:
    return str(value or "").strip().lower()


def _match_section(match: dict) -> str:
    return _section_key(match.get("section") or match.get("bracket"))


def _stage_standings(matches_v2: list[dict], regs: list[dict], sections: set[str] | None = None) -> list[dict]:
    """Rank stage-engine registrations using the same public standings signals."""
    rank_map = {
        r["id"]: {
            "registration_id": r["id"],
            "played": 0,
            "won": 0,
            "top2": 0,
            "lost": 0,
            "points": 0,
            "rank_sum": 0,
            "furthest_round": 0,
            "best_rank": None,
        }
        for r in regs
        if r.get("id")
    }
    wanted_sections = {_section_key(section) for section in sections or set() if section}
    for match in matches_v2:
        if wanted_sections and _match_section(match) not in wanted_sections:
            continue
        if match.get("status") not in {"completed", "forfeit"}:
            continue
        for result in match.get("results") or []:
            rid = result.get("registration_id")
            if rid not in rank_map:
                continue
            rank = int(result.get("rank") or 999)
            row = rank_map[rid]
            row["played"] += 1
            row["rank_sum"] += rank
            row["furthest_round"] = max(row["furthest_round"], int(match.get("round") or 0))
            row["best_rank"] = rank if row["best_rank"] is None else min(row["best_rank"], rank)
            if rank == 1:
                row["won"] += 1
            if rank <= 2:
                row["top2"] += 1
            else:
                row["lost"] += 1
            score = result.get("points")
            if score is None:
                score = result.get("score")
            if isinstance(score, (int, float)):
                row["points"] += score
    rows = list(rank_map.values())
    for row in rows:
        row["avg_rank"] = round(row["rank_sum"] / row["played"], 2) if row["played"] else None
    rows.sort(key=lambda row: (
        row["furthest_round"],
        row["won"],
        row["top2"],
        row["points"],
        -(row["avg_rank"] or 999),
    ), reverse=True)
    for index, row in enumerate(rows, start=1):
        row["rank"] = index
    return [row for row in rows if row.get("played")]


def _placements_from_stage(matches_v2: list[dict], regs: list[dict], sections: set[str] | None = None) -> dict[int, dict]:
    reg_map = {r["id"]: r for r in regs if r.get("id")}
    placements: dict[int, dict] = {}
    for row in _stage_standings(matches_v2, regs, sections):
        rid = row.get("registration_id")
        rank = row.get("rank")
        reg = reg_map.get(rid)
        if not rid or not rank or not reg or rank in placements:
            continue
        placements[int(rank)] = {
            "user_id": reg.get("user_id"),
            "team_id": reg.get("team_id"),
        }
    return placements


def _placements_from_legacy(matches: list[dict], reg_map: dict[str, dict], sections: set[str] | None = None) -> dict[int, dict]:
    placements: dict[int, dict] = {}
    wanted_sections = {_section_key(section) for section in sections or set() if section}
    for match in matches:
        if wanted_sections and _match_section(match) not in wanted_sections:
            continue
        rid = match.get("winner_id")
        rank = match.get("final_position")
        if not rid or not rank or rid not in reg_map:
            continue
        rank = int(rank)
        if rank in placements:
            continue
        reg = reg_map[rid]
        placements[rank] = {
            "user_id": reg.get("user_id"),
            "team_id": reg.get("team_id"),
        }
    return placements


def _resolve_prize_place(raw_place, placements: dict[int, dict]) -> int | None:
    try:
        if str(raw_place).lower() in {"last", "letzter", "-1"}:
            return max(placements.keys(), default=0) or None
        place = int(raw_place)
        return place if place > 0 else None
    except Exception:
        return None


async def auto_create_for_tournament(tid: str) -> int:
    """Build PrizePickups when tournament results are published.

    Reads `prize_places` (list of {group, place, label, value}) and the placements that
    were derived from legacy finals or stage-engine standings. Idempotent: skips
    already-existing (tournament_id, user_id, team_id, place) combinations.
    """
    db = get_db()
    t = await db.tournaments.find_one({"id": tid}, {"_id": 0}) or {}
    prize_places = t.get("prize_places") or []
    if not prize_places:
        return 0

    regs = await db.tournament_registrations.find({"tournament_id": tid}, {"_id": 0}).to_list(500)
    reg_map = {r["id"]: r for r in regs}
    matches = await db.matches.find(
        {"tournament_id": tid, "final_position": {"$ne": None}}, {"_id": 0}
    ).to_list(500)
    matches_v2 = await db.matches_v2.find({"tournament_id": tid}, {"_id": 0}).to_list(3000)

    overall = _placements_from_legacy(matches, reg_map)
    if not overall and matches_v2:
        overall = _placements_from_stage(matches_v2, regs)

    winner_sections = {"wb", "winner", "main", "final", "gf", "grand_final"}
    loser_sections = {"lb", "loser"}
    winner = _placements_from_legacy(matches, reg_map, winner_sections)
    if not winner and matches_v2:
        winner = _placements_from_stage(matches_v2, regs, winner_sections)
    if not winner:
        winner = overall
    loser = _placements_from_legacy(matches, reg_map, loser_sections)
    if not loser and matches_v2:
        loser = _placements_from_stage(matches_v2, regs, loser_sections)
    placements_by_group = {
        "overall": overall,
        "winner": winner,
        "loser": loser,
    }

    created = 0
    deadline = (now_utc() + timedelta(days=DEFAULT_PICKUP_WINDOW_DAYS)).isoformat()
    for prize in prize_places:
        prize_group = prize.get("group") or "overall"
        if prize_group not in placements_by_group:
            continue
        placement_by_rank = placements_by_group.get(prize_group) or {}
        place = _resolve_prize_place(prize.get("place"), placement_by_rank)
        if not place:
            continue
        winner = placement_by_rank.get(place)
        if not winner:
            continue
        uid = winner.get("user_id")
        team_id = winner.get("team_id")
        if not (uid or team_id):
            continue
        # idempotent
        existing = await db.prize_pickups.find_one({
            "tournament_id": tid,
            "place": place,
            "user_id": uid,
            "team_id": team_id,
        })
        if existing:
            continue
        doc = {
            "id": new_id(),
            "tournament_id": tid,
            "tournament_title": t.get("title"),
            "tournament_slug": t.get("slug"),
            "user_id": uid,
            "team_id": team_id,
            "place": place,
            "prize_group": prize_group,
            "place_label": prize.get("label") or _ordinal(place),
            "prize_label": prize.get("label") or "",
            "prize_value": prize.get("value") or "",
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
        created += 1
        if uid:
            try:
                from services.user_notifications import create_user_notification
                prize_text = doc.get("prize_value") or doc.get("prize_label") or "ein Preis"
                await create_user_notification(
                    uid,
                    "Gewinn vorgemerkt",
                    f"{doc.get('place_label') or _ordinal(place)} Platz bei {t.get('title') or 'dem Turnier'}: {prize_text}. Sobald der Gewinn abholbereit ist, bekommst du die nächste Meldung.",
                    url="/me/prizes",
                    kind="prize_pending",
                    meta={"tournament_id": tid, "pickup_id": doc["id"], "place": place},
                )
            except Exception as exc:
                logger.warning("[prizes] notification failed for pickup %s", _log_safe(doc.get("id")), exc_info=True)
        logger.info("[prizes] created pickup %s place %s tournament %s", _log_safe(doc.get("id")), place, _log_safe(tid))
    return created


def _effective_lap_ms(row: dict) -> int:
    return int(row.get("time_ms") or 0) + int((row.get("penalty_seconds") or 0) * 1000)


def _rank_best_laps(times: list[dict]) -> list[dict]:
    best_per_user: dict[str, dict] = {}
    for row in times:
        uid = row.get("user_id")
        if not uid:
            continue
        effective = _effective_lap_ms(row)
        if uid not in best_per_user or effective < best_per_user[uid]["effective_ms"]:
            best_per_user[uid] = {**row, "effective_ms": effective}
    return sorted(best_per_user.values(), key=lambda row: row["effective_ms"])


def _official_f1_time_query(extra: dict | None = None) -> dict:
    return {
        **(extra or {}),
        "is_invalid": {"$ne": True},
        "$or": [{"score_scope": {"$exists": False}}, {"score_scope": {"$ne": "club_reference"}}],
    }


async def _f1_championship_rankings(db, challenge: dict, tracks: list[dict]) -> list[dict]:
    points_system = challenge.get("points_per_position") or [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]
    totals: dict[str, dict] = {}
    for track in tracks:
        times = await db.f1_lap_times.find(
            _official_f1_time_query({"challenge_id": challenge["id"], "track_id": track["id"]}),
            {"_id": 0},
        ).to_list(5000)
        for pos, row in enumerate(_rank_best_laps(times)):
            uid = row.get("user_id")
            if not uid:
                continue
            pts = points_system[pos] if pos < len(points_system) else 0
            totals.setdefault(uid, {"user_id": uid, "points": 0, "wins": 0, "races": 0})
            totals[uid]["points"] += pts
            totals[uid]["races"] += 1
            if pos == 0:
                totals[uid]["wins"] += 1
    return sorted(totals.values(), key=lambda row: (row["points"], row["wins"], row["races"]), reverse=True)


async def auto_create_for_f1_challenge(challenge_id: str) -> int:
    """Build PrizePickups for Fast-Lap results when results are published.

    Non-championship challenges create pickups per track. Championship challenges
    create pickups from the overall championship standings.
    """
    db = get_db()
    challenge = await db.f1_challenges.find_one({"id": challenge_id}, {"_id": 0}) or {}
    prize_places = challenge.get("prize_places") or []
    if not challenge or not prize_places:
        return 0

    prize_ranks: list[tuple[int, dict]] = []
    for prize in prize_places:
        try:
            rank = int(prize.get("place"))
        except Exception:
            continue
        if rank > 0:
            prize_ranks.append((rank, prize))
    if not prize_ranks:
        return 0

    tracks = await db.f1_tracks.find({"challenge_id": challenge_id}, {"_id": 0}).sort("order_index", 1).to_list(100)
    if not tracks:
        return 0

    slug_or_id = challenge.get("slug") or challenge_id
    deadline = (now_utc() + timedelta(days=DEFAULT_PICKUP_WINDOW_DAYS)).isoformat()
    created = 0

    async def create_pickup(user_id: str, place: int, prize: dict, source_key: str, source_label: str, track: dict | None = None) -> bool:
        existing = await db.prize_pickups.find_one({
            "source_type": "fastlap",
            "fastlap_challenge_id": challenge_id,
            "fastlap_source_key": source_key,
            "place": place,
            "user_id": user_id,
            "team_id": None,
        })
        if existing:
            return False
        place_label = prize.get("label") or _ordinal(place)
        doc = {
            "id": new_id(),
            "source_type": "fastlap",
            "fastlap_challenge_id": challenge_id,
            "fastlap_challenge_title": challenge.get("title"),
            "fastlap_challenge_slug": challenge.get("slug"),
            "fastlap_track_id": track.get("id") if track else None,
            "fastlap_track_name": track.get("name") if track else None,
            "fastlap_source_key": source_key,
            "fastlap_source_label": source_label,
            "source_url": f"/fastlap/{slug_or_id}",
            "tournament_id": None,
            "tournament_title": challenge.get("title"),
            "tournament_slug": None,
            "user_id": user_id,
            "team_id": None,
            "place": place,
            "prize_group": prize.get("group") or ("championship" if challenge.get("is_championship") else "track"),
            "place_label": place_label,
            "prize_label": place_label,
            "prize_value": prize.get("value") or "",
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
        try:
            from services.user_notifications import create_user_notification
            prize_text = doc.get("prize_value") or doc.get("prize_label") or "ein Preis"
            await create_user_notification(
                user_id,
                "Fast-Lap Gewinn vorgemerkt",
                f"{source_label}: {place_label} bei {challenge.get('title') or 'Fast Lap'} - {prize_text}. Sobald der Gewinn abholbereit ist, bekommst du die naechste Meldung.",
                url="/me/prizes",
                kind="prize_pending",
                meta={"source_type": "fastlap", "challenge_id": challenge_id, "pickup_id": doc["id"], "place": place, "source_key": source_key},
            )
        except Exception:
            logger.warning("[prizes] f1 notification failed for pickup %s", _log_safe(doc.get("id")), exc_info=True)
        logger.info("[prizes] created f1 pickup %s place %s challenge %s", _log_safe(doc.get("id")), place, _log_safe(challenge_id))
        return True

    if challenge.get("is_championship"):
        ranked = await _f1_championship_rankings(db, challenge, tracks)
        for place, prize in prize_ranks:
            if place <= len(ranked) and await create_pickup(ranked[place - 1]["user_id"], place, prize, "championship", "Gesamtwertung"):
                created += 1
        return created

    max_rank = max(rank for rank, _ in prize_ranks)
    for track in tracks:
        times = await db.f1_lap_times.find(
            _official_f1_time_query({"challenge_id": challenge_id, "track_id": track["id"]}),
            {"_id": 0},
        ).to_list(5000)
        ranked = _rank_best_laps(times)[:max_rank]
        for place, prize in prize_ranks:
            if place <= len(ranked) and await create_pickup(ranked[place - 1]["user_id"], place, prize, f"track:{track['id']}", track.get("name") or "Strecke", track):
                created += 1
    return created


async def mark_ready(pickup_id: str, actor_id: str) -> Optional[dict]:
    db = get_db()
    p = await db.prize_pickups.find_one({"id": pickup_id})
    if not p:
        return None
    await db.prize_pickups.update_one(
        {"id": pickup_id},
        {"$set": {
            "status": "ready",
            "ready_at": now_utc().isoformat(),
            "updated_at": now_utc().isoformat(),
        }},
    )
    # Mail user
    if p.get("user_id"):
        u = await db.users.find_one(
            {"id": p["user_id"]},
            {"email": 1, "display_name": 1, "username": 1, "newsletter_consent": 1, "notification_preferences": 1},
        )
        if u and u.get("email"):
            from services.notification_preferences import send_user_template
            deadline_str = ""
            try:
                deadline_str = datetime.fromisoformat(p.get("pickup_deadline")).strftime("%d.%m.%Y")
            except Exception:
                pass
            await send_user_template(
                u, "prize_ready",
                display_name=u.get("display_name", ""),
                tournament_title=p.get("tournament_title", ""),
                place=str(p.get("place_label") or p.get("place")),
                prize_label=p.get("prize_label", ""),
                deadline=deadline_str,
            )
    return await db.prize_pickups.find_one({"id": pickup_id}, {"_id": 0})


async def mark_picked_up(pickup_id: str, actor_id: str, notes: str = "") -> Optional[dict]:
    db = get_db()
    p = await db.prize_pickups.find_one({"id": pickup_id})
    if not p:
        return None
    await db.prize_pickups.update_one(
        {"id": pickup_id},
        {"$set": {
            "status": "picked_up",
            "picked_up_at": now_utc().isoformat(),
            "picked_up_by": actor_id,
            "notes": notes or p.get("notes", ""),
            "updated_at": now_utc().isoformat(),
        }},
    )
    if p.get("user_id"):
        u = await db.users.find_one(
            {"id": p["user_id"]},
            {"email": 1, "display_name": 1, "username": 1, "newsletter_consent": 1, "notification_preferences": 1},
        )
        if u and u.get("email"):
            from services.notification_preferences import send_user_template
            await send_user_template(
                u, "prize_picked_up",
                display_name=u.get("display_name", ""),
                tournament_title=p.get("tournament_title", ""),
                prize_label=p.get("prize_label", ""),
            )
    return await db.prize_pickups.find_one({"id": pickup_id}, {"_id": 0})


async def expire_overdue() -> int:
    """Background sweep: mark `ready`/`pending` pickups as expired when their
    deadline is in the past. Notifies users via mail queue."""
    db = get_db()
    now_iso = now_utc().isoformat()
    cursor = db.prize_pickups.find({
        "status": {"$in": ["pending", "ready"]},
        "pickup_deadline": {"$lt": now_iso},
    })
    expired = 0
    async for p in cursor:
        await db.prize_pickups.update_one(
            {"id": p["id"]},
            {"$set": {
                "status": "expired",
                "updated_at": now_utc().isoformat(),
            }},
        )
        expired += 1
        if p.get("user_id"):
            u = await db.users.find_one(
                {"id": p["user_id"]},
                {"email": 1, "display_name": 1, "username": 1, "newsletter_consent": 1, "notification_preferences": 1},
            )
            if u and u.get("email"):
                from services.notification_preferences import send_user_template
                await send_user_template(
                    u, "prize_expired",
                    display_name=u.get("display_name", ""),
                    tournament_title=p.get("tournament_title", ""),
                    prize_label=p.get("prize_label", ""),
                    dedupe_key=f"prize_expired:{p['id']}",
                )
    return expired
