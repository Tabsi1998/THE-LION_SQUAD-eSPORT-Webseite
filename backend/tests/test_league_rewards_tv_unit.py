"""Podest am TV (#2410): aus den Einträgen einer Staffel Platz 1 bis 3 mit ihren Belohnungen - die Hauptbelohnung zuerst, ruhende,
„alle Teilnehmer“ und andere Plätze fallen weg, und je Belohnung nur die Felder der Liste. Nur erfundene Namen."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.league_rewards import TV_REWARD_FIELDS, tv_places  # noqa: E402


def entry(rank, reward_id, kind, name, mode="rank", registration="reg-1", **extra):
    return {"rank": rank, "registration_id": registration, "player_ids": ["p-1"], "user_id": None, "team_id": "team-1",
            "reward": {"id": reward_id, "kind": kind, "name": name, "places": {"mode": mode}, "description": "Geheim", "prize": "100 Euro",
                       "image_url": None, "recipients": ["team"], "art": {"place": f"{rank}. Platz", "metal": "gold", "league": "Probe-Liga"}},
            **extra}


def test_main_reward_first_rank_before_range_and_medal_before_banner():
    places = tv_places([
        entry(1, "b", "banner", "Meister-Banner"),
        entry(1, "r", "emblem", "Podest-Emblem", mode="range"),
        entry(1, "m", "medal", "Goldmedaille"),
    ])
    assert [row["name"] for row in places[0]["rewards"]] == ["Goldmedaille", "Meister-Banner", "Podest-Emblem"]


def test_resting_everyone_and_other_places_are_left_out():
    places = tv_places([
        entry(1, "m", "medal", "Goldmedaille", suspended=True),
        entry(2, "a", "banner", "Season-Banner", mode="all", registration="reg-2"),
        entry(4, "t", "title", "Kämpferherz", registration="reg-4"),
        entry(True, "x", "medal", "Kein Platz"),
        entry(3, "e", "emblem", "Podest-Emblem", mode="range", registration="reg-3"),
    ])
    assert [(row["rank"], row["registration_id"], [item["name"] for item in row["rewards"]]) for row in places] == [
        (3, "reg-3", ["Podest-Emblem"])]
    assert tv_places([]) == []


def test_only_the_listed_fields_and_each_reward_once():
    places = tv_places([entry(1, "m", "medal", "Goldmedaille"), entry(1, "m", "medal", "Goldmedaille")])
    assert set(places[0]) == {"rank", "registration_id", "rewards"}
    assert len(places[0]["rewards"]) == 1
    assert set(places[0]["rewards"][0]) == {*TV_REWARD_FIELDS, "art"}
    assert places[0]["rewards"][0]["art"] == {"place": "1. Platz", "metal": "gold"}
