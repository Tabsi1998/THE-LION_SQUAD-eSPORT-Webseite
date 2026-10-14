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
