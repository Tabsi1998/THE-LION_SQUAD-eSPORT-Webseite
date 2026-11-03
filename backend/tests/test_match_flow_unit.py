"""Liga-Check-in (#1652, docs/LIGA.md D.2): Regeln, Fenster und Stand als reine Rechnung - feste Zeitpunkte, Wiener Zeit,
Sommerzeitwechsel (25.10.2026), Verlängerung der Leitung. Erfundene Werte."""
import pathlib
import sys
from datetime import datetime, timezone

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import match_flow  # noqa: E402
from services.match_deadlines import no_show_deadline, no_show_due_text  # noqa: E402
from services.match_flow import DEFAULTS, FlowProblem, defaults_for_season, normalize, rules_of, side_refusal, state, window_of  # noqa: E402


def utc(text: str) -> datetime:
    return datetime.fromisoformat(text).replace(tzinfo=timezone.utc)


HOME, AWAY = "reg-heim", "reg-gast"
# So 25.10.2026 02:45 Sommerzeit = 00:45 UTC; um 01:00 UTC springt die Uhr von 03:00 auf 02:00.
AT = "2026-10-25T00:45:00+00:00"


def staffel(**fields) -> dict:
    return {"id": "t1", "league_context": {"league_id": "l", "season_id": "s", "staffel": "A"}, "format": "league",
            "status": "live", "checkin_rules": dict(DEFAULTS), **fields}


def match(**fields) -> dict:
    return {"id": "m1", "tournament_id": "t1", "status": "scheduled", "matchday_number": 1, "scheduled_at": AT,
            "slots": [{"slot": 1, "registration_id": HOME}, {"slot": 2, "registration_id": AWAY}], **fields}


def done(*sides: str) -> dict:
    return {"checkin": {side: {"at": AT, "user_id": "u", "present": ["a", "b", "c"], "via": "side"} for side in sides}}


# ---------------------------------------------------------------- Einstellung

def test_normalize_fills_defaults_and_checks_bounds():
    assert normalize({}) == DEFAULTS
    assert normalize({"min_present": 1, "closes_minutes_after": 0})["min_present"] == 1
    for bad in ({"opens_minutes_before": 0}, {"closes_minutes_after": 241}, {"min_present": 51}, {"min_present": "3"},
                {"remind_minutes_before_close": -1}, {"unbekannt": 1}, {"min_present": True}):
        with pytest.raises(FlowProblem) as problem:
            normalize(bad)
        assert problem.value.status_code == 422


def test_defaults_follow_the_participant_list_or_the_team_size():
    assert defaults_for_season({"lineup_mode": "series", "lineup_min_players": 3, "team_size": 5})["min_present"] == 3
    assert defaults_for_season({"lineup_mode": "per_map", "team_size": 4})["min_present"] == 3, "Regelwerk: 3 bei 4 gegen 4"
    assert defaults_for_season({"team_size": 1})["min_present"] == 1
    assert defaults_for_season({})["min_present"] == DEFAULTS["min_present"]
    assert defaults_for_season({"team_size": 4})["opens_minutes_before"] == 15


def test_rules_only_for_staffeln_with_the_field():
    assert rules_of({"id": "t", "checkin_rules": dict(DEFAULTS)}) is None, "kein Liga-Turnier"
    assert rules_of({"id": "t", "league_context": {"league_id": "l"}}) is None, "Staffel von vorher"
    assert rules_of(staffel()) == DEFAULTS
    assert rules_of(staffel(checkin_rules={"min_present": 999})) == DEFAULTS, "kaputter Wert sperrt nichts"


# ---------------------------------------------------------------- Fenster

def test_window_counts_minutes_over_the_clock_change():
    opens, closes = window_of(match(), DEFAULTS)
    assert opens == utc("2026-10-25T00:30:00") and closes == utc("2026-10-25T01:00:00")
    # Wanduhr: 02:30 Sommerzeit öffnet, 02:00 Winterzeit schließt - die Stunde dazwischen gibt es zweimal, das Fenster bleibt 30 Minuten.
    assert match_flow.clock_text(opens) == "02:30" and match_flow.clock_text(closes) == "02:00"
    assert window_of(match(scheduled_at=None), DEFAULTS) is None


def test_the_lead_extension_moves_the_end():
    _opens, closes = window_of(match(no_show_extended_until="2026-10-25T01:20:00+00:00"), DEFAULTS)
    assert closes == utc("2026-10-25T01:20:00")
    _opens, unchanged = window_of(match(no_show_extended_until="2026-10-25T00:50:00+00:00"), DEFAULTS)
    assert unchanged == utc("2026-10-25T01:00:00"), "eine Verlängerung vor dem Ende ändert nichts"


# ---------------------------------------------------------------- Stand

