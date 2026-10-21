"""Lese-Adapter „TFT-Dashboard“ der Partner-Plattform (#1964) ohne Netz und Datenbank: gegen gekürzte, anonymisierte
Antworten mit erfundenen Namen (``tests/fixtures/tft_dashboard``). Geprüft: Serien und Turniere, Tagesplatz aus der
Reihenfolge des Veranstalters, Rundenpunkte wie geliefert (ein Bot verschiebt sie), Ausgestiegen, Gäste ohne Riot-ID,
Double Up mit Partner und - Datenschutz - dass weder PUUID noch Avatar das Ergebnis erreichen."""
import json
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import tft_dashboard  # noqa: E402

FIXTURES = pathlib.Path(__file__).resolve().parent / "fixtures" / "tft_dashboard"


def _load(name: str):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def test_series_list_names_each_series_with_its_reference():
    assert tft_dashboard.series_list(_load("series.json")) == [
        {"ref": "7", "name": "Probe Masters 2026/27", "season": "2026/27", "tournaments": 3},
        {"ref": "6", "name": "Probe Saison 2025/26", "season": "2025/26", "tournaments": 0},
    ]


def test_tournaments_of_a_series_carry_the_vienna_day_double_up_and_whether_they_are_finished():
    """22:00 UTC ist schon der nächste Wiener Tag - der Partner speichert Mitternacht in Wien."""
    assert tft_dashboard.series_tournaments(_load("series_7.json")) == [
        {"ref": "901", "name": "Turnier 1 - Probe Masters - Online", "club_day": "2026-09-25", "double_up": False,
         "finished": True, "rounds": 3},
        {"ref": "902", "name": "Turnier 2 - DOUBLE UP - Probe Halle", "club_day": "2026-10-16", "double_up": True,
         "finished": True, "rounds": 2},
        {"ref": "903", "name": "Turnier 3 - Probe Masters - Finale", "club_day": "2026-12-11", "double_up": False,
         "finished": False, "rounds": 5},
    ]


def test_tournament_rows_follow_the_ranking_of_the_organizer_with_riot_ids():
    day = tft_dashboard.tournament(_load("tournament_901.json"))
    assert (day["ref"], day["club_day"], day["double_up"], day["finished"]) == ("901", "2026-09-25", False, True)
    assert [(row["name"], row["place"], row["day_points"]) for row in day["rows"]] == [
        ("Ada Ausgedacht#AAA", 1, 23), ("Bruno Beispiel#EUW", 2, 21), ("Dario Demo#1234", 3, 19),
        ("Cleo Muster#TLS", 4, 18), ("Ella Erfunden", 5, 14), ("Finn Fiktiv#EUW", 6, 9)]
    assert day["rows"][0]["day_rounds"] == [{"place": 1, "points": 8, "lobby": "1"},
                                            {"place": 1, "points": 8, "lobby": "1"},
                                            {"place": 2, "points": 7, "lobby": "1"}]
    assert day["rows"][2]["day_rounds"][0] == {"place": 1, "points": 8, "lobby": "2"}
    assert (day["rounds"], day["lobbies"], day["bots"], day["guests"]) == (3, 4, 1, 1)
    assert all("partner" not in row for row in day["rows"])


def test_a_bot_is_no_participant_but_shifts_the_points_of_the_last_human():
    """Der Bot belegt in Runde 2 Platz 6: Finn wird Siebter und bekommt 2 Punkte - so, wie die Quelle sie liefert."""
    day = tft_dashboard.tournament(_load("tournament_901.json"))
    assert "Bot" not in [row["name"] for row in day["rows"]] and len(day["rows"]) == 6
    finn = day["rows"][-1]
    assert finn["day_rounds"][1] == {"place": 7, "points": 2, "lobby": "1"}


def test_a_player_who_left_has_no_further_rounds_and_the_mark_left():
    finn = tft_dashboard.tournament(_load("tournament_901.json"))["rows"][-1]
    assert finn["day_rounds"] == [{"place": 2, "points": 7, "lobby": "2"}, {"place": 7, "points": 2, "lobby": "1"},
                                  None]
    assert finn["marks"] == ["left"]
    assert tft_dashboard.tournament(_load("tournament_901.json"))["rows"][0]["marks"] == []


def test_double_up_rows_share_the_place_of_their_team_and_name_the_partner():
    day = tft_dashboard.tournament(_load("tournament_902.json"))
    assert day["double_up"] is True and day["club_day"] == "2026-10-16"
    assert [(row["name"], row["place"], row["day_points"], row["partner"]["name"]) for row in day["rows"]] == [
        ("Ada Ausgedacht#AAA", 1, 16, "Gina Gedacht#TLS"), ("Gina Gedacht#TLS", 1, 16, "Ada Ausgedacht#AAA"),
        ("Bruno Beispiel#EUW", 2, 16, "Cleo Muster#TLS"), ("Cleo Muster#TLS", 2, 16, "Bruno Beispiel#EUW"),
        ("Dario Demo#1234", 3, 12, "Hugo Probe#EUW"), ("Hugo Probe#EUW", 3, 12, "Dario Demo#1234"),
        ("Ella Erfunden", 4, 12, "Finn Fiktiv#EUW"), ("Finn Fiktiv#EUW", 4, 12, "Ella Erfunden")]
    # Rundenpunkte des Teams gelten für beide - wie geliefert (Platz 2 im Double Up bringt auch 8).
    assert day["rows"][0]["day_rounds"] == [{"place": 1, "points": 8, "lobby": "1"},
                                            {"place": 2, "points": 8, "lobby": "1"}]
    assert day["rows"][1]["day_rounds"] == day["rows"][0]["day_rounds"]
    assert (day["rounds"], day["lobbies"], day["bots"]) == (2, 2, 0)


def test_no_riot_identifier_avatar_or_rank_reaches_the_result():
    for name in ("tournament_901.json", "tournament_902.json"):
        text = json.dumps(tft_dashboard.tournament(_load(name)))
        for secret in ("puuid", "guest_", "example.invalid", "avatar", "profile_icon", "GOLD", "league_points"):
            assert secret not in text, (name, secret)


@pytest.mark.parametrize("data", [None, [], {"rounds": "kaputt"}, {"id": "901; rm", "rounds": []}, "Text"])
def test_an_unexpected_answer_is_a_format_error_with_a_fixed_message(data):
    with pytest.raises(tft_dashboard.SourceFormatError) as caught:
        tft_dashboard.tournament(data)
    assert str(caught.value) == tft_dashboard.FORMAT_MESSAGE


def test_series_entries_with_unusable_references_are_left_out():
    data = {"tournaments": [{"id": "../admin", "name": "x", "date": "2026-01-01T00:00:00Z"},
                            {"id": 905, "name": "Gut", "date": "2026-01-01T23:00:00.000Z", "status": "completed",
                             "type": "normal", "rounds": 4}]}
    assert [item["ref"] for item in tft_dashboard.series_tournaments(data)] == ["905"]
    assert tft_dashboard.series_list([{"id": "7/../8", "name": "x"}, {"id": 8, "name": "Acht"}]) == [
        {"ref": "8", "name": "Acht", "season": None, "tournaments": 0}]


def test_valid_reference_accepts_only_short_digit_strings():
    assert tft_dashboard.valid_ref("47") and tft_dashboard.valid_ref(47)
    for bad in ("", "4a", "../1", "1/2", "1" * 13, None, True, -3, "٣"):
        assert not tft_dashboard.valid_ref(bad), bad
