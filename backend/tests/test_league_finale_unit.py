"""Saisonfinale am TV (#1641): Auf- und Absteiger je Liga N aus dem Endstand - reine Rechnung, ohne Datenbank."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import league_finale as finale  # noqa: E402


def row(rid, rank, zone, name=None):
    return {"registration_id": rid, "rank": rank, "zone": zone, "display_name": name or f"Team {rid}"}


DIVISIONS = [{"id": "d1", "level": 1}, {"id": "d2", "level": 2, "nickname": "Aufbau"}, {"id": "d3", "level": 3}]


def test_movers_unit_split_up_down_out_in_order():
    rows = [row("c", 3, "relegation"), row("a", 1, "promotion"), row("b", 2, None), row("d", 4, "out"),
            row("e", 2, "playoff_promotion")]
    out = finale.movers(rows)
    assert [item["registration_id"] for item in out["up"]] == ["a"]
    assert [item["registration_id"] for item in out["down"]] == ["c"]
    assert [item["registration_id"] for item in out["out"]] == ["d"]


def test_movers_unit_relegation_places_do_not_move():
    """Relegation ist vorbereitet, ohne Wirkung (league_zones.MOVES) - am TV steht dafür niemand als Auf- oder Absteiger."""
    out = finale.movers([row("a", 1, "playoff_promotion"), row("b", 4, "playoff_relegation")])
    assert out == {"up": [], "down": [], "out": []}


def test_pages_unit_targets_are_neighbour_levels_with_labels():
    finals = [
        {"division_id": "d1", "staffel": "A", "rows": [row("a1", 1, None), row("a4", 4, "relegation")]},
        {"division_id": "d2", "staffel": "A", "rows": [row("b1", 1, "promotion"), row("b4", 4, "relegation")]},
        {"division_id": "d3", "staffel": "A", "rows": [row("c1", 1, "promotion"), row("c4", 4, None)]},
    ]
    pages = finale.build_pages(DIVISIONS, finals)
    assert [page["label"] for page in pages] == ["Liga 1", "Liga 2 · Aufbau", "Liga 3"]
    first, second, third = pages
    assert [(item["name"], item["move"], item["target"]) for item in first["rows"]] == [("Team a4", "down", "Liga 2 · Aufbau")]
    assert [(item["name"], item["move"], item["target"]) for item in second["rows"]] == [
        ("Team b1", "up", "Liga 1"), ("Team b4", "down", "Liga 3")]
    assert [(item["name"], item["move"], item["target"]) for item in third["rows"]] == [("Team c1", "up", "Liga 2 · Aufbau")]


def test_pages_unit_skip_divisions_without_movers_and_order_staffeln():
    finals = [
        {"division_id": "d2", "staffel": "B", "rows": [row("b1", 1, "promotion")]},
        {"division_id": "d2", "staffel": "A", "rows": [row("a1", 1, "promotion"), row("a5", 5, "out")]},
        {"division_id": "d1", "staffel": "A", "rows": [row("x", 1, None)]},
    ]
    pages = finale.build_pages(DIVISIONS, finals)
    assert len(pages) == 1
    page = pages[0]
    assert page["staffeln"] == 2
    # Erst alle Aufsteiger (Staffel A vor B), dann Absteiger, zuletzt wer ausscheidet.
    assert [(item["registration_id"], item["staffel"], item["move"]) for item in page["rows"]] == [
        ("a1", "A", "up"), ("b1", "B", "up"), ("a5", "A", "out")]
    assert page["rows"][2]["target"] is None


def test_pages_unit_single_staffel_hides_staffel_letter():
    finals = [{"division_id": "d2", "staffel": "A", "rows": [row("b1", 1, "promotion")]}]
    page = finale.build_pages(DIVISIONS, finals)[0]
    assert page["staffeln"] == 1
    assert page["rows"][0]["staffel"] is None


def test_pages_unit_full_names_never_cut():
    long_name = "Die außergewöhnlich lange Teambezeichnung der Probe-Mannschaft Nord-Ost"
    finals = [{"division_id": "d2", "staffel": "A", "rows": [row("b1", 1, "promotion", long_name)]}]
    assert finale.build_pages(DIVISIONS, finals)[0]["rows"][0]["name"] == long_name


def test_step_unit_next_and_end():
    assert finale.next_step(0, 3) == 1
    assert finale.next_step(2, 3) == 3
    assert finale.next_step(3, 3) == 3
    assert finale.next_step(0, 0) == 0
    assert finale.clamp_step(5, 2) == 2
    assert finale.clamp_step(-1, 2) == 0
    assert finale.clamp_step("x", 2) == 0


def test_pages_unit_tv_at_most_eight_rows_per_column_rest_counted():
    """Nr. 235: Am TV höchstens 8 Zeilen je Spalte (links Aufstieg, rechts Abstieg und Ausscheiden), der Rest als Zahl je Spalte.
    Ohne Grenze (Discord) kommen alle."""
    rows = [row(f"u{i}", i + 1, "promotion") for i in range(10)]
    rows += [row(f"d{i}", 20 + i, "relegation") for i in range(12)] + [row("x", 40, "out")]
    finals = [{"division_id": "d2", "staffel": "A", "rows": rows}]
    assert finale.TV_COLUMN_ROWS == 8
    page = finale.build_pages(DIVISIONS, finals, column_max=finale.TV_COLUMN_ROWS)[0]
    up = [item["registration_id"] for item in page["rows"] if item["move"] == "up"]
    down = [item["registration_id"] for item in page["rows"] if item["move"] in ("down", "out")]
    assert up == [f"u{i}" for i in range(8)]
    assert down == [f"d{i}" for i in range(8)]
    assert (page["more_up"], page["more_down"], page["more"]) == (2, 5, 7)
    everything = finale.build_pages(DIVISIONS, finals)[0]
    assert len(everything["rows"]) == 23 and everything["more"] == 0


def test_successor_unit_lists_discord_among_the_copied_settings():
    """K6, Nr. 236: Die Folge-Season uebernimmt die Discord-Einstellung samt an - die Vorschau nennt das auch."""
    from services.league_successor import COPIED_GROUPS

    assert any(group.startswith("Discord-Meldungen der Liga") for group in COPIED_GROUPS)


def test_pages_unit_carry_the_league_badge_of_page_and_target():
    """#2561: Am TV steht das Liga-Abzeichen neben „Liga N“ und neben der Ziel-Liga - dafür tragen Seite und Zeile die Stufe
    wie überall (``league_current.badge``: level, nickname, champion)."""
    finals = [
        {"division_id": "d2", "staffel": "A", "rows": [row("b1", 1, "promotion"), row("b4", 4, "relegation"), row("b5", 5, "out")]},
    ]
    page = finale.build_pages(DIVISIONS, finals)[0]
    assert page["badge"] == {"level": 2, "nickname": "Aufbau", "champion": False}
    targets = {item["registration_id"]: item.get("target_badge") for item in page["rows"]}
    assert targets == {"b1": {"level": 1, "nickname": None, "champion": False},
                       "b4": {"level": 3, "nickname": None, "champion": False}, "b5": None}
