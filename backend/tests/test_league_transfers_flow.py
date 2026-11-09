"""Transfers in der Liga (docs/LIGA.md, B.3, #2204): Fenster je Season, die Leitung genehmigt, gleiche Wartezeit, nichts ohne Protokoll.
Dazu was Profil und Team-Seite über die Berechtigung sehen - nie ein Geburtsdatum. Erfundene Namen."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_match_world import staffel  # noqa: E402
from models import now_utc  # noqa: E402
from squad_world import make_squad, squad_registration  # noqa: E402
from test_league_eligibility_flow import born, rules, state_of  # noqa: E402
from test_league_roster_flow import id_world, roster_entry  # noqa: E402
from test_league_squad_rules_flow import ADULT  # noqa: E402

TODAY = now_utc().date()
OPEN_WINDOW = [{"start_date": (TODAY - timedelta(days=2)).isoformat(), "end_date": (TODAY + timedelta(days=2)).isoformat()}]
OLD_WINDOW = [{"start_date": (TODAY - timedelta(days=9)).isoformat(), "end_date": (TODAY - timedelta(days=5)).isoformat()}]


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def transfer_world(flow, *, windows=None, matchday_one_over: bool = False, **season_rules) -> dict:
    """Rudel A und Rudel B spielen in derselben Season. Ida steht in Rudel B und soll zu Rudel A."""
    w = await id_world(flow)
    await rules(flow, w, one_team_per_season=True, transfer_windows=OPEN_WINDOW if windows is None else windows, **season_rules)
    for name in w["users"]:
        await born(flow, w, name, ADULT)
    # Tom stand im Aufbau der Welt in beiden Co-Teams - hier nicht.
    await flow.db.team_squads.update_one({"id": w["squad_b"]["id"]}, {"$pull": {"member_ids": w["users"]["Tom"]["id"]}})
    start = now_utc() - timedelta(days=30) if matchday_one_over else now_utc() + timedelta(days=30)
    await flow.db.tournaments.update_one({"id": w["tournament"]["id"]}, {"$set": {"start_date": start.isoformat(), "matchday_days": 7}})
    other = await staffel(flow, w["season_id"], "B")
    await flow.db.tournaments.update_one({"id": other["id"]}, {"$set": {"start_date": start.isoformat(), "matchday_days": 7}})
    w["reg_b"] = await squad_registration(flow, other, w["lions"], w["squad_b"])
    return w


def squad_url(w: dict, squad: str = "squad_a") -> str:
    return f"/api/teams/{w['lions']['id']}/squads/{w[squad]['id']}"


async def ask(flow, w: dict, name: str = "Ida", actor: str = "LoeLeitung"):
    flow.act_as(w["users"][actor])
    return await flow.post(f"{squad_url(w)}/transfers", json={"user_id": w["users"][name]["id"]})


def admin_url(w: dict) -> str:
    return f"/api/admin/leagues/seasons/{w['season_id']}/transfers"


async def squad_members(flow, w: dict, squad: str) -> list[str]:
    return (await flow.db.team_squads.find_one({"id": w[squad]["id"]}))["member_ids"]


@pytest.mark.asyncio
async def test_a_transfer_moves_the_player_after_the_approval(flow):
    w = await transfer_world(flow)
    asked = await ask(flow, w)
    assert asked.status_code == 200, asked.text
    row = asked.json()
    assert row["status"] == "pending" and row["from_squad_id"] == w["squad_b"]["id"] and row["to_squad_id"] == w["squad_a"]["id"]
    ida = w["users"]["Ida"]["id"]
    assert ida in await squad_members(flow, w, "squad_b"), "vor der Genehmigung ändert sich nichts"
    # Season-Seite mit Reitern (#2267): Der Link führt direkt in die Kaderübersicht, wo die Leitung entscheidet.
    asked_note = await flow.db.notifications.find_one({"meta.reason": "league_transfer_requested"}, {"_id": 0})
    assert asked_note["url"] == f"/admin/leagues/seasons/{w['season_id']}#kader"

    flow.act_as(w["staff"])
    listed = await flow.get(admin_url(w))
    assert [item["id"] for item in listed.json()["items"]] == [row["id"]]
    assert listed.json()["items"][0]["user_name"] == "Ida"
    approved = await flow.post(f"{admin_url(w)}/{row['id']}/approve", json={})

    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "approved"
    assert ida in await squad_members(flow, w, "squad_a")
    assert ida not in await squad_members(flow, w, "squad_b")
    assert (await state_of(flow, w, "Ida"))["ok"] is True
    actions = [log["action"] async for log in flow.db.audit_logs.find({"action": {"$regex": "^league.transfer"}}, {"_id": 0, "action": 1})]
    assert actions == ["league.transfer.request", "league.transfer.approve"]
    told = {note["user_id"] async for note in flow.db.notifications.find({"meta.reason": "league_transfer_approved"}, {"_id": 0})}
    assert {ida, w["users"]["LoeLeitung"]["id"]} <= told


@pytest.mark.asyncio
@pytest.mark.parametrize(("over", "days", "waits"), [(False, 7, True), (True, 7, True), (False, 3, True), (True, 0, False), (False, 0, False)])
async def test_a_transfer_always_waits_also_before_the_end_of_matchday_one(flow, over, days, waits):
    """Entscheidung Nr. 71 (Regelwerk § 4.6): Anders als ein gewöhnlicher Neuzugang wartet ein Transfer immer, nur eine 0 schaltet es aus."""
    w = await transfer_world(flow, matchday_one_over=over, new_player_wait_days=days)
    row = (await ask(flow, w)).json()
    flow.act_as(w["staff"])

    approved = await flow.post(f"{admin_url(w)}/{row['id']}/approve", json={})

    assert approved.status_code == 200, approved.text
    state = await state_of(flow, w, "Ida")
    assert (state["state"] == "waiting") is waits
    assert bool(state["until"]) is waits
    assert bool((await roster_entry(flow, w, "Ida") or {}).get("wait_from")) is waits
    told = await flow.db.notifications.find_one({"meta.reason": "league_transfer_approved", "user_id": w["users"]["Ida"]["id"]}, {"_id": 0})
    assert ("darf ab" in told["body"]) is waits


async def transfer_ida(flow, w: dict) -> dict:
    row = (await ask(flow, w)).json()
    flow.act_as(w["staff"])
    approved = await flow.post(f"{admin_url(w)}/{row['id']}/approve", json={})
    assert approved.status_code == 200, approved.text
    return row


@pytest.mark.asyncio
async def test_somebody_who_already_left_the_other_squad_waits_the_same(flow):
    w = await transfer_world(flow, new_player_wait_days=7)
    ida = w["users"]["Ida"]["id"]
    await flow.db.league_rosters.insert_one({"id": "e", "season_id": w["season_id"], "user_id": ida, "squad_ids": [w["squad_b"]["id"]]})
    await flow.db.team_squads.update_one({"id": w["squad_b"]["id"]}, {"$pull": {"member_ids": ida}})

    row = await transfer_ida(flow, w)

    assert row["from_squad_id"] == w["squad_b"]["id"]
    assert (await state_of(flow, w, "Ida"))["state"] == "waiting"


@pytest.mark.asyncio
async def test_a_transfer_back_into_a_known_squad_waits_again(flow):
    """Der Wiedereintritt startet keine neue Wartezeit - ein genehmigter Transfer schon, auch nach einer früheren Aufhebung."""
    w = await transfer_world(flow, new_player_wait_days=7)
    ida = w["users"]["Ida"]["id"]
    earlier = (now_utc() - timedelta(days=20)).isoformat()
    await flow.db.league_rosters.insert_one({
        "id": "e", "season_id": w["season_id"], "user_id": ida, "squad_ids": [w["squad_a"]["id"], w["squad_b"]["id"]],
        "squad_joined_at": {w["squad_a"]["id"]: earlier}, "wait_from": {w["squad_a"]["id"]: earlier},
        "wait_waivers": [{"squad_id": w["squad_a"]["id"], "at": earlier, "by": "x", "reason": "früher aufgehoben"}]})

    await transfer_ida(flow, w)

    entry = await roster_entry(flow, w, "Ida")
    assert entry["wait_from"][w["squad_a"]["id"]] > earlier
    assert entry["squad_joined_at"][w["squad_a"]["id"]] == earlier, "die erste Aufnahme bleibt"
    assert (await state_of(flow, w, "Ida"))["state"] == "waiting"


@pytest.mark.asyncio
async def test_the_league_office_lifts_the_wait_of_a_transfer_only_with_a_reason(flow):
    w = await transfer_world(flow, new_player_wait_days=7)
    await transfer_ida(flow, w)
    url = f"/api/admin/leagues/seasons/{w['season_id']}/roster/{w['users']['Ida']['id']}/waive-wait"

    assert (await flow.post(url, json={"squad_id": w["squad_a"]["id"], "reason": "kurz"})).status_code == 422
    lifted = await flow.post(url, json={"squad_id": w["squad_a"]["id"], "reason": "Team wäre sonst nicht spielfähig"})

    assert lifted.status_code == 200, lifted.text
    assert (await state_of(flow, w, "Ida"))["ok"] is True


@pytest.mark.asyncio
async def test_an_ordinary_newcomer_still_plays_right_away_before_the_end_of_matchday_one(flow):
    w = await transfer_world(flow, new_player_wait_days=7)
    await rules(flow, w, one_team_per_season=False)
    flow.act_as(w["users"]["LoeLeitung"])
    current = (await flow.db.team_squads.find_one({"id": w["squad_a"]["id"]}))["member_ids"]

    added = await flow.patch(squad_url(w), json={"member_ids": [*current, w["users"]["LoeLeitung"]["id"]]})

    assert added.status_code == 200, added.text
    assert (await state_of(flow, w, "LoeLeitung"))["ok"] is True


@pytest.mark.asyncio
async def test_assigning_a_squad_after_matchday_one_starts_no_wait(flow):
    w = await transfer_world(flow, matchday_one_over=True, new_player_wait_days=7)
    await rules(flow, w, one_team_per_season=False)
    third = await staffel(flow, w["season_id"], "C")
    await flow.db.tournaments.update_one({"id": third["id"]}, {"$set": {"start_date": (now_utc() - timedelta(days=30)).isoformat(), "matchday_days": 7}})
    rudel = await make_squad(flow, w["falcons"], "Horst Zwei", [w["users"]["FalLeitung"], w["users"]["Falke2"]], game_id="probe-shooter")
    flow.act_as(w["staff"])

    answer = await flow.post(f"/api/tournaments/{third['id']}/squad-registrations", json={"team_id": w["falcons"]["id"], "squad_id": rudel["id"]})

    assert answer.status_code == 200, answer.text
    entry = await flow.db.league_rosters.find_one({"season_id": w["season_id"], "user_id": w["users"]["FalLeitung"]["id"]}, {"_id": 0})
    assert not entry.get("wait_from")


@pytest.mark.asyncio
@pytest.mark.parametrize(("windows", "text"), [([], "keine Transfers"), (OLD_WINDOW, "Transferfenster")])
async def test_outside_the_window_there_is_no_transfer(flow, windows, text):
    w = await transfer_world(flow, windows=windows)

    asked = await ask(flow, w)

    assert asked.status_code == 409, asked.text
    assert text in asked.json()["detail"]


@pytest.mark.asyncio
async def test_an_old_request_can_still_be_decided_after_the_window(flow):
    w = await transfer_world(flow)
    row = (await ask(flow, w)).json()
    await rules(flow, w, transfer_windows=OLD_WINDOW)
    flow.act_as(w["staff"])

    assert (await flow.post(f"{admin_url(w)}/{row['id']}/approve", json={})).status_code == 200


@pytest.mark.asyncio
async def test_a_refusal_needs_a_reason_and_changes_nothing(flow):
    w = await transfer_world(flow)
    row = (await ask(flow, w)).json()
    flow.act_as(w["staff"])

    assert (await flow.post(f"{admin_url(w)}/{row['id']}/reject", json={"reason": "x"})).status_code == 422
    refused = await flow.post(f"{admin_url(w)}/{row['id']}/reject", json={"reason": "Kein Grund für den Wechsel"})

    assert refused.status_code == 200, refused.text
    assert refused.json()["status"] == "rejected"
    assert w["users"]["Ida"]["id"] in await squad_members(flow, w, "squad_b")
    assert (await flow.post(f"{admin_url(w)}/{row['id']}/approve", json={})).status_code == 409, "entschieden ist entschieden"
    assert await flow.db.audit_logs.find_one({"action": "league.transfer.reject"})


@pytest.mark.asyncio
async def test_only_one_open_request_and_it_can_be_withdrawn(flow):
    w = await transfer_world(flow)
    await flow.db.league_transfers.create_index([("season_id", 1), ("user_id", 1)], unique=True, name="league_transfer_one_open",
                                                partialFilterExpression={"status": "pending"})
    row = (await ask(flow, w)).json()

    assert (await ask(flow, w)).status_code == 409

    withdrawn = await flow.delete(f"{squad_url(w)}/transfers/{row['id']}")
    assert withdrawn.status_code == 200, withdrawn.text
    assert withdrawn.json()["status"] == "withdrawn"
    assert (await ask(flow, w)).status_code == 200


@pytest.mark.asyncio
async def test_who_may_ask_and_decide(flow):
    w = await transfer_world(flow)

    assert (await ask(flow, w, actor="Mila")).status_code == 403
    row = (await ask(flow, w)).json()
    flow.act_as(w["users"]["LoeLeitung"])
    assert (await flow.post(f"{admin_url(w)}/{row['id']}/approve", json={})).status_code == 403
    assert (await flow.get(admin_url(w))).status_code == 403


@pytest.mark.asyncio
async def test_no_transfer_when_none_is_needed(flow):
    w = await transfer_world(flow)
    await flow.db.team_squads.update_one({"id": w["squad_b"]["id"]}, {"$pull": {"member_ids": w["users"]["Ida"]["id"]}})

    asked = await ask(flow, w)

    assert asked.status_code == 409
    assert "kein Transfer nötig" in asked.json()["detail"]


@pytest.mark.asyncio
async def test_the_person_must_be_in_the_main_team(flow):
    w = await transfer_world(flow)

    asked = await ask(flow, w, name="Falke1")

    assert asked.status_code == 422
    assert "Team" in asked.json()["detail"]


@pytest.mark.asyncio
async def test_approval_checks_size_and_roles_again_but_not_the_age(flow):
    """#2313 (Fabian 09.11.): Ein fehlendes Geburtsdatum hält die Genehmigung nicht auf - die Person darf danach nur nicht spielen."""
    w = await transfer_world(flow, min_age=18, max_squad_size=4)
    row = (await ask(flow, w)).json()
    flow.act_as(w["staff"])
    approve = f"{admin_url(w)}/{row['id']}/approve"
    await born(flow, w, "Ida", None)

    await rules(flow, w, max_squad_size=3)
    too_many = await flow.post(approve, json={})
    assert too_many.status_code == 422 and "höchstens 3" in too_many.json()["detail"]
    await rules(flow, w, max_squad_size=4)

    await flow.db.team_squads.update_one({"id": w["squad_b"]["id"]}, {"$set": {"captain_id": w["users"]["Ida"]["id"]}})
    captain = await flow.post(approve, json={})
    assert captain.status_code == 409 and "Captain" in captain.json()["detail"]
    await flow.db.team_squads.update_one({"id": w["squad_b"]["id"]}, {"$unset": {"captain_id": ""}})

    approved = await flow.post(approve, json={})
    assert approved.status_code == 200, approved.text
    stored = await flow.db.league_transfers.find_one({"id": row["id"]}, {"_id": 0})
    assert stored["status"] == "approved"


