"""Startrechte für die nächste Season (#1627, docs/LIGA.md „F.2a Startrechte für die nächste Season“) - über die echten Routen.

Zwei Liga N mit je vier Co-Teams (Namen in Tabellenreihenfolge), gespielt und abgeschlossen. Dann: Nachricht nur aus bestätigtem
Endstand und nur einmal, Startrecht mit Frist, Zusage, Verfall, Nachrücken mit Rückfall, gleichzeitige Zusagen, Wiederöffnen des
Vorgängers - und Seasons ohne die Einstellung bleiben, wie sie sind. Nur erfundene Namen.
"""
import asyncio
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from league_postseason_world import STAFFELN, build, close, create, matches_of, play_round, settle, sides, win  # noqa: E402
from league_start_world import ADMIN, ok  # noqa: E402
from models import now_utc  # noqa: E402
from services import league_calendar, league_start_rights  # noqa: E402

NEW_START = (now_utc() + timedelta(days=60)).date().isoformat() + "T00:00:00"
LONG_AGO = (now_utc() - timedelta(days=90)).isoformat()
ACCEPT = {"active": True, "mode": "accept", "accept_days": 10}
ANNOUNCED = "league_start_right"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


# ---------------------------------------------------------------- Helfer

def reg(world: dict, level: int, index: int, staffel: int = 0) -> dict:
    return world["regs"][world["tids"][level][staffel]][index]


def squad_id(world: dict, level: int, index: int, staffel: int = 0) -> str:
    return reg(world, level, index, staffel)["squad_id"]


async def person(flow, squad: str, role: str = "captain_id") -> dict:
    row = await flow.db.team_squads.find_one({"id": squad}, {"_id": 0})
    return await flow.db.users.find_one({"id": row[role]}, {"_id": 0})


async def configure(flow, world: dict, season_id: str | None = None, **settings):
    flow.act_as(world["lead"])
    return await flow.put(f"{ADMIN}/seasons/{season_id or world['season']['id']}/start-rights", json={**ACCEPT, **settings})


async def successor(flow, world: dict, **body) -> dict:
    flow.act_as(world["lead"])
    answer = ok(await flow.post(f"{ADMIN}/seasons/{world['season']['id']}/successor", json={"start_date": NEW_START, "confirm": True, **body}))
    return await flow.db.league_seasons.find_one({"id": answer["season"]["id"]}, {"_id": 0})


async def carried(flow, season_id: str) -> dict[str, dict]:
    rows = await flow.db.league_applications.find({"season_id": season_id}, {"_id": 0}).sort("created_at", 1).to_list(None)
    return {row["squad_id"]: row for row in rows}


async def notes(flow, reason: str, user_id: str | None = None) -> list[dict]:
    query = {"meta.reason": reason, **({"user_id": user_id} if user_id else {})}
    return await flow.db.notifications.find(query, {"_id": 0}).to_list(None)


async def announced(flow, world: dict, level: int, index: int, staffel: int = 0) -> list[dict]:
    captain = await person(flow, squad_id(world, level, index, staffel))
    return await notes(flow, ANNOUNCED, captain["id"])


async def own_item(flow, squad: str, application_id: str, role: str = "captain_id") -> dict:
    flow.act_as(await person(flow, squad, role))
    items = ok(await flow.get("/api/me/league-applications"))["items"]
    return next(row for row in items if row["id"] == application_id)


async def answer(flow, squad: str, application_id: str, action: str = "accept", role: str = "captain_id"):
    flow.act_as(await person(flow, squad, role))
    return await flow.post(f"/api/me/league-applications/{application_id}/start-right", json={"action": action})


async def overview(flow, world: dict, season_id: str) -> dict:
    flow.act_as(world["lead"])
    return ok(await flow.get(f"{ADMIN}/seasons/{season_id}/start-rights"))


async def overdue(flow, application_id: str, days: int = 30) -> None:
    """Die Vergabe liegt lange zurück: Die Frist dieses Startrechts ist vorbei."""
    await flow.db.league_applications.update_one(
        {"id": application_id}, {"$set": {"carry_over.start_right.offered_at": (now_utc() - timedelta(days=days)).isoformat()}})


async def ready(flow, world: dict, **settings) -> tuple[dict, dict[str, dict]]:
    """Season mit Startrechten, abgeschlossen, Folge-Season angelegt: (neue Season, Anträge je Co-Team)."""
    ok(await configure(flow, world, **settings))
    await close(flow, world)
    season = await successor(flow, world)
    return season, await carried(flow, season["id"])


# ---------------------------------------------------------------- Seasons ohne die Einstellung bleiben, wie sie sind

