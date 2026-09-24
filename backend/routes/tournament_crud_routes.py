"""Turniere anlegen, auflisten, ansehen, ändern und löschen.
"""
import hashlib
import json
from fastapi import HTTPException, Depends
from fastapi.responses import RedirectResponse
from urllib.parse import quote, urlencode
from pymongo.errors import DuplicateKeyError
from database import get_db
from auth import require_admin, get_optional_user
from services.visibility import user_can_see
from services import partner_pages
from services.access_links import (
    public_access_link_payload,
    touch_access_link,
    validate_access_link,
)
from services.public_phase import derive_public_phase
from services.tournament_permissions import (
    RESULT_STAFF_ROLES,
    STRUCTURE_STAFF_ROLES,
    assigned_tournament_ids,
    has_tournament_staff_permission,
)
from services.competition_versions import (
    apply_competition_version_read_defaults,
    new_competition_version_fields,
)
from services.mutation_lock import MutationLockBusy, mutation_lock
from services.slug_utils import (
    apply_slug_history,
    find_by_slug_or_history,
    slug_source_for_update,
    unique_slug,
)
from models import TournamentCreate, TournamentUpdate, now_utc, new_id
from services import pricing, tournament_fees
from services.permissions import user_has_area
from routes.tournament_common import (
    STAFF_ROLES,
    _create_initial_stage_bracket_preview,
    _enrich_game_identity,
    _ensure_tournament_unlocked,
    _is_tournament_staff,
    _normalize_team_settings,
    _resolve_tid,
    _serialized_tournament_write,
    _user_participates_in_tournament,
    _user_tournament_participation_ids,
)
from routes.tournament_router import router


def _page_items(items: list[dict], limit: int, offset: int, paged: bool):
    safe_limit = max(1, min(int(limit or 48), 200))
    safe_offset = max(0, int(offset or 0))
    page = items[safe_offset:safe_offset + safe_limit]
    if not paged:
        return page
    return {"items": page, "total": len(items), "limit": safe_limit, "offset": safe_offset}


def _compact_tournament(t: dict) -> dict:
    game = t.get("game") or {}
    return {
        "id": t.get("id"),
        "title": t.get("title"),
        "slug": t.get("slug"),
        "banner_url": t.get("banner_url"),
        "status": t.get("status"),
        "visibility": t.get("visibility"),
        "is_public": t.get("is_public"),
        "public_phase": t.get("public_phase"),
        "platform": t.get("platform"),
        "start_date": t.get("start_date"),
        "max_participants": t.get("max_participants"),
        "participant_count": t.get("participant_count", 0),
        "prize_pool": t.get("prize_pool"),
        "registration_enabled": t.get("registration_enabled"),
        "online_registration_enabled": t.get("online_registration_enabled"),
        "registration_open_from": t.get("registration_open_from"),
        "registration_open_until": t.get("registration_open_until"),
        "is_invite_only": t.get("is_invite_only"),
        "engine_version": t.get("engine_version"),
        "ruleset_version": t.get("ruleset_version"),
        "version_inferred": bool(t.get("version_inferred")),
        "game": {
            "id": game.get("id"),
            "name": game.get("name"),
            "short_name": game.get("short_name"),
            "cover_url": game.get("cover_url"),
            "logo_url": game.get("logo_url"),
        } if game else None,
    }


def _iso(dt):
    if dt is None:
        return None
    if hasattr(dt, "isoformat"):
        return dt.isoformat()
    return dt


async def _create_initial_bracket_preview(db, tournament: dict, actor_id: str | None) -> dict | None:
    """Create a non-destructive empty bracket preview right after tournament creation."""
    return await _create_initial_stage_bracket_preview(db, tournament, actor_id)


async def _enrich_tournament(t: dict, user: dict | None = None) -> dict:
    db = get_db()
    t.pop("creation_key", None)
    apply_competition_version_read_defaults(t)
    t["public_phase"] = derive_public_phase(t, "tournament")
    if t.get("game_id"):
        g = await db.games.find_one({"id": t["game_id"]}, {"_id": 0})
        t["game"] = await _enrich_game_identity(db, g)
    # Partner II (#469): Partnervereine am Turnier, Kurzform mit Link auf die Partnerseite.
    await partner_pages.attach_partners(db, t)
    if t.get("event_id"):
        e = await db.events.find_one({"id": t["event_id"]}, {"_id": 0, "tournaments": 0, "f1_challenges": 0})
        if e and e.get("status") != "draft" and await user_can_see(user, e.get("visibility") or "public"):
            t["event"] = e
    t["participant_count"] = await db.tournament_registrations.count_documents(
        {"tournament_id": t["id"], "status": {"$in": ["approved", "checked_in"]}})
    return t


