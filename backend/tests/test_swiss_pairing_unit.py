"""Schweizer System komplett (#1559): Paarung ohne vermeidbare Wiederholung, reproduzierbar, mit Freilos bei
ungerader Zahl - dazu Abschlussregel und Bilanz. Reine Rechnung, ohne Datenbank. Nur erfundene Namen.
"""
import itertools
import pathlib
import random
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.graph_swiss import (  # noqa: E402
    LEGACY_TIEBREAKERS,
    bye_history,
    complete_text,
    pair_field,
    recommended_rounds,
    records,
    round_seed,
    scores_and_history,
    swiss_pairings,
    swiss_round_documents,
    swiss_settings,
    swiss_state,
)

TOURNAMENT = {"id": "t1"}
STAGE = {"id": "stage-1", "number": 1, "settings": {}}


def decided(round_number, winner, loser, status="completed"):
    return {"round": round_number, "status": status,
            "slots": [{"registration_id": winner}, {"registration_id": loser}],
            "results": [{"registration_id": winner, "rank": 1}, {"registration_id": loser, "rank": 2}]}


def drawn(round_number, first, second):
    return {"round": round_number, "status": "completed",
            "slots": [{"registration_id": first}, {"registration_id": second}],
            "results": [{"registration_id": first, "rank": 1}, {"registration_id": second, "rank": 1}]}


def bye(round_number, participant):
    return {"round": round_number, "status": "completed",
            "slots": [{"registration_id": participant}, {"registration_id": None}],
            "results": [{"registration_id": participant, "rank": 1}]}


def open_match(round_number, first, second):
    return {"round": round_number, "status": "ready",
            "slots": [{"registration_id": first}, {"registration_id": second}], "results": []}


def registrations(*names):
    return [{"id": name, "user_id": f"user-{name}", "seed": index} for index, name in enumerate(names, start=1)]


def field(count):
    return [f"p{index:02d}" for index in range(1, count + 1)]


def fewest_rematches(players, opponents):
    """Die kleinste Zahl an Wiederholungen über alle vollständigen Paarungen - stur durchprobiert (nur kleine Felder)."""
    if not players:
        return 0
    first, rest = players[0], players[1:]
    best = None
    for index, other in enumerate(rest):
        cost = (1 if other in opponents[first] else 0) + fewest_rematches(rest[:index] + rest[index + 1:], opponents)
        best = cost if best is None else min(best, cost)
    return best


def rematch_count(pairs, opponents):
    return sum(1 for left, right in pairs if right in opponents[left])


def play_round(players, matches, round_number, seed, rng):
    """Eine Runde paaren und zufällig entscheiden - wie ein Turnier sie spielt."""
    pairs, sitting = swiss_pairings(players, matches, seed=seed)
    for left, right in pairs:
        roll = rng.random()
        if roll < 0.1:
            matches.append(drawn(round_number, left, right))
        elif roll < 0.55:
            matches.append(decided(round_number, left, right))
        else:
            matches.append(decided(round_number, right, left))
    if sitting:
        matches.append(bye(round_number, sitting))
    return pairs, sitting


# ---------------------------------------------------------------- Rematch nur, wenn sonst niemand passt

def test_the_top_two_do_not_meet_when_that_forces_a_rematch_below():
    """Die einfache Regel paarte 1-2 und ließ 3-4 noch einmal spielen; 1-3 und 2-4 geht ohne Wiederholung."""
    opponents = {"p1": set(), "p2": set(), "p3": {"p4"}, "p4": {"p3"}}

    pairs, rematches = pair_field(["p1", "p2", "p3", "p4"], opponents)

    assert rematches == 0
    assert pairs == [("p1", "p3"), ("p2", "p4")]


def test_a_rematch_happens_only_when_every_round_without_one_is_impossible():
    """Vier Teilnehmer, drei Runden gespielt: jeder kennt jeden - eine vierte Runde geht nur mit Wiederholungen."""
    everyone = ["p1", "p2", "p3", "p4"]
    opponents = {player: set(everyone) - {player} for player in everyone}

    pairs, rematches = pair_field(everyone, opponents)

    assert rematches == 2
    assert sorted(player for pair in pairs for player in pair) == everyone


