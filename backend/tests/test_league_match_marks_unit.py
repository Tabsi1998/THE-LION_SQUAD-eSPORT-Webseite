"""Kennzeichen je Spiel für die Staffel-Seite der Liga-Verwaltung (#2262, Paket B): Check-in, Veto, offene Vorfälle und offene
Verfahren als reines Lesefeld - dieselbe Rechnung wie Matchseite und Leitstand, nichts gespeichert. Erfundene Werte."""
import pathlib
import sys
from datetime import datetime, timezone

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.checkin_rules import DEFAULTS  # noqa: E402
from services.league_match_marks import match_marks  # noqa: E402

HOME, AWAY = "reg-heim", "reg-gast"
AT = "2026-11-20T18:00:00+00:00"


def utc(text: str) -> datetime:
    return datetime.fromisoformat(text).replace(tzinfo=timezone.utc)


def staffel(**fields) -> dict:
    return {"id": "t1", "league_context": {"league_id": "l", "season_id": "s", "staffel": "A"}, "format": "league",
            "status": "live", "checkin_rules": dict(DEFAULTS), **fields}


def match(**fields) -> dict:
    return {"id": "m1", "tournament_id": "t1", "status": "scheduled", "matchday_number": 1, "scheduled_at": AT,
            "slots": [{"slot": 1, "registration_id": HOME}, {"slot": 2, "registration_id": AWAY}], **fields}


def checked_in(*sides: str) -> dict:
    return {side: {"at": AT, "user_id": "u", "present": ["a", "b", "c"], "via": "side"} for side in sides}


def test_without_anything_nothing_is_marked():
    marks = match_marks(match(), staffel(checkin_rules=None), now=utc("2026-11-20T17:50:00"))
    assert marks == {"checkin": "none", "checked_in": 0, "veto": None, "incidents": 0, "procedures": 0}


def test_checkin_open_counts_the_sides_that_are_in():
    marks = match_marks(match(flow={"checkin": checked_in(HOME)}), staffel(), now=utc("2026-11-20T17:50:00"))
    assert marks["checkin"] == "open"
    assert marks["checked_in"] == 1


def test_checkin_window_over_with_a_side_missing_is_closed():
    marks = match_marks(match(flow={"checkin": checked_in(AWAY)}), staffel(), now=utc("2026-11-20T18:30:00"))
    assert marks["checkin"] == "closed"
    assert marks["checked_in"] == 1


def test_running_veto_is_named():
    marks = match_marks(match(flow={"checkin": checked_in(HOME, AWAY), "veto": {"status": "running", "step": 2}}), staffel(),
                        now=utc("2026-11-20T17:55:00"))
    assert marks["veto"] == "running"
    assert marks["checked_in"] == 2


def test_open_incidents_and_procedures_are_counted_closed_ones_not():
    row = match(status="in_progress",
                incidents=[{"id": "i1", "state": "proposed"}, {"id": "i2", "state": "decided"}],
                disputes=[{"id": "p1", "kind": "protest", "state": "open"}, {"id": "p2", "kind": "objection", "state": "withdrawn"},
                          {"reason": "alter Streitfall ohne Verfahren"}])
    marks = match_marks(row, staffel(), now=utc("2026-11-20T18:10:00"))
    assert marks["incidents"] == 1
    assert marks["procedures"] == 1
    assert marks["checkin"] == "running"


def test_an_ended_match_has_no_open_incident_any_more():
    row = match(status="completed", incidents=[{"id": "i1", "state": "proposed"}])
    assert match_marks(row, staffel(), now=utc("2026-11-21T10:00:00"))["incidents"] == 0
