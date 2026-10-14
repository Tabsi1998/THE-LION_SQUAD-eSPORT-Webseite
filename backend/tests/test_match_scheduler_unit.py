"""Der Spielplaner (#1552): eine Stelle für Zeit und Station.

Regeln, je ein Test: ab jetzt, nichts rückwirkend; kein Spieler zweimal gleichzeitig; Abhängigkeiten aus dem
Graph mit Prognose; feste Termine bleiben und werden bei Konflikt gemeldet; Mindestpause; online nie Stationen.
"""
from datetime import datetime, timedelta, timezone

from services.match_scheduler import DEFAULT_BREAK_MINUTES, plan_schedule

T0 = datetime(2026, 10, 31, 10, 0, tzinfo=timezone.utc)


def tournament(**extra):
    return {"id": "t1", "format": "single_elim", "event_mode": "local", "schedule_mode": "fixed_by_staff",
            "start_date": T0.isoformat(), "match_duration_minutes": 30, "game_id": "g1", **extra}


def station(sid, name=None, **extra):
    return {"id": sid, "name": name or sid, "tournament_id": "t1", "status": "free", "current_match_id": None, **extra}


def slot(index, value):
    if isinstance(value, dict):
        return {"slot": index, "source": value, "registration_id": None, "user_id": None, "status": "pending"}
    return {"slot": index, "source": {"type": "seed", "seed": index}, "registration_id": value, "user_id": f"u-{value}", "status": "filled"}


def duel(key, a, b, *, round_number=1, order=1, status="pending", section="MAIN", stage_id="s1", **extra):
    return {"id": f"id-{key}", "tournament_id": "t1", "stage_id": stage_id, "stage_number": 1, "match_key": key,
            "section": section, "round": round_number, "order": order, "status": status, "match_type": "duel",
            "slots": [slot(1, a), slot(2, b)], "settings": {"min_players": 2}, **extra}


def winner(key):
    return {"type": "rank", "flow": "W", "match_key": key, "rank": 1}


def by_match(plan):
    return {item["match_id"]: item for item in plan["assignments"]}


def moment(item):
    return datetime.fromisoformat(item["scheduled_at"])


def single_elim_four():
    return [
        duel("A", "r1", "r4", order=1),
        duel("B", "r2", "r3", order=2),
        duel("F", winner("A"), winner("B"), round_number=2, order=1),
    ]


# ---------------------------------------------------------------- Abhängigkeiten und Prognose

def test_round_one_runs_in_parallel_and_the_final_waits_for_both_as_a_forecast():
    plan = plan_schedule(tournament(), single_elim_four(), [station("s-a", "A"), station("s-b", "B")], now=T0)
    got = by_match(plan)
    assert plan["mode"] == "stations"
    assert moment(got["id-A"]) == T0 and moment(got["id-B"]) == T0
    assert {got["id-A"]["station_id"], got["id-B"]["station_id"]} == {"s-a", "s-b"}
    assert got["id-A"]["forecast"] is False
    # Finale: nach dem späteren Vorspiel plus Pause, und nur voraussichtlich, weil die Plätze noch offen sind.
    assert moment(got["id-F"]) == T0 + timedelta(minutes=30 + DEFAULT_BREAK_MINUTES)
    assert got["id-F"]["forecast"] is True
    assert all(item["schedule_source"] == "planner" for item in plan["assignments"])


def test_a_later_stage_waits_for_the_earlier_one():
    matches = single_elim_four()
    playoff = duel("P", "r1", "r2", stage_id="s2", status="pending")
    playoff["stage_number"] = 2
    plan = plan_schedule(tournament(), matches + [playoff], [station("s-a"), station("s-b")], now=T0)
    got = by_match(plan)
    assert moment(got["id-P"]) >= moment(got["id-F"]) + timedelta(minutes=30 + DEFAULT_BREAK_MINUTES)


# ---------------------------------------------------------------- Kein Spieler doppelt

