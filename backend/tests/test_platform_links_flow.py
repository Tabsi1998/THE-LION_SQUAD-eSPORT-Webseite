"""Plattform-Konten verknüpfen (#260): Discord und Twitch per OAuth2, Steam per OpenID - das Feld
wird befüllt und „verifiziert“; ein Konto gehört einem Nutzer; Handänderung nimmt das Häkchen."""
import json
import pathlib
import sys
from urllib.parse import parse_qs, urlparse

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
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
        self.app_redirects = ["http://localhost:3000/api/platform-links/discord/callback"]

    def transport(self):
        return httpx.MockTransport(self.handle)

    @staticmethod
    def basic(client_id: str, secret: str) -> str:
        import base64
        return "Basic " + base64.b64encode(f"{client_id}:{secret}".encode()).decode()

    def handle(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url).split("?")[0]
        body = request.content.decode("utf-8") if request.content else ""
        form = {k: v[0] for k, v in parse_qs(body).items()}
        self.calls.append((request.method, url, form or dict(request.url.params)))
        if url == platform_links.DISCORD_TOKEN and form.get("grant_type") == "client_credentials":
            import base64
            expected = "Basic " + base64.b64encode(b"discord-app:discord-geheim").decode()
            return httpx.Response(200, json={"access_token": "cc"}) if request.headers.get("Authorization") == expected else httpx.Response(401, json={"error": "invalid_client"})
        if url == platform_links.DISCORD_APP_ME:
            if request.headers.get("Authorization") != "Bot bot-token":
                return httpx.Response(401, json={"message": "401: Unauthorized"})
            return httpx.Response(200, json={"id": "discord-app", "redirect_uris": self.app_redirects})
        if url == platform_links.DISCORD_TOKEN:
            assert form.get("grant_type") == "authorization_code" and form.get("client_secret") == "discord-geheim"
            return httpx.Response(200, json={"access_token": "d-token"}) if form.get("code") == "gut" else httpx.Response(400, json={"error": "invalid_grant"})
        if url == platform_links.DISCORD_ME:
            assert request.headers.get("Authorization") == "Bearer d-token"
            return httpx.Response(200, json=self.discord_user)
        if url == platform_links.TWITCH_TOKEN:
            if form.get("grant_type") == "client_credentials":
                return httpx.Response(200, json={"access_token": "app-token"}) if form.get("client_secret") == "twitch-geheim" else httpx.Response(403, json={"message": "invalid client"})
            assert form.get("client_secret") == "twitch-geheim"
            return httpx.Response(200, json={"access_token": "t-token"})
        if url == platform_links.TWITCH_USERS:
            assert request.headers.get("Client-Id") == "twitch-app" and request.headers.get("Authorization") == "Bearer t-token"
            return httpx.Response(200, json={"data": [self.twitch_user]})
        if url == platform_links.BATTLENET_TOKEN:
            return httpx.Response(200, json={"access_token": "bn"}) if request.headers.get("Authorization") == self.basic("battlenet-app", "battlenet-geheim") else httpx.Response(401, json={"error": "unauthorized"})
        if url == platform_links.BATTLENET_USERINFO:
            return httpx.Response(200, json={"id": 4711, "battletag": "Paula#1234"})
        if url == platform_links.X_TOKEN:
            assert form.get("grant_type") == "authorization_code" and form.get("code_verifier"), "X braucht PKCE"
            return httpx.Response(200, json={"access_token": "x"}) if request.headers.get("Authorization") == self.basic("x-app", "x-geheim") else httpx.Response(401, json={"error": "invalid_client"})
        if url == platform_links.X_APP_TOKEN:
            return httpx.Response(200, json={"access_token": "x-app"}) if request.headers.get("Authorization") == self.basic("x-app", "x-geheim") else httpx.Response(401, json={"error": "invalid_client"})
        if url == platform_links.X_ME:
            return httpx.Response(200, json={"data": {"id": "77", "username": "paula_x", "name": "Paula"}})
        if url == platform_links.GOOGLE_TOKEN:
            return httpx.Response(200, json={"access_token": "g"}) if form.get("client_secret") == "youtube-geheim" else httpx.Response(401, json={"error": "invalid_client"})
        if url == platform_links.YOUTUBE_CHANNELS:
            return httpx.Response(200, json={"items": [{"id": "UC1", "snippet": {"title": "Paula plays", "customUrl": "@paulaplays"}}]})
        if url == platform_links.TIKTOK_TOKEN:
            return httpx.Response(200, json={"access_token": "tt"}) if form.get("client_secret") == "tiktok-geheim" and form.get("client_key") == "tiktok-app" else httpx.Response(401, json={"error": "invalid_client"})
        if url == platform_links.TIKTOK_USERINFO:
            return httpx.Response(200, json={"data": {"user": {"open_id": "o-1", "display_name": "Paula", "username": "paula.tt"}}})
        if url == platform_links.RIOT_TOKEN:
            return httpx.Response(200, json={"access_token": "r"}) if request.headers.get("Authorization") == self.basic("riot-app", "riot-geheim") else httpx.Response(401, json={"error": "invalid_client"})
        if url == platform_links.RIOT_ACCOUNT_ME:
            return httpx.Response(200, json={"puuid": "p-1", "gameName": "Paula", "tagLine": "EUW"})
        if url == platform_links.MS_TOKEN:
            return httpx.Response(200, json={"access_token": "ms"}) if form.get("client_secret") == "xbox-geheim" else httpx.Response(401, json={"error": "invalid_client"})
        if url == platform_links.XBL_AUTH:
            payload = json.loads(body)
            assert payload["Properties"]["RpsTicket"] == "d=ms"
            return httpx.Response(200, json={"Token": "xbl", "DisplayClaims": {"xui": [{"uhs": "u"}]}})
        if url == platform_links.XSTS_AUTH:
            assert json.loads(body)["Properties"]["UserTokens"] == ["xbl"]
            return httpx.Response(200, json={"Token": "xsts", "DisplayClaims": {"xui": [{"xid": "9", "gtg": "PaulaGT", "uhs": "u"}]}})
        if url == platform_links.EPIC_TOKEN:
            return httpx.Response(200, json={"access_token": "e"}) if request.headers.get("Authorization") == self.basic("epic-app", "epic-geheim") else httpx.Response(401, json={"error": "invalid_client"})
        if url == platform_links.EPIC_USERINFO:
            return httpx.Response(200, json={"sub": "e-1", "preferred_username": "PaulaEpic"})
        if url == platform_links.FACEIT_TOKEN:
            return httpx.Response(200, json={"access_token": "f"}) if request.headers.get("Authorization") == self.basic("faceit-app", "faceit-geheim") else httpx.Response(401, json={"error": "invalid_client"})
        if url == platform_links.FACEIT_USERINFO:
            return httpx.Response(200, json={"guid": "g-1", "nickname": "paulaf"})
        if url == platform_links.STARTGG_TOKEN:
            payload = json.loads(body)
            return httpx.Response(200, json={"access_token": "s"}) if payload.get("client_secret") == "startgg-geheim" and payload.get("scope") == "user.identity" else httpx.Response(401, json={"error": "invalid_client"})
        if url == platform_links.STARTGG_GQL:
            assert "currentUser" in json.loads(body)["query"]
            return httpx.Response(200, json={"data": {"currentUser": {"id": 5150, "slug": "user/abc", "player": {"gamerTag": "PaulaGG"}}}})
        if url == platform_links.ROBLOX_TOKEN:
            return httpx.Response(200, json={"access_token": "rb"}) if form.get("client_secret") == "roblox-geheim" else httpx.Response(401, json={"error": "invalid_client"})
        if url == platform_links.ROBLOX_USERINFO:
            return httpx.Response(200, json={"sub": "4242", "preferred_username": "paula_rbx", "name": "Paula"})
        if url == platform_links.OSU_TOKEN:
            if form.get("grant_type") == "client_credentials":
                return httpx.Response(200, json={"access_token": "cc"}) if form.get("client_secret") == "osu-geheim" else httpx.Response(401, json={"error": "invalid_client"})
            return httpx.Response(200, json={"access_token": "o"}) if form.get("client_secret") == "osu-geheim" else httpx.Response(401, json={"error": "invalid_client"})
        if url == platform_links.OSU_ME:
            return httpx.Response(200, json={"id": 777, "username": "paulaosu"})
        if url == platform_links.LICHESS_TOKEN:
            assert form.get("code_verifier") and form.get("client_id") == platform_links.LICHESS_CLIENT_ID and "client_secret" not in form
            return httpx.Response(200, json={"access_token": "l"})
        if url == platform_links.LICHESS_ACCOUNT:
            return httpx.Response(200, json={"id": "paulachess", "username": "paulachess"})
        if url == platform_links.GITHUB_TOKEN:
            return httpx.Response(200, json={"access_token": "gh"}) if form.get("client_secret") == "github-geheim" else httpx.Response(401, json={"error": "invalid_client"})
        if url == platform_links.GITHUB_USER:
            return httpx.Response(200, json={"id": 99, "login": "paula-dev", "name": "Paula"})
        if url == platform_links.KICK_TOKEN:
            if form.get("grant_type") == "client_credentials":
                return httpx.Response(200, json={"access_token": "cc"}) if form.get("client_secret") == "kick-geheim" else httpx.Response(401, json={"error": "invalid_client"})
            assert form.get("code_verifier")
            return httpx.Response(200, json={"access_token": "k"}) if form.get("client_secret") == "kick-geheim" else httpx.Response(401, json={"error": "invalid_client"})
        if url == platform_links.KICK_USERS:
            return httpx.Response(200, json={"data": [{"user_id": 31, "name": "paulakick"}]})
        if url == platform_links.REDDIT_TOKEN:
            assert request.headers.get("User-Agent", "").startswith("lionsquad-website")
            return httpx.Response(200, json={"access_token": "rd"}) if request.headers.get("Authorization") == self.basic("reddit-app", "reddit-geheim") else httpx.Response(401, json={"error": "invalid_client"})
        if url == platform_links.REDDIT_ME:
            return httpx.Response(200, json={"id": "t2_1", "name": "paula_r"})
        if url == platform_links.SPOTIFY_TOKEN:
            return httpx.Response(200, json={"access_token": "sp"}) if request.headers.get("Authorization") == self.basic("spotify-app", "spotify-geheim") else httpx.Response(401, json={"error": "invalid_client"})
        if url == platform_links.SPOTIFY_ME:
            return httpx.Response(200, json={"id": "sp-1", "display_name": "Paula S."})
        if url == platform_links.THREADS_TOKEN:
            return httpx.Response(200, json={"access_token": "th", "user_id": "th-1"}) if form.get("client_secret") == "threads-geheim" else httpx.Response(401, json={"error": "invalid_client"})
        if url == platform_links.THREADS_ME:
            return httpx.Response(200, json={"id": "th-1", "username": "paula.threads"})
        if url == platform_links.FACEBOOK_TOKEN:
            if form.get("grant_type") == "client_credentials":
                return httpx.Response(200, json={"access_token": "app|token"}) if form.get("client_secret") == "facebook-geheim" else httpx.Response(401, json={"error": "invalid_client"})
            return httpx.Response(200, json={"access_token": "fb"}) if form.get("client_secret") == "facebook-geheim" else httpx.Response(401, json={"error": "invalid_client"})
        if url == platform_links.FACEBOOK_ME:
            return httpx.Response(200, json={"id": "fb-1", "name": "Paula Beispiel"})
        if url == platform_links.LINKEDIN_TOKEN:
            return httpx.Response(200, json={"access_token": "li"}) if form.get("client_secret") == "linkedin-geheim" else httpx.Response(401, json={"error": "invalid_client"})
        if url == platform_links.LINKEDIN_USERINFO:
            return httpx.Response(200, json={"sub": "li-1", "name": "Paula Beispiel", "given_name": "Paula"})
        if url == platform_links.SNAPCHAT_TOKEN:
            return httpx.Response(200, json={"access_token": "sn"}) if request.headers.get("Authorization") == self.basic("snapchat-app", "snapchat-geheim") else httpx.Response(401, json={"error": "invalid_client"})
        if url == platform_links.SNAPCHAT_ME:
            return httpx.Response(200, json={"data": {"me": {"externalId": "sn-1", "displayName": "PaulaSnap"}}})
        if url == platform_links.PINTEREST_TOKEN:
            return httpx.Response(200, json={"access_token": "pi"}) if request.headers.get("Authorization") == self.basic("pinterest-app", "pinterest-geheim") else httpx.Response(401, json={"error": "invalid_client"})
        if url == platform_links.PINTEREST_ME:
            return httpx.Response(200, json={"id": "pi-1", "username": "paulapins"})
        if url == platform_links.TELEGRAM_TOKEN:
            assert form.get("code_verifier") and form.get("client_id") == "telegram-app"
            if form.get("client_secret") != "telegram-geheim":
                return httpx.Response(401, json={"error": "invalid_client"})
            id_token = jwt.encode({"sub": "tg-1", "id": 4242, "name": "Paula", "preferred_username": "paula_tg", "aud": "telegram-app", "iss": "https://oauth.telegram.org"}, TELEGRAM_PEM, algorithm="RS256", headers={"kid": "tg-1"})
            return httpx.Response(200, json={"access_token": "tg", "id_token": id_token})
        if url == platform_links.TELEGRAM_JWKS:
            return httpx.Response(200, json={"keys": [telegram_jwk()]})
        if url == platform_links.WARGAMING_ACCOUNT_INFO:
            params = dict(request.url.params)
            assert params.get("application_id") == "wg-app" and params.get("access_token") == "wg-token"
            return httpx.Response(200, json={"status": "ok", "data": {"555": {"nickname": "PaulaTank"}}})
        if url == platform_links.BUNGIE_TOKEN:
            assert request.headers.get("X-API-Key") == "bungie-key"
            return httpx.Response(200, json={"access_token": "bn"}) if request.headers.get("Authorization") == self.basic("bungie-app", "bungie-geheim") else httpx.Response(401, json={"error": "invalid_client"})
        if url == platform_links.BUNGIE_MEMBERSHIPS:
            assert request.headers.get("X-API-Key") == "bungie-key"
            return httpx.Response(200, json={"Response": {"bungieNetUser": {"membershipId": "9001", "uniqueName": "Paula#1234", "displayName": "Paula"}}})
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


