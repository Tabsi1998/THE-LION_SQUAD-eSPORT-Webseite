"""Runde mit Läufen (#1930) ohne Datenbank: Lauf je Termin, Kürzel-Varianten beim Einfügen, „Ablauf je Runde“
auch ab Runde X wechselnd, Punkte je Lauf, Pole und Startplatz aus dem Qualifying, umgekehrte Wertung als Startplatz.
Nur erfundene Namen und Orte."""
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import race_weekend, race_weekend_paste  # noqa: E402
from services.reference_calendar import parse_round_lines  # noqa: E402
from services.round_phases import normalize_phases, phase_for, phase_ranges  # noqa: E402

F2 = {"formats": [
    {"from_round": 1, "sessions": [
        {"label": "Blitz-Qualifying", "offset": 0},
        {"label": "Sprint", "offset": 30, "points": [12, 9, 7, 6, 5, 4, 3, 2, 1], "grid": "manual"},
        {"label": "Hauptrennen", "offset": 75}]},
    {"from_round": 5, "sessions": [
        {"label": "Sprint", "offset": 0, "points": "series", "grid": "reverse_standings"},
        {"label": "Hauptrennen", "offset": 45, "grid": "reverse_standings"}]},
]}


# ---------------------------------------------------------------- ab Runde X
def test_phases_start_at_round_one_and_the_latest_start_wins():
    phases = normalize_phases([{"from_round": 5, "x": "b"}, {"x": "a"}], lambda raw, where: {"x": raw["x"]})
    assert [(item["from_round"], item["x"]) for item in phases] == [(1, "a"), (5, "b")]
    assert [phase_for(phases, number)["x"] for number in (1, 4, 5, 9)] == ["a", "a", "b", "b"]
    assert phase_ranges(phases) == [(1, 4), (5, None)]
    with pytest.raises(ValueError):
        normalize_phases([{"from_round": 2}], lambda raw, where: {})
    with pytest.raises(ValueError):
        normalize_phases([{"from_round": 1}, {"from_round": 1}], lambda raw, where: {})


# ---------------------------------------------------------------- Lauf
@pytest.mark.parametrize("label, kind", [
    (None, "race"), ("Rennen", "race"), ("Hauptrennen", "race"), ("Lauf 2", "race"), ("Qualifying", "qualifying"),
    ("Blitz-Qualifying", "qualifying"), ("Q", "qualifying"), ("Sprint-Shootout", "qualifying"), ("Sprint", "sprint"),
])
def test_the_kind_of_a_session_comes_from_its_name(label, kind):
    assert race_weekend.session_kind(label) == kind


@pytest.mark.parametrize("text, code, session", [
    ("R1S · Australien", "R1", "Sprint"),
    ("R1 S · Australien", "R1", "Sprint"),
    ("R1-Sprint · Australien", "R1", "Sprint"),
    ("R1 Sprint · Australien", "R1", "Sprint"),
    ("R1 Q · Australien", "R1", "Qualifying"),
    ("R1 Quali", "R1", "Qualifying"),
    ("R1 Qualifying", "R1", "Qualifying"),
    ("R1Q · Australien", "R1", "Qualifying"),
    ("R1 Rennen", "R1", "Rennen"),
    ("R1 Race", "R1", "Rennen"),
    ("R1 Feature", "R1", "Rennen"),
    ("R1 Hauptrennen", "R1", "Rennen"),
    ("R1 Lauf 2 · Probering", "R1", "Lauf 2"),
    ("R1 · Australien", "R1", None),
    ("R1 Spa", "R1", None),
    ("ST 5 Probehalle", "ST 5", None),
    ("12. Probering", "12", None),
])
def test_codes_with_a_session_are_recognised(text, code, session):
    found, label, rest = race_weekend.take_code(text)
    assert (found, label) == (code, session)
    assert "Sprint" not in rest and "Quali" not in rest


@pytest.mark.parametrize("text, code, rest", [
    # Ein Lauf-Wort zählt nur mit Trenner danach (Prüfer #1930): „Race of Champions“ ist ein Name, kein Lauf.
    ("R1 Race of Champions", "R1", "Race of Champions"),
    ("R1 Q Katar", "R1", "Q Katar"),
    ("R1 Sprint Ring · Spa", "R1", "Sprint Ring · Spa"),
])
def test_a_session_word_needs_a_separator_after_it(text, code, rest):
    found, session, after = race_weekend.take_code(text)
    assert (found, session, after.strip()) == (code, None, rest)


def test_a_removed_date_counts_as_separator_after_a_session_word():
    parsed = parse_round_lines("R1 Sprint 07.03.2026 Spa\nR2 Race of Champions 14.03.2026", season="2026",
                               today="2026-01-01", default_weekday=None, default_time="20:00")
    assert [(row["code"], row["session"], row["venue"]) for row in parsed["rows"]] == [
        ("R1", "Sprint", "Spa"), ("R2", None, "Race of Champions")]


