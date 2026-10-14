"""Discord-Meldungen - über den Bot (#566).

Seit Discord III schickt die Website alles über den Vereins-Bot: je Ziel ein Kanal aus
``settings.discord.channels`` statt einer Webhook-Adresse. Öffentliche Ziele - ``news``,
``events`` - fallen ohne eigenen Kanal auf ``community`` zurück. Private Ziele - ``board``
(Vorstand), ``ops`` (Betrieb, #265) und seit #605 ``members`` (ein Kanal, den nur die Rolle
„Mitglied“ sieht) - fallen **nie** zurück: fehlt ihr Kanal, wird nichts gesendet. Und was nur
Mitglieder oder der Vorstand sehen dürfen, geht nie an ein öffentliches Ziel, Internes nie an die
Mitglieder, egal welcher Schalter an ist. Das entscheidet ``send_event`` an einer Stelle
(``allowed_in_target``).

Ist der Bot aus oder nicht verbunden, wird nichts gesendet - kein Rückfall auf einen Webhook
(Entscheidung des Betreibers, 25.09.). Das Versand-Log (``email_logs``, channel ``discord``)
hält jeden Versuch fest, mit Kanal und Nachrichten-ID, damit spätere Pakete Nachrichten
bearbeiten können.
"""
import logging

from database import get_db
from models import new_id, now_utc
from services.discord_links import (  # noqa: F401 - umgezogen (#1420), hier weiter erreichbar
    _normalize_base_url,
    _public_base_url,
    _is_public_http_url,
    _public_avatar_url,
    _public_link_url,
    build_embed,
    resolve_buttons,
)
from services.discord_targets import (  # noqa: F401 - umgezogen (#1420), hier weiter erreichbar
    EVENTS,
    PRIVATE_TARGETS,
    PUBLIC_TARGETS,
    TARGET_LABELS,
    TARGETS,
    resolve_target,
)

logger = logging.getLogger("tls-arena.discord")
PRIVATE_DISCORD_VISIBILITIES = {"members", "internal"}

# Warum nichts ankam - in Worten mit Klickweg, für Versand-Log, Admin und Betrieb & Logs.
REASON_TEXTS = {
    "disabled": "Discord-Meldungen sind ausgeschaltet (Verbindungen → Discord → „Versand aktiv“).",
    "bot_off": "Der Bot ist aus – ohne Bot keine Meldung (Verbindungen → Discord → „Bot verbinden“).",
    "bot_offline": "Der Bot ist nicht verbunden – der Grund steht im Bot-Kasten unter Verbindungen → Discord.",
    "channel_missing": "Kein Kanal gewählt (Verbindungen → Discord → Kanäle je Zweck).",
    "forbidden": ("Der Bot darf in diesem Kanal nicht schreiben: Kanal → Bearbeiten → Berechtigungen → Bot-Rolle: "
                  "„Kanal ansehen“, „Nachrichten senden“, „Links einbetten“."),
    "unknown_channel": "Kanal nicht gefunden – gelöscht, oder der Bot ist nicht auf diesem Server.",
    # Direktnachrichten (#567)
    "dm_forbidden": ("Discord lässt keine Direktnachricht zu – in Discord unter Einstellungen → Datenschutz „Direktnachrichten von "
                     "Servermitgliedern erlauben“, und der Bot muss mit dir auf dem Vereinsserver sein."),
    "unknown_user": "Discord kennt dieses Konto nicht mehr – im Profil unter Socials neu verknüpfen.",
    # Vorschau und Testkanal (#583)
    "test_channel_missing": "Kein Testkanal gewählt (Verbindungen → Discord → Kanäle je Zweck → Test) – ein Test geht nie in einen anderen Kanal.",
    # Mehrere Server (#625)
    "private_on_sub": "Vorstand, Betrieb, Test und Mitglieder gibt es nur am Hauptserver – auf einem anderen Server wird nichts gesendet.",
    "guild_disabled": "Dieser Server ist ausgeschaltet (Verbindungen → Discord → Server) – dorthin geht nichts.",
    "guild_left": "Der Bot ist nicht mehr auf diesem Server – dorthin geht nichts.",
    "unknown_guild": "Diesen Server kennt die Website nicht.",
    # Mitgliederkanal (#605)
    "members_channel_missing": ("Kein Mitgliederkanal gewählt (Verbindungen → Discord → Kanäle je Zweck → Mitglieder) – "
                                "was nur Mitglieder sehen dürfen, geht nie in einen anderen Kanal."),
    "not_linked": "Dein Discord-Konto ist nicht verknüpft (Profil → Socials → Discord verknüpfen).",
    # Turnier-Threads (#572)
    "thread_forbidden": ("Der Bot darf keine Threads öffnen oder darin schreiben – Turnier-Meldungen gehen bis dahin einzeln in den Kanal. "
                         "Kanal → Bearbeiten → Berechtigungen → Bot-Rolle: „Öffentliche Threads erstellen“ und „Nachrichten in Threads senden“."),
}
# Ein Ziel, dessen letzter Versuch so scheiterte, ist eine Aufgabe für die Tageszentrale (#303).
BROKEN_REASONS = ("forbidden", "unknown_channel", "thread_forbidden")


