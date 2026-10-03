"""Server-Verzeichnis (#624, Discord VI): alle Server, auf denen der Bot ist - ein Hauptserver, beliebig viele Unterserver.

Ein Bot-Token kann auf beliebig vielen Servern sein; es braucht keinen zweiten Bot. Beim Verbinden, beim Beitreten
und beim Verlassen meldet der Bot, auf welchen Servern er ist; ``reconcile`` gleicht das mit der Sammlung
``discord_guilds`` ab: Neue Server kommen als **ausgeschalteter Unterserver** dazu, bis der Admin sie einschaltet;
verlassene bleiben mit ``left_at`` sichtbar. **Genau ein Hauptserver:** fehlt er, wird es beim Abgleich der
eingetragene (``bot_guild_id``) oder der erste - nach dem Deploy bleibt also alles, wie es war. Der Hauptserver
lässt sich nicht ausschalten (erst einen anderen zum Hauptserver machen).

Die Gesundheitsprüfung nennt je Server in Worten, was dem Bot fehlt, mit Klickweg.

**Kanalziele je Server (#625):** jeder Server-Eintrag trägt ``channels``. Unterserver kennen nur die öffentlichen
Ziele (Community, News, Events und Turniere); Vorstand, Betrieb, Test und Mitglieder gibt es nur am Hauptserver.
Die Kanäle des Hauptservers stehen weiter unter „Kanäle je Zweck“ (``settings.discord.channels``) und werden in
seinen Eintrag gespiegelt - so funktionieren alle bisherigen Aufrufer unverändert. Wird ein anderer Server
Hauptserver, wandern die Kanäle mit: seine öffentlichen werden die „Kanäle je Zweck“, die privaten sind neu zu
wählen (sie lagen auf dem alten Server); der alte Hauptserver behält seine öffentlichen.
"""
from __future__ import annotations

from models import now_utc

COLLECTION = "discord_guilds"
ROLES = ("main", "sub")
# Was der Bot je Server darf - Schlüssel wie in discord.py, Name wie im Discord-Menü, wofür.
PERMISSIONS = (
    ("view_channel", "Kanäle ansehen", "ohne sieht der Bot keinen Kanal"),
    ("send_messages", "Nachrichten senden", "für alle Meldungen"),
    ("embed_links", "Links einbetten", "Meldungen kommen als Einbettung"),
    ("read_message_history", "Nachrichtenverlauf anzeigen", "um eigene Einbettungen zu bearbeiten"),
    ("create_public_threads", "Öffentliche Threads erstellen", "Thread je Turnier"),
    ("send_messages_in_threads", "Nachrichten in Threads senden", "Thread je Turnier"),
    ("pin_messages", "Nachrichten anheften", "angepinnte Rangliste und Brackets"),
    ("manage_roles", "Rollen verwalten", "Rollen Mitglied, Vorstand, Turnierleitung"),
    ("manage_events", "Events verwalten", "Discord-Termine"),
    ("create_instant_invite", "Einladung erstellen", "Einladungslink"),
)
# „Nachrichten verwalten“ schließt das Anheften ein (so war es, bevor Discord es getrennt hat).
IMPLIED = {"pin_messages": "manage_messages"}
PERMISSION_FIX = "Discord → Servereinstellungen → Rollen → Rolle des Bots → Berechtigungen"


def permission_snapshot(permissions) -> dict[str, bool]:
    """Die Rechte des Bots als einfache Werte (aus ``guild.me.guild_permissions``) - ohne die Bibliothek zu brauchen."""
    snapshot = {key: bool(getattr(permissions, key, False)) for key, _, _ in PERMISSIONS}
    for key, alternative in IMPLIED.items():
        snapshot[key] = snapshot.get(key) or bool(getattr(permissions, alternative, False))
    if getattr(permissions, "administrator", False):
        snapshot = {key: True for key in snapshot}
    return snapshot


def missing_permissions(snapshot: dict | None) -> list[dict]:
    """Was dem Bot fehlt - in Worten. Ohne Schnappschuss (noch nie gesehen) ist das unbekannt, nicht „alles“."""
    if not snapshot:
        return []
    return [{"key": key, "label": label, "why": why} for key, label, why in PERMISSIONS if not snapshot.get(key)]


def _row(seen: dict, now: str) -> dict:
    return {"name": str(seen.get("name") or "Server")[:100], "icon_url": seen.get("icon_url") or None,
            "member_count": seen.get("member_count"), "bot_permissions": seen.get("bot_permissions") or {},
            "last_seen_at": now, "left_at": None}


