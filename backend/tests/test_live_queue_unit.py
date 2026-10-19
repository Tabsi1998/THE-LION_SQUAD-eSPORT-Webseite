"""Live vor Ort (#1556): die Warteschlange je Station - reine Rechnung, ohne Datenbank.

Entscheidung E1: Der Plan ist die Prognose, die Warteschlange entscheidet. Je Station steht, was läuft, was als
Nächstes kommt und was danach; je Spiel die Prognose („ca. 18:40“) und der Verzug gegenüber der geplanten Zeit.
Gerechnet wird mit dem Spielplaner selbst (``plan_schedule``) ab jetzt - es gibt keine zweite Planlogik.
"""

from datetime import datetime, timedelta, timezone

from services.live_queue import build_live_queue
from services.match_scheduler import DEFAULT_BREAK_MINUTES, plan_schedule

T0 = datetime(2026, 10, 31, 10, 0, tzinfo=timezone.utc)
PAUSE = DEFAULT_BREAK_MINUTES


def tournament(**extra):
    return {
        "id": "t1",
        "format": "single_elim",
        "event_mode": "local",
        "schedule_mode": "fixed_by_staff",
        "start_date": T0.isoformat(),
        "match_duration_minutes": 30,
        **extra,
    }


def station(sid, name, **extra):
    return {
        "id": sid,
        "name": name,
        "device_type": "switch2",
        "tournament_id": "t1",
        "status": "free",
        "current_match_id": None,
        "notes": "Kabel hinten",
        **extra,
    }


def slot(index, value):
    if isinstance(value, dict):
        return {"slot": index, "source": value, "registration_id": None, "status": "pending"}
    return {
        "slot": index,
        "source": {"type": "seed", "seed": index},
        "registration_id": value,
        "user_id": f"u-{value}",
        "status": "filled",
    }


def duel(key, a, b, *, round_number=1, order=1, status="scheduled", **extra):
    return {
        "id": f"id-{key}",
        "tournament_id": "t1",
        "stage_id": "s1",
        "stage_number": 1,
        "match_key": key,
        "section": "MAIN",
        "round": round_number,
        "order": order,
        "status": status,
        "match_type": "duel",
        "slots": [slot(1, a), slot(2, b)],
        "settings": {"min_players": 2},
        **extra,
    }


def winner(key):
    return {"type": "rank", "flow": "W", "match_key": key, "rank": 1}


def at(minutes: int) -> str:
    return (T0 + timedelta(minutes=minutes)).isoformat()


def eight():
    """K.-o. mit 8: vier Viertelfinale, zwei Halbfinale, Finale - der Plan wie „Übernehmen“ ihn geschrieben hat."""
    return [
        duel("QF1", "r1", "r8", order=1, scheduled_at=at(0), station_id="st1", schedule_source="planner"),
        duel("QF2", "r2", "r7", order=2, scheduled_at=at(0), station_id="st2", schedule_source="planner"),
        duel("QF3", "r3", "r6", order=3, scheduled_at=at(35), station_id="st1", schedule_source="planner"),
        duel("QF4", "r4", "r5", order=4, scheduled_at=at(35), station_id="st2", schedule_source="planner"),
        duel(
            "SF1",
            winner("QF1"),
            winner("QF3"),
            round_number=2,
            order=1,
            status="pending",
            scheduled_at=at(70),
            station_id="st1",
            schedule_source="planner",
        ),
        duel(
            "SF2",
            winner("QF2"),
            winner("QF4"),
            round_number=2,
            order=2,
            status="pending",
            scheduled_at=at(70),
            station_id="st2",
            schedule_source="planner",
        ),
        duel(
            "F",
            winner("SF1"),
            winner("SF2"),
            round_number=3,
            order=1,
            status="pending",
            scheduled_at=at(105),
            station_id="st1",
            schedule_source="planner",
        ),
    ]


NAMES = {f"r{index}": f"Spieler {index}" for index in range(1, 9)}


def queue(matches, stations, now, **extra):
    return build_live_queue(tournament(**extra.pop("tournament", {})), matches, stations, now=now, names=NAMES, **extra)


# ---------------------------------------------------------------- Planer: ein Aufruf bleibt an seiner Station


def test_the_planner_keeps_a_called_match_at_its_station():
    """Ist ein Spiel an Station 2 aufgerufen, verschiebt kein „Planen“ es an eine andere Station."""
    matches = [duel("A", "r1", "r2", order=1, station_id="st2", called_at=at(0)), duel("B", "r3", "r4", order=2)]
    plan = plan_schedule(tournament(), matches, [station("st1", "1"), station("st2", "2")], now=T0)
    assert [item["match_id"] for item in plan["assignments"]] == ["id-B"], "der Aufruf wird nicht neu verteilt"
    assert plan["assignments"][0]["station_id"] == "st1", "Station 2 ist durch den Aufruf belegt"


