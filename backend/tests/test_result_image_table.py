"""Saison- und Teamtabelle per Bild (#1999): Zellen aus mehreren Lesungen, Spalten aus den Daten, Gegenproben
(„Dif.“ = Punkte - Punkte des Ersten, Summe der Runden = Punkte, Plätze), Namen gegen die Saison - und mit Tesseract
Ende-zu-Ende ein synthetisches Bild im PRL-Layout (12 Teams × 17 Runden): jede Zelle stimmt oder ist gelb, nie still
falsch. Ohne Tesseract (etwa unter Windows) werden die Lese-Tests übersprungen; die CI setzt ``REQUIRE_TESSERACT=1``.
Nur erfundene Namen."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import season_table_image_fixture as fixture  # noqa: E402
from services import result_image_table as table  # noqa: E402
from services.result_image_ocr import Cell, Read, Word  # noqa: E402
from services.result_image_table import TableCell, TableReading  # noqa: E402
from test_result_image_ocr import needs_tesseract  # noqa: E402


def _read(text, conf=95.0):
    return Read(text, conf, [(text, conf)])


# ---------------------------------------------------------------- Werte und Zellen
def test_numbers_and_no_start_from_the_reads():
    assert table.number_of("35", fix=False) == ("number", 35)
    assert table.number_of("-141", fix=False) == ("number", -141)
    for text in ("--", "-", "—", "=", "~", "_"):
        assert table.number_of(text, fix=False) == ("absent", None), text
    assert table.number_of("3O", fix=True) == ("number", 30)  # Seitenlesung: O ist eine 0
    assert table.number_of("3O", fix=False) is None
    assert table.number_of("abc", fix=True) is None


def test_a_cell_is_sure_only_when_the_reads_agree():
    sure = table._cell([(_read("35"), True), (_read("35"), False), (_read("35"), False)], 80)
    assert (sure.text, sure.value, sure.sure) == ("35", 35, True)
    # 3 oder 5: widersprechen sich die Lesungen, ist die Zelle gelb - der Streifen gilt.
    split = table._cell([(_read("25"), True), (_read("23"), False), (_read("23"), False)], 80)
    assert (split.text, split.sure, split.read) == ("23", False, "25")
    # „--“ entsteht nie aus einer Ziffer: sicher leer, auch wenn nur eine Lesung es sah.
    absent = table._cell([(_read("=", 40), True), (None, False), (None, False)], 80)
    assert (absent.text, absent.absent, absent.sure) == ("--", True, True)
    # Nichts gelesen: nicht angetreten, aber gelb.
    nothing = table._cell([(None, True), (None, False), (None, False)], 80)
    assert (nothing.text, nothing.sure) == ("--", False)
    lonely = table._cell([(_read("35", 60), True), (None, False), (None, False)], 80)
    assert lonely.sure is False


def _reading(rows, *, gap=True):
    kinds = ["rank", "name", "round", "round", "total"] + (["gap"] if gap else [])
    out = TableReading(kinds=kinds, labels=["Pos.", "Team", "Runde 1", "Runde 2", "Punkte", "Dif."][:len(kinds)])
    for row in rows:
        cells = []
        for kind, value in zip(kinds, row):
            if kind == "name":
                cells.append(TableCell(text=value))
            elif value == "--":
                cells.append(TableCell(text="--", absent=True))
            else:
                cells.append(TableCell(text=str(value), value=value, sure=False))
        out.rows.append(cells)
        out.notes.append([])
    return out


def test_gap_and_sum_confirm_or_mark_the_totals():
    reading = _reading([[1, "Probe Rot", 30, 20, 50, "--"], [2, "Probe Blau", 20, 10, 30, -20],
                        [3, "Probe Gelb", 10, 15, 26, -25]])
    table._check(reading)
    table.check_sums(reading, strict=True)
    rows = reading.rows
    # Erster und Zweiter: Dif. passt, Summe passt - alles grün.
    assert [cell.sure for cell in rows[0][2:5]] == [True, True, True]
    assert all(cell.sure for cell in rows[1][2:6])
    # Dritter: 10 + 15 = 25, gelesen 26, Dif. -25 passt zu 25 - Punkte und Dif. gelb, die Runden ebenso.
    assert (rows[2][4].sure, rows[2][5].sure) == (False, False)
    assert [cell.sure for cell in rows[2][2:4]] == [False, False]
    assert reading.notes[2] == ["Summe der Runden 25 ≠ Punkte 26"]
    # Plätze 1 … n laufen mit den Punkten - grün.
    assert [row[0].sure for row in rows] == [True, True, True]


def test_a_team_table_only_notes_a_different_sum_and_drivers_explain_it():
    rows = [[1, "Probe Rot", 30, 20, 45, "--"], [2, "Probe Blau", 20, 10, 30, -15]]
    # Teamtabelle: „Punkte“ ist die aktuelle Besetzung (#1960) - nur ein Hinweis, die Zellen bleiben wie gelesen.
    teams = _reading(rows)
    for row in teams.rows:
        for cell in row[2:4]:
            cell.sure = True
    table.check_sums(teams, strict=False)
    assert [cell.sure for cell in teams.rows[0][2:4]] == [True, True]
    assert teams.notes[0] == ["Summe der Runden 50 ≠ Punkte 45"]
    # Fahrertabelle: eine erklärte Abweichung (Anpassung -5) macht nichts gelb, eine unerklärte schon.
    drivers = _reading(rows)
    for row in drivers.rows:
        for cell in row[2:4]:
            cell.sure = True
    seen = []

    def explain(name, values, summed, total):
        seen.append((name, values, summed, total))
        return "Anpassungen −5" if name == "Probe Rot" else None

    table.check_sums(drivers, strict=True, explain=explain)
    assert seen == [("Probe Rot", [30, 20], 50, 45)]
    assert [cell.sure for cell in drivers.rows[0][2:4]] == [True, True]
    assert drivers.notes[0] == ["Summe der Runden 50, Punkte 45 – erklärt: Anpassungen −5"]
    assert drivers.rows[1][4].sure is True  # 20 + 10 = 30: bestätigt


def test_a_matching_sum_never_confirms_an_unread_cell():
    # Keine Lesung hat etwas gefunden (etwa eine blasse „0“): gelb - und die passende Summe ändert daran nichts.
    empty = table._cell([(None, True), (None, False), (None, False)], 80)
    reading = TableReading(kinds=["name", "round", "round", "total"], labels=["Fahrer", "Runde 1", "Runde 2", "Punkte"])
    reading.rows = [[TableCell(text="Ada"), TableCell(text="25", value=25, sure=False), empty,
                     TableCell(text="25", value=25)]]
    reading.notes = [[]]
    table.check_sums(reading, strict=True)
    assert (empty.text, empty.sure) == ("--", False)
    assert reading.rows[0][1].sure is True  # die gelesene 25 bestätigt die Summe
    assert table.to_payload(reading, kind="drivers")["rows"][0]["uncertain"] == [2]


SIZE = table.GLYPH_WIDTH * 2 * table.GLYPH_HEIGHT  # Schriftbild einer zweistelligen Zahl


def test_the_same_figures_look_the_same_in_one_table():
    reading = _reading([[1, "Probe Rot", 23, 25, 48, "--"], [2, "Probe Blau", 25, 16, 41, -7]])
    half = SIZE // 2
    three, five = [0] * half + [255] * (SIZE - half), [255] * half + [0] * (SIZE - half)
    cells = {(0, 2): three, (0, 3): five, (1, 2): three, (1, 3): [128] * SIZE}
    for (row, column), glyph in cells.items():
        reading.rows[row][column].glyph = glyph
        reading.rows[row][column].sure = True
    table._glyph_check(reading)
    # Die „25“ in Zeile 2 sieht aus wie die „23“ in Zeile 1: beide gelb, mit der anderen Lesung.
    first, second = reading.rows[0][2], reading.rows[1][2]
    assert (first.sure, first.read, second.sure, second.read) == (False, "25", False, "23")
    assert reading.rows[0][3].sure is True and reading.rows[1][3].sure is True


def _big_reading(rows, columns, seed=1999):
    import random
    rng = random.Random(seed)
    reading = TableReading(kinds=["name"] + ["round"] * columns + ["total"])
    for _ in range(rows):
        row = [TableCell(text="x")]
        for _ in range(columns + 1):
            value = rng.randint(10, 99)
            row.append(TableCell(text=str(value), value=value, glyph=[rng.randint(0, 255) for _ in range(SIZE)]))
        reading.rows.append(row)
        reading.notes.append([])
    return reading


def test_the_glyph_check_keeps_to_the_time_budget_and_leaves_the_rest_yellow():
    import time
    # Große Tabelle (300 Zeilen × 13 Zahlenspalten) in kurzer Zeit - verglichen wird nur mit wenigen Zellen je Wert.
    reading = _big_reading(300, 12)
    started = time.monotonic()
    table._glyph_check(reading, deadline=time.monotonic() + 30)
    assert time.monotonic() - started < 10 and not reading.out_of_time
    # Zeitbudget schon aufgebraucht: nichts wird grün gelassen, was nicht verglichen ist.
    late = _big_reading(50, 12)
    table._glyph_check(late, deadline=time.monotonic() - 1)
    assert late.out_of_time is True
    assert all(not cell.sure for row in late.rows for cell in row[1:])


def test_a_lost_minus_in_the_gap_is_set_again():
    reading = _reading([[1, "Probe Rot", 30, 20, 50, "--"], [2, "Probe Blau", 20, 10, 30, 20]])
    table._check(reading)
    gap = reading.rows[1][5]
    assert (gap.text, gap.value, gap.sure, gap.read) == ("-20", -20, True, "20")


def test_names_match_the_season_and_unknown_ones_stay_yellow():
    reading = _reading([[1, "Probe Rotr", 30, 20, 50, "--"], [2, "Ganz Anders", 20, 10, 30, -20]])
    reading.rows[0][1].sure = reading.rows[1][1].sure = False
    table.match_names(reading, {"Probe Rot": "Probe Rot", "Probe Blau": "Probe Blau"})
    assert (reading.rows[0][1].text, reading.rows[0][1].read) == ("Probe Rot", "Probe Rotr")
    assert reading.rows[0][1].sure is False  # nur ähnlich - gelb mit dem bekannten Namen
    assert (reading.rows[1][1].text, reading.rows[1][1].sure) == ("Ganz Anders", False)
    payload = table.to_payload(reading, kind="teams")
    assert payload["columns"][2] == {"label": "Runde 1", "kind": "round"}
    assert 1 in payload["rows"][0]["uncertain"] and payload["rows"][0]["read"]["1"] == "Probe Rotr"


def test_a_table_name_is_green_only_when_it_clearly_is_a_known_one():
    """#2012 auch in Tabellen-Bildern: grün nur, wenn der Name eindeutig ein bekannter ist. Ein unbekannter bleibt gelb,
    wie sicher die Erkennung auch ist; zwei bekannte, die sich nur in l/1 unterscheiden, sind nie eindeutig; ohne
    bekannte Namen ist jeder gelb."""
    reading = _reading([[1, "Probe Rot", 30, 20, 50, "--"], [2, "Neu Team", 20, 10, 30, -20],
                        [3, "Probe Wolf1", 10, 5, 15, -35]])
    assert all(row[1].sure for row in reading.rows)  # die Erkennung ist sich sicher
    table.match_names(reading, {"Probe Rot": "Probe Rot", "Probe Wolf1": "Probe Wolf1", "Probe Wolfl": "Probe Wolfl"})
    assert [(row[1].text, row[1].sure) for row in reading.rows] == [
        ("Probe Rot", True), ("Neu Team", False), ("Probe Wolf1", False)]
    plain = _reading([[1, "Probe Rot", 30, 20, 50, "--"]])
    table.match_names(plain, {})
    assert plain.rows[0][1].sure is False


def test_a_second_reader_makes_agreed_table_names_green():
    """#2018 in Tabellen-Bildern: Lesen Tesseract und der zweite Leser einen unbekannten Namen gleich, ist er grün; bei
    Widerspruch gelb, vorbelegt mit der Lesung des zweiten Lesers; ein bekannter Name braucht keinen Widerspruch."""
    reading = _reading([[1, "Neu Team", 30, 20, 50, "--"], [2, "Dora Nev", 20, 10, 30, -20],
                        [3, "Probe Rot", 10, 5, 15, -35], [4, "Probe Wolf1", 5, 5, 10, -40]])
    for row, second in zip(reading.rows, ("Neu Team", "Dora Neu", "Probe Blau", "Probe Wolf1")):
        row[1].reads = [row[1].text]
        row[1].second = Read(second, 99)
    table.match_names(reading, {"Probe Rot": "Probe Rot", "Probe Blau": "Probe Blau"})
    cells = [row[1] for row in reading.rows]
    assert [(cell.text, cell.sure) for cell in (cells[0], cells[1], cells[3])] == [
        ("Neu Team", True), ("Dora Neu", False), ("Probe Wolf1", False)]  # l/1: nur mit Kader
    assert cells[1].read == "Dora Nev"
    # Die Leser zeigen auf zwei verschiedene bekannte Namen: gelb, der andere im Hinweis.
    assert cells[2].sure is False and {cells[2].text, cells[2].read} == {"Probe Rot", "Probe Blau"}


def test_a_table_name_known_only_through_a_lookalike_stays_yellow():
    """Prüfer zu #2012 auch in Tabellen-Bildern: „Amie“ ist nicht „Arnie“ - ein Treffer nur über Verwechslungen wird
    vorgeschlagen, bleibt aber gelb, auch wenn beide Lesungen sicher sind."""
    reading = _reading([[1, "Amie", 30, 20, 50, "--"], [2, "Kim", 20, 10, 30, -20]])
    assert all(row[1].sure for row in reading.rows)
    table.match_names(reading, {"Arnie": "Arnie", "Kirn": "Kirn"})
    assert [(row[1].text, row[1].sure, row[1].read) for row in reading.rows] == [
        ("Arnie", False, "Amie"), ("Kirn", False, "Kim")]


def _cell(text, left, right):
    return Cell([Word(text, 95, left, 0, right - left, 20)])


def test_columns_get_their_kind_from_header_and_data():
    groups = [(0, 30), (60, 300), (400, 440), (500, 540), (600, 660), (700, 760)]
    members = [[_cell(str(index), 0, 30) for index in range(1, 6)],
               [_cell(name, 60, 300) for name in ("Probe Rot", "Probe Blau", "Probe Gelb", "Probe Grau", "Probe Lila")],
               [_cell(value, 400, 440) for value in ("35", "--", "20", "=", "7")],
               [_cell(value, 500, 540) for value in ("--", "10", "8", "6", "5")],
               [_cell(value, 600, 660) for value in ("90", "80", "70", "60", "50")],
               [_cell(value, 700, 760) for value in ("--", "-10", "-20", "-30", "-40")]]
    assert table._classify(groups, members, {}, 20) == ["rank", "name", "round", "round", "total", "gap"]
    labels = {"team": _cell("Team", 60, 120), "total": _cell("Punkte:", 500, 560)}
    # Mit Überschrift: „Punkte:“ steht über der zweiten Zahlenspalte - danach nur noch der Abstand.
    assert table._classify(groups, members, labels, 20)[:5] == ["rank", "name", "round", "total", None]


# ---------------------------------------------------------------- Ende-zu-Ende mit Tesseract
def _truth(rows):
    return [[str(index), row.name, *row.cells, str(row.total), row.gap] for index, row in enumerate(rows, start=1)]


def _measure(reading, truth):
    silent = []
    for row_index, (row, expected) in enumerate(zip(reading.rows, truth)):
        for column, cell in enumerate(row):
            if cell.sure and cell.text != expected[column]:
                silent.append((row_index, column, cell.text, expected[column]))
    return silent


@needs_tesseract
def test_a_team_table_in_the_prl_layout_is_right_or_yellow():
    rows = fixture.sample_rows()
    reading = table.read_table(fixture.render(rows), budget_seconds=120, sums=False)
    table.match_names(reading, {row.name: row.name for row in rows})
    table.check_sums(reading, strict=False)  # Teamtabelle: „Punkte“ darf anders rechnen als die Zellen
    assert reading.header_found and reading.detected == "teams"
    assert reading.kinds == ["rank", "name", *["round"] * 17, "total", "gap"]
    assert len(reading.rows) == 12
    truth = _truth(rows)
    assert _measure(reading, truth) == []
    # Gesamtpunkte: jede stimmt oder ist gelb - und die meisten sind grün.
    totals = [row[19] for row in reading.rows]
    assert all(cell.text == expected[19] or not cell.sure for cell, expected in zip(totals, truth))
    assert sum(cell.sure for cell in totals) >= 9
    assert [row[1].text for row in reading.rows] == [row.name for row in rows]
    # Nicht unnötig gelb: richtig Gelesenes wird nur gelb, wenn die eigene Lesung oder das Schriftbild zweifelt.
    unnecessary = sum(1 for row, expected in zip(reading.rows, truth) for column, cell in enumerate(row)
                      if not cell.sure and cell.text == expected[column])
    assert unnecessary <= 30


@needs_tesseract
def test_a_driver_table_reads_the_same_way():
    rows = fixture.sample_rows(drivers=True)
    reading = table.read_table(fixture.render(rows, label="Fahrer"), budget_seconds=120)
    assert reading.kinds.count("round") == 17 and "name" in reading.kinds and reading.detected == "drivers"
    assert _measure(reading, _truth(rows)) == []
