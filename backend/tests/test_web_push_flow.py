"""Browser-Benachrichtigungen (Web-Push, #1163) mit der echten Anwendung.

Ein Browser meldet sich an und ab; Meldungen gehen nach denselben Regeln wie der App-Push an ihn (Themen und der Kanal
„Browser“); eine abgelaufene Anmeldung (404/410) verschwindet beim Versand; Abmelden vom Konto nimmt die Anmeldung dieses
Browsers mit; Auskunft und Löschung kennen die Sammlung. Der Push-Dienst ist nachgestellt und entschlüsselt, was ankommt -
wie der Browser.
"""
import json
import os
import pathlib
import sys

import pytest
import pytest_asyncio
from cryptography.hazmat.primitives.asymmetric import ec

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import web_push  # noqa: E402
from test_web_push_unit import decrypt  # noqa: E402

pytestmark = pytest.mark.anyio

FCM = "https://fcm.googleapis.com/fcm/send/"


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def keys(monkeypatch):
    for name, value in web_push.generate_keys().items():
        monkeypatch.setenv(name, value)
    monkeypatch.setenv("SENDER_EMAIL", "noreply@example.test")
    monkeypatch.delenv("OUTBOUND_DISABLED", raising=False)


class Browser:
    def __init__(self, name: str):
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.auth = web_push._b64url(os.urandom(16))
        self.endpoint = FCM + name

    def subscription(self) -> dict:
        p256dh = web_push._b64url(web_push._public_bytes(self.key.public_key()))
        return {"endpoint": self.endpoint, "keys": {"p256dh": p256dh, "auth": self.auth}}


@pytest.fixture
def push_service(monkeypatch):
    """Der Push-Dienst: nimmt an, entschlüsselt mit dem Schlüssel des Browsers und merkt sich die Meldung."""
    service = {"browsers": {}, "status": {}, "received": []}

    class _Response:
        def __init__(self, status_code):
            self.status_code = status_code

    class _Client:
        def __init__(self, *args, **kwargs):
            assert kwargs.get("follow_redirects") is False

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, url, content, headers):
            status = service["status"].get(url, 201)
            if status < 300:
                browser = service["browsers"][url]
                assert headers["Content-Encoding"] == "aes128gcm"
                assert headers["Authorization"].startswith("vapid t=")
                service["received"].append((url, json.loads(decrypt(content, browser.key, browser.auth)), headers))
            return _Response(status)

    monkeypatch.setattr(web_push.httpx, "AsyncClient", _Client)
    return service