MORE_APPS = {
    "battlenet_client_id": "battlenet-app", "battlenet_client_secret": "battlenet-geheim", "x_client_id": "x-app", "x_client_secret": "x-geheim",
    "youtube_client_id": "youtube-app", "youtube_client_secret": "youtube-geheim", "tiktok_client_key": "tiktok-app", "tiktok_client_secret": "tiktok-geheim",
    "riot_client_id": "riot-app", "riot_client_secret": "riot-geheim", "xbox_client_id": "xbox-app", "xbox_client_secret": "xbox-geheim",
    "epic_client_id": "epic-app", "epic_client_secret": "epic-geheim",
    "faceit_client_id": "faceit-app", "faceit_client_secret": "faceit-geheim", "startgg_client_id": "startgg-app", "startgg_client_secret": "startgg-geheim", "roblox_client_id": "roblox-app", "roblox_client_secret": "roblox-geheim", "osu_client_id": "osu-app", "osu_client_secret": "osu-geheim", "github_client_id": "github-app", "github_client_secret": "github-geheim", "kick_client_id": "kick-app", "kick_client_secret": "kick-geheim", "reddit_client_id": "reddit-app", "reddit_client_secret": "reddit-geheim", "spotify_client_id": "spotify-app", "spotify_client_secret": "spotify-geheim",
    "threads_client_id": "threads-app", "threads_client_secret": "threads-geheim", "facebook_client_id": "facebook-app", "facebook_client_secret": "facebook-geheim", "linkedin_client_id": "linkedin-app", "linkedin_client_secret": "linkedin-geheim", "snapchat_client_id": "snapchat-app", "snapchat_client_secret": "snapchat-geheim", "pinterest_client_id": "pinterest-app", "pinterest_client_secret": "pinterest-geheim", "telegram_client_id": "telegram-app", "telegram_client_secret": "telegram-geheim", "bungie_client_id": "bungie-app", "bungie_client_secret": "bungie-geheim",
    "wargaming_application_id": "wg-app", "bungie_api_key": "bungie-key",
}


