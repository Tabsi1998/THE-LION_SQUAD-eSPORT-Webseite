"""Plattform-Konten verknüpfen (#260): Discord und Twitch per OAuth2, Steam per OpenID.

Statt Discord-Namen, Twitch-Namen und Steam-ID zu tippen, meldet man sich einmal bei der
Plattform an. Die Plattform sagt, wer man ist; die Website trägt den Wert ins Profil ein und
merkt sich ``platform_verified.<plattform>`` - das Häkchen „verifiziert“ im Profil, im
öffentlichen Profil und bei Turnieren.

Ablauf: ``start`` baut die Anmeldeadresse mit einem signierten ``state`` (JWT: Nutzer,
Plattform, zehn Minuten). Die Plattform ruft ``callback`` auf - ohne Anmeldung bei uns, der
``state`` sagt, wer verknüpft. Ein Plattform-Konto gehört genau einem Nutzer (``taken``).
Ändert jemand das Profilfeld von Hand, fällt die Verifizierung weg.

Zugangsdaten liegen in den Branding-Einstellungen (Discord: ``discord_client_id/secret``,
Twitch: ``twitch_client_id/secret`` wie für den Live-Embed, Steam: optional ``steam_api_key``
für den Anzeigenamen). Was die Plattform liefert, steht in ``PLATFORMS[...]["delivers"]`` -
der Datenschutztext im Profil nimmt es daher.
"""
from __future__ import annotations

import logging
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

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
    "discord": {"label": "Discord", "field": "discord_name", "delivers": "Discord-Kennung und Nutzername"},
    "twitch": {"label": "Twitch", "field": "twitch_handle", "delivers": "Twitch-Kennung, Login und Anzeigename"},
    "steam": {"label": "Steam", "field": "steam_id", "delivers": "SteamID64 und, falls ein Steam-API-Schlüssel hinterlegt ist, der Anzeigename"},
}

DISCORD_AUTHORIZE = "https://discord.com/oauth2/authorize"
DISCORD_TOKEN = "https://discord.com/api/oauth2/token"
DISCORD_ME = "https://discord.com/api/users/@me"
TWITCH_AUTHORIZE = "https://id.twitch.tv/oauth2/authorize"
TWITCH_TOKEN = "https://id.twitch.tv/oauth2/token"
TWITCH_USERS = "https://api.twitch.tv/helix/users"
STEAM_OPENID = "https://steamcommunity.com/openid/login"
STEAM_SUMMARY = "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/"
STEAM_ID_RE = re.compile(r"/openid/id/(\d{17})$")


class LinkError(Exception):
    """Warum die Verknüpfung nicht zustande kam - der Code landet als ``link_error`` in der Adresse."""

    def __init__(self, code: str, text: str = ""):
        self.code = code
        super().__init__(text or code)


def providers_configured(branding: dict | None) -> dict[str, bool]:
    """Welche Plattformen eingerichtet sind. Steam braucht keine App - nur eine Rückrufadresse."""
    branding = branding or {}
    return {
        "discord": bool(branding.get("discord_client_id") and branding.get("discord_client_secret")),
        "twitch": bool(branding.get("twitch_client_id") and branding.get("twitch_client_secret")),
        "steam": True,
    }


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


