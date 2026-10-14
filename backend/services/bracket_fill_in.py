"""Nachrücker nach dem Baubau (#1551, Entscheidung E15): genau ein freier Platz, solange dessen erstes echtes Spiel
nicht begonnen hat.

Ein freier Platz ist
- der Platz einer Person mit „Nicht erschienen“ - auch einer mit Freilos: das Freilos zählt dann für den Nachrücker,
- oder ein leerer Platz neben einem Freilos (Baum mit weniger Teilnehmern als Plätzen): das Freilos-Spiel wird
  zurückgesetzt, der Spieler mit Freilos rückt aus der nächsten Runde zurück, und das Spiel ist ganz normal spielbar.

Liga (jeder gegen jeden): der Nachrücker übernimmt die offenen Spiele der Person, solange höchstens ein Spieltag
gespielt ist. Gespielte Spiele bleiben, wie sie sind.

Hier steht nur die Rechnung auf den Spielen (Listen von dicts); das Schreiben machen die Anmelde-Routen.
"""
from __future__ import annotations

import copy

from services.match_v2_results import (
    _cascade_clear_downstream,
    _clear_slot,
    _downstream_links,
    _find_slot,
    _reset_match_result_state,
    _status_after_slot_fill,
)

# Ein Spiel hat begonnen, sobald es läuft, entschieden ist, in Klärung steht, gemeldet wurde oder eingetragen wird.
STARTED_STATUSES = {"in_progress", "running", "waiting_result", "completed", "forfeit", "disputed"}
DECIDED_STATUSES = {"completed", "forfeit"}
LEAGUE_STAGE_TYPES = {"league", "round_robin_groups", "ffa_league"}

STARTED_DETAIL = "Das erste Spiel dieses Platzes hat schon begonnen – ein Nachrücker geht nur davor."
LEAGUE_DETAIL = "In der Liga ist schon mehr als ein Spieltag gespielt – ein Nachrücker übernimmt den Platz nicht mehr."
RUNNING_DETAIL = "Ein Spiel dieses Platzes läuft gerade – bitte erst das Ergebnis eintragen."
NO_PLACE_DETAIL = "Im Turnierbaum ist kein Platz frei. Die Anmeldung steht auf der Liste, aber in keinem Spiel."


class FillInRefused(Exception):
    def __init__(self, detail: str):
        super().__init__(detail)
        self.detail = detail


def is_auto_bye(match: dict) -> bool:
    return (match.get("result_meta") or {}).get("source") == "auto_bye"


def has_started(match: dict) -> bool:
    return (
        str(match.get("status") or "") in STARTED_STATUSES
        or bool(match.get("started_at"))
        or bool(match.get("reports"))
        or isinstance(match.get("pending_result"), dict)
    )


def slot_ids(match: dict) -> list[str]:
    return [slot.get("registration_id") for slot in match.get("slots") or [] if slot.get("registration_id")]


def _fixed(matches: list[dict]) -> list[dict]:
    return [match for match in matches if not match.get("is_preview")]


def _is_league(match: dict) -> bool:
    return str(match.get("stage_type") or "") in LEAGUE_STAGE_TYPES


def replacement_targets(matches: list[dict], old_id: str) -> list[dict]:
    """Die Spiele, in denen ``old_id`` durch einen Nachrücker ersetzt wird - oder ``FillInRefused``."""
    involved = [match for match in _fixed(matches) if old_id in slot_ids(match)]
    if not involved:
        return []
    if any(_is_league(match) for match in involved):
        stage_ids = {match.get("stage_id") for match in involved}
        played = {
            match.get("round") for match in _fixed(matches)
            if match.get("stage_id") in stage_ids and not is_auto_bye(match)
            and str(match.get("status") or "") in DECIDED_STATUSES
        }
        if len(played) > 1:
            raise FillInRefused(LEAGUE_DETAIL)
        if any(has_started(match) and str(match.get("status") or "") not in DECIDED_STATUSES for match in involved):
            raise FillInRefused(RUNNING_DETAIL)
        return [match for match in involved if str(match.get("status") or "") not in DECIDED_STATUSES | {"cancelled"}]
    if any(has_started(match) for match in involved if not is_auto_bye(match)):
        raise FillInRefused(STARTED_DETAIL)
    return involved


def swapped(match: dict, old_id: str, new_reg: dict) -> dict:
    """Die Felder eines Spiels nach dem Tausch ``old_id`` → Nachrücker. Ein Freilos-Ergebnis zählt danach für ihn."""
    slots = []
    for slot in match.get("slots") or []:
        slot = dict(slot)
        if slot.get("registration_id") == old_id:
            slot.update({"registration_id": new_reg["id"], "user_id": new_reg.get("user_id"), "status": "filled"})
        slots.append(slot)
    change: dict = {"slots": slots}
    if is_auto_bye(match):
        change["results"] = [
            {**row, "registration_id": new_reg["id"], "user_id": new_reg.get("user_id")}
            if row.get("registration_id") == old_id else row
            for row in match.get("results") or []
        ]
    elif str(match.get("status") or "") in {"pending", "preview", "ready", "scheduled"}:
        change["status"] = _status_after_slot_fill({**match, "slots": slots}, preserve_terminal=False)
        # Ein Vorschlag „nicht erschienen“ und seine Verlängerung gehörten zur alten Paarung (#1551).
        change.update({"no_show_proposal": None, "no_show_extended_until": None})
    return change


