"""Nachrücker nach dem Baubau (#1551, Entscheidung E15): genau ein freier Platz, solange dessen erstes echtes Spiel nicht
begonnen hat.

Ein freier Platz ist
- der Platz einer Person mit „Nicht erschienen“ - auch einer mit Freilos: das Freilos zählt dann für den Nachrücker,
- oder ein leerer Platz neben einem Freilos (Baum mit weniger Teilnehmern als Plätzen): das Freilos-Spiel wird
  zurückgesetzt, der Spieler mit Freilos rückt aus der nächsten Runde zurück, und das Spiel ist ganz normal spielbar.

Liga (jeder gegen jeden): der Nachrücker übernimmt die offenen Spiele der Person, solange höchstens ein Spieltag
gespielt ist. Gespielte Spiele bleiben, wie sie sind.

Hier steht nur die Rechnung auf den Spielen (Listen von dicts); das Schreiben machen die Anmelde-Routen.
"""
from __future__ import annotations

from services.match_v2_results import _status_after_slot_fill

# Ein Spiel hat begonnen, sobald es läuft, entschieden ist, in Klärung steht, gemeldet wurde oder gerade eingetragen wird.
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
            if match.get("stage_id") in stage_ids and str(match.get("status") or "") in DECIDED_STATUSES and not is_auto_bye(match)
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
            {**row, "registration_id": new_reg["id"], "user_id": new_reg.get("user_id")} if row.get("registration_id") == old_id else row
            for row in match.get("results") or []
        ]
    elif str(match.get("status") or "") in {"pending", "preview", "ready", "scheduled"}:
        change["status"] = _status_after_slot_fill({**match, "slots": slots}, preserve_terminal=False)
    return change


def _bye_target(match: dict, by_id: dict[str, dict]) -> tuple[dict, dict] | None:
    for advancement in match.get("advancement") or []:
        if advancement.get("rank") != 1:
            continue
        target = by_id.get(advancement.get("to_match_id"))
        slot = next((row for row in (target or {}).get("slots") or [] if row.get("slot") == advancement.get("to_slot")), None)
        if target and slot:
            return target, slot
    return None


def free_bye_place(matches: list[dict]) -> dict | None:
    """Der erste leere Platz neben einem Freilos, dessen Folgespiel noch nicht begonnen hat."""
    fixed = _fixed(matches)
    by_id = {match.get("id"): match for match in fixed}
    ordered = sorted(fixed, key=lambda row: (row.get("stage_number") or 0, row.get("round") or 0, row.get("order") or 0))
    for match in ordered:
        if not is_auto_bye(match) or len(slot_ids(match)) != 1:
            continue
        empty = next((slot for slot in match.get("slots") or []
                      if slot.get("status") == "bye" and (slot.get("source") or {}).get("type") == "seed"), None)
        found = _bye_target(match, by_id)
        if not empty or not found:
            continue
        target, target_slot = found
        if has_started(target) or target_slot.get("registration_id") != slot_ids(match)[0]:
            continue
        return {"match": match, "slot": empty["slot"], "target": target, "target_slot": target_slot["slot"]}
    return None


def reopened_bye(place: dict, new_reg: dict, now_iso: str) -> tuple[dict, dict]:
    """Das Freilos-Spiel mit dem Nachrücker als zweite Seite (spielbar) und das Folgespiel ohne den Freilos-Sieger."""
    match, target = place["match"], place["target"]
    slots = [
        {**slot, "registration_id": new_reg["id"], "user_id": new_reg.get("user_id"), "status": "filled"}
        if slot.get("slot") == place["slot"] else dict(slot)
        for slot in match.get("slots") or []
    ]
    reopened = {**match, "slots": slots, "status": "pending"}
    match_set = {"slots": slots, "results": [], "result_meta": None, "status": _status_after_slot_fill(reopened, preserve_terminal=False),
                 "updated_at": now_iso}
    target_slots = [
        {**slot, "registration_id": None, "user_id": None, "source_result": None, "status": "pending"}
        if slot.get("slot") == place["target_slot"] else dict(slot)
        for slot in target.get("slots") or []
    ]
    target_set = {"slots": target_slots, "status": _status_after_slot_fill({**target, "slots": target_slots}, preserve_terminal=False),
                  "updated_at": now_iso}
    return match_set, target_set