def group_round_robin():
    # Vier Spieler, drei Spieltage (Kreismethode): kein Spieler zweimal am selben Spieltag.
    return [
        duel("G1", "r1", "r4", round_number=1, order=1, section="group_A"),
        duel("G2", "r2", "r3", round_number=1, order=2, section="group_A"),
        duel("G3", "r1", "r3", round_number=2, order=3, section="group_A"),
        duel("G4", "r4", "r2", round_number=2, order=4, section="group_A"),
        duel("G5", "r1", "r2", round_number=3, order=5, section="group_A"),
        duel("G6", "r3", "r4", round_number=3, order=6, section="group_A"),
    ]


def assert_nobody_plays_twice_at_once(plan, matches, duration=30):
    by_id = {match["id"]: match for match in matches}
    windows = []
    for item in plan["assignments"]:
        start = moment(item)
        players = {slot["registration_id"] for slot in by_id[item["match_id"]]["slots"] if slot.get("registration_id")}
        windows.append((start, start + timedelta(minutes=duration), players, item["match_id"]))
    for index, (start_a, end_a, players_a, id_a) in enumerate(windows):
        for start_b, end_b, players_b, id_b in windows[index + 1:]:
            if start_a < end_b and start_b < end_a:
                assert not (players_a & players_b), f"{id_a} und {id_b} überschneiden sich für {players_a & players_b}"


def test_a_player_in_two_group_matches_never_plays_both_at_once():
    matches = group_round_robin()
    plan = plan_schedule(tournament(format="groups"), matches, [station("s-a"), station("s-b"), station("s-c")], now=T0)
    assert len(plan["assignments"]) == 6
    assert_nobody_plays_twice_at_once(plan, matches)
    got = by_match(plan)
    # Drei Stationen, aber nur zwei Spiele je Spieltag passen ohne Doppelbuchung.
    assert moment(got["id-G1"]) == T0 and moment(got["id-G2"]) == T0
    assert moment(got["id-G3"]) >= T0 + timedelta(minutes=30 + DEFAULT_BREAK_MINUTES)


def test_the_break_between_two_matches_of_one_player_is_configurable():
    matches = group_round_robin()
    plan = plan_schedule(tournament(format="groups", match_break_minutes=12), matches, [station("s-a"), station("s-b")], now=T0)
    got = by_match(plan)
    assert moment(got["id-G3"]) == T0 + timedelta(minutes=30 + 12)


def test_a_player_busy_in_another_tournament_of_the_event_is_not_booked_twice():
    busy = [{"participants": {"user:u-r1"}, "start": T0, "end": T0 + timedelta(minutes=20), "label": "Mario Kart A1"}]
    plan = plan_schedule(tournament(), single_elim_four(), [station("s-a"), station("s-b")], now=T0, busy_elsewhere=busy)
    got = by_match(plan)
    assert moment(got["id-B"]) == T0, "wer frei ist, spielt sofort"
    assert moment(got["id-A"]) == T0 + timedelta(minutes=20 + DEFAULT_BREAK_MINUTES)


# ---------------------------------------------------------------- Ab jetzt

def test_replanning_in_the_middle_plans_nothing_backwards():
    now = T0 + timedelta(hours=2)
    matches = single_elim_four()
    matches[0].update({"status": "completed", "scheduled_at": T0.isoformat(), "station_id": "s-a", "schedule_source": "planner"})
    matches[1].update({"status": "in_progress", "started_at": (now - timedelta(minutes=10)).isoformat(), "scheduled_at": T0.isoformat(),
                       "station_id": "s-b", "schedule_source": "planner"})
    plan = plan_schedule(tournament(), matches, [station("s-a"), station("s-b", current_match_id="id-B", status="busy")], now=now)
    got = by_match(plan)
    assert set(got) == {"id-F"}, "Erledigtes und Laufendes bleibt, wie es ist"
    # Das laufende Spiel ist seit 10 Minuten unterwegs, also noch 20 Minuten plus Pause.
    assert moment(got["id-F"]) == now + timedelta(minutes=20 + DEFAULT_BREAK_MINUTES)
    assert got["id-F"]["station_id"] == "s-a", "die freie Station, nicht die belegte"


def test_a_tournament_that_starts_later_is_planned_from_its_start():
    plan = plan_schedule(tournament(), single_elim_four(), [station("s-a")], now=T0 - timedelta(days=3))
    assert min(moment(item) for item in plan["assignments"]) == T0


