"""Angemeldete Geräte und das Erneuern der Anmeldung (#2395, übernommen aus den Live-Dateien test_iter11_refresh_race.py
und test_iter12_sessions_growth.py).

Vertrag, über die echten Routen und die echte Anmelde-Prüfung (ohne die Abkürzung des Flow-Harness), jeder Browser mit
eigenen Cookies:
- Die Geräteliste zeigt jede Anmeldung; genau eine ist „dieses Gerät“, und zwar aus Sicht des fragenden Browsers.
- „Überall sonst abmelden“ beendet die anderen Anmeldungen und lässt diese stehen.
- Ein einzelnes Gerät lässt sich abmelden; eine fremde oder unbekannte Anmeldung ist 404 und bleibt unberührt.
- Ein Zugangs-Cookie gilt nach dem Erneuern weiter, solange die Anmeldung selbst besteht.
- Erneuern ohne, mit kaputtem oder gefälschtem Erneuerungs-Cookie ist 401; ohne CSRF-Kopfzeile 403.
- Dasselbe alte Erneuerungs-Cookie noch einmal: im kurzen Fenster vom selben Browser harmlos, danach Diebstahl - die
  ganze Anmeldung endet.
Erfundene Konten und Testpasswörter.

Ersetzt:
- test_iter11_refresh_race.py::TestConcurrentRefresh::test_old_token_replay_after_grace_is_rejected_and_family_revoked
- test_iter11_refresh_race.py::TestRefreshSecurity::test_garbage_refresh_token_rejected
- test_iter11_refresh_race.py::TestRefreshSecurity::test_forged_refresh_token_rejected
- test_iter11_refresh_race.py::TestRefreshSecurity::test_no_refresh_cookie_returns_401
- test_iter11_refresh_race.py::TestRefreshSecurity::test_refresh_requires_csrf_header
- test_iter12_sessions_growth.py::TestSessionsList::test_sessions_list_has_current
- test_iter12_sessions_growth.py::TestSessionsList::test_second_login_appears_as_extra_session
- test_iter12_sessions_growth.py::TestSessionsList::test_sessions_requires_auth
- test_iter12_sessions_growth.py::TestRefreshRegression::test_old_access_token_survives_rotation
- test_iter12_sessions_growth.py::TestSessionRevocation::test_logout_all_keeps_current_kills_others
- test_iter12_sessions_growth.py::TestSessionRevocation::test_single_session_revoke
- test_iter12_sessions_growth.py::TestSessionRevocation::test_revoke_unknown_session_404
- test_iter12_sessions_growth.py::TestSessionRevocation::test_revoke_other_users_session_404
"""
import pathlib
import sys
from datetime import datetime, timedelta, timezone

import jwt
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import load_application, make_flow, new_id  # noqa: E402

import auth  # noqa: E402
from routes import auth_routes  # noqa: E402

PASSWORD = "Geraete-Testpasswort-7"


@pytest_asyncio.fixture
async def flow(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "session-devices-secret-with-at-least-32-characters")
    instance, shutdown = make_flow()
    # Die echte Anmelde-Prüfung statt der Abkürzung: Cookie und Sitzung entscheiden, nicht flow.user.
    _database, server, get_current_user, get_optional_user = load_application()
    server.app.dependency_overrides.pop(get_current_user, None)
    server.app.dependency_overrides.pop(get_optional_user, None)
    browsers: list[AsyncClient] = []

    def browser(user_agent: str) -> AsyncClient:
        """Ein eigener Browser: eigene Cookies, eigene Kennung des Programms."""
        client = AsyncClient(transport=ASGITransport(app=server.app), base_url="http://testserver",
                             headers={"User-Agent": user_agent})
        browsers.append(client)
        return client

    instance.browser = browser
    try:
        yield instance
    finally:
        for client in browsers:
            await client.aclose()
        await shutdown()