def read_state(token: str | None, platform: str) -> str:
    """Der Nutzer aus dem ``state`` - oder ``LinkError('invalid')``."""
    try:
        payload = jwt.decode(str(token or ""), get_jwt_secret(), algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise LinkError("invalid", f"state: {exc}")
    if payload.get("type") != STATE_TYPE or payload.get("plt") != platform or not payload.get("sub"):
        raise LinkError("invalid", "state passt nicht zur Plattform")
    return str(payload["sub"])


def authorize_url(platform: str, branding: dict, state: str) -> str:
    """Die Adresse, an die der Browser geschickt wird."""
    if platform not in PLATFORMS:
        raise LinkError("unknown")
    if not providers_configured(branding).get(platform):
        raise LinkError("not_configured")
    redirect = redirect_uri(platform)
    if platform == "discord":
        return f"{DISCORD_AUTHORIZE}?" + urlencode({
            "client_id": branding["discord_client_id"], "redirect_uri": redirect, "response_type": "code",
            "scope": "identify", "state": state, "prompt": "consent",
        })
    if platform == "twitch":
        return f"{TWITCH_AUTHORIZE}?" + urlencode({
            "client_id": branding["twitch_client_id"], "redirect_uri": redirect, "response_type": "code",
            "scope": "", "state": state, "force_verify": "true",
        })
    # Steam (OpenID 2.0): kein Geheimnis, der state hängt an der Rückrufadresse.
    return_to = f"{redirect}?{urlencode({'state': state})}"
    return f"{STEAM_OPENID}?" + urlencode({
        "openid.ns": "http://specs.openid.net/auth/2.0", "openid.mode": "checkid_setup",
        "openid.return_to": return_to, "openid.realm": public_base_url() or return_to,
        "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
        "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
    })


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=TIMEOUT, transport=_transport)


async def fetch_identity(platform: str, branding: dict, query: dict) -> dict:
    """Wer da ist - ``{"external_id", "handle", "display_name"}``. Wirft ``LinkError``."""
    if query.get("error"):
        raise LinkError("denied", str(query.get("error")))
    try:
        if platform == "discord":
            return await _discord_identity(branding, str(query.get("code") or ""))
        if platform == "twitch":
            return await _twitch_identity(branding, str(query.get("code") or ""))
        if platform == "steam":
            return await _steam_identity(branding, query)
    except httpx.HTTPError as exc:
        logger.warning("[platform-links] %s: %s", platform, exc)
        raise LinkError("exchange_failed", str(exc))
    raise LinkError("unknown")


async def _discord_identity(branding: dict, code: str) -> dict:
    if not code:
        raise LinkError("denied", "kein code")
    async with _client() as client:
        token = await client.post(DISCORD_TOKEN, data={
            "client_id": branding["discord_client_id"], "client_secret": decrypt_secret(branding["discord_client_secret"]),
            "grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri("discord"),
        }, headers={"Accept": "application/json"})
        if token.status_code != 200 or not token.json().get("access_token"):
            raise LinkError("exchange_failed", f"token {token.status_code}")
        me = await client.get(DISCORD_ME, headers={"Authorization": f"Bearer {token.json()['access_token']}"})
        if me.status_code != 200 or not me.json().get("id"):
            raise LinkError("exchange_failed", f"me {me.status_code}")
    data = me.json()
    handle = str(data.get("username") or "")
    return {"external_id": str(data["id"]), "handle": handle, "display_name": str(data.get("global_name") or handle)}


async def _twitch_identity(branding: dict, code: str) -> dict:
    if not code:
        raise LinkError("denied", "kein code")
    client_id = branding["twitch_client_id"]
    async with _client() as client:
        token = await client.post(TWITCH_TOKEN, data={
            "client_id": client_id, "client_secret": decrypt_secret(branding["twitch_client_secret"]),
            "grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri("twitch"),
        })
        if token.status_code != 200 or not token.json().get("access_token"):
            raise LinkError("exchange_failed", f"token {token.status_code}")
        users = await client.get(TWITCH_USERS, headers={"Authorization": f"Bearer {token.json()['access_token']}", "Client-Id": client_id})
        rows = users.json().get("data") if users.status_code == 200 else None
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
            players = (summary.json().get("response") or {}).get("players") if summary.status_code == 200 else None
            if players:
                display = str(players[0].get("personaname") or steam_id)
    return {"external_id": steam_id, "handle": steam_id, "display_name": display}


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
    rows = await db.platform_links.find({"user_id": user_id}, {"_id": 0, "platform": 1, "handle": 1, "display_name": 1, "linked_at": 1}).to_list(20)
    return sorted(rows, key=lambda row: row.get("platform") or "")


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


def callback_target(*, linked: str | None = None, error: str | None = None) -> str:
    query = {"tab": "socials"}
    if linked:
        query["linked"] = linked
    if error:
        query["link_error"] = error
    return f"{frontend_url()}/profile?{urlencode(query)}"