async def configure(flow, **extra):
    more = {key: (encrypt_secret(value) if key.endswith(("_secret", "_api_key")) else value) for key, value in MORE_APPS.items()}
    await flow.db.settings.update_one({"id": "branding"}, {"$set": {
        "id": "branding", "discord_client_id": "discord-app", "discord_client_secret": encrypt_secret("discord-geheim"),
        "twitch_client_id": "twitch-app", "twitch_client_secret": encrypt_secret("twitch-geheim"), **more, **extra,
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
    # Steam (OpenID) und Wargaming hängen den state an die Rückrufadresse.
    inner = query.get("openid.return_to") or query["redirect_uri"]
    return parse_qs(urlparse(inner[0]).query)["state"][0]


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
    # Steam (OpenID) und Lichess (öffentlicher Client) brauchen keine App - alle anderen schon.
    assert overview["available"]["steam"] is True and overview["available"]["lichess"] is True
    assert all(value is False for key, value in overview["available"].items() if key not in ("steam", "lichess"))
    assert set(overview["available"]) == set(platform_links.PLATFORMS)
    assert overview["platforms"]["discord"]["field"] == "discord_name" and "Discord-Kennung" in overview["platforms"]["discord"]["delivers"]
    assert (await flow.post("/api/me/platform-links/discord/start")).status_code == 409
    assert (await flow.post("/api/me/platform-links/psn/start")).status_code == 404

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
    assert listing[0]["url"] == "https://discord.com/users/123456789012345678"
    public = (await flow.get(f"/api/users/public/{paula['username']}")).json()
    assert public["verified_platforms"] == ["discord"] and public["discord_name"] == "paula"
    # Verknüpfte Konten mit offizieller Adresse - Beschriftung, Anzeigename, Datum, Link; nie die Kennung als Feld.
    assert len(public["linked_accounts"]) == 1
    account = public["linked_accounts"][0]
    assert account["platform"] == "discord" and account["label"] == "Discord" and account["handle"] == "paula"
    assert account["display_name"] == "Paula B." and account["url"] == "https://discord.com/users/123456789012345678" and account["linked_at"]
    assert "external_id" not in account

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
    failed = target(await flow.get(f"/api/platform-links/discord/callback?code=schlecht&state={state3}"))
    assert failed["link_error"] == "exchange_failed" and failed["link_detail"] == "token 400"
    # Einrichtungsfehler der Plattform (z. B. Rückrufadresse nicht eingetragen): der Grund kommt mit.
    mismatch = target(await flow.get(f"/api/platform-links/discord/callback?error=redirect_mismatch&error_description=Parameter+redirect_uri+does+not+match+registered+URI&state={state3}"))
    assert mismatch["link_error"] == "platform_error" and "redirect_uri does not match" in mismatch["link_detail"]
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


@pytest.mark.asyncio
async def test_admin_check_names_what_is_missing(flow, fake):
    """„Discord prüfen“ im Admin: Client ID/Secret, Zugehörigkeit zur Bot-App und Rückrufadresse - je mit Ergebnis."""
    chef = await flow.add_user(role="superadmin", name="chef")
    paula = await person(flow, "paula")
    flow.act_as(paula)
    assert (await flow.post("/api/settings/platform-links/discord/check")).status_code == 403

    flow.act_as(chef)
    missing = (await flow.post("/api/settings/platform-links/discord/check")).json()
    assert missing["ok"] is False and missing["checks"][0]["key"] == "credentials" and missing["checks"][0]["state"] == "fail"
    assert missing["redirect_uri"] == "http://localhost:3000/api/platform-links/discord/callback"

    await configure(flow)
    await flow.db.settings.update_one({"id": "discord"}, {"$set": {"id": "discord", "bot_token": encrypt_secret("bot-token")}}, upsert=True)
    good = (await flow.post("/api/settings/platform-links/discord/check")).json()
    assert good["ok"] is True and [c["state"] for c in good["checks"]] == ["ok", "ok", "ok"]

    fake.app_redirects = ["https://falsch.example/callback"]
    bad_redirect = (await flow.post("/api/settings/platform-links/discord/check")).json()
    assert bad_redirect["ok"] is False and bad_redirect["checks"][-1]["key"] == "redirect" and "OAuth2 → Redirects" in bad_redirect["checks"][-1]["text"]

    await configure(flow, discord_client_secret=encrypt_secret("falsch"))
    bad_secret = (await flow.post("/api/settings/platform-links/discord/check")).json()
    assert bad_secret["checks"][0]["state"] == "fail" and "invalid_client" in bad_secret["checks"][0]["text"]

    twitch = (await flow.post("/api/settings/platform-links/twitch/check")).json()
    assert twitch["ok"] is True and twitch["checks"][0]["state"] == "ok" and twitch["checks"][1]["state"] == "warn" and "OAuth Redirect URLs" in twitch["checks"][1]["text"]
    steam = (await flow.post("/api/settings/platform-links/steam/check")).json()
    assert steam["ok"] is True and steam["checks"][1]["state"] == "warn"
    assert await flow.db.audit_logs.count_documents({"action": "platform_link.checked"}) == 6


EXPECTED_LINKS = {
    "battlenet": ("Paula#1234", "battlenet_id", ""),
    "x": ("paula_x", "x_handle", "https://x.com/paula_x"),
    "youtube": ("paulaplays", "youtube_handle", "https://www.youtube.com/@paulaplays"),
    "tiktok": ("paula.tt", "tiktok_handle", "https://www.tiktok.com/@paula.tt"),
    "riot": ("Paula#EUW", "riot_id", ""),
    "xbox": ("PaulaGT", "xbox_id", "https://www.xbox.com/play/user/PaulaGT"),
    "epic": ("PaulaEpic", "epic_id", ""),
    # Welle 1 (#547)
    "faceit": ("paulaf", "faceit_handle", "https://www.faceit.com/en/players/paulaf"),
    "startgg": ("PaulaGG", "startgg_handle", ""),
    "roblox": ("paula_rbx", "roblox_handle", "https://www.roblox.com/users/4242/profile"),
    "osu": ("paulaosu", "osu_handle", "https://osu.ppy.sh/users/777"),
    "lichess": ("paulachess", "lichess_handle", "https://lichess.org/@/paulachess"),
    "github": ("paula-dev", "github_handle", "https://github.com/paula-dev"),
    "kick": ("paulakick", "kick_handle", "https://kick.com/paulakick"),
    "reddit": ("paula_r", "reddit_handle", "https://www.reddit.com/user/paula_r"),
    "spotify": ("Paula S.", "spotify_handle", "https://open.spotify.com/user/sp-1"),
    # Welle 2 (#547)
    "threads": ("paula.threads", "threads_handle", "https://www.threads.com/@paula.threads"),
    "facebook": ("Paula Beispiel", "facebook_handle", "https://www.facebook.com/fb-1"),
    "linkedin": ("Paula Beispiel", "linkedin_handle", ""),
    "snapchat": ("PaulaSnap", "snapchat_handle", ""),
    "pinterest": ("paulapins", "pinterest_handle", "https://www.pinterest.com/paulapins/"),
    "telegram": ("paula_tg", "telegram_handle", "https://t.me/paula_tg"),
    "wargaming": ("PaulaTank", "wargaming_handle", ""),
    "bungie": ("Paula#1234", "bungie_handle", "https://www.bungie.net/7/en/User/Profile/254/9001"),
}
# Wie die Plattform zurückruft: OAuth-Code oder (Wargaming) die Antwort mit Token und Konto.
CALLBACK_QUERY = {"wargaming": "status=ok&access_token=wg-token&nickname=PaulaTank&account_id=555&expires_at=1"}

TELEGRAM_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
TELEGRAM_PEM = TELEGRAM_KEY.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())


def telegram_jwk() -> dict:
    numbers = TELEGRAM_KEY.public_key().public_numbers()

    def b64(value: int) -> str:
        import base64
        raw = value.to_bytes((value.bit_length() + 7) // 8, "big")
        return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")

    return {"kty": "RSA", "kid": "tg-1", "use": "sig", "alg": "RS256", "n": b64(numbers.n), "e": b64(numbers.e)}


@pytest.mark.asyncio
async def test_every_oauth_platform_fills_its_field_and_verifies(flow, fake):
    """Battle.net, X (mit PKCE), YouTube, TikTok, Riot, Xbox (drei Schritte) und Epic: Start, Rückruf, Feld, Häkchen, offizielle Adresse."""
    await configure(flow)
    paula = await person(flow, "paula")
    for platform, (handle, field, url) in EXPECTED_LINKS.items():
        flow.act_as(paula)
        start = (await flow.post(f"/api/me/platform-links/{platform}/start")).json()["url"]
        if platform in ("x", "kick", "lichess", "telegram"):
            assert "code_challenge=" in start and "code_challenge_method=S256" in start
        if platform == "wargaming":
            assert start.startswith(platform_links.WARGAMING_LOGIN) and "application_id=wg-app" in start
        if platform == "lichess":
            assert f"client_id={platform_links.LICHESS_CLIENT_ID}" in start
        state = state_of(start)
        flow.act_as(None)
        landed = target(await flow.get(f"/api/platform-links/{platform}/callback?{CALLBACK_QUERY.get(platform, 'code=gut')}&state={state}"))
        assert landed == {"tab": "socials", "linked": platform}, (platform, landed)
        user = await flow.db.users.find_one({"id": paula["id"]}, {"_id": 0})
        assert user[field] == handle and user["platform_verified"][platform] is True, platform
    flow.act_as(paula)
    listing = {row["platform"]: row for row in (await flow.get("/api/me/platform-links")).json()["links"]}
    assert set(listing) == set(EXPECTED_LINKS) and all("external_id" not in row for row in listing.values())
    for platform, (_handle, _field, url) in EXPECTED_LINKS.items():
        assert listing[platform]["url"] == url, platform
    public = (await flow.get(f"/api/users/public/{paula['username']}")).json()
    assert set(public["verified_platforms"]) == set(EXPECTED_LINKS)
    accounts = {row["platform"]: row for row in public["linked_accounts"]}
    assert accounts["xbox"]["display_name"] == "PaulaGT" and accounts["riot"]["handle"] == "Paula#EUW" and accounts["youtube"]["url"] == "https://www.youtube.com/@paulaplays"
    assert accounts["telegram"]["display_name"] == "Paula" and accounts["bungie"]["display_name"] == "Paula" and accounts["wargaming"]["handle"] == "PaulaTank"

    # Von Hand geändert: das Häkchen fällt - auch bei den neuen Plattformen.
    flow.act_as(paula)
    assert (await flow.patch("/api/users/me", json={"x_handle": "anders"})).status_code == 200
    assert "x" not in (await flow.get(f"/api/users/public/{paula['username']}")).json()["verified_platforms"]

    # Falsches Secret: die Prüfung im Admin sagt es; die Verknüpfung scheitert sauber.
    chef = await flow.add_user(role="superadmin", name="chef")
    flow.act_as(chef)
    good = (await flow.post("/api/settings/platform-links/battlenet/check")).json()
    assert good["checks"][0]["state"] == "ok" and good["checks"][1]["key"] == "redirect"
    riot = (await flow.post("/api/settings/platform-links/riot/check")).json()
    assert riot["checks"][0]["state"] == "warn" and "echten Verknüpfung" in riot["checks"][0]["text"]
    lichess = (await flow.post("/api/settings/platform-links/lichess/check")).json()
    assert lichess["ok"] is True and "keine App" in lichess["checks"][0]["text"]
    osu = (await flow.post("/api/settings/platform-links/osu/check")).json()
    assert osu["checks"][0]["state"] == "ok"
    wargaming = (await flow.post("/api/settings/platform-links/wargaming/check")).json()
    assert wargaming["ok"] is True and wargaming["checks"][0]["state"] == "warn" and "Application ID" in wargaming["checks"][0]["text"]
    await configure(flow, bungie_api_key="")
    bungie = (await flow.post("/api/settings/platform-links/bungie/check")).json()
    assert bungie["ok"] is False and bungie["checks"][0]["key"] == "api_key"
    await configure(flow)
    await configure(flow, epic_client_secret=encrypt_secret("falsch"))
    bad = (await flow.post("/api/settings/platform-links/epic/check")).json()
    assert bad["ok"] is False and bad["checks"][0]["state"] == "fail"
    flow.act_as(paula)
    state = state_of((await flow.post("/api/me/platform-links/epic/start")).json()["url"])
    flow.act_as(None)
    failed = target(await flow.get(f"/api/platform-links/epic/callback?code=gut&state={state}"))
    assert failed["link_error"] == "exchange_failed" and failed["link_detail"] == "token 401"

