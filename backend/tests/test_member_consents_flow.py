"""Meine Einwilligungen (#329, Teil 1): ein Mitglied mit bestätigter Zuordnung sieht den Stand je Zweck
aus Dolibarr (erteilte und aktuelle Textfassung), stimmt nur mit der gezeigten Fassung zu, widerruft
jederzeit; jede Entscheidung geht mit fester Vorgangskennung nach Dolibarr und wird nie lokal als
zweite Wahrheit geführt. Ohne Zuordnung oder ohne Anbindung gibt es nichts zu entscheiden."""
import asyncio
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from dolibarr_fake import API_KEY, BASE_URL, OPENAPI, FakeDolibarr, member  # noqa: E402
from flow_harness import InterleavedReads, make_flow  # noqa: E402
from pymongo.errors import DuplicateKeyError  # noqa: E402

import database  # noqa: E402
from routes import membership_routes  # noqa: E402
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
    monkeypatch.setattr(dolibarr_client, "_transport", instance.transport())
    monkeypatch.setattr(dolibarr_client, "RETRY_PAUSES", (0, 0))
    dolibarr_identity.reset_cache()
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

    # Ausfall: ehrliche Antwort, der Auftrag bleibt offen und geht beim nächsten Versuch mit derselben Kennung raus (#1537).
    fake.fail_with = 503
    outage = await flow.post("/api/membership/me/consents", json={"code": "newsletter", "decision": "withdrawn"})
    assert outage.status_code == 503 and "doppelt" in outage.json()["detail"]
    assert fake.member_consents[12]["newsletter"]["state"] == "given"
    assert await flow.db.consent_decisions.count_documents({"user_id": paula["id"], "status": "pending", "error": "unavailable"}) == 1
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


async def connect_module(flow, module_version="1.4.0"):
    """Anbindung mit bekannter Modulversion - ab 1.4.0 spricht die Website über die Mitgliedsnummer (#531)."""
    await connect(flow)
    await flow.db.settings.update_one({"id": "dolibarr_sync_state"}, {"$set": {"id": "dolibarr_sync_state", "module_version": module_version}}, upsert=True)


@pytest.mark.asyncio
async def test_own_consents_are_read_from_the_self_service_endpoint_of_the_module(flow, fake):
    """#1537: die eigenen Einwilligungen kommen über `/vereine/me/consents` - das Modul prüft selbst, für wen die Website
    spricht (Mitgliedsnummer mit dem Recht „im Namen der Mitglieder handeln“ oder Bindung mit der Fähigkeit „consents“)."""
    fake.module_version = "1.4.0"
    await connect_module(flow)
    fake.member_consents[12] = {"fotos": {"state": "given", "version": 2, "moment": "2026-01-10T10:00:00+01:00"}}
    paula = await linked_member(flow, fake, "paula", 12)
    flow.act_as(paula)

    mine = (await flow.get("/api/membership/me/consents")).json()
    assert mine["available"] is True and [row["state"] for row in mine["consents"]] == ["given"]
    reads = [call for call in fake.calls if call[0].endswith("/consents") and call[0] != "/vereine/consents"]
    assert reads == [("/vereine/me/consents", {"member_id": "12"})], "nicht mehr über den allgemeinen Mitglieder-Endpunkt"

    # Fehlt dem API-Benutzer das Recht, sagt die Antwort warum - und es gibt keinen Umweg über den Mitglieder-Endpunkt.
    fake.members_act_right = False
    fake.calls.clear()
    denied = (await flow.get("/api/membership/me/consents")).json()
    assert denied["available"] is False and denied["reason"] == "right_missing" and "im Namen" in denied["text"]
    assert not [call for call in fake.calls if call[0].startswith("/vereine/members/")]


