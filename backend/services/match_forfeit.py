"""„Nicht erschienen“ als Wertung (Forfeit): ein Ergebnis, bei dem eine Seite nicht angetreten ist.

Die Wertung ist eine gewöhnliche Platzierung - wer nicht erschienen ist, steht hinten -, die über den einen
Ergebnis-Weg (``submit_v2_result``) läuft und damit den Baum weiterschiebt. Dazu kommen der Stand „forfeit“, die
Begründung für die betroffene Person (sie sieht sie unter ihren Strafen) und der Eintrag „nicht erschienen“.

Zwei Wege nutzen das: die Turnierleitung über ``POST /matches/{id}/forfeit`` und das Ergebnis-Fenster (#1156), wenn
im Duell eine Seite „Nicht erschienen“ hat - dort geht es erst nach den 10 Sekunden „Rückgängig“ raus. Dazu der
Vorschlag „nicht erschienen“ nach der Frist (#1551), den die Turnierleitung bestätigt.

Im offenen Lauf mit mehr als zwei Spielern (#1823) ist „nicht erschienen“ keine Wertung des ganzen Laufs: die Person
wird am Lauf markiert (``no_show_registration_ids``, die Begründung intern in ``no_show_notes``), der Lauf bleibt offen
und wird mit den Anwesenden gefahren. Beim Eintragen steht sie als „nicht erschienen“ hinten
(``match_v2_results._with_marked_no_shows``). Markierung und Eintrag entstehen an einer Stelle (``services.heat_no_show``),
auch wenn die Leitung jemanden erst im Ergebnis-Fenster als „nicht erschienen“ setzt.
"""
from __future__ import annotations

import logging

from models import now_utc
from services.heat_no_show import marking_fields, record_marks
from services.match_v2_results import MatchV2ResultError
from services.v2_match_flows import no_show_keeps_heat_open, results_for_forfeit
from services.v2_result_submission import submit_v2_result
from services.walkover_incidents import record_walkover_incident  # noqa: F401 - umgezogen (#1420)

logger = logging.getLogger("tls.match")


async def mark_heat_no_show(db, match: dict, registration_id: str, *, note: str, actor_id: str) -> dict:
    """Eine Person im Lauf als nicht erschienen markieren - der Lauf bleibt offen, niemand rückt weiter (#1823).
    Ein zweites Mal für dieselbe Person ändert nichts."""
    if str(match.get("status") or "") == "cancelled":
        raise MatchV2ResultError("Abgebrochene Matches können kein Ergebnis erhalten")
    if registration_id in (match.get("no_show_registration_ids") or []):
        return {**match, "idempotent_replay": True}
    fields = marking_fields(match, {registration_id: note})
    await db.matches_v2.update_one({"id": match["id"]}, {"$set": {**fields, "updated_at": now_utc().isoformat()}})
    await record_marks(db, {**match, **fields}, [registration_id], actor_id=actor_id, source="lead")
    result = await db.matches_v2.find_one({"id": match["id"]}, {"_id": 0}) or match
    result["idempotent_replay"] = False
    return result


async def apply_forfeit(db, match: dict, forfeiting_registration_id: str, *, note: str, actor_id: str,
                        force: bool, reason: str | None = None, hold_id: str | None = None) -> dict:
    """Die Wertung schreiben: Platzierung über den Ergebnis-Weg, dann Stand und Begründung am Spiel. Im offenen Lauf
    mit mehr als zwei Spielern nur die Markierung (#1823)."""
    if no_show_keeps_heat_open(match):
        results_for_forfeit(match, forfeiting_registration_id)  # gehört die Person zum Lauf?
        return await mark_heat_no_show(db, match, forfeiting_registration_id, note=note, actor_id=actor_id)
    results = results_for_forfeit(match, forfeiting_registration_id)
    outcome = await submit_v2_result(
        db,
        match,
        results,
        actor_id=actor_id,
        proof_url=None,
        note=note,
        force=force,
        audit_action="match.forfeit",
        # Eine Wertung als Korrektur (#1035): ihre Pflicht-Begründung ist zugleich der Grund der Korrektur.
        reason=reason or (note if force else None),
        hold_id=hold_id,
    )
    updated = outcome.get("match") or match
    now_iso = now_utc().isoformat()
    await db.matches_v2.update_one({"id": match["id"]}, {"$set": {
        "status": "forfeit",
        "forfeit_registration_id": forfeiting_registration_id,
        "admin_decision_note": note,
        "admin_decision_by": actor_id,
        "admin_decision_at": now_iso,
        "updated_at": now_iso,
    }})
    result = await db.matches_v2.find_one({"id": match["id"]}, {"_id": 0}) or updated
    result["idempotent_replay"] = bool(outcome.get("idempotent_replay"))
    await record_walkover_incident(db, match, forfeiting_registration_id, actor_id)
    return result
