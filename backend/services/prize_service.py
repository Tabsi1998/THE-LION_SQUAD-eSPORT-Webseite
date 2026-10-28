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
    wanted: set[tuple] = set()
    for prize in prize_places:
        prize_group = prize.get("group") or "overall"
        if prize_group not in placements_by_group:
            continue  # Sonderpreise hängen an keinem Platz - die vergibt die Turnierleitung unter „Gewinne“ von Hand
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
            wanted.add((place, uid, team_id))
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
                # Die Abholfrist läuft erst ab „Bereit“ (#2123, ER1) - bis dahin liegt es am Verein, nicht am Gewinner.
                "pickup_deadline": None,
                "ready_at": None,
                "picked_up_at": None,
                "picked_up_by": None,
                "notes": "",
                "created_at": now_utc().isoformat(),
                "updated_at": now_utc().isoformat(),
            }
            await db.prize_pickups.insert_one(doc)
            created += 1
            for recipient in await prize_recipient_ids(db, doc):
                try:
                    from services.user_notifications import create_user_notification
                    prize_text = doc.get("prize_value") or doc.get("prize_label") or "ein Preis"
                    await create_user_notification(
                        recipient,
                        "Gewinn vorgemerkt",
                        f"{place_phrase(doc.get('place_label'), place)} bei {t.get('title') or 'dem Turnier'}: {prize_text}. Sobald der Gewinn abholbereit ist, bekommst du die nächste Meldung.",
                        url="/me/prizes",
                        kind="prize_pending",
                        meta={"tournament_id": tid, "pickup_id": doc["id"], "place": place},
                    )
                except Exception:
                    logger.warning("[prizes] notification failed for pickup %s", _log_safe(doc.get("id")), exc_info=True)
            logger.info("[prizes] created pickup %s place %s tournament %s", _log_safe(doc.get("id")), place, _log_safe(tid))
    await _review_tournament_prizes(db, tid, wanted, set(placements_by_group))
    return created


async def _review_tournament_prizes(db, tid: str, wanted: set[tuple], groups: set[str]) -> int:
    """Nach einer Korrektur (#2123, TA23): ein Gewinn, dessen Platz nicht mehr zur Rangfolge passt, wird nie entzogen -
    er bekommt „nach Korrektur prüfen“ (``needs_review``), wie bei Fast Lap (#1584). Passt er wieder, fällt die
    Markierung weg. Von Hand angelegte Gewinne (etwa Sonderpreise, ohne Preisgruppe) bleiben außen vor."""
    stamp = now_utc().isoformat()
    to_review = 0
    async for pickup in db.prize_pickups.find({"tournament_id": tid, "prize_group": {"$in": sorted(groups)}}, {"_id": 0}):
        stale = (pickup.get("place"), pickup.get("user_id"), pickup.get("team_id")) not in wanted
        to_review += int(stale)
        if stale != bool(pickup.get("needs_review")):
            await db.prize_pickups.update_one({"id": pickup["id"]}, {"$set": {
                "needs_review": stale,
                "review_note": "Nach einer Korrektur der Ergebnisse nicht mehr auf diesem Platz - bitte prüfen." if stale else None,
                "updated_at": stamp,
            }})
    return to_review


async def prize_recipient_ids(db, pickup: dict) -> list[str]:
    """Wer zu einem Gewinn Nachricht bekommt (#2123, ER3): die Person - bei einem Team-Gewinn ohne Person die
    Teamleitung (Kapitän)."""
    if pickup.get("user_id"):
        return [pickup["user_id"]]
    if not pickup.get("team_id"):
        return []
    team = await db.teams.find_one({"id": pickup["team_id"]}, {"_id": 0, "leader_id": 1}) or {}
    return [team["leader_id"]] if team.get("leader_id") else []


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
            "pickup_deadline": None,  # die Frist läuft ab „Bereit“ (#2123, ER1)
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


def _deadline_text(value) -> str:
    try:
        return datetime.fromisoformat(value).strftime("%d.%m.%Y")
    except (TypeError, ValueError):
        return ""  # keine oder unlesbare Abholfrist: dann nennt die Meldung keine


def ready_deadline(pickup: dict, now: datetime) -> str:
    """Die Abholfrist ab „Bereit“ (#2123, ER1): 90 Tage ab jetzt - außer die Verwaltung hat von Hand eine Frist gesetzt,
    die noch nicht vorbei ist."""
    custom = pickup.get("pickup_deadline") if pickup.get("pickup_deadline_custom") else None
    if custom and str(custom) > now.isoformat():
        return str(custom)
    return (now + timedelta(days=DEFAULT_PICKUP_WINDOW_DAYS)).isoformat()


async def _notify_prize(db, pickup: dict, *, template: str, title: str, body: str, mail: dict,
                        dedupe_key: str | None = None) -> None:
    """Bereit, abgeholt, verfallen (#2123, ER3): Glocke und Push wie bei „vorgemerkt“, dazu die Mail wie bisher - an die
    Person bzw. bei Team-Gewinnen an die Teamleitung. Eine Meldung, die scheitert, hält den Statuswechsel nicht auf."""
    from services.notification_preferences import send_user_template
    from services.user_notifications import create_user_notification

    for recipient in await prize_recipient_ids(db, pickup):
        try:
            meta = {"category": "prize_updates", "pickup_id": pickup.get("id"), "status": template}
            if pickup.get("tournament_id"):
                meta["tournament_id"] = pickup["tournament_id"]
            if dedupe_key:
                meta["dedupe_key"] = dedupe_key
            await create_user_notification(recipient, title, body, url="/me/prizes", kind="prize_status", meta=meta)
            user = await db.users.find_one(
                {"id": recipient},
                {"_id": 0, "id": 1, "email": 1, "display_name": 1, "username": 1, "newsletter_consent": 1,
                 "notification_preferences": 1},
            )
            if user and user.get("email"):
                extra = {"dedupe_key": dedupe_key} if dedupe_key else {}
                await send_user_template(user, template, display_name=user.get("display_name", ""),
                                         tournament_title=pickup.get("tournament_title", ""),
                                         prize_label=pickup.get("prize_label", ""), **mail, **extra)
        except Exception:
            logger.warning("[prizes] %s-Meldung für Gewinn %s nicht verschickt", template, _log_safe(pickup.get("id")), exc_info=True)


