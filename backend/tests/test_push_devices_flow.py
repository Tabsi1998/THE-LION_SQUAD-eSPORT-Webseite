"""Push-Geräte (#2467): ein Eintrag je Installation, alte räumen sich selbst weg, die Verwaltung zeigt sie eingeklappt.

Die App schickt eine zufällige Installations-Kennung mit. Meldet dieselbe Installation einen neuen Token, ersetzt er den
alten Eintrag; Kanäle und „ohne Inhalt“ bleiben. Ältere Apps ohne Kennung verhalten sich wie bisher. Abgeschaltete
Einträge löscht der Job ``ops_retention`` nach der eingestellten Frist, die Verwaltung kann sie je Person sofort entfernen.
"""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import ops_alerts  # noqa: E402

INSTALLATION = "inst-7f3a9c2e-4b1d-4e8a-9f60-1a2b3c4d5e6f"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def _register(flow, token, **extra):
    return await flow.post("/api/mobile/push-token", json={"token": token, "platform": "android", **extra})


@pytest.mark.asyncio
async def test_gleiche_installation_mit_neuem_token_ergibt_einen_eintrag(flow):
    user = await flow.add_user(name="lion")
    flow.act_as(user)
    first = await _register(flow, "ExponentPushToken[alt-installation-1]", installation_id=INSTALLATION, channels=2, private=True)
    assert first.status_code == 200, first.text

    # Neu installiert oder Token erneuert: dieselbe Kennung, ein anderer Token - die ältere App meldet Kanäle und Sperre
    # dabei nicht jedes Mal mit.
    second = await _register(flow, "ExponentPushToken[neu-installation-1]", installation_id=INSTALLATION)
    assert second.status_code == 200, second.text
    assert second.json() == {"ok": True, "private_content": True}

    rows = await flow.db.mobile_push_tokens.find({"user_id": user["id"]}, {"_id": 0}).to_list(10)
    assert [row["token"] for row in rows] == ["ExponentPushToken[neu-installation-1]"]
    assert rows[0]["installation_id"] == INSTALLATION
    assert rows[0]["channel_set"] == 2
    assert rows[0]["private_content"] is True
    assert rows[0]["enabled"] is True

    # Was die App neu meldet, gilt vor dem Übernommenen.
    third = await _register(flow, "ExponentPushToken[dritt-installation-1]", installation_id=INSTALLATION, channels=3, private=False)
    assert third.json()["private_content"] is False
    rows = await flow.db.mobile_push_tokens.find({"user_id": user["id"]}, {"_id": 0}).to_list(10)
    assert [(row["token"], row["channel_set"], row["private_content"]) for row in rows] == [("ExponentPushToken[dritt-installation-1]", 3, False)]


@pytest.mark.asyncio
async def test_andere_installation_desselben_kontos_bleibt_stehen(flow):
    user = await flow.add_user(name="zwei-handys")
    flow.act_as(user)
    await _register(flow, "ExponentPushToken[handy-a-0000000001]", installation_id=INSTALLATION)
    await _register(flow, "ExponentPushToken[handy-b-0000000001]", installation_id="tablet-0123456789abcdef")
    assert await flow.db.mobile_push_tokens.count_documents({"user_id": user["id"]}) == 2


@pytest.mark.asyncio
async def test_aeltere_app_ohne_kennung_bleibt_unveraendert(flow):
    user = await flow.add_user(name="altapp")
    flow.act_as(user)
    await _register(flow, "ExponentPushToken[ohne-kennung-0000001]", channels=2)
    await _register(flow, "ExponentPushToken[ohne-kennung-0000002]")

    rows = await flow.db.mobile_push_tokens.find({"user_id": user["id"]}, {"_id": 0}).sort("token", 1).to_list(10)
    assert [row["token"] for row in rows] == ["ExponentPushToken[ohne-kennung-0000001]", "ExponentPushToken[ohne-kennung-0000002]"]
    assert all("installation_id" not in row for row in rows)
    assert rows[0]["channel_set"] == 2
    assert "channel_set" not in rows[1]


