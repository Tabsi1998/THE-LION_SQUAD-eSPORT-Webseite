"""Zielregel je Zone über Staffeln hinweg (#1627, Entscheidung 23.11.): „die N besten Nächstplatzierten“ steigen auf, spiegelbildlich
beim Abstieg. Vergleich nach Punkten je Spiel, dann Map-Differenz je Spiel, dann Entscheid der Leitung - kein Los. Rechnung ohne
Datenbank, je Regel mit Gegenprobe."""
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import league_cross_rank as rank  # noqa: E402
from services import league_cross_zones as cross  # noqa: E402
from services import league_zones as zones  # noqa: E402


def row(key: str, played: int, points: float, diff: int, **extra) -> dict:
    return {"registration_id": key, "display_name": f"Team {key}", "played": played, "points": points, "score_diff": diff, **extra}


def table(letter: str, results: list[tuple[int, float, int]], *, exits: set[int] | None = None) -> dict:
    """Eine Staffel: je Platz (Spiele, Punkte, Map-Differenz). ``exits``: Plätze, die ausgeschieden sind."""
    rows = []
    for index, (played, points, diff) in enumerate(results, start=1):
        item = row(f"{letter}{index}", played, points, diff, rank=index)
        if exits and index in exits:
            item["exit"] = {"kind": "withdrawn"}
        rows.append(item)
    return {"tournament_id": f"tid-{letter}", "staffel": letter, "rows": rows}


MIDDLE = {"level": 2, "zones": {"promote": 1, "relegate": 1, "promote_best": 1, "relegate_worst": 1}}


def rule(**own) -> dict:
    return zones.effective({"level": 2, "zones": {"promote": 1, "relegate": 1, **own}}, [1, 2, 3])


# ---------------------------------------------------------------- Vergleich

def test_points_per_game_beat_raw_points():
    # 9 Punkte aus 3 Spielen schlagen 10 Punkte aus 5 Spielen: unterschiedlich große Staffeln werden je Spiel verglichen.
    order = rank.ranked([row("big", 5, 10, 4), row("small", 3, 9, 1)])
    assert [item["row"]["registration_id"] for item in order] == ["small", "big"]
    assert order[1]["by"] == "ppg" and order[0]["points_per_game"] == 3.0 and order[1]["points_per_game"] == 2.0


def test_map_difference_per_game_breaks_equal_points_per_game():
    order = rank.ranked([row("a", 4, 8, 4), row("b", 2, 4, 3)])
    assert [item["row"]["registration_id"] for item in order] == ["b", "a"]  # +1,5 je Spiel vor +1,0 je Spiel
    assert order[1]["by"] == "map_diff"


def test_equal_on_both_share_a_place_without_a_lot():
    order = rank.ranked([row("a", 4, 8, 4), row("b", 2, 4, 2), row("c", 2, 2, 0)])
    assert [item["place"] for item in order] == [1, 1, 3]
    # Gegenprobe: Mit dem Los als letztem Schritt (Playoff-Setzung, Nr. 206) steht jeder für sich.
    drawn = rank.ranked([row("a", 4, 8, 4), row("b", 2, 4, 2), row("c", 2, 2, 0)], lot=lambda tied: sorted(tied, key=lambda item: item["registration_id"], reverse=True))
    assert [(item["row"]["registration_id"], item["place"], item["by"]) for item in drawn] == [("b", 1, None), ("a", 2, "lot"), ("c", 3, "ppg")]


def test_a_team_without_a_game_counts_as_zero():
    order = rank.ranked([row("none", 0, 0, 0), row("lost", 2, 0, -4)])
    assert [item["row"]["registration_id"] for item in order] == ["none", "lost"]


def test_pick_takes_the_best_and_names_a_tie_at_the_cut():
    rows = [row("a", 4, 12, 6), row("b", 4, 8, 2), row("c", 2, 4, 1), row("d", 4, 4, 0)]
    clear = rank.pick(rows, 1)
    assert [item["registration_id"] for item in clear["chosen"]] == ["a"] and clear["tied"] == [] and clear["open"] == 0
    tied = rank.pick(rows, 2)
    assert [item["registration_id"] for item in tied["chosen"]] == ["a"]
    assert sorted(item["registration_id"] for item in tied["tied"]) == ["b", "c"] and tied["open"] == 1
    # Liegen alle Gleichen diesseits der Grenze, ist nichts zu entscheiden.
    both = rank.pick(rows, 3)
    assert sorted(item["registration_id"] for item in both["chosen"]) == ["a", "b", "c"] and both["tied"] == []
    assert len(rank.pick(rows, 9)["chosen"]) == 4


