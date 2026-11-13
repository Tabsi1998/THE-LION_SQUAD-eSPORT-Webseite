"""F.5 Gesamtwertung über Seasons (#2215, docs/LIGA.md „F.5“): die reinen Regeln - Punkte je Platz nach Teamzahl und Tabelle,
Meister-Bonus, geteilter Platz, Ausgeschiedene, beste X mit Streichergebnis, Reihenfolge und Entscheid der Leitung, Einstellungen.
Jede Regel mit Gegenprobe. Nur erfundene Namen."""
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import league_overall_rules as rules  # noqa: E402

SETTINGS = rules.settings_of({})


def row(registration_id: str, rank: int, exit_kind: str | None = None) -> dict:
    return {"registration_id": registration_id, "rank": rank, "exit": {"kind": exit_kind} if exit_kind else None}


def test_points_follow_the_team_count_with_bonus_for_place_one():
    points = rules.staffel_points([row("a", 1), row("b", 2), row("c", 3), row("d", 4)], SETTINGS)
    # Platz 1 = 4 + 2 Bonus, der Letzte 1.
    assert [points[key]["points"] for key in "abcd"] == [6, 3, 2, 1]
    assert points["a"]["champion"] and not points["b"]["champion"]
    assert {entry["of"] for entry in points.values()} == {4}


def test_n_counts_per_staffel_so_a_smaller_staffel_gives_fewer_points():
    small = rules.staffel_points([row("a", 1), row("b", 2), row("c", 3)], SETTINGS)
    large = rules.staffel_points([row(f"x{index}", index) for index in range(1, 7)], SETTINGS)
    assert small["a"]["points"] == 3 + 2 and large["x1"]["points"] == 6 + 2
    # Gegenprobe: Der Letzte bekommt in jeder Staffel 1.
    assert small["c"]["points"] == 1 and large["x6"]["points"] == 1


def test_shared_place_gets_the_same_points_and_the_next_place_skips():
    points = rules.staffel_points([row("a", 1), row("b", 2), row("c", 2), row("d", 4)], SETTINGS)
    assert points["b"]["points"] == points["c"]["points"] == 3
    assert points["d"]["points"] == 1 and points["d"]["place"] == 4
    shared_first = rules.staffel_points([row("a", 1), row("b", 1), row("c", 3)], SETTINGS)
    # Ein geteilter Platz 1 (nur unterhalb der obersten Liga N möglich) bekommt den Bonus für beide.
    assert shared_first["a"]["points"] == shared_first["b"]["points"] == 3 + 2


def test_exited_and_disqualified_get_zero_and_do_not_push_anyone_back():
    # Regel ``half``: Das ausgetretene Team steht rechnerisch auf Platz 1 - es schiebt niemanden nach hinten.
    points = rules.staffel_points([row("out", 1, "withdrawn"), row("a", 2), row("b", 3), row("dq", 4, "disqualified")], SETTINGS)
    assert points["out"]["points"] == 0 and points["dq"]["points"] == 0
    assert points["out"]["exit"] == "withdrawn" and points["dq"]["exit"] == "disqualified"
    # N = 2 Teams in der Wertung: a ist Erster (2 + 2), b Letzter (1).
    assert points["a"] == {"points": 4, "place": 1, "of": 2, "champion": True, "exit": None}
    assert points["b"]["points"] == 1
    # Gegenprobe: ohne Austritt hätte a nur Platz 2.
    plain = rules.staffel_points([row("out", 1), row("a", 2), row("b", 3)], SETTINGS)
    assert plain["a"]["place"] == 2


def test_own_points_table_and_places_beyond_get_zero():
    settings = {**SETTINGS, "points_mode": "table", "points_table": [10, 6, 3], "champion_bonus": 0}
    points = rules.staffel_points([row("a", 1), row("b", 2), row("c", 3), row("d", 4)], settings)
    assert [points[key]["points"] for key in "abcd"] == [10, 6, 3, 0]


def test_all_seasons_count_by_default():
    entries = {"k1": {"name": "Nordlicht", "seasons": {"s1": {"points": 5, "place": 2}, "s2": {"points": 1, "place": 4}}}}
    ranked = rules.rank(entries, SETTINGS, ["s1", "s2"])
    assert ranked[0]["total"] == 6 and all(entry["counted"] for entry in ranked[0]["seasons"].values())


