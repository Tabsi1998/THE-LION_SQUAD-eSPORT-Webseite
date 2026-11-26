"""Saisonende-Moment (#1639, docs/LIGA.md „F.8 Saisonende-Moment“) über die echten Routen.

Drei Liga N mit je einer Staffel aus vier Co-Teams, alles gespielt. Erst der letzte Abschluss bestätigt den Endstand der ganzen Season -
dann gibt es den Moment für den Meister, die Auf- und die Absteiger. Geprüft: wer ihn bekommt (Einsatz wie F.4, Captain und Vertreter),
einmal je Person auch bei zwei Geräten zugleich, Ruhen beim Wiederöffnen, kein zweiter Moment für denselben Ausgang, ein geänderter
Ausgang still korrigiert, Season „Aus“, die Nachricht „Aufstieg bestätigt“ aus #1627 ohne Doppel, Hinweis an Profil und Teamseite.
Nur erfundene Namen.
"""
import asyncio
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_start_world import ADMIN, GAME, add_staffel, ok, season_body  # noqa: E402
from models import now_utc  # noqa: E402

STAFFELN = f"{ADMIN}/staffeln"
LONG_AGO = (now_utc() - timedelta(days=90)).isoformat()
UNSEEN = "/api/me/league-moments/unseen"
SEEN = "/api/me/league-moments/seen"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def regs_of(flow, tid: str) -> list[dict]:
    rows = await flow.db.tournament_registrations.find({"tournament_id": tid}, {"_id": 0}).to_list(None)
    return sorted(rows, key=lambda row: row["display_name"])


async def squad(flow, squad_id: str) -> dict:
    return await flow.db.team_squads.find_one({"id": squad_id}, {"_id": 0})


async def play(flow, tid: str, *, order=None) -> list[dict]:
    """Jeder gegen jeden. ``order``: Anmeldungen von stark nach schwach (sonst nach Namen). Aufgestellt sind je Co-Team das zweite
    (der Vertreter) und das dritte Kadermitglied - der Captain (erstes) und das vierte haben keinen Einsatz."""
    regs = await regs_of(flow, tid)
    ranking = order or [row["id"] for row in regs]
    strength = {reg_id: index for index, reg_id in enumerate(ranking)}
    lineup = {}
    for row in regs:
        members = (await squad(flow, row["squad_id"]))["member_ids"]
        lineup[row["id"]] = [members[1], members[2]]
    for match in await flow.db.matches_v2.find({"tournament_id": tid, "is_preview": {"$ne": True}}, {"_id": 0}).to_list(None):
        sides = [slot["registration_id"] for slot in match.get("slots") or [] if slot.get("registration_id")]
        if len(sides) != 2:
            continue
        winner, loser = sorted(sides, key=lambda value: strength[value])
        await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {
            "status": "completed", "completed_at": LONG_AGO, "lineups": {side: lineup[side] for side in sides},
            "results": [{"registration_id": winner, "rank": 1, "score": 2}, {"registration_id": loser, "rank": 2, "score": 0}]}})
    return regs


async def build(flow, *, levels: int = 3, visibility: str = "public") -> dict:
    lead = await flow.add_staff()
    flow.act_as(lead)
    game = ok(await flow.post("/api/games", json=GAME))
    league = ok(await flow.post(ADMIN, json={"name": "Moment-Liga", "game_id": game["id"]}))
    season = ok(await flow.post(f"{ADMIN}/{league['id']}/seasons", json=season_body(visibility=visibility)))
    world = {"lead": lead, "league": league, "season": season, "divisions": [], "tids": [], "regs": {}}
    for level in range(1, levels + 1):
        division = ok(await flow.post(f"{ADMIN}/seasons/{season['id']}/divisions", json={}))
        tid = await add_staffel(flow, lead, division["id"], 4, game=game, prefix=f"L{level}")
        flow.act_as(lead)
        ok(await flow.post(f"/api/tournaments/{tid}/status", json={"status": "live"}))
        world["divisions"].append(division)
        world["tids"].append(tid)
        world["regs"][level] = await play(flow, tid)
    return world


async def close(flow, world: dict, *levels: int) -> None:
    flow.act_as(world["lead"])
    for level in levels or range(1, len(world["tids"]) + 1):
        ok(await flow.post(f"{STAFFELN}/{world['tids'][level - 1]}/close", json={"confirm": True}))


async def reopen(flow, world: dict, level: int) -> None:
    second = await flow.add_staff(name="Zweite Leitung")
    flow.act_as(second)
    ok(await flow.post(f"{STAFFELN}/{world['tids'][level - 1]}/reopen", json={"reason": "Ergebnis war falsch eingetragen"}))


