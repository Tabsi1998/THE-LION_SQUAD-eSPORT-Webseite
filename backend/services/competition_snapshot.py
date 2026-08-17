"""Read-only canonical projection for legacy and stage competition matches.

The adapters in this module never mutate source documents and never write to
MongoDB.  They provide the seam required to move readers away from collection-
specific fields before any tournament changes its source of truth.
"""

from __future__ import annotations

from collections import Counter
from copy import deepcopy
from typing import Iterable


STRUCTURE_SNAPSHOT_VERSION = "competition.structure.v1"


def _positive_int(value, default: int | None = None) -> int | None:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return parsed if parsed > 0 else default


def _slot_position(value) -> int | None:
    normalized = str(value or "").strip().lower()
    if normalized in {"a", "1"}:
        return 1
    if normalized in {"b", "2"}:
        return 2
    return _positive_int(normalized)


def _legacy_advancement(match: dict) -> list[dict]:
    edges: list[dict] = []
    for outcome, id_field, slot_field in (
        ("winner", "next_match_id", "next_match_slot"),
        ("loser", "next_loser_match_id", "next_loser_slot"),
    ):
        target_id = match.get(id_field)
        if not target_id:
            continue
        edges.append({
            "outcome": outcome,
            "rank": 1,
            "to_match_id": target_id,
            "to_match_key": None,
            "to_position": _slot_position(match.get(slot_field)),
        })
    return edges


def _stage_advancement(match: dict) -> list[dict]:
    edges: list[dict] = []
    for edge in match.get("advancement") or []:
        flow = str(edge.get("flow") or "R").upper()
        outcome = {"W": "winner", "L": "loser", "R": "rank"}.get(flow, "rank")
        edges.append({
            "outcome": outcome,
            "rank": _positive_int(edge.get("rank"), 1),
            "to_match_id": edge.get("to_match_id"),
            "to_match_key": edge.get("to_match_key"),
            "to_position": _slot_position(edge.get("to_slot")),
        })
    return edges


def _legacy_results(match: dict) -> list[dict]:
    status = str(match.get("status") or "pending")
    winner_id = match.get("winner_id")
    loser_id = match.get("loser_id")
    completed = status in {"completed", "forfeit"} or bool(winner_id)
    if not completed:
        return []

    participants = [
        (match.get("participant_a_id"), match.get("score_a")),
        (match.get("participant_b_id"), match.get("score_b")),
    ]
    score_by_id = {registration_id: score for registration_id, score in participants if registration_id}
    if not winner_id and len(score_by_id) == 2:
        ordered = list(score_by_id.items())
        if ordered[0][1] is not None and ordered[1][1] is not None:
            if ordered[0][1] > ordered[1][1]:
                winner_id, loser_id = ordered[0][0], ordered[1][0]
            elif ordered[1][1] > ordered[0][1]:
                winner_id, loser_id = ordered[1][0], ordered[0][0]

    draw = (
        not winner_id
        and len(score_by_id) == 2
        and all(score is not None for score in score_by_id.values())
        and len(set(score_by_id.values())) == 1
    )
    results: list[dict] = []
    for registration_id, score in participants:
        if not registration_id:
            continue
        if registration_id == winner_id:
            outcome, rank = "winner", 1
        elif registration_id == loser_id or winner_id:
            outcome, rank = "loser", 2
        elif draw:
            outcome, rank = "draw", 1
        else:
            outcome, rank = None, None
        results.append({
            "registration_id": registration_id,
            "rank": rank,
            "score": score,
            "points": None,
            "time_ms": None,
            "outcome": outcome,
            "dnf": False,
            "forfeit": bool(status == "forfeit" and outcome == "loser"),
            "note": None,
        })
    return results


def _stage_results(match: dict) -> list[dict]:
    results: list[dict] = []
    for result in match.get("results") or []:
        rank = result.get("rank")
        if result.get("forfeit"):
            outcome = "forfeit"
        elif result.get("dnf"):
            outcome = "dnf"
        elif rank == 1:
            outcome = "winner"
        elif rank is not None:
            outcome = "placed"
        else:
            outcome = None
        results.append({
            "registration_id": result.get("registration_id"),
            "rank": rank,
            "score": result.get("score"),
            "points": result.get("points"),
            "time_ms": result.get("time_ms"),
            "outcome": outcome,
            "dnf": bool(result.get("dnf")),
            "forfeit": bool(result.get("forfeit")),
            "note": result.get("note"),
        })
    return results


