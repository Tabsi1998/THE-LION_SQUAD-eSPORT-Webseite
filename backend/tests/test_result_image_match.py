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


def row(place="", number="", name="", team="", grid="", time="", gap="", *, strips=None, alts=None, points="",
        conf=95) -> RowReading:
    cells = {key: r(value, conf) for key, value in (
        ("place", place), ("start_number", number), ("name", name), ("team", team), ("grid", grid), ("time", time),
        ("gap", gap), ("points", points)) if value}
    out = RowReading(cells=cells, strips={key: r(value) if isinstance(value, str) else value
                                          for key, value in (strips or {}).items()})
    out.alts = {key: r(value) if isinstance(value, str) else value for key, value in (alts or {}).items()}
    return out


def reading(*rows, header=None, labelled=None) -> Reading:
    out = Reading(template_id=TEMPLATE["id"], header=header or {}, rows=list(rows), header_found=True)
    out.labelled = labelled
    return out


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


def test_names_need_two_exact_and_confident_reads():
    """Namen und Teams (Text): sicher nur, wenn beide Lesungen genau gleich sind (Leerzeichen, Groß/klein) und jede für
    sich über der Schwelle liegt - sonst gelb. So bleiben Verwechsler wie „PPLotta Probe“ nicht still."""
    assert decide("text", r("Lotta Probe", 95), r("Lotta Probe", 90), 80).sure is True
    assert decide("text", r("PPLotta Probe", 90), r("PP Lotta Probe", 87), 80).sure is False
    assert decide("text", r("bertii_bolzt7", 83), r("bertii_bolzt7", 64), 80).sure is False
    assert decide("text", r("Carl_KurvOl", 77), r("Carl_Kurvol", 64), 80).sure is False
    # Zahlen dürfen weiter mit weniger Sicherheit übereinstimmen.
    assert decide("number", r("12", 64), r("12", 30), 80).sure is True


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
                     "points": None, "uncertain": [], "read": {}, "color": None}
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


def test_names_and_teams_need_both_reads_to_agree():
    """Seite und Streifen widersprechen sich: auch wenn eine Lesung genau zu einem Teilnehmer bzw. Team passt, ist das
    Feld gelb - mit beiden Lesungen als Hinweis."""
    out = build(reading(
        row("1", "", "Anna Probe", "Rotor Racing", strips={"name": "Dora Neumann", "team": "Rotor Racing"}),
        row("2", "", "Bert Bolzt", "Blaupfeil GP", strips={"name": "Bert Bolzt", "team": "Rotor Racing"}),
        row("3", "", "Carl Kurve", "Rotor Racing", strips={"name": "Carl Kurve", "team": "Rotor Racing"}),
    ), TEMPLATE, PEOPLE)
    anna, bert, carl = out["rows"]
    assert (anna["participant_id"], anna["uncertain"]) == ("anna", ["name"])
    assert anna["read"] == {"name": "Anna Probe / Dora Neumann"}
    assert (bert["participant_id"], bert["team"], bert["uncertain"]) == ("bert", "Blaupfeil GP", ["team"])
    assert bert["read"] == {"team": "Blaupfeil GP / Rotor Racing"}
    assert (carl["participant_id"], carl["uncertain"], carl["read"]) == ("carl", [], {})


def test_row_that_loses_its_participant_to_another_row_is_yellow():
    """Zwei Zeilen lesen denselben Teilnehmer: die mit passender Startnummer bekommt ihn, die andere bleibt beim
    gelesenen Namen - gelb, denn doppelt oder verlesen."""
    out = build(reading(row("1", "99", "Anna Probe"), row("2", "7", "Anna Probe", strips={"start_number": "7"})),
                TEMPLATE, PEOPLE)
    lost, anna = out["rows"]
    assert (anna["participant_id"], anna["uncertain"]) == ("anna", [])
    assert (lost["participant_id"], lost["name"], lost["uncertain"]) == (None, "Anna Probe", ["name"])
    assert lost["read"] == {"name": "Anna Probe"}


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


