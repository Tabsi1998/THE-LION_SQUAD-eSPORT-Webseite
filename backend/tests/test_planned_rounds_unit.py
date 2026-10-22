"""Geplante Termine einer Saison (#2015) ohne Datenbank: solange der Kalender kürzer ist als die geplante Zahl, rechnen
Streichergebnisse („Runden minus N“) mit der geplanten Zahl. Geprüft an der Saisontabelle aus
``test_double_up_points_unit`` (Turniere 1–4 von 9, erfundene Namen)."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from test_double_up_points_unit import RULES, TABLE, _table_standings  # noqa: E402


def test_planned_rounds_keep_drop_results_from_striking_everything_while_the_calendar_is_shorter():
    # „9 Turniere, beste 6“ als Streichergebnisse: Runden minus 3. Mit nur 4 Terminen im Kalender zählte sonst nur das
    # beste Ergebnis (4 − 3 = 1); mit „geplante Termine = 9“ zählen 6, also alle vier.
    drop = {**RULES, "count_mode": "drop_n", "count_n": 3}
    short = {row["participant_id"]: row for row in _table_standings(drop, calendar=4)}
    assert short["s01"]["points"] == 30 and len(short["s01"]["dropped_round_ids"]) == 3
    planned = _table_standings(drop, calendar=4, planned_rounds=9)
    assert [row["points"] for row in planned] == [item[4] for item in TABLE]
    assert all(row["dropped_round_ids"] == [] for row in planned)
    # Ein längerer Kalender gilt weiter - die geplante Zahl ist nur das Mindeste.
    longer = {row["participant_id"]: row for row in _table_standings(drop, calendar=9, planned_rounds=5)}
    assert longer["s01"]["points"] == 112