def _bye_target(match: dict, by_id: dict[str, dict]) -> tuple[dict, dict] | None:
    """Wohin der Sieger dieses Spiels weiterrückt (Sieger-Weg, Platz 1)."""
    for advancement in match.get("advancement") or []:
        if advancement.get("rank") != 1 or advancement.get("flow", "W") != "W":
            continue
        target = by_id.get(advancement.get("to_match_id"))
        slots = (target or {}).get("slots") or []
        slot = next((row for row in slots if row.get("slot") == advancement.get("to_slot")), None)
        if target and slot:
            return target, slot
    return None


def _first_real_match_open(match: dict, by_id: dict[str, dict], winner_id: str) -> bool:
    """Den Weg des Freilos-Siegers entlang: weitere Freilos-Spiele zählen nicht (Kette aus #1549), das erste echte Spiel
    darf noch nicht begonnen haben."""
    current = match
    for _ in range(len(by_id) + 1):
        found = _bye_target(current, by_id)
        if not found:
            return True
        target, slot = found
        if slot.get("registration_id") != winner_id:
            return False
        if not is_auto_bye(target):
            return not has_started(target)
        current = target
    return False


def free_bye_place(matches: list[dict]) -> dict | None:
    """Der erste leere Platz neben einem Freilos, dessen erstes echtes Folgespiel noch nicht begonnen hat."""
    fixed = _fixed(matches)
    by_id = {match.get("id"): match for match in fixed}
    ordered = sorted(fixed, key=lambda row: (row.get("stage_number") or 0, row.get("round") or 0,
                                             row.get("order") or 0))
    for match in ordered:
        if not is_auto_bye(match) or len(slot_ids(match)) != 1 or isinstance(match.get("pending_result"), dict):
            continue
        empty = next((slot for slot in match.get("slots") or []
                      if slot.get("status") == "bye" and (slot.get("source") or {}).get("type") == "seed"), None)
        if empty and _first_real_match_open(match, by_id, slot_ids(match)[0]):
            return {"match": match, "slot": empty["slot"]}
    return None


def reopened_bye(place: dict, matches: list[dict], new_reg: dict, now_iso: str) -> dict[str, dict]:
    """Was sich ändert, wenn der Nachrücker den leeren Platz neben dem Freilos nimmt: je Spiel die Felder zum Setzen.

    Das Freilos-Spiel wird spielbar (beide Seiten, ohne Ergebnis). Was es weitergeschoben hat, nimmt die
    Korrektur-Kaskade zurück (``_cascade_clear_downstream``): Zielplätze leeren, Ergebnisse, Metadaten und Status der
    Folgespiele zurücksetzen - über die ganze Freilos-Kette. Ein Zielplatz ohne Herkunft (Freilos aus dem Bau) wird über
    den Sieger-Weg gefunden und genauso zurückgesetzt."""
    by_id = {match.get("id"): copy.deepcopy(match) for match in _fixed(matches)}
    match = by_id[place["match"]["id"]]
    winner_id = slot_ids(match)[0]
    downstream = _downstream_links(list(by_id.values()))
    sets: dict[str, dict] = {}
    _cascade_clear_downstream(match["id"], by_id, downstream, sets, now_iso)
    found = _bye_target(match, by_id)
    if found:
        target, _slot = found
        slots = sets.get(target["id"], {}).get("slots") or target.get("slots") or []
        slot = _find_slot({"slots": slots}, int(_slot.get("slot") or 0))
        if slot and slot.get("registration_id") == winner_id and _clear_slot(slot):
            target["slots"] = slots
            sets.setdefault(target["id"], {}).update({"slots": slots, "updated_at": now_iso})
            _reset_match_result_state(target, sets, now_iso)
            _cascade_clear_downstream(target["id"], by_id, downstream, sets, now_iso)
    slots = [
        # Neu besetzt: ein Freilos-Grund (leerer Platz, Austritt #1553) gehört nicht mehr dazu.
        {**slot, "registration_id": new_reg["id"], "user_id": new_reg.get("user_id"), "status": "filled", "source_result": None}
        if slot.get("slot") == place["slot"] else dict(slot)
        for slot in match.get("slots") or []
    ]
    sets[match["id"]] = {
        "slots": slots, "results": [], "result_meta": None, "completed_at": None, "completed_by": None,
        "status": _status_after_slot_fill({**match, "slots": slots, "status": "pending"}, preserve_terminal=False),
        "updated_at": now_iso,
    }
    return sets
