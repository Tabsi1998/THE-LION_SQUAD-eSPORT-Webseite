"""Standings projections over canonical competition matches."""

from __future__ import annotations

from services.match_winner import won_by
from services.round_labels import section_kind


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


def _sole_winner(match: dict) -> str | None:
    """The single winner, or nothing when the match ended level.

    The graph engine expresses a draw as two participants sharing rank 1, so
    picking the first winner it finds would silently turn every draw into a win.
    """
    winners = [
        result.get("registration_id")
        for result in match.get("results") or []
        if result.get("outcome") == "winner"
    ]
    return winners[0] if len(winners) == 1 else None


def _duel_entries(match: dict) -> tuple[dict | None, dict | None, dict | None, dict | None]:
    slots = sorted(match.get("slots") or [], key=lambda slot: _safe_int(slot.get("position"), 999))
    slot_a = slots[0] if slots else None
    slot_b = slots[1] if len(slots) > 1 else None
    results = {row.get("registration_id"): row for row in match.get("results") or []}
    result_a = results.get((slot_a or {}).get("registration_id"))
    result_b = results.get((slot_b or {}).get("registration_id"))
    return slot_a, slot_b, result_a, result_b


def _section_kind(match: dict) -> str:
    return section_kind(match.get("section"))


def decided_places(matches: list[dict]) -> dict[str, int]:
    """Welche Plätze der Baum selbst schon vergeben hat (#1549): das entscheidende Spiel schlägt jede Zählung.

    Grand Final (das letzte gespielte - ein nicht nötiger Reset zählt nicht) vergibt Platz 1 und 2, sonst das Finale
    der Siegerrunde; im Doppel-K.-o. ist der Sieger der Verliererrunde Zweiter, wenn es kein Grand Final gibt, und
    ihr Finalverlierer Dritter. Ein Finale mit mehreren Plätzen (FFA) vergibt alle seine Plätze, das Spiel um Platz 3
    die Plätze 3 und 4. Nur die letzte Phase zählt."""
    decided = [match for match in matches if match.get("status") in TERMINAL_MATCH_STATUSES and match.get("results")]
    if not decided:
        return {}
    last_stage = max(_safe_int(match.get("stage_number")) for match in decided)
    decided = [match for match in decided if _safe_int(match.get("stage_number")) == last_stage]
    by_kind: dict[str, list[dict]] = {}
    for match in decided:
        by_kind.setdefault(_section_kind(match), []).append(match)
    # Nur das Loser Bracket derselben Phase zählt - eines aus einer Vorrunde ändert nichts am Finale danach.
    has_loser_bracket = any(
        _section_kind(match) == "loser" and _safe_int(match.get("stage_number")) == last_stage for match in matches
    )

    def last_of(kind: str) -> dict | None:
        rows = by_kind.get(kind) or []
        if not rows:
            return None
        top_round = max(_safe_int(row.get("round")) for row in rows)
        final_round = [row for row in rows if _safe_int(row.get("round")) == top_round]
        return final_round[0] if len(final_round) == 1 else None

    def ranked(match: dict | None) -> list[str]:
        rows = sorted((row for row in (match or {}).get("results") or [] if row.get("registration_id")),
                      key=lambda row: _safe_int(row.get("rank"), 999))
        return [row["registration_id"] for row in rows]

    places: dict[str, int] = {}

    def place(registration_id: str | None, rank: int) -> None:
        if registration_id and registration_id not in places and rank not in places.values():
            places[registration_id] = rank

    grand_final = ranked(last_of("grand_final"))
    main_final = ranked(last_of("main"))
    loser_final = ranked(last_of("loser"))
    if grand_final:
        for index, registration_id in enumerate(grand_final[:2], start=1):
            place(registration_id, index)
    elif has_loser_bracket:
        place(main_final[0] if main_final else None, 1)
        place(loser_final[0] if loser_final else None, 2)
    else:
        for index, registration_id in enumerate(main_final, start=1):
            place(registration_id, index)
    if has_loser_bracket and len(loser_final) > 1:
        place(loser_final[1], 3)
    for index, registration_id in enumerate(ranked(last_of("bronze"))[:2], start=3):
        place(registration_id, index)
    return places