def public_channels(channels: dict | None) -> dict:
    """Nur die öffentlichen Ziele - mehr darf ein Unterserver nicht haben."""
    from discord_service import PUBLIC_TARGETS

    return {target: str(value) for target, value in (channels or {}).items() if target in PUBLIC_TARGETS and value}


async def mirror_main_channels(db) -> None:
    """Die „Kanäle je Zweck“ in den Eintrag des Hauptservers spiegeln (nach jedem Speichern dort)."""
    settings = await db.settings.find_one({"id": "discord"}, {"_id": 0, "channels": 1}) or {}
    channels = {target: str(value) for target, value in (settings.get("channels") or {}).items() if value}
    await db[COLLECTION].update_one({"role": "main"}, {"$set": {"channels": channels}})


async def reconcile(db, seen: list[dict], *, configured_main: str = "", now=None) -> dict:
    """Abgleich mit den Servern des Bots: neue als ausgeschaltete Unterserver, verlassene markiert, genau ein Hauptserver."""
    stamp = (now or now_utc()).isoformat()
    existing = {row["guild_id"]: row for row in await db[COLLECTION].find({}, {"_id": 0}).to_list(500)}
    seen_ids: list[str] = []
    added = 0
    for guild in seen:
        guild_id = str(guild.get("guild_id") or "")
        if not guild_id:
            continue
        seen_ids.append(guild_id)
        if guild_id in existing:
            await db[COLLECTION].update_one({"guild_id": guild_id}, {"$set": _row(guild, stamp)})
        else:
            added += 1
            await db[COLLECTION].insert_one({"guild_id": guild_id, **_row(guild, stamp), "role": "sub", "enabled": False, "joined_at": stamp,
                                             "invite_url": None, "note": "", "games": [], "channels": {}})
    left = 0
    for guild_id, row in existing.items():
        if guild_id not in seen_ids and not row.get("left_at"):
            left += 1
            await db[COLLECTION].update_one({"guild_id": guild_id}, {"$set": {"left_at": stamp}})
    if seen_ids and not await db[COLLECTION].find_one({"role": "main"}, {"_id": 0, "guild_id": 1}):
        pick = configured_main if configured_main in seen_ids else seen_ids[0]
        await db[COLLECTION].update_one({"guild_id": pick}, {"$set": {"role": "main", "enabled": True}})
        # Die heutigen „Kanäle je Zweck“ gehören dem Hauptserver (#625).
        await mirror_main_channels(db)
    return {"seen": len(seen_ids), "added": added, "left": left}


async def list_guilds(db) -> list[dict]:
    rows = await db[COLLECTION].find({}, {"_id": 0, "channel_list": 0}).to_list(500)
    for row in rows:
        row["missing_permissions"] = missing_permissions(row.get("bot_permissions"))
    # Hauptserver zuerst, dann eingeschaltete, dann nach Name; verlassene zuletzt.
    return sorted(rows, key=lambda row: (bool(row.get("left_at")), row.get("role") != "main", not row.get("enabled"), str(row.get("name") or "").lower()))


async def main_guild_id(db) -> str:
    row = await db[COLLECTION].find_one({"role": "main"}, {"_id": 0, "guild_id": 1})
    return str((row or {}).get("guild_id") or "")


class GuildError(ValueError):
    """Ein Wunsch, der gegen die Regeln des Verzeichnisses verstößt - der Text sagt warum."""


async def update_guild(db, guild_id: str, patch: dict) -> dict:
    """Rolle, Ein/Aus, Einladungslink, Notiz. Ein Hauptserver: wer es wird, macht den bisherigen zum Unterserver."""
    row = await db[COLLECTION].find_one({"guild_id": str(guild_id)}, {"_id": 0})
    if not row:
        raise LookupError(guild_id)
    unknown = set(patch) - {"role", "enabled", "invite_url", "note", "channels"}
    if unknown:
        raise GuildError(f"Unbekannte Einstellung: {', '.join(sorted(unknown))}")
    if "channels" in patch and patch.get("role") == "main":
        raise GuildError("Erst zum Hauptserver machen, dann die Kanäle unter „Kanäle je Zweck“ wählen.")
    updates: dict = {}
    if "role" in patch:
        if patch["role"] not in ROLES:
            raise GuildError("Rolle ist „main“ (Hauptserver) oder „sub“ (Unterserver).")
        if patch["role"] == "sub" and row.get("role") == "main":
            raise GuildError("Es gibt immer einen Hauptserver – erst einen anderen Server zum Hauptserver machen.")
        if patch["role"] == "main":
            if row.get("left_at"):
                raise GuildError("Der Bot ist nicht mehr auf diesem Server – er kann kein Hauptserver sein.")
            await _switch_main(db, row)
            updates["role"] = "main"
            updates["enabled"] = True
    if "enabled" in patch:
        enabled = bool(patch["enabled"])
        if not enabled and (updates.get("role") or row.get("role")) == "main":
            raise GuildError("Der Hauptserver lässt sich nicht ausschalten – erst einen anderen Server zum Hauptserver machen.")
        updates.setdefault("enabled", enabled)
    if "invite_url" in patch:
        url = str(patch["invite_url"] or "").strip()
        if url and not url.startswith(("https://discord.gg/", "https://discord.com/invite/")):
            raise GuildError("Ein Einladungslink beginnt mit https://discord.gg/ oder https://discord.com/invite/.")
        updates["invite_url"] = url or None
    if "note" in patch:
        updates["note"] = str(patch["note"] or "").strip()[:300]
    if "channels" in patch:
        updates["channels"] = _checked_channels(row, patch["channels"])
    if updates:
        updates["updated_at"] = now_utc().isoformat()
        await db[COLLECTION].update_one({"guild_id": row["guild_id"]}, {"$set": updates})
    return await db[COLLECTION].find_one({"guild_id": row["guild_id"]}, {"_id": 0})


