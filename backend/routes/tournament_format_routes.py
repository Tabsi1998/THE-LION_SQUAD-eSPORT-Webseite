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
from services import tournament_guard
from models import now_utc, new_id
from routes.tournament_common import (
    _audit_tournament_action,
    _default_group_count,
    _ensure_tournament_unlocked,
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
    # Der Status bleibt (#2120, TA11): live geht es über „Turnier starten“ - mit Check-in-Ende und Planungsprüfung.
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


async def _swiss_tournament(db, tid: str) -> dict:
    """Ein Schweizer Turnier, das sich noch ändern lässt: nicht gesperrt (423), nicht vorbei oder abgesagt (409)."""
    t = await db.tournaments.find_one({"id": tid}, {"_id": 0})
    if not t or t.get("format") != "swiss":
        raise HTTPException(status_code=400, detail="Nur für Swiss-Turniere")
    await _ensure_tournament_unlocked(db, tid)
    problem = tournament_guard.finished_problem(t) or (SWISS_CANCELLED if t.get("status") == "cancelled" else None)
    if problem:
        raise HTTPException(status_code=409, detail=problem)
    return t


SWISS_CANCELLED = "Das Turnier ist abgesagt – es gibt keine neue Runde."


@router.post("/{tid}/swiss/next-round")
async def swiss_next_round(tid: str, me: dict = Depends(require_admin()),
                           _mutation_tid: str = Depends(_serialized_tournament_write)):
    db = get_db()
    tid = await _resolve_tid(tid)
    t = await _swiss_tournament(db, tid)
    return await _swiss_next_round_graph(db, t, me.get("id"))


@router.post("/{tid}/swiss/undo-round")
async def swiss_undo_round(tid: str, me: dict = Depends(require_admin()),
                           _mutation_tid: str = Depends(_serialized_tournament_write)):
    """„Letzte Runde zurücknehmen“ (#2120, TA11): eine falsch erzeugte Runde verschwindet wieder - solange keines ihrer
    Spiele aufgerufen, gestartet, gemeldet oder gewertet ist (ein Freilos zählt nicht) und keines an einer Station
    hängt. Danach erzeugt „Schweizer Runde“ sie neu."""
    db = get_db()
    tid = await _resolve_tid(tid)
    t = await _swiss_tournament(db, tid)
    stage = await db.tournament_stages.find_one({"tournament_id": tid, "stage_type": "swiss"}, {"_id": 0})
    matches = await db.matches_v2.find({"stage_id": stage["id"]}, {"_id": 0}).to_list(3000) if stage else []
    if not matches:
        raise HTTPException(status_code=409, detail="Es gibt noch keine Runde zum Zurücknehmen.")
    round_number = max(int(match.get("round") or 0) for match in matches)
    last_round = [match for match in matches if int(match.get("round") or 0) == round_number]
    match_ids = [match["id"] for match in last_round if match.get("id")]
    begun = [match for match in last_round if tournament_guard.match_begun(match)]
    reported = await db.match_reports_v2.count_documents({"match_id": {"$in": match_ids}})
    at_station = await db.stations.count_documents({"current_match_id": {"$in": match_ids}})
    if begun or reported or at_station:
        raise HTTPException(
            status_code=409,
            detail=f"In Runde {round_number} hat schon ein Spiel begonnen oder steht an einer Station – die Runde "
                   "bleibt. Einzelne Ergebnisse korrigierst du im Reiter „Spiele“.",
        )
    await db.matches_v2.delete_many({"id": {"$in": match_ids}})
    if len(match_ids) == len(matches):
        await db.tournament_stages.update_one(
            {"id": stage["id"]}, {"$set": {"status": "pending", "updated_at": now_utc().isoformat()}})
    await persist_competition_versions(db, t, "graph")
    await _audit_tournament_action(
        db, "tournament.swiss.undo_round", me.get("id"), tid,
        {"engine": "graph", "stage_id": stage["id"], "round": round_number, "match_count": len(match_ids)},
    )
    return {"ok": True, "round": round_number, "match_count": len(match_ids)}


async def _groups_generate_graph(db, tournament: dict, group_count: int, actor_id: str | None,
                                 force: bool = False) -> dict:
    tid = tournament["id"]
    # Gruppen neu generieren löscht alle Spiele der Gruppenphase (#2120, TA10): echte Spiele nur mit Bestätigung, die
    # ihre Zahl nennt - vorher gingen Ergebnisse ohne Warnung verloren.
    current = await db.tournament_stages.find_one(
        {"tournament_id": tid, "stage_type": "round_robin_groups"}, {"_id": 0, "id": 1})
    if current and not force:
        impact = tournament_guard.match_impact(
            await tournament_guard.tournament_matches(db, {"stage_id": current["id"]}))
        if impact["match_count"]:
            raise HTTPException(status_code=409, detail=tournament_guard.confirm_detail(
                "confirm_destruction",
                f"Neue Gruppen löschen alle Spiele der Gruppenphase ({tournament_guard.impact_text(impact)}) samt "
                "Ergebnissen.",
                impact,
            ))
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
    # Der Status bleibt (#2120, TA10): vorher setzte „Gruppen generieren“ jedes Turnier hart auf „Live“, sogar ein
    # beendetes. Gestartet wird über „Turnier starten“.
    await _audit_tournament_action(
        db, "tournament.groups.generate", actor_id, tid,
        {"engine": "graph", "stage_id": stage["id"], "group_count": len(groups),
         "match_count": len(matches), "force": force},
    )
    return {
        "ok": True,
        "engine": "graph",
        "stage_id": stage["id"],
        "group_count": len(groups),
        "match_count": len(matches),
    }


@router.post("/{tid}/groups/generate")
async def groups_generate(tid: str, body: dict | None = None, force: bool = False,
                          me: dict = Depends(require_admin()),
                          _mutation_tid: str = Depends(_serialized_tournament_write)):
    db = get_db()
    tid = await _resolve_tid(tid)
    t = await db.tournaments.find_one({"id": tid}, {"_id": 0})
    if not t or t.get("format") != "groups":
        raise HTTPException(status_code=400, detail="Nur für Group-Stage")
    # Sperre und Ende (#2120, TA10): ein gesperrtes oder beendetes Turnier bekommt keine neuen Gruppen.
    await _ensure_tournament_unlocked(db, tid)
    finished = tournament_guard.finished_problem(t)
    if finished:
        raise HTTPException(status_code=409, detail=finished)
    group_count = int((body or {}).get("group_count", _default_group_count(t)))
    return await _groups_generate_graph(db, t, group_count, me.get("id"), force=force)


@router.get("/{tid}/groups")
async def list_groups(tid: str, user=Depends(get_optional_user)):
    db = get_db()
    tid = await _resolve_tid(tid)
    await _get_visible_tournament(tid, user)
    return await db.tournament_groups.find({"tournament_id": tid}, {"_id": 0}).to_list(50)