@pytest.mark.asyncio
async def test_a_binding_by_invitation_code_needs_the_ability_consents(flow, fake):
    await connect(flow)
    fake.add(member(12), email="paula@example.test")
    fake.member_consents[12] = {"fotos": {"state": "given", "version": 2, "moment": "2026-01-10T10:00:00+01:00"}}
    paula = await flow.add_user(role="player", name="paula")
    flow.act_as(paula)
    fake.invite("DOCS", 12, capabilities=("documents",))
    assert (await flow.post("/api/membership/me/identity", json={"code": "DOCS"})).json()["status"] == "bound"
    without = (await flow.get("/api/membership/me/consents")).json()
    assert without["available"] is False and without["reason"] == "no_capability" and "Einwilligungen" in without["text"]
    assert (await flow.post("/api/membership/me/consents", json={"code": "fotos", "decision": "withdrawn"})).status_code == 409
    assert fake.member_consents[12]["fotos"]["state"] == "given"

    fake.revoke_identity(paula["id"])
    fake.invite("ALL", 12, capabilities=("documents", "consents"))
    assert (await flow.post("/api/membership/me/identity", json={"code": "ALL"})).json()["status"] == "bound"
    fake.calls.clear()
    mine = (await flow.get("/api/membership/me/consents")).json()
    assert mine["available"] is True and mine["consents"][0]["state"] == "given"
    assert ("/vereine/me/consents", {"subject": paula["id"]}) in fake.calls
    withdrawn = await flow.post("/api/membership/me/consents", json={"code": "fotos", "decision": "withdrawn"})
    assert withdrawn.status_code == 200 and fake.member_consents[12]["fotos"]["state"] == "withdrawn"


@pytest.mark.asyncio
async def test_the_text_of_the_given_version_stays_readable_and_a_new_version_shows_both(flow, fake):
    """#1537: auch nach dem Zustimmen steht der Text da; gibt es eine neue Fassung, beide - die alte nur, wenn die Website
    sie je gesehen hat (das Modul liefert nur die aktuelle)."""
    await connect(flow)
    fake.consent_texts[0] = {"code": "fotos", "label": "Fotos auf der Website", "version": 1, "text": "Fotos dürfen erscheinen (Fassung 1)."}
    fake.consent_texts.append({"code": "newsletter", "label": "Newsletter", "version": 3, "text": "Newsletter, Fassung 3."})
    fake.member_consents[12] = {"fotos": {"state": "given", "version": 1, "moment": "2026-01-10T10:00:00+01:00"},
                                "newsletter": {"state": "given", "version": 2, "moment": "2026-01-10T10:00:00+01:00"}}
    paula = await linked_member(flow, fake, "paula", 12)
    flow.act_as(paula)

    first = {row["code"]: row for row in (await flow.get("/api/membership/me/consents")).json()["consents"]}
    fotos = first["fotos"]
    assert fotos["can_give"] is False and fotos["text_changed"] is False
    assert fotos["text"] == "Fotos dürfen erscheinen (Fassung 1)." and fotos["given_text"] == "Fotos dürfen erscheinen (Fassung 1).", "auch erteilt: Text lesbar"
    news = first["newsletter"]
    assert news["text_changed"] is True and news["text"] == "Newsletter, Fassung 3." and news["given_text"] is None, "Fassung 2 kennt die Website nicht"

    # Der Verein ändert den Foto-Text: die zugestimmte Fassung bleibt lesbar, daneben die neue.
    fake.consent_texts[0] = {"code": "fotos", "label": "Fotos auf der Website", "version": 2, "text": "Fotos dürfen erscheinen (Fassung 2)."}
    second = {row["code"]: row for row in (await flow.get("/api/membership/me/consents")).json()["consents"]}
    fotos = second["fotos"]
    assert fotos["text_changed"] is True and fotos["version"] == 1 and fotos["current_version"] == 2
    assert fotos["given_text"] == "Fotos dürfen erscheinen (Fassung 1)." and fotos["text"] == "Fotos dürfen erscheinen (Fassung 2)."
    assert await flow.db.consent_text_versions.count_documents({}) == 3


