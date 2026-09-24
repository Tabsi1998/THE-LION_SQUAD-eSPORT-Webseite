"""Vereinsakte ohne Einladungscode (#531): ab Vereine 1.4.0 reicht die bestätigte Zuordnung des Kontos - die Website
ruft die Akte mit der Mitgliedsnummer auf (member_id statt subject). Fehlt dem API-Benutzer das Recht, sieht das
Mitglied das Öffentliche und der Admin unter Stand, was fehlt; mit älterem Modul bleibt der Einladungscode der Weg."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from dolibarr_fake import API_KEY, BASE_URL, FakeDolibarr, document_pdf_bytes, member  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from services import dolibarr_client, dolibarr_identity  # noqa: E402
from services.dolibarr_links import verify_link  # noqa: E402
from services.secret_store import encrypt_secret  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def fake(monkeypatch):
    instance = FakeDolibarr()
    instance.module_version = "1.4.0"
    monkeypatch.setattr(dolibarr_client, "_transport", instance.transport())
    monkeypatch.setattr(dolibarr_client, "RETRY_PAUSES", (0, 0))
    dolibarr_identity.reset_cache()
    return instance


async def connect(flow, module_version="1.4.0"):
    await flow.db.settings.update_one({"id": "dolibarr"}, {"$set": {
        "id": "dolibarr", "mode": "live", "environment": "production", "base_url": BASE_URL, "api_key": encrypt_secret(API_KEY),
        "instance": "verein", "entity": 1, "type_map": {"2": "ordinary"},
    }}, upsert=True)
    # Die Modulversion kennt die Website aus dem letzten Abgleich oder Verbindungstest.
    await flow.db.settings.update_one({"id": "dolibarr_sync_state"}, {"$set": {"id": "dolibarr_sync_state", "module_version": module_version}}, upsert=True)


def publish(fake):
    fake.publish(1, title="Statuten 2026", kind="statute", audience="public")
    fake.publish(2, title="Protokoll Generalversammlung 2026", kind="minutes", audience="members")
    fake.publish(3, title="Beitrittsbestätigung Paula", kind="letter", audience="person", member_id=12)
    fake.publish(4, title="Beitrittsbestätigung Max", kind="letter", audience="person", member_id=13)
    fake.statutes_public = False


async def linked_member(flow, fake, name="paula", member_id=12):
    """Ein Konto, das der Vorstand seinem Mitgliedseintrag zugeordnet hat - ohne jede Bindung per Code."""
    fake.add(member(member_id), email=f"{name}@example.test")
    user = await flow.add_user(role="player", name=name)
    user["is_club_member"] = True
    settings = await dolibarr_client.load_settings(flow.db)
    await verify_link(flow.db, settings, user_id=user["id"], member_id=member_id, member_ref=str(member_id), source="admin", actor_id="admin")
    return user


def doc_ids(response):
    return [d["id"] for d in response.json()]


@pytest.mark.asyncio
async def test_a_linked_account_sees_its_file_without_a_code(flow, fake):
    await connect(flow)
    publish(fake)
    paula = await linked_member(flow, fake)
    flow.act_as(paula)

    state = (await flow.get("/api/membership/me/identity")).json()
    assert state["status"] == "bound" and state["via"] == "member" and state["member_ref"] == "12" and state["linked"] is True
    assert "documents" in state["capabilities"] and "profile" in state["capabilities"] and state["right_missing"] is False
    assert await flow.db.dolibarr_identities.count_documents({}) == 0, "keine Bindung nötig"

    # Unterlagen: die eigenen dabei, die fremden nicht; das PDF über den gemeinsamen Weg.
    assert doc_ids(await flow.get("/api/documents")) == ["dolibarr-1", "dolibarr-2", "dolibarr-3"]
    pdf = await flow.get("/api/documents/dolibarr-3/view")
    assert pdf.status_code == 200 and pdf.content == document_pdf_bytes(3)
    assert (await flow.get("/api/documents/dolibarr-4/view")).status_code == 404

    # Eigene Daten und Änderung laufen ohne Fähigkeit aus einer Einladung - das Recht liegt beim API-Benutzer.
    view = (await flow.get("/api/membership/me/self-service")).json()
    assert view["available"] is True and view["profile"]["firstname"] == "Paula" and view["profile"]["version"] == "v1"
    applied = (await flow.post("/api/membership/me/self-service/changes", json={"version": "v1", "changes": {"phone_mobile": "+43 660 1234567"}})).json()
    assert applied["status"] == "applied"
    assert "m12" in fake.profile_requests, "der Aufruf lief über die Mitgliedsnummer"
    assert (await flow.get("/api/membership/me/website-profile")).status_code == 200


@pytest.mark.asyncio
async def test_without_the_right_the_member_sees_public_and_the_admin_sees_why(flow, fake):
    await connect(flow)
    publish(fake)
    fake.members_act_right = False
    paula = await linked_member(flow, fake)
    flow.act_as(paula)

    assert doc_ids(await flow.get("/api/documents")) == ["dolibarr-1"], "ohne Recht nur das Öffentliche"
    state = (await flow.get("/api/membership/me/identity")).json()
    assert state["via"] == "member" and state["right_missing"] is True
    view = (await flow.get("/api/membership/me/self-service")).json()
    assert view["available"] is False and view["reason"] == "right_missing" and "im Namen jedes Mitglieds handeln" in view["text"]
    denied = await flow.post("/api/membership/me/self-service/changes", json={"version": "v1", "changes": {"phone": "1"}})
    assert denied.status_code == 403 and "im Namen jedes Mitglieds handeln" in denied.json()["detail"]
    assert (await flow.get("/api/documents/dolibarr-3/view")).status_code == 404

    # Der Admin sieht unter Stand, was fehlt.
    flow.act_as(await flow.add_user(role="club_admin", name="chef"))
    feature = next(f for f in (await flow.get("/api/admin/dolibarr/status")).json()["features"] if f["key"] == "member_access")
    assert feature["enabled"] is False and feature["state"].startswith("Recht fehlt") and "im Namen jedes Mitglieds handeln" in feature["hint"]

    # Recht gesetzt: beim nächsten Abruf ist alles da, die Störung ist vorbei.
    fake.members_act_right = True
    dolibarr_identity.reset_cache()
    flow.act_as(paula)
    assert doc_ids(await flow.get("/api/documents")) == ["dolibarr-1", "dolibarr-2", "dolibarr-3"]
    assert (await flow.get("/api/membership/me/identity")).json()["right_missing"] is False
    flow.act_as(await flow.add_user(role="club_admin", name="chefin"))
    feature = next(f for f in (await flow.get("/api/admin/dolibarr/status")).json()["features"] if f["key"] == "member_access")
    assert feature["enabled"] is True and feature["state"].startswith("an")


@pytest.mark.asyncio
async def test_an_old_module_keeps_the_invitation_code_path(flow, fake):
    await connect(flow, module_version="1.2.0")
    fake.module_version = "1.2.0"
    publish(fake)
    paula = await linked_member(flow, fake)
    flow.act_as(paula)

    state = (await flow.get("/api/membership/me/identity")).json()
    assert state["status"] == "none" and state["linked"] is True and state["module_too_old"] is True and state["member_ref"] == "12"
    assert doc_ids(await flow.get("/api/documents")) == ["dolibarr-1"]
    assert (await flow.get("/api/membership/me/self-service")).json()["reason"] == "not_bound"

    fake.invite("LION-1234", 12, capabilities=("documents", "profile"))
    bound = (await flow.post("/api/membership/me/identity", json={"code": "LION-1234"})).json()
    assert bound["status"] == "bound" and bound["via"] == "code" and bound["module_too_old"] is True
    assert doc_ids(await flow.get("/api/documents")) == ["dolibarr-1", "dolibarr-2", "dolibarr-3"]
    assert (await flow.get("/api/membership/me/self-service")).json()["available"] is True

    # Modul aktualisiert: die Zuordnung übernimmt, die alte Bindung stört nicht.
    await flow.db.settings.update_one({"id": "dolibarr_sync_state"}, {"$set": {"module_version": "1.4.0"}})
    fake.module_version = "1.4.0"
    dolibarr_identity.reset_cache()
    assert (await flow.get("/api/membership/me/identity")).json()["via"] == "member"
    assert doc_ids(await flow.get("/api/documents")) == ["dolibarr-1", "dolibarr-2", "dolibarr-3"]

    # Und der Verbindungstest merkt sich die Modulversion selbst.
    flow.act_as(await flow.add_user(role="club_admin", name="chef"))
    await flow.db.settings.update_one({"id": "dolibarr_sync_state"}, {"$unset": {"module_version": ""}})
    assert (await flow.post("/api/admin/dolibarr/test")).json()["module_version"] == "1.4.0"
    assert (await flow.db.settings.find_one({"id": "dolibarr_sync_state"}))["module_version"] == "1.4.0"
