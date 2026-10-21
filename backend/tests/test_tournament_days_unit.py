"""Turniertage einer Turnierserie (#1961) ohne Datenbank: Runden je Termin mit Tagessumme und Tagesplatz, geteilte
Plätze (Gleichstand und Double Up), Rundenpunkte wie gelesen (Bots), eigene Sonderboni, Gleichstand-Regel „Top N“ und
Spielkennungen mit Tag („Name#TAG“). Der Abnahmefall aus dem Issue steht ganz oben. Nur erfundene Namen."""
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import series_identity, tournament_days  # noqa: E402
from services.scoring_rules import normalize_rules  # noqa: E402
from services.series_results import check, resolve  # noqa: E402
from services.series_standings import compute_standings  # noqa: E402

SEASON = [35, 30, 26, 23, 20, 18, 16, 14, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2] + [1] * 6
RULES = {
    "points_by_place": SEASON, "count_mode": "best_n", "count_n": 6,
    "activity_points": {"points": 2, "from_round": 7},
    "tiebreakers": ["wins", "top_n", "countback"], "tiebreak_top_n": 4,
    "day_rounds": {"count": 5, "points_by_place": [8, 7, 6, 5, 4, 3, 2, 1]},
    "custom_bonuses": [{"label": "Bingo", "points": 3}],
}
NAMES = {"a": "Ada Ausgedacht", "b": "Bruno Beispiel", "c": "Cleo Muster", "d": "Dario Demo", "e": "Ella Erfunden",
         "f": "Finn Fiktiv", "g": "Gina Gedacht", "h": "Hugo Probe"}
PEOPLE = [{"id": f"p-{key}", "name": name, "link": "external"} for key, name in NAMES.items()]
ROUND = {"id": "t1", "status": "planned", "club_day": "2026-10-01", "counts": True}
TODAY = "2026-10-20"


def _row(key, rounds, **extra):
    """Eine Zeile wie aus dem Einfügen: Name und die Rundenpunkte R1…R5 - ohne Platz (die Tagessumme bestimmt ihn)."""
    entries = [None if value is None else ({"place": value[1]} if isinstance(value, tuple) else {"points": value})
               for value in rounds]
    return {"name": NAMES[key], "day_rounds": entries, **extra}


def _same(points):
    return [points] * 5


# Fünf Turniertage, T3 ist Double Up, T2 hat einen Gleichstand auf Platz 4, H holt in T1 den Bingo-Bonus. In T4 fehlt H;
# die Lobby war nicht voll, ein Bot belegt jeweils Platz 8 - E wird Letzter der Menschen auf Platz 7 und bekommt 2.
DAYS = {
    "t1": {"rows": [_row("g", _same(8)), _row("d", _same(7)), _row("a", _same(6)), _row("c", _same(5)),
                    _row("f", _same(4)), _row("b", _same(3)), _row("e", _same(2)),
                    _row("h", _same(1), bonus_keys=["bingo"])]},
    "t2": {"rows": [_row("g", _same(8)), _row("e", _same(7)), _row("b", _same(6)), _row("c", [5, 4, 5, 4, 4]),
                    _row("f", [4, 5, 4, 5, 4]), _row("a", _same(3)), _row("d", _same(2)), _row("h", _same(1))]},
    "t3": {"double_up": True, "rows": [
        _row("g", _same(4), partner={"name": NAMES["h"]}), _row("h", _same(4)),
        _row("c", _same(3), partner={"name": NAMES["d"]}), _row("d", _same(3), partner={"name": NAMES["c"]}),
        _row("e", _same(2), partner={"name": NAMES["f"]}), _row("f", _same(2)),
        _row("a", _same(1), partner={"name": NAMES["b"]}), _row("b", _same(1))]},
    "t4": {"rows": [_row("a", _same(8)), _row("g", _same(7)), _row("f", _same(6)), _row("b", _same(5)),
                    _row("c", _same(4)), _row("d", _same(3)), _row("e", [("p", 7)] * 5)]},
    "t5": {"rows": [_row("g", _same(8)), _row("h", _same(7)), _row("b", _same(6)), _row("e", _same(5)),
                    _row("d", _same(4)), _row("c", _same(3)), _row("f", _same(2)), _row("a", _same(1))]},
}


def _sheets(rules):
    out = {}
    for day, entry in DAYS.items():
        resolution = resolve(entry, PEOPLE, rules)
        assert resolution.errors == []
        out[day] = resolution.content()
    return out


def _standings(raw_rules=None):
    rules = normalize_rules(raw_rules or RULES)
    rounds = [{"id": day, "order": index, "status": "scored"} for index, day in enumerate(DAYS, start=1)]
    snapshots = compute_standings(rules=rules, rounds=rounds, sheets=_sheets(rules), participants=PEOPLE)
    return [snap for snap in snapshots if snap["scope"] == "drivers"][-1]["rows"]