@pytest.mark.asyncio
@pytest.mark.parametrize("installation_id", ["kurz", "x" * 65, "mit leerzeichen 1234567", "umlaut-äöü-1234567890", "slash/1234567890123"])
async def test_ungueltige_kennung_wird_abgelehnt(flow, installation_id):
    user = await flow.add_user(name="falsch")
    flow.act_as(user)
    answer = await _register(flow, "ExponentPushToken[falsche-kennung-001]", installation_id=installation_id)
    assert answer.status_code == 422
    assert await flow.db.mobile_push_tokens.count_documents({}) == 0


@pytest.mark.asyncio
async def test_installation_wechselt_das_konto(flow):
    first = await flow.add_user(name="erstes-konto")
    second = await flow.add_user(name="zweites-konto")
    flow.act_as(first)
    await _register(flow, "ExponentPushToken[konto-eins-00000001]", installation_id=INSTALLATION, private=True)

    # Abmelden ging nicht mehr durch, dann mit dem zweiten Konto angemeldet - die App bekam dabei einen neuen Token.
    flow.act_as(second)
    answer = await _register(flow, "ExponentPushToken[konto-zwei-00000001]", installation_id=INSTALLATION)
    assert answer.status_code == 200

    assert await flow.db.mobile_push_tokens.count_documents({"user_id": first["id"]}) == 0
    rows = await flow.db.mobile_push_tokens.find({"installation_id": INSTALLATION}, {"_id": 0}).to_list(10)
    assert [row["user_id"] for row in rows] == [second["id"]]
    # Die App-Sperre hängt am Gerät (#1053), nicht am Konto.
    assert rows[0]["private_content"] is True


@pytest.mark.asyncio
async def test_abmelden_merkt_den_zeitpunkt(flow):
    user = await flow.add_user(name="abmelder")
    flow.act_as(user)
    token = "ExponentPushToken[abmelden-000000001]"
    await _register(flow, token)
    answer = await flow.client.request("DELETE", "/api/mobile/push-token", json={"token": token})
    assert answer.status_code == 200
    row = await flow.db.mobile_push_tokens.find_one({"token": token}, {"_id": 0})
    assert row["enabled"] is False
    assert row["disabled_at"]


async def _token(flow, token, user_id, *, enabled=True, disabled_days=None, updated_days=0, **extra):
    now = now_utc()
    row = {"token": token, "user_id": user_id, "platform": "android", "enabled": enabled,
           "updated_at": (now - timedelta(days=updated_days)).isoformat(), "created_at": (now - timedelta(days=90)).isoformat(), **extra}
    if disabled_days is not None:
        row["disabled_at"] = (now - timedelta(days=disabled_days)).isoformat()
    await flow.db.mobile_push_tokens.insert_one(row)


@pytest.mark.asyncio
async def test_abgeschaltete_geraete_verschwinden_nach_der_frist(flow):
    user = await flow.add_user(name="aufraeumen")
    await _token(flow, "ExponentPushToken[aus-seit-31-tagen]", user["id"], enabled=False, disabled_days=31)
    await _token(flow, "ExponentPushToken[aus-seit-29-tagen]", user["id"], enabled=False, disabled_days=29)
    # Vor #2467 abgemeldet: ohne Zeitpunkt zählt die letzte Änderung.
    await _token(flow, "ExponentPushToken[aus-ohne-zeitpunkt]", user["id"], enabled=False, updated_days=40)
    await _token(flow, "ExponentPushToken[aktiv-aber-alt-0001]", user["id"], updated_days=200)

    removed = await ops_alerts.purge_old_logs(flow.db)
    assert removed["push_devices"] == 2
    left = sorted(row["token"] for row in await flow.db.mobile_push_tokens.find({}, {"_id": 0, "token": 1}).to_list(10))
    assert left == ["ExponentPushToken[aktiv-aber-alt-0001]", "ExponentPushToken[aus-seit-29-tagen]"]

    # Ein zweiter Lauf ändert nichts mehr.
    again = await ops_alerts.purge_old_logs(flow.db)
    assert again["push_devices"] == 0

    # Die Frist ist einstellbar, wie die übrigen Aufbewahrungsfristen.
    settings = await ops_alerts.save_alert_settings(flow.db, {"retention_days": {"push_devices": 14}})
    assert settings["retention_days"]["push_devices"] == 14
    assert (await ops_alerts.purge_old_logs(flow.db))["push_devices"] == 1
    left = [row["token"] for row in await flow.db.mobile_push_tokens.find({}, {"_id": 0, "token": 1}).to_list(10)]
    assert left == ["ExponentPushToken[aktiv-aber-alt-0001]"]


