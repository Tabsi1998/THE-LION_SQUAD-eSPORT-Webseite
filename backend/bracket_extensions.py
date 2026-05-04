"""Extended bracket generators: Swiss + Group Stage."""
import math
import random
from typing import List, Dict
from models import new_id, now_utc
from bracket_engine import _participant_list, _make_match


def generate_swiss_round(tournament_id: str, registrations: List[dict], previous_matches: List[dict],
                          round_num: int, best_of: int = 1) -> List[dict]:
    """Generate a new Swiss round based on current scores and avoid re-pairing."""
    regs = _participant_list(registrations, "manual")
    if len(regs) < 2:
        return []

    # Score map + opponent history
    scores: Dict[str, float] = {r["id"]: 0 for r in regs}
    opponents: Dict[str, set] = {r["id"]: set() for r in regs}
    for m in previous_matches:
        if m.get("status") != "completed":
            continue
        a, b, w = m.get("participant_a_id"), m.get("participant_b_id"), m.get("winner_id")
        if a in scores and b in scores:
            opponents[a].add(b)
            opponents[b].add(a)
            if w == a:
                scores[a] += 1
            elif w == b:
                scores[b] += 1
            else:
                scores[a] += 0.5
                scores[b] += 0.5

    # Sort by score desc, shuffle ties
    by_score: Dict[float, List[str]] = {}
    for pid, sc in scores.items():
        by_score.setdefault(sc, []).append(pid)
    ordered = []
    for sc in sorted(by_score.keys(), reverse=True):
        bucket = by_score[sc]
        random.shuffle(bucket)
        ordered.extend(bucket)

    # Greedy pairing, avoid repeats
    matches = []
    used = set()
    match_index = 0
    for i, p in enumerate(ordered):
        if p in used:
            continue
        partner = None
        # Find next unused player not already played
        for j in range(i + 1, len(ordered)):
            cand = ordered[j]
            if cand in used:
                continue
            if cand not in opponents[p]:
                partner = cand
                break
        # Fallback: allow rematch
        if partner is None:
            for j in range(i + 1, len(ordered)):
                if ordered[j] not in used:
                    partner = ordered[j]
                    break
        if partner is None:
            # Bye - player already has his match? In swiss odd-player gets bye point
            break
        used.add(p)
        used.add(partner)
        m = _make_match(tournament_id, round_num, f"Swiss Runde {round_num}", "swiss",
                        match_index, best_of=best_of, p_a=p, p_b=partner)
        m["status"] = "ready"
        matches.append(m)
        match_index += 1
    return matches


def compute_swiss_standings(registrations: List[dict], matches: List[dict]) -> List[dict]:
    """Swiss standings with Buchholz tiebreaker."""
    stats: Dict[str, Dict] = {}
    for r in registrations:
        stats[r["id"]] = {
            "registration_id": r["id"],
            "display_name": r.get("display_name") or r.get("ingame_name") or "—",
            "points": 0, "played": 0, "won": 0, "drawn": 0, "lost": 0,
            "opponents": [],
        }
    for m in matches:
        if m.get("status") != "completed":
            continue
        a, b, w = m.get("participant_a_id"), m.get("participant_b_id"), m.get("winner_id")
        if a in stats and b in stats:
            stats[a]["played"] += 1
            stats[b]["played"] += 1
            stats[a]["opponents"].append(b)
            stats[b]["opponents"].append(a)
            if w == a:
                stats[a]["won"] += 1
                stats[a]["points"] += 1
                stats[b]["lost"] += 1
            elif w == b:
                stats[b]["won"] += 1
                stats[b]["points"] += 1
                stats[a]["lost"] += 1
            else:
                stats[a]["drawn"] += 1
                stats[b]["drawn"] += 1
                stats[a]["points"] += 0.5
                stats[b]["points"] += 0.5
    # Buchholz = sum of opponents' points
    for pid, s in stats.items():
        s["buchholz"] = sum(stats[op]["points"] for op in s["opponents"] if op in stats)
    arr = list(stats.values())
    arr.sort(key=lambda s: (s["points"], s["buchholz"], s["won"]), reverse=True)
    for i, s in enumerate(arr):
        s["rank"] = i + 1
        s.pop("opponents", None)
    return arr


