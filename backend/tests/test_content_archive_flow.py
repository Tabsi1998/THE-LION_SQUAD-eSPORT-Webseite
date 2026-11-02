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
from services import migrations  # noqa: E402


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


@pytest.mark.asyncio
async def test_internal_notes_stay_out_of_every_public_route_and_need_the_content_area(flow):
    await editor(flow)
    await flow.db.club_member_profiles.insert_one({"id": "p-1", "slug": "anni", "display_name": "Anni Probe", "is_active": True, "visibility": "public", "is_public": True})
    await flow.db.partners.insert_one({"id": "pa", "slug": "probe", "name": "Probe Partner", "is_active": True})
    created = (await flow.post("/api/references", json={"title": "Herbst", "internal_notes": "GEHEIMNOTIZ", "partner_ids": ["pa"], "member_profile_ids": ["p-1"]})).json()
    rid = created["id"]
    flow.act_as(None)
    for path in ("/api/references", f"/api/references/{rid}", "/api/partners/probe", "/api/members/anni", "/api/reference-series", f"/api/seo/references/{rid}"):
        answer = await flow.get(path)
        assert "GEHEIMNOTIZ" not in answer.text, path
    flow.act_as(await flow.add_user(name="normal"))
    assert (await flow.get("/api/references/admin")).status_code == 403
    refused = await flow.post("/api/references/admin/checks/preview", json={"internal_notes": "x"})
    assert refused.status_code == 403


# ---------------------------------------------------------------- RF5: ein Feld, die Sichtbarkeit bleibt

def _old_sponsor_status(doc: dict, today: str) -> str:
    """So rechnete die Seite vor #2130 - nur hier festgehalten, als Maßstab für die Umstellung."""
    if doc.get("is_active") is False:
        return "inactive"
    status = str(doc.get("contract_status") or "active").strip().lower()
    if status not in {"planned", "active", "paused", "expired", "cancelled"}:
        status = "active"
    if status in {"paused", "cancelled"}:
        return status
    start, end = (doc.get("contract_start") or None), (doc.get("contract_end") or None)
    if start and start > today:
        return "planned"
    if end and end < today:
        return "expired"
    return "active"


def _sponsor_combinations(today: datetime) -> list[dict]:
    day = lambda offset: (today + timedelta(days=offset)).date().isoformat()  # noqa: E731
    dates = [{}, {"contract_start": day(30)}, {"contract_end": day(-30)}, {"contract_start": day(-30), "contract_end": day(30)},
             {"contract_start": day(30), "contract_end": day(-30)}]
    rows = []
    for active in ({}, {"is_active": True}, {"is_active": False}):
        for status in ({}, *({"contract_status": value} for value in ("active", "planned", "paused", "expired", "cancelled", "PAUSED", " cancelled ", "kaputt", None))):
            for date in dates:
                index = len(rows)
                rows.append({"id": f"s-{index}", "name": f"Sponsor {index}", "logo_url": f"/uploads/logo-{index}.png", "tier": "gold", **active, **status, **date})
    return rows


@pytest.mark.asyncio
async def test_every_old_sponsor_combination_stays_as_visible_as_it_was(flow):
    now = datetime.now(timezone.utc)
    today = now.date().isoformat()
    docs = _sponsor_combinations(now)
    expected = {doc["id"]: _old_sponsor_status(doc, today) for doc in docs}
    await flow.db.sponsors.insert_many([dict(doc) for doc in docs])

    result = await migrations.migrate_one_hide_field(flow.db)
    assert result.endswith("0 references renamed")
    flow.act_as(None)
    # Jeder Sponsor hat ein eigenes Logo - die Liste fasst gleiche Logos zusammen.
    visible = {row["id"] for row in (await flow.get("/api/sponsors")).json()}
    former = {row["id"] for row in (await flow.get("/api/sponsors/former")).json()}
    assert visible == {sid for sid, status in expected.items() if status == "active"}
    assert former == {sid for sid, status in expected.items() if status == "expired"}

    stored = await flow.db.sponsors.find({}, {"_id": 0}).to_list(None)
    assert not any("contract_status" in doc for doc in stored)
    by_id = {doc["id"]: doc for doc in stored}
    for doc in docs:
        was_paused = str(doc.get("contract_status") or "").strip().lower() in {"paused", "cancelled"}
        assert by_id[doc["id"]].get("is_active") == (False if was_paused else doc.get("is_active")), doc

    # Zweiter Lauf: nichts ändert sich mehr, das Protokoll nennt die Verborgenen beim ersten Lauf.
    before = await flow.db.sponsors.find({}, {"_id": 0}).to_list(None)
    assert (await migrations.migrate_one_hide_field(flow.db)).startswith("0 sponsors hidden, 0 contract")
    assert await flow.db.sponsors.find({}, {"_id": 0}).to_list(None) == before
    first = (await audit(flow, "content.one_hide_field"))[0]["data"]
    assert first["sponsors_hidden"] and all(row["contract_status"] in {"paused", "cancelled"} and row["name"] for row in first["sponsors_hidden"])