def test_unread_place_is_never_sure():
    """Ein nicht gelesener Platz ist gelb - auch in einer Ausfall-Zeile, deren „DNF“ nur in der Zeit-Spalte steht. Der
    Abstand des Siegers darf leer sein, ein Platz nicht."""
    assert decide("place", None, None, 80).sure is False
    assert decide("gap", None, None, 80).sure is True
    out = build(reading(
        row("1", name="Anna Probe", time="1:32:15.123"),
        row("", name="Bert Bolzt", time="DNF"),
    ), TEMPLATE, PEOPLE)
    bert = out["rows"][1]
    assert (bert["place"], bert["dnf"], bert["uncertain"]) == (None, True, ["place"])


def test_one_misread_place_or_leader_time_does_not_poison_the_rest():
    """Ein verlesener erster Platz oder eine verlesene Zeit des Siegers ist gelb - die übrigen Zeilen bleiben sicher:
    Reihenfolge und Zeit des Siegers ergeben sich aus der Mehrheit der Zeilen."""
    places = build(reading(row("1", name="Anna Probe"), row("2", name="Bert Bolzt"), row("9", name="Carl Kurve"),
                           row("4", name="Dora Neu")), TEMPLATE, PEOPLE)
    assert [item["uncertain"] for item in places["rows"]] == [[], [], ["place"], []]
    times = build(reading(
        row("1", name="Anna Probe", time="30:26.500"),  # richtig wäre 30:26.300
        row("2", name="Bert Bolzt", time="30:27.043", gap="+0.743"),
        row("3", name="Carl Kurve", time="30:44.141", gap="+17.841"),
    ), TEMPLATE, PEOPLE)
    assert [item["uncertain"] for item in times["rows"]] == [["time"], [], []]


def test_place_one_in_the_box_comes_from_the_order():
    """Platz 1 im farbigen Kasten (#1981): nicht oder verlesen gelesen, aber alle anderen laufen lückenlos 2…n - dann
    ist es Platz 1, nicht gelb. Eine klar gelesene andere Zahl weiter unten bleibt gelb (dann fehlt vielleicht eine
    Zeile); stimmen zwei Zeilen nicht, wird nichts geraten."""
    for first in ("", "@", "C)", "6"):
        out = build(reading(row(first, name="Anna Probe"), row("2", name="Bert Bolzt"), row("3", name="Carl Kurve"),
                            row("4", name="Dora Neu")), TEMPLATE, PEOPLE)
        assert [(item["place"], item["uncertain"]) for item in out["rows"]] == [
            (1, []), (2, []), (3, []), (4, [])], first
    gap_below = build(reading(row("1"), row("2"), row("3"), row("5")), TEMPLATE, [])
    assert [item["uncertain"] for item in gap_below["rows"]] == [[], [], [], ["place"]]
    two_off = build(reading(row(""), row("2"), row("7"), row("4")), TEMPLATE, [])
    assert [item["uncertain"] for item in two_off["rows"]] == [["place"], [], ["place"], []]


def test_other_derived_places_are_prefilled_but_yellow():
    """Codex zu #1981: Grün aus der Reihenfolge nur Platz 1 in der ersten Zeile. Jede andere Ableitung - ein doppelter
    Platz (eine 5 als 6 gelesen, oder ein geteilter Platz wie in Turnierserien, #1961) oder ein fehlender mitten in der
    Liste - wird vorbelegt, bleibt aber gelb; was im Bild stand, steht im Hinweis."""
    taken = build(reading(row("1"), row("2"), row("3"), row("4"), row("6"), row("6"), row("7")), TEMPLATE, [])
    assert [(item["place"], item["uncertain"]) for item in taken["rows"]][4] == (5, ["place"])
    assert taken["rows"][4]["read"] == {"place": "6"}
    shared = build(reading(row("1"), row("2"), row("2"), row("4")), TEMPLATE, [])
    assert [(item["place"], item["uncertain"]) for item in shared["rows"]][2] == (3, ["place"])
    missing = build(reading(row("1"), row("2"), row(""), row("4")), TEMPLATE, [])
    assert [(item["place"], item["uncertain"]) for item in missing["rows"]][2] == (3, ["place"])


