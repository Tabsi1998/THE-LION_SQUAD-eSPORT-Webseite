"""„So sehen dich andere“ (#1149) - durch die echte Anwendung geschickt.

Wer sein eigenes Profil ansieht, sieht alles. Mit ``view_as=public`` sieht die Person ihr Profil so, wie es jemand ohne
Anmeldung sieht: Felder für Community, Verein oder nur Admins fallen weg. Für alle anderen ändert der Schalter nichts.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def neon_with_levels(flow):
    neon = await flow.add_user(name="neonfalke")
    await flow.db.users.update_one({"id": neon["id"]}, {"$set": {
        "privacy_public_profile": True,
        "city": "Innsbruck",
        "country": "AT",
        "bio": "Rocket League und FC 26.",
        "profile_visibility": {"city": "community", "country": "public"},
    }})
    return neon


@pytest.mark.asyncio
async def test_own_profile_as_others_hides_community_fields(flow):
    neon = await neon_with_levels(flow)
    flow.act_as(neon)
    own = (await flow.get("/api/users/public/neonfalke")).json()
    assert own["city"] == "Innsbruck"
    assert own["country"] == "AT"
    as_others = (await flow.get("/api/users/public/neonfalke?view_as=public")).json()
    assert as_others["city"] is None
    assert as_others["country"] == "AT"
    assert as_others["bio"] == "Rocket League und FC 26."
    assert "relationship" not in as_others


@pytest.mark.asyncio
async def test_view_as_changes_nothing_for_somebody_else(flow):
    await neon_with_levels(flow)
    kiwi = await flow.add_user(name="kiwikomet")
    flow.act_as(kiwi)
    normal = (await flow.get("/api/users/public/neonfalke")).json()
    switched = (await flow.get("/api/users/public/neonfalke?view_as=public")).json()
    assert normal["city"] == switched["city"] == "Innsbruck"
    assert switched["relationship"]["status"] != "self"


@pytest.mark.asyncio
async def test_a_private_profile_stays_hidden_as_others(flow):
    neon = await neon_with_levels(flow)
    await flow.db.users.update_one({"id": neon["id"]}, {"$set": {"privacy_public_profile": False}})
    flow.act_as(neon)
    assert (await flow.get("/api/users/public/neonfalke?view_as=public")).status_code == 404
