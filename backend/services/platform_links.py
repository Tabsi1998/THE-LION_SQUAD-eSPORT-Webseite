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

import asyncio
import base64
import hashlib
import hmac
import ipaddress
import json
import logging
import os
import re
import secrets
import socket
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import quote, urlencode

import httpx
import jwt

from auth import get_jwt_secret
from models import new_id, now_utc
from services.secret_store import decrypt_secret, encrypt_secret

logger = logging.getLogger("tls.platform_links")

STATE_MINUTES = 10
STATE_TYPE = "platform_link"
TIMEOUT = 12
# Tests hängen hier einen httpx.MockTransport ein.
_transport = None

PLATFORMS = {
    "discord": {"label": "Discord", "operator": "Discord Inc., USA", "field": "discord_name", "visibility": "discord", "delivers": "Discord-Kennung und Nutzername",
                "id_field": "discord_client_id", "secret_field": "discord_client_secret", "official": "https://discord.com/users/{external_id}"},
    "twitch": {"label": "Twitch", "operator": "Twitch Interactive, Inc. (Amazon), USA", "field": "twitch_handle", "visibility": "twitch", "delivers": "Twitch-Kennung, Login und Anzeigename",
               "id_field": "twitch_client_id", "secret_field": "twitch_client_secret", "official": "https://www.twitch.tv/{handle}"},
    "steam": {"label": "Steam", "operator": "Valve Corporation, USA", "field": "steam_id", "visibility": "steam", "delivers": "SteamID64 und, falls ein Steam-API-Schlüssel hinterlegt ist, der Anzeigename",
              "id_field": None, "secret_field": None, "official": "https://steamcommunity.com/profiles/{external_id}"},
    "battlenet": {"label": "Battle.net", "operator": "Blizzard Entertainment, Inc., USA", "field": "battlenet_id", "visibility": "battlenet", "delivers": "BattleTag und Konto-Kennung",
                  "id_field": "battlenet_client_id", "secret_field": "battlenet_client_secret", "official": ""},
    "x": {"label": "X", "operator": "X Corp., USA", "field": "x_handle", "visibility": "x", "delivers": "X-Kennung, Nutzername und Anzeigename",
          "id_field": "x_client_id", "secret_field": "x_client_secret", "official": "https://x.com/{handle}"},
    "youtube": {"label": "YouTube", "operator": "Google Ireland Ltd.", "field": "youtube_handle", "visibility": "youtube", "delivers": "Kanal-Kennung, Kanalname und Handle (nur lesend)",
                "id_field": "youtube_client_id", "secret_field": "youtube_client_secret", "official": "https://www.youtube.com/@{handle}"},
    "tiktok": {"label": "TikTok", "operator": "TikTok Technology Ltd., Irland", "field": "tiktok_handle", "visibility": "tiktok", "delivers": "TikTok-Kennung, Nutzername und Anzeigename",
               "id_field": "tiktok_client_key", "secret_field": "tiktok_client_secret", "official": "https://www.tiktok.com/@{handle}"},
    "riot": {"label": "Riot Games", "operator": "Riot Games, Inc., USA", "field": "riot_id", "visibility": "riot", "delivers": "Riot-Kennung (PUUID) und Riot ID (Name#TAG)",
             "id_field": "riot_client_id", "secret_field": "riot_client_secret", "official": ""},
    "xbox": {"label": "Xbox", "operator": "Microsoft Ireland Operations Ltd.", "field": "xbox_id", "visibility": "xbox", "delivers": "Xbox-Kennung (XUID) und Gamertag",
             "id_field": "xbox_client_id", "secret_field": "xbox_client_secret", "official": "https://www.xbox.com/play/user/{handle}"},
    "epic": {"label": "Epic Games", "operator": "Epic Games, Inc., USA", "field": "epic_id", "visibility": "epic", "delivers": "Epic-Kennung und Anzeigename",
             "id_field": "epic_client_id", "secret_field": "epic_client_secret", "official": ""},
    # Konten verknüpfen III, Welle 1 (#547): Standard-OAuth2; Lichess braucht keine App (öffentlicher Client mit PKCE).
    "faceit": {"label": "FACEIT", "operator": "FACEIT Ltd., Vereinigtes Königreich", "field": "faceit_handle", "visibility": "faceit", "delivers": "FACEIT-Kennung und Nickname",
             "id_field": 'faceit_client_id', "secret_field": 'faceit_client_secret', "official": "https://www.faceit.com/en/players/{handle}"},
    "startgg": {"label": "start.gg", "operator": "start.gg, Inc., USA", "field": "startgg_handle", "visibility": "startgg", "delivers": "Spieler-Kennung und Gamertag",
             "id_field": 'startgg_client_id', "secret_field": 'startgg_client_secret', "official": ""},
    "roblox": {"label": "Roblox", "operator": "Roblox Corporation, USA", "field": "roblox_handle", "visibility": "roblox", "delivers": "Roblox-Kennung und Nutzername",
             "id_field": 'roblox_client_id', "secret_field": 'roblox_client_secret', "official": "https://www.roblox.com/users/{external_id}/profile"},
    "osu": {"label": "osu!", "operator": "ppy Pty Ltd, Australien", "field": "osu_handle", "visibility": "osu", "delivers": "osu!-Kennung und Nutzername",
             "id_field": 'osu_client_id', "secret_field": 'osu_client_secret', "official": "https://osu.ppy.sh/users/{external_id}"},
    "lichess": {"label": "Lichess", "operator": "lichess.org (Verein, Frankreich)", "field": "lichess_handle", "visibility": "lichess", "delivers": "Lichess-Nutzername",
             "id_field": None, "secret_field": None, "official": "https://lichess.org/@/{handle}"},
    "github": {"label": "GitHub", "operator": "GitHub, Inc. (Microsoft), USA", "field": "github_handle", "visibility": "github", "delivers": "GitHub-Kennung und Login",
             "id_field": 'github_client_id', "secret_field": 'github_client_secret', "official": "https://github.com/{handle}"},
    "kick": {"label": "Kick", "operator": "Kick Streaming Pty Ltd, Australien", "field": "kick_handle", "visibility": "kick", "delivers": "Kick-Kennung und Name",
             "id_field": 'kick_client_id', "secret_field": 'kick_client_secret', "official": "https://kick.com/{handle}"},
    "reddit": {"label": "Reddit", "operator": "Reddit, Inc., USA", "field": "reddit_handle", "visibility": "reddit", "delivers": "Reddit-Kennung und Nutzername",
             "id_field": 'reddit_client_id', "secret_field": 'reddit_client_secret', "official": "https://www.reddit.com/user/{handle}"},
    "spotify": {"label": "Spotify", "operator": "Spotify AB, Schweden", "field": "spotify_handle", "visibility": "spotify", "delivers": "Spotify-Kennung und Anzeigename",
             "id_field": 'spotify_client_id', "secret_field": 'spotify_client_secret', "official": "https://open.spotify.com/user/{external_id}"},
    # Welle 2 (#547): Meta/LinkedIn/Snap/Pinterest brauchen ein App-Review, Telegram läuft als OIDC, Wargaming nur mit
    # Application ID (kein Secret), Bungie mit API Key zusätzlich zu Client ID und Secret.
    "threads": {"label": "Threads", "operator": "Meta Platforms Ireland Ltd.", "field": "threads_handle", "visibility": "threads", "delivers": "Threads-Kennung und Nutzername",
             "id_field": 'threads_client_id', "secret_field": 'threads_client_secret', "official": "https://www.threads.com/@{handle}"},
    "facebook": {"label": "Facebook", "operator": "Meta Platforms Ireland Ltd.", "field": "facebook_handle", "visibility": "facebook", "delivers": "Facebook-Kennung und Name",
             "id_field": 'facebook_client_id', "secret_field": 'facebook_client_secret', "official": "https://www.facebook.com/{external_id}"},
    "linkedin": {"label": "LinkedIn", "operator": "LinkedIn Ireland Unlimited Company", "field": "linkedin_handle", "visibility": "linkedin", "delivers": "LinkedIn-Kennung und Name",
             "id_field": 'linkedin_client_id', "secret_field": 'linkedin_client_secret', "official": ""},
    "snapchat": {"label": "Snapchat", "operator": "Snap Inc., USA", "field": "snapchat_handle", "visibility": "snapchat", "delivers": "Snapchat-Kennung und Anzeigename",
             "id_field": 'snapchat_client_id', "secret_field": 'snapchat_client_secret', "official": ""},
    "pinterest": {"label": "Pinterest", "operator": "Pinterest Europe Ltd.", "field": "pinterest_handle", "visibility": "pinterest", "delivers": "Pinterest-Kennung und Nutzername",
             "id_field": 'pinterest_client_id', "secret_field": 'pinterest_client_secret', "official": "https://www.pinterest.com/{handle}/"},
    "telegram": {"label": "Telegram", "operator": "Telegram FZ-LLC, VAE", "field": "telegram_handle", "visibility": "telegram", "delivers": "Telegram-Kennung und Nutzername",
             "id_field": 'telegram_client_id', "secret_field": 'telegram_client_secret', "official": "https://t.me/{handle}"},
    "wargaming": {"label": "Wargaming.net", "operator": "Wargaming Group Ltd., Zypern", "field": "wargaming_handle", "visibility": "wargaming", "delivers": "Konto-Kennung und Nickname (World of Tanks/Warships)",
             "id_field": 'wargaming_application_id', "secret_field": None, "official": ""},
    "bungie": {"label": "Bungie.net", "operator": "Bungie, Inc., USA", "field": "bungie_handle", "visibility": "bungie", "delivers": "Bungie-Kennung und Anzeigename (Destiny)",
             "id_field": 'bungie_client_id', "secret_field": 'bungie_client_secret', "extra_field": 'bungie_api_key', "official": "https://www.bungie.net/7/en/User/Profile/254/{external_id}"},
    # Welle 3 (#547): dezentral - keine App im Admin. Mastodon registriert die Website je Instanz selbst,
    # Bluesky beschreibt die Website über ihre Client-Metadaten (atproto OAuth mit PAR, DPoP und PKCE).
    # ``input``: was die Person vor dem Start eintippt (Instanz bzw. Handle).
    "mastodon": {"label": "Mastodon", "operator": "die gewählte Instanz (dezentral, Betreiber je Instanz)", "field": "mastodon_handle", "visibility": "mastodon",
                 "delivers": "Mastodon-Kennung, Nutzername und Instanz", "id_field": None, "secret_field": None, "official": "",
                 "input": {"label": "Instanz", "placeholder": "z. B. mastodon.social", "required": True}},
    "bluesky": {"label": "Bluesky", "operator": "Bluesky Social PBC, USA (oder der eigene PDS)", "field": "bluesky_handle", "visibility": "bluesky",
                "delivers": "DID und Handle", "id_field": None, "secret_field": None, "official": "https://bsky.app/profile/{handle}",
                "input": {"label": "Handle (optional)", "placeholder": "name.bsky.social", "required": False}},
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
FACEIT_AUTHORIZE = "https://accounts.faceit.com/accounts"
FACEIT_TOKEN = "https://api.faceit.com/auth/v1/oauth/token"
FACEIT_USERINFO = "https://api.faceit.com/auth/v1/resources/userinfo"
STARTGG_AUTHORIZE = "https://start.gg/oauth/authorize"
STARTGG_TOKEN = "https://api.start.gg/oauth/access_token"
STARTGG_GQL = "https://api.start.gg/gql/alpha"
ROBLOX_AUTHORIZE = "https://apis.roblox.com/oauth/v1/authorize"
ROBLOX_TOKEN = "https://apis.roblox.com/oauth/v1/token"
ROBLOX_USERINFO = "https://apis.roblox.com/oauth/v1/userinfo"
OSU_AUTHORIZE = "https://osu.ppy.sh/oauth/authorize"
OSU_TOKEN = "https://osu.ppy.sh/oauth/token"
OSU_ME = "https://osu.ppy.sh/api/v2/me"
LICHESS_AUTHORIZE = "https://lichess.org/oauth"
LICHESS_TOKEN = "https://lichess.org/api/token"
LICHESS_ACCOUNT = "https://lichess.org/api/account"
LICHESS_CLIENT_ID = "lionsquad-website"   # Lichess: öffentlicher Client, jede eindeutige Kennung reicht
GITHUB_AUTHORIZE = "https://github.com/login/oauth/authorize"
GITHUB_TOKEN = "https://github.com/login/oauth/access_token"
GITHUB_USER = "https://api.github.com/user"
KICK_AUTHORIZE = "https://id.kick.com/oauth/authorize"
KICK_TOKEN = "https://id.kick.com/oauth/token"
KICK_USERS = "https://api.kick.com/public/v1/users"
REDDIT_AUTHORIZE = "https://www.reddit.com/api/v1/authorize"
REDDIT_TOKEN = "https://www.reddit.com/api/v1/access_token"
REDDIT_ME = "https://oauth.reddit.com/api/v1/me"
SPOTIFY_AUTHORIZE = "https://accounts.spotify.com/authorize"
SPOTIFY_TOKEN = "https://accounts.spotify.com/api/token"
SPOTIFY_ME = "https://api.spotify.com/v1/me"
USER_AGENT = "lionsquad-website/1.0 (+https://lionsquad.at)"   # Reddit lehnt Standard-Kennungen ab
THREADS_AUTHORIZE = "https://threads.com/oauth/authorize"
THREADS_TOKEN = "https://graph.threads.com/oauth/access_token"
THREADS_ME = "https://graph.threads.com/v1.0/me"
FACEBOOK_AUTHORIZE = "https://www.facebook.com/v25.0/dialog/oauth"
FACEBOOK_TOKEN = "https://graph.facebook.com/v25.0/oauth/access_token"
FACEBOOK_ME = "https://graph.facebook.com/v25.0/me"
LINKEDIN_AUTHORIZE = "https://www.linkedin.com/oauth/v2/authorization"
LINKEDIN_TOKEN = "https://www.linkedin.com/oauth/v2/accessToken"
LINKEDIN_USERINFO = "https://api.linkedin.com/v2/userinfo"
SNAPCHAT_AUTHORIZE = "https://accounts.snapchat.com/accounts/oauth2/auth"
SNAPCHAT_TOKEN = "https://accounts.snapchat.com/accounts/oauth2/token"
SNAPCHAT_ME = "https://kit.snapchat.com/v1/me"
PINTEREST_AUTHORIZE = "https://www.pinterest.com/oauth/"
PINTEREST_TOKEN = "https://api.pinterest.com/v5/oauth/token"
PINTEREST_ME = "https://api.pinterest.com/v5/user_account"
TELEGRAM_AUTHORIZE = "https://oauth.telegram.org/auth"
TELEGRAM_TOKEN = "https://oauth.telegram.org/token"
TELEGRAM_JWKS = "https://oauth.telegram.org/.well-known/jwks.json"
WARGAMING_LOGIN = "https://api.worldoftanks.eu/wot/auth/login/"
WARGAMING_ACCOUNT_INFO = "https://api.worldoftanks.eu/wot/account/info/"
BUNGIE_AUTHORIZE = "https://www.bungie.net/en/OAuth/Authorize"
BUNGIE_TOKEN = "https://www.bungie.net/platform/app/oauth/token/"
BUNGIE_MEMBERSHIPS = "https://www.bungie.net/Platform/User/GetMembershipsForCurrentUser/"
MASTODON_SCOPE = "read:accounts"
BLUESKY_ENTRY = "https://bsky.social"                      # Einstiegsserver ohne Handle
BLUESKY_PUBLIC_API = "https://public.api.bsky.app/xrpc"
BLUESKY_SCOPE = "atproto"
PLC_DIRECTORY = "https://plc.directory"
HOST_RE = re.compile(r"^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$")


class LinkError(Exception):
    """Warum die Verknüpfung nicht zustande kam - der Code landet als ``link_error`` in der Adresse,
    ein kurzer Grund (von der Plattform oder von uns, nie ein Geheimnis) als ``link_detail``."""

    def __init__(self, code: str, text: str = ""):
        self.code = code
        super().__init__(text or code)


# Offizielle Adresse des verknüpften Kontos - damit im Profil steht, wohin es geht.
def official_url(platform: str, external_id: str, handle: str) -> str:
    if platform == "mastodon":
        # Der Handle ist „name@instanz“ - die Adresse liegt auf der Instanz.
        user, _sep, instance = str(handle or "").partition("@")
        return f"https://{instance}/@{quote(user, safe='')}" if user and instance else ""
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
            continue
        ready = bool(branding.get(spec["id_field"]))
        if spec.get("secret_field"):
            ready = ready and bool(branding.get(spec["secret_field"]))
        if spec.get("extra_field"):
            ready = ready and bool(branding.get(spec["extra_field"]))
        out[key] = ready
    for key in disabled_platforms(branding):
        if key in out:
            out[key] = False
    return out


# Plattformen ohne Anmeldung, die Mitglieder von Hand eintragen - der Verein kann auch sie abschalten (#558).
MANUAL_PLATFORMS = {
    "instagram": {"label": "Instagram", "field": "instagram_handle", "visibility": "instagram"},
    "psn": {"label": "PlayStation Network", "field": "psn_id", "visibility": "psn"},
    "nintendo": {"label": "Nintendo", "field": "nintendo_fc", "visibility": "nintendo"},
    "ea": {"label": "EA", "field": "ea_id", "visibility": "ea"},
}
GAME_PLATFORM_KEYS = {"steam", "psn", "xbox", "epic", "nintendo", "ea", "riot", "battlenet", "faceit", "startgg", "roblox", "osu", "lichess", "wargaming", "bungie"}


def disabled_platforms(branding: dict | None) -> set[str]:
    """Die vom Verein abgehakten Plattformen (#558) - nur bekannte Schlüssel zählen."""
    known = set(PLATFORMS) | set(MANUAL_PLATFORMS)
    return {str(key) for key in ((branding or {}).get("disabled_platforms") or []) if str(key) in known}


def platform_catalog(branding: dict | None) -> list[dict]:
    """Jede Plattform, die Mitglieder eintragen oder verknüpfen können, mit Haken-Zustand - für Alle Verbindungen."""
    off = disabled_platforms(branding)
    rows = []
    for key, spec in {**PLATFORMS, **MANUAL_PLATFORMS}.items():
        rows.append({"key": key, "label": spec["label"], "field": spec["field"], "group": "game" if key in GAME_PLATFORM_KEYS else "social",
                     "linkable": key in PLATFORMS, "enabled": key not in off})
    return rows


def _credentials(platform: str, branding: dict) -> tuple[str, str]:
    spec = PLATFORMS[platform]
    client_id = str(branding.get(spec["id_field"]) or "")
    secret_field = spec.get("secret_field")
    secret = decrypt_secret(branding[secret_field]) if secret_field and branding.get(secret_field) else ""
    return client_id, secret


def public_base_url() -> str:
    base = os.getenv("PUBLIC_BACKEND_URL") or os.getenv("PUBLIC_BASE_URL") or os.getenv("FRONTEND_URL") or ""
    return base.strip().rstrip("/")


def frontend_url() -> str:
    return (os.getenv("FRONTEND_URL") or public_base_url()).strip().rstrip("/")


def redirect_uri(platform: str) -> str:
    return f"{public_base_url()}/api/platform-links/{platform}/callback"


def client_name(branding: dict | None) -> str:
    return str((branding or {}).get("club_name") or "THE LION SQUAD").strip() or "THE LION SQUAD"


async def begin_link(db, platform: str, branding: dict, state: str, user_input: str = "") -> str:
    """Die Adresse, an die der Browser geht. Mastodon und Bluesky brauchen vorher Arbeit (App je Instanz,
    PAR mit DPoP) und merken sich die Sitzung zum ``state``; alle anderen liefern die Adresse direkt."""
    if platform not in PLATFORMS:
        raise LinkError("unknown")
    if platform in disabled_platforms(branding):
        raise LinkError("disabled")
    if platform == "mastodon":
        return await _mastodon_authorize(db, branding, state, user_input)
    if platform == "bluesky":
        return await _bluesky_authorize(db, branding, state, user_input)
    return authorize_url(platform, branding, state)


async def _remember_session(db, nonce: str, platform: str, data: dict) -> None:
    now = now_utc()
    await db.platform_link_sessions.delete_many({"expires_at": {"$lt": now.isoformat()}})
    await db.platform_link_sessions.update_one({"nonce": nonce}, {"$set": {
        "nonce": nonce, "platform": platform, "data": data, "expires_at": (now + timedelta(minutes=STATE_MINUTES)).isoformat(),
    }}, upsert=True)


async def _take_session(db, nonce: str) -> dict | None:
    """Die Sitzung zum state - einmal lesbar, dann weg."""
    doc = await db.platform_link_sessions.find_one({"nonce": nonce}, {"_id": 0})
    if not doc:
        return None
    await db.platform_link_sessions.delete_one({"nonce": nonce})
    if str(doc.get("expires_at") or "") < now_utc().isoformat():
        return None
    return doc.get("data") or {}


def _resolves_public(host: str) -> bool:
    """Nur echte öffentliche Adressen - die Website spricht keine internen Hosts an, nur weil jemand sie tippt."""
    try:
        infos = socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)
    except (socket.gaierror, UnicodeError, OSError):
        return False
    try:
        addresses = [ipaddress.ip_address(info[4][0]) for info in infos]
    except ValueError:
        return False
    return bool(addresses) and all(address.is_global for address in addresses)


