"""Liga-Termine (#2194, docs/LIGA.md D.1): Regeln, Grenzen und 72-h-Regel als Rechnung - feste Zeitpunkte, Wiener Zeit,
Sommerzeitwechsel (25.10.2026) und Sperrzeiten. Erfundene Werte."""
import pathlib
import sys
from datetime import datetime, timezone

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import league_schedule  # noqa: E402
from services.league_schedule import DEFAULTS, ScheduleProblem, normalize, request_refusal, rules_of, target_refusal  # noqa: E402
from services.league_schedule_sweep import home_rule_problem  # noqa: E402
from services.matchday_schedule import resolve_matchday_time, response_deadline, tournament_matchday_window  # noqa: E402


def utc(text: str) -> datetime:
    return datetime.fromisoformat(text).replace(tzinfo=timezone.utc)


# Spielwoche 1: Di 20.10. 00:00 (Sommerzeit) bis Di 27.10. 00:00 (Winterzeit) Wiener Zeit.
START = "2026-10-19T22:00:00+00:00"
HOME, AWAY = "reg-heim", "reg-gast"


def staffel(**fields) -> dict:
    return {"id": "t1", "league_context": {"league_id": "l", "season_id": "s", "staffel": "A"}, "format": "league",
            "start_date": START, "matchday_days": 7, "schedule_rules": dict(DEFAULTS), **fields}


def match(**fields) -> dict:
    return {"id": "m1", "tournament_id": "t1", "status": "scheduled", "matchday_number": 1, "round": 1,
            "slots": [{"registration_id": HOME}, {"registration_id": AWAY}], **fields}


def proposal(**fields) -> dict:
    return {"id": "p1", "match_id": "m1", "status": "pending", "actor_registration_id": HOME,
            "created_at": "2026-10-23T18:00:00+00:00", "scheduled_at": "2026-10-26T20:00:00+00:00", **fields}


# ---------------------------------------------------------------- Einstellung

def test_normalize_fills_defaults_and_checks_bounds():
    assert normalize({}) == DEFAULTS
    assert normalize({"reschedule_max": 0, "home_rule": False})["reschedule_max"] == 0
    for bad in ({"home_rule_hours": 0}, {"reschedule_max": 11}, {"reschedule_notice_hours": -1}, {"home_rule": "ja"},
                {"result_overdue_hours": 12, "result_reminder_hours": 24}, {"unbekannt": 1}, {"home_rule_hours": True}):
        with pytest.raises(ScheduleProblem) as problem:
            normalize(bad)
        assert problem.value.status_code == 422


def test_rules_only_for_staffeln_with_the_field():
    assert rules_of({"id": "t", "schedule_rules": dict(DEFAULTS)}) is None, "kein Liga-Turnier"
    assert rules_of({"id": "t", "league_context": {"league_id": "l"}}) is None, "Staffel von vorher"
    assert rules_of(staffel()) == DEFAULTS
    assert rules_of(staffel(schedule_rules={"home_rule_hours": 9999})) == DEFAULTS, "kaputter Wert sperrt nichts"


# ---------------------------------------------------------------- 72-h-Regel

def test_home_rule_deadline_counts_real_hours_over_the_clock_change():
    # Fr 23.10. 20:00 Sommerzeit + 72 h = Mo 26.10. 19:00 Winterzeit (18:00 UTC) - die doppelte Stunde zählt mit.
    due = response_deadline(staffel(), "2026-10-23T18:00:00+00:00", 72)
    assert due == utc("2026-10-26T18:00:00")
    t, m, p = staffel(), match(), proposal()
    assert home_rule_problem(t, m, p, DEFAULTS, utc("2026-10-26T17:59:00")) == "Frist läuft noch"
    assert home_rule_problem(t, m, p, DEFAULTS, utc("2026-10-26T18:00:00")) is None


def test_home_rule_needs_home_side_week_no_block_and_no_fixed_time():
    t, now = staffel(), utc("2026-10-26T18:00:00")
    assert home_rule_problem(t, match(), proposal(actor_registration_id=AWAY), DEFAULTS, now) == "nicht die Heimseite"
    assert home_rule_problem(t, match(), proposal(scheduled_at="2026-10-27T19:00:00+00:00"), DEFAULTS, now) == "nicht in der Spielwoche"
    assert home_rule_problem(t, match(), proposal(scheduled_at="2026-10-26T18:03:00+00:00"), DEFAULTS, now) == "Termin schon vorbei"
    fixed = match(scheduled_at="2026-10-22T18:00:00+00:00", schedule_source="manual")
    assert home_rule_problem(t, fixed, proposal(), DEFAULTS, now) == "Termin steht fest"
    assert home_rule_problem(t, match(), proposal(), {**DEFAULTS, "home_rule": False}, now) == "aus"
    assert home_rule_problem(t, match(status="completed"), proposal(), DEFAULTS, now) == "Spiel läuft oder ist entschieden"
    # Die Default-Quelle (Standardtermin) ist kein fester Termin.
    standard = match(scheduled_at="2026-10-25T19:00:00+00:00", schedule_source="default")
    assert home_rule_problem(t, standard, proposal(), DEFAULTS, now) is None