# ---------------------------------------------------------------- Abnahmefall
def test_acceptance_five_days_double_up_tie_on_four_and_bingo_match_the_example_table():
    rows = _standings()
    # Beispieltabelle: Saisonpunkte je Turniertag (Platz → 35/30/26/23/20/18/16/14), beste 6 von 5 = alle, Bingo +3
    # getrennt. Gleichstand: Siege (A vor B), dann Top 4 (C vor D - Countback allein sähe D vorn, zwei zweite Plätze),
    # dann Countback (E vor F mit einem zweiten Platz).
    assert [(row["participant_id"], row["rank"], row["points"], row["bonus_points"], row["tiebreak"])
            for row in rows] == [
        ("p-g", 1, 170, 0, None),
        ("p-a", 2, 116, 0, None),
        ("p-b", 3, 116, 0, "wins"),
        ("p-c", 4, 114, 0, None),
        ("p-d", 5, 114, 0, "top_n"),
        ("p-e", 6, 111, 0, None),
        ("p-f", 7, 111, 0, "countback"),
        ("p-h", 8, 96, 3, None),
    ]
    by_id = {row["participant_id"]: row for row in rows}
    # Tagesplätze aus der Tagessumme: T2 zweimal Platz 4, danach Platz 6; T3 je Paar ein Platz (1, 1, 2, 2 …).
    places = {pid: [item["place"] for item in row["results"]] for pid, row in by_id.items()}
    assert places["p-c"] == [4, 4, 2, 5, 6] and places["p-f"] == [5, 4, 3, 3, 7]
    assert places["p-a"] == [3, 6, 4, 1, 8] and places["p-h"] == [8, 8, 1, 2]
    # Beste 6 von 5 Terminen: nichts gestrichen; Aktivitätspunkte erst ab Turnier 7.
    assert all(row["dropped_round_ids"] == [] and row["activity_points"] == 0 for row in rows)
    # Das Spieler-Detail kennt Tagespunkte, Runden, Partner und Bonus je Termin.
    t3 = next(item for item in by_id["p-c"]["results"] if item["round_id"] == "t3")
    assert (t3["day_points"], t3["partner_id"], t3["points"]) == (15, "p-d", 30)
    assert [entry["points"] for entry in t3["day_rounds"]] == [3, 3, 3, 3, 3]
    t1 = by_id["p-h"]["results"][0]
    assert (t1["bonus"], t1["bonus_keys"], t1["points"]) == (3, ["bingo"], 14)


def test_bot_places_count_as_read_and_a_place_gives_points_from_the_round_scheme():
    rows = _standings()
    e_t4 = next(item for item in next(row for row in rows if row["participant_id"] == "p-e")["results"]
                if item["round_id"] == "t4")
    # Platz 7 in der Lobby (ein Bot auf 8): 2 Punkte je Runde, nicht 1 aus der Reihenfolge der Menschen.
    assert [entry["points"] for entry in e_t4["day_rounds"]] == [2, 2, 2, 2, 2]
    assert e_t4["day_points"] == 10 and e_t4["place"] == 7


def test_best_n_drops_results_but_never_the_bonus():
    rows = _standings({**RULES, "count_n": 3})
    h = next(row for row in rows if row["participant_id"] == "p-h")
    # H: 14 (T1, mit Bingo), 14 (T2), 35, 30 - die besten drei zählen (bei gleichen Punkten bleibt der frühere Termin),
    # gestrichen ist T2. Der Bonus zählt getrennt und würde auch mit T1 nicht gestrichen.
    assert h["dropped_round_ids"] == ["t2"] and h["points"] == 35 + 30 + 14 + 3 and h["bonus_points"] == 3
    rows = _standings({**RULES, "count_n": 2})
    h = next(row for row in rows if row["participant_id"] == "p-h")
    assert h["dropped_round_ids"] == ["t1", "t2"] and h["points"] == 35 + 30 + 3


# ---------------------------------------------------------------- Blatt: Plätze, Paare, GES P
def _checked(entry, rules=None):
    out = resolve(entry, PEOPLE, normalize_rules(rules or RULES))
    check(out, normalize_rules(rules or RULES), ROUND, TODAY)
    return out


def _codes(problems):
    return [item["code"] for item in problems]


def test_a_tie_on_four_and_double_up_pairs_share_their_place_without_a_message():
    tie = _checked(DAYS["t2"])
    assert [row["place"] for row in tie.rows] == [1, 2, 3, 4, 4, 6, 7, 8]
    assert tie.errors == [] and tie.warnings == []
    pairs = _checked(DAYS["t3"])
    assert [row["place"] for row in pairs.rows] == [1, 1, 2, 2, 3, 3, 4, 4]
    assert pairs.errors == [] and pairs.warnings == []
    # Wer nur auf einer Seite steht, bekommt den Partner auf der anderen dazu.
    assert [(row["participant_id"], row["partner_id"]) for row in pairs.rows[:2]] == [("p-g", "p-h"), ("p-h", "p-g")]
    assert pairs.content()["double_up"] is True