# ---------- Mastodon: Instanz wählen, App je Instanz registrieren ----------

def mastodon_instance(raw: str) -> str:
    """Aus „mastodon.social“, „@paula@mastodon.social“ oder „https://mastodon.social/@paula“ wird der Host."""
    value = str(raw or "").strip().lower()
    if not value:
        raise LinkError("input", "Instanz fehlt – zum Beispiel mastodon.social")
    if "://" in value:
        value = value.split("://", 1)[1]
    elif "@" in value:
        value = value.rsplit("@", 1)[-1]
    value = value.split("/", 1)[0].split(":", 1)[0].strip(".")
    if not HOST_RE.match(value) or value.endswith((".local", ".internal", ".localhost")):
        raise LinkError("input", "Das sieht nicht nach einer Mastodon-Instanz aus – zum Beispiel mastodon.social")
    return value


async def _mastodon_app(db, branding: dict, instance: str) -> tuple[str, str]:
    """Client ID und Secret der Website bei dieser Instanz - beim ersten Mal registriert sich die Website selbst."""
    entry = await db.mastodon_apps.find_one({"instance": instance}, {"_id": 0})
    if entry and entry.get("client_id") and entry.get("client_secret"):
        try:
            return str(entry["client_id"]), decrypt_secret(entry["client_secret"])
        except RuntimeError:
            pass   # anderer SETTINGS_ENCRYPTION_KEY: neu registrieren
    async with _client() as client:
        response = await client.post(f"https://{instance}/api/v1/apps", data={
            "client_name": client_name(branding), "redirect_uris": redirect_uri("mastodon"), "scopes": MASTODON_SCOPE,
            "website": frontend_url() or public_base_url(),
        })
    body = _json(response) if response.status_code == 200 else {}
    if not body.get("client_id") or not body.get("client_secret"):
        raise LinkError("platform_error", f"{instance} nimmt die App-Registrierung nicht an (HTTP {response.status_code})")
    await db.mastodon_apps.update_one({"instance": instance}, {"$set": {
        "instance": instance, "client_id": str(body["client_id"]), "client_secret": encrypt_secret(str(body["client_secret"])),
        "registered_at": now_utc().isoformat(),
    }}, upsert=True)
    return str(body["client_id"]), str(body["client_secret"])


