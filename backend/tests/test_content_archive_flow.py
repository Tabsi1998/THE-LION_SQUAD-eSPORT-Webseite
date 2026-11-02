"""Referenzen, Partner und Sponsoren (#2130): interne Notizen bleiben intern, was Dolibarr führt, ist gesperrt, gelöscht wird
nur Unbenutztes mit Protokoll, und ausgeblendet wird über genau ein Feld. Nur Fakes, nur erfundene Daten."""
import pathlib
import sys
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import dolibarr_sponsors, migrations  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    await instance.db.mutation_locks.create_index("resource", unique=True)
    try:
        yield instance
    finally:
        await shutdown()


async def editor(flow):
    admin = await flow.add_user(role="club_admin", name="redaktion")
    flow.act_as(admin)
    return admin


async def audit(flow, action):
    return await flow.db.audit_logs.find({"action": action}, {"_id": 0}).to_list(20)


# ---------------------------------------------------------------- RF1: interne Notizen

@pytest.mark.asyncio
async def test_internal_notes_reach_only_the_administration(flow):
    await editor(flow)
    await flow.db.partners.insert_one({"id": "pa-1", "slug": "probe", "name": "Probe Partner", "is_active": True})
    await flow.db.club_member_profiles.insert_one({"id": "p-1", "slug": "anni", "display_name": "Anni Probe", "is_active": True})
    created = await flow.post("/api/references", json={"title": "Herbst Cup", "highlights": "Toller Lauf", "internal_notes": "Rechnung offen",
                                                       "partner_ids": ["pa-1"], "member_profile_ids": ["p-1"]})
    assert created.status_code == 200, created.text
    rid = created.json()["id"]
    assert created.json()["internal_notes"] == "Rechnung offen"
    saved = await flow.patch(f"/api/references/{rid}", json={"internal_notes": "Rechnung bezahlt"})
    assert saved.json()["internal_notes"] == "Rechnung bezahlt"
    assert (await flow.get("/api/references/admin")).json()["items"][0]["internal_notes"] == "Rechnung bezahlt"

    flow.act_as(None)
    for path in ("/api/references", f"/api/references/{rid}", "/api/partners/probe"):
        answer = await flow.get(path)
        assert answer.status_code == 200, (path, answer.text)
        assert "Rechnung" not in answer.text and "internal_notes" not in answer.text, path
    assert (await flow.get(f"/api/references/{rid}")).json()["highlights"] == "Toller Lauf"
