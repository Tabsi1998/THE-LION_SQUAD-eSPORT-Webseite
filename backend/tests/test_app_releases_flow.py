"""App-Releases (#250) durch die echte Anwendung: der Admin oder das Release-Skript
legen eine APK ab, angemeldete Nutzer erfahren, ob ein Update ansteht, und laden
sie mit Prüfsumme; alle anderen kommen nicht heran."""
import hashlib
import pathlib
import sys
from datetime import datetime, timezone

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

    # Die Update-Prüfung gilt für die Installation (#1002): auch Gäste ohne Konto fragen sie ab.
    # Der APK-Download bleibt angemeldeten Nutzern vorbehalten.
    flow.act_as(None)
    guest = await flow.get("/api/mobile/app-version?build=62")
    assert guest.status_code == 200, guest.text
    assert guest.json()["update_available"] is True and guest.json()["current"]["build"] == 63
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
    deleted = await flow.client.delete("/api/admin/app-releases/64")
    assert deleted.status_code == 200
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


@pytest.mark.asyncio
async def test_server_updater_switch_stays_internal_and_only_club_admins_flip_it(flow):
    """Server-Updater an/aus (#421): Standard an; nur der Club-Admin schaltet. Seit #1002 ist die Update-Prüfung
    öffentlich - der Schalter ist eine interne Einstellung und steht nicht mehr in ihrer Antwort."""
    admin = await flow.add_user(role="club_admin", name="clubadmin")
    flow.act_as(admin)
    assert (await upload(flow)).status_code == 200
    assert (await flow.get("/api/admin/app-releases/settings")).json() == {"server_updater_enabled": True}

    player = await flow.add_user(role="player", name="spieler")
    flow.act_as(player)
    info = (await flow.get("/api/mobile/app-version?build=62")).json()
    assert "server_updater_enabled" not in info
    assert info["play_store_url"].endswith("id=at.lionsquad.app")
    denied = await flow.client.patch("/api/admin/app-releases/settings", json={"server_updater_enabled": False})
    assert denied.status_code == 403

    flow.act_as(admin)
    flipped = await flow.client.patch("/api/admin/app-releases/settings", json={"server_updater_enabled": False})
    assert flipped.status_code == 200, flipped.text
    assert flipped.json() == {"server_updater_enabled": False}
    flow.act_as(player)
    assert "server_updater_enabled" not in (await flow.get("/api/mobile/app-version?build=62")).json()
    # Die {build}-Routen bleiben unberührt: „settings“ ist keine Buildnummer.
    assert (await flow.get("/api/admin/app-releases")).status_code == 403


@pytest.mark.asyncio
async def test_guests_see_only_public_release_fields_with_short_public_cache(flow):
    """Ohne Anmeldung (#1002): nur Öffentliches zum Release - kein Hochlader, keine Pfade, keine Download-Adresse."""
    admin = await flow.add_user(role="club_admin", name="clubadmin")
    flow.act_as(admin)
    assert (await upload(flow, min_build=60)).status_code == 200

    flow.act_as(None)
    answer = await flow.get("/api/mobile/app-version?build=62")
    assert answer.status_code == 200, answer.text
    assert answer.headers["cache-control"] == "public, max-age=300"
    # Genau diese Felder - keine internen Einstellungen wie der Server-Updater-Schalter.
    assert set(answer.json()) == {"current", "own_build", "next_check_after", "play_store_url", "update_available", "mandatory"}
    current = answer.json()["current"]
    assert set(current) == {"build", "version", "notes", "sha256", "size", "min_build", "channel"}
    assert current["build"] == 63 and current["min_build"] == 60 and current["sha256"] == hashlib.sha256(FAKE_APK).hexdigest()
    assert current["size"] == len(FAKE_APK) and current["notes"].startswith("- Was ist neu")
    # Angemeldet kommt dieselbe Auswahl - die Antwort hängt nicht am Konto und darf zwischengespeichert werden.
    player = await flow.add_user(role="player", name="spieler")
    flow.act_as(player)
    assert set((await flow.get("/api/mobile/app-version?build=62")).json()["current"]) == set(current)


@pytest.fixture
def frozen_rate_limit_clock(monkeypatch):
    """Das Zählfenster (60 Sekunden, an der Uhr ausgerichtet) bleibt während des Tests dasselbe.

    Sonst wurde der Test rot, wenn die 61 Abrufe über eine volle Minute liefen: im neuen Fenster zählt der Zähler
    von vorn (#2054, in der CI mit parallelen Testprozessen gesehen).
    """
    import services.rate_limit as rate_limit

    class FrozenClock(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 10, 27, 12, 0, 5, tzinfo=timezone.utc)

    monkeypatch.setattr(rate_limit, "datetime", FrozenClock)


@pytest.mark.asyncio
async def test_app_version_is_rate_limited_per_address(flow, frozen_rate_limit_clock):
    flow.act_as(None)
    answers = [await flow.get("/api/mobile/app-version?build=62") for _ in range(61)]
    assert [answer.status_code for answer in answers[:60]] == [200] * 60
    assert answers[60].status_code == 429
    # Die Bremse wird nicht zwischengespeichert - nur die Antwort mit Release-Angaben.
    assert answers[60].headers["cache-control"] == "no-store"