def generate_groups(tournament_id: str, registrations: List[dict],
                     group_count: int = 4, best_of: int = 1) -> dict:
    """Split players into groups and generate round-robin matches per group.
    Returns dict {groups: [{name, participant_ids}], matches: [...]}."""
    regs = _participant_list(registrations, "random")
    if len(regs) < 2 or group_count < 1:
        return {"groups": [], "matches": []}

    # Distribute participants
    groups = [[] for _ in range(group_count)]
    for i, r in enumerate(regs):
        groups[i % group_count].append(r["id"])

    letters = "ABCDEFGHIJKL"
    all_matches = []
    groups_data = []
    for gi, pids in enumerate(groups):
        name = f"Gruppe {letters[gi]}" if gi < len(letters) else f"Gruppe {gi + 1}"
        groups_data.append({"id": new_id(), "name": name, "group_key": letters[gi] if gi < len(letters) else str(gi), "participant_ids": pids})
        # Round-robin
        players = pids[:]
        if len(players) % 2 == 1:
            players.append(None)
        n = len(players)
        half = n // 2
        arr = players[:]
        match_index = len(all_matches)
        for round_num in range(n - 1):
            for i in range(half):
                a, b = arr[i], arr[n - 1 - i]
                if a is None or b is None:
                    continue
                m = _make_match(tournament_id, round_num + 1,
                                 f"{name} - Spieltag {round_num + 1}",
                                 f"group_{letters[gi] if gi < len(letters) else gi}",
                                 match_index, best_of=best_of, p_a=a, p_b=b)
                m["status"] = "ready"
                m["group_id"] = groups_data[-1]["id"]
                all_matches.append(m)
                match_index += 1
            arr = [arr[0]] + [arr[-1]] + arr[1:-1]
    return {"groups": groups_data, "matches": all_matches}


def compute_group_standings(groups: List[dict], matches: List[dict], reg_map: dict) -> List[dict]:
    """Return standings per group."""
    result = []
    for g in groups:
        pids = set(g.get("participant_ids", []))
        stats = {pid: {"registration_id": pid, "display_name": reg_map.get(pid, {}).get("display_name", "—"),
                       "played": 0, "won": 0, "lost": 0, "drawn": 0,
                       "score_for": 0, "score_against": 0, "points": 0} for pid in pids}
        group_key = g.get("group_key")
        bracket_key = f"group_{group_key}"
        for m in matches:
            if m.get("bracket") != bracket_key or m.get("status") != "completed":
                continue
            a, b = m.get("participant_a_id"), m.get("participant_b_id")
            sa, sb = m.get("score_a", 0), m.get("score_b", 0)
            w = m.get("winner_id")
            if a in stats:
                stats[a]["played"] += 1; stats[a]["score_for"] += sa; stats[a]["score_against"] += sb
            if b in stats:
                stats[b]["played"] += 1; stats[b]["score_for"] += sb; stats[b]["score_against"] += sa
            if w == a and a in stats:
                stats[a]["won"] += 1; stats[a]["points"] += 3
                if b in stats: stats[b]["lost"] += 1
            elif w == b and b in stats:
                stats[b]["won"] += 1; stats[b]["points"] += 3
                if a in stats: stats[a]["lost"] += 1
            else:
                if a in stats: stats[a]["drawn"] += 1; stats[a]["points"] += 1
                if b in stats: stats[b]["drawn"] += 1; stats[b]["points"] += 1
        arr = list(stats.values())
        arr.sort(key=lambda s: (s["points"], s["score_for"] - s["score_against"]), reverse=True)
        for i, s in enumerate(arr):
            s["rank"] = i + 1
        result.append({"group": g, "standings": arr})
    return result