async def _mastodon_authorize(db, branding: dict, state: str, raw: str) -> str:
    instance = mastodon_instance(raw)
    if not await asyncio.to_thread(_resolves_public, instance):
        raise LinkError("input", f"{instance} ist nicht erreichbar oder keine öffentliche Adresse")
    client_id, _secret = await _mastodon_app(db, branding, instance)
    await _remember_session(db, str(read_state_payload(state, "mastodon")["nonce"]), "mastodon", {"instance": instance})
    return f"https://{instance}/oauth/authorize?" + urlencode({
        "client_id": client_id, "redirect_uri": redirect_uri("mastodon"), "response_type": "code", "scope": MASTODON_SCOPE, "state": state,
    })


async def _mastodon_identity(db, branding: dict, code: str, nonce: str) -> dict:
    session = await _take_session(db, nonce)
    instance = str((session or {}).get("instance") or "")
    if not instance:
        raise LinkError("invalid", "Sitzung abgelaufen – bitte noch einmal starten")
    client_id, secret = await _mastodon_app(db, branding, instance)
    async with _client() as client:
        token = await _token(client, f"https://{instance}/oauth/token", data={
            "grant_type": "authorization_code", "code": code, "client_id": client_id, "client_secret": secret,
            "redirect_uri": redirect_uri("mastodon"), "scope": MASTODON_SCOPE,
        })
        me = await client.get(f"https://{instance}/api/v1/accounts/verify_credentials", headers={"Authorization": f"Bearer {token}"})
        data = _json(me) if me.status_code == 200 else {}
        if not data.get("id") or not data.get("username"):
            raise LinkError("exchange_failed", f"verify_credentials {me.status_code}")
    handle = f"{data['username']}@{instance}"
    return {"external_id": f"{instance}:{data['id']}", "handle": handle, "display_name": str(data.get("display_name") or data["username"])}


