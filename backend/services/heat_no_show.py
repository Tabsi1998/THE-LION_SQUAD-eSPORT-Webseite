"""„Nicht erschienen“ im Lauf (#1823): die Markierung an einer Stelle.

Im Lauf mit mehr als zwei Spielern wertet „nicht erschienen“ nicht den ganzen Lauf. Die Person wird am Lauf markiert
(``no_show_registration_ids``; die Begründung intern in ``no_show_notes``), bekommt den Eintrag „nicht erschienen“
unter ihren Strafen, und das Protokoll hält „match.no_show.marked“ fest. Zwei Wege führen hierher - beide über diese
Bausteine, damit Markierung und Eintrag immer gleich entstehen:

- die Turnierleitung (Vorschlag nach der Frist oder ``POST /matches/{id}/forfeit``): ``services.match_forfeit``,
- das Eintragen eines Ergebnisses, in dem die Leitung jemanden als „nicht erschienen“ gesetzt hat
  (``services.v2_result_submission``). Meldungen der Spieler markieren niemanden.

Wer markiert ist und doch mit Platz eingetragen wird, ist gefahren: Markierung und Eintrag fallen weg.
"""
from __future__ import annotations

from models import new_id, now_utc
from services.match_v2_results import HEAT_NO_SHOW_NOTE
from services.v2_match_flows import participant_ids
from services.walkover_incidents import record_walkover_incident


def is_heat(match: dict) -> bool:
    """Ein Lauf mit mehr als zwei Spielern - nur dort gibt es die Markierung."""
    return len(participant_ids(match)) > 2


def marking_fields(match: dict, add: dict[str, str] | None = None, remove: set[str] | frozenset = frozenset()) -> dict:
    """Die Felder am Spiel nach der Änderung: ``add`` (Anmeldung → Begründung) dazu, ``remove`` weg."""
    marked = [item for item in match.get("no_show_registration_ids") or [] if item not in remove]
    notes = {key: value for key, value in (match.get("no_show_notes") or {}).items() if key not in remove}
    for registration_id, note in (add or {}).items():
        if registration_id not in marked:
            marked.append(registration_id)
        notes.setdefault(registration_id, note or HEAT_NO_SHOW_NOTE)
    return {"no_show_registration_ids": marked, "no_show_notes": notes}


def result_marks(match: dict, results: list[dict], *, from_players: bool) -> tuple[dict, list[str], list[str]]:
    """Was ein eingetragenes Ergebnis an der Markierung ändert: ``(felder, neu_markiert, doch_gefahren)``.

    Neu markiert wird, wen die Turnierleitung im Lauf als „nicht erschienen“ eingetragen hat und wer noch nicht markiert
    ist. Doch gefahren ist, wer markiert war und mit Platz (ohne „nicht erschienen“) im Ergebnis steht."""
    marked = match.get("no_show_registration_ids") or []
    ranked = {row.get("registration_id") for row in results}
    missing = {row.get("registration_id"): row.get("note") for row in results if row.get("forfeit")}
    raced = [item for item in marked if item in ranked and item not in missing]
    new = [] if from_players or not is_heat(match) else [item for item in missing if item not in marked]
    if not raced and not new:
        return {}, [], []
    return marking_fields(match, {item: missing[item] for item in new}, set(raced)), new, raced


async def record_marks(db, match: dict, registration_ids: list[str], *, actor_id: str | None, source: str) -> None:
    """Protokoll und Eintrag „nicht erschienen“ je neu markierter Person (sie sieht ihn unter ihren Strafen)."""
    notes = match.get("no_show_notes") or {}
    for registration_id in registration_ids:
        await db.audit_logs.insert_one({
            "id": new_id(), "action": "match.no_show.marked", "target_id": match.get("tournament_id"), "actor_id": actor_id,
            "data": {"match_id": match.get("id"), "stage_id": match.get("stage_id"), "match_key": match.get("match_key"),
                     "registration_id": registration_id, "note": notes.get(registration_id), "source": source},
            "created_at": now_utc().isoformat(),
        })
        await record_walkover_incident(db, match, registration_id, actor_id)