async def people(flow, world: dict, level: int, index: int) -> dict:
    """Kader des Co-Teams auf Platz ``index + 1``: Captain, Vertreter, die beiden Aufgestellten und wer keinen Einsatz hatte."""
    row = world["regs"][level][index]
    doc = await squad(flow, row["squad_id"])
    users = {user["id"]: user for user in await flow.db.users.find({"id": {"$in": doc["member_ids"]}}, {"_id": 0}).to_list(None)}
    members = doc["member_ids"]
    return {"squad_id": row["squad_id"], "team_id": doc["team_id"], "captain": users[doc["captain_id"]], "vice": users[doc["vice_captain_id"]],
            "fielded": [users[members[1]], users[members[2]]], "bench": users[members[3]], "registration_id": row["id"]}


async def moments_of(flow, world: dict) -> dict[str, dict]:
    rows = await flow.db.league_moments.find({"season_id": world["season"]["id"]}, {"_id": 0}).to_list(None)
    return {row["squad_id"]: row for row in rows}


async def unseen(flow, user: dict) -> list[dict]:
    flow.act_as(user)
    return ok(await flow.get(UNSEEN))["moments"]


async def profile_moments(flow, user: dict, viewer: dict | None = None) -> list[dict]:
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"privacy_public_profile": True}})
    flow.act_as(viewer)
    return ok(await flow.get(f"/api/users/public/{user['username']}"))["league_moments"]


async def notes(flow, user: dict) -> list[dict]:
    return await flow.db.notifications.find({"user_id": user["id"], "meta.reason": "league_moment"}, {"_id": 0}).to_list(None)


# ---------------------------------------------------------------- Quelle: der bestätigte Endstand der ganzen Season

@pytest.mark.asyncio
async def test_no_moment_until_the_whole_season_is_confirmed(flow):
    world = await build(flow)
    await close(flow, world, 1, 2)
    up = await people(flow, world, 2, 0)
    champion = await people(flow, world, 1, 0)
    # Zwei von drei Staffeln abgeschlossen: Meister und Aufsteiger stehen in den Tabellen, aber die Season ist nicht bestätigt.
    assert await moments_of(flow, world) == {}
    assert await unseen(flow, up["fielded"][0]) == []
    assert await unseen(flow, champion["fielded"][0]) == []
    await close(flow, world, 3)
    found = await moments_of(flow, world)
    outcomes = {squad_id: (row["outcome"], row["from"]["level"], row["to"]["level"]) for squad_id, row in found.items()}
    regs = world["regs"]
    assert outcomes == {
        regs[1][0]["squad_id"]: ("champion", 1, 1),
        regs[1][3]["squad_id"]: ("down", 1, 2),
        regs[2][0]["squad_id"]: ("up", 2, 1),
        regs[2][3]["squad_id"]: ("down", 2, 3),
        regs[3][0]["squad_id"]: ("up", 3, 2),
    }
    # Wer bleibt, bekommt keinen Moment.
    assert regs[2][1]["squad_id"] not in found and regs[3][3]["squad_id"] not in found


@pytest.mark.asyncio
async def test_audience_is_fielded_players_with_captain_and_vice(flow):
    world = await build(flow)
    await close(flow, world)
    up = await people(flow, world, 2, 0)
    doc = (await moments_of(flow, world))[up["squad_id"]]
    fielded = sorted(user["id"] for user in up["fielded"])
    assert doc["player_ids"] == fielded
    assert set(doc["audience_ids"]) == {*fielded, up["captain"]["id"], up["vice"]["id"]}
    # Ohne Einsatz kein Moment (F.4, Nr. 163) - wer nur im Kader stand, sieht ihn nicht.
    assert up["bench"]["id"] not in doc["audience_ids"]
    assert await unseen(flow, up["bench"]) == []
    moment = (await unseen(flow, up["fielded"][0]))[0]
    assert moment["outcome"] == "up" and moment["to"]["level"] == 1 and moment["from"]["level"] == 2
    assert moment["texts"]["kicker"] == "Aufstieg"
    assert moment["badge_to"] == {"level": 1, "nickname": None, "champion": False}
    assert not {"audience_ids", "player_ids", "seen_by"} & set(moment)
    # Eine fremde Person sieht ihn nie.
    stranger = await flow.add_user(name="Fremder Gast")
    assert await unseen(flow, stranger) == []