# ---------- Bluesky: atproto OAuth (Client-Metadaten, PAR, DPoP, PKCE) ----------

def bluesky_client_id() -> str:
    return f"{public_base_url()}/api/platform-links/bluesky/client-metadata.json"


def bluesky_client_metadata(branding: dict | None) -> dict:
    """Die Website beschreibt sich selbst - der Authorization Server holt dieses Dokument unter der client_id."""
    return {
        "client_id": bluesky_client_id(), "client_name": client_name(branding), "client_uri": frontend_url() or public_base_url(),
        "redirect_uris": [redirect_uri("bluesky")], "scope": BLUESKY_SCOPE, "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"], "token_endpoint_auth_method": "none", "application_type": "web", "dpop_bound_access_tokens": True,
    }


def bluesky_handle(raw: str) -> str:
    """„@paula.bsky.social“, „paula.bsky.social“ oder „https://bsky.app/profile/paula.bsky.social“ - leer erlaubt."""
    value = str(raw or "").strip().lower().lstrip("@")
    if "bsky.app/profile/" in value:
        value = value.split("bsky.app/profile/", 1)[1].split("/", 1)[0].split("?", 1)[0]
    if not value:
        return ""
    if not HOST_RE.match(value):
        raise LinkError("input", "Das sieht nicht nach einem Bluesky-Handle aus – zum Beispiel name.bsky.social")
    return value


def _dpop_key() -> tuple[str, dict]:
    """Ein frisches ES256-Schlüsselpaar je Verknüpfung: privater Teil als PEM, öffentlicher als JWK."""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    key = ec.generate_private_key(ec.SECP256R1())
    pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()
    jwk = json.loads(jwt.algorithms.ECAlgorithm.to_jwk(key.public_key()))
    return pem, jwk


def _dpop_proof(pem: str, jwk: dict, method: str, url: str, *, nonce: str = "", access_token: str = "") -> str:
    claims = {"jti": uuid.uuid4().hex, "htm": method, "htu": url.split("?", 1)[0], "iat": int(datetime.now(timezone.utc).timestamp())}
    if nonce:
        claims["nonce"] = nonce
    if access_token:
        claims["ath"] = base64.urlsafe_b64encode(hashlib.sha256(access_token.encode()).digest()).decode().rstrip("=")
    return jwt.encode(claims, pem, algorithm="ES256", headers={"typ": "dpop+jwt", "jwk": jwk})


async def _dpop_post(client: httpx.AsyncClient, pem: str, jwk: dict, url: str, data: dict, *, nonce: str = "") -> tuple[httpx.Response, str]:
    """POST mit DPoP-Nachweis. Verlangt der Server einen Nonce (use_dpop_nonce), gleich noch einmal mit Nonce."""
    response = None
    for attempt in range(2):
        response = await client.post(url, data=data, headers={"DPoP": _dpop_proof(pem, jwk, "POST", url, nonce=nonce), "Accept": "application/json"})
        served = response.headers.get("DPoP-Nonce") or ""
        if attempt == 0 and response.status_code in (400, 401) and _json(response).get("error") == "use_dpop_nonce" and served:
            nonce = served
            continue
        return response, (served or nonce)
    return response, nonce


async def _did_document(client: httpx.AsyncClient, did: str) -> dict:
    if did.startswith("did:plc:"):
        url = f"{PLC_DIRECTORY}/{did}"
    elif did.startswith("did:web:"):
        url = f"https://{did[len('did:web:'):].split(':', 1)[0]}/.well-known/did.json"
    else:
        raise LinkError("exchange_failed", "unbekannte DID-Art")
    response = await client.get(url)
    return _json(response) if response.status_code == 200 else {}