def _checked_channels(row: dict, incoming) -> dict:
    """Kanäle eines Unterservers: nur öffentliche Ziele, gültige Kanal-IDs; leer entfernt das Ziel."""
    from discord_service import PUBLIC_TARGETS, TARGETS, channel_id_valid

    if row.get("role") == "main":
        raise GuildError("Die Kanäle des Hauptservers stehen im Reiter „Meldungen“ unter „Kanäle je Zweck“.")
    if not isinstance(incoming, dict):
        raise GuildError("Kanäle kommen als Ziel → Kanal-ID.")
    channels = dict(row.get("channels") or {})
    for target, value in incoming.items():
        if target not in TARGETS:
            raise GuildError(f"Unbekanntes Ziel: {target}")
        if target not in PUBLIC_TARGETS:
            raise GuildError("Vorstand, Betrieb, Test und Mitglieder gibt es nur am Hauptserver.")
        channel_id = str(value or "").strip()
        if channel_id and not channel_id_valid(channel_id):
            raise GuildError("Eine Kanal-ID ist eine Zahl mit 17 bis 20 Stellen (Rechtsklick auf den Kanal → „Kanal-ID kopieren“).")
        if channel_id:
            channels[target] = channel_id
        else:
            channels.pop(target, None)
    return channels


async def _switch_main(db, new_main: dict) -> None:
    """Ein anderer Server wird Hauptserver: die Kanäle wandern mit (#625). Seine öffentlichen werden die „Kanäle je
    Zweck“, private sind neu zu wählen; der alte Hauptserver behält seine öffentlichen als Unterserver."""
    settings = await db.settings.find_one({"id": "discord"}, {"_id": 0, "channels": 1}) or {}
    old_main = await db[COLLECTION].find_one({"role": "main", "guild_id": {"$ne": new_main["guild_id"]}}, {"_id": 0, "guild_id": 1})
    if old_main:
        await db[COLLECTION].update_one({"guild_id": old_main["guild_id"]},
                                        {"$set": {"role": "sub", "channels": public_channels(settings.get("channels"))}})
    channels = public_channels(new_main.get("channels"))
    await db.settings.update_one({"id": "discord"}, {"$set": {"channels": channels}, "$setOnInsert": {"id": "discord"}}, upsert=True)
    await db[COLLECTION].update_one({"guild_id": new_main["guild_id"]}, {"$set": {"channels": channels}})


