import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import new_id  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.mark.asyncio
async def test_prizes_cannot_be_generated_before_results_are_published(flow):
    tournament_id = new_id()
    await flow.db.tournaments.insert_one({
        "id": tournament_id,
        "slug": "not-finished",
        "title": "Noch nicht beendet",
        "status": "registration",
        "prize_places": [{"place": 1, "value": "Pokal"}],
    })
    flow.act_as(await flow.add_staff())

    response = await flow.post(f"/api/prizes/auto-create/{tournament_id}")

    assert response.status_code == 409, response.text
    assert response.json()["detail"] == "Gewinne können erst nach veröffentlichten Ergebnissen erzeugt werden."
