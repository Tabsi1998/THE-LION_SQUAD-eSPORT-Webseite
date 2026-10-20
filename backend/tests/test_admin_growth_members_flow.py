"""Startseite der Verwaltung (#1378): „Neue Vereinsmitglieder“ kommen aus der Mitgliedschaft, nicht aus den Konten.

Der Kasten „Wachstum“ zählte jede Registrierung als „neues Mitglied“. Konten heißen jetzt Konten; dazu kommt die Zahl der
Mitgliedschaften (aktiv oder Ehrenmitglied), die im Zeitraum begonnen haben - nur für Vereinsverwaltung und System.
"""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from models import now_utc  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def _day(days_ago: int) -> str:
    return (now_utc() - timedelta(days=days_ago)).strftime("%Y-%m-%d")


async def _membership(flow, status: str, since: str | None, precision: str | None = "day") -> None:
    await flow.db.memberships.insert_one({
        "id": new_id(), "user_id": new_id(), "member_status": status,
        "member_since": since, "member_since_precision": precision,
    })


@pytest.mark.asyncio
async def test_new_club_members_come_from_the_membership(flow):
    # Konten ohne Mitgliedschaft (hier die anlegende Person) zählen nicht als Vereinsmitglieder.
    await _membership(flow, "active", _day(3))
    await _membership(flow, "honorary", f"{_day(10)}T12:00:00+00:00")
    # Nicht neu: vor dem Zeitraum, nur beantragt, ausgetreten, ohne Datum, nur Jahr bekannt.
    await _membership(flow, "active", _day(60))
    await _membership(flow, "pending", _day(2))
    await _membership(flow, "former", _day(2))
    await _membership(flow, "active", None)
    await _membership(flow, "active", _day(1), precision="year")

    flow.act_as(await flow.add_user(role="club_admin"))
    response = await flow.get("/api/admin/growth-stats?days=30")
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["new_members"] == 2


@pytest.mark.asyncio
async def test_only_club_administration_and_system_see_the_growth_box(flow):
    for areas in (["finance"], ["content"], ["tournaments"]):
        person = await flow.add_user(role="user")
        await flow.db.users.update_one({"id": person["id"]}, {"$set": {"areas": areas}})
        person["areas"] = areas
        flow.act_as(person)
        assert (await flow.get("/api/admin/growth-stats?days=30")).status_code == 403, areas
    club = await flow.add_user(role="user")
    await flow.db.users.update_one({"id": club["id"]}, {"$set": {"areas": ["club"]}})
    club["areas"] = ["club"]
    flow.act_as(club)
    response = await flow.get("/api/admin/growth-stats?days=30")
    assert response.status_code == 200, response.text
    assert response.json()["new_members"] == 0
