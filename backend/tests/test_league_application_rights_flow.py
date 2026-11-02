"""Rechte am Eingang der Selbstanmeldung (docs/LIGA.md, B.4, #2205), auch negativ: andere Liga über Season- oder Antrags-Kennung, andere Zuständigkeit, ohne Zwei-Faktor, Mitglied ohne Rolle. Erfundene Namen."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from league_application_world import application_world, inbox_url, submitted  # noqa: E402
from league_start_world import ok  # noqa: E402
from models import now_utc  # noqa: E402

ACTIONS = (("review", {}), ("accept", {}), ("reject", {"reason": "Grund genug"}), ("waitlist", {}), ("assign", {"tournament_id": "T"}))
OTHER_CAPABILITIES = ["manage", "season", "roster", "matches", "results", "disputes", "sanctions", "rules"]


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def holder(flow, league_id: str, capabilities: list[str], **fields) -> dict:
    user = await flow.add_user(name=f"Zuständig {new_id()[:6]}")
    user.update(fields)
    await flow.db.league_staff.insert_one({"id": new_id(), "league_id": league_id, "user_id": user["id"], "capabilities": capabilities,
                                           "created_at": now_utc().isoformat(), "created_by": "test"})
    return user


async def refused_everywhere(flow, w: dict, application: dict, person: dict, code: int = 403) -> None:
    flow.act_as(person)
    assert (await flow.get(inbox_url(w))).status_code == code
    for action, body in ACTIONS:
        body = {**body, "tournament_id": w["tid"]} if body.get("tournament_id") else body
        answer = await flow.post(f"{inbox_url(w)}/{application['id']}/{action}", json=body)
        assert answer.status_code == code, (action, answer.text)
    assert (await flow.db.league_applications.find_one({"id": application["id"]}))["status"] == "submitted"


@pytest.mark.asyncio
async def test_the_right_capability_may_decide_in_its_league(flow):
    w = await application_world(flow)
    application = await submitted(flow, w, w["teams"][0])
    duty = await holder(flow, w["league"]["id"], ["applications"])
    flow.act_as(duty)

    assert ok(await flow.get(inbox_url(w)))["items"][0]["id"] == application["id"]
    assert ok(await flow.post(f"{inbox_url(w)}/{application['id']}/review", json={}))["status"] == "in_review"
    assert ok(await flow.post(f"{inbox_url(w)}/{application['id']}/accept", json={"tournament_id": w["tid"]}))["status"] == "accepted"


@pytest.mark.asyncio
async def test_the_leagues_area_may_decide(flow):
    w = await application_world(flow)
    application = await submitted(flow, w, w["teams"][0])
    area = await flow.add_user(name="Ligaleitung")
    area["areas"] = ["leagues"]
    flow.act_as(area)

    assert ok(await flow.post(f"{inbox_url(w)}/{application['id']}/accept", json={}))["status"] == "accepted"


@pytest.mark.asyncio
async def test_another_capability_is_refused(flow):
    w = await application_world(flow)
    application = await submitted(flow, w, w["teams"][0])

    await refused_everywhere(flow, w, application, await holder(flow, w["league"]["id"], OTHER_CAPABILITIES))


@pytest.mark.asyncio
async def test_another_league_is_refused_by_season_id(flow):
    w = await application_world(flow)
    other = await application_world(flow, teams=0)
    application = await submitted(flow, w, w["teams"][0])

    await refused_everywhere(flow, w, application, await holder(flow, other["league"]["id"], ["applications"]))


@pytest.mark.asyncio
async def test_staff_of_another_league_cannot_reach_it_through_their_own_season(flow):
    w = await application_world(flow)
    other = await application_world(flow, teams=0)
    application = await submitted(flow, w, w["teams"][0])
    flow.act_as(await holder(flow, other["league"]["id"], ["applications"]))

    for action, body in (("review", {}), ("accept", {"tournament_id": w["tid"]}), ("reject", {"reason": "Grund genug"}), ("waitlist", {}), ("assign", {"tournament_id": w["tid"]})):
        answer = await flow.post(f"{inbox_url(other)}/{application['id']}/{action}", json=body)
        assert answer.status_code == 404, (action, answer.text)
    assert w["teams"][0]["squad"]["name"] not in str((await flow.get(inbox_url(other))).json())
    assert (await flow.db.league_applications.find_one({"id": application["id"]}))["status"] == "submitted"


@pytest.mark.asyncio
async def test_without_second_factor_nothing_goes(flow):
    w = await application_world(flow)
    application = await submitted(flow, w, w["teams"][0])

    await refused_everywhere(flow, w, application, await holder(flow, w["league"]["id"], ["applications"], auth_mfa_verified=False))
    area = await flow.add_user(name="Ligaleitung ohne Zwei-Faktor")
    area.update(areas=["leagues"], auth_mfa_verified=False)
    await refused_everywhere(flow, w, application, area)


@pytest.mark.asyncio
@pytest.mark.parametrize("role,areas", [("tournament_admin", []), ("moderator", []), ("user", ["tournaments"]), ("user", [])])
async def test_tournament_rights_and_plain_accounts_get_nothing(flow, role, areas):
    w = await application_world(flow)
    application = await submitted(flow, w, w["teams"][0])
    person = await flow.add_user(role=role, name="Keine Ligarechte")
    person["areas"] = areas

    await refused_everywhere(flow, w, application, person)


@pytest.mark.asyncio
async def test_a_member_of_the_applying_squad_has_no_say(flow):
    w = await application_world(flow)
    side = w["teams"][0]
    application = await submitted(flow, w, side)

    await refused_everywhere(flow, w, application, side["member"])
    await refused_everywhere(flow, w, application, side["captain"])
    await refused_everywhere(flow, w, application, side["lead"])


@pytest.mark.asyncio
async def test_a_guest_gets_401(flow):
    w = await application_world(flow)
    application = await submitted(flow, w, w["teams"][0])

    await refused_everywhere(flow, w, application, None, code=401)


@pytest.mark.asyncio
async def test_settings_need_the_season_capability(flow):
    w = await application_world(flow, open_window=False)
    url = f"/api/admin/leagues/seasons/{w['season']['id']}"
    flow.act_as(await holder(flow, w["league"]["id"], ["applications"]))
    assert (await flow.patch(url, json={"application_slots": 8})).status_code == 403
    flow.act_as(await holder(flow, w["league"]["id"], ["season"]))
    assert ok(await flow.patch(url, json={"application_slots": 8}))["application_slots"] == 8
