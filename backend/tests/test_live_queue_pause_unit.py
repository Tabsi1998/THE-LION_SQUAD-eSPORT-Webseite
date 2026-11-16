"""Warteschlange und Planer rechnen die Turnierpause heraus (#2398, Folge #1167).

Die Spielzeit-Uhr hält in der Pause an. Das Ende eines laufenden Spiels ist deshalb Start plus Dauer plus Pausenzeit:
frühere Pausen (``paused_seconds``) und, solange das Turnier pausiert, die laufende (``paused_at``) - dieselbe Rechnung
wie ``match_timing.timing``. Ohne Pause bleibt alles wie bisher.
"""

from datetime import timedelta

from services.match_scheduler import plan_schedule
from services.match_timing import timing
from test_live_queue_unit import T0, at, duel, eight, queue, station, tournament


def running_end(matches, now, **tournament_fields) -> str:
    plan = plan_schedule(tournament(**tournament_fields), matches, [station("st1", "1", status="busy",
                                                                            current_match_id=matches[0]["id"])], now=now)
    held = {item["match_id"]: item for item in plan["held"]}
    return held[matches[0]["id"]]["end"]


def test_without_a_pause_the_running_match_ends_after_its_duration():
    match = duel("A", "r1", "r2", status="in_progress", started_at=at(0), station_id="st1")
    assert running_end([match], T0 + timedelta(minutes=10)) == at(30)


def test_an_earlier_pause_moves_the_end_of_a_running_match():
    match = duel("A", "r1", "r2", status="in_progress", started_at=at(0), station_id="st1", paused_seconds=600)
    assert running_end([match], T0 + timedelta(minutes=15)) == at(40)


def test_a_running_pause_moves_the_end_while_it_lasts():
    match = duel("A", "r1", "r2", status="in_progress", started_at=at(0), station_id="st1")
    now = T0 + timedelta(minutes=35)
    end = running_end([match], now, status="paused", paused_at=at(20))
    assert end == at(45), "15 Minuten Pause bisher - die Uhr steht bei 20 von 30"
    paused_tournament = tournament(status="paused", paused_at=at(20))
    assert timing(match, paused_tournament, now)["due_at"] > end, "dieselbe Rechnung wie die Spielzeit-Uhr"


def test_several_pauses_add_up():
    match = duel("A", "r1", "r2", status="in_progress", started_at=at(0), station_id="st1", paused_seconds=300)
    assert running_end([match], T0 + timedelta(minutes=30), status="paused", paused_at=at(20)) == at(45)


def test_a_match_started_during_the_pause_counts_the_pause_only_from_its_start():
    match = duel("A", "r1", "r2", status="in_progress", started_at=at(10), station_id="st1")
    assert running_end([match], T0 + timedelta(minutes=20), status="paused", paused_at=at(5)) == at(50)


def test_a_pause_that_ended_without_playing_on_does_not_hold_the_clock():
    """``paused_at`` bleibt nach einem Abschluss aus der Pause stehen - es zählt nur, solange das Turnier pausiert."""
    match = duel("A", "r1", "r2", status="in_progress", started_at=at(0), station_id="st1")
    assert running_end([match], T0 + timedelta(minutes=20), status="live", paused_at=at(5)) == at(30)


def test_the_queue_moves_the_end_and_the_next_forecasts_after_a_pause():
    matches = eight()
    matches[0].update(status="in_progress", started_at=at(0), paused_seconds=600)
    matches[1].update(status="in_progress", started_at=at(0), paused_seconds=600)
    stations = [
        station("st1", "1", status="busy", current_match_id="id-QF1"),
        station("st2", "2", status="busy", current_match_id="id-QF2"),
    ]
    view = queue(matches, stations, T0 + timedelta(minutes=20))
    first, second = view["stations"]
    assert first["running"]["ends_at"] == at(40), "Start plus 30 Minuten plus 10 Minuten Pause"
    assert first["next"]["forecast_at"] == at(40), "„ca. …“ für als Nächstes rückt mit"
    assert second["next"]["forecast_at"] == at(40)

    unpaused = eight()
    unpaused[0].update(status="in_progress", started_at=at(0))
    unpaused[1].update(status="in_progress", started_at=at(0))
    before = queue(unpaused, stations, T0 + timedelta(minutes=20))
    assert view["summary"]["ends_at"] > before["summary"]["ends_at"], "das Finale rückt nach hinten"


def test_the_queue_counts_a_running_pause_for_the_running_match():
    matches = eight()
    matches[0].update(status="in_progress", started_at=at(0))
    stations = [station("st1", "1", status="busy", current_match_id="id-QF1"), station("st2", "2")]
    view = queue(matches, stations, T0 + timedelta(minutes=25), tournament={"status": "paused", "paused_at": at(15)})
    assert view["matches"]["id-QF1"]["ends_at"] == at(40)
    assert view["matches"]["id-QF1"]["paused_at"] == at(15)
