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
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any


ASSIGNMENT_RE = re.compile(r"^(?P<key>[A-Za-z0-9_.-]+)\s*=\s*\[(?P<slots>.*)\]\s*$")
SECTION_RE = re.compile(r"^\[(?P<section>[A-Za-z0-9_. -]+)\]\s*$")
SOURCE_RE = re.compile(r"^(?P<flow>[WLR]):(?P<match>[A-Za-z0-9_.-]+):(?P<rank>[1-9][0-9]*)$")
ROUND_RE = re.compile(r"\bround\s+([0-9]+)\b", re.IGNORECASE)


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
            raise BracketSchemaError(f"Seed muss groesser 0 sein: {token}")
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
            raise BracketSchemaError(f"Match-Key doppelt vergeben: {key}")
        seen.add(key)
        slot_raw = assignment.group("slots").strip()
        if not slot_raw:
            raise BracketSchemaError(f"Match {key} hat keine Slots")
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
        raise BracketSchemaError("Schema enthaelt keine Matches")
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
                raise BracketSchemaError(f"Match {match.key} referenziert unbekanntes Match {ref}")
            if ref == match.key:
                raise BracketSchemaError(f"Match {match.key} referenziert sich selbst")

    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(key: str) -> None:
        if key in visited:
            return
        if key in visiting:
            raise BracketSchemaError(f"Zyklische Referenz im Schema bei Match {key}")
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


def build_matches_v2_from_schema(tournament: dict, stage: dict, registrations: list[dict], preview: bool = False) -> list[dict]:
    settings = stage.get("settings") or {}
    schema = settings.get("schema") or settings.get("custom_schema") or settings.get("bracket_schema")
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
            "round_name": spec.round_name_hint or f"Round {rounds[spec.key]}",
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
            },
            "status": "preview" if preview else ("ready" if not has_ref and filled_count >= min_players else "pending"),
            "is_preview": bool(preview),
            "generation_mode": "preview" if preview else "seeded",
            "scheduled_at": None,
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

    return sorted(docs, key=lambda m: (m["round"], m["order"]))
