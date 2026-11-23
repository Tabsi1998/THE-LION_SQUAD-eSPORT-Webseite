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

import hashlib
import math
import random
import uuid
from datetime import datetime, timezone


WIN_POINTS = 1.0
DRAW_POINTS = 0.5
DECIDED_STATUSES = {"completed", "forfeit"}
SETTLED_STATUSES = DECIDED_STATUSES | {"cancelled"}

# ---------------------------------------------------------------- Einstellungen (#1559)
# ``tournament.swiss_settings`` - alles Vorgaben der Turnierleitung. Ohne das Feld läuft ein Schweizer Turnier wie
# bisher: Runden von Hand, kein festes Ende, Reihenfolge Punkte, Buchholz, Siege.
#
# - ``end_rule``: ``manual`` (kein festes Ende), ``rounds`` (nach ``rounds`` Runden ist Schluss, die besten ``top_n``
#   kommen weiter) oder ``wins_losses`` (wer ``wins_to_advance`` Siege hat, ist weiter; wer ``losses_to_exit``
#   Niederlagen hat, ist raus - beide spielen nicht mehr mit).
# - ``auto_next_round``: die nächste Runde entsteht, sobald das letzte Spiel der laufenden gewertet ist.
# - ``tiebreakers``: Reihenfolge bei Punktgleichheit, zuerst zählen immer die Punkte.
END_RULES = ("manual", "rounds", "wins_losses")
TIEBREAKERS = ("median_buchholz", "buchholz", "head_to_head", "wins")
LEGACY_TIEBREAKERS = ("buchholz", "wins")
DEFAULT_WINS_TO_ADVANCE = 3
DEFAULT_LOSSES_TO_EXIT = 3
MAX_ROUNDS = 30
MAX_RECORD = 20
MAX_TOP_N = 4096
# So viele Schritte verbessert die Paarung die einfache Regel, bevor sie das Beste bis dahin nimmt. Ein Schritt ist ein
# geprüfter Gegner; 60000 sind rund 30 ms. Felder bis etwa 32 Teilnehmer sind damit immer bewiesen die beste Runde.
PAIRING_BUDGET = 60000
# So viele Kandidaten für das Freilos werden durchprobiert, wenn die Runde sonst eine Wiederholung bräuchte.
BYE_TRIES = 8
_ROUND_NAMESPACE = uuid.UUID("6f0c1c5e-7a55-5b0e-9d1e-1559a0c0ffee")


def _whole(value, minimum: int, maximum: int) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        return None
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if minimum <= number <= maximum else None


def swiss_settings(tournament: dict | None) -> dict:
    """Die Schweizer Einstellungen eines Turniers, vollständig. Fehlt etwas oder ist es Unsinn, gilt die Vorgabe -
    ohne ``swiss_settings`` also der Stand von vor #1559."""
    raw = (tournament or {}).get("swiss_settings")
    raw = raw if isinstance(raw, dict) else {}
    tiebreakers = raw.get("tiebreakers")
    if isinstance(tiebreakers, (list, tuple)):
        chosen: list[str] = []
        for key in tiebreakers:
            if key in TIEBREAKERS and key not in chosen:
                chosen.append(key)
    else:
        chosen = list(LEGACY_TIEBREAKERS)
    return {
        "end_rule": raw.get("end_rule") if raw.get("end_rule") in END_RULES else "manual",
        "rounds": _whole(raw.get("rounds"), 1, MAX_ROUNDS),
        "top_n": _whole(raw.get("top_n"), 1, MAX_TOP_N),
        "wins_to_advance": _whole(raw.get("wins_to_advance"), 1, MAX_RECORD) or DEFAULT_WINS_TO_ADVANCE,
        "losses_to_exit": _whole(raw.get("losses_to_exit"), 1, MAX_RECORD) or DEFAULT_LOSSES_TO_EXIT,
        "auto_next_round": bool(raw.get("auto_next_round")),
        "tiebreakers": chosen,
    }


def recommended_rounds(participant_count: int) -> int:
    """So viele Runden braucht ein Feld, bis höchstens einer ungeschlagen ist: 8 ergibt 3, 9 bis 16 ergibt 4."""
    return max(1, math.ceil(math.log2(max(2, int(participant_count or 0)))))


