"""Online-Zahl und „wer ist im Voice“ auf der Website (#581) - aus dem Server-Widget von Discord.

Der Discord ist die Community; die Website zeigt, dass dort was los ist. Quelle ist das Server-Widget
(Discord → Servereinstellungen → Widget → „Server-Widget aktivieren“): ``widget.json`` liefert ohne Bot-Recht
und ohne die geschützten Presence-Intents die Online-Zahl und die öffentlichen Sprachkanäle mit Belegung.
Der Bot ergänzt nur die Server-ID. Ein Job holt das Widget jede Minute und legt den Stand ab
(``settings`` mit ``id: discord_widget``) - Startseite, Mitgliederbereich und App lesen nur diesen Stand.

- **Startseite:** nur Zahlen („Discord: 42 online · 5 im Voice“) und der Einladungs-Link.
- **Mitgliederbereich (Web und App):** je belegtem Sprachkanal Name und Zahl („Turnier-Lobby: 4“).
- **Nie Namen von Personen:** das Widget liefert sie mit, sie werden beim Abruf verworfen. Gezählt werden
  nur die Sprachkanäle, die das Widget selbst zeigt - private Kanäle bleiben unsichtbar.

Widget aus oder Server unbekannt: die Anzeige verschwindet, der Bot-Kasten im Admin sagt warum und wo man es
einschaltet. Ein Stand älter als fünf Minuten wird nicht mehr gezeigt.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from models import now_utc

logger = logging.getLogger("tls.discord.widget")

WIDGET_URL = "https://discord.com/api/guilds/{guild_id}/widget.json"
STATE_ID = "discord_widget"
FRESH_SECONDS = 300
REASON_TEXTS = {
    "no_guild": "Der Bot kennt den Server noch nicht – Bot verbinden oder unter „Discord-Bot“ die Server-ID eintragen.",
    "widget_disabled": ("Das Server-Widget ist aus: Discord → Servereinstellungen → Widget → „Server-Widget aktivieren“. "
                        "Bis dahin zeigt die Website keine Discord-Zahlen."),
    "unknown_guild": "Discord kennt diese Server-ID nicht – unter „Discord-Bot“ die Server-ID prüfen.",
    "rate_limited": "Discord bremst gerade – der nächste Abruf kommt in einer Minute.",
    "error": "Discord hat nicht geantwortet – der nächste Abruf kommt in einer Minute.",
}


def summarize(payload: dict | None) -> dict:
    """Aus dem Widget nur Zahlen: online gesamt und je öffentlichem Sprachkanal die Belegung - keine Namen."""
    payload = payload or {}
    channels = {}
    for channel in payload.get("channels") or []:
        if channel.get("id"):
            channels[str(channel["id"])] = {"name": str(channel.get("name") or "Sprachkanal")[:100], "position": int(channel.get("position") or 0)}
    counts: dict[str, int] = {}
    for member in payload.get("members") or []:
        channel_id = str(member.get("channel_id") or "")
        if channel_id in channels:
            counts[channel_id] = counts.get(channel_id, 0) + 1
    rows = sorted(((channels[cid], count) for cid, count in counts.items()), key=lambda row: (row[0]["position"], row[0]["name"]))
    invite = str(payload.get("instant_invite") or "")
    return {
        "online": max(0, int(payload.get("presence_count") or 0)),
        "in_voice": sum(counts.values()),
        "voice": [{"name": channel["name"], "count": count} for channel, count in rows],
        "invite": invite if invite.startswith("https://") else None,
    }


async def guild_id(db) -> str:
    """Die Server-ID: eingetragen unter „Discord-Bot“, sonst der Server, mit dem der Bot verbunden ist."""
    from services.discord_bot import bot_settings, read_state

    settings = await db.settings.find_one({"id": "discord"}, {"_id": 0, "bot_guild_id": 1}) or {}
    configured = bot_settings(settings)["guild_id"]
    if configured.isdigit():
        return configured
    seen = str((await read_state(db)).get("guild_id") or "")
    return seen if seen.isdigit() else ""


async def _fetch(url: str) -> tuple[int, dict]:
    import httpx

    async with httpx.AsyncClient(timeout=10.0, headers={"User-Agent": "LION-Website (Discord-Widget)"}) as client:
        response = await client.get(url)
    try:
        body = response.json()
    except ValueError:
        body = {}
    return response.status_code, body if isinstance(body, dict) else {}


async def _save(db, fields: dict, unset: tuple[str, ...] = ()) -> None:
    op: dict = {"$set": fields, "$setOnInsert": {"id": STATE_ID}}
    if unset:
        op["$unset"] = {key: "" for key in unset}
    await db.settings.update_one({"id": STATE_ID}, op, upsert=True)


async def refresh(db, *, fetch=None, now: datetime | None = None) -> dict:
    """Job, jede Minute: Widget holen und den Stand ablegen. Bremst Discord oder hakt das Netz, bleibt der letzte Stand."""
    stamp = (now or now_utc()).isoformat()
    gid = await guild_id(db)
    if not gid:
        await _save(db, {"available": False, "reason": "no_guild", "checked_at": stamp}, ("online", "in_voice", "voice", "invite"))
        return {"ok": False, "reason": "no_guild"}
    try:
        status, body = await (fetch or _fetch)(WIDGET_URL.format(guild_id=gid))
    except Exception as exc:  # noqa: BLE001 - die Startseite darf nie an Discord hängen
        logger.info("[discord-widget] %s", type(exc).__name__)
        status, body = 0, {}
    if status == 200:
        await _save(db, {**summarize(body), "available": True, "reason": None, "guild_id": gid, "fetched_at": stamp, "checked_at": stamp})
        return {"ok": True}
    if status in (403, 404):
        reason = "widget_disabled" if status == 403 else "unknown_guild"
        await _save(db, {"available": False, "reason": reason, "guild_id": gid, "checked_at": stamp}, ("online", "in_voice", "voice", "invite"))
        return {"ok": False, "reason": reason}
    reason = "rate_limited" if status == 429 else "error"
    await _save(db, {"reason": reason, "checked_at": stamp})
    return {"ok": False, "reason": reason}


async def _state(db) -> dict:
    return await db.settings.find_one({"id": STATE_ID}, {"_id": 0}) or {}


def _fresh(state: dict, now: datetime | None = None) -> bool:
    try:
        fetched = datetime.fromisoformat(str(state.get("fetched_at") or "").replace("Z", "+00:00"))
    except ValueError:
        return False
    fetched = fetched if fetched.tzinfo else fetched.replace(tzinfo=timezone.utc)
    return (now or now_utc()) - fetched <= timedelta(seconds=FRESH_SECONDS)


async def _invite(db, state: dict) -> str | None:
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0, "discord_invite_url": 1}) or {}
    return str(branding.get("discord_invite_url") or "").strip() or state.get("invite")


async def public_view(db, now: datetime | None = None) -> dict:
    """Für die Startseite: nur Zahlen und der Einladungs-Link - oder nichts."""
    state = await _state(db)
    if not state.get("available") or not _fresh(state, now) or not state.get("online"):
        return {"available": False}
    return {"available": True, "online": int(state.get("online") or 0), "in_voice": int(state.get("in_voice") or 0), "invite": await _invite(db, state)}


async def member_view(db, now: datetime | None = None) -> dict:
    """Für Mitglieder: dazu je belegtem Sprachkanal Name und Zahl - nie Namen von Personen."""
    view = await public_view(db, now)
    if not view["available"]:
        return view
    return {**view, "voice": list((await _state(db)).get("voice") or [])}


async def admin_view(db, now: datetime | None = None) -> dict:
    """Für den Bot-Kasten: läuft es, und wenn nicht, warum - mit Klickweg."""
    state = await _state(db)
    reason = state.get("reason")
    return {"available": bool(state.get("available")) and _fresh(state, now), "reason": reason, "reason_text": REASON_TEXTS.get(reason or ""),
            "online": state.get("online"), "in_voice": state.get("in_voice"), "fetched_at": state.get("fetched_at"), "checked_at": state.get("checked_at")}