@pytest.mark.asyncio
async def test_every_old_reference_combination_stays_as_visible_as_it_was(flow):
    docs = []
    for active in ({}, {"is_active": True}, {"is_active": False}):
        for status in ("planned", "active", "completed", "archived"):
            for visibility in ("public", "community", "members", "internal"):
                docs.append({"id": f"r-{len(docs)}", "title": f"Referenz {len(docs)}", "status": status, "visibility": visibility, **active})
    await flow.db.references.insert_many([dict(doc) for doc in docs])
    flow.act_as(None)
    before = {row["id"] for row in (await flow.get("/api/references")).json()["items"]}
    assert before == {doc["id"] for doc in docs if doc.get("is_active") is not False and doc["visibility"] == "public"}
    assert await migrations.migrate_one_hide_field(flow.db) == "0 sponsors hidden, 0 contract statuses cleared, 12 references renamed"
    assert {row["id"] for row in (await flow.get("/api/references")).json()["items"]} == before
    assert await flow.db.references.count_documents({"status": "archived"}) == 0
    # „Archiviert“ blendete nie aus: der Status wird umbenannt, ``is_active`` bleibt bei jeder Referenz, wie es war.
    stored = {doc["id"]: doc async for doc in flow.db.references.find({}, {"_id": 0})}
    for doc in docs:
        assert stored[doc["id"]].get("is_active") == doc.get("is_active")
    assert await migrations.migrate_one_hide_field(flow.db) == "0 sponsors hidden, 0 contract statuses cleared, 0 references renamed"


@pytest.mark.asyncio
async def test_a_sponsor_without_id_does_not_stop_the_migration(flow):
    """Altbestand ohne ``id``: darf den Start nicht abbrechen und wird trotzdem umgestellt."""
    await flow.db.sponsors.insert_many([
        {"name": "Altbestand", "contract_status": "paused", "logo_url": "/x.png"},
        {"id": "s-2", "name": "Mit Kennung", "contract_status": "active"},
    ])
    assert await migrations.migrate_one_hide_field(flow.db) == "1 sponsors hidden, 2 contract statuses cleared, 0 references renamed"
    old = await flow.db.sponsors.find_one({"name": "Altbestand"}, {"_id": 0})
    assert old["is_active"] is False and "contract_status" not in old
    assert "contract_status" not in await flow.db.sponsors.find_one({"id": "s-2"}, {"_id": 0})
    rows = await audit(flow, "content.one_hide_field")
    assert [row["data"]["section"] for row in rows] == ["sponsors"]
    assert rows[0]["data"]["sponsors_hidden"] == [{"id": None, "name": "Altbestand", "contract_status": "paused"}]


@pytest.mark.asyncio
async def test_the_log_is_written_section_by_section_before_changing_anything(flow):
    """Bricht der Lauf bei den Referenzen ab, stehen die Namen der Sponsoren schon im Protokoll; der nächste Lauf holt den Rest nach."""
    await flow.db.sponsors.insert_one({"id": "s-1", "name": "Pause GmbH", "contract_status": "paused"})
    await flow.db.references.insert_one({"id": "r-1", "title": "Alt", "status": "archived"})

    class BrokenReferences:
        def __init__(self, collection):
            self.find = collection.find

        async def update_many(self, *_args, **_kwargs):
            raise RuntimeError("Datenbank weg")

    class BrokenDb:
        def __getattr__(self, name):
            collection = getattr(flow.db, name)
            return BrokenReferences(collection) if name == "references" else collection

    with pytest.raises(RuntimeError):
        await migrations.migrate_one_hide_field(BrokenDb())
    rows = await audit(flow, "content.one_hide_field")
    assert [row["data"]["section"] for row in rows] == ["sponsors", "references"]
    assert rows[0]["data"]["sponsors_hidden"][0]["name"] == "Pause GmbH"
    assert rows[1]["data"]["references_renamed"] == [{"id": "r-1", "title": "Alt"}]

    assert await migrations.migrate_one_hide_field(flow.db) == "0 sponsors hidden, 0 contract statuses cleared, 1 references renamed"
    assert (await flow.db.references.find_one({"id": "r-1"}))["status"] == "completed"


def test_the_migration_is_registered_with_the_next_free_number():
    versions = [row[0] for row in migrations.MIGRATIONS]
    assert versions == sorted(set(versions))
    assert (21, "one_hide_field", migrations.migrate_one_hide_field) in migrations.MIGRATIONS


@pytest.mark.asyncio
async def test_sponsors_and_references_have_one_switch_left(flow):
    await editor(flow)
    created = (await flow.post("/api/sponsors", json={"name": "Probe", "contract_status": "paused"})).json()
    assert "contract_status" not in created and created["effective_status"] == "active", "alte Oberfläche: der Wert wirkt nicht mehr"
    refused = await flow.post("/api/references", json={"title": "Alt", "status": "archived"})
    assert refused.status_code == 422


