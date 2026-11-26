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
    # Der Dritte lehnt das Nachrücken ab: zurück in seine Liga - das gilt zugleich als Zusage dort (Entscheidung 26.11.) -, der
    # Vierte rückt nach.
    declined = ok(await answer(flow, third["squad_id"], third["id"], action="decline"))
    assert declined["carry_over"]["division_label"].startswith("Liga 2") and declined["carry_over"]["start_right"]["state"] == "accepted"
    after = await carried(flow, season["id"])
    kept = after[third["squad_id"]]["carry_over"]["start_right"]
    assert kept["status"] == "accepted" and kept["accepted_via"] == "team" and kept["offered_at"] == third["carry_over"]["start_right"]["offered_at"]
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
async def test_once_the_start_date_is_reached_nothing_happens_by_itself_and_the_lead_decides(flow):
    """Entscheidung 26.11. (B): Ab dem Startdatum der Folge-Season - auch im Entwurf - verfällt nichts mehr automatisch und niemand
    rückt automatisch nach. Vorher erzeugte das Nachrücken auf einen Platz mit abgelaufener Frist Lauf für Lauf neue Nachrichten."""
    world = await build(flow, levels=2)
    season, rows = await ready(flow, world, successor="lead")
    promoted, second, silent = rows[squad_id(world, 2, 0)], rows[squad_id(world, 2, 1)], rows[squad_id(world, 1, 0)]
    # Vor dem Start: Der Aufsteiger meldet sich ab - sein Platz wartet (Regel „lead“).
    flow.act_as(await person(flow, promoted["squad_id"]))
    ok(await flow.post(f"/api/me/league-applications/{promoted['id']}/withdraw"))
    await flow.db.league_seasons.update_one({"id": season["id"]}, {"$set": {"start_rights.successor": "next"}})
    # Das Startdatum ist erreicht, die Season ist noch Entwurf.
    assert season["status"] == "draft"
    await flow.db.league_seasons.update_one({"id": season["id"]}, {"$set": {"start_date": (now_utc() - timedelta(hours=1)).isoformat()}})
    before = await carried(flow, season["id"])
    for _run in range(4):
        assert await league_start_rights.sweep(flow.db) == {"expired": 0, "restored": 0, "filled": 0, "reminded": 0, "announced": 0, "paused": 0}
    assert await carried(flow, season["id"]) == before
    for reason in ("league_start_right_expired", "league_start_right_fill", "league_start_right_back", "league_start_right_reminder"):
        assert await notes(flow, reason) == []
    # Das Team kann nicht mehr selbst zusagen - die Leitung entscheidet.
    late = await answer(flow, silent["squad_id"], silent["id"])
    assert late.status_code == 409 and "Frist" in late.json()["detail"]
    item = await own_item(flow, silent["squad_id"], silent["id"])
    right = item["carry_over"]["start_right"]
    assert right["state"] == "offered" and right["waits_for_lead"] is True and right["can_accept"] is False
    view = await overview(flow, world, season["id"])
    row = next(entry for entry in view["rows"] if entry["application_id"] == silent["id"])
    assert view["started"] is True and row["state"] == "offered" and row["waits_for_lead"] is True
    done = ok(await flow.post(f"{ADMIN}/seasons/{season['id']}/start-rights/{silent['id']}/accept", json={"reason": "Zusage am Telefon"}))
    assert done["state"] == "accepted" and done["accepted_via"] == "lead"
    # Nachrücken gibt es nach dem Start nur noch von Hand im Eingang.
    refused = await flow.post(f"{ADMIN}/seasons/{season['id']}/start-rights/{promoted['id']}/fill",
                              json={"candidate_id": second["id"], "reason": "Platz 2 der Tabelle rückt nach"})
    assert refused.status_code == 409 and "begonnen" in refused.json()["detail"]


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
async def test_reopening_the_old_season_rests_the_deadline_and_corrects_the_rights_once(flow):
    """Entscheidung 26.11. (A): Solange der Vorgänger wieder geöffnet ist, steht die Frist still und verlängert sich danach um die
    Dauer der Pause. Zusagen bleibt möglich, nichts verfällt, niemand rückt nach."""
    world = await build(flow, levels=2)
    season, rows = await ready(flow, world)
    winner, runner_up, third, fourth = (rows[squad_id(world, 2, index)] for index in range(4))
    ok(await answer(flow, winner["squad_id"], winner["id"]))
    ok(await answer(flow, runner_up["squad_id"], runner_up["id"]))
    stays = rows[squad_id(world, 1, 0)]
    ok(await answer(flow, stays["squad_id"], stays["id"]))
    # Wieder öffnen (zweite Person): Der Endstand wird geprüft.
    tid = world["tids"][2][0]
    flow.act_as(await second_lead(flow, world))
    ok(await flow.post(f"{STAFFELN}/{tid}/reopen", json={"reason": "Ergebnis vertauscht eingetragen"}))
    paused = await flow.db.league_seasons.find_one({"id": season["id"]}, {"_id": 0})
    assert len(paused["start_right_pauses"]) == 1 and paused["start_right_pauses"][0]["to"] is None
    # Die Pause läuft seit drei Tagen; ohne sie wäre die Frist (zehn Tage) für die beiden Schweigenden seit zwei Tagen vorbei.
    since = now_utc() - timedelta(days=3)
    await flow.db.league_seasons.update_one({"id": season["id"]}, {"$set": {"start_right_pauses.0.from": since.isoformat()}})
    for row in (third, fourth):
        await overdue(flow, row["id"], days=12)
    done = await league_start_rights.sweep(flow.db)
    assert done["paused"] == 1 and done["expired"] == 0 and done["filled"] == 0 and done["reminded"] == 0
    item = await own_item(flow, third["squad_id"], third["id"])
    right = item["carry_over"]["start_right"]
    assert right["state"] == "offered" and right["paused"] is True and right["accept_until"] is None and right["can_accept"] is True
    view = await overview(flow, world, season["id"])
    assert view["paused"] is True
    # Zusagen bleibt in der Pause möglich.
    ok(await answer(flow, third["squad_id"], third["id"]))
    # Korrektur: Der Zweite hat das direkte Spiel gewonnen. Neu abschließen - die Pause endet.
    regs = world["regs"][tid]
    duel = next(match for match in await flow.db.matches_v2.find({"tournament_id": tid}, {"_id": 0}).to_list(None)
                if {slot["registration_id"] for slot in match["slots"]} == {regs[0]["id"], regs[1]["id"]})
    await flow.db.matches_v2.update_one({"id": duel["id"]}, {"$set": {"results": [
        {"registration_id": regs[1]["id"], "rank": 1, "score": 2}, {"registration_id": regs[0]["id"], "rank": 2, "score": 0}]}})
    flow.act_as(world["lead"])
    ok(await flow.post(f"{STAFFELN}/{tid}/close", json={"confirm": True}))
    ended = (await flow.db.league_seasons.find_one({"id": season["id"]}, {"_id": 0}))["start_right_pauses"]
    assert len(ended) == 1 and ended[0]["to"] is not None
    # Die Frist ist um die Dauer der Pause länger: zehn Tage ab Vergabe plus die drei Tage Pause - für den Vierten also noch ein Tag.
    silent = (await carried(flow, season["id"]))[fourth["squad_id"]]
    fresh_season = await flow.db.league_seasons.find_one({"id": season["id"]}, {"_id": 0})
    offered = league_calendar.aware(silent["carry_over"]["start_right"]["offered_at"])
    pause = league_calendar.aware(ended[0]["to"]) - since
    assert league_start_rights.accept_until(silent, fresh_season) == offered + timedelta(days=10) + pause
    assert (await league_start_rights.sweep(flow.db))["expired"] == 0
    assert (await overview(flow, world, season["id"]))["paused"] is False
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
    assert after[third["squad_id"]]["carry_over"]["start_right"]["status"] == "accepted"
    # Ist auch die verlängerte Frist vorbei, verfällt das Startrecht wie immer.
    await overdue(flow, fourth["id"], days=14)
    done = await league_start_rights.sweep(flow.db)
    assert done["paused"] == 0 and done["expired"] == 1
    assert (await carried(flow, season["id"]))[fourth["squad_id"]]["carry_over"]["start_right"]["status"] == "expired"


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
    assert saved["settings"] == {"mode": "accept", "accept_days": 21, "successor": "lead", "remind_hours": 0, "announce": False, "rest_days": 3}
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
    ok(await flow.put(new_url, json={"active": True, "mode": "auto", "confirm_open": True}))
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