@pytest.mark.asyncio
async def test_a_season_without_the_setting_behaves_as_before(flow):
    world = await build(flow, levels=2)
    await close(flow, world)
    assert await notes(flow, ANNOUNCED) == []  # keine neue Nachricht
    season = await successor(flow, world)
    assert "start_rights" not in season
    rows = await carried(flow, season["id"])
    assert len(rows) == 8 and all("start_right" not in row["carry_over"] for row in rows.values())
    # Die Nachricht beim Anlegen sagt wie bisher „automatisch dabei“.
    promoted = rows[squad_id(world, 2, 0)]
    captain = await person(flow, promoted["squad_id"])
    told = await notes(flow, "league_successor", captain["id"])
    assert len(told) == 1 and "automatisch dabei" in told[0]["body"] and "Startrecht" not in told[0]["body"]
    # Die Antwort an das Team trägt nichts Neues am Antrag.
    item = await own_item(flow, promoted["squad_id"], promoted["id"])
    assert "start_right" not in item["carry_over"] and item["can_withdraw"]
    assert ok(await flow.get("/api/me/league-applications"))["start_rights"] == []
    # Zusagen gibt es nicht: Es gibt nichts zuzusagen.
    refused = await answer(flow, promoted["squad_id"], promoted["id"])
    assert refused.status_code == 409
    # Der Job fasst nichts an - auch nicht nach dem Start.
    before = await carried(flow, season["id"])
    await flow.db.league_seasons.update_one({"id": season["id"]}, {"$set": {"start_date": LONG_AGO}})
    done = await league_start_rights.sweep(flow.db)
    assert done == {"expired": 0, "restored": 0, "filled": 0, "reminded": 0, "announced": 0, "paused": 0}
    assert await carried(flow, season["id"]) == before
    await flow.db.league_seasons.update_one({"id": season["id"]}, {"$set": {"start_date": NEW_START}})
    # Abmelden lässt niemanden nachrücken (nachrücken entscheidet die Leitung, F.2).
    flow.act_as(captain)
    ok(await flow.post(f"/api/me/league-applications/{promoted['id']}/withdraw"))
    after = await carried(flow, season["id"])
    assert after[promoted["squad_id"]]["status"] == "withdrawn"
    assert all("fills" not in row["carry_over"] and "filled_by" not in row["carry_over"] for row in after.values())
    # Zuteilen geht ohne Zusage.
    flow.act_as(world["lead"])
    division = await flow.db.league_divisions.find_one({"season_id": season["id"], "level": 2}, {"_id": 0})
    staffel = ok(await flow.post(f"{ADMIN}/divisions/{division['id']}/staffeln", json={}))
    stays = after[squad_id(world, 2, 1)]
    ok(await flow.post(f"{ADMIN}/seasons/{season['id']}/applications/{stays['id']}/assign", json={"tournament_id": staffel["tournament_id"]}))
    view = await overview(flow, world, season["id"])
    assert view["active"] is False and view["settings"] is None and view["open_places"] == []


# ---------------------------------------------------------------- Aufstieg über die Zone: bestätigt, einmal gemeldet, mit Frist vergeben

@pytest.mark.asyncio
async def test_promotion_by_zone_is_announced_once_when_confirmed_and_offered_with_a_deadline(flow):
    world = await build(flow, levels=2)
    ok(await configure(flow, world))
    top, bottom = world["tids"][1][0], world["tids"][2][0]
    # Eine abgeschlossene Staffel allein bestätigt nichts - erst der Endstand der ganzen Season.
    await close(flow, world, bottom)
    assert await notes(flow, ANNOUNCED) == []
    await close(flow, world, top)
    up, down = squad_id(world, 2, 0), squad_id(world, 1, 3)
    for squad, word, label in ((up, "Aufstieg bestätigt", "Liga 1"), (down, "Abstieg bestätigt", "Liga 2")):
        for role in ("captain_id", "vice_captain_id"):
            mine = await notes(flow, ANNOUNCED, (await person(flow, squad, role))["id"])
            assert len(mine) == 1 and mine[0]["title"] == word and label in mine[0]["body"], mine
    # Wer bleibt, bekommt keine - und niemand sonst.
    assert await announced(flow, world, 1, 0) == [] and await announced(flow, world, 2, 1) == []
    assert len(await notes(flow, ANNOUNCED)) == 4
    # Ein Startrecht ist keine Anmeldung: Das sagt die Nachricht.
    assert "keine Anmeldung" in (await announced(flow, world, 2, 0))[0]["body"]
    # Noch einmal melden (Job, Wiederholung): nichts doppelt.
    assert (await league_start_rights.announce(flow.db, world["season"]["id"]))["sent"] == 0
    assert (await league_start_rights.sweep(flow.db))["announced"] == 0
    assert len(await notes(flow, ANNOUNCED)) == 4
    assert await flow.db.audit_logs.count_documents({"action": "league.start_right.announce"}) == 1

    season = await successor(flow, world)
    # Die Einstellung geht mit, der Stand der Nachrichten nicht.
    assert season["start_rights"]["mode"] == "accept" and season["start_rights"]["accept_days"] == 10
    assert "start_right_notices" not in season
    rows = await carried(flow, season["id"])
    assert len(rows) == 8 and all(row["carry_over"]["start_right"]["status"] == "offered" for row in rows.values())
    promoted = rows[up]
    told = await notes(flow, "league_successor", (await person(flow, up))["id"])
    assert len(told) == 1 and "Startrecht" in told[0]["body"] and "zusagen" in told[0]["body"] and "automatisch dabei" not in told[0]["body"]
    # Das eigene Team: Zustand, Frist, Knopf.
    item = await own_item(flow, up, promoted["id"])
    right = item["carry_over"]["start_right"]
    assert right["state"] == "offered" and right["can_accept"] and not right["can_decline"]
    offered = league_calendar.aware(promoted["carry_over"]["start_right"]["offered_at"])
    assert right["accept_until"] == (offered + timedelta(days=10)).isoformat()
    # Nur Captain und Vertreter sagen zu.
    squad = await flow.db.team_squads.find_one({"id": up}, {"_id": 0})
    member = next(uid for uid in squad["member_ids"] if uid not in (squad["captain_id"], squad["vice_captain_id"]))
    flow.act_as(await flow.db.users.find_one({"id": member}, {"_id": 0}))
    refused = await flow.post(f"/api/me/league-applications/{promoted['id']}/start-right", json={"action": "accept"})
    assert refused.status_code == 403
    done = ok(await answer(flow, up, promoted["id"]))
    assert done["carry_over"]["start_right"]["state"] == "accepted" and not done.get("replay")
    again = ok(await answer(flow, up, promoted["id"], role="vice_captain_id"))
    assert again["replay"] is True and again["carry_over"]["start_right"]["state"] == "accepted"
    stored = (await carried(flow, season["id"]))[up]
    assert stored["status"] == "accepted" and stored["carry_over"]["start_right"]["accepted_via"] == "team"
    assert len([step for step in stored["history"] if step.get("start_right") == "accepted"]) == 1
    assert await flow.db.audit_logs.count_documents({"action": "league.start_right.accept"}) == 1
    # Die Zusage ist keine Zustimmung zum Regelwerk und keine Teilnahme.
    assert "rule_consent" not in stored and "assignment" not in stored
    # Verwaltung: Übersicht mit Stand und Frist.
    view = await overview(flow, world, season["id"])
    assert view["active"] and view["settings"]["accept_days"] == 10 and view["predecessor"]["id"] == world["season"]["id"]
    assert view["counts"] == {"offered": 7, "accepted": 1}
    row = next(item for item in view["rows"] if item["squad_id"] == up)
    assert row["state"] == "accepted" and row["movement"] == "up" and row["division_label"].startswith("Liga 1")
    # Zuteilen: erst nach der Zusage - dann ist es Teilnahme.
    division = await flow.db.league_divisions.find_one({"season_id": season["id"], "level": 1}, {"_id": 0})
    staffel = ok(await flow.post(f"{ADMIN}/divisions/{division['id']}/staffeln", json={}))
    waiting = rows[squad_id(world, 1, 0)]
    early = await flow.post(f"{ADMIN}/seasons/{season['id']}/applications/{waiting['id']}/assign", json={"tournament_id": staffel["tournament_id"]})
    assert early.status_code == 422 and "Startrecht" in early.json()["detail"]
    ok(await flow.post(f"{ADMIN}/seasons/{season['id']}/applications/{promoted['id']}/assign", json={"tournament_id": staffel["tournament_id"]}))
    view = await overview(flow, world, season["id"])
    assert next(item for item in view["rows"] if item["squad_id"] == up)["state"] == "participating"
    assert view["counts"] == {"offered": 7, "participating": 1}