@pytest.mark.parametrize("text", ["R1x · Probering", "Probering", "Abcdefg1 Ort", "R1Q2 Ort"])
def test_anything_else_glued_to_a_code_is_no_code(text):
    assert race_weekend.take_code(text) == (None, None, text)


def test_a_pasted_list_keeps_the_session_out_of_the_venue():
    parsed = parse_round_lines("R1S · 07.03.2026 · Australien\nR1 · 08.03.2026 · Australien", season="2026",
                               today="2026-01-01", default_weekday=None, default_time="20:00")
    assert parsed["errors"] == []
    assert [(row["code"], row["session"], row["venue"], row["country_code"]) for row in parsed["rows"]] == [
        ("R1", "Sprint", "Australien", "AU"), ("R1", None, "Australien", "AU")]


# ---------------------------------------------------------------- Ablauf je Runde
def test_the_weekend_template_fills_in_defaults_per_kind():
    weekend = race_weekend.normalize_weekend(F2)
    first, second = weekend["formats"]
    assert [(item["label"], item["counts"], item["points"], item["grid"]) for item in first["sessions"]] == [
        ("Blitz-Qualifying", False, "none", "manual"),
        ("Sprint", True, [12, 9, 7, 6, 5, 4, 3, 2, 1], "manual"),
        ("Hauptrennen", True, "series", "qualifying"),
    ]
    assert second["from_round"] == 5
    assert race_weekend.normalize_weekend(None) is None
    assert race_weekend.normalize_weekend({"formats": []}) is None


@pytest.mark.parametrize("raw", [
    {"formats": [{"sessions": []}]},
    {"formats": [{"sessions": [{"label": ""}]}]},
    {"formats": [{"sessions": [{"label": "Sprint"}, {"label": "sprint"}]}]},
    {"formats": [{"sessions": [{"label": "Sprint", "grid": "lottery"}]}]},
    {"formats": [{"sessions": [{"label": "Sprint", "points": [-1]}]}]},
    {"formats": [{"sessions": [{"label": "Sprint", "offset": 99999}]}]},
    {"formats": [{"from_round": 3, "sessions": [{"label": "Sprint"}]}]},
])
def test_a_broken_template_is_refused(raw):
    with pytest.raises(ValueError):
        race_weekend.normalize_weekend(raw)


def test_the_config_of_a_session_follows_the_round_and_falls_back_to_its_kind():
    weekend = race_weekend.normalize_weekend(F2)
    assert race_weekend.session_config(weekend, 2, "Sprint")["points"][0] == 12
    assert race_weekend.session_config(weekend, 5, "Sprint")["points"] == "series"
    # „Rennen“ steht nicht in der Vorgabe - es nimmt den Lauf derselben Art (Hauptrennen).
    # Der frühere Name „reverse_standings“ heißt jetzt „vor der Runde“.
    assert race_weekend.session_config(weekend, 6, "Rennen")["grid"] == "reverse_standings_before_round"
    # Ohne Vorgabe: Qualifying ohne Punkte, Rennen mit Startplatz aus dem Qualifying.
    assert race_weekend.session_config(None, 1, "Qualifying")["points"] == "none"
    assert race_weekend.session_config(None, 1, None)["grid"] == "qualifying"


def _rounds(*items):
    return [{"id": rid, "code": code, "session": session, "order": index, "status": "scored", "counts": counts}
            for index, (rid, code, session, counts) in enumerate(items, start=1)]


def test_rounds_with_the_same_code_are_one_weekend():
    rounds = _rounds(("a", "R1", "Qualifying", False), ("b", "r 1", "Rennen", True), ("c", "R2", None, True),
                     ("d", None, None, True))
    groups = race_weekend.weekend_groups(rounds)
    assert [(group["number"], [rnd["id"] for rnd in group["rounds"]]) for group in groups] == [
        (1, ["a", "b"]), (2, ["c"]), (3, ["d"])]
    annotated = race_weekend.annotate(rounds)
    assert [(rnd["weekend"], rnd["session_kind"]) for rnd in annotated] == [
        (1, "qualifying"), (1, "race"), (2, "race"), (3, "race")]


# ---------------------------------------------------------------- Einfügen
def test_one_line_per_round_creates_every_session_of_its_format():
    weekend = race_weekend.normalize_weekend(F2)
    text = "\n".join(f"R{number} · {number:02d}.03.2026 · Probering" for number in range(1, 9))
    parsed = parse_round_lines(text, season="2026", today="2026-01-01", default_weekday=None, default_time="20:00")
    out = race_weekend_paste.expand_paste(parsed, weekend, [])
    assert out["errors"] == [] and out["count"] == 4 * 3 + 4 * 2
    first, fifth = out["rows"][0], out["rows"][4]
    assert [(item["session"], item["time"], item["counts"]) for item in first["sessions"]] == [
        ("Blitz-Qualifying", "20:00", False), ("Sprint", "20:30", True), ("Hauptrennen", "21:15", True)]
    assert [(item["session"], item["time"]) for item in fifth["sessions"]] == [("Sprint", "20:00"),
                                                                             ("Hauptrennen", "20:45")]


