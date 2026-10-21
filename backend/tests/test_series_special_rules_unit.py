"""Sonderregeln einer Rennliga (#1960) im Rechenkern - ohne Datenbank, nur erfundene Namen.

- **Anpassungen:** ±Punkte je Saison mit Grund und Datum, für Fahrer und Teams. Zwei −5-Abzüge ergeben genau die
  offizielle Tabelle; eine Anpassung zählt ab ihrem Termin (sonst ab dem letzten Stand an ihrem Tag).
- **Teamwertung bei wechselnder Besetzung:** „je Rennen für das gefahrene Team“ (Vorgabe) oder „aktuelle Besetzung“ -
  ein Fahrer wechselt ab Runde 12 das Team, ein früherer Teamkollege hat die Liga verlassen.
- **Teamwertung laut Veranstalter:** ist sie da, gilt sie für Platz und Punkte; die eigene Rechnung bleibt als Vergleich.
"""
import pytest

from services import series_adjustments
from services.scoring_rules import normalize_rules
from services.series_standings import compute_standings

SCHEME = [10, 6, 4, 3, 2, 1]
PEOPLE = [
    {"id": "anna", "name": "Anna Probe", "link": "member", "default_team": "Probe Löwen"},
    {"id": "bert", "name": "Bert Beispiel", "link": "external", "default_team": "Probe Löwen"},
    {"id": "cora", "name": "Cora Test", "link": "external", "default_team": "Fremd Rot"},
    {"id": "dino", "name": "Dino Dummy", "link": "external", "default_team": "Fremd Rot"},
    {"id": "emil", "name": "Emil Erfunden", "link": "external", "default_team": "Fremd Rot"},
]


def _rules(**overrides):
    return normalize_rules({"points_by_place": SCHEME, "tiebreakers": ["countback"], **overrides})


def _round(number, day=None):
    return {"id": f"r{number}", "order": number, "status": "scored", "counts": True,
            "club_day": day or f"2026-03-{number:02d}"}


def _sheet(*order, teams=None, **extra):
    """``"anna", "bert"`` → Plätze 1, 2 …; ``teams`` = Team je Zeile (sonst das Standard-Team)."""
    teams = teams or {}
    return {"rows": [{"participant_id": pid, "place": place, "marks": [], "team": teams.get(pid)}
                     for place, pid in enumerate(order, start=1)], **extra}


def _latest(snapshots, scope):
    return [snap for snap in snapshots if snap["scope"] == scope][-1]["rows"]


def _at(snapshots, scope, round_id):
    return next(snap for snap in snapshots if snap["scope"] == scope and snap["round_id"] == round_id)["rows"]


def _adjust(adj_id, points, reason, *, pid=None, team=None, day="2026-03-10", round_id=None):
    return {"id": adj_id, "kind": "team" if team else "participant", "participant_id": pid, "team": team,
            "points": points, "reason": reason, "day": day, "round_id": round_id}


# ---------------------------------------------------------------- Anpassungen
def test_two_minus_five_adjustments_match_the_official_table():
    rounds = [_round(1), _round(2), _round(3)]
    # Rennsummen: anna 26, bert 20, cora 14. Offiziell (nach Abzügen): anna 21, bert 20, cora 9 - wie im Abgleich lagen
    # zwei Fahrer genau 5 Punkte unter ihrer Rennsumme.
    sheets = {"r1": _sheet("anna", "bert", "cora"), "r2": _sheet("anna", "cora", "bert"),
              "r3": _sheet("bert", "anna", "cora", official_totals={"anna": 21, "bert": 20, "cora": 9})}
    adjustments = [_adjust("a1", -5, "Nichtteilnahme nach Anmeldung", pid="anna", round_id="r2"),
                   _adjust("a2", -5, "Video fehlt", pid="cora", day="2026-03-03")]
    without = _latest(compute_standings(rules=_rules(), rounds=rounds, sheets=sheets, participants=PEOPLE), "drivers")
    assert [(row["participant_id"], row["deviation"]) for row in without] == [("anna", -5), ("bert", 0), ("cora", -5)]

    rows = _latest(compute_standings(rules=_rules(), rounds=rounds, sheets=sheets, participants=PEOPLE,
                                     adjustments=adjustments), "drivers")
    assert [(row["participant_id"], row["rank"], row["points"], row["computed_points"], row["deviation"])
            for row in rows] == [("anna", 1, 21, 21, 0), ("bert", 2, 20, 20, 0), ("cora", 3, 9, 9, 0)]
    assert rows[0]["adjustment_points"] == -5
    assert rows[0]["adjustments"] == [{"id": "a1", "points": -5, "reason": "Nichtteilnahme nach Anmeldung",
                                       "day": "2026-03-10", "round_id": "r2"}]
    assert rows[1]["adjustment_points"] == 0 and rows[1]["adjustments"] == []


