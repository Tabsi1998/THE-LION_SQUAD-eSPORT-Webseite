"""Meine Einwilligungen (#329, Teil 1): ein Mitglied mit bestätigter Zuordnung sieht den Stand je Zweck
aus Dolibarr (erteilte und aktuelle Textfassung), stimmt nur mit der gezeigten Fassung zu, widerruft
jederzeit; jede Entscheidung geht mit fester Vorgangskennung nach Dolibarr und wird nie lokal als
zweite Wahrheit geführt. Ohne Zuordnung oder ohne Anbindung gibt es nichts zu entscheiden."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from dolibarr_fake import API_KEY, BASE_URL, FakeDolibarr, member  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from services import dolibarr_client  # noqa: E402
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
    monkeypatch.setattr(dolibarr_client, "_transport", instance.transport())
    monkeypatch.setattr(dolibarr_client, "RETRY_PAUSES", (0, 0))
    return instance


async def connect(flow, mode="live"):
    await flow.db.settings.update_one({"id": "dolibarr"}, {"$set": {
        "id": "dolibarr", "mode": mode, "environment": "production", "base_url": BASE_URL, "api_key": encrypt_secret(API_KEY),
        "instance": "verein", "entity": 1, "type_map": {"2": "ordinary"},
    }}, upsert=True)


async def linked_member(flow, fake, name, member_id):
    fake.add(member(member_id), email=f"{name}@example.test")
    user = await flow.add_user(role="player", name=name)
    settings = await dolibarr_client.load_settings(flow.db)
    await verify_link(flow.db, settings, user_id=user["id"], member_id=member_id, member_ref=str(member_id), source="admin", actor_id="admin")
    return user


@pytest.mark.asyncio
async def test_member_sees_gives_and_withdraws_consents_only_with_the_shown_version(flow, fake):
    await connect(flow)
    fake.consent_texts.append({"code": "newsletter", "label": "Newsletter", "version": 1, "text": "Ich möchte den Newsletter bekommen."})
    fake.member_consents[12] = {"fotos": {"state": "given", "version": 1, "moment": "2026-01-10T10:00:00+01:00"}}
    paula = await linked_member(flow, fake, "paula", 12)
    flow.act_as(paula)

    mine = (await flow.get("/api/membership/me/consents")).json()
    assert mine["available"] is True
    by_code = {row["code"]: row for row in mine["consents"]}
    fotos = by_code["fotos"]
    assert fotos["state"] == "given" and fotos["version"] == 1 and fotos["current_version"] == 2 and fotos["text_changed"] is True
    assert fotos["can_give"] is True and fotos["can_withdraw"] is True and fotos["text"] == fake.consent_texts[0]["text"], "neue Fassung: Text zum Nachlesen"
    newsletter = by_code["newsletter"]
    assert newsletter["state"] == "none" and newsletter["can_give"] is True and newsletter["can_withdraw"] is False and newsletter["text"] == "Ich möchte den Newsletter bekommen."

    # Zustimmen nur mit der gezeigten Fassung - eine alte wird abgewiesen, ohne etwas zu speichern.
    old = await flow.post("/api/membership/me/consents", json={"code": "newsletter", "decision": "given", "version": 0})
    assert old.status_code == 400
    assert (await flow.post("/api/membership/me/consents", json={"code": "fotos", "decision": "given", "version": 1})).status_code == 400
    assert fake.member_consents[12]["fotos"]["version"] == 1
    given = await flow.post("/api/membership/me/consents", json={"code": "newsletter", "decision": "given", "version": 1})
    assert given.status_code == 200, given.text
    assert given.json()["result"] == {"code": "newsletter", "state": "given", "version": 1, "recorded": True}
    assert {row["code"]: row["state"] for row in given.json()["consents"]} == {"fotos": "given", "newsletter": "given"}
    sent = fake.calls[-2]
    assert sent[0] == "/vereine/members/12/consents"
    stored = await flow.db.consent_decisions.find_one({"user_id": paula["id"], "code": "newsletter"}, {"_id": 0})
    assert stored["status"] == "recorded" and stored["reference"].startswith("web-c-") and stored["reference"] in fake.consent_references
    assert await flow.db.audit_logs.count_documents({"action": "consent.given", "target_id": paula["id"]}) == 1

    # Neue Fassung der Foto-Einwilligung annehmen, dann widerrufen - Widerruf braucht keine Fassung.
    assert (await flow.post("/api/membership/me/consents", json={"code": "fotos", "decision": "given", "version": 2})).json()["result"]["version"] == 2
    withdrawn = await flow.post("/api/membership/me/consents", json={"code": "fotos", "decision": "withdrawn"})
    assert withdrawn.status_code == 200 and withdrawn.json()["result"]["state"] == "withdrawn"
    fotos = next(row for row in withdrawn.json()["consents"] if row["code"] == "fotos")
    assert fotos["state"] == "withdrawn" and fotos["can_withdraw"] is False and fotos["can_give"] is True and fotos["text_changed"] is False
    assert fake.member_consents[12]["fotos"]["state"] == "withdrawn"

    # Ausfall: nichts geändert, ehrliche Antwort, der Auftrag steht als gescheitert da.
    fake.fail_with = 503
    outage = await flow.post("/api/membership/me/consents", json={"code": "newsletter", "decision": "withdrawn"})
    assert outage.status_code == 503 and "nichts geändert" in outage.json()["detail"]
    assert fake.member_consents[12]["newsletter"]["state"] == "given"
    assert await flow.db.consent_decisions.count_documents({"user_id": paula["id"], "status": "failed", "error": "unavailable"}) == 1
    # Von den zwei alten Fassungen oben ging nur eine bis Dolibarr (Fassung 0 hielt die Website selbst auf).
    assert await flow.db.consent_decisions.count_documents({"user_id": paula["id"], "status": "failed", "error": "bad_request"}) == 1
    listed = (await flow.get("/api/membership/me/consents")).json()
    assert listed["available"] is False and listed["reason"] == "unavailable"


@pytest.mark.asyncio
async def test_without_link_or_connection_there_is_nothing_to_decide_and_nobody_acts_for_others(flow, fake):
    await connect(flow)
    fake.add(member(12), email="paula@example.test")
    stranger = await flow.add_user(role="player", name="fremd")
    flow.act_as(stranger)
    assert (await flow.get("/api/membership/me/consents")).json() == {"available": False, "reason": "not_linked"}
    assert (await flow.post("/api/membership/me/consents", json={"code": "fotos", "decision": "given", "version": 2})).status_code == 409
    assert fake.member_consents == {}, "ohne Zuordnung entscheidet niemand für ein Mitglied"

    paula = await linked_member(flow, fake, "paula", 13)
    await connect(flow, mode="preview")
    flow.act_as(paula)
    assert (await flow.get("/api/membership/me/consents")).json() == {"available": False, "reason": "not_connected"}
    assert (await flow.post("/api/membership/me/consents", json={"code": "fotos", "decision": "withdrawn"})).status_code == 409
    assert (await flow.post("/api/membership/me/consents", json={"code": "fotos", "decision": "given"})).status_code == 409
    assert not [call for call in fake.calls if call[0].endswith("/consents")]
