"""Eigene Daten und Austritt (#329 Teil 2): nur mit Bindung und Fähigkeit „profile“; Änderungen nennen den
gesehenen Stand (sonst 409), sofort übernommene Felder stehen gleich im Profil, der Rest liegt beim Vorstand;
derselbe Inhalt noch einmal ist derselbe Auftrag; den letzten Tag des Austritts rechnet der Verein."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from dolibarr_fake import API_KEY, BASE_URL, FakeDolibarr, member  # noqa: E402
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


async def paula_bound(flow, fake, capabilities=("documents", "profile")):
    fake.add(member(12), email="paula@example.test")
    fake.invite("CODE", 12, capabilities=capabilities)
    paula = await flow.add_user(role="player", name="paula")
    paula["is_club_member"] = True
    flow.act_as(paula)
    assert (await flow.post("/api/membership/me/identity", json={"code": "CODE"})).json()["status"] == "bound"
    return paula


@pytest.mark.asyncio
async def test_own_data_change_and_exit_run_through_the_binding(flow, fake):
    await connect(flow)
    fake.add(member(12), email="paula@example.test")
    paula = await flow.add_user(role="player", name="paula")
    paula["is_club_member"] = True
    flow.act_as(paula)
    assert (await flow.get("/api/membership/me/self-service")).json()["reason"] == "not_bound"
    denied = await flow.post("/api/membership/me/self-service/changes", json={"version": "v1", "changes": {"phone": "1"}})
    assert denied.status_code == 403 and "Einladungscode" in denied.json()["detail"]

    # Nur Dokumente erlaubt: der Grund steht da, nichts geht raus.
    fake.invite("DOCS", 12, capabilities=("documents",))
    assert (await flow.post("/api/membership/me/identity", json={"code": "DOCS"})).json()["status"] == "bound"
    assert (await flow.get("/api/membership/me/self-service")).json()["reason"] == "no_capability"
    assert (await flow.post("/api/membership/me/self-service/changes", json={"version": "v1", "changes": {"phone": "1"}})).status_code == 409

    # Neue Bindung mit „profile“: die eigenen Daten, Geburtsdatum nur lesend, noch keine Einreichung.
    fake.revoke_identity(paula["id"])
    fake.invite("ALL", 12, capabilities=("documents", "profile"))
    assert (await flow.post("/api/membership/me/identity", json={"code": "ALL"})).json()["capabilities"] == ["documents", "profile"]
    view = (await flow.get("/api/membership/me/self-service")).json()
    assert view["available"] is True and view["profile"]["firstname"] == "Paula" and view["profile"]["birth"] == "1990-05-04"
    assert view["profile"]["version"] == "v1" and view["profile"]["exit"] is None and view["profile"]["direct"] == ["phone", "phone_mobile"]
    assert view["changeable"] == ["address", "zip", "town", "country_code", "phone", "phone_mobile", "email"] and view["requests"] == []
    assert "birth" not in view["changeable"]

    # Mobilnummer: übernimmt der Verein sofort - Profil neu, Stand neu.
    applied = (await flow.post("/api/membership/me/self-service/changes", json={"version": "v1", "changes": {"phone_mobile": " +43 660 1234567 "}})).json()
    assert applied["status"] == "applied" and applied["status_label"] == "übernommen" and applied["kind"] == "change"
    view = (await flow.get("/api/membership/me/self-service")).json()
    assert view["profile"]["phone_mobile"] == "+43 660 1234567" and view["profile"]["version"] == "v2" and len(view["requests"]) == 1

    # Adresse: mit altem Stand 409, mit neuem Stand beim Vorstand; derselbe Inhalt noch einmal = derselbe Auftrag.
    stale = await flow.post("/api/membership/me/self-service/changes", json={"version": "v1", "changes": {"address": "Neue Gasse 2"}})
    assert stale.status_code == 409 and "inzwischen geändert" in stale.json()["detail"]
    change = {"version": "v2", "changes": {"address": "Neue Gasse 2", "zip": "6020", "town": "Innsbruck"}}
    received = (await flow.post("/api/membership/me/self-service/changes", json=change)).json()
    assert received["status"] == "received" and received["status_label"] == "beim Vorstand" and received["changes"]["town"] == "Innsbruck"
    again = (await flow.post("/api/membership/me/self-service/changes", json=change)).json()
    assert again["external_id"] == received["external_id"]
    view = (await flow.get("/api/membership/me/self-service")).json()
    assert len(view["requests"]) == 2 and view["profile"]["address"] == "Teststraße 1", "beim Vorstand heißt: noch nicht übernommen"

    # Was nicht geht: fremde Felder, nichts, kein Stand.
    assert (await flow.post("/api/membership/me/self-service/changes", json={"version": "v2", "changes": {"lastname": "X"}})).status_code == 400
    assert (await flow.post("/api/membership/me/self-service/changes", json={"version": "v2", "changes": {}})).status_code == 400
    assert (await flow.post("/api/membership/me/self-service/changes", json={"version": "", "changes": {"phone": "1"}})).status_code == 400

    # Austritt: Wunsch vor der Frist wird nicht übernommen, der Verein rechnet den letzten Tag; zweimal geht nicht.
    assert (await flow.post("/api/membership/me/self-service/exit", json={"wished_last_day": "1.10.2026"})).status_code == 400
    exit_row = (await flow.post("/api/membership/me/self-service/exit", json={"wished_last_day": "2026-10-01"})).json()
    assert exit_row["kind"] == "exit" and exit_row["last_day"] == "2026-12-31" and exit_row["wished_too_early"] is True and exit_row["notice_day"] == "2026-09-24"
    view = (await flow.get("/api/membership/me/self-service")).json()
    assert view["profile"]["exit"] == {"status": "planned", "reason": "", "notice_day": "2026-09-24", "last_day": "2026-12-31"}
    twice = await flow.post("/api/membership/me/self-service/exit", json={})
    assert twice.status_code == 409 and "schon geplant" in twice.json()["detail"]
    assert [row["kind"] for row in view["requests"]] == ["change", "change", "exit"]


@pytest.mark.asyncio
async def test_a_revoked_binding_closes_the_self_service(flow, fake):
    await connect(flow)
    paula = await paula_bound(flow, fake)
    assert (await flow.get("/api/membership/me/self-service")).json()["available"] is True
    fake.revoke_identity(paula["id"])
    view = (await flow.get("/api/membership/me/self-service")).json()
    assert view["available"] is False and view["reason"] == "not_bound"
    assert (await flow.get("/api/membership/me/identity")).json()["status"] == "revoked"
    assert (await flow.post("/api/membership/me/self-service/exit", json={})).status_code == 403