# ---------------------------------------------------------------- Leitstand

@pytest.mark.asyncio
async def test_the_desk_does_not_ask_to_assign_a_team_that_has_not_accepted(flow):
    world = await build(flow, levels=2)
    season, rows = await ready(flow, world)
    promoted, waits = rows[squad_id(world, 2, 0)], rows[squad_id(world, 1, 0)]
    ok(await answer(flow, promoted["squad_id"], promoted["id"]))
    flow.act_as(world["lead"])
    data = ok(await flow.get(f"{ADMIN}/seasons/{season['id']}/desk"))
    items = {row["id"]: row for part in data["groups"] if part["key"] == "applications" for row in part["items"]}
    # Zugesagt: zuteilen wie immer. Offen: erst die Zusage - der Weg führt zu den Startrechten, die Frist ist das Fälligkeitsdatum.
    assert items[f"applications:{promoted['id']}"]["action"] == "Zuteilen"
    open_right = items[f"applications:{waits['id']}"]
    assert open_right["action"] == "Startrechte ansehen" and "Zusage" in open_right["text"] and open_right["url"].endswith("#startrechte")
    assert open_right["due_at"] == league_start_rights.accept_until(waits, season).isoformat()


# ---------------------------------------------------------------- Nachbesserung 26.11.: Gegenproben der Prüfung

@pytest.mark.asyncio
async def test_when_everybody_stays_silent_everything_expires_and_nobody_moves_up(flow):
    """M1: Niemand sagt zu, alle Fristen sind vorbei, ein Lauf. Vorher rückten Überfällige nach (4 verfallen, 4 nachgerückt, je nach
    Reihenfolge) - jetzt verfallen alle acht, und niemand rückt nach (Entscheidung 26.11., C)."""
    world = await build(flow, levels=2)
    season, rows = await ready(flow, world)
    for row in rows.values():
        await overdue(flow, row["id"])
    assert await league_start_rights.sweep(flow.db) == {"expired": 8, "restored": 0, "filled": 0, "reminded": 0, "announced": 0, "paused": 0}
    after = await carried(flow, season["id"])
    assert all(row["status"] == "rejected" and row["carry_over"]["start_right"]["status"] == "expired" for row in after.values())
    assert all("fills" not in row["carry_over"] and "filled_by" not in row["carry_over"] for row in after.values())
    assert await notes(flow, "league_start_right_fill") == [] and len(await notes(flow, "league_start_right_expired")) == 16
    assert await league_start_rights.sweep(flow.db) == {"expired": 0, "restored": 0, "filled": 0, "reminded": 0, "announced": 0, "paused": 0}


@pytest.mark.asyncio
async def test_expiry_does_not_depend_on_the_order_and_only_teams_in_time_move_up(flow):
    """M1: Alle Verfälle eines Laufs zuerst, dann das Nachrücken. Der Aufsteiger und der Zweite schweigen, der Dritte hat zugesagt:
    Der Platz in Liga 1 geht an den Dritten - nie an den überfälligen Zweiten, gleich in welcher Reihenfolge der Lauf sie anfasst."""
    world = await build(flow, levels=2)
    season, rows = await ready(flow, world)
    promoted, second, third = (rows[squad_id(world, 2, index)] for index in range(3))
    ok(await answer(flow, third["squad_id"], third["id"]))
    for row in (promoted, second):
        await overdue(flow, row["id"])
    done = await league_start_rights.sweep(flow.db)
    assert done["expired"] == 2 and done["filled"] == 1 and done["restored"] == 0
    after = await carried(flow, season["id"])
    assert after[second["squad_id"]]["status"] == "rejected" and "fills" not in after[second["squad_id"]]["carry_over"]
    assert after[third["squad_id"]]["carry_over"]["division_level"] == 1
    assert after[third["squad_id"]]["carry_over"]["fills"]["for_application_id"] == promoted["id"]
    # Annehmen des Nachrückplatzes gilt zugleich als Zusage.
    ok(await answer(flow, third["squad_id"], third["id"]))
    final = (await carried(flow, season["id"]))[third["squad_id"]]["carry_over"]
    assert final["start_right"]["status"] == "accepted" and final["division_level"] == 1
    # Die Nachricht an die Leitung führt zu den Startrechten.
    lead_notes = await notes(flow, "league_start_right_lead", world["lead"]["id"])
    assert lead_notes and all(row["url"].endswith("#startrechte") for row in lead_notes)


async def tie_places_two_to_four(flow, tid: str, regs: list[dict]) -> None:
    """Platz 2 bis 4 schlagen sich im Kreis: gleiche Punkte, gleiche Differenz, direkter Vergleich ohne Sieger."""
    wins = [(regs[1]["id"], regs[2]["id"]), (regs[2]["id"], regs[3]["id"]), (regs[3]["id"], regs[1]["id"])]
    for match in await flow.db.matches_v2.find({"tournament_id": tid}, {"_id": 0}).to_list(None):
        pair = {slot["registration_id"] for slot in match.get("slots") or [] if slot.get("registration_id")}
        for winner, loser in wins:
            if pair == {winner, loser}:
                await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"results": [
                    {"registration_id": winner, "rank": 1, "score": 2}, {"registration_id": loser, "rank": 2, "score": 0}]}})


@pytest.mark.asyncio
async def test_a_shared_place_never_moves_up_by_itself(flow):
    """M2: Liga 2, Platz 2 bis 4 punkt- und differenzgleich. Meldet sich der Aufsteiger ab, rückt niemand automatisch nach - die
    Leitung wählt mit Grund (kein Los, Nr. 156)."""
    world = await build(flow, levels=2)
    tid = world["tids"][2][0]
    await tie_places_two_to_four(flow, tid, world["regs"][tid])
    season, rows = await ready(flow, world)
    final = await flow.db.league_final_tables.find_one({"tournament_id": tid, "active": True}, {"_id": 0})
    assert sorted(row["rank"] for row in final["rows"]) == [1, 2, 2, 2]
    promoted = rows[squad_id(world, 2, 0)]
    tied = sorted(rows[squad_id(world, 2, index)]["id"] for index in (1, 2, 3))
    flow.act_as(await person(flow, promoted["squad_id"]))
    ok(await flow.post(f"/api/me/league-applications/{promoted['id']}/withdraw"))
    after = await carried(flow, season["id"])
    assert all("fills" not in row["carry_over"] for row in after.values()) and "filled_by" not in after[promoted["squad_id"]]["carry_over"]
    assert await notes(flow, "league_start_right_fill") == []
    place = (await overview(flow, world, season["id"]))["open_places"][0]
    assert place["pick"] is None and sorted(place["tied"]) == tied and sorted(row["application_id"] for row in place["candidates"]) == tied
    chosen = rows[squad_id(world, 2, 3)]
    ok(await flow.post(f"{ADMIN}/seasons/{season['id']}/start-rights/{promoted['id']}/fill",
                       json={"candidate_id": chosen["id"], "reason": "Entscheid der Leitung nach Sichtung der Spiele"}))
    assert (await carried(flow, season["id"]))[chosen["squad_id"]]["carry_over"]["division_level"] == 1


