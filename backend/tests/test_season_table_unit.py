"""Saisontabelle des Veranstalters einlesen (#1928) ohne Datenbank: Zellen lesen („OUT“, „--“, leer, DSQ, DNS),
Spalten den Terminen zuordnen (Kürzel, Strecke, Flagge, Reihenfolge), Platz aus den Punkten zurückrechnen (eindeutig,
mehrdeutig, Bonus im Wert, außerhalb des Schemas, Gleichstand), „Punkte laut Veranstalter“ ohne Rückrechnung und die
Erklärung der Abweichung zur Spalte „Gesamt“. Nur erfundene Namen."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import season_table  # noqa: E402
from services.scoring_rules import normalize_rules  # noqa: E402

F1 = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]
RACING = normalize_rules({"points_by_place": F1, "bonuses": {"fastest_lap": {"points": 1, "max_place": 10}}})
# Turnierserie wie im Kommentar des Issues: 21 = 18 + 3 Bingo.
TFT = normalize_rules({"points_by_place": [35, 30, 26, 23, 20, 18, 16, 14, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2] + [1] * 6,
                       "custom_bonuses": [{"label": "Bingo", "points": 3}]})
NAMES = ["Ada Ausgedacht", "Bruno Beispiel", "Cleo Muster", "Dario Demo", "Ella Erfunden", "Finn Fiktiv",
         "Gina Gedacht", "Hugo Probe"]


def _round(rid, order, **extra):
    return {"id": rid, "order": order, "status": "planned", "archived_at": None, "code": None, "title": None,
            "venue": None, "country_code": None, "session": None, **extra}


def _column(cells, rules=RACING, **extra):
    names = NAMES[:len(cells)]
    return season_table.build_column(cells, rules, names=names, teams=[None] * len(cells), **extra)


def _by_row(built):
    return {cell["row"]: cell for cell in built["cells"]}


# ---------------------------------------------------------------- Zellen
def test_cells_read_points_marks_and_no_start():
    assert season_table.read_cell("25") == {"kind": "points", "value": 25}
    assert season_table.read_cell(" 12,5 ") == {"kind": "points", "value": 12.5}
    assert season_table.read_cell("0") == {"kind": "points", "value": 0}
    for text in ("OUT", "dnf", "Ret", "Ausfall"):
        assert season_table.read_cell(text) == {"kind": "mark", "mark": "dnf"}, text
    assert season_table.read_cell("DSQ") == {"kind": "mark", "mark": "dsq"}
    assert season_table.read_cell("DQ") == {"kind": "mark", "mark": "dsq"}
    assert season_table.read_cell("DNS") == {"kind": "mark", "mark": "dns"}
    for text in ("", "  ", "--", "-", "–", "—", "---", None):
        assert season_table.read_cell(text) == {"kind": "absent"}, text
    assert season_table.read_cell("abc")["kind"] == "unreadable"
    assert season_table.read_cell("1e3")["kind"] == "unreadable"


def test_a_flag_or_a_country_name_in_the_header_gives_the_country():
    assert season_table.header_country("\U0001F1E6\U0001F1F9") == "AT"
    assert season_table.header_country("Österreich") == "AT"
    assert season_table.header_country("Spielberg") == "AT"
    assert season_table.header_country("IT") == "IT"
    assert season_table.header_country("R7") is None


# ---------------------------------------------------------------- Spalten → Termine
def test_columns_find_their_round_by_code_track_flag_or_order():
    rounds = [_round("r1", 1, code="R1"), _round("r2", 2, code="R2", venue="Red Bull Ring", country_code="AT"),
              _round("r3", 3, code="R3", title="GP Italien", country_code="IT"), _round("r4", 4, code="R4"),
              _round("r5", 5, code="R5", status="cancelled"), _round("r6", 6, code="R6", archived_at="2026-01-01")]
    found = season_table.match_columns(["R1", "Red Bull Ring", "\U0001F1EE\U0001F1F9", "Lauf vier"],
                                       [None, None, None, None], rounds)
    assert [(item["round_id"], item["how"]) for item in found] == [
        ("r1", "code"), ("r2", "title"), ("r3", "country"), ("r4", "order")]
    # Gewählt schlägt automatisch, "" heißt: Spalte nicht übernehmen. Ein Termin nie zweimal.
    found = season_table.match_columns(["R1", "R2", "R3"], ["r3", "", None], rounds)
    assert [(item["round_id"], item["how"]) for item in found] == [("r3", "chosen"), (None, "skip"), (None, None)]
    # Abgesagte und archivierte Termine stehen nicht zur Wahl.
    assert [item["id"] for item in season_table.round_choices(rounds)] == ["r1", "r2", "r3", "r4"]


def test_a_round_with_runs_takes_the_race_unless_the_header_names_the_run():
    rounds = [_round("q", 1, code="R1", session="Qualifying"), _round("s", 2, code="R1", session="Sprint"),
              _round("r", 3, code="R1", session="Rennen"), _round("x", 4, code="R2", session="Rennen")]
    found = season_table.match_columns(["R1", "R1 Sprint", "R2"], [None, None, None], rounds)
    assert [(item["round_id"], item["how"]) for item in found] == [("r", "code"), ("s", "code"), ("x", "code")]


# ---------------------------------------------------------------- Rückrechnung
def test_places_come_back_from_the_scheme_with_bonus_points():
    assert season_table.place_candidates(25, RACING) == [{"place": 1, "bonus_keys": [], "marks": []}]
    assert season_table.place_candidates(26, RACING) == [{"place": 1, "bonus_keys": [], "marks": ["fastest_lap"]}]
    # 2 Punkte: Platz 9 oder Platz 10 mit schnellster Runde.
    assert [(item["place"], item["marks"]) for item in season_table.place_candidates(2, RACING)] == [
        (9, []), (10, ["fastest_lap"])]
    assert season_table.place_candidates(17, RACING) == []
    assert [(item["place"], item["bonus_keys"]) for item in season_table.place_candidates(21, TFT)] == [(6, ["bingo"])]


def test_a_full_round_gives_every_place_once():
    built = _column(["25", "18", "15", "OUT", "--", "", "DSQ", "0"])
    cells = _by_row(built)
    assert [(row["name"], row["place"], row["marks"]) for row in built["rows"]] == [
        ("Ada Ausgedacht", 1, []), ("Bruno Beispiel", 2, []), ("Cleo Muster", 3, []), ("Dario Demo", None, ["dnf"]),
        ("Gina Gedacht", None, ["dsq"]), ("Hugo Probe", None, [])]
    assert built["row_of"] == [0, 1, 2, 3, 6, 7]
    assert (cells[7]["state"], cells[7]["code"], built["rows"][-1]["points"]) == ("ok", "zero", 0)
    assert 4 not in cells and 5 not in cells  # „--“ und leer: nicht angetreten, keine Zeile
    assert built["unclear"] == 0 and built["errors"] == []
    assert built["placeless"] == [3, 4, 5]  # Zeilen ohne Platz mit Absicht (Ausfall, DSQ, 0 Punkte)


def test_ambiguous_points_are_settled_by_the_other_places_of_the_round():
    # 2 Punkte: Platz 9 oder 10 mit schnellster Runde - Platz 10 hat schon jemand, also Platz 9.
    built = _column(["2", "1"])
    assert [(row["place"], row["marks"]) for row in built["rows"]] == [(9, []), (10, [])]
    assert built["unclear"] == 0
    # Ohne den Fahrer auf Platz 10 bleibt es offen (gelb) - mit beiden Vorschlägen.
    alone = _by_row(_column(["2"]))[0]
    assert (alone["state"], alone["code"]) == ("unclear", "ambiguous")
    assert [item["place"] for item in alone["candidates"]] == [9, 10]


def test_the_tft_case_with_bingo_in_the_value_is_yellow_with_a_proposal():
    built = _column(["35", "30", "29", "23", "20", "21", "16", "14"], rules=TFT)
    cells = _by_row(built)
    # 23 wäre auch Platz 5 + Bingo - Platz 5 hat aber die 20, also Platz 4.
    assert (cells[3]["state"], cells[3]["place"]) == ("ok", 4)
    for row, place in ((2, 3), (5, 6)):
        assert (cells[row]["state"], cells[row]["code"]) == ("unclear", "bonus"), row
        assert cells[row]["candidates"] == [{"place": place, "bonus_keys": ["bingo"], "marks": [],
                                             "label": f"Platz {place} + Bingo"}]
    assert built["unclear"] == 2
    # Bis zur Klärung zählt der Wert der Tabelle (ohne Platz), damit die Summe stimmt.
    unclear_row = built["rows"][built["row_of"].index(5)]
    assert (unclear_row["place"], unclear_row["points"], unclear_row["points_source"]) == (None, 21, "manual")


def test_decisions_settle_yellow_cells():
    decisions = {5: {"choice": "place", "place": 6, "bonus_keys": ["bingo"], "marks": []},
                 2: {"choice": "organizer"}}
    built = _column(["35", "30", "29", "23", "20", "21", "16", "14"], rules=TFT, decisions=decisions)
    cells = _by_row(built)
    assert built["unclear"] == 0
    finn = built["rows"][built["row_of"].index(5)]
    assert (finn["place"], finn["bonus_keys"], finn["points"], finn["points_source"]) == (6, ["bingo"], 18, "organizer")
    cleo = built["rows"][built["row_of"].index(2)]
    assert (cleo["place"], cleo["points"], cleo["points_source"]) == (None, 29, "manual")
    assert cells[2]["code"] == "decided" and cells[5]["code"] == "decided"


def test_a_decision_counts_only_when_it_fits_the_scheme_of_this_round():
    decisions = {5: {"choice": "place", "place": 6, "bonus_keys": ["bingo"], "marks": []}}
    tft = _by_row(_column(["35", "30", "29", "23", "20", "21", "16", "14"], rules=TFT, decisions=decisions))
    assert tft[5]["code"] == "decided"
    # Dieselbe Spalte einem Termin mit anderem Schema zugeordnet: die Klärung passt nicht mehr - wieder gelb.
    racing = _by_row(_column(["25", "18", "15", "12", "10", "21"], decisions=decisions))
    assert (racing[5]["state"], racing[5]["code"]) == ("unclear", "outside")
    # „Punkte laut Veranstalter“ passt immer, ein Platz ohne den Bonus nicht.
    assert season_table.decision_fits(21, {"choice": "organizer"}, RACING)
    assert not season_table.decision_fits(21, {"choice": "place", "place": 6}, TFT)


def test_points_outside_the_scheme_and_two_drivers_on_one_place_are_yellow():
    cells = _by_row(_column(["17", "25", "25"]))
    assert (cells[0]["state"], cells[0]["code"], cells[0]["candidates"]) == ("unclear", "outside", [])
    assert [(cells[row]["state"], cells[row]["code"]) for row in (1, 2)] == [("unclear", "shared")] * 2


def test_points_by_the_organizer_skip_the_way_back_and_note_values_outside_the_scheme():
    built = _column(["25", "17", "OUT"], organizer=True)
    cells = _by_row(built)
    assert [(row["place"], row["points"], row["points_source"]) for row in built["rows"]] == [
        (None, 25, "manual"), (None, 17, "manual"), (None, None, "scheme")]
    assert (cells[0]["state"], cells[1]["state"], cells[1]["code"]) == ("ok", "note", "outside_scheme")
    assert built["unclear"] == 0 and built["placeless"] == [0, 1, 2]
    # Eine Saison „Punkte laut Veranstalter“ rechnet nie zurück.
    organizer = normalize_rules({"points_mode": "organizer"})
    rows = season_table.build_column(["25", "OUT"], organizer, names=NAMES[:2], teams=["Team A", ""])["rows"]
    assert [(row["place"], row["points"], row["points_source"], row["team"]) for row in rows] == [
        (None, 25, "organizer", "Team A"), (None, 0, "organizer", None)]


def test_an_unreadable_cell_is_an_error_of_the_column():
    built = _column(["25", "x7"])
    assert built["errors"] and "x7" in built["errors"][0]["message"]
    assert _by_row(built)[1]["state"] == "error"


# ---------------------------------------------------------------- Abgleich mit „Gesamt“
def test_a_total_that_differs_by_dropped_results_is_explained():
    # Tabelle 100, gerechnet 100 (Streichresultat -20 wie beim Veranstalter): stimmt, der Grund steht als Hinweis da.
    out = season_table.explain_total(100, 100, {"dropped": -20, "activity": 0})
    assert (out["state"], [item["kind"] for item in out["reasons"]]) == ("ok", ["dropped"])
    # Der Veranstalter streicht nicht und kennt keine Aktivitätspunkte: -16 sind erklärt.
    explained = season_table.explain_total(120, 104, {"dropped": -20, "activity": 4})
    assert explained["state"] == "explained" and explained["deviation"] == -16
    assert [item["kind"] for item in explained["explains"]] == ["dropped", "activity"]
    off = season_table.explain_total(130, 100, {"dropped": -20})
    assert off["state"] == "differs" and off["deviation"] == -30
    assert season_table.explain_total(None, 120, {})["state"] == "no_total"


def test_the_parts_between_cells_and_the_own_total_add_up():
    standing = {"computed_points": 55, "activity_points": 2, "adjustment_points": -5, "dropped_round_ids": ["r2"],
                "results": [{"round_id": "r1", "points": 25}, {"round_id": "r2", "points": 10},
                            {"round_id": "r3", "points": 18, "bonus": 3}, {"round_id": "x", "points": 12}]}
    cell_sum, computed, parts = season_table.total_parts([25, 10, 21, 4], [True, True, True, False], standing,
                                                         {"r1", "r2", "r3"})
    assert (cell_sum, computed) == (60, 55)
    assert parts == {"ignored": -4, "sheet": 0, "dropped": -10, "activity": 2, "adjustment": -5, "other": 12}
    assert cell_sum + sum(parts.values()) == computed
    # Ohne Stand (nur „--“): gerechnet 0.
    assert season_table.total_parts([None, None], [True, True], None, set()) == (0, 0, {"ignored": 0, "sheet": 0})


def test_the_place_in_the_table_comes_from_the_column_or_the_totals():
    assert season_table.table_ranks([3, 1, 2], [10, 30, 20]) == [3, 1, 2]
    assert season_table.table_ranks([None] * 4, [30, 20, 20, None]) == [1, 2, 2, None]
    # Ohne Spalte „Platz“ sind 2, 2 gleich gut - der eigene Vorrang darf 2 oder 3 daraus machen; mit Spalte nicht.
    ranks = [1, 2, 2, None]
    assert [season_table.rank_differs(table, own, ranks, False) for table, own in ((2, 3), (2, 2), (2, 4), (1, 2))] == [
        False, False, True, True]
    assert season_table.rank_differs(2, 3, [1, 2, 3], True) is True
    assert season_table.rank_differs(None, 3, [], True) is False
