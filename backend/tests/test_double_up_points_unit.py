"""Double-Up-Punkte wie bei PineApps (#2015) ohne Datenbank: ein Team auf Platz k bekommt für beide Spieler die Punkte
von Einzelplatz 2k−1, ein geteilter Team-Platz 6 die von Platz 11 - einstellbar je Saison (``double_up_points``), die
Vorgabe rechnet wie PineApps. Dazu der Prüffall: eine echte Saisontabelle (Turniere 1–4, 31 Spieler, T3 Double Up,
beste 6, Aktivität ab 7, Bingo 3, Vorrang Siege → Top 4 → P2 …) mit erfundenen Namen - dieselben Summen und Plätze.
Nur erfundene Namen."""
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.scoring_rules import normalize_rules, result_points  # noqa: E402
from services.series_results import check, resolve  # noqa: E402
from services.series_standings import compute_standings  # noqa: E402

SCHEME = [35, 30, 26, 23, 20, 18, 16, 14, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2] + [1] * 6
RULES = {
    "points_by_place": SCHEME, "count_mode": "best_n", "count_n": 6,
    "activity_points": {"points": 2, "from_round": 7},
    "tiebreakers": ["wins", "top_n", "countback"], "tiebreak_top_n": 4,
    "custom_bonuses": [{"label": "Bingo", "points": 3}],
}
ROUND = {"id": "t3", "status": "planned", "club_day": "2026-10-01", "counts": True}
TODAY = "2026-10-20"


# ---------------------------------------------------------------- Regel
def test_the_default_is_the_single_place_of_the_better_player_and_team_place_is_a_choice():
    assert normalize_rules({})["double_up_points"] == "best_player_place"
    assert normalize_rules({"double_up_points": "team_place"})["double_up_points"] == "team_place"
    assert normalize_rules({"double_up_points": None})["double_up_points"] == "best_player_place"
    with pytest.raises(ValueError):
        normalize_rules({"double_up_points": "irgendwas"})


def test_a_team_on_place_k_scores_like_single_place_two_k_minus_one():
    rules = normalize_rules(RULES)
    points = [result_points({"place": k, "partner_id": "x"}, rules)["points"] for k in range(1, 6)]
    assert points == [35, 26, 20, 16, 12]
    # Ohne Partner (Einzel) zählt der Platz selbst, mit „nach Team-Platz“ auch im Double Up.
    assert [result_points({"place": k}, rules)["points"] for k in range(1, 4)] == [35, 30, 26]
    team = normalize_rules({**RULES, "double_up_points": "team_place"})
    assert [result_points({"place": k, "partner_id": "x"}, team)["points"] for k in range(1, 4)] == [35, 30, 26]
    # Hinter dem Schema 0: Team-Platz 13 wäre Einzelplatz 25.
    assert result_points({"place": 13, "partner_id": "x"}, rules)["points"] == 0


# ---------------------------------------------------------------- Ergebnisblatt mit Gleichstand
NAMES = ["Ada Ausgedacht", "Bruno Beispiel", "Cleo Muster", "Dario Demo", "Ella Erfunden", "Finn Fiktiv",
         "Gina Gedacht", "Hugo Probe", "Ida Irgendwer", "Jan Jedermann"]
PEOPLE = [{"id": f"p-{index}", "name": name, "link": "external"} for index, name in enumerate(NAMES)]


def _pair(first, second, total):
    return [{"name": NAMES[first], "day_points": total, "partner": {"name": NAMES[second]}},
            {"name": NAMES[second], "day_points": total}]


def test_tied_teams_share_the_place_and_all_four_get_the_points_of_the_shared_single_place():
    # Fünf Teams aus GES P: 40, 31, 25, 25 (Gleichstand auf Team-Platz 3), 12 → Team-Plätze 1, 2, 3, 3, 5.
    entry = {"double_up": True, "rows": [*_pair(0, 1, 40), *_pair(2, 3, 31), *_pair(4, 5, 25), *_pair(6, 7, 25),
                                         *_pair(8, 9, 12)]}
    rules = normalize_rules(RULES)
    sheet = resolve(entry, PEOPLE, rules)
    check(sheet, rules, ROUND, TODAY)
    assert sheet.errors == [] and sheet.warnings == []
    assert [row["place"] for row in sheet.rows] == [1, 1, 2, 2, 3, 3, 3, 3, 5, 5]
    # Punkte wie Einzelplatz 1, 3, 5, 5 und 9: 35, 26, 20, 20, 12 - für beide Spieler.
    assert [result_points(row, rules)["points"] for row in sheet.rows] == [35, 35, 26, 26, 20, 20, 20, 20, 12, 12]
    # Nach Team-Platz rechnet dieselbe Liste 35, 30, 26, 26, 20.
    team = normalize_rules({**RULES, "double_up_points": "team_place"})
    assert [result_points(row, team)["points"] for row in sheet.rows] == [35, 35, 30, 30, 26, 26, 26, 26, 20, 20]


def test_the_entry_preview_does_not_warn_when_points_typed_from_the_organizer_match_two_k_minus_one():
    rules = normalize_rules(RULES)
    rows = _pair(0, 1, 40) + _pair(2, 3, 31)
    for row, points in zip(rows, (35, 35, 26, 26)):
        row.update({"points": points, "points_source": "organizer"})
    sheet = resolve({"double_up": True, "rows": rows}, PEOPLE, rules)
    check(sheet, rules, ROUND, TODAY)
    assert [item["code"] for item in sheet.warnings] == []


