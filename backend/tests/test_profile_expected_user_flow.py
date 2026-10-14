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


@pytest.mark.asyncio
async def test_leerer_header_wird_abgelehnt(flow):
    """Ein leerer Wert ist kein fehlender Header: der Client wollte ein Konto nennen und hat keins - nichts schreiben."""
    anna = await flow.add_user(name="anna")
    flow.act_as(anna)
    res = await flow.patch("/api/users/me", json={"bio": "Leer"}, headers={"X-Expected-User-Id": ""})
    assert res.status_code == 409, res.text
    stored = await flow.db.users.find_one({"id": anna["id"]}, {"_id": 0, "bio": 1})
    assert (stored or {}).get("bio") in (None, "")


@pytest.mark.asyncio
async def test_autosave_schickt_felder_einzeln_und_alles_bleibt(flow):
    """Profil speichert von selbst (#1048): jede Änderung geht als eigener kleiner PATCH mit dem Header. Was vorher
    gespeichert wurde, bleibt stehen; neu gelesen ist alles da und updated_at ist der neueste Stand."""
    anna = await flow.add_user(name="anna")
    flow.act_as(anna)
    headers = {"X-Expected-User-Id": anna["id"]}
    first = await flow.patch("/api/users/me", json={"bio": "Von selbst gespeichert"}, headers=headers)
    assert first.status_code == 200, first.text
    second = await flow.patch("/api/users/me", json={"privacy_public_profile": False}, headers=headers)
    assert second.status_code == 200, second.text
    assert second.json()["bio"] == "Von selbst gespeichert"
    assert second.json()["updated_at"] >= first.json()["updated_at"]

    # Neu laden: das eigene Konto frisch aus der Datenbank (die Sitzung im Prüfstand ist fest).
    reloaded = await flow.get(f"/api/users/{anna['id']}")
    assert reloaded.status_code == 200, reloaded.text
    assert reloaded.json()["bio"] == "Von selbst gespeichert"
    assert reloaded.json()["privacy_public_profile"] is False
    assert reloaded.json()["updated_at"] == second.json()["updated_at"]