@pytest.mark.asyncio
async def test_a_transfer_is_part_of_the_data_request_and_the_account_erasure(flow):
    w = await transfer_world(flow)
    await ask(flow, w)
    from services.personal_data import PERSONAL

    assert PERSONAL["league_transfers"].export == ("league_transfers",)
    from services import account_erasure
    assert "league_transfers" in account_erasure.PURGED


# ---------------------------------------------------------------- Was Profil und Team-Seite sehen


@pytest.mark.asyncio
async def test_the_own_profile_shows_the_state_without_a_date(flow):
    w = await transfer_world(flow, min_age=18)
    await born(flow, w, "Ida", None)
    flow.act_as(w["users"]["Ida"])

    response = await flow.get("/api/me/league-eligibility")

    assert response.status_code == 200, response.text
    item = response.json()["items"][0]
    assert item["squad_id"] == w["squad_b"]["id"]
    assert (item["state"], item["ok"], item["age"], item["min_age"]) == ("age_missing", False, "missing", 18)
    assert "birth" not in response.text

    await born(flow, w, "Ida", ADULT)
    response = await flow.get("/api/me/league-eligibility")
    assert response.json()["items"][0]["age"] == "met"
    assert "1990" not in response.text


@pytest.mark.asyncio
async def test_a_player_without_a_squad_in_a_league_sees_nothing(flow):
    w = await transfer_world(flow)
    flow.act_as(w["users"]["Fremd"])

    assert (await flow.get("/api/me/league-eligibility")).json() == {"items": []}