def test_pick_worst_mirrors_the_rule():
    rows = [row("a", 4, 12, 6), row("b", 4, 8, 2), row("c", 4, 4, 0)]
    assert [item["registration_id"] for item in rank.pick(rows, 1, worst=True)["chosen"]] == ["c"]


# ---------------------------------------------------------------- Einstellung

def test_without_the_fields_zones_look_as_before():
    assert zones.settings_of({"zones": {"promote": 2}}) == {"promote": 2, "relegate": 1, "playoff_promote": 0, "playoff_relegate": 0}
    assert zones.clean({"promote": 1, "relegate": 1, "promote_best": 0}, 8) == {"promote": 1, "relegate": 1, "playoff_promote": 0, "playoff_relegate": 0}
    assert zones.cross_candidates(table("A", [(3, 9, 5)] * 4)["rows"], rule()) == {"promote_best": None, "relegate_worst": None}


def test_the_rule_is_part_of_the_zones_and_checked_against_the_staffel_size():
    saved = zones.clean({"promote": 1, "relegate": 1, "promote_best": 2, "relegate_worst": 1}, 4)
    assert saved["promote_best"] == 2 and saved["relegate_worst"] == 1
    # Aufsteiger, Absteiger und je ein Platz für den Vergleich: vier Plätze - in eine Staffel mit drei Teams passt das nicht.
    with pytest.raises(zones.ZoneProblem):
        zones.clean({"promote": 1, "relegate": 1, "promote_best": 2, "relegate_worst": 1}, 3)
    assert "2 beste Nächstplatzierte" in zones.summary(rule(promote_best=2))
    assert "schlechtester Platz vor dem Abstieg" in zones.summary(rule(relegate_worst=1))


def test_top_division_has_no_best_runner_up_and_bottom_no_worst():
    top = zones.effective({"level": 1, "zones": {"promote_best": 2, "relegate_worst": 1}}, [1, 2])
    assert "promote_best" not in top and top["relegate_worst"] == 1
    bottom = zones.effective({"level": 2, "zones": {"promote_best": 2, "relegate_worst": 1}}, [1, 2])
    assert bottom["promote_best"] == 2 and "relegate_worst" not in bottom


def test_candidates_are_the_next_place_after_the_fixed_ones():
    rows = table("A", [(3, 9, 5), (3, 6, 2), (3, 3, -2), (3, 0, -5)])["rows"]
    found = zones.cross_candidates(rows, rule(promote_best=1, relegate_worst=1))
    assert found["promote_best"]["registration_id"] == "A2" and found["relegate_worst"]["registration_id"] == "A3"
    # Ausgeschiedene belegen zuerst die Abstiegsplätze (Nr. 43): Ist der Platz vor der Abstiegszone ein Ausgeschiedener, stellt
    # die Staffel dort niemanden - und aufsteigen kann ein Ausgeschiedener nie.
    gone = table("A", [(3, 9, 5), (3, 6, 2), (3, 3, -2), (3, 0, -5)], exits={3, 4})["rows"]
    assert zones.cross_candidates(gone, rule(promote_best=1, relegate_worst=1))["relegate_worst"] is None
    # In einer Staffel mit zwei Teams ist der zweite Platz schon der Abstiegsplatz: kein Kandidat.
    small = table("A", [(1, 3, 2), (1, 0, -2)])["rows"]
    assert zones.cross_candidates(small, rule(promote_best=1)) == {"promote_best": None, "relegate_worst": None}


# ---------------------------------------------------------------- Auswertung

def test_the_best_runner_up_is_promoted_across_staffeln_of_unequal_size():
    big = table("A", [(4, 12, 8), (4, 7, 2), (4, 6, 0), (4, 3, -4), (4, 0, -6)])
    small = table("B", [(3, 9, 6), (3, 6, 1), (3, 3, -2), (3, 0, -5)])
    found = cross.evaluate(rule(promote_best=1), [big, small])
    # B2 holt 2,0 Punkte je Spiel, A2 nur 1,75 - obwohl A2 mehr Punkte hat.
    assert found["zones"] == {"B2": zones.PROMOTION} and found["ties"] == []
    side = found["sides"][0]
    assert [(item["registration_id"], item["chosen"]) for item in side["candidates"]] == [("B2", True), ("A2", False)]