def test_one_unavoidable_rematch_is_not_made_two():
    """Sechs Teilnehmer, fast jeder kennt jeden - offen sind nur p1 gegen p4 und p2 gegen p5. p3 und p6 müssen noch
    einmal gegeneinander spielen; mehr als diese eine Wiederholung braucht es nicht."""
    everyone = [f"p{index}" for index in range(1, 7)]
    opponents = {player: set() for player in everyone}

    def met(left, right):
        opponents[left].add(right)
        opponents[right].add(left)

    for left, right in itertools.combinations(everyone, 2):
        met(left, right)
    for left, right in (("p1", "p4"), ("p2", "p5")):
        opponents[left].discard(right)
        opponents[right].discard(left)

    pairs, rematches = pair_field(everyone, opponents)

    assert rematches == fewest_rematches(everyone, opponents) == 1
    assert ("p1", "p4") in pairs and ("p2", "p5") in pairs


@pytest.mark.parametrize("size", [4, 5, 6, 7, 8, 9, 10])
def test_simulated_tournaments_never_repeat_a_pairing_that_could_be_avoided(size):
    """Viele gespielte Turniere, jede Runde nachgerechnet: so wenige Wiederholungen, wie überhaupt möglich sind."""
    for run in range(12):
        rng = random.Random(1000 * size + run)
        players = field(size)
        matches: list[dict] = []
        for round_number in range(1, size):
            _scores, before = scores_and_history(players, matches)
            had_bye = bye_history(matches)
            pairs, sitting = play_round(players, matches, round_number, seed=run * 31 + round_number, rng=rng)
            paired = sorted(player for pair in pairs for player in pair)
            assert paired == sorted(set(players) - {sitting}), "jeder genau einmal"
            if size % 2:
                assert sitting is not None
                if set(players) - had_bye:
                    assert sitting not in had_bye, "niemand setzt zweimal aus, solange ein anderer noch nie ausgesetzt hat"
                # Mit ungerader Zahl darf das Freilos wandern, damit die Runde ohne Wiederholung aufgeht.
                candidates = [player for player in players if player not in had_bye] or players
                least = min(fewest_rematches([p for p in players if p != candidate], before) for candidate in candidates)
            else:
                assert sitting is None
                least = fewest_rematches(players, before)
            assert rematch_count(pairs, before) == least, f"Runde {round_number} bei {size} Teilnehmern"


def test_the_first_rounds_of_a_big_field_stay_free_of_rematches():
    """64 Teilnehmer, sechs Runden: kein Paar trifft sich zweimal."""
    rng = random.Random(64)
    players = field(64)
    matches: list[dict] = []
    seen: set[frozenset] = set()
    for round_number in range(1, 7):
        pairs, sitting = play_round(players, matches, round_number, seed=round_number, rng=rng)
        assert sitting is None and len(pairs) == 32
        for pair in pairs:
            assert frozenset(pair) not in seen
            seen.add(frozenset(pair))


def test_similar_scores_still_meet():
    """Die Suche darf die Grundregel nicht aufgeben: nach Runde 1 spielen Sieger gegen Sieger."""
    played = [decided(1, "p1", "p2"), decided(1, "p3", "p4"), decided(1, "p5", "p6"), decided(1, "p7", "p8")]

    pairs, _ = swiss_pairings([f"p{index}" for index in range(1, 9)], played, seed=5)

    winners = {"p1", "p3", "p5", "p7"}
    assert all((left in winners) == (right in winners) for left, right in pairs)


# ---------------------------------------------------------------- Freilos

def test_an_odd_field_gets_exactly_one_bye_and_everyone_else_plays():
    pairs, sitting = swiss_pairings(field(7), [], seed=3)

    assert sitting in field(7)
    assert len(pairs) == 3
    assert sorted([sitting, *(player for pair in pairs for player in pair)]) == field(7)