async def subscribe(flow, browser: Browser, service=None, **kwargs):
    if service is not None:
        service["browsers"][browser.endpoint] = browser
    return await flow.post("/api/web-push/subscriptions", json=browser.subscription(),
                           headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36"}, **kwargs)


async def test_ohne_schluessel_ist_alles_aus(flow, monkeypatch):
    monkeypatch.delenv("WEB_PUSH_VAPID_PRIVATE_KEY", raising=False)
    user = await flow.add_user()
    flow.act_as(user)
    config = await flow.get("/api/web-push/config")
    assert config.json() == {"enabled": False, "public_key": None, "subscriptions": 0}
    refused = await subscribe(flow, Browser("a"))
    assert refused.status_code == 409


async def test_anmelden_und_abmelden_eines_browsers(flow, keys):
    user = await flow.add_user()
    flow.act_as(user)
    config = (await flow.get("/api/web-push/config")).json()
    assert config["enabled"] is True and config["public_key"] == os.environ["WEB_PUSH_VAPID_PUBLIC_KEY"]

    browser = Browser("eins")
    res = await subscribe(flow, browser)
    assert res.status_code == 200
    again = await subscribe(flow, browser)
    assert again.status_code == 200
    rows = await flow.db.web_push_subscriptions.find({}, {"_id": 0}).to_list(10)
    assert len(rows) == 1
    assert rows[0]["user_id"] == user["id"] and rows[0]["browser"] == "Chrome unter Windows"
    assert rows[0]["created_at"] and rows[0]["endpoint_hash"] == web_push.endpoint_hash(browser.endpoint)
    assert (await flow.get("/api/web-push/config")).json()["subscriptions"] == 1

    # Fremde Dienste und kaputte Schlüssel nimmt der Server nicht an.
    bad = browser.subscription()
    bad["endpoint"] = "https://example.test/push"
    res = await flow.post("/api/web-push/subscriptions", json=bad)
    assert res.status_code == 400
    broken = browser.subscription()
    broken["keys"]["p256dh"] = "A" * 87
    res = await flow.post("/api/web-push/subscriptions", json=broken)
    assert res.status_code == 400

    # Ein anderes Konto im selben Browser übernimmt die Anmeldung - nie zwei Konten an einem Browser.
    other = await flow.add_user()
    flow.act_as(other)
    await subscribe(flow, browser)
    rows = await flow.db.web_push_subscriptions.find({}, {"_id": 0}).to_list(10)
    assert [row["user_id"] for row in rows] == [other["id"]]

    res = await flow.client.request("DELETE", "/api/web-push/subscriptions", json={"endpoint": browser.endpoint})
    assert res.json()["removed"] == 1
    assert await flow.db.web_push_subscriptions.count_documents({}) == 0


async def test_versand_nach_themen_und_kanal_browser(flow, keys, push_service):
    from services.user_notifications import create_user_notification

    user = await flow.add_user()
    flow.act_as(user)
    browser = Browser("turnier")
    await subscribe(flow, browser, push_service)

    created = await create_user_notification(user["id"], "Check-in offen", "Bis 18:00 einchecken",
                                             url="/tournaments/cup", kind="tournament_checkin", meta={"tournament_id": "t1"})
    assert created["browser_sent_count"] == 1
    url, payload, headers = push_service["received"][0]
    assert url == browser.endpoint
    assert payload["title"] == "Check-in offen" and payload["url"] == "/tournaments/cup"
    assert payload["actions"][0]["title"] == "Jetzt einchecken"
    assert headers["Urgency"] == "high"
    stored = await flow.db.notifications.find_one({"id": created["id"]}, {"_id": 0})
    assert stored["browser_sent_count"] == 1

    # Thema „Turnier-Updates“ im Browser aus: nichts kommt - Postfach bleibt.
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"notification_preferences": {"browser:tournament_updates": False}}})
    quiet = await create_user_notification(user["id"], "Turnier beendet", url="/tournaments/cup", kind="tournament_finished")
    assert quiet["browser_sent_count"] == 0
    # Ein anderes Thema geht weiter.
    message = await create_user_notification(user["id"], "Nachricht von Max", url="/messages/max", kind="direct_message")
    assert message["browser_sent_count"] == 1

    # Kanal „Browser“ ganz aus: nichts mehr.
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"notification_preferences": {"browser": False}}})
    off = await create_user_notification(user["id"], "Nachricht von Mia", url="/messages/mia", kind="direct_message")
    assert off["browser_sent_count"] == 0
    assert len(push_service["received"]) == 2

    # Abnahme-Stand: nichts geht hinaus.
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"notification_preferences": {}}})
    os.environ["OUTBOUND_DISABLED"] = "true"
    try:
        held = await create_user_notification(user["id"], "Nachricht von Ali", url="/messages/ali", kind="direct_message")
    finally:
        os.environ.pop("OUTBOUND_DISABLED", None)
    assert held["browser_sent_count"] == 0


