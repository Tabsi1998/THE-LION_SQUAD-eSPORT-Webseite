"""Plattform-Konten verknüpfen (#260): Discord und Twitch per OAuth2, Steam per OpenID - das Feld
wird befüllt und „verifiziert“; ein Konto gehört einem Nutzer; Handänderung nimmt das Häkchen."""
import pathlib
import sys
from urllib.parse import parse_qs, urlparse

import httpx
import jwt
import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import platform_links  # noqa: E402
from services.secret_store import encrypt_secret  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


class FakePlatforms:
    """Antwortet wie Discord, Twitch und Steam - und merkt sich, was gefragt wurde."""

    def __init__(self):
        self.calls: list[tuple[str, str, dict]] = []
        self.discord_user = {"id": "123456789012345678", "username": "paula", "global_name": "Paula B."}
        self.twitch_user = {"id": "44556677", "login": "paulaplays", "display_name": "PaulaPlays"}
        self.steam_valid = True
        self.steam_name = "Paula auf Steam"

    def transport(self):
        return httpx.MockTransport(self.handle)

    def handle(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url).split("?")[0]
        body = request.content.decode("utf-8") if request.content else ""
        form = {k: v[0] for k, v in parse_qs(body).items()}
        self.calls.append((request.method, url, form or dict(request.url.params)))
        if url == platform_links.DISCORD_TOKEN:
            assert form.get("grant_type") == "authorization_code" and form.get("client_secret") == "discord-geheim"
            return httpx.Response(200, json={"access_token": "d-token"}) if form.get("code") == "gut" else httpx.Response(400, json={"error": "invalid_grant"})
        if url == platform_links.DISCORD_ME:
            assert request.headers.get("Authorization") == "Bearer d-token"
            return httpx.Response(200, json=self.discord_user)
        if url == platform_links.TWITCH_TOKEN:
            assert form.get("client_secret") == "twitch-geheim"
            return httpx.Response(200, json={"access_token": "t-token"})
        if url == platform_links.TWITCH_USERS:
            assert request.headers.get("Client-Id") == "twitch-app" and request.headers.get("Authorization") == "Bearer t-token"
            return httpx.Response(200, json={"data": [self.twitch_user]})
        if url == platform_links.STEAM_OPENID:
            assert form.get("openid.mode") == "check_authentication"
            return httpx.Response(200, text="ns:http://specs.openid.net/auth/2.0\nis_valid:true\n" if self.steam_valid else "is_valid:false\n")
        if url == platform_links.STEAM_SUMMARY:
            assert dict(request.url.params).get("key") == "steam-schluessel"
            return httpx.Response(200, json={"response": {"players": [{"steamid": "76561198000000001", "personaname": self.steam_name}]}})
        return httpx.Response(404, json={"error": "unbekannt"})


@pytest.fixture(autouse=True)
def env(monkeypatch):
    # Zur Laufzeit gelten die Import-Werte des Harness nicht mehr: Rückrufadresse und Signatur hier setzen.
    monkeypatch.setenv("JWT_SECRET", "flow-tests-secret-with-at-least-32-characters")
    monkeypatch.setenv("FRONTEND_URL", "http://localhost:3000")


@pytest.fixture
def fake(monkeypatch):
    instance = FakePlatforms()
    monkeypatch.setattr(platform_links, "_transport", instance.transport())
    return instance


async def configure(flow, **extra):
    await flow.db.settings.update_one({"id": "branding"}, {"$set": {
        "id": "branding", "discord_client_id": "discord-app", "discord_client_secret": encrypt_secret("discord-geheim"),
        "twitch_client_id": "twitch-app", "twitch_client_secret": encrypt_secret("twitch-geheim"), **extra,
    }}, upsert=True)


async def person(flow, name, **fields):
    user = await flow.add_user(role="player", name=name)
    fields.setdefault("display_name", name.capitalize())
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {**fields, "privacy_public_profile": True}})
    user.update(fields)
    return user


def state_of(url: str) -> str:
    query = parse_qs(urlparse(url).query)
    if "state" in query:
        return query["state"][0]
    return parse_qs(urlparse(query["openid.return_to"][0]).query)["state"][0]


def target(response) -> dict:
    assert response.status_code == 302, response.text
    parsed = urlparse(response.headers["location"])
    assert parsed.path == "/profile"
    return {k: v[0] for k, v in parse_qs(parsed.query).items()}