@pytest.mark.asyncio
async def test_frist_vorgabe_ist_30_tage(flow):
    settings = await ops_alerts.load_alert_settings(flow.db)
    assert settings["retention_days"]["push_devices"] == 30


@pytest.mark.asyncio
async def test_alte_geraete_entfernen_nur_mit_recht_und_mit_protokoll(flow):
    admin = await flow.add_user(role="club_admin", name="systemadmin")
    turnier = await flow.add_user(role="tournament_admin", name="turnierleitung")
    target = await flow.add_user(name="viele-handys")
    other = await flow.add_user(name="andere-person")
    await _token(flow, "ExponentPushToken[ziel-aktiv-0000001]", target["id"])
    await _token(flow, "ExponentPushToken[ziel-alt-000000001]", target["id"], enabled=False, disabled_days=1)
    await _token(flow, "ExponentPushToken[ziel-alt-000000002]", target["id"], enabled=False, disabled_days=3)
    await _token(flow, "ExponentPushToken[andere-alt-0000001]", other["id"], enabled=False, disabled_days=1)

    url = f"/api/admin/mobile-push/old-devices/{target['id']}"
    for who in (target, turnier):
        flow.act_as(who)
        refused = await flow.delete(url)
        assert refused.status_code == 403
    assert await flow.db.mobile_push_tokens.count_documents({}) == 4
    assert await flow.db.audit_logs.count_documents({"action": "mobile_push.old_devices.remove"}) == 0

    flow.act_as(admin)
    answer = await flow.delete(url)
    assert answer.status_code == 200, answer.text
    assert answer.json() == {"ok": True, "removed": 2}
    left = sorted(row["token"] for row in await flow.db.mobile_push_tokens.find({}, {"_id": 0, "token": 1}).to_list(10))
    assert left == ["ExponentPushToken[andere-alt-0000001]", "ExponentPushToken[ziel-aktiv-0000001]"]

    log = await flow.db.audit_logs.find_one({"action": "mobile_push.old_devices.remove"}, {"_id": 0})
    assert log["actor_id"] == admin["id"]
    assert log["target_id"] == target["id"]
    assert log["data"] == {"removed": 2}

    missing = await flow.delete("/api/admin/mobile-push/old-devices/gibt-es-nicht")
    assert missing.status_code == 404