# ---------------------------------------------------------------- Läuft, als Nächstes, danach


def test_each_station_shows_running_next_and_after():
    matches = eight()
    matches[0].update(status="in_progress", started_at=at(0))
    matches[1].update(status="in_progress", started_at=at(0))
    stations = [
        station("st1", "1", status="busy", current_match_id="id-QF1"),
        station("st2", "2", status="busy", current_match_id="id-QF2"),
    ]
    view = queue(matches, stations, T0 + timedelta(minutes=10))
    assert view["applies"] is True
    first, second = view["stations"]
    assert first["station_text"] == "Station 1 · Switch 2" and "notes" not in first
    assert first["running"]["match_id"] == "id-QF1" and first["running"]["state"] == "running"
    assert first["running"]["names"] == ["Spieler 1", "Spieler 8"]
    assert first["next"]["match_id"] in {"id-QF3", "id-QF4"} and second["next"]["match_id"] in {"id-QF3", "id-QF4"}
    assert first["next"]["match_id"] != second["next"]["match_id"]
    # QF3/QF4 starten, wenn die Viertelfinale vorbei sind (30 Min.) plus Pause der Spieler gilt nicht - andere Spieler.
    assert first["next"]["forecast_at"] == at(30)
    assert {first["after"]["match_id"], second["after"]["match_id"]} == {"id-SF1", "id-SF2"}
    assert first["after"]["forecast"] is True and first["after"]["names"] == [], "die Plätze stehen noch nicht fest"
    assert view["matches"]["id-F"]["state"] == "queued"


def test_an_entry_says_whether_it_is_a_heat():
    """Ein Lauf (mehr als zwei Plätze) ist als solcher markiert - die Stationen nennen dann Durchgang und Namen (#1824)."""
    heat = duel("A", "r1", "r2", match_type="ffa", settings={"min_players": 2})
    heat["slots"] = [slot(1, "r1"), slot(2, "r2"), slot(3, "r3"), slot(4, "r4")]
    view = queue([heat, duel("B", "r5", "r6", order=2)], [station("st1", "1"), station("st2", "2")], T0)
    assert view["matches"]["id-A"]["heat"] is True
    assert view["matches"]["id-A"]["names"] == ["Spieler 1", "Spieler 2", "Spieler 3", "Spieler 4"]
    assert view["matches"]["id-B"]["heat"] is False


def test_the_next_match_depends_only_on_its_own_lines_not_on_the_whole_round():
    """SF1 wartet auf QF1 und QF3 - nicht auf QF2/QF4. Läuft QF2 lang, verschiebt das SF1 nicht."""
    matches = eight()
    for index in (0, 2):
        matches[index].update(status="completed")
    matches[4]["slots"] = [slot(1, "r1"), slot(2, "r3")]
    matches[1].update(status="in_progress", started_at=at(30))
    now = T0 + timedelta(minutes=40)
    stations = [station("st1", "1"), station("st2", "2", status="busy", current_match_id="id-QF2"), station("st3", "3")]
    view = queue(matches, stations, now)
    sf1 = view["matches"]["id-SF1"]
    assert sf1["ready"] is True and sf1["forecast_at"] == now.isoformat(), "SF1 kann sofort an eine freie Station"
    assert sf1["position"] == 1
    sf2 = view["matches"]["id-SF2"]
    assert sf2["ready"] is False and sf2["forecast_at"] >= at(
        60 + PAUSE
    ), "SF2 wartet auf seine eigenen Linien (QF2, QF4)"


def test_a_called_match_is_next_with_its_report_time():
    matches = eight()
    matches[0].update(status="in_progress", started_at=at(0))
    matches[1].update(status="scheduled", called_at=at(1))
    stations = [
        station("st1", "1", status="busy", current_match_id="id-QF1"),
        station("st2", "2", status="reserved", current_match_id="id-QF2", called_at=at(1)),
    ]
    view = queue(matches, stations, T0 + timedelta(minutes=2), report_minutes=2)
    called = view["stations"][1]["next"]
    assert called["match_id"] == "id-QF2" and called["state"] == "called"
    assert called["called_at"] == at(1) and called["report_by"] == at(3)
    assert called["no_show_due_at"] == at(11), "vor Ort 10 Minuten ab dem Aufruf (E6)"


# ---------------------------------------------------------------- Verzug


