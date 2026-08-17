"""Pure validation for the canonical competition structure graph.

The validator deliberately operates on ``competition.structure.v1`` snapshots.
It neither repairs source documents nor decides which collection should win.
That makes it safe for previews, shadow reads, and migration dry runs.
"""

from __future__ import annotations

from collections import Counter, defaultdict, deque
from typing import Any


GRAPH_VALIDATION_VERSION = "competition.graph-validation.v1"
MATCH_RESULT_SOURCE = "match_result"
VALID_ADVANCEMENT_OUTCOMES = {"winner", "loser", "rank"}


def _positive_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value > 0 else None
    if isinstance(value, float):
        return int(value) if value.is_integer() and value > 0 else None
    try:
        normalized = str(value).strip()
        if not normalized or not normalized.isdigit():
            return None
        parsed = int(normalized)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _issue_sort_key(issue: dict) -> tuple:
    return (
        issue.get("severity") or "",
        issue.get("code") or "",
        str(issue.get("match_id") or ""),
        str(issue.get("target_id") or ""),
        _positive_int(issue.get("position")) or 0,
        str(issue.get("registration_id") or ""),
    )


def validate_competition_graph(snapshot: dict) -> dict:
    """Return a deterministic validation report for a canonical snapshot.

    Multiple independent entry matches are valid. A match is unreachable only
    when its declared match-result dependencies cannot be traced back to an
    entry match (for example because of a missing source or a closed cycle).
    """

    issues: list[dict] = []

    def add_issue(code: str, *, severity: str = "error", **context: Any) -> None:
        issues.append({"severity": severity, "code": code, **context})

    matches = snapshot.get("matches") or []
    by_id: dict[str, dict] = {}
    for match in matches:
        match_id = match.get("id")
        if not match_id:
            add_issue("missing_match_id")
            continue
        if match_id in by_id:
            add_issue("duplicate_match_id", match_id=match_id)
            continue
        by_id[match_id] = match

    slots_by_match: dict[str, dict[int, dict]] = {}
    declared_dependencies: dict[str, set[str]] = defaultdict(set)
    missing_dependencies: set[str] = set()

    for match_id, match in by_id.items():
        slots = match.get("slots") or []
        slot_positions: dict[int, dict] = {}
        registrations: Counter[str] = Counter()
        for slot in slots:
            position = _positive_int(slot.get("position"))
            if position is None:
                add_issue(
                    "invalid_slot_position",
                    match_id=match_id,
                    position=slot.get("position"),
                )
            elif position in slot_positions:
                add_issue("duplicate_slot_position", match_id=match_id, position=position)
            else:
                slot_positions[position] = slot

            registration_id = slot.get("registration_id")
            if registration_id:
                registrations[str(registration_id)] += 1

            source = slot.get("source") or {}
            if source.get("type") != MATCH_RESULT_SOURCE:
                continue
            source_id = source.get("match_id")
            if not source_id or source_id not in by_id:
                add_issue(
                    "missing_slot_source_match",
                    match_id=match_id,
                    position=position,
                    source_match_id=source_id,
                )
                missing_dependencies.add(match_id)
                continue
            declared_dependencies[match_id].add(source_id)
            source_rank = _positive_int(source.get("rank"))
            source_slot_count = len(by_id[source_id].get("slots") or [])
            if (
                source_rank is None
                or source_slot_count == 0
                or source_rank > source_slot_count
            ):
                add_issue(
                    "invalid_slot_source_rank",
                    match_id=match_id,
                    position=position,
                    source_match_id=source_id,
                    rank=source.get("rank"),
                    max_rank=source_slot_count,
                )
            if source.get("outcome") not in VALID_ADVANCEMENT_OUTCOMES:
                add_issue(
                    "invalid_slot_source_outcome",
                    match_id=match_id,
                    position=position,
                    source_match_id=source_id,
                    outcome=source.get("outcome"),
                )

        slots_by_match[match_id] = slot_positions
        for registration_id, count in registrations.items():
            if count > 1:
                add_issue(
                    "duplicate_match_participant",
                    match_id=match_id,
                    registration_id=registration_id,
                    count=count,
                )

        result_registrations: Counter[str] = Counter()
        result_rank_limit = max(len(slots), len(match.get("results") or []))
        for result in match.get("results") or []:
            registration_id = result.get("registration_id")
            if registration_id:
                result_registrations[str(registration_id)] += 1
            rank = _positive_int(result.get("rank"))
            if rank is None or (result_rank_limit and rank > result_rank_limit):
                add_issue(
                    "invalid_result_rank",
                    match_id=match_id,
                    registration_id=registration_id,
                    rank=result.get("rank"),
                    max_rank=result_rank_limit,
                )
        for registration_id, count in result_registrations.items():
            if count > 1:
                add_issue(
                    "duplicate_result_participant",
                    match_id=match_id,
                    registration_id=registration_id,
                    count=count,
                )

    graph: dict[str, set[str]] = {match_id: set() for match_id in by_id}
    incoming_edges: dict[tuple[str, int], list[dict]] = defaultdict(list)
    for source_id, match in by_id.items():
        source_slot_count = len(match.get("slots") or [])
        for edge in match.get("advancement") or []:
            target_id = edge.get("to_match_id")
            position = _positive_int(edge.get("to_position"))
            rank = _positive_int(edge.get("rank"))
            if rank is None or source_slot_count == 0 or rank > source_slot_count:
                add_issue(
                    "invalid_advancement_rank",
                    match_id=source_id,
                    target_id=target_id,
                    rank=edge.get("rank"),
                    max_rank=source_slot_count,
                )
            if edge.get("outcome") not in VALID_ADVANCEMENT_OUTCOMES:
                add_issue(
                    "invalid_advancement_outcome",
                    match_id=source_id,
                    target_id=target_id,
                    outcome=edge.get("outcome"),
                )
            if not target_id or target_id not in by_id:
                add_issue(
                    "missing_advancement_target",
                    match_id=source_id,
                    target_id=target_id,
                )
                continue
            graph[source_id].add(target_id)
            declared_dependencies[target_id].add(source_id)
            if position is None or position not in slots_by_match.get(target_id, {}):
                add_issue(
                    "missing_target_slot",
                    match_id=source_id,
                    target_id=target_id,
                    position=edge.get("to_position"),
                )
                continue
            incoming_edges[(target_id, position)].append({
                "source_id": source_id,
                "outcome": edge.get("outcome"),
                "rank": rank,
            })

    for (target_id, position), edges in incoming_edges.items():
        if len(edges) > 1:
            add_issue(
                "duplicate_target_slot_source",
                target_id=target_id,
                position=position,
                source_match_ids=sorted(str(edge["source_id"]) for edge in edges),
            )
        slot_source = (slots_by_match[target_id][position].get("source") or {})
        if slot_source.get("type") != MATCH_RESULT_SOURCE:
            add_issue("missing_target_slot_source", target_id=target_id, position=position)
            continue
        expected_source_id = slot_source.get("match_id")
        expected_rank = _positive_int(slot_source.get("rank"))
        expected_outcome = slot_source.get("outcome")
        if not any(edge["source_id"] == expected_source_id for edge in edges):
            add_issue(
                "target_slot_source_mismatch",
                target_id=target_id,
                position=position,
                source_match_id=expected_source_id,
            )
        elif not any(
            edge["source_id"] == expected_source_id
            and edge["rank"] == expected_rank
            and edge["outcome"] == expected_outcome
            for edge in edges
        ):
            add_issue(
                "target_slot_contract_mismatch",
                target_id=target_id,
                position=position,
                source_match_id=expected_source_id,
            )

    for target_id, slots in slots_by_match.items():
        for position, slot in slots.items():
            source = slot.get("source") or {}
            if source.get("type") != MATCH_RESULT_SOURCE:
                continue
            source_id = source.get("match_id")
            if source_id in by_id and not any(
                edge["source_id"] == source_id
                for edge in incoming_edges.get((target_id, position), [])
            ):
                add_issue(
                    "missing_source_advancement",
                    match_id=target_id,
                    position=position,
                    source_match_id=source_id,
                )

    # Slot declarations are dependencies too, even if the mirrored advancement
    # edge is damaged. Including both views catches cycles before apply.
    dependency_graph: dict[str, set[str]] = {
        match_id: set(targets) for match_id, targets in graph.items()
    }
    for target_id, source_ids in declared_dependencies.items():
        for source_id in source_ids:
            if source_id in by_id:
                dependency_graph.setdefault(source_id, set()).add(target_id)

    # Kahn's algorithm avoids recursion limits for large custom brackets. Any
    # nodes left after all zero-indegree nodes are removed contain or depend on
    # a cycle, which is sufficient to reject the graph before apply.
    indegree = {match_id: 0 for match_id in by_id}
    for targets in dependency_graph.values():
        for target_id in targets:
            indegree[target_id] += 1
    ready = deque(match_id for match_id, count in indegree.items() if count == 0)
    acyclic_nodes: set[str] = set()
    while ready:
        match_id = ready.popleft()
        acyclic_nodes.add(match_id)
        for target_id in dependency_graph.get(match_id, set()):
            indegree[target_id] -= 1
            if indegree[target_id] == 0:
                ready.append(target_id)
    cycle_blocked_nodes = sorted(set(by_id) - acyclic_nodes)
    if cycle_blocked_nodes:
        add_issue("advancement_cycle", match_ids=cycle_blocked_nodes)

    remaining_dependencies = {
        match_id: len(declared_dependencies.get(match_id, set()))
        for match_id in by_id
    }
    dependents: dict[str, set[str]] = defaultdict(set)
    for target_id, source_ids in declared_dependencies.items():
        for source_id in source_ids:
            dependents[source_id].add(target_id)
    entry_matches = deque(
        match_id
        for match_id, count in remaining_dependencies.items()
        if count == 0 and match_id not in missing_dependencies
    )
    reachable: set[str] = set()
    while entry_matches:
        match_id = entry_matches.popleft()
        if match_id in reachable:
            continue
        reachable.add(match_id)
        for target_id in dependents.get(match_id, set()):
            remaining_dependencies[target_id] -= 1
            if (
                remaining_dependencies[target_id] == 0
                and target_id not in missing_dependencies
            ):
                entry_matches.append(target_id)
    for match_id in sorted(set(by_id) - reachable):
        add_issue("unreachable_match", match_id=match_id)

    issues.sort(key=_issue_sort_key)
    severity_counts = Counter(issue["severity"] for issue in issues)
    issue_counts = Counter(issue["code"] for issue in issues)
    return {
        "validation_version": GRAPH_VALIDATION_VERSION,
        "valid": severity_counts.get("error", 0) == 0,
        "match_count": len(matches),
        "validated_match_count": len(by_id),
        "issue_count": len(issues),
        "error_count": severity_counts.get("error", 0),
        "warning_count": severity_counts.get("warning", 0),
        "issue_counts": dict(sorted(issue_counts.items())),
        "issues": issues,
    }
