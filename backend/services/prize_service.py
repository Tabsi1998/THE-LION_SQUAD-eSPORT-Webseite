"""Phase 9: PrizePickup service. Auto-creates pickup tickets when tournaments
publish results, sends emails via the mail queue and tracks pickup status.

Status flow: pending  → ready → picked_up
                              → expired (after deadline reached)
"""
import logging
from datetime import datetime, timedelta
from typing import Optional

from database import get_db
from models import new_id, now_utc
from services.competition_read import load_competition_read_model, observe_structure_read
from services.competition_standings import placements_for_structure

logger = logging.getLogger("tls.prizes")

DEFAULT_PICKUP_WINDOW_DAYS = 90


def _log_safe(value, limit: int = 160) -> str:
    return str(value or "").replace("\r", " ").replace("\n", " ")[:limit]


def _ordinal(rank: int) -> str:
    return f"{rank}."


def place_phrase(label, place: int) -> str:
    """Der Platz für die Gewinn-Meldung (#1941): „1. Platz“ - „Platz“ steht genau einmal. Eine Bezeichnung mit „Platz“
    („1. Platz“, „Platz 2“, „Letzter Platz“) bleibt, eine bloße Zahl („3.“) oder keine bekommt es dazu, ein eigener
    Name („Sieger“) bleibt, wie er ist."""
    text = " ".join(str(label or "").split())
    if not text or text.rstrip(".").isdigit():
        return f"{text.rstrip('.') or place}. Platz"
    return text


def _resolve_prize_place(raw_place, placements: dict[int, list[dict]]) -> int | None:
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
    read_model = await load_competition_read_model(db, tid)
    snapshot = read_model.structure_snapshot()
    observe_structure_read(snapshot, surface="prize_pickups")

    overall = placements_for_structure(snapshot, regs, tournament=t)

    winner_sections = {"wb", "winner", "main", "final", "gf", "grand_final"}
    loser_sections = {"lb", "loser"}
    winner = placements_for_structure(snapshot, regs, sections=winner_sections, tournament=t)
    if not winner:
        winner = overall
    loser = placements_for_structure(snapshot, regs, sections=loser_sections, tournament=t)
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
        # Ein geteilter Platz (#1593): jeder, der ihn hält, bekommt den Preis - je Person höchstens einmal.
        for winner in placement_by_rank.get(place) or []:
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
                        f"{place_phrase(doc.get('place_label'), place)} bei {t.get('title') or 'dem Turnier'}: {prize_text}. Sobald der Gewinn abholbereit ist, bekommst du die nächste Meldung.",
                        url="/me/prizes",
                        kind="prize_pending",
                        meta={"tournament_id": tid, "pickup_id": doc["id"], "place": place},
                    )
                except Exception:
                    logger.warning("[prizes] notification failed for pickup %s", _log_safe(doc.get("id")), exc_info=True)
            logger.info("[prizes] created pickup %s place %s tournament %s", _log_safe(doc.get("id")), place, _log_safe(tid))
    return created


async def auto_create_for_f1_challenge(challenge_id: str) -> int:
    """Build PrizePickups for Fast-Lap results when results are published.

    Non-championship challenges create pickups per track. Championship challenges
    create pickups from the overall championship standings.
    """
    return (await _sync_f1_prizes(challenge_id, review_stale=False))["created"]


async def review_f1_prizes(challenge_id: str) -> dict:
    """Gewinne nach einer Korrektur veröffentlichter Ergebnisse (#1584): fehlende für die neue Rangfolge anlegen; wer
    nicht mehr auf dem Platz steht, behält seinen Gewinn - er bekommt ``needs_review`` („nach Korrektur prüfen“), auch
    wenn er schon ausgegeben ist. Passt ein markierter Gewinn wieder, fällt die Markierung weg."""
    return await _sync_f1_prizes(challenge_id, review_stale=True)


