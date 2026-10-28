"""Ein Turnier samt allem, was nur an ihm hängt, aus der Datenbank nehmen.

Gemeinsam für „Turnier löschen“ (``routes/tournament_crud_routes.delete_tournament``) und das Löschen leerer
Entwurfs-Staffeln mit ihrer Liga, Season oder Liga N (#2106, ``services/league_service``). Die Prüfung, ob gelöscht
werden darf, macht der Aufrufer.
"""
from __future__ import annotations


async def purge_tournament(db, tid: str) -> None:
    v2_match_ids = await db.matches_v2.distinct("id", {"tournament_id": tid})
    await db.tournaments.delete_one({"id": tid})
    await db.tournament_registrations.delete_many({"tournament_id": tid})
    await db.tournament_staff_assignments.delete_many({"tournament_id": tid})
    await db.tournament_stages.delete_many({"tournament_id": tid})
    await db.matches_v2.delete_many({"tournament_id": tid})
    if v2_match_ids:
        await db.match_reports_v2.delete_many({"match_id": {"$in": v2_match_ids}})
    # Fotos vom Ergebnis (#1157): persönlich - sie gehen mit dem Turnier.
    from services.match_proofs import delete_for_tournament
    await delete_for_tournament(db, tid)
