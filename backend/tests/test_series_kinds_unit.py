"""Art-Profil je Spur-Art (#2024) ohne Datenbank: jede Art hat Felder, Begriffe, Standardregeln und Vorlagen; die
Turnierserie kennt keinen Ort, keine Flagge und keine F1-Boni, die Rennliga bleibt wie bisher, und die Terminliste
liest eine Zeile ohne Datum bei der Turnierserie als offenen Termin."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import series_kinds  # noqa: E402
from services.reference_calendar import parse_round_lines  # noqa: E402
from services.reference_series import POINTS_SCHEME_TEMPLATES, SERIES_KINDS  # noqa: E402
from services.scoring_rules import normalize_rules  # noqa: E402


def test_every_kind_has_a_complete_profile():
    for kind in SERIES_KINDS:
        profile = series_kinds.profile(kind)
        assert profile["kind"] == kind
        assert set(profile) >= {"label", "fields", "vocab", "default_rules", "templates", "placeholders"}
        assert set(profile["fields"]) == set(series_kinds.FIELD_KEYS)
        assert set(profile["vocab"]) == set(series_kinds.VOCAB_KEYS)
        # Die Standardregeln sind vollständig und gültig - das Formular braucht keine eigenen Standards.
        assert profile["default_rules"] == normalize_rules(profile["default_rules"])


def test_an_unknown_kind_falls_back_to_the_tournament_series():
    assert series_kinds.profile("schach")["kind"] == "series"
    assert series_kinds.profile(None)["kind"] == "series"


def test_the_tournament_series_has_no_place_flag_or_race_extras():
    fields = series_kinds.profile("series")["fields"]
    assert not any(fields[key] for key in ("venue", "country", "session", "opponent", "race_details",
                                           "race_extras", "race_bonuses", "team_scoring", "start_number"))
    assert fields["day_rounds"] and fields["double_up"] and fields["name_tags"] and fields["result_needs_day"]
    assert fields["marks"] == ["dns", "dsq", "left"]


def test_the_tournament_series_speaks_of_tournament_days_and_players():
    vocab = series_kinds.profile("series")["vocab"]
    assert (vocab["round_one"], vocab["round_many"], vocab["round_dative"]) == ("Turniertag", "Turniertage",
                                                                                "Turniertagen")
    assert (vocab["person_one"], vocab["club_people"], vocab["team_scoring"]) == ("Spieler", "Vereinsspieler",
                                                                                  "Double Up")
    assert (vocab["next_round"], vocab["code_prefix"]) == ("Nächster Turniertag", "T")


def test_the_racing_league_keeps_its_words_and_fields():
    profile = series_kinds.profile("racing")
    assert profile["fields"]["venue"] and profile["fields"]["country"] and profile["fields"]["race_details"]
    assert profile["vocab"]["round_one"] == "Rennen" and profile["vocab"]["code_prefix"] == "R"
    assert profile["vocab"]["standings_label"] == "Fahrerwertung"


def test_tft_default_rules_have_five_rounds_eight_to_one_and_no_race_bonuses():
    rules = series_kinds.default_rules("series")
    assert rules["day_rounds"] == {"count": 5, "points_by_place": [8, 7, 6, 5, 4, 3, 2, 1]}
    assert rules["bonuses"]["fastest_lap"]["points"] == 0 and rules["bonuses"]["pole"]["points"] == 0
    assert rules["team_scoring"]["enabled"] is False and rules["double_up"] is False
    # Die Rennliga startet wie bisher mit den allgemeinen Standards.
    assert series_kinds.default_rules("racing") == normalize_rules({})


def test_formula_1_is_only_for_racing_and_tft_only_for_the_tournament_series():
    templates = {item["id"]: item for item in POINTS_SCHEME_TEMPLATES}
    assert templates["formula_1"]["kinds"] == ["racing"]
    assert templates["tft"]["kinds"] == ["series"]
    tft = normalize_rules(templates["tft"]["rules"])
    assert tft["day_rounds"]["count"] == 5 and tft["points_by_place"][:3] == [35, 30, 26]
    assert "tft" in series_kinds.profile("series")["templates"]
    assert "formula_1" not in series_kinds.profile("series")["templates"]


def test_an_undated_line_is_an_open_round_in_a_tournament_series_and_the_next_weekday_in_racing():
    text = "T1 · 01.10.2026\nT2\nT3 · 12.11. 20:00"
    series = parse_round_lines(text, season="2026", today="2026-10-20", default_weekday=3, default_time="19:00",
                               kind="series")
    assert [(row["code"], row["day"], row["open"]) for row in series["rows"]] == [
        ("T1", "2026-10-01", False), ("T2", None, True), ("T3", "2026-11-12", False)]
    racing = parse_round_lines(text, season="2026", today="2026-10-20", default_weekday=3, default_time="19:00",
                               kind="racing")
    assert racing["rows"][1]["day"] == "2026-10-08" and racing["rows"][1]["derived_day"] is True
    # Auch die erste Zeile ohne Datum ist bei der Turnierserie offen - kein Fehler.
    first = parse_round_lines("T1", season="2026", today="2026-10-20", default_weekday=None, default_time=None,
                              kind="series")
    assert first["errors"] == [] and first["rows"][0]["open"] is True


def test_the_tournament_series_list_reads_no_place_and_no_flag():
    parsed = parse_round_lines("T1 · 01.10.2026 · Monza\nT2 · offen · vs Team X", season="2026",
                               today="2026-10-20", default_weekday=None, default_time=None, kind="series")
    assert parsed["errors"] == []
    assert [(row["venue"], row["country_code"], row["opponent"]) for row in parsed["rows"]] == [
        (None, None, None), (None, None, None)]