def test_delay_moves_every_later_forecast_and_names_the_final():
    """Die Viertelfinale haben 20 Minuten zu spät begonnen: alles danach rückt nach, das Finale auch."""
    matches = eight()
    matches[0].update(status="in_progress", started_at=at(20))
    matches[1].update(status="in_progress", started_at=at(20))
    stations = [
        station("st1", "1", status="busy", current_match_id="id-QF1"),
        station("st2", "2", status="busy", current_match_id="id-QF2"),
    ]
    view = queue(matches, stations, T0 + timedelta(minutes=25))
    assert view["matches"]["id-QF1"]["delay_minutes"] == 20
    assert view["matches"]["id-QF3"]["forecast_at"] == at(50) and view["matches"]["id-QF3"]["delay_minutes"] == 15
    final = view["matches"]["id-F"]
    assert final["planned_at"] == at(105) and final["delay_minutes"] > 0
    summary = view["summary"]
    assert summary["last"]["match_id"] == "id-F" and summary["last"]["forecast_at"] == final["forecast_at"]
    assert summary["delay_minutes"] == final["delay_minutes"]


def test_a_running_match_over_its_time_pushes_the_queue_to_now():
    matches = eight()
    matches[0].update(status="in_progress", started_at=at(0))
    stations = [station("st1", "1", status="busy", current_match_id="id-QF1"), station("st2", "2")]
    now = T0 + timedelta(minutes=45)
    view = queue(matches, stations, now)
    running = view["stations"][0]["running"]
    assert running["ends_at"] == at(30) and running["duration_minutes"] == 30
    assert view["stations"][0]["next"]["forecast_at"] >= now.isoformat()


def test_a_ready_match_goes_to_the_free_station_not_behind_a_busy_one():
    """#1791: Station 1 überzieht (läuft noch), Station 2 ist frei - das bereite Spiel kommt an Station 2, nicht dahinter.

    Für den Planer ist die überzogene Station „ab jetzt“ frei, genau wie die freie - bei Gleichstand gewinnt die Station,
    die zuerst frei war (Handbuch: „an die Station, die zuerst frei ist“), nicht die mit dem kleineren Namen."""
    matches = [
        duel("A", "r1", "r2", order=1, status="in_progress", started_at=at(0), station_id="st1"),
        duel("B", "r3", "r4", order=2, scheduled_at=at(0), station_id="st1", schedule_source="planner"),
    ]
    stations = [station("st1", "1", status="busy", current_match_id="id-A"), station("st2", "2")]
    now = T0 + timedelta(minutes=45)
    view = queue(matches, stations, now)
    first, second = view["stations"]
    assert first["running"]["match_id"] == "id-A" and first["next"] is None
    assert second["next"]["match_id"] == "id-B" and second["next"]["forecast_at"] == now.isoformat()


def test_a_time_set_by_hand_in_the_past_is_forecast_from_now():
    """Ein von Hand gesetzter Termin, der vorbei ist, ohne dass das Spiel begann.

    Prognose „jetzt“, nicht die alte Zeit."""
    matches = [duel("A", "r1", "r2", scheduled_at=at(0), station_id="st1", schedule_source="manual")]
    now = T0 + timedelta(minutes=12)
    view = queue(matches, [station("st1", "1")], now)
    entry = view["matches"]["id-A"]
    assert entry["forecast_at"] == now.isoformat() and entry["delay_minutes"] == 12


# ---------------------------------------------------------------- Online und ohne Stationen


def test_online_has_no_queue():
    view = queue(
        eight(), [station("st1", "1")], T0, tournament={"event_mode": "online", "schedule_mode": "player_proposal"}
    )
    assert view["applies"] is False and view["stations"] == [] and view["matches"] == {}


def test_without_stations_there_is_no_queue():
    view = queue(eight(), [], T0)
    assert view["applies"] is False and view["reason"]


def test_a_station_being_deleted_gets_nothing():
    """Eine Station mit Löschmarkierung (``deleting``) steht nicht in der Warteschlange und bekommt kein Spiel."""
    view = queue(eight(), [station("st1", "1"), station("st2", "2", deleting=True)], T0)
    assert [row["id"] for row in view["stations"]] == ["st1"]
    assert {entry["station_id"] for entry in view["matches"].values()} == {"st1"}


def test_a_preview_tree_has_no_queue():
    """Vorschau-Baum (vor dem Check-in-Ende): keine Warteschlange, also auch kein Aufruf."""
    matches = [{**match, "is_preview": True} for match in eight()]
    view = queue(matches, [station("st1", "1")], T0)
    assert view["applies"] is False and view["matches"] == {}


def test_a_called_match_holds_its_station_from_now_even_if_planned_later():
    """Codex zu #1595: Aufgerufen für 11:00, jetzt ist 10:00.

    Die Station ist ab jetzt reserviert, nicht erst ab 11:00."""
    matches = [duel("A", "r1", "r2", order=1, station_id="st1", called_at=at(0), scheduled_at=at(60)),
               duel("B", "r3", "r4", order=2)]
    plan = plan_schedule(tournament(), matches, [station("st1", "1")], now=T0)
    later = by_id(plan)["id-B"]
    assert datetime.fromisoformat(later["scheduled_at"]) >= T0 + timedelta(minutes=90), "B nicht vor das aufgerufene A"


def by_id(plan):
    return {item["match_id"]: item for item in plan["assignments"]}