async def _bluesky_issuer(client: httpx.AsyncClient, handle: str) -> tuple[str, str]:
    """(Authorization Server, DID) zu einem Handle - über DID-Dokument und PDS. Ohne Handle: der Einstiegsserver."""
    if not handle:
        return BLUESKY_ENTRY, ""
    resolved = await client.get(f"{BLUESKY_PUBLIC_API}/com.atproto.identity.resolveHandle", params={"handle": handle})
    did = str((_json(resolved) if resolved.status_code == 200 else {}).get("did") or "")
    if not did:
        raise LinkError("input", f"Der Handle {handle} ist bei Bluesky nicht bekannt")
    document = await _did_document(client, did)
    pds = next((str(service.get("serviceEndpoint") or "") for service in (document.get("service") or []) if str(service.get("id") or "").endswith("#atproto_pds")), "")
    if not pds:
        raise LinkError("exchange_failed", "DID-Dokument ohne PDS")
    resource = await client.get(f"{pds.rstrip('/')}/.well-known/oauth-protected-resource")
    servers = (_json(resource) if resource.status_code == 200 else {}).get("authorization_servers") or []
    if not servers:
        raise LinkError("exchange_failed", "PDS nennt keinen Authorization Server")
    return str(servers[0]).rstrip("/"), did


async def _bluesky_authorize(db, branding: dict, state: str, raw: str) -> str:
    if not public_base_url():
        raise LinkError("not_configured", "PUBLIC_BACKEND_URL fehlt")
    handle = bluesky_handle(raw)
    payload = read_state_payload(state, "bluesky")
    nonce = str(payload["nonce"])
    async with _client() as client:
        issuer, did = await _bluesky_issuer(client, handle)
        meta = await client.get(f"{issuer}/.well-known/oauth-authorization-server")
        server = _json(meta) if meta.status_code == 200 else {}
        par_endpoint = str(server.get("pushed_authorization_request_endpoint") or "")
        authorize = str(server.get("authorization_endpoint") or "")
        token_endpoint = str(server.get("token_endpoint") or "")
        if not (par_endpoint and authorize and token_endpoint):
            raise LinkError("exchange_failed", f"{issuer} nennt keine PAR-/Token-Endpunkte")
        pem, jwk = _dpop_key()
        data = {
            "client_id": bluesky_client_id(), "redirect_uri": redirect_uri("bluesky"), "response_type": "code", "scope": BLUESKY_SCOPE,
            "state": state, "code_challenge": _pkce_challenge(_pkce_verifier(nonce)), "code_challenge_method": "S256",
        }
        if handle:
            data["login_hint"] = handle
        response, dpop_nonce = await _dpop_post(client, pem, jwk, par_endpoint, data)
        body = _json(response)
        if response.status_code not in (200, 201) or not body.get("request_uri"):
            raise LinkError("platform_error", f"PAR {response.status_code}: {body.get('error_description') or body.get('error') or ''}".strip(": "))
    await _remember_session(db, nonce, "bluesky", {
        "issuer": issuer, "token_endpoint": token_endpoint, "dpop_key": encrypt_secret(pem), "dpop_jwk": jwk, "dpop_nonce": dpop_nonce, "did": did,
    })
    return f"{authorize}?" + urlencode({"client_id": bluesky_client_id(), "request_uri": str(body["request_uri"])})


async def _bluesky_identity(db, query: dict, code: str, nonce: str) -> dict:
    session = await _take_session(db, nonce)
    if not session or not session.get("token_endpoint"):
        raise LinkError("invalid", "Sitzung abgelaufen – bitte noch einmal starten")
    issuer = str(query.get("iss") or "").rstrip("/")
    if issuer and issuer != session.get("issuer"):
        raise LinkError("invalid", "iss passt nicht zum Authorization Server")
    pem, jwk = decrypt_secret(session["dpop_key"]), session["dpop_jwk"]
    async with _client() as client:
        response, _nonce = await _dpop_post(client, pem, jwk, session["token_endpoint"], {
            "grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri("bluesky"), "client_id": bluesky_client_id(),
            "code_verifier": _pkce_verifier(nonce),
        }, nonce=str(session.get("dpop_nonce") or ""))
        body = _json(response)
        did = str(body.get("sub") or "")
        if response.status_code != 200 or not did:
            raise LinkError("exchange_failed", f"token {response.status_code}")
        profile = await client.get(f"{BLUESKY_PUBLIC_API}/app.bsky.actor.getProfile", params={"actor": did})
        data = _json(profile) if profile.status_code == 200 else {}
        handle = str(data.get("handle") or "")
        if not handle:
            known = (await _did_document(client, did)).get("alsoKnownAs") or []
            handle = str(known[0])[len("at://"):] if known and str(known[0]).startswith("at://") else ""
    return {"external_id": did, "handle": handle or did, "display_name": str(data.get("displayName") or handle or did)}


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
    if platform in disabled_platforms(branding):
        raise LinkError("disabled")
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
    if platform == "faceit":
        return f"{FACEIT_AUTHORIZE}?" + urlencode({**common, "scope": "openid profile", "redirect_popup": "true"})
    if platform == "startgg":
        return f"{STARTGG_AUTHORIZE}?" + urlencode({**common, "scope": "user.identity"})
    if platform == "roblox":
        return f"{ROBLOX_AUTHORIZE}?" + urlencode({**common, "scope": "openid profile"})
    if platform == "osu":
        return f"{OSU_AUTHORIZE}?" + urlencode({**common, "scope": "identify"})
    if platform == "lichess":
        nonce = str(read_state_payload(state, platform).get("nonce") or "")
        challenge = _pkce_challenge(_pkce_verifier(nonce))
        return f"{LICHESS_AUTHORIZE}?" + urlencode({"client_id": LICHESS_CLIENT_ID, "redirect_uri": redirect, "response_type": "code", "state": state, "code_challenge": challenge, "code_challenge_method": "S256"})
    if platform == "github":
        return f"{GITHUB_AUTHORIZE}?" + urlencode({**common, "scope": "read:user"})
    if platform == "kick":
        nonce = str(read_state_payload(state, platform).get("nonce") or "")
        challenge = _pkce_challenge(_pkce_verifier(nonce))
        return f"{KICK_AUTHORIZE}?" + urlencode({**common, "scope": "user:read", "code_challenge": challenge, "code_challenge_method": "S256"})
    if platform == "reddit":
        return f"{REDDIT_AUTHORIZE}?" + urlencode({**common, "scope": "identity", "duration": "temporary"})
    if platform == "spotify":
        return f"{SPOTIFY_AUTHORIZE}?" + urlencode(common)
    if platform == "threads":
        return f"{THREADS_AUTHORIZE}?" + urlencode({**common, "scope": "threads_basic"})
    if platform == "facebook":
        return f"{FACEBOOK_AUTHORIZE}?" + urlencode({**common, "scope": "public_profile"})
    if platform == "linkedin":
        return f"{LINKEDIN_AUTHORIZE}?" + urlencode({**common, "scope": "openid profile"})
    if platform == "snapchat":
        return f"{SNAPCHAT_AUTHORIZE}?" + urlencode({**common, "scope": "https://auth.snapchat.com/oauth2/api/user.display_name https://auth.snapchat.com/oauth2/api/user.external_id"})
    if platform == "pinterest":
        return f"{PINTEREST_AUTHORIZE}?" + urlencode({**common, "scope": "user_accounts:read"})
    if platform == "telegram":
        nonce = str(read_state_payload(state, platform).get("nonce") or "")
        challenge = _pkce_challenge(_pkce_verifier(nonce))
        return f"{TELEGRAM_AUTHORIZE}?" + urlencode({**common, "scope": "openid profile", "code_challenge": challenge, "code_challenge_method": "S256"})
    if platform == "wargaming":
        # Wargaming (OpenID-artig): kein Secret, der state hängt an der Rückrufadresse wie bei Steam.
        return f"{WARGAMING_LOGIN}?" + urlencode({"application_id": client_id, "redirect_uri": f"{redirect}?{urlencode({'state': state})}", "display": "page"})
    if platform == "bungie":
        return f"{BUNGIE_AUTHORIZE}?" + urlencode({"client_id": client_id, "response_type": "code", "state": state})
    raise LinkError("unknown")


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=TIMEOUT, transport=_transport, headers={"User-Agent": USER_AGENT})


