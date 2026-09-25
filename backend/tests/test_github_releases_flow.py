"""GitHub-Releases von selbst (#309): der Server holt mobile-v*-Releases, prüft die Prüfsumme, kennt Beta
und Release, rollt Betas nur mit Schalter aus; das Token bleibt verschlüsselt beim Server; ohne Token
oder mit falschem Token steht der Grund im Stand. Alles gegen ein nachgestelltes GitHub."""
import hashlib
import json
import pathlib
import sys

import httpx
import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import app_releases, github_releases  # noqa: E402

FAKE_APK = b"PK\x03\x04" + bytes(range(256)) * 8
REPO = "Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite"


class FakeGithub:
    def __init__(self):
        self.releases: list[dict] = []
        self.assets: dict[str, bytes] = {}
        self.calls: list[tuple[str, str]] = []
        self.token = "ghp_test_token"

    def add_release(self, tag: str, *, prerelease: bool, apk: bytes = FAKE_APK, sha: str | None = None, draft: bool = False, body: str = "- Neu"):
        number = len(self.releases) + 1
        apk_url = f"https://api.github.com/repos/{REPO}/releases/assets/{number}0"
        sha_url = f"https://api.github.com/repos/{REPO}/releases/assets/{number}1"
        digest = sha if sha is not None else hashlib.sha256(apk).hexdigest()
        self.assets[apk_url] = apk
        self.assets[sha_url] = f"{digest}  LionsAPP-{tag}.apk\n".encode()
        self.releases.insert(0, {
            "tag_name": tag, "prerelease": prerelease, "draft": draft, "body": body, "published_at": "2026-09-24T20:00:00Z",
            "html_url": f"https://github.com/{REPO}/releases/tag/{tag}",
            "assets": [{"name": f"LionsAPP-{tag}.apk", "url": apk_url}, {"name": f"LionsAPP-{tag}.apk.sha256", "url": sha_url}],
        })

    def handle(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url).split("?")[0]
        self.calls.append((request.method, url))
        if request.headers.get("Authorization") != f"Bearer {self.token}":
            return httpx.Response(401, json={"message": "Bad credentials"})
        if url == f"https://api.github.com/repos/{REPO}/releases":
            return httpx.Response(200, json=self.releases)
        if url in self.assets:
            assert request.headers.get("Accept") == "application/octet-stream"
            return httpx.Response(200, content=self.assets[url])
        return httpx.Response(404, json={"message": "Not Found"})


@pytest_asyncio.fixture
async def flow(tmp_path, monkeypatch):
    monkeypatch.setattr(app_releases, "APP_RELEASE_DIR", tmp_path / "app-releases")
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def fake(monkeypatch):
    instance = FakeGithub()
    monkeypatch.setattr(github_releases, "_transport", httpx.MockTransport(instance.handle))
    return instance


def downloads(fake: FakeGithub) -> int:
    return sum(1 for _method, url in fake.calls if "/assets/" in url)


def test_tags_and_channels():
    assert github_releases.parse_tag("mobile-v0.9.0-beta-build77") == ("0.9.0-beta", 77)
    assert github_releases.parse_tag("mobile-v1.0.0-build80") == ("1.0.0", 80)
    assert github_releases.parse_tag("web-v2.0.0") is None and github_releases.parse_tag("mobile-v1.0.0-build0") is None
    assert app_releases.channel_of("0.9.0-beta") == "beta" and app_releases.channel_of("1.0.0") == "release"
    assert app_releases.channel_of("1.0.0", prerelease=True) == "beta" and app_releases.channel_of("1.0.0-beta", prerelease=False) == "release"
    assert github_releases._sha_from_text("abc " + "f" * 64 + "  datei.apk\n") == "f" * 64 and github_releases._sha_from_text("nichts") == ""


