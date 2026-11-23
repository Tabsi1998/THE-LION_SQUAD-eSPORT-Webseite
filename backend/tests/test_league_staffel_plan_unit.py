"""Los auf mehrere Staffeln und Vorschlag der Staffelzahl (#1623, #1627): Rechnung ohne Datenbank - je Regel mit Gegenprobe."""
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import league_staffel_plan as plan  # noqa: E402


def entries(count: int, *, siblings: dict[str, int] | None = None) -> list[dict]:
    """``count`` Co-Teams, je eines je Hauptteam; ``siblings``: Hauptteam → Zahl seiner Co-Teams zusätzlich."""
    rows = [{"key": f"s{index:02d}", "team_id": f"t{index:02d}"} for index in range(1, count + 1)]
    for team, squads in (siblings or {}).items():
        rows += [{"key": f"{team}-{letter}", "team_id": team} for letter in "abcdefgh"[:squads]]
    return rows


def staffeln(count: int, *, capacity: int = 8, seats: dict[str, list[str]] | None = None) -> list[dict]:
    return [{"id": f"tid-{letter}", "staffel": letter, "capacity": capacity, "team_ids": list((seats or {}).get(letter, []))}
            for letter in "ABCDEFGH"[:count]]


def sizes_of(result: dict, rows: list[dict]) -> dict[str, int]:
    out = {row["id"]: len(row["team_ids"]) for row in rows}
    for target in result["placements"].values():
        out[target] += 1
    return out


# ---------------------------------------------------------------- Staffelzahl

def test_sizes_differ_by_at_most_one():
    assert plan.balanced_sizes(16, 2) == [8, 8]
    assert plan.balanced_sizes(21, 3) == [7, 7, 7]
    assert plan.balanced_sizes(10, 3) == [4, 3, 3]
    # Gegenprobe: ohne Staffel gibt es nichts zu verteilen.
    assert plan.balanced_sizes(5, 0) == []


def test_suggestion_uses_the_smaller_of_setting_and_calendar():
    # 7 aktive Wochen, nur Hinrunde: höchstens 8 Teams (7 Spieltage). Die Einstellung erlaubt 10 - der Kalender gewinnt.
    found = plan.suggest(10, max_size=10, active_weeks=7, legs=1)
    assert (found["cap"], found["cap_by"], found["needed"], found["sizes"]) == (8, "weeks", 2, [5, 5])
    # Gegenprobe: mit 9 Wochen passt die Einstellung, eine Staffel reicht.
    wide = plan.suggest(10, max_size=10, active_weeks=9, legs=1)
    assert (wide["cap"], wide["cap_by"], wide["needed"], wide["sizes"]) == (10, "setting", 1, [10])


def test_suggestion_says_what_is_missing():
    found = plan.suggest(9, max_size=8, active_weeks=10, legs=1, have=1)
    assert found["fits"] is False and found["needed"] == 2 and found["sizes"] == [5, 4]
    assert "2 Staffeln" in found["text"] and "5 und 4" in found["text"] and "fehlt" in found["text"]
    # Gegenprobe: mit zwei Staffeln passt es, der Satz warnt nicht mehr.
    ok = plan.suggest(9, max_size=8, active_weeks=10, legs=1, have=2)
    assert ok["fits"] is True and "fehlt" not in ok["text"]


def test_suggestion_spreads_over_existing_staffeln_when_there_are_more_than_needed():
    found = plan.suggest(9, max_size=8, active_weeks=10, legs=1, have=3)
    assert found["fits"] is True and found["needed"] == 2 and found["sizes"] == [3, 3, 3]


def test_suggestion_edge_cases():
    assert plan.suggest(0, max_size=8, active_weeks=10, legs=1)["needed"] == 0
    one = plan.suggest(1, max_size=8, active_weeks=10, legs=1, have=1)
    assert one["fits"] is False and "mindestens 2" in one["text"]
    # Der Kalender lässt gar keine Staffel zu (eine Woche, Hin- und Rückrunde).
    none = plan.suggest(6, max_size=8, active_weeks=1, legs=2)
    assert none["cap"] == 0 and none["fits"] is False and "Wochen" in none["text"]


# ---------------------------------------------------------------- Los

def test_draw_is_reproducible_and_complete():
    rows, groups = entries(13), staffeln(2)
    first = plan.draw(rows, groups, "seed-1")
    again = plan.draw(list(reversed(rows)), list(reversed(groups)), "seed-1")
    assert first == again  # gleiche Eingabe (egal in welcher Reihenfolge) + gleicher Seed = gleiches Ergebnis
    assert sorted(first["placements"]) == sorted(row["key"] for row in rows)  # jedes Co-Team genau einmal
    # Gegenprobe: ein anderer Seed lost anders.
    assert plan.draw(rows, groups, "seed-2")["placements"] != first["placements"]


@pytest.mark.parametrize("teams,count", [(16, 2), (21, 3), (9, 2), (5, 4), (2, 2)])
def test_draw_sizes_differ_by_at_most_one(teams, count):
    rows, groups = entries(teams), staffeln(count, capacity=12)
    sizes = sizes_of(plan.draw(rows, groups, "x"), groups).values()
    assert max(sizes) - min(sizes) <= 1 and sum(sizes) == teams