def test_leader_has_no_gap_even_if_the_placeholder_is_misread():
    """Platz 1 hat keinen Abstand (#1981): der Platzhalter „+--:--,---“ - auch verlesen („deln“, „a“) - ist „kein
    Abstand“, nicht gelb. Ein echter Abstand beim Ersten passt nicht - gelb."""
    for placeholder in ("+--:--,---", "--:--.---", "deln", "a", "So"):
        out = build(reading(
            row("1", name="Anna Probe", time="1:31,770", gap=placeholder, strips={"gap": "a"}),
            row("2", name="Bert Bolzt", time="1:32,134", gap="+0,364"),
            row("3", name="Carl Kurve", time="1:32,754", gap="+0,984"),
        ), TEMPLATE, PEOPLE)
        leader = out["rows"][0]
        assert (leader["gap"], leader["uncertain"]) == (None, []), placeholder
    wrong = build(reading(row("1", time="1:31,770", gap="+0,500"), row("2", time="1:32,134", gap="+0,364"),
                          row("3", time="1:32,754", gap="+0,984")), TEMPLATE, [])
    assert "gap" in wrong["rows"][0]["uncertain"]


def test_times_take_their_separators_from_the_format():
    """Rennzeit „m:ss,mmm“, Abstand „+s,mmm“ bzw. „+m:ss,mmm“ (#1981): die Trennzeichen setzt die Form - ein fehlender
    oder als Punkt gelesener Doppelpunkt ändert nichts. Gespeichert wird wie bisher mit Punkt. Fehlt eine Ziffer
    (Trennzeichen passen nicht zur Form), ist die Zelle gelb."""
    out = build(reading(
        row("1", name="Anna Probe", time="1:31,770", gap="+--:--,---"),
        row("2", name="Bert Bolzt", time="132,134", gap="+0,364", strips={"time": "1.32,134"}),
        row("3", name="Carl Kurve", time="1:32:754", gap="+0.984"),
        row("4", name="Dora Neu", time="1:45,23", gap="+13,462"),
        row("5", name="Emil Eck", time="2:04,878", gap="+33,108"),
    ), TEMPLATE, PEOPLE)
    assert [(item["time"], item["gap"]) for item in out["rows"]] == [
        ("1:31.770", None), ("1:32.134", "+0.364"), ("1:32.754", "+0.984"), ("1:45,23", "+13.462"),
        ("2:04.878", "+33.108")]
    assert [item["uncertain"] for item in out["rows"]][:3] == [[], [], []]
    assert "time" in out["rows"][3]["uncertain"]  # wie gelesen, aber gelb
    # Lange Abstände und Rennzeiten über eine Stunde.
    race = build(reading(row("1", time="31:55,056"), row("2", time="3201253", gap="+6,197"),
                         row("3", time="33:29,934", gap="+1:34,878")), TEMPLATE, [])
    assert [(item["time"], item["gap"]) for item in race["rows"]] == [
        ("31:55.056", None), ("32:01.253", "+6.197"), ("33:29.934", "+1:34.878")]


def test_a_quali_whose_times_lost_their_colon_is_still_a_result():
    """Echter Fall (#1981): In einem Quali-Bild las die Erkennung „132,134“ statt „1:32,134“ - bisher keine Zeit, und
    weil so weniger als die Hälfte der Zeilen eine Zeit hatte, galt das Bild als Tabelle ohne Zeiten (422)."""
    out = build(reading(
        row("1", name="Anna Probe", time="1:31,770", gap="+--:--,---"),
        row("2", name="Bert Bolzt", time="132,134", gap="+0,364"),
        row("3", name="Carl Kurve", time="132,754", gap="+0,984"),
        row("4", name="Dora Neu", time="1:332,856", gap="+1,086", strips={"time": "132,856"}),
        row("5", name="Emil Eck", time="134,358", gap="+2,588"),
    ), TEMPLATE, PEOPLE)
    assert out["is_result"] is True
    assert [item["time"] for item in out["rows"]] == ["1:31.770", "1:32.134", "1:32.754", "1:32.856", "1:34.358"]


