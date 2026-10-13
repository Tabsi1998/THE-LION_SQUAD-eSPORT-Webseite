"""Ergebnis-Vertrag (#1035): welche Werte ein Ergebnis haben darf - geprüft an einer Stelle (services/match_v2_results).

- Zahlen sind endlich, nicht negativ und haben eine Obergrenze; was keine Zahl ist, ist ein Eingabefehler (422).
- Im K.-o. gibt es keinen Gleichstand: bei gleichem Stand entscheidet nur ein angegebener Platz, sonst nichts.
- Best-of: der Sieger hat genau die nötigen Siege, die Gegenseite weniger.
- Was Web und App schicken (resultEntry.cases.json), nimmt der Server an - mit denselben Plätzen.
"""
import json
import math
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from match_rules import RESULT_MAX_SCORE, RESULT_MAX_TIME_MS  # noqa: E402
from services.match_v2_results import (  # noqa: E402
    MatchV2ResultError,
    build_v2_result_application,
    normalize_v2_results,
    resolve_best_of,
)

CASES = pathlib.Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib" / "resultEntry.cases.json"


def duel(section="WB", **settings):
    return {
        "id": "m1",
        "section": section,
        "settings": {"match_size": 2, **settings},
        "slots": [
            {"slot": 1, "registration_id": "a", "status": "filled", "user_id": "u1"},
            {"slot": 2, "registration_id": "b", "status": "filled", "user_id": "u2"},
        ],
    }


def heat(ids, section="WB", **settings):
    return {
        "id": "h1",
        "section": section,
        "settings": {"match_size": len(ids), **settings},
        "slots": [{"slot": index, "registration_id": item, "status": "filled"} for index, item in enumerate(ids, start=1)],
    }


def places(results):
    return {row["registration_id"]: row["rank"] for row in results}


@pytest.mark.parametrize("field,value", [
    ("score", math.nan),
    ("score", math.inf),
    ("points", -math.inf),
    ("score", RESULT_MAX_SCORE + 1),
    ("score", "viel"),
    ("time_ms", math.nan),
    ("time_ms", math.inf),
    ("time_ms", RESULT_MAX_TIME_MS + 1),
    ("time_ms", "schnell"),
    ("score", True),
])
def test_values_outside_the_contract_are_an_input_error(field, value):
    with pytest.raises(MatchV2ResultError) as raised:
        normalize_v2_results(duel(), [
            {"registration_id": "a", field: value},
            {"registration_id": "b", field: 1},
        ])
    assert raised.value.status_code == 422


def test_the_upper_bounds_themselves_are_allowed():
    results = normalize_v2_results(duel(), [
        {"registration_id": "a", "score": RESULT_MAX_SCORE},
        {"registration_id": "b", "score": 0},
    ])
    assert places(results) == {"a": 1, "b": 2}

    timed = normalize_v2_results(duel(calculation="time"), [
        {"registration_id": "a", "time_ms": RESULT_MAX_TIME_MS},
        {"registration_id": "b", "time_ms": 61000},
    ])
    assert places(timed) == {"b": 1, "a": 2}


def test_a_knockout_tie_without_a_place_is_refused():
    with pytest.raises(MatchV2ResultError, match="Gleichstand"):
        normalize_v2_results(duel(), [
            {"registration_id": "a", "score": 2},
            {"registration_id": "b", "score": 2},
        ])


def test_a_knockout_tie_is_decided_by_the_stated_place():
    """Etwa nach Verlängerung: gleicher Stand, aber der Platz sagt, wer weiterkommt - nicht die Reihenfolge der Liste."""
    results = normalize_v2_results(duel(), [
        {"registration_id": "a", "score": 2, "rank": 2},
        {"registration_id": "b", "score": 2, "rank": 1},
    ])
    assert places(results) == {"a": 2, "b": 1}


def test_the_stated_place_does_not_beat_a_different_score():
    results = normalize_v2_results(duel(), [
        {"registration_id": "a", "score": 1, "rank": 1},
        {"registration_id": "b", "score": 3, "rank": 2},
    ])
    assert places(results) == {"a": 2, "b": 1}


def test_a_tie_in_a_table_stays_a_shared_place():
    results = normalize_v2_results(duel("group_A"), [
        {"registration_id": "a", "score": 2, "rank": 1},
        {"registration_id": "b", "score": 2, "rank": 2},
    ])
    assert places(results) == {"a": 1, "b": 1}