async def health(db, guild_id: str, *, connected_ids: set[str] | None = None) -> dict:
    """Gesundheitsprüfung eines Servers: Bot anwesend, Rechte in Worten; beim Hauptserver die Kanalziele mit letztem Versand."""
    from discord_service import TARGET_LABELS, target_status

    row = await db[COLLECTION].find_one({"guild_id": str(guild_id)}, {"_id": 0})
    if not row:
        raise LookupError(guild_id)
    checks: list[dict] = []
    present = not row.get("left_at") and (connected_ids is None or row["guild_id"] in connected_ids)
    checks.append({"key": "present", "ok": present, "text": "Der Bot ist auf diesem Server." if present else
                   "Der Bot ist nicht (mehr) auf diesem Server – mit dem Einladungslink für den Bot neu einladen."})
    missing = missing_permissions(row.get("bot_permissions"))
    if missing:
        names = ", ".join(f"„{entry['label']}“ ({entry['why']})" for entry in missing)
        checks.append({"key": "permissions", "ok": False, "text": f"Dem Bot fehlen: {names}. Einstellen unter {PERMISSION_FIX}."})
    elif row.get("bot_permissions"):
        checks.append({"key": "permissions", "ok": True, "text": "Der Bot hat alle nötigen Rechte."})
    if row.get("role") == "main":
        status = await target_status(db)
        for target, entry in status.items():
            if entry.get("private") and target not in ("board", "test", "members"):
                continue
            last = entry.get("last") or {}
            if not entry.get("configured"):
                checks.append({"key": f"target.{target}", "ok": target not in ("community",),
                               "text": f"{TARGET_LABELS[target]}: kein eigener Kanal" + (" – geht an Community." if not entry.get("private") else ".")})
            else:
                when = last.get("created_at")
                verdict = "zuletzt gesendet" if last.get("status") == "sent" else "zuletzt fehlgeschlagen" if last.get("status") == "failed" else "noch nichts gesendet"
                checks.append({"key": f"target.{target}", "ok": last.get("status") != "failed",
                               "text": f"{TARGET_LABELS[target]}: #{entry.get('channel_name') or entry.get('channel_id')} – {verdict}" + (f" ({when})" if when else "") + "."})
    else:
        # Unterserver: seine öffentlichen Ziele - ohne Community geht dorthin nichts.
        from discord_service import PUBLIC_TARGETS

        own = row.get("channels") or {}
        for target in PUBLIC_TARGETS:
            if own.get(target):
                last = await db.email_logs.find_one({"channel": "discord", "guild_id": row["guild_id"], "target": target, "status": {"$in": ["sent", "failed"]}},
                                                    {"_id": 0, "status": 1, "created_at": 1}, sort=[("created_at", -1)])
                verdict = "zuletzt gesendet" if (last or {}).get("status") == "sent" else "zuletzt fehlgeschlagen" if last else "noch nichts gesendet"
                checks.append({"key": f"target.{target}", "ok": (last or {}).get("status") != "failed", "text": f"{TARGET_LABELS[target]}: Kanal {own[target]} – {verdict}."})
            else:
                checks.append({"key": f"target.{target}", "ok": target != "community",
                               "text": f"{TARGET_LABELS[target]}: kein Kanal" + (" – auf diesem Server kommt nichts an." if target == "community" else " – geht an Community.")})
    await db[COLLECTION].update_one({"guild_id": row["guild_id"]}, {"$set": {"health_checked_at": now_utc().isoformat()}})
    return {"guild_id": row["guild_id"], "ok": all(check["ok"] for check in checks), "checks": checks}


def invite_permissions() -> int:
    """Die Rechte im Einladungslink für weitere Server - dieselben wie oben."""
    import discord

    permissions = discord.Permissions.none()
    permissions.update(**{key: True for key, _, _ in PERMISSIONS})
    return permissions.value


def bot_invite_url(application_id: str) -> str | None:
    """OAuth-Link, mit dem der Bot auf einen weiteren Server kommt (Scopes bot und Slash-Befehle)."""
    if not str(application_id or "").isdigit():
        return None
    return (f"https://discord.com/oauth2/authorize?client_id={application_id}&scope=bot%20applications.commands"
            f"&permissions={invite_permissions()}")


async def send_test(db, guild_id: str, *, confirmed: bool = False) -> dict:
    """Testnachricht (#624): am Hauptserver in den privaten Testkanal (wie „Test“ bei den Kanälen); am Unterserver in
    dessen Systemkanal - der ist öffentlich, darum nur nach Bestätigung."""
    from discord_service import _new_log, _send_embed, send_to
    from services.discord_bot import bot

    row = await db[COLLECTION].find_one({"guild_id": str(guild_id)}, {"_id": 0})
    if not row:
        raise LookupError(guild_id)
    title = f"{row.get('name') or 'Server'} · Testnachricht"
    text = "Diese Nachricht bestätigt, dass der Bot auf diesem Server schreiben darf. 🦁"
    if row.get("role") == "main":
        return await send_to("test", title, text, event_key="test.guild", test=True)
    if not confirmed:
        raise GuildError("Die Testnachricht geht in den Systemkanal dieses Servers – den sehen alle dort. Bitte bestätigen.")
    channel_id = bot.system_channel_id(row["guild_id"])
    if not channel_id:
        return {"ok": False, "reason": "channel_missing", "error": "Dieser Server hat keinen Systemkanal (Discord → Servereinstellungen → Übersicht → Systemnachrichten-Kanal)."}
    log = _new_log("test.guild", title, "guild", test=True)
    log["guild_id"] = row["guild_id"]
    return await _send_embed(channel_id, title=title, description=text, color=0x29B6E8, url=None, fields=None, image_url=None, log=log)
