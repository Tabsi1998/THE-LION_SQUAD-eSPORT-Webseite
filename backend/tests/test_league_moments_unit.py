"""Saisonende-Moment (#1639, docs/LIGA.md „F.8 Saisonende-Moment“): Texte, Ausgang als Wert, Frische und Auswahl je Co-Team - ohne
Datenbank. Nur erfundene Namen."""
import pathlib
import sys
from datetime import timedelta

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from models import now_utc  # noqa: E402
from services import league_moments as moments  # noqa: E402

TITLE = "Probe-Liga · Season 1"


def doc(outcome="up", **extra):
    base = {"id": "m-1", "outcome": outcome, "display_name": "Probe Alpha", "from": {"level": 2, "nickname": None},
            "to": {"level": 1, "nickname": "Elite"}, "via": None, "active": True}
    return {**base, **extra}


def test_fact_and_labels():
    assert moments.fact_of("up", 1) == "up:1"
    assert moments.level_label({"level": 1, "nickname": "  Elite  Klasse "}) == "Liga 1 · Elite Klasse"
    assert moments.level_label({"level": 10}) == "Liga 10"
    assert moments.level_label(None) == "Liga"
    assert moments.season_title({"name": "Probe-Liga"}, {"name": "Season 1"}) == TITLE
    assert moments.season_title(None, None) == "Season"


def test_promotion_texts_name_both_leagues_and_the_next_season():
    texts = moments.texts(doc(), TITLE)
    assert texts["kicker"] == "Aufstieg"
    assert texts["title"] == "Liga 1 · Elite"
    assert texts["line"] == "Probe Alpha steigt von Liga 2 in Liga 1 · Elite auf."
    # Jede Angabe nur einmal: Liga N im Titel, der Weg dorthin im Satz - keine dritte Zeile mit derselben Liga.
    assert texts["next"] is None
    assert texts["label"] == "Aufstieg" and texts["summary"] == texts["line"]
    assert texts["aria"].startswith("Aufstieg: Probe Alpha")
    relegation = moments.texts(doc(via="relegation"), TITLE)
    assert "über die Relegation" in relegation["line"]


def test_relegation_texts_stay_calm_and_look_ahead():
    texts = moments.texts(doc("down", **{"from": {"level": 2}, "to": {"level": 3}}), TITLE)
    assert texts["kicker"] == "Abstieg"
    assert texts["title"] == "Nächste Season in Liga 3"
    assert texts["line"] == "Probe Alpha wechselt von Liga 2 in Liga 3."
    assert texts["next"] == "Die neue Season beginnt für alle bei null."
    assert texts["summary"] == "Probe Alpha spielt die nächste Season in Liga 3."
    # Kein Alarm: keine Ausrufezeichen, kein „leider“.
    joined = " ".join(str(value) for value in texts.values() if value)
    assert "!" not in joined and "leider" not in joined.lower()


def test_champion_texts_from_table_and_playoffs():
    table = moments.texts(doc("champion", **{"from": {"level": 1}, "to": {"level": 1}}), TITLE)
    # „Meister“ steht einmal groß, darüber die Liga N.
    assert table["kicker"] == "Liga 1" and table["title"] == "Meister" and table["label"] == "Meister"
    assert table["line"] == "Platz 1 im Endstand der Season."
    assert table["meta"] == TITLE
    assert table["summary"] == "Probe Alpha ist Meister in Liga 1."
    playoffs = moments.texts(doc("champion", playoffs=True, **{"from": {"level": 1}, "to": {"level": 1}}), TITLE)
    assert playoffs["line"] == "Sieger der Playoffs."


def test_push_texts_first_and_corrected():
    assert moments.push_texts(doc(), TITLE) == ("Aufstieg in Liga 1 · Elite",
                                              f"Der Endstand von {TITLE} steht fest: Probe Alpha steigt in Liga 1 · Elite auf.")
    headline, text = moments.push_texts(doc("down", to={"level": 3}), TITLE)
    assert headline == "Nächste Season in Liga 3"
    assert moments.push_texts(doc("champion"), TITLE)[0] == "Meister: Probe Alpha"
    headline, text = moments.push_texts(doc(), TITLE, corrected=True)
    assert headline == "Endstand korrigiert" and text.endswith("Probe Alpha steigt in Liga 1 · Elite auf.")
    headline, text = moments.push_texts(doc(active=False), TITLE)
    assert headline == "Endstand korrigiert" and "Stand auf der Ligaseite" in text


def test_fresh_only_for_a_while_after_the_confirmed_final():
    now = now_utc()
    assert moments.fresh({"confirmed_at": (now - timedelta(days=1)).isoformat()}, now)
    assert not moments.fresh({"confirmed_at": (now - timedelta(days=moments.FRESH_DAYS + 1)).isoformat()}, now)
    assert not moments.fresh({"confirmed_at": "kaputt"}, now)
    assert not moments.fresh({}, now)


def test_latest_per_entrant_keeps_one_row_per_co_team():
    rows = [{"id": "a", "squad_id": "s1", "confirmed_at": "2026-01-01"}, {"id": "b", "squad_id": "s1", "confirmed_at": "2026-06-01"},
            {"id": "c", "squad_id": "s2", "confirmed_at": "2026-03-01"}, {"id": "d", "user_id": "u1", "confirmed_at": "2026-02-01"}]
    assert [row["id"] for row in moments._latest_per_entrant(rows, 5)] == ["b", "c", "d"]
    assert [row["id"] for row in moments._latest_per_entrant(rows, 1)] == ["b"]


def test_view_has_no_person_lists_and_gold_only_for_the_champion():
    stored = {**doc(), "season_id": "s", "player_ids": ["p1"], "audience_ids": ["p1"], "seen_by": ["p1"], "responsible_ids": ["c1"]}
    row = moments.view(stored, {"name": "Season 1", "slug": "season-1"}, {"name": "Probe-Liga", "slug": "probe-liga"})
    assert not {"player_ids", "audience_ids", "seen_by", "responsible_ids", "notified_ids", "told_ids"} & set(row)
    assert row["url"] == "/liga/probe-liga/season-1"
    assert row["badge_from"] == {"level": 2, "nickname": None, "champion": False}
    assert row["badge_to"] == {"level": 1, "nickname": "Elite", "champion": False}
    champion = moments.view({**stored, "outcome": "champion"}, {"name": "Season 1"}, {"name": "Probe-Liga"})
    assert champion["badge_to"]["champion"] is True and champion["url"] is None


def test_announce_of_start_rights_covers_captains_only_for_moves():
    season = {"start_rights": {"mode": "accept", "announce": True}}
    assert moments._announce_covers(season, {"outcome": "up"})
    assert moments._announce_covers(season, {"outcome": "down"})
    assert not moments._announce_covers(season, {"outcome": "champion"})
    assert not moments._announce_covers({"start_rights": {"announce": False}}, {"outcome": "up"})
    assert not moments._announce_covers({}, {"outcome": "up"})
