"""The scheduling rules the operator stated, one test per rule.

These are deliberately written as the rules read, not as the implementation is
structured: if a rule is ever changed, exactly one test should have to change
with it.
"""
from datetime import datetime, timedelta, timezone

import pytest

from services.matchday_schedule import (
    MatchdayScheduleError,
    default_time_in,
    duel_sides,
    home_registration_id,
    matchday_number_of,
    matchday_window,
    resolve_matchday_time,
    usable_proposals,
)


# Die Liga startet an einem Dienstag um 18:00 UTC.
TUESDAY = datetime(2026, 9, 8, 18, 0, tzinfo=timezone.utc)


def match(home="reg-home", away="reg-away"):
    return {"slots": [{"registration_id": home}, {"registration_id": away}]}


def proposal(actor, moment, status="pending", **extra):
    return {"id": f"p-{actor}-{moment.isoformat()}", "actor_registration_id": actor,
            "scheduled_at": moment.isoformat(), "status": status, **extra}


# ---------------------------------------------------------------- Die Woche

def test_a_matchday_is_one_week_from_the_start():
    window = matchday_window(TUESDAY, 1)

    assert window.start == TUESDAY
    assert window.end == TUESDAY + timedelta(days=7)


def test_the_weeks_follow_each_other_without_gap():
    first = matchday_window(TUESDAY, 1)
    second = matchday_window(TUESDAY, 2)

    assert second.start == first.end
    assert second.end == TUESDAY + timedelta(days=14)


def test_the_week_does_not_snap_to_monday():
    """Startet die Liga am Dienstag, laeuft die Woche Dienstag bis Dienstag."""
    window = matchday_window(TUESDAY, 1)

    assert window.start.weekday() == 1
    assert window.end.weekday() == 1


def test_a_missing_start_date_is_refused_instead_of_guessed():
    with pytest.raises(MatchdayScheduleError):
        matchday_window(None, 1)


def test_matchdays_are_counted_from_one():
    with pytest.raises(MatchdayScheduleError):
        matchday_window(TUESDAY, 0)


# ---------------------------------------------------------------- Heimrecht

def test_the_first_slot_is_the_home_side():
    assert duel_sides(match()) == ("reg-home", "reg-away")
    assert home_registration_id(match()) == "reg-home"


def test_the_classic_match_shape_is_understood_too():
    assert duel_sides({"participant_a_id": "a", "participant_b_id": "b"}) == ("a", "b")


def test_the_matchday_number_is_read_from_whichever_field_carries_it():
    assert matchday_number_of({"matchday_number": 3}) == 3
    assert matchday_number_of({"round": 2}) == 2
    assert matchday_number_of({"round": "0"}) is None
    assert matchday_number_of({}) is None


# ---------------------------------------------------------------- Standardzeit

def test_without_any_choice_the_default_time_applies():
    window = matchday_window(TUESDAY, 1)

    resolution = resolve_matchday_time(match(), [], window)

    assert resolution.source == "default"
    assert resolution.scheduled_at.weekday() == 6
    assert resolution.scheduled_at.hour == 20
    assert window.contains(resolution.scheduled_at)


def test_the_default_time_is_configurable():
    window = matchday_window(TUESDAY, 1)

    resolution = resolve_matchday_time(match(), [], window, weekday=4, hour=19, minute=30)

    assert resolution.scheduled_at.weekday() == 4
    assert (resolution.scheduled_at.hour, resolution.scheduled_at.minute) == (19, 30)


def test_a_default_day_outside_a_short_week_gives_no_answer():
    """Lieber keine Antwort als ein Termin ausserhalb des Spieltags."""
    window = matchday_window(TUESDAY, 1, days=2)

    assert default_time_in(window, weekday=6) is None
    assert resolve_matchday_time(match(), [], window) is None


def test_an_impossible_default_is_refused():
    window = matchday_window(TUESDAY, 1)

    with pytest.raises(MatchdayScheduleError):
        default_time_in(window, weekday=9)
    with pytest.raises(MatchdayScheduleError):
        default_time_in(window, hour=25)


# ---------------------------------------------------------------- Was gilt

def test_what_the_opponent_accepts_counts():
    window = matchday_window(TUESDAY, 1)
    agreed = TUESDAY + timedelta(days=2, hours=1)

    resolution = resolve_matchday_time(
        match(), [proposal("reg-away", agreed, status="accepted")], window)

    assert resolution.source == "accepted"
    assert resolution.scheduled_at == agreed


def test_an_accepted_time_beats_the_home_offer():
    window = matchday_window(TUESDAY, 1)
    agreed = TUESDAY + timedelta(days=2)
    home_wish = TUESDAY + timedelta(days=4)

    resolution = resolve_matchday_time(match(), [
        proposal("reg-home", home_wish),
        proposal("reg-away", agreed, status="accepted"),
    ], window)

    assert resolution.source == "accepted"
    assert resolution.scheduled_at == agreed


def test_the_home_side_decides_when_nothing_was_agreed():
    window = matchday_window(TUESDAY, 1)
    home_wish = TUESDAY + timedelta(days=3, hours=2)

    resolution = resolve_matchday_time(match(), [proposal("reg-home", home_wish)], window)

    assert resolution.source == "home"
    assert resolution.scheduled_at == home_wish


