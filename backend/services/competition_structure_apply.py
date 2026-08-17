"""Controlled activation and compensation for validated structure plans.

MongoDB is deployed as a standalone node in this project, so multi-document
transactions are unavailable. Activation therefore stages the new generation,
switches collections under the cross-worker tournament lease, and restores the
captured preview documents if any later write fails.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Iterable

from models import new_id, now_utc
from services.competition_versions import competition_version_fields_for_write


class StructureApplyError(RuntimeError):
    pass


class StructureApplyPreconditionError(StructureApplyError):
    pass


PROTECTED_TOURNAMENT_STATUSES = {
    "live",
    "paused",
    "completed",
    "results_published",
    "archived",
    "cancelled",
}


async def _restore_documents(collection, documents: Iterable[dict]) -> None:
    for document in documents:
        document_id = document.get("id")
        if not document_id:
            raise StructureApplyError("Rollback-Dokument ohne stabile ID")
        await collection.replace_one(
            {"id": document_id},
            deepcopy(document),
            upsert=True,
        )


async def activate_structure_plan(
    db,
    *,
    tournament: dict,
    engine: str,
    matches: list[dict],
    stage: dict | None,
    previous_legacy_matches: list[dict],
    previous_stage_matches: list[dict],
    previous_stages: list[dict],
    plan_hash: str,
    base_structure_hash: str,
    plan_version: str,
    actor_id: str | None,
) -> dict:
    """Activate one already validated plan and compensate on write failure."""

    if engine not in {"classic", "graph"}:
        raise StructureApplyPreconditionError("Unbekanntes Struktur-Schreibmodell")
    if not matches:
        raise StructureApplyPreconditionError("Strukturplan enthält keine Matches")
    if engine == "graph" and not stage:
        raise StructureApplyPreconditionError("Graph-Strukturplan enthält keine Stage")

    previous_matches = [*previous_legacy_matches, *previous_stage_matches]
    if any(not match.get("is_preview") for match in previous_matches):
        raise StructureApplyPreconditionError(
            "Bestehende reale Matches dürfen mit dem sicheren Apply-Weg nicht ersetzt werden"
        )
    if tournament.get("status") in PROTECTED_TOURNAMENT_STATUSES:
        raise StructureApplyPreconditionError(
            "Laufende oder historische Turniere dürfen mit dem sicheren Apply-Weg nicht ersetzt werden"
        )

    previous_documents = [
        *previous_matches,
        *previous_stages,
    ]
    if any(not document.get("id") for document in previous_documents):
        raise StructureApplyPreconditionError("Bestehende Struktur enthält Dokumente ohne stabile ID")

    new_matches = [deepcopy(match) for match in matches]
    new_stage = deepcopy(stage) if stage else None
    new_match_ids = [match.get("id") for match in new_matches]
    if any(not match_id for match_id in new_match_ids):
        raise StructureApplyPreconditionError("Strukturplan enthält Matches ohne stabile ID")
    if len(set(new_match_ids)) != len(new_match_ids):
        raise StructureApplyPreconditionError("Strukturplan enthält doppelte Match-IDs")
    if any(match.get("tournament_id") != tournament.get("id") for match in new_matches):
        raise StructureApplyPreconditionError("Strukturplan gehört nicht vollständig zum Turnier")
    if new_stage and (
        not new_stage.get("id")
        or new_stage.get("tournament_id") != tournament.get("id")
    ):
        raise StructureApplyPreconditionError("Stage des Strukturplans gehört nicht zum Turnier")

    for match in new_matches:
        match["structure_plan_hash"] = plan_hash
    if new_stage:
        new_stage["structure_plan_hash"] = plan_hash
        new_stage["created_by"] = actor_id

    old_v2_ids = [
        match["id"]
        for match in previous_stage_matches
        if match.get("id")
    ]
    previous_reports = []
    if old_v2_ids:
        previous_reports = await db.match_reports_v2.find(
            {"match_id": {"$in": old_v2_ids}},
            {"_id": 0},
        ).to_list(5000)
        if any(not report.get("id") for report in previous_reports):
            raise StructureApplyPreconditionError("Bestehender Match-Report enthält keine stabile ID")

    revision = int(tournament.get("structure_revision") or 0) + 1
    version_fields = competition_version_fields_for_write(tournament, engine)
    tournament_fields = {
        **version_fields,
        "structure_revision": revision,
        "last_structure_plan_hash": plan_hash,
        "last_structure_base_hash": base_structure_hash,
        "last_structure_plan_version": plan_version,
        "last_structure_engine": engine,
        "updated_at": now_utc().isoformat(),
    }
    previous_tournament_fields = {
        field: tournament.get(field)
        for field in tournament_fields
    }
    tournament_updated = False

    try:
        if engine == "graph":
            await db.tournament_stages.insert_one(new_stage)
            await db.matches_v2.insert_many(new_matches)
            await db.matches.delete_many({"tournament_id": tournament["id"]})
            await db.matches_v2.delete_many({
                "tournament_id": tournament["id"],
                "id": {"$nin": new_match_ids},
            })
            await db.tournament_stages.delete_many({
                "tournament_id": tournament["id"],
                "id": {"$ne": new_stage["id"]},
            })
        else:
            await db.matches.insert_many(new_matches)
            await db.matches.delete_many({
                "tournament_id": tournament["id"],
                "id": {"$nin": new_match_ids},
            })
            await db.matches_v2.delete_many({"tournament_id": tournament["id"]})
            await db.tournament_stages.delete_many({"tournament_id": tournament["id"]})

        if old_v2_ids:
            await db.match_reports_v2.delete_many({"match_id": {"$in": old_v2_ids}})
        await db.tournaments.update_one(
            {"id": tournament["id"]},
            {"$set": tournament_fields},
        )
        tournament_updated = True
        await db.audit_logs.insert_one({
            "id": new_id(),
            "action": "tournament.structure_plan.apply",
            "target_id": tournament["id"],
            "actor_id": actor_id,
            "data": {
                "plan_hash": plan_hash,
                "plan_version": plan_version,
                "base_structure_hash": base_structure_hash,
                "engine": engine,
                "structure_revision": revision,
                "match_count": len(new_matches),
                "replaced_legacy_match_count": len(previous_legacy_matches),
                "replaced_stage_match_count": len(previous_stage_matches),
                "replaced_stage_count": len(previous_stages),
                "removed_report_count": len(previous_reports),
            },
            "created_at": now_utc().isoformat(),
        })
    except Exception as exc:
        rollback_errors: list[Exception] = []

        async def rollback(operation) -> None:
            try:
                await operation
            except Exception as rollback_exc:  # pragma: no cover - catastrophic DB failure
                rollback_errors.append(rollback_exc)

        await rollback(db.matches.delete_many({"id": {"$in": new_match_ids}}))
        await rollback(db.matches_v2.delete_many({"id": {"$in": new_match_ids}}))
        if new_stage:
            await rollback(db.tournament_stages.delete_one({"id": new_stage["id"]}))
        await rollback(_restore_documents(db.matches, previous_legacy_matches))
        await rollback(_restore_documents(db.matches_v2, previous_stage_matches))
        await rollback(_restore_documents(db.tournament_stages, previous_stages))
        await rollback(_restore_documents(db.match_reports_v2, previous_reports))
        if tournament_updated:
            set_fields = {
                field: value
                for field, value in previous_tournament_fields.items()
                if value is not None
            }
            unset_fields = {
                field: ""
                for field, value in previous_tournament_fields.items()
                if value is None
            }
            update = {"$set": set_fields}
            if unset_fields:
                update["$unset"] = unset_fields
            await rollback(db.tournaments.update_one({"id": tournament["id"]}, update))
        if rollback_errors:
            raise StructureApplyError(
                f"Strukturaktivierung fehlgeschlagen; Rollback unvollständig ({len(rollback_errors)})"
            ) from exc
        raise

    return {
        "ok": True,
        "idempotent_replay": False,
        "plan_hash": plan_hash,
        "base_structure_hash": base_structure_hash,
        "plan_version": plan_version,
        "engine": engine,
        "structure_revision": revision,
        "match_count": len(new_matches),
        "stage_id": new_stage.get("id") if new_stage else None,
    }