def test_a_third_reading_that_disagrees_makes_digits_yellow():
    """3 und 5 (#1981): Seite und Streifen sagen „35“, die dritte Lesung (größer, eigene Schwelle) „33“ - gelb, nie
    still falsch. Sagt sie dasselbe, bleibt es sicher."""
    agree = build(reading(row("1", "35", "Neu Name", alts={"start_number": "35"}), row("2"), row("3")), TEMPLATE, [])
    assert agree["rows"][0]["uncertain"] == []
    differ = build(reading(row("1", "35", "Neu Name", strips={"start_number": "35"}, alts={"start_number": "33"}),
                           row("2"), row("3")), TEMPLATE, [])
    assert differ["rows"][0]["uncertain"] == ["start_number"]
    # Zeit = Zeit des Ersten + Abstand bestätigt, wenn sie genau ein Paar der Lesungen stützt.
    second = row("2", time="1:32,134", gap="+0,364", alts={"time": "1:32,154", "gap": "+0,564"})
    times = build(reading(row("1", time="1:31,770"), second, row("3", time="1:32,754", gap="+0,984")), TEMPLATE, [])
    assert times["rows"][1]["uncertain"] == []


def test_a_check_confirms_only_the_one_reading_it_supports():
    """Codex zu #1981: Die Probe Zeit = P1 + Abstand löschte jeden Widerspruch der Lesungen. Jetzt: passen mehrere
    Paare (die dritte Lesung sagt 1:32,154 und +0,384 - das geht genauso auf), entscheidet die Probe nichts - gelb.
    Passt genau eine andere Lesung als die gewählte, gilt diese."""
    both = row("2", time="1:32,134", gap="+0,364", alts={"time": "1:32,154", "gap": "+0,384"})
    out = build(reading(row("1", time="1:31,770"), both, row("3", time="1:32,754", gap="+0,984")), TEMPLATE, [])
    assert {"time", "gap"} <= set(out["rows"][1]["uncertain"])
    # Seite und Streifen lesen 1:32,154 (falsch), die dritte Lesung 1:32,134 - nur sie passt zu P1 + Abstand.
    fixed = row("2", time="1:32,154", gap="+0,364", strips={"time": "1:32,154"}, alts={"time": "1:32,134"})
    out = build(reading(row("1", time="1:31,770"), fixed, row("3", time="1:32,754", gap="+0,984")), TEMPLATE, [])
    assert (out["rows"][1]["time"], out["rows"][1]["uncertain"]) == ("1:32.134", [])
    # Die Reihenfolge stützt genau eine Lesung eines Platzes: die gilt.
    place = build(reading(row("1"), row("2"), row("5", strips={"place": "5"}, alts={"place": "3"}), row("4")),
                  TEMPLATE, [])
    assert (place["rows"][2]["place"], place["rows"][2]["uncertain"]) == (3, [])


def test_a_reading_of_another_kind_is_a_contradiction():
    """Codex zu #1981: Seite und Streifen lesen Platz 2, die dritte Lesung „DNF“ - die Reihenfolge stützt zwar die 2,
    aber die Ausfall-Marke widerspricht: gelb. Ebenso in der ersten Zeile (Platz 1 aus der Reihenfolge) und bei „DNF“
    statt einer Zeit oder „+1 Runde“ statt eines Abstands."""
    place = build(reading(row("1"), row("2", strips={"place": "2"}, alts={"place": "DNF"}), row("3"), row("4")),
                  TEMPLATE, [])
    assert (place["rows"][1]["place"], place["rows"][1]["uncertain"]) == (2, ["place"])
    first = build(reading(row("1", strips={"place": "1"}, alts={"place": "DNF"}), row("2"), row("3"), row("4")),
                  TEMPLATE, [])
    assert (first["rows"][0]["place"], first["rows"][0]["uncertain"]) == (1, ["place"])
    for alts, field in (({"time": "DNF"}, "time"), ({"gap": "+1 Runde"}, "gap")):
        second = row("2", time="1:32,134", gap="+0,364", strips={"time": "1:32,134", "gap": "+0,364"}, alts=alts)
        out = build(reading(row("1", time="1:31,770"), second, row("3", time="1:32,754", gap="+0,984")), TEMPLATE, [])
        assert field in out["rows"][1]["uncertain"], alts


