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

**Spiel → Server (#626):** das Spiel trägt ``discord_guild_id``; ``guild_for_game`` löst auf: eigenes Feld →
Hauptspiel → Hauptserver, ausgeschaltete und verlassene Server überspringt sie. Öffentlich steht nur, was
``public_server`` herausgibt - nie ein ausgeschalteter Server. „Du bist dabei“ (``own_status``) gibt es nur für die
eigene Person: der Bot prüft, das Ergebnis gilt fünf Minuten in ``discord_memberships``; Beitritt und Austritt meldet
er sofort (``note_membership``) - daraus zählt der Erfolg „Überall dabei“ (``discord_guilds_joined``).
"""
from __future__ import annotations

from models import new_id, now_utc

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
                                             "invite_url": None, "note": "", "channels": {}})
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
    unknown = set(patch) - {"role", "enabled", "invite_url", "note", "channels", "mirror_events", "embeds"}
    if unknown:
        raise GuildError(f"Unbekannte Einstellung: {', '.join(sorted(unknown))}")
    if "channels" in patch and patch.get("role") == "main":
        raise GuildError("Erst zum Hauptserver machen, dann die Kanäle unter „Kanäle je Zweck“ wählen.")
    if "mirror_events" in patch and (patch.get("role") or row.get("role")) == "main":
        raise GuildError("Nur für Unterserver: Termine des Hauptservers stehen immer dort.")
    if "embeds" in patch and (patch.get("role") or row.get("role")) == "main":
        raise GuildError("Die Einbettungen des Hauptservers stehen im Reiter „Einbettungen“ oben.")
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
    if "embeds" in patch:
        updates.update(_checked_embeds(row, patch["embeds"]))
    if "mirror_events" in patch:
        # Termine auf dem Spielserver auch am Hauptserver (#628) - Vorgabe an; gilt nur für Unterserver.
        updates["mirror_events"] = bool(patch["mirror_events"])
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


def _checked_embeds(row: dict, incoming) -> dict:
    """Einbettungen eines Unterservers (#628): Schalter und Kanal je Art (Rangliste, nächste Termine). Ein neuer Kanal
    heißt eine neue Nachricht - die alte bleibt im alten Kanal stehen, wie am Hauptserver."""
    from discord_service import channel_id_valid
    from services.discord_embeds import SUB_KINDS

    if not isinstance(incoming, dict):
        raise GuildError("Einbettungen kommen als Art → Schalter und Kanal.")
    current = row.get("embeds") if isinstance(row.get("embeds"), dict) else {}
    updates: dict = {}
    for kind, patch in incoming.items():
        if kind not in SUB_KINDS or not isinstance(patch, dict) or set(patch) - {"enabled", "channel_id"}:
            raise GuildError(f"Diese Einbettung gibt es auf Unterservern nicht: {kind}")
        if "enabled" in patch:
            updates[f"embeds.{kind}.enabled"] = bool(patch["enabled"])
        if "channel_id" in patch:
            channel_id = str(patch.get("channel_id") or "").strip()
            if channel_id and not channel_id_valid(channel_id):
                raise GuildError("Eine Kanal-ID ist eine Zahl mit 17 bis 20 Stellen (Rechtsklick auf den Kanal → „Kanal-ID kopieren“).")
            updates[f"embeds.{kind}.channel_id"] = channel_id or None
            if channel_id != str((current.get(kind) or {}).get("channel_id") or ""):
                for field in ("message_id", "hash", "posted_at", "updated_at", "error", "paused"):
                    updates[f"embeds.{kind}.{field}"] = None
    return updates


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



# ---------------------------------------------------------------- Spiel → Server (#626)

MEMBERSHIP_TTL_SECONDS = 300
GAME_FIELDS = {"_id": 0, "id": 1, "name": 1, "display_name": 1, "short_name": 1, "slug": 1, "discord_guild_id": 1, "parent_game_id": 1, "kind": 1}


def _usable(row: dict | None) -> bool:
    return bool(row) and bool(row.get("enabled")) and not row.get("left_at")


async def guild_for_game(db, game: dict | None) -> dict | None:
    """Der Server eines Spiels (#626): eigenes Feld → Hauptspiel → Hauptserver. Ausgeschaltete oder verlassene Server
    zählen nicht - dann gilt die nächste Stufe. ``inherited_from``: None (eigenes Feld), die ID des Hauptspiels oder „main“."""
    visited: set = set()
    current = game
    while current and current.get("id") not in visited:
        visited.add(current.get("id"))
        guild_id = str(current.get("discord_guild_id") or "")
        if guild_id:
            row = await db[COLLECTION].find_one({"guild_id": guild_id}, {"_id": 0, "channel_list": 0})
            if _usable(row):
                return {**row, "inherited_from": None if current is game else current.get("id")}
        parent_id = current.get("parent_game_id")
        current = await db.games.find_one({"id": parent_id}, GAME_FIELDS) if parent_id else None
    main = await db[COLLECTION].find_one({"role": "main"}, {"_id": 0, "channel_list": 0})
    return {**main, "inherited_from": "main"} if main else None


async def public_server(db, row: dict | None) -> dict:
    """Was öffentlich über einen Server stehen darf: Name, Symbol, Mitglieder, Einladung - nie ein ausgeschalteter."""
    if not _usable(row):
        return {"available": False}
    invite = row.get("invite_url")
    if not invite and row.get("role") == "main":
        branding = await db.settings.find_one({"id": "branding"}, {"_id": 0, "discord_invite_url": 1}) or {}
        invite = str(branding.get("discord_invite_url") or "").strip() or None
    return {"available": True, "guild_id": row["guild_id"], "name": row.get("name"), "icon_url": row.get("icon_url"),
            "member_count": row.get("member_count"), "invite_url": invite, "main": row.get("role") == "main"}


async def games_by_guild(db) -> dict[str, list[dict]]:
    """Die umgekehrte Sicht für den Reiter „Server“: je Server die Spiele - eigene und geerbte (Editionen)."""
    games = await db.games.find({}, GAME_FIELDS).to_list(500)
    by_id = {game["id"]: game for game in games}
    out: dict[str, list[dict]] = {}
    for game in games:
        own = str(game.get("discord_guild_id") or "")
        inherited = False
        if not own and game.get("parent_game_id"):
            own = str((by_id.get(game["parent_game_id"]) or {}).get("discord_guild_id") or "")
            inherited = bool(own)
        if own:
            out.setdefault(own, []).append({"id": game["id"], "name": game.get("display_name") or game.get("name"), "slug": game.get("slug"), "inherited": inherited})
    for rows in out.values():
        rows.sort(key=lambda row: (row["inherited"], str(row["name"] or "").lower()))
    return out


def _fresh(entry: dict | None, current) -> bool:
    from datetime import datetime, timedelta

    try:
        checked = datetime.fromisoformat(str((entry or {}).get("checked_at") or ""))
    except ValueError:
        return False
    return current - checked < timedelta(seconds=MEMBERSHIP_TTL_SECONDS)


async def own_status(db, user_id: str, guild_ids: list[str], *, now=None) -> dict:
    """„Du bist dabei“ - immer nur für die eigene Person (#626). Der Bot prüft, das Ergebnis gilt fünf Minuten;
    Beitritt und Austritt meldet der Bot sofort (``note_membership``). Unbekannt (Bot offline) bleibt None und wird
    nicht gemerkt. Ohne verknüpftes Discord gibt es keinen Status."""
    from services.discord_bot import bot
    from services.discord_dm import discord_link_id

    discord_id = await discord_link_id(db, user_id)
    if not discord_id or not guild_ids:
        return {"linked": bool(discord_id), "statuses": {}}
    current = now or now_utc()
    cached = {row["guild_id"]: row for row in await db.discord_memberships.find({"user_id": user_id, "guild_id": {"$in": list(guild_ids)}}, {"_id": 0}).to_list(500)}
    statuses: dict[str, bool | None] = {}
    stale = []
    for guild_id in guild_ids:
        if _fresh(cached.get(guild_id), current):
            statuses[guild_id] = bool(cached[guild_id].get("member"))
        else:
            stale.append(guild_id)
    if stale:
        for guild_id, member in (await bot.member_status(stale, discord_id)).items():
            statuses[guild_id] = member
            if member is not None:
                await db.discord_memberships.update_one({"user_id": user_id, "guild_id": guild_id},
                                                        {"$set": {"member": bool(member), "checked_at": current.isoformat()}}, upsert=True)
    return {"linked": True, "statuses": statuses}


async def member_servers(db, user: dict, *, now=None) -> dict:
    """Mitgliederbereich (#626): alle eingeschalteten Server mit „du bist dabei“ - nur für die eigene Person.
    Ohne verknüpftes Discord nur die Einladungen. Ausgeschaltete und verlassene Server fehlen."""
    rows = [row for row in await list_guilds(db) if _usable(row)]
    status = await own_status(db, user["id"], [row["guild_id"] for row in rows], now=now)
    servers = []
    for row in rows:
        servers.append({**await public_server(db, row), "member": status["statuses"].get(row["guild_id"]) if status["linked"] else None})
    return {"linked": status["linked"], "servers": servers}


async def note_membership(db, guild_id: str, discord_id: str, member: bool) -> str | None:
    """Beitritt oder Austritt, wie der Bot ihn sieht (#626) - nur für verknüpfte Konten; der Zähler für
    „Überall dabei“ rechnet sofort neu."""
    link = await db.platform_links.find_one({"platform": "discord", "external_id": str(discord_id)}, {"_id": 0, "user_id": 1})
    if not link:
        return None
    await db.discord_memberships.update_one({"user_id": link["user_id"], "guild_id": str(guild_id)},
                                            {"$set": {"member": bool(member), "checked_at": now_utc().isoformat()}}, upsert=True)
    from services.achievement_queue import request_evaluation

    await request_evaluation([link["user_id"]], "discord_guild", sources={"discord"})
    return link["user_id"]


async def matching_servers(db, user_id: str) -> list[dict]:
    """Server, die zu den eigenen Spielen passen (Lieblingsspiele und Turnier-Anmeldungen) - nur eigene Server, nicht der Hauptserver."""
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "favorite_games": 1}) or {}
    wanted = {str(value).strip().casefold() for value in user.get("favorite_games") or [] if str(value).strip()}
    game_ids = set()
    async for registration in db.tournament_registrations.find({"user_id": user_id}, {"_id": 0, "tournament_id": 1}):
        tournament = await db.tournaments.find_one({"id": registration.get("tournament_id")}, {"_id": 0, "game_id": 1})
        if (tournament or {}).get("game_id"):
            game_ids.add(tournament["game_id"])
    servers: dict[str, dict] = {}
    for game in await db.games.find({}, GAME_FIELDS).to_list(500):
        names = {str(game.get(key) or "").strip().casefold() for key in ("name", "display_name", "short_name")} - {""}
        if game["id"] not in game_ids and not names & wanted:
            continue
        row = await guild_for_game(db, game)
        if row and row.get("role") != "main":
            entry = servers.setdefault(row["guild_id"], {**await public_server(db, row), "games": []})
            entry["games"].append(game.get("display_name") or game.get("name"))
    return [server for server in servers.values() if server.get("available")]


async def greet_linked(db, user_id: str, discord_id: str) -> dict:
    """Nach dem Verknüpfen (#626): eine Direktnachricht mit den Servern zu den eigenen Spielen - nur DM, nie ein Kanal;
    einmal je Discord-Konto. Steht wie jede Direktnachricht im Discord-Log (ohne Inhalt zum erneuten Senden)."""
    from discord_service import REASON_TEXTS, build_embed, resolve_buttons
    from services.discord_bot import bot, bot_settings
    from services.discord_dm import DM_TARGET

    person = await db.users.find_one({"id": user_id}, {"_id": 0, "discord_servers_greeted_for": 1}) or {}
    if str(person.get("discord_servers_greeted_for") or "") == str(discord_id):
        return {"ok": False, "reason": "already_greeted"}
    servers = [server for server in await matching_servers(db, user_id) if server.get("invite_url")][:5]
    if not servers:
        return {"ok": False, "reason": "nothing_to_suggest"}
    lines = [f"• **{server['name']}** – für {', '.join(server['games'][:3])}" for server in servers]
    embed = await build_embed("Passend zu deinen Spielen", "Dein Discord-Konto ist verknüpft. Diese Server des Vereins passen zu deinen Spielen:\n"
                              + "\n".join(lines), color=0x5865F2, url="/members/area")
    log = {"id": new_id(), "channel": "discord", "target": DM_TARGET, "user_id": user_id, "event_key": "discord.servers_for_games",
           "title": embed["title"], "status": "skipped", "error": None, "reason": None, "created_at": now_utc().isoformat()}
    settings = await db.settings.find_one({"id": "discord"}, {"_id": 0, "bot_enabled": 1, "bot_token": 1}) or {}
    if not bot_settings(settings)["enabled"]:
        log["reason"], log["error"] = "bot_off", REASON_TEXTS["bot_off"]
        await db.email_logs.insert_one(log)
        return {"ok": False, "reason": "bot_off"}
    buttons = await resolve_buttons([{"label": str(server["name"])[:80], "url": server["invite_url"]} for server in servers])
    try:
        result = await bot.send_dm(str(discord_id), embed, buttons=buttons)
    except Exception as exc:  # noqa: BLE001 - das Verknüpfen darf nie an Discord scheitern
        result = {"ok": False, "reason": "error", "error": type(exc).__name__}
    if result.get("ok"):
        log["status"], log["message_id"] = "sent", result.get("message_id")
        await db.users.update_one({"id": user_id}, {"$set": {"discord_servers_greeted_for": str(discord_id)}})
    else:
        reason = result.get("reason") or "error"
        log["status"] = "skipped" if reason == "bot_offline" else "failed"
        log["reason"] = "dm_forbidden" if reason == "forbidden" else reason
        log["error"] = result.get("error") or REASON_TEXTS.get(log["reason"]) or reason
    await db.email_logs.insert_one(log)
    return result