@pytest.mark.asyncio
async def test_the_team_page_shows_state_candidates_and_window(flow):
    w = await transfer_world(flow, min_age=18, max_squad_size=50, new_player_wait_days=7)
    await born(flow, w, "Mila", None)
    flow.act_as(w["users"]["LoeLeitung"])

    response = await flow.get(f"{squad_url(w)}/eligibility")

    assert response.status_code == 200, response.text
    assert "1990" not in response.text and "birth" not in response.text
    season = response.json()["seasons"][0]
    assert season["rules"]["max_squad_size"] == 50
    assert season["rules"]["min_age"] == 18
    assert season["rules"]["transfer_open"] is True
    assert season["can_edit"] is True
    players = {row["name"]: row for row in season["players"]}
    assert players["Mila"]["reason"] == "Geburtsdatum fehlt. Die Person trägt es im eigenen Profil ein."
    assert players["Kapitaen"]["age"] == "met" and players["Kapitaen"]["ok"] is True
    assert "text" not in players["Kapitaen"], "die Spiel-ID bleibt, wo sie heute schon steht"
    candidates = {row["name"]: row for row in season["candidates"]}
    assert candidates["Ida"]["needs_transfer"] is True and candidates["Ida"]["can_add"] is False
    assert "LoeLeitung" in candidates


