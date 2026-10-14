"""Swiss pairing for the graph engine.

Swiss is the one format that cannot be written down in advance. Who meets whom
in round three depends on what happened in rounds one and two, so unlike a
bracket it has no declarative schema - each round is computed when the previous
one is finished.

The pairing rules are the familiar ones: similar scores meet, nobody plays the
same opponent twice while an alternative exists, and with an odd number of
participants one gets a bye. Everything here is pure computation on plain
dicts so it can be checked without a database.
"""
from __future__ import annotations

import random
import uuid
from datetime import datetime, timezone


WIN_POINTS = 1.0
DRAW_POINTS = 0.5
DECIDED_STATUSES = {"completed", "forfeit"}
SETTLED_STATUSES = DECIDED_STATUSES | {"cancelled"}


def _filled(match: dict) -> list[str]:
    return [slot["registration_id"] for slot in (match.get("slots") or []) if slot.get("registration_id")]


def scores_and_history(participants: list[str], matches: list[dict]) -> tuple[dict[str, float], dict[str, set]]:
    """Points so far and who already played whom.

    Only decided matches count. A pending round must not influence the next
    pairing, otherwise a half-entered round would scramble the field.
    """
    scores: dict[str, float] = {item: 0.0 for item in participants}
    opponents: dict[str, set] = {item: set() for item in participants}

    for match in matches:
        if match.get("status") not in DECIDED_STATUSES:
            continue
        present = _filled(match)
        if len(present) == 1:
            # Freilos: volle Punktzahl, aber kein Gegner in der Historie.
            if present[0] in scores:
                scores[present[0]] += WIN_POINTS
            continue
        taking_part = [item for item in present if item in scores]
        if len(taking_part) < 2:
            continue
        for item in taking_part:
            opponents[item].update(other for other in taking_part if other != item)

        results = match.get("results") or []
        ranked = sorted(
            (entry for entry in results if entry.get("registration_id") in scores),
            key=lambda entry: entry.get("rank") or 999,
        )
        if not ranked:
            continue
        best_rank = ranked[0].get("rank")
        winners = [entry for entry in ranked if entry.get("rank") == best_rank]
        points = WIN_POINTS if len(winners) == 1 else DRAW_POINTS
        for entry in winners:
            scores[entry["registration_id"]] += points
    return scores, opponents


def bye_history(matches: list[dict]) -> set[str]:
    """Who already sat a round out. Nobody should sit out twice."""
    seated: set[str] = set()
    for match in matches:
        present = _filled(match)
        if len(present) == 1:
            seated.add(present[0])
    return seated


def _ordered_by_score(scores: dict[str, float], rng: random.Random) -> list[str]:
    buckets: dict[float, list[str]] = {}
    for participant, score in scores.items():
        buckets.setdefault(score, []).append(participant)
    ordered: list[str] = []
    for score in sorted(buckets, reverse=True):
        bucket = sorted(buckets[score])
        rng.shuffle(bucket)
        ordered.extend(bucket)
    return ordered


def swiss_pairings(
    participants: list[str],
    matches: list[dict],
    *,
    seed: int | None = None,
) -> tuple[list[tuple[str, str]], str | None]:
    """Pair the next round. Returns the pairs and whoever gets a bye.

    Pairing walks the field from the top and takes the closest opponent that
    has not been faced yet. Only when every remaining candidate has already
    been played does it allow a rematch - refusing to pair at all would stall
    the tournament, which is worse than a repeat.
    """
    field = [item for item in participants if item]
    if len(field) < 2:
        return [], field[0] if field else None

    rng = random.Random(seed)
    scores, opponents = scores_and_history(field, matches)
    ordered = _ordered_by_score(scores, rng)

    bye: str | None = None
    if len(ordered) % 2 == 1:
        # Von hinten aufgerollt: das Freilos geht an den Letzten, der noch keines
        # hatte. Zweimal aussetzen wäre ein Vorteil, den niemand verdient hat.
        seated = bye_history(matches)
        bye = next((item for item in reversed(ordered) if item not in seated), ordered[-1])
        ordered = [item for item in ordered if item != bye]

    pairs: list[tuple[str, str]] = []
    used: set[str] = set()
    for index, player in enumerate(ordered):
        if player in used:
            continue
        partner = next(
            (other for other in ordered[index + 1:]
             if other not in used and other not in opponents[player]),
            None,
        )
        if partner is None:
            partner = next((other for other in ordered[index + 1:] if other not in used), None)
        if partner is None:
            break
        used.add(player)
        used.add(partner)
        pairs.append((player, partner))
    return pairs, bye