def event_field(event_key: str) -> str:
    """Feldname eines Schalters in der Datenbank. Ein Punkt im Namen wäre für MongoDB ein Unterordner."""
    return event_key.replace(".", "__")


def channel_id_valid(value) -> bool:
    """Discord-Kanal-IDs sind Snowflakes: nur Ziffern, 17 bis 20 Stellen (mit Luft nach beiden Seiten)."""
    text = str(value or "").strip()
    return text.isdigit() and 15 <= len(text) <= 22


def should_post_to_public_discord(item: dict | None) -> bool:
    """Return whether a content object is safe for a public Discord channel."""
    item = item or {}
    if item.get("is_public") is False:
        return False
    return (item.get("visibility") or "public") not in PRIVATE_DISCORD_VISIBILITIES


def allowed_in_target(item: dict | None, target: str) -> bool:
    """Darf dieser Inhalt in dieses Ziel (#605)? Öffentliche Ziele nur Öffentliches, der Mitgliederkanal nichts
    Internes; Vorstand, Betrieb und Test sind ohnehin nur für den Vorstand."""
    if item is None:
        return True
    if target in PUBLIC_TARGETS:
        return should_post_to_public_discord(item)
    if target == "members":
        return (item.get("visibility") or "public") != "internal"
    return True


async def _get_discord_config() -> dict:
    from services.discord_runtime import bot_settings

    db = get_db()
    s = await db.settings.find_one({"id": "discord"}) or {}
    stored = s.get("channels") if isinstance(s.get("channels"), dict) else {}
    return {
        "master": bool(s.get("enabled", True)),
        "bot": bot_settings(s),
        "channels": {target: str(stored.get(target) or "").strip() for target in TARGETS},
        "events": {key: (s.get("events") or {}).get(event_field(key)) for key in EVENTS},
        # Routing-Regel je Ereignis (#627); leer heißt Vorgabe.
        "routing": {key: (s.get("routing") or {}).get(event_field(key)) for key in EVENTS},
        # „Spiel-Rolle anpingen“ je Ereignis (#629); von Anfang an aus.
        "pings": {key: bool((s.get("pings") or {}).get(event_field(key))) for key in EVENTS},
    }


def ping_enabled(cfg: dict, event_key: str) -> bool:
    """Darf diese Ereignisart eine Spiel-Rolle anpingen? Nur mit Spielbezug und nie in privaten Zielen."""
    from services.discord_routing import routable

    return bool((cfg.get("pings") or {}).get(event_key)) and routable(event_key)


async def game_ping(cfg: dict, event_key: str, item: dict | None, guild_id: str | None) -> str | None:
    """Die Rolle, die diese Meldung auf diesem Server anpingt (#629) - ihre Kennung dort, oder nichts: Schalter aus,
    kein Spiel, oder die Rolle gibt es auf dem Server nicht."""
    if not ping_enabled(cfg, event_key):
        return None
    from services.discord_runtime import bot
    from services.discord_roles import ping_role_name

    return bot.role_id(await ping_role_name(get_db(), item), guild_id)


def with_ping(full: dict, role_id: str | None) -> dict:
    """Die Meldung beginnt mit der Erwähnung - genau einer, und nur diese Rolle darf Discord anpingen."""
    if not role_id:
        return full
    mention = f"<@&{role_id}>"
    return {**full, "content": f"{mention}\n{full['content']}" if full.get("content") else mention, "mention_role_ids": [role_id]}


def event_enabled(cfg: dict, event_key: str) -> bool:
    spec = EVENTS.get(event_key)
    if not spec:
        return True
    value = (cfg.get("events") or {}).get(event_key)
    return bool(spec["default"] if value is None else value)


async def target_channel(target: str, guild: dict | None = None) -> dict:
    """Wohin ein Ziel auf diesem Server heute ginge (#631): Kanal, tatsächliches Ziel, Rückfall - für die Vorschau beim
    Verteilen. Ohne ``guild`` der Hauptserver."""
    return resolve_target(await _get_discord_config(), target, guild)