@pytest.mark.asyncio
async def test_a_decision_changed_after_the_last_close_corrects_the_announcement(flow):
    """M3: Der Entscheid „bester Zweiter“ wird nach dem letzten Abschluss umgesetzt (A2 → B2). A2 erfährt „Endstand korrigiert“, B2
    bekommt die Bestätigung - vorher blieb A2 bei „Aufstieg bestätigt“ und B2 bekam nichts."""
    world = await build(flow, levels=2, staffeln={2: [4, 4]}, zones={2: {"promote": 1, "promote_best": 1}})
    ok(await configure(flow, world))
    top, first, second = world["tids"][1][0], *world["tids"][2]
    a2, b2 = world["regs"][first][1], world["regs"][second][1]
    url = f"{ADMIN}/divisions/{world['divisions'][2]['id']}/zone-decision"
    body = {"kind": "promote_best", "method": "playoff", "reason": "Entscheidungsspiel 3:1"}
    flow.act_as(world["lead"])
    await close(flow, world, top, first)
    ok(await flow.put(url, json={**body, "registration_ids": [a2["id"]]}))
    await close(flow, world, second)
    first_note = await notes(flow, ANNOUNCED, (await person(flow, a2["squad_id"]))["id"])
    assert [row["title"] for row in first_note] == ["Aufstieg bestätigt"]
    assert await notes(flow, ANNOUNCED, (await person(flow, b2["squad_id"]))["id"]) == []
    # Der Entscheid wird zurückgenommen: Der Gleichstand ist wieder offen - gemeldet wird nichts, bis neu entschieden ist.
    flow.act_as(world["lead"])
    ok(await flow.client.request("DELETE", f"{url}/promote_best", json={"reason": "Entscheidungsspiel wird wiederholt"}))
    assert len(await notes(flow, ANNOUNCED, (await person(flow, a2["squad_id"]))["id"])) == 1
    flow.act_as(world["lead"])
    ok(await flow.put(url, json={**body, "registration_ids": [b2["id"]], "reason": "Wiederholung 2:3"}))
    old = await notes(flow, ANNOUNCED, (await person(flow, a2["squad_id"]))["id"])
    new = await notes(flow, ANNOUNCED, (await person(flow, b2["squad_id"]))["id"])
    assert sorted(row["title"] for row in old) == ["Aufstieg bestätigt", "Endstand korrigiert"]
    assert [row["title"] for row in new] == ["Aufstieg bestätigt"]
    # Derselbe Stand noch einmal: nichts doppelt.
    assert (await league_start_rights.announce(flow.db, world["season"]["id"]))["sent"] == 0


@pytest.mark.asyncio
async def test_in_automatic_mode_the_successor_moves_at_once_and_may_decline_until_the_start(flow):
    world = await build(flow, levels=2)
    season, rows = await ready(flow, world, mode="auto")
    assert all("start_right" not in row["carry_over"] for row in rows.values())
    promoted, second, third = (rows[squad_id(world, 2, index)] for index in range(3))
    flow.act_as(await person(flow, promoted["squad_id"]))
    ok(await flow.post(f"/api/me/league-applications/{promoted['id']}/withdraw"))
    moved = (await carried(flow, season["id"]))[second["squad_id"]]["carry_over"]
    assert moved["division_level"] == 1 and "start_right" not in moved and moved["fills"]["back"]["division_level"] == 2
    told = await notes(flow, "league_start_right_fill", (await person(flow, second["squad_id"]))["id"])
    assert len(told) == 1 and "automatisch dabei" in told[0]["body"]
    item = await own_item(flow, second["squad_id"], second["id"])
    right = item["carry_over"]["start_right"]
    assert right["state"] == "confirmed" and right["can_decline"] is True and right["can_accept"] is False
    # Ablehnen: zurück in die eigene Liga, der Nächste rückt nach.
    back = ok(await answer(flow, second["squad_id"], second["id"], action="decline"))
    assert back["carry_over"]["division_label"].startswith("Liga 2")
    after = await carried(flow, season["id"])
    assert "fills" not in after[second["squad_id"]]["carry_over"] and after[third["squad_id"]]["carry_over"]["division_level"] == 1


@pytest.mark.asyncio
async def test_switching_to_automatic_asks_first_and_a_successor_keeps_the_choice(flow):
    """Entscheidung 26.11. (D): Umschalten oder Ausschalten fragt nach, bevor offene Startrechte als zugesagt gelten. Ein Nachrücker
    darf danach weiter bis zum Start ablehnen."""
    world = await build(flow, levels=2)
    season, rows = await ready(flow, world)
    promoted, second = rows[squad_id(world, 2, 0)], rows[squad_id(world, 2, 1)]
    flow.act_as(await person(flow, promoted["squad_id"]))
    ok(await flow.post(f"/api/me/league-applications/{promoted['id']}/withdraw"))
    url = f"{ADMIN}/seasons/{season['id']}/start-rights"
    flow.act_as(world["lead"])
    assert ok(await flow.get(url))["open_rights"] == 7
    for body in ({"active": True, "mode": "auto"}, {"active": False}):
        asked = await flow.put(url, json=body)
        assert asked.status_code == 409 and "7 offene Startrechte" in asked.json()["detail"], body
    assert all(row["carry_over"]["start_right"]["status"] == "offered" for row in (await carried(flow, season["id"])).values()
               if row["status"] == "accepted")
    assert (await flow.db.league_seasons.find_one({"id": season["id"]}, {"_id": 0}))["start_rights"]["mode"] == "accept"
    # Ohne offene Startrechte fragt niemand: eine andere Einstellung speichert wie immer.
    ok(await flow.put(url, json={"active": True, "accept_days": 9}))
    ok(await flow.put(url, json={"active": True, "mode": "auto", "confirm_open": True}))
    moved = (await carried(flow, season["id"]))[second["squad_id"]]
    assert moved["carry_over"]["start_right"]["accepted_via"] == "mode" and moved["carry_over"]["fills"]
    item = await own_item(flow, second["squad_id"], second["id"])
    assert item["carry_over"]["start_right"]["can_decline"] is True
    back = ok(await answer(flow, second["squad_id"], second["id"], action="decline"))
    assert back["carry_over"]["division_label"].startswith("Liga 2")
    # Zurück in der eigenen Liga gilt im Modus „automatisch“ nichts mehr als offen.
    restored = (await carried(flow, season["id"]))[second["squad_id"]]["carry_over"]
    assert restored["start_right"]["status"] == "accepted" and "fills" not in restored


@pytest.mark.asyncio
async def test_the_reminder_does_not_come_right_after_the_offer(flow):
    world = await build(flow, levels=2)
    season, rows = await ready(flow, world, accept_days=1, remind_hours=48)
    assert (await league_start_rights.sweep(flow.db))["reminded"] == 0
    # Zur Hälfte der Frist: einmal.
    for row in rows.values():
        await flow.db.league_applications.update_one({"id": row["id"]}, {"$set": {
            "carry_over.start_right.offered_at": (now_utc() - timedelta(hours=13)).isoformat()}})
    assert (await league_start_rights.sweep(flow.db))["reminded"] == 8
    assert (await league_start_rights.sweep(flow.db))["reminded"] == 0