def test_a_line_with_a_session_creates_only_that_one_and_never_twice():
    weekend = race_weekend.normalize_weekend(F2)
    parsed = parse_round_lines("R1 Feature · 05.03.2026 21:00 · Probering", season="2026", today="2026-01-01",
                               default_weekday=None, default_time="20:00")
    out = race_weekend_paste.expand_paste(parsed, weekend, [])
    assert [(item["session"], item["time"]) for item in out["rows"][0]["sessions"]] == [("Hauptrennen", "21:00")]
    existing = [{"id": "x", "code": "R1", "session": "Hauptrennen", "order": 1}]
    again = race_weekend_paste.expand_paste(parsed, weekend, existing)
    assert again["rows"] == [] and again["errors"][0]["message"] == "R1 Hauptrennen gibt es in dieser Saison schon."


def test_a_duplicate_from_the_same_list_names_the_line_and_the_reason():
    weekend = race_weekend.normalize_weekend({"formats": [{"from_round": 1, "sessions": [
        {"label": "Qualifying", "offset": 0}, {"label": "Rennen", "offset": 30}]}]})
    parsed = parse_round_lines("R1 Q · 05.03.2026 · Probering\nR1 · 05.03.2026 · Probering", season="2026",
                               today="2026-01-01", default_weekday=None, default_time="20:30")
    out = race_weekend_paste.expand_paste(parsed, weekend, [])
    assert out["errors"][0]["line"] == 2
    assert out["errors"][0]["message"] == (
        "R1 Qualifying steht schon in Zeile 1 – ‚R1‘ legt laut Ablauf Qualifying und Rennen an. Entweder nur ‚R1‘ je "
        "Runde oder jeden Lauf einzeln (‚R1 Q‘, ‚R1 Rennen‘).")


def test_every_suggested_line_creates_exactly_that_session():
    weekend = race_weekend.normalize_weekend({"formats": [{"from_round": 1, "sessions": [
        {"label": "Blitz-Qualifying", "offset": 0}, {"label": "Shootout", "offset": 10},
        {"label": "Sprint", "offset": 20}, {"label": "Hauptrennen", "offset": 60},
        {"label": "Lauf 2", "offset": 90}]}]})
    for label in ("Blitz-Qualifying", "Shootout", "Sprint", "Hauptrennen", "Lauf 2"):
        line = race_weekend_paste.suggestion("R1", label, weekend, 1)
        assert line, label
        parsed = parse_round_lines(f"{line} · 05.03.2026", season="2026", today="2026-01-01", default_weekday=None,
                                   default_time="20:00")
        sessions = race_weekend_paste.expand_paste(parsed, weekend, [])["rows"][0]["sessions"]
        assert [item["session"] for item in sessions] == [label]
    # Ein eigener Name, den der Parser nicht als Lauf kennt, bekommt keinen Vorschlag.
    two_races = race_weekend.normalize_weekend({"formats": [{"from_round": 1, "sessions": [
        {"label": "Rennen", "offset": 0}, {"label": "Nachtrennen", "offset": 60}]}]})
    assert race_weekend_paste.suggestion("R1", "Nachtrennen", two_races, 1) is None


def test_a_shootout_keeps_its_name_even_if_the_template_has_another_qualifying():
    weekend = race_weekend.normalize_weekend(F2)
    parsed = parse_round_lines("R1 Shootout · 05.03.2026 18:00", season="2026", today="2026-01-01",
                               default_weekday=None, default_time="20:00")
    sessions = race_weekend_paste.expand_paste(parsed, weekend, [])["rows"][0]["sessions"]
    assert [(item["session"], item["counts"]) for item in sessions] == [("Shootout", False)]


def test_without_a_template_a_line_stays_one_round():
    parsed = parse_round_lines("R1 · 05.03.2026 · Probering\nR1 · 12.03.2026", season="2026", today="2026-01-01",
                               default_weekday=None, default_time=None)
    out = race_weekend_paste.expand_paste(parsed, None, [])
    assert [[item["session"] for item in row["sessions"]] for row in out["rows"]] == [[None], [None]]


def test_sessions_are_created_in_the_order_of_their_time():
    weekend = race_weekend.normalize_weekend({"formats": [{"sessions": [
        {"label": "Qualifying", "offset": 0}, {"label": "Hauptrennen", "offset": 75}, {"label": "Sprint", "offset": 30}]}]})
    parsed = parse_round_lines("R1 · 07.03.2026", season="2026", today="2026-01-01", default_weekday=None,
                               default_time="20:00")
    sessions = race_weekend_paste.expand_paste(parsed, weekend, [])["rows"][0]["sessions"]
    assert [(item["session"], item["time"]) for item in sessions] == [
        ("Qualifying", "20:00"), ("Sprint", "20:30"), ("Hauptrennen", "21:15")]


