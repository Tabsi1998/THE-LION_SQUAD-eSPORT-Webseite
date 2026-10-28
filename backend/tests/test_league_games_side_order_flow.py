"""Die Seiten eines Liga-Spiels in der Reihenfolge der Plätze (#2096, Browser-Durchlauf): Heim zuerst - so stehen die
Sieger-Knöpfe im Melde- und Bestätigen-Formular und im Ergebnis-Fenster wie Überschrift und Spielplan. Vorher kam die
Reihenfolge aus der Datenbank und war bei manchen Spielen vertauscht. Erfundene Namen."""

import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_match_world import duel, world  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.mark.asyncio
async def test_the_sides_follow_the_slots_not_the_database(flow):
    w = await world(flow)
    # Heim ist hier Horst (Platz 1), angelegt wurde aber Rudel A zuerst.
    reverse = await duel(flow, w["tournament"], w["reg_h"], w["reg_a"], matchday=2)

    for match, expected in ((w["match"], [w["reg_a"]["id"], w["reg_h"]["id"]]),
                            (reverse, [w["reg_h"]["id"], w["reg_a"]["id"]])):
        for person in (w["users"]["Kapitaen"], w["users"]["Falke1"], w["staff"]):
            flow.act_as(person)
            page = (await flow.get(f"/api/matches/{match['id']}/page")).json()
            assert [side["registration_id"] for side in page["league"]["sides"]] == expected