def test_a_stale_planner_time_in_the_past_is_moved_forward_not_kept():
    now = T0 + timedelta(hours=1)
    matches = single_elim_four()
    matches[0].update({"status": "scheduled", "scheduled_at": T0.isoformat(), "station_id": "s-a", "schedule_source": "planner"})
    plan = plan_schedule(tournament(), matches, [station("s-a"), station("s-b")], now=now)
    assert moment(by_match(plan)["id-A"]) == now


# ---------------------------------------------------------------- Feste Termine

def test_a_manual_time_stays_and_the_rest_is_planned_around_it():
    matches = single_elim_four()
    fixed = T0 + timedelta(minutes=10)
    matches[1].update({"status": "scheduled", "scheduled_at": fixed.isoformat(), "station_id": "s-a", "schedule_source": "manual"})
    plan = plan_schedule(tournament(), matches, [station("s-a"), station("s-b")], now=T0)
    got = by_match(plan)
    assert "id-B" not in got, "von Hand gesetzt wird nicht neu geplant"
    assert moment(got["id-A"]) == T0 and got["id-A"]["station_id"] == "s-b"
    assert moment(got["id-F"]) == fixed + timedelta(minutes=30 + DEFAULT_BREAK_MINUTES)
    assert plan["warnings"] == []


def test_a_manual_time_that_is_too_early_is_reported_red_instead_of_moved():
    matches = single_elim_four()
    matches[2].update({"status": "scheduled", "scheduled_at": T0.isoformat(), "station_id": "s-a", "schedule_source": "manual"})
    plan = plan_schedule(tournament(), matches, [station("s-a"), station("s-b")], now=T0)
    got = by_match(plan)
    assert "id-F" not in got
    too_early = [item for item in plan["warnings"] if item["type"] == "too_early"]
    assert len(too_early) == 1 and too_early[0]["match_id"] == "id-F" and too_early[0]["severity"] == "error"
    # Die Vorspiele weichen der festen Station aus, statt sie zu überbuchen.
    assert all(item["station_id"] == "s-b" or moment(item) >= T0 + timedelta(minutes=30) for item in plan["assignments"])


def test_two_manual_times_that_collide_are_reported():
    matches = single_elim_four()
    matches[0].update({"status": "scheduled", "scheduled_at": T0.isoformat(), "station_id": "s-a", "schedule_source": "manual"})
    matches[1].update({"status": "scheduled", "scheduled_at": T0.isoformat(), "station_id": "s-a", "schedule_source": "manual"})
    plan = plan_schedule(tournament(), matches, [station("s-a")], now=T0)
    assert [item["type"] for item in plan["warnings"]] == ["station_overlap"]
    assert {plan["warnings"][0]["match_id"], plan["warnings"][0]["other_match_id"]} == {"id-A", "id-B"}


def test_a_player_booked_twice_by_hand_is_reported():
    matches = single_elim_four()
    matches.append(duel("X", "r1", "r2", order=3))
    matches[0].update({"status": "scheduled", "scheduled_at": T0.isoformat(), "station_id": "s-a", "schedule_source": "manual"})
    matches[3].update({"status": "scheduled", "scheduled_at": T0.isoformat(), "station_id": "s-b", "schedule_source": "manual"})
    plan = plan_schedule(tournament(), matches, [station("s-a"), station("s-b")], now=T0)
    assert [item["type"] for item in plan["warnings"]] == ["player_overlap"]


# ---------------------------------------------------------------- Austragung

def test_an_online_tournament_gets_no_stations_and_no_station_warnings():
    plan = plan_schedule(tournament(event_mode="online", schedule_mode="player_proposal"), single_elim_four(), [station("s-a")], now=T0)
    assert plan["mode"] == "none"
    assert plan["assignments"] == [] and plan["warnings"] == []


def test_without_stations_the_plan_says_so_instead_of_inventing_times():
    plan = plan_schedule(tournament(), single_elim_four(), [], now=T0)
    assert plan["assignments"] == []
    assert [item["type"] for item in plan["warnings"]] == ["no_stations"]


