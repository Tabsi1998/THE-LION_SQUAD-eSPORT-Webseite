"""Saisonende-Moment (#1639, docs/LIGA.md „F.8 Saisonende-Moment“) über die echten Routen.

Drei Liga N mit je einer Staffel aus vier Co-Teams, alles gespielt. Erst der letzte Abschluss bestätigt den Endstand der ganzen Season -
dann gibt es den Moment für den Meister, die Auf- und die Absteiger. Geprüft: wer ihn bekommt (Einsatz wie F.4: kampflose Spiele
zählen nicht; Captain und Vertreter, nie wer nur angemeldet hat), einmal je Person auch bei zwei Geräten zugleich und nach einer
verlorenen Antwort, Ruhen beim Wiederöffnen, kein zweiter Moment für denselben Ausgang, ein geänderter Ausgang einmal neu mit
„Endstand korrigiert“, Season „Aus“ und „Nur Liga-Leitung“, Meister mit Belohnungen in einem Ablauf und mit einer Nachricht, die
Nachricht „Aufstieg bestätigt“ aus #1627 ohne Doppel, ein ausgelassener Abgleich holt nach, gleichzeitige Abschlüsse, Dauer je Season,
Kontolöschung, Hinweis an Profil und Teamseite. Nur erfundene Namen.
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
DONE = "/api/me/league-moments/done"
GOLD = {"kind": "medal", "name": "Goldmedaille", "places": {"mode": "rank", "rank": 1}, "recipients": ["team", "players"]}


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


async def build(flow, *, levels: int = 3, visibility: str = "public", rewards: list | None = None) -> dict:
    lead = await flow.add_staff()
    flow.act_as(lead)
    game = ok(await flow.post("/api/games", json=GAME))
    league = ok(await flow.post(ADMIN, json={"name": "Moment-Liga", "game_id": game["id"]}))
    season = ok(await flow.post(f"{ADMIN}/{league['id']}/seasons", json=season_body(visibility=visibility)))
    world = {"lead": lead, "league": league, "season": season, "divisions": [], "tids": [], "regs": {}}
    if rewards is not None:
        ok(await flow.put(f"{ADMIN}/seasons/{season['id']}/rewards", json={"items": rewards}))
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


async def notes(flow, user: dict, reason: str = "league_moment") -> list[dict]:
    return await flow.db.notifications.find({"user_id": user["id"], "meta.reason": reason}, {"_id": 0}).to_list(None)


async def claim(flow, user: dict, moment_id: str, token: str = "geraet-eins-1234") -> list[str]:
    flow.act_as(user)
    return ok(await flow.post(SEEN, json={"ids": [moment_id], "token": token}))["claimed"]


async def see(flow, user: dict, moment_id: str, token: str = "geraet-eins-1234") -> None:
    """Gezeigt und geschlossen: erst geholt (``seen`` mit Token), dann fertig (``done``)."""
    assert await claim(flow, user, moment_id, token) == [moment_id]
    flow.act_as(user)
    ok(await flow.post(DONE, json={"ids": [moment_id]}))


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
    first, second = await asyncio.gather(flow.post(SEEN, json={"ids": [moment["id"]], "token": "geraet-eins-1234"}),
                                         flow.post(SEEN, json={"ids": [moment["id"]], "token": "geraet-zwei-5678"}))
    claimed = [ok(first)["claimed"], ok(second)["claimed"]]
    assert sorted(len(row) for row in claimed) == [0, 1]
    winner = "geraet-eins-1234" if claimed[0] else "geraet-zwei-5678"
    loser = "geraet-zwei-5678" if claimed[0] else "geraet-eins-1234"
    # Das andere Gerät bekommt ihn nicht - auch nicht beim nächsten Versuch.
    assert await claim(flow, player, moment["id"], loser) == []
    ok(await flow.post(DONE, json={"ids": [moment["id"]]}))
    # Neu laden nach dem Schließen: kein zweites Mal, auf keinem Gerät.
    assert await unseen(flow, player) == []
    assert await claim(flow, player, moment["id"], winner) == []
    # Die anderen sehen ihn weiter - gesehen gilt je Person.
    assert len(await unseen(flow, up["fielded"][1])) == 1
    # Fremde Kennungen trägt niemand ein.
    stranger = await flow.add_user(name="Fremder Gast")
    assert await claim(flow, stranger, moment["id"]) == []


@pytest.mark.asyncio
async def test_a_lost_answer_brings_the_moment_back_on_the_same_device(flow):
    world = await build(flow)
    await close(flow, world)
    player = (await people(flow, world, 2, 0))["fielded"][1]
    moment = (await unseen(flow, player))[0]
    # Die Antwort auf das Holen geht verloren: Das Gerät hat nichts gezeigt.
    assert await claim(flow, player, moment["id"], "geraet-eins-1234") == [moment["id"]]
    # Beim nächsten Besuch kommt er wieder - dasselbe Gerät (gemerkter Schlüssel) bekommt ihn erneut, ein anderes nicht.
    assert [row["id"] for row in await unseen(flow, player)] == [moment["id"]]
    assert await claim(flow, player, moment["id"], "geraet-eins-1234") == [moment["id"]]
    assert await claim(flow, player, moment["id"], "geraet-zwei-5678") == []
    # Liegt das Holen lange zurück (Gerät verloren), darf ein anderes Gerät ihn zeigen.
    await flow.db.league_moments.update_one({"id": moment["id"]}, {"$set": {f"claims.{player['id']}.at": LONG_AGO}})
    assert await claim(flow, player, moment["id"], "geraet-zwei-5678") == [moment["id"]]


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


# ---------------------------------------------------------------- M2: kampflose Spiele zählen nicht, wer angemeldet hat, ist nicht Captain

@pytest.mark.asyncio
async def test_a_substitute_only_in_a_forfeit_gets_nothing(flow):
    world = await build(flow, levels=2)
    up = await people(flow, world, 2, 0)
    # Der Ersatz (viertes Kadermitglied) steht nur in einem kampflos gewerteten Spiel in der Aufstellung.
    match = await flow.db.matches_v2.find_one({"tournament_id": world["tids"][1], "slots.registration_id": up["registration_id"]}, {"_id": 0})
    lineups = {**match["lineups"], up["registration_id"]: [up["bench"]["id"]]}
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"status": "forfeit", "lineups": lineups}})
    await close(flow, world)
    doc = (await moments_of(flow, world))[up["squad_id"]]
    assert up["bench"]["id"] not in doc["player_ids"] and up["bench"]["id"] not in doc["audience_ids"]
    assert await unseen(flow, up["bench"]) == [] and await notes(flow, up["bench"]) == []
    assert await profile_moments(flow, up["bench"]) == []
    # Captain und Vertreter des Co-Teams - nie die Leitung, die die Anmeldung angelegt hat.
    assert doc["responsible_ids"] == sorted([up["captain"]["id"], up["vice"]["id"]])
    assert world["lead"]["id"] not in doc["audience_ids"]


# ---------------------------------------------------------------- Korrigierter Endstand

@pytest.mark.asyncio
async def test_reopen_suspends_and_the_same_outcome_never_comes_twice(flow):
    world = await build(flow)
    await close(flow, world)
    up = await people(flow, world, 2, 0)
    seen_by, waiting = up["fielded"]
    moment = (await unseen(flow, seen_by))[0]
    await see(flow, seen_by, moment["id"])
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
async def test_changed_outcome_comes_once_more_with_the_correction_notice(flow):
    world = await build(flow)
    await close(flow, world)
    old = await people(flow, world, 2, 0)
    new = await people(flow, world, 2, 1)
    player = old["fielded"][1]
    moment = (await unseen(flow, player))[0]
    await see(flow, player, moment["id"])
    await reopen(flow, world, 2)
    regs = world["regs"][2]
    # Korrektur: Das bisher zweite Co-Team gewinnt alles - das bisher erste bleibt in Liga 2.
    await play(flow, world["tids"][1], order=[regs[1]["id"], regs[0]["id"], regs[2]["id"], regs[3]["id"]])
    await close(flow, world, 2)
    found = await moments_of(flow, world)
    assert found[old["squad_id"]]["active"] is False
    # Das alte Team bleibt: kein Moment, kein Hinweis - nur still „Endstand korrigiert“ für alle, die davon erfuhren.
    assert await unseen(flow, player) == [] and await profile_moments(flow, player) == []
    rows = sorted(await notes(flow, player), key=lambda row: row["created_at"])
    assert [row["title"] for row in rows] == ["Aufstieg in Liga 1", "Endstand korrigiert"]
    assert rows[1]["meta"].get("in_app_only") is True
    first = [row["outcome"] for row in await unseen(flow, new["fielded"][1])]
    assert first == ["up"]
    # Das neue Team steigt auf. Dann korrigiert die Leitung noch einmal: Es steigt doch nicht auf, dann doch wieder - ein
    # geänderter Ausgang kommt einmal neu mit dem Hinweis, auch für alle, die ihn schon gesehen haben.
    new_moment = (await unseen(flow, new["fielded"][1]))[0]
    await see(flow, new["fielded"][1], new_moment["id"])
    await reopen(flow, world, 2)
    await play(flow, world["tids"][1], order=[regs[2]["id"], regs[1]["id"], regs[0]["id"], regs[3]["id"]])
    await close(flow, world, 2)
    await reopen(flow, world, 2)
    await play(flow, world["tids"][1], order=[regs[1]["id"], regs[0]["id"], regs[2]["id"], regs[3]["id"]])
    await close(flow, world, 2)
    again = await unseen(flow, new["fielded"][1])
    assert [row["id"] for row in again] == [new_moment["id"]]
    assert again[0]["corrected"] is True and again[0]["texts"]["notice"] == "Endstand korrigiert"
    latest = sorted(await notes(flow, new["fielded"][1]), key=lambda row: row["created_at"])[-1]
    assert latest["title"] == "Endstand korrigiert" and not latest["meta"].get("in_app_only")
    # Einmal: danach nicht mehr.
    await see(flow, new["fielded"][1], new_moment["id"], token="geraet-eins-zweimal")
    assert await unseen(flow, new["fielded"][1]) == []


# ---------------------------------------------------------------- M1: ein ausgelassener Abgleich holt nach

class BusyLock:
    """Die Sperre des Abgleichs ist belegt (ein anderer Abgleich läuft) - auf echtem MongoDB wie auf dem Ersatz gleich."""

    def __init__(self, *_args, **_kwargs):
        pass

    async def __aenter__(self):
        from services.mutation_lock import MutationLockBusy

        raise MutationLockBusy("league_season:moments")

    async def __aexit__(self, *_exc):
        return False


@pytest.mark.asyncio
async def test_a_skipped_sync_is_caught_up_and_reads_never_trust_a_stale_moment(flow, monkeypatch):
    from services import league_moments, mutation_lock

    world = await build(flow)
    season_id = world["season"]["id"]
    await close(flow, world, 1, 2)
    real_lock = mutation_lock.mutation_lock
    # Ein anderer Abgleich hält die Sperre: Der letzte Abschluss lässt aus - die Marke an der Season bleibt.
    monkeypatch.setattr(mutation_lock, "mutation_lock", lambda db, resource, **kwargs: BusyLock() if ":moments" in resource
                        else real_lock(db, resource, **kwargs))
    await close(flow, world, 3)
    monkeypatch.setattr(mutation_lock, "mutation_lock", real_lock)
    assert await moments_of(flow, world) == {}
    assert (await flow.db.league_seasons.find_one({"id": season_id}, {"_id": 0}))[league_moments.PENDING_FIELD]
    await league_moments.sweep(flow.db)
    assert len(await moments_of(flow, world)) == 5
    assert league_moments.PENDING_FIELD not in await flow.db.league_seasons.find_one({"id": season_id}, {"_id": 0})
    up = await people(flow, world, 2, 0)
    moment = (await unseen(flow, up["fielded"][1]))[0]
    # Wiederöffnen, während die Sperre belegt ist: Der Moment steht noch aktiv da - gelesen und geholt wird er trotzdem nicht.
    monkeypatch.setattr(mutation_lock, "mutation_lock", lambda db, resource, **kwargs: BusyLock() if ":moments" in resource
                        else real_lock(db, resource, **kwargs))
    await reopen(flow, world, 3)
    monkeypatch.setattr(mutation_lock, "mutation_lock", real_lock)
    assert (await moments_of(flow, world))[up["squad_id"]]["suspended"] is False
    assert await unseen(flow, up["fielded"][1]) == []
    assert await claim(flow, up["fielded"][1], moment["id"]) == []
    await league_moments.sweep(flow.db)
    assert (await moments_of(flow, world))[up["squad_id"]]["suspended"] is True


@pytest.mark.asyncio
async def test_two_closes_at_once_give_one_moment_each(flow):
    world = await build(flow)
    await close(flow, world, 1)
    flow.act_as(world["lead"])
    answers = await asyncio.gather(*[flow.post(f"{STAFFELN}/{tid}/close", json={"confirm": True}) for tid in world["tids"][1:]])
    assert all(answer.status_code == 200 for answer in answers), [answer.text for answer in answers]
    found = await flow.db.league_moments.find({"season_id": world["season"]["id"]}, {"_id": 0}).to_list(None)
    assert len(found) == len({row["key"] for row in found}) == 5
    up = await people(flow, world, 2, 0)
    assert len(await notes(flow, up["fielded"][1])) == 1


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
async def test_a_season_for_the_lead_only_waits_until_members_see_it(flow):
    world = await build(flow, visibility="admins")
    up = await people(flow, world, 2, 0)
    # Der Captain ist zugleich in der Liga-Leitung - er sähe die Season, Mitglieder nicht.
    await flow.db.league_staff.insert_one({"id": "staff-captain", "league_id": world["league"]["id"], "user_id": up["captain"]["id"],
                                           "capabilities": ["matches"], "created_at": now_utc().isoformat()})
    await close(flow, world)
    assert up["squad_id"] in await moments_of(flow, world)
    assert await unseen(flow, up["captain"]) == [] and await notes(flow, up["captain"]) == []
    assert await profile_moments(flow, up["captain"], up["captain"]) == []
    flow.act_as(up["captain"])
    assert ok(await flow.get(f"/api/teams/{up['team_id']}"))["league_moments"] == []
    flow.act_as(world["lead"])
    ok(await flow.patch(f"{ADMIN}/seasons/{world['season']['id']}",
                        json={"visibility": "members", "readiness_override_reason": "Testaufbau ohne Prüfung"}))
    assert len(await notes(flow, up["captain"])) == 1
    assert [row["outcome"] for row in await unseen(flow, up["captain"])] == ["up"]


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
    # Liga 1 schloss vor der ganzen Season: Der Captain des Meisters hörte „Staffel abgeschlossen … Meister“ schon - kein zweites Mal (M3).
    assert await league_titles(flow, champion["captain"]) == ["Staffel abgeschlossen"]


# ---------------------------------------------------------------- Meister mit Belohnungen: ein Ablauf, eine Nachricht (Fabian 26.11., A)

@pytest.mark.asyncio
async def test_champion_with_rewards_is_one_flow_and_one_message(flow):
    # Eine Liga N: Der Abschluss bestätigt die Season - der Moment erreicht den Meister sofort.
    world = await build(flow, levels=1, rewards=[GOLD])
    champion = await people(flow, world, 1, 0)
    other = await people(flow, world, 1, 1)
    player = champion["fielded"][1]
    await close(flow, world)
    moment = (await unseen(flow, player))[0]
    assert moment["outcome"] == "champion"
    assert [row["reward"]["name"] for row in moment["rewards"]] == ["Goldmedaille"]
    flow.act_as(player)
    assert ok(await flow.get("/api/me/rewards/unseen"))["rewards"] == []
    # Eine Nachricht je Person: der Meister mit der Belohnung - keine eigene „Neue Belohnung“, kein „Staffel abgeschlossen“.
    for person in [player, champion["captain"], champion["vice"]]:
        assert await league_titles(flow, person) == ["Meister: " + world["regs"][1][0]["display_name"]], person["display_name"]
        assert "Goldmedaille" in (await notes(flow, person))[0]["body"]
    # Die anderen Captains erfahren den Abschluss wie bisher.
    assert [row["title"] for row in await notes(flow, other["captain"], "league_final")] == ["Staffel abgeschlossen"]
    # Gesehen: Moment und Belohnungen sind durch - nichts kommt noch einmal.
    await see(flow, player, moment["id"])
    flow.act_as(player)
    ok(await flow.post("/api/me/rewards/seen", json={"ids": [row["id"] for row in moment["rewards"]]}))
    assert await unseen(flow, player) == [] and ok(await flow.get("/api/me/rewards/unseen"))["rewards"] == []
    # Wer den Moment schloss, ohne die Belohnungen zu sehen (Abbruch dazwischen), bekommt sie danach wie bisher.
    other_player = champion["fielded"][0]
    other_moment = (await unseen(flow, other_player))[0]
    await see(flow, other_player, other_moment["id"])
    flow.act_as(other_player)
    assert [row["reward"]["name"] for row in ok(await flow.get("/api/me/rewards/unseen"))["rewards"]] == ["Goldmedaille"]


# ---------------------------------------------------------------- M3: nur zurückhalten, wenn der Moment die Person erreicht

async def league_titles(flow, person: dict) -> list[str]:
    rows = await flow.db.notifications.find({"user_id": person["id"], "meta.reason": {"$in": ["league_moment", "league_reward", "league_final"]}},
                                            {"_id": 0}).sort("created_at", 1).to_list(None)
    return [row["title"] for row in rows]


async def rewards_unseen(flow, person: dict) -> list[str]:
    flow.act_as(person)
    return [row["reward"]["name"] for row in ok(await flow.get("/api/me/rewards/unseen"))["rewards"]]


@pytest.mark.asyncio
async def test_m3_a_season_not_yet_confirmed_celebrates_the_reward_as_before_and_never_twice(flow):
    world = await build(flow, levels=2, rewards=[GOLD])
    champion = await people(flow, world, 1, 0)
    player = champion["fielded"][1]
    name = world["regs"][1][0]["display_name"]
    await close(flow, world, 1)
    # Liga 2 ist noch offen: Ein Moment kann (noch) niemanden erreichen - Belohnung und Abschluss melden sich wie vor #1639.
    assert await league_titles(flow, player) == ["Neue Belohnung"]
    assert await rewards_unseen(flow, player) == ["Goldmedaille"]
    assert sorted(await league_titles(flow, champion["captain"])) == ["Belohnung für euer Team", "Staffel abgeschlossen"]
    await close(flow, world, 2)
    # Später bestätigt: der Meister-Moment - ohne die Belohnung noch einmal zu nennen; der Captain hörte „Meister“ schon.
    titles = await league_titles(flow, player)
    assert titles == ["Neue Belohnung", f"Meister: {name}"]
    assert "Goldmedaille" not in (await notes(flow, player))[0]["body"]
    assert sorted(await league_titles(flow, champion["captain"])) == ["Belohnung für euer Team", "Staffel abgeschlossen"]


@pytest.mark.asyncio
async def test_m3_a_season_for_the_lead_only_celebrates_the_reward_as_before(flow):
    world = await build(flow, levels=1, visibility="admins", rewards=[GOLD])
    champion = await people(flow, world, 1, 0)
    player = champion["fielded"][1]
    name = world["regs"][1][0]["display_name"]
    await close(flow, world)
    assert await league_titles(flow, player) == ["Neue Belohnung"]
    assert await rewards_unseen(flow, player) == ["Goldmedaille"]
    assert "Staffel abgeschlossen" in await league_titles(flow, champion["captain"])
    # Wird die Season sichtbar, kommt der Moment - ohne doppelte Nachricht.
    flow.act_as(world["lead"])
    ok(await flow.patch(f"{ADMIN}/seasons/{world['season']['id']}",
                        json={"visibility": "public", "readiness_override_reason": "Testaufbau ohne Prüfung"}))
    assert await league_titles(flow, player) == ["Neue Belohnung", f"Meister: {name}"]
    assert "Goldmedaille" not in (await notes(flow, player))[0]["body"]
    assert sorted(await league_titles(flow, champion["captain"])) == ["Belohnung für euer Team", "Staffel abgeschlossen"]


@pytest.mark.asyncio
async def test_m3_a_player_who_cannot_see_a_members_season_gets_the_reward_as_before(flow):
    world = await build(flow, levels=1, visibility="members", rewards=[GOLD])
    champion = await people(flow, world, 1, 0)
    player = champion["fielded"][1]
    await close(flow, world)
    # Kein Vereinsmitglied: Die Season „Nur Mitglieder“ sieht er nicht - also auch keinen Moment.
    assert await unseen(flow, player) == []
    assert await league_titles(flow, player) == ["Neue Belohnung"]
    assert await rewards_unseen(flow, player) == ["Goldmedaille"]


@pytest.mark.asyncio
async def test_m3_a_champion_without_co_team_hears_as_before(flow):
    world = await build(flow, levels=1, rewards=[GOLD])
    champion = await people(flow, world, 1, 0)
    player = champion["fielded"][1]
    # Die Anmeldung des Meisters hat kein Co-Team: Es gibt keinen Moment für ihn.
    await flow.db.tournament_registrations.update_one({"id": champion["registration_id"]}, {"$set": {"squad_id": None}})
    await close(flow, world)
    assert champion["squad_id"] not in await moments_of(flow, world)
    assert await league_titles(flow, player) == ["Neue Belohnung"]
    assert await rewards_unseen(flow, player) == ["Goldmedaille"]


# ---------------------------------------------------------------- Dauer je Season (Fabian 26.11., D)

@pytest.mark.asyncio
async def test_how_long_the_moment_waits_is_set_per_season(flow):
    world = await build(flow)
    flow.act_as(world["lead"])
    view = ok(await flow.get(f"{ADMIN}/seasons/{world['season']['id']}/rewards"))
    assert view["moment_days"] == 45 and view["moment_days_default"] == 45
    refused = await flow.put(f"{ADMIN}/seasons/{world['season']['id']}/rewards", json={"moment_days": 400})
    assert refused.status_code == 422
    ok(await flow.put(f"{ADMIN}/seasons/{world['season']['id']}/rewards", json={"moment_days": 2}))
    await close(flow, world)
    player = (await people(flow, world, 2, 0))["fielded"][1]
    assert len(await unseen(flow, player)) == 1
    three_days_ago = (now_utc() - timedelta(days=3)).isoformat()
    await flow.db.league_moments.update_many({"season_id": world["season"]["id"]}, {"$set": {"confirmed_at": three_days_ago}})
    assert await unseen(flow, player) == []
    # Der Hinweis bleibt.
    assert len(await profile_moments(flow, player)) == 1


# ---------------------------------------------------------------- Kontolöschung

@pytest.mark.asyncio
async def test_deleting_an_account_removes_the_person_but_keeps_the_moment(flow):
    from services import league_moments

    world = await build(flow)
    await close(flow, world)
    up = await people(flow, world, 2, 0)
    player = up["fielded"][1]
    moment = (await unseen(flow, player))[0]
    await see(flow, player, moment["id"])
    await league_moments.scrub_person(flow.db, player["id"])
    doc = (await moments_of(flow, world))[up["squad_id"]]
    for field in ("player_ids", "audience_ids", "seen_by", "notified_ids", "told_ids", "responsible_ids"):
        assert player["id"] not in (doc.get(field) or []), field
    assert player["id"] not in (doc.get("claims") or {})
    assert doc["active"] is True and doc["outcome"] == "up"


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
