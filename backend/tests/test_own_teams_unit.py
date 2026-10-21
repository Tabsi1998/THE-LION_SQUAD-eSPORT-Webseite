"""Mehrere eigene Teams je Saison (#1926): die Liste „Eigene Teams“ (das alte Feld ``team_name`` wird übernommen) und
die Zuordnung eines Ergebnis-Teams über Schreibweisen und Alias. In den Ständen zählt jedes eigene Team unter seinem
Namen, auch wenn der Veranstalter es einmal anders schreibt. Nur erfundene Namen."""
import pytest

from services import own_teams, series_results
from services.scoring_rules import normalize_rules
from services.series_standings import compute_standings


def test_the_old_single_team_is_taken_over_and_the_list_is_cleaned():
    assert own_teams.own_teams({"team_name": " Probe Löwen "}) == [{"name": "Probe Löwen", "aliases": []}]
    assert own_teams.own_teams({}) == []
    series = {"team_name": "Alt", "own_teams": [
        {"name": "Probe Löwen", "aliases": ["PL", " ", "pl"]}, {"name": " "}, {"name": "probe löwen"},
        {"name": "Probe-DarkFriday", "aliases": []}]}
    # Die Liste gilt vor dem alten Feld; leere und doppelte Namen fallen weg, Aliase ohne Doppel.
    assert own_teams.own_teams(series) == [{"name": "Probe Löwen", "aliases": ["PL"]},
                                           {"name": "Probe-DarkFriday", "aliases": []}]
    assert own_teams.own_team_names(series) == ["Probe Löwen", "Probe-DarkFriday"]


def test_a_result_team_is_matched_by_spelling_and_alias():
    matcher = own_teams.Matcher([{"name": "Probe-DarkFriday", "aliases": ["PDF Racing"]}, {"name": "Probe Löwen"}])
    assert matcher.canonical("Probe DarkFriday") == "Probe-DarkFriday"
    assert matcher.canonical("probe_darkfriday") == "Probe-DarkFriday"
    assert matcher.canonical("PDF-Racing") == "Probe-DarkFriday"
    assert matcher.canonical("PROBE LÖWEN") == "Probe Löwen"
    assert matcher.canonical("Fremd Rot") == "Fremd Rot"
    assert matcher.canonical(None) is None
    assert matcher.is_own("pdf racing") and not matcher.is_own("Fremd Rot")
    # Auch eine reine Namensliste (alte Aufrufe) taugt.
    assert own_teams.Matcher(["Probe Löwen"]).is_own("probe-löwen")


SCHEME = [10, 6, 4]
PEOPLE = [
    {"id": "a", "name": "Probe A", "link": "member", "default_team": "Probe-DarkFriday"},
    {"id": "b", "name": "Probe B", "link": "member", "default_team": "Probe DarkFriday"},
    {"id": "c", "name": "Fremd C", "link": "external", "default_team": "Fremd Rot"},
]


def test_team_scoring_counts_an_own_team_once_whatever_the_spelling():
    rules = normalize_rules({"points_by_place": SCHEME, "team_scoring": {"enabled": True}})
    rounds = [{"id": "r1", "order": 1, "status": "scored"}, {"id": "r2", "order": 2, "status": "scored"}]
    # Ohne gelesenes Team steht das Standard-Team in der Zeile (#1960: beim Eintragen vorbelegt, Altdaten migriert).
    sheets = {
        "r1": {"rows": [{"participant_id": "a", "place": 1, "team": "PDF Racing"},
                        {"participant_id": "c", "place": 2, "team": "Fremd Rot"},
                        {"participant_id": "b", "place": 3, "team": "Probe DarkFriday"}]},
        "r2": {"rows": [{"participant_id": "b", "place": 1, "team": "probe darkfriday"},
                        {"participant_id": "a", "place": 2, "team": "Probe-DarkFriday"},
                        {"participant_id": "c", "place": 3, "team": "Fremd Rot"}]},
    }
    # Die Standard-Teams von a und b sind zwei wörtlich verschiedene Schreibweisen - zusammen gehören sie nur, weil
    # „Probe DarkFriday“ als Schreibweise eingetragen ist. „probe darkfriday“ im zweiten Rennen passt ohnehin.
    teams = [{"name": "Probe-DarkFriday", "aliases": ["PDF Racing", "Probe DarkFriday"]}]
    snapshots = compute_standings(rules=rules, rounds=rounds, sheets=sheets, participants=PEOPLE, own_teams=teams)
    table = [snap for snap in snapshots if snap["scope"] == "teams"][-1]["rows"]
    assert [(row["team"], row["points"]) for row in table] == [("Probe-DarkFriday", 30), ("Fremd Rot", 10)]
    drivers = [snap for snap in snapshots if snap["scope"] == "drivers"][-1]["rows"]
    assert {item["team"] for row in drivers if row["participant_id"] in ("a", "b") for item in row["results"]
            if item["team"]} == {
        "Probe-DarkFriday"}


