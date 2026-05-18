"""Custom tournament bracket schema parser and v2 match generator.

The schema is intentionally small and explicit:

    [WB]
    A=[1,2,3,4]
    B=[W:A:1,W:A:2,5,6]

Numeric tokens are seed slots. Reference tokens use FLOW:MATCH:RANK, where
FLOW is W (winner/qualified), L (loser/lower ranks), or R (raw rank).
"""
from __future__ import annotations

import random
import re
import uuid
import math
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any


ASSIGNMENT_RE = re.compile(r"^(?P<key>[A-Za-z0-9_.-]+)\s*=\s*\[(?P<slots>.*)\]\s*$")
SECTION_RE = re.compile(r"^\[(?P<section>[A-Za-z0-9_. -]+)\]\s*$")
SOURCE_RE = re.compile(r"^(?P<flow>[WLR]):(?P<match>[A-Za-z0-9_.-]+):(?P<rank>[1-9][0-9]*)$")
ROUND_RE = re.compile(r"\b(?:round|runde)\s+([0-9]+)\b", re.IGNORECASE)


class BracketSchemaError(ValueError):
    pass


def _new_id() -> str:
    return str(uuid.uuid4())


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


@dataclass(frozen=True)
class BracketMatchSpec:
    key: str
    section: str
    order: int
    sources: list[dict[str, Any]]
    round_hint: int | None = None
    round_name_hint: str | None = None


def _strip_inline_comment(line: str) -> str:
    return line.split("#", 1)[0].strip()


def _parse_source(raw: str) -> dict[str, Any]:
    token = raw.strip()
    if not token:
        raise BracketSchemaError("Leerer Slot im Schema gefunden")
    if token.lower() in {"bye", "-", "null", "none"}:
        return {"type": "bye", "raw": token}
    if token.isdigit():
        seed = int(token)
        if seed <= 0:
            raise BracketSchemaError(f"Setzplatz muss groesser 0 sein: {token}")
        return {"type": "seed", "seed": seed, "raw": token}
    match = SOURCE_RE.match(token)
    if not match:
        raise BracketSchemaError(f"Ungueltiger Slot-Ausdruck: {token}")
    return {
        "type": "rank",
        "flow": match.group("flow"),
        "match_key": match.group("match"),
        "rank": int(match.group("rank")),
        "raw": token,
    }


def parse_custom_bracket_schema(schema: str) -> list[BracketMatchSpec]:
    if not schema or not str(schema).strip():
        raise BracketSchemaError("Schema fehlt")

    section = "MAIN"
    round_hint: int | None = None
    round_name: str | None = None
    matches: list[BracketMatchSpec] = []
    seen: set[str] = set()

    for line_no, raw_line in enumerate(str(schema).splitlines(), start=1):
        raw = raw_line.strip()
        if not raw:
            continue
        if raw.startswith("#"):
            text = raw.lstrip("#").strip()
            if text:
                round_name = text
                found_round = ROUND_RE.search(text)
                round_hint = int(found_round.group(1)) if found_round else None
            continue
        section_match = SECTION_RE.match(raw)
        if section_match:
            section = section_match.group("section").strip()
            round_hint = None
            round_name = None
            continue

        line = _strip_inline_comment(raw)
        if not line:
            continue
        assignment = ASSIGNMENT_RE.match(line)
        if not assignment:
            raise BracketSchemaError(f"Zeile {line_no}: erwartet MATCH=[...]")
        key = assignment.group("key").strip()
        if key in seen:
            raise BracketSchemaError(f"Spiel-Key doppelt vergeben: {key}")
        seen.add(key)
        slot_raw = assignment.group("slots").strip()
        if not slot_raw:
            raise BracketSchemaError(f"Spiel {key} hat keine Spielplätze")
        sources = [_parse_source(part) for part in slot_raw.split(",")]
        matches.append(BracketMatchSpec(
            key=key,
            section=section,
            order=len(matches) + 1,
            sources=sources,
            round_hint=round_hint,
            round_name_hint=round_name,
        ))

    if not matches:
        raise BracketSchemaError("Schema enthaelt keine Spiele")
    _validate_references(matches)
    return matches


def _validate_references(matches: list[BracketMatchSpec]) -> None:
    by_key = {m.key: m for m in matches}
    for match in matches:
        for source in match.sources:
            if source.get("type") != "rank":
                continue
            ref = source["match_key"]
            if ref not in by_key:
                raise BracketSchemaError(f"Spiel {match.key} referenziert unbekanntes Spiel {ref}")
            if ref == match.key:
                raise BracketSchemaError(f"Spiel {match.key} referenziert sich selbst")

    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(key: str) -> None:
        if key in visited:
            return
        if key in visiting:
            raise BracketSchemaError(f"Zyklische Referenz im Schema bei Spiel {key}")
        visiting.add(key)
        for source in by_key[key].sources:
            if source.get("type") == "rank":
                visit(source["match_key"])
        visiting.remove(key)
        visited.add(key)

    for key in by_key:
        visit(key)