@pytest.mark.asyncio
async def test_start_needs_a_configured_app_and_signs_the_state(flow):
    paula = await person(flow, "paula")
    flow.act_as(paula)
    overview = (await flow.get("/api/me/platform-links")).json()
    assert overview["available"] == {"discord": False, "twitch": False, "steam": True}
    assert overview["platforms"]["discord"]["field"] == "discord_name" and "Discord-Kennung" in overview["platforms"]["discord"]["delivers"]
    assert (await flow.post("/api/me/platform-links/discord/start")).status_code == 409
    assert (await flow.post("/api/me/platform-links/xbox/start")).status_code == 404

    await configure(flow)
    url = (await flow.post("/api/me/platform-links/discord/start")).json()["url"]
    assert url.startswith("https://discord.com/oauth2/authorize?") and "scope=identify" in url
    query = parse_qs(urlparse(url).query)
    assert query["redirect_uri"] == ["http://localhost:3000/api/platform-links/discord/callback"]
    payload = jwt.decode(query["state"][0], "flow-tests-secret-with-at-least-32-characters", algorithms=["HS256"])
    assert payload["sub"] == paula["id"] and payload["plt"] == "discord" and payload["type"] == "platform_link"

    steam = (await flow.post("/api/me/platform-links/steam/start")).json()["url"]
    assert steam.startswith("https://steamcommunity.com/openid/login?") and "openid.mode=checkid_setup" in steam
    assert state_of(steam) == parse_qs(urlparse(steam).query)["openid.return_to"][0].split("state=")[1]


@pytest.mark.asyncio
async def test_discord_callback_fills_and_verifies_the_field_once_per_account(flow, fake):
    await configure(flow)
    paula = await person(flow, "paula", discord_name="tippfehler")
    flow.act_as(paula)
    state = state_of((await flow.post("/api/me/platform-links/discord/start")).json()["url"])
    flow.act_as(None)
    assert target(await flow.get(f"/api/platform-links/discord/callback?code=gut&state={state}")) == {"tab": "socials", "linked": "discord"}

    user = await flow.db.users.find_one({"id": paula["id"]}, {"_id": 0})
    assert user["discord_name"] == "paula" and user["discord_id"] == "123456789012345678" and user["platform_verified"] == {"discord": True}
    link = await flow.db.platform_links.find_one({"user_id": paula["id"]}, {"_id": 0})
    assert link["platform"] == "discord" and link["external_id"] == "123456789012345678" and link["display_name"] == "Paula B."
    flow.act_as(paula)
    listing = (await flow.get("/api/me/platform-links")).json()["links"]
    assert [row["platform"] for row in listing] == ["discord"] and "external_id" not in listing[0]
    public = (await flow.get(f"/api/users/public/{paula['username']}")).json()
    assert public["verified_platforms"] == ["discord"] and public["discord_name"] == "paula"

    # Dasselbe Discord-Konto an einem zweiten Profil: abgelehnt.
    max_ = await person(flow, "max")
    flow.act_as(max_)
    state2 = state_of((await flow.post("/api/me/platform-links/discord/start")).json()["url"])
    flow.act_as(None)
    assert target(await flow.get(f"/api/platform-links/discord/callback?code=gut&state={state2}"))["link_error"] == "taken"
    assert await flow.db.platform_links.count_documents({}) == 1

    # Nochmal verknüpfen (gleiches Konto, gleicher Nutzer): kein zweiter Eintrag.
    flow.act_as(paula)
    state3 = state_of((await flow.post("/api/me/platform-links/discord/start")).json()["url"])
    flow.act_as(None)
    assert target(await flow.get(f"/api/platform-links/discord/callback?code=gut&state={state3}"))["linked"] == "discord"
    assert await flow.db.platform_links.count_documents({"user_id": paula["id"]}) == 1

    # Abgelehnt bei Discord, kaputter Code, gefälschter oder fremder state: immer eine Erklärung, nie ein Häkchen.
    assert target(await flow.get(f"/api/platform-links/discord/callback?error=access_denied&state={state3}"))["link_error"] == "denied"
    assert target(await flow.get(f"/api/platform-links/discord/callback?code=schlecht&state={state3}"))["link_error"] == "exchange_failed"
    assert target(await flow.get("/api/platform-links/discord/callback?code=gut&state=kaputt"))["link_error"] == "invalid"
    flow.act_as(paula)
    wrong = state_of((await flow.post("/api/me/platform-links/twitch/start")).json()["url"])
    flow.act_as(None)
    assert target(await flow.get(f"/api/platform-links/discord/callback?code=gut&state={wrong}"))["link_error"] == "invalid"


@pytest.mark.asyncio
async def test_manual_edit_drops_the_check_and_unlink_keeps_the_text(flow, fake):
    await configure(flow)
    paula = await person(flow, "paula")
    flow.act_as(paula)
    state = state_of((await flow.post("/api/me/platform-links/twitch/start")).json()["url"])
    flow.act_as(None)
    assert target(await flow.get(f"/api/platform-links/twitch/callback?code=gut&state={state}"))["linked"] == "twitch"
    flow.act_as(paula)
    me = await flow.db.users.find_one({"id": paula["id"]}, {"_id": 0})
    assert me["twitch_handle"] == "paulaplays" and me["platform_verified"] == {"twitch": True}

    # Gleicher Wert gespeichert: Häkchen bleibt. Anderer Wert: Häkchen weg, Verknüpfung weg.
    same = await flow.put("/api/users/me", json={"twitch_handle": "paulaplays", "bio": "hi"})
    assert same.status_code == 200 and same.json()["platform_verified"] == {"twitch": True}
    changed = await flow.put("/api/users/me", json={"twitch_handle": "andererkanal"})
    assert changed.status_code == 200 and not changed.json().get("platform_verified")
    assert await flow.db.platform_links.count_documents({"user_id": paula["id"]}) == 0

    # Trennen lässt den Text stehen.
    state = state_of((await flow.post("/api/me/platform-links/twitch/start")).json()["url"])
    flow.act_as(None)
    await flow.get(f"/api/platform-links/twitch/callback?code=gut&state={state}")
    flow.act_as(paula)
    assert (await flow.client.delete("/api/me/platform-links/twitch")).json() == {"ok": True, "removed": True}
    user = await flow.db.users.find_one({"id": paula["id"]}, {"_id": 0})
    assert user["twitch_handle"] == "paulaplays" and not user.get("platform_verified")
    assert (await flow.client.delete("/api/me/platform-links/twitch")).json()["removed"] is False


