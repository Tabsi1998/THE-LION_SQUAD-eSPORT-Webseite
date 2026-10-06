"""App-Sitzungen (#942) durch die echte Anwendung: „Angemeldet bleiben“ zählt auch in der App, das Gerät steht in der
Sitzungsliste, ein Neu-Login desselben Geräts schließt die alte Sitzung, dasselbe Gerät darf eine gerade gedrehte
Erneuerung länger wiederholen, und App-Sitzungen ohne Aktivität seit 30 Tagen werden geschlossen."""
import pathlib
import sys
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from auth import REMEMBER_DAYS, SESSION_ONLY_HOURS, _decode, hash_password, token_remembers  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from routes import auth_routes  # noqa: E402
from services.auth_sessions import purge_stale_app_sessions  # noqa: E402

PASSWORD = "pw-42"
# Kopfzeilen sind ASCII: die App baut den Namen als „Modell / System“ (deviceIdentity.ts).
PIXEL = {"User-Agent": "okhttp/4.12.0", "X-Device-Id": "geraet-pixel-9", "X-Device-Name": "Pixel 9 / Android 16"}
TABLET = {"User-Agent": "okhttp/4.12.0", "X-Device-Id": "geraet-tab-s9", "X-Device-Name": "Galaxy Tab S9 / Android 15"}


@pytest_asyncio.fixture
async def flow(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "login-tests-secret-with-at-least-32-characters")
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def account(flow, name="app"):
    user = await flow.add_user(role="player", name=name)
    update = {"email": f"{name}@lionsquad-test.at", "email_verified": True, "password_hash": hash_password(PASSWORD), "mfa_enabled": False}
    await flow.db.users.update_one({"id": user["id"]}, {"$set": update})
    user.update(update)
    return user


