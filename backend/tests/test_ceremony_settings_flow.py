"""Erfolge II (E8, #618): die Zeremonie-Einstellungen am Profil - Ton an/aus, Lautstärke 0–100, volle
Bewegung oder dezent - werden über PATCH /api/users/me gespeichert und mit dem Konto zurückgegeben."""
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
async def test_zeremonie_einstellungen_speichern_und_pruefen(flow):
    user = await flow.add_user(name="anna")
    flow.act_as(user)
    res = await flow.patch("/api/users/me", json={"ceremony_sound": False, "ceremony_volume": 35, "ceremony_mode": "subtle"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["ceremony_sound"] is False and body["ceremony_volume"] == 35 and body["ceremony_mode"] == "subtle"
    stored = await flow.db.users.find_one({"id": user["id"]}, {"_id": 0, "ceremony_sound": 1, "ceremony_volume": 1, "ceremony_mode": 1})
    assert stored == {"ceremony_sound": False, "ceremony_volume": 35, "ceremony_mode": "subtle"}
    assert (await flow.patch("/api/users/me", json={"ceremony_volume": 140})).status_code == 422
    assert (await flow.patch("/api/users/me", json={"ceremony_mode": "laut"})).status_code == 422
    res = await flow.patch("/api/users/me", json={"ceremony_sound": True, "ceremony_volume": 100, "ceremony_mode": "full"})
    assert res.status_code == 200 and res.json()["ceremony_mode"] == "full" and res.json()["ceremony_volume"] == 100
