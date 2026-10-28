"""Ein Turnier samt allem, was nur an ihm hängt, aus der Datenbank nehmen.

Gemeinsam für „Turnier löschen“ (``routes/tournament_crud_routes.delete_tournament``) und das Löschen leerer
Entwurfs-Staffeln mit ihrer Liga, Season oder Liga N (#2106, ``services/league_service``). Die Prüfung, ob gelöscht
werden darf, macht der Aufrufer (für Turniere ``tournament_guard.delete_problem``).

Seit #2111 (TA18) gehen auch Gruppen, Map-Pools des Turniers und seiner Phasen und der Turnier-Chat mit; Stationen
bleiben (sie sind Geräte in der Halle) und verlieren nur die Zuordnung zum Turnier.
"""
from __future__ import annotations


async def purge_tournament(db, tid: str) -> None:
    v2_match_ids = await db.matches_v2.distinct("id", {"tournament_id": tid})
    stage_ids = await db.tournament_stages.distinct("id", {"tournament_id": tid})
    await db.tournaments.delete_one({"id": tid})
    await db.tournament_registrations.delete_many({"tournament_id": tid})
    await db.tournament_staff_assignments.delete_many({"tournament_id": tid})
    await db.tournament_stages.delete_many({"tournament_id": tid})
    await db.matches_v2.delete_many({"tournament_id": tid})
    if v2_match_ids:
        await db.match_reports_v2.delete_many({"match_id": {"$in": v2_match_ids}})
    await db.tournament_groups.delete_many({"tournament_id": tid})
    await db.tournament_chat_messages.delete_many({"tournament_id": tid})
    pool_scopes: list[dict] = [{"scope": "tournament", "scope_id": tid}]
    if stage_ids:
        pool_scopes.append({"scope": "stage", "scope_id": {"$in": stage_ids}})
    await db.map_pools.delete_many({"$or": pool_scopes})
    await db.stations.update_many({"tournament_id": tid}, {"$set": {"tournament_id": None}})
    # Fotos vom Ergebnis (#1157): persönlich - sie gehen mit dem Turnier.
    from services.match_proofs import delete_for_tournament
    await delete_for_tournament(db, tid)