def _new_log(event_key: str, title: str, target: str, *, test: bool = False) -> dict:
    log = {
        "id": new_id(), "channel": "discord", "target": target, "event_key": event_key,
        "title": title, "status": "skipped", "error": None,
        "created_at": now_utc().isoformat(),
    }
    if test:
        log["test"] = True  # Vorschau-Test (#583): steht im Log, zählt nicht als Meldung
    return log


def _payload(title, description, color, url, fields, image_url, buttons=None) -> dict:
    """Für „erneut senden“ (#303): was gesendet werden sollte - mit den Knöpfen (#573)."""
    return {"title": title[:256], "description": (description or "")[:4000], "color": color, "url": url,
            "fields": (fields or [])[:10], "image_url": image_url, "buttons": list(buttons or [])[:5]}


async def _skip(log: dict, reason: str, error: str) -> dict:
    log["reason"] = reason
    log["error"] = error
    await get_db().email_logs.insert_one(log)
    return {"ok": False, "reason": reason, "error": error, "target": log.get("target")}


async def _send_embed(channel_id: str, *, title: str, description: str, color: int, url: str | None,
                      fields: list | None, image_url: str | None, log: dict, footer: str | None = None,
                      buttons: list | None = None, embed: dict | None = None, content: str | None = None,
                      mention_role_ids: list[str] | None = None) -> dict:
    """Ein Embed über den Bot in genau diesen Kanal; das Log landet in email_logs - mit Nachrichten-ID. ``embed``
    (#866 Teil 2): schon im Aussehen der Gestaltung gerendert - dann wird nichts mehr gebaut; ``content`` darüber."""
    from services.discord_runtime import bot

    db = get_db()
    if embed is None:
        embed = await build_embed(title, description, color=color, url=url, fields=fields, image_url=image_url, footer=footer)
    links = await resolve_buttons(buttons)
    log["channel_id"] = channel_id
    extra = {"content": content} if content else {}
    if mention_role_ids:
        extra["mention_role_ids"] = mention_role_ids
        log["mention_role_ids"] = mention_role_ids
    try:
        result = await bot.send_embed(channel_id, embed, buttons=links, **extra)  # Knöpfe als Link-Zeile darunter (#573)
    except Exception as exc:  # noqa: BLE001 - ein Discord-Fehler darf nichts abbrechen
        logger.error("[discord] %s", type(exc).__name__)
        result = {"ok": False, "reason": "error", "error": type(exc).__name__}
    if result.get("ok"):
        log["status"] = "sent"
        log["message_id"] = result.get("message_id")
    else:
        log["status"] = "failed"
        log["reason"] = result.get("reason") or "error"
        if log.get("thread_id") and log["reason"] == "forbidden":
            log["reason"] = "thread_forbidden"  # im Kanal darf er, im Thread nicht (#572)
        log["error"] = result.get("error") or REASON_TEXTS.get(log["reason"]) or log["reason"]
    await db.email_logs.insert_one(log)
    return {"ok": log["status"] == "sent", "reason": log.get("reason"), "error": log.get("error"), "target": log.get("target"),
            "channel_id": channel_id, "message_id": log.get("message_id")}