def round_seed(stage_id: str | None, round_number: int) -> int:
    """Der Startwert der Auslosung einer Runde - aus Phase und Runde, damit dieselbe Runde immer gleich gepaart wird
    (auch nach „Runde zurücknehmen“)."""
    digest = hashlib.sha256(f"{stage_id or ''}:{int(round_number)}".encode("utf-8")).hexdigest()
    return int(digest[:16], 16)


def _filled(match: dict) -> list[str]:
    return [slot["registration_id"] for slot in (match.get("slots") or []) if slot.get("registration_id")]


def winner_ids(results: list[dict] | None) -> list[str]:
    """Wer ein Spiel gewonnen hat: alle auf dem besten Platz. Einer ist ein Sieg, mehrere sind ein Unentschieden, keiner
    heißt: noch kein Ergebnis. Es zählen alle Einträge des Spiels - auch von jemandem, der nicht mehr im Feld ist."""
    ranked = [entry for entry in results or [] if entry.get("registration_id")]
    if not ranked:
        return []
    best_rank = min(entry.get("rank") or 999 for entry in ranked)
    return [entry["registration_id"] for entry in ranked if (entry.get("rank") or 999) == best_rank]


def scores_and_history(participants: list[str], matches: list[dict]) -> tuple[dict[str, float], dict[str, set]]:
    """Points so far and who already played whom.

    Only decided matches count. A pending round must not influence the next
    pairing, otherwise a half-entered round would scramble the field.

    Für jeden aus ``participants`` zählt jedes entschiedene Spiel - auch gegen jemanden, der nicht (mehr) im Feld steht,
    weil er schon weiter, ausgeschieden oder abgemeldet ist (#1559). Sonst fehlten bei „Siege/Niederlagen“ genau die
    Siege gegen Ausgeschiedene, und ein 2-1 traf auf ein 1-2. Die Punkte sind damit dieselben wie in ``records``:
    Siege plus halbe Unentschieden.
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
        for item in present:
            if item in opponents:
                opponents[item].update(other for other in present if other != item)

        winners = winner_ids(match.get("results"))
        points = WIN_POINTS if len(winners) == 1 else DRAW_POINTS
        for winner in winners:
            if winner in scores:
                scores[winner] += points
    return scores, opponents


def records(participants: list[str], matches: list[dict]) -> dict[str, dict]:
    """Siege, Niederlagen, Unentschieden und Freilose je Teilnehmer - die Bilanz für „3 Siege weiter, 3 Niederlagen
    raus“. Ein Freilos zählt als Sieg. Wie in ``scores_and_history`` zählt jedes entschiedene Spiel, auch gegen
    jemanden, der inzwischen ausgeschieden ist."""
    out = {item: {"won": 0, "lost": 0, "drawn": 0, "byes": 0} for item in participants}
    for match in matches:
        if match.get("status") not in DECIDED_STATUSES:
            continue
        present = _filled(match)
        if len(present) == 1:
            if present[0] in out:
                out[present[0]]["won"] += 1
                out[present[0]]["byes"] += 1
            continue
        winners = winner_ids(match.get("results"))
        for entry in match.get("results") or []:
            row = out.get(entry.get("registration_id"))
            if row is None:
                continue
            if entry["registration_id"] in winners:
                row["won" if len(winners) == 1 else "drawn"] += 1
            else:
                row["lost"] += 1
    return out


def swiss_state(settings: dict, participants: list[str], matches: list[dict]) -> dict:
    """Wo das Schweizer System steht: gespielte Runden, ob die letzte noch läuft, wer weiter oder raus ist, wer noch
    gepaart wird - und ob Schluss ist (``complete``). ``settings``: ``swiss_settings(tournament)``."""
    field = [item for item in participants if item]
    rounds_played = max((int(match.get("round") or 0) for match in matches), default=0)
    round_open = bool(rounds_played and open_matches(matches, rounds_played))
    rule = settings.get("end_rule") or "manual"
    advanced: list[str] = []
    eliminated: list[str] = []
    active = list(field)
    rounds_total = None
    complete = False
    if rule == "rounds":
        rounds_total = settings.get("rounds") or recommended_rounds(len(field))
        complete = rounds_played >= rounds_total and not round_open
    elif rule == "wins_losses":
        record = records(field, matches)
        advanced = [item for item in field if record[item]["won"] >= settings["wins_to_advance"]]
        eliminated = [item for item in field
                      if item not in advanced and record[item]["lost"] >= settings["losses_to_exit"]]
        decided = set(advanced) | set(eliminated)
        active = [item for item in field if item not in decided]
        # Mit weniger als zwei Offenen gibt es keine Paarung mehr - eine einzelne Person bleibt ohne Entscheidung.
        complete = bool(rounds_played) and not round_open and len(active) < 2
    return {
        "end_rule": rule,
        "rounds_played": rounds_played,
        "rounds_total": rounds_total,
        "round_open": round_open,
        "complete": complete,
        "advanced": advanced,
        "eliminated": eliminated,
        "active": active,
    }


def complete_text(state: dict) -> str:
    """Warum es keine Runde mehr gibt - für die Turnierleitung, mit dem, was zu tun ist."""
    if state.get("end_rule") == "wins_losses":
        return ("Alle sind weiter oder ausgeschieden – das Schweizer System ist abgeschlossen. Andere Grenzen stellst du "
                "unter Bearbeiten → Struktur ein.")
    return (f"Alle {state.get('rounds_total')} Runden sind gespielt – das Schweizer System ist abgeschlossen. Mehr Runden "
            "stellst du unter Bearbeiten → Struktur ein.")


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


def _half_points(score) -> int:
    """Punkte in halben Schritten, als ganze Zahl - damit gleiche Punkte sicher gleich sind."""
    return int(round(2 * float(score or 0)))


def _best_pairs(ordered: list[str], opponents: dict[str, set], scores: dict[str, float] | None,
                budget: int) -> tuple[list[tuple[str, str]], int, bool]:
    """Die beste vollständige Paarung eines geraden Feldes: Paare, Zahl der Wiederholungen und ob sie bewiesen die
    beste ist (``False``: das Schrittbudget war vorher verbraucht).

    Was „beste“ heißt, in dieser Reihenfolge:

    1. so wenige Wiederholungen wie möglich,
    2. die Punkte in jedem Paar so nah beieinander wie möglich. Gezählt wird die Summe der quadrierten Abstände: Gleiche
       Punkte kosten nichts, also wird eine Punktgruppe erst in sich gepaart. Wer ausweichen muss, geht zur
       Nachbargruppe - zwei kleine Schritte sind besser als ein weiter, der Erste trifft nie auf den Letzten, nur weil
       beide in ihrer Gruppe übrig sind.

    Gesucht wird von oben: Der Beste ohne Gegner probiert die anderen der Reihe nach, erst die noch nie gespielten,
    dann die Wiederholungen. Der erste Durchlauf ist die einfache Regel und steht nach einem Gang durchs Feld. Danach
    wird jede Wahl zurückgenommen und die nächste versucht, solange sie noch besser werden kann als das Gefundene
    (Schranke ``rest``), und kein Stand wird zweimal durchsucht (``seen``). Steht eine Runde, die nach den Punkten gar
    nicht besser sein kann (``floor``), ist sofort Schluss. Ohne Rekursion, damit auch ein großes Feld nicht an der
    Aufruftiefe scheitert.
    """
    size = len(ordered)
    value = [_half_points((scores or {}).get(player)) for player in ordered]
    # Die Schranken brauchen absteigende Punkte; bei gleichen Punkten bleibt die übergebene Reihenfolge.
    rank = sorted(range(size), key=lambda index: -value[index])
    ordered = [ordered[index] for index in rank]
    value = [value[index] for index in rank]
    place = {player: index for index, player in enumerate(ordered)}

    group = [0] * size
    for index in range(1, size):
        group[index] = group[index - 1] + (value[index] != value[index - 1])
    groups = group[-1] + 1
    free = [0] * groups
    points = [0] * groups
    for index, number in enumerate(group):
        free[number] += 1
        points[number] = value[index]

    # Eine Zahl je Runde, die beide Ziele in ihrer Reihenfolge hält: Eine Wiederholung wiegt mehr als alle Abstände.
    widest = value[0] - value[-1]
    repeat = widest * widest * (size // 2) + 1

    def rest(start: int) -> int:
        """Was die noch Freien ab Gruppe ``start`` mindestens kosten - ohne Blick auf die Geschichte: Jede Gruppe paart
        sich in sich, wer übrig ist, trifft auf die nächste Gruppe, in der noch jemand frei ist."""
        total = 0
        carried = -1
        for number in range(start, groups):
            count = free[number]
            if not count:
                continue
            if carried >= 0:
                gap = points[carried] - points[number]
                total += gap * gap
                count -= 1
                carried = -1
            if count % 2:
                carried = number
        return total

    floor = rest(0)

    faced_at: list[set[int]] = []
    again: list[list[int]] = []
    for index, player in enumerate(ordered):
        met = {place[other] for other in opponents.get(player) or () if other in place}
        faced_at.append(met)
        again.append(sorted(other for other in met if other > index))

    used = [False] * size
    taken = 0
    partial = 0
    best_cost: int | None = None
    best: list[tuple[int, int]] = []
    seen: dict[int, int] = {}
    steps = 0
    proven = True

    # Ein Eintrag je Spieler, der gerade seinen Gegner sucht:
    # [Platz, Abschnitt (0 neu, 1 Wiederholung, 2 fertig), Zeiger, gewählter Gegner, Preis der Wahl]
    used[0] = True
    stack: list[list[int]] = [[0, 0, 1, -1, 0]]
    while stack:
        frame = stack[-1]
        index = frame[0]
        mine = group[index]
        if frame[3] >= 0:
            # Die vorige Wahl ist durchsucht: zurücknehmen.
            other = frame[3]
            used[other] = False
            taken ^= (1 << index) | (1 << other)
            free[mine] += 1
            free[group[other]] += 1
            partial -= frame[4]
            frame[3] = -1
        picked = -1
        cost = 0
        while frame[1] < 2:
            if frame[1] == 0:
                cursor = frame[2]
                met = faced_at[index]
                while cursor < size and (used[cursor] or cursor in met):
                    cursor += 1
                steps += cursor - frame[2]
                if cursor >= size:
                    frame[1], frame[2] = 1, 0
                    continue
                frame[2] = cursor + 1
                other = cursor
                cost = 0
            else:
                options = again[index]
                cursor = frame[2]
                while cursor < len(options) and used[options[cursor]]:
                    cursor += 1
                if cursor >= len(options):
                    frame[1] = 2
                    break
                frame[2] = cursor + 1
                other = options[cursor]
                cost = repeat
            gap = value[index] - value[other]
            cost += gap * gap
            if best_cost is not None:
                steps += 1
                if steps > budget:
                    proven = False
                    stack = []
                    break
                if partial + cost >= best_cost:
                    # Jeder weitere Gegner dieses Spielers ist mindestens so teuer: Der Abstand wächst nach unten, und
                    # eine Wiederholung wiegt mehr als jeder Abstand.
                    frame[1] = 2
                    break
                theirs = group[other]
                free[mine] -= 1
                free[theirs] -= 1
                remaining = rest(mine)
                free[mine] += 1
                free[theirs] += 1
                if partial + cost + remaining >= best_cost:
                    continue
                state = taken | (1 << index) | (1 << other)
                if seen.get(state, best_cost) <= partial + cost:
                    continue
                seen[state] = partial + cost
            picked = other
            break
        if not stack:
            break
        if picked < 0:
            stack.pop()
            used[index] = False
            continue
        used[picked] = True
        taken |= (1 << index) | (1 << picked)
        free[mine] -= 1
        free[group[picked]] -= 1
        frame[3], frame[4] = picked, cost
        partial += cost
        following = index + 1
        while following < size and used[following]:
            following += 1
        if following >= size:
            if best_cost is None or partial < best_cost:
                best_cost = partial
                best = [(entry[0], entry[3]) for entry in stack]
                if best_cost <= floor:
                    break
            continue
        used[following] = True
        stack.append([following, 0, following + 1, -1, 0])
    return [(ordered[left], ordered[right]) for left, right in best], (best_cost or 0) // repeat, proven


def _greedy_pairs(ordered: list[str], opponents: dict[str, set]) -> tuple[list[tuple[str, str]], int]:
    """Die einfache Regel: von oben, der nächste noch nicht gespielte Gegner - sonst eine Wiederholung."""
    pairs: list[tuple[str, str]] = []
    used: set[str] = set()
    rematches = 0
    for index, player in enumerate(ordered):
        if player in used:
            continue
        faced = opponents.get(player) or set()
        partner = next((other for other in ordered[index + 1:] if other not in used and other not in faced), None)
        if partner is None:
            partner = next((other for other in ordered[index + 1:] if other not in used), None)
            if partner is None:
                break
            rematches += 1
        used.add(player)
        used.add(partner)
        pairs.append((player, partner))
    return pairs, rematches


def pair_field(ordered: list[str], opponents: dict[str, set],
               scores: dict[str, float] | None = None) -> tuple[list[tuple[str, str]], int]:
    """Paart ein Feld in gegebener Reihenfolge und liefert die Paare und die Zahl der Wiederholungen: so wenige
    Wiederholungen wie möglich, dann die Punkte (``scores``) in jedem Paar so nah beieinander wie möglich - siehe
    ``_best_pairs``. Reicht das Schrittbudget nicht für den Beweis (große Felder mit dichter Geschichte), gilt das Beste
    bis dahin; das ist mindestens die einfache Regel."""
    if len(ordered) % 2:
        return _greedy_pairs(ordered, opponents)
    if not ordered:
        return [], 0
    pairs, rematches, _proven = _best_pairs(ordered, opponents, scores, PAIRING_BUDGET)
    return pairs, rematches


def swiss_pairings(
    participants: list[str],
    matches: list[dict],
    *,
    seed: int | None = None,
) -> tuple[list[tuple[str, str]], str | None]:
    """Pair the next round. Returns the pairs and whoever gets a bye.

    Equal scores meet first: a score group is paired within itself, and only
    whoever is left over meets the neighbouring group. A rematch happens only
    when no complete round without one exists (#1559) - refusing to pair at
    all would stall the tournament, which is worse than a repeat. The same
    field, the same results and the same ``seed`` always give the same round.

    ``participants`` are the ones to pair; their points come from every
    decided match in ``matches``, also against someone who is not paired any
    more.
    """
    field = [item for item in participants if item]
    if len(field) < 2:
        return [], field[0] if field else None

    rng = random.Random(seed)
    scores, opponents = scores_and_history(field, matches)
    ordered = _ordered_by_score(scores, rng)

    if len(ordered) % 2 == 0:
        return pair_field(ordered, opponents, scores)[0], None

    # Von hinten aufgerollt: das Freilos geht an den Letzten, der noch keines
    # hatte. Zweimal aussetzen wäre ein Vorteil, den niemand verdient hat. Bräuchte
    # die Runde damit eine Wiederholung, setzt der Nächste von hinten aus (#1559).
    seated = bye_history(matches)
    candidates = [item for item in reversed(ordered) if item not in seated] or [ordered[-1]]
    best: tuple[list[tuple[str, str]], str, int] | None = None
    for bye in candidates[:BYE_TRIES]:
        pairs, rematches = pair_field([item for item in ordered if item != bye], opponents, scores)
        if best is None or rematches < best[2]:
            best = (pairs, bye, rematches)
        if not rematches:
            break
    return best[0], best[1]


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
    participants: list[str] | None = None,
) -> list[dict]:
    """Build one Swiss round as graph match documents.

    The shape matches what the schema builder produces for every other format,
    so the read model, the standings and the result flows treat a Swiss match
    like any other. A bye is written as a decided match with a single
    participant rather than being dropped, which is how it earns its point.

    ``participants`` (#1559): wer noch gepaart wird - ohne Angabe alle Anmeldungen. Ohne ``seed`` gilt der der Runde
    (``round_seed``), und die Kennung jedes Spiels entsteht aus Phase, Runde und Reihenfolge: dieselbe Runde ergibt
    immer dieselben Dokumente, ein zweites Schreiben derselben Runde scheitert am eindeutigen Index der Kennung.
    """
    by_id = {registration["id"]: registration for registration in registrations if registration.get("id")}
    field = list(by_id) if participants is None else [item for item in participants if item in by_id]
    if seed is None:
        seed = round_seed(stage.get("id"), round_number)
    pairs, bye = swiss_pairings(field, played, seed=seed)
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
            "id": str(uuid.uuid5(_ROUND_NAMESPACE, f"{stage['id']}:{round_number}:{order}")),
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