def test_an_offset_without_time_moves_whole_days_only():
    weekend = race_weekend.normalize_weekend({"formats": [{"sessions": [
        {"label": "Sprint", "offset": 0}, {"label": "Rennen", "offset": 24 * 60 + 30}]}]})
    parsed = parse_round_lines("R1 · 07.03.2026", season="2026", today="2026-01-01", default_weekday=None,
                               default_time=None)
    sessions = race_weekend_paste.expand_paste(parsed, weekend, [])["rows"][0]["sessions"]
    assert [(item["day"], item["time"]) for item in sessions] == [("2026-03-07", None), ("2026-03-08", None)]


# ---------------------------------------------------------------- Pole und Startplatz
def test_place_one_of_a_qualifying_gets_the_pole():
    rows = [{"participant_id": "b", "place": 2, "marks": []}, {"participant_id": "a", "place": 1, "marks": []}]
    race_weekend.mark_pole(rows)
    assert [row["marks"] for row in rows] == [[], ["pole"]]
    # Eine Marke von Hand auf Platz 2 überstimmt Platz 1 nicht - sie fällt weg (Codex Runde 2, #1930).
    marked = [{"participant_id": "a", "place": 1, "marks": []}, {"participant_id": "b", "place": 2, "marks": ["pole"]}]
    race_weekend.mark_pole(marked)
    assert [row["marks"] for row in marked] == [["pole"], []]


PEOPLE = [{"id": pid, "name": name} for pid, name in (("a", "Anna Probe"), ("b", "Bert Bolzt"), ("c", "Carl Kurve"))]


def _sheet(*rows):
    return {"rows": [{"participant_id": pid, "place": place, "marks": [], **extra} for pid, place, extra in rows]}


def _results(snapshot):
    return {row["participant_id"]: {item["round_id"]: item for item in row["results"]} for row in snapshot["rows"]}


def test_the_grid_and_the_pole_come_from_the_qualifying_of_the_same_weekend():
    rounds = _rounds(("q1", "R1", "Qualifying", False), ("r1", "R1", None, True))
    sheets = {
        "q1": _sheet(("c", 1, {"marks": ["pole"]}), ("a", 2, {}), ("b", 3, {})),
        # Anna startet nach einer Strafe von 5 - der eingetragene Startplatz bleibt.
        "r1": _sheet(("a", 1, {"grid": 5}), ("c", 2, {}), ("b", 3, {})),
    }
    rules = {"points_by_place": [25, 18, 15], "bonuses": {"pole": {"points": 1}}}
    snapshots = race_weekend.standings(rules=rules, rounds=rounds, sheets=sheets, participants=PEOPLE)
    drivers = next(snap for snap in snapshots if snap["scope"] == "drivers")
    results = _results(drivers)
    assert {pid: results[pid]["r1"].get("grid") for pid in "abc"} == {"a": 5, "b": 3, "c": 1}
    assert results["c"]["r1"]["marks"] == ["pole"]
    # Das Qualifying zählt nicht, die Pole bringt ihren Bonus am Rennen.
    assert {row["participant_id"]: row["points"] for row in drivers["rows"]} == {"a": 25, "c": 19, "b": 15}
    assert "q1" not in {snap["round_id"] for snap in snapshots}


def test_a_sprint_has_its_own_points_and_keeps_its_own_grid():
    weekend = race_weekend.normalize_weekend(F2)
    rounds = _rounds(("q1", "R1", "Blitz-Qualifying", False), ("s1", "R1", "Sprint", True),
                     ("f1", "R1", "Hauptrennen", True))
    sheets = {
        "q1": _sheet(("a", 1, {}), ("b", 2, {}), ("c", 3, {})),
        "s1": _sheet(("c", 1, {}), ("b", 2, {}), ("a", 3, {})),
        "f1": _sheet(("a", 1, {}), ("b", 2, {}), ("c", 3, {})),
    }
    snapshots = race_weekend.standings(rules={"points_by_place": [25, 18, 15]}, rounds=rounds, sheets=sheets,
                                       participants=PEOPLE, weekend=weekend)
    drivers = [snap for snap in snapshots if snap["scope"] == "drivers"][-1]
    results = _results(drivers)
    assert {pid: results[pid]["s1"]["points"] for pid in "abc"} == {"a": 7, "b": 9, "c": 12}
    assert {pid: results[pid]["s1"].get("grid") for pid in "abc"} == {"a": None, "b": None, "c": None}
    assert {pid: results[pid]["f1"].get("grid") for pid in "abc"} == {"a": 1, "b": 2, "c": 3}
    assert {row["participant_id"]: row["points"] for row in drivers["rows"]} == {"a": 32, "b": 27, "c": 27}


