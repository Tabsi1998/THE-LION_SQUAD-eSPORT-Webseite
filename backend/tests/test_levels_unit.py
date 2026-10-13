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
    assert levels.title_for_level(1) == "Jungtier" and levels.title_for_level(4) == "Jungtier"
    assert levels.title_for_level(5) == "Fährte" and levels.title_for_level(20) == "Silbermähne" and levels.title_for_level(60) == "Löwenkönig"
    assert levels.next_title_at(1) == 5 and levels.next_title_at(54) == 55 and levels.next_title_at(55) is None and levels.next_title_at(60) is None


def test_loewen_rang_grenzen():
    """Löwen-Rang (#1452): 12 Ränge zu je fünf Level, Rang 1 ab Level 1, Rang 12 von 55 bis 60."""
    assert len(levels.RANK_NAMES) == 12 and levels.RANK_NAMES[0] == "Jungtier" and levels.RANK_NAMES[-1] == "Löwenkönig"
    assert [levels.rank_for_level(n) for n in (1, 4, 5, 9, 10, 54, 55, 59, 60)] == [1, 1, 2, 2, 3, 11, 12, 12, 12]
    assert levels.rank_for_level(0) == 1 and levels.rank_for_level(99) == 12, "außerhalb 1–60 bleibt es beim Rand"
    assert levels.rank_view(4) == {"rank": 1, "rank_name": "Jungtier", "rank_from": 1, "rank_to": 4, "step": 3}
    assert levels.rank_view(5) == {"rank": 2, "rank_name": "Fährte", "rank_from": 5, "rank_to": 9, "step": 0}
    assert levels.rank_view(54) == {"rank": 11, "rank_name": "Sonnenlöwe", "rank_from": 50, "rank_to": 54, "step": 4}
    assert levels.rank_view(55) == {"rank": 12, "rank_name": "Löwenkönig", "rank_from": 55, "rank_to": 60, "step": 0}
    assert levels.rank_view(60) == {"rank": 12, "rank_name": "Löwenkönig", "rank_from": 55, "rank_to": 60, "step": 5}
    for level in range(1, levels.MAX_LEVEL + 1):
        view = levels.rank_view(level)
        assert view["rank_from"] <= level <= view["rank_to"] and view["step"] == level - view["rank_from"]
        assert view["rank_name"] == levels.title_for_level(level), "ein Name je Stufe - Titel und Rang sind dasselbe"


def test_payload_traegt_den_rang_und_prestige_bleibt():
    view = levels.level_view(levels.xp_for_level(5))
    assert view["level"] == 5 and view["title"] == "Fährte"
    assert {k: view[k] for k in ("rank", "rank_name", "rank_from", "rank_to", "step")} == {"rank": 2, "rank_name": "Fährte", "rank_from": 5, "rank_to": 9, "step": 0}
    top = levels.level_view(levels.xp_for_level(60, prestige=3), 3)
    assert top["level"] == 60 and top["prestige"] == 3 and top["rank"] == 12 and top["step"] == 5 and top["rank_name"] == "Löwenkönig"
    restart = levels.level_view(0, 4)
    assert restart["level"] == 1 and restart["prestige"] == 4 and restart["rank"] == 1 and restart["title"] == "Jungtier"


def test_ansicht_und_prestige():
    view = levels.level_view(200, member=True)
    assert view["level"] == 2 and view["xp"] == 200 and view["points"] == 200 and view["title"] == "Jungtier"
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
