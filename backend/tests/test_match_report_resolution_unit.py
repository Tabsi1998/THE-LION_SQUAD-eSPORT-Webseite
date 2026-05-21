import pathlib
import sys
import asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from routes.match_routes import _audit_match_action, _score_report_resolution


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
    return {
        "score_a": score_a,
        "score_b": score_b,
        "user_id": user_id,
        "registration_id": f"reg-{user_id}",
    }


def test_score_report_resolution_waits_for_second_report():
    result = _score_report_resolution(_match(), [_report(2, 1, "u1")])

    assert result is None


def test_score_report_resolution_ignores_duplicate_reports_from_same_participant():
    result = _score_report_resolution(
        _match(),
        [_report(2, 1, "u1"), _report(2, 1, "u1")],
    )

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


def test_score_report_resolution_uses_latest_report_per_participant():
    result = _score_report_resolution(
        _match(),
        [_report(2, 1, "u1"), _report(1, 2, "u2"), _report(1, 2, "u1")],
    )

    assert result["status"] == "completed"
    assert result["winner_id"] == "reg-b"


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


def test_audit_match_action_records_context():
    db = _FakeDb()

    asyncio.run(_audit_match_action(
        db,
        "match.result.report",
        _match(tournament_id="t1", stage_id="s1", match_key="A1"),
        "user-1",
        {"score_a": 2, "score_b": 0},
    ))

    doc = db.audit_logs.docs[0]
    assert doc["action"] == "match.result.report"
    assert doc["target_id"] == "t1"
    assert doc["actor_id"] == "user-1"
    assert doc["data"]["match_id"] == "match-1"
    assert doc["data"]["stage_id"] == "s1"
    assert doc["data"]["match_key"] == "A1"
    assert doc["data"]["score_a"] == 2
    assert doc["data"]["score_b"] == 0


class _FakeAuditLogs:
    def __init__(self):
        self.docs = []

    async def insert_one(self, doc):
        self.docs.append(doc)


class _FakeDb:
    def __init__(self):
        self.audit_logs = _FakeAuditLogs()