def test_an_adjustment_counts_from_its_round_or_from_the_last_standing_on_its_day():
    rounds = [_round(1), _round(2), _round(3)]
    sheets = {key: _sheet("anna", "bert") for key in ("r1", "r2", "r3")}
    adjustments = [_adjust("a1", -5, "Verspätete Abmeldung", pid="anna", round_id="r2"),
                   # Ohne Termin: ab dem Stand, der an diesem Tag galt (nach r2 am 02.03., vor r3 am 03.03.).
                   _adjust("a2", 3, "Nachträglich gewertet", pid="bert", day="2026-03-02")]
    snaps = compute_standings(rules=_rules(), rounds=rounds, sheets=sheets, participants=PEOPLE,
                              adjustments=adjustments)
    points = {key: {row["participant_id"]: row["points"] for row in _at(snaps, "drivers", key)}
              for key in ("r1", "r2", "r3")}
    assert points == {"r1": {"anna": 10, "bert": 6}, "r2": {"anna": 15, "bert": 15},
                      "r3": {"anna": 25, "bert": 21}}
    # Vor dem ersten Stand datiert: zählt ab dem ersten.
    early = compute_standings(rules=_rules(), rounds=rounds, sheets=sheets, participants=PEOPLE,
                              adjustments=[_adjust("a3", -1, "Vor Saisonstart", pid="bert", day="2026-01-01")])
    assert {row["participant_id"]: row["points"] for row in _at(early, "drivers", "r1")} == {"anna": 10, "bert": 5}


def test_a_participant_with_only_an_adjustment_stands_in_the_table():
    rounds = [_round(1)]
    sheets = {"r1": _sheet("anna")}
    rows = _latest(compute_standings(rules=_rules(), rounds=rounds, sheets=sheets, participants=PEOPLE,
                                     adjustments=[_adjust("a1", -5, "Nicht erschienen", pid="dino")]), "drivers")
    assert [(row["participant_id"], row["points"], row["rounds_played"]) for row in rows] == [
        ("anna", 10, 1), ("dino", -5, 0)]


def test_a_team_adjustment_counts_in_the_team_standings_only():
    rounds = [_round(1)]
    sheets = {"r1": _sheet("anna", "cora", "bert", "dino")}
    snaps = compute_standings(rules=_rules(team_scoring={"enabled": True}), rounds=rounds, sheets=sheets,
                              participants=PEOPLE,
                              adjustments=[_adjust("t1", -6, "Teamregel verletzt", team="probe löwen")])
    teams = _latest(snaps, "teams")
    # Löwen 10 + 4 - 6 = 8 liegt jetzt hinter Rot (6 + 3); die Schreibweise des Teams ist egal.
    assert [(row["team"], row["points"], row["adjustment_points"]) for row in teams] == [
        ("Fremd Rot", 9, 0), ("Probe Löwen", 8, -6)]
    assert teams[1]["adjustments"][0]["reason"] == "Teamregel verletzt"
    assert {row["participant_id"]: row["points"] for row in _latest(snaps, "drivers")}["anna"] == 10


def test_adjustments_are_checked_before_they_are_stored():
    clean = series_adjustments.normalize({"kind": "participant", "participant_id": "anna", "points": "-5",
                                          "reason": "  Video   fehlt ", "day": "2026-03-04"})
    assert (clean["points"], clean["reason"], clean["team"], clean["round_id"]) == (-5, "Video fehlt", None, None)
    team = series_adjustments.normalize({"kind": "team", "team": " Probe  Löwen ", "points": 2.5,
                                         "reason": "Korrektur", "day": "2026-03-04"})
    assert (team["team"], team["points"], team["participant_id"]) == ("Probe Löwen", 2.5, None)
    for broken in ({"points": 0}, {"points": 5000}, {"reason": " "}, {"day": "04.03.2026"},
                   {"participant_id": None}, {"kind": "egal"}):
        raw = {"kind": "participant", "participant_id": "anna", "points": -5, "reason": "Grund",
               "day": "2026-03-04", **broken}
        with pytest.raises(ValueError):
            series_adjustments.normalize(raw)