async def account(flow, name: str) -> dict:
    username = f"{name}-{new_id()[:6]}"
    user = {
        "id": new_id(), "username": username, "display_name": name, "email": f"{username}@example.com",
        "role": "player", "roles": ["player"], "is_active": True, "is_banned": False,
        "email_verified": True, "mfa_enabled": False, **auth.password_fields(PASSWORD),
        "password_login_available": True, "privacy_policy_version": "2026-08-26",
    }
    await flow.db.users.insert_one(dict(user))
    return user


async def signed_in(flow, user: dict, user_agent: str) -> AsyncClient:
    client = flow.browser(user_agent)
    response = await client.post("/api/auth/login", json={"email": user["email"], "password": PASSWORD})
    assert response.status_code == 200, response.text[:300]
    assert client.cookies.get("refresh_token") and client.cookies.get("csrf_token")
    return client


def put_cookie(client: AsyncClient, name: str, value: str) -> None:
    """Ein Cookie ersetzen wie ein Browser - unter derselben Adresse, unter der die Antworten es setzen."""
    client.cookies.delete(name)
    client.cookies.set(name, value, domain="testserver.local")


def csrf(client: AsyncClient) -> dict:
    return {"X-CSRF-Token": client.cookies.get("csrf_token")}


async def who(client: AsyncClient) -> str | None:
    response = await client.get("/api/auth/me")
    assert response.status_code == 200, response.text[:200]
    return (response.json() or {}).get("id")


async def sessions(client: AsyncClient) -> list[dict]:
    response = await client.get("/api/auth/sessions")
    assert response.status_code == 200, response.text[:200]
    return response.json()


@pytest.mark.asyncio
async def test_each_browser_sees_every_device_and_itself_as_this_device(flow):
    user = await account(flow, "geraete")
    first = await signed_in(flow, user, "Browser-A/1.0")
    second = await signed_in(flow, user, "Browser-B/1.0")

    rows = await sessions(first)
    assert len(rows) == 2
    current = [row for row in rows if row["current"]]
    assert len(current) == 1 and current[0]["user_agent"] == "Browser-A/1.0"
    assert {"id", "created_at", "last_active", "user_agent", "ip", "client", "expires_at"} <= set(current[0])
    assert all("_id" not in row for row in rows)
    assert [row["user_agent"] for row in await sessions(second) if row["current"]] == ["Browser-B/1.0"]

    guest = flow.browser("Gast/1.0")
    assert (await guest.get("/api/auth/sessions")).status_code == 401


@pytest.mark.asyncio
async def test_signing_out_everywhere_else_keeps_only_this_browser(flow):
    user = await account(flow, "ueberall")
    here = await signed_in(flow, user, "Browser-A/1.0")
    phone = await signed_in(flow, user, "Browser-B/1.0")
    laptop = await signed_in(flow, user, "Browser-C/1.0")

    response = await here.post("/api/auth/sessions/logout-all", headers=csrf(here))
    assert response.status_code == 200, response.text[:300]
    assert response.json()["ok"] is True and response.json()["revoked_sessions"] == 2

    assert await who(here) == user["id"]
    assert await who(phone) is None and await who(laptop) is None
    assert (await phone.post("/api/auth/refresh", headers=csrf(phone))).status_code == 401
    rows = await sessions(here)
    assert len(rows) == 1 and rows[0]["current"] is True


@pytest.mark.asyncio
async def test_one_device_signs_out_and_foreign_or_unknown_sessions_stay_404(flow):
    user = await account(flow, "einzeln")
    here = await signed_in(flow, user, "Browser-A/1.0")
    there = await signed_in(flow, user, "Browser-B/1.0")
    stranger = await account(flow, "fremd")
    elsewhere = await signed_in(flow, stranger, "Browser-F/1.0")

    target = next(row["id"] for row in await sessions(here) if not row["current"])
    response = await here.delete(f"/api/auth/sessions/{target}", headers=csrf(here))
    assert response.status_code == 200, response.text[:300]
    assert response.json() == {"ok": True, "current": False}
    assert await who(there) is None
    assert await who(here) == user["id"]
    assert target not in [row["id"] for row in await sessions(here)]

    unknown = await here.delete("/api/auth/sessions/gibt-es-nicht", headers=csrf(here))
    assert unknown.status_code == 404
    foreign = (await sessions(elsewhere))[0]["id"]
    refused = await here.delete(f"/api/auth/sessions/{foreign}", headers=csrf(here))
    assert refused.status_code == 404, "eine fremde Anmeldung gibt es für diese Person nicht"
    assert await who(elsewhere) == stranger["id"]


