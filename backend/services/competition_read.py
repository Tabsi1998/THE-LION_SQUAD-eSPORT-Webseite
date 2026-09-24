"""Database boundary for read-only competition projections.

Writes deliberately stay in their existing services until the canonical write
core is ready.  This module only loads current documents and projects them via
the versioned read contract.

Gelesen wird nur noch der Graph-Speicher (``matches_v2`` und ``tournament_stages``). Der
klassische Speicher ``matches`` ist seit Block 8 leer und wird seit #231 nicht mehr angefasst.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
import logging

from services.competition_snapshot import (
    adapt_stage_matches,
    build_structure_snapshot,
    structure_snapshot_metrics,
)


logger = logging.getLogger("tls.competition_read")


@dataclass(slots=True)
class CompetitionReadModel:
    tournament_id: str
    stage_matches: list[dict]
    stages: list[dict]

    def structure_snapshot(self) -> dict:
        return build_structure_snapshot(
            self.tournament_id,
            stage_matches=self.stage_matches,
            stages=self.stages,
        )


@dataclass(frozen=True, slots=True)
class MatchSourceRecord:
    match: dict
    collection: str


def observe_structure_read(snapshot: dict, *, surface: str) -> dict:
    """Emit one bounded shadow-read record and return its testable metrics."""

    metrics = structure_snapshot_metrics(snapshot)
    log = logger.warning if metrics["integrity_issue_count"] else logger.info
    log(
        "[competition-read] surface=%s tournament=%s schema=%s matches=%s sources=%s results=%s advancement=%s integrity_issues=%s issue_types=%s",
        surface,
        snapshot.get("tournament_id"),
        metrics["schema_version"],
        metrics["match_count"],
        metrics["source_counts"],
        metrics["result_count"],
        metrics["advancement_count"],
        metrics["integrity_issue_count"],
        metrics["integrity_issue_counts"],
    )
    return metrics


async def load_competition_read_model(
    db,
    tournament_id: str,
    *,
    stage_limit: int = 5000,
    stages_limit: int = 200,
) -> CompetitionReadModel:
    """Load the graph store once, without choosing a write engine."""

    stage_cursor = db.matches_v2.find({"tournament_id": tournament_id}, {"_id": 0}).sort([
        ("stage_number", 1),
        ("round", 1),
        ("order", 1),
    ])
    stages_cursor = db.tournament_stages.find({"tournament_id": tournament_id}, {"_id": 0}).sort("number", 1)
    stage_matches, stages = await asyncio.gather(
        stage_cursor.to_list(stage_limit),
        stages_cursor.to_list(stages_limit),
    )
    return CompetitionReadModel(
        tournament_id=tournament_id,
        stage_matches=stage_matches,
        stages=stages,
    )


async def load_registration_matches(
    db,
    registration_ids: list[str] | set[str],
    *,
    limit: int = 5000,
) -> list[dict]:
    """Load canonical matches referencing any supplied registration."""

    ids = sorted({registration_id for registration_id in registration_ids if registration_id})
    if not ids:
        return []
    stage = await db.matches_v2.find(
        {"$or": [
            {"slots.registration_id": {"$in": ids}},
            {"results.registration_id": {"$in": ids}},
        ]},
        {"_id": 0},
    ).to_list(limit)
    return adapt_stage_matches(stage)


async def load_matches_by_query(
    db,
    query: dict,
    *,
    per_store_limit: int = 5000,
) -> list[dict]:
    """Run one filter against the graph store and return canonical matches."""

    stage = await db.matches_v2.find(query, {"_id": 0}).to_list(per_store_limit)
    return adapt_stage_matches(stage)


async def count_matches_by_status(db, statuses: set[str]) -> int:
    """Count operational matches for dashboard surfaces."""

    wanted = sorted({status for status in statuses if status})
    if not wanted:
        return 0
    return await db.matches_v2.count_documents({"status": {"$in": wanted}})


async def load_scheduled_matches(
    db,
    *,
    scheduled_from: str,
    scheduled_until: str,
    statuses: set[str],
    per_store_limit: int = 5000,
) -> list[dict]:
    """Load upcoming canonical matches for reminder and operations readers."""

    query = {
        "scheduled_at": {"$gte": scheduled_from, "$lte": scheduled_until},
        "status": {"$in": sorted(statuses)},
    }
    matches = await load_matches_by_query(db, query, per_store_limit=per_store_limit)
    return sorted(matches, key=lambda match: (
        str(match.get("scheduled_at") or ""),
        str(match.get("id") or ""),
    ))


async def find_match_source(db, match_id: str) -> MatchSourceRecord | None:
    """Resolve a stable match ID while preserving the backing collection."""

    match = await db.matches_v2.find_one({"id": match_id}, {"_id": 0})
    if match:
        return MatchSourceRecord(match=match, collection="matches_v2")
    return None


async def canonical_match_for_source(db, source_match: dict, collection: str) -> dict | None:
    """Return one canonical detail while retaining full graph context."""

    tournament_id = source_match.get("tournament_id")
    match_id = source_match.get("id")
    if not tournament_id or not match_id:
        return None
    read_model = await load_competition_read_model(db, tournament_id)
    snapshot = read_model.structure_snapshot()
    observe_structure_read(snapshot, surface="match_detail")
    return next(
        (
            match
            for match in snapshot["matches"]
            if match.get("id") == match_id
            and match.get("source", {}).get("collection") == collection
        ),
        None,
    )