def test_a_station_for_another_game_is_not_used():
    plan = plan_schedule(tournament(), single_elim_four(), [station("s-a", game_id="g1"), station("s-x", game_id="g-other")], now=T0)
    assert {item["station_id"] for item in plan["assignments"]} == {"s-a"}


def test_a_broken_station_is_not_used():
    plan = plan_schedule(tournament(), single_elim_four(), [station("s-a"), station("s-b", status="broken")], now=T0)
    assert {item["station_id"] for item in plan["assignments"]} == {"s-a"}


# ---------------------------------------------------------------- Reihenfolge und Ergebnisform

def test_the_longest_chain_to_the_final_goes_first():
    # Eine Station: beide Vorspiele vor dem Finale, in ihrer Reihenfolge.
    plan = plan_schedule(tournament(), single_elim_four(), [station("s-a")], now=T0)
    assert [item["match_id"] for item in sorted(plan["assignments"], key=moment)] == ["id-A", "id-B", "id-F"]


def test_the_plan_says_what_changes_and_carries_a_fingerprint():
    matches = single_elim_four()
    matches[0].update({"status": "scheduled", "scheduled_at": T0.isoformat(), "station_id": "s-a", "schedule_source": "planner"})
    first = plan_schedule(tournament(), matches, [station("s-a"), station("s-b")], now=T0)
    got = by_match(first)
    assert got["id-A"]["changed"] is False and got["id-B"]["changed"] is True
    again = plan_schedule(tournament(), matches, [station("s-a"), station("s-b")], now=T0)
    assert first["fingerprint"] == again["fingerprint"]
    assert first["fingerprint"] != plan_schedule(tournament(), matches, [station("s-a")], now=T0)["fingerprint"]


def test_a_match_with_too_few_possible_players_is_skipped():
    matches = single_elim_four()
    matches[0]["slots"][1] = {"slot": 2, "source": {"type": "bye"}, "registration_id": None, "user_id": None, "status": "bye"}
    plan = plan_schedule(tournament(), matches, [station("s-a"), station("s-b")], now=T0)
    assert "id-A" not in by_match(plan)


# ---------------------------------------------------------------- Teams (Codex-Prüfung zu #1569)

def test_team_members_resolved_by_the_caller_count_as_players():
    # Zwei Spiele mit verschiedenen Anmeldungen, aber derselbe Mensch steht in beiden Teams: nie gleichzeitig.
    matches = [duel("A", "r1", "r4", order=1), duel("B", "r2", "r3", order=2)]
    keys = {"id-A": {"reg:r1", "reg:r4", "user:captain-a", "user:member-shared"},
            "id-B": {"reg:r2", "reg:r3", "user:captain-b", "user:member-shared"}}
    plan = plan_schedule(tournament(), matches, [station("s-a"), station("s-b")], now=T0, participant_keys=keys)
    got = by_match(plan)
    assert moment(got["id-A"]) == T0
    assert moment(got["id-B"]) == T0 + timedelta(minutes=30 + DEFAULT_BREAK_MINUTES)


def test_a_too_early_time_is_told_in_vienna_time_with_the_earliest_possible_start():
    # Matchplan-Seite (#1557): die Warnung steht so in der Vorschau - in Wiener Zeit, nicht in UTC, und mit dem Zeitpunkt,
    # ab dem das Spiel frühestens gehen kann.
    from zoneinfo import ZoneInfo
    matches = single_elim_four()
    matches[2].update({"status": "scheduled", "scheduled_at": T0.isoformat(), "station_id": "s-a", "schedule_source": "manual"})
    plan = plan_schedule(tournament(), matches, [station("s-a"), station("s-b")], now=T0)
    warning = next(item for item in plan["warnings"] if item["type"] == "too_early")
    vienna = T0.astimezone(ZoneInfo("Europe/Vienna")).strftime("%H:%M")
    assert "UTC" not in warning["message"] and f"um {vienna}" in warning["message"]
    earliest = datetime.fromisoformat(warning["earliest_at"])
    assert earliest >= T0 + timedelta(minutes=30 + DEFAULT_BREAK_MINUTES)