def test_the_worst_before_the_relegation_zone_goes_down():
    one = table("A", [(3, 9, 5), (3, 6, 2), (3, 3, -2), (3, 0, -5)])
    two = table("B", [(3, 9, 5), (3, 6, 2), (3, 2, -3), (3, 0, -5)])
    found = cross.evaluate(rule(relegate_worst=1), [one, two])
    assert found["zones"] == {"B3": zones.RELEGATION}


def test_a_tie_at_the_cut_stays_open_until_the_lead_decides():
    one = table("A", [(3, 9, 5), (3, 6, 2), (3, 3, -2), (3, 0, -5)])
    two = table("B", [(3, 9, 5), (3, 6, 2), (3, 3, -2), (3, 0, -5)])
    found = cross.evaluate(rule(promote_best=1), [one, two])
    assert found["zones"] == {}
    tie = found["ties"][0]
    assert (tie["kind"], tie["open"], sorted(tie["registration_ids"])) == ("promote_best", 1, ["A2", "B2"])
    decided = cross.evaluate(rule(promote_best=1), [one, two],
                             {"promote_best": {"registration_ids": ["B2"], "tied": ["A2", "B2"], "values": tie["values"], "method": "playoff",
                                               "reason": "Entscheidungsspiel 3:1"}})
    assert decided["zones"] == {"B2": zones.PROMOTION} and decided["ties"] == []
    assert decided["sides"][0]["decision"]["method"] == "playoff"
    # Gegenprobe: Ein Entscheid zu einem anderen Gleichstand gilt nicht mehr - etwa nach einem korrigierten Ergebnis.
    stale = cross.evaluate(rule(promote_best=1), [one, two],
                           {"promote_best": {"registration_ids": ["B2"], "tied": ["B2", "C2"], "values": tie["values"], "method": "lead"}})
    assert stale["zones"] == {} and len(stale["ties"]) == 1
    wrong = cross.evaluate(rule(promote_best=1), [one, two],
                           {"promote_best": {"registration_ids": ["A2", "B2"], "tied": ["A2", "B2"], "values": tie["values"], "method": "lead"}})
    assert wrong["zones"] == {} and len(wrong["ties"]) == 1


def test_with_as_many_places_as_staffeln_everyone_on_that_place_goes():
    one = table("A", [(3, 9, 5), (3, 6, 2), (3, 3, -2), (3, 0, -5)])
    two = table("B", [(3, 9, 5), (3, 6, 2), (3, 3, -2), (3, 0, -5)])
    found = cross.evaluate(rule(promote_best=5), [one, two])
    assert found["zones"] == {"A2": zones.PROMOTION, "B2": zones.PROMOTION} and found["ties"] == []


def test_overlay_only_touches_the_chosen_rows():
    one = table("A", [(3, 9, 5), (3, 6, 2), (3, 3, -2), (3, 0, -5)])
    two = table("B", [(3, 9, 6), (3, 7, 2), (3, 3, -2), (3, 0, -5)])
    found = cross.evaluate(rule(promote_best=1), [one, two])
    rows = zones.mark([dict(item) for item in two["rows"]], rule(promote_best=1))
    cross.apply(rows, found["zones"])
    assert [(item["registration_id"], item["zone"], item.get("zone_cross")) for item in rows] == [
        ("B1", zones.PROMOTION, None), ("B2", zones.PROMOTION, True), ("B3", None, None), ("B4", zones.RELEGATION, None)]
    other = zones.mark([dict(item) for item in one["rows"]], rule(promote_best=1))
    cross.apply(other, found["zones"])
    assert [item["zone"] for item in other] == [zones.PROMOTION, None, None, zones.RELEGATION]


# ---------------------------------------------------------------- Fix-Runde (Entscheidungen Nr. 227-229)

def test_the_candidate_comes_after_the_relegation_places_too():
    """Nr. 227: Kandidat ist der erste Platz nach den festen Aufsteigern **und** den Relegationsplätzen - unten spiegelbildlich. Kein
    Team steht je in zwei Zonen."""
    rows = table("A", [(5, 15, 9), (5, 12, 6), (5, 9, 3), (5, 6, -3), (5, 3, -6), (5, 0, -9)])["rows"]
    both = rule(playoff_promote=1, playoff_relegate=1, promote_best=1, relegate_worst=1)
    found = zones.cross_candidates(rows, both)
    assert found["promote_best"]["registration_id"] == "A3"  # nicht A2: Der spielt die Relegation um den Aufstieg
    assert found["relegate_worst"]["registration_id"] == "A4"  # nicht A5: Der spielt die Relegation gegen den Abstieg
    marked = zones.assign(rows, both)
    assert (marked["A2"], marked["A3"], marked["A4"], marked["A5"]) == (zones.PLAYOFF_PROMOTION, None, None, zones.PLAYOFF_RELEGATION)
    # Gegenprobe: ohne Relegationsplätze ist es wie bisher der Platz gleich nach den Aufsteigern.
    plain = zones.cross_candidates(rows, rule(promote_best=1, relegate_worst=1))
    assert plain["promote_best"]["registration_id"] == "A2" and plain["relegate_worst"]["registration_id"] == "A5"
    # Liegen die Kandidatenplätze schon in der anderen Hälfte, gibt es keinen Kandidaten.
    small = table("A", [(2, 6, 4), (2, 3, 0), (2, 0, -4)])["rows"]
    assert zones.cross_candidates(small, both) == {"promote_best": None, "relegate_worst": None}


