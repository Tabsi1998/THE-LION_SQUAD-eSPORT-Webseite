"""Vereinsakte verbinden (#324 Teil 1): ein Mitglied löst einen Einladungscode ein und sieht danach seine
eigenen Unterlagen aus der Vereinsakte in den Vereinsdokumenten; ohne Bindung nur die öffentlichen; das PDF
kommt über denselben Weg wie eigene Dateien und nur, wenn die Bytes zur Prüfsumme passen. Ein Widerruf im
Modul wirkt beim nächsten Abruf."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from dolibarr_fake import API_KEY, BASE_URL, FakeDolibarr, document_pdf_bytes, member  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from services import dolibarr_client, dolibarr_identity  # noqa: E402
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
    monkeypatch.setattr(dolibarr_client, "_transport", instance.transport())
    monkeypatch.setattr(dolibarr_client, "RETRY_PAUSES", (0, 0))
    dolibarr_identity.reset_cache()
    return instance


async def connect(flow, mode="live"):
    await flow.db.settings.update_one({"id": "dolibarr"}, {"$set": {
        "id": "dolibarr", "mode": mode, "environment": "production", "base_url": BASE_URL, "api_key": encrypt_secret(API_KEY),
        "instance": "verein", "entity": 1, "type_map": {"2": "ordinary"},
    }}, upsert=True)


def publish_examples(fake):
    fake.add(member(12), email="paula@example.test")
    fake.invite("LION-1234", 12)
    fake.publish(1, title="Statuten 2026", kind="statute", audience="public")
    fake.publish(2, title="Protokoll Generalversammlung 2026", kind="minutes", audience="members")
    fake.publish(3, title="Beitrittsbestätigung Paula", kind="letter", audience="person", member_id=12)
    fake.publish(4, title="Beitrittsbestätigung Max", kind="letter", audience="person", member_id=13)


async def club_member(flow, name):
    user = await flow.add_user(role="player", name=name)
    user["is_club_member"] = True
    return user


@pytest.mark.asyncio
async def test_member_binds_with_an_invitation_code_and_sees_own_documents(flow, fake):
    await connect(flow)
    publish_examples(fake)
    paula = await club_member(flow, "paula")
    flow.act_as(paula)

    # Vor der Bindung: Stand „none“, in den Vereinsdokumenten nur das Öffentliche aus der Akte.
    assert (await flow.get("/api/membership/me/identity")).json() == {"available": True, "status": "none", "capabilities": []}
    assert [d["id"] for d in (await flow.get("/api/documents")).json()] == ["dolibarr-1"]

    bad = await flow.post("/api/membership/me/identity", json={"code": "FALSCH"})
    assert bad.status_code == 403 and "Code" in bad.json()["detail"]
    assert (await flow.post("/api/membership/me/identity", json={"code": "  "})).status_code == 400

    bound = (await flow.post("/api/membership/me/identity", json={"code": "LION-1234"})).json()
    assert bound["status"] == "bound" and bound["capabilities"] == ["documents"] and bound["capability_labels"] == ["Dokumente"] and bound["linked_at"]
    assert fake.invitations["LION-1234"]["used"] is True
    assert (await flow.post("/api/membership/me/identity", json={"code": "LION-1234"})).status_code == 409
    stored = await flow.db.dolibarr_identities.find_one({"user_id": paula["id"]}, {"_id": 0})
    assert stored["subject"] == paula["id"] and stored["member_id"] == 12 and stored["instance"] == "verein:1"

    docs = (await flow.get("/api/documents")).json()
    assert [d["id"] for d in docs] == ["dolibarr-1", "dolibarr-2", "dolibarr-3"], "das fremde persönliche Dokument fehlt"
    letter = next(d for d in docs if d["id"] == "dolibarr-3")
    assert letter["source"] == "dolibarr" and letter["category"] == "letter" and letter["personal"] is True
    assert letter["view_url"] == "/api/documents/dolibarr-3/view" and letter["mime"] == "application/pdf" and letter["allow_download"] is True
    assert "unterschrieben" in letter["description"] and "nur für dich" in letter["description"] and "sha256" not in letter
    assert [d["id"] for d in (await flow.get("/api/documents?category=minutes")).json()] == ["dolibarr-2"]

    # Das PDF über den gemeinsamen Weg - Ansehen und Herunterladen.
    pdf = await flow.get("/api/documents/dolibarr-3/view")
    assert pdf.status_code == 200 and pdf.headers["content-type"].startswith("application/pdf") and pdf.content == document_pdf_bytes(3)
    assert pdf.headers["content-disposition"].startswith("inline;") and "DOC03-1.pdf" in pdf.headers["content-disposition"]
    download = await flow.get("/api/documents/dolibarr-2/download")
    assert download.status_code == 200 and download.headers["content-disposition"].startswith("attachment;")
    assert (await flow.get("/api/documents/dolibarr-4/view")).status_code == 404, "fremde Unterlagen: 404, nicht 403"
    assert (await flow.get("/api/documents/dolibarr-99/download")).status_code == 404
    fake.tampered_document_ids.add(2)
    assert (await flow.get("/api/documents/dolibarr-2/view")).status_code == 502

    # Gast und Nicht-Mitglied sehen nichts aus der Akte.
    flow.act_as(None)
    assert (await flow.get("/api/documents/dolibarr-1/view")).status_code == 403
    flow.act_as(await flow.add_user(role="player", name="gast"))
    assert (await flow.get("/api/documents")).json() == []
    assert (await flow.get("/api/documents/dolibarr-1/view")).status_code == 403


@pytest.mark.asyncio
async def test_a_revoked_binding_falls_back_to_public_documents_until_a_new_code(flow, fake):
    await connect(flow)
    publish_examples(fake)
    paula = await club_member(flow, "paula")
    flow.act_as(paula)
    assert (await flow.post("/api/membership/me/identity", json={"code": "LION-1234"})).json()["status"] == "bound"
    assert len((await flow.get("/api/documents")).json()) == 3

    fake.revoke_identity(paula["id"])
    dolibarr_identity.reset_cache()
    assert [d["id"] for d in (await flow.get("/api/documents")).json()] == ["dolibarr-1"]
    state = (await flow.get("/api/membership/me/identity")).json()
    assert state["status"] == "revoked" and state["revoked_at"]
    assert (await flow.get("/api/documents/dolibarr-3/view")).status_code == 404

    fake.invite("LION-NEU", 12)
    assert (await flow.post("/api/membership/me/identity", json={"code": "LION-NEU"})).json()["status"] == "bound"
    assert len((await flow.get("/api/documents")).json()) == 3


@pytest.mark.asyncio
async def test_without_the_right_or_without_live_mode_the_code_cannot_be_used(flow, fake):
    await connect(flow)
    publish_examples(fake)
    fake.identity_right = False
    paula = await club_member(flow, "paula")
    flow.act_as(paula)
    denied = await flow.post("/api/membership/me/identity", json={"code": "LION-1234"})
    assert denied.status_code == 403 and "für Personen handeln" in denied.json()["detail"]
    assert fake.invitations["LION-1234"]["used"] is False

    await connect(flow, mode="preview")
    assert (await flow.get("/api/membership/me/identity")).json() == {"available": False, "status": "none", "capabilities": []}
    assert (await flow.post("/api/membership/me/identity", json={"code": "LION-1234"})).status_code == 409
    assert (await flow.get("/api/documents")).json() == []
