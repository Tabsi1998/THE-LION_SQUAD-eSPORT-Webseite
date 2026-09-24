"""Gemeinsame Helfer der Turnierrouten.

Hier liegt, was mehrere Fachmodule brauchen: Sichtbarkeit und Berechtigung,
Sperren, Audit, Vorschauen und der Planungsbericht. Dieses Modul hat keinen
Router und importiert kein Fachmodul - so kann kein Ringimport entstehen.
"""
from fastapi import HTTPException
from typing import Optional
from datetime import datetime, timedelta, timezone
import math
from pydantic import BaseModel, Field
from database import get_db
from services.visibility import user_can_see
from services.station_labels import attach_station_info
from services.tournament_permissions import READ_STAFF_ROLES, has_tournament_staff_permission
from services.custom_bracket import BracketSchemaError, build_matches_v2_from_schema
from services.competition_engine import GRAPH, preferred_engine
from services.competition_formats import find_format_capability
from services.competition_versions import persist_competition_versions
from services.mutation_lock import MutationLockBusy, mutation_lock, tournament_write_resource
from services.slug_utils import find_by_slug_or_history
from models import now_utc, new_id
from services.competition_usage import record_write


STAFF_ROLES = {"moderator", "tournament_admin", "club_admin", "superadmin"}


MAX_INITIAL_PREVIEW_MATCHES = 512


TOURNAMENT_MUTATION_LOCKED_DETAIL = "Turnier ist gesperrt und kann nur noch angesehen oder geloescht werden."


MATCH_PLAN_FIELDS = ("scheduled_at", "duration_minutes", "station_id", "admin_note", "map", "best_of")


MATCH_PLAN_ACTIVE_STATUSES = {"preview", "pending", "ready", "scheduled", "in_progress", "waiting_result"}


MATCH_PLAN_DONE_STATUSES = {"completed", "forfeit", "cancelled", "archived", "bye"}


class TournamentBracketStructurePayload(BaseModel):
    stage_type: Optional[str] = None
    match_type: Optional[str] = None
    name: Optional[str] = None
    settings: dict = Field(default_factory=dict)


def _next_power_of_two(n: int) -> int:
    return 1 if n <= 1 else 2 ** math.ceil(math.log2(n))


