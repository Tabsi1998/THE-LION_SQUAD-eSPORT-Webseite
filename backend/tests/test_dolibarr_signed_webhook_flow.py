"""Signierte Webhooks des Vereinsmoduls (#1540) durch die echte Anwendung.

Der Empfänger prüft, was die Modul-Spezifikation verlangt (``Vereine-Signature: v1=<hex>,t=<s>,k=<id>,e=<event>``,
HMAC-SHA-256 über ``v1.<t>.<Body-Bytes>``): Kopf lesbar, Schlüssel bekannt, Zeitpunkt höchstens 300 s daneben,
Signatur in konstanter Zeit verglichen, Ereignis-Kennung noch nicht gesehen. Ein Ereignis ist nur der Anlass zum
Nachlesen - verarbeitet wird mit denselben Abgleich-Funktionen wie bisher. Ohne Geheimnis bleibt die Tür zu."""
import hashlib
import hmac
import json
import logging
import pathlib
import sys
import time

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from dolibarr_fake import API_KEY, BASE_URL, FakeDolibarr, member  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from services import dolibarr_client, dolibarr_sync, ops_checks, vereine_webhooks  # noqa: E402
from services.secret_store import encrypt_secret  # noqa: E402

PATH = "/api/integrations/dolibarr/vereine-webhook"
KEY_ID = "a1b2c3d4"
SECRET = "5e" * 32
EVENT = "9f2c" + "0" * 36


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
    monkeypatch.delenv(vereine_webhooks.SECRETS_ENV, raising=False)
    return instance


async def connect(flow, mode="live", **extra):
    await flow.db.settings.update_one({"id": "dolibarr"}, {"$set": {
        "id": "dolibarr", "mode": mode, "environment": "production", "base_url": BASE_URL,
        "api_key": encrypt_secret(API_KEY), "instance": "verein", "entity": 1, "type_map": {"2": "ordinary"}, **extra,
    }}, upsert=True)


async def connect_signed(flow, **extra):
    await connect(flow, signed_webhook_key_id=KEY_ID, signed_webhook_secret=encrypt_secret(SECRET), **extra)


def body_of(event_id=EVENT, object_type="membership", object_id=12, change="updated", **extra) -> bytes:
    """Genau so, wie das Modul den Body baut (``VereineHookRules::body``)."""
    body = {"version": "v1", "event_id": event_id, "object_type": object_type, "object_id": object_id, "revision": 3, "change": change,
            **extra, "occurred_at": "2026-10-14T08:00:00Z"}
    return json.dumps(body, separators=(",", ":")).encode()


def header_for(body: bytes, *, secret=SECRET, key_id=KEY_ID, stamp=None, event_id=EVENT) -> str:
    stamp = int(time.time()) if stamp is None else stamp
    digest = hmac.new(secret.encode(), b"v1." + str(stamp).encode() + b"." + body, hashlib.sha256).hexdigest()
    return f"v1={digest},t={stamp},k={key_id},e={event_id}"


async def deliver(flow, body: bytes, header: str | None = None, **kwargs):
    headers = {"Content-Type": "application/json", "Vereine-Signature": header if header is not None else header_for(body, **kwargs)}
    return await flow.post(PATH, content=body, headers=headers)


# ---------------------------------------------------------------- Prüfung nach Modul-Spezifikation

def test_the_signature_is_the_one_the_module_computes():
    body = body_of()
    stamp = 1790000000
    header = header_for(body, stamp=stamp)
    parts = vereine_webhooks.read_header(header)
    assert parts == {"signature": header.split(",")[0][3:], "timestamp": stamp, "key_id": KEY_ID, "event_id": EVENT}
    assert vereine_webhooks.verify(header, body, {KEY_ID: SECRET}, stamp) == ""
    assert vereine_webhooks.verify(header, body, {KEY_ID: SECRET}, stamp + 300) == ""
    assert vereine_webhooks.verify(header, body, {KEY_ID: SECRET}, stamp + 301) == "expired"
    assert vereine_webhooks.verify(header, body, {KEY_ID: SECRET}, stamp - 301) == "expired"
    assert vereine_webhooks.verify(header, body + b" ", {KEY_ID: SECRET}, stamp) == "signature", "die Bytes zählen, nicht das JSON"
    assert vereine_webhooks.verify(header, body, {"other": SECRET}, stamp) == "key"
    for broken in ("", "v1=abc,t=1,k=a,e=b", "t=1,k=a,e=b", f"v1={'0' * 64},t=x,k=a,e=b", "kaputt"):
        assert vereine_webhooks.verify(broken, body, {KEY_ID: SECRET}, stamp) == "header", broken