def _legacy_incoming_sources(matches: Iterable[dict]) -> dict[tuple[str, int], dict]:
    incoming: dict[tuple[str, int], dict] = {}
    for match in matches:
        source_id = match.get("id")
        if not source_id:
            continue
        for edge in _legacy_advancement(match):
            target_id = edge.get("to_match_id")
            position = edge.get("to_position")
            if target_id and position:
                incoming[(target_id, position)] = {
                    "type": "match_result",
                    "match_id": source_id,
                    "match_key": None,
                    "outcome": edge["outcome"],
                    "rank": edge["rank"],
                }
    return incoming


def _legacy_slot(match: dict, position: int, incoming: dict[tuple[str, int], dict]) -> dict:
    participant_field = "participant_a_id" if position == 1 else "participant_b_id"
    registration_id = match.get(participant_field)
    source = incoming.get((match.get("id"), position))
    if not source:
        if registration_id:
            source = {"type": "direct"}
        elif match.get("status") == "completed" and match.get("winner_id"):
            source = {"type": "bye"}
        else:
            source = {"type": "unassigned"}
    if registration_id:
        state = "filled"
    elif source.get("type") == "bye":
        state = "bye"
    elif match.get("is_preview") or match.get("status") == "preview":
        state = "preview"
    else:
        state = "pending"
    return {
        "position": position,
        "registration_id": registration_id,
        "user_id": None,
        "seed": None,
        "state": state,
        "source": source,
    }


def _stage_source(source: dict, match_ids_by_key: dict[tuple[str | None, str], str]) -> dict:
    source_type = source.get("type")
    if source_type == "seed":
        return {"type": "seed", "seed": source.get("seed")}
    if source_type == "bye":
        return {"type": "bye"}
    if source_type == "rank":
        flow = str(source.get("flow") or "R").upper()
        match_key = source.get("match_key")
        stage_id = source.get("stage_id")
        return {
            "type": "match_result",
            "match_id": source.get("match_id") or match_ids_by_key.get((stage_id, match_key)),
            "match_key": match_key,
            "outcome": {"W": "winner", "L": "loser", "R": "rank"}.get(flow, "rank"),
            "rank": _positive_int(source.get("rank"), 1),
        }
    return deepcopy(source) if source else {"type": "unassigned"}


def _common_match_fields(match: dict, collection: str, engine: str) -> dict:
    return {
        "schema_version": STRUCTURE_SNAPSHOT_VERSION,
        "id": match.get("id"),
        "tournament_id": match.get("tournament_id"),
        "stage_id": match.get("stage_id"),
        "stage_number": match.get("stage_number"),
        "group_id": match.get("group_id"),
        "round": match.get("round") or match.get("matchday_number"),
        "round_name": match.get("round_name") or match.get("matchday_label"),
        "match_key": match.get("match_key"),
        "section": match.get("section") or match.get("bracket"),
        "final_position": match.get("final_position"),
        "match_type": match.get("match_type") or "duel",
        "status": match.get("status") or "pending",
        "scheduled_at": match.get("scheduled_at"),
        "updated_at": match.get("updated_at"),
        "duration_minutes": match.get("duration_minutes"),
        "station_id": match.get("station_id"),
        "station": deepcopy(match.get("station")),
        "station_name": match.get("station_name"),
        "station_label": match.get("station_label"),
        "best_of": match.get("best_of"),
        "map": match.get("map"),
        "order": match.get("order") if match.get("order") is not None else match.get("match_index"),
        "is_preview": bool(match.get("is_preview") or match.get("status") == "preview"),
        "generation_mode": match.get("generation_mode"),
        "collection": collection,
        "source": {"engine": engine, "collection": collection},
    }


