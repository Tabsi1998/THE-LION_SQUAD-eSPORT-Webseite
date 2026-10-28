"""Turniere anlegen, auflisten, ansehen, ändern und löschen.
"""
import hashlib
import json
from typing import Literal
from fastapi import HTTPException, Depends, Request
from fastapi.responses import RedirectResponse
from urllib.parse import quote, urlencode
from pymongo.errors import DuplicateKeyError
from database import get_db
from services.permissions import is_confirmed_tournament_lead
from auth import require_admin, get_optional_user
from services.visibility import user_can_see
from services.visibility import hide_unseen_event_links, lead_can_see
from services import partner_pages, staffel_guard, tournament_guard
from services.access_links import (
    public_access_link_payload,
    touch_access_link,
    validate_access_link,
)
from services.public_phase import derive_public_phase
from services.league_scope import is_league_staffel, league_filter, league_label
from services.tournament_permissions import (
    assigned_tournament_ids,
    tournament_rights,
)
from services.competition_versions import (
    apply_competition_version_read_defaults,
    new_competition_version_fields,
    persist_competition_versions,
)
from services.custom_bracket import BracketSchemaError, build_matches_v2_from_schema
from services.mutation_lock import MutationLockBusy, mutation_lock
from services.slug_utils import (
    apply_slug_history,
    find_by_slug_or_history,
    slug_source_for_update,
    unique_slug,
)
from models import TournamentCreate, TournamentUpdate, now_utc, new_id
from services import pricing, tournament_fees
from services.advancement_draw import MODE_KEY, SETTING_KEY as LEGACY_MODE_KEY, advancement_mode_of, sync_advancement_fields
from services.permissions import can_use_area, user_has_area
from routes.tournament_common import (
    _apply_match_plan,
    _audit_tournament_action,
    _collect_match_plan,
    _create_initial_stage_bracket_preview,
    _enrich_game_identity,
    _ensure_tournament_unlocked,
    _normalize_team_settings,
    _resolve_tid,
    _serialized_tournament_write,
    _stage_defaults_for_tournament_format,
    _user_tournament_participation_ids,
    _v2_plan_key,
    tournament_hidden_reason,
)
from services import onsite_access
from services.change_events import reset_scope_cache
from services.bracket_tree import attach_has_bracket_tree
from routes.tournament_router import router


EVENT_LINK_ONLY_IN_EVENT = "Zu welchem Event das gehört, änderst du im Event unter „Programm“."
# Turnierliste (#2124, TP12): „Beendet“ heißt auch „Ergebnisse veröffentlicht“ und „Archiviert“ (der Normalfall),
# „Live“ auch pausiert. Die Webseite fragt die Gruppe, die App weiter einzelne Status.
LIST_STATUS_GROUPS = {
    "finished": ("completed", "results_published", "archived"),
    "running": ("live", "paused"),
}


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
        # Das Event als Klammer (#1182): Liste und Startseite stellen das Turnier unter sein Event.
        "end_date": t.get("end_date"),
        "event_id": t.get("event_id"),
        "team_mode": t.get("team_mode"),
        "max_participants": t.get("max_participants"),
        "participant_count": t.get("participant_count", 0),
        "prize_pool": t.get("prize_pool"),
        "registration_enabled": t.get("registration_enabled"),
        "online_registration_enabled": t.get("online_registration_enabled"),
        "registration_open_from": t.get("registration_open_from"),
        "registration_open_until": t.get("registration_open_until"),
        "is_invite_only": t.get("is_invite_only"),
        "has_bracket_tree": t.get("has_bracket_tree", True),
        "engine_version": t.get("engine_version"),
        "ruleset_version": t.get("ruleset_version"),
        "version_inferred": bool(t.get("version_inferred")),
        # Liga (docs/LIGA.md): die Karte kennzeichnet eine Staffel („Liga · Staffel A“).
        **({"league_context": t["league_context"], "league_label": league_label(t)} if is_league_staffel(t) else {}),
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
    # Weiterkommen (#1590): ältere Turniere kennen nur den Schalter - gelesen wird immer der Modus.
    t[MODE_KEY] = advancement_mode_of(t, None)
    t["public_phase"] = derive_public_phase(t, "tournament")
    if is_league_staffel(t):
        t["league_label"] = league_label(t)  # Kennzeichnung „Liga · Staffel A“ (docs/LIGA.md)
    if t.get("game_id"):
        g = await db.games.find_one({"id": t["game_id"]}, {"_id": 0})
        t["game"] = await _enrich_game_identity(db, g)
    # Partner II (#469): Partnervereine am Turnier, Kurzform mit Link auf die Partnerseite.
    await partner_pages.attach_partners(db, t)
    if t.get("event_id"):
        e = await db.events.find_one({"id": t["event_id"]}, {"_id": 0, "tournaments": 0, "f1_challenges": 0})
        if e and e.get("status") != "draft" and await lead_can_see(user, e.get("visibility") or "public"):
            t["event"] = e
    t["participant_count"] = await db.tournament_registrations.count_documents(
        {"tournament_id": t["id"], "status": {"$in": ["approved", "checked_in"]}})
    return t