@pytest.mark.asyncio
async def test_verwaltung_trennt_aktive_und_alte_geraete(flow):
    admin = await flow.add_user(role="club_admin", name="sysadmin2")
    target = await flow.add_user(name="ein-aktives")
    await _token(flow, "ExponentPushToken[aktiv-0000000000001]", target["id"], updated_days=1)
    # Das zuletzt geänderte Gerät ist ein abgemeldetes mit Fehler - das ist kein Problem der Person.
    await _token(flow, "ExponentPushToken[alt-mit-fehler-0001]", target["id"], enabled=False, disabled_days=0,
                 last_receipt_status="error", last_receipt_error="DeviceNotRegistered")
    await _token(flow, "ExponentPushToken[alt-mit-fehler-0002]", target["id"], enabled=False, disabled_days=2, updated_days=2,
                 last_ticket_status="error", last_ticket_error="DeviceNotRegistered")
    flow.act_as(admin)

    users = (await flow.get("/api/admin/mobile-push/users")).json()
    row = next(item for item in users if item["id"] == target["id"])
    assert row["enabled_token_count"] == 1
    assert row["disabled_token_count"] == 2
    assert row["active_error"] is None

    status = (await flow.get(f"/api/admin/mobile-push/status/{target['id']}")).json()
    assert status["enabled_count"] == 1
    assert status["disabled_count"] == 2

    # Ein Fehler an einem aktiven Gerät bleibt sichtbar.
    await flow.db.mobile_push_tokens.update_one({"token": "ExponentPushToken[aktiv-0000000000001]"},
                                                {"$set": {"last_ticket_status": "error", "last_ticket_error": "MessageRateExceeded"}})
    users = (await flow.get("/api/admin/mobile-push/users")).json()
    row = next(item for item in users if item["id"] == target["id"])
    assert row["active_error"] == "MessageRateExceeded"


@pytest.mark.asyncio
async def test_kachel_zaehlt_nur_fehler_aktiver_geraete(flow):
    from services.push_notifications import mobile_push_health_summary

    user = await flow.add_user(name="kachel")
    await _token(flow, "ExponentPushToken[kachel-aktiv-00001]", user["id"])
    await _token(flow, "ExponentPushToken[kachel-alt-000001]", user["id"], enabled=False, disabled_days=1,
                 last_receipt_status="error", last_receipt_error="DeviceNotRegistered")
    summary = await mobile_push_health_summary()
    assert (summary["ticket_errors"], summary["receipt_errors"], summary["latest_problem"]) == (0, 0, None)
    assert summary["disabled_tokens"] == 1

    await flow.db.mobile_push_tokens.update_one({"token": "ExponentPushToken[kachel-aktiv-00001]"},
                                                {"$set": {"last_receipt_status": "error", "last_receipt_error": "MessageRateExceeded"}})
    summary = await mobile_push_health_summary()
    assert summary["receipt_errors"] == 1
    assert summary["latest_problem"]["last_receipt_error"] == "MessageRateExceeded"


class _Collection:
    """Reicht alles an die echte Collection weiter; vor dem ersten Aufräumen der Installation läuft ``before_cleanup``."""

    def __init__(self, real, before_cleanup):
        self._real = real
        self._before_cleanup = before_cleanup

    def __getattr__(self, name):
        return getattr(self._real, name)

    async def delete_many(self, query, *args, **kwargs):
        if "installation_id" in query and self._before_cleanup:
            hook, self._before_cleanup = self._before_cleanup, None
            await hook()
        return await self._real.delete_many(query, *args, **kwargs)


class _Db:
    def __init__(self, real, collection):
        self._real = real
        self.mobile_push_tokens = collection

    def __getattr__(self, name):
        return getattr(self._real, name)


@pytest.mark.asyncio
async def test_gleichzeitige_anmeldungen_derselben_installation_lassen_den_spaeteren_stehen(flow, monkeypatch):
    from routes import mobile_routes

    user = await flow.add_user(name="doppelt")
    # Ein früherer Token derselben Installation: beide Anmeldungen finden etwas zum Ersetzen.
    await _token(flow, "ExponentPushToken[gleichzeitig-alt-01]", user["id"], updated_days=10, installation_id=INSTALLATION)
    clock = iter([now_utc() - timedelta(seconds=2), now_utc() - timedelta(seconds=1)])
    monkeypatch.setattr(mobile_routes, "now_utc", lambda: next(clock))
    first = mobile_routes.MobilePushTokenCreate(token="ExponentPushToken[gleichzeitig-a-0001]", platform="android", installation_id=INSTALLATION)
    second = mobile_routes.MobilePushTokenCreate(token="ExponentPushToken[gleichzeitig-b-0001]", platform="android", installation_id=INSTALLATION)

    # A hat seinen Eintrag geschrieben; bevor A die alten Einträge der Installation löscht, läuft B ganz durch.
    async def second_runs_in_between():
        monkeypatch.setattr(mobile_routes, "get_db", lambda: flow.db)
        await mobile_routes.register_mobile_push_token(second, user)

    monkeypatch.setattr(mobile_routes, "get_db", lambda: _Db(flow.db, _Collection(flow.db.mobile_push_tokens, second_runs_in_between)))
    await mobile_routes.register_mobile_push_token(first, user)

    rows = await flow.db.mobile_push_tokens.find({"installation_id": INSTALLATION}, {"_id": 0, "token": 1}).to_list(10)
    assert [row["token"] for row in rows] == ["ExponentPushToken[gleichzeitig-b-0001]"]


