"""Setzliste der Playoffs und Paarungen der Relegation aus dem Endstand (#2404, docs/LIGA.md „F.6 … Setzliste aus dem Endstand“).

Rein rechnend, ohne Datenbank: 4, 6, 8 und 12 Teilnehmer, Freilose, Gleichstand bei der Setzung, Ausgeschiedene, Relegation über Kreuz.
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import postseason_seeding as seeding  # noqa: E402


def table(staffel: str, size: int, *, points=None, played: int = 6, exits=(), zones=None) -> dict:
    """Eine Staffel mit ``size`` Teams, Platz 1 bis N; ``points``: Punkte des Ersten (die anderen je 3 weniger)."""
    top = points if points is not None else 3 * size
    rows = []
    for index in range(size):
        row = {"registration_id": f"{staffel}{index + 1}", "display_name": f"Team {staffel}{index + 1}", "rank": index + 1,
               "played": played, "points": top - 3 * index, "score_diff": size - 2 * index}
        if index + 1 in exits:
            row["exit"] = {"kind": "withdrawn"}
        if zones and zones.get(index + 1):
            row["zone"] = zones[index + 1]
        rows.append(row)
    return {"tournament_id": f"t{staffel}", "staffel": staffel, "rows": rows}


def names(found: dict) -> list[str]:
    return [row["registration_id"] for row in found["seeds"]]


def pairs(found: dict) -> list[tuple]:
    by_seed = {row["seed"]: row["registration_id"] for row in found["seeds"]}
    return [(by_seed.get(pair["a"]), by_seed.get(pair["b"])) for pair in seeding.first_round(len(found["seeds"]))]


def same_staffel(found: dict) -> list[tuple]:
    origin = {row["registration_id"]: row["staffel"] for row in found["seeds"]}
    return [pair for pair in pairs(found) if pair[0] and pair[1] and origin[pair[0]] == origin[pair[1]]]


# ---------------------------------------------------------------- 4, 6, 8, 12 Teilnehmer

def test_four_from_one_staffel_play_one_against_four_and_two_against_three():
    found = seeding.seed([table("A", 6)], 4)
    assert names(found) == ["A1", "A2", "A3", "A4"]
    assert pairs(found) == [("A1", "A4"), ("A2", "A3")]
    assert seeding.rounds(4) == 2 and seeding.byes(4) == 0


def test_four_from_two_staffeln_are_seeded_across():
    # Nr. 206/221: A1 hat mehr Punkte je Spiel als B1 - die Reihenfolge der Staffeln gilt für jede Platzgruppe.
    found = seeding.seed([table("A", 4, points=18), table("B", 4, points=15)], 2)
    assert names(found) == ["A1", "B1", "A2", "B2"]
    assert pairs(found) == [("A1", "B2"), ("B1", "A2")]
    assert [row["tie"] for row in found["seeds"]] == [None, "ppg", None, "ppg"]


def test_the_better_staffel_winner_puts_its_staffel_first_in_every_group():
    # B1 steht vor A1 - auch die Zweiten folgen dieser Reihenfolge, selbst wenn A2 mehr Punkte hat als B2 (sonst A1-A2).
    b = table("B", 4, points=21)
    b["rows"][1]["points"] = 3
    found = seeding.seed([table("A", 4, points=18), b], 2)
    assert names(found) == ["B1", "A1", "B2", "A2"]
    assert pairs(found) == [("B1", "A2"), ("A1", "B2")]


def test_six_teams_give_the_two_best_a_bye():
    found = seeding.seed([table("A", 5, points=18), table("B", 5, points=15)], 3)
    assert names(found) == ["A1", "B1", "A2", "B2", "A3", "B3"]
    assert seeding.byes(6) == 2 and seeding.rounds(6) == 3
    assert pairs(found) == [("A1", None), ("B2", "A3"), ("B1", None), ("A2", "B3")]
    assert same_staffel(found) == []


def test_eight_from_two_staffeln():
    found = seeding.seed([table("A", 6, points=18), table("B", 6, points=15)], 4)
    assert pairs(found) == [("A1", "B4"), ("B2", "A3"), ("B1", "A4"), ("A2", "B3")]
    assert seeding.byes(8) == 0 and seeding.rounds(8) == 3


def test_twelve_from_one_staffel_give_four_byes():
    found = seeding.seed([table("A", 14)], 12)
    assert len(found["seeds"]) == 12 and seeding.byes(12) == 4 and seeding.rounds(12) == 4
    first = pairs(found)
    assert [pair for pair in first if pair[1] is None] == [("A1", None), ("A4", None), ("A2", None), ("A3", None)]
    assert ("A5", "A12") in first and ("A8", "A9") in first


def test_twelve_from_three_staffeln_never_pair_the_same_staffel_in_round_one():
    # Ohne Tauschen träfe A3 auf A4 (Setzplätze 7 und 10) - Nr. 221: tauschen, bis keine Paarung aus derselben Staffel kommt.
    found = seeding.seed([table("A", 6, points=21), table("B", 6, points=18), table("C", 6, points=15)], 4)
    assert len(found["seeds"]) == 12
    assert same_staffel(found) == []
    assert found["swaps"] >= 1
    # Die Bestgesetzten haben das Freilos, die Staffelsieger stehen vorn.
    assert names(found)[:3] == ["A1", "B1", "C1"]


def test_six_from_three_staffeln_swap_inside_the_lower_group():
    found = seeding.seed([table("A", 4, points=21), table("B", 4, points=18), table("C", 4, points=15)], 2)
    assert same_staffel(found) == []
    assert sorted(names(found)[3:]) == ["A2", "B2", "C2"]


def test_twelve_from_four_staffeln_need_no_swap():
    found = seeding.seed([table(letter, 5, points=30 - index) for index, letter in enumerate("ABCD")], 3)
    assert len(found["seeds"]) == 12 and same_staffel(found) == [] and found["swaps"] == 0


# ---------------------------------------------------------------- Gleichstand bei der Setzung

def test_equal_staffel_winners_stay_open_without_a_lot():
    found = seeding.seed([table("A", 4, points=18), table("B", 4, points=18)], 2)
    # Die Vorschau lost nicht (Nr. 225): Die Gleichen stehen in der Reihenfolge der Staffeln, mit Hinweis.
    assert found["open_lot"] == [["Team A1", "Team B1"]]
    assert names(found) == ["A1", "B1", "A2", "B2"] and found["draws"] == []


def test_the_lot_orders_equal_staffel_winners_and_is_recorded():
    found = seeding.seed([table("A", 4, points=18), table("B", 4, points=18)], 2, lot=lambda group: list(reversed(group)))
    assert names(found) == ["B1", "A1", "B2", "A2"]
    assert found["open_lot"] == []
    assert [row["tie"] for row in found["seeds"]] == [None, "lot", None, "lot"]
    assert found["draws"] == [{"registration_ids": ["A1", "B1"], "names": ["Team A1", "Team B1"], "order": ["B1", "A1"]}]


def test_map_difference_per_game_decides_before_the_lot():
    a, b = table("A", 4, points=18), table("B", 4, points=18)
    b["rows"][0]["score_diff"] = 12
    found = seeding.seed([a, b], 2, lot=lambda group: (_ for _ in ()).throw(AssertionError("kein Los nötig")))
    assert names(found)[:2] == ["B1", "A1"] and found["seeds"][1]["tie"] == "map_diff"


def test_different_staffel_sizes_compare_per_game():
    # 12 Punkte aus 4 Spielen schlagen 15 aus 6.
    found = seeding.seed([table("A", 4, points=15, played=6), table("B", 3, points=12, played=4)], 1)
    assert names(found) == ["B1", "A1"]


# ---------------------------------------------------------------- Ausgeschiedene und Nachrücken

def test_exited_teams_never_qualify_and_the_next_one_moves_up():
    found = seeding.seed([table("A", 5, exits={2})], 3)
    assert names(found) == ["A1", "A3", "A4"]
    assert [row["rank"] for row in found["seeds"]] == [1, 3, 4]


def test_a_team_gone_after_the_close_is_left_out_and_the_others_keep_their_seed():
    before = seeding.seed([table("A", 5, points=18), table("B", 5, points=15)], 2)
    after = seeding.seed([table("A", 5, points=18), table("B", 5, points=15)], 2, gone={"A2"})
    assert names(before) == ["A1", "B1", "A2", "B2"]
    # A3 übernimmt den Platz von A2 in der Platzgruppe - alle anderen Setzplätze bleiben.
    assert names(after) == ["A1", "B1", "A3", "B2"]


def test_a_staffel_with_fewer_teams_sends_what_it_has():
    found = seeding.seed([table("A", 4, points=18), table("B", 1, points=2, played=1)], 2)
    assert names(found) == ["A1", "B1", "A2"]


def test_no_table_and_no_place_give_no_seeds():
    assert seeding.seed([], 4)["seeds"] == []
    assert seeding.seed([table("A", 4)], 0)["seeds"] == []


# ---------------------------------------------------------------- Kennzeichen und Grenze

def test_mark_sets_the_playoff_flag_only_for_qualified_rows():
    rows = seeding.mark(table("A", 5, exits={1})["rows"], 2)
    assert [bool(row.get("playoff")) for row in rows] == [False, True, True, False, False]
    assert all("playoff" not in row for row in seeding.mark(table("B", 4)["rows"], 0))


def test_a_tie_at_the_playoff_boundary_is_reported():
    rows = table("A", 5)["rows"]
    rows[2]["rank"] = 2  # Platz 2 geteilt, zwei Plätze: nur einer der beiden käme hinein
    ties = seeding.boundary_ties(rows, 2)
    assert [(tie["kind"], tie["rank"], tie["registration_ids"]) for tie in ties] == [("playoff", 2, ["A2", "A3"])]
    assert seeding.boundary_ties(rows, 3) == []
    assert seeding.boundary_ties(table("A", 5)["rows"], 2) == []


# ---------------------------------------------------------------- Relegation

UP, DOWN = "playoff_promotion", "playoff_relegation"


def test_relegation_pairs_best_upper_against_worst_lower():
    upper = [table("A", 6, zones={4: DOWN, 5: DOWN})]
    lower = [table("C", 6, zones={2: UP, 3: UP})]
    found = seeding.relegation_pairs(upper, lower)
    assert found["problem"] is None
    assert [(pair["upper"]["registration_id"], pair["lower"]["registration_id"]) for pair in found["pairs"]] == [("A4", "C3"), ("A5", "C2")]


def test_relegation_across_two_staffeln_orders_equal_places_per_game():
    upper = [table("A", 4, points=18, zones={3: DOWN}), table("B", 4, points=21, zones={3: DOWN})]
    lower = [table("C", 4, points=18, zones={2: UP}), table("D", 4, points=24, zones={2: UP})]
    found = seeding.relegation_pairs(upper, lower)
    # B3 ist der bessere Obere und spielt gegen den schlechteren Unteren (C2).
    assert [(pair["upper"]["registration_id"], pair["lower"]["registration_id"]) for pair in found["pairs"]] == [("B3", "C2"), ("A3", "D2")]


def test_relegation_must_add_up():
    found = seeding.relegation_pairs([table("A", 6, zones={5: DOWN})], [table("C", 6, zones={2: UP, 3: UP})])
    assert found["pairs"] == [] and "geht nicht auf" in found["problem"]
    assert "1" in found["problem"] and "2" in found["problem"]
    empty = seeding.relegation_pairs([table("A", 6)], [table("C", 6)])
    assert empty["pairs"] == [] and empty["problem"]


def test_relegation_lot_only_orders_equal_rows():
    upper = [table("A", 4, zones={3: DOWN}), table("B", 4, zones={3: DOWN})]
    lower = [table("C", 4, zones={2: UP}), table("D", 4, zones={2: UP})]
    open_ = seeding.relegation_pairs(upper, lower)
    assert sorted(len(group) for group in open_["open_lot"]) == [2, 2]
    drawn = seeding.relegation_pairs(upper, lower, lot=lambda group: list(reversed(group)))
    assert drawn["open_lot"] == [] and len(drawn["draws"]) == 2
    assert [(pair["upper"]["registration_id"], pair["lower"]["registration_id"]) for pair in drawn["pairs"]] == [("B3", "C2"), ("A3", "D2")]


def test_stamp_changes_with_its_parts_and_ignores_their_order():
    assert seeding.stamp(["b", "a"], 2) == seeding.stamp(["a", "b"], 2)
    assert seeding.stamp(["a", "b"], 2) != seeding.stamp(["a", "b"], 3)
    assert seeding.stamp([], 2) == ""


def test_the_tree_positions_match_the_bracket_generator():
    from services.custom_bracket import _seed_positions

    for size in (2, 4, 8, 16, 32):
        assert seeding._positions(size) == _seed_positions(size)