def test_secrets_come_from_the_server_environment_or_the_encrypted_settings(monkeypatch):
    monkeypatch.delenv(vereine_webhooks.SECRETS_ENV, raising=False)
    assert vereine_webhooks.configured_secrets({}) == {}
    settings = {"signed_webhook_key_id": KEY_ID, "signed_webhook_secret": encrypt_secret(SECRET)}
    assert vereine_webhooks.configured_secrets(settings) == {KEY_ID: SECRET}
    # Während eines Schlüsselwechsels zwei Schlüssel in der Umgebung, durch Komma getrennt.
    monkeypatch.setenv(vereine_webhooks.SECRETS_ENV, f" e5f6a7b8:{'ab' * 32} , {KEY_ID}:{SECRET} ")
    assert vereine_webhooks.configured_secrets({}) == {"e5f6a7b8": "ab" * 32, KEY_ID: SECRET}
    monkeypatch.setenv(vereine_webhooks.SECRETS_ENV, "ohne-doppelpunkt")
    assert vereine_webhooks.configured_secrets({}) == {}, "ein kaputter Eintrag öffnet nichts"
    monkeypatch.setenv(vereine_webhooks.SECRETS_ENV, f"{KEY_ID}:kurz")
    assert vereine_webhooks.configured_secrets({}) == {}, "zu kurze Geheimnisse gelten nicht"


# ---------------------------------------------------------------- Der Empfänger

@pytest.mark.asyncio
async def test_a_valid_event_queues_the_member_once(flow, fake, caplog):
    await connect_signed(flow)
    caplog.set_level(logging.INFO)
    body = body_of()
    header = header_for(body)
    answer = await deliver(flow, body, header)
    assert answer.status_code == 200, answer.text
    assert answer.json() == {"ok": True, "result": "queued"}
    pending = await flow.db.dolibarr_pending.find_one({}, {"_id": 0})
    assert pending["member_id"] == 12
    seen = await flow.db.dolibarr_webhook_events.find_one({}, {"_id": 0})
    assert seen["event_id"] == EVENT and seen["key"] == f"verein:1:{EVENT}" and "object_id" not in seen and seen["expires_at"]
    # Logs ohne Signatur, Geheimnis und Mitgliedsnummer.
    assert SECRET not in caplog.text and header.split(",")[0][3:] not in caplog.text


@pytest.mark.asyncio
async def test_a_wrong_signature_is_refused_and_changes_nothing(flow, fake):
    await connect_signed(flow)
    body = body_of()
    answer = await deliver(flow, body, secret="ff" * 32)
    assert answer.status_code == 401
    assert SECRET not in answer.text
    assert await flow.db.dolibarr_pending.count_documents({}) == 0
    assert await flow.db.dolibarr_webhook_events.count_documents({}) == 0
    # Unbekannter Schlüssel und manipulierter Body ebenso.
    assert (await deliver(flow, body, key_id="e5f6a7b8")).status_code == 401
    assert (await deliver(flow, body_of(object_id=13), header_for(body))).status_code == 401
    assert await flow.db.dolibarr_pending.count_documents({}) == 0


@pytest.mark.asyncio
async def test_a_stale_or_future_moment_is_refused(flow, fake):
    await connect_signed(flow)
    body = body_of()
    assert (await deliver(flow, body, stamp=int(time.time()) - 301)).status_code == 401
    assert (await deliver(flow, body, stamp=int(time.time()) + 301)).status_code == 401
    assert await flow.db.dolibarr_pending.count_documents({}) == 0
    assert (await deliver(flow, body, stamp=int(time.time()) - 200)).status_code == 200


@pytest.mark.asyncio
async def test_a_repeated_event_is_answered_but_not_processed_again(flow, fake):
    await connect_signed(flow)
    body = body_of()
    assert (await deliver(flow, body)).status_code == 200
    await flow.db.dolibarr_pending.delete_many({})
    # Das Modul wiederholt mit derselben Ereignis-Kennung und neuer Signatur.
    again = await deliver(flow, body, stamp=int(time.time()) + 5)
    assert again.status_code == 200 and again.json() == {"ok": True, "result": "duplicate"}
    assert await flow.db.dolibarr_pending.count_documents({}) == 0
    assert await flow.db.dolibarr_webhook_events.count_documents({}) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("queue, object_type, retried", [("queue_member", "membership", "queued"), ("queue_applications", "application", "applications")])