def test_an_unsure_third_reading_does_not_contradict():
    """Codex zu #1981: Die dritte Lesung widerspricht nur, wenn sie sicher genug ist (``min_confidence``). Eine
    unsichere „33“ neben zweimal „35“ ist Rauschen - grün; eine sichere „33“ bleibt ein Widerspruch (3/5) - gelb."""
    assert decide("number", r("35"), r("35"), 80, alt=r("33", 50)).sure is True
    assert decide("number", r("35"), r("35"), 80, alt=r("33", 80)).sure is False
    noisy = row("1", "35", "Neu Name", strips={"start_number": "35"}, alts={"start_number": r("33", 50)})
    unsure = build(reading(noisy, row("2"), row("3")), TEMPLATE, [])
    assert unsure["rows"][0]["uncertain"] == []


def _leader_and_third():
    leader = row("1", "7", "Anna Probe", time="1:28,783", gap="+--:--,---",
                 strips={"place": "1", "time": "1:28,783", "gap": "+--:--,---"})
    third = row("3", "21", "Carl Kurve", time="1:31,000", gap="+2,217",
                strips={"place": "3", "time": "1:31,000", "gap": "+2,217"})
    return leader, third


def test_a_value_in_the_third_reading_beside_a_placeholder_is_yellow():
    """Prüfer zu #1981: Lesen Seite und Streifen nur den Platzhalter (oder gar nichts), die dritte Lesung aber sicher
    eine Zeit, sind Zeit und Abstand gelb - nicht leer und grün. In einer Ausfall-Zeile und beim Abstand des Siegers
    bleibt der Platzhalter leer und grün."""
    leader, third = _leader_and_third()
    placeholder = row("2", "12", "Bert Bolzt", time="--:--,---", gap="+--:--,---",
                      strips={"place": "2", "time": "--:--,---", "gap": "+--:--,---"},
                      alts={"time": "1:30,000", "gap": "+1,217"})
    unread = row("2", "12", "Bert Bolzt", strips={"place": "2"}, alts={"time": "1:30,000", "gap": "+1,217"})
    for second in (placeholder, unread):
        out = build(reading(leader, second, third), TEMPLATE, PEOPLE)
        assert [item["uncertain"] for item in out["rows"]] == [[], ["time", "gap"], []]
    out_row = row("DNF", "12", "Bert Bolzt", time="--:--,---", gap="+--:--,---",
                  strips={"place": "DNF", "time": "--:--,---", "gap": "+--:--,---"}, alts={"gap": "+1,217"})
    out = build(reading(leader, third, out_row), TEMPLATE, PEOPLE)
    assert (out["rows"][2]["time"], out["rows"][2]["gap"], out["rows"][2]["uncertain"]) == (None, None, [])


def test_the_gap_of_an_unsure_first_place_is_not_cleared():
    """Prüfer zu #1981: Ein „Platz 1“, der selbst gelb ist (hier eine verlesene 2), löscht seinen Abstand nicht still -
    der unlesbare Abstand bleibt gelb."""
    leader, _ = _leader_and_third()
    misread = row("1", "12", "Bert Bolzt", time="1:30,000", gap="+1,2x7",
                  strips={"place": "1", "time": "1:30,000", "gap": "+1,2?7"})
    out = build(reading(leader, misread), TEMPLATE, PEOPLE)
    assert out["rows"][0]["uncertain"] == []
    assert out["rows"][1]["uncertain"] == ["place", "gap"]


def test_lines_and_unlabelled_points_never_become_points():
    """Echter Fall (#1981): Der Rand der Tabelle („|“) stand in der Punkte-Spalte und wurde zu „1 Punkt“ in jeder
    Zeile. Ein Strich ist keine Ziffer, und Punkte gelten nur, wenn ihre Überschrift im Bild steht."""
    border = build(reading(row("1", points="|"), row("2", points="|"), row("3", points="|"),
                           labelled={"place", "time"}), TEMPLATE, [])
    assert [(item["points"], item["uncertain"]) for item in border["rows"]] == [(None, [])] * 3
    no_label = build(reading(row("1", points="25"), row("2", points="18"), labelled={"place"}), TEMPLATE, [])
    assert [(item["points"], item["uncertain"]) for item in no_label["rows"]] == [(None, []), (None, [])]
    labelled = build(reading(row("1", points="25"), row("2", points="18"), labelled={"place", "points"}),
                     TEMPLATE, [])
    assert [item["points"] for item in labelled["rows"]] == [25, 18]
    assert decide("number", r("|"), None, 80).text == ""