def test_draw_fills_up_around_teams_that_are_already_seated():
    groups = staffeln(2, seats={"A": ["old1", "old2", "old3"]})
    found = plan.draw(entries(5), groups, "x")
    assert sizes_of(found, groups) == {"tid-A": 4, "tid-B": 4}


def test_draw_keeps_sibling_squads_apart():
    rows = entries(4, siblings={"lions": 2, "wolves": 2})
    for seed in ("a", "b", "c", "d", "e", "f"):
        found = plan.draw(rows, staffeln(2), seed)["placements"]
        assert found["lions-a"] != found["lions-b"] and found["wolves-a"] != found["wolves-b"]
    # Gegenprobe: erlaubt die Season Geschwister in einer Staffel, landen sie bei irgendeinem Seed auch zusammen.
    together = [plan.draw(rows, staffeln(2), seed, siblings_allowed=True)["placements"] for seed in "abcdefghijklmnop"]
    assert any(found["lions-a"] == found["lions-b"] for found in together)


def test_draw_respects_a_sibling_that_is_already_seated():
    groups = staffeln(2, seats={"A": ["lions"]})
    rows = [{"key": "lions-b", "team_id": "lions"}, *entries(3)]
    for seed in "abcdef":
        assert plan.draw(rows, groups, seed)["placements"]["lions-b"] == "tid-B"


def test_draw_stays_balanced_when_siblings_force_a_choice():
    # Zwei Hauptteams mit je zwei Co-Teams und ein einzelnes: 3 + 2 geht nur, wenn die Paare getrennt stehen.
    rows = entries(1, siblings={"lions": 2, "wolves": 2})
    for seed in "abcdefgh":
        groups = staffeln(2)
        found = plan.draw(rows, groups, seed)
        assert sorted(sizes_of(found, groups).values()) == [2, 3]


def test_draw_refuses_what_cannot_work():
    with pytest.raises(plan.DrawProblem) as too_many_siblings:
        plan.draw(entries(2, siblings={"lions": 3}), staffeln(2), "x")
    assert "lions" not in too_many_siblings.value.message  # Kennungen stehen nicht im Satz, der Name kommt vom Aufrufer
    assert too_many_siblings.value.team_ids == ["lions"]
    with pytest.raises(plan.DrawProblem) as full:
        plan.draw(entries(9), staffeln(1, capacity=8), "x")
    assert "Plätze" in full.value.message
    with pytest.raises(plan.DrawProblem):
        plan.draw(entries(3), [], "x")
    with pytest.raises(plan.DrawProblem):
        plan.draw([], staffeln(2), "x")


def test_input_hash_follows_the_inputs():
    rows, groups = entries(4), staffeln(2)
    base = plan.input_hash(rows, groups, siblings_allowed=False)
    assert base == plan.input_hash(list(reversed(rows)), list(reversed(groups)), siblings_allowed=False)
    assert base != plan.input_hash(rows[:-1], groups, siblings_allowed=False)
    assert base != plan.input_hash(rows, staffeln(2, seats={"A": ["old"]}), siblings_allowed=False)
    assert base != plan.input_hash(rows, staffeln(2, capacity=6), siblings_allowed=False)
    assert base != plan.input_hash(rows, groups, siblings_allowed=True)


def test_swap_exchanges_two_teams_and_checks_siblings():
    rows = entries(2, siblings={"lions": 2})
    groups = staffeln(2)
    placements = {"s01": "tid-A", "lions-a": "tid-A", "s02": "tid-B", "lions-b": "tid-B"}
    swapped = plan.swap(rows, groups, placements, "s01", "s02")
    assert (swapped["s01"], swapped["s02"]) == ("tid-B", "tid-A")
    assert placements["s01"] == "tid-A"  # die Eingabe bleibt unverändert
    with pytest.raises(plan.DrawProblem):  # Geschwister kämen in dieselbe Staffel
        plan.swap(rows, groups, placements, "lions-a", "s02")
    with pytest.raises(plan.DrawProblem):  # dieselbe Staffel: nichts zu tauschen
        plan.swap(rows, groups, placements, "s01", "lions-a")
    # Gegenprobe: erlaubt die Season Geschwister, geht derselbe Tausch.
    assert plan.swap(rows, groups, placements, "lions-a", "s02", siblings_allowed=True)["lions-a"] == "tid-B"


def test_draw_with_siblings_allowed_keeps_a_squad_out_of_a_staffel_it_left():
    # Erlaubt die Season Geschwister, zählt jedes Co-Team für sich: s01 stand schon in Staffel A (ausgetreten, Platz frei).
    groups = [{"id": "tid-A", "staffel": "A", "capacity": 8, "team_ids": ["s01"], "seats": 0},
              {"id": "tid-B", "staffel": "B", "capacity": 8, "team_ids": [], "seats": 0}]
    for seed in "abcdef":
        assert plan.draw(entries(4), groups, seed, siblings_allowed=True)["placements"]["s01"] == "tid-B"
