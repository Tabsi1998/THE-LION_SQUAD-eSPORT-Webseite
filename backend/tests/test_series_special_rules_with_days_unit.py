"""Sonderregeln einer Rennliga (#1960) zusammen mit Turniertagen (#1961) - ohne Datenbank, nur erfundene Namen.

- Sonderbonus und Anpassung zählen je genau einmal und stehen getrennt an der Zeile (``bonus_points``,
  ``adjustment_points``). In der aktuellen Besetzung bringt ein Fahrer beides einmal ins Team; je Rennen zählt das Team
  wie bisher nur die Rennpunkte.
- Der Vorrang ``top_n`` entscheidet auch in der Teamwertung nach aktueller Besetzung.
"""
import pytest

from services.scoring_rules import normalize_rules
from services.series_standings import compute_standings

SCHEME = [10, 6, 4, 3, 2, 1]
PEOPLE = [
    {"id": "anna", "name": "Anna Probe", "default_team": "Probe Löwen"},
    {"id": "bert", "name": "Bert Beispiel", "default_team": "Probe Löwen"},
    {"id": "cora", "name": "Cora Test", "default_team": "Fremd Rot"},
    {"id": "dino", "name": "Dino Dummy", "default_team": "Fremd Rot"},
]
ROUNDS = [{"id": "r1", "order": 1, "status": "scored", "counts": True, "club_day": "2026-03-01"}]


def _rules(mode):
    return normalize_rules({"points_by_place": SCHEME, "tiebreakers": ["top_n", "countback"], "tiebreak_top_n": 2,
                            "custom_bonuses": [{"label": "Bingo", "points": 3}],
                            "team_scoring": {"enabled": True, "mode": mode}})


def _sheet(*order, bonus=None):
    teams = {person["id"]: person["default_team"] for person in PEOPLE}  # wie beim Eintragen vorbelegt
    return {"r1": {"rows": [{"participant_id": pid, "place": place, "marks": [], "team": teams[pid],
                             **({"bonus_keys": ["bingo"]} if pid == bonus else {})}
                            for place, pid in enumerate(order, start=1)]}}


def _adjust(adj_id, points, *, pid=None, team=None):
    return {"id": adj_id, "kind": "team" if team else "participant", "participant_id": pid, "team": team,
            "points": points, "reason": "Regel", "day": "2026-03-01", "round_id": "r1"}


def _scope(snapshots, scope):
    return {row.get("participant_id") or row.get("team"): row
            for row in [snap for snap in snapshots if snap["scope"] == scope][-1]["rows"]}


@pytest.mark.parametrize("mode, teams", [("current_lineup", {"Probe Löwen": 10, "Fremd Rot": 9}),
                                         ("per_race", {"Probe Löwen": 12, "Fremd Rot": 9})])
def test_a_special_bonus_and_an_adjustment_each_count_once_and_apart(mode, teams):
    snaps = compute_standings(rules=_rules(mode), rounds=ROUNDS, sheets=_sheet("anna", "cora", "bert", "dino", bonus="anna"),
                              participants=PEOPLE,
                              adjustments=[_adjust("a1", -5, pid="anna"), _adjust("t1", -2, team="Probe Löwen")])
    anna = _scope(snaps, "drivers")["anna"]
    # 10 für Platz 1, +3 Bingo, −5 Anpassung - je genau einmal, getrennt ausgewiesen.
    assert (anna["points"], anna["bonus_points"], anna["adjustment_points"]) == (8, 3, -5)
    assert anna["results"][0]["points"] == 10 and anna["results"][0]["bonus"] == 3
    rows = _scope(snaps, "teams")
    # Aktuelle Besetzung: anna 8 + bert 4 − 2 (Team) = 10. Je Rennen: 10 + 4 − 2 = 12 (Bonus und Fahrer-Abzug nicht).
    assert {team: row["points"] for team, row in rows.items()} == teams
    assert [item["points"] for item in rows["Probe Löwen"]["round_points"]] == [14]
    assert rows["Probe Löwen"]["adjustment_points"] == -2


def test_top_n_breaks_a_tie_in_the_current_lineup():
    # Löwen fahren auf 1 und 2 (16), Rot auf 3 und 4 (7) plus 9 als Team-Anpassung: gleich viele Punkte, Top 2 entscheidet.
    snaps = compute_standings(rules=_rules("current_lineup"), rounds=ROUNDS, sheets=_sheet("anna", "bert", "cora", "dino"),
                              participants=PEOPLE, adjustments=[_adjust("t1", 9, team="Fremd Rot")])
    rows = sorted(_scope(snaps, "teams").values(), key=lambda row: row["rank"])
    assert [(row["team"], row["rank"], row["points"], row.get("tiebreak")) for row in rows] == [
        ("Probe Löwen", 1, 16, None), ("Fremd Rot", 2, 16, "top_n")]
