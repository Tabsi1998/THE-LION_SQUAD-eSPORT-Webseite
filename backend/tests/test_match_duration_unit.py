"""Eine Spieldauer, eine Funktion (#1552).

Die Kette Match → Match.settings → Phase → Turnier → 30 war neunmal kopiert, einmal ohne den Turnierwert
(`match_planning.py`). Hier steht sie einmal, und der Wächter unten hält die Kopien fern.
"""
import re
from pathlib import Path

import pytest

from services.match_duration import DEFAULT_MATCH_DURATION_MINUTES, effective_match_duration

BACKEND = Path(__file__).resolve().parents[1]


def test_without_any_value_the_default_is_thirty():
    assert DEFAULT_MATCH_DURATION_MINUTES == 30
    assert effective_match_duration({}) == 30
    assert effective_match_duration(None, stage=None, tournament=None) == 30


def test_the_tournament_value_applies_when_match_and_stage_say_nothing():
    assert effective_match_duration({}, tournament={"match_duration_minutes": 45}) == 45


def test_the_stage_beats_the_tournament():
    assert effective_match_duration({}, stage={"settings": {"duration_minutes": 20}}, tournament={"match_duration_minutes": 45}) == 20


def test_the_match_settings_beat_the_stage():
    match = {"settings": {"duration_minutes": 25}}
    assert effective_match_duration(match, stage={"settings": {"duration_minutes": 20}}, tournament={"match_duration_minutes": 45}) == 25


def test_the_match_itself_beats_everything():
    match = {"duration_minutes": 15, "settings": {"duration_minutes": 25}}
    assert effective_match_duration(match, stage={"settings": {"duration_minutes": 20}}, tournament={"match_duration_minutes": 45}) == 15


def test_pending_updates_win_over_the_stored_match():
    match = {"duration_minutes": 15}
    assert effective_match_duration(match, updates={"duration_minutes": 40}) == 40
    # Leer gesetzt heißt: die Kette darunter gilt wieder, nicht der alte Wert am Spiel.
    assert effective_match_duration(match, updates={"duration_minutes": None}, tournament={"match_duration_minutes": 50}) == 50


@pytest.mark.parametrize("bad", ["", "abc", 0, -5, None, "0"])
def test_unusable_values_fall_through_to_the_next_level(bad):
    assert effective_match_duration({"duration_minutes": bad}, tournament={"match_duration_minutes": 35}) == 35
    assert effective_match_duration({"duration_minutes": bad}) == 30


def test_string_numbers_are_read():
    assert effective_match_duration({"duration_minutes": "12"}) == 12


# ---------------------------------------------------------------- Wächter

COPY = re.compile(r"duration_minutes.*\bor\s+(30|DEFAULT_DURATION_MINUTES|DEFAULT_MATCH_DURATION_MINUTES)\b")


def test_no_file_outside_match_duration_repeats_the_duration_chain():
    """Wer die Dauer braucht, ruft effective_match_duration - eine neue Kopie fällt hier auf."""
    found = []
    for path in BACKEND.rglob("*.py"):
        rel = path.relative_to(BACKEND)
        if rel.parts[0] in {"tests", "static", "__pycache__", ".venv", "venv"}:
            continue
        if rel.as_posix() == "services/match_duration.py":
            continue
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            if COPY.search(line):
                found.append(f"{rel.as_posix()}:{number}: {line.strip()}")
    assert found == [], "Dauer-Kette kopiert statt effective_match_duration zu nutzen:\n" + "\n".join(found)


# ---------------------------------------------------------------- Ebene „Spiel“ (#1554)

from services.match_duration import expected_games, game_duration, game_mode  # noqa: E402

MK8 = {
    "id": "mk8",
    "match_modes": [
        {"mode": "gp4", "label": "Grand Prix 4 Rennen", "minutes": 12},
        {"mode": "race", "label": "Einzelrennen", "minutes": 4, "per_game": True},
    ],
}


def test_the_game_comes_after_the_tournament():
    assert effective_match_duration({}, tournament={"match_duration_minutes": 45}, game=MK8) == 45
    assert effective_match_duration({}, tournament={}, game=MK8) == 12


def test_the_game_comes_before_the_default():
    assert effective_match_duration({}, game=MK8) == 12
    assert effective_match_duration({}, game={"match_modes": []}) == 30
    assert effective_match_duration({}, game=None) == 30


def test_stage_and_match_still_beat_the_game():
    assert effective_match_duration({}, stage={"settings": {"duration_minutes": 20}}, game=MK8) == 20
    assert effective_match_duration({"duration_minutes": 9}, game=MK8) == 9


def test_without_a_chosen_mode_the_first_mode_counts():
    assert game_mode(MK8)["mode"] == "gp4"


