"""Zonen für Auf- und Abstieg (F.2, #1627, Nr. 158/159): Rechnung ohne Datenbank - je Regel mit Gegenprobe."""
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import league_zones as zones  # noqa: E402


def table(count: int, *, exits: dict[int, str] | None = None, played: int = 3) -> list[dict]:
    rows = []
    for index in range(1, count + 1):
        row = {"registration_id": f"r{index}", "display_name": f"Team {index}", "rank": index, "played": played, "points": 10 - index}
        if exits and index in exits:
            row["exit"] = {"kind": exits[index], "at": "2026-01-01T00:00:00+00:00"}
        rows.append(row)
    return rows


def test_default_one_up_one_down_in_a_middle_division():
    found = zones.assign(table(6), zones.effective({"level": 2}, [1, 2, 3]))
    assert found["r1"] == zones.PROMOTION and found["r6"] == zones.RELEGATION
    # Gegenprobe: die Mitte bleibt.
    assert [found[f"r{index}"] for index in range(2, 6)] == [None] * 4


def test_top_division_has_no_promotion_and_bottom_no_relegation():
    top = zones.effective({"level": 1, "zones": {"promote": 3, "relegate": 2}}, [1, 2, 3])
    bottom = zones.effective({"level": 3, "zones": {"promote": 2, "relegate": 3}}, [1, 2, 3])
    assert top["promote"] == 0 and top["relegate"] == 2 and top["top"] and not top["bottom"]
    assert bottom["relegate"] == 0 and bottom["promote"] == 2 and bottom["bottom"] and not bottom["top"]
    found_top = zones.assign(table(6), top)
    found_bottom = zones.assign(table(6), bottom)
    assert zones.PROMOTION not in found_top.values() and list(found_top.values()).count(zones.RELEGATION) == 2
    assert zones.RELEGATION not in found_bottom.values() and list(found_bottom.values()).count(zones.PROMOTION) == 2


def test_single_division_moves_nobody():
    found = zones.assign(table(4), zones.effective({"level": 1}, [1]))
    assert set(found.values()) == {None}


def test_counts_per_division_and_relegation_places():
    rules = zones.effective({"level": 2, "zones": {"promote": 2, "relegate": 1, "playoff_promote": 1, "playoff_relegate": 1}}, [1, 2, 3])
    found = zones.assign(table(8), rules)
    assert [found[f"r{index}"] for index in range(1, 9)] == [
        zones.PROMOTION, zones.PROMOTION, zones.PLAYOFF_PROMOTION, None, None, None, zones.PLAYOFF_RELEGATION, zones.RELEGATION]
    # Relegation ist vorbereitet: keine Bewegung.
    assert zones.MOVES[zones.PLAYOFF_PROMOTION] == 0 and zones.MOVES[zones.PLAYOFF_RELEGATION] == 0


def test_exited_teams_sit_at_the_end_never_go_up_and_fill_relegation_first():
    # Regel „half“: Das ausgetretene Team steht rechnerisch auf Platz 1 - für die Zonen steht es hinten.
    rows = table(6, exits={1: "withdrawn"})
    found = zones.assign(rows, zones.effective({"level": 2}, [1, 2, 3]))
    assert found["r1"] == zones.OUT
    assert found["r2"] == zones.PROMOTION
    # Der Abstiegsplatz ist vom ausgetretenen Team belegt: Der Letzte in der Wertung bleibt.
    assert found["r6"] is None


def test_disqualified_falls_out_even_in_the_bottom_division():
    found = zones.assign(table(4, exits={3: "disqualified"}), zones.effective({"level": 3}, [1, 2, 3]))
    assert found["r3"] == zones.OUT
    assert [found[key] for key in ("r1", "r2", "r4")] == [zones.PROMOTION, None, None]


def test_no_zones_before_the_first_result():
    rows = zones.mark(table(4, played=0), zones.effective({"level": 2}, [1, 2, 3]))
    assert {row["zone"] for row in rows} == {None}
    rows = zones.mark(table(4), zones.effective({"level": 2}, [1, 2, 3]))
    assert rows[0]["zone"] == zones.PROMOTION


def test_overlapping_zones_are_refused():
    with pytest.raises(zones.ZoneProblem):
        zones.clean({"promote": 3, "relegate": 2, "playoff_promote": 1}, 5)
    assert zones.clean({"promote": 3, "relegate": 2}, 5) == {"promote": 3, "relegate": 2, "playoff_promote": 0, "playoff_relegate": 0}


def test_tie_across_a_zone_boundary_is_found_but_not_inside_a_zone():
    rows = table(6)
    rows[1]["rank"] = 1  # Platz 1 geteilt, Grenze nach Platz 1
    found = zones.boundary_ties(rows, zones.effective({"level": 2}, [1, 2, 3]))
    assert [tie["registration_ids"] for tie in found] == [["r1", "r2"]]
    # Gegenprobe: Gleichstand in der Mitte - keine Grenze betroffen.
    rows = table(6)
    rows[3]["rank"] = 3
    assert zones.boundary_ties(rows, zones.effective({"level": 2}, [1, 2, 3])) == []
    # Gegenprobe: zwei Aufsteiger - der geteilte Platz 1 liegt ganz in der Zone.
    rows = table(6)
    rows[1]["rank"] = 1
    assert zones.boundary_ties(rows, zones.effective({"level": 2, "zones": {"promote": 2}}, [1, 2, 3])) == []


def test_pdf_shows_the_zone_next_to_the_name_and_as_a_mark():
    from pdf_service import _pdf_standings_tables, pdf_standings

    rows = zones.mark(table(4), zones.effective({"level": 2}, [1, 2, 3]))
    for row in rows:
        row.update(score_diff=0, won=1, drawn=0, lost=1)
    built = _pdf_standings_tables({"format": "league"}, rows)[0]
    assert built["zones"] == ["promotion", None, None, "relegation"]
    assert built["rows"][0][1] == "Team 1 (Aufstieg)" and built["rows"][3][1] == "Team 4 (Abstieg)" and built["rows"][1][1] == "Team 2"
    assert pdf_standings({"title": "Probe", "format": "league"}, rows).startswith(b"%PDF")
    # Gegenprobe: ein Turnier ohne Zonen bleibt, wie es war.
    plain = _pdf_standings_tables({"format": "league"}, table(2))[0]
    assert plain["zones"] == [None, None] and plain["rows"][0][1] == "Team 1"


def test_no_tie_block_when_all_tied_teams_land_in_the_same_zone():
    # Vier Teams, Zonen 3/3 (überlappen): Platz 1 geteilt - beide steigen auf, nichts zu entscheiden.
    rows = table(4)
    rows[1]["rank"] = 1
    rules = zones.effective({"level": 2, "zones": {"promote": 3, "relegate": 3}}, [1, 2, 3])
    assert zones.boundary_ties(rows, rules) == []
    # Gegenprobe: Platz 3 und 4 geteilt - einer stiege auf, einer ab.
    rows = table(4)
    rows[3]["rank"] = 3
    assert [tie["registration_ids"] for tie in zones.boundary_ties(rows, rules)] == [["r3", "r4"]]