def test_empty_cell_in_a_filled_column_is_yellow():
    """Steht in fast allen Zeilen ein Team, eine Startnummer, ein Startplatz, ist eine leere Zelle verdächtig (etwa
    dunkelgraue Schrift auf dunklem Grund) - gelb. Das Team bleibt leer (#1960): oft stand dort ein farbiges Schild
    wie „Ersatzfahrer“, das beim Lesen wegfällt - das Stammteam vorzuschlagen, hieße es still dafür zu zählen."""
    out = build(reading(row("1", "7", "Anna Probe", "Rotor Racing", "2"),
                        row("2", "12", "Bert Bolzt", "Blaupfeil GP", "1"),
                        row("3", "", "Dora Neu", "", "")), TEMPLATE, PEOPLE)
    dora = out["rows"][2]
    assert {"start_number", "team", "grid"} <= set(dora["uncertain"])
    known = build(reading(row("1", "7", "Anna Probe", "Rotor Racing"), row("2", "", "Bert Bolzt", "")),
                  TEMPLATE, PEOPLE)
    bert = known["rows"][1]
    assert (bert["team"], "team" in bert["uncertain"]) == (None, True)


def test_a_substitute_entry_stays_as_read():
    """„Ersatzfahrer“ (#1960, Eintrag „kein Team“ der Saison) bleibt im Team-Feld - auch wenn ein bekanntes Team ähnlich
    heißt und der Fahrer ein Stammteam hat."""
    people = [*PEOPLE, {"id": "rasta", "name": "Rasta Probe", "start_number": "33", "default_team": "Rasta Fahrer"}]
    out = build(reading(row("1", "7", "Anna Probe", "Ersatzfahrer"), row("2", "12", "Bert Bolzt", "Blaupfeil GP"),
                        row("3", "33", "Rasta Probe", "Rasta Fahrer")),
                TEMPLATE, people, no_team_names=["Ersatzfahrer"])
    anna = out["rows"][0]
    assert anna["team"] == "Ersatzfahrer" and anna["participant_id"] == "anna"
    # Ein unbekanntes Team bleibt ebenso stehen, wie gelesen.
    other = build(reading(row("1", "7", "Anna Probe", "Reverse Pole"), row("2", "12", "Bert Bolzt", "Blaupfeil GP")),
                  TEMPLATE, PEOPLE, no_team_names=["Ersatzfahrer"])
    assert other["rows"][0]["team"] == "Reverse Pole"


def test_a_different_game_tag_stays_another_person_and_the_team_stays_as_read():
    """Zusammenspiel mit #1961: „Name#BBB“ ist nicht „Name#AAA“ (Ähnlichkeit 0) - die Zeile bekommt keinen Teilnehmer,
    sein Stammteam auch nicht. „Ersatzfahrer“ bleibt stehen, eine leere Team-Zelle bleibt leer und gelb."""
    people = [*PEOPLE, {"id": "max", "name": "Max#AAA", "default_team": "Rasta Fahrer"}]
    assert similarity("Max#BBB", "Max#AAA") == 0
    out = build(reading(row("1", "7", "Anna Probe", "Rotor Racing"), row("2", "12", "Bert Bolzt", "Blaupfeil GP"),
                        row("3", "", "Max#BBB", "Ersatzfahrer"), row("4", "", "Max#AAA", "")),
                TEMPLATE, people, no_team_names=["Ersatzfahrer"])
    other, own = out["rows"][2], out["rows"][3]
    assert (other["participant_id"], other["team"]) == (None, "Ersatzfahrer")
    assert (own["participant_id"], own["team"], "team" in own["uncertain"]) == ("max", None, True)