@router.get("")
async def list_tournaments(status: str | None = None, game_id: str | None = None,
                           event_id: str | None = None, limit: int = 100,
                           offset: int = 0, paged: bool = False, compact: bool = False,
                           include_drafts: bool = False,
                           user=Depends(get_optional_user)):
    db = get_db()
    is_admin = user and user.get("role") in STAFF_ROLES
    assigned_ids = await assigned_tournament_ids(user)
    can_include_drafts = bool(include_drafts and (is_admin or assigned_ids))
    q = {}
    if status:
        if status == "draft" and not can_include_drafts:
            return []
        q["status"] = status
    elif include_drafts and is_admin:
        pass
    elif include_drafts and assigned_ids:
        q["$or"] = [{"status": {"$ne": "draft"}}, {"id": {"$in": assigned_ids}}]
    else:
        q["status"] = {"$ne": "draft"}
    assigned_visible_ids = assigned_ids if include_drafts else []
    participant_visible_ids = await _user_tournament_participation_ids(db, user)
    if game_id:
        q["game_id"] = game_id
    if event_id:
        q["event_id"] = event_id
    safe_limit = max(1, min(int(limit or 100), 500))
    projection = {"_id": 0}
    if compact:
        projection = {
            "_id": 0, "id": 1, "title": 1, "slug": 1, "banner_url": 1,
            "status": 1, "visibility": 1, "is_public": 1, "game_id": 1,
            "platform": 1, "start_date": 1, "max_participants": 1,
            "prize_pool": 1, "registration_enabled": 1, "online_registration_enabled": 1,
            "registration_open_from": 1, "registration_open_until": 1, "is_invite_only": 1,
        }
    fetch_limit = max(safe_limit, min(safe_limit + max(int(offset or 0), 0) + 80, 500))
    tournaments = await db.tournaments.find(q, projection).sort("created_at", -1).to_list(fetch_limit)
    if not is_admin:
        visible = []
        for t in tournaments:
            if t.get("id") in assigned_visible_ids:
                visible.append(t)
            elif t.get("id") in participant_visible_ids:
                visible.append(t)
            elif t.get("status") == "draft":
                continue
            elif t.get("is_public") is not False and await user_can_see(user, t.get("visibility") or "public"):
                visible.append(t)
        tournaments = visible
    finance = bool(user) and await user_has_area(user, "finance")
    for t in tournaments:
        await _enrich_tournament(t, user)
        _expose_offer(t, finance)
    if compact:
        tournaments = [_compact_tournament(t) for t in tournaments]
        return _page_items(tournaments, limit, offset, paged)
    return tournaments