# ---------------------------------------------------------------- Beste Zweite, Relegation, Playoffs

@pytest.mark.asyncio
async def test_the_best_runner_up_is_only_confirmed_after_the_last_staffel_of_the_division(flow):
    world = await build(flow, levels=2, staffeln={2: [4, 3]}, zones={2: {"promote": 1, "promote_best": 1}})
    ok(await configure(flow, world))
    top, first, second = world["tids"][1][0], *world["tids"][2]
    await close(flow, world, top, first)
    # Der Erste der Staffel A steigt sicher auf - gemeldet wird trotzdem erst der bestätigte Endstand der Season.
    assert await notes(flow, ANNOUNCED) == []
    await close(flow, world, second)
    flow.act_as(world["lead"])
    preview = ok(await flow.get(f"{ADMIN}/seasons/{world['season']['id']}/successor"))
    crossed = [team for row in preview["divisions"] for team in row["teams"] if team.get("zone_cross")]
    assert len(crossed) == 1 and crossed[0]["movement"] == "up"
    told = await notes(flow, ANNOUNCED, (await person(flow, crossed[0]["squad_id"]))["id"])
    assert len(told) == 1 and told[0]["title"] == "Aufstieg bestätigt"
    # Drei Aufsteiger (je Staffel der Erste, dazu der beste Zweite), ein Absteiger - je Captain und Vertreter.
    assert len(await notes(flow, ANNOUNCED)) == 8
    season = await successor(flow, world)
    right = (await carried(flow, season["id"]))[crossed[0]["squad_id"]]
    assert right["carry_over"]["division_level"] == 1 and right["carry_over"]["start_right"]["status"] == "offered"


@pytest.mark.asyncio
async def test_the_relegation_confirms_the_rights_and_names_the_way(flow):
    zones = {1: {"relegate": 1, "playoff_relegate": 1}, 2: {"promote": 1, "playoff_promote": 1}}
    world = await build(flow, levels=2, zones=zones, postseason={"relegation": {"enabled": True}})
    ok(await configure(flow, world))
    await close(flow, world)
    # Alle Tabellen stehen - aber die Relegation fehlt noch: nichts ist bestätigt.
    assert await notes(flow, ANNOUNCED) == []
    ok(await create(flow, world, "relegation"))
    tournament = await flow.db.tournaments.find_one(
        {"league_context.division_id": world["divisions"][1]["id"], "league_context.kind": "relegation"}, {"_id": 0})
    flow.act_as(world["lead"])
    for match in await matches_of(flow, tournament["id"]):
        _upper, lower = sides(match)
        await win(flow, match, lower)
    await settle(flow, tournament["id"])
    ok(await flow.post(f"{STAFFELN}/{tournament['id']}/close", json={"confirm": True}))
    winner, loser = squad_id(world, 2, 1), squad_id(world, 1, 2)
    up = await notes(flow, ANNOUNCED, (await person(flow, winner))["id"])
    down = await notes(flow, ANNOUNCED, (await person(flow, loser))["id"])
    assert len(up) == 1 and up[0]["title"] == "Aufstieg bestätigt" and "über die Relegation" in up[0]["body"]
    assert len(down) == 1 and down[0]["title"] == "Abstieg bestätigt" and "über die Relegation" in down[0]["body"]
    # Dazu der Aufsteiger und der Absteiger aus der Tabelle - ohne den Zusatz.
    direct = await announced(flow, world, 2, 0)
    assert len(direct) == 1 and "Relegation" not in direct[0]["body"]
    assert len(await notes(flow, ANNOUNCED)) == 8
    season = await successor(flow, world)
    rows = await carried(flow, season["id"])
    assert rows[winner]["carry_over"]["division_level"] == 1 and rows[winner]["carry_over"]["start_right"]["status"] == "offered"
    assert rows[loser]["carry_over"]["division_level"] == 2 and rows[loser]["carry_over"]["via"] == "relegation"