# ---------------------------------------------------------------- Prüffall: Saisontabelle mit erfundenen Namen
# Je Spieler in der Reihenfolge der Tabelle des Veranstalters: Tagesplatz in T1, T2, T4 (Einzel) und der Team-Platz in
# T3 (Double Up) mit dem Partner (Nummer in dieser Liste). Platz 19-24 gibt je 1 Punkt; in T4 holt Nr. 6 den Bingo.
# Die Summen laut Tabelle stehen dahinter - erfundene Namen „Spieler 01“ … „Spieler 31“ in der Reihenfolge der Tabelle.
TABLE = [
    # (T1, T2, (T3-Team-Platz, Partner), T4, Summe laut Tabelle)
    (2, 3, (2, 6), 2, 112),
    (1, 2, (1, 5), None, 100),
    (7, 4, (4, 11), 1, 90),
    (4, 1, None, 7, 74),
    (5, 6, (1, 2), None, 73),
    (3, None, (2, 1), 6, 73),
    (6, 5, (8, 9), 3, 69),
    (8, None, (6, 12), 8, 37),
    (9, 10, (8, 7), 11, 36),
    (10, 9, None, 9, 34),
    (None, 8, (4, 3), None, 30),
    (16, 11, (6, 8), 13, 29),
    (11, 7, None, None, 25),
    (19, 14, (5, 23), 15, 24),
    (None, None, None, 4, 23),
    (None, None, (3, 17), None, 20),
    (None, None, (3, 16), None, 20),
    (None, None, None, 5, 20),
    (17, None, (6, 20), 14, 18),
    (None, None, (6, 19), 12, 17),
    (13, None, None, 10, 17),
    (14, 12, None, None, 14),
    (None, None, (5, 14), None, 12),
    (12, None, None, None, 8),
    (20, 13, None, None, 8),
    (21, 16, None, 17, 8),
    (15, None, None, None, 5),
    (None, 15, None, None, 5),
    (None, None, None, 16, 4),
    (18, None, None, None, 2),
    (22, None, None, None, 1),
]
# Plätze laut Tabelle des Veranstalters - bei völlig gleichem Stand (16/17, 27/28) nummeriert er einfach weiter, die
# Regeln der Saison teilen dann den Platz („entscheidet keines, teilen sich beide den Platz“) - die Reihenfolge bleibt.
OUR_RANKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 16, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 27, 29,
             30, 31]
TABLE_PEOPLE = [{"id": f"s{number:02d}", "name": f"Spieler {number:02d}", "link": "external"}
                for number in range(1, len(TABLE) + 1)]


def _table_sheets(rules):
    def name(index):
        return TABLE_PEOPLE[index - 1]["name"]

    sheets = {}
    for day, column in (("t1", 0), ("t2", 1), ("t4", 3)):
        rows = [{"name": name(index), "place": item[column]} for index, item in enumerate(TABLE, start=1)
                if item[column]]
        if day == "t4":
            rows = [{**row, "bonus_keys": ["bingo"]} if row["name"] == name(6) else row for row in rows]
        sheets[day] = {"rows": rows}
    sheets["t3"] = {"double_up": True, "rows": [
        {"name": name(index), "place": item[2][0], "partner": {"name": name(item[2][1])}}
        for index, item in enumerate(TABLE, start=1) if item[2]]}
    out = {}
    for day in ("t1", "t2", "t3", "t4"):
        resolution = resolve(sheets[day], TABLE_PEOPLE, rules)
        assert resolution.errors == []
        out[day] = resolution.content()
    return out


def _table_standings(raw_rules, calendar=9, **extra):
    rules = normalize_rules(raw_rules)
    rounds = [{"id": f"t{number}", "order": number, "status": "scored" if number <= 4 else "planned"}
              for number in range(1, calendar + 1)]
    snapshots = compute_standings(rules=rules, rounds=rounds, sheets=_table_sheets(rules), participants=TABLE_PEOPLE,
                                  **extra)
    return [snap for snap in snapshots if snap["scope"] == "drivers"][-1]["rows"]


def test_the_organizers_season_table_comes_out_with_the_same_totals_and_places():
    rows = _table_standings(RULES)
    assert [row["participant_id"] for row in rows] == [person["id"] for person in TABLE_PEOPLE]
    assert [row["points"] for row in rows] == [item[4] for item in TABLE]
    assert [row["rank"] for row in rows] == OUR_RANKS
    by_id = {row["participant_id"]: row for row in rows}
    # T3 Double Up: Team 1 → 35, Team 2 → 26, Team 3 → 20, Team 4 → 16, Team 5 → 12, zweimal Team 6 → je 9 (P11),
    # Team 8 → 5 (P15). Der Platz bleibt der Team-Platz.
    t3 = {pid: next(item for item in row["results"] if item["round_id"] == "t3")
          for pid, row in by_id.items() if any(item["round_id"] == "t3" for item in row["results"])}
    assert sorted({(item["place"], item["points"]) for item in t3.values()}) == [
        (1, 35), (2, 26), (3, 20), (4, 16), (5, 12), (6, 9), (8, 5)]
    # Gleichstand 73: Nr. 5 hat einen Sieg (Team-Platz 1 im Double Up) - Nr. 6 steht wegen der Siege dahinter.
    assert (by_id["s05"]["rank"], by_id["s06"]["rank"], by_id["s06"]["tiebreak"]) == (5, 6, "wins")
    # Bingo zählt getrennt; Aktivität erst ab Turnier 7.
    assert by_id["s06"]["bonus_points"] == 3 and all(row["activity_points"] == 0 for row in rows)
    # 20 Punkte: zweimal Team-Platz 3 (Top 4) vor einem Einzelplatz 5; 17 Punkte: Team-Platz 6 vor Platz 10.
    assert (by_id["s16"]["tiebreak"], by_id["s18"]["tiebreak"], by_id["s21"]["tiebreak"]) == (None, "top_n", "countback")