@pytest.mark.asyncio
async def test_captain_reads_players_and_others_do_not(flow):
    w = await transfer_world(flow)
    flow.act_as(w["users"]["Kapitaen"])
    captain = await flow.get(f"{squad_url(w)}/eligibility")
    assert captain.status_code == 200
    assert captain.json()["seasons"][0]["can_edit"] is False

    flow.act_as(w["users"]["Mila"])
    assert (await flow.get(f"{squad_url(w)}/eligibility")).status_code == 403
    flow.act_as(w["users"]["Fremd"])
    assert (await flow.get(f"{squad_url(w)}/eligibility")).status_code == 403


@pytest.mark.asyncio
async def test_the_list_of_squads_says_what_the_season_asks(flow):
    w = await transfer_world(flow, min_age=18, max_squad_size=12)
    flow.act_as(w["users"]["LoeLeitung"])

    squads = (await flow.get(f"/api/teams/{w['lions']['id']}/squads")).json()

    wanted = next(row for row in squads if row["id"] == w["squad_a"]["id"])["league_requirement"]
    assert wanted["max_size"] == 12 and wanted["min_age"] == 18 and wanted["transfers_open"] is True


@pytest.mark.asyncio
async def test_the_roster_overview_counts_waiting_and_age_without_a_date(flow):
    w = await transfer_world(flow, min_age=18)
    await born(flow, w, "Mila", None)
    flow.act_as(w["staff"])

    overview = await flow.get(f"/api/admin/leagues/seasons/{w['season_id']}/roster")

    assert overview.status_code == 200, overview.text
    assert "1990" not in overview.text and "birth_date" not in overview.text
    body = overview.json()
    assert body["counts"]["age"] == 1
    squad = next(row for row in body["squads"] if row["squad_id"] == w["squad_a"]["id"])
    mila = next(row for row in squad["players"] if row["id"] == w["users"]["Mila"]["id"])
    assert mila["eligibility"]["state"] == "age_missing" and mila["eligibility"]["age"] == "missing"
    assert body["rules"]["min_age"] == 18


