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


# ---------------------------------------------------------------- RF4: archivieren, löschen nur unbenutzt, Protokoll

@pytest.mark.asyncio
async def test_sponsor_is_archived_while_used_and_deleted_when_not(flow):
    admin = await editor(flow)
    sponsor = (await flow.post("/api/sponsors", json={"name": "Probe GmbH", "tier": "gold"})).json()
    sid = sponsor["id"]
    await flow.db.events.insert_one({"id": "e-1", "name": "LAN", "sponsor_ids": [sid]})
    await flow.db.tournaments.insert_many([
        {"id": "t-1", "title": "Cup", "round_sponsors": [{"round": 1, "sponsor_id": sid}]},
        {"id": "t-2", "title": "Cup 2", "round_sponsors": [{"round": 1, "sponsor_id": sid}]},
    ])
    refused = await flow.delete(f"/api/sponsors/{sid}")
    assert refused.status_code == 409
    assert "1 Event" in refused.json()["detail"] and "2 Turniere" in refused.json()["detail"] and "Archiviere" in refused.json()["detail"]
    assert await flow.db.sponsors.count_documents({"id": sid}) == 1
    assert await audit(flow, "sponsor.delete") == []

    archived = await flow.patch(f"/api/sponsors/{sid}", json={"is_active": False})
    assert archived.json()["is_active"] is False and archived.json()["is_currently_visible"] is False
    flow.act_as(None)
    assert (await flow.get("/api/sponsors")).json() == []
    flow.act_as(admin)
    # Gleicher Wert ist keine Änderung; Zurückholen steht wieder im Protokoll.
    assert (await flow.patch(f"/api/sponsors/{sid}", json={"is_active": False})).status_code == 200
    rows = await audit(flow, "sponsor.archive")
    assert len(rows) == 1 and rows[0]["target_id"] == sid and rows[0]["actor_id"] == admin["id"] and rows[0]["data"]["name"] == "Probe GmbH"
    assert (await flow.patch(f"/api/sponsors/{sid}", json={"is_active": True})).json()["is_currently_visible"] is True
    assert len(await audit(flow, "sponsor.restore")) == 1

    await flow.db.events.delete_many({})
    await flow.db.tournaments.delete_many({})
    assert (await flow.delete(f"/api/sponsors/{sid}")).status_code == 200
    rows = await audit(flow, "sponsor.delete")
    assert len(rows) == 1 and rows[0]["data"]["name"] == "Probe GmbH"
    assert (await flow.delete(f"/api/sponsors/{sid}")).status_code == 404


@pytest.mark.asyncio
async def test_partner_in_use_stays_and_archiving_hides_it(flow):
    admin = await editor(flow)
    partner = (await flow.post("/api/partners", json={"name": "Probe Verein"})).json()
    pid = partner["id"]
    await flow.db.references.insert_one({"id": "r-1", "title": "Cup", "partner_ids": [pid]})
    await flow.db.reference_series.insert_one({"id": "s-1", "partner_ids": [pid]})
    refused = await flow.delete(f"/api/partners/{pid}")
    assert refused.status_code == 409 and "1 Referenz" in refused.json()["detail"] and "1 Saison" in refused.json()["detail"]
    assert (await flow.patch(f"/api/partners/{pid}", json={"is_active": False})).json()["is_active"] is False
    assert len(await audit(flow, "partner.archive")) == 1
    flow.act_as(None)
    assert (await flow.get("/api/partners")).json() == []
    assert (await flow.get(f"/api/partners/{partner['slug']}")).status_code == 404
    flow.act_as(admin)
    await flow.db.references.delete_many({})
    await flow.db.reference_series.delete_many({})
    assert (await flow.delete(f"/api/partners/{pid}")).status_code == 200
    assert (await audit(flow, "partner.delete"))[0]["data"]["name"] == "Probe Verein"


@pytest.mark.asyncio
async def test_reference_in_use_is_archived_not_deleted(flow):
    admin = await editor(flow)
    await flow.db.club_member_profiles.insert_one({"id": "p-1", "slug": "anni", "display_name": "Anni Probe", "is_active": True})
    with_people = (await flow.post("/api/references", json={"title": "Mit Leuten", "member_profile_ids": ["p-1"]})).json()
    refused = await flow.delete(f"/api/references/{with_people['id']}")
    assert refused.status_code == 409 and "1 Mitgliederprofil" in refused.json()["detail"]

    plain = (await flow.post("/api/references", json={"title": "Probe Cup"})).json()
    rid = plain["id"]
    await flow.db.reference_series.insert_one({"id": "s-1", "reference_id": rid})
    refused = await flow.delete(f"/api/references/{rid}")
    assert refused.status_code == 409 and "Saison" in refused.json()["detail"]
    await flow.db.reference_series.delete_many({})

    assert (await flow.patch("/api/references/admin/showcase", json={"mode": "pinned", "reference_id": rid})).status_code == 200
    refused = await flow.delete(f"/api/references/{rid}")
    assert refused.status_code == 409 and "Vitrine" in refused.json()["detail"]
    assert (await flow.patch("/api/references/admin/showcase", json={"mode": "auto", "reference_id": None})).status_code == 200

    assert (await flow.patch(f"/api/references/{rid}", json={"is_active": False})).json()["is_active"] is False
    assert len(await audit(flow, "reference.archive")) == 1
    flow.act_as(None)
    assert (await flow.get(f"/api/references/{rid}")).status_code == 404
    flow.act_as(admin)
    assert (await flow.delete(f"/api/references/{rid}")).status_code == 200
    assert (await audit(flow, "reference.delete"))[0]["data"]["name"] == "Probe Cup"
    assert (await flow.delete(f"/api/references/{rid}")).status_code == 404