def test_an_even_field_has_no_bye():
    pairs, sitting = swiss_pairings(field(8), [], seed=3)

    assert sitting is None and len(pairs) == 4


def test_the_bye_moves_up_when_the_last_one_would_force_a_rematch():
    """a hat schon gegen b, c und d gespielt, e ist neu dazugekommen. Setzt e aus, bleibt für a nur eine Wiederholung;
    setzt einer von b, c, d aus, spielt a gegen e und die Runde geht ohne Wiederholung auf."""
    played = [decided(1, "a", "b"), decided(2, "a", "c"), decided(3, "a", "d")]

    for seed in range(20):
        pairs, sitting = swiss_pairings(["a", "b", "c", "d", "e"], played, seed=seed)
        _scores, opponents = scores_and_history(["a", "b", "c", "d", "e"], played)

        assert sitting in {"b", "c", "d"}, f"Startwert {seed}"
        assert rematch_count(pairs, opponents) == 0, f"Startwert {seed}"


# ---------------------------------------------------------------- Deterministisch und reproduzierbar

def test_the_same_round_is_always_paired_the_same_way():
    """Ohne Startwert von außen: Phase und Runde bestimmen ihn - zweimal erzeugt, zweimal dieselben Spiele."""
    regs = registrations(*field(9))
    played = [decided(1, "p01", "p02"), decided(1, "p03", "p04"), decided(1, "p05", "p06"),
              decided(1, "p07", "p08"), bye(1, "p09")]

    first = swiss_round_documents(TOURNAMENT, STAGE, regs, played, round_number=2)
    second = swiss_round_documents(TOURNAMENT, STAGE, list(reversed(regs)), list(reversed(played)), round_number=2)

    def shape(documents):
        return [(document["id"], document["match_key"], [slot["registration_id"] for slot in document["slots"]])
                for document in documents]

    assert shape(first) == shape(second)


def test_each_round_and_each_stage_has_its_own_draw():
    assert round_seed("stage-1", 1) == round_seed("stage-1", 1)
    assert round_seed("stage-1", 1) != round_seed("stage-1", 2)
    assert round_seed("stage-1", 1) != round_seed("stage-2", 1)


def test_match_ids_are_stable_per_round_and_differ_between_rounds():
    regs = registrations(*field(4))

    round_one = swiss_round_documents(TOURNAMENT, STAGE, regs, [], round_number=1)
    again = swiss_round_documents(TOURNAMENT, STAGE, regs, [], round_number=1)
    round_two = swiss_round_documents(TOURNAMENT, STAGE, regs, [], round_number=2)
    other_stage = swiss_round_documents(TOURNAMENT, {**STAGE, "id": "stage-2"}, regs, [], round_number=1)

    ids = [document["id"] for document in round_one]
    assert ids == [document["id"] for document in again]
    assert len(set(ids)) == len(ids)
    assert not set(ids) & {document["id"] for document in round_two}
    assert not set(ids) & {document["id"] for document in other_stage}


def test_only_the_named_participants_are_paired():
    """Wer weiter oder raus ist, spielt nicht mehr mit - auch nicht als Freilos."""
    regs = registrations("a", "b", "c", "d", "e")

    documents = swiss_round_documents(TOURNAMENT, STAGE, regs, [], round_number=4, participants=["b", "c", "e", "x"])

    seated = sorted(slot["registration_id"] for document in documents for slot in document["slots"] if slot["registration_id"])
    assert seated == ["b", "c", "e"]


# ---------------------------------------------------------------- Einstellungen

def test_without_settings_swiss_runs_as_before():
    assert swiss_settings({}) == {
        "end_rule": "manual", "rounds": None, "top_n": None, "wins_to_advance": 3, "losses_to_exit": 3,
        "auto_next_round": False, "tiebreakers": list(LEGACY_TIEBREAKERS)}
    assert swiss_settings(None) == swiss_settings({"swiss_settings": None})


