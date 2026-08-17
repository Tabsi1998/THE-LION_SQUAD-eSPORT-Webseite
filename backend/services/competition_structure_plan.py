"""Deterministic, non-destructive planning helpers for competition structures."""

from __future__ import annotations

import hashlib
import json
import uuid
from copy import deepcopy
from datetime import date, datetime
from typing import Any, Iterable


STRUCTURE_PLAN_VERSION = "competition.structure-plan.v1"
_VOLATILE_KEYS = {"_id", "created_at", "updated_at"}
_TOURNAMENT_PLAN_FIELDS = (
    "id",
    "format",
    "max_participants",
    "best_of",
    "bronze_match",
    "seeding_mode",
    "match_duration_minutes",
    "randomize_advancement_rounds",
    "engine_version",
    "ruleset_version",
)


def _normalized(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            str(key): _normalized(item)
            for key, item in sorted(value.items(), key=lambda pair: str(pair[0]))
            if key not in _VOLATILE_KEYS
        }
    if isinstance(value, (list, tuple)):
        return [_normalized(item) for item in value]
    if isinstance(value, set):
        return sorted(_normalized(item) for item in value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


def stable_structure_digest(value: Any) -> str:
    """Hash JSON-like structure data while ignoring generated timestamps."""

    payload = json.dumps(
        _normalized(value),
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
        default=str,
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def ordered_plan_registrations(registrations: Iterable[dict]) -> list[dict]:
    """Return a stable generator input before optional seeded randomization."""

    def seed_value(registration: dict) -> int:
        try:
            parsed = int(registration.get("seed"))
        except (TypeError, ValueError):
            return 2_147_483_647
        return parsed if parsed > 0 else 2_147_483_647

    return sorted(
        (deepcopy(registration) for registration in registrations),
        key=lambda registration: (
            seed_value(registration),
            str(registration.get("id") or ""),
        ),
    )


def structure_plan_seed(
    tournament: dict,
    request_payload: dict,
    registrations: Iterable[dict],
    base_structure: dict,
) -> dict:
    """Build hashes binding a plan to inputs and the current structure state."""

    base_structure_hash = stable_structure_digest(base_structure)
    input_payload = {
        "tournament": {
            field: tournament.get(field)
            for field in _TOURNAMENT_PLAN_FIELDS
        },
        "request": request_payload,
        "registrations": [
            {
                "id": registration.get("id"),
                "status": registration.get("status"),
                "seed": registration.get("seed"),
                "user_id": registration.get("user_id"),
                "team_id": registration.get("team_id"),
            }
            for registration in ordered_plan_registrations(registrations)
        ],
    }
    input_hash = stable_structure_digest(input_payload)
    seed = stable_structure_digest({
        "version": STRUCTURE_PLAN_VERSION,
        "base_structure_hash": base_structure_hash,
        "input_hash": input_hash,
    })
    return {
        "seed": seed,
        "base_structure_hash": base_structure_hash,
        "input_hash": input_hash,
    }


def deterministic_structure_id(seed: str, kind: str, identity: str) -> str:
    return str(uuid.uuid5(
        uuid.NAMESPACE_URL,
        f"thelionsquad:{STRUCTURE_PLAN_VERSION}:{seed}:{kind}:{identity}",
    ))


def stabilize_stage_plan_matches(
    matches: Iterable[dict],
    *,
    seed: str,
    stage_id: str,
) -> list[dict]:
    """Replace generator UUIDs and their references with deterministic IDs."""

    planned = [deepcopy(match) for match in matches]
    old_to_new: dict[str, str] = {}
    identities: set[str] = set()
    for index, match in enumerate(planned):
        identity = str(match.get("match_key") or (
            f"{match.get('stage_number')}:{match.get('round')}:{match.get('order')}:{index}"
        ))
        if identity in identities:
            identity = f"{identity}:{index}"
        identities.add(identity)
        new_id = deterministic_structure_id(seed, "match", identity)
        if match.get("id"):
            old_to_new[str(match["id"])] = new_id
        match["id"] = new_id
        match["stage_id"] = stage_id

    for match in planned:
        for edge in match.get("advancement") or []:
            target_id = edge.get("to_match_id")
            if target_id in old_to_new:
                edge["to_match_id"] = old_to_new[target_id]
        for slot in match.get("slots") or []:
            source = slot.get("source") or {}
            source_id = source.get("match_id")
            if source_id in old_to_new:
                source["match_id"] = old_to_new[source_id]
            source_result = slot.get("source_result") or {}
            result_source_id = source_result.get("from_match_id")
            if result_source_id in old_to_new:
                source_result["from_match_id"] = old_to_new[result_source_id]
    return planned


def stabilize_legacy_plan_matches(matches: Iterable[dict], *, seed: str) -> list[dict]:
    """Replace classic generator UUIDs without changing bracket topology."""

    planned = [deepcopy(match) for match in matches]
    old_to_new: dict[str, str] = {}
    identities: set[str] = set()
    for index, match in enumerate(planned):
        identity = (
            f"{match.get('bracket')}:{match.get('round')}:"
            f"{match.get('match_index', match.get('order'))}"
        )
        if identity in identities:
            identity = f"{identity}:{index}"
        identities.add(identity)
        new_id = deterministic_structure_id(seed, "match", identity)
        if match.get("id"):
            old_to_new[str(match["id"])] = new_id
        match["id"] = new_id

    for match in planned:
        for field in ("next_match_id", "next_loser_match_id"):
            target_id = match.get(field)
            if target_id in old_to_new:
                match[field] = old_to_new[target_id]
    return planned


def structure_plan_hash(
    *,
    engine: str,
    base_structure_hash: str,
    input_hash: str,
    planned_structure: dict,
    stage: dict | None = None,
) -> str:
    return stable_structure_digest({
        "version": STRUCTURE_PLAN_VERSION,
        "engine": engine,
        "base_structure_hash": base_structure_hash,
        "input_hash": input_hash,
        "stage": stage,
        "structure": planned_structure,
    })