# ---------------------------------------------------------------- Archivierter Partner bleibt verknüpft

async def archived_partner(flow, pid="pa"):
    await flow.db.partners.insert_one({"id": pid, "slug": pid, "name": f"Probe {pid}", "is_active": False})


@pytest.mark.asyncio
async def test_saving_a_reference_keeps_an_archived_partner_but_cannot_add_one(flow):
    await editor(flow)
    await flow.db.partners.insert_one({"id": "pa", "slug": "pa", "name": "Probe Verein", "is_active": True})
    ref = (await flow.post("/api/references", json={"title": "Cup", "partner_ids": ["pa"]})).json()
    assert ref["partner_ids"] == ["pa"]
    archived = await flow.patch("/api/partners/pa", json={"is_active": False})
    assert archived.json()["is_active"] is False

    saved = await flow.patch(f"/api/references/{ref['id']}", json={"title": "Cup 2", "partner_ids": ["pa"]})
    assert saved.json()["partner_ids"] == ["pa"], "Verknüpfung weg"
    assert saved.json()["partners"] == [], "nach außen kein archivierter Partner"
    refused = await flow.delete("/api/partners/pa")
    assert refused.status_code == 409 and "1 Referenz" in refused.json()["detail"]
    restored = await flow.patch("/api/partners/pa", json={"is_active": True})
    assert restored.status_code == 200
    assert [partner["id"] for partner in (await flow.get(f"/api/references/{ref['id']}")).json()["partners"]] == ["pa"]

    await archived_partner(flow, "pb")
    added = await flow.patch(f"/api/references/{ref['id']}", json={"partner_ids": ["pa", "pb", "gibt-es-nicht"]})
    assert added.json()["partner_ids"] == ["pa"], "neu dazu nur aktive"
    other = await flow.post("/api/references", json={"title": "Neu", "partner_ids": ["pb"]})
    assert other.json()["partner_ids"] == []


@pytest.mark.asyncio
async def test_events_tournaments_and_series_keep_an_archived_partner(flow):
    await editor(flow)
    admin = await flow.add_user(role="superadmin", name="alles")
    flow.act_as(admin)
    await archived_partner(flow)
    await archived_partner(flow, "pb")
    await flow.db.events.insert_one({"id": "e-1", "slug": "e-1", "name": "LAN", "status": "scheduled", "partner_ids": ["pa"]})
    event = await flow.patch("/api/events/e-1", json={"partner_ids": ["pa", "pb"]})
    assert event.status_code == 200, event.text
    assert event.json()["partner_ids"] == ["pa"]

    await flow.create_tournament(id="t-1", slug="t-1", partner_ids=["pa"])
    tournament = await flow.patch("/api/tournaments/t-1", json={"partner_ids": ["pa", "pb"]})
    assert tournament.status_code == 200, tournament.text
    assert (await flow.db.tournaments.find_one({"id": "t-1"}))["partner_ids"] == ["pa"]

    await flow.db.reference_lineages.insert_one({"id": "l-1", "slug": "l-1", "title": "Spur", "kind": "series", "partner_ids": ["pa"], "partner_roles": {"pa": "organizer"}})
    lineage = await flow.patch("/api/reference-series/admin/lineages/l-1", json={"partner_ids": ["pa", "pb"]})
    assert lineage.status_code == 200, lineage.text
    stored = await flow.db.reference_lineages.find_one({"id": "l-1"})
    assert stored["partner_ids"] == ["pa"] and stored["partner_roles"] == {"pa": "organizer"}

    await flow.db.reference_series.insert_one({"id": "s-1", "lineage_id": "l-1", "season": "2026", "season_slug": "2026", "status": "planned", "partner_ids": ["pa"], "partner_roles": {"pa": "contributor"}})
    series = await flow.patch("/api/reference-series/admin/series/s-1", json={"partner_ids": ["pa", "pb"]})
    assert series.status_code == 200, series.text
    assert (await flow.db.reference_series.find_one({"id": "s-1"}))["partner_ids"] == ["pa"]


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
    removed = await flow.delete(f"/api/sponsors/{sid}")
    assert removed.status_code == 200, removed.text
    rows = await audit(flow, "sponsor.delete")
    assert len(rows) == 1 and rows[0]["data"]["name"] == "Probe GmbH"
    removed = await flow.delete(f"/api/sponsors/{sid}")
    assert removed.status_code == 404, removed.text


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
    removed = await flow.delete(f"/api/partners/{pid}")
    assert removed.status_code == 200, removed.text
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
    removed = await flow.delete(f"/api/references/{rid}")
    assert removed.status_code == 200, removed.text
    assert (await audit(flow, "reference.delete"))[0]["data"]["name"] == "Probe Cup"
    removed = await flow.delete(f"/api/references/{rid}")
    assert removed.status_code == 404, removed.text