def test_home_rule_pauses_in_a_blocked_period():
    blocked = staffel(blocked_periods=[{"start_date": "2026-10-24", "end_date": "2026-10-24", "label": "Pause"}])
    # Fr 20:00 → Sa 00:00 4 h, Samstag gesperrt, So 25 h (Umstellung), Mo 24 h, Di 19 h: Di 27.10. 19:00 Wiener Zeit.
    assert response_deadline(blocked, "2026-10-23T18:00:00+00:00", 72) == utc("2026-10-27T18:00:00")
    assert home_rule_problem(blocked, match(), proposal(), DEFAULTS, utc("2026-10-26T18:00:00")) == "Frist läuft noch"
    in_break = proposal(scheduled_at="2026-10-24T18:00:00+00:00", created_at="2026-10-19T22:00:00+00:00")
    assert home_rule_problem(blocked, match(), in_break, DEFAULTS, utc("2026-10-23T20:00:00")) == "Sperrzeit"


def test_with_rules_an_open_home_offer_does_not_count_at_once():
    window = tournament_matchday_window(staffel(), 1)
    without = resolve_matchday_time(match(), [proposal()], window, tournament={**staffel(), "schedule_rules": None})
    assert without.source == "home", "ohne Regeln wie bisher: Heimrecht sofort"
    with_rules = resolve_matchday_time(match(), [proposal()], window, tournament=staffel())
    assert with_rules.source == "default"
    # So 25.10. 20:00 Winterzeit = 19:00 UTC - der Standardtermin bleibt Wanduhrzeit über die Umstellung.
    assert with_rules.scheduled_at == utc("2026-10-25T19:00:00")


# ---------------------------------------------------------------- Verschiebung: Grenzen

FIXED = {"scheduled_at": "2026-10-22T18:00:00+00:00", "schedule_source": "accepted"}  # Do 22.10. 20:00 Sommerzeit


def test_request_needs_fixed_time_and_respects_notice():
    rules = DEFAULTS
    assert "kein fester Termin" not in (request_refusal(match(**FIXED), rules, utc("2026-10-21T17:59:00")) or "")
    assert request_refusal(match(**FIXED), rules, utc("2026-10-21T17:59:00")) is None
    late = request_refusal(match(**FIXED), rules, utc("2026-10-21T18:01:00"))
    assert "24 Stunden" in late and "Mi 21.10. 20:00" in late and "@leitung" in late
    assert "noch kein fester Termin" in request_refusal(match(scheduled_at=FIXED["scheduled_at"], schedule_source="default"), rules,
                                                        utc("2026-10-20T10:00:00"))
    assert league_schedule.request_until(match(**FIXED), rules) == utc("2026-10-21T18:00:00")


def test_request_limits_count_and_open_request():
    now = utc("2026-10-20T10:00:00")
    assert "2-mal verschoben" in request_refusal(match(**FIXED, reschedule_count=2), DEFAULTS, now)
    assert "einmal verschoben" in request_refusal(match(**FIXED, reschedule_count=1), {**DEFAULTS, "reschedule_max": 1}, now)
    assert "nicht selbst" in request_refusal(match(**FIXED), {**DEFAULTS, "reschedule_max": 0}, now)
    assert "schon eine Verschiebung offen" in request_refusal(match(**FIXED, reschedule_requests=[{"id": "r", "status": "pending"}]),
                                                             DEFAULTS, now)
    assert league_schedule.remaining(match(**FIXED, reschedule_count=1), DEFAULTS) == 1


def test_target_must_stay_in_the_week_and_outside_breaks():
    t = staffel(blocked_periods=[{"start_date": "2026-10-23", "end_date": "2026-10-23", "label": "Pause"}])
    m = match(**FIXED)
    outside = target_refusal(t, m, DEFAULTS, utc("2026-10-27T19:00:00"))
    assert "Spielwoche" in outside and "Di 20.10. 00:00" in outside and "Mo 26.10. 23:59" in outside
    assert target_refusal(t, m, {**DEFAULTS, "reschedule_same_week": False}, utc("2026-10-27T19:00:00")) is None
    assert "nicht gespielt" in target_refusal(t, m, DEFAULTS, utc("2026-10-23T18:00:00"))
    assert "schon der geltende" in target_refusal(t, m, DEFAULTS, utc("2026-10-22T18:00:00"))
    assert target_refusal(t, m, DEFAULTS, utc("2026-10-26T20:00:00")) is None


def test_when_text_is_vienna_wall_time_on_both_sides_of_the_change():
    assert league_schedule.when_text("2026-10-24T18:00:00+00:00") == "Sa 24.10. 20:00"
    assert league_schedule.when_text("2026-10-26T19:00:00+00:00") == "Mo 26.10. 20:00"


def test_blocks_proposals_only_with_rules_and_fixed_time():
    assert league_schedule.blocks_proposals(staffel(), match(**FIXED))
    assert not league_schedule.blocks_proposals(staffel(schedule_rules=None), match(**FIXED))
    assert not league_schedule.blocks_proposals(staffel(), match(scheduled_at=FIXED["scheduled_at"], schedule_source="default"))