def adapt_legacy_matches(matches: Iterable[dict]) -> list[dict]:
    """Project legacy A/B matches into canonical variable-slot matches."""

    source_matches = [dict(match) for match in matches]
    incoming = _legacy_incoming_sources(source_matches)
    adapted: list[dict] = []
    for match in source_matches:
        canonical = _common_match_fields(match, "matches", "legacy")
        canonical["slots"] = [_legacy_slot(match, 1, incoming), _legacy_slot(match, 2, incoming)]
        canonical["results"] = _legacy_results(match)
        canonical["advancement"] = _legacy_advancement(match)
        adapted.append(canonical)
    return _sort_matches(adapted)


def adapt_stage_matches(matches: Iterable[dict]) -> list[dict]:
    """Project stage/V2 documents into the same canonical match shape."""

    source_matches = [dict(match) for match in matches]
    match_ids_by_key = {
        (match.get("stage_id"), match.get("match_key")): match.get("id")
        for match in source_matches
        if match.get("match_key") and match.get("id")
    }
    adapted: list[dict] = []
    for match in source_matches:
        canonical = _common_match_fields(match, "matches_v2", "stage")
        canonical["slots"] = [
            {
                "position": _slot_position(slot.get("slot")) or index,
                "registration_id": slot.get("registration_id"),
                "user_id": slot.get("user_id"),
                "seed": slot.get("seed"),
                "state": slot.get("status") or "pending",
                "source": _stage_source(
                    {**(slot.get("source") or {}), "stage_id": match.get("stage_id")},
                    match_ids_by_key,
                ),
            }
            for index, slot in enumerate(match.get("slots") or [], start=1)
        ]
        canonical["results"] = _stage_results(match)
        canonical["advancement"] = _stage_advancement(match)
        adapted.append(canonical)
    return _sort_matches(adapted)


def _sort_matches(matches: Iterable[dict]) -> list[dict]:
    return sorted(
        matches,
        key=lambda match: (
            _positive_int(match.get("stage_number"), 0),
            _positive_int(match.get("round"), 0),
            _positive_int(match.get("order"), 0),
            str(match.get("id") or ""),
        ),
    )


def build_structure_snapshot(
    tournament_id: str,
    *,
    legacy_matches: Iterable[dict] = (),
    stage_matches: Iterable[dict] = (),
    stages: Iterable[dict] = (),
) -> dict:
    legacy = adapt_legacy_matches(legacy_matches)
    stage = adapt_stage_matches(stage_matches)
    engines = [engine for engine, rows in (("legacy", legacy), ("stage", stage)) if rows]
    return {
        "schema_version": STRUCTURE_SNAPSHOT_VERSION,
        "tournament_id": tournament_id,
        "source_engines": engines,
        "mixed_source": len(engines) > 1,
        "stages": [
            {
                "id": item.get("id"),
                "number": item.get("number"),
                "name": item.get("name"),
                "stage_type": item.get("stage_type"),
                "match_type": item.get("match_type"),
                "status": item.get("status"),
                "settings": deepcopy(item.get("settings") or {}),
            }
            for item in stages
        ],
        "matches": _sort_matches([*legacy, *stage]),
    }


def semantic_match_projection(match: dict) -> dict:
    """Return engine-independent fields used by shadow/differential tests."""

    return {
        "id": match.get("id"),
        "tournament_id": match.get("tournament_id"),
        "round": match.get("round"),
        "status": match.get("status"),
        "scheduled_at": match.get("scheduled_at"),
        "station_id": match.get("station_id"),
        "slots": [
            {
                "position": slot.get("position"),
                "registration_id": slot.get("registration_id"),
                "state": slot.get("state"),
            }
            for slot in match.get("slots") or []
        ],
        "results": [
            {
                "registration_id": result.get("registration_id"),
                "rank": result.get("rank"),
                "score": result.get("score"),
            }
            for result in match.get("results") or []
        ],
        "advancement": [
            {
                "outcome": edge.get("outcome"),
                "rank": edge.get("rank"),
                "to_match_id": edge.get("to_match_id"),
                "to_position": edge.get("to_position"),
            }
            for edge in match.get("advancement") or []
        ],
    }