@pytest.mark.asyncio
async def test_the_waitlist_is_no_way_around_the_acceptance(flow):
    """Die Leitung stuft ein übernommenes Co-Team auf die Warteliste zurück und nimmt es wieder an: Mit Staffel geht das erst nach der
    Zusage, ohne Staffel beginnt die Frist neu. Auf der Warteliste verfällt nichts."""
    world = await build(flow, levels=2)
    season, rows = await ready(flow, world)
    row = rows[squad_id(world, 1, 0)]
    base = f"{ADMIN}/seasons/{season['id']}/applications/{row['id']}"
    flow.act_as(world["lead"])
    ok(await flow.post(f"{base}/waitlist", json={"reason": "Kader wird noch geklärt"}))
    await overdue(flow, row["id"])
    done = await league_start_rights.sweep(flow.db)
    assert done["expired"] == 0 and (await carried(flow, season["id"]))[row["squad_id"]]["status"] == "waitlist"
    division = await flow.db.league_divisions.find_one({"season_id": season["id"], "level": 1}, {"_id": 0})
    flow.act_as(world["lead"])
    staffel = ok(await flow.post(f"{ADMIN}/divisions/{division['id']}/staffeln", json={}))
    refused = await flow.post(f"{base}/accept", json={"tournament_id": staffel["tournament_id"]})
    assert refused.status_code == 422 and "Startrecht" in refused.json()["detail"]
    waiting = (await carried(flow, season["id"]))[row["squad_id"]]
    assert waiting["status"] == "waitlist" and "assignment" not in waiting
    ok(await flow.post(f"{base}/accept", json={}))
    back = (await carried(flow, season["id"]))[row["squad_id"]]
    assert back["status"] == "accepted" and back["carry_over"]["start_right"]["status"] == "offered"
    assert back["carry_over"]["start_right"]["offered_at"] > row["carry_over"]["start_right"]["offered_at"]
    assert (await league_start_rights.sweep(flow.db))["expired"] == 0
    ok(await answer(flow, row["squad_id"], row["id"]))
    flow.act_as(world["lead"])
    ok(await flow.post(f"{base}/assign", json={"tournament_id": staffel["tournament_id"]}))


@pytest.mark.asyncio
async def test_recompute_makes_a_successor_a_regular_right_when_the_final_now_says_the_same_division(flow):
    """Prüfer-Frage 4: Der Nachrücker steht nach dem korrigierten Endstand selbst auf dem Aufstiegsplatz. Dann ist er kein Nachrücker
    mehr - „Ablehnen“ darf ihn nicht in die alte Liga führen."""
    world = await build(flow, levels=2)
    season, rows = await ready(flow, world)
    winner, runner_up = rows[squad_id(world, 2, 0)], rows[squad_id(world, 2, 1)]
    flow.act_as(await person(flow, winner["squad_id"]))
    ok(await flow.post(f"/api/me/league-applications/{winner['id']}/withdraw"))
    moved = (await carried(flow, season["id"]))[runner_up["squad_id"]]["carry_over"]
    assert moved["division_level"] == 1 and moved["fills"]["back"]["division_level"] == 2
    # Wieder öffnen, der Zweite gewinnt das direkte Spiel, neu abschließen: Er ist jetzt selbst der Aufsteiger.
    tid = world["tids"][2][0]
    regs = world["regs"][tid]
    flow.act_as(await second_lead(flow, world))
    ok(await flow.post(f"{STAFFELN}/{tid}/reopen", json={"reason": "Ergebnis vertauscht eingetragen"}))
    duel = next(match for match in await flow.db.matches_v2.find({"tournament_id": tid}, {"_id": 0}).to_list(None)
                if {slot["registration_id"] for slot in match["slots"]} == {regs[0]["id"], regs[1]["id"]})
    await flow.db.matches_v2.update_one({"id": duel["id"]}, {"$set": {"results": [
        {"registration_id": regs[1]["id"], "rank": 1, "score": 2}, {"registration_id": regs[0]["id"], "rank": 2, "score": 0}]}})
    flow.act_as(world["lead"])
    ok(await flow.post(f"{STAFFELN}/{tid}/close", json={"confirm": True}))
    preview = ok(await flow.get(f"{ADMIN}/seasons/{season['id']}/successor/recompute"))
    ok(await flow.post(f"{ADMIN}/seasons/{season['id']}/successor/recompute", json={"confirm": True, "stamp": preview["stamp"]}))
    after = await carried(flow, season["id"])
    fresh = after[runner_up["squad_id"]]["carry_over"]
    assert fresh["division_level"] == 1 and fresh["movement"] == "up" and fresh["rank"] == 1
    assert "fills" not in fresh
    item = await own_item(flow, runner_up["squad_id"], runner_up["id"])
    assert item["carry_over"]["start_right"]["can_decline"] is False and item["carry_over"]["start_right"]["fills"] is None
    refused = await answer(flow, runner_up["squad_id"], runner_up["id"], action="decline")
    assert refused.status_code == 409


@pytest.mark.asyncio
async def test_deleting_an_account_also_clears_who_revoked_a_right(flow):
    world = await build(flow, levels=2)
    season, rows = await ready(flow, world)
    row = rows[squad_id(world, 1, 0)]
    await flow.db.league_applications.update_one({"id": row["id"]}, {"$set": {"carry_over.revoked_by": "person-x", "carry_over.revoked_at": LONG_AGO}})
    from services.league_applications import scrub_person

    assert await scrub_person(flow.db, "person-x") == 1
    assert (await carried(flow, season["id"]))[row["squad_id"]]["carry_over"]["revoked_by"] is None


# ---------------------------------------------------------------- Nachbesserung 26.11. (N1): Nachrück-Angebot und die eigene Frist

async def moved_up_late(flow, world: dict, *, offer_days_ago: int = 3, **settings) -> tuple[dict, dict, dict]:
    """Frist zehn Tage. Der Aufsteiger meldet sich ab, der Zweite rückt nach - sein eigenes Startrecht ist noch offen. Rückdatiert: Das
    Angebot kam vor ``offer_days_ago`` Tagen, damals hatte die eigene Frist (vergeben vor zwölf Tagen) noch einen Tag.
    Antwort: (neue Season, frei gewordener Antrag, Nachrücker)."""
    season, rows = await ready(flow, world, **settings)
    promoted, second = rows[squad_id(world, 2, 0)], rows[squad_id(world, 2, 1)]
    flow.act_as(await person(flow, promoted["squad_id"]))
    ok(await flow.post(f"/api/me/league-applications/{promoted['id']}/withdraw"))
    moved = (await carried(flow, season["id"]))[second["squad_id"]]["carry_over"]
    assert moved["fills"]["back"]["start_right"]["status"] == "offered"
    at = (now_utc() - timedelta(days=offer_days_ago)).isoformat()
    await flow.db.league_applications.update_one({"id": second["id"]}, {"$set": {
        "carry_over.fills.at": at, "carry_over.start_right.offered_at": at,
        "carry_over.fills.back.start_right.offered_at": (now_utc() - timedelta(days=offer_days_ago + 9)).isoformat()}})
    return season, promoted, second


@pytest.mark.asyncio
async def test_declining_to_move_up_counts_as_acceptance_for_the_own_division(flow):
    """N1: Tag 9 nachgerückt, Tag 12 abgelehnt. Vorher verfiel das eigene Startrecht sofort - jetzt gilt das Ablehnen als Zusage
    für die eigene Liga."""
    world = await build(flow, levels=2)
    season, _promoted, second = await moved_up_late(flow, world)
    told = await notes(flow, "league_start_right_fill", (await person(flow, second["squad_id"]))["id"])
    assert len(told) == 1 and "gilt das als Zusage für Liga 2" in told[0]["body"] and "mindestens 3 Tage" in told[0]["body"]
    item = await own_item(flow, second["squad_id"], second["id"])
    assert item["carry_over"]["start_right"]["fills"] == {"from_label": item["carry_over"]["start_right"]["fills"]["from_label"],
                                                         "own_open": True, "rest_days": 3}
    back = ok(await answer(flow, second["squad_id"], second["id"], action="decline"))
    assert back["carry_over"]["division_label"].startswith("Liga 2") and back["carry_over"]["start_right"]["state"] == "accepted"
    stored = (await carried(flow, season["id"]))[second["squad_id"]]
    assert stored["status"] == "accepted" and stored["carry_over"]["start_right"]["status"] == "accepted"
    assert stored["carry_over"]["start_right"]["accepted_via"] == "team" and "fills" not in stored["carry_over"]
    done = await league_start_rights.sweep(flow.db)
    assert done["expired"] == 0
    assert (await carried(flow, season["id"]))[second["squad_id"]]["status"] == "accepted"


