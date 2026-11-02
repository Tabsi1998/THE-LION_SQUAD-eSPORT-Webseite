"""„Nicht erschienen?“ verschwindet mit der ersten Meldung (#2201, D-13).

Der Vorschlag gilt nur ohne Meldung (``match_deadlines.no_show_deadline``), Bestätigen gäbe 409. Die Karte darf dann nicht
stehen bleiben und „Ergebnis fehlt“ oder „Meldungen weichen ab“ verdecken.
"""
import pathlib
import sys
from datetime import timedelta

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from models import now_utc  # noqa: E402
from services.match_attention import attention_items  # noqa: E402


def ago(**delta) -> str:
    return (now_utc() - timedelta(**delta)).isoformat()

def attention_match(**fields) -> dict:
    return {"id": "m1", "status": "scheduled", "match_type": "duel", "match_key": "M1",
            "scheduled_at": ago(days=1), "no_show_proposal": {"id": "n1", "rule": "online", "minutes": 15, "due_at": ago(hours=3)},
            "slots": [{"registration_id": "a"}, {"registration_id": "b"}], **fields}


def kinds_of(match: dict, tournament: dict | None = None) -> list[str]:
    tournament = tournament or {"id": "t", "format": "single_elim", "event_mode": "online"}
    return [row["kind"] for row in attention_items(tournament, [match], [], {}, now_utc())]


def report(side: str, score: int) -> dict:
    return {"registration_id": side, "at": ago(minutes=5), "results": [{"registration_id": side, "rank": 1, "score": score}]}


def test_the_card_stays_without_a_report():
    assert kinds_of(attention_match()) == ["no_show"]


def test_a_report_replaces_the_card_with_result_missing():
    assert kinds_of(attention_match(reports=[report("a", 2)])) == ["result_missing"]


def test_conflicting_reports_replace_the_card_with_the_conflict():
    reports = [
        {"registration_id": "a", "at": ago(minutes=9), "results": [{"registration_id": "a", "rank": 1, "score": 2},
                                                                   {"registration_id": "b", "rank": 2, "score": 0}]},
        {"registration_id": "b", "at": ago(minutes=5), "results": [{"registration_id": "b", "rank": 1, "score": 2},
                                                                   {"registration_id": "a", "rank": 2, "score": 0}]},
    ]
    assert kinds_of(attention_match(reports=reports)) == ["report_conflict"]