@router.get("/{slug_or_id}")
async def get_tournament(slug_or_id: str, include_draft: bool = False, access: str | None = None, user=Depends(get_optional_user)):
    db = get_db()
    t, was_old_slug = await find_by_slug_or_history(db.tournaments, slug_or_id, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    is_admin = user and user.get("role") in STAFF_ROLES
    is_assigned = await _is_tournament_staff(t["id"], user)
    is_participant = await _user_participates_in_tournament(db, t["id"], user)
    access_link = await validate_access_link(db, access, "tournament", t["id"], user, "view")
    has_access = bool(access_link)
    if t.get("status") == "draft" and not (is_admin or is_assigned or has_access):
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    if not (is_admin or is_assigned or is_participant or has_access) and t.get("is_public") is False:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    if not (is_admin or is_assigned or is_participant or has_access) and not await user_can_see(user, t.get("visibility") or "public"):
        raise HTTPException(status_code=403, detail="Turnier ist nicht sichtbar")
    if was_old_slug and t.get("slug"):
        suffix = f"?{urlencode({'access': access})}" if access else ""
        return RedirectResponse(url=f"/api/tournaments/{quote(str(t['slug']), safe='')}{suffix}", status_code=301)
    await _enrich_tournament(t, user)
    t["can_manage_results"] = bool(
        is_admin
        or await has_tournament_staff_permission(user, t["id"], RESULT_STAFF_ROLES)
    )
    t["can_manage_structure"] = bool(
        is_admin
        or await has_tournament_staff_permission(user, t["id"], STRUCTURE_STAFF_ROLES, "tournament")
    )
    if access_link:
        await touch_access_link(db, access_link, user)
        t["access_link"] = public_access_link_payload(access_link)
    if t.get("event_id"):
        related_f1_query = {"event_id": t["event_id"]}
        if not is_admin:
            related_f1_query["status"] = {"$ne": "draft"}
        t["related_f1_challenges"] = await db.f1_challenges.find(
            related_f1_query,
            {"_id": 0, "id": 1, "title": 1, "slug": 1, "start_date": 1, "status": 1, "visibility": 1, "registration_enabled": 1, "online_registration_enabled": 1, "registration_open_from": 1, "registration_open_until": 1},
        ).to_list(50)
        if not is_admin:
            visible_f1 = []
            for c in t["related_f1_challenges"]:
                if await user_can_see(user, c.get("visibility") or "public"):
                    c["public_phase"] = derive_public_phase(c, "f1")
                    visible_f1.append(c)
            t["related_f1_challenges"] = visible_f1
        else:
            for c in t["related_f1_challenges"]:
                c["public_phase"] = derive_public_phase(c, "f1")
    _expose_offer(t, bool(user) and await user_has_area(user, "finance"))
    return t


def _expose_offer(t: dict, finance: bool) -> None:
    """Startgeld (#319): Preisangabe für alle, die Konfiguration mit Dolibarr-Nummern nur für Finanzen."""
    offer = t.pop("billing", None)
    t["offer"] = pricing.public_offer(offer) if tournament_fees.charges(t, offer) else None
    if finance:
        t["billing"] = offer or pricing.normalize_offer(None)


@router.post("")
async def create_tournament(body: TournamentCreate, me: dict = Depends(require_admin())):
    db = get_db()
    canonical_body = body.model_dump(mode="json")
    creation_digest = hashlib.sha256(
        json.dumps(canonical_body, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    ).hexdigest()
    creation_key = f"{me['id']}:{creation_digest}"
    try:
        async with mutation_lock(db, "tournament:create"):
            existing = await db.tournaments.find_one({"creation_key": creation_key}, {"_id": 0})
            if existing:
                existing.pop("creation_key", None)
                apply_competition_version_read_defaults(existing)
                return {**existing, "auto_generated_bracket": None, "idempotent_replay": True}
            # Validate game
            if not await db.games.find_one({"id": body.game_id}):
                raise HTTPException(status_code=400, detail="Spiel nicht gefunden")
            doc = body.model_dump()
            doc["partner_ids"] = await partner_pages.clean_partner_ids(db, doc.get("partner_ids"))
            doc["creation_key"] = creation_key
            billing = await tournament_fees.billing_updates(body.model_dump(exclude_unset=True), None, me)
            doc["billing"] = billing if billing is not None else pricing.normalize_offer(None)
            doc["slug"] = await unique_slug(db.tournaments, doc.get("slug") or doc.get("title"), fallback="turnier")
            doc["format_label"] = (doc.get("format_label") or "").strip() or None
            if doc.get("format") != "single_elim":
                doc["bronze_match"] = False
            # ISO-serialize datetimes
            for k in ["registration_open_from", "registration_open_until", "check_in_from",
                      "check_in_until", "start_date", "end_date"]:
                doc[k] = _iso(doc.get(k))
            doc["id"] = new_id()
            doc.update(new_competition_version_fields(doc.get("format")))
            # Allow scheduling directly (announced) — fall back to draft.
            if not doc.get("status"):
                doc["status"] = "draft"
            doc["created_at"] = now_utc().isoformat()
            doc["updated_at"] = now_utc().isoformat()
            doc["created_by"] = me["id"]
            try:
                await db.tournaments.insert_one(doc)
            except DuplicateKeyError:
                existing = await db.tournaments.find_one({"creation_key": creation_key}, {"_id": 0})
                if not existing:
                    raise HTTPException(status_code=409, detail="Turnier konnte wegen einer parallelen Erstellung nicht angelegt werden")
                existing.pop("creation_key", None)
                apply_competition_version_read_defaults(existing)
                return {**existing, "auto_generated_bracket": None, "idempotent_replay": True}
            auto_preview = await _create_initial_bracket_preview(db, doc, me.get("id"))
            doc.pop("_id", None)
            doc.pop("creation_key", None)
            apply_competition_version_read_defaults(doc)
            _expose_offer(doc, await user_has_area(me, "finance"))
            doc["auto_generated_bracket"] = auto_preview
            doc["idempotent_replay"] = False
            return doc
    except MutationLockBusy:
        raise HTTPException(status_code=409, detail="Eine Turniererstellung wird bereits verarbeitet. Bitte erneut versuchen.")


@router.put("/{tid}")
@router.patch("/{tid}")
async def update_tournament(tid: str, body: TournamentUpdate, me: dict = Depends(require_admin()),
                            _mutation_tid: str = Depends(_serialized_tournament_write)):
    db = get_db()
    tid = await _resolve_tid(tid)
    if body.game_id and not await db.games.find_one({"id": body.game_id}, {"id": 1}):
        raise HTTPException(status_code=400, detail="Spiel nicht gefunden")
    existing = await _ensure_tournament_unlocked(db, tid)
    raw_updates = body.model_dump(exclude_unset=True)
    if "partner_ids" in raw_updates:
        raw_updates["partner_ids"] = await partner_pages.clean_partner_ids(db, raw_updates["partner_ids"])
    if "format_label" in raw_updates:
        raw_updates["format_label"] = (raw_updates.get("format_label") or "").strip() or None
    if "award_images" in raw_updates:
        from services.awards import clean_award_images
        raw_updates["award_images"] = clean_award_images(raw_updates.get("award_images"))
    effective_format = raw_updates.get("format", existing.get("format"))
    if effective_format != "single_elim":
        raw_updates["bronze_match"] = False
    nullable_fields = {
        "description", "platform", "event_id", "registration_open_from",
        "registration_open_until", "check_in_from", "check_in_until",
        "start_date", "end_date", "rules", "prize_pool", "prize_places",
        "stream_link", "twitch_channel", "discord_link", "location",
        "banner_url", "stream_platform", "stream_url", "stream_title", "format_label",
        "result_entry_mode", "schedule_mode",
    }
    updates = {k: v for k, v in raw_updates.items() if v is not None or k in nullable_fields}
    billing = await tournament_fees.billing_updates(raw_updates, existing, me)
    if billing is not None:
        updates["billing"] = billing
    else:
        updates.pop("billing", None)
    slug_source = slug_source_for_update(raw_updates, existing, "title", fallback="turnier")
    if slug_source is not None:
        updates["slug"] = await unique_slug(db.tournaments, slug_source, current_id=tid, fallback="turnier")
        apply_slug_history(existing, updates)
    if "team_mode" in updates or "team_size" in updates:
        normalized_team_settings = _normalize_team_settings({
            "team_mode": updates.get("team_mode", existing.get("team_mode") or "solo"),
            "team_size": updates.get("team_size", existing.get("team_size") or 1),
        })
        updates["team_mode"] = normalized_team_settings["team_mode"]
        updates["team_size"] = normalized_team_settings["team_size"]
    for k in ["registration_open_from", "registration_open_until", "check_in_from",
              "check_in_until", "start_date", "end_date"]:
        if k in updates:
            updates[k] = _iso(updates[k])
    updates["updated_at"] = now_utc().isoformat()
    await db.tournaments.update_one({"id": tid}, {"$set": updates})
    t = await db.tournaments.find_one({"id": tid}, {"_id": 0})
    t.pop("creation_key", None)
    apply_competition_version_read_defaults(t)
    _expose_offer(t, await user_has_area(me, "finance"))
    return t


@router.delete("/{tid}")
async def delete_tournament(tid: str, me: dict = Depends(require_admin()),
                            _mutation_tid: str = Depends(_serialized_tournament_write)):
    db = get_db()
    tid = await _resolve_tid(tid)
    v2_match_ids = await db.matches_v2.distinct("id", {"tournament_id": tid})
    await db.tournaments.delete_one({"id": tid})
    await db.tournament_registrations.delete_many({"tournament_id": tid})
    await db.tournament_staff_assignments.delete_many({"tournament_id": tid})
    await db.tournament_stages.delete_many({"tournament_id": tid})
    await db.matches_v2.delete_many({"tournament_id": tid})
    if v2_match_ids:
        await db.match_reports_v2.delete_many({"match_id": {"$in": v2_match_ids}})
    await db.matches.delete_many({"tournament_id": tid})
    return {"ok": True}
