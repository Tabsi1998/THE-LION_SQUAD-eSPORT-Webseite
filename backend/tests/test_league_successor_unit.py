"""Ziel-Liga der neuen Season (F.2, #1627): erst das Ziel, dann die nächste aktive Liga N - auch mit archivierter Liga oben, in der Mitte
und unten."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.league_successor import target_level  # noqa: E402


def test_all_active_one_step():
    assert [target_level([1, 2, 3], 2, move) for move in (-1, 0, 1)] == [1, 2, 3]


def test_archived_in_the_middle_never_two_steps():
    levels = [1, 3, 4]  # Liga 2 archiviert
    assert target_level(levels, 2, -1) == 1
    assert target_level(levels, 2, 0) == 3
    assert target_level(levels, 2, 1) == 3  # Gegenprobe zur alten Rechnung: nicht Liga 4
    assert target_level(levels, 1, 1) == 3
    assert target_level(levels, 3, -1) == 1
    assert target_level(levels, 3, 1) == 4


def test_archived_on_top_and_at_the_bottom():
    assert [target_level([2, 3], 1, move) for move in (-1, 0, 1)] == [2, 2, 2]
    assert target_level([2, 3], 2, -1) == 2
    assert [target_level([1, 2], 3, move) for move in (-1, 0, 1)] == [2, 2, 2]
    assert target_level([1, 2], 2, 1) == 2