async def test_a_failed_enqueue_answers_5xx_and_frees_the_event(flow, fake, monkeypatch, queue, object_type, retried):
    await connect_signed(flow)
    body = body_of(object_type=object_type)

    async def broken(*args, **kwargs):
        raise RuntimeError("Datenbank weg")

    original = getattr(vereine_webhooks, queue)
    monkeypatch.setattr(vereine_webhooks, queue, broken)
    failed = await deliver(flow, body)
    assert failed.status_code == 503
    assert await flow.db.dolibarr_webhook_events.count_documents({}) == 0, "die Wiederholung des Moduls darf es noch einmal versuchen"
    assert await flow.db.dolibarr_pending.count_documents({}) == 0
    monkeypatch.setattr(vereine_webhooks, queue, original)
    again = await deliver(flow, body, stamp=int(time.time()) + 30)
    assert again.status_code == 200 and again.json()["result"] == retried
    assert await flow.db.dolibarr_pending.count_documents({}) == 1, "erst eingereiht, dann 200"


@pytest.mark.asyncio
async def test_a_body_that_is_too_large_is_refused_before_it_is_read(flow, fake):
    await connect_signed(flow)
    body = body_of(padding="x" * (vereine_webhooks.MAX_BODY_BYTES + 1))
    assert (await deliver(flow, body)).status_code == 413
    assert await flow.db.dolibarr_webhook_events.count_documents({}) == 0


async def chunked(body: bytes, size: int = 1024):
    for start in range(0, len(body), size):
        yield body[start:start + size]


@pytest.mark.asyncio
async def test_a_streamed_body_without_length_is_cut_off_at_the_limit(flow, fake):
    """Ohne Content-Length (chunked, mehrere ASGI-Teile) greift die Grenze beim Lesen."""
    await connect_signed(flow)
    big = body_of(padding="x" * (vereine_webhooks.MAX_BODY_BYTES + 1))
    headers = {"Content-Type": "application/json", "Vereine-Signature": header_for(big)}
    answer = await flow.post(PATH, content=chunked(big), headers=headers)
    assert answer.request.headers.get("content-length") is None and answer.request.headers.get("transfer-encoding") == "chunked"
    assert answer.status_code == 413
    assert await flow.db.dolibarr_webhook_events.count_documents({}) == 0
    # Ein gültiger Body in mehreren Teilen wird zusammengesetzt und geprüft wie am Stück.
    small = body_of()
    answer = await flow.post(PATH, content=chunked(small, 50), headers={**headers, "Vereine-Signature": header_for(small)})
    assert answer.status_code == 200 and answer.json()["result"] == "queued"


@pytest.mark.asyncio
async def test_unknown_or_broken_events(flow, fake):
    await connect_signed(flow)
    # Gültig signiert, aber eine Objektart, die das Modul (noch) nicht kennt: angenommen, nichts passiert.
    unknown = body_of(event_id="1" * 40, object_type="raumschiff")
    answer = await deliver(flow, unknown, event_id="1" * 40)
    assert answer.status_code == 200 and answer.json() == {"ok": True, "result": "ignored"}
    # Bekannte Art ohne Abgleich auf der Website (Abstimmungen liest ein eigener Job): ebenso.
    ballot = body_of(event_id="2" * 40, object_type="ballot", object_id=7, state="opened")
    assert (await deliver(flow, ballot, event_id="2" * 40)).json()["result"] == "ignored"
    assert await flow.db.dolibarr_pending.count_documents({}) == 0
    # Kaputter Body, falsche Version, Kennung im Kopf passt nicht zum Body: 400.
    for event_id, raw in (("3" * 40, b"kein json"), ("4" * 40, body_of(event_id="4" * 40, object_id="zwoelf")),
                          ("5" * 40, body_of(event_id="5" * 40).replace(b'"v1"', b'"v2"')), ("6" * 40, body_of(event_id="7" * 40))):
        assert (await deliver(flow, raw, event_id=event_id)).status_code == 400, raw
    assert (await deliver(flow, body_of(), "")).status_code == 400
    assert (await flow.post(PATH, content=body_of(), headers={"Content-Type": "application/json"})).status_code == 400


@pytest.mark.asyncio
async def test_without_a_secret_the_receiver_stays_closed(flow, fake):
    await connect(flow)
    body = body_of()
    answer = await deliver(flow, body)
    assert answer.status_code == 503
    assert await flow.db.dolibarr_webhook_events.count_documents({}) == 0
    assert await flow.db.dolibarr_pending.count_documents({}) == 0


