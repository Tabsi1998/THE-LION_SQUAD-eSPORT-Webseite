"""Ergebnis-Bilder auslesen (#1756): Werte aus zwei Lesungen, Gegenproben und Abgleich mit den Teilnehmern - ohne
Tesseract, mit nachgestellten Lesungen. Nur erfundene Namen."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import result_image_templates  # noqa: E402
from services.result_image_match import (  # noqa: E402
    build, decide, parse_gap, parse_time, similarity,
)
from services.result_image_ocr import Read, Reading, RowReading  # noqa: E402

TEMPLATE = result_image_templates.get(result_image_templates.DEFAULT_ID)
PEOPLE = [
    {"id": "anna", "name": "Anna Probe", "start_number": "7", "default_team": "Rotor Racing"},
    {"id": "bert", "name": "Bert Bolzt", "start_number": "12", "default_team": "Blaupfeil GP"},
    {"id": "carl", "name": "Carl Kurve", "start_number": "21", "default_team": "Rotor Racing"},
]


def r(text: str, conf: float = 95) -> Read:
    return Read(text, conf, [(word, conf) for word in text.split()])


def row(place="", number="", name="", team="", grid="", time="", gap="", *, strips=None, conf=95) -> RowReading:
    cells = {key: r(value, conf) for key, value in (
        ("place", place), ("start_number", number), ("name", name), ("team", team), ("grid", grid), ("time", time),
        ("gap", gap)) if value}
    return RowReading(cells=cells, strips={key: r(value) if isinstance(value, str) else value
                                           for key, value in (strips or {}).items()})


def reading(*rows, header=None) -> Reading:
    return Reading(template_id=TEMPLATE["id"], header=header or {}, rows=list(rows), header_found=True)


# ---------------------------------------------------------------- Werte
def test_times_and_gaps_are_parsed_strictly():
    assert parse_time("1:32:15.123") == (5535.123, "1:32:15.123")
    assert parse_time("1:31,207") == (91.207, "1:31.207")
    assert parse_time("31.2") == (31.2, "31.2")
    for broken in ("132:41.250", "1:3:15.123", "1:32:75.123", "1:32:15", "abc", ""):
        assert parse_time(broken) is None, broken
    assert parse_gap("+2.333") == ("+2.333", 2.333)
    assert parse_gap("+1:03.177") == ("+1:03.177", 63.177)
    assert parse_gap("#2.333") == ("+2.333", 2.333)  # verlesenes Plus
    assert parse_gap("+1 Runde") == ("+1 Runde", None)
    assert parse_gap("+2Laps") == ("+2 Laps", None)
    assert parse_gap("") is None
    assert parse_gap("Runde") is None


def test_two_reads_decide_the_value():
    agree = decide("number", r("12"), r("12", 70), 80)
    assert (agree.text, agree.sure) == ("12", True)
    # Zwei Lesungen sagen dasselbe: dafür reicht weniger Sicherheit - aber nicht beliebig wenig.
    assert decide("number", r("12", 64), r("12", 30), 80).sure is True
    assert decide("number", r("12", 50), r("12", 40), 80).sure is False
    # Widerspruch: der Streifen mit Whitelist gilt, sicher ist die Zelle nicht.
    clash = decide("number", r("6", 93), r("5", 95), 80)
    assert (clash.text, clash.sure, clash.disagree) == ("5", False, True)
    # Die Seitenlesung darf Buchstaben statt Ziffern haben.
    assert decide("number", r("I2"), None, 80).text == "12"
    # Nur eine Lesung: sicher nur ab der Schwelle.
    assert decide("grid", r("4", 85), None, 80).sure is True
    assert decide("grid", r("4", 60), None, 80).sure is False
    # Unlesbar: der Text bleibt sichtbar, gelb.
    broken = decide("time", r("1:3x:15.1"), None, 80)
    assert (broken.value, broken.text, broken.sure) == (None, "1:3x:15.1", False)
    # Leer ist leer - und sicher (etwa der Abstand des Siegers).
    assert decide("gap", None, None, 80).sure is True
    # „DNF“ statt Platz, auch leicht verlesen.
    assert decide("place", r("ONF"), r("DNF"), 80).mark == "dnf"


def test_similarity_ignores_case_tags_and_lookalikes():
    assert similarity("anna probe", "Anna Probe") == 1.0
    assert similarity("[TLS] Anna Probe", "Anna Probe") == 1.0
    assert similarity("Anna Pr0be", "Anna Probe") == 1.0  # 0 statt o
    assert 0.72 <= similarity("Carl Kurue", "Carl Kurve") < 0.95
    assert similarity("Dora Neu", "Anna Probe") < 0.5


# ---------------------------------------------------------------- Ganzes Blatt
def test_clean_reading_is_sure_and_snaps_to_participants():
    out = build(reading(
        row("1", "7", "Anna Probe", "Rotor Racing", "2", "1:32:15.123"),
        row("2", "12", "Bert Bolzt", "Blaupfeil GP", "1", "1:32:17.456", "+2.333"),
        row("DNF", "21", "Carl Kurve", "Rotor Racing", "3", "DNF"),
    ), TEMPLATE, PEOPLE)
    assert out["uncertain_rows"] == 0
    first, second, third = out["rows"]
    assert first == {"index": 0, "place": 1, "dnf": False, "marks": [], "start_number": "7", "name": "Anna Probe",
                     "participant_id": "anna", "team": "Rotor Racing", "grid": 2, "time": "1:32:15.123", "gap": None,
                     "uncertain": [], "read": {}}
    assert (second["gap"], second["participant_id"]) == ("+2.333", "bert")
    assert (third["place"], third["dnf"], third["marks"], third["time"]) == (None, True, ["dnf"], None)


def test_start_number_is_the_anchor():
    out = build(reading(
        # Name passt zu Anna, die Startnummer gehört Bert: der Name gilt, die Startnummer wird gelb.
        row("1", "12", "Anna Probe", strips={"start_number": "12"}),
        # Name kaum lesbar, Startnummer eindeutig: Carl - der Name gelb.
        row("2", "21", "Crl", strips={"start_number": "21"}),
        # Widerspruch der Lesungen, die Startnummer des erkannten Namens bestätigt eine davon: sicher.
        row("3", "6", "Bert Bolzt", strips={"start_number": "12"}),
    ), TEMPLATE, PEOPLE)
    anna, carl, bert = out["rows"]
    assert (anna["participant_id"], anna["start_number"], anna["uncertain"]) == ("anna", "7", ["start_number"])
    assert anna["read"] == {"start_number": "12"}
    assert (carl["participant_id"], carl["name"], carl["uncertain"]) == ("carl", "Carl Kurve", ["name"])
    assert (bert["participant_id"], bert["start_number"], bert["uncertain"]) == ("bert", "12", [])


def test_fuzzy_names_and_new_names():
    out = build(reading(
        row("1", "", "Carl Kurue"),
        row("2", "", "Anna Probe"),
        row("3", "", "Dora Neu"),
        row("4", "", "Anna Probe"),  # Anna nur einmal: die zweite Zeile bleibt ein neuer Name
    ), TEMPLATE, PEOPLE)
    carl, anna, dora, again = out["rows"]
    assert (carl["participant_id"], carl["name"], carl["uncertain"]) == ("carl", "Carl Kurve", ["name"])
    assert carl["read"] == {"name": "Carl Kurue"}
    assert (anna["participant_id"], anna["uncertain"]) == ("anna", [])
    assert (dora["participant_id"], dora["name"], dora["uncertain"]) == (None, "Dora Neu", [])
    assert again["participant_id"] is None
    # Ohne Teilnehmer bleibt alles, wie es gelesen wurde.
    plain = build(reading(row("1", "7", "Carl Kurue")), TEMPLATE, [])
    assert (plain["rows"][0]["name"], plain["rows"][0]["participant_id"]) == ("Carl Kurue", None)


def test_aliases_count_like_names():
    aliases = [{"name": "Alter Tag", "participant_id": "anna"}]
    with_alias = build(reading(row("1", "", "Alter Tag")), TEMPLATE, PEOPLE, aliases=aliases)
    assert (with_alias["rows"][0]["participant_id"], with_alias["rows"][0]["name"]) == ("anna", "Anna Probe")
    without = build(reading(row("1", "", "Alter Tag")), TEMPLATE, PEOPLE)
    assert without["rows"][0]["participant_id"] is None


def test_places_run_without_gaps():
    out = build(reading(
        row("1", name="Anna Probe"), row("2", name="Bert Bolzt"), row("4", name="Carl Kurve"),
        row("DNF", name="Dora Neu"),
    ), TEMPLATE, PEOPLE)
    assert [item["uncertain"] for item in out["rows"]] == [[], [], ["place"], []]
    # Ein Widerspruch der Lesungen, den die Reihenfolge bestätigt, ist sicher.
    agreed = build(reading(row("1", name="Anna Probe"), row("3", name="Bert Bolzt", strips={"place": "2"})),
                   TEMPLATE, PEOPLE)
    assert (agreed["rows"][1]["place"], agreed["rows"][1]["uncertain"]) == (2, [])


def test_time_equals_leader_plus_gap():
    out = build(reading(
        row("1", name="Anna Probe", time="1:32:15.123"),
        row("2", name="Bert Bolzt", time="1:32:17.456", gap="+2.333", conf=60),  # unsicher gelesen, aber stimmig
        row("3", name="Carl Kurve", time="1:32:21.900", gap="+9.999"),  # passt nicht zusammen
        row("4", name="Dora Neu", time="1:33:30.000", gap="+1 Runde"),
    ), TEMPLATE, PEOPLE)
    rows = out["rows"]
    assert rows[1]["uncertain"] == []
    assert {"time", "gap"} <= set(rows[2]["uncertain"])
    assert (rows[3]["gap"], rows[3]["uncertain"]) == ("+1 Runde", [])


def test_grid_positions_are_unique_and_teams_snap():
    out = build(reading(
        row("1", name="Anna Probe", grid="3", team="Rotor Racmg"),
        row("2", name="Bert Bolzt", grid="3", team="Blaupfeil GP"),
        row("3", name="Dora Neu", grid="1", team="Neues Team"),
    ), TEMPLATE, PEOPLE)
    anna, bert, dora = out["rows"]
    assert (anna["team"], anna["uncertain"]) == ("Rotor Racing", ["team", "grid"])
    assert anna["read"]["team"] == "Rotor Racmg"
    assert (bert["team"], bert["uncertain"]) == ("Blaupfeil GP", ["grid"])
    assert (dora["team"], dora["uncertain"]) == ("Neues Team", [])


def test_header_fields():
    out = build(reading(row("1", name="Anna Probe"), header={
        "track": r("Probering Nord"), "fastest_lap": r("Bert Bolzt 1:31.207"), "driver_of_the_day": r("Carl Kurve")}),
        TEMPLATE, PEOPLE)
    assert out["track"] == {"name": "Probering Nord", "uncertain": []}
    assert out["fastest_lap"] == {"name": "Bert Bolzt", "participant_id": "bert", "time": "1:31.207", "uncertain": [],
                                  "read": "Bert Bolzt 1:31.207"}
    assert out["driver_of_the_day"] == {"name": "Carl Kurve", "participant_id": "carl", "uncertain": [],
                                        "read": "Carl Kurve"}
    # Verlesen: der Name wird vorgeschlagen, die Zeit geraten - beides gelb.
    blurry = build(reading(row("1", name="Anna Probe"), header={"fastest_lap": r("Bart Bolz 131.207", 40)}),
                   TEMPLATE, PEOPLE)
    assert blurry["fastest_lap"]["name"] == "Bert Bolzt"
    assert blurry["fastest_lap"]["time"] == "1:31.207"
    assert blurry["fastest_lap"]["uncertain"] == ["name", "time"]
