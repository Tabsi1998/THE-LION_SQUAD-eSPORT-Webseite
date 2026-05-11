"""Result validation and advancement for matches_v2."""
from __future__ import annotations

from typing import Any
from collections import defaultdict


class MatchV2ResultError(ValueError):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


LOCKED_DOWNSTREAM_STATUSES = {"in_progress", "waiting_result", "disputed", "completed", "forfeit"}


def _filled_slots(match: dict) -> list[dict]:
    return [
        slot for slot in match.get("slots") or []
        if slot.get("status") == "filled" and slot.get("registration_id")
    ]


def _slot_participant_map(match: dict) -> dict[str, dict]:
    return {slot["registration_id"]: slot for slot in _filled_slots(match)}


def _as_number(value: Any) -> int | float | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        raise MatchV2ResultError("Score/Punkte duerfen kein Boolean sein")
    if isinstance(value, (int, float)):
        if value < 0:
            raise MatchV2ResultError("Score/Punkte duerfen nicht negativ sein")
        return value
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise MatchV2ResultError(f"Ungueltiger Zahlenwert: {value}")
    if number < 0:
        raise MatchV2ResultError("Score/Punkte duerfen nicht negativ sein")
    return int(number) if number.is_integer() else number


def _result_score_for_ranking(entry: dict) -> int | float:
    score = _as_number(entry.get("points"))
    if score is None:
        score = _as_number(entry.get("score"))
    if score is None:
        score = 0
    return score


def _auto_rank_results(raw_results: list[dict]) -> list[dict]:
    ranked = sorted(
        enumerate(raw_results),
        key=lambda item: (
            bool(item[1].get("forfeit")),
            bool(item[1].get("dnf")),
            -_result_score_for_ranking(item[1]),
            item[0],
        ),
    )
    next_rows = [dict(entry) for entry in raw_results]
    for rank, (idx, _) in enumerate(ranked, start=1):
        next_rows[idx]["rank"] = rank
    return next_rows


def normalize_v2_results(match: dict, raw_results: list[dict]) -> list[dict]:
    participants = _slot_participant_map(match)
    if not participants:
        raise MatchV2ResultError("Match hat keine belegten Slots")
    if len(raw_results) != len(participants):
        raise MatchV2ResultError("Ergebnisliste muss alle belegten Teilnehmer enthalten")
    if any(entry.get("rank") in (None, "") for entry in raw_results):
        raw_results = _auto_rank_results(raw_results)

    seen_regs: set[str] = set()
    seen_ranks: set[int] = set()
    normalized: list[dict] = []
    for entry in raw_results:
        registration_id = (entry.get("registration_id") or "").strip()
        if not registration_id:
            raise MatchV2ResultError("registration_id fehlt in einem Ergebnis")
        if registration_id not in participants:
            raise MatchV2ResultError(f"Teilnehmer {registration_id} ist kein Slot dieses Matches")
        if registration_id in seen_regs:
            raise MatchV2ResultError(f"Teilnehmer {registration_id} kommt mehrfach im Ergebnis vor")
        seen_regs.add(registration_id)
        try:
            rank = int(entry.get("rank"))
        except (TypeError, ValueError):
            raise MatchV2ResultError("Rank muss eine Zahl sein")
        if rank < 1:
            raise MatchV2ResultError("Rank muss groesser 0 sein")
        if rank in seen_ranks:
            raise MatchV2ResultError(f"Rank {rank} ist mehrfach vergeben")
        seen_ranks.add(rank)
        time_ms = int(entry["time_ms"]) if entry.get("time_ms") not in (None, "") else None
        if time_ms is not None and time_ms < 0:
            raise MatchV2ResultError("time_ms darf nicht negativ sein")
        normalized.append({
            "registration_id": registration_id,
            "user_id": participants[registration_id].get("user_id"),
            "slot": participants[registration_id].get("slot"),
            "rank": rank,
            "score": _as_number(entry.get("score")),
            "points": _as_number(entry.get("points")),
            "time_ms": time_ms,
            "dnf": bool(entry.get("dnf")),
            "forfeit": bool(entry.get("forfeit")),
            "note": (entry.get("note") or "").strip() or None,
        })

    expected_ranks = set(range(1, len(participants) + 1))
    if seen_ranks != expected_ranks:
        missing = ", ".join(str(r) for r in sorted(expected_ranks - seen_ranks))
        raise MatchV2ResultError(f"Ranks muessen fortlaufend 1-{len(participants)} sein; fehlt: {missing}")
    return sorted(normalized, key=lambda item: item["rank"])


def _target_lookup(stage_matches: list[dict]) -> tuple[dict[str, dict], dict[str, dict]]:
    by_id = {match["id"]: match for match in stage_matches if match.get("id")}
    by_key = {match["match_key"]: match for match in stage_matches if match.get("match_key")}
    return by_id, by_key


def _find_slot(match: dict, slot_number: int) -> dict | None:
    for slot in match.get("slots") or []:
        if int(slot.get("slot") or 0) == int(slot_number):
            return slot
    return None


def _downstream_links(stage_matches: list[dict]) -> dict[str, list[tuple[str, int]]]:
    links: dict[str, list[tuple[str, int]]] = defaultdict(list)
    for match in stage_matches:
        match_id = match.get("id")
        if not match_id:
            continue
        for slot in match.get("slots") or []:
            source = slot.get("source_result") or {}
            source_match_id = source.get("from_match_id")
            if source_match_id:
                links[source_match_id].append((match_id, int(slot.get("slot") or 0)))
    return links


def _clear_slot(slot: dict) -> bool:
    had_value = bool(slot.get("registration_id") or slot.get("user_id") or slot.get("source_result"))
    slot["registration_id"] = None
    slot["user_id"] = None
    slot["source_result"] = None
    slot["status"] = "pending"
    return had_value


