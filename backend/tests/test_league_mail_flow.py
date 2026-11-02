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
async def test_a_transfer_decision_is_mailed_to_the_person(flow):
    w = await transfer_world(flow)
    row = (await ask(flow, w)).json()
    flow.act_as(w["staff"])

    await flow.post(f"{admin_url(w)}/{row['id']}/approve", json={})

    assert await mails(flow, w["users"]["Ida"])