def test_state_follows_the_window_and_the_sides():
    t = staffel()
    assert state(match(), t, utc("2026-10-25T00:29:00")) == match_flow.WAITING
    assert state(match(), t, utc("2026-10-25T00:30:00")) == match_flow.OPEN
    assert state(match(), t, utc("2026-10-25T00:59:59")) == match_flow.OPEN
    assert state(match(), t, utc("2026-10-25T01:00:00")) == match_flow.CLOSED
    assert state(match(flow=done(HOME)), t, utc("2026-10-25T00:40:00")) == match_flow.OPEN
    assert state(match(flow=done(HOME, AWAY)), t, utc("2026-10-25T00:20:00")) == match_flow.READY, "beide da: spielbereit, auch vor dem Termin"
    assert state(match(flow=done(HOME, AWAY), started_at=AT), t, utc("2026-10-25T00:50:00")) == match_flow.RUNNING
    assert state(match(status="in_progress"), t, utc("2026-10-25T00:50:00")) == match_flow.RUNNING
    assert state(match(status="forfeit"), t, utc("2026-10-25T00:50:00")) == match_flow.FINISHED
    # Neuer Termin (E.1 „Neu ansetzen“, Leitung): ein Check-in von früher zählt nicht mehr - ohne ``for_at`` (Altbestand) gilt er weiter.
    dated = {"checkin": {HOME: {"present": ["a", "b", "c"], "via": "side", "for_at": AT},
                         AWAY: {"present": ["x", "y", "z"], "via": "side", "for_at": "2026-10-24T00:45:00+00:00"}}}
    assert match_flow.missing_sides(match(flow=dated)) == [AWAY]
    assert match_flow.missing_sides(match(flow=dated, scheduled_at="2026-10-26T18:00:00+00:00")) == [HOME, AWAY]
    assert match_flow.missing_sides(match(flow=done(HOME, AWAY), scheduled_at="2026-10-26T18:00:00+00:00")) == []
    assert state(match(scheduled_at=None), t, utc("2026-10-25T00:50:00")) == match_flow.NO_TIME
    assert state(match(), staffel(checkin_rules=None), utc("2026-10-25T00:50:00")) == match_flow.NONE
    assert state(match(slots=[{"slot": 1, "registration_id": HOME}]), t, utc("2026-10-25T00:50:00")) == match_flow.NONE
    assert state(match(is_preview=True), t, utc("2026-10-25T00:50:00")) == match_flow.NONE


def test_missing_sides_ignore_checkins_of_sides_that_left():
    gone = match(flow={"checkin": {"reg-weg": {"present": ["a"], "via": "side"}}})
    assert match_flow.missing_sides(gone) == [HOME, AWAY]
    assert match_flow.missing_sides(match(flow=done(AWAY))) == [HOME]


def test_side_refusal_names_the_window_in_vienna_time():
    t, rules = staffel(), DEFAULTS
    early = side_refusal(match(), t, rules, utc("2026-10-25T00:00:00"))
    assert "öffnet erst um So 25.10. 02:30" in early and "15 Minuten" in early
    late = side_refusal(match(), t, rules, utc("2026-10-25T01:00:00"))
    assert "seit So 25.10. 02:00 geschlossen" in late and "Liga-Leitung" in late and "@leitung" in late
    assert side_refusal(match(), t, rules, utc("2026-10-25T00:45:00")) is None
    assert side_refusal(match(started_at=AT), t, rules, utc("2026-10-25T00:45:00")) == match_flow.STARTED_DETAIL
    assert side_refusal(match(reports=[{"registration_id": HOME}]), t, rules, utc("2026-10-25T00:45:00")) == match_flow.REPORTED_DETAIL
    assert side_refusal(match(scheduled_at=None), t, rules, utc("2026-10-25T00:45:00")) == match_flow.NO_TIME_DETAIL


def test_start_refusal_for_every_state():
    assert "beide Seiten eingecheckt" in match_flow.start_refusal(match_flow.OPEN)
    assert "läuft schon" in match_flow.start_refusal(match_flow.RUNNING)
    assert "Veto" in match_flow.start_refusal(match_flow.VETO)
    assert match_flow.start_refusal(match_flow.NO_TIME) == match_flow.NO_TIME_DETAIL
    assert match_flow.veto_pending(match(), staffel()) is False, "Haken für D.3"


# ---------------------------------------------------------------- Vorschlag an die Leitung (nie eine Wertung)

def test_no_show_info_only_after_the_window_with_a_missing_side():
    t = staffel()
    assert no_show_deadline(match(), t) == {"rule": "check_in", "minutes": 15, "base_at": utc("2026-10-25T00:45:00"),
                                            "due_at": utc("2026-10-25T01:00:00"), "missing": [HOME, AWAY]}
    assert no_show_deadline(match(flow=done(HOME)), t)["missing"] == [AWAY]
    assert no_show_deadline(match(flow=done(HOME, AWAY)), t) is None, "beide da: kein Vorschlag"
    assert no_show_deadline(match(started_at=AT), t) is None, "ein laufendes Spiel ist kein Nichtantritt"
    assert no_show_deadline(match(status="in_progress"), t) is None
    assert no_show_deadline(match(reports=[{"registration_id": HOME}]), t) is None
    assert no_show_deadline(match(scheduled_at=None), t) is None
    assert no_show_deadline(match(), staffel(checkin_rules=None)) is None, "Staffel ohne Check-in wie seit #2201"
    extended = no_show_deadline(match(no_show_extended_until="2026-10-25T01:30:00+00:00"), t)
    assert extended["due_at"] == utc("2026-10-25T01:30:00")
    info = no_show_deadline(match(), t)
    assert no_show_due_text(match(), info) == "Check-in bis 02:00 abgelaufen"
    assert no_show_due_text(match(no_show_extended_until="2026-10-25T01:30:00+00:00"), extended) == "Verlängerung bis 02:30 abgelaufen"