def _prize_text(pickup: dict) -> str:
    source = pickup.get("fastlap_challenge_title") or pickup.get("tournament_title") or "deinem Turnier"
    prize = pickup.get("prize_value") or pickup.get("prize_label") or "Dein Gewinn"
    return f"{prize} ({source})"


async def mark_ready(pickup_id: str, actor_id: str) -> Optional[dict]:
    """Auf „Bereit“ setzen - aus „Offen“ oder als „Wieder öffnen“ aus „Verfallen“ (#2123, ER1): die Abholfrist beginnt
    jetzt, der Gewinner bekommt Bescheid. Zurück aus „Abgeholt“ geht über ``revert_picked_up`` - ohne Meldung."""
    db = get_db()
    p = await db.prize_pickups.find_one({"id": pickup_id}, {"_id": 0})
    if not p:
        return None
    now = now_utc()
    deadline = ready_deadline(p, now)
    await db.prize_pickups.update_one(
        {"id": pickup_id},
        {"$set": {
            "status": "ready",
            "ready_at": now.isoformat(),
            "pickup_deadline": deadline,
            "expired_at": None,
            "updated_at": now.isoformat(),
        }},
    )
    deadline_str = _deadline_text(deadline)
    await _notify_prize(
        db, {**p, "pickup_deadline": deadline}, template="prize_ready",
        title="Gewinn abholbereit" if p.get("status") != "expired" else "Gewinn wieder abholbereit",
        body=f"{_prize_text(p)} liegt zur Abholung bereit" + (f" - abholbar bis {deadline_str}." if deadline_str else "."),
        mail={"place": str(p.get("place_label") or p.get("place")), "deadline": deadline_str},
    )
    return await db.prize_pickups.find_one({"id": pickup_id}, {"_id": 0})


async def revert_picked_up(pickup_id: str) -> Optional[dict]:
    """„Zurück“ aus „Abgeholt“ (#2123, ER2): versehentlich abgehakt - wieder „Bereit“ mit der bisherigen Frist, ohne
    erneute Meldung „abholbereit“."""
    db = get_db()
    p = await db.prize_pickups.find_one({"id": pickup_id}, {"_id": 0})
    if not p:
        return None
    now = now_utc()
    change = {"status": "ready", "picked_up_at": None, "picked_up_by": None, "updated_at": now.isoformat()}
    if not p.get("pickup_deadline") or str(p["pickup_deadline"]) <= now.isoformat():
        # Ohne oder mit abgelaufener Frist verfiele der Gewinn beim nächsten Lauf sofort - dann eine neue Frist.
        change["pickup_deadline"] = ready_deadline(p, now)
    if not p.get("ready_at"):
        change["ready_at"] = now.isoformat()
    await db.prize_pickups.update_one({"id": pickup_id}, {"$set": change})
    return await db.prize_pickups.find_one({"id": pickup_id}, {"_id": 0})


async def mark_picked_up(pickup_id: str, actor_id: str, notes: str = "") -> Optional[dict]:
    db = get_db()
    p = await db.prize_pickups.find_one({"id": pickup_id}, {"_id": 0})
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
    await _notify_prize(db, p, template="prize_picked_up", title="Gewinn abgeholt",
                        body=f"{_prize_text(p)} ist als abgeholt vermerkt. Viel Freude damit!", mail={})
    return await db.prize_pickups.find_one({"id": pickup_id}, {"_id": 0})


async def expire_overdue() -> int:
    """Hintergrundlauf: Gewinne auf „Bereit“, deren Abholfrist vorbei ist, verfallen. „Offen“ verfällt nie (#2123, ER1)
    - solange der Verein den Gewinn nicht bereitgestellt hat, läuft keine Frist. Meldung per Glocke, Push und Mail."""
    db = get_db()
    now_iso = now_utc().isoformat()
    cursor = db.prize_pickups.find({
        "status": "ready",
        "pickup_deadline": {"$lt": now_iso},
    }, {"_id": 0})
    expired = 0
    async for p in cursor:
        result = await db.prize_pickups.update_one(
            {"id": p["id"], "status": "ready", "pickup_deadline": {"$lt": now_iso}},
            {"$set": {
                "status": "expired",
                "expired_at": now_iso,
                "updated_at": now_iso,
            }},
        )
        if getattr(result, "modified_count", 0) != 1:
            continue  # inzwischen abgeholt, wieder geöffnet oder verlängert - kein Verfall, keine Meldung
        expired += 1
        await _notify_prize(db, p, template="prize_expired", title="Gewinn verfallen",
                            body=f"Die Abholfrist für {_prize_text(p)} ist abgelaufen. Melde dich bei der Turnierleitung, "
                                 "wenn das ein Versehen ist.",
                            # je Frist einmal - nach „Wieder öffnen“ kann ein Gewinn ein zweites Mal verfallen
                            mail={}, dedupe_key=f"prize_expired:{p['id']}:{p.get('pickup_deadline')}")
    return expired