@pytest.mark.asyncio
async def test_a_retry_after_a_timeout_sends_the_same_reference_and_records_once(flow, fake):
    """#1537: kommt die Antwort nicht an, bleibt der Auftrag offen; der nächste Klick schickt dieselbe Kennung und
    denselben Zeitpunkt - das Modul erkennt den Auftrag, es gibt keinen zweiten Nachweis."""
    await connect(flow)
    paula = await linked_member(flow, fake, "paula", 12)
    flow.act_as(paula)

    fake.lose_consent_responses = 1
    lost = await flow.post("/api/membership/me/consents", json={"code": "fotos", "decision": "given", "version": 2})
    assert lost.status_code == 503
    assert len(fake.consent_events) == 1, "angekommen ist der Auftrag trotzdem"
    first = await flow.db.consent_decisions.find_one({"user_id": paula["id"]}, {"_id": 0})
    assert first["status"] == "pending" and first["error"] == "timeout"

    again = await flow.post("/api/membership/me/consents", json={"code": "fotos", "decision": "given", "version": 2})
    assert again.status_code == 200, again.text
    assert again.json()["result"]["recorded"] is False and again.json()["result"]["state"] == "given"
    assert len(fake.consent_events) == 1, "kein zweiter Nachweis"
    sent = list(fake.consent_posts)
    assert len(sent) == 2 and sent[0]["reference"] == sent[1]["reference"] == first["reference"]
    assert sent[0]["granted_at"] == sent[1]["granted_at"], "derselbe Zeitpunkt der Entscheidung"
    rows = await flow.db.consent_decisions.find({"user_id": paula["id"]}, {"_id": 0}).to_list(10)
    assert len(rows) == 1 and rows[0]["status"] == "duplicate" and rows[0]["attempts"] == 2

    # Eine neue Entscheidung ist ein neuer Auftrag; ein offener alter zum selben Zweck wird nie mehr nachgeschickt.
    fake.fail_with = 503
    assert (await flow.post("/api/membership/me/consents", json={"code": "fotos", "decision": "withdrawn"})).status_code == 503
    fake.fail_with = None
    fake.consent_texts[0] = {**fake.consent_texts[0], "version": 3}
    given = await flow.post("/api/membership/me/consents", json={"code": "fotos", "decision": "given", "version": 3})
    assert given.status_code == 200 and given.json()["result"]["recorded"] is True
    withdrawn = await flow.db.consent_decisions.find_one({"user_id": paula["id"], "decision": "withdrawn"}, {"_id": 0})
    assert withdrawn["status"] == "superseded"
    assert len({row["reference"] for row in fake.consent_posts}) == 2
    assert fake.member_consents[12]["fotos"]["state"] == "given" and fake.member_consents[12]["fotos"]["version"] == 3


def test_the_contract_offers_the_own_consents_for_reading_only():
    """Vertrag (#1537): `me/consents` gibt es nur zum Lesen, mit `subject` oder `member_id` und im Format des
    Mitglieder-Endpunkts - Entscheidungen gehen weiter über `members/{id}/consents` mit `reference`."""
    own = OPENAPI["paths"]["/vereine/me/consents"]
    assert set(own) == {"get"}
    assert {param["name"] for param in own["get"]["parameters"]} == {"subject", "member_id"}
    schema = own["get"]["responses"]["200"]["content"]["application/json"]["schema"]["items"]["$ref"].rsplit("/", 1)[-1]
    fields = set(OPENAPI["components"]["schemas"][schema]["properties"])
    assert {"code", "label", "state", "version", "current_version", "moment", "can_give", "can_withdraw"} <= fields
    decision = OPENAPI["components"]["schemas"]["ConsentDecision"]["properties"]
    assert {"reference", "granted_at", "form"} <= set(decision)


