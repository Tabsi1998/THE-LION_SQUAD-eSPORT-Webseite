"""Aufstieg zur Onyx-Krone (#2501), durch die echten Routen.

Vertrag:
- Wer von einer Rangkrone (Gold, Silber, Bronze) zu Onyx aufsteigt, bekommt keine Meldung „Krone verloren“, sondern genau
  einmal „Onyx erreicht“ (Art ``crown_onyx``). Ein zweiter Lauf meldet nichts.
- Wer erstmals Onyx erreicht, ohne vorher eine Rangkrone getragen zu haben, bekommt dieselbe Meldung genau einmal.
- Wer Onyx wieder verliert (Erfolge privat, gesperrt, Punkte entzogen), bekommt keine Verlust-Meldung - auch kein
  „Krone erobert“, wenn er danach wieder eine Rangkrone trägt. Kommt Onyx zurück, kommt die Meldung nicht noch einmal -
  auch dann nicht, wenn die alte Meldung inzwischen gelöscht ist: Der Kronen-Stand merkt sich in ``onyx_announced``, wer
  „Onyx erreicht“ schon bekommen hat.
- Ein gespeicherter Kronen-Stand ohne Onyx-Liste (vor #2501) meldet nur, wer gerade von einer Rangkrone zu Onyx wechselt;
  wer schon Onyx trug, erfährt nichts Neues und gilt als gemeldet.
Erfundene Personen.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402

from services import crown_events  # noqa: E402

CROWN_KINDS = ("crown_gained", "crown_changed", "crown_lost", "crown_onyx")


@pytest_asyncio.fixture
async def flow(monkeypatch):
    instance, shutdown = make_flow()
    monkeypatch.setitem(crown_events._cache, "at", None)
    try:
        yield instance
    finally:
        await shutdown()


async def probe_tiers(flow) -> None:
    await flow.db.achievement_groups.insert_one({"code": "probe", "id": "probe", "name": "Probe", "category": "match",
                                                 "public": True, "is_negative": False, "sort_order": 1})
    await flow.db.achievements.insert_many([
        {"code": code, "id": code, "group_code": "probe", "name": code, "level": 1, "points": value}
        for code, value in {"probe_onyx": crown_events.ONYX_FLOOR, "probe_a": 50, "probe_b": 30, "probe_c": 10}.items()])


async def award(flow, user: dict, *tiers: str) -> None:
    await flow.db.user_achievements.insert_many([
        {"id": new_id(), "user_id": user["id"], "tier_code": code, "group_code": "probe",
         "earned_at": "2026-10-01T10:00:00+00:00"} for code in tiers])


async def person(flow, name: str, *tiers: str) -> dict:
    user = {"id": new_id(), "username": name, "display_name": name, "email": f"{name}@example.test", "role": "player",
            "is_active": True, "is_banned": False, "privacy_public_profile": True}
    await flow.db.users.insert_one(dict(user))
    if tiers:
        await award(flow, user, *tiers)
    return user


async def crowns(flow) -> dict:
    """Ein frischer Lauf, so wie ein Gast die Kronen abruft."""
    crown_events._cache["at"] = None
    flow.act_as(None)
    response = await flow.get("/api/achievements/crowns")
    assert response.status_code == 200
    return response.json()["crowns"]


async def crown_mail(flow) -> list[tuple[str, str]]:
    rows = await flow.db.notifications.find({"kind": {"$in": list(CROWN_KINDS)}}, {"_id": 0, "user_id": 1, "kind": 1}).to_list(100)
    return sorted((row["user_id"], row["kind"]) for row in rows)


async def four_players(flow) -> list[dict]:
    await probe_tiers(flow)
    return [
        await person(flow, "spitze", "probe_a", "probe_b", "probe_c"),  # 90
        await person(flow, "zweite", "probe_a", "probe_b"),  # 80
        await person(flow, "dritte", "probe_a"),  # 50
        await person(flow, "vierte", "probe_b"),  # 30
    ]


@pytest.mark.asyncio
async def test_gold_to_onyx_says_onyx_reached_once_and_never_crown_lost(flow):
    top, second, third, fourth = await four_players(flow)
    assert await crowns(flow) == {top["id"]: "gold", second["id"]: "silver", third["id"]: "bronze"}
    assert await crown_mail(flow) == []

    await award(flow, top, "probe_onyx")
    assert await crowns(flow) == {top["id"]: "onyx", second["id"]: "gold", third["id"]: "silver", fourth["id"]: "bronze"}
    expected = sorted([(top["id"], "crown_onyx"), (second["id"], "crown_gained"), (third["id"], "crown_gained"),
                       (fourth["id"], "crown_gained")])
    assert await crown_mail(flow) == expected, "ein Aufstieg zu Onyx ist kein Verlust"
    note = await flow.db.notifications.find_one({"user_id": top["id"], "kind": "crown_onyx"}, {"_id": 0})
    assert note["title"] == "👑 Onyx erreicht!"
    assert "Onyx-Krone" in note["body"]
    assert note["url"] == "/achievements"
    assert note["meta"]["variant"] == "onyx" and note["meta"]["prev"] == "gold"
    assert note["meta"]["category"] == "achievements"

    await crowns(flow)
    await crown_events.get_crowns(force=True)
    assert await crown_mail(flow) == expected, "ein zweiter Lauf meldet nichts"


@pytest.mark.asyncio
async def test_losing_onyx_brings_no_message_and_regaining_it_no_second_one(flow):
    top, second, third, fourth = await four_players(flow)
    await crowns(flow)
    await award(flow, top, "probe_onyx")
    await crowns(flow)
    before = await crown_mail(flow)
    assert (top["id"], "crown_onyx") in before

    await flow.db.users.update_one({"id": top["id"]}, {"$set": {"privacy_achievements_public": False}})
    assert top["id"] not in await crowns(flow)
    assert await crown_mail(flow) == before, "Erfolge privat: keine Meldung"

    await flow.db.users.update_one({"id": top["id"]}, {"$set": {"privacy_achievements_public": True}})
    assert (await crowns(flow))[top["id"]] == "onyx"
    assert await crown_mail(flow) == before, "Onyx kommt zurück: keine zweite Meldung „Onyx erreicht“"


@pytest.mark.asyncio
async def test_dropping_from_onyx_to_gold_is_not_a_crown_won(flow):
    top, second, third, fourth = await four_players(flow)
    await crowns(flow)
    await award(flow, top, "probe_onyx")
    await crowns(flow)
    before = await crown_mail(flow)

    await flow.db.user_achievements.delete_many({"user_id": top["id"], "tier_code": "probe_onyx"})
    assert await crowns(flow) == {top["id"]: "gold", second["id"]: "silver", third["id"]: "bronze"}
    after = await crown_mail(flow)
    assert [row for row in after if row[0] == top["id"]] == [(top["id"], "crown_onyx")], "kein „Krone erobert“ nach Onyx"
    assert sorted(set(after) - set(before)) == sorted([
        (second["id"], "crown_changed"), (third["id"], "crown_changed"), (fourth["id"], "crown_lost")]), "die anderen wie bisher"


@pytest.mark.asyncio
async def test_first_onyx_without_a_rank_crown_is_announced_once(flow):
    top, second, third, fourth = await four_players(flow)
    climber = await person(flow, "aufsteiger")
    await crowns(flow)

    await award(flow, climber, "probe_onyx")
    assert (await crowns(flow))[climber["id"]] == "onyx"
    assert await crown_mail(flow) == [(climber["id"], "crown_onyx")], "die Rangkronen bleiben, wo sie sind"
    await crowns(flow)
    assert await crown_mail(flow) == [(climber["id"], "crown_onyx")], "ein zweiter Lauf meldet nichts"


@pytest.mark.asyncio
async def test_a_stored_state_without_onyx_list_only_announces_the_real_step_up(flow):
    top, second, third, fourth = await four_players(flow)
    veteran = await person(flow, "altonyx", "probe_onyx")
    # Stand vor #2501: nur die Rangkronen gespeichert, ``veteran`` trug Onyx schon.
    await flow.db.crown_state.insert_one({"id": "current", "version": 3,
                                          "holders": {top["id"]: "gold", second["id"]: "silver", third["id"]: "bronze"}})
    await crowns(flow)
    assert await crown_mail(flow) == [], "nichts hat sich geändert - auch der alte Onyx-Träger erfährt nichts"
    state = await flow.db.crown_state.find_one({"id": "current"}, {"_id": 0})
    assert state["onyx"] == [veteran["id"]]
    assert state["onyx_announced"] == [veteran["id"]], "wer schon Onyx trug, gilt als gemeldet"

    await award(flow, top, "probe_onyx")
    await crowns(flow)
    assert sorted(row for row in await crown_mail(flow) if row[1] == "crown_onyx") == [(top["id"], "crown_onyx")]

    # Der alte Onyx-Träger verliert Onyx und bekommt es zurück: auch jetzt keine Meldung.
    await flow.db.users.update_one({"id": veteran["id"]}, {"$set": {"is_banned": True}})
    await crowns(flow)
    await flow.db.users.update_one({"id": veteran["id"]}, {"$set": {"is_banned": False}})
    assert (await crowns(flow))[veteran["id"]] == "onyx"
    assert (veteran["id"], "crown_onyx") not in await crown_mail(flow)


@pytest.mark.asyncio
async def test_onyx_reached_stays_once_even_after_the_message_was_deleted(flow):
    top, second, third, fourth = await four_players(flow)
    await crowns(flow)
    await award(flow, top, "probe_onyx")
    await crowns(flow)
    assert (top["id"], "crown_onyx") in await crown_mail(flow)

    # „Gelesene löschen“ im Postfach, dann Onyx verlieren und zurückbekommen.
    await flow.db.notifications.delete_many({"user_id": top["id"]})
    await flow.db.users.update_one({"id": top["id"]}, {"$set": {"privacy_achievements_public": False}})
    await crowns(flow)
    await flow.db.users.update_one({"id": top["id"]}, {"$set": {"privacy_achievements_public": True}})
    assert (await crowns(flow))[top["id"]] == "onyx"
    assert [row for row in await crown_mail(flow) if row[0] == top["id"]] == [], "„Onyx erreicht“ kommt nur einmal"
    state = await flow.db.crown_state.find_one({"id": "current"}, {"_id": 0})
    assert top["id"] in state["onyx_announced"]


@pytest.mark.asyncio
async def test_a_legacy_state_still_turns_gold_to_onyx_into_onyx_reached(flow):
    top, second, third, fourth = await four_players(flow)
    await award(flow, top, "probe_onyx")
    await flow.db.crown_state.insert_one({"id": "current", "version": 3,
                                          "holders": {top["id"]: "gold", second["id"]: "silver", third["id"]: "bronze"}})
    await crowns(flow)
    mail = await crown_mail(flow)
    assert (top["id"], "crown_onyx") in mail and (top["id"], "crown_lost") not in mail