def test_without_own_teams_spellings_stay_apart_as_before():
    rules = normalize_rules({"points_by_place": SCHEME, "team_scoring": {"enabled": True}})
    rounds = [{"id": "r1", "order": 1, "status": "scored"}]
    sheets = {"r1": {"rows": [{"participant_id": "a", "place": 1, "team": "Probe-DarkFriday"},
                              {"participant_id": "b", "place": 2, "team": "Probe DarkFriday"}]}}
    snapshots = compute_standings(rules=rules, rounds=rounds, sheets=sheets, participants=PEOPLE)
    table = [snap for snap in snapshots if snap["scope"] == "teams"][-1]["rows"]
    assert sorted(row["team"] for row in table) == ["Probe DarkFriday", "Probe-DarkFriday"]


@pytest.mark.parametrize(("home", "away", "missing"), [
    ("Probe Löwen B", "Fremd Rot", False), ("Fremd Rot", "probe-löwen", False), ("Fremd Rot", "Fremd Blau", True)])
def test_the_own_team_check_of_a_match_knows_every_own_team(home, away, missing):
    resolution = series_results.resolve(
        {"matches": [{"home": home, "away": away, "home_score": 2, "away_score": 1}]}, [],
        normalize_rules({"points_mode": "organizer"}))
    series_results.check(resolution, normalize_rules({"points_mode": "organizer"}), {"status": "planned"},
                         "2026-11-01", [{"name": "Probe Löwen"}, {"name": "Probe Löwen B"}])
    codes = [warning["code"] for warning in resolution.warnings]
    assert ("own_team_missing" in codes) is missing


# ---------------------------------------------------------------- Schreibweisen ohne stilles Zusammenlegen
def test_two_own_teams_that_only_differ_in_spelling_stay_two_teams():
    teams = own_teams.clean_teams([{"name": "A-B"}, {"name": "AB"}, {"name": "a-b"}])
    # Nur wörtlich gleiche Namen (ohne Groß/klein) sind doppelt - „A-B“ und „AB“ bleiben zwei Teams.
    assert [team["name"] for team in teams] == ["A-B", "AB"]
    matcher = own_teams.Matcher(teams)
    assert (matcher.canonical("a-b"), matcher.canonical("ab")) == ("A-B", "AB")
    # Eine dritte Schreibweise passt zu beiden - sie gehört keinem.
    assert matcher.canonical("A B") == "A B"
    assert not matcher.is_own("A B")


def test_a_spelling_counts_only_without_a_literally_different_team_of_the_same_form_beside_it():
    matcher = own_teams.Matcher([{"name": "Probe-DarkFriday", "aliases": ["PDF Racing"]}])
    assert matcher.canonical("Probe DarkFriday", ["Probe DarkFriday", "Fremd Rot"]) == "Probe-DarkFriday"
    # Steht „Probe-DarkFriday“ wörtlich daneben, ist „Probe DarkFriday“ ein anderes Team.
    assert matcher.canonical("Probe DarkFriday", ["Probe DarkFriday", "Probe-DarkFriday"]) == "Probe DarkFriday"
    assert not matcher.is_own("Probe DarkFriday", ["Probe-DarkFriday"])
    # Name und ausdrücklicher Alias gelten immer.
    assert matcher.canonical("Probe-DarkFriday", ["Probe DarkFriday"]) == "Probe-DarkFriday"
    assert matcher.canonical("pdf racing", ["PDF-Racing"]) == "Probe-DarkFriday"