def test_tables_without_times_are_no_result():
    """Eine Saisontabelle (Punkte statt Zeiten) oder der Kalender ist kein Rennergebnis; Platzhalter zählen nicht."""
    table = build(reading(row("1", "37", "Anna Probe", "Sonstige", "65"), row("2", "7", "Bert Bolzt", "Sonstige", "65"),
                          row("3", "25", "Carl Kurve", "Sonstige", "49", "--:--:--,---")), TEMPLATE, PEOPLE)
    assert table["is_result"] is False
    race = build(reading(row("1", name="Anna Probe", time="33:31,908", gap="+--:--,---"),
                         row("2", name="Bert Bolzt", time="+1 Runden", gap="+1 Runden"),
                         row("", name="Carl Kurve", time="--:--:--,---", gap="+--:--,---")), TEMPLATE, PEOPLE)
    assert race["is_result"] is True
    # Platzhalter sind leer und sicher, „+1 Runden“ in Zeit und Abstand bestätigen sich gegenseitig.
    first, lapped, out = race["rows"]
    assert (first["time"], first["gap"], first["uncertain"]) == ("33:31.908", None, [])
    assert (lapped["time"], lapped["gap"], lapped["uncertain"]) == ("+1 Runden", "+1 Runden", [])
    assert (out["time"], out["gap"]) == (None, None)


def test_out_points_session_and_team_colors():
    """„OUT“ statt Platz ist ein Ausfall; Punkte aus dem Bild; Art der Sitzung als Hinweis; Teamfarbe als Vorschlag."""
    first, second, out_row = (row("1", "7", "Anna Probe", "Rotor Racing", time="1:32:15.123"),
                              row("2", "12", "Bert Bolzt", "Blaupfeil GP", time="1:32:17.456", gap="+2.333"),
                              row("OUT", "21", "Carl Kurve", "Rotor Racing"))
    first.cells["points"], second.cells["points"] = r("25"), r("18")
    first.color, second.color, out_row.color = "#e62832", "#3c6eff", "#e62832"
    out = build(reading(first, second, out_row, header={"session": r("Qualifying")}), TEMPLATE, PEOPLE)
    anna, bert, carl = out["rows"]
    assert (anna["points"], bert["points"], carl["points"]) == (25, 18, None)
    assert (carl["place"], carl["dnf"], carl["marks"]) == (None, True, ["dnf"])
    assert out["session"] == {"name": "Qualifying", "kind": "qualifying"}
    assert out["team_colors"] == {"Blaupfeil GP": "#3c6eff", "Rotor Racing": "#e62832"}
    assert anna["color"] == "#e62832"


def test_unreadable_placeholders_in_out_rows_are_fine():
    """In einer Ausfall-Zeile stehen statt Zeit und Abstand Platzhalter - auch verlesen ohne Ziffern sind sie leer und
    nicht gelb."""
    out = build(reading(row("1", name="Anna Probe", time="1:32:15.123"),
                        row("DNF", name="Bert Bolzt", time="enlanlenmen", gap="a")), TEMPLATE, PEOPLE)
    bert = out["rows"][1]
    assert (bert["dnf"], bert["time"], bert["gap"], bert["uncertain"]) == (True, None, None, [])


def test_unreadable_time_stays_empty_but_yellow():
    out = build(reading(row("1", name="Anna Probe", time="1:32:15.123"), row("2", name="Bert Bolzt", gap="deine")),
                TEMPLATE, PEOPLE)
    bert = out["rows"][1]
    assert (bert["gap"], "gap" in bert["uncertain"], bert["read"]["gap"]) == (None, True, "deine")


def test_long_reads_are_cut_to_what_the_sheet_takes():
    """Die Antwort bleibt klein: Namen und Teams höchstens 120 Zeichen wie im Blatt, Startnummern 10."""
    out = build(reading(row("1", "1234567890123", "Langer " * 40, "Team " * 40)), TEMPLATE, [])
    first = out["rows"][0]
    assert len(first["name"]) <= 120 and len(first["team"]) <= 120
    assert len(first["read"].get("name", "")) <= 120
    assert first["start_number"] is None or len(first["start_number"]) <= 10


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
    # Teams sind wenige und bekannt: auch ein stark verlesenes wird vorgeschlagen - gelb.
    rough = build(reading(row("1", name="Bert Bolzt", team="Baupted GP")), TEMPLATE, PEOPLE)["rows"][0]
    assert (rough["team"], rough["uncertain"], rough["read"]) == ("Blaupfeil GP", ["team"], {"team": "Baupted GP"})


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
