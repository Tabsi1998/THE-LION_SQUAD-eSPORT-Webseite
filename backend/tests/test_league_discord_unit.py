"""Liga im Discord (#1642): Einstellung, Texte und wann ein Spieltag fertig ist - reine Rechnung, ohne Datenbank und ohne Discord.
Nur erfundene Namen."""
import pathlib
import sys
from datetime import datetime, timedelta, timezone

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import league_discord as digest  # noqa: E402

NOW = datetime(2026, 11, 23, 12, 0, tzinfo=timezone.utc)
CHANNEL = "100000000000000042"


# ---------------------------------------------------------------- Einstellung

def test_settings_unit_default_is_off():
    """Ohne Einstellung ist alles aus - es bleibt, wie es war."""
    settings = digest.settings_of({})
    assert settings["matchday"] is False and settings["season_end"] is False
    assert settings["channel_id"] == ""
    assert settings["wait_hours"] == 48 and settings["late"] is True and settings["table_rows"] == 5


def test_settings_unit_switching_on_needs_channel():
    with pytest.raises(digest.DigestProblem) as problem:
        digest.normalize({"matchday": True}, None, NOW)
    assert "Kanal" in problem.value.detail


def test_settings_unit_channel_must_be_digits():
    with pytest.raises(digest.DigestProblem):
        digest.normalize({"season_end": True, "channel_id": "#ergebnisse"}, None, NOW)


def test_settings_unit_ranges_are_checked():
    with pytest.raises(digest.DigestProblem):
        digest.normalize({"wait_hours": 500}, None, NOW)
    with pytest.raises(digest.DigestProblem):
        digest.normalize({"table_rows": -1}, None, NOW)


def test_settings_unit_matchday_since_set_once_and_dropped_when_off():
    on = digest.normalize({"matchday": True, "channel_id": CHANNEL}, None, NOW)
    assert on["matchday_since"] == NOW.isoformat()
    later = digest.normalize({"table_rows": 8}, on, NOW + timedelta(days=3))
    assert later["matchday_since"] == NOW.isoformat()
    off = digest.normalize({"matchday": False}, later, NOW + timedelta(days=4))
    assert "matchday_since" not in off


# ---------------------------------------------------------------- Spieltag fertig?

def games(*statuses):
    return [{"status": status} for status in statuses]


def test_due_unit_complete_matchday_goes_out_at_once():
    assert digest.matchday_due(games("completed", "forfeit", "cancelled"), NOW + timedelta(days=3), digest.DEFAULTS, NOW) == (True, 0)


def test_due_unit_waits_for_missing_results_until_deadline():
    end = NOW - timedelta(hours=47)
    assert digest.matchday_due(games("completed", "scheduled"), end, digest.DEFAULTS, NOW) == (False, 1)
    end = NOW - timedelta(hours=48)
    assert digest.matchday_due(games("completed", "scheduled", "live"), end, digest.DEFAULTS, NOW) == (True, 2)


def test_due_unit_without_late_only_complete():
    settings = {**digest.DEFAULTS, "late": False}
    assert digest.matchday_due(games("completed", "scheduled"), NOW - timedelta(days=30), settings, NOW) == (False, 1)


def test_due_unit_never_without_a_single_result():
    assert digest.matchday_due(games("cancelled", "scheduled"), NOW - timedelta(days=30), digest.DEFAULTS, NOW) == (False, 1)
    assert digest.matchday_due(games("cancelled"), NOW - timedelta(days=30), digest.DEFAULTS, NOW) == (False, 0)


# ---------------------------------------------------------------- Texte

def side(rid, name, score=None):
    return {"registration_id": rid, "name": name, "score": score}


def test_text_unit_result_lines():
    assert digest.result_line({"done": True, "status": "completed", "home": side("a", "Probe Nord", 2), "away": side("b", "Probe Süd", 0)}) \
        == "Probe Nord **2 : 0** Probe Süd"
    assert digest.result_line({"done": False, "status": "scheduled", "home": side("a", "Probe Nord"), "away": side("b", "Probe Süd")}) \
        == "Probe Nord – Probe Süd · offen"
    assert digest.result_line({"done": True, "status": "forfeit", "forfeit": True, "winner_registration_id": "b",
                               "home": side("a", "Probe Nord"), "away": side("b", "Probe Süd")}) \
        == "Probe Nord **gewertet** Probe Süd · kampflos für Probe Süd"
    assert digest.result_line({"done": True, "status": "forfeit", "forfeit": True, "double_forfeit": True,
                               "home": side("a", "Probe Nord"), "away": side("b", "Probe Süd")}) \
        == "Probe Nord – Probe Süd · beide nicht angetreten"
    assert digest.result_line({"done": False, "status": "cancelled", "home": side("a", "Probe Nord"), "away": side("b", "Probe Süd")}) \
        == "Probe Nord – Probe Süd · abgesagt"


def test_text_unit_markdown_in_names_is_harmless():
    line = digest.result_line({"done": True, "status": "completed", "home": side("a", "*Stern*_Team", 1), "away": side("b", "@everyone", 0)})
    assert "\\*Stern\\*\\_Team" in line
    assert "@everyone" not in line