# ---------------------------------------------------------------- Teamwertung bei wechselnder Besetzung
def _team_season():
    """13 Runden: bis R11 fahren anna und bert für Probe Löwen, cora und dino für Fremd Rot. bert verlässt die Liga;
    ab R12 fährt cora für Probe Löwen und emil (neu) für Fremd Rot."""
    rounds = [_round(number) for number in range(1, 14)]
    sheets = {}
    for number in range(1, 12):
        sheets[f"r{number}"] = _sheet("anna", "cora", "bert", "dino")
    for number in (12, 13):
        sheets[f"r{number}"] = _sheet("cora", "anna", "emil", "dino", teams={"cora": "Probe Löwen"})
    return rounds, sheets


def test_team_points_per_race_count_for_the_team_driven_for():
    rounds, sheets = _team_season()
    teams = _latest(compute_standings(rules=_rules(team_scoring={"enabled": True}), rounds=rounds, sheets=sheets,
                                      participants=PEOPLE), "teams")
    # Löwen: anna 11×10 + 2×6 = 122, bert 11×4 = 44, cora 2×10 = 20 → 186. Rot: cora 11×6 = 66, dino 11×3 + 2×3 = 39,
    # emil 2×4 = 8 → 113.
    assert [(row["team"], row["points"]) for row in teams] == [("Probe Löwen", 186), ("Fremd Rot", 113)]


def test_team_points_with_the_current_lineup_move_with_the_driver():
    rounds, sheets = _team_season()
    rules = _rules(team_scoring={"enabled": True, "mode": "current_lineup"})
    snaps = compute_standings(rules=rules, rounds=rounds, sheets=sheets, participants=PEOPLE)
    teams = _latest(snaps, "teams")
    # Jetzt im Team: anna und cora (alle Saisonpunkte: 122 + 86) - bert hat die Liga verlassen; Rot: dino und emil.
    assert [(row["team"], row["points"], row["driver_ids"]) for row in teams] == [
        ("Probe Löwen", 208, ["anna", "cora"]), ("Fremd Rot", 47, ["dino", "emil"])]
    # Vor dem Wechsel gilt die Besetzung von damals.
    assert [(row["team"], row["points"]) for row in _at(snaps, "teams", "r11")] == [
        ("Probe Löwen", 154), ("Fremd Rot", 99)]
    # Wer ein Rennen auslässt, bleibt im Team, solange niemand seinen Platz übernimmt.
    sheets["r13"] = _sheet("cora", "emil", "dino", teams={"cora": "Probe Löwen"})
    teams = _latest(compute_standings(rules=rules, rounds=rounds, sheets=sheets, participants=PEOPLE), "teams")
    assert [(row["team"], row["driver_ids"]) for row in teams] == [
        ("Probe Löwen", ["anna", "cora"]), ("Fremd Rot", ["dino", "emil"])]


def test_the_team_mode_is_a_season_setting_with_per_race_as_default():
    assert normalize_rules({})["team_scoring"]["mode"] == "per_race"
    assert normalize_rules({"team_scoring": {"mode": "current_lineup"}})["team_scoring"]["mode"] == "current_lineup"
    with pytest.raises(ValueError):
        normalize_rules({"team_scoring": {"mode": "egal"}})


# ---------------------------------------------------------------- Teamwertung laut Veranstalter
def test_the_official_team_standings_decide_place_and_points():
    rounds = [_round(1), _round(2)]
    sheets = {"r1": _sheet("anna", "cora", "bert", "dino"),
              "r2": _sheet("cora", "anna", "dino", "bert",
                           official_team_totals={"Fremd Rot": 30, "Probe Löwen": 24, "Fremd Blau": 3})}
    adjustments = [_adjust("t1", -2, "Korrektur laut Veranstalter", team="Probe Löwen")]
    rows = _latest(compute_standings(rules=_rules(team_scoring={"enabled": True}), rounds=rounds, sheets=sheets,
                                     participants=PEOPLE, adjustments=adjustments), "teams")
    # Eigene Rechnung: Löwen 10 + 4 + 6 + 3 - 2 = 21, Rot 6 + 3 + 10 + 4 = 23 - laut Veranstalter umgekehrt.
    assert [(row["team"], row["rank"], row["points"], row["computed_points"], row["deviation"]) for row in rows] == [
        ("Fremd Rot", 1, 30, 23, 7), ("Probe Löwen", 2, 24, 21, 3), ("Fremd Blau", 3, 3, 0, 3)]