def test_best_x_drop_the_weakest_season_and_on_equal_points_the_earlier_counts():
    settings = {**SETTINGS, "counting": "best", "best_count": 2}
    entries = {"k1": {"name": "Nordlicht", "seasons": {"s1": {"points": 3}, "s2": {"points": 6}, "s3": {"points": 3}}}}
    ranked = rules.rank(entries, settings, ["s1", "s2", "s3"])[0]
    assert ranked["total"] == 9
    assert ranked["seasons"]["s2"]["counted"] and ranked["seasons"]["s1"]["counted"]
    # Gleich viele Punkte in s1 und s3: die frühere zählt, s3 ist Streichergebnis.
    assert ranked["seasons"]["s3"]["counted"] is False
    # Gegenprobe: mit „alle“ zählt auch s3.
    assert rules.rank(entries, SETTINGS, ["s1", "s2", "s3"])[0]["total"] == 12


def test_a_season_without_play_drops_nothing():
    settings = {**SETTINGS, "counting": "best", "best_count": 2}
    entries = {"k1": {"name": "A", "seasons": {"s1": {"points": 4}}}, "k2": {"name": "B", "seasons": {"s1": {"points": 2}, "s2": {"points": 1}}}}
    ranked = {row["key"]: row for row in rules.rank(entries, settings, ["s1", "s2"])}
    assert ranked["k1"]["total"] == 4 and ranked["k2"]["total"] == 3


def test_tiebreakers_then_shared_place():
    entries = {
        "a": {"name": "A", "seasons": {"s1": {"points": 6, "place": 1}, "s2": {"points": 1, "place": 4}}},
        "b": {"name": "B", "seasons": {"s1": {"points": 3, "place": 2}, "s2": {"points": 4, "place": 2}}},
        "c": {"name": "C", "seasons": {"s1": {"points": 3, "place": 2}, "s2": {"points": 4, "place": 2}}},
    }
    ranked = rules.rank(entries, SETTINGS, ["s1", "s2"])
    # Alle 7 Punkte: A hat einen Staffelsieg - vorn. B und C stehen nach allen Kriterien gleich: geteilter Platz 2.
    assert [(row["key"], row["place"], row["tie"]) for row in ranked] == [("a", 1, False), ("b", 2, True), ("c", 2, True)]
    # Gegenprobe: Mit „jüngste Season“ zuerst liegen B und C vor A.
    latest_first = rules.rank(entries, {**SETTINGS, "tiebreakers": ["latest"]}, ["s1", "s2"])
    assert [row["key"] for row in latest_first][2] == "a"
    assert rules.ties(ranked) == [{"place": 2, "keys": ["b", "c"], "names": ["B", "C"], "total": 7}]


def test_lead_decision_orders_exactly_the_tied_group():
    entries = {"b": {"name": "B", "seasons": {"s1": {"points": 3, "place": 2}}}, "c": {"name": "C", "seasons": {"s1": {"points": 3, "place": 2}}}}
    decision = {"id": "d1", "keys": ["c", "b"], "reason": "Entscheidungsspiel gewonnen", "method": "playoff"}
    ranked = rules.rank(entries, SETTINGS, ["s1"], [decision])
    assert [(row["key"], row["place"]) for row in ranked] == [("c", 1), ("b", 2)]
    assert ranked[0]["lead_decision"]["method_label"] == "Entscheidungsspiel"
    # Gegenprobe: Steht eine andere Gruppe gleich, gilt der Entscheid nicht.
    entries["d"] = {"name": "D", "seasons": {"s1": {"points": 3, "place": 2}}}
    assert {row["place"] for row in rules.rank(entries, SETTINGS, ["s1"], [decision])} == {1}


def test_settings_are_checked():
    current = rules.settings_of({})
    assert rules.clean_points({"points_mode": "table", "points_table": [10, "6", 3]}, current)["points_table"] == [10, 6, 3]
    with pytest.raises(rules.OverallProblem):
        rules.clean_points({"points_mode": "table", "points_table": []}, current)
    with pytest.raises(rules.OverallProblem):
        rules.clean_points({"counting": "best", "best_count": 0}, current)
    with pytest.raises(rules.OverallProblem):
        rules.clean_points({"tiebreakers": ["wins", "wins"]}, current)
    with pytest.raises(rules.OverallProblem):
        rules.clean_points({"champion_bonus": 2.5}, current)
    # Gegenprobe: „alle“ braucht kein X.
    assert rules.clean_points({"counting": "all", "best_count": 0}, current)["best_count"] is None