@pytest.mark.asyncio
async def test_verwaltung_bekommt_die_installations_kennung_nicht(flow):
    admin = await flow.add_user(role="club_admin", name="sysadmin3")
    target = await flow.add_user(name="kennung-geheim")
    flow.act_as(target)
    await _register(flow, "ExponentPushToken[kennung-geheim-0001]", installation_id=INSTALLATION)

    flow.act_as(admin)
    for url in (f"/api/admin/mobile-push/status/{target['id']}", "/api/admin/mobile-push/users"):
        answer = await flow.get(url)
        assert answer.status_code == 200
        assert INSTALLATION not in answer.text
        assert "installation_id" not in answer.text


@pytest.mark.asyncio
async def test_erneutes_abmelden_verlaengert_die_frist_nicht(flow):
    user = await flow.add_user(name="doppelt-ab")
    flow.act_as(user)
    token = "ExponentPushToken[doppelt-abmelden-001]"
    await _register(flow, token)
    first = await flow.client.request("DELETE", "/api/mobile/push-token", json={"token": token})
    assert first.status_code == 200
    stamp = "2026-10-01T10:00:00+00:00"
    await flow.db.mobile_push_tokens.update_one({"token": token}, {"$set": {"disabled_at": stamp}})

    again = await flow.client.request("DELETE", "/api/mobile/push-token", json={"token": token})
    assert again.status_code == 200
    row = await flow.db.mobile_push_tokens.find_one({"token": token}, {"_id": 0})
    assert row["enabled"] is False
    assert row["disabled_at"] == stamp


@pytest.mark.asyncio
async def test_erneute_anmeldung_beendet_die_frist(flow):
    user = await flow.add_user(name="zurueck")
    flow.act_as(user)
    token = "ExponentPushToken[wieder-angemeldet-01]"
    await _token(flow, token, user["id"], enabled=False, disabled_days=40, updated_days=40)

    answer = await _register(flow, token)
    assert answer.status_code == 200
    row = await flow.db.mobile_push_tokens.find_one({"token": token}, {"_id": 0})
    assert row["enabled"] is True
    assert "disabled_at" not in row

    assert (await ops_alerts.purge_old_logs(flow.db))["push_devices"] == 0
    assert await flow.db.mobile_push_tokens.count_documents({"token": token}) == 1


@pytest.mark.asyncio
async def test_frist_unter_sieben_tagen_wird_abgelehnt(flow):
    with pytest.raises(ValueError):
        await ops_alerts.save_alert_settings(flow.db, {"retention_days": {"push_devices": 6}})
    assert (await ops_alerts.load_alert_settings(flow.db))["retention_days"]["push_devices"] == 30

    admin = await flow.add_user(role="club_admin", name="sysadmin4")
    flow.act_as(admin)
    refused = await flow.put("/api/admin/ops/alerts", json={"retention_days": {"push_devices": 3}})
    assert refused.status_code == 400
    accepted = await flow.put("/api/admin/ops/alerts", json={"retention_days": {"push_devices": 7}})
    assert accepted.status_code == 200
    assert (await ops_alerts.load_alert_settings(flow.db))["retention_days"]["push_devices"] == 7