@pytest.mark.asyncio
async def test_silence_on_the_offer_falls_back_with_the_rest_of_the_own_deadline(flow):
    """N1: Der Nachrücker schweigt. Vorher fiel er zurück und verfiel im selben Lauf - jetzt ruhte seine eigene Frist, und er hat
    in der eigenen Liga die Restfrist, mindestens drei Tage."""
    world = await build(flow, levels=2)
    season, _promoted, second = await moved_up_late(flow, world, offer_days_ago=11)
    before = now_utc()
    done = await league_start_rights.sweep(flow.db)
    assert done["restored"] == 1 and done["expired"] == 0
    fresh_season = await flow.db.league_seasons.find_one({"id": season["id"]}, {"_id": 0})
    stored = (await carried(flow, season["id"]))[second["squad_id"]]
    assert stored["status"] == "accepted" and stored["carry_over"]["division_level"] == 2
    assert stored["carry_over"]["start_right"]["status"] == "offered" and "fills" not in stored["carry_over"]
    until = league_start_rights.accept_until(stored, fresh_season)
    assert before + timedelta(days=3) <= until <= now_utc() + timedelta(days=3)
    told = await notes(flow, "league_start_right_back", (await person(flow, second["squad_id"]))["id"])
    assert len(told) == 1 and "bleibt in Liga 2" in told[0]["body"] and "zusagen" in told[0]["body"]
    # Ein zweiter Lauf lässt es stehen; zusagen geht.
    assert (await league_start_rights.sweep(flow.db))["expired"] == 0
    ok(await answer(flow, second["squad_id"], second["id"]))
    assert (await carried(flow, season["id"]))[second["squad_id"]]["carry_over"]["start_right"]["status"] == "accepted"


@pytest.mark.asyncio
async def test_after_the_rest_the_own_right_expires_like_any_other(flow):
    world = await build(flow, levels=2)
    season, _promoted, second = await moved_up_late(flow, world, offer_days_ago=11)
    assert (await league_start_rights.sweep(flow.db))["restored"] == 1
    await flow.db.league_applications.update_one({"id": second["id"]}, {"$set": {
        "carry_over.start_right.min_until": (now_utc() - timedelta(hours=1)).isoformat(),
        "carry_over.start_right.offered_at": (now_utc() - timedelta(days=40)).isoformat()}})
    done = await league_start_rights.sweep(flow.db)
    assert done["expired"] == 1
    assert (await carried(flow, season["id"]))[second["squad_id"]]["carry_over"]["start_right"]["status"] == "expired"


@pytest.mark.asyncio
async def test_the_rest_never_reaches_beyond_the_start_date_and_then_the_lead_decides(flow):
    """N1 mit B: Fällt das Startdatum in die Restfrist, endet sie dort - verfallen tut danach nichts mehr, die Leitung entscheidet."""
    world = await build(flow, levels=2)
    season, _promoted, second = await moved_up_late(flow, world, offer_days_ago=11)
    start = now_utc() + timedelta(days=1)
    await flow.db.league_seasons.update_one({"id": season["id"]}, {"$set": {"start_date": start.isoformat()}})
    assert (await league_start_rights.sweep(flow.db))["restored"] == 1
    fresh_season = await flow.db.league_seasons.find_one({"id": season["id"]}, {"_id": 0})
    stored = (await carried(flow, season["id"]))[second["squad_id"]]
    assert league_start_rights.accept_until(stored, fresh_season) == league_calendar.aware(start.isoformat())
    await flow.db.league_seasons.update_one({"id": season["id"]}, {"$set": {"start_date": (now_utc() - timedelta(minutes=5)).isoformat()}})
    assert await league_start_rights.sweep(flow.db) == {"expired": 0, "restored": 0, "filled": 0, "reminded": 0, "announced": 0, "paused": 0}
    item = await own_item(flow, second["squad_id"], second["id"])
    assert item["carry_over"]["start_right"]["state"] == "offered" and item["carry_over"]["start_right"]["waits_for_lead"] is True


@pytest.mark.asyncio
async def test_an_open_offer_at_the_start_date_stays_with_the_lead(flow):
    """N1 mit B: Das Startdatum ist erreicht, während das Nachrück-Angebot noch offen ist - nichts fällt von selbst zurück."""
    world = await build(flow, levels=2)
    season, _promoted, second = await moved_up_late(flow, world, offer_days_ago=11)
    await flow.db.league_seasons.update_one({"id": season["id"]}, {"$set": {"start_date": (now_utc() - timedelta(minutes=5)).isoformat()}})
    assert await league_start_rights.sweep(flow.db) == {"expired": 0, "restored": 0, "filled": 0, "reminded": 0, "announced": 0, "paused": 0}
    stored = (await carried(flow, season["id"]))[second["squad_id"]]["carry_over"]
    assert stored["division_level"] == 1 and stored["fills"] and stored["start_right"]["status"] == "offered"


# ---------------------------------------------------------------- Zurückgenommener Nachrücker (Prüfer-Frage 2)

@pytest.mark.asyncio
@pytest.mark.parametrize("rule", ["next", "lead"])
async def test_a_revoked_successor_frees_the_place_again(flow, rule):
    """Der Nachrücker ist nach dem korrigierten Endstand nicht mehr dabei („Übernahme neu berechnen“ nimmt ihn zurück): Der Platz ist
    wieder frei, und es gilt die Nachrückerregel der Season - automatisch oder als Vorschlag für die Leitung."""
    world = await build(flow, levels=2)
    season, rows = await ready(flow, world, successor=rule)
    promoted, second, third = (rows[squad_id(world, 2, index)] for index in range(3))
    flow.act_as(await person(flow, promoted["squad_id"]))
    ok(await flow.post(f"/api/me/league-applications/{promoted['id']}/withdraw"))
    if rule == "lead":
        flow.act_as(world["lead"])
        ok(await flow.post(f"{ADMIN}/seasons/{season['id']}/start-rights/{promoted['id']}/fill",
                           json={"candidate_id": second["id"], "reason": "Platz 2 der Tabelle rückt nach"}))
    assert (await carried(flow, season["id"]))[promoted["squad_id"]]["carry_over"]["filled_by"]["application_id"] == second["id"]
    # Wieder öffnen, der Zweite wird disqualifiziert, neu abschließen, neu berechnen.
    tid = world["tids"][2][0]
    flow.act_as(await second_lead(flow, world))
    ok(await flow.post(f"{STAFFELN}/{tid}/reopen", json={"reason": "Disqualifikation nachgetragen"}))
    await flow.db.tournament_registrations.update_one({"id": world["regs"][tid][1]["id"]}, {"$set": {
        "status": "disqualified", "removal": {"at": LONG_AGO, "mode": "forfeit"}}})
    flow.act_as(world["lead"])
    ok(await flow.post(f"{STAFFELN}/{tid}/close", json={"confirm": True}))
    preview = ok(await flow.get(f"{ADMIN}/seasons/{season['id']}/successor/recompute"))
    assert {change["squad_id"]: change["kind"] for change in preview["changes"]}[second["squad_id"]] == "revoked"
    ok(await flow.post(f"{ADMIN}/seasons/{season['id']}/successor/recompute", json={"confirm": True, "stamp": preview["stamp"]}))
    after = await carried(flow, season["id"])
    gone = after[second["squad_id"]]
    assert gone["status"] == "rejected" and gone["carry_over"]["revoked_at"] and "fills" not in gone["carry_over"]
    freed = after[promoted["squad_id"]]["carry_over"]
    if rule == "next":
        # Die Regel greift sofort: Der Nächste rückt nach.
        assert freed["filled_by"]["application_id"] == third["id"]
        assert after[third["squad_id"]]["carry_over"]["division_level"] == 1 and after[third["squad_id"]]["carry_over"]["fills"]
    else:
        assert "filled_by" not in freed
        place = (await overview(flow, world, season["id"]))["open_places"][0]
        assert place["application_id"] == promoted["id"] and place["pick"] == third["id"]