# ---------------------------------------------------------------- Format am Spiel


@pytest.mark.asyncio
@pytest.mark.parametrize(("field", "code"), [
    ({"key": "id", "label": "ID", "pattern": "[", "required": True}, 422),
    ({"key": "id", "label": "ID", "pattern": "a" * 201}, 422),
    ({"key": "id", "label": "ID", "options": ["A"] * 31}, 422),
    ({"key": "id", "label": "ID", "pattern": r"[^#]+#\d+", "format_hint": "Name#123"}, 200),
    ({"key": "plattform", "label": "Plattform", "options": ["A", "B"], "required": True}, 200),
    ({"key": "id", "label": "ID", "required": True}, 200),
])
async def test_the_game_checks_its_id_fields(flow, field, code):
    flow.act_as(await flow.add_staff())

    created = await flow.post("/api/games", json={"name": "Probe", "slug": "probe", "player_id_fields": [field]})

    assert created.status_code == code, created.text
    if code == 200:
        assert created.json()["player_id_fields"][0]["key"] == field["key"]


async def format_game(flow) -> dict:
    flow.act_as(await flow.add_staff())
    return (await flow.post("/api/games", json={"name": "Probe", "slug": "probe", "player_id_fields": [
        {"key": "id", "label": "Spiel-ID", "pattern": r"[^#]+#\d+", "format_hint": "Name#123", "required": True},
        {"key": "plattform", "label": "Plattform", "options": ["A", "B"], "required": True},
        {"key": "frei", "label": "Frei"}]})).json()


@pytest.mark.asyncio
async def test_the_profile_refuses_only_new_values_that_do_not_fit(flow):
    await format_game(flow)
    user = await flow.add_user(name="Profilperson")
    flow.act_as(user)

    wrong = await flow.patch("/api/users/me", json={"game_ids": {"probe": {"id": "falsch"}}})
    assert wrong.status_code == 422, wrong.text
    assert "Name#123" in wrong.json()["detail"]
    choice = await flow.patch("/api/users/me", json={"game_ids": {"probe": {"plattform": "C"}}})
    assert choice.status_code == 422
    fine = await flow.patch("/api/users/me", json={"game_ids": {"probe": {"id": "Name#1", "plattform": "A", "frei": "alles"}}})
    assert fine.status_code == 200, fine.text

    # Altbestand: Ein alter Wert hält das Speichern nicht auf.
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"game_ids.probe.id": "alt"}})
    kept = await flow.patch("/api/users/me", json={"game_ids": {"probe": {"id": "alt", "plattform": "B"}}})
    assert kept.status_code == 200, kept.text