def test_the_reverse_standings_set_the_grid_of_a_later_format():
    weekend = race_weekend.normalize_weekend({"formats": [
        {"sessions": [{"label": "Rennen", "grid": "manual"}]},
        {"from_round": 2, "sessions": [{"label": "Sprint", "grid": "reverse_standings"},
                                       {"label": "Hauptrennen", "grid": "reverse_standings"}]}]})
    rounds = _rounds(("r1", "R1", None, True), ("s2", "R2", "Sprint", True), ("f2", "R2", "Hauptrennen", True))
    sheets = {
        "r1": _sheet(("a", 1, {}), ("b", 2, {}), ("c", 3, {})),
        "s2": _sheet(("c", 1, {}), ("b", 2, {}), ("a", 3, {})),
        "f2": _sheet(("b", 1, {"grid": 1}), ("a", 2, {}), ("c", 3, {})),
    }
    snapshots = race_weekend.standings(rules={"points_by_place": [25, 18, 15]}, rounds=rounds, sheets=sheets,
                                       participants=PEOPLE, weekend=weekend)
    results = _results([snap for snap in snapshots if snap["scope"] == "drivers"][-1])
    # Nach R1: Anna vor Bert vor Carl - umgedreht startet Carl vorn. Ein eingetragener Startplatz bleibt.
    assert {pid: results[pid]["s2"]["grid"] for pid in "abc"} == {"a": 3, "b": 2, "c": 1}
    assert {pid: results[pid]["f2"]["grid"] for pid in "abc"} == {"a": 3, "b": 1, "c": 1}


def test_existing_rounds_without_sessions_stay_as_they_are():
    rounds = _rounds(("r1", "R1", None, True), ("r2", "R2", None, True))
    sheets = {"r1": _sheet(("a", 1, {}), ("b", 2, {})), "r2": _sheet(("b", 1, {}), ("a", 2, {}))}
    rules = {"points_by_place": [25, 18]}
    from services.series_standings import compute_standings

    assert race_weekend.standings(rules=rules, rounds=rounds, sheets=sheets, participants=PEOPLE) == \
        compute_standings(rules=rules, rounds=rounds, sheets=sheets, participants=PEOPLE)


# ---------------------------------------------------------------- Prüfer #1930
def test_a_line_without_code_keeps_its_sessions_in_one_round():
    weekend = race_weekend.normalize_weekend({"formats": [{"sessions": [
        {"label": "Qualifying", "offset": 0}, {"label": "Sprint", "offset": 30}, {"label": "Rennen", "offset": 90}]}]})
    parsed = parse_round_lines("05.03.2026 · Probering\nR2 · 12.03.2026", season="2026", today="2026-01-01",
                               default_weekday=None, default_time="20:00")
    out = race_weekend_paste.expand_paste(parsed, weekend, [])
    assert [(row["code"], row["weekend"]) for row in out["rows"]] == [("R1", 1), ("R2", 2)]
    # So, wie die Route speichert: je Lauf ein Termin mit dem Kürzel der Zeile.
    saved = [{"id": f"t{index}", "code": row["code"], "session": item["session"], "order": index}
             for index, (row, item) in enumerate(((row, item) for row in out["rows"] for item in row["sessions"]),
                                                 start=1)]
    assert [(group["number"], len(group["rounds"])) for group in race_weekend.weekend_groups(saved)] == [(1, 3), (2, 3)]
    taken = [{"id": "x", "code": "R1", "session": "Rennen", "order": 1}]
    again = race_weekend_paste.expand_paste(parse_round_lines(
        "19.03.2026", season="2026", today="2026-01-01", default_weekday=None, default_time="20:00"), weekend, taken)
    assert again["rows"][0]["code"] == "R2"


def test_a_negative_offset_without_time_stays_on_the_day():
    weekend = race_weekend.normalize_weekend({"formats": [{"sessions": [
        {"label": "Qualifying", "offset": -30}, {"label": "Rennen", "offset": 0}, {"label": "Sprint", "offset": -1440}]}]})
    parsed = parse_round_lines("R1 · 07.03.2026", season="2026", today="2026-01-01", default_weekday=None,
                               default_time=None)
    sessions = race_weekend_paste.expand_paste(parsed, weekend, [])["rows"][0]["sessions"]
    assert {item["session"]: item["day"] for item in sessions} == {
        "Sprint": "2026-03-06", "Qualifying": "2026-03-07", "Rennen": "2026-03-07"}