@pytest.mark.asyncio
async def test_champion_moment_is_gold_and_first(flow):
    world = await build(flow)
    await close(flow, world)
    champion = await people(flow, world, 1, 0)
    rows = await unseen(flow, champion["fielded"][0])
    assert [row["outcome"] for row in rows] == ["champion"]
    assert rows[0]["badge_to"]["champion"] is True
    assert rows[0]["texts"]["line"] == "Platz 1 im Endstand der Season."


# ---------------------------------------------------------------- Einmal je Person, auf jedem Gerät

@pytest.mark.asyncio
async def test_seen_once_even_on_two_devices_at_the_same_time(flow):
    world = await build(flow)
    await close(flow, world)
    up = await people(flow, world, 2, 0)
    player = up["fielded"][0]
    moment = (await unseen(flow, player))[0]
    flow.act_as(player)
    first, second = await asyncio.gather(flow.post(SEEN, json={"ids": [moment["id"]]}), flow.post(SEEN, json={"ids": [moment["id"]]}))
    claimed = [ok(first)["claimed"], ok(second)["claimed"]]
    assert sorted(len(row) for row in claimed) == [0, 1]
    # Neu laden, anderes Gerät: kein zweites Mal.
    assert await unseen(flow, player) == []
    assert ok(await flow.post(SEEN, json={"ids": [moment["id"]]}))["claimed"] == []
    # Die anderen sehen ihn weiter - gesehen gilt je Person.
    assert len(await unseen(flow, up["fielded"][1])) == 1
    # Fremde Kennungen trägt niemand ein.
    stranger = await flow.add_user(name="Fremder Gast")
    flow.act_as(stranger)
    assert ok(await flow.post(SEEN, json={"ids": [moment["id"]]}))["claimed"] == []


@pytest.mark.asyncio
async def test_one_message_per_person_and_a_second_sync_changes_nothing(flow):
    from services import league_moments

    world = await build(flow)
    await close(flow, world)
    up = await people(flow, world, 2, 0)
    for user in [*up["fielded"], up["captain"], up["vice"]]:
        rows = await notes(flow, user)
        assert len(rows) == 1, user["display_name"]
        assert rows[0]["kind"] == "league_reward" and rows[0]["title"] == "Aufstieg in Liga 1"
    assert await notes(flow, up["bench"]) == []
    before = await moments_of(flow, world)
    await asyncio.gather(league_moments.sync(flow.db, world["season"]["id"]), league_moments.sync(flow.db, world["season"]["id"]))
    after = await moments_of(flow, world)
    assert {key: (row["id"], row["seq"]) for key, row in after.items()} == {key: (row["id"], row["seq"]) for key, row in before.items()}
    assert len(await notes(flow, up["fielded"][0])) == 1


# ---------------------------------------------------------------- Korrigierter Endstand

@pytest.mark.asyncio
async def test_reopen_suspends_and_the_same_outcome_never_comes_twice(flow):
    world = await build(flow)
    await close(flow, world)
    up = await people(flow, world, 2, 0)
    seen_by, waiting = up["fielded"]
    moment = (await unseen(flow, seen_by))[0]
    flow.act_as(seen_by)
    ok(await flow.post(SEEN, json={"ids": [moment["id"]]}))
    await reopen(flow, world, 3)
    # Der Endstand steht nicht mehr fest: nichts zu sehen, kein Hinweis im Profil.
    assert (await moments_of(flow, world))[up["squad_id"]]["suspended"] is True
    assert await unseen(flow, waiting) == []
    assert await profile_moments(flow, waiting) == []
    await close(flow, world, 3)
    doc = (await moments_of(flow, world))[up["squad_id"]]
    assert doc["suspended"] is False and doc["seq"] == 1 and doc["id"] == moment["id"]
    assert await unseen(flow, seen_by) == []
    assert [row["id"] for row in await unseen(flow, waiting)] == [moment["id"]]
    # Kein zweites „Aufstieg“ für denselben Ausgang.
    assert len(await notes(flow, seen_by)) == 1