@pytest.mark.asyncio
async def test_playoffs_hold_the_confirmation_back_but_never_move_a_team(flow):
    world = await build(flow, levels=2, postseason={"playoffs": {"enabled": True, "per_staffel": 4}})
    ok(await configure(flow, world))
    await close(flow, world)
    assert await notes(flow, ANNOUNCED) == []  # die Playoffs gehören zum Endstand der Season
    for level in (1, 2):
        ok(await create(flow, world, "playoffs", level))
        tournament = await flow.db.tournaments.find_one(
            {"league_context.division_id": world["divisions"][level]["id"], "league_context.kind": "playoff"}, {"_id": 0})
        for _round in range(3):
            if not await play_round(flow, world, tournament["id"], favourite=False):
                break
        await settle(flow, tournament["id"])
        flow.act_as(world["lead"])
        ok(await flow.post(f"{STAFFELN}/{tournament['id']}/close", json={"confirm": True}))
        if level == 1:
            assert await notes(flow, ANNOUNCED) == []
    # Auf- und Abstieg sagt die Tabelle: Der Playoff-Sieger der unteren Liga (der Tabellenletzte) bekommt kein Startrecht nach oben.
    assert len(await announced(flow, world, 2, 0)) == 1 and len(await announced(flow, world, 1, 3)) == 1
    assert await announced(flow, world, 2, 3) == []
    assert len(await notes(flow, ANNOUNCED)) == 4
    season = await successor(flow, world)
    rows = await carried(flow, season["id"])
    assert rows[squad_id(world, 2, 3)]["carry_over"]["division_level"] == 2
    assert rows[squad_id(world, 2, 0)]["carry_over"]["division_level"] == 1


# ---------------------------------------------------------------- Rückzug, Absage und Nachrücker

@pytest.mark.asyncio
async def test_a_withdrawn_team_gets_no_right_and_a_declined_right_goes_to_the_next_of_the_table(flow):
    world = await build(flow, levels=2)
    ok(await configure(flow, world))
    # Rückzug im Saisonverlauf: Der Zweite der oberen Liga ist ausgetreten.
    gone = reg(world, 1, 1)
    await flow.db.tournament_registrations.update_one({"id": gone["id"]}, {"$set": {"status": "withdrawn", "removal": {"at": LONG_AGO, "mode": "forfeit"}}})
    await close(flow, world)
    assert await notes(flow, ANNOUNCED, (await person(flow, gone["squad_id"]))["id"]) == []
    season = await successor(flow, world)
    rows = await carried(flow, season["id"])
    assert gone["squad_id"] not in rows and len(rows) == 7
    promoted, second, third = (rows[squad_id(world, 2, index)] for index in range(3))
    # Der Zweite der unteren Liga hat für seine Liga schon zugesagt.
    ok(await answer(flow, second["squad_id"], second["id"]))
    # Der Aufsteiger sagt ab (meldet sich ab): Sein Platz in Liga 1 geht an den besten Nicht-Aufsteiger.
    flow.act_as(await person(flow, promoted["squad_id"]))
    ok(await flow.post(f"/api/me/league-applications/{promoted['id']}/withdraw"))
    after = await carried(flow, season["id"])
    freed, moved = after[promoted["squad_id"]], after[second["squad_id"]]
    assert freed["status"] == "withdrawn" and freed["carry_over"]["start_right"]["status"] == "declined"
    assert freed["carry_over"]["filled_by"]["application_id"] == second["id"]
    carry = moved["carry_over"]
    assert carry["division_level"] == 1 and carry["movement"] == "up" and carry["division_label"].startswith("Liga 1")
    assert carry["fills"]["for_application_id"] == promoted["id"] and carry["fills"]["why"] == "declined" and carry["fills"]["by"] is None
    assert carry["fills"]["group"] == "non_promoted" and carry["fills"]["back"]["division_level"] == 2
    # Andere Liga N: neue Zusage mit neuer Frist - die alte bleibt als Rückfall erhalten.
    assert carry["start_right"]["status"] == "offered" and carry["fills"]["back"]["start_right"]["status"] == "accepted"
    assert after[third["squad_id"]]["carry_over"]["division_level"] == 2  # keine Kette
    told = await notes(flow, "league_start_right_fill", (await person(flow, second["squad_id"]))["id"])
    assert len(told) == 1 and "Liga 1" in told[0]["body"] and promoted["display_name"] not in told[0]["title"]
    item = await own_item(flow, second["squad_id"], second["id"])
    right = item["carry_over"]["start_right"]
    assert right["state"] == "offered" and right["can_accept"] and right["can_decline"] and right["fills"]["from_label"].startswith("Liga 2")
    assert item["carry_over"]["division_label"].startswith("Liga 1")
    ok(await answer(flow, second["squad_id"], second["id"]))
    final = (await carried(flow, season["id"]))[second["squad_id"]]
    assert final["carry_over"]["start_right"]["status"] == "accepted" and final["carry_over"]["division_level"] == 1
    view = await overview(flow, world, season["id"])
    assert view["open_places"] == []
    row = next(item for item in view["rows"] if item["squad_id"] == promoted["squad_id"])
    assert row["state"] == "declined" and row["filled_by"]["display_name"] == second["display_name"]
    log = await flow.db.audit_logs.find_one({"action": "league.start_right.fill"}, {"_id": 0})
    assert log["data"]["for_application_id"] == promoted["id"] and log["data"]["application_id"] == second["id"] and log["actor_id"] is None


