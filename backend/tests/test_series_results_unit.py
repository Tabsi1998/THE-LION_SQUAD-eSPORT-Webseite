"""Ergebnisse eintragen (#1744) ohne Datenbank: Zeilen den Teilnehmern zuordnen (Kennung, Name, Startnummer, neue
Namen), Plausibilität mit Fehlern und Warnungen, Finalgrenze. Nur erfundene Namen."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import series_results  # noqa: E402
from services.scoring_rules import normalize_rules, result_points  # noqa: E402
from services.series_results import check, final_line, official_warnings, replace_new_ids, resolve  # noqa: E402

PEOPLE = [
    {"id": "p-anna", "name": "Anna Probe", "start_number": "7"},
    {"id": "p-bert", "name": "[TLS] Bert Bolzt", "start_number": "12"},
    {"id": "p-carl", "name": "Carl Kurve", "start_number": "21"},
    {"id": "p-carl2", "name": "carl kurve", "start_number": "22"},
]
SCHEME = normalize_rules({"points_by_place": [10, 6, 4], "bonuses": {"fastest_lap": {"points": 1}}})
ORGANIZER = normalize_rules({"points_mode": "organizer"})
ROUND = {"id": "r1", "status": "planned", "club_day": "2026-10-01", "counts": True}
TODAY = "2026-10-20"


def _codes(problems):
    return [item["code"] for item in problems]


def _resolved(rows, rules=SCHEME, **entry):
    return resolve({"rows": rows, **entry}, PEOPLE, rules)


# ---------------------------------------------------------------- Zuordnen
def test_rows_find_participants_by_id_name_without_clan_tag_and_start_number():
    out = _resolved([
        {"participant_id": "p-anna", "place": 1},
        {"name": "  bert   BOLZT ", "place": 2},
        {"name": "Ganz Anders", "start_number": "21 ", "place": 3, "official_total": 40},
        {"start_number": "7", "place": 4},
    ])
    assert [(row["participant_id"], row["match"]) for row in out.rows[:3]] == [
        ("p-anna", "id"), ("p-bert", "name_untagged"), ("p-carl", "start_number")]
    # Startnummer allein findet auch - hier steht Anna aber schon in Zeile 1.
    assert out.rows[3]["participant_id"] == "p-anna"
    assert _codes(out.warnings) == ["name_differs"] and out.warnings[0]["rows"] == [2]
    assert _codes(out.errors) == ["duplicate_participant"] and out.errors[0]["rows"] == [0, 3]
    assert out.official_totals == {"p-carl": 40}


def test_the_full_name_wins_over_the_name_without_clan_tag():
    people = [{"id": "p-1", "name": "[TLS] Dora"}, {"id": "p-2", "name": "Dora"}]
    out = resolve({"rows": [{"name": "dora", "place": 1}]}, people, SCHEME)
    assert (out.rows[0]["participant_id"], out.rows[0]["match"]) == ("p-2", "name")


def test_an_ambiguous_name_needs_the_start_number_or_a_choice():
    out = _resolved([{"name": "Carl Kurve", "start_number": "22", "place": 1}, {"name": "CARL KURVE", "place": 2}])
    assert out.rows[0]["participant_id"] == "p-carl2"
    assert out.rows[1]["participant_id"] is None
    assert _codes(out.errors) == ["ambiguous_name"] and out.errors[0]["rows"] == [1]


def test_unknown_names_become_new_people_once_with_their_rows_and_team():
    out = _resolved([{"name": "Neu Nora", "place": 1, "team": "Probe Team"}, {"name": "Fremd Fritz", "place": 2,
                                                                              "start_number": "99"}])
    assert [row["participant_id"] for row in out.rows] == ["neu:neunora", "neu:fremdfritz"]
    assert out.new_people["neunora"] == {"key": "neunora", "participant_id": "neu:neunora", "name": "Neu Nora",
                                         "start_number": None, "team": "Probe Team", "rows": [0], "matches": []}
    assert out.new_people["fremdfritz"]["start_number"] == "99"
    assert out.errors == []

    twice = _resolved([{"name": "Neu Nora", "place": 1}, {"name": "neu  nora!", "place": 2}])
    assert _codes(twice.errors) == ["duplicate_participant"]


def test_rows_without_a_usable_reference_are_errors():
    out = _resolved([{"participant_id": "fremd", "place": 1}, {"name": "!!!", "place": 2}, {"place": 3},
                     {"start_number": "404", "place": 4}])
    assert _codes(out.errors) == ["unknown_participant", "unusable_name", "missing_participant",
                                  "unknown_start_number"]
    assert [item["rows"] for item in out.errors] == [[0], [1], [2], [3]]
    assert all(row["participant_id"] is None for row in out.rows)
    assert out.content()["rows"] == []


def test_new_ids_are_replaced_everywhere_after_creating_the_people():
    out = _resolved([{"name": "Neu Nora", "place": 1, "official_total": 10}],
                    matches=[{"home": "A", "away": "B", "home_score": 1, "away_score": 0,
                              "lineup": [{"name": "Neu Nora"}, {"participant_id": "p-anna"}]}])
    content = replace_new_ids(out.content(), {"neunora": "p-nora"})
    assert content["rows"][0]["participant_id"] == "p-nora"
    assert content["matches"][0]["lineup"] == ["p-nora", "p-anna"]
    assert content["official_totals"] == {"p-nora": 10}
    assert out.new_people["neunora"]["matches"] == [0]


# ---------------------------------------------------------------- Plausibilität
def test_places_gaps_twice_missing_and_dns_with_place_are_warnings():
    out = _resolved([{"participant_id": "p-anna", "place": 1}, {"participant_id": "p-bert", "place": 1},
                     {"participant_id": "p-carl", "place": 4}, {"participant_id": "p-carl2"}])
    check(out, SCHEME, ROUND, TODAY)
    assert out.errors == []
    assert _codes(out.warnings) == ["place_missing", "place_twice", "place_gap"]
    gap = out.warnings[-1]
    assert gap["places"] == [2, 3] and gap["message"] == "Plätze 2, 3 fehlen in der Reihenfolge."

    dns = _resolved([{"participant_id": "p-anna", "place": 1},
                     {"participant_id": "p-bert", "place": 2, "marks": ["dns"]}])
    check(dns, SCHEME, ROUND, TODAY)
    assert _codes(dns.warnings) == ["dns_with_place"]


def test_points_against_the_scheme():
    out = _resolved([
        {"participant_id": "p-anna", "place": 1, "points": 11, "marks": ["fastest_lap"]},  # passt: 10 + 1
        {"participant_id": "p-bert", "place": 2, "points": 8},                               # Schlüssel sagt 6
    ])
    check(out, SCHEME, ROUND, TODAY)
    assert _codes(out.warnings) == ["points_differ"]
    assert [row["points_source"] for row in out.rows] == ["scheme", "scheme"]


def test_with_a_scheme_organizer_points_are_only_compared_and_the_scheme_counts():
    out = _resolved([{"participant_id": "p-carl", "place": 3, "points": 7, "points_source": "organizer"}])
    check(out, SCHEME, ROUND, TODAY)
    row = out.rows[0]
    # Gespeichert als Wert des Veranstalters, gezählt wird der Schlüssel (Platz 3: 4 Punkte) - mit Warnung.
    assert (row["points_source"], row["points"]) == ("organizer", 7)
    assert result_points(row, SCHEME)["points"] == 4
    points = [item for item in out.warnings if item["code"].startswith("points")]
    assert _codes(points) == ["points_differ"] and "gezählt wird der Schlüssel" in points[0]["message"]


def test_with_a_scheme_only_manual_points_override_it():
    out = _resolved([{"participant_id": "p-carl", "place": 3, "points": 5, "points_source": "manual"}])
    check(out, SCHEME, ROUND, TODAY)
    row = out.rows[0]
    assert (row["points_source"], result_points(row, SCHEME)["points"]) == ("manual", 5)
    assert [code for code in _codes(out.warnings) if code.startswith("points")] == ["points_manual"]


def test_points_by_the_organizer_are_kept_and_missing_ones_are_flagged():
    out = _resolved([{"participant_id": "p-anna", "place": 1, "points": 30},
                     {"participant_id": "p-bert", "place": 2},
                     {"participant_id": "p-carl", "marks": ["dns"]}], rules=ORGANIZER)
    check(out, ORGANIZER, ROUND, TODAY)
    assert [row["points_source"] for row in out.rows] == ["organizer", "organizer", "organizer"]
    # In der Serie „laut Veranstalter“ zählt der eingetragene Wert.
    assert result_points(out.rows[0], ORGANIZER)["points"] == 30
    assert _codes(out.warnings) == ["points_missing"] and out.warnings[0]["rows"] == [1]


def test_the_round_itself_empty_cancelled_archived_future_not_counted():
    empty = _resolved([])
    check(empty, SCHEME, ROUND, TODAY)
    assert _codes(empty.errors) == ["empty"]

    rows = [{"participant_id": "p-anna", "place": 1}]
    closed = _resolved(rows)
    check(closed, SCHEME, {**ROUND, "status": "cancelled", "archived_at": "2026-10-02T00:00:00+00:00"}, TODAY)
    assert _codes(closed.errors) == ["round_archived", "round_cancelled"]

    later = _resolved(rows)
    check(later, SCHEME, {**ROUND, "club_day": "2026-11-01", "counts": False}, TODAY)
    assert later.errors == [] and _codes(later.warnings) == ["round_in_future", "round_not_counted"]


def test_team_league_lineup_maps_own_team_and_official_table():
    out = resolve({"matches": [
        {"home": "Probe Löwen", "away": "Probe Gegner", "home_score": 2, "away_score": 1,
         "maps": [{"name": "Map A", "home_score": 13, "away_score": 9}, {"name": "Map B", "home_score": 5,
                                                                         "away_score": 13}],
         "lineup": [{"participant_id": "p-anna"}, {"name": "Anna Probe"}, {"name": "Neu Nora"}]},
        {"home": "Fremd A", "away": "Fremd B", "home_score": 1, "away_score": 1},
    ], "official_table": [
        {"team": "Probe Löwen", "rank": 1, "points": 3}, {"team": "probe löwen", "points": 0},
        {"team": "Probe Gegner", "rank": 2, "points": 0},
    ]}, PEOPLE, SCHEME)
    check(out, SCHEME, ROUND, TODAY, own_teams="Probe Löwen")
    assert out.errors == []
    assert out.matches[0]["lineup"] == ["p-anna", "neu:neunora"]
    # Das zweite Spiel ist ein übriges Spiel des Spieltags (#1931) - ohne eigenes Team, ohne Warnung.
    assert _codes(out.warnings) == ["maps_differ", "table_team_twice", "table_rank_partial"]
    assert out.warnings[0]["message"] == "Spiel 1: Die Maps ergeben 1:1, eingetragen ist 2:1."
    assert out.official_table[0] == {"team": "Probe Löwen", "rank": 1, "played": None, "won": None, "drawn": None,
                                     "lost": None, "score_for": None, "score_against": None, "score_diff": None,
                                     "points": 3}


def test_lineup_errors_point_to_the_match():
    out = resolve({"matches": [{"home": "A", "away": "B", "home_score": 0, "away_score": 0,
                                "lineup": [{"participant_id": "fremd"}]}]}, PEOPLE, SCHEME)
    assert out.errors == [{"code": "unknown_participant", "match": 0, "rows": [],
                           "message": "Spiel 1, Aufstellung: Diesen Teilnehmer gibt es in der Saison nicht."}]


# ---------------------------------------------------------------- Offizieller Wert und Finalgrenze
def test_official_deviation_is_named():
    rows = [{"participant_id": "p-anna", "deviation": 2, "official_points": 27, "computed_points": 25},
            {"participant_id": "p-bert", "deviation": None, "official_points": None, "computed_points": 18},
            {"participant_id": "p-carl", "deviation": 0, "official_points": 15, "computed_points": 15}]
    found = official_warnings(rows, {"p-anna": "Anna Probe"}, scope="drivers")
    assert [item["message"] for item in found] == ["„Anna Probe“: offiziell 27, gerechnet 25 (+2)."]


def test_final_line_with_shared_places_and_movement():
    now = [{"participant_id": "a", "rank": 1}, {"participant_id": "c", "rank": 2}, {"participant_id": "b", "rank": 2},
           {"participant_id": "d", "rank": 4}]
    before = [{"participant_id": "a", "rank": 1}, {"participant_id": "d", "rank": 2},
              {"participant_id": "b", "rank": 3}]
    assert final_line(now, before, 2) == {"top_n": 2, "participant_ids": ["a", "c", "b"], "entered": ["c", "b"],
                                          "left": ["d"]}
    assert final_line(now, None, 2)["entered"] == []
    assert final_line(now, before, None) is None


def test_only_known_marks_and_clean_numbers_are_kept():
    out = _resolved([{"participant_id": "p-anna", "place": 1, "points": 25.0, "penalty_points": 5.0,
                      "marks": ["pole", "dnf", "pole"]}])
    row = out.content()["rows"][0]
    assert row == {"participant_id": "p-anna", "place": 1, "team": None, "points": 25, "points_source": "scheme",
                   "marks": ["dnf", "pole"], "penalty_points": 5, "note": None}
    assert series_results.is_new("neu:x") and not series_results.is_new("p-anna")
