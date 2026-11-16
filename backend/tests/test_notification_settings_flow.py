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


def _expected(newsletter: bool) -> dict:
    """Neue Konten (#1204, M5): Stufe „Alles“ - News & Events ohne Newsletter-Haken nur in der Glocke."""
    prefs = level_preferences("all")
    if not newsletter:
        prefs.update(mode_preferences("news_events", "app"))
    return prefs


async def _check_new_account(flow, query: dict, newsletter: bool):
    from services.notification_preferences import notification_level, topic_modes

    stored = await flow.db.users.find_one(query, {"_id": 0})
    assert stored is not None, query
    assert stored["notification_preferences"] == _expected(newsletter)
    assert bool(stored.get("newsletter_consent")) is newsletter
    assert topic_modes(stored)["news_events"] == ("push" if newsletter else "app")
    assert topic_modes(stored)["achievements"] == "push"
    # Ohne Haken zeigt das Konto „Eigene Auswahl“ - so gewollt.
    assert notification_level(stored) == ("all" if newsletter else "custom")


@pytest.fixture
def secrets_and_google(monkeypatch):
    from routes import auth_routes

    monkeypatch.setenv("JWT_SECRET", "notification-settings-tests-secret-with-32-characters")
    real = auth_routes.load_auth_settings

    async def settings(db=None):
        data = await real(db)
        return {**data, "google_login_enabled": True, "google_client_id": "test-client", "registration_enabled": True,
                "google_registration_enabled": True}

    who = {"email": "", "id": ""}

    async def identity(_credential, _client_id):
        return {"email": who["email"], "id": who["id"], "name": "Neu Hier"}

    monkeypatch.setattr(auth_routes, "load_auth_settings", settings)
    monkeypatch.setattr(auth_routes, "_resolve_google_identity", identity)
    return who


@pytest.mark.asyncio
@pytest.mark.parametrize("newsletter", [True, False])
async def test_a_new_account_starts_with_all_news_only_with_consent(flow, secrets_and_google, newsletter):
    """Alle vier Wege: Website, App, Google und Einladung durch die Verwaltung - je mit und ohne Newsletter-Haken."""
    from spam_forms import form_fields

    tag = "mit" if newsletter else "ohne"
    # Website
    res = await flow.post("/api/auth/register", json={
        "username": f"web{tag}", "email": f"web-{tag}@lionsquad-test.at", "password": "Passwort-123!",
        "accept_privacy": True, "accept_terms": True, "newsletter_consent": newsletter, **form_fields("register"),
    })
    assert res.status_code == 200, res.text
    await _check_new_account(flow, {"username": f"web{tag}"}, newsletter)
    # App
    res = await flow.post("/api/auth/mobile/register", json={
        "username": f"app{tag}", "email": f"app-{tag}@lionsquad-test.at", "password": "Passwort-123!",
        "accept_privacy": True, "accept_terms": True, "newsletter_consent": newsletter,
    })
    assert res.status_code == 200, res.text
    await _check_new_account(flow, {"username": f"app{tag}"}, newsletter)
    # Google
    secrets_and_google.update(email=f"google-{tag}@lionsquad-test.at", id=f"google-{tag}")
    res = await flow.post("/api/auth/google/session", json={
        "credential": "x", "intent": "register", "accept_privacy": True, "accept_terms": True, "newsletter_consent": newsletter,
    })
    assert res.status_code == 200, res.text
    await _check_new_account(flow, {"google_id": f"google-{tag}"}, newsletter)


@pytest.mark.asyncio
async def test_an_invited_account_has_news_only_in_the_bell(flow):
    """Die Einladung durch die Verwaltung hat keine Newsletter-Zustimmung - News & Events nur in der Glocke."""
    flow.act_as(await flow.add_user(role="superadmin", name="root"))
    res = await flow.post("/api/users", json={"username": "eingeladen", "email": "eingeladen@lionsquad-test.at", "role": "player"})
    assert res.status_code in (200, 201), res.text
    await _check_new_account(flow, {"username": "eingeladen"}, False)
