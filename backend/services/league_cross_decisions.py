"""Entscheid der Leitung bei Gleichstand über Staffeln hinweg (#1627, docs/LIGA.md „F.2 … Zielregel je Zone“).

Die Rechnung und das Lesen stehen im Blatt-Modul ``league_cross_zones``. Hier steht, was dafür mehr braucht: die laufende Tabelle
offener Staffeln (``league_final.live_rows``), die Season-Sperre, die Befangenheit (nie über das eigene Team, Superadmin als
Notausnahme mit Grund) und das Protokoll.
"""
from __future__ import annotations

from models import new_id, now_utc
from services import league_cross_zones, league_final, league_permissions
from services.league_cross_zones import (
    BUSY, KINDS, METHOD_NEEDED, METHODS, NO_DECISION, NO_DIVISION, NO_RULE, NO_TIE, PICK_EXACT, REASON_MIN, REASON_NEEDED, CrossProblem,
)
from services.mutation_lock import MutationLockBusy, league_season_resource, mutation_lock


async def _live(db, staffeln: list[dict]) -> dict[str, list[dict]]:
    tournaments = {row["id"]: row for row in await db.tournaments.find(
        {"id": {"$in": [row["id"] for row in staffeln if not league_cross_zones.is_closed(row)]}}, {"_id": 0}).to_list(100)}
    return {key: await league_final.live_rows(db, tournament) for key, tournament in tournaments.items()}


async def current(db, division_id: str) -> dict | None:
    """Die Auswertung mit dem Stand von jetzt: Endstände, wo abgeschlossen ist, sonst die laufende Tabelle."""
    return await league_cross_zones.resolve(db, division_id, live=await _live(db, await league_cross_zones.staffeln_of(db, division_id)))


async def _audit(db, action: str, division: dict, actor: dict, **data) -> None:
    await db.audit_logs.insert_one({"id": new_id(), "action": action, "actor_id": actor.get("id"), "target_id": division.get("season_id"),
                                    "data": {"division_id": division["id"], **data}, "created_at": now_utc().isoformat()})


async def decide(db, division_id: str, body: dict, actor: dict) -> dict:
    """Die Leitung entscheidet einen Gleichstand an der Grenze: welche der Gleichen den Platz bekommen - mit Art und Grund. Nie über das
    eigene Team (Befangenheit wie beim Gleichstand in der Tabelle); der Superadmin als Notausnahme mit Grund."""
    kind = body.get("kind")
    if kind not in KINDS:
        raise CrossProblem(NO_RULE)
    if body.get("method") not in METHODS:
        raise CrossProblem(METHOD_NEEDED)
    reason = " ".join(str(body.get("reason") or "").split())[:500]
    if len(reason) < REASON_MIN:
        raise CrossProblem(REASON_NEEDED)
    division = await db.league_divisions.find_one({"id": division_id}, {"_id": 0, "id": 1, "season_id": 1})
    if not division:
        raise CrossProblem(NO_DIVISION, 404)
    try:
        async with mutation_lock(db, league_season_resource(division["season_id"]), wait_seconds=10.0):
            found = await current(db, division_id)
            tie = next((row for row in (found or {}).get("ties") or [] if row["kind"] == kind), None)
            if not found:
                raise CrossProblem(NO_RULE, 409)
            if not tie:
                raise CrossProblem(NO_TIE, 409)
            chosen = list(dict.fromkeys(str(item) for item in body.get("registration_ids") or []))
            if len(chosen) != tie["open"] or not set(chosen) <= set(tie["registration_ids"]):
                raise CrossProblem(PICK_EXACT.format(count=tie["open"], names=", ".join(tie["names"])))
            registrations = await db.tournament_registrations.find({"id": {"$in": tie["registration_ids"]}}, {"_id": 0}).to_list(64)
            overrides = [await league_permissions.require_no_side_conflict(db, actor, registration, conflict_reason=body.get("conflict_reason"))
                         for registration in registrations]
            # Gebunden an die Gruppe und ihre Werte (Nr. 229): Ändern sich Punkte oder Map-Differenz je Spiel, gilt der Entscheid nicht mehr.
            decision = {"id": new_id(), "registration_ids": chosen, "tied": sorted(tie["registration_ids"]), "values": list(tie["values"]),
                        "method": body["method"], "reason": reason, "by": actor.get("id"), "at": now_utc().isoformat()}
            await db.league_divisions.update_one({"id": division_id}, {"$set": {f"zone_decisions.{kind}": decision}})
    except MutationLockBusy:
        raise CrossProblem(BUSY, 409) from None
    override = next((item for item in overrides if item), None)
    if override:
        await league_permissions.record_override(db, actor, action="zone_decision", target_id=division["season_id"], reason=override,
                                                 division_id=division_id, decision_id=decision["id"])
    await _audit(db, "league.zone.decision", division, actor, kind=kind, decision_id=decision["id"], registration_ids=chosen,
                 tied=decision["tied"], method=decision["method"], reason=reason, **({"conflict_override": override} if override else {}))
    return decision


async def clear(db, division_id: str, kind: str, reason: str | None, actor: dict, *, conflict_reason: str | None = None) -> None:
    """Den Entscheid zurücknehmen - mit Grund. Der Gleichstand ist dann wieder offen. Dieselben Regeln wie beim Entscheiden: unter der
    Season-Sperre, nie über das eigene Team (wer zu einem Team des entschiedenen Gleichstands gehört, bekommt 403), der Superadmin
    als Notausnahme mit Grund."""
    if kind not in KINDS:
        raise CrossProblem(NO_RULE)
    text = " ".join(str(reason or "").split())[:500]
    if len(text) < REASON_MIN:
        raise CrossProblem(REASON_NEEDED)
    seen = await db.league_divisions.find_one({"id": division_id}, {"_id": 0, "id": 1, "season_id": 1})
    if not seen:
        raise CrossProblem(NO_DIVISION, 404)
    try:
        async with mutation_lock(db, league_season_resource(seen["season_id"]), wait_seconds=10.0):
            division = await db.league_divisions.find_one({"id": division_id}, {"_id": 0, "id": 1, "season_id": 1, "zone_decisions": 1})
            decision = ((division or {}).get("zone_decisions") or {}).get(kind)
            if not decision:
                raise CrossProblem(NO_DECISION, 409)
            involved = list(decision.get("tied") or decision.get("registration_ids") or [])
            registrations = await db.tournament_registrations.find({"id": {"$in": involved}}, {"_id": 0}).to_list(64)
            overrides = [await league_permissions.require_no_side_conflict(db, actor, registration, conflict_reason=conflict_reason)
                         for registration in registrations]
            await db.league_divisions.update_one({"id": division_id}, {"$unset": {f"zone_decisions.{kind}": ""}})
    except MutationLockBusy:
        raise CrossProblem(BUSY, 409) from None
    override = next((item for item in overrides if item), None)
    if override:
        await league_permissions.record_override(db, actor, action="zone_decision_clear", target_id=division["season_id"], reason=override,
                                                 division_id=division_id, decision_id=decision.get("id"))
    await _audit(db, "league.zone.decision.clear", division, actor, kind=kind, decision_id=decision.get("id"), reason=text,
                 **({"conflict_override": override} if override else {}))
