"""Live-Warteschlange (#1872): ein bereiter Lauf an einer freien Station hat die Prognose „jetzt“.

Gefunden bei #1858 (Probelauf-Cup vor Ort, daneben der Sofort-Cup mit denselben Spielern): Station frei, Lauf E bereit,
„Aufrufen“ da - aber als Prognose „ca. 19:08“. Der Planer zählte ein geplantes, noch nicht gestartetes Spiel des
Sofort-Cups als Belegung des Spielers.

Erwartung: Bereit und Station frei → jetzt. Was einen Spieler wirklich bindet (sein Spiel im anderen Turnier läuft oder
ist aufgerufen), verschiebt die Prognose weiter. Ein bloß geplantes fremdes Spiel nimmt dem bereiten Lauf den Platz
„jetzt“ nicht; für alles Spätere plant der Planer weiter darum herum - niemand steht doppelt im Plan, wo es sich
vermeiden lässt.
"""
import pathlib
import sys
from datetime import datetime, timedelta

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from services.match_scheduler import plan_schedule  # noqa: E402
from test_live_queue_waiting_heats_unit import (  # noqa: E402
    MINUTES, T0, assert_ready_first, callable_stations, cup, draw, nexts, participant_keys, queue, sofort_cup, stage,
    stations, tournament,
)

PAUSE = 5  # match_break_minutes im Probelauf-Cup


def at(value: str) -> datetime:
    return datetime.fromisoformat(value)


def entries(view: dict) -> dict[str, dict]:
    return {entry["match_key"]: entry for entry in view["matches"].values()}


# ---------------------------------------------------------------- bereit + frei = jetzt


def test_ready_heats_at_free_stations_are_due_now_beside_the_sofort_cup():
    matches = cup()
    view = queue(matches, 4, busy=sofort_cup(matches, "E", "F"))
    shown = nexts(view)
    assert len(callable_stations(view)) == 2
    for key in ("E", "F"):
        assert shown[key]["ready"], key
        assert at(shown[key]["forecast_at"]) == T0, f"{key}: bereit, Station frei - Prognose jetzt, nicht {shown[key]['forecast_at']}"
    # #1858 bleibt: die wartenden Läufe stehen an den anderen Stationen, nicht davor.
    assert shown["LA"]["waiting_for"] == "draw" and shown["LB"]["waiting_for"] == "draw"
    assert_ready_first(view)


def test_four_ready_heats_are_all_due_now():
    matches = cup()
    draw(matches, "LB:2")
    view = queue(matches, 4, busy=sofort_cup(matches, "E", "F", "LA", "LB"))
    shown = nexts(view)
    assert len(callable_stations(view)) == 4
    assert {key: at(entry["forecast_at"]) for key, entry in shown.items()} == {key: T0 for key in ("E", "F", "LA", "LB")}


def test_duels_are_due_now_as_well():
    matches = cup("duel")
    view = queue(matches, 4, busy=sofort_cup(matches, "E", "F"), match_type="duel")
    shown = nexts(view)
    assert at(shown["E"]["forecast_at"]) == T0 and at(shown["F"]["forecast_at"]) == T0


def test_the_planner_writes_now_for_a_ready_heat_at_a_free_station():
    """Dieselbe Rechnung hinter „Planen“ im Matchplan."""
    matches = cup()
    plan = plan_schedule(tournament(), matches, stations(4), stages=[stage("ffa")], now=T0,
                         busy_elsewhere=sofort_cup(matches, "E", "F"), participant_keys=participant_keys(matches))
    got = {item["match_key"]: item for item in plan["assignments"]}
    assert at(got["E"]["scheduled_at"]) == T0 and at(got["F"]["scheduled_at"]) == T0


# ---------------------------------------------------------------- was wirklich bindet, verschiebt weiter


def test_a_running_match_elsewhere_still_delays_the_heat():
    """Läuft das Spiel im Sofort-Cup schon, ist der Spieler nicht da - kein Doppelstart, die Prognose rückt nach hinten."""
    matches = cup()
    view = queue(matches, 4, busy=sofort_cup(matches, "E", state="running", offset=-2))
    entry = entries(view)["E"]
    assert at(entry["forecast_at"]) >= T0 + timedelta(minutes=-2 + MINUTES + PAUSE)


def test_a_called_match_elsewhere_still_delays_the_heat():
    """Aufgerufen heißt: der Spieler ist auf dem Weg zur Station des anderen Turniers - ab jetzt gebunden."""
    matches = cup()
    view = queue(matches, 4, busy=sofort_cup(matches, "E", state="called", offset=3))
    entry = entries(view)["E"]
    assert at(entry["forecast_at"]) >= T0 + timedelta(minutes=3 + MINUTES + PAUSE)


def test_without_a_state_a_foreign_match_counts_as_binding():
    """Wer den Zustand nicht mitgibt (ältere Aufrufer), bekommt das vorsichtige Verhalten von vorher."""
    matches = cup()
    busy = sofort_cup(matches, "E")
    for row in busy:
        row.pop("state")
    entry = entries(queue(matches, 4, busy=busy))["E"]
    assert at(entry["forecast_at"]) >= T0 + timedelta(minutes=10 + MINUTES + PAUSE)


def test_later_heats_still_avoid_a_planned_match_elsewhere():
    """Nicht doppelt verplant: Was nicht jetzt beginnen kann (eine Station, F kommt nach E), plant der Planer weiter um
    das geplante Spiel im Sofort-Cup herum."""
    matches = cup()
    view = queue(matches, 1, busy=sofort_cup(matches, "E", "F"))
    got = entries(view)
    first, second = sorted(("E", "F"), key=lambda key: got[key]["forecast_at"])
    assert at(got[first]["forecast_at"]) == T0, "der erste bereite Lauf beginnt jetzt"
    assert at(got[second]["forecast_at"]) >= T0 + timedelta(minutes=10 + MINUTES + PAUSE), \
        "der zweite kommt erst nach seinem Spiel im Sofort-Cup"
    assert_ready_first(view)