async def app_login(flow, user, headers=PIXEL, **body):
    flow.act_as(None)
    response = await flow.post("/api/auth/mobile/login", json={"email": user["email"], "password": PASSWORD, **body}, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


async def sessions_of(flow, user):
    flow.act_as(user)
    return (await flow.get("/api/auth/sessions")).json()


@pytest.mark.asyncio
async def test_the_app_sends_remember_and_gets_24_hours_without_the_tick(flow):
    user = await account(flow)
    kept = await app_login(flow, user)
    assert token_remembers(_decode(kept["refresh_token"])) is True, "ohne Angabe: angemeldet bleiben, wie bisher"
    short = await app_login(flow, user, headers=TABLET, remember=False)
    assert token_remembers(_decode(short["refresh_token"])) is False
    now = datetime.now(timezone.utc)
    rows = {row["device"]: row for row in await sessions_of(flow, user)}
    assert datetime.fromisoformat(rows["Pixel 9 / Android 16"]["expires_at"]) - now > timedelta(days=REMEMBER_DAYS - 1)
    assert datetime.fromisoformat(rows["Galaxy Tab S9 / Android 15"]["expires_at"]) - now <= timedelta(hours=SESSION_ONLY_HOURS)
    assert all(row["client"] == "mobile" for row in rows.values())


@pytest.mark.asyncio
async def test_a_new_login_of_the_same_device_closes_its_old_session_and_keeps_the_others(flow):
    user = await account(flow)
    first = await app_login(flow, user)
    other = await app_login(flow, user, headers=TABLET)
    again = await app_login(flow, user)
    rows = await sessions_of(flow, user)
    assert [row["device"] for row in rows].count("Pixel 9 / Android 16") == 1, "nicht je Tag eine neue Zeile für dasselbe Handy"
    assert any(row["device"] == "Galaxy Tab S9 / Android 15" for row in rows), "ein anderes Gerät bleibt angemeldet"
    closed = await flow.db.refresh_tokens.find_one({"token_hash": auth_routes.hash_token(first["refresh_token"])})
    assert closed["revoked"] is True and closed["revocation_reason"] == "device_relogin"
    flow.act_as(None)
    assert (await flow.post("/api/auth/mobile/refresh", json={"refresh_token": first["refresh_token"]}, headers=PIXEL)).status_code == 401
    assert (await flow.post("/api/auth/mobile/refresh", json={"refresh_token": other["refresh_token"]}, headers=TABLET)).status_code == 200
    assert (await flow.post("/api/auth/mobile/refresh", json={"refresh_token": again["refresh_token"]}, headers=PIXEL)).status_code == 200
    # Ohne Gerätekennung (ältere App): keine Rückschlüsse, nichts wird geschlossen.
    bare = {"User-Agent": "okhttp/4.12.0"}
    await app_login(flow, user, headers=bare)
    await app_login(flow, user, headers=bare)
    assert len(await sessions_of(flow, user)) == 4


@pytest.mark.asyncio
async def test_the_same_device_may_repeat_a_rotation_within_a_minute_but_a_stranger_may_not(flow, monkeypatch):
    user = await account(flow)
    login = await app_login(flow, user)
    flow.act_as(None)
    first = await flow.post("/api/auth/mobile/refresh", json={"refresh_token": login["refresh_token"]}, headers=PIXEL)
    assert first.status_code == 200
    # 40 Sekunden später kommt derselbe alte Token noch einmal vom selben Gerät (Start der App bei schlechtem Netz).
    real_now = auth_routes.datetime

    class Later(datetime):
        @classmethod
        def now(cls, tz=None):
            return real_now.now(tz) + timedelta(seconds=40)

    monkeypatch.setattr(auth_routes, "datetime", Later)
    repeat = await flow.post("/api/auth/mobile/refresh", json={"refresh_token": login["refresh_token"]}, headers=PIXEL)
    assert repeat.status_code == 200, "dasselbe Gerät bekommt denselben Ersatz, die Familie bleibt"
    assert repeat.json()["refresh_token"] == first.json()["refresh_token"]
    # Ein fremdes Gerät mit dem alten Token - auch 40 Sekunden danach: Diebstahl, die ganze Familie fliegt
    # (das kurze Fenster von zehn Sekunden gilt wie bisher für jeden mit derselben Kennung des Programms).
    stranger = await flow.post("/api/auth/mobile/refresh", json={"refresh_token": login["refresh_token"]}, headers=TABLET)
    assert stranger.status_code == 401
    monkeypatch.setattr(auth_routes, "datetime", real_now)
    assert (await flow.post("/api/auth/mobile/refresh", json={"refresh_token": first.json()["refresh_token"]}, headers=PIXEL)).status_code == 401
    family = await flow.db.refresh_tokens.find_one({"token_hash": auth_routes.hash_token(first.json()["refresh_token"])})
    assert family["revocation_reason"] == "refresh_reuse"


@pytest.mark.asyncio
async def test_app_sessions_without_activity_for_30_days_are_closed_web_sessions_are_not(flow):
    user = await account(flow)
    old = await app_login(flow, user)
    fresh = await app_login(flow, user, headers=TABLET)
    flow.client.cookies.clear()
    web = await flow.post("/api/auth/login", json={"email": user["email"], "password": PASSWORD})
    assert web.status_code == 200
    long_ago = datetime.now(timezone.utc) - timedelta(days=31)
    old_family = _decode(old["refresh_token"])["fid"]
    await flow.db.auth_sessions.update_one({"family_id": old_family}, {"$set": {"last_active": long_ago}})
    web_family = _decode(flow.client.cookies.get("refresh_token"))["fid"]
    await flow.db.auth_sessions.update_one({"family_id": web_family}, {"$set": {"last_active": long_ago}})

    assert await purge_stale_app_sessions(flow.db) == 1
    assert await purge_stale_app_sessions(flow.db) == 0, "beim zweiten Lauf nichts mehr"
    rows = await sessions_of(flow, user)
    devices = sorted(row["device"] for row in rows)
    assert devices == ["", "Galaxy Tab S9 / Android 15"], "die alte App-Sitzung ist weg, Tablet und Website bleiben"
    gone = await flow.db.refresh_tokens.find_one({"token_hash": auth_routes.hash_token(old["refresh_token"])})
    assert gone["revoked"] is True and gone["revocation_reason"] == "inactive_30d"
    flow.act_as(None)
    assert (await flow.post("/api/auth/mobile/refresh", json={"refresh_token": old["refresh_token"]}, headers=PIXEL)).status_code == 401
    assert (await flow.post("/api/auth/mobile/refresh", json={"refresh_token": fresh["refresh_token"]}, headers=TABLET)).status_code == 200
