"""Der Verein in Zahlen auf der Startseite (#407): echte Zähler, nur was öffentlich zählt."""
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


@pytest.mark.asyncio
async def test_club_numbers_count_only_public_and_real_things(flow):
    await flow.db.memberships.insert_many([
        {"id": "m1", "user_id": "u1", "member_status": "active"},
        {"id": "m2", "user_id": "u2", "member_status": "honorary"},
        {"id": "m3", "user_id": "u3", "member_status": "former"},
        {"id": "m4", "user_id": "u4", "member_status": "pending"},
    ])
    await flow.db.tournaments.insert_many([
        {"id": "t1", "slug": "cup", "title": "Cup", "status": "completed", "is_public": True},
        {"id": "t2", "slug": "geheim", "title": "Geheim", "status": "scheduled", "is_public": False},
        {"id": "t3", "slug": "entwurf", "title": "Entwurf", "status": "draft"},
        {"id": "t4", "slug": "abgesagt", "title": "Abgesagt", "status": "cancelled"},
    ])
    await flow.db.events.insert_many([
        {"id": "e1", "slug": "fest", "name": "Fest", "status": "completed", "visibility": "public"},
        {"id": "e2", "slug": "lan", "name": "LAN", "status": "scheduled"},
        {"id": "e3", "slug": "intern", "name": "Intern", "status": "scheduled", "visibility": "members"},
        {"id": "e4", "slug": "entwurf", "name": "Entwurf", "status": "draft", "visibility": "public"},
    ])
    # Turnierteilnahmen (#425) sind die Referenzen - nicht die Auszeichnungen aus eigenen Turnieren.
    await flow.db.references.insert_many([
        {"id": "ref1", "title": "[PS] HC | Liga X | Cup A", "status": "completed", "placement": 3},
        {"id": "ref2", "title": "[PC] Cup B", "status": "planned"},
        {"id": "ref3", "title": "[PS] Cup C", "status": "active"},
    ])
    await flow.db.tournament_awards.insert_one({"id": "a1", "tournament_id": "t1", "registration_id": "r1", "place": 1})
    flow.act_as(None)
    response = await flow.get("/api/home/state")
    assert response.status_code == 200, response.text
    assert response.json()["club_numbers"] == {"members": 2, "tournaments": 1, "events": 2, "participations": 3}
