"""Co-Team-Formular (#2128, TM3): das Spiel ist eine Auswahl mit Server-Prüfung, „Turnier“ und „Jahreswertung“ sind weg.

Alte Co-Teams behalten ihre Altfelder und bleiben änderbar, auch mit einem Freitext als Spiel; die Liga-Prüfung liest
weiter ``game_id``. Die App schickt noch Freitext - ein genau passender Spielname wird zur Kennung. Erfundene Daten."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def world(flow):
    leader = await flow.add_user(role="player", name=f"leitung-{new_id()[:6]}")
    game = {"id": new_id(), "name": "Probe Rush", "slug": "probe-rush", "short_name": "PR"}
    await flow.db.games.insert_one(dict(game))
    team = {"id": new_id(), "name": "Rudel", "tag": "RDL", "leader_id": leader["id"], "co_leader_ids": [],
            "member_ids": [leader["id"]], "is_public": True}
    await flow.db.teams.insert_one(dict(team))
    flow.act_as(leader)
    return leader, team, game


@pytest.mark.asyncio
async def test_game_is_checked_and_a_known_name_becomes_the_id(flow):
    _leader, team, game = await world(flow)
    url = f"/api/teams/{team['id']}/squads"

    by_id = await flow.post(url, json={"name": "Erste", "game_id": game["id"]})
    assert by_id.status_code == 200 and by_id.json()["game_id"] == game["id"]

    by_name = await flow.post(url, json={"name": "Zweite", "game_id": "  probe rush "})
    assert by_name.status_code == 200 and by_name.json()["game_id"] == game["id"], "Freitext der App: genau passender Name"

    unknown = await flow.post(url, json={"name": "Dritte", "game_id": "Irgendwas"})
    assert unknown.status_code == 400 and "Liste" in unknown.json()["detail"]

    empty = await flow.post(url, json={"name": "Vierte", "game_id": "  "})
    assert empty.status_code == 200 and empty.json()["game_id"] is None

    listed = {row["name"]: row for row in (await flow.get(url)).json()}
    assert listed["Erste"]["game"] == "Probe Rush", "Name zum Spiel für Web und App"
    assert "game" not in listed["Vierte"]


@pytest.mark.asyncio
async def test_old_fields_stay_stored_and_are_no_longer_written(flow):
    _leader, team, game = await world(flow)
    squad = {"id": new_id(), "team_id": team["id"], "name": "Alt", "status": "active", "member_ids": [], "game_id": "CoD MW",
             "tournament_id": "turnier-alt", "season_id": "saison-alt"}
    await flow.db.team_squads.insert_one(dict(squad))
    url = f"/api/teams/{team['id']}/squads/{squad['id']}"

    # Ein alter Freitext hält andere Änderungen nicht auf, auch wenn er mitgeschickt wird (App).
    renamed = await flow.patch(url, json={"name": "Alt neu", "game_id": "CoD MW", "tournament_id": "x", "season_id": None})
    assert renamed.status_code == 200, renamed.text
    stored = await flow.db.team_squads.find_one({"id": squad["id"]}, {"_id": 0})
    assert stored["name"] == "Alt neu" and stored["game_id"] == "CoD MW"
    assert stored["tournament_id"] == "turnier-alt" and stored["season_id"] == "saison-alt", "bleiben gespeichert"

    assert (await flow.patch(url, json={"game_id": "CoD MW2"})).status_code == 400, "neuer Freitext nicht"
    assert (await flow.patch(url, json={"game_id": game["id"]})).json()["game_id"] == game["id"]
    assert (await flow.patch(url, json={"game_id": None})).json()["game_id"] is None

    new = await flow.post(f"/api/teams/{team['id']}/squads", json={"name": "Neu", "tournament_id": "x", "season_id": "y"})
    assert new.status_code == 200
    fresh = await flow.db.team_squads.find_one({"id": new.json()["id"]}, {"_id": 0})
    assert "tournament_id" not in fresh and "season_id" not in fresh


@pytest.mark.asyncio
async def test_game_stays_while_the_squad_plays_in_a_league(flow):
    _leader, team, game = await world(flow)
    squad = (await flow.post(f"/api/teams/{team['id']}/squads", json={"name": "Liga", "game_id": game["id"]})).json()
    other = {"id": new_id(), "name": "Anderes"}
    await flow.db.games.insert_one(dict(other))
    running = await flow.create_tournament(title="Staffel", status="live", team_mode="team")
    await flow.db.tournament_registrations.insert_one({"id": new_id(), "tournament_id": running["id"], "team_id": team["id"],
                                                       "squad_id": squad["id"], "status": "approved"})
    url = f"/api/teams/{team['id']}/squads/{squad['id']}"

    refused = await flow.patch(url, json={"game_id": other["id"]})
    assert refused.status_code == 409 and "Staffel" in refused.json()["detail"]
    same = await flow.patch(url, json={"game_id": game["id"], "description": "Kader Herbst"})
    assert same.status_code == 200, "unverändert geht - das Formular schickt das Spiel immer mit"

    await flow.db.tournaments.update_one({"id": running["id"]}, {"$set": {"status": "completed"}})
    assert (await flow.patch(url, json={"game_id": other["id"]})).status_code == 200


BASE_PROBLEMS = dict(min_size=1, taken_teams={}, seats_taken=0, other_staffel_squad_ids=set())


def game_texts(squad_game, staffel_game, games, parents=None):
    from services import squad_registration

    team = {"id": "t1", "member_ids": ["u1"]}
    squad = {"id": "s1", "team_id": "t1", "name": "Erste", "status": "active", "member_ids": ["u1"], "game_id": squad_game}
    found = squad_registration.squad_problems(team, squad, {"id": "x", "game_id": staffel_game}, team_member_ids={"u1"}, games=games, **BASE_PROBLEMS)
    return [text for _code, text in found]


def test_old_free_text_says_what_to_do():
    games = {"bo7": {"id": "bo7", "name": "Black Ops 7"}}
    texts = game_texts("Black Ops 7", "bo7", games)
    assert texts == ["Erste hat noch einen alten Spielnamen („Black Ops 7“) – unter Teams → Deine Teams aus der Liste wählen."]
    assert game_texts(None, "bo7", games) == [], "ohne Spiel passt es"
    assert game_texts("bo7", "bo7", games) == []


@pytest.mark.asyncio
async def test_migration_turns_exact_names_into_ids_and_counts_the_rest(flow):
    from services import migrations

    await flow.db.games.insert_many([{"id": "bo7", "name": "Black Ops 7"}, {"id": "a1", "name": "Doppelt"}, {"id": "a2", "name": "doppelt"}])
    rows = [("exakt", "Black Ops 7"), ("klein", "  black ops  7 "), ("kennung", "bo7"), ("fremd", "Irgendwas"), ("zweideutig", "Doppelt"), ("leer", None)]
    for name, value in rows:
        await flow.db.team_squads.insert_one({"id": name, "team_id": "t1", "name": name, "game_id": value})

    result = await migrations.migrate_squad_game_names(flow.db)
    assert result == "2 squads moved to a game id, 2 left"
    stored = {row["id"]: row["game_id"] async for row in flow.db.team_squads.find({}, {"_id": 0, "id": 1, "game_id": 1})}
    assert stored == {"exakt": "bo7", "klein": "bo7", "kennung": "bo7", "fremd": "Irgendwas", "zweideutig": "Doppelt", "leer": None}
    row = await flow.db.audit_logs.find_one({"action": "team.squad.game_names"}, {"_id": 0})
    assert row["data"] == {"moved": 2, "left": 2}

    assert await migrations.migrate_squad_game_names(flow.db) == "0 squads moved to a game id, 2 left", "ein zweiter Lauf ändert nichts"
    assert (20, "squad_game_names", migrations.migrate_squad_game_names) in migrations.MIGRATIONS