async def test_abgelaufene_anmeldungen_verschwinden(flow, keys, push_service):
    user = await flow.add_user()
    flow.act_as(user)
    alive, gone, expired, broken = Browser("lebt"), Browser("weg"), Browser("abgelaufen"), Browser("kaputt")
    for browser in (alive, gone, expired, broken):
        await subscribe(flow, browser, push_service)
    push_service["status"][gone.endpoint] = 410
    push_service["status"][expired.endpoint] = 404
    push_service["status"][broken.endpoint] = 500

    sent = await web_push.send_web_push_for_notification({"id": "n1", "user_id": user["id"], "kind": "match_call", "title": "Du bist dran", "url": "/matches/m1"})
    assert sent == 1
    left = {row["endpoint"]: row for row in await flow.db.web_push_subscriptions.find({}, {"_id": 0}).to_list(10)}
    assert set(left) == {alive.endpoint, broken.endpoint}
    assert left[alive.endpoint].get("last_sent_at")
    assert left[broken.endpoint]["last_error"] == "HTTP 500"


async def test_abmelden_vom_konto_nimmt_die_browser_anmeldung_mit(flow, keys, monkeypatch):
    import auth
    from routes import auth_routes

    monkeypatch.setenv("JWT_SECRET", "flow-tests-secret-with-at-least-32-characters")
    user = await flow.add_user()
    flow.act_as(user)
    access = auth.create_access_token(user["id"], user["email"], "user", "jti-1", "familie-1")
    await flow.post("/api/web-push/subscriptions", json=Browser("hier").subscription(), headers={"Authorization": f"Bearer {access}"})
    other_access = auth.create_access_token(user["id"], user["email"], "user", "jti-2", "familie-2")
    await flow.post("/api/web-push/subscriptions", json=Browser("dort").subscription(), headers={"Authorization": f"Bearer {other_access}"})
    rows = await flow.db.web_push_subscriptions.find({}, {"_id": 0, "session_family": 1}).to_list(10)
    assert sorted(row["session_family"] for row in rows) == ["familie-1", "familie-2"]

    refresh = auth.create_refresh_token(user["id"], "jti-1", "familie-1")
    await flow.db.refresh_tokens.insert_one({"jti": "jti-1", "user_id": user["id"], "family_id": "familie-1", "token_hash": auth.hash_token(refresh)})
    await auth_routes._revoke_refresh(flow.db, refresh)

    left = await flow.db.web_push_subscriptions.find({}, {"_id": 0, "session_family": 1}).to_list(10)
    assert [row["session_family"] for row in left] == ["familie-2"]


async def test_auskunft_und_loeschung(flow, keys):
    from routes import dsgvo_routes
    from services.personal_data import PERSONAL

    user = await flow.add_user()
    flow.act_as(user)
    browser = Browser("auskunft")
    await subscribe(flow, browser)
    assert PERSONAL["web_push_subscriptions"].export == ("web_push_browsers",)

    export = await dsgvo_routes._user_data_export(flow.db, user["id"])
    rows = export["web_push_browsers"]
    assert rows and rows[0]["browser"] == "Chrome unter Windows"
    dumped = json.dumps(rows)
    assert browser.endpoint not in dumped and browser.auth not in dumped

    await dsgvo_routes._anonymize_user_data(flow.db, user["id"], user["id"], "self_delete")
    assert await flow.db.web_push_subscriptions.count_documents({"user_id": user["id"]}) == 0


async def test_ohne_browser_anmeldung_entsteht_keine_unsichtbare_meldung(flow, keys, push_service):
    """Postfach und Push aus, kein Browser angemeldet: wie bisher keine Meldung - der Kanal „Browser“ allein legt nichts an."""
    from services.user_notifications import create_user_notification

    user = await flow.add_user()
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"notification_preferences": {"in_app": False, "push": False}}})
    created = await create_user_notification(user["id"], "Check-in offen", url="/tournaments/cup", kind="tournament_checkin")
    assert created is None
    assert await flow.db.notifications.count_documents({"user_id": user["id"]}) == 0

    # Mit angemeldetem Browser kommt sie dort an - im Postfach bleibt sie unsichtbar.
    flow.act_as(user)
    await subscribe(flow, Browser("spaeter"), push_service)
    created = await create_user_notification(user["id"], "Check-in offen", url="/tournaments/cup", kind="tournament_checkin",
                                             meta={"tournament_id": "t2"})
    assert created["browser_sent_count"] == 1 and created["in_app_visible"] is False
