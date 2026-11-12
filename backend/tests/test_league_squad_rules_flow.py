"""Spielberechtigung (docs/LIGA.md, B.3, #2204): Regeln bei Kaderaufnahme und Zuteilen, Wartezeit und ihre Aufhebung, Protokoll
und die Nachricht an die Teamleitung, wenn die Liga-Leitung von außen eingreift. Erfundene Namen."""
import pathlib
import re
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_match_world import staffel  # noqa: E402
from models import now_utc  # noqa: E402
from squad_world import squad_registration  # noqa: E402
from test_league_eligibility_flow import born, rules, state_of  # noqa: E402
from test_league_roster_flow import id_world, roster_entry, set_id  # noqa: E402

ADULT = "1990-05-05"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def rule_world(flow, *, matchday_one_over: bool = False, **season_rules) -> dict:
    w = await id_world(flow)
    await rules(flow, w, **season_rules)
    for name in w["users"]:
        await born(flow, w, name, ADULT)
    start = now_utc() - timedelta(days=30) if matchday_one_over else now_utc() + timedelta(days=30)
    await flow.db.tournaments.update_one({"id": w["tournament"]["id"]}, {"$set": {"start_date": start.isoformat(), "matchday_days": 7}})
    return w


async def set_members(flow, w: dict, squad: str, *names: str, actor: str = "LoeLeitung"):
    flow.act_as(w["users"][actor] if actor in w["users"] else w[actor])
    body = {"member_ids": [w["users"][name]["id"] for name in names]}
    return await flow.patch(f"/api/teams/{w['lions']['id']}/squads/{w[squad]['id']}", json=body)


async def squad_b_in_season(flow, w: dict) -> dict:
    other = await staffel(flow, w["season_id"], "B")
    return await squad_registration(flow, other, w["lions"], w["squad_b"])


async def notes(flow, reason: str) -> list[dict]:
    return await flow.db.notifications.find({"meta.reason": reason}, {"_id": 0}).to_list(50)


# ---------------------------------------------------------------- Kaderaufnahme


@pytest.mark.asyncio
async def test_an_old_season_lets_everything_through_as_before(flow):
    w = await rule_world(flow)
    await squad_b_in_season(flow, w)
    await born(flow, w, "Ida", None)

    added = await set_members(flow, w, "squad_a", "Kapitaen", "Mila", "Tom", "Ida")

    assert added.status_code == 200, added.text


@pytest.mark.asyncio
@pytest.mark.parametrize(("most", "code"), [(3, 422), (4, 200), (50, 200)])
async def test_the_largest_squad_per_setting(flow, most, code):
    w = await rule_world(flow, max_squad_size=most)

    added = await set_members(flow, w, "squad_a", "Kapitaen", "Mila", "Tom", "Ida")

    assert added.status_code == code, added.text
    if code == 422:
        assert f"höchstens {most}" in added.json()["detail"]


@pytest.mark.asyncio
async def test_a_person_in_another_squad_of_the_season_needs_a_transfer(flow):
    w = await rule_world(flow, one_team_per_season=True)
    await squad_b_in_season(flow, w)

    added = await set_members(flow, w, "squad_a", "Kapitaen", "Mila", "Tom", "Ida")

    assert added.status_code == 409, added.text
    assert "Transfer" in added.json()["detail"]
    assert "Rudel B" not in added.json()["detail"]
    stored = await flow.db.team_squads.find_one({"id": w["squad_a"]["id"]})
    assert w["users"]["Ida"]["id"] not in stored["member_ids"], "die Aufnahme wurde nicht gespeichert"


@pytest.mark.asyncio
async def test_leaving_first_does_not_get_round_the_transfer(flow):
    w = await rule_world(flow, one_team_per_season=True)
    await squad_b_in_season(flow, w)
    # Ida stand schon im Rudel B der Season und geht dort - der Abgang bleibt frei.
    await flow.db.league_rosters.insert_one({"id": "e", "season_id": w["season_id"], "user_id": w["users"]["Ida"]["id"], "squad_ids": [w["squad_b"]["id"]]})
    left = await set_members(flow, w, "squad_b", "Tom", "LoeLeitung")
    assert left.status_code == 200, left.text

    added = await set_members(flow, w, "squad_a", "Kapitaen", "Mila", "Tom", "Ida")

    assert added.status_code == 409, added.text
    assert "Transfer" in added.json()["detail"]