def context(**extra):
    return {"league": "Probe-Liga", "season": "Season 1", "division": "Liga 1", "staffel": None, "number": 3,
            "matches": [{"done": True, "status": "completed", "home": side("a", "Probe Nord", 2), "away": side("b", "Probe Süd", 1)},
                        {"done": False, "status": "scheduled", "home": side("c", "Probe West"), "away": side("d", "Probe Ost")}],
            "open": 1, "table": [{"rank": 1, "display_name": "Probe Nord", "points": 9, "zone": None},
                                 {"rank": 2, "display_name": "Probe West", "points": 6, "zone": None},
                                 {"rank": 3, "display_name": "Probe Süd", "points": 3, "zone": "relegation"}],
            "table_rows": 2, "url": "/liga/probe-liga/season-1/spieltage", **extra}


def test_text_unit_matchday_message():
    message = digest.matchday_message(context())
    assert message["title"] == "Spieltag 3 · Liga 1"
    assert message["description"].startswith("Probe-Liga · Season 1")
    assert "Probe Nord **2 : 1** Probe Süd" in message["description"]
    assert "*1 Spiel offen*" in message["description"]
    table = message["fields"][0]
    assert table["name"] == "Tabelle"
    assert table["value"].splitlines() == ["1. Probe Nord · 9 Pkt.", "2. Probe West · 6 Pkt.", "… ganze Tabelle auf der Ligaseite"]
    assert message["buttons"] == [{"label": "Zur Ligaseite", "url": "/liga/probe-liga/season-1/spieltage"}]


def test_text_unit_matchday_staffel_and_complete():
    message = digest.matchday_message(context(staffel="B", open=0, table_rows=0))
    assert message["title"] == "Spieltag 3 · Liga 1 · Staffel B"
    assert "*Alle Spiele gewertet*" in message["description"]
    assert message["fields"] == []


def test_text_unit_long_lists_drop_whole_lines_never_cut_names():
    name = "Probe-Mannschaft mit einem wirklich sehr langen Namen Nummer"
    many = [{"done": True, "status": "completed", "home": side(f"h{i}", f"{name} {i}", 1), "away": side(f"a{i}", f"{name} {i}b", 0)}
            for i in range(80)]
    message = digest.matchday_message(context(matches=many))
    lines = message["description"].splitlines()
    shown = [line for line in lines if line.startswith(name)]
    assert shown and all(line.endswith("b") for line in shown)
    assert any(line.startswith("… und ") and line.endswith("weitere Spiele auf der Ligaseite") for line in lines)
    assert len(message["description"]) <= 4096


def test_text_unit_season_end_message():
    pages = [{"label": "Liga 1", "rows": [{"name": "Probe Süd", "move": "down", "target": "Liga 2", "staffel": None}], "more": 0},
             {"label": "Liga 2", "rows": [{"name": "Probe Aufsteiger", "move": "up", "target": "Liga 1", "staffel": "A"},
                                          {"name": "Probe Raus", "move": "out", "target": None, "staffel": "B"}], "more": 0}]
    message = digest.season_end_message({"league": "Probe-Liga", "season": "Season 1", "champions": [{"name": "Probe Nord", "staffel": None}],
                                         "pages": pages, "url": "/liga/probe-liga/season-1"})
    assert message["title"] == "Saisonende · Season 1"
    assert message["description"] == "Probe-Liga: Die Season ist abgeschlossen.\nMeister: **Probe Nord**"
    assert [field["name"] for field in message["fields"]] == ["Liga 1", "Liga 2"]
    assert message["fields"][0]["value"] == "▼ Probe Süd → Liga 2"
    assert message["fields"][1]["value"].splitlines() == ["▲ Probe Aufsteiger (Staffel A) → Liga 1", "✕ Probe Raus (Staffel B) scheidet aus"]
    assert message["buttons"] == [{"label": "Zur Season", "url": "/liga/probe-liga/season-1"}]


def test_text_unit_season_end_without_movers_and_several_champions():
    message = digest.season_end_message({"league": "Probe-Liga", "season": "Season 1", "pages": [], "url": None,
                                         "champions": [{"name": "Probe Nord", "staffel": "A"}, {"name": "Probe Süd", "staffel": "B"}]})
    assert "Meister Staffel A: **Probe Nord**\nMeister Staffel B: **Probe Süd**" in message["description"]
    assert message["fields"] == [{"name": "Auf- und Abstieg", "value": "In dieser Season steigt niemand auf oder ab.", "inline": False}]
    assert message["buttons"] == []