def test_settings_keep_what_is_valid_and_fall_back_for_the_rest():
    settings = swiss_settings({"swiss_settings": {
        "end_rule": "nie", "rounds": 0, "top_n": "8", "wins_to_advance": 99, "losses_to_exit": 2,
        "auto_next_round": 1, "tiebreakers": ["median_buchholz", "quatsch", "median_buchholz", "head_to_head"]}})

    assert settings == {
        "end_rule": "manual", "rounds": None, "top_n": 8, "wins_to_advance": 3, "losses_to_exit": 2,
        "auto_next_round": True, "tiebreakers": ["median_buchholz", "head_to_head"]}


def test_an_empty_tiebreaker_list_means_points_only():
    assert swiss_settings({"swiss_settings": {"tiebreakers": []}})["tiebreakers"] == []


@pytest.mark.parametrize("count,rounds", [(0, 1), (2, 1), (4, 2), (8, 3), (9, 4), (16, 4), (17, 5), (32, 5), (33, 6)])
def test_recommended_rounds_follow_the_field_size(count, rounds):
    assert recommended_rounds(count) == rounds


# ---------------------------------------------------------------- Bilanz und Abschlussregel

def test_records_count_wins_losses_draws_and_byes():
    played = [decided(1, "a", "b"), drawn(1, "c", "d"), bye(1, "e"), decided(2, "a", "x", status="forfeit"),
              open_match(2, "b", "c")]

    result = records(["a", "b", "c", "d", "e"], played)

    assert result["a"] == {"won": 2, "lost": 0, "drawn": 0, "byes": 0}
    assert result["b"] == {"won": 0, "lost": 1, "drawn": 0, "byes": 0}
    assert result["c"] == {"won": 0, "lost": 0, "drawn": 1, "byes": 0}
    assert result["e"] == {"won": 1, "lost": 0, "drawn": 0, "byes": 1}


def rounds_rule(**extra):
    return swiss_settings({"swiss_settings": {"end_rule": "rounds", **extra}})


def test_manual_swiss_never_ends_by_itself():
    played = [decided(round_number, "a", "b") for round_number in range(1, 12)]

    state = swiss_state(swiss_settings({}), ["a", "b"], played)

    assert state["complete"] is False and state["rounds_played"] == 11 and state["rounds_total"] is None


def test_a_fixed_number_of_rounds_ends_after_the_last_one_is_decided():
    players = ["a", "b", "c", "d"]
    settings = rounds_rule(rounds=2)
    round_one = [decided(1, "a", "b"), decided(1, "c", "d")]

    assert swiss_state(settings, players, [])["complete"] is False
    assert swiss_state(settings, players, round_one)["complete"] is False
    running = swiss_state(settings, players, [*round_one, decided(2, "a", "c"), open_match(2, "b", "d")])
    assert running["complete"] is False and running["round_open"] is True
    done = swiss_state(settings, players, [*round_one, decided(2, "a", "c"), decided(2, "b", "d")])
    assert done["complete"] is True and done["rounds_total"] == 2 and done["active"] == players
    assert "2 Runden" in complete_text(done)


def test_without_a_number_the_rounds_follow_the_field():
    state = swiss_state(rounds_rule(), field(16), [])

    assert state["rounds_total"] == 4


def test_a_cancelled_match_does_not_keep_the_last_round_open():
    cancelled = {**open_match(1, "c", "d"), "status": "cancelled"}

    assert swiss_state(rounds_rule(rounds=1), ["a", "b", "c", "d"], [decided(1, "a", "b"), cancelled])["complete"] is True


def wins_losses(wins=2, losses=2):
    return swiss_settings({"swiss_settings": {"end_rule": "wins_losses", "wins_to_advance": wins, "losses_to_exit": losses}})


def test_enough_wins_advance_and_enough_losses_are_out():
    players = ["a", "b", "c", "d"]
    played = [decided(1, "a", "b"), decided(1, "c", "d"), decided(2, "a", "c"), decided(2, "d", "b")]

    state = swiss_state(wins_losses(), players, played)

    assert state["advanced"] == ["a"]
    assert state["eliminated"] == ["b"]
    assert state["active"] == ["c", "d"]
    assert state["complete"] is False