@pytest.mark.asyncio
async def test_the_same_person_may_play_for_another_team_in_another_season(flow):
    w = await rule_world(flow, one_team_per_season=True)
    other = await flow.create_tournament(team_mode="team", format="league", game_id="probe-shooter",
                                         league_context={"league_id": "andere", "season_id": "s-andere", "division_id": "d", "staffel": "A"})
    await squad_registration(flow, other, w["lions"], w["squad_b"])

    added = await set_members(flow, w, "squad_a", "Kapitaen", "Mila", "Tom", "Ida")

    assert added.status_code == 200, added.text


@pytest.mark.asyncio
@pytest.mark.parametrize(("birth", "state"), [(ADULT, None), (None, "age_missing"), ("2015-01-01", "age_not_met")])
async def test_the_age_rule_at_the_squad_only_blocks_playing(flow, birth, state):
    """#2313 (Fabian 09.11.): Ohne oder mit zu jungem Geburtsdatum geht die Aufnahme, die Person darf nur nicht spielen."""
    w = await rule_world(flow, min_age=18)
    await born(flow, w, "Ida", birth)

    added = await set_members(flow, w, "squad_a", "Kapitaen", "Mila", "Tom", "Ida")

    assert added.status_code == 200, added.text
    view = await flow.get(f"/api/teams/{w['lions']['id']}/squads/{w['squad_a']['id']}/eligibility")
    assert view.status_code == 200, view.text
    ida = next(row for season in view.json()["seasons"] for row in season["players"] if row["id"] == w["users"]["Ida"]["id"])
    assert ida["ok"] is (state is None) and (state is None or ida["state"] == state), ida
    assert not re.search(r"2015-01-01|01\.01\.2015", view.text), "das Datum bleibt im Server"


@pytest.mark.asyncio
async def test_departures_stay_free_whatever_the_rules_say(flow):
    w = await rule_world(flow, min_age=18, one_team_per_season=True, max_squad_size=2, min_squad_size=3)

    left = await set_members(flow, w, "squad_a", "Kapitaen", "Mila")

    assert left.status_code == 200, left.text


@pytest.mark.asyncio
async def test_a_short_squad_warns_only_below_the_lower_minimum(flow):
    w = await rule_world(flow)
    await flow.db.tournaments.update_one({"id": w["tournament"]["id"]}, {"$set": {"lineup_mode": "series", "lineup_min_players": 3, "min_squad_size": 3, "team_size": 4}})

    three = await set_members(flow, w, "squad_a", "Kapitaen", "Mila", "Tom", "Ida")
    assert three.status_code == 200, three.text
    back_to_three = await set_members(flow, w, "squad_a", "Kapitaen", "Mila", "Tom")
    assert back_to_three.status_code == 200
    assert not await notes(flow, "league_squad_short"), "drei reichen, obwohl die Sollstärke vier ist"

    two = await set_members(flow, w, "squad_a", "Kapitaen", "Mila")
    assert two.status_code == 200
    assert await notes(flow, "league_squad_short")


# ---------------------------------------------------------------- Wartezeit


@pytest.mark.asyncio
async def test_until_the_end_of_matchday_one_new_players_play_right_away(flow):
    w = await rule_world(flow, new_player_wait_days=7)

    await set_members(flow, w, "squad_a", "Kapitaen", "Mila", "Tom", "Ida")

    entry = await roster_entry(flow, w, "Ida")
    assert w["squad_a"]["id"] in entry["squad_joined_at"]
    assert not entry.get("wait_from")
    assert (await state_of(flow, w, "Ida"))["ok"] is True
    assert not await notes(flow, "league_wait")


@pytest.mark.asyncio
async def test_after_matchday_one_new_players_wait_even_if_the_squad_is_short(flow):
    w = await rule_world(flow, matchday_one_over=True, new_player_wait_days=7, min_squad_size=5)

    added = await set_members(flow, w, "squad_a", "Kapitaen", "Mila", "Tom", "Ida")

    assert added.status_code == 200, added.text
    row = await state_of(flow, w, "Ida")
    assert (row["state"], row["ok"]) == ("waiting", False)
    assert row["until"]
    assert "darf ab" in row["reason"]
    assert [item["user_id"] for item in await notes(flow, "league_wait")] == [w["users"]["Ida"]["id"]]
    assert w["users"]["Kapitaen"]["id"] in {item["user_id"] for item in await notes(flow, "league_wait_team")}


