"""Team-Liga im Ergebnisblatt (#1931) ohne Datenbank: übrige Spiele des Spieltags, Maps mit Wahl und Aufstellung je Map,
Banns, Termin des eigenen Spiels und Zusammenführen. Nur erfundene Namen."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import series_participants  # noqa: E402
from services.scoring_rules import normalize_rules  # noqa: E402
from services.series_results import check, replace_new_ids, resolve  # noqa: E402

PEOPLE = [{"id": "p-anna", "name": "Anna Probe"}, {"id": "p-bert", "name": "Bert Probe"},
          {"id": "p-carl", "name": "Carl Probe"}, {"id": "p-dora", "name": "Dora Probe"}]
RULES = normalize_rules({"points_mode": "organizer"})
ROUND = {"id": "st1", "status": "planned", "club_day": "2026-05-13", "counts": True}
TODAY = "2026-05-20"
OWN = [{"name": "Probe Löwen"}]


def _codes(problems):
    return [item["code"] for item in problems]


def _own_match(**extra):
    return {"home": "Probe Löwen", "away": "Probe Falken", "home_score": 2, "away_score": 1, **extra}


def test_maps_keep_who_picked_them_and_a_lineup_each_and_the_match_lineup_is_their_union():
    out = resolve({"matches": [_own_match(
        maps=[{"name": "Karte Nord", "home_score": 6, "away_score": 3, "picked_by": "home",
               "lineup": [{"participant_id": "p-anna"}, {"name": "Bert Probe"}, {"participant_id": "p-carl"},
                          {"name": "Neu Nora"}]},
              {"name": "Karte Süd", "home_score": 4, "away_score": 6, "picked_by": "away",
               "lineup": [{"participant_id": "p-anna"}, {"participant_id": "p-dora"}]},
              {"name": "Karte West", "home_score": 6, "away_score": 5, "picked_by": "decider"}],
        lineup=[{"participant_id": "p-bert"}],
        bans=[{"name": "Karte Ost", "by": "home"}, {"name": " Karte  Hafen ", "by": "away"}])]}, PEOPLE, RULES)
    assert out.errors == []
    match = out.matches[0]
    assert match["lineup"] == ["p-bert", "p-anna", "p-carl", "neu:neunora", "p-dora"]
    assert [(item["name"], item.get("picked_by"), item.get("lineup")) for item in match["maps"]] == [
        ("Karte Nord", "home", ["p-anna", "p-bert", "p-carl", "neu:neunora"]),
        ("Karte Süd", "away", ["p-anna", "p-dora"]),
        ("Karte West", "decider", None)]
    assert match["bans"] == [{"name": "Karte Ost", "by": "home"}, {"name": "Karte Hafen", "by": "away"}]
    assert list(out.new_people) == ["neunora"]

    saved = replace_new_ids(out.content(), {"neunora": "p-nora"})
    assert saved["matches"][0]["lineup"][3] == "p-nora"
    assert saved["matches"][0]["maps"][0]["lineup"] == ["p-anna", "p-bert", "p-carl", "p-nora"]


def test_a_match_without_extras_is_stored_exactly_as_before():
    out = resolve({"matches": [_own_match(maps=[{"name": "Karte Nord", "home_score": 6, "away_score": 3}])]},
                  PEOPLE, RULES)
    assert out.matches[0] == {"home": "Probe Löwen", "away": "Probe Falken", "home_score": 2, "away_score": 1,
                              "maps": [{"name": "Karte Nord", "home_score": 6, "away_score": 3}], "lineup": []}


def test_the_own_match_keeps_its_vienna_day_and_time():
    out = resolve({"matches": [_own_match(day="2026-05-14", time="21:15")]}, PEOPLE, RULES)
    match = out.matches[0]
    assert (match["club_day"], match["time"], match["starts_at"]) == ("2026-05-14", "21:15",
                                                                      "2026-05-14T19:15:00+00:00")
    gap = resolve({"matches": [_own_match(day="2026-03-29", time="02:30")]}, PEOPLE, RULES)
    assert _codes(gap.errors) == ["match_time"]
    assert gap.errors[0]["match"] == 0


def test_other_matches_of_the_matchday_need_no_own_team_but_one_match_must_have_it():
    out = resolve({"matches": [_own_match(), {"home": "Probe Adler", "away": "Probe Eulen", "home_score": 0,
                                              "away_score": 2}]}, PEOPLE, RULES)
    check(out, RULES, ROUND, TODAY, OWN)
    assert "own_team_missing" not in _codes(out.warnings)

    none = resolve({"matches": [{"home": "Probe Adler", "away": "Probe Eulen", "home_score": 0, "away_score": 2},
                                {"home": "Probe Wölfe", "away": "Probe Falken", "home_score": 2, "away_score": 2}]},
                   PEOPLE, RULES)
    check(none, RULES, ROUND, TODAY, OWN)
    missing = [item for item in none.warnings if item["code"] == "own_team_missing"]
    assert [item["message"] for item in missing] == ["Das eigene Team „Probe Löwen“ spielt in keinem der Spiele."]


def test_a_map_lineup_with_an_unknown_id_points_to_its_match():
    out = resolve({"matches": [_own_match(maps=[{"name": "Karte Nord", "home_score": 6, "away_score": 3,
                                                 "lineup": [{"participant_id": "fremd"}]}])]}, PEOPLE, RULES)
    assert [(item["code"], item["match"]) for item in out.errors] == [("unknown_participant", 0)]
    assert out.errors[0]["message"].startswith("Spiel 1, Map 1:")


def test_merging_two_participants_also_swaps_the_map_lineups():
    content = {"matches": [{"home": "Probe Löwen", "away": "Probe Falken", "home_score": 1, "away_score": 0,
                            "lineup": ["p-anna", "p-dup"],
                            "maps": [{"name": "Karte Nord", "home_score": 6, "away_score": 2,
                                      "lineup": ["p-dup"]}]}]}
    swapped = series_participants.swap_participant(content, "p-dup", "p-bert")
    assert swapped["matches"][0]["lineup"] == ["p-anna", "p-bert"]
    assert swapped["matches"][0]["maps"][0]["lineup"] == ["p-bert"]
    assert series_participants.content_participant_ids(content) == {"p-anna", "p-dup"}