# ---------------------------------------------------------------- Pause: verpasster Beginn, Reihenfolge, früher Ausstieg

@pytest.mark.asyncio
async def test_a_missed_pause_starts_at_the_reopening_not_at_the_job(flow):
    """Fehlte der Schritt in der Route (etwa durch einen Absturz), holt der Job die Pause nach - ab dem Wiederöffnen, nicht ab jetzt."""
    world = await build(flow, levels=2)
    season, rows = await ready(flow, world)
    tid = world["tids"][2][0]
    flow.act_as(await second_lead(flow, world))
    ok(await flow.post(f"{STAFFELN}/{tid}/reopen", json={"reason": "Ergebnis vertauscht eingetragen"}))
    reopened = (now_utc() - timedelta(days=2)).isoformat()
    await flow.db.league_seasons.update_one({"id": season["id"]}, {"$unset": {"start_right_pauses": ""}})
    await flow.db.league_final_tables.update_many({"tournament_id": tid, "reopened_at": {"$ne": None}}, {"$set": {"reopened_at": reopened}})
    assert (await league_start_rights.sweep(flow.db))["paused"] == 1
    pauses = (await flow.db.league_seasons.find_one({"id": season["id"]}, {"_id": 0}))["start_right_pauses"]
    assert pauses == [{"from": reopened, "to": None}]


@pytest.mark.asyncio
async def test_the_pause_is_recorded_even_when_the_announcement_fails(flow, monkeypatch):
    """Erst der Pausenabgleich, dann die Nachricht: Ein Fehler beim Melden lässt keine Frist weiterlaufen."""
    world = await build(flow, levels=2)
    season, _rows = await ready(flow, world)

    async def broken(_db, _season_id):
        raise RuntimeError("Nachricht kaputt")

    monkeypatch.setattr(league_start_rights, "announce", broken)
    tid = world["tids"][2][0]
    flow.act_as(await second_lead(flow, world))
    ok(await flow.post(f"{STAFFELN}/{tid}/reopen", json={"reason": "Ergebnis vertauscht eingetragen"}))
    paused = await flow.db.league_seasons.find_one({"id": season["id"]}, {"_id": 0})
    assert len(paused["start_right_pauses"]) == 1 and paused["start_right_pauses"][0]["to"] is None


@pytest.mark.asyncio
async def test_after_the_start_date_the_job_does_not_even_read_the_final_standings(flow, monkeypatch):
    world = await build(flow, levels=2)
    season, _rows = await ready(flow, world)
    await flow.db.league_seasons.update_one({"id": season["id"]}, {"$set": {"start_date": (now_utc() - timedelta(minutes=5)).isoformat()}})
    calls = []

    async def counted(_db, _season):
        calls.append(1)
        raise AssertionError("nach dem Startdatum wird der Endstand nicht mehr gelesen")

    monkeypatch.setattr(league_start_rights, "_context", counted)
    assert await league_start_rights.sweep(flow.db) == {"expired": 0, "restored": 0, "filled": 0, "reminded": 0, "announced": 0, "paused": 0}
    assert calls == []


@pytest.mark.asyncio
async def test_back_from_the_waitlist_in_automatic_mode_nothing_is_offered_again(flow):
    world = await build(flow, levels=2)
    season, rows = await ready(flow, world)
    row = rows[squad_id(world, 1, 0)]
    base = f"{ADMIN}/seasons/{season['id']}/applications/{row['id']}"
    flow.act_as(world["lead"])
    ok(await flow.post(f"{base}/waitlist", json={"reason": "Kader wird noch geklärt"}))
    # Umschalten auf „automatisch“: Auf der Warteliste bleibt das Startrecht offen (es zählt nicht zu den offenen Zusagen) ...
    ok(await flow.put(f"{ADMIN}/seasons/{season['id']}/start-rights", json={"active": True, "mode": "auto", "confirm_open": True}))
    assert (await carried(flow, season["id"]))[row["squad_id"]]["carry_over"]["start_right"]["status"] == "offered"
    # ... und beim Annehmen entsteht daraus kein neues „Zusage offen“, auch gleich mit Staffel.
    division = await flow.db.league_divisions.find_one({"season_id": season["id"], "level": 1}, {"_id": 0})
    staffel = ok(await flow.post(f"{ADMIN}/divisions/{division['id']}/staffeln", json={}))
    ok(await flow.post(f"{base}/accept", json={"tournament_id": staffel["tournament_id"]}))
    back = (await carried(flow, season["id"]))[row["squad_id"]]
    assert back["status"] == "accepted" and back["assignment"] and back["carry_over"]["start_right"]["status"] == "accepted"
    assert back["carry_over"]["start_right"]["accepted_via"] == "mode"


# ---------------------------------------------------------------- Dritte Nachbesserung: P1, P2 und Randfälle

async def flip(flow, tid: str, winner: dict, loser: dict) -> None:
    """Korrektur eines Ergebnisses: ``winner`` hat das direkte Spiel gegen ``loser`` gewonnen."""
    duel = next(match for match in await flow.db.matches_v2.find({"tournament_id": tid}, {"_id": 0}).to_list(None)
                if {slot["registration_id"] for slot in match["slots"]} == {winner["id"], loser["id"]})
    await flow.db.matches_v2.update_one({"id": duel["id"]}, {"$set": {"results": [
        {"registration_id": winner["id"], "rank": 1, "score": 2}, {"registration_id": loser["id"], "rank": 2, "score": 0}]}})


async def recompute(flow, world: dict, season: dict) -> dict:
    flow.act_as(world["lead"])
    preview = ok(await flow.get(f"{ADMIN}/seasons/{season['id']}/successor/recompute"))
    return ok(await flow.post(f"{ADMIN}/seasons/{season['id']}/successor/recompute", json={"confirm": True, "stamp": preview["stamp"]}))