@pytest.mark.asyncio
async def test_coming_back_does_not_restart_the_waiting_time(flow):
    w = await rule_world(flow, matchday_one_over=True, new_player_wait_days=7)
    await set_members(flow, w, "squad_a", "Kapitaen", "Mila", "Tom", "Ida")
    first = (await roster_entry(flow, w, "Ida"))["wait_from"][w["squad_a"]["id"]]

    await set_members(flow, w, "squad_a", "Kapitaen", "Mila", "Tom")
    await set_members(flow, w, "squad_a", "Kapitaen", "Mila", "Tom", "Ida")

    assert (await roster_entry(flow, w, "Ida"))["wait_from"][w["squad_a"]["id"]] == first


@pytest.mark.asyncio
async def test_a_game_without_required_ids_still_knows_the_waiting_time(flow):
    w = await rule_world(flow, matchday_one_over=True, new_player_wait_days=7)
    await flow.db.games.update_one({"id": "probe-main"}, {"$set": {"player_id_fields": []}})

    await set_members(flow, w, "squad_a", "Kapitaen", "Mila", "Tom", "Ida")

    assert (await state_of(flow, w, "Ida"))["state"] == "waiting"


@pytest.mark.asyncio
async def test_lifting_the_wait_needs_a_reason_and_the_right(flow):
    w = await rule_world(flow, matchday_one_over=True, new_player_wait_days=7)
    await set_members(flow, w, "squad_a", "Kapitaen", "Mila", "Tom", "Ida")
    url = f"/api/admin/leagues/seasons/{w['season_id']}/roster/{w['users']['Ida']['id']}/waive-wait"
    body = {"squad_id": w["squad_a"]["id"], "reason": "Kader sonst nicht spielfähig"}

    flow.act_as(w["users"]["LoeLeitung"])
    assert (await flow.post(url, json=body)).status_code == 403

    flow.act_as(w["staff"])
    short = await flow.post(url, json={**body, "reason": "kurz"})
    assert short.status_code == 422
    assert "Grund" in short.json()["detail"]
    lifted = await flow.post(url, json=body)
    assert lifted.status_code == 200, lifted.text
    assert lifted.json()["ok"] is True
    assert (await state_of(flow, w, "Ida"))["ok"] is True

    log = await flow.db.audit_logs.find_one({"action": "league.roster.wait_waive"}, {"_id": 0})
    assert log["data"]["reason"] == body["reason"] and log["data"]["user_id"] == w["users"]["Ida"]["id"]
    again = await flow.post(url, json=body)
    assert again.status_code == 409, "es gibt nichts mehr aufzuheben"


@pytest.mark.asyncio
async def test_a_wrong_or_taken_id_gets_its_own_message_without_the_owner(flow):
    w = await rule_world(flow, unique_game_ids=True)
    await flow.db.games.update_one({"id": "probe-main"}, {"$set": {"player_id_fields": [
        {"key": "activision_id", "label": "Activision-ID", "required": True, "pattern": r"[^#]+#\d+", "format_hint": "Name#123"}]}})
    await set_id(flow, w["users"]["Ida"], "falsch")

    assert (await set_members(flow, w, "squad_a", "Kapitaen", "Mila", "Tom", "Ida")).status_code == 200

    rows = await notes(flow, "league_id_problem")
    assert w["users"]["Ida"]["id"] in {row["user_id"] for row in rows}
    assert w["users"]["Kapitaen"]["id"] in {row["user_id"] for row in rows}
    assert all("Name#123" in row["body"] for row in rows)
    assert all("Stichtag" not in row["body"] for row in rows)


# ---------------------------------------------------------------- Protokoll und Griff von außen


@pytest.mark.asyncio
async def test_every_squad_change_in_a_staffel_is_in_the_protocol(flow):
    w = await rule_world(flow)

    await set_members(flow, w, "squad_a", "Kapitaen", "Mila", "Ida")

    log = await flow.db.audit_logs.find_one({"action": "league.squad.roster"}, {"_id": 0})
    assert log["data"]["squad_id"] == w["squad_a"]["id"]
    assert log["data"]["added"] == [w["users"]["Ida"]["id"]]
    assert log["data"]["removed"] == [w["users"]["Tom"]["id"]]
    assert log["actor_id"] == w["users"]["LoeLeitung"]["id"]


@pytest.mark.asyncio
async def test_leaving_the_team_is_in_the_protocol_too(flow):
    w = await rule_world(flow)
    flow.act_as(w["users"]["Mila"])

    left = await flow.post(f"/api/teams/{w['lions']['id']}/leave")

    assert left.status_code == 200, left.text
    log = await flow.db.audit_logs.find_one({"action": "league.squad.roster"}, {"_id": 0})
    assert log["data"]["removed"] == [w["users"]["Mila"]["id"]]


