"""Schweizer Runden und Gruppen erzeugen.
"""
from fastapi import HTTPException, Depends
from database import get_db
from auth import require_admin, get_optional_user
from services.custom_bracket import (
    BracketSchemaError,
    build_matches_v2_from_schema,
    groups_from_generated_matches,
)
from services.graph_swiss import (
    next_round_number,
    open_matches as open_swiss_matches,
    swiss_round_documents,
)
from services.competition_versions import persist_competition_versions
from models import now_utc, new_id
from routes.tournament_common import (
    _audit_tournament_action,
    _default_group_count,
    _get_visible_tournament,
    _resolve_tid,
    _serialized_tournament_write,
)
from routes.tournament_router import router


async def _dedicated_stage(db, tournament: dict, stage_type: str, settings: dict,
                           name: str, actor_id: str | None) -> dict:
    """Find or create the one stage a Swiss or group tournament runs in."""
    tid = tournament["id"]
    stage = await db.tournament_stages.find_one(
        {"tournament_id": tid, "stage_type": stage_type}, {"_id": 0})
    if stage:
        merged = {**(stage.get("settings") or {}), **settings}
        if merged != (stage.get("settings") or {}):
            await db.tournament_stages.update_one(
                {"id": stage["id"]},
                {"$set": {"settings": merged, "updated_at": now_utc().isoformat()}},
            )
            stage["settings"] = merged
        return stage
    number = await db.tournament_stages.count_documents({"tournament_id": tid}) + 1
    stage = {
        "id": new_id(),
        "tournament_id": tid,
        "name": name,
        "number": number,
        "stage_type": stage_type,
        "match_type": "duel",
        "settings": {
            "min_players": 2,
            "match_size": 2,
            "qualifiers_per_match": 1,
            "score_type": "points",
            "calculation": "points",
            "duration_minutes": int(tournament.get("match_duration_minutes") or 30),
            **settings,
        },
        "status": "pending",
        "created_at": now_utc().isoformat(),
        "updated_at": now_utc().isoformat(),
        "created_by": actor_id,
    }
    await db.tournament_stages.insert_one(dict(stage))
    return stage


async def _swiss_next_round_graph(db, tournament: dict, actor_id: str | None) -> dict:
    tid = tournament["id"]
    stage = await _dedicated_stage(db, tournament, "swiss", {}, "Schweizer System", actor_id)
    played = await db.matches_v2.find({"stage_id": stage["id"]}, {"_id": 0}).to_list(3000)
    round_number = next_round_number(played)
    still_open = open_swiss_matches(played, round_number - 1)
    if still_open:
        raise HTTPException(status_code=400, detail=f"{len(still_open)} Matches sind noch offen")

    regs = await db.tournament_registrations.find(
        {"tournament_id": tid, "status": {"$in": ["approved", "checked_in"]}},
        {"_id": 0},
    ).to_list(500)
    documents = swiss_round_documents(
        tournament, stage, regs, played, round_number=round_number,
    )
    if not documents:
        raise HTTPException(status_code=400, detail="Mindestens 2 Teilnehmer benötigt")

    await db.matches_v2.insert_many(documents)
    await db.tournament_stages.update_one(
        {"id": stage["id"]},
        {"$set": {"status": "ready", "updated_at": now_utc().isoformat()}},
    )
    await persist_competition_versions(db, tournament, "graph")
    if tournament.get("status") == "draft":
        await db.tournaments.update_one({"id": tid}, {"$set": {"status": "live"}})
    await _audit_tournament_action(
        db, "tournament.swiss.next_round", actor_id, tid,
        {"engine": "graph", "stage_id": stage["id"], "round": round_number,
         "match_count": len(documents)},
    )
    return {
        "ok": True,
        "engine": "graph",
        "stage_id": stage["id"],
        "round": round_number,
        "match_count": len(documents),
    }


@router.post("/{tid}/swiss/next-round")
async def swiss_next_round(tid: str, me: dict = Depends(require_admin()),
                           _mutation_tid: str = Depends(_serialized_tournament_write)):
    db = get_db()
    tid = await _resolve_tid(tid)
    t = await db.tournaments.find_one({"id": tid})
    if not t or t.get("format") != "swiss":
        raise HTTPException(status_code=400, detail="Nur für Swiss-Turniere")
    return await _swiss_next_round_graph(db, t, me.get("id"))


async def _groups_generate_graph(db, tournament: dict, group_count: int, actor_id: str | None) -> dict:
    tid = tournament["id"]
    stage = await _dedicated_stage(
        db, tournament, "round_robin_groups", {"group_count": group_count}, "Gruppenphase", actor_id)
    regs = await db.tournament_registrations.find(
        {"tournament_id": tid, "status": {"$in": ["approved", "checked_in"]}},
        {"_id": 0},
    ).to_list(500)
    if len(regs) < 2:
        raise HTTPException(status_code=400, detail="Mindestens 2 Teilnehmer benötigt")
    try:
        matches = build_matches_v2_from_schema(tournament, stage, regs, preview=False)
    except BracketSchemaError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not matches:
        raise HTTPException(status_code=400, detail="Die Gruppenphase erzeugt keine Spiele.")

    groups = groups_from_generated_matches(matches)
    group_id_by_section = {group["section"]: group["id"] for group in groups}
    for match in matches:
        group_id = group_id_by_section.get(match.get("section") or "")
        if group_id:
            match["group_id"] = group_id

    old_match_ids = await db.matches_v2.distinct("id", {"stage_id": stage["id"]})
    if old_match_ids:
        await db.match_reports_v2.delete_many({"match_id": {"$in": old_match_ids}})
    await db.matches_v2.delete_many({"stage_id": stage["id"]})
    await db.tournament_groups.delete_many({"tournament_id": tid})
    await db.tournament_groups.insert_many([
        {**group, "tournament_id": tid, "created_at": now_utc().isoformat()}
        for group in groups
    ])
    await db.matches_v2.insert_many(matches)
    await db.tournament_stages.update_one(
        {"id": stage["id"]},
        {"$set": {"status": "ready", "updated_at": now_utc().isoformat()}},
    )
    await persist_competition_versions(db, tournament, "graph")
    await db.tournaments.update_one({"id": tid}, {"$set": {"status": "live"}})
    await _audit_tournament_action(
        db, "tournament.groups.generate", actor_id, tid,
        {"engine": "graph", "stage_id": stage["id"], "group_count": len(groups),
         "match_count": len(matches)},
    )
    return {
        "ok": True,
        "engine": "graph",
        "stage_id": stage["id"],
        "group_count": len(groups),
        "match_count": len(matches),
    }


@router.post("/{tid}/groups/generate")
async def groups_generate(tid: str, body: dict, me: dict = Depends(require_admin()),
                          _mutation_tid: str = Depends(_serialized_tournament_write)):
    db = get_db()
    tid = await _resolve_tid(tid)
    t = await db.tournaments.find_one({"id": tid})
    if not t or t.get("format") != "groups":
        raise HTTPException(status_code=400, detail="Nur für Group-Stage")
    group_count = int(body.get("group_count", _default_group_count(t)))
    return await _groups_generate_graph(db, t, group_count, me.get("id"))


@router.get("/{tid}/groups")
async def list_groups(tid: str, user=Depends(get_optional_user)):
    db = get_db()
    tid = await _resolve_tid(tid)
    await _get_visible_tournament(tid, user)
    return await db.tournament_groups.find({"tournament_id": tid}, {"_id": 0}).to_list(50)