def compare_structure_snapshots(reference: dict, candidate: dict) -> dict:
    """Return bounded semantic diff metrics for migration shadow reads."""

    reference_by_id = {
        match.get("id"): semantic_match_projection(match)
        for match in reference.get("matches") or []
        if match.get("id")
    }
    candidate_by_id = {
        match.get("id"): semantic_match_projection(match)
        for match in candidate.get("matches") or []
        if match.get("id")
    }
    reference_ids = set(reference_by_id)
    candidate_ids = set(candidate_by_id)
    shared_ids = reference_ids & candidate_ids
    mismatches = sorted(
        match_id
        for match_id in shared_ids
        if reference_by_id[match_id] != candidate_by_id[match_id]
    )
    missing_ids = sorted(reference_ids - candidate_ids)
    extra_ids = sorted(candidate_ids - reference_ids)
    return {
        "reference_count": len(reference_ids),
        "candidate_count": len(candidate_ids),
        "shared_count": len(shared_ids),
        "mismatch_count": len(mismatches),
        "missing_count": len(missing_ids),
        "extra_count": len(extra_ids),
        "equivalent": not mismatches and not missing_ids and not extra_ids,
        "mismatch_ids": mismatches[:25],
        "missing_ids": missing_ids[:25],
        "extra_ids": extra_ids[:25],
        "truncated": any(len(items) > 25 for items in (mismatches, missing_ids, extra_ids)),
    }


def structure_snapshot_issues(snapshot: dict) -> list[dict]:
    """Validate read-side graph references without changing source data."""

    issues: list[dict] = []
    matches = snapshot.get("matches") or []
    by_id: dict[str, dict] = {}
    for match in matches:
        match_id = match.get("id")
        if not match_id:
            issues.append({"code": "missing_match_id"})
            continue
        if match_id in by_id:
            issues.append({"code": "duplicate_match_id", "match_id": match_id})
            continue
        by_id[match_id] = match

    graph: dict[str, set[str]] = {match_id: set() for match_id in by_id}
    incoming_slots: set[tuple[str, int]] = set()
    for source_id, match in by_id.items():
        for edge in match.get("advancement") or []:
            target_id = edge.get("to_match_id")
            position = edge.get("to_position")
            if not target_id or target_id not in by_id:
                issues.append({
                    "code": "missing_advancement_target",
                    "match_id": source_id,
                    "target_id": target_id,
                })
                continue
            valid_positions = {slot.get("position") for slot in by_id[target_id].get("slots") or []}
            if position not in valid_positions:
                issues.append({
                    "code": "missing_target_slot",
                    "match_id": source_id,
                    "target_id": target_id,
                    "position": position,
                })
                continue
            slot_key = (target_id, position)
            if slot_key in incoming_slots:
                issues.append({
                    "code": "duplicate_target_slot_source",
                    "target_id": target_id,
                    "position": position,
                })
            incoming_slots.add(slot_key)
            graph[source_id].add(target_id)

    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(match_id: str) -> bool:
        if match_id in visiting:
            return True
        if match_id in visited:
            return False
        visiting.add(match_id)
        has_cycle = any(visit(target_id) for target_id in graph.get(match_id, set()))
        visiting.remove(match_id)
        visited.add(match_id)
        return has_cycle

    if any(visit(match_id) for match_id in graph if match_id not in visited):
        issues.append({"code": "advancement_cycle"})
    return issues


def structure_snapshot_metrics(snapshot: dict) -> dict:
    """Build low-cardinality read metrics without persisting another model."""

    matches = snapshot.get("matches") or []
    issues = structure_snapshot_issues(snapshot)
    source_counts = Counter(
        match.get("source", {}).get("engine") or "unknown"
        for match in matches
    )
    status_counts = Counter(str(match.get("status") or "unknown") for match in matches)
    issue_counts = Counter(issue["code"] for issue in issues)
    return {
        "schema_version": snapshot.get("schema_version"),
        "match_count": len(matches),
        "stage_count": len(snapshot.get("stages") or []),
        "source_counts": dict(sorted(source_counts.items())),
        "status_counts": dict(sorted(status_counts.items())),
        "result_count": sum(len(match.get("results") or []) for match in matches),
        "advancement_count": sum(len(match.get("advancement") or []) for match in matches),
        "integrity_issue_count": len(issues),
        "integrity_issue_counts": dict(sorted(issue_counts.items())),
    }