@pytest.mark.asyncio
async def test_a_squad_outside_a_staffel_writes_nothing(flow):
    w = await rule_world(flow)

    await set_members(flow, w, "squad_b", "Tom", "Ida")

    assert not await flow.db.audit_logs.find_one({"action": "league.squad.roster"})


@pytest.mark.asyncio
async def test_the_team_lead_hears_when_the_league_office_edits_the_squad(flow):
    w = await rule_world(flow)
    co_lead = await flow.add_user(name="CoLeitung")
    await flow.db.teams.update_one({"id": w["lions"]["id"]}, {"$set": {"co_leader_ids": [co_lead["id"]]}, "$push": {"member_ids": co_lead["id"]}})

    edited = await set_members(flow, w, "squad_a", "Kapitaen", "Mila", "Ida", actor="staff")

    assert edited.status_code == 200, edited.text
    rows = await notes(flow, "league_squad_edit")
    assert {row["user_id"] for row in rows} == {w["users"]["LoeLeitung"]["id"], co_lead["id"]}
    text = rows[0]["body"]
    assert "Rudel A" in text and "Ida" in text and "Tom" in text
    assert w["staff"]["display_name"] in text or w["staff"]["username"] in text
    assert all(row["meta"]["dedupe_key"].startswith(f"league-squad-edit:{w['squad_a']['id']}:") for row in rows)


@pytest.mark.asyncio
async def test_the_team_lead_gets_no_message_about_their_own_edit(flow):
    w = await rule_world(flow)

    await set_members(flow, w, "squad_a", "Kapitaen", "Mila", "Ida")

    assert not await notes(flow, "league_squad_edit")


@pytest.mark.asyncio
async def test_a_role_change_from_outside_tells_the_team_lead(flow):
    w = await rule_world(flow)
    flow.act_as(w["staff"])

    changed = await flow.put(f"/api/teams/{w['lions']['id']}/squads/{w['squad_a']['id']}/roles", json={"captain_id": w["users"]["Mila"]["id"]})

    assert changed.status_code == 200, changed.text
    rows = await notes(flow, "league_squad_edit")
    assert [row["user_id"] for row in rows] == [w["users"]["LoeLeitung"]["id"]]
    assert "Captain" in rows[0]["body"]


# ---------------------------------------------------------------- Zuteilen


async def assign_b(flow, w: dict):
    other = await staffel(flow, w["season_id"], "B")
    flow.act_as(w["staff"])
    return await flow.post(f"/api/tournaments/{other['id']}/squad-registrations",
                           json={"team_id": w["lions"]["id"], "squad_id": w["squad_b"]["id"]}), other


@pytest.mark.asyncio
@pytest.mark.parametrize(("season_rules", "change", "code", "text"), [
    ({"max_squad_size": 2}, None, 400, "höchstens 2"),
    ({"one_team_per_season": True}, None, 409, "schon in einem anderen Co-Team"),
    # Seit #2313: ein fehlendes Geburtsdatum hält das Zuteilen nicht auf, es sperrt erst Check-in und Aufstellung.
    ({"min_age": 18}, "Ida", 200, None),
    ({}, None, 200, None),
])
async def test_assigning_checks_the_season(flow, season_rules, change, code, text):
    w = await rule_world(flow, **season_rules)
    if change:
        await born(flow, w, change, None)

    answer, _other = await assign_b(flow, w)

    assert answer.status_code == code, answer.text
    if text:
        assert text in answer.json()["detail"]


@pytest.mark.asyncio
async def test_the_assign_dialog_shows_the_same_reasons_without_a_date(flow):
    w = await rule_world(flow, min_age=18)
    await born(flow, w, "Ida", "2015-01-01")
    other = await staffel(flow, w["season_id"], "B")
    flow.act_as(w["staff"])

    response = await flow.get(f"/api/tournaments/{other['id']}/squad-candidates")

    assert response.status_code == 200, response.text
    assert not re.search(r"2015-01-01|01\.01\.2015", response.text)
    squads = {squad["name"]: squad for team in response.json()["teams"] for squad in team["squads"]}
    assert squads["Rudel B"]["problems"] == []
    assert any("Altersvorgabe" in text for text in squads["Rudel B"]["notes"])