def infer_rounds(matches: list[BracketMatchSpec]) -> dict[str, int]:
    by_key = {m.key: m for m in matches}
    cache: dict[str, int] = {}

    def depth(key: str) -> int:
        if key in cache:
            return cache[key]
        refs = [source["match_key"] for source in by_key[key].sources if source.get("type") == "rank"]
        if not refs:
            value = by_key[key].round_hint or 1
        else:
            value = max(depth(ref) for ref in refs) + 1
            if by_key[key].round_hint:
                value = max(value, by_key[key].round_hint)
        cache[key] = value
        return value

    return {match.key: depth(match.key) for match in matches}


def _ordered_registrations(registrations: list[dict], seeding_mode: str) -> list[dict]:
    regs = [r for r in registrations if r.get("status") in ("approved", "checked_in")]
    if seeding_mode in {"manual", "ranking"}:
        regs.sort(key=lambda r: (r.get("seed") is None, r.get("seed") or 999999, r.get("created_at") or ""))
    elif seeding_mode == "random":
        regs = list(regs)
        random.shuffle(regs)
    else:
        regs.sort(key=lambda r: (r.get("seed") is None, r.get("seed") or 999999, r.get("created_at") or ""))
    return regs


def _next_power_of_two(n: int) -> int:
    return 1 if n <= 1 else 2 ** math.ceil(math.log2(n))