def test_typed_places_tie_with_a_gap_after_is_fine_but_a_double_without_one_warns():
    entry = {"rows": [{"name": NAMES[key], "place": place} for key, place in (("a", 1), ("b", 2), ("c", 2), ("d", 4))]}
    assert _checked(entry).warnings == []
    sloppy = {"rows": [{"name": NAMES[key], "place": place} for key, place in (("a", 1), ("b", 2), ("c", 2), ("d", 3))]}
    assert _codes(_checked(sloppy).warnings) == ["place_twice"]


def test_partners_must_be_in_the_list_not_oneself_and_not_taken():
    out = _checked({"double_up": True, "rows": [
        {"name": NAMES["a"], "place": 1, "partner": {"name": NAMES["b"]}},
        {"name": NAMES["b"], "place": 1},
        {"name": NAMES["c"], "place": 2, "partner": {"name": NAMES["b"]}},
        {"name": NAMES["d"], "place": 2, "partner": {"name": NAMES["d"]}},
        {"name": NAMES["e"], "place": 3, "partner": {"name": "Niemand Hier"}},
    ]})
    assert _codes(out.errors) == ["partner_self", "partner_not_in_list", "partner_conflict"]
    assert [item["rows"] for item in out.errors] == [[3], [4], [1, 2]]


def test_double_up_rows_without_partner_or_with_another_place_warn():
    out = _checked({"double_up": True, "rows": [
        {"name": NAMES["a"], "place": 1, "partner": {"name": NAMES["b"]}}, {"name": NAMES["b"], "place": 2},
        {"name": NAMES["c"], "place": 3}]})
    assert _codes(out.warnings) == ["partner_place_differs", "partner_missing"]


def test_given_day_points_win_over_the_sum_of_rounds_with_a_warning():
    out = _checked({"rows": [_row("a", _same(8), day_points=41), _row("b", _same(7))]})
    assert _codes(out.warnings) == ["day_points_differ"] and "es gilt GES P" in out.warnings[0]["message"]
    assert tournament_days.day_total(out.rows[0], normalize_rules(RULES)) == 41


def test_left_rounds_count_zero_and_the_mark_is_kept():
    out = _checked({"rows": [_row("a", [8, 8, None, None, None], marks=["left"]), _row("b", _same(1))]})
    assert out.warnings == []
    assert out.rows[0]["marks"] == ["left"] and out.rows[0]["place"] == 1
    assert out.content()["rows"][0]["day_rounds"] == [{"points": 8}, {"points": 8}]


def test_unknown_bonus_keys_fall_away_with_a_warning():
    out = _checked({"rows": [_row("a", _same(8), bonus_keys=["bingo", "joker"])]})
    assert out.rows[0]["bonus_keys"] == ["bingo"] and _codes(out.warnings) == ["bonus_unknown"]


def test_a_dns_row_gets_no_derived_place():
    out = _checked({"rows": [_row("a", _same(8)), _row("b", _same(7), marks=["dns"])]})
    assert [row["place"] for row in out.rows] == [1, None]


# ---------------------------------------------------------------- Regeln
def test_rules_default_to_no_day_rounds_and_check_bonuses_and_top_n():
    rules = normalize_rules({})
    assert rules["day_rounds"] == {"count": 0, "points_by_place": [8, 7, 6, 5, 4, 3, 2, 1]}
    assert (rules["custom_bonuses"], rules["tiebreak_top_n"]) == ([], 4)
    assert normalize_rules({"custom_bonuses": [{"label": " Bingo! ", "points": "3"}]})["custom_bonuses"] == [
        {"key": "bingo", "label": "Bingo!", "points": 3}]
    # Die Kennung bleibt, wenn der Name sich ändert.
    assert normalize_rules({"custom_bonuses": [{"key": "bingo", "label": "Bingo-Karte", "points": 3}]})[
        "custom_bonuses"][0]["key"] == "bingo"
    for broken in ({"custom_bonuses": [{"label": "!!", "points": 1}]},
                   {"custom_bonuses": [{"label": "Bingo", "points": 1}, {"label": "bingo", "points": 2}]},
                   {"custom_bonuses": [{"label": "Bingo", "points": -1}]},
                   {"day_rounds": {"count": 21}}, {"tiebreak_top_n": 0}, {"tiebreakers": ["top_x"]}):
        with pytest.raises(ValueError):
            normalize_rules(broken)


# ---------------------------------------------------------------- Spielkennung mit Tag
def test_a_name_with_game_tag_is_the_same_person_and_shows_without_tag():
    assert series_identity.without_game_tag("TheLostFriday#TLS") == "TheLostFriday"
    assert series_identity.without_game_tag("Ada Ausgedacht #EUW1") == "Ada Ausgedacht"
    # Kein Tag: zu kurz, zu lang, Leerzeichen darin, nur ein Tag.
    for name in ("Lion #1", "Probe#ABCDEF", "Probe#AB C", "#TLS"):
        assert series_identity.without_game_tag(name) == name
    assert "thelostfriday" in series_identity.name_keys("TheLostFriday#TLS")
    out = resolve({"rows": [{"name": "Ada Ausgedacht#TLS", "place": 1}]}, PEOPLE, normalize_rules(RULES))
    assert (out.rows[0]["participant_id"], out.rows[0]["match"]) == ("p-a", "name_untagged")
