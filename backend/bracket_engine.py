"""Bracket generation engine. Generates matches list given registrations + format."""
import math
import random
from typing import List, Dict, Any, Optional
from models import new_id, now_utc


def _participant_list(registrations: List[dict], seeding_mode: str = "random") -> List[dict]:
    regs = [r for r in registrations if r.get("status") in ("approved", "checked_in")]
    if seeding_mode == "manual":
        regs.sort(key=lambda r: r.get("seed") or 99999)
    elif seeding_mode == "random":
        random.shuffle(regs)
    # ranking mode uses pre-set seed from admin (already handled)
    return regs


def _next_power_of_two(n: int) -> int:
    return 1 if n <= 1 else 2 ** math.ceil(math.log2(n))


def _seed_positions(size: int) -> List[int]:
    """Standard tournament bracket seeding order for `size` (power of 2)."""
    if size == 1:
        return [1]
    prev = _seed_positions(size // 2)
    result = []
    for s in prev:
        result.append(s)
        result.append(size + 1 - s)
    return result


def _make_match(tournament_id: str, round_num: int, round_name: str, bracket: str,
                match_index: int, best_of: int = 1,
                p_a: Optional[str] = None, p_b: Optional[str] = None,
                next_match_id: Optional[str] = None, next_slot: Optional[str] = None,
                next_loser_match_id: Optional[str] = None, next_loser_slot: Optional[str] = None) -> dict:
    return {
        "id": new_id(),
        "tournament_id": tournament_id,
        "round": round_num,
        "round_name": round_name,
        "bracket": bracket,
        "match_index": match_index,
        "participant_a_id": p_a,
        "participant_b_id": p_b,
        "score_a": 0,
        "score_b": 0,
        "winner_id": None,
        "loser_id": None,
        "status": "pending",
        "scheduled_at": None,
        "station_id": None,
        "best_of": best_of,
        "map": None,
        "next_match_id": next_match_id,
        "next_match_slot": next_slot,
        "next_loser_match_id": next_loser_match_id,
        "next_loser_slot": next_loser_slot,
        "reports": [],
        "disputes": [],
        "admin_note": None,
        "created_at": now_utc().isoformat(),
        "updated_at": now_utc().isoformat(),
    }


def generate_single_elimination(tournament_id: str, registrations: List[dict],
                                 best_of: int = 1, bronze_match: bool = False,
                                 seeding_mode: str = "random") -> List[dict]:
    regs = _participant_list(registrations, seeding_mode)
    n = len(regs)
    if n < 2:
        return []
    bracket_size = _next_power_of_two(n)
    positions = _seed_positions(bracket_size)  # 1-indexed seed at each slot
    # Pad with None byes
    slotted: List[Optional[str]] = []
    for seed in positions:
        idx = seed - 1
        slotted.append(regs[idx]["id"] if idx < n else None)

    rounds = int(math.log2(bracket_size))
    # Generate from round 1 bottom-up. Build all rounds first with IDs so we can link.
    round_matches: List[List[dict]] = []
    for r in range(rounds):
        cnt = bracket_size // (2 ** (r + 1))
        round_name = _round_name(r, rounds)
        ms = []
        for i in range(cnt):
            ms.append(_make_match(tournament_id, r + 1, round_name, "winner", i, best_of=best_of))
        round_matches.append(ms)

    # Link round r match -> round r+1
    for r in range(rounds - 1):
        for i, m in enumerate(round_matches[r]):
            parent = round_matches[r + 1][i // 2]
            m["next_match_id"] = parent["id"]
            m["next_match_slot"] = "a" if i % 2 == 0 else "b"

    # Fill round 1 participants
    for i, m in enumerate(round_matches[0]):
        m["participant_a_id"] = slotted[2 * i]
        m["participant_b_id"] = slotted[2 * i + 1]
        # Auto-advance byes
        if m["participant_a_id"] and not m["participant_b_id"]:
            m["winner_id"] = m["participant_a_id"]
            m["status"] = "completed"
            m["score_a"] = 1
            _propagate_winner(m, round_matches)
        elif m["participant_b_id"] and not m["participant_a_id"]:
            m["winner_id"] = m["participant_b_id"]
            m["status"] = "completed"
            m["score_b"] = 1
            _propagate_winner(m, round_matches)
        elif m["participant_a_id"] and m["participant_b_id"]:
            m["status"] = "ready"

    all_matches = [m for rm in round_matches for m in rm]

    # Bronze match (3rd place) - losers of semis
    if bronze_match and rounds >= 2:
        bronze = _make_match(tournament_id, rounds, "Bronze Match", "bronze", 0, best_of=best_of)
        all_matches.append(bronze)

    return all_matches


def _round_name(r: int, total: int) -> str:
    remaining = total - r
    if remaining == 1:
        return "Finale"
    if remaining == 2:
        return "Halbfinale"
    if remaining == 3:
        return "Viertelfinale"
    if remaining == 4:
        return "Achtelfinale"
    if remaining == 5:
        return "Sechzehntelfinale"
    return f"Runde {r + 1}"


def _propagate_winner(match: dict, round_matches: List[List[dict]]):
    """Advance winner to next match if this match has a byewinner."""
    nmi = match.get("next_match_id")
    if not nmi:
        return
    for rm in round_matches:
        for m in rm:
            if m["id"] == nmi:
                slot = match["next_match_slot"]
                if slot == "a":
                    m["participant_a_id"] = match["winner_id"]
                else:
                    m["participant_b_id"] = match["winner_id"]
                if m["participant_a_id"] and m["participant_b_id"]:
                    m["status"] = "ready"
                elif m["participant_a_id"] and not m["participant_b_id"]:
                    # Another bye
                    m["winner_id"] = m["participant_a_id"]
                    m["status"] = "completed"
                    m["score_a"] = 1
                    _propagate_winner(m, round_matches)
                elif m["participant_b_id"] and not m["participant_a_id"]:
                    m["winner_id"] = m["participant_b_id"]
                    m["status"] = "completed"
                    m["score_b"] = 1
                    _propagate_winner(m, round_matches)
                return


def generate_double_elimination(tournament_id: str, registrations: List[dict],
                                 best_of: int = 1, seeding_mode: str = "random") -> List[dict]:
    """Simplified double elim: generate WB as single elim, LB and Grand Final as 'pending'."""
    regs = _participant_list(registrations, seeding_mode)
    n = len(regs)
    if n < 2:
        return []
    # Winner Bracket
    wb = generate_single_elimination(tournament_id, registrations, best_of=best_of,
                                      bronze_match=False, seeding_mode=seeding_mode)
    for m in wb:
        m["bracket"] = "winner"
    bracket_size = _next_power_of_two(n)
    wb_rounds = int(math.log2(bracket_size))

    # Loser Bracket: 2 * (wb_rounds - 1) rounds approximately
    lb_rounds_count = max(1, 2 * (wb_rounds - 1))
    lb_matches: List[List[dict]] = []
    # First LB round takes losers of WB round 1 - size = bracket_size / 4 (pairs)
    # Simplified: create placeholder rounds with correct match count
    sizes = []
    cur = bracket_size // 2 // 2  # losers from R1 paired
    if cur < 1:
        cur = 1
    for r in range(lb_rounds_count):
        sizes.append(max(1, cur))
        if r % 2 == 1:
            cur = max(1, cur // 2)
    lb_all = []
    for r, sz in enumerate(sizes):
        row = []
        for i in range(sz):
            m = _make_match(tournament_id, r + 1, f"LB Runde {r + 1}", "loser", i, best_of=best_of)
            row.append(m)
            lb_all.append(m)
        lb_matches.append(row)

    # Grand final (2 matches with potential reset)
    gf1 = _make_match(tournament_id, wb_rounds + 1, "Grand Final", "grand_final", 0, best_of=best_of)
    gf2 = _make_match(tournament_id, wb_rounds + 2, "Grand Final Reset", "grand_final", 1, best_of=best_of)

    return wb + lb_all + [gf1, gf2]


def generate_round_robin(tournament_id: str, registrations: List[dict],
                         best_of: int = 1, double_round: bool = False) -> List[dict]:
    regs = _participant_list(registrations, "manual")
    n = len(regs)
    if n < 2:
        return []
    # Circle method
    players = [r["id"] for r in regs]
    if n % 2 == 1:
        players.append(None)  # bye
        n += 1
    rounds_count = n - 1
    half = n // 2
    matches = []
    arr = players[:]
    match_index = 0
    for round_num in range(rounds_count):
        for i in range(half):
            a = arr[i]
            b = arr[n - 1 - i]
            if a is None or b is None:
                continue
            m = _make_match(tournament_id, round_num + 1, f"Spieltag {round_num + 1}",
                            "round_robin", match_index, best_of=best_of, p_a=a, p_b=b)
            m["status"] = "ready"
            matches.append(m)
            match_index += 1
        arr = [arr[0]] + [arr[-1]] + arr[1:-1]
    if double_round:
        # Second leg - swap home/away
        first_leg_count = len(matches)
        for i in range(first_leg_count):
            m_orig = matches[i]
            m = _make_match(tournament_id, m_orig["round"] + rounds_count,
                            f"Rückspiel {m_orig['round']}", "round_robin",
                            match_index, best_of=best_of,
                            p_a=m_orig["participant_b_id"], p_b=m_orig["participant_a_id"])
            m["status"] = "ready"
            matches.append(m)
            match_index += 1
    return matches


def generate_bracket(tournament: dict, registrations: List[dict]) -> List[dict]:
    fmt = tournament.get("format", "single_elim")
    best_of = tournament.get("best_of", 1)
    bronze = tournament.get("bronze_match", False)
    seeding = tournament.get("seeding_mode", "random")
    tid = tournament["id"]
    if fmt == "single_elim":
        return generate_single_elimination(tid, registrations, best_of, bronze, seeding)
    if fmt == "double_elim":
        return generate_double_elimination(tid, registrations, best_of, seeding)
    if fmt == "round_robin":
        return generate_round_robin(tid, registrations, best_of, False)
    if fmt == "league":
        return generate_round_robin(tid, registrations, best_of, True)
    # For other formats (swiss, groups, ffa, battle_royale, time_trial, grand_prix) we don't
    # auto-generate matches. time_trial / grand_prix flow via F1 lap times.
    return []


def advance_match_winner(match: dict, all_matches: List[dict]) -> List[dict]:
    """Given a completed match, propagate winner to next_match. Returns list of matches to update."""
    updated = []
    nmi = match.get("next_match_id")
    winner_id = match.get("winner_id")
    loser_id = match.get("loser_id")
    if nmi and winner_id:
        nxt = next((m for m in all_matches if m["id"] == nmi), None)
        if nxt:
            slot = match.get("next_match_slot", "a")
            if slot == "a":
                nxt["participant_a_id"] = winner_id
            else:
                nxt["participant_b_id"] = winner_id
            if nxt["participant_a_id"] and nxt["participant_b_id"]:
                nxt["status"] = "ready"
            nxt["updated_at"] = now_utc().isoformat()
            updated.append(nxt)
    nlmi = match.get("next_loser_match_id")
    if nlmi and loser_id:
        nxt = next((m for m in all_matches if m["id"] == nlmi), None)
        if nxt:
            slot = match.get("next_loser_slot", "a")
            if slot == "a":
                nxt["participant_a_id"] = loser_id
            else:
                nxt["participant_b_id"] = loser_id
            if nxt["participant_a_id"] and nxt["participant_b_id"]:
                nxt["status"] = "ready"
            nxt["updated_at"] = now_utc().isoformat()
            updated.append(nxt)
    return updated


def compute_round_robin_standings(matches: List[dict], registrations: List[dict]) -> List[dict]:
    """Compute standings for round robin / league format."""
    stats: Dict[str, Dict[str, Any]] = {}
    for r in registrations:
        stats[r["id"]] = {
            "registration_id": r["id"],
            "user_id": r.get("user_id"),
            "team_id": r.get("team_id"),
            "display_name": r.get("display_name") or r.get("ingame_name") or "—",
            "played": 0, "won": 0, "lost": 0, "drawn": 0,
            "score_for": 0, "score_against": 0, "points": 0,
        }
    for m in matches:
        if m.get("status") != "completed":
            continue
        a = m.get("participant_a_id")
        b = m.get("participant_b_id")
        sa = m.get("score_a", 0)
        sb = m.get("score_b", 0)
        if a in stats:
            stats[a]["played"] += 1
            stats[a]["score_for"] += sa
            stats[a]["score_against"] += sb
        if b in stats:
            stats[b]["played"] += 1
            stats[b]["score_for"] += sb
            stats[b]["score_against"] += sa
        w = m.get("winner_id")
        if w == a and a in stats:
            stats[a]["won"] += 1
            stats[a]["points"] += 3
            if b in stats:
                stats[b]["lost"] += 1
        elif w == b and b in stats:
            stats[b]["won"] += 1
            stats[b]["points"] += 3
            if a in stats:
                stats[a]["lost"] += 1
        else:  # draw
            if a in stats:
                stats[a]["drawn"] += 1
                stats[a]["points"] += 1
            if b in stats:
                stats[b]["drawn"] += 1
                stats[b]["points"] += 1
    arr = list(stats.values())
    arr.sort(key=lambda s: (s["points"], s["won"], s["score_for"] - s["score_against"]), reverse=True)
    for i, s in enumerate(arr):
        s["rank"] = i + 1
    return arr
