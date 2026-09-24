"""Plattform-Konten verknüpfen (#260): Discord, Twitch, Battle.net, X, YouTube, TikTok, Riot, Xbox
und Epic per OAuth2, Steam per OpenID.

Statt Namen und Kennungen zu tippen, meldet man sich einmal bei der Plattform an. Die Plattform
sagt, wer man ist; die Website trägt den Wert ins Profil ein und merkt sich
``platform_verified.<plattform>`` - das Häkchen „verifiziert“ im Profil, im öffentlichen Profil
und bei Turnieren.

Ablauf: ``start`` baut die Anmeldeadresse mit einem signierten ``state`` (JWT: Nutzer, Plattform,
Nonce, zehn Minuten). Die Plattform ruft ``callback`` auf - ohne Anmeldung bei uns, der ``state``
sagt, wer verknüpft. Ein Plattform-Konto gehört genau einem Nutzer (``taken``). Ändert jemand das
Profilfeld von Hand, fällt die Verifizierung weg.

Jede Plattform steht in ``PLATFORMS`` mit ihrem Profilfeld, dem Sichtbarkeitsschlüssel des Profils,
den Einstellungsfeldern (Client ID + Secret in den Branding-Einstellungen, verschlüsselt) und dem
Muster der offiziellen Adresse. Was die Plattform liefert, steht in ``delivers`` - der
Datenschutztext im Profil nimmt es daher. PlayStation, Nintendo und EA bieten keine Anmeldung für
Websites, Instagram nur für Business-Konten über eine geprüfte Meta-App - sie bleiben getippt.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import quote, urlencode

import httpx
import jwt

from auth import get_jwt_secret
from models import new_id, now_utc
from services.secret_store import decrypt_secret

logger = logging.getLogger("tls.platform_links")

STATE_MINUTES = 10
STATE_TYPE = "platform_link"
TIMEOUT = 12
# Tests hängen hier einen httpx.MockTransport ein.
_transport = None

PLATFORMS = {
    "discord": {"label": "Discord", "field": "discord_name", "visibility": "discord", "delivers": "Discord-Kennung und Nutzername",
                "id_field": "discord_client_id", "secret_field": "discord_client_secret", "official": "https://discord.com/users/{external_id}"},
    "twitch": {"label": "Twitch", "field": "twitch_handle", "visibility": "twitch", "delivers": "Twitch-Kennung, Login und Anzeigename",
               "id_field": "twitch_client_id", "secret_field": "twitch_client_secret", "official": "https://www.twitch.tv/{handle}"},
    "steam": {"label": "Steam", "field": "steam_id", "visibility": "steam", "delivers": "SteamID64 und, falls ein Steam-API-Schlüssel hinterlegt ist, der Anzeigename",
              "id_field": None, "secret_field": None, "official": "https://steamcommunity.com/profiles/{external_id}"},
    "battlenet": {"label": "Battle.net", "field": "battlenet_id", "visibility": "battlenet", "delivers": "BattleTag und Konto-Kennung",
                  "id_field": "battlenet_client_id", "secret_field": "battlenet_client_secret", "official": ""},
    "x": {"label": "X", "field": "x_handle", "visibility": "x", "delivers": "X-Kennung, Nutzername und Anzeigename",
          "id_field": "x_client_id", "secret_field": "x_client_secret", "official": "https://x.com/{handle}"},
    "youtube": {"label": "YouTube", "field": "youtube_handle", "visibility": "youtube", "delivers": "Kanal-Kennung, Kanalname und Handle (nur lesend)",
                "id_field": "youtube_client_id", "secret_field": "youtube_client_secret", "official": "https://www.youtube.com/@{handle}"},
    "tiktok": {"label": "TikTok", "field": "tiktok_handle", "visibility": "tiktok", "delivers": "TikTok-Kennung, Nutzername und Anzeigename",
               "id_field": "tiktok_client_key", "secret_field": "tiktok_client_secret", "official": "https://www.tiktok.com/@{handle}"},
    "riot": {"label": "Riot Games", "field": "riot_id", "visibility": "riot", "delivers": "Riot-Kennung (PUUID) und Riot ID (Name#TAG)",
             "id_field": "riot_client_id", "secret_field": "riot_client_secret", "official": ""},
    "xbox": {"label": "Xbox", "field": "xbox_id", "visibility": "xbox", "delivers": "Xbox-Kennung (XUID) und Gamertag",
             "id_field": "xbox_client_id", "secret_field": "xbox_client_secret", "official": "https://www.xbox.com/play/user/{handle}"},
    "epic": {"label": "Epic Games", "field": "epic_id", "visibility": "epic", "delivers": "Epic-Kennung und Anzeigename",
             "id_field": "epic_client_id", "secret_field": "epic_client_secret", "official": ""},
}

DISCORD_AUTHORIZE = "https://discord.com/oauth2/authorize"
DISCORD_TOKEN = "https://discord.com/api/oauth2/token"
DISCORD_ME = "https://discord.com/api/users/@me"
DISCORD_APP_ME = "https://discord.com/api/v10/applications/@me"
TWITCH_AUTHORIZE = "https://id.twitch.tv/oauth2/authorize"
TWITCH_TOKEN = "https://id.twitch.tv/oauth2/token"
TWITCH_USERS = "https://api.twitch.tv/helix/users"
STEAM_OPENID = "https://steamcommunity.com/openid/login"
STEAM_SUMMARY = "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/"
STEAM_ID_RE = re.compile(r"/openid/id/(\d{17})$")
BATTLENET_AUTHORIZE = "https://oauth.battle.net/authorize"
BATTLENET_TOKEN = "https://oauth.battle.net/token"
BATTLENET_USERINFO = "https://oauth.battle.net/userinfo"
X_AUTHORIZE = "https://x.com/i/oauth2/authorize"
X_TOKEN = "https://api.x.com/2/oauth2/token"
X_APP_TOKEN = "https://api.x.com/oauth2/token"
X_ME = "https://api.x.com/2/users/me"
GOOGLE_AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"
YOUTUBE_CHANNELS = "https://www.googleapis.com/youtube/v3/channels"
TIKTOK_AUTHORIZE = "https://www.tiktok.com/v2/auth/authorize/"
TIKTOK_TOKEN = "https://open.tiktokapis.com/v2/oauth/token/"
TIKTOK_USERINFO = "https://open.tiktokapis.com/v2/user/info/"
RIOT_AUTHORIZE = "https://auth.riotgames.com/authorize"
RIOT_TOKEN = "https://auth.riotgames.com/token"
RIOT_ACCOUNT_ME = "https://europe.api.riotgames.com/riot/account/v1/accounts/me"
MS_AUTHORIZE = "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize"
MS_TOKEN = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token"
XBL_AUTH = "https://user.auth.xboxlive.com/user/authenticate"
XSTS_AUTH = "https://xsts.auth.xboxlive.com/xsts/authorize"
EPIC_AUTHORIZE = "https://www.epicgames.com/id/authorize"
EPIC_TOKEN = "https://api.epicgames.dev/epic/oauth/v2/token"
EPIC_USERINFO = "https://api.epicgames.dev/epic/oauth/v2/userInfo"


class LinkError(Exception):
    """Warum die Verknüpfung nicht zustande kam - der Code landet als ``link_error`` in der Adresse,
    ein kurzer Grund (von der Plattform oder von uns, nie ein Geheimnis) als ``link_detail``."""

    def __init__(self, code: str, text: str = ""):
        self.code = code
        super().__init__(text or code)


# Offizielle Adresse des verknüpften Kontos - damit im Profil steht, wohin es geht.
def official_url(platform: str, external_id: str, handle: str) -> str:
    template = (PLATFORMS.get(platform) or {}).get("official") or ""
    if not template:
        return ""
    if "{external_id}" in template:
        return template.replace("{external_id}", quote(str(external_id or ""), safe="")) if external_id else ""
    return template.replace("{handle}", quote(str(handle or ""), safe="")) if handle else ""


def providers_configured(branding: dict | None) -> dict[str, bool]:
    """Welche Plattformen eingerichtet sind. Steam braucht keine App - nur eine Rückrufadresse."""
    branding = branding or {}
    out = {}
    for key, spec in PLATFORMS.items():
        if not spec["id_field"]:
            out[key] = True
        else:
            out[key] = bool(branding.get(spec["id_field"]) and branding.get(spec["secret_field"]))
    return out


def _credentials(platform: str, branding: dict) -> tuple[str, str]:
    spec = PLATFORMS[platform]
    client_id = str(branding.get(spec["id_field"]) or "")
    secret = decrypt_secret(branding[spec["secret_field"]]) if branding.get(spec["secret_field"]) else ""
    return client_id, secret


def public_base_url() -> str:
    base = os.getenv("PUBLIC_BACKEND_URL") or os.getenv("PUBLIC_BASE_URL") or os.getenv("FRONTEND_URL") or ""
    return base.strip().rstrip("/")


def frontend_url() -> str:
    return (os.getenv("FRONTEND_URL") or public_base_url()).strip().rstrip("/")


def redirect_uri(platform: str) -> str:
    return f"{public_base_url()}/api/platform-links/{platform}/callback"


def make_state(user_id: str, platform: str) -> str:
    payload = {
        "sub": user_id, "plt": platform, "type": STATE_TYPE, "nonce": secrets.token_urlsafe(8),
        "exp": datetime.now(timezone.utc) + timedelta(minutes=STATE_MINUTES),
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm="HS256")


def read_state_payload(token: str | None, platform: str) -> dict:
    """Der signierte ``state`` - oder ``LinkError('invalid')``."""
    try:
        payload = jwt.decode(str(token or ""), get_jwt_secret(), algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise LinkError("invalid", f"state: {exc}")
    if payload.get("type") != STATE_TYPE or payload.get("plt") != platform or not payload.get("sub"):
        raise LinkError("invalid", "state passt nicht zur Plattform")
    return payload


def read_state(token: str | None, platform: str) -> str:
    """Der Nutzer aus dem ``state`` - oder ``LinkError('invalid')``."""
    return str(read_state_payload(token, platform)["sub"])


def _pkce_verifier(nonce: str) -> str:
    """X verlangt PKCE. Der Verifier wird aus der Nonce des signierten state abgeleitet - so muss nichts
    zwischengespeichert werden, und in der Adresse steht nur die Challenge."""
    digest = hmac.new(get_jwt_secret().encode("utf-8"), f"pkce:{nonce}".encode("utf-8"), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


def _pkce_challenge(verifier: str) -> str:
    return base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("ascii")).digest()).decode("ascii").rstrip("=")


def authorize_url(platform: str, branding: dict, state: str) -> str:
    """Die Adresse, an die der Browser geschickt wird."""
    if platform not in PLATFORMS:
        raise LinkError("unknown")
    if not providers_configured(branding).get(platform):
        raise LinkError("not_configured")
    redirect = redirect_uri(platform)
    if platform == "steam":
        # Steam (OpenID 2.0): kein Geheimnis, der state hängt an der Rückrufadresse.
        return_to = f"{redirect}?{urlencode({'state': state})}"
        return f"{STEAM_OPENID}?" + urlencode({
            "openid.ns": "http://specs.openid.net/auth/2.0", "openid.mode": "checkid_setup",
            "openid.return_to": return_to, "openid.realm": public_base_url() or return_to,
            "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
            "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
        })
    client_id = str(branding.get(PLATFORMS[platform]["id_field"]) or "")
    common = {"client_id": client_id, "redirect_uri": redirect, "response_type": "code", "state": state}
    if platform == "discord":
        return f"{DISCORD_AUTHORIZE}?" + urlencode({**common, "scope": "identify", "prompt": "consent"})
    if platform == "twitch":
        return f"{TWITCH_AUTHORIZE}?" + urlencode({**common, "scope": "", "force_verify": "true"})
    if platform == "battlenet":
        return f"{BATTLENET_AUTHORIZE}?" + urlencode({**common, "scope": "openid"})
    if platform == "x":
        nonce = str(read_state_payload(state, platform).get("nonce") or "")
        challenge = _pkce_challenge(_pkce_verifier(nonce))
        return f"{X_AUTHORIZE}?" + urlencode({**common, "scope": "users.read tweet.read", "code_challenge": challenge, "code_challenge_method": "S256"})
    if platform == "youtube":
        return f"{GOOGLE_AUTHORIZE}?" + urlencode({**common, "scope": "https://www.googleapis.com/auth/youtube.readonly", "access_type": "online", "prompt": "consent"})
    if platform == "tiktok":
        return f"{TIKTOK_AUTHORIZE}?" + urlencode({"client_key": client_id, "redirect_uri": redirect, "response_type": "code", "state": state, "scope": "user.info.basic,user.info.profile"})
    if platform == "riot":
        return f"{RIOT_AUTHORIZE}?" + urlencode({**common, "scope": "openid"})
    if platform == "xbox":
        return f"{MS_AUTHORIZE}?" + urlencode({**common, "scope": "XboxLive.signin", "response_mode": "query"})
    if platform == "epic":
        return f"{EPIC_AUTHORIZE}?" + urlencode({**common, "scope": "basic_profile"})
    raise LinkError("unknown")


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=TIMEOUT, transport=_transport)


def _json(response: httpx.Response) -> dict:
    try:
        data = response.json()
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}


async def fetch_identity(platform: str, branding: dict, query: dict, state_payload: dict | None = None) -> dict:
    """Wer da ist - ``{"external_id", "handle", "display_name"}``. Wirft ``LinkError``."""
    if query.get("error"):
        # „access_denied“ heißt: die Person hat abgebrochen. Alles andere (z. B. redirect_mismatch,
        # wenn die Rückrufadresse in der Entwickler-Konsole fehlt) ist ein Einrichtungsfehler - der
        # Grund der Plattform kommt mit, damit der Betreiber ihn im Profil lesen kann.
        error = str(query.get("error"))
        if error == "access_denied":
            raise LinkError("denied", error)
        raise LinkError("platform_error", f"{error}: {query.get('error_description') or ''}".strip(" :"))
    try:
        if platform == "steam":
            return await _steam_identity(branding, query)
        code = str(query.get("code") or "")
        if not code:
            raise LinkError("denied", "kein code")
        if platform == "discord":
            return await _discord_identity(branding, code)
        if platform == "twitch":
            return await _twitch_identity(branding, code)
        if platform == "battlenet":
            return await _battlenet_identity(branding, code)
        if platform == "x":
            return await _x_identity(branding, code, str((state_payload or {}).get("nonce") or ""))
        if platform == "youtube":
            return await _youtube_identity(branding, code)
        if platform == "tiktok":
            return await _tiktok_identity(branding, code)
        if platform == "riot":
            return await _riot_identity(branding, code)
        if platform == "xbox":
            return await _xbox_identity(branding, code)
        if platform == "epic":
            return await _epic_identity(branding, code)
    except httpx.HTTPError as exc:
        logger.warning("[platform-links] %s: %s", platform, exc)
        # Nur die Fehlerart nach außen - die Meldung könnte die Adresse samt Code enthalten.
        raise LinkError("exchange_failed", f"Plattform nicht erreichbar ({type(exc).__name__})")
    raise LinkError("unknown")


async def _token(client: httpx.AsyncClient, url: str, *, data: dict, auth: tuple[str, str] | None = None, headers: dict | None = None) -> str:
    response = await client.post(url, data=data, auth=auth, headers={"Accept": "application/json", **(headers or {})})
    token = _json(response).get("access_token") if response.status_code == 200 else None
    if not token:
        raise LinkError("exchange_failed", f"token {response.status_code}")
    return str(token)


async def _discord_identity(branding: dict, code: str) -> dict:
    client_id, secret = _credentials("discord", branding)
    async with _client() as client:
        token = await _token(client, DISCORD_TOKEN, data={"client_id": client_id, "client_secret": secret, "grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri("discord")})
        me = await client.get(DISCORD_ME, headers={"Authorization": f"Bearer {token}"})
        if me.status_code != 200 or not _json(me).get("id"):
            raise LinkError("exchange_failed", f"me {me.status_code}")
    data = _json(me)
    handle = str(data.get("username") or "")
    return {"external_id": str(data["id"]), "handle": handle, "display_name": str(data.get("global_name") or handle)}


async def _twitch_identity(branding: dict, code: str) -> dict:
    client_id, secret = _credentials("twitch", branding)
    async with _client() as client:
        token = await _token(client, TWITCH_TOKEN, data={"client_id": client_id, "client_secret": secret, "grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri("twitch")})
        users = await client.get(TWITCH_USERS, headers={"Authorization": f"Bearer {token}", "Client-Id": client_id})
        rows = _json(users).get("data") if users.status_code == 200 else None
        if not rows:
            raise LinkError("exchange_failed", f"users {users.status_code}")
    data = rows[0]
    login = str(data.get("login") or "")
    return {"external_id": str(data.get("id") or ""), "handle": login, "display_name": str(data.get("display_name") or login)}


async def _steam_identity(branding: dict, query: dict) -> dict:
    claimed = str(query.get("openid.claimed_id") or "")
    match = STEAM_ID_RE.search(claimed)
    if query.get("openid.mode") != "id_res" or not match:
        raise LinkError("denied", "kein Steam-Konto")
    # Die Antwort wird bei Steam gegengeprüft - sonst könnte jeder eine SteamID in die Adresse schreiben.
    check = {key: value for key, value in query.items() if key.startswith("openid.")}
    check["openid.mode"] = "check_authentication"
    async with _client() as client:
        verify = await client.post(STEAM_OPENID, data=check)
        if verify.status_code != 200 or "is_valid:true" not in verify.text:
            raise LinkError("exchange_failed", "Steam bestätigt die Anmeldung nicht")
        steam_id = match.group(1)
        display = steam_id
        if branding.get("steam_api_key"):
            summary = await client.get(STEAM_SUMMARY, params={"key": decrypt_secret(branding["steam_api_key"]), "steamids": steam_id})
            players = (_json(summary).get("response") or {}).get("players") if summary.status_code == 200 else None
            if players:
                display = str(players[0].get("personaname") or steam_id)
    return {"external_id": steam_id, "handle": steam_id, "display_name": display}


async def _battlenet_identity(branding: dict, code: str) -> dict:
    client_id, secret = _credentials("battlenet", branding)
    async with _client() as client:
        token = await _token(client, BATTLENET_TOKEN, data={"grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri("battlenet")}, auth=(client_id, secret))
        info = await client.get(BATTLENET_USERINFO, headers={"Authorization": f"Bearer {token}"})
        data = _json(info) if info.status_code == 200 else {}
        if not data.get("battletag"):
            raise LinkError("exchange_failed", f"userinfo {info.status_code}")
    tag = str(data["battletag"])
    return {"external_id": str(data.get("id") or data.get("sub") or tag), "handle": tag, "display_name": tag}


async def _x_identity(branding: dict, code: str, nonce: str) -> dict:
    client_id, secret = _credentials("x", branding)
    async with _client() as client:
        token = await _token(client, X_TOKEN, data={"grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri("x"), "code_verifier": _pkce_verifier(nonce), "client_id": client_id}, auth=(client_id, secret))
        me = await client.get(X_ME, headers={"Authorization": f"Bearer {token}"})
        data = (_json(me).get("data") or {}) if me.status_code == 200 else {}
        if not data.get("username"):
            raise LinkError("exchange_failed", f"me {me.status_code}")
    return {"external_id": str(data.get("id") or ""), "handle": str(data["username"]), "display_name": str(data.get("name") or data["username"])}


async def _youtube_identity(branding: dict, code: str) -> dict:
    client_id, secret = _credentials("youtube", branding)
    async with _client() as client:
        token = await _token(client, GOOGLE_TOKEN, data={"client_id": client_id, "client_secret": secret, "grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri("youtube")})
        channels = await client.get(YOUTUBE_CHANNELS, params={"part": "snippet", "mine": "true"}, headers={"Authorization": f"Bearer {token}"})
        items = _json(channels).get("items") if channels.status_code == 200 else None
        if not items:
            raise LinkError("exchange_failed", f"channels {channels.status_code} – kein YouTube-Kanal auf diesem Google-Konto")
    item = items[0]
    snippet = item.get("snippet") or {}
    handle = str(snippet.get("customUrl") or "").lstrip("@") or str(snippet.get("title") or "")
    return {"external_id": str(item.get("id") or ""), "handle": handle, "display_name": str(snippet.get("title") or handle)}


async def _tiktok_identity(branding: dict, code: str) -> dict:
    client_id, secret = _credentials("tiktok", branding)
    async with _client() as client:
        token = await _token(client, TIKTOK_TOKEN, data={"client_key": client_id, "client_secret": secret, "grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri("tiktok")})
        info = await client.get(TIKTOK_USERINFO, params={"fields": "open_id,display_name,username"}, headers={"Authorization": f"Bearer {token}"})
        user = ((_json(info).get("data") or {}).get("user") or {}) if info.status_code == 200 else {}
        if not user.get("open_id"):
            raise LinkError("exchange_failed", f"userinfo {info.status_code}")
    handle = str(user.get("username") or user.get("display_name") or "")
    return {"external_id": str(user["open_id"]), "handle": handle, "display_name": str(user.get("display_name") or handle)}


async def _riot_identity(branding: dict, code: str) -> dict:
    client_id, secret = _credentials("riot", branding)
    async with _client() as client:
        token = await _token(client, RIOT_TOKEN, data={"grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri("riot")}, auth=(client_id, secret))
        account = await client.get(RIOT_ACCOUNT_ME, headers={"Authorization": f"Bearer {token}"})
        data = _json(account) if account.status_code == 200 else {}
        if not data.get("puuid"):
            raise LinkError("exchange_failed", f"account {account.status_code}")
    riot_id = f"{data.get('gameName') or ''}#{data.get('tagLine') or ''}".strip("#")
    return {"external_id": str(data["puuid"]), "handle": riot_id, "display_name": riot_id}


async def _xbox_identity(branding: dict, code: str) -> dict:
    """Microsoft-Konto → Xbox-Live-Token → XSTS-Token: erst der dritte Schritt nennt den Gamertag."""
    client_id, secret = _credentials("xbox", branding)
    async with _client() as client:
        token = await _token(client, MS_TOKEN, data={"client_id": client_id, "client_secret": secret, "grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri("xbox"), "scope": "XboxLive.signin"})
        xbl = await client.post(XBL_AUTH, json={"Properties": {"AuthMethod": "RPS", "SiteName": "user.auth.xboxlive.com", "RpsTicket": f"d={token}"}, "RelyingParty": "http://auth.xboxlive.com", "TokenType": "JWT"}, headers={"Accept": "application/json"})
        xbl_token = _json(xbl).get("Token") if xbl.status_code == 200 else None
        if not xbl_token:
            raise LinkError("exchange_failed", f"xbl {xbl.status_code}")
        xsts = await client.post(XSTS_AUTH, json={"Properties": {"SandboxId": "RETAIL", "UserTokens": [xbl_token]}, "RelyingParty": "http://xboxlive.com", "TokenType": "JWT"}, headers={"Accept": "application/json"})
        claims = ((_json(xsts).get("DisplayClaims") or {}).get("xui") or [{}])[0] if xsts.status_code == 200 else {}
        if not claims.get("gtg"):
            raise LinkError("exchange_failed", f"xsts {xsts.status_code} – kein Xbox-Profil auf diesem Microsoft-Konto")
    return {"external_id": str(claims.get("xid") or ""), "handle": str(claims["gtg"]), "display_name": str(claims["gtg"])}


async def _epic_identity(branding: dict, code: str) -> dict:
    client_id, secret = _credentials("epic", branding)
    async with _client() as client:
        token = await _token(client, EPIC_TOKEN, data={"grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri("epic")}, auth=(client_id, secret))
        info = await client.get(EPIC_USERINFO, headers={"Authorization": f"Bearer {token}"})
        data = _json(info) if info.status_code == 200 else {}
        if not data.get("sub"):
            raise LinkError("exchange_failed", f"userinfo {info.status_code}")
    name = str(data.get("preferred_username") or "")
    return {"external_id": str(data["sub"]), "handle": name, "display_name": name}


# ---------------------------------------------------------------- Einrichtung prüfen (Admin)

def _check(key: str, state: str, text: str) -> dict:
    return {"key": key, "state": state, "text": text}


# Plattformen, die Client ID und Secret ohne Person bestätigen (client_credentials): Adresse, Art der
# Übergabe und zusätzliche Felder.
CLIENT_CREDENTIALS = {
    "discord": (DISCORD_TOKEN, "basic", {"scope": "identify"}),
    "twitch": (TWITCH_TOKEN, "form", {}),
    "battlenet": (BATTLENET_TOKEN, "basic", {}),
    "x": (X_APP_TOKEN, "basic", {}),
    "tiktok": (TIKTOK_TOKEN, "form_key", {}),
    "epic": (EPIC_TOKEN, "basic", {}),
    "xbox": (MS_TOKEN, "form", {"scope": "https://graph.microsoft.com/.default"}),
}
REDIRECT_HINTS = {
    "twitch": "Twitch bestätigt Redirects nicht per API: {redirect} muss in der Developer Console unter „OAuth Redirect URLs“ stehen (genau so, ohne Schrägstrich am Ende), Client Type „Confidential“.",
    "battlenet": "Battle.net: {redirect} muss beim Client unter „Redirect URLs“ stehen.",
    "x": "X: {redirect} muss in der App unter „User authentication settings“ als Callback URI stehen; Typ „Web App“ mit Client Secret.",
    "youtube": "Google: {redirect} muss beim OAuth-Client unter „Autorisierte Weiterleitungs-URIs“ stehen; die YouTube Data API v3 muss im Projekt aktiviert sein.",
    "tiktok": "TikTok: {redirect} muss in der App unter „Redirect URI“ stehen; die App braucht die Freigabe von TikTok (Login Kit).",
    "riot": "Riot: {redirect} muss beim RSO-Client als Redirect URI stehen; Riot Sign On gibt es nur nach Antrag im Developer Portal.",
    "xbox": "Microsoft: {redirect} muss in der Azure-App-Registrierung unter „Redirect URIs“ (Web) stehen; Kontotyp „Personal Microsoft accounts“.",
    "epic": "Epic: {redirect} muss beim Client im Developer Portal als Redirect URL stehen; die Anwendung muss die Markenprüfung bestanden haben.",
}


async def check_provider(platform: str, branding: dict, *, bot_token: str | None = None) -> dict:
    """Ohne Anmeldung einer Person prüfen, was an der Einrichtung fehlt: passen Client ID und Secret
    (client_credentials), kennt die Discord-App die Rückrufadresse (über den Bot-Token lesbar)?
    Die anderen Plattformen verraten ihre Redirect-Liste nicht - dort bleibt der Hinweis."""
    if platform not in PLATFORMS:
        raise LinkError("unknown")
    spec = PLATFORMS[platform]
    redirect = redirect_uri(platform)
    checks: list[dict] = []
    try:
        if platform == "steam":
            checks.append(_check("credentials", "ok", "Steam braucht keine App – die Verknüpfung läuft über OpenID."))
            key = branding.get("steam_api_key")
            if key:
                async with _client() as client:
                    summary = await client.get(STEAM_SUMMARY, params={"key": decrypt_secret(key), "steamids": "76561197960287930"})
                checks.append(_check("api_key", "ok", "Steam-API-Schlüssel gültig – Anzeigenamen kommen mit.") if summary.status_code == 200 else _check("api_key", "fail", f"Steam nimmt den API-Schlüssel nicht an (HTTP {summary.status_code}) – neu erzeugen und hier eintragen."))
            else:
                checks.append(_check("api_key", "warn", "Ohne Steam-API-Schlüssel zeigt das Profil die 17-stellige ID statt des Anzeigenamens (optional)."))
            return {"platform": platform, "ok": all(c["state"] != "fail" for c in checks), "redirect_uri": redirect, "checks": checks}

        client_id, secret = _credentials(platform, branding)
        if not client_id or not secret:
            checks.append(_check("credentials", "fail", f"Client ID oder Client Secret fehlt – beides aus der Entwickler-Konsole von {spec['label']} eintragen und speichern."))
        elif platform in CLIENT_CREDENTIALS:
            url, style, extra = CLIENT_CREDENTIALS[platform]
            data = {"grant_type": "client_credentials", **extra}
            auth = None
            if style == "basic":
                auth = (client_id, secret)
            elif style == "form":
                data.update({"client_id": client_id, "client_secret": secret})
            else:
                data.update({"client_key": client_id, "client_secret": secret})
            async with _client() as client:
                token = await client.post(url, data=data, auth=auth, headers={"Accept": "application/json"})
            body = _json(token)
            if token.status_code == 200 and body.get("access_token"):
                checks.append(_check("credentials", "ok", "Client ID und Client Secret passen zusammen."))
            else:
                reason = body.get("error_description") or body.get("message") or body.get("error") or f"HTTP {token.status_code}"
                checks.append(_check("credentials", "fail", f"{spec['label']} lehnt Client ID oder Secret ab ({reason}). In der Entwickler-Konsole ein neues Secret erzeugen und hier eintragen."))
        else:
            checks.append(_check("credentials", "warn", f"Client ID und Secret sind eingetragen; {spec['label']} bestätigt sie erst bei einer echten Verknüpfung (Profil → Socials)."))

        if platform == "discord":
            if bot_token:
                async with _client() as client:
                    app = await client.get(DISCORD_APP_ME, headers={"Authorization": f"Bot {bot_token}"})
                if app.status_code == 200:
                    data = _json(app)
                    app_id = str(data.get("id") or "")
                    uris = [str(u) for u in (data.get("redirect_uris") or [])]
                    if client_id and app_id and app_id != client_id:
                        checks.append(_check("app", "warn", f"Die Client ID gehört nicht zur Bot-App (deren ID ist {app_id}). Am einfachsten: Client ID und Secret der Bot-App verwenden – dann prüft sich auch die Rückrufadresse."))
                    else:
                        checks.append(_check("app", "ok", "Client ID gehört zur Bot-App."))
                        if redirect in uris:
                            checks.append(_check("redirect", "ok", "Rückrufadresse ist in der App eingetragen."))
                        else:
                            checks.append(_check("redirect", "fail", f"Rückrufadresse fehlt in der App: {redirect} unter OAuth2 → Redirects hinzufügen und „Save Changes“ klicken."))
                else:
                    checks.append(_check("app", "warn", f"Discord nimmt den Bot-Token nicht an (HTTP {app.status_code}) – die Rückrufadresse {redirect} bitte von Hand unter OAuth2 → Redirects prüfen."))
            else:
                checks.append(_check("redirect", "warn", f"Kein Bot-Token hinterlegt (Einstellungen → Discord) – die Rückrufadresse lässt sich nicht automatisch prüfen: {redirect} muss unter OAuth2 → Redirects stehen."))
        elif platform in REDIRECT_HINTS:
            checks.append(_check("redirect", "warn", REDIRECT_HINTS[platform].replace("{redirect}", redirect)))
    except httpx.HTTPError as exc:
        logger.warning("[platform-links] Prüfung %s: %s", platform, exc)
        checks.append(_check("network", "fail", f"{spec['label']} ist gerade nicht erreichbar ({type(exc).__name__}) – später noch einmal prüfen."))
    return {"platform": platform, "ok": all(c["state"] != "fail" for c in checks), "redirect_uri": redirect, "checks": checks}


# ---------------------------------------------------------------- Speichern

async def link_account(db, user_id: str, platform: str, identity: dict) -> dict:
    """Verknüpfung speichern und das Profilfeld füllen. Ein Plattform-Konto gehört einem Nutzer."""
    spec = PLATFORMS[platform]
    other = await db.platform_links.find_one({"platform": platform, "external_id": identity["external_id"], "user_id": {"$ne": user_id}}, {"_id": 0, "id": 1})
    if other:
        raise LinkError("taken", "dieses Konto ist schon mit einem anderen Profil verknüpft")
    now = now_utc().isoformat()
    link = {"user_id": user_id, "platform": platform, "external_id": identity["external_id"], "handle": identity.get("handle") or "",
            "display_name": identity.get("display_name") or "", "linked_at": now}
    existing = await db.platform_links.find_one({"user_id": user_id, "platform": platform}, {"_id": 0, "id": 1})
    if existing:
        await db.platform_links.update_one({"id": existing["id"]}, {"$set": link})
        link["id"] = existing["id"]
    else:
        link["id"] = new_id()
        await db.platform_links.insert_one(dict(link))
    profile = {spec["field"]: identity.get("handle") or identity["external_id"], f"platform_verified.{platform}": True, "updated_at": now}
    if platform == "discord":
        profile["discord_id"] = identity["external_id"]
    await db.users.update_one({"id": user_id}, {"$set": profile})
    return link


async def unlink(db, user_id: str, platform: str) -> bool:
    """Trennen: Verknüpfung weg, Häkchen weg - der Text im Profilfeld bleibt."""
    result = await db.platform_links.delete_many({"user_id": user_id, "platform": platform})
    await db.users.update_one({"id": user_id}, {"$unset": {f"platform_verified.{platform}": ""}, "$set": {"updated_at": now_utc().isoformat()}})
    return result.deleted_count > 0


async def links_for(db, user_id: str) -> list[dict]:
    """Die eigenen Verknüpfungen mit der offiziellen Adresse - die Kennung selbst bleibt beim Server."""
    rows = await db.platform_links.find({"user_id": user_id}, {"_id": 0, "platform": 1, "handle": 1, "display_name": 1, "linked_at": 1, "external_id": 1}).to_list(20)
    out = []
    for row in sorted(rows, key=lambda row: row.get("platform") or ""):
        external_id = row.pop("external_id", "")
        row["url"] = official_url(row.get("platform") or "", external_id, row.get("handle") or "")
        out.append(row)
    return out


async def linked_accounts(db, user_id: str, platforms: list[str]) -> list[dict]:
    """Für das öffentliche Profil: die verknüpften Konten der sichtbaren Plattformen mit Beschriftung,
    Anzeigename, Datum und offizieller Adresse - so sieht jeder, dass das Konto echt ist und wohin es geht."""
    if not platforms:
        return []
    rows = await db.platform_links.find({"user_id": user_id, "platform": {"$in": list(platforms)}},
                                        {"_id": 0, "platform": 1, "handle": 1, "display_name": 1, "linked_at": 1, "external_id": 1}).to_list(20)
    out = []
    for row in sorted(rows, key=lambda row: list(PLATFORMS).index(row["platform"]) if row.get("platform") in PLATFORMS else 99):
        platform = row.get("platform") or ""
        out.append({
            "platform": platform, "label": PLATFORMS.get(platform, {}).get("label", platform),
            "handle": row.get("handle") or "", "display_name": row.get("display_name") or row.get("handle") or "",
            "linked_at": row.get("linked_at"), "url": official_url(platform, row.get("external_id") or "", row.get("handle") or ""),
        })
    return out


def verified_platforms(user: dict | None) -> list[str]:
    flags = (user or {}).get("platform_verified") or {}
    return [platform for platform in PLATFORMS if flags.get(platform)]


def changed_verified_platforms(updates: dict, user: dict) -> list[str]:
    """Welche Verifizierungen ein Profil-Update von Hand aufhebt: das Feld ändert sich."""
    flags = user.get("platform_verified") or {}
    changed = []
    for platform, spec in PLATFORMS.items():
        field = spec["field"]
        if flags.get(platform) and field in updates and (updates.get(field) or "") != (user.get(field) or ""):
            changed.append(platform)
    return changed


def callback_target(*, linked: str | None = None, error: str | None = None, detail: str | None = None) -> str:
    query = {"tab": "socials"}
    if linked:
        query["linked"] = linked
    if error:
        query["link_error"] = error
    if error and detail:
        # Kurz und ohne Steuerzeichen - es landet in der Adresse und im Hinweis auf der Seite.
        query["link_detail"] = re.sub(r"[^\w .,:;()/=+@'-]", " ", str(detail))[:160].strip()
    return f"{frontend_url()}/profile?{urlencode(query)}"