@pytest.mark.asyncio
async def test_the_secret_may_come_from_the_server_environment(flow, fake, monkeypatch):
    await connect(flow)
    monkeypatch.setenv(vereine_webhooks.SECRETS_ENV, f"{KEY_ID}:{SECRET}")
    assert (await deliver(flow, body_of())).status_code == 200


@pytest.mark.asyncio
async def test_member_deleted_reads_again_and_ends_the_membership(flow, fake, monkeypatch):
    await connect_signed(flow)
    fake.add(member(12))
    monkeypatch.setattr(dolibarr_sync, "PENDING_DELAY_SECONDS", -1)
    assert (await deliver(flow, body_of(change="deleted"))).json()["result"] == "queued"
    fake.members.pop(12)
    assert (await dolibarr_sync.process_pending(flow.db))["processed"] == 0
    assert await flow.db.dolibarr_pending.count_documents({}) == 0, "404 beim Nachlesen beendet den Auftrag"


@pytest.mark.asyncio
async def test_consent_and_fee_events_read_the_member_again(flow, fake, monkeypatch):
    await connect_signed(flow, directory_consent_code="fotos")
    fake.add(member(12))
    fake.member_consents[12] = {"fotos": {"state": "given", "version": 2, "moment": "2026-10-14T08:00:00Z"}}
    monkeypatch.setattr(dolibarr_sync, "PENDING_DELAY_SECONDS", -1)
    consent = body_of(event_id="8" * 40, object_type="consent")
    assert (await deliver(flow, consent, event_id="8" * 40)).json()["result"] == "queued"
    assert (await dolibarr_sync.process_pending(flow.db))["processed"] == 1
    entry = await flow.db.club_member_profiles.find_one({"dolibarr_member_id": 12}, {"_id": 0})
    assert entry and entry["is_active"] is True, "sync_directory_entry ist gelaufen"
    fee = body_of(event_id="9" * 40, object_type="fee")
    assert (await deliver(flow, fee, event_id="9" * 40)).json()["result"] == "queued"


@pytest.mark.asyncio
async def test_preview_mode_accepts_but_does_not_queue(flow, fake):
    await connect_signed(flow, mode="preview")
    answer = await deliver(flow, body_of())
    assert answer.status_code == 200 and answer.json()["result"] == "skipped"
    assert await flow.db.dolibarr_pending.count_documents({}) == 0


async def make_due(flow, **fields):
    await flow.db.dolibarr_pending.update_many({}, {"$set": {"due_at": "2000-01-01T00:00:00+00:00", **fields}})


@pytest.mark.asyncio
async def test_an_application_event_is_queued_durably_and_retried(flow, fake, monkeypatch):
    await connect_signed(flow, applications_enabled=True)
    monkeypatch.setattr(dolibarr_sync, "PENDING_DELAY_SECONDS", -1)
    await flow.db.membership_applications.insert_one({"id": "antrag-1", "user_id": "u1", "status": "pending", "external_id": "web-antrag-1",
                                                      "dolibarr": {"checked_at": "2099-01-01T00:00:00+00:00"}})
    application = body_of(event_id="a" * 40, object_type="application", object_id=5)
    answer = await deliver(flow, application, event_id="a" * 40)
    assert answer.status_code == 200 and answer.json()["result"] == "applications"
    entry = await flow.db.dolibarr_pending.find_one({}, {"_id": 0})
    assert entry["kind"] == "applications" and entry["attempts"] == 0, "vor der Antwort dauerhaft eingereiht"

    # Dolibarr kennt den Antrag (noch) nicht: am Antrag vermerkt, der Eintrag bleibt mit einem Versuch mehr und Abstand.
    assert (await vereine_webhooks.process_pending_applications(flow.db))["ok"] is False
    entry = await flow.db.dolibarr_pending.find_one({}, {"_id": 0})
    assert entry["attempts"] == 1 and entry["due_at"] > dolibarr_sync.now_utc().isoformat()
    assert (await flow.db.membership_applications.find_one({"id": "antrag-1"}))["dolibarr"]["error"]

    # Grenze: nach dem letzten Versuch fällt der Eintrag weg, der regelmäßige Lauf holt es nach.
    await make_due(flow, attempts=dolibarr_sync.PENDING_MAX_ATTEMPTS - 1)
    assert (await dolibarr_sync.process_pending(flow.db))["processed"] == 0, "der Mitglieder-Verarbeiter lässt den Eintrag liegen"
    assert await flow.db.dolibarr_pending.count_documents({}) == 1
    await vereine_webhooks.process_pending_applications(flow.db)
    assert await flow.db.dolibarr_pending.count_documents({}) == 0

    # Der nächste Hinweis: diesmal liest der Job den Stand.
    fake.applications["web-antrag-1"] = {"external_id": "web-antrag-1", "status": "in_review", "received_at": "2026-10-14T08:00:00+02:00",
                                         "decided_at": "", "reason": "", "member_id": 0, "member_ref": ""}
    assert (await deliver(flow, body_of(event_id="b" * 40, object_type="application", object_id=5), event_id="b" * 40)).status_code == 200
    assert (await vereine_webhooks.process_pending_applications(flow.db))["processed"] == 1
    assert await flow.db.dolibarr_pending.count_documents({}) == 0
    doc = await flow.db.membership_applications.find_one({"id": "antrag-1"}, {"_id": 0})
    assert doc["dolibarr"]["application_status"] == "in_review" and "error" not in doc["dolibarr"]