def test_the_race_takes_its_grid_from_the_qualifying_and_the_sprint_from_the_shootout():
    weekend = race_weekend.normalize_weekend({"formats": [{"sessions": [
        {"label": "Qualifying", "offset": 0}, {"label": "Shootout", "offset": 1440},
        {"label": "Sprint", "offset": 1500, "points": [8, 7, 6], "grid": "qualifying"},
        {"label": "Rennen", "offset": 2880, "grid": "qualifying"}]}]})
    rounds = _rounds(("q", "R1", "Qualifying", False), ("so", "R1", "Shootout", False), ("s", "R1", "Sprint", True),
                     ("r", "R1", "Rennen", True))
    sheets = {"q": _sheet(("a", 1, {"marks": ["pole"]}), ("b", 2, {}), ("c", 3, {})),
              "so": _sheet(("c", 1, {}), ("b", 2, {}), ("a", 3, {})),
              "s": _sheet(("a", 1, {}), ("b", 2, {}), ("c", 3, {})),
              "r": _sheet(("b", 1, {}), ("a", 2, {}), ("c", 3, {}))}
    snapshots = race_weekend.standings(rules={"points_by_place": [25, 18, 15], "bonuses": {"pole": {"points": 3}}},
                                       rounds=rounds, sheets=sheets, participants=PEOPLE, weekend=weekend)
    results = _results([snap for snap in snapshots if snap["scope"] == "drivers"][-1])
    assert {pid: results[pid]["r"]["grid"] for pid in "abc"} == {"a": 1, "b": 2, "c": 3}
    assert {pid: results[pid]["s"]["grid"] for pid in "abc"} == {"c": 1, "b": 2, "a": 3}
    # Die Pole kommt aus dem Qualifying fürs Rennen und zählt am Rennen - nicht am Sprint.
    assert [pid for pid in "abc" if "pole" in results[pid]["r"]["marks"]] == ["a"]
    assert [pid for pid in "abc" if "pole" in results[pid]["s"]["marks"]] == []


def test_a_disqualified_first_place_does_not_get_the_pole():
    rows = [{"participant_id": "a", "place": 1, "marks": ["dsq", "pole"]}, {"participant_id": "b", "place": 2, "marks": []},
            {"participant_id": "c", "place": 3, "marks": []}]
    race_weekend.mark_pole(rows)
    assert [row["marks"] for row in rows] == [["dsq"], ["pole"], []]
    assert race_weekend.pole_holder([{"participant_id": "a", "place": 1, "marks": ["dsq"]},
                                     {"participant_id": "b", "place": 2, "marks": []}]) == "b"
    rounds = _rounds(("q", "R1", "Qualifying", False), ("r", "R1", "Rennen", True))
    sheets = {"q": _sheet(("a", 1, {"marks": ["dsq"]}), ("b", 2, {})), "r": _sheet(("b", 1, {}), ("a", 2, {}))}
    snapshots = race_weekend.standings(rules={"points_by_place": [25, 18], "bonuses": {"pole": {"points": 3}}},
                                       rounds=rounds, sheets=sheets, participants=PEOPLE)
    results = _results([snap for snap in snapshots if snap["scope"] == "drivers"][-1])
    assert [pid for pid in "ab" if "pole" in results[pid]["r"]["marks"]] == ["b"]
    assert results["b"]["r"]["points"] == 28


def test_a_manual_pole_mark_on_another_row_does_not_overrule_the_first_valid_place():
    # Codex Runde 2 (#1930): Die Pole hat der erste gültige Platz des Haupt-Qualifyings - überall dieselbe Regel.
    rows = [{"index": 0, "participant_id": "a", "place": 1, "marks": []},
            {"index": 1, "participant_id": "b", "place": 2, "marks": ["pole"]},
            {"index": 2, "participant_id": "c", "place": 3, "marks": []}]
    assert race_weekend.pole_holder(rows) == "a"
    # Die Marke auf Platz 2 fällt weg - mit Hinweis an ihrer Zeile.
    assert race_weekend.mark_pole(rows) == [{"code": "pole_moved", "message": "Pole hat Platz 1 – Marke entfernt",
                                             "rows": [1]}]
    assert [row["marks"] for row in rows] == [["pole"], [], []]
    assert race_weekend.mark_pole(rows) == []
    # Die Pole am Rennen: eine Marke auf einer anderen Zeile zählt nicht, die Pole (samt Bonus) hat Platz 1 des
    # Qualifyings - auch wenn das Blatt des Qualifyings eine Marke auf Platz 2 trägt.
    rounds = _rounds(("q", "R1", "Qualifying", False), ("r", "R1", "Rennen", True))
    sheets = {"q": _sheet(("a", 1, {}), ("b", 2, {"marks": ["pole"]})),
              "r": _sheet(("b", 1, {"marks": ["pole"]}), ("a", 2, {}))}
    snapshots = race_weekend.standings(rules={"points_by_place": [25, 18], "bonuses": {"pole": {"points": 3}}},
                                       rounds=rounds, sheets=sheets, participants=PEOPLE)
    results = _results([snap for snap in snapshots if snap["scope"] == "drivers"][-1])
    assert [pid for pid in "ab" if "pole" in results[pid]["r"]["marks"]] == ["a"]
    assert (results["a"]["r"]["points"], results["b"]["r"]["points"]) == (21, 25)