@pytest.mark.asyncio
async def test_an_expired_right_moves_on_and_a_silent_successor_falls_back(flow):
    world = await build(flow, levels=2)
    season, rows = await ready(flow, world, accept_days=5, remind_hours=48)
    promoted, second, third, fourth = (rows[squad_id(world, 2, index)] for index in range(4))
    ok(await answer(flow, second["squad_id"], second["id"]))
    from services.league_applications import seat_stats

    taken = (await seat_stats(flow.db, season))["taken"]
    # Erinnerung: zwei Tage vor Fristende, einmal.
    await overdue(flow, promoted["id"], days=4)
    assert (await league_start_rights.sweep(flow.db))["reminded"] == 1
    assert (await league_start_rights.sweep(flow.db))["reminded"] == 0
    captain = await person(flow, promoted["squad_id"])
    assert len(await notes(flow, "league_start_right_reminder", captain["id"])) == 1
    # Frist vorbei: Zusagen geht nicht mehr - schon bevor der Job läuft.
    await overdue(flow, promoted["id"])
    late = await answer(flow, promoted["squad_id"], promoted["id"])
    assert late.status_code == 409 and "Frist" in late.json()["detail"]
    done = await league_start_rights.sweep(flow.db)
    assert done["expired"] == 1 and done["filled"] == 1
    after = await carried(flow, season["id"])
    lost = after[promoted["squad_id"]]
    assert lost["status"] == "rejected" and "active_key" not in lost and lost["carry_over"]["start_right"]["status"] == "expired"
    assert "verfallen" in lost["decision_reason"]
    assert len(await notes(flow, "league_start_right_expired", captain["id"])) == 1
    assert (await seat_stats(flow.db, season))["taken"] == taken - 1
    assert after[second["squad_id"]]["carry_over"]["division_level"] == 1 and after[second["squad_id"]]["carry_over"]["fills"]["why"] == "expired"
    # Der Nachrücker meldet sich nicht: Er fällt auf sein Startrecht zurück - samt früherer Zusage -, der Nächste ist dran.
    await overdue(flow, second["id"])
    done = await league_start_rights.sweep(flow.db)
    assert done["restored"] == 1 and done["filled"] == 1 and done["expired"] == 0
    after = await carried(flow, season["id"])
    back = after[second["squad_id"]]
    assert back["status"] == "accepted" and back["carry_over"]["division_level"] == 2 and back["carry_over"]["movement"] == "stay"
    assert back["carry_over"]["start_right"]["status"] == "accepted" and "fills" not in back["carry_over"]
    assert back["carry_over"]["passed"] == [promoted["id"]]
    assert len(await notes(flow, "league_start_right_back", (await person(flow, second["squad_id"]))["id"])) == 1
    moved = after[third["squad_id"]]
    assert moved["carry_over"]["division_level"] == 1 and moved["carry_over"]["fills"]["for_application_id"] == promoted["id"]
    assert after[promoted["squad_id"]]["carry_over"]["filled_by"]["application_id"] == third["id"]
    # Der Dritte lehnt das Nachrücken ab: zurück in seine Liga mit seiner noch offenen Frist, der Vierte rückt nach.
    declined = ok(await answer(flow, third["squad_id"], third["id"], action="decline"))
    assert declined["carry_over"]["division_label"].startswith("Liga 2") and declined["carry_over"]["start_right"]["state"] == "offered"
    after = await carried(flow, season["id"])
    assert after[third["squad_id"]]["carry_over"]["start_right"] == third["carry_over"]["start_right"]
    assert after[fourth["squad_id"]]["carry_over"]["division_level"] == 1
    ok(await answer(flow, fourth["squad_id"], fourth["id"]))
    # Wiederholt ändert der Job nichts mehr.
    snapshot = await carried(flow, season["id"])
    assert await league_start_rights.sweep(flow.db) == {"expired": 0, "restored": 0, "filled": 0, "reminded": 0, "announced": 0, "paused": 0}
    assert await carried(flow, season["id"]) == snapshot
    assert await flow.db.audit_logs.count_documents({"action": "league.start_right.expire"}) == 1
    assert await flow.db.audit_logs.count_documents({"action": "league.start_right.fill"}) == 3
    assert await flow.db.audit_logs.count_documents({"action": "league.start_right.pass"}) == 2
    # Nach dem Verfall bleibt nur der normale Weg: Ohne Anmeldefenster geht keine neue Anmeldung.
    view = await overview(flow, world, season["id"])
    assert next(item for item in view["rows"] if item["squad_id"] == promoted["squad_id"])["state"] == "expired"


@pytest.mark.asyncio
async def test_after_the_season_start_nobody_moves_up_automatically(flow):
    world = await build(flow, levels=2)
    season, rows = await ready(flow, world)
    promoted = rows[squad_id(world, 2, 0)]
    await overdue(flow, promoted["id"])
    await flow.db.league_seasons.update_one({"id": season["id"]}, {"$set": {"status": "active", "started_at": LONG_AGO}})
    done = await league_start_rights.sweep(flow.db)
    # Verfallen ist verfallen - aber nachgerückt wird nach dem Start nur noch von Hand im Eingang.
    assert done["expired"] >= 1 and done["filled"] == 0
    after = await carried(flow, season["id"])
    assert all("fills" not in row["carry_over"] for row in after.values())


# ---------------------------------------------------------------- Zwei gleichzeitige Zusagen

@pytest.mark.asyncio
async def test_two_acceptances_at_the_same_time_count_once(flow):
    world = await build(flow, levels=2)
    season, rows = await ready(flow, world)
    promoted = rows[squad_id(world, 2, 0)]
    captain, vice = await person(flow, promoted["squad_id"]), await person(flow, promoted["squad_id"], "vice_captain_id")
    first, second = await asyncio.gather(league_start_rights.accept(flow.db, promoted["id"], captain),
                                         league_start_rights.accept(flow.db, promoted["id"], vice))
    assert first["carry_over"]["start_right"]["status"] == second["carry_over"]["start_right"]["status"] == "accepted"
    assert sorted(bool(row.get("replay")) for row in (first, second)) == [False, True]
    stored = (await carried(flow, season["id"]))[promoted["squad_id"]]
    assert len([step for step in stored["history"] if step.get("start_right") == "accepted"]) == 1
    assert await flow.db.audit_logs.count_documents({"action": "league.start_right.accept"}) == 1
    # Über die Route: ein Doppelklick.
    other = rows[squad_id(world, 1, 0)]
    flow.act_as(await person(flow, other["squad_id"]))
    url = f"/api/me/league-applications/{other['id']}/start-right"
    one, two = await asyncio.gather(flow.post(url, json={"action": "accept"}), flow.post(url, json={"action": "accept"}))
    assert one.status_code == two.status_code == 200
    assert await flow.db.audit_logs.count_documents({"action": "league.start_right.accept"}) == 2
    # Zusage und Verfall im selben Moment: Es gilt genau eines von beiden - nie beides.
    third = rows[squad_id(world, 1, 1)]
    await overdue(flow, third["id"])
    owner = await person(flow, third["squad_id"])

    async def late_accept():
        try:
            return await league_start_rights.accept(flow.db, third["id"], owner)
        except league_start_rights.StartRightProblem as problem:
            return problem

    result, _swept = await asyncio.gather(late_accept(), league_start_rights.sweep(flow.db))
    final = (await carried(flow, season["id"]))[third["squad_id"]]
    assert isinstance(result, league_start_rights.StartRightProblem) and result.status_code == 409
    assert final["status"] == "rejected" and final["carry_over"]["start_right"]["status"] == "expired"