@pytest.mark.asyncio
async def test_the_access_cookie_still_works_right_after_a_refresh(flow):
    user = await account(flow, "weiter")
    client = await signed_in(flow, user, "Browser-A/1.0")
    old_access = client.cookies.get("access_token")

    renewed = await client.post("/api/auth/refresh", headers=csrf(client))
    assert renewed.status_code == 200, renewed.text[:300]

    # Ein zweiter Reiter hatte noch das Zugangs-Cookie von vorher.
    tab = flow.browser("Browser-A/1.0")
    put_cookie(tab, "access_token", old_access)
    assert await who(tab) == user["id"], "das Erneuern beendet die Anmeldung nicht"


@pytest.mark.asyncio
async def test_refresh_without_a_valid_token_or_csrf_header_is_refused(flow):
    user = await account(flow, "falsch")
    client = await signed_in(flow, user, "Browser-A/1.0")
    good = client.cookies.get("refresh_token")

    without = flow.browser("Browser-A/1.0")
    assert (await without.post("/api/auth/refresh")).status_code == 401

    put_cookie(client, "refresh_token", "kein.echter.token")
    assert (await client.post("/api/auth/refresh", headers=csrf(client))).status_code == 401
    forged = jwt.encode({"sub": user["id"], "jti": "gefaelscht", "fid": "gefaelscht", "type": "refresh",
                         "exp": datetime.now(timezone.utc) + timedelta(days=1)},
                        "ein-ganz-anderer-schluessel-mit-mindestens-32-zeichen", algorithm="HS256")
    put_cookie(client, "refresh_token", forged)
    assert (await client.post("/api/auth/refresh", headers=csrf(client))).status_code == 401

    put_cookie(client, "refresh_token", good)
    assert (await client.post("/api/auth/refresh")).status_code == 403, "ohne CSRF-Kopfzeile kein Erneuern"
    assert (await client.post("/api/auth/refresh", headers=csrf(client))).status_code == 200, "das echte Cookie gilt weiter"


@pytest.mark.asyncio
async def test_an_old_refresh_cookie_after_the_short_window_ends_the_whole_sign_in(flow, monkeypatch):
    user = await account(flow, "spaet")
    client = await signed_in(flow, user, "Browser-A/1.0")
    old_refresh = client.cookies.get("refresh_token")
    header = csrf(client)

    first = await client.post("/api/auth/refresh", headers=header)
    assert first.status_code == 200, first.text[:300]
    rotated = client.cookies.get("refresh_token")
    assert rotated and rotated != old_refresh

    # Gleich danach noch einmal (zweiter Reiter, Wiederholung): harmlos, derselbe Ersatz.
    late = flow.browser("Browser-A/1.0")
    put_cookie(late, "refresh_token", old_refresh)
    put_cookie(late, "csrf_token", header["X-CSRF-Token"])
    again = await late.post("/api/auth/refresh", headers=header)
    assert again.status_code == 200, again.text[:300]
    assert late.cookies.get("refresh_token") == rotated

    # Elf Sekunden später ist dasselbe alte Cookie kein Versehen mehr.
    real_datetime = auth_routes.datetime

    class Later(datetime):
        @classmethod
        def now(cls, tz=None):
            return real_datetime.now(tz) + timedelta(seconds=auth_routes.REFRESH_REPLAY_GRACE_SECONDS + 1)

    monkeypatch.setattr(auth_routes, "datetime", Later)
    put_cookie(late, "refresh_token", old_refresh)
    replay = await late.post("/api/auth/refresh", headers=csrf(late))
    assert replay.status_code == 401
    monkeypatch.setattr(auth_routes, "datetime", real_datetime)

    assert (await client.post("/api/auth/refresh", headers=csrf(client))).status_code == 401, "die ganze Anmeldung ist beendet"
    assert await who(client) is None