def next_round_number(matches: list[dict]) -> int:
    rounds = [int(match.get("round") or 0) for match in matches]
    return (max(rounds) if rounds else 0) + 1


def round_is_complete(matches: list[dict], round_number: int) -> bool:
    """A new round may only start once the current one is fully decided."""
    return not open_matches(matches, round_number)


def open_matches(matches: list[dict], round_number: int) -> list[dict]:
    """Matches of one round that are neither decided nor called off."""
    return [
        match for match in matches
        if int(match.get("round") or 0) == round_number
        and match.get("status") not in SETTLED_STATUSES
    ]


def swiss_round_documents(
    tournament: dict,
    stage: dict,
    registrations: list[dict],
    played: list[dict],
    *,
    round_number: int,
    seed: int | None = None,
) -> list[dict]:
    """Build one Swiss round as graph match documents.

    The shape matches what the schema builder produces for every other format,
    so the read model, the standings and the result flows treat a Swiss match
    like any other. A bye is written as a decided match with a single
    participant rather than being dropped, which is how it earns its point.
    """
    by_id = {registration["id"]: registration for registration in registrations if registration.get("id")}
    pairs, bye = swiss_pairings(list(by_id), played, seed=seed)
    if not pairs and not bye:
        return []

    settings = stage.get("settings") or {}
    now = datetime.now(timezone.utc).isoformat()
    round_name = f"Swiss Runde {round_number}"

    def slot(index: int, registration_id: str | None) -> dict:
        registration = by_id.get(registration_id or "") or {}
        return {
            "slot": index,
            "source": {"type": "direct", "raw": "swiss"},
            "registration_id": registration.get("id"),
            "user_id": registration.get("user_id"),
            "seed": registration.get("seed"),
            "status": "filled" if registration else "bye",
        }

    documents: list[dict] = []
    entries: list[tuple[list[dict], bool]] = [
        ([slot(1, left), slot(2, right)], False) for left, right in pairs
    ]
    if bye:
        entries.append(([slot(1, bye), slot(2, None)], True))

    for order, (slots, is_bye) in enumerate(entries, start=1):
        document = {
            "id": str(uuid.uuid4()),
            "tournament_id": tournament["id"],
            "stage_id": stage["id"],
            "stage_number": stage.get("number"),
            "stage_type": "swiss",
            "match_type": "duel",
            "match_key": f"S{round_number}-{order}",
            "section": "swiss",
            "round": round_number,
            "round_name": round_name,
            "order": order,
            "slots": slots,
            "results": [],
            "advancement": [],
            "settings": {
                "min_players": 2,
                "match_size": 2,
                "qualifiers_per_match": 1,
                "score_type": settings.get("score_type") or "points",
                "calculation": settings.get("calculation") or "points",
                "randomize_advancement_rounds": False,
            },
            "status": "ready",
            "is_preview": False,
            "generation_mode": "swiss_pairing",
            "scheduled_at": None,
            "station_id": None,
            "created_at": now,
            "updated_at": now,
        }
        if is_bye:
            document["status"] = "completed"
            document["results"] = [{
                "registration_id": bye,
                "user_id": (by_id.get(bye) or {}).get("user_id"),
                "slot": 1,
                "rank": 1,
                "score": None,
                "points": None,
                "time_ms": None,
                "dnf": False,
                "forfeit": False,
                "note": "Freilos in dieser Runde",
                "reported_by": "system",
                "reported_at": now,
            }]
            document["result_meta"] = {"source": "swiss_bye", "updated_at": now}
        documents.append(document)
    return documents