def test_a_season_belongs_to_at_most_one_period():
    seasons = {"s1", "s2", "s3"}
    names = {"s1": "Season 1"}
    out = rules.clean_periods([{"name": "2027", "season_ids": ["s1", "s2"]}, {"name": "2028", "season_ids": ["s3"]}], [], seasons, names, set())
    assert [row["season_ids"] for row in out] == [["s1", "s2"], ["s3"]]
    with pytest.raises(rules.OverallProblem) as problem:
        rules.clean_periods([{"name": "2027", "season_ids": ["s1"]}, {"name": "2028", "season_ids": ["s1"]}], [], seasons, names, set())
    assert "höchstens einem Zeitraum" in problem.value.message
    with pytest.raises(rules.OverallProblem):
        rules.clean_periods([{"name": "Fremd", "season_ids": ["andere"]}], [], seasons, names, set())


def test_a_closed_period_keeps_its_seasons_and_stays():
    current = [{"id": "p1", "name": "2027", "season_ids": ["s1"]}]
    with pytest.raises(rules.OverallProblem) as problem:
        rules.clean_periods([{"id": "p1", "name": "2027", "season_ids": ["s1", "s2"]}], current, {"s1", "s2"}, {}, {"p1"})
    assert problem.value.status == 409
    with pytest.raises(rules.OverallProblem) as gone:
        rules.clean_periods([], current, {"s1"}, {}, {"p1"})
    assert gone.value.status == 409
    # Gegenprobe: umbenennen geht, die Kennung bleibt.
    assert rules.clean_periods([{"id": "p1", "name": "Jahr 2027", "season_ids": ["s1"]}], current, {"s1"}, {}, {"p1"})[0]["id"] == "p1"


def test_without_period_there_is_no_overall_standing():
    assert not rules.enabled({}) and not rules.enabled({"overall": {"points_mode": "teams"}})
    league = {"overall": {"periods": [{"id": "p1", "name": "2027", "season_ids": ["s1"]}]}}
    assert rules.enabled(league) and rules.period_of(league, "s1")["id"] == "p1" and rules.period_of(league, "s2") is None


def test_latest_means_the_newest_season_with_a_result_in_this_level():
    # Season 3 hat in dieser Liga N (noch) keinen Endstand: Es entscheidet Season 2, nicht „alle 0 in Season 3“.
    entries = {"a": {"name": "A", "seasons": {"s1": {"points": 5, "place": 1}, "s2": {"points": 1, "place": 4}}},
               "b": {"name": "B", "seasons": {"s1": {"points": 2, "place": 3}, "s2": {"points": 4, "place": 2}}}}
    settings = {**SETTINGS, "tiebreakers": ["latest"]}
    assert [row["key"] for row in rules.rank(entries, settings, ["s1", "s2", "s3"])] == ["b", "a"]
    # Gegenprobe: ohne das Kriterium nach Namen, A vor B.
    assert [row["key"] for row in rules.rank(entries, {**SETTINGS, "tiebreakers": []}, ["s1", "s2", "s3"])] == ["a", "b"]


def test_a_deleted_season_in_a_closed_period_does_not_block_saving():
    current = [{"id": "p1", "name": "2027", "season_ids": ["s1", "weg"]}]
    # Die Season „weg“ gibt es nicht mehr: Umbenennen geht, die Kennung fällt still heraus.
    out = rules.clean_periods([{"id": "p1", "name": "Jahr 2027", "season_ids": ["s1", "weg"]}], current, {"s1"}, {}, {"p1"})
    assert out == [{"id": "p1", "name": "Jahr 2027", "season_ids": ["s1"]}]
    assert rules.clean_periods([{"id": "p1", "name": "2027", "season_ids": ["s1"]}], current, {"s1"}, {}, {"p1"})[0]["season_ids"] == ["s1"]
    # Gegenprobe: eine fremde Kennung, die nie im Zeitraum stand, bleibt ein Fehler.
    with pytest.raises(rules.OverallProblem):
        rules.clean_periods([{"id": "p1", "name": "2027", "season_ids": ["s1", "fremd"]}], current, {"s1"}, {}, {"p1"})