def test_text_unit_season_end_stays_under_6000_characters_per_embed():
    """Discord nimmt je Embed höchstens 6000 Zeichen (Titel, Text, alle Felder) - darüber fallen ganze Liga N weg, mit Hinweis."""
    name = "Probe-Mannschaft mit einem wirklich sehr langen Namen"
    pages = [{"label": f"Liga {level}", "more": 0,
              "rows": [{"name": f"{name} {level}-{i}", "move": "down", "target": f"Liga {level + 1}", "staffel": "A"} for i in range(30)]}
             for level in range(1, 21)]
    message = digest.season_end_message({"league": "Probe-Liga", "season": "Season 1", "champions": [{"name": "Probe Nord", "staffel": None}],
                                         "pages": pages, "url": "/liga/probe-liga/season-1"})
    total = len(message["title"]) + len(message["description"]) + sum(len(f["name"]) + len(f["value"]) for f in message["fields"])
    assert total <= 6000
    assert message["fields"][0]["name"] == "Liga 1"
    assert message["fields"][-1] == {"name": "Weitere Ligen", "value": f"… und {20 - (len(message['fields']) - 1)} weitere Liga N auf der Season-Seite",
                                     "inline": False}


@pytest.mark.parametrize("result, again", [
    ({"ok": False, "reason": "bot_offline"}, True),
    ({"ok": False, "reason": "unknown_channel"}, True),
    ({"ok": False, "reason": "forbidden"}, True),
    ({"ok": False, "reason": "http", "error": "Discord 400: Invalid Form Body"}, True),
    ({"ok": False, "reason": "http", "error": "Discord 503: Service Unavailable"}, False),
    ({"ok": False, "reason": "error", "error": "TimeoutError: "}, False),
    ({"ok": False}, False),
])
def test_retry_unit_only_when_surely_nothing_went_out(result, again):
    """Wiederholt wird nur, wenn sicher nichts hinausging - nach einem unklaren Fehler (Zeitüberschreitung, 5xx) kann die Meldung
    schon im Kanal stehen; dann bleibt der Merker und die Leitung sieht den Hinweis."""
    assert digest.retryable(result) is again


def test_text_unit_season_end_at_most_nine_leagues_then_the_rest_line():
    """K1: Discord nimmt höchstens 10 Felder je Embed - 9 Liga N und der Hinweis „Weitere Ligen“, nie still weggefallene Felder."""
    pages = [{"label": f"Liga {level}", "more": 0, "rows": [{"name": f"Probe {level}", "move": "down", "target": f"Liga {level + 1}", "staffel": None}]}
             for level in range(1, 16)]
    message = digest.season_end_message({"league": "Probe-Liga", "season": "Season 1", "champions": [], "pages": pages, "url": None})
    assert len(message["fields"]) == 10
    assert [field["name"] for field in message["fields"][:9]] == [f"Liga {level}" for level in range(1, 10)]
    assert message["fields"][9] == {"name": "Weitere Ligen", "value": "… und 6 weitere Liga N auf der Season-Seite", "inline": False}
    ten = digest.season_end_message({"league": "Probe-Liga", "season": "Season 1", "champions": [], "pages": pages[:10], "url": None})
    assert len(ten["fields"]) == 10 and ten["fields"][9]["name"] == "Liga 10"


# ---------------------------------------------------------------- Kennzeichnung je Stufe (#2561)

def test_text_unit_tier_mark_is_short_and_the_same_per_tier():
    """Discord kennt kein Wappen ohne Bilder-Host - stattdessen ein Zeichen je Stufe wie die Form des Abzeichens: Liga 1 mit
    Krone, Liga 2, ab Liga 3 schlicht. Ohne Stufe nichts."""
    assert digest.tier_mark(1) == "👑"
    assert digest.tier_mark(2) == "🔷"
    assert digest.tier_mark(3) == digest.tier_mark(4) == digest.tier_mark(12) == "🔹"
    assert digest.tier_mark(None) == digest.tier_mark(0) == digest.tier_mark("x") == ""
    assert len({digest.tier_mark(1), digest.tier_mark(2), digest.tier_mark(3)}) == 3


def test_text_unit_season_end_marks_field_names_and_targets():
    pages = [{"label": "Liga 1 · Elite", "level": 1, "more": 0,
              "rows": [{"name": "Probe Süd", "move": "down", "target": "Liga 2", "target_badge": {"level": 2}, "staffel": None}]},
             {"label": "Liga 3", "level": 3, "more": 0,
              "rows": [{"name": "Probe Auf", "move": "up", "target": "Liga 2", "target_badge": {"level": 2}, "staffel": None},
                       {"name": "Probe Raus", "move": "out", "target": None, "target_badge": None, "staffel": None}]}]
    message = digest.season_end_message({"league": "Probe-Liga", "season": "Season 1", "champions": [], "pages": pages, "url": None})
    assert [field["name"] for field in message["fields"]] == ["👑 Liga 1 · Elite", "🔹 Liga 3"]
    assert message["fields"][0]["value"] == "▼ Probe Süd → 🔷 Liga 2"
    assert message["fields"][1]["value"].splitlines() == ["▲ Probe Auf → 🔷 Liga 2", "✕ Probe Raus scheidet aus"]


def test_text_unit_matchday_title_marks_the_tier():
    message = digest.matchday_message(context(division_level=1))
    assert message["title"] == "Spieltag 3 · 👑 Liga 1"