@pytest.mark.asyncio
async def test_github_releases_land_on_the_server_with_channel_and_checksum(flow, fake, tmp_path):
    admin = await flow.add_user(role="club_admin", name="clubadmin")
    flow.act_as(admin)
    # Ohne Token: der Stand sagt es, der Abgleich tut nichts.
    status = (await flow.get("/api/admin/app-releases/github")).json()
    assert status["github_token_configured"] is False and status["github_repo"] == REPO and status["github_rollout_betas"] is True
    empty = (await flow.post("/api/admin/app-releases/github/sync")).json()
    assert "Token" in empty["skipped"] and "Token" in empty["settings"]["github_last_error"]

    # Token speichern: verschlüsselt, nie zurück in der Antwort; das Repo-Format wird geprüft.
    assert (await flow.patch("/api/admin/app-releases/github", json={"github_repo": "kaputt"})).status_code == 400
    saved = (await flow.patch("/api/admin/app-releases/github", json={"github_token": "ghp_test_token", "github_repo": REPO})).json()
    assert saved["github_token_configured"] is True and "ghp_" not in json.dumps(saved)
    raw = await flow.db.settings.find_one({"id": "app_releases"}, {"_id": 0})
    assert raw["github_token"] != "ghp_test_token"
    assert await flow.db.audit_logs.count_documents({"action": "app_release.github_settings"}) == 1

    fake.add_release("mobile-v0.9.0-beta-build77", prerelease=True, body="- Beta-Neuerung")
    fake.add_release("mobile-v1.0.0-build80", prerelease=False, body="- Erstes Release")
    fake.add_release("web-v2.0.0", prerelease=False)                       # kein App-Release
    fake.add_release("mobile-v1.0.1-build81", prerelease=False, draft=True)  # Entwurf: nicht veröffentlicht
    result = (await flow.post("/api/admin/app-releases/github/sync")).json()
    assert [row["build"] for row in result["imported"]] == [77, 80] and result["errors"] == [], result
    assert result["imported"][0]["channel"] == "beta" and result["imported"][1]["channel"] == "release" and result["imported"][1]["checked"] is True
    assert result["settings"]["github_last_release"] == "mobile-v1.0.1-build81" or result["settings"]["github_last_release"] == "mobile-v1.0.0-build80"
    rows = {row["build"]: row for row in (await flow.get("/api/admin/app-releases")).json()}
    assert rows[80]["is_current"] is True and rows[77]["is_current"] is False
    assert rows[80]["channel"] == "release" and rows[77]["channel"] == "beta" and rows[80]["source"] == "github"
    assert rows[80]["sha256"] == hashlib.sha256(FAKE_APK).hexdigest() and rows[80]["notes"] == "- Erstes Release"
    assert rows[80]["github_url"] == f"https://github.com/{REPO}/releases/tag/mobile-v1.0.0-build80"
    assert app_releases.release_path(80).is_file() and app_releases.release_path(77).is_file()

    # Die App sieht das Update mit Kanal - und lädt es wie einen Upload von Hand.
    player = await flow.add_user(role="player", name="spieler")
    flow.act_as(player)
    info = (await flow.get("/api/mobile/app-version?build=76")).json()
    assert info["update_available"] is True and info["current"]["build"] == 80 and info["current"]["channel"] == "release"
    assert (await flow.get("/api/mobile/app-download/80")).status_code == 200

    # Noch einmal: nichts Neues, kein zweiter Download.
    flow.act_as(admin)
    before = downloads(fake)
    again = (await flow.post("/api/admin/app-releases/github/sync")).json()
    assert again["imported"] == [] and again["errors"] == [] and downloads(fake) == before

    # Falsche Prüfsumme: nicht übernommen, die Datei ist weg, der Grund steht im Stand.
    fake.add_release("mobile-v1.0.1-build82", prerelease=False, sha="0" * 64)
    bad = (await flow.post("/api/admin/app-releases/github/sync")).json()
    assert bad["imported"] == [] and any("Prüfsumme" in error for error in bad["errors"])
    assert await flow.db.app_releases.count_documents({"build": 82}) == 0 and not app_releases.release_path(82).exists()
    assert "Prüfsumme" in (await flow.get("/api/admin/app-releases/github")).json()["github_last_error"]

    # Betas nicht ausrollen: die neue Beta landet in der Liste, aktuell bleibt das Release.
    assert (await flow.patch("/api/admin/app-releases/github", json={"github_rollout_betas": False})).json()["github_rollout_betas"] is False
    fake.add_release("mobile-v1.1.0-beta-build83", prerelease=True)
    beta = (await flow.post("/api/admin/app-releases/github/sync")).json()
    assert [row["build"] for row in beta["imported"]] == [83] and beta["imported"][0]["is_current"] is False
    rows = {row["build"]: row for row in (await flow.get("/api/admin/app-releases")).json()}
    assert rows[80]["is_current"] is True and rows[83]["is_current"] is False and rows[83]["channel"] == "beta"
    assert (await flow.get("/api/mobile/app-version?build=80")).json()["update_available"] is False

    # Von Hand hochgeladen: der Kanal kommt aus der Versionsnummer.
    manual = await flow.post("/api/admin/app-releases", data={"version": "1.2.0-beta", "build": "84", "notes": "", "set_current": "false"},
                             files={"file": ("app.apk", FAKE_APK, "application/vnd.android.package-archive")})
    assert manual.status_code == 200 and manual.json()["channel"] == "beta" and manual.json()["source"].startswith("admin")

    # Token entfernen: der Abgleich meldet den Grund; Spieler kommen an nichts davon heran.
    cleared = (await flow.patch("/api/admin/app-releases/github", json={"clear_github_token": True})).json()
    assert cleared["github_token_configured"] is False
    assert "Token" in (await flow.post("/api/admin/app-releases/github/sync")).json()["skipped"]
    flow.act_as(player)
    assert (await flow.get("/api/admin/app-releases/github")).status_code == 403
    assert (await flow.post("/api/admin/app-releases/github/sync")).status_code == 403


@pytest.mark.asyncio
async def test_a_wrong_token_and_the_switch_off_are_reported_not_hidden(flow, fake):
    admin = await flow.add_user(role="club_admin", name="clubadmin")
    flow.act_as(admin)
    await flow.patch("/api/admin/app-releases/github", json={"github_token": "falsch"})
    fake.add_release("mobile-v1.0.0-build80", prerelease=False)
    result = (await flow.post("/api/admin/app-releases/github/sync")).json()
    assert "401" in result["error"] and "Bad credentials" in result["error"] and result["imported"] == []
    assert "401" in (await flow.get("/api/admin/app-releases/github")).json()["github_last_error"]
    assert await flow.db.app_releases.count_documents({}) == 0

    # Abgleich aus: der Hintergrundjob tut nichts, „Jetzt abgleichen“ läuft trotzdem.
    await flow.patch("/api/admin/app-releases/github", json={"github_sync_enabled": False, "github_token": "ghp_test_token"})
    assert (await github_releases.sync(flow.db))["skipped"] == "aus"
    forced = (await flow.post("/api/admin/app-releases/github/sync")).json()
    assert [row["build"] for row in forced["imported"]] == [80]
    assert await flow.db.audit_logs.count_documents({"action": "app_release.github_sync"}) >= 2
