"""Einstellungen → Benachrichtigungen (#1204, #1206) über die echten Routen: Stufe und Themen als Sicht auf die gespeicherten
Schalter, die Ruhezeit am Konto - und jede Person ändert nur ihre eigenen Einstellungen."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow

from services.notification_preferences import level_preferences, mode_preferences


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.mark.asyncio
async def test_level_custom_choice_and_quiet_hours_round_trip(flow):
    anna = await flow.add_user(name="anna")
    flow.act_as(anna)
    res = await flow.get("/api/users/me/notification-preferences")
    assert res.status_code == 200, res.text
    # Altes Konto ohne Schalter und ohne Newsletter: keine Stufe passt genau.
    assert res.json()["level"] == "custom" and res.json()["quiet_hours"] == {"enabled": False, "start": "22:00", "end": "07:00"}

    res = await flow.patch("/api/users/me", json={"notification_preferences": level_preferences("important")})
    assert res.status_code == 200, res.text
    payload = (await flow.get("/api/users/me/notification-preferences")).json()
    assert payload["level"] == "important" and payload["topic_modes"]["achievements"] == "app"

    prefs = {**level_preferences("important"), **mode_preferences("news_events", "off")}
    await flow.patch("/api/users/me", json={"notification_preferences": prefs})
    payload = (await flow.get("/api/users/me/notification-preferences")).json()
    assert payload["level"] == "custom" and payload["topic_modes"]["news_events"] == "off"

    res = await flow.patch("/api/users/me", json={"quiet_hours": {"enabled": True, "start": "22:30", "end": "06:45"}})
    assert res.status_code == 200, res.text
    assert res.json()["quiet_hours"] == {"enabled": True, "start": "22:30", "end": "06:45"}
    payload = (await flow.get("/api/users/me/notification-preferences")).json()
    assert payload["quiet_hours"] == {"enabled": True, "start": "22:30", "end": "06:45"}
    for bad in ({"enabled": True, "start": "22:30", "end": "22:30"}, {"enabled": True, "start": "nachts", "end": "07:00"}):
        res = await flow.patch("/api/users/me", json={"quiet_hours": bad})
        assert res.status_code == 422, res.text
    stored = await flow.db.users.find_one({"id": anna["id"]}, {"_id": 0, "quiet_hours": 1})
    assert stored == {"quiet_hours": {"enabled": True, "start": "22:30", "end": "06:45"}}


@pytest.mark.asyncio
async def test_partial_quiet_hours_patch_changes_only_what_is_sent(flow):
    """Ein Teil-PATCH (#1206): nur die gesendeten Felder ändern sich - Anzeige und Wirkung bleiben gleich."""
    anna = await flow.add_user(name="anna")
    flow.act_as(anna)

    async def stored():
        return await flow.db.users.find_one({"id": anna["id"]}, {"_id": 0, "quiet_hours": 1})

    # Nur einschalten: der Vorschlag wird mitgespeichert - gezeigt wird, was auch wirkt.
    res = await flow.patch("/api/users/me", json={"quiet_hours": {"enabled": True}})
    assert res.status_code == 200, res.text
    assert (await stored())["quiet_hours"] == {"enabled": True, "start": "22:00", "end": "07:00"}
    # Eigene Zeiten, dann nur ausschalten: die Zeiten bleiben.
    await flow.patch("/api/users/me", json={"quiet_hours": {"start": "23:00", "end": "06:30"}})
    res = await flow.patch("/api/users/me", json={"quiet_hours": {"enabled": False}})
    assert res.status_code == 200, res.text
    assert (await stored())["quiet_hours"] == {"enabled": False, "start": "23:00", "end": "06:30"}
    # Nur den Beginn ändern: das gespeicherte Ende gilt weiter (früher fiel es auf 07:00 zurück und scheiterte).
    res = await flow.patch("/api/users/me", json={"quiet_hours": {"enabled": True, "start": "07:00"}})
    assert res.status_code == 200, res.text
    assert (await stored())["quiet_hours"] == {"enabled": True, "start": "07:00", "end": "06:30"}
    # Weniger als 15 Minuten Lücke: abgelehnt, mit Grund - und nichts geändert.
    res = await flow.patch("/api/users/me", json={"quiet_hours": {"start": "06:40"}})
    assert res.status_code == 422 and "15 Minuten" in res.json()["detail"]
    assert (await stored())["quiet_hours"] == {"enabled": True, "start": "07:00", "end": "06:30"}
    payload = (await flow.get("/api/users/me/notification-preferences")).json()
    assert payload["quiet_hours"] == {"enabled": True, "start": "07:00", "end": "06:30"}


@pytest.mark.asyncio
async def test_only_own_settings(flow):
    """Die Verwaltung setzt fremde Profile nur zurück (#2118) - Stufe, Themen und Ruhezeit ändert nur die Person selbst."""
    anna = await flow.add_user(name="anna")
    admin = await flow.add_user(role="superadmin", name="root")
    flow.act_as(admin)
    res = await flow.patch(f"/api/users/{anna['id']}", json={"quiet_hours": {"enabled": True, "start": "22:00", "end": "07:00"},
                                                             "notification_preferences": level_preferences("few")})
    assert res.status_code == 422, res.text
    res = await flow.patch("/api/users/me", json={"quiet_hours": {"enabled": True, "start": "21:00", "end": "08:00"}})
    assert res.status_code == 200
    stored = await flow.db.users.find_one({"id": anna["id"]}, {"_id": 0, "quiet_hours": 1, "notification_preferences": 1})
    assert stored == {}, "Annas Konto bleibt unberührt"
    # Die Ansicht der Einstellungen zeigt immer das eigene Konto.
    flow.act_as(anna)
    assert (await flow.get("/api/users/me/notification-preferences")).json()["quiet_hours"]["enabled"] is False
    flow.act_as(None)
    assert (await flow.get("/api/users/me/notification-preferences")).status_code == 401


@pytest.mark.asyncio
async def test_a_new_account_starts_with_all(flow, monkeypatch):
    """Website, App, Google und Einladung legen Konten an - geprüft über die Registrierung der App (ohne Formular-Token)."""
    from services.notification_preferences import notification_level

    monkeypatch.setenv("JWT_SECRET", "notification-settings-tests-secret-with-32-characters")
    res = await flow.post("/api/auth/mobile/register", json={
        "username": "neuerloewe", "email": "neu-1204@lionsquad-test.at", "password": "Passwort-123!",
        "accept_privacy": True, "accept_terms": True,
    })
    assert res.status_code == 200, res.text
    stored = await flow.db.users.find_one({"username": "neuerloewe"}, {"_id": 0})
    assert stored["notification_preferences"] == level_preferences("all")
    assert notification_level(stored) == "all"
    # Die Verwaltung legt ein Konto per Einladung an - auch das startet mit „Alles“.
    flow.act_as(await flow.add_user(role="superadmin", name="root"))
    res = await flow.post("/api/users", json={"username": "eingeladen", "email": "eingeladen@lionsquad-test.at", "role": "player"})
    assert res.status_code in (200, 201), res.text
    invited = await flow.db.users.find_one({"username": "eingeladen"}, {"_id": 0, "notification_preferences": 1})
    assert invited["notification_preferences"] == level_preferences("all")
