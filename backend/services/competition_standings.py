"""Standings projections over canonical competition matches."""

from __future__ import annotations


TERMINAL_MATCH_STATUSES = {"completed", "forfeit"}


def _safe_int(value, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _display_name(registration: dict) -> str:
    return (
        registration.get("display_name")
        or registration.get("ingame_name")
        or (registration.get("user") or {}).get("display_name")
        or "Teilnehmer"
    )


def _duel_entries(match: dict) -> tuple[dict | None, dict | None, dict | None, dict | None]:
    slots = sorted(match.get("slots") or [], key=lambda slot: _safe_int(slot.get("position"), 999))
    slot_a = slots[0] if slots else None
    slot_b = slots[1] if len(slots) > 1 else None
    results = {row.get("registration_id"): row for row in match.get("results") or []}
    result_a = results.get((slot_a or {}).get("registration_id"))
    result_b = results.get((slot_b or {}).get("registration_id"))
    return slot_a, slot_b, result_a, result_b


def stage_standings(matches: list[dict], registrations: list[dict]) -> list[dict]:
    rank_map = {
        registration["id"]: {
            "registration_id": registration["id"],
            "display_name": _display_name(registration),
            "played": 0,
            "won": 0,
            "top2": 0,
            "lost": 0,
            "points": 0,
            "rank_sum": 0,
            "furthest_round": 0,
            "best_rank": None,
        }
        for registration in registrations
        if registration.get("id")
    }
    for match in matches:
        if match.get("status") not in TERMINAL_MATCH_STATUSES:
            continue
        for result in match.get("results") or []:
            registration_id = result.get("registration_id")
            if registration_id not in rank_map:
                continue
            rank = _safe_int(result.get("rank"), 999)
            row = rank_map[registration_id]
            row["played"] += 1
            row["rank_sum"] += rank
            row["furthest_round"] = max(row["furthest_round"], _safe_int(match.get("round")))
            row["best_rank"] = rank if row["best_rank"] is None else min(row["best_rank"], rank)
            if rank == 1:
                row["won"] += 1
            if rank <= 2:
                row["top2"] += 1
            else:
                row["lost"] += 1
            score = result.get("points")
            if score is None:
                score = result.get("score")
            if isinstance(score, (int, float)):
                row["points"] += score
    rows = list(rank_map.values())
    for row in rows:
        row["avg_rank"] = round(row["rank_sum"] / row["played"], 2) if row["played"] else None
    rows.sort(
        key=lambda row: (
            row["furthest_round"],
            row["won"],
            row["top2"],
            row["points"],
            -(row["avg_rank"] or 999),
        ),
        reverse=True,
    )
    for index, row in enumerate(rows, start=1):
        row["rank"] = index
    return rows


def elimination_standings(matches: list[dict], registrations: list[dict]) -> list[dict]:
    rank_map = {
        registration["id"]: {
            "registration_id": registration["id"],
            "display_name": _display_name(registration),
            "furthest_round": 0,
            "wins": 0,
            "losses": 0,
        }
        for registration in registrations
        if registration.get("id")
    }
    for match in matches:
        round_number = _safe_int(match.get("round"))
        for slot in match.get("slots") or []:
            registration_id = slot.get("registration_id")
            if registration_id in rank_map:
                rank_map[registration_id]["furthest_round"] = max(
                    rank_map[registration_id]["furthest_round"],
                    round_number,
                )
        if match.get("status") not in TERMINAL_MATCH_STATUSES:
            continue
        for result in match.get("results") or []:
            registration_id = result.get("registration_id")
            if registration_id not in rank_map:
                continue
            outcome = result.get("outcome")
            if outcome == "winner" or (outcome is None and _safe_int(result.get("rank"), 999) == 1):
                rank_map[registration_id]["wins"] += 1
            elif outcome in {"loser", "forfeit"} or (outcome is None and result.get("rank") is not None):
                rank_map[registration_id]["losses"] += 1
    rows = list(rank_map.values())
    rows.sort(key=lambda row: (row["furthest_round"], row["wins"], -row["losses"]), reverse=True)
    for index, row in enumerate(rows, start=1):
        row["rank"] = index
    return rows


def round_robin_standings(matches: list[dict], registrations: list[dict]) -> list[dict]:
    stats = {
        registration["id"]: {
            "registration_id": registration["id"],
            "user_id": registration.get("user_id"),
            "team_id": registration.get("team_id"),
            "display_name": _display_name(registration),
            "played": 0,
            "won": 0,
            "lost": 0,
            "drawn": 0,
            "score_for": 0,
            "score_against": 0,
            "points": 0,
        }
        for registration in registrations
        if registration.get("id")
    }
    for match in matches:
        if match.get("status") != "completed":
            continue
        slot_a, slot_b, result_a, result_b = _duel_entries(match)
        registration_a = (slot_a or {}).get("registration_id")
        registration_b = (slot_b or {}).get("registration_id")
        score_a = (result_a or {}).get("score")
        score_b = (result_b or {}).get("score")
        score_a = score_a if isinstance(score_a, (int, float)) else 0
        score_b = score_b if isinstance(score_b, (int, float)) else 0
        if registration_a in stats:
            stats[registration_a]["played"] += 1
            stats[registration_a]["score_for"] += score_a
            stats[registration_a]["score_against"] += score_b
        if registration_b in stats:
            stats[registration_b]["played"] += 1
            stats[registration_b]["score_for"] += score_b
            stats[registration_b]["score_against"] += score_a
        winner_id = next(
            (
                result.get("registration_id")
                for result in match.get("results") or []
                if result.get("outcome") == "winner"
            ),
            None,
        )
        if winner_id == registration_a and registration_a in stats:
            stats[registration_a]["won"] += 1
            stats[registration_a]["points"] += 3
            if registration_b in stats:
                stats[registration_b]["lost"] += 1
        elif winner_id == registration_b and registration_b in stats:
            stats[registration_b]["won"] += 1
            stats[registration_b]["points"] += 3
            if registration_a in stats:
                stats[registration_a]["lost"] += 1
        else:
            if registration_a in stats:
                stats[registration_a]["drawn"] += 1
                stats[registration_a]["points"] += 1
            if registration_b in stats:
                stats[registration_b]["drawn"] += 1
                stats[registration_b]["points"] += 1
    rows = list(stats.values())
    rows.sort(key=lambda row: (row["points"], row["won"], row["score_for"] - row["score_against"]), reverse=True)
    for index, row in enumerate(rows, start=1):
        row["rank"] = index
    return rows


def swiss_standings(matches: list[dict], registrations: list[dict]) -> list[dict]:
    stats = {
        registration["id"]: {
            "registration_id": registration["id"],
            "display_name": _display_name(registration),
            "points": 0,
            "played": 0,
            "won": 0,
            "drawn": 0,
            "lost": 0,
            "opponents": [],
        }
        for registration in registrations
        if registration.get("id")
    }
    for match in matches:
        if match.get("status") != "completed":
            continue
        slot_a, slot_b, _result_a, _result_b = _duel_entries(match)
        registration_a = (slot_a or {}).get("registration_id")
        registration_b = (slot_b or {}).get("registration_id")
        if registration_a not in stats or registration_b not in stats:
            continue
        stats[registration_a]["played"] += 1
        stats[registration_b]["played"] += 1
        stats[registration_a]["opponents"].append(registration_b)
        stats[registration_b]["opponents"].append(registration_a)
        winner_id = next(
            (
                result.get("registration_id")
                for result in match.get("results") or []
                if result.get("outcome") == "winner"
            ),
            None,
        )
        if winner_id == registration_a:
            stats[registration_a]["won"] += 1
            stats[registration_a]["points"] += 1
            stats[registration_b]["lost"] += 1
        elif winner_id == registration_b:
            stats[registration_b]["won"] += 1
            stats[registration_b]["points"] += 1
            stats[registration_a]["lost"] += 1
        else:
            stats[registration_a]["drawn"] += 1
            stats[registration_b]["drawn"] += 1
            stats[registration_a]["points"] += 0.5
            stats[registration_b]["points"] += 0.5
    for row in stats.values():
        row["buchholz"] = sum(stats[opponent]["points"] for opponent in row["opponents"] if opponent in stats)
        row.pop("opponents", None)
    rows = list(stats.values())
    rows.sort(key=lambda row: (row["points"], row["buchholz"], row["won"]), reverse=True)
    for index, row in enumerate(rows, start=1):
        row["rank"] = index
    return rows


def group_standings(matches: list[dict], registrations: list[dict], groups: list[dict]) -> list[dict]:
    registration_map = {registration["id"]: registration for registration in registrations if registration.get("id")}
    result = []
    for group in groups:
        group_id = group.get("id")
        section = f"group_{group.get('group_key')}"
        group_matches = [
            match
            for match in matches
            if match.get("group_id") == group_id or match.get("section") == section
        ]
        group_registrations = [
            registration_map[registration_id]
            for registration_id in group.get("participant_ids") or []
            if registration_id in registration_map
        ]
        result.append({
            "group": group,
            "standings": round_robin_standings(group_matches, group_registrations),
        })
    return result


def standings_for_structure(
    tournament: dict,
    snapshot: dict,
    registrations: list[dict],
    *,
    groups: list[dict] = (),
) -> list[dict]:
    """Select the existing standings policy over one canonical read model."""

    matches = snapshot.get("matches") or []
    stage_matches = [match for match in matches if match.get("source", {}).get("engine") == "stage"]
    if stage_matches:
        return stage_standings(stage_matches, registrations)
    legacy_matches = [match for match in matches if match.get("source", {}).get("engine") == "legacy"]
    format_key = tournament.get("format")
    if format_key in {"round_robin", "league"}:
        return round_robin_standings(legacy_matches, registrations)
    if format_key == "swiss":
        return swiss_standings(legacy_matches, registrations)
    if format_key == "groups":
        return group_standings(legacy_matches, registrations, list(groups))
    return elimination_standings(legacy_matches, registrations)
