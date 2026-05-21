import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from routes.match_routes import _score_report_resolution


def _match(**overrides):
    match = {
        "id": "match-1",
        "participant_a_id": "reg-a",
        "participant_b_id": "reg-b",
        "bracket": "winner",
    }
    match.update(overrides)
    return match


def _report(score_a, score_b, user_id):
    return {"score_a": score_a, "score_b": score_b, "user_id": user_id}


def test_score_report_resolution_waits_for_second_report():
    result = _score_report_resolution(_match(), [_report(2, 1, "u1")])

    assert result is None


def test_score_report_resolution_completes_when_last_two_reports_match():
    result = _score_report_resolution(
        _match(),
        [_report(2, 1, "u1"), _report(2, 1, "u2")],
    )

    assert result["status"] == "completed"
    assert result["score_a"] == 2
    assert result["score_b"] == 1
    assert result["winner_id"] == "reg-a"
    assert result["loser_id"] == "reg-b"


def test_score_report_resolution_marks_conflicting_reports_as_disputed():
    result = _score_report_resolution(
        _match(),
        [_report(2, 1, "u1"), _report(1, 2, "u2")],
    )

    assert result["status"] == "disputed"
    assert result["admin_note"].startswith("Abweichende Ergebnisberichte")
    assert "score_a" not in result
    assert "winner_id" not in result


def test_score_report_resolution_requires_winner_for_knockout_draw():
    result = _score_report_resolution(
        _match(),
        [_report(1, 1, "u1"), _report(1, 1, "u2")],
    )

    assert result["status"] == "disputed"
    assert result["score_a"] == 1
    assert result["score_b"] == 1
    assert result["winner_id"] is None
    assert result["loser_id"] is None
    assert result["admin_note"].startswith("Unentschieden gemeldet")


def test_score_report_resolution_allows_draws_in_group_matches():
    result = _score_report_resolution(
        _match(bracket="round_robin"),
        [_report(1, 1, "u1"), _report(1, 1, "u2")],
    )

    assert result["status"] == "completed"
    assert result["score_a"] == 1
    assert result["score_b"] == 1
    assert result["winner_id"] is None
    assert result["loser_id"] is None
