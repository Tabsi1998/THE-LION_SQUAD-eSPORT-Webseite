"""Die Anmelde-Schalter der Verwaltung wirken (#2395, übernommen aus den Live-Dateien test_iter10_auth_settings.py,
test_iter6_google_gallery.py und test_iter7_fixes.py).

Vertrag, über die echten Routen gegen die Datenbank im Speicher:
- Die Schalter liest und ändert nur der Superadmin; gespeichert heißt: die Verwaltung und die öffentliche Seite sehen
  denselben Stand.
- Registrierung aus: ein neues Konto wird abgewiesen, wieder an: es geht.
- Google-Login aus: die Anmeldung mit Google ist abgewiesen; Google-Verknüpfung aus: das Verknüpfen ebenso. Beides
  verlangt für das Verknüpfen eine Anmeldung.
- Scheitert die Prüfung bei Google, gibt es keine Anmelde-Cookies.
- Google trennen geht nur, wenn das Konto noch ein Passwort hat - sonst sperrte man sich aus.
Erfundene Konten, Testpasswörter und eine erfundene Google-Kennung.

Ersetzt:
- test_iter10_auth_settings.py::TestAuthSettingsEndpoint::test_get_requires_admin
- test_iter10_auth_settings.py::TestAuthSettingsEndpoint::test_get_returns_four_booleans
- test_iter10_auth_settings.py::TestAuthSettingsEndpoint::test_put_persists_and_public_reflects
- test_iter10_auth_settings.py::TestEnforcement (beide Fälle)
- test_iter10_auth_settings.py::TestGoogleLinkGuards::test_link_requires_auth
- test_iter10_auth_settings.py::TestGoogleLinkGuards::test_link_disabled_returns_403
- test_iter10_auth_settings.py::TestGoogleLinkGuards::test_unlink_local_account_ok
- test_iter10_auth_settings.py::TestGoogleLinkGuards::test_unlink_requires_auth
- test_iter10_auth_settings.py::test_public_settings_contains_all_flags
- test_iter6_google_gallery.py::TestGoogleSession::test_bogus_session_id (heute ``credential`` statt ``session_id``)
- test_iter6_google_gallery.py::TestGoogleSession::test_no_cookies_issued_on_failure
- test_iter7_fixes.py::TestGoogleSessionGuard::test_bogus_session_id_returns_401
- test_iter7_fixes.py::TestGoogleSessionGuard::test_no_cookie_on_failure
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from spam_forms import form_fields  # noqa: E402

import auth  # noqa: E402
from routes import auth_routes  # noqa: E402
from services.google_identity import GoogleIdentityError  # noqa: E402

SWITCHES = ("password_login_enabled", "registration_enabled", "google_login_enabled", "google_linking_enabled")
CLIENT_ID = "123456789-loewen.apps.googleusercontent.com"
PASSWORD = "Schalter-Testpasswort-7"


@pytest_asyncio.fixture
async def flow(monkeypatch):
    async def no_mail(*args, **kwargs):
        return {"ok": True}

    def google_says_no(credential, client_id):
        raise GoogleIdentityError("Google-Anmeldung konnte nicht bestätigt werden.")

    monkeypatch.setattr(auth_routes, "send_template", no_mail)
    # Nie ins Netz: Google lehnt jede Kennung ab, die Route übersetzt das wie im Betrieb.
    monkeypatch.setattr(auth_routes, "verify_google_credential", google_says_no)
    monkeypatch.setenv("JWT_SECRET", "auth-switches-secret-with-at-least-32-characters")
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def switch(flow, **values) -> dict:
    flow.act_as(await flow.add_user(role="superadmin", name="root"))
    response = await flow.put("/api/settings/auth", json=values)
    assert response.status_code == 200, response.text
    flow.act_as(None)
    return response.json()


async def account(flow, *, password: bool) -> dict:
    user = await flow.add_user(role="player", name="loewe")
    fields = {"google_id": f"g-{new_id()[:8]}", "google_email": user["email"], "google_linked": True,
              "password_login_available": password, "auth_provider": "hybrid" if password else "google",
              **auth.password_fields(PASSWORD)}
    await flow.db.users.update_one({"id": user["id"]}, {"$set": fields})
    return {**user, **fields}


def registration() -> dict:
    name = f"loewe{new_id()[:6]}"
    return {"username": name, "email": f"{name}@example.com", "password": PASSWORD, "display_name": name,
            "accept_privacy": True, "accept_terms": True, **form_fields("register")}


@pytest.mark.asyncio
async def test_only_the_superadmin_reads_and_changes_the_switches_and_the_public_page_follows(flow):
    flow.act_as(None)
    assert (await flow.get("/api/settings/auth")).status_code == 401
    for role in ("player", "club_admin"):
        flow.act_as(await flow.add_user(role=role))
        assert (await flow.get("/api/settings/auth")).status_code == 403, role
        assert (await flow.put("/api/settings/auth", json={"registration_enabled": False})).status_code == 403, role

    saved = await switch(flow, google_client_id=CLIENT_ID, google_login_enabled=True, google_linking_enabled=True)
    assert all(isinstance(saved[key], bool) for key in SWITCHES) and "_id" not in saved
    assert saved["google_linking_enabled"] is True

    saved = await switch(flow, google_linking_enabled=False)
    assert saved["google_linking_enabled"] is False and saved["google_login_enabled"] is True, "nur der eine Schalter"
    public = (await flow.get("/api/settings/public")).json()
    assert {key: public[key] for key in SWITCHES} == {key: saved[key] for key in SWITCHES}


@pytest.mark.asyncio
async def test_registration_switch_closes_and_opens_sign_up(flow):
    await switch(flow, registration_enabled=False)
    body = registration()
    refused = await flow.post("/api/auth/register", json=body)
    assert refused.status_code == 403, refused.text
    assert await flow.db.users.count_documents({"email": body["email"]}) == 0

    await switch(flow, registration_enabled=True)
    created = await flow.post("/api/auth/register", json=body)
    assert created.status_code == 200, created.text
    assert await flow.db.users.count_documents({"email": body["email"]}) == 1


@pytest.mark.asyncio
async def test_google_switches_close_login_and_linking_and_a_failed_check_sets_no_cookie(flow):
    user = await account(flow, password=True)
    await switch(flow, google_client_id=CLIENT_ID, google_login_enabled=False, google_linking_enabled=False)
    refused = await flow.post("/api/auth/google/session", json={"credential": "beliebig"})
    assert refused.status_code == 403, refused.text
    assert (await flow.post("/api/auth/google/link", json={"credential": "beliebig"})).status_code == 401, "nur angemeldet"
    flow.act_as(user)
    assert (await flow.post("/api/auth/google/link", json={"credential": "beliebig"})).status_code == 403

    await switch(flow, google_login_enabled=True)
    flow.client.cookies.clear()
    failed = await flow.post("/api/auth/google/session", json={"credential": "gefaelscht"})
    assert failed.status_code == 401, failed.text
    assert not failed.headers.get_list("set-cookie"), "keine Anmeldung ohne bestätigte Google-Kennung"
    assert "access_token" not in flow.client.cookies


@pytest.mark.asyncio
async def test_google_can_only_be_unlinked_while_a_password_remains(flow):
    assert (await flow.post("/api/auth/google/unlink", json={})).status_code == 401

    hybrid = await account(flow, password=True)
    flow.act_as(hybrid)
    response = await flow.post("/api/auth/google/unlink", json={})
    assert response.status_code == 200 and response.json() == {"ok": True}
    stored = await flow.db.users.find_one({"id": hybrid["id"]}, {"_id": 0})
    assert stored["google_linked"] is False and stored["google_id"] is None

    google_only = await account(flow, password=False)
    flow.act_as(google_only)
    refused = await flow.post("/api/auth/google/unlink", json={})
    assert refused.status_code == 400, refused.text
    stored = await flow.db.users.find_one({"id": google_only["id"]}, {"_id": 0})
    assert stored["google_linked"] is True and stored["google_id"] == google_only["google_id"]