@pytest.mark.asyncio
@pytest.mark.parametrize("rule", ["next", "lead"])
async def test_a_place_that_the_corrected_final_no_longer_knows_is_not_given_away_again(flow, rule):
    """P1: X (Erster der Liga 2) meldet sich ab, N rückt nach. Korrektur: N wird disqualifiziert, der Dritte schlägt X und ist jetzt
    selbst Erster - er steigt aus eigenem Recht auf. Der Platz von X in Liga 1 besteht damit nicht mehr; vorher wurde er trotzdem
    wieder vergeben (zwei Aufsteiger aus Liga 2)."""
    world = await build(flow, levels=2)
    season, rows = await ready(flow, world, successor=rule)
    x, n, third, fourth = (rows[squad_id(world, 2, index)] for index in range(4))
    flow.act_as(await person(flow, x["squad_id"]))
    ok(await flow.post(f"/api/me/league-applications/{x['id']}/withdraw"))
    if rule == "lead":
        flow.act_as(world["lead"])
        ok(await flow.post(f"{ADMIN}/seasons/{season['id']}/start-rights/{x['id']}/fill", json={"candidate_id": n["id"], "reason": "Platz 2 rückt nach"}))
    assert (await carried(flow, season["id"]))[n["squad_id"]]["carry_over"]["division_level"] == 1
    tid = world["tids"][2][0]
    regs = world["regs"][tid]
    flow.act_as(await second_lead(flow, world))
    ok(await flow.post(f"{STAFFELN}/{tid}/reopen", json={"reason": "Disqualifikation und Ergebnis nachgetragen"}))
    await flow.db.tournament_registrations.update_one({"id": regs[1]["id"]}, {"$set": {"status": "disqualified", "removal": {"at": LONG_AGO, "mode": "forfeit"}}})
    await flip(flow, tid, regs[2], regs[0])
    flow.act_as(world["lead"])
    ok(await flow.post(f"{STAFFELN}/{tid}/close", json={"confirm": True}))
    await recompute(flow, world, season)
    after = await carried(flow, season["id"])
    assert after[third["squad_id"]]["carry_over"]["division_level"] == 1 and "fills" not in after[third["squad_id"]]["carry_over"]
    assert after[n["squad_id"]]["status"] == "rejected" and after[n["squad_id"]]["carry_over"]["revoked_at"]
    # Genau ein Aufsteiger aus Liga 2: Niemand rückt auf den Platz nach, den es nicht mehr gibt.
    up = [row["display_name"] for row in after.values() if row["status"] == "accepted" and row["carry_over"]["from_level"] == 2
          and row["carry_over"]["division_level"] == 1]
    assert up == [third["display_name"]]
    assert "fills" not in after[fourth["squad_id"]]["carry_over"] and after[fourth["squad_id"]]["carry_over"]["division_level"] == 2
    assert "filled_by" not in after[x["squad_id"]]["carry_over"]
    assert (await overview(flow, world, season["id"]))["open_places"] == []
    # Auch von Hand gibt es diesen Platz nicht mehr.
    refused = await flow.post(f"{ADMIN}/seasons/{season['id']}/start-rights/{x['id']}/fill",
                              json={"candidate_id": fourth["id"], "reason": "Platz soll trotzdem vergeben werden"})
    assert refused.status_code == 409


@pytest.mark.asyncio
async def test_a_successor_who_withdraws_frees_the_place_for_the_next_one(flow):
    """Der Nachrücker meldet sich ganz ab: Der Platz, auf den er nachgerückt war, geht nach der Regel an den Nächsten."""
    world = await build(flow, levels=2)
    season, rows = await ready(flow, world)
    x, n, third = (rows[squad_id(world, 2, index)] for index in range(3))
    flow.act_as(await person(flow, x["squad_id"]))
    ok(await flow.post(f"/api/me/league-applications/{x['id']}/withdraw"))
    flow.act_as(await person(flow, n["squad_id"]))
    ok(await flow.post(f"/api/me/league-applications/{n['id']}/withdraw"))
    after = await carried(flow, season["id"])
    assert after[x["squad_id"]]["carry_over"]["filled_by"]["application_id"] == third["id"]
    assert after[third["squad_id"]]["carry_over"]["division_level"] == 1 and after[third["squad_id"]]["carry_over"]["fills"]["for_application_id"] == x["id"]
    # Der abgemeldete Nachrücker selbst ist kein zweiter freier Platz in Liga 1.
    assert (await overview(flow, world, season["id"]))["open_places"] == []


@pytest.mark.asyncio
async def test_a_successor_rejected_by_the_lead_frees_the_place_again(flow):
    world = await build(flow, levels=2)
    season, rows = await ready(flow, world, successor="lead")
    x, n, third = (rows[squad_id(world, 2, index)] for index in range(3))
    flow.act_as(await person(flow, x["squad_id"]))
    ok(await flow.post(f"/api/me/league-applications/{x['id']}/withdraw"))
    flow.act_as(world["lead"])
    ok(await flow.post(f"{ADMIN}/seasons/{season['id']}/start-rights/{x['id']}/fill", json={"candidate_id": n["id"], "reason": "Platz 2 rückt nach"}))
    ok(await flow.post(f"{ADMIN}/seasons/{season['id']}/applications/{n['id']}/reject", json={"reason": "Kader nicht spielberechtigt"}))
    places = (await overview(flow, world, season["id"]))["open_places"]
    assert [place["application_id"] for place in places] == [x["id"]] and places[0]["pick"] == third["id"]
    ok(await flow.post(f"{ADMIN}/seasons/{season['id']}/start-rights/{x['id']}/fill", json={"candidate_id": third["id"], "reason": "Platz 3 rückt nach"}))
    assert (await carried(flow, season["id"]))[x["squad_id"]]["carry_over"]["filled_by"]["application_id"] == third["id"]


@pytest.mark.asyncio
async def test_a_successor_moved_elsewhere_by_recompute_frees_the_place_for_the_rule(flow):
    """Ein Nachrücker, den der korrigierte Endstand in eine dritte Liga schickt (``moved``), gibt den Platz frei - wie ein
    zurückgenommener: Mit ``next`` rückt sofort der Nächste nach."""
    world = await build(flow, levels=3)
    season, rows = await ready(flow, world)
    x, n, third = (rows[squad_id(world, 2, index)] for index in range(3))
    flow.act_as(await person(flow, x["squad_id"]))
    ok(await flow.post(f"/api/me/league-applications/{x['id']}/withdraw"))
    assert (await carried(flow, season["id"]))[n["squad_id"]]["carry_over"]["division_level"] == 1
    # Korrektur: N verliert auch gegen den Dritten und den Vierten - er ist Letzter der Liga 2 und steigt ab.
    tid = world["tids"][2][0]
    regs = world["regs"][tid]
    flow.act_as(await second_lead(flow, world))
    ok(await flow.post(f"{STAFFELN}/{tid}/reopen", json={"reason": "Ergebnisse vertauscht eingetragen"}))
    await flip(flow, tid, regs[2], regs[1])
    await flip(flow, tid, regs[3], regs[1])
    flow.act_as(world["lead"])
    ok(await flow.post(f"{STAFFELN}/{tid}/close", json={"confirm": True}))
    done = await recompute(flow, world, season)
    assert done["released_places"] == [x["id"]]
    after = await carried(flow, season["id"])
    assert after[n["squad_id"]]["carry_over"]["division_level"] == 3 and "fills" not in after[n["squad_id"]]["carry_over"]
    assert after[x["squad_id"]]["carry_over"]["filled_by"]["application_id"] == third["id"]
    assert after[third["squad_id"]]["carry_over"]["division_level"] == 1


