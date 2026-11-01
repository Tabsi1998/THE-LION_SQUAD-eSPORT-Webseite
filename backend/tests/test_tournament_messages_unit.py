"""Server-Meldungen der Turnierverwaltung auf Deutsch und mit dem, was zu tun ist (#2111, TA28).

Die Verwaltung zeigt Fehlermeldungen des Servers 1:1 an. Vorher standen dort Technik-Wörter wie „Stage“, „Matches“,
„Group-Stage“, „Apply-Weg“ oder „force=true“.
"""
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from routes.tournament_structure_routes import _no_generator_text  # noqa: E402

BACKEND = pathlib.Path(__file__).resolve().parents[1]
FILES = [
    "routes/tournament_stage_routes.py", "routes/tournament_structure_routes.py", "routes/tournament_format_routes.py",
    "routes/tournament_registration_routes.py", "routes/tournament_lifecycle_routes.py", "routes/tournament_staff_routes.py",
    "routes/tournament_crud_routes.py", "services/competition_structure_apply.py",
]
TECH_WORDS = re.compile(r"Stage|Matches|force=true|Apply|Bracket-Generator|Display-Name|Group-Stage|Swiss-Turniere")


def test_no_technical_words_in_details():
    for name in FILES:
        source = (BACKEND / name).read_text(encoding="utf-8")
        for detail in re.findall(r'detail=f?"([^"]*)"', source) + re.findall(r'"message": f?"([^"]*)"', source):
            assert not TECH_WORDS.search(detail), f"{name}: {detail}"


def test_no_generator_names_the_way_out():
    assert "Schweizer Runde" in _no_generator_text({"format": "swiss"})
    assert "Fast Lap" in _no_generator_text({"format": "time_trial"})
    assert "Serien" in _no_generator_text({"format": "grand_prix"})
    assert _no_generator_text({"format": "historical_unknown"}).startswith("Für dieses Format")