@pytest.mark.asyncio
async def test_two_identical_clicks_at_once_send_one_reference_and_leave_one_proof(flow, fake, monkeypatch):
    """Codex-Prüfung #1547: zwei gleichzeitige gleiche Klicks lesen beide „kein offener Auftrag“ - ohne atomaren
    Schreibschritt gingen zwei Kennungen raus. Mit Upsert auf den offenen Auftrag (eindeutiger partieller Index) ist
    es derselbe Auftrag."""
    await connect(flow)
    await database.init_audit_indexes(flow.db)
    paula = await linked_member(flow, fake, "paula", 12)
    flow.act_as(paula)
    monkeypatch.setattr(membership_routes, "get_db", lambda: InterleavedReads(flow.db, "consent_decisions"))
    # Beide Klicks sind gleichzeitig unterwegs: keiner bekommt die Antwort von Dolibarr, bevor der andere seinen Auftrag hat.
    both_sent = asyncio.Barrier(2)
    decide = dolibarr_client.DolibarrClient.decide_consent

    async def overlapping(self, member_id, payload):
        await asyncio.wait_for(both_sent.wait(), 2)
        return await decide(self, member_id, payload)

    monkeypatch.setattr(dolibarr_client.DolibarrClient, "decide_consent", overlapping)

    body = {"code": "fotos", "decision": "given", "version": 2}
    first, second = await asyncio.gather(flow.post("/api/membership/me/consents", json=body), flow.post("/api/membership/me/consents", json=body))
    assert first.status_code == 200 and second.status_code == 200, (first.text, second.text)
    assert len({post["reference"] for post in fake.consent_posts}) == 1, "genau eine Kennung"
    assert len(fake.consent_events) == 1, "genau ein Nachweis"
    assert await flow.db.consent_decisions.count_documents({"user_id": paula["id"]}) == 1


@pytest.mark.asyncio
async def test_a_duplicate_key_on_the_open_order_is_the_same_order(flow, fake, monkeypatch):
    """Verliert ein Request das Rennen um das Anlegen (DuplicateKeyError am partiellen Index), nimmt er den Auftrag des
    anderen - dieselbe Kennung, kein Fehler."""
    await connect(flow)
    await database.init_audit_indexes(flow.db)
    paula = await linked_member(flow, fake, "paula", 12)
    flow.act_as(paula)
    collection = flow.db.consent_decisions
    original = collection.find_one_and_update
    calls = {"n": 0}

    async def racing(*args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            # Der andere Request legt den Auftrag genau jetzt an.
            await collection.insert_one({"id": "fremd", "user_id": paula["id"], "member_id": 12, "code": "fotos", "decision": "given", "version": 2,
                                         "reference": "web-c-andere", "created_at": "2026-10-14T08:00:00+00:00", "status": "sent", "attempts": 1})
            raise DuplicateKeyError("E11000 duplicate key")
        return await original(*args, **kwargs)

    monkeypatch.setattr(type(collection), "find_one_and_update", lambda self, *args, **kwargs: racing(*args, **kwargs))
    answer = await flow.post("/api/membership/me/consents", json={"code": "fotos", "decision": "given", "version": 2})
    assert answer.status_code == 200, answer.text
    assert [post["reference"] for post in fake.consent_posts] == ["web-c-andere"]
    assert [post["granted_at"] for post in fake.consent_posts] == ["2026-10-14T08:00:00+00:00"]


@pytest.mark.asyncio
async def test_the_open_order_index_only_covers_open_orders(flow):
    await database.init_audit_indexes(flow.db)
    key = {"user_id": "u1", "member_id": 12, "code": "fotos", "decision": "given", "version": 2}
    await flow.db.consent_decisions.insert_one({**key, "status": "recorded"})
    await flow.db.consent_decisions.insert_one({**key, "status": "failed"})
    await flow.db.consent_decisions.insert_one({**key, "status": "sent"})
    with pytest.raises(DuplicateKeyError):
        await flow.db.consent_decisions.insert_one({**key, "status": "pending"})