@pytest.mark.asyncio
async def test_a_pause_also_rests_the_minimum_rest(flow):
    """P2: Der Nachrücker ist zurückgefallen, seine Frist endet am Boden (mindestens drei Tage). Wird der Vorgänger in dieser Zeit
    wieder geöffnet, ruht auch sie - vorher galt das Startrecht in der Pause als verfallen, und die Zusage bekam 409."""
    world = await build(flow, levels=2)
    season, _x, second = await moved_up_late(flow, world, offer_days_ago=11)
    assert (await league_start_rights.sweep(flow.db))["restored"] == 1
    # Rückdatiert: Der Rückfall war vor vier Tagen, der Boden (drei Tage) wäre seit gestern vorbei.
    await flow.db.league_applications.update_one({"id": second["id"]}, {"$set": {
        "carry_over.start_right.rests.0.to": (now_utc() - timedelta(days=4)).isoformat(),
        "carry_over.start_right.min_until": (now_utc() - timedelta(days=1)).isoformat()}})
    tid = world["tids"][2][0]
    flow.act_as(await second_lead(flow, world))
    ok(await flow.post(f"{STAFFELN}/{tid}/reopen", json={"reason": "Ergebnis vertauscht eingetragen"}))
    # ... aber der Vorgänger ist seit zwei Tagen wieder geöffnet: Die Pause begann, als die Frist noch lief.
    await flow.db.league_seasons.update_one({"id": season["id"]}, {"$set": {"start_right_pauses.0.from": (now_utc() - timedelta(days=2)).isoformat()}})
    item = await own_item(flow, second["squad_id"], second["id"])
    right = item["carry_over"]["start_right"]
    assert right["state"] == "offered" and right["paused"] is True and right["can_accept"] is True
    done = await league_start_rights.sweep(flow.db)
    assert done["paused"] == 1 and done["expired"] == 0
    ok(await answer(flow, second["squad_id"], second["id"]))
    assert (await carried(flow, season["id"]))[second["squad_id"]]["carry_over"]["start_right"]["status"] == "accepted"


@pytest.mark.asyncio
async def test_the_reminder_does_not_come_in_the_same_run_as_the_fall_back(flow):
    world = await build(flow, levels=2)
    season, _x, second = await moved_up_late(flow, world, offer_days_ago=11, rest_days=1, remind_hours=48)
    done = await league_start_rights.sweep(flow.db)
    assert done["restored"] == 1 and done["reminded"] == 0
    captain = await person(flow, second["squad_id"])
    assert len(await notes(flow, "league_start_right_back", captain["id"])) == 1
    assert await notes(flow, "league_start_right_reminder", captain["id"]) == []
    # Auch der nächste Lauf erinnert nicht sofort: erst zur Hälfte der Restfrist.
    assert (await league_start_rights.sweep(flow.db))["reminded"] == 0


@pytest.mark.asyncio
async def test_the_job_closes_an_open_pause_even_after_the_start_date(flow):
    """Fehlte der Schritt in der Route beim neuen Abschluss, schließt der Job die Pause - auch wenn das Startdatum schon erreicht ist.
    Sonst stünde dort für immer „Frist ruht“ statt „die Leitung entscheidet“."""
    world = await build(flow, levels=2)
    season, rows = await ready(flow, world)
    await flow.db.league_seasons.update_one({"id": season["id"]}, {"$set": {
        "start_right_pauses": [{"from": (now_utc() - timedelta(days=3)).isoformat(), "to": None}],
        "start_date": (now_utc() - timedelta(minutes=5)).isoformat()}})
    assert await league_start_rights.sweep(flow.db) == {"expired": 0, "restored": 0, "filled": 0, "reminded": 0, "announced": 0, "paused": 0}
    pauses = (await flow.db.league_seasons.find_one({"id": season["id"]}, {"_id": 0}))["start_right_pauses"]
    assert len(pauses) == 1 and pauses[0]["to"] is not None
    row = rows[squad_id(world, 1, 0)]
    item = await own_item(flow, row["squad_id"], row["id"])
    assert item["carry_over"]["start_right"]["paused"] is False and item["carry_over"]["start_right"]["waits_for_lead"] is True


@pytest.mark.asyncio
@pytest.mark.parametrize("had_accepted", [True, False])
async def test_a_successor_goes_back_when_the_corrected_final_no_longer_knows_the_place(flow, had_accepted):
    """P1, dieselbe Ursache auf dem anderen Weg: Der Nachrücker bleibt nach der Korrektur, wo der Endstand ihn vorher sah (Liga 2) -
    aber der Platz, auf den er nachgerückt war, besteht nicht mehr, weil jetzt ein anderer aus eigenem Recht aufsteigt. Dann geht
    er zurück in seine Liga; sonst stiegen wieder zwei auf. Wie bei jedem Rückfall (Nr. 260, Nr. 265): Seine frühere Zusage gilt
    wieder - war sie noch offen, hat er die Restfrist, mindestens ``rest_days``, nie eine neue volle Frist."""
    world = await build(flow, levels=2)
    season, rows = await ready(flow, world)
    x, n, third = (rows[squad_id(world, 2, index)] for index in range(3))
    if had_accepted:
        ok(await answer(flow, n["squad_id"], n["id"]))
    flow.act_as(await person(flow, x["squad_id"]))
    ok(await flow.post(f"/api/me/league-applications/{x['id']}/withdraw"))
    assert (await carried(flow, season["id"]))[n["squad_id"]]["carry_over"]["division_level"] == 1
    # Rückdatiert: Das eigene Startrecht kam vor neun Tagen (Frist zehn Tage) - beim Nachrücken blieb davon ein Tag.
    first_offer = (now_utc() - timedelta(days=9)).isoformat()
    await flow.db.league_applications.update_one({"id": n["id"]}, {"$set": {"carry_over.fills.back.start_right.offered_at": first_offer}})
    tid = world["tids"][2][0]
    regs = world["regs"][tid]
    flow.act_as(await second_lead(flow, world))
    ok(await flow.post(f"{STAFFELN}/{tid}/reopen", json={"reason": "Ergebnisse vertauscht eingetragen"}))
    # Der Dritte hat gegen X und gegen N gewonnen: Er ist Erster, X Zweiter, N Dritter.
    await flip(flow, tid, regs[2], regs[0])
    await flip(flow, tid, regs[2], regs[1])
    flow.act_as(world["lead"])
    ok(await flow.post(f"{STAFFELN}/{tid}/close", json={"confirm": True}))
    done = await recompute(flow, world, season)
    assert done["released_places"] == [x["id"]]
    after = await carried(flow, season["id"])
    up = [row["display_name"] for row in after.values() if row["status"] == "accepted" and row["carry_over"]["from_level"] == 2
          and row["carry_over"]["division_level"] == 1]
    assert up == [third["display_name"]]
    back = after[n["squad_id"]]
    assert back["status"] == "accepted" and back["carry_over"]["division_level"] == 2 and "fills" not in back["carry_over"]
    assert "filled_by" not in after[x["squad_id"]]["carry_over"]
    assert (await overview(flow, world, season["id"]))["open_places"] == []
    # Das frühere Startrecht gilt wieder - keine neue volle Frist.
    right = back["carry_over"]["start_right"]
    assert right["offered_at"] == first_offer
    told = [row for row in await notes(flow, "league_successor", (await person(flow, n["squad_id"]))["id"])
            if "entfällt nach dem korrigierten Endstand" in row["body"]]
    assert len(told) == 1 and "Der Platz in Liga 1 entfällt" in told[0]["body"] and "bleibt in Liga 2" in told[0]["body"]
    if had_accepted:
        assert right["status"] == "accepted" and right["accepted_via"] == "team"
        assert "Eure Zusage dort gilt weiter" in told[0]["body"]
    else:
        # Restfrist: ein Tag wäre übrig, mindestens aber drei Tage (``rest_days``) - nicht zehn.
        fresh = await flow.db.league_seasons.find_one({"id": season["id"]}, {"_id": 0})
        until = league_start_rights.accept_until(back, fresh)
        assert right["status"] == "offered" and right["min_until"]
        assert timedelta(days=2, hours=23) < until - now_utc() < timedelta(days=3, hours=1)
        assert "bitte bis " in told[0]["body"] and "zusagen" in told[0]["body"]
        item = await own_item(flow, n["squad_id"], n["id"])
        assert item["carry_over"]["start_right"]["state"] == "offered" and item["carry_over"]["start_right"]["fills"] is None
    # Ein zweites Neuberechnen ändert nichts mehr.
    flow.act_as(world["lead"])
    again = ok(await flow.get(f"{ADMIN}/seasons/{season['id']}/successor/recompute"))
    assert again["changes"] == []