@pytest.mark.asyncio
async def test_changed_outcome_is_corrected_quietly_without_doubles(flow):
    world = await build(flow)
    await close(flow, world)
    old = await people(flow, world, 2, 0)
    player = old["fielded"][0]
    moment = (await unseen(flow, player))[0]
    flow.act_as(player)
    ok(await flow.post(SEEN, json={"ids": [moment["id"]]}))
    await reopen(flow, world, 2)
    regs = world["regs"][2]
    # Korrektur: Das bisher zweite Co-Team gewinnt alles.
    await play(flow, world["tids"][1], order=[regs[1]["id"], regs[0]["id"], regs[2]["id"], regs[3]["id"]])
    await close(flow, world, 2)
    found = await moments_of(flow, world)
    assert found[old["squad_id"]]["active"] is False
    assert found[regs[1]["squad_id"]]["outcome"] == "up" and found[regs[1]["squad_id"]]["active"] is True
    # Wer den Aufstieg sah, bekommt keinen neuen Moment - nur still „Endstand korrigiert“ (Postfach, kein Push).
    assert await unseen(flow, player) == []
    rows = sorted(await notes(flow, player), key=lambda row: row["created_at"])
    assert [row["title"] for row in rows] == ["Aufstieg in Liga 1", "Endstand korrigiert"]
    assert rows[1]["meta"].get("in_app_only") is True
    new = await people(flow, world, 2, 1)
    assert [row["outcome"] for row in await unseen(flow, new["fielded"][0])] == ["up"]
    assert await profile_moments(flow, player) == []


# ---------------------------------------------------------------- Season-Schalter und #1627

@pytest.mark.asyncio
async def test_season_off_shows_nothing_until_it_is_switched_on(flow):
    world = await build(flow)
    await close(flow, world, 1, 2)
    flow.act_as(world["lead"])
    ok(await flow.patch(f"{ADMIN}/seasons/{world['season']['id']}", json={"visibility": "off"}))
    await close(flow, world, 3)
    up = await people(flow, world, 2, 0)
    assert up["squad_id"] in await moments_of(flow, world)
    assert await unseen(flow, up["fielded"][0]) == []
    assert await notes(flow, up["fielded"][0]) == []
    flow.act_as(up["fielded"][0])
    assert ok(await flow.get(f"/api/teams/{up['team_id']}"))["league_moments"] == []
    assert await profile_moments(flow, up["fielded"][0], up["fielded"][0]) == []
    flow.act_as(world["lead"])
    ok(await flow.patch(f"{ADMIN}/seasons/{world['season']['id']}",
                        json={"visibility": "public", "readiness_override_reason": "Testaufbau ohne Prüfung"}))
    assert len(await notes(flow, up["fielded"][0])) == 1
    assert [row["outcome"] for row in await unseen(flow, up["fielded"][0])] == ["up"]


@pytest.mark.asyncio
async def test_captains_with_start_rights_announce_get_no_second_message(flow):
    world = await build(flow)
    await flow.db.league_seasons.update_one({"id": world["season"]["id"]}, {"$set": {"start_rights": {"mode": "accept", "announce": True}}})
    await close(flow, world)
    up = await people(flow, world, 2, 0)
    # „Aufstieg bestätigt“ (#1627) erreicht Captain und Vertreter schon - der Moment schickt ihnen keine zweite Nachricht …
    assert await notes(flow, up["captain"]) == [] and await notes(flow, up["vice"]) == []
    # Der Vertreter war aufgestellt (``fielded[0]``) - zählt aber als Vertreter; der zweite Aufgestellte bekommt die Nachricht.
    assert up["fielded"][0]["id"] == up["vice"]["id"]
    assert len(await notes(flow, up["fielded"][1])) == 1
    # … zeigt ihnen den Moment aber trotzdem.
    assert [row["outcome"] for row in await unseen(flow, up["captain"])] == ["up"]
    champion = await people(flow, world, 1, 0)
    assert len(await notes(flow, champion["captain"])) == 1


# ---------------------------------------------------------------- Hinweis an Profil und Teamseite

@pytest.mark.asyncio
async def test_hint_on_profile_and_team_page(flow):
    world = await build(flow)
    await close(flow, world)
    up = await people(flow, world, 2, 0)
    rows = await profile_moments(flow, up["fielded"][0])
    assert [(row["outcome"], row["to"]["label"]) for row in rows] == [("up", "Liga 1")]
    assert rows[0]["url"]
    # Andere sehen den Hinweis nur bei den Spielern (wie die Season-Historie) - die Person selbst auch als Captain.
    captain = up["captain"]
    if captain["id"] not in [user["id"] for user in up["fielded"]]:
        assert await profile_moments(flow, captain) == []
        assert [row["outcome"] for row in await profile_moments(flow, captain, captain)] == ["up"]
    flow.act_as(None)
    team = ok(await flow.get(f"/api/teams/{up['team_id']}"))
    assert [(row["outcome"], row["squad_id"]) for row in team["league_moments"]] == [("up", up["squad_id"])]