def test_each_staffel_uses_the_zones_of_its_own_final():
    """Nr. 228: Gelesen wird aus dem beim Abschluss gespeicherten Stand. Trägt eine Tabelle eigene ``zones``, zählen die für ihren
    Kandidaten - die heutige Einstellung der Liga N ändert daran nichts."""
    one = {**table("A", [(3, 9, 5), (3, 6, 2), (3, 3, -2), (3, 0, -5)]), "zones": rule(promote_best=1)}
    two = {**table("B", [(3, 9, 6), (3, 7, 2), (3, 3, -2), (3, 0, -5)]), "zones": rule(promote=2, promote_best=1)}
    found = cross.evaluate(rule(promote_best=1), [one, two])
    # Staffel B schloss mit zwei festen Aufsteigern ab: Ihr Kandidat ist der Dritte.
    assert [(item["registration_id"], item["chosen"]) for item in found["sides"][0]["candidates"]] == [("A2", True), ("B3", False)]


def test_a_decision_is_bound_to_the_values_it_was_made_for():
    """Nr. 229: Der Entscheid gilt für die Gruppe **und** ihre Punkte bzw. Map-Differenz je Spiel. Ändern sich die Werte, ist er hinfällig."""
    one = table("A", [(3, 9, 5), (3, 6, 2), (3, 3, -2), (3, 0, -5)])
    two = table("B", [(3, 9, 5), (3, 6, 2), (3, 3, -2), (3, 0, -5)])
    open_tie = cross.evaluate(rule(promote_best=1), [one, two])["ties"][0]
    assert open_tie["values"] == ["2", "2/3"]
    decision = {"registration_ids": ["B2"], "tied": ["A2", "B2"], "values": open_tie["values"], "method": "lead", "reason": "Sichtung der Spiele"}
    assert cross.evaluate(rule(promote_best=1), [one, two], {"promote_best": decision})["zones"] == {"B2": zones.PROMOTION}
    # Beide Zweiten haben nach einer Korrektur andere Werte, stehen aber wieder gleich: derselbe Kreis, ein neuer Gleichstand.
    other = [table("A", [(3, 9, 5), (3, 5, 1), (3, 3, -2), (3, 0, -5)]), table("B", [(3, 9, 5), (3, 5, 1), (3, 3, -2), (3, 0, -5)])]
    stale = cross.evaluate(rule(promote_best=1), other, {"promote_best": decision})
    assert stale["zones"] == {} and stale["ties"][0]["values"] == ["5/3", "1/3"]
    # Ein Entscheid ohne gespeicherte Werte gilt nicht.
    bare = {key: value for key, value in decision.items() if key != "values"}
    assert cross.evaluate(rule(promote_best=1), [one, two], {"promote_best": bare})["zones"] == {}


def test_the_loser_of_a_decision_is_marked_as_staying():
    one = table("A", [(3, 9, 5), (3, 6, 2), (3, 3, -2), (3, 0, -5)])
    two = table("B", [(3, 9, 5), (3, 6, 2), (3, 3, -2), (3, 0, -5)])
    values = cross.evaluate(rule(promote_best=1), [one, two])["ties"][0]["values"]
    found = cross.evaluate(rule(promote_best=1), [one, two],
                           {"promote_best": {"registration_ids": ["B2"], "tied": ["A2", "B2"], "values": values, "method": "playoff", "reason": "3:1"}})
    by_id = {item["registration_id"]: item for item in found["sides"][0]["candidates"]}
    assert (by_id["B2"]["chosen"], by_id["B2"]["passed"]) == (True, False)
    assert (by_id["A2"]["chosen"], by_id["A2"]["passed"]) == (False, True)
    assert found["sides"][0]["decision"]["tied"] == ["A2", "B2"]
