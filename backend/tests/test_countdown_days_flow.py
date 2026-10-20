"""Countdown nur, wenn es bald so weit ist (#1264): ab wie vielen Tagen vorher die Website zählt, ist einstellbar
(Verwaltung → Branding, Vorgabe 14 Tage, erlaubt 1 bis 60) und steht in den öffentlichen Einstellungen."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def public_days(flow) -> int:
    response = await flow.get("/api/settings/public")
    assert response.status_code == 200, response.text
    return response.json()["countdown_days"]


@pytest.mark.asyncio
async def test_countdown_days_default_setting_and_limits(flow):
    assert await public_days(flow) == 14, "ohne Einstellung die Vorgabe aus dem Ticket"

    flow.act_as(await flow.add_user(role="club_admin", name="admin"))
    saved = await flow.put("/api/settings/branding", json={"countdown_days": 21})
    assert saved.status_code == 200, saved.text
    assert await public_days(flow) == 21

    for wrong in (0, 61, -3, "viele"):
        refused = await flow.put("/api/settings/branding", json={"countdown_days": wrong})
        assert refused.status_code == 422, (wrong, refused.text)
    assert await public_days(flow) == 21, "ein ungültiger Wert ändert nichts"

    # Leeren heißt: wieder die Vorgabe.
    cleared = await flow.put("/api/settings/branding", json={"countdown_days": None})
    assert cleared.status_code == 200, cleared.text
    assert await public_days(flow) == 14


@pytest.mark.asyncio
async def test_a_stored_value_outside_the_limits_falls_back_to_the_default(flow):
    await flow.db.settings.update_one({"id": "branding"}, {"$set": {"countdown_days": 500}}, upsert=True)
    assert await public_days(flow) == 14
