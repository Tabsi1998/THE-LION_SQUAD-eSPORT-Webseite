"""Rennergebnis mit allem, was Veranstalter-Grafiken zeigen (#1927): je Zeile Startnummer, Startplatz (``grid``),
Rennzeit, Abstand und Ausfall (``dnf``), je Rennen die schnellste Runde mit Zeit und der Fahrer des Tages - in genau den
Feldern, die auch die Texterkennung (#1756) liefert. Alles optional; die Punkte bleiben nach Schema, ohne die Felder
bleibt das Blatt wie bisher. Nur erfundene Namen."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.scoring_rules import normalize_rules  # noqa: E402
from services.series_results import check, replace_new_ids, resolve  # noqa: E402
from services.series_standings import compute_standings  # noqa: E402

PEOPLE = [
    {"id": "p-anna", "name": "Anna Probe", "start_number": "7"},
    {"id": "p-bert", "name": "Bert Bolzt", "start_number": "12"},
    {"id": "p-carl", "name": "Carl Kurve", "start_number": "21"},
]
SCHEME = normalize_rules({"points_by_place": [35, 30, 26, 23, 20], "bonuses": {"fastest_lap": {"points": 1}}})
ROUND = {"id": "r1", "status": "planned", "club_day": "2026-10-01", "counts": True}

# So liefert die Texterkennung eine Zeile (und so liest das Einfügen eine Tabelle).
OCR = {
    "rows": [
        {"place": 1, "name": "Anna Probe", "start_number": "7", "grid": 3, "time": "1:32:45.123", "gap": None},
        {"place": 2, "name": "Bert Bolzt", "start_number": "12", "grid": 1, "time": None, "gap": "+5.204"},
        {"place": 3, "name": "Neu Nora", "start_number": "88", "grid": 5, "gap": "+1 Runde"},
        {"place": None, "name": "Carl Kurve", "start_number": "21", "grid": 2, "dnf": True},
    ],
    "fastest_lap": {"name": "Bert Bolzt", "time": "1:31.456"},
    "driver_of_the_day": "Neu Nora",
}


def test_the_rows_of_the_text_recognition_are_taken_over_field_by_field():
    out = resolve(OCR, PEOPLE, SCHEME)
    assert out.errors == []
    content = out.content()
    assert [(row["participant_id"], row.get("start_number"), row.get("grid"), row.get("time"), row.get("gap"),
             row["marks"]) for row in content["rows"]] == [
        ("p-anna", "7", 3, "1:32:45.123", None, []),
        ("p-bert", "12", 1, None, "+5.204", ["fastest_lap"]),
        ("neu:neunora", "88", 5, None, "+1 Runde", []),
        ("p-carl", "21", 2, None, None, ["dnf"]),
    ]
    # Die schnellste Runde setzt die Marke an der Zeile (so zählt ein Bonus), die Zeit steht beim Rennen.
    assert content["fastest_lap"] == {"participant_id": "p-bert", "time": "1:31.456"}
    assert content["driver_of_the_day"] == "neu:neunora"
    # Neue Namen bekommen beim Übernehmen ihre Kennung - auch beim Fahrer des Tages.
    saved = replace_new_ids(content, {"neunora": "p-nora"})
    assert saved["driver_of_the_day"] == "p-nora"
    assert saved["rows"][2]["participant_id"] == "p-nora"


def test_without_the_new_fields_the_sheet_stays_as_before():
    out = resolve({"rows": [{"participant_id": "p-anna", "place": 1}, {"participant_id": "p-bert", "place": 2}]},
                  PEOPLE, SCHEME)
    content = out.content()
    assert content["rows"][0] == {"participant_id": "p-anna", "place": 1, "team": None, "points": None,
                                  "points_source": "scheme", "marks": [], "penalty_points": 0, "note": None}
    assert (content["fastest_lap"], content["driver_of_the_day"]) == (None, None)


def test_fastest_lap_with_only_a_time_belongs_to_the_marked_row():
    out = resolve({"rows": [{"participant_id": "p-anna", "place": 1, "marks": ["fastest_lap"]},
                            {"participant_id": "p-bert", "place": 2}],
                   "fastest_lap": {"time": "1:30.001"}}, PEOPLE, SCHEME)
    assert out.content()["fastest_lap"] == {"participant_id": "p-anna", "time": "1:30.001"}


def test_fastest_lap_and_driver_of_the_day_must_be_in_the_list():
    out = resolve({"rows": [{"participant_id": "p-anna", "place": 1}],
                   "fastest_lap": {"name": "Bert Bolzt", "time": "1:31.0"},
                   "driver_of_the_day": {"name": "Ganz Fremd"}}, PEOPLE, SCHEME)
    codes = [problem["code"] for problem in out.errors]
    assert codes == ["fastest_lap_not_in_list", "driver_of_the_day_not_in_list"]
    assert "Bert Bolzt" in out.errors[0]["message"]


def test_two_fastest_laps_are_a_warning():
    out = resolve({"rows": [{"participant_id": "p-anna", "place": 1, "marks": ["fastest_lap"]},
                            {"participant_id": "p-bert", "place": 2}],
                   "fastest_lap": {"name": "Bert Bolzt"}}, PEOPLE, SCHEME)
    check(out, SCHEME, ROUND, "2026-10-20")
    assert [problem["code"] for problem in out.warnings] == ["fastest_lap_twice"]


def test_the_standing_carries_the_race_details_only_where_given():
    out = resolve(OCR, PEOPLE, SCHEME)
    sheet = replace_new_ids(out.content(), {"neunora": "p-nora"})
    people = [*PEOPLE, {"id": "p-nora", "name": "Neu Nora"}]
    snapshots = compute_standings(rules=SCHEME, rounds=[{"id": "r1", "order": 1, "status": "scored"}],
                                  sheets={"r1": sheet}, participants=people)
    rows = {row["participant_id"]: row["results"][0] for row in snapshots[0]["rows"]}
    assert rows["p-anna"] == {"round_id": "r1", "place": 1, "points": 35, "source": "scheme", "marks": [],
                              "team": None, "start_number": "7", "grid": 3, "time": "1:32:45.123"}
    assert rows["p-bert"]["fastest_lap_time"] == "1:31.456"
    assert rows["p-bert"]["points"] == 31
    assert rows["p-nora"]["driver_of_the_day"] is True
    assert "driver_of_the_day" not in rows["p-anna"] and "fastest_lap_time" not in rows["p-anna"]
    assert (rows["p-carl"]["marks"], rows["p-carl"]["grid"]) == (["dnf"], 2)


def test_a_placeholder_without_time_is_no_time():
    # So liefert eine Grafik einen Ausfall: „OUT“ als Feld dnf, Zeit und Abstand als Platzhalter.
    out = resolve({"rows": [{"place": 1, "name": "Anna Probe", "time": "1:32:45.123"},
                            {"place": None, "name": "Bert Bolzt", "time": "--:--.---", "gap": "--.---", "dnf": True}],
                   "fastest_lap": {"name": "Anna Probe", "time": "--:--.---"}}, PEOPLE, SCHEME)
    content = out.content()
    assert content["rows"][1] == {"participant_id": "p-bert", "place": None, "team": None, "points": None,
                                  "points_source": "scheme", "marks": ["dnf"], "penalty_points": 0, "note": None}
    assert content["fastest_lap"] == {"participant_id": "p-anna", "time": None}