def test_the_home_side_also_beats_an_unanswered_away_offer():
    """Sonst waere das Heimrecht wertlos - die Rueckrunde dreht es ohnehin um."""
    window = matchday_window(TUESDAY, 1)
    home_wish = TUESDAY + timedelta(days=5)
    away_wish = TUESDAY + timedelta(days=1)

    resolution = resolve_matchday_time(match(), [
        proposal("reg-away", away_wish),
        proposal("reg-home", home_wish),
    ], window)

    assert resolution.source == "home"
    assert resolution.scheduled_at == home_wish


def test_an_away_offer_alone_does_not_bind_and_the_default_applies():
    window = matchday_window(TUESDAY, 1)

    resolution = resolve_matchday_time(
        match(), [proposal("reg-away", TUESDAY + timedelta(days=1))], window)

    assert resolution.source == "default"


def test_the_return_leg_hands_the_home_right_to_the_other_side():
    window = matchday_window(TUESDAY, 6)
    wish = window.start + timedelta(hours=3)

    # Hinrunde: reg-home ist Heim. Rueckrunde: die Seiten sind getauscht.
    first_leg = resolve_matchday_time(match(), [proposal("reg-home", wish)], window)
    return_leg = resolve_matchday_time(
        match(home="reg-away", away="reg-home"), [proposal("reg-home", wish)], window)

    assert first_leg.source == "home"
    assert return_leg.source == "default"


# ---------------------------------------------------------------- Ausgeschlossen

def test_a_time_in_the_wrong_week_cannot_decide_this_matchday():
    window = matchday_window(TUESDAY, 1)
    next_week = TUESDAY + timedelta(days=9)

    assert usable_proposals([proposal("reg-home", next_week)], window) == []
    assert resolve_matchday_time(match(), [proposal("reg-home", next_week)], window).source == "default"


@pytest.mark.parametrize("status", ["declined", "withdrawn", "countered"])
def test_settled_offers_no_longer_count(status):
    window = matchday_window(TUESDAY, 1)
    wish = TUESDAY + timedelta(days=2)

    resolution = resolve_matchday_time(
        match(), [proposal("reg-home", wish, status=status)], window)

    assert resolution.source == "default"


def test_a_naive_datetime_is_read_as_utc_instead_of_a_guessed_zone():
    window = matchday_window(TUESDAY.replace(tzinfo=None), 1)

    assert window.start == TUESDAY


def test_the_later_agreement_wins_after_a_counter_offer():
    window = matchday_window(TUESDAY, 1)
    first = TUESDAY + timedelta(days=1)
    later = TUESDAY + timedelta(days=4)

    resolution = resolve_matchday_time(match(), [
        proposal("reg-home", first, status="accepted", updated_at=TUESDAY.isoformat()),
        proposal("reg-away", later, status="accepted",
                 updated_at=(TUESDAY + timedelta(hours=5)).isoformat()),
    ], window)

    assert resolution.scheduled_at == later


# ---------------------------------------------------------------- Den geltenden Termin schreiben (#235)

from services.matchday_schedule import schedule_writes  # noqa: E402


def league(**extra):
    return {"id": "t1", "format": "league", "start_date": TUESDAY.isoformat(), **extra}


def fixture(match_id, number, **extra):
    return {"id": match_id, "tournament_id": "t1", "matchday_number": number, "status": "pending", **match(), **extra}


def test_the_default_time_is_written_with_its_source_and_only_once():
    writes = schedule_writes(league(), [fixture("m1", 1)], [])
    assert len(writes) == 1
    update = writes[0]["update"]
    assert update["schedule_source"] == "default" and update["status"] == "scheduled"
    assert datetime.fromisoformat(update["scheduled_at"]).weekday() == 6

    # Steht es schon so in der Partie, wird nichts geschrieben - der Lauf ist idempotent.
    written = fixture("m1", 1, scheduled_at=update["scheduled_at"], schedule_source="default", status="scheduled")
    assert schedule_writes(league(), [written], []) == []


def test_home_right_and_agreement_replace_the_default():
    window = matchday_window(TUESDAY, 1)
    home_time = window.start + timedelta(days=2)
    agreed = window.start + timedelta(days=3)
    stored = fixture("m1", 1, scheduled_at=default_time_in(window).isoformat(), schedule_source="default")

    only_home = schedule_writes(league(), [stored], [proposal("reg-home", home_time, match_id="m1")])
    assert only_home[0]["update"]["schedule_source"] == "home"
    assert only_home[0]["update"]["scheduled_at"] == home_time.isoformat()

    both = schedule_writes(league(), [stored], [proposal("reg-home", home_time, match_id="m1"), proposal("reg-away", agreed, status="accepted", match_id="m1")])
    assert both[0]["update"]["schedule_source"] == "accepted"
    assert both[0]["update"]["scheduled_at"] == agreed.isoformat()


def test_a_manual_time_and_a_finished_match_are_never_touched():
    window = matchday_window(TUESDAY, 1)
    manual = fixture("m1", 1, scheduled_at=(window.start + timedelta(days=1)).isoformat(), schedule_source="manual")
    done = fixture("m2", 1, status="completed")
    running = fixture("m3", 1, status="running", scheduled_at=None)
    assert schedule_writes(league(), [manual, done, running], []) == []


def test_formats_without_matchdays_get_nothing_written():
    assert schedule_writes({"id": "t", "format": "single_elim", "start_date": TUESDAY.isoformat()}, [fixture("m1", 1)], []) == []