@router.get("")
async def list_tournaments(status: str | None = None, game_id: str | None = None,
                           event_id: str | None = None, limit: int = 100,
                           offset: int = 0, paged: bool = False, compact: bool = False,
                           include_drafts: bool = False, managed: bool = False,
                           league: Literal["include", "exclude", "only"] = "include",
                           user=Depends(get_optional_user)):
    """``league`` (docs/LIGA.md): ``include`` (Vorgabe - die App ohne neuen Build sieht Staffeln als Turniere),
    ``exclude`` (Web-Listen) oder ``only``."""
    db = get_db()
    is_admin = is_confirmed_tournament_lead(user)
    assigned_ids = await assigned_tournament_ids(user)
    can_include_drafts = bool(include_drafts and (is_admin or assigned_ids))
    q = {}
    if status:
        if status == "draft" and not can_include_drafts:
            return []
        # Status-Gruppen (#2124): „Beendet“ und „Live“ der Turnierliste - ein einzelner Status bleibt wie bisher.
        q["status"] = {"$in": list(LIST_STATUS_GROUPS[status])} if status in LIST_STATUS_GROUPS else status
    elif include_drafts and is_admin:
        pass
    elif include_drafts and assigned_ids:
        q["$or"] = [{"status": {"$ne": "draft"}}, {"id": {"$in": assigned_ids}}]
    else:
        q["status"] = {"$ne": "draft"}
    if managed and not is_admin:
        # Verwaltungsliste (#1028): ohne die Turnierleitung über alle Turniere - dazu gehört die bestätigte
        # Zwei-Faktor-Anmeldung - nur die Turniere des eigenen Helfer-Einsatzes.
        q["id"] = {"$in": assigned_ids}
    assigned_visible_ids = assigned_ids if include_drafts or managed else []
    participant_visible_ids = await _user_tournament_participation_ids(db, user)
    if game_id:
        q["game_id"] = game_id
    if event_id:
        q["event_id"] = event_id
    q.update(league_filter(league))
    safe_limit = max(1, min(int(limit or 100), 500))
    projection = {"_id": 0}
    if compact:
        projection = {
            "_id": 0, "id": 1, "title": 1, "slug": 1, "banner_url": 1, "league_context": 1,
            "status": 1, "visibility": 1, "is_public": 1, "game_id": 1,
            "platform": 1, "start_date": 1, "end_date": 1, "event_id": 1, "team_mode": 1, "max_participants": 1,
            "prize_pool": 1, "registration_enabled": 1, "online_registration_enabled": 1,
            "registration_open_from": 1, "registration_open_until": 1, "is_invite_only": 1,
            # Turnierbaum je Format (#2124): ``has_bracket_tree`` braucht das Format.
            "format": 1,
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
            elif t.get("is_public") is not False and await lead_can_see(user, t.get("visibility") or "public"):
                visible.append(t)
        tournaments = visible
    # Kurze Liste (#2124): erst die Seite schneiden, dann nur sie anreichern - gleiche Reihenfolge, gleiche Zahl.
    total = len(tournaments)
    page_limit = max(1, min(int(limit or 48), 200))
    page_offset = max(0, int(offset or 0))
    if compact:
        tournaments = tournaments[page_offset:page_offset + page_limit]
    finance = await can_use_area(user, "finance")
    for t in tournaments:
        await _enrich_tournament(t, user)
        _expose_offer(t, finance)
        if not is_admin:
            # Der Umbau-Vorschlag für die Läufe (#1550) gehört der Turnierleitung; Helfer sehen ihn am Turnier selbst.
            t.pop("heat_rebuild_plan", None)
            t.pop("heat_rebuild_dismissed", None)
            t.pop("participant_removal_plan", None)
    # Das Event als Klammer (#1182): die Kennung des Events nur, wenn es für die Person sichtbar ist (#1473).
    await hide_unseen_event_links(db, user, tournaments)
    await attach_has_bracket_tree(db, tournaments)
    if compact:
        items = [_compact_tournament(t) for t in tournaments]
        if not paged:
            return items
        return {"items": items, "total": total, "limit": page_limit, "offset": page_offset}
    return tournaments


@router.get("/{slug_or_id}")
async def get_tournament(slug_or_id: str, include_draft: bool = False, access: str | None = None,
                         user=Depends(get_optional_user), request: Request = None):
    db = get_db()
    t, was_old_slug = await find_by_slug_or_history(db.tournaments, slug_or_id, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    is_admin = is_confirmed_tournament_lead(user)
    access_link = await validate_access_link(db, access, "tournament", t["id"], user, "view")
    hidden = None if access_link else await tournament_hidden_reason(db, t, user)
    # Vor-Ort-Zugang (#1592): wer sonst nichts sieht, aber den QR-Code eingelöst hat, bekommt die schlanke Ansicht.
    onsite_only = bool(hidden) and await onsite_access.has_pass(db, request, t)
    if hidden == 404 and not onsite_only:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    if hidden and not onsite_only:
        raise HTTPException(status_code=403, detail="Turnier ist nicht sichtbar")
    if was_old_slug and t.get("slug"):
        suffix = f"?{urlencode({'access': access})}" if access else ""
        return RedirectResponse(url=f"/api/tournaments/{quote(str(t['slug']), safe='')}{suffix}", status_code=301)
    await _enrich_tournament(t, user)
    await attach_has_bracket_tree(db, [t])
    # Wie lang die Warteliste ist (#1941): das Bestätigungs-Blatt nennt bei vollem Cup den Platz - nur die Zahl.
    t["waitlist_count"] = await db.tournament_registrations.count_documents({"tournament_id": t["id"], "status": "waitlist"})
    if onsite_only:
        _expose_offer(t, False)
        return onsite_access.slim_view(t)
    # Was die Person hier darf (#1353): die Verwaltung zeigt Knöpfe nur nach diesen Feldern.
    t.update(await tournament_rights(user, t["id"]))
    if is_league_staffel(t):
        # Kopf der Staffel-Verwaltung (#2109): „Liga 1 · Staffel A – Season öffnen · Ligaseite“.
        # Der Admin-Pfad der Season nur für die Verwaltung (Turnierleitung oder Strukturrechte).
        t["league_links"] = await staffel_guard.staffel_links(
            db, t, with_admin_path=is_admin or bool(t.get("can_manage_structure")))
    if not t.get("can_manage_structure"):
        # Der Umbau-Vorschlag für die Läufe (#1550) und der für Austritt/Disqualifikation (#1553) sieht nur, wer ihn
        # auch bestätigen darf (Strukturrollen).
        t.pop("heat_rebuild_plan", None)
        t.pop("heat_rebuild_dismissed", None)
        t.pop("participant_removal_plan", None)
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
    _expose_offer(t, await can_use_area(user, "finance"))
    # Turnier nur mit Event-Anmeldung (#875): die Seite zeigt den Weg über das Event, bevor jemand scheitert.
    from services import tournament_event_gate
    t["event_gate"] = await tournament_event_gate.viewer_state(db, t, user)
    if not is_admin:
        # Das Event als Klammer nur, wenn die Person es sehen darf (#1473) - auch für Teilnehmende ohne Mitgliedschaft.
        await hide_unseen_event_links(db, user, [t])
    return t


def _expose_offer(t: dict, finance: bool) -> None:
    """Startgeld (#319): Preisangabe für alle, die Konfiguration mit Dolibarr-Nummern nur für Finanzen."""
    offer = t.pop("billing", None)
    t["offer"] = pricing.public_offer(offer) if tournament_fees.charges(t, offer) else None
    if finance:
        t["billing"] = offer or pricing.normalize_offer(None)


@router.post("")
async def create_tournament(body: TournamentCreate, me: dict = Depends(require_admin())):
    return await create_tournament_doc(body, me)


async def create_tournament_doc(body: TournamentCreate, me: dict) -> dict:
    """Anlegen ohne Route - auch für „+ Turnier in diesem Event“ (#1371, ``event_program_routes``)."""
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
            sync_advancement_fields(doc)
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
                reset_scope_cache()  # Live-Meldungen (#1801): Turnier und Event neu nachschlagen
            except DuplicateKeyError:
                existing = await db.tournaments.find_one({"creation_key": creation_key}, {"_id": 0})
                if not existing:
                    raise HTTPException(status_code=409, detail="Turnier konnte wegen einer parallelen Erstellung nicht angelegt werden")
                existing.pop("creation_key", None)
                apply_competition_version_read_defaults(existing)
                return {**existing, "auto_generated_bracket": None, "idempotent_replay": True}
            auto_preview = await _create_initial_bracket_preview(db, doc, me.get("id"))
            if doc.get("status") != "draft":
                # Gleich mit „Anmeldung offen“ angelegt: angekündigt wie ein Statuswechsel (#572).
                from services.discord_threads import status_written
                await status_written(db, doc["id"], None)
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
    # Status nur über den Ablauf (#2109): ``POST /status`` prüft Spielplan, Check-in und schreibt ins Protokoll - das
    # Formular nicht. Derselbe Status stört nicht, ein anderer wird abgelehnt (alle Turniere).
    problem = staffel_guard.status_problem(raw_updates, existing) or staffel_guard.staffel_update_problem(
        raw_updates, existing)
    if problem:
        raise HTTPException(status_code=400, detail=problem)
    # Ab dem Ende des Check-ins steht der Baum (#2120, TA9): Format, Teilnahme, Teamgröße und Spiel bleiben, wie sie
    # sind - sonst liefe das Turnier mit Anmeldungen und Spielen im alten Zustand weiter.
    fixed_problem = await tournament_guard.structure_update_problem(db, raw_updates, existing)
    if fixed_problem:
        raise HTTPException(status_code=409, detail=fixed_problem)
    preview_changed = tournament_guard.changed_fields(raw_updates, existing, tournament_guard.PREVIEW_FIELDS)
    raw_updates.pop("status", None)
    # Event als Klammer (#1371): verbunden wird nur im Event. Derselbe Wert stört nicht, ein anderer wird abgelehnt.
    if "event_id" in raw_updates:
        if (raw_updates.pop("event_id") or None) != (existing.get("event_id") or None):
            raise HTTPException(status_code=400, detail=EVENT_LINK_ONLY_IN_EVENT)
    if "partner_ids" in raw_updates:
        raw_updates["partner_ids"] = await partner_pages.clean_partner_ids(db, raw_updates["partner_ids"])
    if "format_label" in raw_updates:
        raw_updates["format_label"] = (raw_updates.get("format_label") or "").strip() or None
    if "award_images" in raw_updates:
        from services.awards import clean_award_images
        raw_updates["award_images"] = clean_award_images(raw_updates.get("award_images"))
    if MODE_KEY in raw_updates or LEGACY_MODE_KEY in raw_updates:
        # Modus und alter Schalter bleiben im Gleichschritt (#1590); fehlt der Modus, folgt er dem Schalter.
        sync_advancement_fields(raw_updates)
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
        # Leer: die Dauer bzw. der Modus kommt vom Spiel (#1554).
        "match_duration_minutes", "game_mode",
        # Fristen (#1551): leer heißt wieder Standard.
        "no_show_minutes_on_site", "no_show_minutes_online", "result_confirm_minutes_online", "result_confirm_hours_league",
        # Show-Auslosung (#1590): leer heißt wieder Vorgabe (10 Minuten).
        "draw_show_minutes",
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
    reset_scope_cache()  # Live-Meldungen (#1801): Turnier und Event neu nachschlagen
    t = await db.tournaments.find_one({"id": tid}, {"_id": 0})
    auto_preview = None
    if preview_changed:
        # Vor dem Ende des Check-ins (#2120, TA9): die Vorschau folgt dem neuen Format bzw. der Teilnahme - vorher
        # baute das Auffrischen weiter aus der alten Phase, ein auf Doppel-K.-o. umgestelltes Turnier lief als K.-o.
        auto_preview = await _rebuild_preview_after_structure_change(db, t, existing, me.get("id"), preview_changed)
    t.pop("creation_key", None)
    apply_competition_version_read_defaults(t)
    _expose_offer(t, await user_has_area(me, "finance"))
    if auto_preview is not None:
        t["auto_generated_bracket"] = auto_preview
    return t


EMPTY_STAGE_SETTING = (None, "", False, [], {})


def _is_default_stage(stage: dict, tournament: dict) -> bool:
    """Ist die Phase noch genau die, die das Format von selbst anlegt (Name, Typ, Einstellungen)? Eine eigene Phase
    (anderer Name, Best of, Schema, Renn-Einstellungen …) baut ein Formatwechsel nicht still mit Standardwerten neu."""
    defaults = _stage_defaults_for_tournament_format(tournament, None)
    if not defaults:
        return False
    if (stage.get("name") or "") != defaults["name"] or stage.get("stage_type") != defaults["stage_type"] \
            or stage.get("match_type") != defaults["match_type"]:
        return False
    wanted = defaults["settings"]
    for key, value in (stage.get("settings") or {}).items():
        if key in wanted:
            if value != wanted[key]:
                return False
        elif value not in EMPTY_STAGE_SETTING:
            return False
    return True


async def _rebuild_preview_after_structure_change(db, tournament: dict, previous: dict, actor_id: str | None,
                                                  fields: list[str]) -> dict | None:
    """Die Vorschau neu bauen, wenn Format, Teilnahme oder Teamgröße sich vor dem Ende des Check-ins ändern.

    Nur über einer reinen Vorschau (keine echten Spiele, höchstens eine Phase):
    - Teilnahme oder Teamgröße: die Phase bleibt, wie sie ist (Name, Best of, Schema …); nur ihre Vorschau-Spiele
      werden neu gebaut, geplante Zeiten und Stationen gehen mit (Review #2120).
    - Format: neu angelegt wird nur die Standard-Phase des alten Formats. Eine eigene Phase bleibt stehen - dort baut
      die Turnierleitung selbst mit „Speichern & Struktur anwenden“ neu (``custom_stages``)."""
    tid = tournament["id"]
    stages = await db.tournament_stages.find({"tournament_id": tid}, {"_id": 0}).sort("number", 1).to_list(200)
    if len(stages) > 1:
        return {"ok": False, "reason": "custom_stages", "preview": True}
    matches = await db.matches_v2.find({"tournament_id": tid}, {"_id": 0}).to_list(5000)
    if any(not match.get("is_preview") for match in matches):
        return None
    stage = stages[0] if stages else None
    if stage and "format" in fields and not _is_default_stage(stage, previous):
        return {"ok": False, "reason": "custom_stages", "preview": True}
    match_plan = _collect_match_plan(matches)
    match_ids = [match["id"] for match in matches if match.get("id")]
    built = None
    if stage and "format" not in fields:
        registrations = await db.tournament_registrations.find(
            {"tournament_id": tid, "status": {"$in": ["approved", "checked_in"]}}, {"_id": 0}).to_list(5000)
        try:
            rebuilt = build_matches_v2_from_schema(tournament, stage, registrations, preview=True)
        except BracketSchemaError:
            return {"ok": False, "reason": "schema_error", "preview": True}
        _apply_match_plan(rebuilt, match_plan, _v2_plan_key)
        await _drop_matches(db, match_ids)
        if rebuilt:
            await db.matches_v2.insert_many(rebuilt)
        await persist_competition_versions(db, tournament, "graph")
        built = {"ok": True, "engine": "stages", "stage_id": stage["id"], "match_count": len(rebuilt),
                 "preview": True, "participant_count": len(registrations)}
    else:
        await _drop_matches(db, match_ids)
        if stage:
            await db.tournament_stages.delete_many({"tournament_id": tid})
        built = await _create_initial_stage_bracket_preview(db, tournament, actor_id)
        if built:
            # Geplante Zeiten und Stationen, wo das neue Format dieselben Spiele hat.
            fresh = await db.matches_v2.find({"tournament_id": tid}, {"_id": 0}).to_list(5000)
            for match in fresh:
                if match_plan.get(_v2_plan_key(match)):
                    planned = _apply_match_plan([dict(match)], match_plan, _v2_plan_key)[0]
                    await db.matches_v2.update_one({"id": match["id"]}, {"$set": {
                        key: value for key, value in planned.items() if match.get(key) != value}})
    await _audit_tournament_action(db, "tournament.structure.preview_rebuilt", actor_id, tid, {
        "fields": fields, "removed_match_count": len(match_ids), "match_count": (built or {}).get("match_count", 0),
        "stage_kept": bool(stage) and "format" not in fields,
    })
    return built or {"ok": True, "preview": True, "match_count": 0}


async def _drop_matches(db, match_ids: list[str]) -> None:
    if match_ids:
        await db.match_reports_v2.delete_many({"match_id": {"$in": match_ids}})
        await db.matches_v2.delete_many({"id": {"$in": match_ids}})


@router.delete("/{tid}")
async def delete_tournament(tid: str, me: dict = Depends(require_admin()),
                            _mutation_tid: str = Depends(_serialized_tournament_write)):
    db = get_db()
    tid = await _resolve_tid(tid)
    # Liga-Staffel (#2109): löschen nur vor dem Start - danach „Abgesagt“ oder „Archiviert“.
    stored = await db.tournaments.find_one({"id": tid}, {"_id": 0}) or {}
    problem = await staffel_guard.staffel_delete_problem(db, stored)
    if problem:
        raise HTTPException(status_code=409, detail=problem)
    from services.tournament_purge import purge_tournament
    await purge_tournament(db, tid)
    reset_scope_cache()  # Live-Meldungen (#1801): Turnier und Event neu nachschlagen
    return {"ok": True}


@router.get("/{slug_or_id}/streams")
async def tournament_live_streams(slug_or_id: str, user=Depends(get_optional_user), request: Request = None):
    """„Turnier live“ (#579): die laufenden Streams der Teilnehmer, nur Personen mit öffentlichem Profil.

    Wer das Turnier sieht (dieselbe Regel wie die Turnierseite, auch „Nur Mitglieder“), bekommt die Streams (#1831).
    Wer die Turnierseite öffnen kann, das Turnier aber nicht sieht (403, Vor-Ort-Zugang), bekommt eine leere Liste statt
    eines Fehlers - die Seite sagt selbst, was sie zeigt. Was die Turnierseite mit 404 beantwortet, bleibt 404."""
    from services import tournament_streams
    db = get_db()
    t, _ = await find_by_slug_or_history(db.tournaments, slug_or_id, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    hidden = await tournament_hidden_reason(db, t, user)
    if hidden == 404 and not await onsite_access.has_pass(db, request, t):
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    if hidden:
        return []
    return await tournament_streams.participant_streams(db, t)