def _json(response: httpx.Response) -> dict:
    try:
        data = response.json()
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}


async def fetch_identity(platform: str, branding: dict, query: dict, state_payload: dict | None = None, db=None) -> dict:
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
        if platform == "wargaming":
            return await _wargaming_identity(branding, query)
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
        nonce = str((state_payload or {}).get("nonce") or "")
        if platform == "mastodon":
            return await _mastodon_identity(db, branding, code, nonce)
        if platform == "bluesky":
            return await _bluesky_identity(db, query, code, nonce)
        if platform == "faceit":
            return await _faceit_identity(branding, code)
        if platform == "startgg":
            return await _startgg_identity(branding, code)
        if platform == "roblox":
            return await _roblox_identity(branding, code)
        if platform == "osu":
            return await _osu_identity(branding, code)
        if platform == "lichess":
            return await _lichess_identity(code, nonce)
        if platform == "github":
            return await _github_identity(branding, code)
        if platform == "kick":
            return await _kick_identity(branding, code, nonce)
        if platform == "reddit":
            return await _reddit_identity(branding, code)
        if platform == "spotify":
            return await _spotify_identity(branding, code)
        if platform == "threads":
            return await _threads_identity(branding, code)
        if platform == "facebook":
            return await _facebook_identity(branding, code)
        if platform == "linkedin":
            return await _linkedin_identity(branding, code)
        if platform == "snapchat":
            return await _snapchat_identity(branding, code)
        if platform == "pinterest":
            return await _pinterest_identity(branding, code)
        if platform == "telegram":
            return await _telegram_identity(branding, code, nonce)
        if platform == "bungie":
            return await _bungie_identity(branding, code)
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

