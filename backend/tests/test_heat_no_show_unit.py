"""„Nicht erschienen“ im Lauf (#1823): wann ein eingetragenes Ergebnis jemanden markiert - die Regel ohne Datenbank."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.heat_no_show import marking_fields, result_marks  # noqa: E402


def heat(*seated, **extra):
    return {"id": "m1", "slots": [{"slot": index + 1, "registration_id": reg} for index, reg in enumerate(seated)], **extra}


RESULT = [
    {"registration_id": "a", "rank": 1}, {"registration_id": "b", "rank": 2},
    {"registration_id": "c", "rank": 3, "forfeit": True, "note": "Nicht erschienen"}, {"registration_id": "d", "rank": 3, "forfeit": True},
]


def test_the_lead_marks_whom_it_entered_as_no_show():
    fields, new, raced = result_marks(heat("a", "b", "c", "d"), RESULT, from_players=False)
    assert new == ["c", "d"] and raced == []
    assert fields["no_show_registration_ids"] == ["c", "d"]
    assert fields["no_show_notes"] == {"c": "Nicht erschienen", "d": "Nicht erschienen"}


def test_reports_of_players_mark_nobody():
    assert result_marks(heat("a", "b", "c", "d"), RESULT, from_players=True) == ({}, [], [])


def test_a_duel_is_no_heat_and_has_no_mark():
    duel = [{"registration_id": "a", "rank": 1}, {"registration_id": "b", "rank": 2, "forfeit": True}]
    assert result_marks(heat("a", "b"), duel, from_players=False) == ({}, [], [])


def test_whoever_raced_after_all_loses_the_mark_and_marked_ones_are_not_marked_twice():
    match = heat("a", "b", "c", "d", no_show_registration_ids=["a", "c"], no_show_notes={"a": "Frist", "c": "Frist"})
    fields, new, raced = result_marks(match, RESULT, from_players=False)
    assert raced == ["a"] and new == ["d"]
    assert fields == {"no_show_registration_ids": ["c", "d"], "no_show_notes": {"c": "Frist", "d": "Nicht erschienen"}}


def test_marking_keeps_the_first_reason():
    match = heat("a", "b", "c", no_show_registration_ids=["c"], no_show_notes={"c": "Frist um"})
    assert marking_fields(match, {"c": "anders", "b": None}) == {
        "no_show_registration_ids": ["c", "b"], "no_show_notes": {"c": "Frist um", "b": "Nicht erschienen"}}