def _status_after_slot_fill(match: dict, preserve_terminal: bool = True) -> str:
    current = match.get("status") or "pending"
    if preserve_terminal and current in {"completed", "forfeit", "cancelled"}:
        return current
    slots = match.get("slots") or []
    filled = [slot for slot in slots if slot.get("status") == "filled" and slot.get("registration_id")]
    pending = [slot for slot in slots if slot.get("status") == "pending"]
    min_players = int((match.get("settings") or {}).get("min_players") or 2)
    if not pending and len(filled) >= min_players:
        return "ready"
    return "pending"


def _reset_match_result_state(match: dict, target_sets: dict[str, dict], now_iso: str) -> None:
    target_sets.setdefault(match["id"], {})
    target_sets[match["id"]].update({
        "results": [],
        "result_meta": None,
        "completed_at": None,
        "completed_by": None,
        "status": _status_after_slot_fill(match, preserve_terminal=False),
        "updated_at": now_iso,
    })


def _cascade_clear_downstream(
    source_match_id: str,
    by_id: dict[str, dict],
    downstream: dict[str, list[tuple[str, int]]],
    target_sets: dict[str, dict],
    now_iso: str,
    visited: set[str] | None = None,
) -> None:
    visited = visited or set()
    if source_match_id in visited:
        return
    visited.add(source_match_id)

    for child_id, slot_number in downstream.get(source_match_id, []):
        child = by_id.get(child_id)
        if not child:
            continue
        slots = target_sets.get(child_id, {}).get("slots") or child.get("slots") or []
        slot = _find_slot({"slots": slots}, slot_number)
        if not slot:
            continue
        source = slot.get("source_result") or {}
        if source.get("from_match_id") != source_match_id:
            continue
        if not _clear_slot(slot):
            continue
        child["slots"] = slots
        target_sets.setdefault(child_id, {})
        target_sets[child_id].update({
            "slots": slots,
            "status": _status_after_slot_fill(child, preserve_terminal=False),
            "updated_at": now_iso,
        })
        _reset_match_result_state(child, target_sets, now_iso)
        _cascade_clear_downstream(child_id, by_id, downstream, target_sets, now_iso, visited)


def build_v2_result_application(
    match: dict,
    stage_matches: list[dict],
    raw_results: list[dict],
    actor_id: str,
    now_iso: str,
    proof_url: str | None = None,
    note: str | None = None,
    force: bool = False,
) -> dict:
    if match.get("status") in {"cancelled"}:
        raise MatchV2ResultError("Abgebrochene Matches koennen kein Ergebnis erhalten")
    if match.get("status") in {"completed", "forfeit"} and not force:
        raise MatchV2ResultError("Match ist bereits abgeschlossen. Fuer Korrektur force=true nutzen.", 409)

    results = normalize_v2_results(match, raw_results)
    result_by_rank = {entry["rank"]: entry for entry in results}
    by_id, by_key = _target_lookup(stage_matches)
    downstream = _downstream_links(stage_matches)
    target_sets: dict[str, dict] = {}
    overwritten_targets: set[str] = set()

    for advancement in match.get("advancement") or []:
        target = by_id.get(advancement.get("to_match_id")) or by_key.get(advancement.get("to_match_key"))
        if not target:
            raise MatchV2ResultError(f"Zielmatch {advancement.get('to_match_key')} nicht gefunden")
        target_slot = _find_slot(target, int(advancement.get("to_slot") or 0))
        if not target_slot:
            raise MatchV2ResultError(f"Zielslot {advancement.get('to_slot')} in {target.get('match_key')} nicht gefunden")
        result = result_by_rank.get(int(advancement.get("rank") or 0))
        if not result:
            raise MatchV2ResultError(f"Rank {advancement.get('rank')} fehlt fuer Advancement")

        existing_reg = target_slot.get("registration_id")
        if existing_reg and existing_reg != result["registration_id"]:
            if not force:
                raise MatchV2ResultError(
                    f"Zielslot {target.get('match_key')}:{target_slot.get('slot')} ist bereits belegt. Fuer Korrektur force=true nutzen.",
                    409,
                )
            overwritten_targets.add(target["id"])
            if target.get("status") in LOCKED_DOWNSTREAM_STATUSES:
                overwritten_targets.add(target["id"])

        target_slot["registration_id"] = result["registration_id"]
        target_slot["user_id"] = result.get("user_id")
        target_slot["source_result"] = {
            "from_match_id": match["id"],
            "from_match_key": match.get("match_key"),
            "rank": result["rank"],
            "flow": advancement.get("flow"),
            "confirmed_at": now_iso,
        }
        target_slot["status"] = "filled"
        target_sets[target["id"]] = {
            "slots": target.get("slots") or [],
            "status": _status_after_slot_fill(target),
            "updated_at": now_iso,
        }

    if force:
        for target_id in overwritten_targets:
            target = by_id[target_id]
            if target.get("status") in LOCKED_DOWNSTREAM_STATUSES or target.get("results"):
                _reset_match_result_state(target, target_sets, now_iso)
            _cascade_clear_downstream(target_id, by_id, downstream, target_sets, now_iso)

    match_set = {
        "results": results,
        "result_meta": {
            "proof_url": (proof_url or "").strip() or None,
            "note": (note or "").strip() or None,
            "confirmed_by": actor_id,
            "confirmed_at": now_iso,
            "force": force,
        },
        "status": "completed",
        "completed_at": now_iso,
        "completed_by": actor_id,
        "updated_at": now_iso,
    }
    return {
        "match_set": match_set,
        "target_sets": target_sets,
        "results": results,
        "advanced": len(target_sets),
    }