async def _sync_f1_prizes(challenge_id: str, *, review_stale: bool) -> dict:
    db = get_db()
    result = {"created": 0, "to_review": 0}
    challenge = await db.f1_challenges.find_one({"id": challenge_id}, {"_id": 0}) or {}
    prize_places = challenge.get("prize_places") or []
    if not challenge or not prize_places:
        return result

    prize_ranks: list[tuple[int, dict]] = []
    for prize in prize_places:
        try:
            rank = int(prize.get("place"))
        except Exception:
            continue
        if rank > 0:
            prize_ranks.append((rank, prize))
    if not prize_ranks:
        return result

    tracks = await db.f1_tracks.find({"challenge_id": challenge_id}, {"_id": 0}).sort("order_index", 1).to_list(100)
    if not tracks:
        return result

    slug_or_id = challenge.get("slug") or challenge_id
    deadline = (now_utc() + timedelta(days=DEFAULT_PICKUP_WINDOW_DAYS)).isoformat()

    async def create_pickup(user_id: str, place: int, prize: dict, source_key: str, source_label: str, track: dict | None = None) -> bool:
        key = {"source_type": "fastlap", "fastlap_challenge_id": challenge_id, "fastlap_source_key": source_key,
               "place": place, "user_id": user_id}
        if await db.prize_pickups.find_one(key, {"_id": 1}):
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
        # Einmal je Platz und Person (#1584): Upsert auf den eindeutigen Schlüssel - zwei gleichzeitige Abgleiche legen
        # keinen zweiten Gewinn an.
        written = await db.prize_pickups.update_one(key, {"$setOnInsert": doc}, upsert=True)
        if getattr(written, "upserted_id", None) is None:
            return False
        try:
            from services.user_notifications import create_user_notification
            prize_text = doc.get("prize_value") or doc.get("prize_label") or "ein Preis"
            await create_user_notification(
                user_id,
                "Fast-Lap Gewinn vorgemerkt",
                f"{source_label}: {place_label} bei {challenge.get('title') or 'Fast Lap'} - {prize_text}. Sobald der Gewinn abholbereit ist, bekommst du die nächste Meldung.",
                url="/me/prizes",
                kind="prize_pending",
                meta={"source_type": "fastlap", "challenge_id": challenge_id, "pickup_id": doc["id"], "place": place, "source_key": source_key},
            )
        except Exception:
            logger.warning("[prizes] f1 notification failed for pickup %s", _log_safe(doc.get("id")), exc_info=True)
        logger.info("[prizes] created f1 pickup %s place %s challenge %s", _log_safe(doc.get("id")), place, _log_safe(challenge_id))
        return True

    # Dieselbe Rangfolge wie Tabelle und Gesamtwertung (#1584, services/fastlap_standings.py).
    from services.fastlap_standings import challenge_standings, official_times, track_ranking

    # Wer welchen Gewinn bekommt: (Person, Platz, Preis, Quelle, Bezeichnung, Strecke).
    targets: list[tuple] = []
    if challenge.get("is_championship"):
        ranked, _per_track, _tracks = await challenge_standings(db, challenge, tracks)
        for place, prize in prize_ranks:
            if place <= len(ranked):
                targets.append((ranked[place - 1]["user_id"], place, prize, "championship", "Gesamtwertung", None))
    else:
        max_rank = max(rank for rank, _ in prize_ranks)
        for track in tracks:
            ranked = track_ranking(await official_times(db, challenge_id, track["id"]))[:max_rank]
            for place, prize in prize_ranks:
                if place <= len(ranked):
                    targets.append((ranked[place - 1][0], place, prize, f"track:{track['id']}", track.get("name") or "Strecke", track))
    for user_id, place, prize, source_key, source_label, track in targets:
        if await create_pickup(user_id, place, prize, source_key, source_label, track):
            result["created"] += 1
    if not review_stale:
        return result

    wanted = {(source_key, place, user_id) for user_id, place, _prize, source_key, _label, _track in targets}
    stamp = now_utc().isoformat()
    async for pickup in db.prize_pickups.find({"source_type": "fastlap", "fastlap_challenge_id": challenge_id}, {"_id": 0}):
        stale = (pickup.get("fastlap_source_key"), pickup.get("place"), pickup.get("user_id")) not in wanted
        if stale:
            result["to_review"] += 1
        if stale != bool(pickup.get("needs_review")):
            await db.prize_pickups.update_one({"id": pickup["id"]}, {"$set": {
                "needs_review": stale,
                "review_note": "Nach einer Korrektur der Ergebnisse nicht mehr auf diesem Platz - bitte prüfen." if stale else None,
                "updated_at": stamp,
            }})
    return result


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
            except (TypeError, ValueError):
                pass  # keine oder unlesbare Abholfrist: dann nennt die Mail keine
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