def test_several_who_gave_up_in_a_knockout_heat_keep_their_stated_places():
    results = normalize_v2_results(heat(["a", "b", "c", "d"]), [
        {"registration_id": "a", "rank": 1, "score": 12},
        {"registration_id": "b", "rank": 2, "score": 9},
        {"registration_id": "c", "rank": 3, "dnf": True},
        {"registration_id": "d", "rank": 4, "dnf": True},
    ])
    assert places(results) == {"a": 1, "b": 2, "c": 3, "d": 4}


@pytest.mark.parametrize("scores", [(2, 0), (2, 1)])
def test_best_of_three_accepts_a_decided_series(scores):
    results = normalize_v2_results(duel(), [
        {"registration_id": "a", "score": scores[0]},
        {"registration_id": "b", "score": scores[1]},
    ], best_of=3)
    assert places(results) == {"a": 1, "b": 2}


@pytest.mark.parametrize("scores", [(1, 0), (3, 0), (3, 2), (1.5, 0)])
def test_best_of_three_refuses_a_series_that_does_not_fit(scores):
    with pytest.raises(MatchV2ResultError, match="Best of 3"):
        normalize_v2_results(duel(), [
            {"registration_id": "a", "score": scores[0]},
            {"registration_id": "b", "score": scores[1]},
        ], best_of=3)


def test_where_the_lower_score_wins_the_score_counts_not_best_of():
    """Web und App geben dort den Stand ein (inputKind), kein Best-of - der Server dreht den Sieger nicht um."""
    results = normalize_v2_results(duel(calculation="lower_score"), [
        {"registration_id": "a", "score": 72},
        {"registration_id": "b", "score": 68},
    ], best_of=3)
    assert places(results) == {"a": 2, "b": 1}


def test_best_of_with_a_side_that_gave_up_or_did_not_show():
    gave_up = normalize_v2_results(duel(), [
        {"registration_id": "a", "rank": 1, "score": 1},
        {"registration_id": "b", "rank": 2, "score": 1, "dnf": True},
    ], best_of=3)
    assert places(gave_up) == {"a": 1, "b": 2}
    no_show = normalize_v2_results(duel(), [
        {"registration_id": "a", "rank": 1},
        {"registration_id": "b", "rank": 2, "forfeit": True},
    ], best_of=3)
    assert places(no_show) == {"a": 1, "b": 2}
    with pytest.raises(MatchV2ResultError, match="Best of 3"):
        normalize_v2_results(duel(), [
            {"registration_id": "a", "rank": 1, "score": 3},
            {"registration_id": "b", "rank": 2, "score": 0, "dnf": True},
        ], best_of=3)


def test_best_of_is_only_checked_for_duels_and_without_best_of():
    normalize_v2_results(duel(), [{"registration_id": "a", "score": 5}, {"registration_id": "b", "score": 0}])
    normalize_v2_results(duel(), [{"registration_id": "a", "score": 5}, {"registration_id": "b", "score": 0}], best_of=1)


def test_best_of_is_read_like_the_result_window():
    assert resolve_best_of({"best_of": 5}, {"settings": {"best_of": 3}}, {"best_of": 1}) == 5
    assert resolve_best_of({}, {"settings": {"best_of": 3}}, {"best_of": 1}) == 3
    assert resolve_best_of({}, None, {"best_of": 7}) == 7
    assert resolve_best_of({}, None, None) == 1
    assert resolve_best_of({"best_of": "kaputt"}, None, None) == 1


# ---------------------------------------------------------------- Web und App

def _client_cases():
    cases = json.loads(CASES.read_text(encoding="utf-8"))
    for group in ("score", "bestof", "winner", "order", "points"):
        for case in cases[group]:
            if "results" in case:
                yield pytest.param(group, case, id=f"{group}: {case['name']}")


@pytest.mark.parametrize("group,case", list(_client_cases()))
def test_what_web_and_app_send_is_accepted_with_the_same_places(group, case):
    data = case["input"]
    ids = data.get("sides") or data.get("all")
    match = heat(ids, section="group_A" if data.get("allowsDraw") else "WB",
                 calculation=data.get("mode") or "points")
    best_of = data.get("bestOf") if group == "bestof" else None
    results = normalize_v2_results(match, case["results"], best_of=best_of)
    assert places(results) == places(case["results"])


# ---------------------------------------------------------------- Korrektur nach Weiterleitung