def test_without_a_qualifying_a_manual_pole_mark_in_the_race_stays():
    # Bestand #1927: Ein Rennen ohne Qualifying (etwa aus F1-Altdaten) behält die Pole-Marke von Hand - in einer Saison
    # ohne Läufe wie in einer Runde mit Läufen, aber ohne Qualifying.
    rules = {"points_by_place": [25, 18], "bonuses": {"pole": {"points": 3}}}
    for rounds in (_rounds(("r", "R1", None, True)), _rounds(("s", "R1", "Sprint", True), ("r", "R1", "Rennen", True))):
        sheets = {rnd["id"]: _sheet(("a", 1, {}), ("b", 2, {"marks": ["pole"]})) for rnd in rounds}
        snapshots = race_weekend.standings(rules=rules, rounds=rounds, sheets=sheets, participants=PEOPLE)
        results = _results([snap for snap in snapshots if snap["scope"] == "drivers"][-1])
        assert [pid for pid in "ab" if "pole" in results[pid]["r"]["marks"]] == ["b"]
        assert results["b"]["r"]["points"] == 21
    quali = [{"index": 0, "participant_id": "a", "place": 1, "marks": []}]
    race = {"id": "r", "code": "R1"}
    assert race_weekend.quali_pole({}, _rounds(("r", "R1", None, True)), race, {"q": quali}) is None


NO_VALID_PLACE = "Kein gültiger Platz im Qualifying – Pole-Marke entfernt"


def test_a_qualifying_without_a_valid_place_has_no_pole_and_says_so():
    # Codex Runde 3 (#1930): Alle Plätze ungültig (DNS/DSQ) - keine Pole; eine Marke fällt mit Hinweis weg, nicht still.
    rows = [{"index": 0, "participant_id": "a", "place": 1, "marks": ["dsq", "pole"]},
            {"index": 1, "participant_id": "b", "place": 2, "marks": ["dns"]}]
    assert race_weekend.pole_holder(rows) is None
    assert race_weekend.mark_pole(rows) == [{"code": "pole_moved", "message": NO_VALID_PLACE, "rows": [0]}]
    assert [row["marks"] for row in rows] == [["dsq"], ["dns"]]
    assert race_weekend.mark_pole(rows) == []


def test_a_race_with_a_qualifying_without_a_valid_place_gets_no_pole():
    # Codex Runde 3 (#1930): Die Pole-Marke von Hand bleibt nur im Rennen ohne Qualifying. Gibt es ein Qualifying, aber
    # keinen gültigen Platz, hat niemand die Pole - die Marke im Rennen fällt weg und bringt keinen Bonus.
    rounds = _rounds(("q", "R1", "Qualifying", False), ("r", "R1", "Rennen", True))
    sheets = {"q": _sheet(("a", 1, {"marks": ["dns"]}), ("b", 2, {"marks": ["dsq"]})),
              "r": _sheet(("a", 1, {}), ("b", 2, {"marks": ["pole"]}))}
    snapshots = race_weekend.standings(rules={"points_by_place": [25, 18], "bonuses": {"pole": {"points": 3}}},
                                       rounds=rounds, sheets=sheets, participants=PEOPLE)
    results = _results([snap for snap in snapshots if snap["scope"] == "drivers"][-1])
    assert [pid for pid in "ab" if "pole" in results[pid]["r"]["marks"]] == []
    assert results["b"]["r"]["points"] == 18
    # Im Blatt des Rennens: die Marke fällt beim Prüfen weg, mit Hinweis an ihrer Zeile.
    pole = race_weekend.quali_pole({}, rounds, rounds[1], sheets)
    assert pole is not None and pole[0] is None
    race = [{"index": 0, "participant_id": "a", "place": 1, "marks": []},
            {"index": 1, "participant_id": "b", "place": 2, "marks": ["pole"]}]
    assert race_weekend.clear_race_pole(race, pole) == [{"code": "pole_moved", "message": NO_VALID_PLACE, "rows": [1]}]
    assert [row["marks"] for row in race] == [[], []]


def _drivers(snapshots):
    return {row["participant_id"]: row for row in [snap for snap in snapshots if snap["scope"] == "drivers"][-1]["rows"]}


def test_activity_points_and_rounds_played_count_once_per_round():
    weekend = race_weekend.normalize_weekend({"formats": [{"sessions": [
        {"label": "Blitz-Qualifying", "points": [2]}, {"label": "Sprint", "grid": "manual"}, {"label": "Hauptrennen"}]}]})
    rounds = _rounds(("q", "R1", "Blitz-Qualifying", True), ("s", "R1", "Sprint", True), ("f", "R1", "Hauptrennen", True),
                     ("q2", "R2", "Blitz-Qualifying", True), ("s2", "R2", "Sprint", True))
    sheets = {rid: _sheet(("a", 1, {}), ("b", 2, {})) for rid in ("q", "s", "f", "q2", "s2")}
    snapshots = race_weekend.standings(rules={"points_by_place": [25, 18], "activity_points": {"points": 1, "from_round": 2}},
                                       rounds=rounds, sheets=sheets, participants=PEOPLE, weekend=weekend)
    rows = _drivers(snapshots)
    # Runde 1: 2 + 25 + 25, Runde 2: 2 + 25, dazu ein Aktivitätspunkt für Runde 2 (nicht je Lauf).
    assert (rows["a"]["points"], rows["a"]["activity_points"], rows["a"]["rounds_played"]) == (80, 1, 2)


