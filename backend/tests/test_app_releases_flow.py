"""App-Releases (#250) durch die echte Anwendung: der Admin oder das Release-Skript
legen eine APK ab, angemeldete Nutzer erfahren, ob ein Update ansteht, und laden
sie mit Prüfsumme; alle anderen kommen nicht heran."""
import hashlib
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import app_releases  # noqa: E402

FAKE_APK = b"PK\x03\x04" + bytes(range(256)) * 8  # 2 KB, sieht für den Server wie ein ZIP aus


@pytest_asyncio.fixture
async def flow(tmp_path, monkeypatch):
    monkeypatch.setattr(app_releases, "APP_RELEASE_DIR", tmp_path / "app-releases")
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def upload(flow, *, build=63, version="0.5.0-beta", content=FAKE_APK, headers=None, **fields):
    data = {"version": version, "build": str(build), "notes": "- Was ist neu\n- Update aus der App", **{k: str(v) for k, v in fields.items()}}
    return await flow.post("/api/admin/app-releases", data=data, files={"file": ("app.apk", content, "application/vnd.android.package-archive")}, headers=headers or {})


@pytest.mark.asyncio
async def test_admin_uploads_and_users_see_and_download_the_update(flow):
    admin = await flow.add_user(role="club_admin", name="clubadmin")
    flow.act_as(admin)
    stored = await upload(flow)
    assert stored.status_code == 200, stored.text
    body = stored.json()
    assert body["build"] == 63 and body["version"] == "0.5.0-beta" and body["is_current"] is True
    assert body["sha256"] == hashlib.sha256(FAKE_APK).hexdigest()
    assert body["md5"] == hashlib.md5(FAKE_APK).hexdigest()
    assert body["download_url"] == "/api/mobile/app-download/63"
    assert (await flow.get("/api/admin/app-releases")).json()[0]["build"] == 63

    player = await flow.add_user(role="player", name="spieler")
    flow.act_as(player)
    version = await flow.get("/api/mobile/app-version?build=62")
    assert version.status_code == 200, version.text
    info = version.json()
    assert info["update_available"] is True and info["mandatory"] is False
    assert info["current"]["notes"].startswith("- Was ist neu")

    same = (await flow.get("/api/mobile/app-version?build=63")).json()
    assert same["update_available"] is False

    download = await flow.get("/api/mobile/app-download/63")
    assert download.status_code == 200, download.text
    assert download.headers["content-type"].startswith("application/vnd.android.package-archive")
    assert int(download.headers["content-length"]) == len(FAKE_APK)
    assert download.headers["x-release-sha256"] == body["sha256"]
    assert download.content == FAKE_APK

    flow.act_as(None)
    assert (await flow.get("/api/mobile/app-version?build=62")).status_code == 401
    assert (await flow.get("/api/mobile/app-download/63")).status_code == 401


@pytest.mark.asyncio
async def test_min_build_makes_the_update_mandatory_and_can_be_changed(flow):
    admin = await flow.add_user(role="club_admin", name="clubadmin")
    flow.act_as(admin)
    assert (await upload(flow, build=63, min_build=63)).status_code == 200

    player = await flow.add_user(role="player", name="spieler")
    flow.act_as(player)
    assert (await flow.get("/api/mobile/app-version?build=62")).json()["mandatory"] is True

    flow.act_as(admin)
    changed = await flow.patch("/api/admin/app-releases/63", json={"min_build": 60})
    assert changed.status_code == 200 and changed.json()["min_build"] == 60
    flow.act_as(player)
    assert (await flow.get("/api/mobile/app-version?build=62")).json()["mandatory"] is False


@pytest.mark.asyncio
async def test_only_apks_from_admins_or_the_release_script_are_accepted(flow, monkeypatch):
    player = await flow.add_user(role="player", name="spieler")
    flow.act_as(player)
    assert (await upload(flow)).status_code == 403

    flow.act_as(None)
    monkeypatch.delenv(app_releases.UPLOAD_TOKEN_ENV, raising=False)
    missing = await upload(flow, headers={"X-Release-Token": "x" * 40})
    assert missing.status_code == 401 and "kein APP_RELEASE_UPLOAD_TOKEN hinterlegt" in missing.json()["detail"]

    monkeypatch.setenv(app_releases.UPLOAD_TOKEN_ENV, "x" * 40)
    wrong = await upload(flow, headers={"X-Release-Token": "falsch"})
    assert wrong.status_code == 401 and wrong.json()["detail"] == "Upload-Token stimmt nicht mit dem Server überein."
    scripted = await upload(flow, headers={"X-Release-Token": "x" * 40})
    assert scripted.status_code == 200, scripted.text
    stored = await flow.db.app_releases.find_one({"build": 63}, {"_id": 0})
    assert stored["source"] == "release-script"

    monkeypatch.setenv(app_releases.UPLOAD_TOKEN_ENV, "kurz")
    assert (await upload(flow, build=64, headers={"X-Release-Token": "kurz"})).status_code == 401, "zu kurze Token zählen nicht"

    admin = await flow.add_user(role="club_admin", name="clubadmin")
    flow.act_as(admin)
    junk = await upload(flow, build=65, content=b"kein zip " * 300)
    assert junk.status_code == 400 and "APK" in junk.json()["detail"]
    bad_version = await upload(flow, build=66, version="v5")
    assert bad_version.status_code == 400


@pytest.mark.asyncio
async def test_a_newer_upload_becomes_current_and_deleting_removes_the_file(flow):
    admin = await flow.add_user(role="club_admin", name="clubadmin")
    flow.act_as(admin)
    assert (await upload(flow, build=63)).status_code == 200
    assert (await upload(flow, build=64, version="0.5.1-beta")).status_code == 200
    rows = (await flow.get("/api/admin/app-releases")).json()
    assert [row["build"] for row in rows] == [64, 63]
    assert [row["is_current"] for row in rows] == [True, False]

    back = await flow.patch("/api/admin/app-releases/63", json={"is_current": True})
    assert back.json()["is_current"] is True
    assert (await flow.db.app_releases.find_one({"build": 64}, {"_id": 0}))["is_current"] is False

    assert app_releases.release_path(64).is_file()
    assert (await flow.client.delete("/api/admin/app-releases/64")).status_code == 200
    assert not app_releases.release_path(64).exists()
    assert (await flow.get("/api/mobile/app-download/64")).status_code == 404


@pytest.mark.asyncio
async def test_the_admin_sees_whether_the_server_has_an_upload_token(flow, monkeypatch):
    admin = await flow.add_user(role="club_admin", name="clubadmin")
    flow.act_as(admin)
    monkeypatch.delenv(app_releases.UPLOAD_TOKEN_ENV, raising=False)
    status = (await flow.get("/api/admin/app-releases/status")).json()["upload_token"]
    assert status["configured"] is False and status["length"] == 0 and status["env"] == "APP_RELEASE_UPLOAD_TOKEN"

    monkeypatch.setenv(app_releases.UPLOAD_TOKEN_ENV, "y" * 48)
    status = (await flow.get("/api/admin/app-releases/status")).json()["upload_token"]
    assert status == {"configured": True, "length": 48, "min_length": 24, "env": "APP_RELEASE_UPLOAD_TOKEN"}

    player = await flow.add_user(role="player", name="spieler")
    flow.act_as(player)
    assert (await flow.get("/api/admin/app-releases/status")).status_code == 403
