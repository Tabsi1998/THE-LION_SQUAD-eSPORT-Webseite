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
    sheets = {
        "r1": {"rows": [{"participant_id": "a", "place": 1, "team": "PDF Racing"},
                        {"participant_id": "c", "place": 2}, {"participant_id": "b", "place": 3}]},
        "r2": {"rows": [{"participant_id": "b", "place": 1, "team": "probe darkfriday"},
                        {"participant_id": "a", "place": 2}, {"participant_id": "c", "place": 3}]},
    }
    teams = [{"name": "Probe-DarkFriday", "aliases": ["PDF Racing"]}]
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
    sheets = {"r1": {"rows": [{"participant_id": "a", "place": 1}, {"participant_id": "b", "place": 2}]}}
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