def test_a_drop_removes_a_whole_round_never_a_single_session():
    weekend = race_weekend.normalize_weekend({"formats": [{"sessions": [{"label": "Qualifying", "points": [2]},
                                                                        {"label": "Rennen"}]}]})
    rounds = _rounds(("q1", "R1", "Qualifying", True), ("r1", "R1", "Rennen", True),
                     ("q2", "R2", "Qualifying", True), ("r2", "R2", "Rennen", True))
    sheets = {"q1": _sheet(("a", 1, {}), ("b", 2, {})), "r1": _sheet(("b", 1, {}), ("a", 2, {})),
              "q2": _sheet(("b", 1, {}), ("a", 2, {})), "r2": _sheet(("a", 1, {}), ("b", 2, {}))}
    snapshots = race_weekend.standings(rules={"points_by_place": [25, 18], "count_mode": "drop_n", "count_n": 1},
                                       rounds=rounds, sheets=sheets, participants=PEOPLE, weekend=weekend)
    rows = _drivers(snapshots)
    # Anna: R1 = 2 + 18 = 20, R2 = 0 + 25 = 25 - gestrichen wird die ganze Runde 1, nicht das Qualifying.
    assert (rows["a"]["points"], rows["a"]["dropped_round_ids"], rows["a"]["counted_round_ids"]) == (
        25, ["q1", "r1"], ["q2", "r2"])
    assert (rows["b"]["points"], rows["b"]["dropped_round_ids"]) == (25, ["q2", "r2"])


def test_old_seasons_with_the_same_code_twice_stay_separate_rounds():
    rounds = [{"id": "a", "code": "R1", "order": 1}, {"id": "b", "code": "R1", "order": 2},
              {"id": "c", "code": "R2", "order": 3}]
    assert [len(group["rounds"]) for group in race_weekend.weekend_groups(rounds)] == [1, 1, 1]
    assert [item["weekend"] for item in race_weekend.annotate([dict(item) for item in rounds])] == [1, 2, 3]
    # Mit einem Lauf oder einem Ablauf je Runde sind gleiche Kürzel eine Runde.
    assert [len(group["rounds"]) for group in race_weekend.weekend_groups(rounds, {"formats": [{"sessions": []}]})] == [
        2, 1]
    with_session = [{**rounds[0], "session": "Qualifying"}, *rounds[1:]]
    assert [len(group["rounds"]) for group in race_weekend.weekend_groups(with_session)] == [2, 1]


def test_the_reverse_grid_after_the_previous_session_follows_the_sprint():
    weekend = race_weekend.normalize_weekend({"formats": [
        {"sessions": [{"label": "Rennen", "grid": "manual"}]},
        {"from_round": 2, "sessions": [
            {"label": "Sprint", "grid": "reverse_standings_before_round"},
            {"label": "Hauptrennen", "offset": 60, "grid": "reverse_standings_after_previous_session"}]}]})
    rounds = _rounds(("r1", "R1", None, True), ("s2", "R2", "Sprint", True), ("f2", "R2", "Hauptrennen", True))
    sheets = {"r1": _sheet(("a", 1, {}), ("b", 2, {}), ("c", 3, {})),
              "s2": _sheet(("c", 1, {}), ("b", 2, {}), ("a", 3, {})),
              "f2": _sheet(("a", 1, {}), ("b", 2, {}), ("c", 3, {}))}
    snapshots = race_weekend.standings(rules={"points_by_place": [25, 18, 15]}, rounds=rounds, sheets=sheets,
                                       participants=PEOPLE, weekend=weekend)
    results = _results([snap for snap in snapshots if snap["scope"] == "drivers"][-1])
    # Sprint: Stand nach R1 (a, b, c) umgedreht. Hauptrennen: Stand nach dem Sprint (a 40, c 40, b 36) umgedreht.
    assert {pid: results[pid]["s2"]["grid"] for pid in "abc"} == {"a": 3, "b": 2, "c": 1}
    order_after_sprint = [row["participant_id"] for row in next(
        snap for snap in snapshots if snap["scope"] == "drivers" and snap["round_id"] == "s2")["rows"]]
    assert {pid: results[pid]["f2"]["grid"] for pid in "abc"} == {
        pid: len(order_after_sprint) - order_after_sprint.index(pid) for pid in "abc"}


def test_counts_follow_the_template_unless_set_by_hand():
    weekend = race_weekend.normalize_weekend({"formats": [{"sessions": [{"label": "Qualifying", "points": [2]},
                                                                        {"label": "Rennen"}]}]})
    rounds = [{"id": "q", "code": "R1", "session": "Qualifying", "order": 1, "counts": False, "counts_manual": False},
              {"id": "q2", "code": "R2", "session": "Qualifying", "order": 2, "counts": False, "counts_manual": True},
              {"id": "old", "code": "R3", "session": "Qualifying", "order": 3, "counts": False}]
    assert race_weekend.counts_updates(rounds, weekend) == {"q": True}
    assert race_weekend.counts_updates(rounds, None) == {}