def test_the_mode_of_the_tournament_is_used():
    assert game_mode(MK8, tournament={"game_mode": "race"})["mode"] == "race"
    assert effective_match_duration({}, tournament={"game_mode": "race"}, game=MK8) == 4


def test_the_mode_of_the_stage_beats_the_mode_of_the_tournament():
    stage = {"settings": {"game_mode": "gp4"}}
    assert game_mode(MK8, stage=stage, tournament={"game_mode": "race"})["mode"] == "gp4"


def test_an_unknown_mode_falls_back_to_the_first_mode():
    assert game_mode(MK8, tournament={"game_mode": "weg"})["mode"] == "gp4"


@pytest.mark.parametrize("best_of, games", [(1, 1), (3, 2.5), (5, 4), (7, 5.5), (2, 2), (None, 1), (0, 1), ("x", 1)])
def test_expected_games_are_the_middle_of_shortest_and_longest_series(best_of, games):
    assert expected_games(best_of) == games


def test_a_duration_per_single_game_is_multiplied_with_the_expected_games():
    # Bo3 mit 4 Minuten je Rennen: 2,5 × 4 = 10 Minuten.
    assert effective_match_duration({}, tournament={"game_mode": "race", "best_of": 3}, game=MK8) == 10
    # Bo5: 4 × 4 = 16; aufgerundet auf ganze Minuten: Bo3 mit 5 Minuten = 12,5 → 13.
    assert effective_match_duration({}, tournament={"game_mode": "race", "best_of": 5}, game=MK8) == 16
    per_game_five = {"match_modes": [{"mode": "m", "label": "M", "minutes": 5, "per_game": True}]}
    assert effective_match_duration({}, tournament={"best_of": 3}, game=per_game_five) == 13


def test_the_best_of_of_match_and_stage_counts_for_the_expected_games():
    tournament = {"game_mode": "race", "best_of": 1}
    assert effective_match_duration({"best_of": 3}, tournament=tournament, game=MK8) == 10
    assert effective_match_duration({}, stage={"settings": {"best_of": 5}}, tournament=tournament, game=MK8) == 16


def test_a_duration_per_match_ignores_best_of():
    assert effective_match_duration({}, tournament={"best_of": 3}, game=MK8) == 12


def test_setup_time_is_added_to_the_game_duration():
    game = {**MK8, "setup_minutes": 3}
    assert game_duration(game) == 15
    assert effective_match_duration({}, game=game) == 15
    # Ein Wert am Turnier ist die ganze Spieldauer - die Aufbauzeit kommt nicht noch dazu.
    assert effective_match_duration({}, tournament={"match_duration_minutes": 20}, game=game) == 20


def test_unusable_game_data_falls_through_to_the_default():
    assert game_duration({"match_modes": [{"mode": "x", "label": "X", "minutes": 0}]}) is None
    assert game_duration({"match_modes": "kaputt"}) is None
    assert game_duration({"match_modes": [None, "x"]}) is None
    assert effective_match_duration({}, game={"match_modes": [{"mode": "x", "minutes": "abc"}]}) == 30


FREEZE = re.compile(r"""["']duration_minutes["']\s*(:|,)\s*(effective_match_duration|duration\b)""")


def test_no_generator_freezes_the_duration_into_a_new_match_or_stage():
    """Spiele ohne eigenen Wert folgen dem Turnier (#1554): beim Erzeugen wird die Dauer nicht mehr hineinkopiert."""
    found = []
    for path in BACKEND.rglob("*.py"):
        rel = path.relative_to(BACKEND)
        if rel.parts[0] in {"tests", "static", "__pycache__", ".venv", "venv"}:
            continue
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            if FREEZE.search(line):
                found.append(f"{rel.as_posix()}:{number}: {line.strip()}")
    assert found == [], "Dauer beim Erzeugen eingefroren:\n" + "\n".join(found)


def test_the_result_timer_knows_stage_and_game():
    """„Ergebnis fehlt“ (#1160) rechnet mit derselben Kette - auch mit Phase und Game."""
    from datetime import datetime, timedelta, timezone

    from services.match_timing import timing

    start = datetime(2026, 10, 31, 10, 0, tzinfo=timezone.utc)
    # Gezählt ab dem echten Start (#1556) - an der Station gestartet.
    match = {"scheduled_at": start.isoformat(), "started_at": start.isoformat(), "status": "in_progress", "station_id": "s1"}
    now = start + timedelta(minutes=14)
    assert timing(match, {}, now, game=MK8)["overdue_minutes"] == 2
    assert timing(match, {}, now, stage={"settings": {"duration_minutes": 10}})["overdue_minutes"] == 4
