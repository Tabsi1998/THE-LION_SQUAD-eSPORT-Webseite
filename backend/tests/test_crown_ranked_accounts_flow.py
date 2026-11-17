"""Kronen und Erfolge-Rangliste zählen dieselben Konten (#2492), durch die echten Routen.

Vertrag:
- Ein gesperrtes, deaktiviertes, gelöschtes oder nicht öffentliches Konto - oder eines mit „Erfolge öffentlich“ aus -
  trägt keine Krone, auch mit den meisten Punkten; die Nummer 1 der sichtbaren Rangliste trägt Gold, die Plätze 2 und 3
  Silber und Bronze.
- Kommt das Konto zurück (entsperrt, wieder aktiv, wieder öffentlich), trägt es beim nächsten Lauf wieder seine Krone.
- Die Kronen wandern beim nächsten Lauf weiter; jede Person erfährt jeden Wechsel genau einmal, auch wenn danach noch
  einmal gerechnet wird. Wer gesperrt, deaktiviert oder unsichtbar wurde, bekommt keine Meldung „Krone verloren“.
- Rangliste, Kronen, Erfolg der Woche, Laufband und die Schnellsten der Ostersuche fragen dieselbe Auswahl ab
  (``ranked_users_query``); bei den Schnellsten zählt der Platz weiter unter allen.
- Die Level-Rangliste lässt dieselben gesperrten, deaktivierten, gelöschten und nicht öffentlichen Konten weg
  (``listed_accounts_query``); „Erfolge öffentlich“ aus nimmt dort niemanden heraus - das Level ist auch sonst sichtbar.
Erfundene Personen.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402

from services import achievement_visibility, crown_events  # noqa: E402
from services import easter_hunt  # noqa: E402

CROWN_KINDS = ("crown_gained", "crown_changed", "crown_lost")

# Zustand, der ein Konto aus Rangliste und Kronen nimmt, und der Zustand, der es zurückbringt (None: kein Weg zurück).
HIDDEN_STATES = {
    "gesperrt": ({"is_banned": True}, {"is_banned": False}),
    "deaktiviert": ({"is_active": False}, {"is_active": True}),
    "nicht_oeffentlich": ({"privacy_public_profile": False}, {"privacy_public_profile": True}),
    "erfolge_privat": ({"privacy_achievements_public": False}, {"privacy_achievements_public": True}),
    "geloescht": ({"anonymized_at": "2026-11-01T10:00:00+00:00"}, None),
}


@pytest_asyncio.fixture
async def flow(monkeypatch):
    instance, shutdown = make_flow()
    monkeypatch.setitem(crown_events._cache, "at", None)
    try:
        yield instance
    finally:
        await shutdown()


async def probe_tiers(flow, **points: int) -> None:
    await flow.db.achievement_groups.insert_one({"code": "probe", "id": "probe", "name": "Probe", "category": "match",
                                                 "public": True, "is_negative": False, "sort_order": 1})
    await flow.db.achievements.insert_many([
        {"code": code, "id": code, "group_code": "probe", "name": code, "level": 1, "points": value}
        for code, value in points.items()])


async def person(flow, name: str, *tiers: str) -> dict:
    user = {"id": new_id(), "username": name, "display_name": name, "email": f"{name}@example.test", "role": "player",
            "is_active": True, "is_banned": False, "privacy_public_profile": True}
    await flow.db.users.insert_one(dict(user))
    if not tiers:
        return user
    await flow.db.user_achievements.insert_many([
        {"id": new_id(), "user_id": user["id"], "tier_code": code, "group_code": "probe",
         "earned_at": "2026-10-01T10:00:00+00:00"} for code in tiers])
    return user


async def podium(flow) -> tuple[dict, list[str]]:
    """Kronen und die ersten drei der Rangliste - so, wie ein Gast sie sieht, nach einem frischen Lauf."""
    crown_events._cache["at"] = None
    flow.act_as(None)
    response = await flow.get("/api/achievements/crowns")
    assert response.status_code == 200
    crowns = response.json()["crowns"]
    board = (await flow.get("/api/achievements/leaderboard")).json()
    return crowns, [row["user_id"] for row in board][:3]


async def crown_mail(flow) -> list[tuple[str, str]]:
    rows = await flow.db.notifications.find({"kind": {"$in": list(CROWN_KINDS)}}, {"_id": 0, "user_id": 1, "kind": 1}).to_list(100)
    return sorted((row["user_id"], row["kind"]) for row in rows)


async def four_players(flow) -> list[dict]:
    await probe_tiers(flow, probe_a=50, probe_b=30, probe_c=10)
    return [
        await person(flow, "spitze", "probe_a", "probe_b", "probe_c"),  # 90
        await person(flow, "zweite", "probe_a", "probe_b"),  # 80
        await person(flow, "dritte", "probe_a"),  # 50
        await person(flow, "vierte", "probe_b"),  # 30
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize("state", sorted(HIDDEN_STATES))
async def test_an_account_off_the_leaderboard_wears_no_crown_and_gets_it_back_on_return(flow, state):
    top, second, third, fourth = await four_players(flow)
    hide, undo = HIDDEN_STATES[state]

    crowns, board = await podium(flow)
    assert board == [top["id"], second["id"], third["id"]]
    assert crowns == {top["id"]: "gold", second["id"]: "silver", third["id"]: "bronze"}

    await flow.db.users.update_one({"id": top["id"]}, {"$set": hide})
    crowns, board = await podium(flow)
    assert board == [second["id"], third["id"], fourth["id"]], "nicht auf der Rangliste"
    assert top["id"] not in crowns, f"{state}: trägt trotz fehlendem Ranglistenplatz eine Krone"
    assert crowns == {second["id"]: "gold", third["id"]: "silver", fourth["id"]: "bronze"}, "die Nummer 1 der Rangliste trägt Gold"
    assert [crowns[uid] for uid in board] == ["gold", "silver", "bronze"]

    if undo is None:
        return
    await flow.db.users.update_one({"id": top["id"]}, {"$set": undo})
    crowns, board = await podium(flow)
    assert board == [top["id"], second["id"], third["id"]]
    assert crowns == {top["id"]: "gold", second["id"]: "silver", third["id"]: "bronze"}, "nach der Rückkehr wieder dabei"


@pytest.mark.asyncio
async def test_crowns_move_on_after_a_ban_and_everyone_hears_it_exactly_once(flow):
    top, second, third, fourth = await four_players(flow)
    await podium(flow)  # erster Lauf: Kronen festhalten, ohne Meldung
    assert await crown_mail(flow) == []

    await flow.db.users.update_one({"id": top["id"]}, {"$set": {"is_banned": True}})
    await podium(flow)
    expected = sorted([(second["id"], "crown_gained"), (third["id"], "crown_gained"), (fourth["id"], "crown_gained")])
    assert await crown_mail(flow) == expected, "das gesperrte Konto bekommt keine Meldung „Krone verloren“"
    await podium(flow)
    await crown_events.get_crowns(force=True)
    assert await crown_mail(flow) == expected, "ein zweiter Lauf meldet nichts doppelt"

    await flow.db.users.update_one({"id": top["id"]}, {"$set": {"is_banned": False}})
    await podium(flow)
    await podium(flow)
    assert await crown_mail(flow) == sorted(expected + [
        (top["id"], "crown_gained"), (second["id"], "crown_changed"), (third["id"], "crown_changed"),
        (fourth["id"], "crown_lost")]), "wer überholt wird, erfährt es - einmal"


def test_leaderboard_and_crowns_share_one_account_selection():
    query = achievement_visibility.ranked_users_query(["a", "b"])
    assert query["id"] == {"$in": ["a", "b"]}
    assert query["privacy_public_profile"] is True
    assert query["privacy_achievements_public"] == {"$ne": False}
    assert query["is_active"] == {"$ne": False}
    assert query["is_banned"] == {"$ne": True}
    assert query["anonymized_at"] is None
    # Die Level-Rangliste nimmt dieselben Konten, nur ohne den Schalter „Erfolge öffentlich“ - das Level steht auch in
    # der Spielerliste und im Profil, wenn die Erfolge privat sind.
    listed = achievement_visibility.listed_accounts_query(["a", "b"])
    assert {**listed, "privacy_achievements_public": {"$ne": False}} == query


@pytest.mark.asyncio
@pytest.mark.parametrize("state", sorted(HIDDEN_STATES))
async def test_the_fastest_egg_hunters_show_only_accounts_from_the_leaderboard(flow, state):
    hidden = await person(flow, "flink")
    shown = await person(flow, "zweitflink")
    await flow.db.users.update_one({"id": hidden["id"]}, {"$set": HIDDEN_STATES[state][0]})
    await flow.db[easter_hunt.PROGRESS].insert_many([
        {"hunt_id": "probe-2027", "user_id": hidden["id"], "completed_at": "2027-03-26T09:00:00+00:00", "duration_seconds": 60},
        {"hunt_id": "probe-2027", "user_id": shown["id"], "completed_at": "2027-03-26T10:00:00+00:00", "duration_seconds": 120},
    ])
    rows = await easter_hunt.fastest(flow.db, {"id": "probe-2027"})
    assert [(row["rank"], row["username"]) for row in rows] == [(2, "zweitflink")], state


LEVEL_HIDDEN = {name: change for name, change in HIDDEN_STATES.items() if name != "erfolge_privat"}


@pytest.mark.asyncio
@pytest.mark.parametrize("state", sorted(LEVEL_HIDDEN))
async def test_the_level_leaderboard_leaves_out_the_same_accounts(flow, state):
    hidden = await person(flow, "hochstufig")
    shown = await person(flow, "mittelstufig")
    private_achievements = await person(flow, "verschwiegen")
    await flow.db.users.update_one({"id": private_achievements["id"]}, {"$set": {"privacy_achievements_public": False}})
    await flow.db.user_xp.insert_many([
        {"user_id": hidden["id"], "total": 9000, "level": 9, "prestige": 0},
        {"user_id": shown["id"], "total": 5000, "level": 5, "prestige": 0},
        {"user_id": private_achievements["id"], "total": 1000, "level": 2, "prestige": 0},
    ])
    flow.act_as(None)
    before = (await flow.get("/api/achievements/leaderboard", params={"by": "level"})).json()
    assert [row["username"] for row in before] == ["hochstufig", "mittelstufig", "verschwiegen"]

    await flow.db.users.update_one({"id": hidden["id"]}, {"$set": LEVEL_HIDDEN[state][0]})
    after = (await flow.get("/api/achievements/leaderboard", params={"by": "level"})).json()
    assert [(row["rank"], row["username"]) for row in after] == [(1, "mittelstufig"), (2, "verschwiegen")], state