def _source():
    return {
        "id": "m-a", "stage_id": "s1", "match_key": "A", "status": "completed",
        "results": [{"registration_id": "r1", "rank": 1}, {"registration_id": "r2", "rank": 2}],
        "slots": [
            {"slot": 1, "registration_id": "r1", "user_id": "u1", "status": "filled"},
            {"slot": 2, "registration_id": "r2", "user_id": "u2", "status": "filled"},
        ],
        "advancement": [{"flow": "W", "rank": 1, "to_match_id": "m-b", "to_match_key": "B", "to_slot": 1}],
    }


def _next(**fields):
    return {
        "id": "m-b", "stage_id": "s1", "match_key": "B", "status": "ready", "settings": {"min_players": 2},
        "slots": [
            {"slot": 1, "registration_id": "r1", "status": "filled", "source_result": {"from_match_id": "m-a", "rank": 1}},
            {"slot": 2, "registration_id": "r9", "status": "filled"},
        ],
        **fields,
    }


CORRECTED = [{"registration_id": "r2", "score": 2}, {"registration_id": "r1", "score": 1}]


def test_a_correction_lists_the_follow_up_it_resets_with_the_result_it_had():
    follow_up = _next(status="completed", results=[{"registration_id": "r1", "rank": 1}, {"registration_id": "r9", "rank": 2}],
                      reports=[{"registration_id": "r9", "results": []}], forfeit_registration_id="r9")
    application = build_v2_result_application(_source(), [_source(), follow_up], CORRECTED, actor_id="lead",
                                              now_iso="2026-10-13T12:00:00+00:00", force=True)
    reset = application["target_sets"]["m-b"]
    assert reset["results"] == [] and reset["status"] == "ready"
    assert reset["reports"] == [], "Meldungen gehörten zur alten Paarung"
    assert reset["forfeit_registration_id"] is None
    assert application["reset_matches"] == [{
        "id": "m-b", "match_key": "B", "status": "completed",
        "results": [{"registration_id": "r1", "rank": 1}, {"registration_id": "r9", "rank": 2}],
        "forfeit_registration_id": "r9",
    }]


def test_a_reset_follow_up_drops_start_call_and_marks_open_disputes_void():
    follow_up = _next(status="disputed", started_at="2026-10-13T10:00:00+00:00", called_at="2026-10-13T09:55:00+00:00",
                      status_before_dispute="in_progress", admin_decision_note="alt",
                      disputes=[{"reason": "alt", "resolved_at": "2026-10-13T09:00:00+00:00"}, {"reason": "offen"}])
    application = build_v2_result_application(_source(), [_source(), follow_up], CORRECTED, actor_id="lead",
                                              now_iso="2026-10-13T12:00:00+00:00", force=True)
    reset = application["target_sets"]["m-b"]
    assert reset["started_at"] is None and reset["called_at"] is None and reset["status_before_dispute"] is None
    assert reset["admin_decision_note"] is None and reset["status"] == "ready"
    assert reset["disputes"][0] == {"reason": "alt", "resolved_at": "2026-10-13T09:00:00+00:00"}
    assert reset["disputes"][1] == {"reason": "offen", "resolved_at": "2026-10-13T12:00:00+00:00", "decision": "void",
                                    "decision_note": "Paarung geändert"}


def test_a_new_pairing_before_the_start_also_drops_a_call():
    follow_up = _next(called_at="2026-10-13T09:55:00+00:00")
    application = build_v2_result_application(_source(), [_source(), follow_up], CORRECTED, actor_id="lead",
                                              now_iso="2026-10-13T12:00:00+00:00", force=True)
    assert application["target_sets"]["m-b"]["called_at"] is None


def test_a_new_pairing_drops_reports_of_the_old_one_even_before_it_started():
    follow_up = _next(reports=[{"registration_id": "r9", "results": []}])
    application = build_v2_result_application(_source(), [_source(), follow_up], CORRECTED, actor_id="lead",
                                              now_iso="2026-10-13T12:00:00+00:00", force=True)
    assert application["target_sets"]["m-b"]["reports"] == []
    assert application["reset_matches"] == []


def test_a_correction_waits_while_the_follow_up_has_a_result_in_its_undo_window():
    follow_up = _next(pending_result={"id": "hold-1"})
    with pytest.raises(MatchV2ResultError) as raised:
        build_v2_result_application(_source(), [_source(), follow_up], CORRECTED, actor_id="lead",
                                    now_iso="2026-10-13T12:00:00+00:00", force=True)
    assert raised.value.status_code == 409
