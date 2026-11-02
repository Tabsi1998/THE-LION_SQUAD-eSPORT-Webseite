"""Die Liga-Prüfung und ihre Antworten nennen nie ein Datum oder Alter der Person (docs/LIGA.md, B.3, #2204). Das freiwillige Feld im öffentlichen
Profil ist eine Einstellung der Person und gehört nicht hierher - aber kein Liga-Weg liest es mit: Gelesen wird es nur an einer Stelle."""
import pathlib
import re

BACKEND = pathlib.Path(__file__).resolve().parents[1]
LEAGUE_WAYS = [
    *sorted((BACKEND / "services").glob("league_*.py")),
    *sorted((BACKEND / "services").glob("squad_*.py")),
    BACKEND / "routes" / "league_routes.py",
    BACKEND / "routes" / "league_roster_routes.py",
    BACKEND / "routes" / "team_routes.py",
    BACKEND / "services" / "match_audience.py",
]


def test_only_the_age_check_reads_the_birth_date():
    readers = [path.name for path in LEAGUE_WAYS if "birth_date" in path.read_text(encoding="utf-8")]

    assert readers == ["league_eligibility.py"]


def test_the_age_check_reads_it_once_and_hands_out_only_a_state():
    source = (BACKEND / "services" / "league_eligibility.py").read_text(encoding="utf-8")

    assert len(re.findall(r"db\.users\.find\(.*birth_date", source)) == 1
    assert 'row.get("birth_date")' in source
    assert "public_row" in source
    for key in ("state", "ok", "reason", "until", "age"):
        assert f'"{key}"' in source
