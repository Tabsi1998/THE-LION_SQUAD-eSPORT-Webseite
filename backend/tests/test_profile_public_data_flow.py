"""Profil und öffentliche Daten (#2126): was Fremde nicht sehen, was die Person selbst pflegt - und dass alte Konten erreichbar bleiben.

Namen und Werte sind erfunden.
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


async def player(flow, name, **fields):
    user = await flow.add_user(role="player", name=name)
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"privacy_public_profile": True, "is_active": True, **fields}})
    user.update(fields)
    return user


async def club_admin(flow, name="vereinsleitung"):
    user = await flow.add_user(role="player", name=name)
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"areas": ["club"]}})
    return {**user, "areas": ["club"]}


# ---------------------------------------------------------------- Zusatz: Dokumente
@pytest.mark.asyncio
async def test_members_never_see_where_a_document_is_stored(flow):
    await flow.db.documents.insert_one({"id": "d-1", "title": "Statuten", "category": "statutes", "visibility": "members",
                                        "storage_key": "ablage-1.pdf", "created_at": "2026-09-01T10:00:00+00:00"})
    member = await player(flow, "mitglied", is_club_member=True)
    flow.act_as(member)
    for url in ("/api/documents", "/api/documents?scope=club"):
        rows = (await flow.get(url)).json()
        assert [row["id"] for row in rows] == ["d-1"]
        assert "storage_key" not in rows[0] and rows[0]["view_url"] == "/api/documents/d-1/view"

    flow.act_as(await club_admin(flow))
    assert (await flow.get("/api/documents/admin")).json()[0]["storage_key"] == "ablage-1.pdf"
    changed = await flow.patch("/api/documents/d-1", json={"title": "Statuten 2026"})
    assert changed.status_code == 200 and changed.json()["storage_key"] == "ablage-1.pdf"