async def send_to(target: str, title: str, description: str = "", *, color: int = 0x29B6E8, url: str = None,
                  fields: list = None, image_url: str = None, event_key: str = "custom",
                  footer: str | None = None, test: bool = False, thread_id: str | None = None,
                  buttons: list | None = None, guild_id: str | None = None, crossref_of: str | None = None,
                  embed: dict | None = None, content: str | None = None, mention_role_ids: list[str] | None = None) -> dict:
    """An ein Ziel senden. Öffentliche Ziele fallen auf Community zurück, private nie; ohne Bot gar nichts.
    ``mention_role_ids`` (#629): die eine Rolle, die ``content`` erwähnt - in einem privaten Ziel fällt sie weg.
    ``thread_id`` (#572): in diesen Thread im Kanal des Ziels statt in den Kanal selbst.
    ``guild_id`` (#625): an diesen Server - ohne ist der Hauptserver gemeint. Ein Unterserver muss eingeschaltet sein
    und kennt nur öffentliche Ziele; nie fällt etwas auf einen anderen Server zurück.
    ``crossref_of`` (#627): ein Querverweis am Hauptserver auf die Meldung dieses Spielservers - steht so im Log."""
    cfg = await _get_discord_config()
    guild = None
    if guild_id:
        guild = await get_db().discord_guilds.find_one({"guild_id": str(guild_id)}, {"_id": 0})
    resolved = resolve_target(cfg, target, guild)
    log = _new_log(event_key, title, resolved["target"], test=test)
    if guild_id:
        log["guild_id"] = str(guild_id)
    else:
        # Jede Meldung trägt ihren Server (#627) - ohne Angabe der Hauptserver, sobald es das Verzeichnis gibt.
        main = await get_db().discord_guilds.find_one({"role": "main"}, {"_id": 0, "guild_id": 1})
        if main:
            log["guild_id"] = str(main["guild_id"])
    if crossref_of:
        log["crossref"] = True
        log["crossref_guild_id"] = str(crossref_of)
    if resolved["fallback"]:
        log["wanted_target"] = target
    log["payload"] = _payload(title, description, color, url, fields, image_url, buttons)
    if embed is not None:
        # Gestaltet (#866 Teil 2): „erneut senden“ schickt genau diese Einbettung noch einmal.
        log["payload"]["embed"] = embed
        log["payload"]["content"] = content
    if not cfg["master"]:
        return await _skip(log, "disabled", REASON_TEXTS["disabled"])
    if not cfg["bot"]["enabled"]:
        return await _skip(log, "bot_off", REASON_TEXTS["bot_off"])
    if guild_id and guild is None:
        return await _skip(log, "unknown_guild", REASON_TEXTS["unknown_guild"])
    if guild is not None and guild.get("role") != "main":
        if guild.get("left_at"):
            return await _skip(log, "guild_left", REASON_TEXTS["guild_left"])
        if not guild.get("enabled"):
            return await _skip(log, "guild_disabled", REASON_TEXTS["guild_disabled"])
        if resolved.get("error") == "private_on_sub":
            return await _skip(log, "private_on_sub", REASON_TEXTS["private_on_sub"])
    if not resolved["channel_id"]:
        private = resolved["target"] in PRIVATE_TARGETS
        reason = f"{resolved['target']}_channel_missing" if private else "channel_missing"
        return await _skip(log, reason, REASON_TEXTS.get(reason) or REASON_TEXTS["channel_missing"])
    if thread_id:
        log["thread_id"] = str(thread_id)
    if mention_role_ids and resolved["target"] in PRIVATE_TARGETS:
        mention_role_ids = None  # privat wird nie gepingt - der Text der Erwähnung fällt mit weg
        content = "\n".join(line for line in str(content or "").split("\n") if not line.startswith("<@&")) or None
    return await _send_embed(str(thread_id or resolved["channel_id"]), title=title, description=description, color=color, url=url,
                             fields=fields, image_url=image_url, log=log, footer=footer, buttons=buttons, embed=embed, content=content,
                             mention_role_ids=mention_role_ids)


async def send_event(event_key: str, title: str, description: str = "", *, item: dict | None = None,
                     color: int = 0x29B6E8, url: str = None, fields: list = None, image_url: str = None,
                     thread_id: str | None = None, buttons: list | None = None, guild_id: str | None = None,
                     route: bool = True, embed: dict | None = None, content: str | None = None) -> dict:
    """Ein benanntes Ereignis melden: Schalter, Ziel und die Grenze „privat nie öffentlich“ an einer Stelle.
    Mit Spielbezug entscheidet die Routing-Regel (#627), welcher Server die Meldung voll bekommt und ob am
    Hauptserver ein Querverweis steht. Ein ausdrücklicher Server, ein Thread oder ``route=False`` heißt: genau dorthin."""
    spec = EVENTS.get(event_key) or {"target": "community"}
    if not allowed_in_target(item, spec["target"]):
        return {"ok": False, "reason": "private_visibility"}
    cfg = await _get_discord_config()
    if not event_enabled(cfg, event_key):
        return {"ok": False, "reason": "event_disabled"}
    full = {"color": color, "url": url, "fields": fields, "image_url": image_url, "event_key": event_key, "buttons": buttons, "embed": embed, "content": content}
    # Spiel-Rolle anpingen (#629): an jeder vollen Meldung, mit der Rolle des Servers, an den sie geht - der
    # Querverweis am Hauptserver pingt nie, sonst klingelte es bei derselben Person zweimal.
    if guild_id or thread_id or not route:
        return await send_to(spec["target"], title, description, thread_id=thread_id, guild_id=guild_id,
                             **with_ping(full, await game_ping(cfg, event_key, item, guild_id)))
    from services import discord_routing

    plan = await discord_routing.plan(get_db(), cfg, event_key, item, spec["target"])
    game_guild = (plan["game"] or {}).get("guild_id")
    sent = await send_to(spec["target"], title, description, guild_id=game_guild,
                         **with_ping(full, await game_ping(cfg, event_key, item, game_guild)))
    if not game_guild:
        return sent
    main_kind = plan["main"]
    if main_kind == "crossref" and not sent.get("ok") and sent.get("reason") in discord_routing.FALLBACK_REASONS:
        main_kind = "full"  # der Spielserver nimmt nichts an: voll an den Hauptserver statt eines Verweises ins Leere
    main = None
    if main_kind == "crossref":
        ref = discord_routing.crossref_message(title, url=url, server=plan["game"], game_name=plan["game_name"], sent=sent, color=color)
        main = await send_to(spec["target"], ref["title"], ref["description"], color=color, url=url, event_key=event_key,
                             footer=ref["footer"], buttons=ref["buttons"], crossref_of=game_guild)
    elif main_kind == "full":
        main = await send_to(spec["target"], title, description, **with_ping(full, await game_ping(cfg, event_key, item, None)))
    primary = sent if sent.get("ok") or not (main and main_kind == "full" and main.get("ok")) else main
    return {**primary, "routing": plan["rule"], "game_guild_id": game_guild, "main": main}