def _estimated_match_count(tournament: dict) -> int:
    fmt = tournament.get("format") or "single_elim"
    count = _next_power_of_two(max(2, int(tournament.get("max_participants") or 2)))
    if fmt == "single_elim":
        return max(1, count - 1) + (1 if tournament.get("bronze_match") and count >= 4 else 0)
    if fmt == "double_elim":
        rounds = int(math.log2(count))
        loser_rounds = max(1, 2 * (rounds - 1))
        loser_matches = 0
        current = max(1, count // 4)
        for round_index in range(loser_rounds):
            loser_matches += max(1, current)
            if round_index % 2 == 1:
                current = max(1, current // 2)
        return max(1, count - 1) + loser_matches + 2
    if fmt == "round_robin":
        return (count * (count - 1)) // 2
    if fmt == "league":
        return count * (count - 1)
    return 0


def _can_create_initial_legacy_preview(tournament: dict) -> bool:
    capability = find_format_capability(tournament.get("format"))
    if not capability or capability.initial_preview_engine != "legacy":
        return False
    return 0 < _estimated_match_count(tournament) <= MAX_INITIAL_PREVIEW_MATCHES


GROUP_TARGET_SIZE = 4


def _default_group_count(tournament: dict) -> int:
    """How many groups a group stage starts with, from the field size.

    A fixed default of four turned eight participants into four pairs - four
    "groups" of two, where every group is decided by a single match. Aiming for
    groups of about four keeps a group stage what it is: a few matches inside
    each group before anyone advances.
    """
    size = max(2, int(tournament.get("max_participants") or 0) or 2)
    return max(1, min(size // GROUP_TARGET_SIZE, size // 2))


def _can_create_initial_stage_preview(tournament: dict) -> bool:
    capability = find_format_capability(tournament.get("format"))
    if not capability or capability.initial_preview_engine != "stage":
        return False
    if capability.auto_match_limit != "legacy_estimate":
        return True
    # Jeder gegen jeden wächst quadratisch: eine Liga mit 64 Teilnehmern wären
    # über viertausend Spiele. Die Obergrenze gilt unabhängig vom Speicher.
    return 0 < _estimated_match_count(tournament) <= MAX_INITIAL_PREVIEW_MATCHES



def _v2_plan_key(match: dict) -> tuple:
    return (
        "v2",
        int(match.get("stage_number") or 0),
        match.get("section") or "",
        match.get("match_key") or "",
        int(match.get("round") or 0),
        int(match.get("order") or match.get("position") or 0),
    )


def _collect_match_plan(v2_matches: list[dict] | None = None) -> dict[tuple, dict]:
    plan: dict[tuple, dict] = {}
    for match in v2_matches or []:
        fields = {field: match.get(field) for field in MATCH_PLAN_FIELDS if match.get(field) is not None}
        if fields:
            plan[_v2_plan_key(match)] = fields
    return plan


def _apply_match_plan(matches: list[dict], plan: dict[tuple, dict], key_fn) -> list[dict]:
    for match in matches:
        fields = plan.get(key_fn(match))
        if not fields:
            continue
        match.update(fields)
        if fields.get("scheduled_at") and match.get("status") in {"preview", "pending", "ready", "scheduled"}:
            match["status"] = "scheduled"
    return matches


def _parse_plan_dt(value) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _plan_duration(match: dict, tournament: dict | None = None) -> int:
    tournament = tournament or {}
    raw = match.get("duration_minutes") or (match.get("settings") or {}).get("duration_minutes") or tournament.get("match_duration_minutes") or 30
    try:
        return max(1, int(raw))
    except Exception:
        return 30


def _plan_match_label(match: dict) -> str:
    return (
        match.get("match_key")
        or match.get("round_name")
        or (f"Spiel #{int(match.get('match_index') or 0) + 1}" if match.get("match_index") is not None else None)
        or match.get("id")
        or "Match"
    )


def _plan_match_sort(match: dict) -> tuple:
    scheduled = _parse_plan_dt(match.get("scheduled_at")) or datetime.max.replace(tzinfo=timezone.utc)
    return (
        scheduled,
        int(match.get("stage_number") or 0),
        str(match.get("section") or match.get("bracket") or ""),
        int(match.get("round") or 0),
        int(match.get("order") or match.get("position") or match.get("match_index") or 0),
        str(match.get("match_key") or match.get("id") or ""),
    )


def _plan_station_label(match: dict) -> str:
    return match.get("station_label") or match.get("station_name") or (match.get("station") or {}).get("name") or match.get("station_id") or ""


def _match_participant_count(match: dict) -> int:
    if match.get("slots"):
        return len([slot for slot in match.get("slots") or [] if slot.get("registration_id")])
    return int(bool(match.get("participant_a_id"))) + int(bool(match.get("participant_b_id")))


def _match_minimum_players(match: dict) -> int:
    if match.get("slots"):
        try:
            return max(1, int((match.get("settings") or {}).get("min_players") or 2))
        except (TypeError, ValueError):
            return 2
    return 2


def _match_has_minimum_players(match: dict, allow_preview: bool = True) -> bool:
    if not allow_preview and (match.get("is_preview") or match.get("status") == "preview"):
        return False
    return _match_participant_count(match) >= _match_minimum_players(match)


async def _collect_plan_matches(db, tid: str) -> tuple[list[dict], dict]:
    tournament = await db.tournaments.find_one({"id": tid}, {"_id": 0}) or {}
    matches = await db.matches_v2.find({"tournament_id": tid}, {"_id": 0}).to_list(3000)
    for match in matches:
        match["_collection"] = "matches_v2"
    await attach_station_info(db, matches)
    return sorted(matches, key=_plan_match_sort), tournament


def _planning_report(
    matches: list[dict],
    tournament: dict | None = None,
    participant_count: int | None = None,
    require_fixed_bracket: bool = False,
) -> dict:
    tournament = tournament or {}
    warnings: list[dict] = []
    errors: list[dict] = []
    event_mode = tournament.get("event_mode") or ("local" if tournament.get("location") and not tournament.get("stream_link") else "online")
    result_entry_mode = tournament.get("result_entry_mode") or ("staff_only" if event_mode == "local" else "player_confirmed")
    schedule_mode = tournament.get("schedule_mode") or ("fixed_by_staff" if event_mode == "local" else "player_proposal")
    if event_mode == "local" and result_entry_mode != "staff_only":
        warnings.append({
            "type": "rule_mode_conflict",
            "severity": "warning",
            "message": "Vor-Ort-Turnier erlaubt Spieler-Ergebnismeldungen. Für lokale Events ist meist 'Nur Turnierleitung' sinnvoll.",
        })
    if event_mode == "local" and schedule_mode != "fixed_by_staff":
        warnings.append({
            "type": "rule_mode_conflict",
            "severity": "warning",
            "message": "Vor-Ort-Turnier erlaubt Terminabstimmung. Für lokale Events ist meist 'Fix durch Turnierleitung' sinnvoll.",
        })
    if event_mode == "online" and result_entry_mode == "staff_only":
        warnings.append({
            "type": "rule_mode_conflict",
            "severity": "warning",
            "message": "Online-Turnier ist auf Staff-Erfassung gesetzt. Teilnehmer können keine Ergebnisse melden.",
        })
    planned_by_station: dict[str, list[dict]] = {}
    active_matches = [
        match for match in matches
        if match.get("status") not in MATCH_PLAN_DONE_STATUSES
    ]
    plannable_matches = [match for match in active_matches if _match_participant_count(match)]
    ready_matches = [
        match for match in active_matches
        if _match_has_minimum_players(match, allow_preview=not require_fixed_bracket)
    ]
    for match in plannable_matches:
        label = _plan_match_label(match)
        if not _match_has_minimum_players(match, allow_preview=not require_fixed_bracket):
            warnings.append({
                "type": "incomplete_match",
                "severity": "warning",
                "match_id": match.get("id"),
                "label": label,
                "message": f"{label}: zu wenige Teilnehmer für einen sicheren Start.",
            })
            continue
        if not match.get("scheduled_at"):
            warnings.append({"type": "missing_time", "severity": "warning", "match_id": match.get("id"), "label": label, "message": f"{label}: keine Startzeit geplant."})
        if not match.get("station_id"):
            warnings.append({"type": "missing_station", "severity": "warning", "match_id": match.get("id"), "label": label, "message": f"{label}: keine Station geplant."})
        scheduled = _parse_plan_dt(match.get("scheduled_at"))
        if scheduled and match.get("station_id"):
            planned_by_station.setdefault(match["station_id"], []).append({
                "match": match,
                "start": scheduled,
            })
    for station_id, rows in planned_by_station.items():
        enriched = []
        for row in rows:
            duration = _plan_duration(row["match"], tournament)
            enriched.append({**row, "end": row["start"] + timedelta(minutes=duration), "duration": duration})
        enriched.sort(key=lambda row: row["start"])
        for index, current in enumerate(enriched):
            for other in enriched[index + 1:]:
                if other["start"] >= current["end"]:
                    break
                station = _plan_station_label(current["match"]) or station_id
                msg = f"{station}: {_plan_match_label(current['match'])} überschneidet sich mit {_plan_match_label(other['match'])}."
                errors.append({
                    "type": "station_overlap",
                    "severity": "error",
                    "station_id": station_id,
                    "station": station,
                    "match_id": current["match"].get("id"),
                    "other_match_id": other["match"].get("id"),
                    "message": msg,
                })
    try:
        minimum_participants = max(2, int(tournament.get("min_participants") or 2))
    except (TypeError, ValueError):
        minimum_participants = 2
    if participant_count is not None and participant_count < minimum_participants:
        errors.insert(0, {
            "type": "insufficient_participants",
            "severity": "error",
            "participant_count": participant_count,
            "minimum_participants": minimum_participants,
            "message": f"Nur {participant_count} von mindestens {minimum_participants} Teilnehmern sind startbereit.",
        })
    if require_fixed_bracket and not ready_matches:
        errors.insert(0, {
            "type": "no_playable_matches",
            "severity": "error",
            "message": "Es gibt keinen fixierten, vollständig belegten Match-Start. Bracket und Teilnehmer prüfen.",
        })
    return {
        "ok": not errors,
        "rule_policy": {
            "event_mode": event_mode,
            "result_entry_mode": result_entry_mode,
            "schedule_mode": schedule_mode,
        },
        "error_count": len(errors),
        "warning_count": len(warnings),
        "participant_count": participant_count,
        "minimum_participants": minimum_participants,
        "checked_matches": len(plannable_matches),
        "ready_match_count": len(ready_matches),
        "errors": errors,
        "warnings": warnings,
    }


def _stage_defaults_for_tournament_format(tournament: dict, body: TournamentBracketStructurePayload | None = None) -> dict | None:
    fmt = (tournament.get("format") or "single_elim")
    capability = find_format_capability(fmt)
    settings = dict((body.settings if body else {}) or {})
    default_stage_type = (
        capability.canonical_stage_type
        if capability and capability.stage_generator_available
        else None
    )
    stage_type = (body.stage_type if body else None) or default_stage_type
    if not stage_type:
        return None
    if capability and stage_type == default_stage_type:
        default_match_type = capability.canonical_match_type
    else:
        default_match_type = "ffa" if stage_type.startswith("ffa_") or stage_type == "simple" else "duel"
    match_type = (body.match_type if body else None) or default_match_type
    settings.setdefault("match_size", 4 if match_type == "ffa" else 2)
    settings.setdefault("min_players", 2)
    if stage_type == "round_robin_groups":
        # Eine Gruppe ist ein Round Robin, mehrere sind eine Gruppenphase.
        settings.setdefault("group_count", _default_group_count(tournament) if fmt == "groups" else 1)
    settings.setdefault("qualifiers_per_match", 2 if match_type == "ffa" else 1)
    settings.setdefault("duration_minutes", int(tournament.get("match_duration_minutes") or 30))
    settings.setdefault("score_type", "points")
    settings.setdefault("calculation", "points")
    return {
        "name": (body.name if body and body.name else "Turnierbaum"),
        "number": 1,
        "stage_type": stage_type,
        "match_type": match_type,
        "settings": settings,
        "status": "pending",
    }


def _is_staff(user: dict | None) -> bool:
    return bool(user and user.get("role") in STAFF_ROLES)


async def _is_tournament_staff(tid: str, user: dict | None, roles: set[str] | None = None) -> bool:
    return await has_tournament_staff_permission(user, tid, roles or READ_STAFF_ROLES)


def _is_tournament_locked(tournament: dict | None) -> bool:
    return bool(tournament and tournament.get("locked_at"))


async def _ensure_tournament_unlocked(db, tid: str) -> dict:
    tournament = await db.tournaments.find_one({"id": tid}, {"_id": 0})
    if not tournament:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    if _is_tournament_locked(tournament):
        raise HTTPException(status_code=423, detail=TOURNAMENT_MUTATION_LOCKED_DETAIL)
    return tournament


async def _user_tournament_participation_ids(db, user: dict | None) -> set[str]:
    if not user:
        return set()
    team_ids = [
        row["team_id"] for row in await db.team_members.find(
            {"user_id": user["id"]},
            {"_id": 0, "team_id": 1},
        ).to_list(200)
        if row.get("team_id")
    ]
    query = {
        "status": {"$nin": ["rejected", "no_show"]},
        "$or": [{"user_id": user["id"]}],
    }
    if team_ids:
        query["$or"].append({"team_id": {"$in": team_ids}})
    return set(await db.tournament_registrations.distinct("tournament_id", query))


async def _user_participates_in_tournament(db, tid: str, user: dict | None) -> bool:
    if not user:
        return False
    participant_ids = await _user_tournament_participation_ids(db, user)
    return tid in participant_ids


async def _get_visible_tournament(tid: str, user: dict | None) -> dict:
    db = get_db()
    t = await db.tournaments.find_one({"id": tid}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    is_staff = _is_staff(user)
    is_assigned = await _is_tournament_staff(tid, user)
    if t.get("status") == "draft" and not (is_staff or is_assigned):
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    is_participant = await _user_participates_in_tournament(db, tid, user)
    if t.get("is_public") is False and not (is_staff or is_assigned or is_participant):
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    if not (is_staff or is_assigned or is_participant) and not await user_can_see(user, t.get("visibility") or "public"):
        raise HTTPException(status_code=403, detail="Turnier ist nicht sichtbar")
    return t


def _public_registration(reg: dict, user: dict | None, is_staff: bool) -> dict:
    if is_staff:
        return {key: value for key, value in reg.items() if key not in {"_id", "identity_key"}}
    is_self = bool(user and reg.get("user_id") == user.get("id"))
    out = {
        "id": reg.get("id"),
        "tournament_id": reg.get("tournament_id"),
        "status": reg.get("status"),
        "display_name": reg.get("display_name") or reg.get("ingame_name"),
        "ingame_name": reg.get("ingame_name"),
        "team_id": reg.get("team_id"),
        "seed": reg.get("seed"),
        "created_at": reg.get("created_at"),
    }
    if is_self:
        out["user_id"] = reg.get("user_id")
        from services.tournament_fees import public_price
        price = public_price(reg)
        if price:
            out["price"] = price
    return out


def _normalize_team_settings(doc: dict) -> dict:
    mode = doc.get("team_mode") or "solo"
    if mode not in {"solo", "team"}:
        raise HTTPException(status_code=422, detail="Teilnahme muss 'solo' oder 'team' sein")
    if mode == "solo":
        doc["team_mode"] = "solo"
        doc["team_size"] = 1
        return doc
    team_size = int(doc.get("team_size") or 2)
    if team_size < 2 or team_size > 6:
        raise HTTPException(status_code=422, detail="Spieler pro Team muss zwischen 2 und 6 liegen")
    doc["team_mode"] = "team"
    doc["team_size"] = team_size
    return doc


async def _enrich_game_identity(db, game: dict | None) -> dict | None:
    if not game:
        return None
    parent = None
    if game.get("parent_game_id"):
        parent = await db.games.find_one({"id": game.get("parent_game_id")}, {"_id": 0})
    name = (game.get("name") or "").strip()
    parent_name = ((parent or {}).get("name") or "").strip()
    if game.get("kind") == "edition" and parent_name and name and not name.lower().startswith(f"{parent_name.lower()}:") and name.lower() != parent_name.lower():
        game["display_name"] = f"{parent_name}: {name}"
    else:
        game["display_name"] = name
    if parent:
        game["parent_game"] = {
            "id": parent.get("id"),
            "name": parent.get("name"),
            "display_name": parent.get("display_name") or parent.get("name"),
            "slug": parent.get("slug"),
            "short_name": parent.get("short_name"),
        }
    source = game
    source_id = game.get("identity_source_game_id")
    if not source_id and game.get("inherit_player_ids") is not False:
        source_id = game.get("parent_game_id")
    if source_id:
        source = await db.games.find_one({"id": source_id}, {"_id": 0}) or game
    seen = set()
    fields = []
    for field in (source.get("player_id_fields") or []) + (game.get("player_id_fields") or []):
        if not isinstance(field, dict) or not field.get("key") or field["key"] in seen:
            continue
        seen.add(field["key"])
        fields.append(field)
    game["identity_game_slug"] = source.get("slug") or game.get("slug")
    game["identity_game_name"] = source.get("name") or game.get("name")
    game["effective_player_id_fields"] = fields
    return game


async def _audit_tournament_action(db, action: str, actor_id: str | None,
                                   target_id: str, data: dict | None = None) -> None:
    # Strukturarbeit ist der zweite Schreibweg neben den Ergebnissen; welche
    # Engine dabei bedient wurde, steht in den mitgegebenen Daten.
    await record_write(
        (data or {}).get("engine") or "unknown",
        action,
        tournament_id=target_id,
        format_key=(data or {}).get("format"),
    )
    await db.audit_logs.insert_one({
        "id": new_id(),
        "action": action,
        "target_id": target_id,
        "actor_id": actor_id,
        "data": data or {},
        "created_at": now_utc().isoformat(),
    })


async def _create_initial_stage_bracket_preview(db, tournament: dict, actor_id: str | None) -> dict | None:
    """Create a V2 preview stage for free/custom bracket formats."""
    if not _can_create_initial_stage_preview(tournament):
        return None
    tid = tournament["id"]
    if await db.tournament_stages.count_documents({"tournament_id": tid}):
        return None
    if await db.matches_v2.count_documents({"tournament_id": tid}):
        return None

    stage_defaults = _stage_defaults_for_tournament_format(tournament, None)
    if not stage_defaults:
        return None
    stage = {
        **stage_defaults,
        "id": new_id(),
        "tournament_id": tid,
        "created_at": now_utc().isoformat(),
        "updated_at": now_utc().isoformat(),
        "created_by": actor_id,
    }
    registrations = await db.tournament_registrations.find(
        {"tournament_id": tid, "status": {"$in": ["approved", "checked_in"]}},
        {"_id": 0},
    ).to_list(5000)
    try:
        matches = build_matches_v2_from_schema(tournament, stage, registrations, preview=True)
    except BracketSchemaError:
        return None
    if not matches:
        return None

    await db.tournament_stages.insert_one(stage)
    await db.matches_v2.insert_many(matches)
    await persist_competition_versions(db, tournament, "graph")
    await _audit_tournament_action(
        db,
        "tournament.stage.preview_create",
        actor_id,
        tid,
        {
            "stage_id": stage["id"],
            "stage_type": stage.get("stage_type"),
            "match_type": stage.get("match_type"),
            "match_count": len(matches),
            "participant_count": len(registrations),
        },
    )
    return {
        "ok": True,
        "engine": "stages",
        "stage_id": stage["id"],
        "match_count": len(matches),
        "preview": True,
        "participant_count": len(registrations),
    }



def _v2_match_can_be_rebuilt(match: dict) -> bool:
    status = match.get("status") or "pending"
    if match.get("is_preview") or status in {"pending", "ready", "scheduled", "cancelled"}:
        return True
    if status == "completed" and (match.get("result_meta") or {}).get("source") == "auto_bye":
        return True
    return False


async def _rebuild_checkin_bracket_after_staff_change(db, tournament: dict, actor_id: str | None) -> dict | None:
    """Rebuild the fixed check-in bracket after staff changes, until real play starts."""
    tid = tournament["id"]
    registrations = await db.tournament_registrations.find(
        {"tournament_id": tid, "status": {"$in": ["approved", "checked_in"]}},
        {"_id": 0},
    ).to_list(5000)
    if len(registrations) < 2:
        return None

    v2_matches = await db.matches_v2.find({"tournament_id": tid}, {"_id": 0}).to_list(3000)
    match_plan = _collect_match_plan(v2_matches)
    locked_v2 = [m.get("id") for m in v2_matches if not _v2_match_can_be_rebuilt(m)]
    if locked_v2:
        return {
            "ok": False,
            "reason": "matches_started",
            "preview": False,
            "participant_count": len(registrations),
            "locked_match_count": len(locked_v2),
        }

    stages = await db.tournament_stages.find(
        {"tournament_id": tid},
        {"_id": 0},
    ).sort("number", 1).to_list(200)
    if stages:
        if v2_matches:
            match_ids = [match["id"] for match in v2_matches if match.get("id")]
            if match_ids:
                await db.match_reports_v2.delete_many({"match_id": {"$in": match_ids}})
            await db.matches_v2.delete_many({"tournament_id": tid})

        changed_stages: list[dict] = []
        total_matches = 0
        for stage in stages:
            try:
                matches = build_matches_v2_from_schema(tournament, stage, registrations, preview=False)
            except BracketSchemaError as exc:
                return {
                    "ok": False,
                    "reason": "schema_error",
                    "detail": str(exc),
                    "preview": False,
                    "participant_count": len(registrations),
                }
            if not matches:
                continue
            _apply_match_plan(matches, match_plan, _v2_plan_key)
            await db.matches_v2.insert_many(matches)
            await db.tournament_stages.update_one(
                {"id": stage["id"]},
                {"$set": {"status": "ready", "updated_at": now_utc().isoformat()}},
            )
            changed_stages.append({
                "stage_id": stage["id"],
                "stage_number": stage.get("number"),
                "stage_type": stage.get("stage_type"),
                "match_count": len(matches),
            })
            total_matches += len(matches)

        if not changed_stages:
            return None
        await persist_competition_versions(db, tournament, "graph")
        await _audit_tournament_action(
            db,
            "tournament.stage.checkin_rebuild_after_registration",
            actor_id,
            tid,
            {
                "stage_count": len(changed_stages),
                "match_count": total_matches,
                "participant_count": len(registrations),
            },
        )
        return {
            "ok": True,
            "engine": "stages",
            "match_count": total_matches,
            "participant_count": len(registrations),
            "stages": changed_stages,
            "preview": False,
            "reason": "checkin_rebuild",
        }

    return None


async def _resolve_tid(slug_or_id: str) -> str:
    """Resolve slug to id if needed. Returns id or raises 404."""
    db = get_db()
    t, _ = await find_by_slug_or_history(db.tournaments, slug_or_id, {"id": 1})
    if not t:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    return t["id"]


async def _serialized_tournament_write(tid: str):
    """Serialize critical writes for one canonical tournament across workers."""
    db = get_db()
    resolved_tid = await _resolve_tid(tid)
    try:
        async with mutation_lock(db, tournament_write_resource(resolved_tid)):
            yield resolved_tid
    except MutationLockBusy:
        raise HTTPException(status_code=409, detail="Eine Turnieraktion wird bereits verarbeitet. Bitte erneut versuchen.")


# ---------- Swiss / Groups specific ----------
async def _competition_engine(db, tid: str, tournament: dict | None = None) -> str:
    """Which store this tournament writes to.

    Existing documents decide first: a tournament stays in the engine it was
    built in, so neither generator can move a running one behind the organiser's
    back. A stage without matches already counts - it is the structure the next
    round will be written into.

    Only a tournament that has nothing yet follows its format, and every format
    now points at the graph. The classic store is no longer read at all (#231).
    """
    if await db.tournament_stages.count_documents({"tournament_id": tid}):
        return GRAPH
    if await db.matches_v2.count_documents({"tournament_id": tid}):
        return GRAPH
    return preferred_engine((tournament or {}).get("format"))