def test_standings_keep_a_colliding_spelling_apart():
    rules = normalize_rules({"points_by_place": SCHEME, "team_scoring": {"enabled": True}})
    rounds = [{"id": "r1", "order": 1, "status": "scored"}]
    sheets = {"r1": {"rows": [{"participant_id": "a", "place": 1, "team": "Probe-DarkFriday"},
                              {"participant_id": "b", "place": 2, "team": "Probe DarkFriday"},
                              {"participant_id": "c", "place": 3, "team": "Fremd Rot"}]}}
    snapshots = compute_standings(rules=rules, rounds=rounds, sheets=sheets, participants=PEOPLE,
                                  own_teams=[{"name": "Probe-DarkFriday"}])
    table = [snap for snap in snapshots if snap["scope"] == "teams"][-1]["rows"]
    assert [(row["team"], row["points"]) for row in table] == [
        ("Probe-DarkFriday", 10), ("Probe DarkFriday", 6), ("Fremd Rot", 4)]


def test_the_sheet_check_names_a_spelling_that_is_not_merged():
    rules = normalize_rules({"points_by_place": SCHEME})
    resolution = series_results.resolve({"rows": [
        {"name": "Anna", "place": 1, "team": "Probe-DarkFriday"},
        {"name": "Bert", "place": 2, "team": "Probe DarkFriday"},
        {"name": "Carl", "place": 3, "team": "A B"}]}, [], rules)
    series_results.check(resolution, rules, {"status": "planned"}, "2026-11-01",
                         [{"name": "Probe-DarkFriday"}, {"name": "A-B"}, {"name": "AB"}])
    spelling = [warning for warning in resolution.warnings if warning["code"] == "own_team_spelling"]
    assert len(spelling) == 2
    assert "„Probe DarkFriday“" in spelling[0]["message"] and "„Probe-DarkFriday“" in spelling[0]["message"]
    assert spelling[0]["rows"] == [1]
    assert "„A B“" in spelling[1]["message"] and "„A-B“" in spelling[1]["message"]
    # Ohne Doppel im Blatt zählt die Schreibweise still als das eigene Team - kein Hinweis.
    quiet = series_results.resolve({"rows": [{"name": "Bert", "place": 1, "team": "Probe DarkFriday"}]}, [], rules)
    series_results.check(quiet, rules, {"status": "planned"}, "2026-11-01", [{"name": "Probe-DarkFriday"}])
    assert "own_team_spelling" not in [warning["code"] for warning in quiet.warnings]


def test_the_exact_name_of_an_own_team_wins_over_another_teams_alias():
    teams = [{"name": "Probe Alpha", "aliases": ["Probe Bravo"]}, {"name": "Probe Bravo"}]
    matcher = own_teams.Matcher(teams)
    assert matcher.canonical("Probe Bravo") == "Probe Bravo"
    assert matcher.canonical("probe bravo") == "Probe Bravo"
    assert own_teams.team_conflicts(teams) == [
        "Die Schreibweise „Probe Bravo“ von „Probe Alpha“ ist der Name des eigenen Teams „Probe Bravo“."]
    shared = [{"name": "Probe Alpha", "aliases": ["PA"]}, {"name": "Probe Bravo", "aliases": ["pa"]}]
    assert own_teams.team_conflicts(shared) == [
        "Die Schreibweise „pa“ steht bei „Probe Alpha“ und „Probe Bravo“."]
    assert own_teams.team_conflicts([{"name": "Probe Alpha", "aliases": ["PA"]}, {"name": "Probe Bravo"}]) == []
