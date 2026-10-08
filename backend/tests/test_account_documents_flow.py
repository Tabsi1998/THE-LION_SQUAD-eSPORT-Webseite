"""Persönliche Unterlagen (#1255): die eigenen Schreiben aus der Vereinsakte stehen im Profil unter „Nur für dich“
(/api/account/documents), die Vereinsdokumente sind für alle Mitglieder gleich (/api/documents?scope=club). Ohne scope
bleibt die gemischte Liste - ältere App-Versionen sehen ihre Unterlagen weiter."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from dolibarr_fake import API_KEY, BASE_URL, FakeDolibarr, member, pin_club_clock  # noqa: E402
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
    pin_club_clock(monkeypatch)
    return instance


async def connect(flow):
    await flow.db.settings.update_one({"id": "dolibarr"}, {"$set": {
        "id": "dolibarr", "mode": "live", "environment": "production", "base_url": BASE_URL, "api_key": encrypt_secret(API_KEY),
        "instance": "verein", "entity": 1, "type_map": {"2": "ordinary"},
    }}, upsert=True)


def seed(fake: FakeDolibarr) -> None:
    fake.add(member(12), email="mira@example.test")
    fake.add(member(13), email="ole@example.test")
    fake.statutes_public = False
    fake.publish(21, title="Protokoll Generalversammlung", audience="members")
    fake.publish(22, title="Beitrittsbestätigung Mira", kind="letter", audience="person", member_id=12, date="2026-03-02T10:00:00+00:00")
    fake.publish(23, title="Spendenbestätigung Mira", kind="letter", audience="person", member_id=12, date="2026-09-01T10:00:00+00:00")
    fake.publish(24, title="Beitrittsbestätigung Ole", kind="letter", audience="person", member_id=13)


async def bind(flow, code: str) -> None:
    response = await flow.post("/api/membership/me/identity", json={"code": code})
    assert response.status_code == 200 and response.json()["status"] == "bound", response.text


@pytest.mark.asyncio
async def test_own_documents_only_the_own_letters_and_club_list_without_them(flow, fake):
    await connect(flow)
    seed(fake)
    await flow.db.documents.insert_one({"id": "d-ordnung", "title": "Hausordnung", "visibility": "members", "category": "regulations"})
    mira = await flow.add_user(role="player", name="mira")
    mira["is_club_member"] = True
    flow.act_as(mira)

    # Ohne Bindung: keine eigenen Unterlagen - und der Grund dazu.
    own = (await flow.get("/api/account/documents")).json()
    assert own["available"] is True and own["reason"] == "not_bound" and own["documents"] == [] and "Vereinsakte" in own["text"]

    fake.invite("DOCS", 12, capabilities=("documents",))
    await bind(flow, "DOCS")
    own = (await flow.get("/api/account/documents")).json()
    assert own["available"] is True and own["reason"] is None
    assert [doc["title"] for doc in own["documents"]] == ["Spendenbestätigung Mira", "Beitrittsbestätigung Mira"], "nur die eigenen, neueste zuerst"
    assert all(doc["personal"] and doc["view_url"].startswith("/api/documents/dolibarr-") for doc in own["documents"])

    # Die Vereinsdokumente: für alle gleich, ohne persönliche Schreiben.
    club = (await flow.get("/api/documents", params={"scope": "club"})).json()
    assert {doc["title"] for doc in club} == {"Hausordnung", "Protokoll Generalversammlung"}
    # Ohne scope wie bisher (ältere App-Versionen): gemischt - aber nie die Unterlagen anderer.
    mixed = {doc["title"] for doc in (await flow.get("/api/documents")).json()}
    assert mixed == {"Hausordnung", "Protokoll Generalversammlung", "Beitrittsbestätigung Mira", "Spendenbestätigung Mira"}
    assert (await flow.get("/api/documents", params={"scope": "alles"})).status_code == 422

    # Öffnen geht wie bisher über die Adresse des Dokuments - das Modul prüft bei jedem Abruf neu.
    first = own["documents"][0]
    opened = await flow.get(first["view_url"])
    assert opened.status_code == 200 and opened.headers["content-type"].startswith("application/pdf")

    # Die Akte antwortet nicht: das wird gesagt, statt einer leeren Liste.
    dolibarr_identity.reset_cache()
    fake.fail_with = 503
    down = (await flow.get("/api/account/documents")).json()
    assert down["available"] is False and down["reason"] == "unreachable" and down["documents"] == [] and "später" in down["text"]


@pytest.mark.asyncio
async def test_own_documents_for_non_members_and_without_dolibarr(flow, fake):
    guest = await flow.add_user(role="player", name="gast")
    flow.act_as(guest)
    own = (await flow.get("/api/account/documents")).json()
    assert own == {"available": False, "reason": "not_member", "text": "Unterlagen aus der Vereinsakte gibt es für Vereinsmitglieder.", "documents": []}
    # Moderation allein macht niemanden zum Mitglied (#1300).
    moderator = await flow.add_user(role="moderator", name="moderation")
    flow.act_as(moderator)
    assert (await flow.get("/api/account/documents")).json()["reason"] == "not_member"

    mira = await flow.add_user(role="player", name="mira")
    mira["is_club_member"] = True
    flow.act_as(mira)
    own = (await flow.get("/api/account/documents")).json()
    assert own["available"] is False and own["reason"] == "not_configured" and own["documents"] == []

    flow.act_as(None)
    assert (await flow.get("/api/account/documents")).status_code == 401
