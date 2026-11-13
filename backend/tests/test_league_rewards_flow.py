"""F.4 Belohnungen (#2214, docs/LIGA.md „F.4 Belohnungen“, Nr. 163 bis 166) über die echten Routen: Vergabe aus dem Endstand für
Platz 1 bis 3, Platzbereich und alle, Spieler mit Einsatz gegenüber Kader, Liga-N-Abweichung, Ruhen beim Wiederöffnen und neu Zuteilen
ohne Doppel, Nachricht je Fassung, Sichtbarkeit für Gäste, Rechte und gleichzeitiger Abschluss - jede Regel mit Gegenprobe.
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

from flow_harness import make_flow, new_id  # noqa: E402
from models import now_utc  # noqa: E402

ADMIN = "/api/admin/leagues"
STAFFELN = "/api/admin/leagues/staffeln"
PAGE = "/api/leagues/probe-shooter/season-1"
SEASON = {"start_date": "2026-01-05T00:00:00", "visibility": "public", "readiness_override_reason": "Testaufbau ohne Prüfung"}
LONG_AGO = (now_utc() - timedelta(days=90)).isoformat()

GOLD = {"kind": "medal", "name": "Goldmedaille", "places": {"mode": "rank", "rank": 1}, "recipients": ["team", "players"]}
PODIUM = {"kind": "emblem", "name": "Podest-Emblem", "places": {"mode": "range", "from": 2, "to": 3}, "recipients": ["team"]}
EVERYONE = {"kind": "banner", "name": "Season-Banner", "places": {"mode": "all"}, "recipients": ["players"]}
LAST = {"kind": "title", "name": "Kämpferherz", "places": {"mode": "rank", "rank": 4}, "recipients": ["team"]}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


# ---------------------------------------------------------------- Aufbau

async def add_staffel(flow, division: dict, prefix: str = "", teams: int = 4) -> dict:
    """Vier Teams mit je einem Co-Team (Kader: zwei Spieler und ein Ersatz) - ``{prefix}p-<team>-<n>``."""
    created = (await flow.post(f"{ADMIN}/divisions/{division['id']}/staffeln", json={})).json()
    staffel = await flow.db.tournaments.find_one({"id": created["tournament_id"]}, {"_id": 0})
    for index in range(1, teams + 1):
        people = [f"{prefix}p-{index}-{number}" for number in (1, 2, 3)]
        for person in [f"{prefix}captain-{index}", *people]:
            await flow.db.users.insert_one({"id": person, "username": person, "display_name": person.title(), "role": "user",
                                            "is_active": True, "email": f"{person}@example.test", "privacy_public_profile": True})
        await flow.db.teams.insert_one({"id": f"{prefix}team-{index}", "name": f"Probe {prefix}{index}", "leader_id": f"{prefix}captain-{index}",
                                        "member_ids": [f"{prefix}captain-{index}", *people]})
        await flow.db.team_squads.insert_one({"id": f"{prefix}squad-{index}", "team_id": f"{prefix}team-{index}", "name": f"Kader {index}",
                                              "status": "active", "member_ids": people})
        await flow.db.tournament_registrations.insert_one({
            "id": f"{prefix}reg-{index}", "tournament_id": staffel["id"], "team_id": f"{prefix}team-{index}", "squad_id": f"{prefix}squad-{index}",
            "status": "approved", "registration_type": "team", "display_name": f"Probe {prefix}{index}",
            "identity_key": f"{staffel['id']}:team:{prefix}team-{index}"})
    started = await flow.post(f"/api/tournaments/{staffel['id']}/status", json={"status": "live"})
    assert started.status_code == 200, started.text
    return staffel


async def setup(flow, *, rewards: list | None = None, season: dict | None = None):
    admin = await flow.add_staff()
    flow.act_as(admin)
    game = (await flow.post("/api/games", json={"name": "Probe Shooter", "slug": "probe-shooter"})).json()
    league = (await flow.post(ADMIN, json={"name": "Probe-Liga", "game_id": game["id"]})).json()
    season_doc = (await flow.post(f"{ADMIN}/{league['id']}/seasons", json={**SEASON, **(season or {})})).json()
    division = (await flow.post(f"{ADMIN}/seasons/{season_doc['id']}/divisions", json={})).json()
    staffel = await add_staffel(flow, division)
    if rewards is not None:
        saved = await flow.put(f"{ADMIN}/seasons/{season_doc['id']}/rewards", json={"items": rewards})
        assert saved.status_code == 200, saved.text
    return admin, league, season_doc, division, staffel


async def matches_of(flow, staffel) -> list[dict]:
    return await flow.db.matches_v2.find({"tournament_id": staffel["id"], "is_preview": {"$ne": True}}, {"_id": 0}).sort("order", 1).to_list(100)


def number(registration_id: str) -> int:
    return int(registration_id.rsplit("-", 1)[1])


async def play_all(flow, staffel, *, prefix: str = "", winner_of=None):
    """Jedes Spiel gewertet - das Team mit der kleineren Nummer gewinnt (Tabelle 1, 2, 3, 4). In der Aufstellung stehen je Team die
    Spieler 1 und 2 - Spieler 3 ist Ersatz ohne Einsatz."""
    for match in await matches_of(flow, staffel):
        sides = [slot["registration_id"] for slot in match["slots"]]
        winner = (winner_of or (lambda pair: min(pair, key=number)))(sides)
        loser = next(side for side in sides if side != winner)
        lineups = {side: [f"{prefix}p-{number(side)}-1", f"{prefix}p-{number(side)}-2"] for side in sides}
        await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {
            "status": "completed", "completed_at": LONG_AGO, "lineups": lineups,
            "results": [{"registration_id": winner, "rank": 1, "score": 2}, {"registration_id": loser, "rank": 2, "score": 0}]}})


async def close(flow, staffel):
    return await flow.post(f"{STAFFELN}/{staffel['id']}/close", json={"confirm": True})


async def must_close(flow, staffel):
    response = await close(flow, staffel)
    assert response.status_code == 200, response.text
    return response


async def must_reopen(flow, staffel):
    response = await flow.post(f"{STAFFELN}/{staffel['id']}/reopen", json={"reason": "Ergebnis war falsch eingetragen"})
    assert response.status_code == 200, response.text


async def lead(flow, league, name: str, *capabilities: str) -> dict:
    user = await flow.add_user(name=name)
    await flow.db.league_staff.insert_one({"id": new_id(), "league_id": league["id"], "user_id": user["id"],
                                           "capabilities": list(capabilities), "created_at": now_utc().isoformat()})
    return user


async def rewards_of(flow, staffel) -> list[dict]:
    return await flow.db.tournament_awards.find({"tournament_id": staffel["id"], "reward_key": {"$type": "string"}}, {"_id": 0}).to_list(200)


def held(docs: list[dict]) -> set[tuple[str, str]]:
    return {(doc["registration_id"], doc["reward"]["name"]) for doc in docs}


# ---------------------------------------------------------------- Vergabe aus dem Endstand

@pytest.mark.asyncio
async def test_rewards_follow_the_final_table_for_place_one_range_all_and_a_single_place(flow):
    _admin, _league, _season, _division, staffel = await setup(flow, rewards=[GOLD, PODIUM, EVERYONE, LAST])
    await play_all(flow, staffel)
    await must_close(flow, staffel)

    docs = await rewards_of(flow, staffel)
    assert held(docs) == {
        ("reg-1", "Goldmedaille"), ("reg-1", "Season-Banner"),
        ("reg-2", "Podest-Emblem"), ("reg-2", "Season-Banner"),
        ("reg-3", "Podest-Emblem"), ("reg-3", "Season-Banner"),
        ("reg-4", "Kämpferherz"), ("reg-4", "Season-Banner"),
    }
    # Gegenprobe: niemand bekommt, was nicht zu seinem Platz passt.
    assert ("reg-4", "Goldmedaille") not in held(docs) and ("reg-1", "Podest-Emblem") not in held(docs)
    gold = next(doc for doc in docs if doc["reward"]["name"] == "Goldmedaille")
    assert gold["rank"] == 1 and gold["kind"] == "reward" and gold["team_id"] == "team-1" and gold["player_ids"] == ["p-1-1", "p-1-2"]
    assert gold["reward"]["art"] == {"league": "Probe-Liga", "season": gold["season"]["name"], "division": "Liga 1", "place": "1. Platz",
                                     "metal": "gold"}
    emblem = next(doc for doc in docs if doc["registration_id"] == "reg-3" and doc["reward"]["name"] == "Podest-Emblem")
    # Nur an das Team: keine Spieler, Bronze aus dem Platz im Bereich.
    assert emblem["player_ids"] == [] and emblem["team_id"] == "team-3" and emblem["reward"]["art"]["metal"] == "bronze"
    banner = next(doc for doc in docs if doc["registration_id"] == "reg-4" and doc["reward"]["name"] == "Season-Banner")
    # Nur an die Spieler: kein Team-Eintrag, damit die Teamseite ihn nicht als Team-Belohnung zeigt.
    assert banner["team_id"] is None and banner["player_ids"] == ["p-4-1", "p-4-2"]
    # Der Meister-Eintrag aus F.1 bleibt daneben genau einer.
    champions = await flow.db.tournament_awards.find({"tournament_id": staffel["id"], "reward_key": None}, {"_id": 0}).to_list(10)
    assert [(row["registration_id"], row["league"]["title"]) for row in champions] == [("reg-1", "Meister")]

    flow.act_as({"id": "p-1-1", "role": "user"})
    mine = (await flow.get("/api/me/awards")).json()["awards"]
    assert sorted(row["reward"]["name"] for row in mine if row["reward"]) == ["Goldmedaille", "Season-Banner"]
    assert {row["kind"] for row in mine if row["reward"]} == {"medal", "banner"}
    team = (await flow.get("/api/teams/team-3")).json()
    assert [row["reward"]["name"] for row in team["awards"] if row["reward"]] == ["Podest-Emblem"]


@pytest.mark.asyncio
async def test_an_exited_team_gets_nothing_not_even_the_reward_for_everyone(flow):
    _admin, _league, _season, _division, staffel = await setup(flow, rewards=[EVERYONE, {**GOLD, "places": {"mode": "rank", "rank": 1}}])
    await play_all(flow, staffel)
    # Team 1 tritt aus (Regel ``half``: rechnerisch bleibt es vorn) - weder Platz 1 noch „alle Teilnehmer“.
    await flow.db.tournaments.update_one({"id": staffel["id"]}, {"$set": {"scoring_rules.exit_rule": "half"}})
    await flow.db.tournament_registrations.update_one({"id": "reg-1"}, {"$set": {"status": "withdrawn", "withdrawn_at": LONG_AGO}})
    await must_close(flow, staffel)
    final = await flow.db.league_final_tables.find_one({"tournament_id": staffel["id"], "active": True}, {"_id": 0})
    assert any(row["registration_id"] == "reg-1" and row.get("exit") for row in final["rows"])
    docs = await rewards_of(flow, staffel)
    assert "reg-1" not in {doc["registration_id"] for doc in docs}
    # Gegenprobe: die übrigen bekommen „alle“, Gold geht an niemanden, solange Team 1 rechnerisch auf Platz 1 steht.
    assert {doc["registration_id"] for doc in docs if doc["reward"]["name"] == "Season-Banner"} == {"reg-2", "reg-3", "reg-4"}


@pytest.mark.asyncio
async def test_a_season_without_rewards_behaves_as_before(flow):
    _admin, _league, season, _division, staffel = await setup(flow)
    await play_all(flow, staffel)
    await must_close(flow, staffel)
    assert await rewards_of(flow, staffel) == []
    assert await flow.db.notifications.count_documents({"kind": "league_reward"}) == 0
    assert await flow.db.prize_pickups.count_documents({}) == 0
    view = (await flow.get(f"{PAGE}/staffeln/{staffel['slug']}")).json()
    assert view["staffel"]["rewards"] is None
    # Gegenprobe: mit Belohnungen gibt es Einträge und Nachrichten.
    flow.act_as(await flow.add_staff())
    second = await flow.post(f"{STAFFELN}/{staffel['id']}/reopen", json={"reason": "Belohnungen nachtragen"})
    assert second.status_code == 200, second.text
    saved = await flow.put(f"{ADMIN}/seasons/{season['id']}/rewards", json={"items": [GOLD]})
    assert saved.status_code == 200, saved.text
    await must_close(flow, staffel)
    assert held(await rewards_of(flow, staffel)) == {("reg-1", "Goldmedaille")}
    assert await flow.db.notifications.count_documents({"kind": "league_reward"}) > 0


# ---------------------------------------------------------------- Spieler mit Einsatz gegenüber Kader (Nr. 163)

@pytest.mark.asyncio
async def test_player_rewards_go_to_fielded_players_by_default_and_to_the_whole_roster_when_switched(flow):
    admin, league, season, _division, staffel = await setup(flow, rewards=[{**GOLD, "recipients": ["players"]}])
    await play_all(flow, staffel)
    await must_close(flow, staffel)
    gold = (await rewards_of(flow, staffel))[0]
    assert gold["player_ids"] == ["p-1-1", "p-1-2"] and "p-1-3" not in gold["player_ids"]
    flow.act_as({"id": "p-1-3", "role": "user"})
    assert [row for row in (await flow.get("/api/me/awards")).json()["awards"] if row["reward"]] == []

    flow.act_as(admin)
    saved = await flow.put(f"{ADMIN}/seasons/{season['id']}/rewards", json={"reward_players": "roster"})
    assert saved.status_code == 200 and saved.json()["reward_players"] == "roster"
    flow.act_as(await lead(flow, league, "Zweite Leitung", "season"))
    await must_reopen(flow, staffel)
    await must_close(flow, staffel)
    roster = (await rewards_of(flow, staffel))[0]
    assert roster["id"] == gold["id"] and roster["player_ids"] == ["p-1-1", "p-1-2", "p-1-3"]
    assert roster["reward"]["recipients_label"] == "Ganzer Kader zum Abschluss"
    flow.act_as({"id": "p-1-3", "role": "user"})
    assert [row["reward"]["name"] for row in (await flow.get("/api/me/awards")).json()["awards"] if row["reward"]] == ["Goldmedaille"]


@pytest.mark.asyncio
async def test_a_lineup_in_a_cancelled_match_is_no_appearance(flow):
    from services import league_rewards

    matches = [{"status": "cancelled", "lineups": {"reg-1": ["bank"]}}, {"status": "completed", "lineups": {"reg-1": ["star"]}},
               {"status": "forfeit", "games": [{"lineups": {"reg-1": ["kampflos"]}}]}]
    assert league_rewards._fielded(matches, "reg-1") == {"star", "kampflos"}
    assert league_rewards._fielded(matches, "reg-2") == set()


# ---------------------------------------------------------------- Liga N weicht ab

@pytest.mark.asyncio
async def test_a_division_can_have_its_own_rewards_or_none_and_otherwise_inherits_the_season(flow):
    admin, _league, season, division, staffel = await setup(flow, rewards=[GOLD])
    lower = (await flow.post(f"{ADMIN}/seasons/{season['id']}/divisions", json={})).json()
    third = (await flow.post(f"{ADMIN}/seasons/{season['id']}/divisions", json={})).json()
    lower_staffel = await add_staffel(flow, lower, "b")
    third_staffel = await add_staffel(flow, third, "c")
    silver = {"kind": "medal", "name": "Aufsteiger-Medaille", "places": {"mode": "rank", "rank": 1}, "recipients": ["team"]}
    saved = await flow.put(f"{ADMIN}/seasons/{season['id']}/rewards", json={"divisions": {lower["id"]: [silver], third["id"]: []}})
    assert saved.status_code == 200, saved.text
    rows = {row["id"]: row for row in saved.json()["divisions"]}
    assert rows[division["id"]]["own"] is False and [item["name"] for item in rows[division["id"]]["items"]] == ["Goldmedaille"]
    assert rows[lower["id"]]["own"] is True and [item["name"] for item in rows[lower["id"]]["items"]] == ["Aufsteiger-Medaille"]
    assert rows[third["id"]]["own"] is True and rows[third["id"]]["items"] == []

    for item, prefix in ((staffel, ""), (lower_staffel, "b"), (third_staffel, "c")):
        await play_all(flow, item, prefix=prefix)
        flow.act_as(admin)
        await must_close(flow, item)
    assert held(await rewards_of(flow, staffel)) == {("reg-1", "Goldmedaille")}
    assert held(await rewards_of(flow, lower_staffel)) == {("breg-1", "Aufsteiger-Medaille")}
    assert await rewards_of(flow, third_staffel) == []

    page = (await flow.get(PAGE)).json()
    assert [item["name"] for item in page["rewards"]] == ["Goldmedaille"]
    by_id = {row["id"]: row for row in page["divisions"]}
    assert by_id[division["id"]]["rewards"] is None and [item["name"] for item in by_id[lower["id"]]["rewards"]] == ["Aufsteiger-Medaille"]
    assert by_id[third["id"]]["rewards"] == []

    # Zurück auf die Season: ``null``.
    back = await flow.put(f"{ADMIN}/seasons/{season['id']}/rewards", json={"divisions": {lower["id"]: None}})
    assert next(row for row in back.json()["divisions"] if row["id"] == lower["id"])["own"] is False


# ---------------------------------------------------------------- Wieder öffnen und neu abschließen (Nr. 166)

@pytest.mark.asyncio
async def test_reopen_lets_rewards_rest_and_a_new_close_reassigns_them_without_a_double_and_tells_who_changed(flow):
    admin, league, season, _division, staffel = await setup(flow, rewards=[GOLD, EVERYONE])
    await play_all(flow, staffel)
    await must_close(flow, staffel)
    first = {doc["reward_key"]: doc["id"] for doc in await rewards_of(flow, staffel)}
    gains = await flow.db.notifications.find({"kind": "league_reward"}, {"_id": 0}).to_list(100)
    assert {note["user_id"] for note in gains} >= {"p-1-1", "p-2-1", "captain-1"} and all(note["title"] == "Neue Belohnung" for note in gains)
    assert "captain-2" not in {note["user_id"] for note in gains}  # Team 2 hat nur Spieler-Belohnungen

    second = await lead(flow, league, "Zweite Leitung", "season")
    flow.act_as(second)
    await must_reopen(flow, staffel)
    resting = await rewards_of(flow, staffel)
    assert len(resting) == len(first) and all(doc["suspended"] for doc in resting)
    flow.act_as({"id": "p-1-1", "role": "user"})
    assert [row for row in (await flow.get("/api/me/awards")).json()["awards"] if row["reward"]] == []
    assert (await flow.get("/api/me/rewards/unseen")).json()["rewards"] == []
    assert (await flow.get(f"/api/users/public/p-1-1")).json()["awards"] == []
    view = (await flow.get(f"{PAGE}/staffeln/{staffel['slug']}")).json()["staffel"]["rewards"]
    assert view["granted"] is False and all(item["holders"] == [] for item in view["items"])

    # Korrigiert: Team 2 gewinnt alles - Gold wechselt, „alle“ bleibt bei allen.
    flow.act_as(admin)
    await play_all(flow, staffel, winner_of=lambda pair: "reg-2" if "reg-2" in pair else min(pair, key=number))
    await must_close(flow, staffel)
    after = await rewards_of(flow, staffel)
    keys = [doc["reward_key"] for doc in after]
    assert len(keys) == len(set(keys)) == 5 and not any(doc["suspended"] for doc in after)
    assert held(after) == {("reg-2", "Goldmedaille"), *{(f"reg-{index}", "Season-Banner") for index in (1, 2, 3, 4)}}
    # Was blieb, ist derselbe Eintrag.
    for doc in after:
        if doc["reward_key"] in first:
            assert doc["id"] == first[doc["reward_key"]]
    final = await flow.db.league_final_tables.find_one({"tournament_id": staffel["id"], "active": True}, {"_id": 0})
    changed = await flow.db.notifications.find({"kind": "league_reward", "meta.dedupe_key": {"$regex": f"^league-reward:{final['id']}:"}},
                                               {"_id": 0}).to_list(100)
    by_person = {(note["user_id"], note["title"]) for note in changed}
    assert ("p-1-1", "Belohnung entfällt") in by_person and ("captain-1", "Belohnung entfällt") in by_person
    assert ("p-2-1", "Neue Belohnung") in by_person and ("captain-2", "Neue Belohnung") in by_person
    # Gegenprobe: wer nur „alle“ hat und behält, bekommt keine Nachricht.
    assert not any(person == "p-3-1" for person, _title in by_person)


@pytest.mark.asyncio
async def test_the_message_is_sent_once_per_version_direction_and_person(flow):
    from services import league_final, league_rewards

    _admin, _league, _season, _division, staffel = await setup(flow, rewards=[GOLD])
    await play_all(flow, staffel)
    await must_close(flow, staffel)
    count = await flow.db.notifications.count_documents({"kind": "league_reward"})
    assert count == 3  # zwei Spieler und der Captain von Team 1
    final = await flow.db.league_final_tables.find_one({"tournament_id": staffel["id"], "active": True}, {"_id": 0})
    tournament = await flow.db.tournaments.find_one({"id": staffel["id"]}, {"_id": 0})
    frame = await league_final._frame(flow.db, tournament)
    again = {"gains": {"p-1-1": ["Goldmedaille"]}, "losses": {}}
    await league_rewards.notify(flow.db, tournament, final, frame, again)
    assert await flow.db.notifications.count_documents({"kind": "league_reward"}) == count
    # Gegenprobe: eine andere Fassung ist eine neue Nachricht.
    await league_rewards.notify(flow.db, tournament, {**final, "id": "andere-fassung"}, frame, again)
    assert await flow.db.notifications.count_documents({"kind": "league_reward"}) == count + 1


# ---------------------------------------------------------------- Echter Gewinn

@pytest.mark.asyncio
async def test_a_real_prize_rides_on_the_pickup_and_is_never_withdrawn_after_a_correction(flow):
    admin, league, _season, _division, staffel = await setup(flow, rewards=[{**GOLD, "prize": "Gutschein für das Team"}])
    await play_all(flow, staffel)
    await must_close(flow, staffel)
    pickups = await flow.db.prize_pickups.find({"tournament_id": staffel["id"]}, {"_id": 0}).to_list(10)
    assert [(row["team_id"], row["source_type"], row["prize_value"], row.get("needs_review")) for row in pickups] == [
        ("team-1", "league_reward", "Gutschein für das Team", None)]
    flow.act_as(await lead(flow, league, "Zweite Leitung", "season"))
    await must_reopen(flow, staffel)
    flow.act_as(admin)
    await play_all(flow, staffel, winner_of=lambda pair: "reg-2" if "reg-2" in pair else min(pair, key=number))
    await must_close(flow, staffel)
    pickups = {row["team_id"]: row for row in await flow.db.prize_pickups.find({"tournament_id": staffel["id"]}, {"_id": 0}).to_list(10)}
    assert set(pickups) == {"team-1", "team-2"}
    assert pickups["team-1"]["needs_review"] is True and not pickups["team-2"].get("needs_review")


# ---------------------------------------------------------------- Sichtbarkeit für Gäste

@pytest.mark.asyncio
async def test_guests_see_rewards_only_where_season_and_staffel_are_visible(flow):
    admin, _league, season, _division, staffel = await setup(flow, rewards=[GOLD])
    await play_all(flow, staffel)
    await must_close(flow, staffel)
    award = next(doc for doc in await rewards_of(flow, staffel))
    flow.act_as(None)
    public = (await flow.get("/api/users/public/p-1-1")).json()
    assert [row["reward"]["name"] for row in public["awards"] if row["reward"]] == ["Goldmedaille"]
    image = await flow.get(f"/api/rewards/{award['id']}/share.png")
    assert image.status_code == 200 and image.headers["content-type"] == "image/png" and image.content[:4] == b"\x89PNG"
    assert (await flow.get("/api/teams/team-1")).json()["awards"]

    # Season nur für Mitglieder: Gäste sehen nichts mehr - weder im Profil noch am Team noch als Bild.
    await flow.db.league_seasons.update_one({"id": season["id"]}, {"$set": {"visibility": "members"}})
    assert [row for row in (await flow.get("/api/users/public/p-1-1")).json()["awards"] if row.get("league")] == []
    assert [row for row in (await flow.get("/api/teams/team-1")).json()["awards"] if row.get("league")] == []
    assert (await flow.get(f"/api/rewards/{award['id']}/share.png")).status_code == 404
    # Gegenprobe: Mitglieder des Teams sehen es an der eigenen Teamseite weiter.
    flow.act_as({"id": "captain-1", "role": "user"})
    assert [row["reward"]["name"] for row in (await flow.get("/api/teams/team-1")).json()["awards"] if row["reward"]] == ["Goldmedaille"]

    # Season wieder öffentlich, aber die Staffel nicht öffentlich: ebenfalls nichts.
    flow.act_as(None)
    await flow.db.league_seasons.update_one({"id": season["id"]}, {"$set": {"visibility": "public"}})
    await flow.db.tournaments.update_one({"id": staffel["id"]}, {"$set": {"is_public": False}})
    assert [row for row in (await flow.get("/api/users/public/p-1-1")).json()["awards"] if row.get("league")] == []
    assert (await flow.get(f"/api/rewards/{award['id']}/share.png")).status_code == 404
    await flow.db.tournaments.update_one({"id": staffel["id"]}, {"$set": {"is_public": True}})
    assert (await flow.get(f"/api/rewards/{award['id']}/share.png")).status_code == 200


# ---------------------------------------------------------------- Rechte

@pytest.mark.asyncio
async def test_only_season_configure_may_compose_rewards_and_the_server_checks_the_input(flow):
    _admin, league, season, _division, _staffel = await setup(flow)
    url = f"{ADMIN}/seasons/{season['id']}/rewards"
    flow.act_as(await lead(flow, league, "Ergebnisse", "results"))
    view = await flow.get(url)
    assert view.status_code == 200 and view.json()["can_edit"] is False and view.json()["reward_players"] == "fielded"
    refused = await flow.put(url, json={"items": [GOLD]})
    assert refused.status_code == 403
    assert (await flow.db.league_seasons.find_one({"id": season["id"]}, {"_id": 0})).get("rewards") is None

    flow.act_as(await flow.add_user(name="Fremde Person"))
    assert (await flow.get(url)).status_code == 403
    assert (await flow.put(url, json={"items": [GOLD]})).status_code == 403
    flow.act_as(None)
    assert (await flow.get(url)).status_code == 401

    flow.act_as(await lead(flow, league, "Season-Leitung", "season"))
    ok = await flow.put(url, json={"items": [GOLD]})
    assert ok.status_code == 200 and ok.json()["can_edit"] is True and [row["name"] for row in ok.json()["items"]] == ["Goldmedaille"]
    kept_id = ok.json()["items"][0]["id"]
    renamed = await flow.put(url, json={"items": [{**GOLD, "id": kept_id, "name": "Gold"}]})
    assert renamed.json()["items"][0]["id"] == kept_id
    # Fremde Kennungen nimmt der Server nicht: er vergibt eine eigene.
    foreign = await flow.put(url, json={"items": [{**GOLD, "id": "fremd"}]})
    assert foreign.json()["items"][0]["id"] not in ("fremd", kept_id)

    for body, text in (
        ({"items": [{**GOLD, "name": "  "}]}, "Namen"),
        ({"items": [{**GOLD, "kind": "pokal"}]}, "Art der Belohnung"),
        ({"items": [{**GOLD, "recipients": []}]}, "wer sie bekommt"),
        ({"items": [{**GOLD, "places": {"mode": "range", "from": 5, "to": 2}}]}, "„bis“"),
        ({"items": [{**GOLD, "places": {"mode": "rank", "rank": 0}}]}, "1 bis"),
        ({"items": [GOLD] * 21}, "Höchstens 20"),
        ({"items": [{**GOLD, "image_url": "https://example.test/bild.png"}]}, "Hochladen"),
        ({"items": [{**GOLD, "image_url": "/api/static/uploads/fehlt.png"}]}, "Mediathek"),
        ({"reward_players": "alle"}, "Einsatz"),
        ({"divisions": {"unbekannt": []}}, "Liga N"),
    ):
        response = await flow.put(url, json=body)
        assert response.status_code in (404, 422), (body, response.text)
        assert text in response.json()["detail"], (body, response.json())


# ---------------------------------------------------------------- Gleichzeitiger Abschluss

@pytest.mark.asyncio
async def test_two_closes_at_once_grant_every_reward_exactly_once(flow):
    _admin, _league, _season, _division, staffel = await setup(flow, rewards=[GOLD, EVERYONE])
    await play_all(flow, staffel)
    answers = await asyncio.gather(close(flow, staffel), close(flow, staffel))
    assert sorted(answer.status_code for answer in answers) == [200, 409]
    docs = await rewards_of(flow, staffel)
    keys = [doc["reward_key"] for doc in docs]
    assert len(keys) == len(set(keys)) == 5
    persons = [note["user_id"] for note in await flow.db.notifications.find({"kind": "league_reward"}, {"_id": 0}).to_list(100)]
    assert len(persons) == len(set(persons))


@pytest.mark.asyncio
async def test_granting_twice_at_the_same_time_leaves_one_entry_per_reward_and_registration(flow):
    from services import league_final, league_rewards

    _admin, _league, _season, _division, staffel = await setup(flow, rewards=[GOLD, EVERYONE])
    await play_all(flow, staffel)
    await must_close(flow, staffel)
    final = await flow.db.league_final_tables.find_one({"tournament_id": staffel["id"], "active": True}, {"_id": 0})
    tournament = await flow.db.tournaments.find_one({"id": staffel["id"]}, {"_id": 0})
    frame = await league_final._frame(flow.db, tournament)
    await asyncio.gather(league_rewards.grant(flow.db, tournament, final, frame), league_rewards.grant(flow.db, tournament, final, frame))
    keys = [doc["reward_key"] for doc in await rewards_of(flow, staffel)]
    assert len(keys) == len(set(keys)) == 5


# ---------------------------------------------------------------- Zeremonie, Auswahl, Ligaseite, PDF

@pytest.mark.asyncio
async def test_the_ceremony_shows_each_new_reward_once_and_only_to_its_people(flow):
    admin, _league, season, _division, staffel = await setup(flow, rewards=[GOLD, LAST])
    await play_all(flow, staffel)
    await must_close(flow, staffel)
    flow.act_as({"id": "p-1-1", "role": "user"})
    unseen = (await flow.get("/api/me/rewards/unseen")).json()["rewards"]
    assert [row["reward"]["name"] for row in unseen] == ["Goldmedaille"]
    # Eine fremde Person kann nichts für andere als gesehen markieren.
    flow.act_as({"id": "p-2-1", "role": "user"})
    assert (await flow.post("/api/me/rewards/seen", json={"ids": [unseen[0]["id"]]})).json()["seen"] == 0
    flow.act_as({"id": "p-1-1", "role": "user"})
    assert (await flow.post("/api/me/rewards/seen", json={"ids": [unseen[0]["id"]]})).json()["seen"] == 1
    assert (await flow.get("/api/me/rewards/unseen")).json()["rewards"] == []
    flow.act_as({"id": "captain-4", "role": "user"})
    assert [row["reward"]["name"] for row in (await flow.get("/api/me/rewards/unseen")).json()["rewards"]] == ["Kämpferherz"]

    # Titel neben dem Namen: nur eine Belohnung der Art „Titel“.
    title = next(doc for doc in await rewards_of(flow, staffel) if doc["reward"]["kind"] == "title")
    gold = next(doc for doc in await rewards_of(flow, staffel) if doc["reward"]["kind"] == "medal")
    team_title = await flow.post(f"/api/teams/team-4/awards/{title['id']}/feature?slot=title")
    assert team_title.status_code == 200, team_title.text
    flow.act_as(None)
    assert (await flow.get("/api/teams/team-4")).json()["featured_title"]["reward"]["name"] == "Kämpferherz"
    flow.act_as({"id": "captain-1", "role": "user"})
    wrong = await flow.post(f"/api/teams/team-1/awards/{gold['id']}/feature?slot=title")
    assert wrong.status_code == 404
    flow.act_as({"id": "p-1-1", "role": "user"})
    assert (await flow.post(f"/api/me/awards/{gold['id']}/feature?slot=title")).status_code == 404
    assert (await flow.post(f"/api/me/awards/{gold['id']}/feature")).status_code == 200

    view = (await flow.get(f"{PAGE}/staffeln/{staffel['slug']}")).json()["staffel"]["rewards"]
    assert view["granted"] is True
    assert [(item["name"], [row["display_name"] for row in item["holders"]]) for item in view["items"]] == [
        ("Goldmedaille", ["Probe 1"]), ("Kämpferherz", ["Probe 4"])]

    # Ergebnis-PDF: Belohnung je Platz.
    from services.league_rewards import pdf_rows

    flow.act_as(admin)
    pdf = await flow.get(f"/api/exports/tournaments/{staffel['slug']}/standings.pdf")
    assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"
    tournament = await flow.db.tournaments.find_one({"id": staffel["id"]}, {"_id": 0})
    assert await pdf_rows(flow.db, tournament) == [["1. Platz", "Goldmedaille", "Medaille", "Probe 1"],
                                                   ["4. Platz", "Kämpferherz", "Titel", "Probe 4"]]
    # Gegenprobe: wieder geöffnet - kein Abschnitt.
    flow.act_as(await flow.add_staff(name="Zweite Leitung"))
    await must_reopen(flow, staffel)
    assert await pdf_rows(flow.db, await flow.db.tournaments.find_one({"id": staffel["id"]}, {"_id": 0})) == []