def _seed_positions(size: int) -> list[int]:
    if size == 1:
        return [1]
    prev = _seed_positions(size // 2)
    result = []
    for seed in prev:
        result.append(seed)
        result.append(size + 1 - seed)
    return result


def _match_key(index: int) -> str:
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    key = ""
    value = index
    while True:
        key = alphabet[value % 26] + key
        value = value // 26 - 1
        if value < 0:
            return key


def _auto_single_elim_schema(slot_count: int, bronze_match: bool = False) -> str:
    bracket_size = _next_power_of_two(max(2, slot_count))
    sources = [str(seed) for seed in _seed_positions(bracket_size)]
    lines = ["[WB]"]
    next_key_index = 0
    round_num = 1
    round_keys: list[list[str]] = []
    while len(sources) > 1:
        lines.append(f"# Runde {round_num}")
        next_sources = []
        keys_this_round: list[str] = []
        for idx in range(0, len(sources), 2):
            key = _match_key(next_key_index)
            next_key_index += 1
            lines.append(f"{key}=[{sources[idx]},{sources[idx + 1]}]")
            keys_this_round.append(key)
            next_sources.append(f"W:{key}:1")
        round_keys.append(keys_this_round)
        sources = next_sources
        round_num += 1
    if bronze_match and len(round_keys) >= 2 and len(round_keys[-2]) >= 2:
        semifinals = round_keys[-2]
        key = _match_key(next_key_index)
        lines.append("")
        lines.append("[BRONZE]")
        lines.append("# Spiel um Platz 3")
        lines.append(f"{key}=[L:{semifinals[0]}:2,L:{semifinals[1]}:2]")
    return "\n".join(lines)


def _auto_double_elim_schema(slot_count: int) -> str:
    bracket_size = _next_power_of_two(max(2, slot_count))
    if bracket_size == 2:
        return "[WB]\n# Winner Bracket\nA=[1,2]\n\n[GF]\n# Finale\nGF=[W:A:1,L:A:2]"

    lines = ["[WB]"]
    sources = [str(seed) for seed in _seed_positions(bracket_size)]
    next_key_index = 0
    wb_rounds: list[list[str]] = []
    round_num = 1
    while len(sources) > 1:
        lines.append(f"# Winner Runde {round_num}")
        round_keys: list[str] = []
        next_sources = []
        for idx in range(0, len(sources), 2):
            key = _match_key(next_key_index)
            next_key_index += 1
            lines.append(f"{key}=[{sources[idx]},{sources[idx + 1]}]")
            round_keys.append(key)
            next_sources.append(f"W:{key}:1")
        wb_rounds.append(round_keys)
        sources = next_sources
        round_num += 1

    lines.append("")
    lines.append("[LB]")
    lb_key_index = 0
    lb_prev: list[str] = []
    first_wb = wb_rounds[0]
    lines.append("# Loser Runde 1")
    for idx in range(0, len(first_wb), 2):
        key = f"L{_match_key(lb_key_index)}"
        lb_key_index += 1
        lines.append(f"{key}=[L:{first_wb[idx]}:2,L:{first_wb[idx + 1]}:2]")
        lb_prev.append(key)

    lb_round_num = 2
    for wb_round in wb_rounds[1:]:
        drop_round: list[str] = []
        lines.append(f"# Loser Runde {lb_round_num}")
        lb_round_num += 1
        for idx, wb_key in enumerate(wb_round):
            if idx >= len(lb_prev):
                break
            key = f"L{_match_key(lb_key_index)}"
            lb_key_index += 1
            lines.append(f"{key}=[W:{lb_prev[idx]}:1,L:{wb_key}:2]")
            drop_round.append(key)
        lb_prev = drop_round
        if len(lb_prev) > 1:
            collapse_round: list[str] = []
            lines.append(f"# Loser Runde {lb_round_num}")
            lb_round_num += 1
            for idx in range(0, len(lb_prev), 2):
                key = f"L{_match_key(lb_key_index)}"
                lb_key_index += 1
                lines.append(f"{key}=[W:{lb_prev[idx]}:1,W:{lb_prev[idx + 1]}:1]")
                collapse_round.append(key)
            lb_prev = collapse_round

    wb_final = wb_rounds[-1][0]
    lb_final = lb_prev[0]
    lines.append("")
    lines.append("[GF]")
    lines.append("# Grand Final")
    lines.append(f"GF=[W:{wb_final}:1,W:{lb_final}:1]")
    return "\n".join(lines)


def _with_custom_bronze_match(schema: str) -> str:
    specs = parse_custom_bracket_schema(schema)
    if any((spec.section or "").strip().lower() in {"bronze", "spiel um platz 3", "platz 3"} for spec in specs):
        return schema

    referenced = {
        source["match_key"]
        for spec in specs
        for source in spec.sources
        if source.get("type") == "rank"
    }
    finals = [spec for spec in specs if spec.key not in referenced]
    if not finals:
        return schema
    rounds = infer_rounds(specs)
    final = max(finals, key=lambda spec: (rounds.get(spec.key, 0), spec.order))
    semifinal_sources = [
        source for source in final.sources
        if source.get("type") == "rank" and source.get("flow") == "W" and int(source.get("rank") or 0) == 1
    ]
    if len(semifinal_sources) != 2:
        return schema

    seen_keys = {spec.key for spec in specs}
    next_index = len(specs)
    key = _match_key(next_index)
    while key in seen_keys:
        next_index += 1
        key = _match_key(next_index)
    left = semifinal_sources[0]["match_key"]
    right = semifinal_sources[1]["match_key"]
    return "\n".join([
        schema.rstrip(),
        "",
        "[BRONZE]",
        "# Spiel um Platz 3",
        f"{key}=[L:{left}:2,L:{right}:2]",
    ])


def _resolve_schema(tournament: dict, stage: dict, registrations: list[dict], preview: bool) -> str | None:
    settings = stage.get("settings") or {}
    schema = settings.get("schema") or settings.get("custom_schema") or settings.get("bracket_schema")
    if schema:
        if bool(tournament.get("bronze_match")) and (stage.get("stage_type") or "") == "custom_bracket":
            return _with_custom_bronze_match(schema)
        return schema
    if (stage.get("stage_type") or "") == "single_elimination":
        size = int(tournament.get("max_participants") or 2) if preview else max(2, len(registrations))
        return _auto_single_elim_schema(size, bool(tournament.get("bronze_match")))
    if (stage.get("stage_type") or "") == "double_elimination":
        size = int(tournament.get("max_participants") or 2) if preview else max(2, len(registrations))
        return _auto_double_elim_schema(size)
    return None


def _ready_status_for_slots(slots: list[dict], min_players: int) -> str:
    filled = sum(1 for slot in slots if slot.get("status") == "filled" and slot.get("registration_id"))
    has_pending_ref = any(
        slot.get("status") == "pending" and (slot.get("source") or {}).get("type") == "rank"
        for slot in slots
    )
    return "ready" if not has_pending_ref and filled >= min_players else "pending"


def _apply_auto_byes(docs: list[dict]) -> None:
    by_id = {doc["id"]: doc for doc in docs}
    for doc in sorted(docs, key=lambda item: (item.get("round") or 0, item.get("order") or 0)):
        if doc.get("is_preview") or doc.get("match_type") != "duel" or doc.get("status") == "completed":
            continue
        slots = doc.get("slots") or []
        filled = [slot for slot in slots if slot.get("status") == "filled" and slot.get("registration_id")]
        unresolved = [slot for slot in slots if slot.get("status") == "pending"]
        if len(filled) != 1 or unresolved or not any(slot.get("status") == "bye" for slot in slots):
            continue
        winner = filled[0]
        now = _now_utc().isoformat()
        doc["results"] = [{
            "registration_id": winner.get("registration_id"),
            "user_id": winner.get("user_id"),
            "slot": winner.get("slot"),
            "rank": 1,
            "score": None,
            "points": None,
            "time_ms": None,
            "dnf": False,
            "forfeit": False,
            "note": "Auto-Advance durch Bye",
            "reported_by": "system",
            "reported_at": now,
        }]
        doc["status"] = "completed"
        doc["result_meta"] = {"source": "auto_bye", "updated_at": now}
        doc["updated_at"] = now
        for advancement in doc.get("advancement") or []:
            if advancement.get("rank") != 1:
                continue
            target = by_id.get(advancement.get("to_match_id"))
            if not target:
                continue
            target_slot = next(
                (slot for slot in (target.get("slots") or []) if slot.get("slot") == advancement.get("to_slot")),
                None,
            )
            if not target_slot:
                continue
            target_slot["registration_id"] = winner.get("registration_id")
            target_slot["user_id"] = winner.get("user_id")
            target_slot["status"] = "filled"
            target["status"] = _ready_status_for_slots(target.get("slots") or [], int((target.get("settings") or {}).get("min_players") or 2))
            target["updated_at"] = now


def build_matches_v2_from_schema(tournament: dict, stage: dict, registrations: list[dict], preview: bool = False) -> list[dict]:
    settings = stage.get("settings") or {}
    schema = _resolve_schema(tournament, stage, registrations, preview)
    specs = parse_custom_bracket_schema(schema)
    rounds = infer_rounds(specs)
    ordered_regs = _ordered_registrations(registrations, tournament.get("seeding_mode") or "random")
    seed_to_reg = {index + 1: reg for index, reg in enumerate(ordered_regs)}
    now = _now_utc().isoformat()
    match_type = stage.get("match_type") or settings.get("match_type") or "ffa"
    stage_type = stage.get("stage_type") or "custom_bracket"
    min_players = int(settings.get("min_players") or (2 if match_type == "ffa" else 2))
    qualifiers_per_match = int(settings.get("qualifiers_per_match") or (2 if match_type == "ffa" else 1))

    docs: list[dict] = []
    by_key: dict[str, dict] = {}
    for spec in specs:
        slots = []
        has_ref = False
        filled_count = 0
        for idx, source in enumerate(spec.sources, start=1):
            slot = {
                "slot": idx,
                "source": dict(source),
                "registration_id": None,
                "user_id": None,
                "seed": source.get("seed"),
                "status": "pending",
            }
            if source.get("type") == "seed":
                reg = seed_to_reg.get(int(source["seed"]))
                if reg:
                    slot["registration_id"] = reg.get("id")
                    slot["user_id"] = reg.get("user_id")
                    slot["status"] = "filled"
                    filled_count += 1
                else:
                    slot["status"] = "preview" if preview else "bye"
            elif source.get("type") == "bye":
                slot["status"] = "bye"
            else:
                has_ref = True
            slots.append(slot)

        doc = {
            "id": _new_id(),
            "tournament_id": tournament["id"],
            "stage_id": stage["id"],
            "stage_number": stage.get("number"),
            "stage_type": stage_type,
            "match_type": match_type,
            "match_key": spec.key,
            "section": spec.section,
            "round": rounds[spec.key],
            "round_name": spec.round_name_hint or f"Runde {rounds[spec.key]}",
            "order": spec.order,
            "slots": slots,
            "results": [],
            "advancement": [],
            "settings": {
                "min_players": min_players,
                "match_size": len(slots),
                "qualifiers_per_match": qualifiers_per_match,
                "score_type": settings.get("score_type") or "points",
                "calculation": settings.get("calculation") or "points",
                "duration_minutes": int(settings.get("duration_minutes") or tournament.get("match_duration_minutes") or 30),
            },
            "status": "preview" if preview else ("ready" if not has_ref and filled_count >= min_players else "pending"),
            "is_preview": bool(preview),
            "generation_mode": "preview" if preview else "seeded",
            "scheduled_at": None,
            "duration_minutes": int(settings.get("duration_minutes") or tournament.get("match_duration_minutes") or 30),
            "station_id": None,
            "created_at": now,
            "updated_at": now,
        }
        docs.append(doc)
        by_key[spec.key] = doc

    for doc in docs:
        for slot in doc["slots"]:
            source = slot.get("source") or {}
            if source.get("type") != "rank":
                continue
            ref_doc = by_key.get(source["match_key"])
            if not ref_doc:
                continue
            ref_doc["advancement"].append({
                "flow": source["flow"],
                "rank": source["rank"],
                "to_match_key": doc["match_key"],
                "to_match_id": doc["id"],
                "to_slot": slot["slot"],
            })

    if not preview:
        _apply_auto_byes(docs)

    return sorted(docs, key=lambda m: (m["round"], m["order"]))