@pytest.mark.asyncio
async def test_steam_openid_is_verified_at_steam_and_names_the_player(flow, fake):
    await configure(flow, steam_api_key=encrypt_secret("steam-schluessel"))
    paula = await person(flow, "paula")
    flow.act_as(paula)
    state = state_of((await flow.post("/api/me/platform-links/steam/start")).json()["url"])
    flow.act_as(None)
    openid = {"openid.mode": "id_res", "openid.claimed_id": "https://steamcommunity.com/openid/id/76561198000000001",
              "openid.sig": "abc", "openid.signed": "x", "state": state}
    assert target(await flow.get("/api/platform-links/steam/callback", params=openid))["linked"] == "steam"
    user = await flow.db.users.find_one({"id": paula["id"]}, {"_id": 0})
    assert user["steam_id"] == "76561198000000001" and user["platform_verified"] == {"steam": True}
    link = await flow.db.platform_links.find_one({"user_id": paula["id"]}, {"_id": 0})
    assert link["display_name"] == "Paula auf Steam"
    assert any(url == platform_links.STEAM_OPENID for _, url, _ in fake.calls), "die Antwort wird bei Steam gegengeprüft"

    # Steam sagt „ungültig“ oder die Adresse trägt keine SteamID: keine Verknüpfung.
    fake.steam_valid = False
    max_ = await person(flow, "max")
    flow.act_as(max_)
    state = state_of((await flow.post("/api/me/platform-links/steam/start")).json()["url"])
    flow.act_as(None)
    assert target(await flow.get("/api/platform-links/steam/callback", params={**openid, "state": state}))["link_error"] == "exchange_failed"
    assert target(await flow.get("/api/platform-links/steam/callback", params={"openid.mode": "id_res", "openid.claimed_id": "https://boese.example/id/1", "state": state}))["link_error"] == "denied"
    assert await flow.db.platform_links.count_documents({"user_id": max_["id"]}) == 0


@pytest.mark.asyncio
async def test_settings_hide_the_secrets_and_export_and_anonymize_carry_the_links(flow, fake):
    chef = await flow.add_user(role="superadmin", name="chef")
    flow.act_as(chef)
    saved = await flow.put("/api/settings/branding", json={"discord_client_id": "discord-app", "discord_client_secret": "discord-geheim", "steam_api_key": "steam-schluessel"})
    assert saved.status_code == 200, saved.text
    assert saved.json()["discord_client_secret_masked"] == "********" and "discord_client_secret" not in saved.json()
    assert saved.json()["steam_api_key_masked"] == "********" and "steam_api_key" not in saved.json()
    stored = await flow.db.settings.find_one({"id": "branding"}, {"_id": 0})
    assert stored["discord_client_secret"] != "discord-geheim" and stored["steam_api_key"] != "steam-schluessel"
    # Leer gelassen heißt behalten; der Lösch-Haken entfernt.
    kept = await flow.put("/api/settings/branding", json={"discord_client_id": "discord-app-2", "discord_client_secret": ""})
    assert kept.json()["discord_client_secret_masked"] == "********"
    cleared = await flow.put("/api/settings/branding", json={"clear_steam_api_key": True})
    assert "steam_api_key_masked" not in cleared.json()

    await flow.db.settings.update_one({"id": "branding"}, {"$set": {"twitch_client_id": "twitch-app", "twitch_client_secret": encrypt_secret("twitch-geheim")}})
    paula = await person(flow, "paula")
    flow.act_as(paula)
    state = state_of((await flow.post("/api/me/platform-links/discord/start")).json()["url"])
    flow.act_as(None)
    await flow.get(f"/api/platform-links/discord/callback?code=gut&state={state}")
    flow.act_as(paula)
    export = (await flow.get("/api/dsgvo/export-my-data")).json()
    assert [row["platform"] for row in export["platform_links"]] == ["discord"]
    assert (await flow.post("/api/dsgvo/anonymize-me")).status_code == 200
    assert await flow.db.platform_links.count_documents({"user_id": paula["id"]}) == 0
    user = await flow.db.users.find_one({"id": paula["id"]}, {"_id": 0})
    assert "platform_verified" not in user and user["discord_name"] is None