# ---------------------------------------------------------------- Wiederöffnen des Vorgängers nach der Bestätigung

async def second_lead(flow, world: dict) -> dict:
    user = await flow.add_user(name="Zweite Leitung")
    await flow.db.league_staff.insert_one({"id": new_id(), "league_id": world["league"]["id"], "user_id": user["id"],
                                           "capabilities": ["season", "results", "manage"], "created_at": now_utc().isoformat()})
    return user


@pytest.mark.asyncio
async def test_reopening_the_old_season_pauses_the_rights_and_corrects_them_once(flow):
    world = await build(flow, levels=2)
    season, rows = await ready(flow, world)
    winner, runner_up, third = (rows[squad_id(world, 2, index)] for index in range(3))
    ok(await answer(flow, winner["squad_id"], winner["id"]))
    ok(await answer(flow, runner_up["squad_id"], runner_up["id"]))
    stays = rows[squad_id(world, 1, 0)]
    ok(await answer(flow, stays["squad_id"], stays["id"]))
    await overdue(flow, third["id"])
    # Wieder öffnen (zweite Person): Der Endstand wird geprüft - nichts verfällt, niemand rückt nach.
    tid = world["tids"][2][0]
    flow.act_as(await second_lead(flow, world))
    ok(await flow.post(f"{STAFFELN}/{tid}/reopen", json={"reason": "Ergebnis vertauscht eingetragen"}))
    done = await league_start_rights.sweep(flow.db)
    assert done["paused"] == 1 and done["expired"] == 0 and done["filled"] == 0
    assert (await carried(flow, season["id"]))[third["squad_id"]]["carry_over"]["start_right"]["status"] == "offered"
    view = await overview(flow, world, season["id"])
    assert view["paused"] is True
    # Korrektur: Der Zweite hat das direkte Spiel gewonnen. Neu abschließen.
    regs = world["regs"][tid]
    duel = next(match for match in await flow.db.matches_v2.find({"tournament_id": tid}, {"_id": 0}).to_list(None)
                if {slot["registration_id"] for slot in match["slots"]} == {regs[0]["id"], regs[1]["id"]})
    await flow.db.matches_v2.update_one({"id": duel["id"]}, {"$set": {"results": [
        {"registration_id": regs[1]["id"], "rank": 1, "score": 2}, {"registration_id": regs[0]["id"], "rank": 2, "score": 0}]}})
    flow.act_as(world["lead"])
    ok(await flow.post(f"{STAFFELN}/{tid}/close", json={"confirm": True}))
    # Nachrichten: der neue Aufsteiger einmal, der alte einmal „korrigiert“ - der unveränderte Absteiger nicht noch einmal.
    new_up = await notes(flow, ANNOUNCED, (await person(flow, runner_up["squad_id"]))["id"])
    old_up = await notes(flow, ANNOUNCED, (await person(flow, winner["squad_id"]))["id"])
    assert [row["title"] for row in new_up] == ["Aufstieg bestätigt"]
    assert sorted(row["title"] for row in old_up) == ["Aufstieg bestätigt", "Endstand korrigiert"]
    assert len(await announced(flow, world, 1, 3)) == 1
    assert (await league_start_rights.announce(flow.db, world["season"]["id"]))["sent"] == 0
    # Übernahme neu berechnen: andere Liga N heißt neue Zusage mit neuer Frist; wer bleibt, behält seine Zusage.
    flow.act_as(world["lead"])
    preview = ok(await flow.get(f"{ADMIN}/seasons/{season['id']}/successor/recompute"))
    ok(await flow.post(f"{ADMIN}/seasons/{season['id']}/successor/recompute", json={"confirm": True, "stamp": preview["stamp"]}))
    after = await carried(flow, season["id"])
    for row, level in ((winner, 2), (runner_up, 1)):
        fresh = after[row["squad_id"]]["carry_over"]
        assert fresh["division_level"] == level and fresh["start_right"]["status"] == "offered"
        assert fresh["start_right"]["offered_at"] > row["carry_over"]["start_right"]["offered_at"] and "accepted_at" not in fresh["start_right"]
    assert after[stays["squad_id"]]["carry_over"]["start_right"]["status"] == "accepted"
    # Jetzt läuft die Frist wieder.
    done = await league_start_rights.sweep(flow.db)
    assert done["paused"] == 0 and done["expired"] == 1
    assert (await carried(flow, season["id"]))[third["squad_id"]]["carry_over"]["start_right"]["status"] == "expired"


@pytest.mark.asyncio
async def test_a_successor_keeps_the_place_when_recompute_finds_nothing_new_for_it(flow):
    world = await build(flow, levels=2)
    season, rows = await ready(flow, world)
    promoted, second = rows[squad_id(world, 2, 0)], rows[squad_id(world, 2, 1)]
    flow.act_as(await person(flow, promoted["squad_id"]))
    ok(await flow.post(f"/api/me/league-applications/{promoted['id']}/withdraw"))
    assert (await carried(flow, season["id"]))[second["squad_id"]]["carry_over"]["division_level"] == 1
    flow.act_as(world["lead"])
    preview = ok(await flow.get(f"{ADMIN}/seasons/{season['id']}/successor/recompute"))
    assert [change for change in preview["changes"] if change["squad_id"] == second["squad_id"]] == []


# ---------------------------------------------------------------- Leitung: Regel „lead“, Zusage eintragen, Rechte

