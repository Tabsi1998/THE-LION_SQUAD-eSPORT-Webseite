"""App-Sperre (#1052): ein Gerät mit App-Sperre bekommt Pushes ohne Inhalt.

Die App meldet beim Registrieren des Geräts, ob die App-Sperre an ist. Dann trägt der Push nur „Neue Benachrichtigung“
und die Kennung - Titel, Text, Art und Ziel lädt die App erst nach dem Entsperren vom Server. Geräte ohne Sperre und
ältere Apps, die nichts melden, bekommen weiter den vollen Push.
"""
import asyncio
import pathlib
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from flow_harness import make_flow  # noqa: E402
from services import push_notifications  # noqa: E402

NOTIFICATION = {
    "id": "n1",
    "user_id": "u1",
    "kind": "direct_message",
    "title": "Nachricht von Max",
    "body": "Treffen um acht?",
    "url": "/messages/max",
    "meta": {"thread_user_id": "max"},
}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def _send(monkeypatch, rows):
    sent = []

    class _Client:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, _url, json):
            sent.extend(json)
            return SimpleNamespace(raise_for_status=lambda: None, json=lambda: {"data": [{"status": "ok", "id": f"t{i}"} for i in range(len(json))]})

    class _Cursor:
        async def to_list(self, _limit):
            return rows

    tokens = SimpleNamespace(find=lambda *_args, **_kwargs: _Cursor(), update_one=AsyncMock(), update_many=AsyncMock())
    monkeypatch.setattr(push_notifications, "get_db", lambda: SimpleNamespace(mobile_push_tokens=tokens))
    monkeypatch.setattr(push_notifications.httpx, "AsyncClient", _Client)
    count = asyncio.run(push_notifications.send_mobile_push_for_notification(dict(NOTIFICATION)))
    assert count == len(rows)
    return {row["to"]: row for row in sent}


def test_gesperrtes_geraet_bekommt_den_push_ohne_inhalt(monkeypatch):
    sent = _send(monkeypatch, [
        {"token": "ExponentPushToken[gesperrt]", "channel_set": 2, "private_content": True},
        {"token": "ExponentPushToken[offen]", "channel_set": 2, "private_content": False},
        {"token": "ExponentPushToken[alt]", "channel_set": 2},
    ])

    account = push_notifications.push_account_tag("u1")
    hidden = sent["ExponentPushToken[gesperrt]"]
    assert hidden["title"] == "LionsAPP"
    assert hidden["body"] == "Neue Benachrichtigung"
    assert hidden["data"] == {"notification_id": "n1", "private": True, "account": account}
    # Auch der Kanal verrät die Art nicht: der Standardkanal statt „Chats“.
    assert hidden["channelId"] == push_notifications.FALLBACK_CHANNEL
    text = repr(hidden)
    for secret in ("Max", "acht", "/messages", "direct_message", "lion_chats", "u1"):
        assert secret not in text

    for token in ("ExponentPushToken[offen]", "ExponentPushToken[alt]"):
        assert sent[token]["title"] == "Nachricht von Max"
        assert sent[token]["body"] == "Treffen um acht?"
        assert sent[token]["data"]["url"] == "/messages/max"
        assert sent[token]["data"]["account"] == account
        assert sent[token]["channelId"] == "lion_chats"


def test_alte_app_mit_sperre_bekommt_ihren_standardkanal(monkeypatch):
    sent = _send(monkeypatch, [{"token": "ExponentPushToken[alt-gesperrt]", "private_content": True}])
    assert sent["ExponentPushToken[alt-gesperrt]"]["channelId"] == "default"


def test_konto_kennung_ist_kurz_und_gleich_wie_in_der_app():
    # Derselbe Wert steht in mobile/src/notifications/PushService.test.ts - beide Seiten rechnen gleich.
    assert push_notifications.push_account_tag("u-test-1") == "c6c8cd198acdde30"
    assert push_notifications.push_account_tag("u-test-2") != "c6c8cd198acdde30"


@pytest.mark.asyncio
async def test_das_geraet_meldet_die_app_sperre_beim_registrieren(flow):
    user = await flow.add_user(name="lion")
    flow.act_as(user)
    token = "ExponentPushToken[privat-test-geraet]"

    async def stored():
        return await flow.db.mobile_push_tokens.find_one({"token": token}, {"_id": 0})

    answer = await flow.post("/api/mobile/push-token", json={"token": token, "platform": "android", "private": True})
    assert answer.status_code == 200
    # Der Server bestätigt die Wahl ausdrücklich - daran erkennt die App, dass er Pushes ohne Inhalt schickt.
    assert answer.json() == {"ok": True, "private_content": True}
    assert (await stored())["private_content"] is True

    # Sperre wieder aus: derselbe Weg schaltet zurück.
    answer = await flow.post("/api/mobile/push-token", json={"token": token, "platform": "android", "private": False})
    assert answer.json()["private_content"] is False
    assert (await stored())["private_content"] is False

    # Eine ältere App ohne die Angabe lässt ein gespeichertes „ohne Inhalt“ stehen - vorsichtig ist hier richtig.
    await flow.post("/api/mobile/push-token", json={"token": token, "platform": "android", "private": True})
    answer = await flow.post("/api/mobile/push-token", json={"token": token, "platform": "android"})
    assert answer.json()["private_content"] is True
    assert (await stored())["private_content"] is True


@pytest.mark.asyncio
async def test_ein_geraet_gehoert_nur_dem_zuletzt_angemeldeten_konto(flow):
    first = await flow.add_user(name="erster")
    second = await flow.add_user(name="zweiter")
    token = "ExponentPushToken[wechsel-test-geraet]"

    flow.act_as(first)
    await flow.post("/api/mobile/push-token", json={"token": token, "platform": "android", "private": True})
    # Die App konnte das Gerät für das erste Konto nicht abmelden - der Wechsel geht trotzdem.
    flow.act_as(second)
    assert (await flow.post("/api/mobile/push-token", json={"token": token, "platform": "android"})).status_code == 200

    rows = await flow.db.mobile_push_tokens.find({"token": token}, {"_id": 0}).to_list(10)
    assert [row["user_id"] for row in rows] == [second["id"]]
    assert await flow.db.mobile_push_tokens.count_documents({"user_id": first["id"]}) == 0
    # Die Wahl „ohne Inhalt“ hängt am Gerät, nicht am Konto.
    assert rows[0]["private_content"] is True
