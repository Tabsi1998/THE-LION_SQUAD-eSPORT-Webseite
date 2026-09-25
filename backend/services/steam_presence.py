"""„Gerade in Steam“ im Mitgliederbereich (#584).

Für Spielabende und LANs: Wer sein Steam-Konto verknüpft hat **und** im Profil „Meinen Steam-Status
im Mitgliederbereich zeigen“ einschaltet, erscheint dort mit Online-Stand und aktuellem Spiel -
„Paula spielt gerade Rocket League“. Ohne Opt-in wird das Konto nie abgefragt.

Quelle ist die Steam Web API ``GetPlayerSummaries`` mit dem Steam-API-Schlüssel, der schon für den
Anzeigenamen beim Verknüpfen eingerichtet ist (Branding, verschlüsselt). Steam liefert Online-Stand
und Spiel nur bei öffentlichem Steam-Profil - sonst bleibt die Person still. Abgefragt wird alle zwei
Minuten, gebündelt (bis 100 Konten je Aufruf); es gibt keinen Verlauf, nur den aktuellen Stand, und
nach zehn Minuten ohne Abruf ist die Liste leer. Wer die Verknüpfung löst oder den Schalter ausmacht,
ist beim nächsten Lesen sofort draußen - die Antwort prüft Opt-in und Verknüpfung noch einmal.

Nichts davon ist öffentlich oder geht in den Discord: nur Vereinsmitglieder sehen die Liste.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

import httpx

from models import now_utc
from services.secret_store import decrypt_secret, secret_is_configured

logger = logging.getLogger("tls.steam")

STATE_ID = "steam_presence_state"
STEAM_SUMMARY = "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/"
POLL_INTERVAL_SECONDS = 120
STALE_AFTER_SECONDS = 600
BATCH = 100
MAX_SHOWN = 8
TIMEOUT = 20
_transport = None   # Tests hängen hier einen MockTransport ein

# Steams personastate: 0 offline (auch privates Profil), 1 online, 2 beschäftigt, 3 abwesend, 4 Schlummer, 5 handelt, 6 spielt gern
STATE_TEXTS = {1: "online", 2: "beschäftigt", 3: "abwesend", 4: "abwesend", 5: "online", 6: "online"}


def _dt(value) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=TIMEOUT, transport=_transport, headers={"User-Agent": "lionsquad-website/1.0 (+https://lionsquad.at)"})


async def api_key(db) -> str:
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0, "steam_api_key": 1}) or {}
    stored = branding.get("steam_api_key")
    return decrypt_secret(stored) if secret_is_configured(stored) else ""


async def opted_in_accounts(db) -> list[dict]:
    """Verknüpfte Steam-Konten von Mitgliedern mit Opt-in - nur die werden abgefragt."""
    users = await db.users.find(
        {"show_steam_status": True, "is_active": True, "is_banned": {"$ne": True}},
        {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1},
    ).to_list(5000)
    if not users:
        return []
    by_id = {user["id"]: user for user in users}
    links = await db.platform_links.find({"platform": "steam", "user_id": {"$in": list(by_id)}}, {"_id": 0, "user_id": 1, "external_id": 1}).to_list(5000)
    accounts = []
    for link in links:
        user = by_id.get(link.get("user_id"))
        steam_id = str(link.get("external_id") or "").strip()
        if user and steam_id.isdigit():
            accounts.append({"user_id": user["id"], "steam_id": steam_id, "username": user.get("username"),
                             "display_name": user.get("display_name") or user.get("username"), "avatar_url": user.get("avatar_url")})
    return accounts


def presence_rows(players: dict[str, dict], accounts: list[dict]) -> list[dict]:
    """Aus Steams Antwort die Zeilen für die Liste: nur wer online ist; spielt zuerst, dann nach Namen."""
    rows = []
    for account in accounts:
        player = players.get(account["steam_id"]) or {}
        try:
            state = int(player.get("personastate") or 0)
        except (TypeError, ValueError):
            state = 0
        if state <= 0:
            continue
        game = str(player.get("gameextrainfo") or "").strip()
        rows.append({
            "user_id": account["user_id"], "username": account.get("username"), "display_name": account.get("display_name"),
            "avatar_url": account.get("avatar_url"), "state": "playing" if game else "online",
            "state_text": f"spielt gerade {game}" if game else STATE_TEXTS.get(state, "online"), "game": game or None,
            "game_id": str(player.get("gameid") or "") or None,
        })
    rows.sort(key=lambda row: (row["state"] != "playing", str(row.get("display_name") or "").lower()))
    return rows


def _chunks(items: list, size: int):
    for start in range(0, len(items), size):
        yield items[start:start + size]


async def poll(db) -> dict:
    """Alle Konten mit Opt-in bei Steam abfragen und den Stand ablegen - nur die Gegenwart, kein Verlauf."""
    key = await api_key(db)
    now = now_utc().isoformat()
    if not key:
        await db.settings.update_one({"id": STATE_ID}, {"$set": {"id": STATE_ID, "fetched_at": now, "players": [], "error": "no_api_key", "checked": 0}}, upsert=True)
        return {"checked": 0, "online": 0, "error": "no_api_key"}
    accounts = await opted_in_accounts(db)
    players: dict[str, dict] = {}
    error = None
    if accounts:
        try:
            async with _client() as client:
                for chunk in _chunks(accounts, BATCH):
                    response = await client.get(STEAM_SUMMARY, params={"key": key, "steamids": ",".join(account["steam_id"] for account in chunk)})
                    if response.status_code != 200:
                        error = f"Steam antwortet {response.status_code}"
                        break
                    for player in (response.json().get("response") or {}).get("players") or []:
                        players[str(player.get("steamid") or "")] = player
        except (httpx.HTTPError, ValueError) as exc:
            error = f"{type(exc).__name__}"
            logger.warning("[steam] %s", error)
    rows = [] if error else presence_rows(players, accounts)
    await db.settings.update_one({"id": STATE_ID}, {"$set": {"id": STATE_ID, "fetched_at": now, "players": rows, "error": error, "checked": len(accounts)}}, upsert=True)
    return {"checked": len(accounts), "online": len(rows), "error": error}


async def presence_for(db, user: dict) -> dict:
    """Für den Mitgliederbereich: Zähler, bis zu acht Personen - und ob ich selbst dabei sein könnte."""
    available = bool(await api_key(db))
    me_link = await db.platform_links.find_one({"platform": "steam", "user_id": user["id"]}, {"_id": 0, "external_id": 1})
    me = {"linked": bool(me_link), "opted_in": bool(user.get("show_steam_status"))}
    if not available:
        return {"available": False, "fetched_at": None, "stale": False, "online_count": 0, "players": [], "me": me}
    state = await db.settings.find_one({"id": STATE_ID}, {"_id": 0}) or {}
    fetched = _dt(state.get("fetched_at"))
    stale = not fetched or now_utc() - fetched > timedelta(seconds=STALE_AFTER_SECONDS)
    players = [] if stale else list(state.get("players") or [])
    if players:
        # Wer inzwischen die Verknüpfung gelöst oder den Schalter ausgemacht hat, ist sofort draußen.
        allowed = {account["user_id"] for account in await opted_in_accounts(db)}
        players = [row for row in players if row.get("user_id") in allowed]
    return {
        "available": True, "fetched_at": state.get("fetched_at"), "stale": stale, "online_count": len(players),
        "players": players[:MAX_SHOWN], "me": me, "interval_seconds": POLL_INTERVAL_SECONDS,
    }
