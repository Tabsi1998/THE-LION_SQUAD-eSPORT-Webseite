"""Report, dispute and forfeit for graph matches.

These three flows decide who advances and who is recorded as having given up,
so the rules they follow have to be pinned rather than assumed - especially the
one where reports disagree, which must wait for staff instead of guessing.
"""
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.match_v2_results import MatchV2ResultError
from services.v2_match_flows import (
    dispute_entry,
    is_duplicate_dispute,
    is_duplicate_report,
    report_consensus,
    report_entry,
    results_for_forfeit,
    validate_forfeit_note,
)


def match_with(*registration_ids, **extra):
    return {
        "id": "m1",
        "slots": [{"registration_id": item, "slot_index": index} for index, item in enumerate(registration_ids)],
        **extra,
    }


# ---------------------------------------------------------------- Forfeit

def test_the_forfeiting_participant_is_ranked_last():
    results = results_for_forfeit(match_with("reg-a", "reg-b"), "reg-b")

    assert results == [
        {"registration_id": "reg-a", "rank": 1},
        # Ausdrücklich als Aufgabe gekennzeichnet - sonst wäre die Platzierung
        # dort, wo Unentschieden erlaubt sind, von einem geteilten Platz nicht
        # zu unterscheiden.
        {"registration_id": "reg-b", "rank": 2, "forfeit": True},
    ]


def test_the_other_participants_keep_their_order():
    """Bei mehr als zwei Teilnehmern gibt der Forfeit nur den letzten Platz vor."""
    results = results_for_forfeit(match_with("a", "b", "c", "d"), "b")

    assert [item["registration_id"] for item in results] == ["a", "c", "d", "b"]
    assert [item["rank"] for item in results] == [1, 2, 3, 4]


def test_empty_slots_are_ignored():
    match = {"slots": [{"registration_id": "a"}, {"registration_id": None}, {"registration_id": "b"}]}

    assert len(results_for_forfeit(match, "b")) == 2


def test_a_stranger_cannot_forfeit_this_match():
    with pytest.raises(MatchV2ResultError):
        results_for_forfeit(match_with("a", "b"), "fremder")


def test_a_match_without_an_opponent_cannot_be_forfeited():
    with pytest.raises(MatchV2ResultError):
        results_for_forfeit(match_with("a"), "a")


@pytest.mark.parametrize("note", [None, "", "   ", "kurz"])
def test_a_forfeit_without_a_real_reason_is_rejected(note):
    """Ein Forfeit ist eine Sanktion - der Betroffene hat ein Recht auf Begründung."""
    with pytest.raises(MatchV2ResultError):
        validate_forfeit_note(note)


def test_a_proper_reason_is_accepted_and_trimmed():
    assert validate_forfeit_note("  nicht angetreten  ") == "nicht angetreten"


# ---------------------------------------------------------------- Einspruch

def test_the_same_objection_twice_is_recognised():
    match = {"disputes": [{"user_id": "u1", "reason": "Falscher Score"}]}

    assert is_duplicate_dispute(match, "u1", "Falscher Score") is True
    assert is_duplicate_dispute(match, "u1", "  Falscher Score  ") is True


def test_a_different_person_or_reason_is_a_new_objection():
    match = {"disputes": [{"user_id": "u1", "reason": "Falscher Score"}]}

    assert is_duplicate_dispute(match, "u2", "Falscher Score") is False
    assert is_duplicate_dispute(match, "u1", "Gegner nicht erschienen") is False


def test_an_objection_records_who_when_and_why():
    entry = dispute_entry("u1", "  Falscher Score  ")

    assert entry["user_id"] == "u1"
    assert entry["reason"] == "Falscher Score"
    assert entry["at"]


# ---------------------------------------------------------------- Ergebnismeldung

def _results(first, second):
    return [{"registration_id": first, "rank": 1}, {"registration_id": second, "rank": 2}]


def test_two_matching_reports_decide_the_match():
    reports = [
        report_entry("u1", "reg-a", _results("reg-a", "reg-b")),
        report_entry("u2", "reg-b", _results("reg-a", "reg-b")),
    ]

    assert report_consensus(reports) == _results("reg-a", "reg-b")


def test_the_order_within_a_report_does_not_matter():
    reports = [
        report_entry("u1", "reg-a", _results("reg-a", "reg-b")),
        report_entry("u2", "reg-b", list(reversed(_results("reg-a", "reg-b")))),
    ]

    assert report_consensus(reports) is not None


def test_conflicting_reports_wait_for_staff():
    """Bei Widerspruch wird nicht geraten - genau wie im klassischen Ablauf."""
    reports = [
        report_entry("u1", "reg-a", _results("reg-a", "reg-b")),
        report_entry("u2", "reg-b", _results("reg-b", "reg-a")),
    ]

    assert report_consensus(reports) is None


def test_a_single_report_decides_nothing():
    assert report_consensus([report_entry("u1", "reg-a", _results("reg-a", "reg-b"))]) is None
    assert report_consensus([]) is None


def test_the_same_reporter_twice_is_still_only_one_voice():
    reports = [
        report_entry("u1", "reg-a", _results("reg-a", "reg-b")),
        report_entry("u1", "reg-a", _results("reg-a", "reg-b")),
    ]

    assert report_consensus(reports) is None


def test_a_corrected_report_replaces_the_earlier_one():
    """Wer sich korrigiert, dessen letzte Meldung zaehlt."""
    reports = [
        report_entry("u1", "reg-a", _results("reg-b", "reg-a")),
        report_entry("u2", "reg-b", _results("reg-a", "reg-b")),
        report_entry("u1", "reg-a", _results("reg-a", "reg-b")),
    ]

    assert report_consensus(reports) == _results("reg-a", "reg-b")


def test_an_identical_repeat_report_is_recognised():
    match = {"reports": [report_entry("u1", "reg-a", _results("reg-a", "reg-b"))]}

    assert is_duplicate_report(match, "u1", _results("reg-a", "reg-b")) is True
    assert is_duplicate_report(match, "u1", _results("reg-b", "reg-a")) is False
    assert is_duplicate_report(match, "u2", _results("reg-a", "reg-b")) is False