@pytest.mark.asyncio
async def test_with_the_rule_lead_the_place_waits_for_the_lead(flow):
    world = await build(flow, levels=2)
    season, rows = await ready(flow, world, successor="lead")
    promoted, second, third = (rows[squad_id(world, 2, index)] for index in range(3))
    flow.act_as(await person(flow, promoted["squad_id"]))
    ok(await flow.post(f"/api/me/league-applications/{promoted['id']}/withdraw"))
    assert all("fills" not in row["carry_over"] for row in (await carried(flow, season["id"])).values())
    view = await overview(flow, world, season["id"])
    place = view["open_places"][0]
    assert place["application_id"] == promoted["id"] and place["why"] == "declined" and place["pick"] == second["id"]
    assert [row["application_id"] for row in place["candidates"]] == [second["id"]] and place["group"] == "non_promoted"
    url = f"{ADMIN}/seasons/{season['id']}/start-rights/{promoted['id']}/fill"
    assert (await flow.post(url, json={"candidate_id": second["id"], "reason": "ok"})).status_code == 422
    wrong = await flow.post(url, json={"candidate_id": third["id"], "reason": "Der Dritte soll es sein"})
    assert wrong.status_code == 422 and "Kandidat" in wrong.json()["detail"]
    done = ok(await flow.post(url, json={"candidate_id": second["id"], "reason": "Platz 2 der Tabelle rückt nach"}))
    assert done["fills"]["by"] == world["lead"]["id"]
    moved = (await carried(flow, season["id"]))[second["squad_id"]]["carry_over"]
    assert moved["division_level"] == 1 and moved["fills"]["reason"] == "Platz 2 der Tabelle rückt nach"
    # Ein Platz wird nie zweimal vergeben.
    twice = await flow.post(url, json={"candidate_id": second["id"], "reason": "Platz 2 der Tabelle rückt nach"})
    assert twice.status_code == 409
    assert (await overview(flow, world, season["id"]))["open_places"] == []


@pytest.mark.asyncio
async def test_the_lead_enters_an_acceptance_with_a_reason_but_never_for_the_own_team(flow):
    world = await build(flow, levels=2)
    season, rows = await ready(flow, world)
    promoted = rows[squad_id(world, 2, 0)]
    url = f"{ADMIN}/seasons/{season['id']}/start-rights/{promoted['id']}/accept"
    flow.act_as(world["lead"])
    assert (await flow.post(url, json={"reason": "ja"})).status_code == 422
    # Wer zum Co-Team gehört, entscheidet nicht selbst - auch nicht mit der Zuständigkeit.
    insider = await person(flow, promoted["squad_id"])
    await flow.db.league_staff.insert_one({"id": new_id(), "league_id": world["league"]["id"], "user_id": insider["id"],
                                           "capabilities": ["applications"], "created_at": now_utc().isoformat(), "created_by": "test"})
    flow.act_as(insider)
    refused = await flow.post(url, json={"reason": "Zusage am Telefon"})
    assert refused.status_code == 403
    # Die Einstellung ändert nur „Season konfigurieren“ - lesen darf jede Zuständigkeit.
    assert (await flow.get(f"{ADMIN}/seasons/{season['id']}/start-rights")).status_code == 200
    assert (await flow.put(f"{ADMIN}/seasons/{season['id']}/start-rights", json={**ACCEPT, "accept_days": 3})).status_code == 403
    outsider = await flow.add_user(name="Niemand")
    flow.act_as(outsider)
    assert (await flow.get(f"{ADMIN}/seasons/{season['id']}/start-rights")).status_code in (403, 404)
    assert (await flow.post(url, json={"reason": "Zusage am Telefon"})).status_code in (403, 404)
    flow.act_as(world["lead"])
    done = ok(await flow.post(url, json={"reason": "Zusage am Telefon"}))
    assert done["state"] == "accepted" and done["accepted_via"] == "lead"
    stored = (await carried(flow, season["id"]))[promoted["squad_id"]]["carry_over"]["start_right"]
    assert stored["accept_reason"] == "Zusage am Telefon" and stored["accepted_by"] == world["lead"]["id"]
    assert len(await notes(flow, "league_start_right_accepted", insider["id"])) == 1
    # Die Frist gilt auch für die Leitung: Danach bleibt der Sonderweg „Co-Team zuteilen“ oder eine neue Anmeldung.
    late = rows[squad_id(world, 2, 2)]
    await overdue(flow, late["id"])
    refused = await flow.post(f"{ADMIN}/seasons/{season['id']}/start-rights/{late['id']}/accept", json={"reason": "Zusage am Telefon"})
    assert refused.status_code == 409 and "Frist" in refused.json()["detail"]
    await flow.db.league_applications.update_one({"id": late["id"]}, {"$set": {"carry_over.start_right.offered_at": now_utc().isoformat()}})
    # Der Sonderweg „Co-Team zuteilen“ gilt als Zusage durch die Leitung.
    other = rows[squad_id(world, 1, 0)]
    division = await flow.db.league_divisions.find_one({"season_id": season["id"], "level": 1}, {"_id": 0})
    staffel = ok(await flow.post(f"{ADMIN}/divisions/{division['id']}/staffeln", json={}))
    ok(await flow.post(f"/api/tournaments/{staffel['tournament_id']}/squad-registrations", json={"team_id": other["team_id"], "squad_id": other["squad_id"]}))
    linked = (await carried(flow, season["id"]))[other["squad_id"]]
    assert linked["assignment"] and linked["carry_over"]["start_right"]["status"] == "accepted"
    assert linked["carry_over"]["start_right"]["accepted_via"] == "assignment"
    # Das Los nimmt nur zugesagte Startrechte.
    draws = ok(await flow.get(f"{ADMIN}/seasons/{season['id']}/draws"))
    first = next(row for row in draws["divisions"] if row["level"] == 1)
    assert [row["application_id"] for row in first["waiting"]] == [promoted["id"]]
    assert len(first["waiting_start_right"]) == 2


