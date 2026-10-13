"""Speicher-Warteschlange (#1048, #1061): Web und App schicken beim Speichern des eigenen Profils den Header
X-Expected-User-Id mit. Ist inzwischen ein anderes Konto angemeldet (anderer Tab, Kontowechsel in der App), lehnt der
Server mit 409 ab und schreibt nichts - die Änderung landet nie im falschen Konto. Ohne Header bleibt alles wie bisher
(ältere App-Versionen)."""
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
async def test_passendes_konto_speichert(flow):
    anna = await flow.add_user(name="anna")
    flow.act_as(anna)
    res = await flow.patch("/api/users/me", json={"bio": "Hallo"}, headers={"X-Expected-User-Id": anna["id"]})
    assert res.status_code == 200, res.text
    assert res.json()["bio"] == "Hallo"
    assert res.json()["updated_at"]


@pytest.mark.asyncio
async def test_anderes_konto_wird_abgelehnt_und_nichts_geschrieben(flow):
    anna = await flow.add_user(name="anna")
    bert = await flow.add_user(name="bert")
    flow.act_as(bert)
    res = await flow.patch("/api/users/me", json={"bio": "Von Anna gemeint"}, headers={"X-Expected-User-Id": anna["id"]})
    assert res.status_code == 409, res.text
    assert "anderen Konto" in res.json()["detail"]
    stored = await flow.db.users.find_one({"id": bert["id"]}, {"_id": 0, "bio": 1})
    assert (stored or {}).get("bio") in (None, "")


@pytest.mark.asyncio
async def test_ohne_header_wie_bisher(flow):
    anna = await flow.add_user(name="anna")
    flow.act_as(anna)
    res = await flow.patch("/api/users/me", json={"bio": "Alt"})
    assert res.status_code == 200, res.text
    assert res.json()["bio"] == "Alt"