async def send_discord(title: str, description: str = "", *,
                       color: int = 0x29B6E8, url: str = None,
                       fields: list = None, event_key: str = "custom") -> dict:
    """Ein Embed in den Community-Kanal."""
    return await send_to("community", title, description, color=color, url=url, fields=fields, event_key=event_key)


async def send_ops_discord(title: str, description: str = "", *,
                           color: int = 0xFF3B30, url: str = None,
                           fields: list = None, event_key: str = "ops") -> dict:
    """Ein Embed nur in den Betriebskanal - nie in die Community (#265)."""
    return await send_to("ops", title, description, color=color, url=url, fields=fields, event_key=event_key)


async def send_public_discord(item: dict | None, title: str, description: str = "", *,
                              color: int = 0x29B6E8, url: str = None,
                              fields: list = None, event_key: str = "custom", image_url: str = None,
                              buttons: list | None = None) -> dict:
    """Send to a public Discord target only for publicly visible content."""
    if not should_post_to_public_discord(item):
        return {"ok": False, "reason": "private_visibility"}
    if event_key in EVENTS:
        return await send_event(event_key, title, description, item=item, color=color, url=url,
                                fields=fields, image_url=image_url, buttons=buttons)
    return await send_discord(title, description, color=color, url=url, fields=fields, event_key=event_key)


async def target_status(db=None) -> dict:
    """Je Ziel: Kanal, wohin es wirklich geht, letzter Versuch."""
    from services.discord_runtime import read_state

    db = db if db is not None else get_db()
    cfg = await _get_discord_config()
    names = {str(row.get("id")): row.get("name") for row in ((await read_state(db)).get("channels") or []) if row.get("id")}
    main_id = str(((await db.discord_guilds.find_one({"role": "main"}, {"_id": 0, "guild_id": 1})) or {}).get("guild_id") or "") or None
    status = {}
    for target in TARGETS:
        resolved = resolve_target(cfg, target)
        own = not resolved["fallback"] and bool(resolved["channel_id"])
        last = await db.email_logs.find_one(
            # Nur der Hauptserver (#627): Versand an Spielserver steht dort am Server-Eintrag.
            {"channel": "discord", "target": target, "status": {"$in": ["sent", "failed"]}, "guild_id": {"$in": [None, main_id]}},
            {"_id": 0, "status": 1, "reason": 1, "error": 1, "event_key": 1, "created_at": 1, "channel_id": 1},
            # Gleicher Zeitpunkt (Versand und gleich danach der Thread, #572): der später gespeicherte gilt.
            sort=[("created_at", -1), ("_id", -1)],
        )
        channel_id = cfg["channels"].get(target) or ""
        status[target] = {
            "label": TARGET_LABELS[target], "private": target in PRIVATE_TARGETS, "configured": own,
            "channel_id": channel_id, "channel_name": names.get(channel_id),
            "delivers_to": resolved["target"] if resolved["channel_id"] else None, "last": last,
        }
    return status


async def broken_targets(db=None) -> list[dict]:
    """Ziele, deren letzter Versuch an Kanal oder Recht scheiterte - für die Tageszentrale (#303)."""
    broken = []
    for target, entry in (await target_status(db)).items():
        last = entry.get("last") or {}
        if entry["configured"] and last.get("status") == "failed" and last.get("reason") in BROKEN_REASONS:
            broken.append({"target": target, "label": entry["label"], "reason": last.get("reason"),
                           "text": REASON_TEXTS.get(last.get("reason"), ""), "at": last.get("created_at")})
    return broken