async def _faceit_identity(branding: dict, code: str) -> dict:
    client_id, secret = _credentials("faceit", branding)
    async with _client() as client:
        token = await _token(client, FACEIT_TOKEN, data={"grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri("faceit")}, auth=(client_id, secret))
        info = await client.get(FACEIT_USERINFO, headers={"Authorization": f"Bearer {token}"})
        data = _json(info) if info.status_code == 200 else {}
        if not data.get("guid"):
            raise LinkError("exchange_failed", f"userinfo {info.status_code}")
    nick = str(data.get("nickname") or "")
    return {"external_id": str(data["guid"]), "handle": nick, "display_name": nick}


async def _startgg_identity(branding: dict, code: str) -> dict:
    """start.gg nimmt das Token-Formular als JSON und nennt die Person nur über GraphQL."""
    client_id, secret = _credentials("startgg", branding)
    async with _client() as client:
        response = await client.post(STARTGG_TOKEN, json={"grant_type": "authorization_code", "client_id": client_id, "client_secret": secret, "code": code,
                                                          "redirect_uri": redirect_uri("startgg"), "scope": "user.identity"}, headers={"Accept": "application/json"})
        token = _json(response).get("access_token") if response.status_code == 200 else None
        if not token:
            raise LinkError("exchange_failed", f"token {response.status_code}")
        me = await client.post(STARTGG_GQL, json={"query": "{ currentUser { id slug player { gamerTag } } }"}, headers={"Authorization": f"Bearer {token}"})
        user = ((_json(me).get("data") or {}).get("currentUser") or {}) if me.status_code == 200 else {}
        if not user.get("id"):
            raise LinkError("exchange_failed", f"currentUser {me.status_code}")
    tag = str((user.get("player") or {}).get("gamerTag") or user.get("slug") or "")
    return {"external_id": str(user["id"]), "handle": tag, "display_name": tag}


async def _roblox_identity(branding: dict, code: str) -> dict:
    client_id, secret = _credentials("roblox", branding)
    async with _client() as client:
        token = await _token(client, ROBLOX_TOKEN, data={"client_id": client_id, "client_secret": secret, "grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri("roblox")})
        info = await client.get(ROBLOX_USERINFO, headers={"Authorization": f"Bearer {token}"})
        data = _json(info) if info.status_code == 200 else {}
        if not data.get("sub"):
            raise LinkError("exchange_failed", f"userinfo {info.status_code}")
    handle = str(data.get("preferred_username") or "")
    return {"external_id": str(data["sub"]), "handle": handle, "display_name": str(data.get("name") or handle)}


async def _osu_identity(branding: dict, code: str) -> dict:
    client_id, secret = _credentials("osu", branding)
    async with _client() as client:
        token = await _token(client, OSU_TOKEN, data={"client_id": client_id, "client_secret": secret, "grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri("osu")})
        me = await client.get(OSU_ME, headers={"Authorization": f"Bearer {token}"})
        data = _json(me) if me.status_code == 200 else {}
        if not data.get("id"):
            raise LinkError("exchange_failed", f"me {me.status_code}")
    name = str(data.get("username") or "")
    return {"external_id": str(data["id"]), "handle": name, "display_name": name}


async def _lichess_identity(code: str, nonce: str) -> dict:
    """Lichess: öffentlicher Client ohne Secret, PKCE ist Pflicht."""
    async with _client() as client:
        token = await _token(client, LICHESS_TOKEN, data={"grant_type": "authorization_code", "code": code, "code_verifier": _pkce_verifier(nonce), "redirect_uri": redirect_uri("lichess"), "client_id": LICHESS_CLIENT_ID})
        account = await client.get(LICHESS_ACCOUNT, headers={"Authorization": f"Bearer {token}"})
        data = _json(account) if account.status_code == 200 else {}
        if not data.get("id"):
            raise LinkError("exchange_failed", f"account {account.status_code}")
    name = str(data.get("username") or data["id"])
    return {"external_id": str(data["id"]), "handle": name, "display_name": name}


async def _github_identity(branding: dict, code: str) -> dict:
    client_id, secret = _credentials("github", branding)
    async with _client() as client:
        token = await _token(client, GITHUB_TOKEN, data={"client_id": client_id, "client_secret": secret, "code": code, "redirect_uri": redirect_uri("github")})
        user = await client.get(GITHUB_USER, headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"})
        data = _json(user) if user.status_code == 200 else {}
        if not data.get("id"):
            raise LinkError("exchange_failed", f"user {user.status_code}")
    login = str(data.get("login") or "")
    return {"external_id": str(data["id"]), "handle": login, "display_name": str(data.get("name") or login)}


async def _kick_identity(branding: dict, code: str, nonce: str) -> dict:
    client_id, secret = _credentials("kick", branding)
    async with _client() as client:
        token = await _token(client, KICK_TOKEN, data={"grant_type": "authorization_code", "client_id": client_id, "client_secret": secret, "redirect_uri": redirect_uri("kick"), "code_verifier": _pkce_verifier(nonce), "code": code})
        users = await client.get(KICK_USERS, headers={"Authorization": f"Bearer {token}"})
        rows = _json(users).get("data") if users.status_code == 200 else None
        if not rows or not (rows[0] or {}).get("user_id"):
            raise LinkError("exchange_failed", f"users {users.status_code}")
    data = rows[0]
    name = str(data.get("name") or "")
    return {"external_id": str(data["user_id"]), "handle": name, "display_name": name}


async def _reddit_identity(branding: dict, code: str) -> dict:
    client_id, secret = _credentials("reddit", branding)
    async with _client() as client:
        token = await _token(client, REDDIT_TOKEN, data={"grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri("reddit")}, auth=(client_id, secret))
        me = await client.get(REDDIT_ME, headers={"Authorization": f"Bearer {token}"})
        data = _json(me) if me.status_code == 200 else {}
        if not data.get("name"):
            raise LinkError("exchange_failed", f"me {me.status_code}")
    name = str(data["name"])
    return {"external_id": str(data.get("id") or name), "handle": name, "display_name": name}


async def _spotify_identity(branding: dict, code: str) -> dict:
    client_id, secret = _credentials("spotify", branding)
    async with _client() as client:
        token = await _token(client, SPOTIFY_TOKEN, data={"grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri("spotify")}, auth=(client_id, secret))
        me = await client.get(SPOTIFY_ME, headers={"Authorization": f"Bearer {token}"})
        data = _json(me) if me.status_code == 200 else {}
        if not data.get("id"):
            raise LinkError("exchange_failed", f"me {me.status_code}")
    display = str(data.get("display_name") or data["id"])
    return {"external_id": str(data["id"]), "handle": display, "display_name": display}


async def _threads_identity(branding: dict, code: str) -> dict:
    client_id, secret = _credentials("threads", branding)
    async with _client() as client:
        token = await _token(client, THREADS_TOKEN, data={"client_id": client_id, "client_secret": secret, "grant_type": "authorization_code", "redirect_uri": redirect_uri("threads"), "code": code})
        me = await client.get(THREADS_ME, params={"fields": "id,username"}, headers={"Authorization": f"Bearer {token}"})
        data = _json(me) if me.status_code == 200 else {}
        if not data.get("id"):
            raise LinkError("exchange_failed", f"me {me.status_code}")
    name = str(data.get("username") or "")
    return {"external_id": str(data["id"]), "handle": name, "display_name": name}


async def _facebook_identity(branding: dict, code: str) -> dict:
    client_id, secret = _credentials("facebook", branding)
    async with _client() as client:
        token = await _token(client, FACEBOOK_TOKEN, data={"client_id": client_id, "client_secret": secret, "redirect_uri": redirect_uri("facebook"), "code": code})
        me = await client.get(FACEBOOK_ME, params={"fields": "id,name"}, headers={"Authorization": f"Bearer {token}"})
        data = _json(me) if me.status_code == 200 else {}
        if not data.get("id"):
            raise LinkError("exchange_failed", f"me {me.status_code}")
    name = str(data.get("name") or "")
    return {"external_id": str(data["id"]), "handle": name, "display_name": name}


async def _linkedin_identity(branding: dict, code: str) -> dict:
    client_id, secret = _credentials("linkedin", branding)
    async with _client() as client:
        token = await _token(client, LINKEDIN_TOKEN, data={"grant_type": "authorization_code", "code": code, "client_id": client_id, "client_secret": secret, "redirect_uri": redirect_uri("linkedin")})
        info = await client.get(LINKEDIN_USERINFO, headers={"Authorization": f"Bearer {token}"})
        data = _json(info) if info.status_code == 200 else {}
        if not data.get("sub"):
            raise LinkError("exchange_failed", f"userinfo {info.status_code}")
    name = str(data.get("name") or "")
    return {"external_id": str(data["sub"]), "handle": name, "display_name": name}


async def _snapchat_identity(branding: dict, code: str) -> dict:
    client_id, secret = _credentials("snapchat", branding)
    async with _client() as client:
        token = await _token(client, SNAPCHAT_TOKEN, data={"grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri("snapchat")}, auth=(client_id, secret))
        me = await client.post(SNAPCHAT_ME, json={"query": "{ me { externalId displayName } }"}, headers={"Authorization": f"Bearer {token}"})
        user = ((_json(me).get("data") or {}).get("me") or {}) if me.status_code == 200 else {}
        if not user.get("externalId"):
            raise LinkError("exchange_failed", f"me {me.status_code}")
    name = str(user.get("displayName") or "")
    return {"external_id": str(user["externalId"]), "handle": name, "display_name": name}


async def _pinterest_identity(branding: dict, code: str) -> dict:
    client_id, secret = _credentials("pinterest", branding)
    async with _client() as client:
        token = await _token(client, PINTEREST_TOKEN, data={"grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri("pinterest")}, auth=(client_id, secret))
        me = await client.get(PINTEREST_ME, headers={"Authorization": f"Bearer {token}"})
        data = _json(me) if me.status_code == 200 else {}
        if not data.get("username"):
            raise LinkError("exchange_failed", f"user_account {me.status_code}")
    name = str(data["username"])
    return {"external_id": str(data.get("id") or name), "handle": name, "display_name": name}


async def _telegram_identity(branding: dict, code: str, nonce: str) -> dict:
    """Telegram (OpenID Connect): kein userinfo - die Person steht im signierten ID-Token, geprüft gegen die JWKS."""
    client_id, secret = _credentials("telegram", branding)
    async with _client() as client:
        response = await client.post(TELEGRAM_TOKEN, data={"grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri("telegram"),
                                                          "client_id": client_id, "client_secret": secret, "code_verifier": _pkce_verifier(nonce)},
                                     headers={"Accept": "application/json"})
        body = _json(response) if response.status_code == 200 else {}
        id_token = str(body.get("id_token") or "")
        if not id_token:
            raise LinkError("exchange_failed", f"token {response.status_code}")
        jwks = await client.get(TELEGRAM_JWKS)
        keys = (_json(jwks).get("keys") or []) if jwks.status_code == 200 else []
    try:
        header = jwt.get_unverified_header(id_token)
        jwk = next((k for k in keys if k.get("kid") == header.get("kid")), keys[0] if keys else None)
        if not jwk:
            raise LinkError("exchange_failed", "jwks leer")
        alg = str(header.get("alg") or jwk.get("alg") or "RS256")
        claims = jwt.decode(id_token, jwt.PyJWK(jwk, algorithm=alg).key, algorithms=[alg], audience=client_id)
    except jwt.PyJWTError as exc:
        raise LinkError("exchange_failed", f"id_token: {type(exc).__name__}")
    external_id = str(claims.get("sub") or claims.get("id") or "")
    if not external_id:
        raise LinkError("exchange_failed", "id_token ohne sub")
    handle = str(claims.get("preferred_username") or "")
    display = str(claims.get("name") or handle or external_id)
    return {"external_id": external_id, "handle": handle or display, "display_name": display}


async def _wargaming_identity(branding: dict, query: dict) -> dict:
    """Wargaming schickt Nickname und Konto-Kennung mit dem Rückruf - geprüft wird das Token bei Wargaming selbst."""
    if str(query.get("status") or "") != "ok":
        raise LinkError("denied", str(query.get("message") or query.get("status") or "abgebrochen"))
    account_id = str(query.get("account_id") or "")
    access_token = str(query.get("access_token") or "")
    if not account_id or not access_token:
        raise LinkError("denied", "kein Konto")
    client_id, _secret = _credentials("wargaming", branding)
    async with _client() as client:
        info = await client.get(WARGAMING_ACCOUNT_INFO, params={"application_id": client_id, "account_id": account_id, "access_token": access_token, "fields": "nickname"})
        body = _json(info) if info.status_code == 200 else {}
        row = ((body.get("data") or {}).get(account_id) or {}) if body.get("status") == "ok" else {}
        if not row:
            raise LinkError("exchange_failed", f"account/info {info.status_code}: {(body.get('error') or {}).get('message') or ''}".strip(": "))
    nick = str(row.get("nickname") or query.get("nickname") or "")
    return {"external_id": account_id, "handle": nick, "display_name": nick}


async def _bungie_identity(branding: dict, code: str) -> dict:
    client_id, secret = _credentials("bungie", branding)
    api_key = decrypt_secret(branding["bungie_api_key"]) if branding.get("bungie_api_key") else ""
    async with _client() as client:
        token = await _token(client, BUNGIE_TOKEN, data={"grant_type": "authorization_code", "code": code}, auth=(client_id, secret), headers={"X-API-Key": api_key})
        me = await client.get(BUNGIE_MEMBERSHIPS, headers={"Authorization": f"Bearer {token}", "X-API-Key": api_key})
        user = ((_json(me).get("Response") or {}).get("bungieNetUser") or {}) if me.status_code == 200 else {}
        if not user.get("membershipId"):
            raise LinkError("exchange_failed", f"memberships {me.status_code}")
    name = str(user.get("uniqueName") or user.get("displayName") or "")
    return {"external_id": str(user["membershipId"]), "handle": name, "display_name": str(user.get("displayName") or name)}


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
    "osu": (OSU_TOKEN, "form", {"scope": "public"}),
    "kick": (KICK_TOKEN, "form", {}),
    "reddit": (REDDIT_TOKEN, "basic", {}),
    "spotify": (SPOTIFY_TOKEN, "basic", {}),
    "facebook": (FACEBOOK_TOKEN, "form", {}),
    "pinterest": (PINTEREST_TOKEN, "basic", {}),
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
    "faceit": "FACEIT: {redirect} muss bei der App im Developer Portal unter „Redirect URIs“ stehen (FACEIT Connect).",
    "startgg": "start.gg: {redirect} muss bei der Anwendung unter Developer Settings als Redirect URI stehen; Scope „user.identity“.",
    "roblox": "Roblox: {redirect} muss bei der OAuth-2.0-App im Creator Dashboard als Redirect URL stehen (Scopes openid, profile); vor der Prüfung durch Roblox dürfen nur eingetragene Tester verknüpfen.",
    "osu": "osu!: {redirect} muss bei der OAuth-Anwendung als Application Callback URL stehen.",
    "github": "GitHub: {redirect} muss bei der OAuth App als Authorization callback URL stehen.",
    "kick": "Kick: {redirect} muss bei der App unter Redirect URI stehen; Scope „user:read“.",
    "reddit": "Reddit: {redirect} muss bei der App (Typ „web app“) als redirect uri stehen.",
    "spotify": "Spotify: {redirect} muss bei der App im Dashboard unter Redirect URIs stehen; im Development Mode dürfen nur eingetragene Nutzer verknüpfen.",
    "threads": "Threads: {redirect} muss in der Meta-App (Threads API) unter Redirect Callback URLs stehen; ohne App-Review dürfen nur Tester verknüpfen.",
    "facebook": "Facebook: {redirect} muss in der Meta-App unter Facebook Login → Valid OAuth Redirect URIs stehen; ohne App-Review dürfen nur Tester verknüpfen.",
    "linkedin": "LinkedIn: {redirect} muss bei der App unter Auth → Authorized redirect URLs stehen; Produkt „Sign In with LinkedIn using OpenID Connect“ freischalten.",
    "snapchat": "Snapchat: {redirect} muss bei der App im Snap Kit Portal unter Redirect URIs stehen; ohne Review nur Tester.",
    "pinterest": "Pinterest: {redirect} muss bei der App unter Redirect URIs stehen; die App braucht den Standard-Zugang von Pinterest.",
    "telegram": "Telegram: {redirect} muss bei BotFather als Allowed URL eingetragen sein (Client ID und Secret kommen von BotFather).",
    "wargaming": "Wargaming: die Website-Adresse muss beim Application-Eintrag im Developer Room hinterlegt sein; ein Secret gibt es nicht.",
    "bungie": "Bungie: {redirect} muss bei der Anwendung als Redirect URL stehen, OAuth Client Type „Confidential“; zusätzlich der API Key der Anwendung.",
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

        if platform == "mastodon":
            checks.append(_check("credentials", "ok", "Mastodon braucht keine feste App – die Website registriert sich bei jeder Instanz selbst, sobald ein Mitglied sie zum ersten Mal wählt."))
            return {"platform": platform, "ok": True, "redirect_uri": redirect, "checks": checks}
        if platform == "bluesky":
            if public_base_url():
                checks.append(_check("credentials", "ok", f"Bluesky braucht keine App – die Website beschreibt sich selbst unter {bluesky_client_id()} (atproto OAuth mit PAR, DPoP und PKCE)."))
            else:
                checks.append(_check("credentials", "fail", "Die öffentliche Adresse der Website fehlt (PUBLIC_BACKEND_URL) – ohne sie gibt es keine Client-Metadaten."))
            return {"platform": platform, "ok": all(c["state"] != "fail" for c in checks), "redirect_uri": redirect, "checks": checks}
        if platform == "lichess":
            checks.append(_check("credentials", "ok", "Lichess braucht keine App – die Verknüpfung läuft als öffentlicher Client mit PKCE."))
            return {"platform": platform, "ok": True, "redirect_uri": redirect, "checks": checks}

        client_id, secret = _credentials(platform, branding)
        if not spec.get("secret_field"):
            # Nur eine Kennung (Wargaming): kein Secret, das sich prüfen ließe.
            if client_id:
                checks.append(_check("credentials", "warn", f"Application ID eingetragen; {spec['label']} bestätigt sie erst bei einer echten Verknüpfung (Profil → Socials)."))
            else:
                checks.append(_check("credentials", "fail", f"Application ID fehlt – aus dem Developer Room von {spec['label']} eintragen und speichern."))
            return {"platform": platform, "ok": all(c["state"] != "fail" for c in checks), "redirect_uri": redirect, "checks": checks}
        if spec.get("extra_field") and not branding.get(spec["extra_field"]):
            checks.append(_check("api_key", "fail", f"API Key fehlt – aus der Anwendung bei {spec['label']} eintragen und speichern."))
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


async def links_for(db, user_id: str, branding: dict | None = None) -> list[dict]:
    """Die eigenen Verknüpfungen mit der offiziellen Adresse - die Kennung selbst bleibt beim Server.
    Abgehakte Plattformen (#558) fehlen, bleiben aber gespeichert."""
    hidden = disabled_platforms(branding) if branding is not None else set()
    rows = await db.platform_links.find({"user_id": user_id}, {"_id": 0, "platform": 1, "handle": 1, "display_name": 1, "linked_at": 1, "external_id": 1}).to_list(40)
    out = []
    for row in sorted(rows, key=lambda row: row.get("platform") or ""):
        if row.get("platform") in hidden:
            continue
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