def test_wins_and_losses_end_when_fewer_than_two_are_left_to_pair():
    players = ["a", "b", "c", "d"]
    played = [decided(1, "a", "b"), decided(1, "c", "d"), decided(2, "a", "c"), decided(2, "d", "b"),
              decided(3, "c", "d")]

    state = swiss_state(wins_losses(), players, played)

    assert state["advanced"] == ["a", "c"] and state["eliminated"] == ["b", "d"]
    assert state["active"] == [] and state["complete"] is True
    assert "weiter oder ausgeschieden" in complete_text(state)


def test_wins_and_losses_wait_for_the_running_round():
    players = ["a", "b", "c", "d"]
    played = [decided(1, "a", "b"), decided(1, "c", "d"), decided(2, "a", "c"), open_match(2, "d", "b")]

    state = swiss_state(wins_losses(), players, played)

    assert state["round_open"] is True and state["complete"] is False


def test_a_bye_counts_as_a_win_towards_advancing():
    state = swiss_state(wins_losses(wins=2), ["a", "b", "c"], [decided(1, "a", "b"), bye(1, "c"), bye(2, "c")])

    assert "c" in state["advanced"]


def test_nothing_is_complete_before_the_first_round():
    assert swiss_state(wins_losses(), ["a"], [])["complete"] is False


# ---------------------------------------------------------------- Gepaart wird nach der ganzen Bilanz

def test_a_win_against_someone_who_no_longer_plays_still_counts_for_the_pairing():
    """x ist schon weiter, y schon raus - beide stehen nicht mehr im Feld. Der Sieg gegen sie bleibt ein Sieg, die
    Niederlage gegen sie bringt keinen Punkt, und das Unentschieden gegen sie zählt halb."""
    played = [decided(1, "a", "y"), decided(1, "x", "b"), drawn(2, "c", "x"), decided(2, "a", "c")]

    scores, opponents = scores_and_history(["a", "b", "c"], played)

    assert scores == {"a": 2.0, "b": 0.0, "c": 0.5}
    assert opponents["a"] == {"y", "c"}


def test_points_for_the_pairing_match_the_record():
    """Dieselbe Geschichte, zwei Rechnungen: die Punkte der Paarung sind Siege plus halbe Unentschieden der Bilanz."""
    rng = random.Random(7)
    players = field(10)
    matches: list[dict] = []
    for round_number in range(1, 6):
        play_round(players, matches, round_number, seed=round_number, rng=rng)

    still_playing = players[::2]
    scores, _ = scores_and_history(still_playing, matches)
    record = records(still_playing, matches)

    assert scores == {player: record[player]["won"] + 0.5 * record[player]["drawn"] for player in still_playing}


def test_only_the_active_are_paired_but_by_all_their_results():
    """Siege/Niederlagen: p1 und p2 haben zweimal gewonnen, p3 und p4 zweimal verloren - alles gegen Leute, die schon
    weiter oder raus sind. Vorher zählte davon nichts, alle vier galten als punktgleich und wurden gelost."""
    regs = registrations("p1", "p2", "p3", "p4", "w1", "w2", "l1", "l2")
    played = [decided(1, "p1", "l1"), decided(1, "p2", "l2"), decided(1, "w1", "p3"), decided(1, "w2", "p4"),
              decided(2, "p1", "l2"), decided(2, "p2", "l1"), decided(2, "w1", "p4"), decided(2, "w2", "p3")]

    for stage_number in range(20):
        documents = swiss_round_documents(
            TOURNAMENT, {**STAGE, "id": f"stage-{stage_number}"}, regs, played, round_number=3,
            participants=["p1", "p2", "p3", "p4"])
        pairs = sorted(tuple(sorted(slot["registration_id"] for slot in document["slots"])) for document in documents)

        assert pairs == [("p1", "p2"), ("p3", "p4")], f"Phase {stage_number}"
