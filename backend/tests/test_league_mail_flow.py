"""Spielberechtigung (#2204): Was jemand tun muss oder was ohne ihn entschieden wurde, kommt auch per Mail - nach den Einstellungen der Person.
Vorlage ``league_notice``. Nie ein Geburtsdatum, nie wem eine Spiel-ID gehört. Erfundene Namen."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from email_service import render_named  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from test_league_participants_flow import confirmed_without_list, series_world  # noqa: E402
from test_league_squad_rules_flow import rule_world, set_members  # noqa: E402
from test_league_transfers_flow import admin_url, ask, transfer_world  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def mails(flow, user: dict) -> list[dict]:
    return await flow.db.mail_jobs.find({"template_key": "league_notice", "to": user["email"]}, {"_id": 0}).to_list(10)


@pytest.mark.asyncio
async def test_the_template_exists_and_carries_title_text_and_link(flow):
    subject, body = await render_named("league_notice", title="Teilnehmerliste fehlt", text="Bitte eintragen.", url="https://example.test/m")

    assert subject == "Teilnehmerliste fehlt"
    assert "Bitte eintragen." in body and "https://example.test/m" in body


@pytest.mark.asyncio
async def test_a_missing_list_is_mailed_to_captain(flow):
    w = await series_world(flow)

    await confirmed_without_list(flow, w)

    assert await mails(flow, w["captain_h"])
    assert not await mails(flow, w["captain_a"])


@pytest.mark.asyncio
async def test_an_edit_from_outside_is_mailed_to_the_team_lead(flow):
    w = await rule_world(flow)

    await set_members(flow, w, "squad_a", "Kapitaen", "Mila", "Ida", actor="staff")

    assert await mails(flow, w["users"]["LoeLeitung"])
    assert not await mails(flow, w["users"]["Kapitaen"])


@pytest.mark.asyncio
async def test_no_league_answer_or_message_carries_a_birth_date(flow):
    w = await transfer_world(flow, min_age=18, new_player_wait_days=7)
    marker = "1987-06-05"
    for name in w["users"]:
        await flow.db.users.update_one({"id": w["users"][name]["id"]}, {"$set": {"birth_date": marker}})
    await flow.db.users.update_one({"id": w["users"]["Mila"]["id"]}, {"$set": {"birth_date": "2020-06-05"}})
    row = (await ask(flow, w)).json()
    flow.act_as(w["staff"])
    answers = [await flow.post(f"{admin_url(w)}/{row['id']}/approve", json={}),
               await flow.get(f"/api/admin/leagues/seasons/{w['season_id']}/roster"),
               await flow.get(admin_url(w))]
    flow.act_as(w["users"]["LoeLeitung"])
    answers += [await flow.get(f"/api/teams/{w['lions']['id']}/squads/{w['squad_a']['id']}/eligibility"),
                await flow.get(f"/api/teams/{w['lions']['id']}/squads"),
                await flow.patch(f"/api/teams/{w['lions']['id']}/squads/{w['squad_b']['id']}", json={"member_ids": [w["users"]["Mila"]["id"]]})]
    flow.act_as(w["users"]["Ida"])
    answers.append(await flow.get("/api/me/league-eligibility"))

    assert all(answer.status_code < 500 for answer in answers)
    written = [str(row) async for row in flow.db.notifications.find({}, {"_id": 0})]
    written += [str(row) async for row in flow.db.mail_jobs.find({}, {"_id": 0})]
    written += [str(row) async for row in flow.db.audit_logs.find({}, {"_id": 0})]
    for text in [*(answer.text for answer in answers), *written]:
        assert marker not in text and "2020-06-05" not in text and "birth_date" not in text
        assert "1987" not in text


@pytest.mark.asyncio
async def test_a_transfer_decision_is_mailed_to_the_person(flow):
    w = await transfer_world(flow)
    row = (await ask(flow, w)).json()
    flow.act_as(w["staff"])

    await flow.post(f"{admin_url(w)}/{row['id']}/approve", json={})

    assert await mails(flow, w["users"]["Ida"])
