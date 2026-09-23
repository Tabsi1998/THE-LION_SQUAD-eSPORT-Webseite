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
DISCORD_APP_ME = "https://discord.com/api/v10/applications/@me"
TWITCH_AUTHORIZE = "https://id.twitch.tv/oauth2/authorize"
TWITCH_TOKEN = "https://id.twitch.tv/oauth2/token"
TWITCH_USERS = "https://api.twitch.tv/helix/users"
STEAM_OPENID = "https://steamcommunity.com/openid/login"
STEAM_SUMMARY = "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/"
STEAM_ID_RE = re.compile(r"/openid/id/(\d{17})$")


class LinkError(Exception):
    """Warum die Verknüpfung nicht zustande kam - der Code landet als ``link_error`` in der Adresse,
    ein kurzer Grund (von der Plattform oder von uns, nie ein Geheimnis) als ``link_detail``."""

    def __init__(self, code: str, text: str = ""):
        self.code = code
        super().__init__(text or code)


# Offizielle Adresse des verknüpften Kontos - damit im Profil steht, wohin es geht.
def official_url(platform: str, external_id: str, handle: str) -> str:
    if platform == "discord" and external_id:
        return f"https://discord.com/users/{external_id}"
    if platform == "twitch" and handle:
        return f"https://www.twitch.tv/{handle}"
    if platform == "steam" and external_id:
        return f"https://steamcommunity.com/profiles/{external_id}"
    return ""


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
        # „access_denied“ heißt: die Person hat abgebrochen. Alles andere (z. B. redirect_mismatch,
        # wenn die Rückrufadresse in der Entwickler-Konsole fehlt) ist ein Einrichtungsfehler - der
        # Grund der Plattform kommt mit, damit der Betreiber ihn im Profil lesen kann.
        error = str(query.get("error"))
        if error == "access_denied":
            raise LinkError("denied", error)
        raise LinkError("platform_error", f"{error}: {query.get('error_description') or ''}".strip(" :"))
    try:
        if platform == "discord":
            return await _discord_identity(branding, str(query.get("code") or ""))
        if platform == "twitch":
            return await _twitch_identity(branding, str(query.get("code") or ""))
        if platform == "steam":
            return await _steam_identity(branding, query)
    except httpx.HTTPError as exc:
        logger.warning("[platform-links] %s: %s", platform, exc)
        # Nur die Fehlerart nach außen - die Meldung könnte die Adresse samt Code enthalten.
        raise LinkError("exchange_failed", f"Plattform nicht erreichbar ({type(exc).__name__})")
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


# ---------------------------------------------------------------- Einrichtung prüfen (Admin)

def _check(key: str, state: str, text: str) -> dict:
    return {"key": key, "state": state, "text": text}


async def check_provider(platform: str, branding: dict, *, bot_token: str | None = None) -> dict:
    """Ohne Anmeldung einer Person prüfen, was an der Einrichtung fehlt: passen Client ID und Secret
    (client_credentials), kennt die Discord-App die Rückrufadresse (über den Bot-Token lesbar)?
    Twitch verrät seine Redirect-Liste nicht - dort bleibt nur der Hinweis."""
    if platform not in PLATFORMS:
        raise LinkError("unknown")
    redirect = redirect_uri(platform)
    checks: list[dict] = []
    try:
        if platform == "discord":
            client_id, secret = branding.get("discord_client_id"), branding.get("discord_client_secret")
            if not client_id or not secret:
                checks.append(_check("credentials", "fail", "Client ID oder Client Secret fehlt – beides aus dem Developer Portal (OAuth2) eintragen und speichern."))
            else:
                async with _client() as client:
                    token = await client.post(DISCORD_TOKEN, data={"grant_type": "client_credentials", "scope": "identify"}, auth=(str(client_id), decrypt_secret(secret)), headers={"Accept": "application/json"})
                if token.status_code == 200 and (token.json() or {}).get("access_token"):
                    checks.append(_check("credentials", "ok", "Client ID und Client Secret passen zusammen."))
                else:
                    reason = (token.json() or {}).get("error_description") or (token.json() or {}).get("error") or f"HTTP {token.status_code}"
                    checks.append(_check("credentials", "fail", f"Discord lehnt Client ID oder Secret ab ({reason}). Im Developer Portal → OAuth2 „Reset Secret“, das neue Secret hier eintragen."))
            if bot_token:
                async with _client() as client:
                    app = await client.get(DISCORD_APP_ME, headers={"Authorization": f"Bot {bot_token}"})
                if app.status_code == 200:
                    data = app.json() or {}
                    app_id = str(data.get("id") or "")
                    uris = [str(u) for u in (data.get("redirect_uris") or [])]
                    if client_id and app_id and app_id != str(client_id):
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
        elif platform == "twitch":
            client_id, secret = branding.get("twitch_client_id"), branding.get("twitch_client_secret")
            if not client_id or not secret:
                checks.append(_check("credentials", "fail", "Client ID oder Client Secret fehlt – beides aus der Twitch Developer Console eintragen (Reiter Twitch) und speichern."))
            else:
                async with _client() as client:
                    token = await client.post(TWITCH_TOKEN, data={"client_id": str(client_id), "client_secret": decrypt_secret(secret), "grant_type": "client_credentials"})
                if token.status_code == 200 and (token.json() or {}).get("access_token"):
                    checks.append(_check("credentials", "ok", "Client ID und Client Secret passen zusammen."))
                else:
                    reason = (token.json() or {}).get("message") or f"HTTP {token.status_code}"
                    checks.append(_check("credentials", "fail", f"Twitch lehnt Client ID oder Secret ab ({reason}). In der Developer Console → Manage → „New Secret“, das neue Secret hier eintragen."))
            checks.append(_check("redirect", "warn", f"Twitch bestätigt Redirects nicht per API: {redirect} muss in der Developer Console unter „OAuth Redirect URLs“ stehen (genau so, ohne Schrägstrich am Ende), Client Type „Confidential“."))
        else:
            checks.append(_check("credentials", "ok", "Steam braucht keine App – die Verknüpfung läuft über OpenID."))
            key = branding.get("steam_api_key")
            if key:
                async with _client() as client:
                    summary = await client.get(STEAM_SUMMARY, params={"key": decrypt_secret(key), "steamids": "76561197960287930"})
                checks.append(_check("api_key", "ok", "Steam-API-Schlüssel gültig – Anzeigenamen kommen mit.") if summary.status_code == 200 else _check("api_key", "fail", f"Steam nimmt den API-Schlüssel nicht an (HTTP {summary.status_code}) – neu erzeugen und hier eintragen."))
            else:
                checks.append(_check("api_key", "warn", "Ohne Steam-API-Schlüssel zeigt das Profil die 17-stellige ID statt des Anzeigenamens (optional)."))
    except httpx.HTTPError as exc:
        logger.warning("[platform-links] Prüfung %s: %s", platform, exc)
        checks.append(_check("network", "fail", f"{PLATFORMS[platform]['label']} ist gerade nicht erreichbar ({type(exc).__name__}) – später noch einmal prüfen."))
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