def stage_standings(matches: list[dict], registrations: list[dict]) -> list[dict]:
    places = decided_places(matches)
    rank_map = {
        registration["id"]: {
            "registration_id": registration["id"],
            # Team-Kennung wie in der öffentlichen Anmeldung (#1593): „mit deinem Team“ auch im K.-o.
            "team_id": registration.get("team_id"),
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
            # Vom Baum vergebene Plätze zuerst (Platz 1 vor Platz 2), dann die Zählung.
            -places.get(row["registration_id"], 10_000),
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
            "team_id": registration.get("team_id"),
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


def _round_robin_rows(matches: list[dict], registrations: list[dict]) -> list[dict]:
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
        if match.get("status") not in TERMINAL_MATCH_STATUSES:
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
        winner_id = _sole_winner(match)
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
    for row in rows:
        row["score_diff"] = row["score_for"] - row["score_against"]
    _rank_with_ties(rows, lambda row: (row["points"], row["won"], row["score_diff"]))
    return rows


def round_robin_standings(matches: list[dict], registrations: list[dict]) -> list[dict]:
    """Liga, Round Robin und jede Gruppe: Punkte, Differenz, Form und Bewegung seit dem letzten Spieltag."""
    return _with_form_and_movement(_round_robin_rows, matches, registrations)


def swiss_standings(matches: list[dict], registrations: list[dict]) -> list[dict]:
    return _with_form_and_movement(_swiss_rows, matches, registrations)


def _rank_with_ties(rows: list[dict], key) -> None:
    """Wettbewerbsrang (#1593): wer in jedem Kriterium gleich steht, teilt den Platz - 1, 2, 2, 4.

    Sonst hinge der Platz an der Reihenfolge der Anmeldungen, und Podest und Pfeile wären zufällig.
    """
    rows.sort(key=key, reverse=True)
    previous = None
    for index, row in enumerate(rows, start=1):
        value = key(row)
        if value != previous:
            rank = index
            previous = value
        row["rank"] = rank


FORM_LENGTH = 5


def _played_in_order(matches: list[dict]) -> list[dict]:
    terminal = [match for match in matches if match.get("status") in TERMINAL_MATCH_STATUSES]
    return sorted(terminal, key=lambda match: (_safe_int(match.get("round")), _safe_int(match.get("order"))))


def _form(matches: list[dict]) -> dict[str, list[str]]:
    """Die letzten Spiele je Anmeldung als „W“ (Sieg), „D“ (Unentschieden), „L“ (Niederlage) - das jüngste rechts.

    Ein Freilos zählt wie in der Tabelle als Sieg.
    """
    form: dict[str, list[str]] = {}
    for match in _played_in_order(matches):
        slot_a, slot_b, _result_a, _result_b = _duel_entries(match)
        registration_a = (slot_a or {}).get("registration_id")
        registration_b = (slot_b or {}).get("registration_id")
        if registration_a and registration_b is None:
            form.setdefault(registration_a, []).append("W")
            continue
        winner_id = _sole_winner(match)
        for registration_id in (registration_a, registration_b):
            if not registration_id:
                continue
            letter = "D" if winner_id is None else "W" if winner_id == registration_id else "L"
            form.setdefault(registration_id, []).append(letter)
    return {registration_id: letters[-FORM_LENGTH:] for registration_id, letters in form.items()}


def _with_form_and_movement(compute, matches: list[dict], registrations: list[dict]) -> list[dict]:
    """Pfeile in der Tabelle (#1179): der Platz nach dem vorigen Spieltag, solange der jüngste läuft.

    Verglichen wird mit der Tabelle ohne den jüngsten Spieltag, an dem schon ein Ergebnis steht. Gibt es davor keinen
    gespielten Spieltag, bleibt ``previous_rank`` leer - dann zeigt niemand einen Pfeil.
    """
    rows = compute(matches, registrations)
    played_rounds = sorted({_safe_int(match.get("round")) for match in _played_in_order(matches)})
    previous: dict[str, int] = {}
    if len(played_rounds) > 1:
        latest = played_rounds[-1]
        earlier = [match for match in matches if _safe_int(match.get("round")) < latest]
        previous = {row["registration_id"]: row["rank"] for row in compute(earlier, registrations)}
    form = _form(matches)
    for row in rows:
        row["form"] = form.get(row["registration_id"], [])
        row["previous_rank"] = previous.get(row["registration_id"])
    return rows


def _swiss_rows(matches: list[dict], registrations: list[dict]) -> list[dict]:
    stats = {
        registration["id"]: {
            "registration_id": registration["id"],
            "user_id": registration.get("user_id"),
            "team_id": registration.get("team_id"),
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
        if match.get("status") not in TERMINAL_MATCH_STATUSES:
            continue
        slot_a, slot_b, _result_a, _result_b = _duel_entries(match)
        registration_a = (slot_a or {}).get("registration_id")
        registration_b = (slot_b or {}).get("registration_id")
        if registration_a in stats and registration_b is None:
            # Freilos: zaehlt als voller Punkt, aber gegen niemanden.
            stats[registration_a]["played"] += 1
            stats[registration_a]["won"] += 1
            stats[registration_a]["points"] += 1
            continue
        if registration_a not in stats or registration_b not in stats:
            continue
        stats[registration_a]["played"] += 1
        stats[registration_b]["played"] += 1
        stats[registration_a]["opponents"].append(registration_b)
        stats[registration_b]["opponents"].append(registration_a)
        winner_id = _sole_winner(match)
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
    _rank_with_ties(rows, lambda row: (row["points"], row["buchholz"], row["won"]))
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
    format_key = tournament.get("format")
    stage_matches = [match for match in matches if match.get("source", {}).get("engine") == "stage"]
    if stage_matches:
        # Der Speicher entscheidet nicht über die Tabelle: ein Schweizer Turnier
        # braucht Buchholz und ein Gruppenturnier seine Gruppentabellen, egal in
        # welcher Engine die Matches liegen.
        if format_key == "swiss":
            return swiss_standings(stage_matches, registrations)
        if format_key == "groups":
            return group_standings(stage_matches, registrations, list(groups))
        if format_key in {"round_robin", "league"}:
            return round_robin_standings(stage_matches, registrations)
        return stage_standings(stage_matches, registrations)
    legacy_matches = [match for match in matches if match.get("source", {}).get("engine") == "legacy"]
    if format_key in {"round_robin", "league"}:
        return round_robin_standings(legacy_matches, registrations)
    if format_key == "swiss":
        return swiss_standings(legacy_matches, registrations)
    if format_key == "groups":
        return group_standings(legacy_matches, registrations, list(groups))
    return elimination_standings(legacy_matches, registrations)


def _section_key(value) -> str:
    return str(value or "").strip().lower()


def placements_for_structure(
    snapshot: dict,
    registrations: list[dict],
    *,
    sections: set[str] | None = None,
    tournament: dict | None = None,
) -> dict[int, list[dict]]:
    """Resolve prize/season placements through the canonical read contract.

    Explicit legacy ``final_position`` values remain authoritative for historical
    tournaments.  If none exist, Stage/FFA results use the shared standings
    projection.  This preserves the old fallback behaviour while giving every
    downstream consumer one engine-independent entry point.

    Ein Platz kann geteilt sein (#1593): Liga, Jeder gegen jeden und Schweizer System (über ``tournament``) nehmen ihre
    Tabelle mit Gleichstand - zwei Erste stehen beide auf Platz 1, der nächste ist 3. Darum je Platz eine Liste.
    """

    registration_map = {
        registration["id"]: registration
        for registration in registrations
        if registration.get("id")
    }
    wanted_sections = {
        _section_key(section)
        for section in sections or set()
        if section
    }

    def wanted(match: dict) -> bool:
        return not wanted_sections or _section_key(match.get("section")) in wanted_sections

    legacy_matches = [
        match
        for match in snapshot.get("matches") or []
        if match.get("source", {}).get("engine") == "legacy" and wanted(match)
    ]
    placements: dict[int, list[dict]] = {}
    placed_registration_ids: set[str] = set()
    for match in legacy_matches:
        registration_id = next(
            (
                result.get("registration_id")
                for result in match.get("results") or []
                if result.get("outcome") == "winner"
            ),
            None,
        )
        rank = _safe_int(match.get("final_position"))
        registration = registration_map.get(registration_id)
        if (
            not registration_id
            or not rank
            or not registration
            or rank in placements
            or registration_id in placed_registration_ids
        ):
            continue
        placements[rank] = [{
            "registration_id": registration_id,
            "user_id": registration.get("user_id"),
            "team_id": registration.get("team_id"),
        }]
        placed_registration_ids.add(registration_id)
    if placements:
        return placements

    stage_matches = [
        match
        for match in snapshot.get("matches") or []
        if match.get("source", {}).get("engine") == "stage" and wanted(match)
    ]
    format_key = (tournament or {}).get("format")
    if not wanted_sections and format_key in {"round_robin", "league"}:
        rows = round_robin_standings(stage_matches, registrations)
    elif not wanted_sections and format_key == "swiss":
        rows = swiss_standings(stage_matches, registrations)
    else:
        rows = stage_standings(stage_matches, registrations)
    for row in rows:
        registration_id = row.get("registration_id")
        rank = _safe_int(row.get("rank"))
        registration = registration_map.get(registration_id)
        if not registration_id or not rank or not row.get("played") or not registration:
            continue
        placements.setdefault(rank, []).append({
            "registration_id": registration_id,
            "user_id": registration.get("user_id"),
            "team_id": registration.get("team_id"),
        })
    return placements


def placement_rows_for_structure(snapshot: dict, registrations: list[dict], *, tournament: dict | None = None) -> list[dict]:
    """Return ordered placement rows suitable for season-point awards - a shared place appears once per holder."""

    return [
        {**placement, "rank": rank}
        for rank, group in sorted(placements_for_structure(snapshot, registrations, tournament=tournament).items())
        for placement in group
    ]


def registration_badge_match_progress(matches: list[dict], registration_ids: set[str]) -> dict:
    """Return completed-match badge counters over canonical match shapes."""

    relevant = []
    for match in matches:
        if match.get("status") != "completed":
            continue
        participants = {
            slot.get("registration_id")
            for slot in match.get("slots") or []
            if slot.get("registration_id")
        } | {
            result.get("registration_id")
            for result in match.get("results") or []
            if result.get("registration_id")
        }
        if participants.intersection(registration_ids):
            relevant.append(match)
    relevant.sort(key=lambda match: (
        str(match.get("updated_at") or match.get("scheduled_at") or ""),
        _safe_int(match.get("stage_number")),
        _safe_int(match.get("round")),
        _safe_int(match.get("order")),
        str(match.get("id") or ""),
    ))

    won = 0
    streak = 0
    streak_max = 0
    for match in relevant:
        # Dieselbe Regel wie alle Sieg-Erfolge (#1796): ein Unentschieden (zwei Mal Platz 1) und ein Freilos sind
        # kein Sieg - der Turnierbaum schreibt beides als „winner“.
        if won_by(match, registration_ids):
            won += 1
            streak += 1
            streak_max = max(streak_max, streak)
        else:
            streak = 0
    return {
        "matches_played": len(relevant),
        "matches_won": won,
        "match_streak_max": streak_max,
    }


def registration_tournament_achievement_progress(
    snapshot: dict,
    registrations: list[dict],
    registration_ids: set[str],
    *,
    tournament: dict | None = None,
) -> dict:
    """Return one tournament's win/podium/fourth-place badge flags."""

    ranks = {
        rank
        for rank, group in placements_for_structure(snapshot, registrations, tournament=tournament).items()
        for placement in group
        if placement.get("registration_id") in registration_ids
    }
    legacy_fourth = any(
        _safe_int(match.get("final_position")) == 4
        and any(
            result.get("registration_id") in registration_ids
            and result.get("outcome") == "loser"
            for result in match.get("results") or []
        )
        for match in snapshot.get("matches") or []
        if match.get("source", {}).get("engine") == "legacy"
    )
    return {
        "tournaments_won": int(1 in ranks),
        "podium_finishes": int(any(1 <= rank <= 3 for rank in ranks)),
        "rank_4_count": int(4 in ranks or legacy_fourth),
    }


def registration_match_summary(matches: list[dict], registration_ids: set[str]) -> dict:
    """Count terminal matches and wins once across canonical match shapes."""

    played = 0
    won = 0
    for match in matches:
        if match.get("status") not in TERMINAL_MATCH_STATUSES:
            continue
        participants = {
            slot.get("registration_id")
            for slot in match.get("slots") or []
            if slot.get("registration_id")
        }
        if not participants.intersection(registration_ids):
            continue
        played += 1
        if any(
            result.get("registration_id") in registration_ids
            and result.get("outcome") == "winner"
            for result in match.get("results") or []
        ):
            won += 1
    return {"matches_played": played, "matches_won": won}
