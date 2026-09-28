"""Level-Kurve (#617): Level 1–60 nach ``round(60·n^1,5/10)·10`` je Schritt, Titel alle fünf Level, Prestige
verlängert die Kurve um ein Viertel je Stern; die alte Quadratkurve bleibt für Team-Level erhalten."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import levels  # noqa: E402


def test_kurve_wie_in_der_tabelle():
    assert levels.xp_step(1) == 0
    assert levels.xp_step(2) == 170
    assert {n: levels.xp_for_level(n) for n in (2, 5, 10, 20, 30, 40, 50, 60)} == {2: 170, 5: 1630, 10: 8500, 20: 45590, 30: 123210, 40: 250420, 50: 434830, 60: 683150}
    assert levels.level_for_xp(0) == 1 and levels.level_for_xp(169) == 1 and levels.level_for_xp(170) == 2
    assert levels.level_for_xp(683149) == 59 and levels.level_for_xp(683150) == 60 and levels.level_for_xp(10_000_000) == 60


def test_titel_alle_fuenf_level():
    assert levels.title_for_level(1) == "Rookie" and levels.title_for_level(4) == "Rookie"
    assert levels.title_for_level(5) == "Anwärter" and levels.title_for_level(20) == "Veteran" and levels.title_for_level(60) == "Legende"
    assert levels.next_title_at(1) == 5 and levels.next_title_at(57) == 60 and levels.next_title_at(60) is None


def test_ansicht_und_prestige():
    view = levels.level_view(200, member=True)
    assert view["level"] == 2 and view["xp"] == 200 and view["points"] == 200 and view["title"] == "Rookie"
    assert view["current_level_points"] == 170 and view["next_level_points"] == 170 + levels.xp_step(3) and 0 <= view["progress"] <= 100
    assert view["member_bonus"] == 0.1 and view["prestige"] == 0 and view["prestige_available"] is False
    top = levels.level_view(683150)
    assert top["level"] == 60 and top["progress"] == 100 and top["prestige_available"] is True
    assert levels.prestige_multiplier(1) == 1.25 and levels.prestige_multiplier(9) == 1.25 ** 5
    assert levels.xp_step(2, prestige=1) == 210 and levels.level_for_xp(170, prestige=1) == 1 and levels.level_for_xp(210, prestige=1) == 2
    assert levels.level_view(0, 2)["prestige"] == 2


def test_alte_quadratkurve_fuer_teams():
    assert levels.legacy_square_curve(0) == {"level": 1, "points": 0, "current_level_points": 0, "next_level_points": 100, "progress": 0}
    assert levels.legacy_square_curve(450)["level"] == 3 and levels.legacy_square_curve(450)["progress"] == 10
