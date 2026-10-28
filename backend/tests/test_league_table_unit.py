"""Liga P2 (docs/LIGA.md, #1625): die Tabelle rechnet mit den Punkten und der Gleichstands-Reihenfolge der Season
(``scoring_rules``); ohne Feld exakt wie bisher (3/1/0, Punkte → Siege → Differenz). Nur erfundene Namen.
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.competition_standings import round_robin_standings, table_rules  # noqa: E402


# ---------------------------------------------------------------- Tabelle mit eigenen Punkten

def duel(match_id, round_number, a, b, score_a, score_b):
    winner = a if score_a > score_b else b if score_b > score_a else None
    return {"id": match_id, "round": round_number, "status": "completed",
            "slots": [{"slot": 1, "registration_id": a}, {"slot": 2, "registration_id": b}],
            "results": [{"registration_id": a, "score": score_a, "outcome": "winner" if winner == a else None},
                        {"registration_id": b, "score": score_b, "outcome": "winner" if winner == b else None}]}


REGS = [{"id": key, "display_name": key.upper()} for key in ("a", "b", "c")]
MATCHES = [duel("m1", 1, "a", "b", 2, 0), duel("m2", 2, "b", "c", 1, 1), duel("m3", 3, "c", "a", 2, 1)]


def test_without_scoring_rules_the_table_is_exactly_as_before():
    rows = {row["registration_id"]: row for row in round_robin_standings(MATCHES, REGS)}
    assert (rows["a"]["points"], rows["b"]["points"], rows["c"]["points"]) == (3, 1, 4)
    assert rows["c"]["rank"] == 1 and rows["a"]["rank"] == 2
    assert table_rules({}) is None and table_rules({"scoring_rules": "kaputt"}) is None


def test_own_points_and_tiebreak_order_from_the_season():
    rules = table_rules({"scoring_rules": {"match_points": {"win": 3, "draw": 0, "loss": 0}}})
    rows = {row["registration_id"]: row for row in round_robin_standings(MATCHES, REGS, rules)}
    assert (rows["a"]["points"], rows["b"]["points"], rows["c"]["points"]) == (3, 0, 3)
    # Gleichstand a/c bei 3 Punkten: Vorgabe score_diff (a +1, c +1), dann score_for (a 3, c 3) - geteilter Platz 1.
    assert rows["a"]["rank"] == rows["c"]["rank"] == 1

    by_wins_first = table_rules({"scoring_rules": {"match_points": {"win": 2, "draw": 1, "loss": 0},
                                                   "table_tiebreakers": ["score_for"]}})
    matches = [duel("m1", 1, "a", "b", 3, 0), duel("m2", 2, "c", "b", 1, 0), duel("m3", 3, "a", "c", 0, 0)]
    rows = {row["registration_id"]: row for row in round_robin_standings(matches, REGS, by_wins_first)}
    assert (rows["a"]["points"], rows["c"]["points"]) == (3, 3)
    assert rows["a"]["rank"] == 1 and rows["c"]["rank"] == 2  # mehr Maps gewonnen (3 zu 1)
    loss_points = table_rules({"scoring_rules": {"match_points": {"win": 3, "draw": 1, "loss": 1}}})
    rows = {row["registration_id"]: row for row in round_robin_standings(MATCHES, REGS, loss_points)}
    assert rows["b"]["points"] == 2  # eine Niederlage (1) und ein Remis (1)


def test_every_reader_of_the_table_uses_the_season_points():
    """Web/App (standings_for_structure), Plätze (placements_for_structure) und Discord lesen dieselbe Tabelle."""
    from services import discord_bracket
    from services.competition_standings import placements_for_structure, standings_for_structure

    league = {"format": "league", "scoring_rules": {"match_points": {"win": 3, "draw": 0, "loss": 0}}}
    snapshot = {"matches": [{**match, "source": {"engine": "stage"}, "stage_id": "s1"} for match in MATCHES]}
    rows = {row["registration_id"]: row["points"] for row in standings_for_structure(league, snapshot, REGS)}
    assert rows == {"a": 3, "b": 0, "c": 3}
    plain = {row["registration_id"]: row["points"]
             for row in standings_for_structure({"format": "league"}, snapshot, REGS)}
    assert plain == {"a": 3, "b": 1, "c": 4}
    places = placements_for_structure(snapshot, REGS, tournament=league)
    assert sorted(item["registration_id"] for item in places[1]) == ["a", "c"]
    fields = discord_bracket.bracket_fields(snapshot["matches"], [{"id": "s1", "stage_type": "league"}], REGS, {},
                                            tournament=league)
    table = next(field for field in fields if "Pkt" in field.get("value", ""))
    assert "3 Pkt" in table["value"] and "4 Pkt" not in table["value"]