@pytest.mark.asyncio
async def test_settings_are_checked_stored_logged_and_can_be_switched_off(flow):
    world = await build(flow, levels=2)
    flow.act_as(world["lead"])
    url = f"{ADMIN}/seasons/{world['season']['id']}/start-rights"
    empty = ok(await flow.get(url))
    assert empty["active"] is False and empty["defaults"] == league_start_rights.defaults() and empty["rows"] == []
    assert (await flow.put(url, json={"active": True, "accept_days": 0})).status_code == 422
    assert (await flow.put(url, json={"active": True, "mode": "invite"})).status_code == 422
    saved = ok(await flow.put(url, json={"active": True, "mode": "accept", "accept_days": 21, "successor": "lead", "remind_hours": 0, "announce": False}))
    assert saved["settings"] == {"mode": "accept", "accept_days": 21, "successor": "lead", "remind_hours": 0, "announce": False}
    assert (await flow.db.league_seasons.find_one({"id": world["season"]["id"]}, {"_id": 0}))["start_rights"]["accept_days"] == 21
    assert await flow.db.audit_logs.count_documents({"action": "league.season.start_rights"}) == 1
    # Das Blatt „Neue Season aus …“ bekommt die Einstellung als Vorgabe für die neue Season.
    preview = ok(await flow.get(f"{ADMIN}/seasons/{world['season']['id']}/successor"))
    assert preview["start_rights"] == {"settings": saved["settings"], "defaults": league_start_rights.defaults()}
    # „announce: aus“: Der bestätigte Endstand meldet nichts.
    await close(flow, world)
    assert await notes(flow, ANNOUNCED) == []
    # Beim Anlegen lässt sich die Einstellung für die neue Season mitgeben.
    season = await successor(flow, world, start_rights={"mode": "accept", "accept_days": 7})
    assert season["start_rights"]["accept_days"] == 7 and season["start_rights"]["successor"] == "next"
    rows = await carried(flow, season["id"])
    # Umschalten auf „automatisch“: Offene Startrechte gelten als zugesagt, niemand verliert seinen Platz.
    new_url = f"{ADMIN}/seasons/{season['id']}/start-rights"
    ok(await flow.put(new_url, json={"active": True, "mode": "auto"}))
    after = await carried(flow, season["id"])
    assert all(row["carry_over"]["start_right"]["status"] == "accepted" and row["carry_over"]["start_right"]["accepted_via"] == "mode"
               for row in after.values())
    # Ausschalten nimmt das Feld weg - es bleibt bei F.2.
    off = ok(await flow.put(new_url, json={"active": False}))
    assert off["active"] is False
    assert "start_rights" not in await flow.db.league_seasons.find_one({"id": season["id"]}, {"_id": 0})
    assert len(rows) == 8


# ---------------------------------------------------------------- Das eigene Team: Prognose und bestätigt

@pytest.mark.asyncio
async def test_the_own_team_reads_forecast_then_confirmed_then_the_offer(flow):
    world = await build(flow, levels=2)
    ok(await configure(flow, world))
    up, stay = squad_id(world, 2, 0), squad_id(world, 2, 1)
    # Sichtbarkeit wie bei der Liga: Solange die Season nur der Leitung gezeigt wird, steht auch hier nichts.
    flow.act_as(await person(flow, up))
    assert ok(await flow.get("/api/me/league-applications"))["start_rights"] == []
    await flow.db.league_seasons.update_one({"id": world["season"]["id"]}, {"$set": {"visibility": "public"}})
    found = ok(await flow.get("/api/me/league-applications"))["start_rights"]
    assert len(found) == 1 and found[0]["state"] == "forecast" and found[0]["movement"] == "up" and found[0]["squad_id"] == up
    assert found[0]["zone_label"] and found[0]["division_label"] is None  # eine Prognose nennt kein Startrecht
    flow.act_as(await person(flow, stay))
    assert ok(await flow.get("/api/me/league-applications"))["start_rights"][0]["movement"] == "stay"
    # Ein Fremder sieht nichts davon.
    flow.act_as(await flow.add_user(name="Fremd"))
    assert ok(await flow.get("/api/me/league-applications"))["start_rights"] == []
    await close(flow, world)
    flow.act_as(await person(flow, up))
    found = ok(await flow.get("/api/me/league-applications"))["start_rights"]
    assert len(found) == 1 and found[0]["state"] == "confirmed" and found[0]["movement"] == "up"
    assert found[0]["division_label"].startswith("Liga 1") and found[0]["rank"] == 1
    # Mit der Folge-Season steht das Startrecht am Antrag - die Vorschau fällt weg.
    await successor(flow, world)
    flow.act_as(await person(flow, up))
    answer_ = ok(await flow.get("/api/me/league-applications"))
    assert answer_["start_rights"] == [] and answer_["items"][0]["carry_over"]["start_right"]["state"] == "offered"


# ---------------------------------------------------------------- Konto löschen

@pytest.mark.asyncio
async def test_deleting_an_account_takes_the_person_out_of_the_start_rights(flow):
    world = await build(flow, levels=2)
    season, rows = await ready(flow, world, successor="lead")
    promoted, second, stays = rows[squad_id(world, 2, 0)], rows[squad_id(world, 2, 1)], rows[squad_id(world, 1, 0)]
    flow.act_as(world["lead"])
    ok(await flow.post(f"{ADMIN}/seasons/{season['id']}/start-rights/{stays['id']}/accept", json={"reason": "Zusage am Telefon"}))
    flow.act_as(await person(flow, promoted["squad_id"]))
    ok(await flow.post(f"/api/me/league-applications/{promoted['id']}/withdraw"))
    flow.act_as(world["lead"])
    ok(await flow.post(f"{ADMIN}/seasons/{season['id']}/start-rights/{promoted['id']}/fill",
                       json={"candidate_id": second["id"], "reason": "Platz 2 der Tabelle rückt nach"}))
    from services.league_applications import scrub_person

    lead_id = world["lead"]["id"]
    scrubbed = await scrub_person(flow.db, lead_id)
    assert scrubbed >= 2
    after = await carried(flow, season["id"])
    assert after[stays["squad_id"]]["carry_over"]["start_right"]["accepted_by"] is None
    assert after[second["squad_id"]]["carry_over"]["fills"]["by"] is None
    assert lead_id not in str(after)
