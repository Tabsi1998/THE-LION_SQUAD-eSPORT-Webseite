"""Liga P2 (docs/LIGA.md, Abschnitt 5, #1624): Runden ≤ aktive Wochen auch beim Erzeugen und Neu-Auslosen des
Spielplans, nicht nur beim Anlegen der Staffel. Ohne Wochenbudget (normale Liga) keine Prüfung.
"""
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.custom_bracket import BracketSchemaError, build_matches_v2_from_schema  # noqa: E402

# Season 1: Di 10.11.2026 00:00 Wien, 10 Wochen, Weihnachtspause 21.12.–3.1. → Wochen 7 und 8 gesperrt.
SEASON_ONE = {
    "id": "staffel-a", "format": "league", "event_mode": "online", "start_date": "2026-11-09T23:00:00+00:00",
    "matchday_days": 7, "default_match_weekday": 6, "default_match_time": "20:00",
    "matchday_blocked_weeks": [7, 8], "matchday_weeks_total": 10, "round_robin_legs": 1,
    "blocked_periods": [{"start_date": "2026-12-21", "end_date": "2027-01-03", "label": "Weihnachtspause"}],
}


# ---------------------------------------------------------------- Runden ≤ aktive Wochen beim Erzeugen

def test_generating_a_schedule_checks_rounds_against_active_weeks():
    stage = {"id": "s1", "stage_type": "league", "settings": {}}
    nine = [{"id": f"r{index}", "status": "approved", "seed": index} for index in range(1, 10)]
    with pytest.raises(BracketSchemaError) as refused:
        build_matches_v2_from_schema({**SEASON_ONE, "max_participants": 9}, stage, nine)
    assert "9 Spielwochen" in str(refused.value) and "zweite Staffel" in str(refused.value)
    # Hin- und Rückrunde mit 8 Teams braucht 14 Wochen.
    eight = nine[:8]
    with pytest.raises(BracketSchemaError):
        build_matches_v2_from_schema({**SEASON_ONE, "round_robin_legs": 2, "max_participants": 8}, stage, eight)
    # Ohne Wochenbudget (normale Liga) keine Prüfung.
    plain = {"id": "t", "format": "league", "max_participants": 9}
    assert len(build_matches_v2_from_schema(plain, stage, nine)) == 72
