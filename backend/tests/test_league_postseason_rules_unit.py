"""Einstellungen für Playoffs und Relegation (#2404, docs/LIGA.md „F.6 … Einstellungen im Einzelnen“) - Prüfen, Zusammenführen, Kalender."""
import pathlib
import sys
from datetime import date

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import league_postseason_rules as rules  # noqa: E402
from services import league_scope  # noqa: E402

SEASON = {"start_date": "2031-03-03T00:00:00", "weeks_total": 4, "matchday_days": 7, "best_of": 3, "max_staffel_size": 8,
          "blocked_periods": [{"start_date": "2031-04-07", "end_date": "2031-04-13", "label": "Pause"}]}


def test_without_the_field_nothing_is_enabled():
    found = rules.effective(SEASON, {"level": 1})
    assert not found["playoffs"]["enabled"] and not found["relegation"]["enabled"]
    assert found["champion_source"] == "table" and found["reopen_guard"] == "hint"
    assert found["playoffs"]["best_of"] == 3 and found["relegation"]["best_of"] == 3
    assert not rules.any_enabled(SEASON)
    assert rules.sport_key(found) == (False, 0, False)


def test_clean_fills_the_defaults_and_keeps_what_was_set():
    saved = rules.clean_season({"playoffs": {"enabled": True, "per_staffel": 4, "best_of": 5, "third_place": True,
                                             "best_of_rounds": [{"round": 3, "best_of": 7}, {"round": 1, "best_of": 3}]},
                                "relegation": {"enabled": True}, "champion_source": "playoffs"}, SEASON)
    assert saved["playoffs"] == {"enabled": True, "per_staffel": 4, "format": "single_elim", "seeding": "cross", "best_of": 5,
                                 "best_of_rounds": [{"round": 1, "best_of": 3}, {"round": 3, "best_of": 7}], "third_place": True,
                                 "home": "better_seed", "start_date": None}
    assert saved["relegation"] == {"enabled": True, "best_of": None, "start_date": None}
    assert saved["champion_source"] == "playoffs" and saved["reopen_guard"] == "hint"


@pytest.mark.parametrize("body, word", [
    ({"playoffs": {"enabled": True}}, "wie viele Teams"),
    ({"playoffs": {"enabled": True, "per_staffel": 0}}, "wie viele Teams"),
    ({"playoffs": {"enabled": True, "per_staffel": 17}}, "wie viele Teams"),
    ({"playoffs": {"enabled": True, "per_staffel": 9}}, "mehr als Teams"),
    ({"playoffs": {"enabled": True, "per_staffel": 4, "best_of": 4}}, "Best of"),
    ({"playoffs": {"enabled": True, "per_staffel": 4, "format": "double_elim"}}, "Einfach-K.-o."),
    ({"playoffs": {"enabled": True, "per_staffel": 4, "home": "tree"}}, "Heimrecht"),
    ({"playoffs": {"enabled": True, "per_staffel": 4, "best_of_rounds": [{"round": 9, "best_of": 3}]}}, "Runde"),
    ({"playoffs": {"enabled": True, "per_staffel": 4, "best_of_rounds": [{"round": 1, "best_of": 3}, {"round": 1, "best_of": 5}]}}, "Runde"),
    ({"playoffs": {"enabled": True, "per_staffel": 4, "start_date": "2031-03-20"}}, "regulären Season"),
    ({"playoffs": {"enabled": True, "per_staffel": 4, "start_date": "bald"}}, "Datum"),
    ({"relegation": {"enabled": True, "best_of": 2}}, "Best of"),
    ({"champion_source": "cup"}, "Meister aus"),
    ({"reopen_guard": "never"}, "Wiederöffnen"),
])
def test_wrong_values_are_refused_in_plain_words(body, word):
    with pytest.raises(rules.PostseasonProblem) as problem:
        rules.clean_season(body, SEASON)
    assert word in problem.value.message and problem.value.status == 422


def test_a_division_overrides_a_whole_part_and_keeps_the_rest():
    season = {**SEASON, "postseason": rules.clean_season({"playoffs": {"enabled": True, "per_staffel": 4}, "relegation": {"enabled": True}}, SEASON)}
    own = rules.clean_division({"playoffs": {"enabled": True, "per_staffel": 2, "best_of": 5}}, SEASON, staffel_size=6)
    found = rules.effective(season, {"level": 2, "postseason": own}, best_of=3)
    assert found["playoffs"]["per_staffel"] == 2 and found["playoffs"]["best_of"] == 5
    assert found["relegation"]["enabled"] and found["own"] == {"playoffs": True, "relegation": False}
    assert rules.clean_division({}, SEASON) is None
    # Playoffs in dieser Liga aus, obwohl die Season sie hat.
    off = rules.effective(season, {"postseason": rules.clean_division({"playoffs": {"enabled": False}}, SEASON)})
    assert not off["playoffs"]["enabled"] and rules.sport_key(off) == (False, 0, True)


def test_best_of_per_round_and_round_names():
    playoffs = {"best_of": 3, "best_of_rounds": [{"round": 3, "best_of": 7}]}
    assert [rules.best_of_for(playoffs, number) for number in (1, 2, 3)] == [3, 3, 7]
    assert [rules.round_label(number, 4) for number in (1, 2, 3, 4)] == ["Achtelfinale", "Viertelfinale", "Halbfinale", "Finale"]
    assert rules.round_label(1, 5) == "Runde 1"


def test_playoff_weeks_start_after_the_regular_season_and_skip_blocked_weeks():
    # Vier Wochen ab 03.03.: die letzte endet am 30.03. - Start am 31.03., die Woche 07.-13.04. ist gesperrt.
    assert rules.regular_end_day(SEASON) == date(2031, 3, 30)
    assert rules.default_start(SEASON) == date(2031, 3, 31)
    found = rules.weeks(SEASON, rules.default_start(SEASON), 3)
    assert [(row["round"], row["start_day"]) for row in found["rounds"]] == [(1, "2031-03-31"), (2, "2031-04-14"), (3, "2031-04-21")]
    assert found["blocked"] == [2] and found["end_day"] == "2031-04-27"
    assert rules.weeks(SEASON, None, 2)["rounds"] == []


def test_staffel_kind_and_label():
    regular = {"league_context": {"season_id": "s", "division_id": "d", "staffel": "A"}}
    playoff = {"league_context": {"season_id": "s", "division_id": "d", "staffel": "PO", "kind": "playoff"}}
    relegation = {"league_context": {"season_id": "s", "division_id": "d", "staffel": "REL", "kind": "relegation"}}
    assert [league_scope.staffel_kind(row) for row in (regular, playoff, relegation, {"id": "t"}, None)] == [None, "playoff", "relegation", None, None]
    assert [league_scope.staffel_label(row) for row in (regular, playoff, relegation, {"id": "t"})] == ["Staffel A", "Playoffs", "Relegation", None]
    assert [league_scope.league_label(row) for row in (regular, playoff, relegation, {"id": "t"})] == [
        "Liga · Staffel A", "Liga · Playoffs", "Liga · Relegation", None]
    assert league_scope.is_regular_staffel(regular) and not league_scope.is_regular_staffel(playoff)
    # Ein unbekannter Wert ist keine Art: Die Staffel bleibt regulär.
    assert league_scope.staffel_kind({"league_context": {"staffel": "A", "kind": "regular"}}) is None