# ---------------------------------------------------------------- Einrichtung, alter Weg, Checks

@pytest.mark.asyncio
async def test_the_secret_is_stored_encrypted_and_never_comes_back(flow, fake):
    await connect(flow)
    flow.act_as(await flow.add_user(role="club_admin"))
    saved = await flow.put("/api/admin/dolibarr/settings", json={"signed_webhook_key_id": KEY_ID, "signed_webhook_secret": SECRET})
    assert saved.status_code == 200, saved.text
    stored = await flow.db.settings.find_one({"id": "dolibarr"})
    assert stored["signed_webhook_secret"].startswith("enc:v1:") and stored["signed_webhook_key_id"] == KEY_ID
    status = await flow.get("/api/admin/dolibarr/status")
    assert status.json()["signed_webhook"] == {"configured": True, "source": "settings", "path": PATH}
    assert SECRET not in status.text
    for wrong in ({"signed_webhook_key_id": "a b"}, {"signed_webhook_secret": "kurz"}):
        assert (await flow.put("/api/admin/dolibarr/settings", json=wrong)).status_code == 400
    flow.act_as(None)
    assert (await deliver(flow, body_of())).status_code == 200


@pytest.mark.asyncio
async def test_the_old_way_can_be_switched_off_and_the_checks_say_while_it_is_on(flow, fake):
    await connect_signed(flow)
    admin = await flow.add_user(role="club_admin")
    flow.act_as(admin)
    path = (await flow.post("/api/admin/dolibarr/webhook-token")).json()["path"]
    event = {"triggercode": "VEREINE_MEMBER_CHANGED", "object": {"id": 12, "member_id": 12}}
    flow.act_as(None)
    assert (await flow.post(path, json=event)).status_code == 202, "bis zur Umstellung bleibt der alte Weg"
    check = await ops_checks.check_dolibarr_webhook(flow.db)
    assert check["key"] == "dolibarr_webhook" and check["status"] == "warn"

    vorstand = await flow.add_user(role="player")
    await flow.db.users.update_one({"id": vorstand["id"]}, {"$set": {"areas": ["club"]}})
    flow.act_as({**vorstand, "areas": ["club"]})
    assert (await flow.put("/api/admin/dolibarr/features", json={"key": "legacy_webhook", "on": False})).status_code == 403, "nur System"

    flow.act_as(admin)
    switched = await flow.put("/api/admin/dolibarr/features", json={"key": "legacy_webhook", "on": False})
    assert switched.status_code == 200, switched.text
    features = {row["key"]: row for row in switched.json()["features"]}
    assert features["legacy_webhook"]["switch"] == {"on": False, "system_only": True}
    assert features["webhook"]["enabled"] is True
    flow.act_as(None)
    assert (await flow.post(path, json=event)).status_code == 404
    check = await ops_checks.check_dolibarr_webhook(flow.db)
    assert check["status"] == "ok"
    assert "dolibarr_webhook" in {key for key, _, _ in ops_checks.default_checks(flow.db)}


@pytest.mark.asyncio
async def test_the_checks_stay_quiet_without_a_connection(flow, fake):
    assert (await ops_checks.check_dolibarr_webhook(flow.db))["status"] == "ok"
    await connect(flow)
    check = await ops_checks.check_dolibarr_webhook(flow.db)
    assert check["status"] == "ok" and "noch nicht" in check["value"]
