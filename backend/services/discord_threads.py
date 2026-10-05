"""Ein Thread je Turnier (#572) - und die eine Stelle für Turnier-Meldungen im Discord.

Die erste Meldung eines Turniers im Kanal „Events und Turniere“ - meist „Anmeldung offen“ - bekommt einen
Thread. Alles Weitere des Turniers geht dort hinein: Check-in, live, Streams (#579), das Bracket (#571),
beendet, Ergebnisse. Der Kanal zeigt je Turnier eine Meldung; am Ende steht der Endstand als letzte
Nachricht im Thread. Discord archiviert einen Thread nach einer Woche Ruhe selbst - eine neue Meldung holt
ihn zurück.

Am Turnier steht unter ``discord_thread``: der Kanal, die Ankündigung, der Thread und die letzte Nachricht
des Bots darin (damit der Endstand weiß, ob er noch zuletzt steht). Darf der Bot keinen Thread öffnen, geht
es wie bisher einzeln im Kanal weiter, mit dem Grund im Versand-Log; wird ein anderer Kanal gewählt oder der
Thread gelöscht, öffnet die nächste Meldung einen neuen.

Statuswechsel kommen von vielen Stellen - Knopf der Turnierleitung, Formular, Anlegen, Zeitplan, Start an
einer Station, Gruppen- und Swiss-Runden -, alle melden sich über ``status_changed``. „Ohne Discord“ am
Turnier (``discord_skip``) hält alles zurück, ebenso alles, was nicht öffentlich ist.

**Mehrere Server (#627):** die Routing-Regel (``services/discord_routing.py``) entscheidet je Meldung. Bekommt der
Spielserver sie voll, hat das Turnier dort seinen eigenen Thread (``discord_thread_by_guild.<Server>``); am
Hauptserver (``discord_thread`` wie bisher) stehen dann die Querverweise - die erste Ankündigung im Kanal, alles
Weitere im Thread darunter. So zeigt auch der Hauptserver je Turnier genau eine Meldung.

**Turniere nur für Mitglieder (#910):** dieselben Meldungen gehen in den Kanal „Mitglieder (privat)“ am Hauptserver,
mit eigenem Thread (``discord_thread_members``) - nie öffentlich, nie auf einen Spielserver, kein Querverweis. Ohne
Mitglieder-Kanal kommt nichts an (kein Rückfall). „Intern“ und versteckte Turniere bleiben draußen.
"""
from __future__ import annotations

import logging

from models import new_id, now_utc

logger = logging.getLogger("tls.discord.threads")

FIELD = "discord_thread"
GUILD_FIELD = "discord_thread_by_guild"
MEMBERS_FIELD = "discord_thread_members"
BRACKET_STATUSES = ("live", "completed", "results_published")
FINAL_STATUSES = ("completed", "results_published")
# Scheitert der Versand in den Thread so, geht die Meldung in den Kanal - sie geht nie verloren.
FALLBACK_REASONS = ("unknown_channel", "thread_forbidden")


def thread_name(tournament: dict) -> str:
    return f"🏆 {tournament.get('title') or 'Turnier'}"[:100]


def wants_discord(tournament: dict | None) -> bool:
    """Darf dieses Turnier in den Discord? Nicht mit „Ohne Discord“ und nie, wenn es nicht für alle sichtbar ist."""
    tournament = tournament or {}
    if tournament.get("discord_skip") or tournament.get("is_public") is False:
        return False
    return (tournament.get("visibility") or "public") == "public"


def members_only(tournament: dict | None) -> bool:
    """Ein Turnier nur für Mitglieder (#910): seine Meldungen gehen in den Mitglieder-Kanal - nie öffentlich."""
    tournament = tournament or {}
    if tournament.get("discord_skip") or tournament.get("is_public") is False:
        return False
    return (tournament.get("visibility") or "public") == "members"


def state_field(guild_id: str | None = None, members: bool = False) -> str:
    """Wo der Thread-Stand eines Servers am Turnier steht: der Hauptserver wie bisher, jeder andere darunter (#627);
    der Thread im Mitglieder-Kanal für sich (#910)."""
    if members:
        return MEMBERS_FIELD
    return f"{GUILD_FIELD}.{guild_id}" if guild_id else FIELD


def thread_state(tournament: dict, guild_id: str | None = None, members: bool = False) -> dict:
    if members:
        return tournament.get(MEMBERS_FIELD) or {}
    if guild_id:
        return ((tournament.get(GUILD_FIELD) or {}).get(str(guild_id))) or {}
    return tournament.get(FIELD) or {}


def thread_of(tournament: dict, channel_id: str, guild_id: str | None = None, members: bool = False) -> str:
    """Der Thread des Turniers auf diesem Server - nur, wenn er im heute gewählten Kanal liegt."""
    state = thread_state(tournament, guild_id, members)
    if state.get("thread_id") and channel_id and str(state.get("channel_id") or "") == str(channel_id):
        return str(state["thread_id"])
    return ""


async def events_channel(guild: dict | None = None, members: bool = False) -> str:
    """Der Kanal der Turnier-Meldungen: „Events und Turniere“ - für Mitglieder-Turniere „Mitglieder (privat)“ (#910)."""
    from discord_service import _get_discord_config, resolve_target

    return resolve_target(await _get_discord_config(), "members" if members else "events", guild)["channel_id"]


async def note_message(db, tournament_id: str, message_id: str | None, guild_id: str | None = None, members: bool = False) -> None:
    """Eine neue Nachricht des Bots im Thread. Stand bis eben der Endstand zuletzt, muss er wieder nach unten."""
    from services import discord_bracket

    if not message_id:
        return
    field = state_field(guild_id, members)
    projection = {"_id": 0, FIELD: 1, GUILD_FIELD: 1, MEMBERS_FIELD: 1, discord_bracket.FIELD: 1, discord_bracket.GUILD_FIELD: 1}
    tournament = await db.tournaments.find_one({"id": tournament_id}, projection) or {}
    updates = {f"{field}.last_message_id": str(message_id), f"{field}.last_message_at": now_utc().isoformat()}
    # Das Bracket dieses Threads (#628): am Spielserver sein eigener Stand, sonst der des Hauptservers.
    bracket_field = f"{discord_bracket.GUILD_FIELD}.{guild_id}" if guild_id else discord_bracket.FIELD
    bracket = discord_bracket._state_at(tournament, bracket_field)
    thread_id = str(thread_state(tournament, guild_id, members).get("thread_id") or "")
    if bracket.get("final") and thread_id and str(bracket.get("channel_id") or "") == thread_id and str(bracket.get("message_id") or "") != str(message_id):
        updates[f"{bracket_field}.final"] = False
        discord_bracket.request_refresh(tournament_id, final=True)
    await db.tournaments.update_one({"id": tournament_id}, {"$set": updates})


async def _open_thread(db, tournament: dict, sent: dict, guild_id: str | None = None, members: bool = False) -> dict:
    """Unter der Ankündigung im Kanal den Thread öffnen und am Turnier festhalten - je Server (#627)."""
    from discord_service import REASON_TEXTS
    from services.discord_bot import bot

    channel_id, message_id = str(sent.get("channel_id") or ""), str(sent.get("message_id") or "")
    state = {"channel_id": channel_id, "message_id": message_id, "thread_id": None, "created_at": now_utc().isoformat(), "error": None}
    try:
        created = await bot.create_thread(channel_id, message_id, thread_name(tournament))
    except Exception as exc:  # noqa: BLE001 - ein Discord-Fehler hält keinen Statuswechsel auf
        created = {"ok": False, "reason": "error", "error": type(exc).__name__}
    if created.get("ok"):
        state["thread_id"] = str(created["thread_id"])
    else:
        reason = created.get("reason") or "error"
        state["error"] = REASON_TEXTS.get(reason) or created.get("error") or reason
        if reason != "bot_offline":
            # Im Versand-Log und im Kasten „Kanäle je Zweck“ - ein fehlendes Recht ist eine Aufgabe für die Tageszentrale.
            log = {"id": new_id(), "channel": "discord", "target": sent.get("target") or "events", "event_key": "tournament.thread",
                   "title": thread_name(tournament), "status": "failed", "reason": reason, "error": state["error"],
                   "channel_id": channel_id, "created_at": now_utc().isoformat()}
            if guild_id:
                log["guild_id"] = str(guild_id)
            await db.email_logs.insert_one(log)
    await db.tournaments.update_one({"id": tournament["id"]}, {"$set": {state_field(guild_id, members): state}})
    return state


async def _send(message: dict, tournament: dict, thread_id: str | None = None, guild_id: str | None = None, crossref_of: str | None = None,
                members: bool = False) -> dict:
    """Genau an diesen Server - die Routing-Regel hat ``deliver`` schon angewandt."""
    from discord_service import send_event, send_to, EVENTS

    if members:
        # Mitglieder-Turnier (#910): der private Kanal am Hauptserver; der Schalter je Meldung galt schon in ``deliver``.
        return await send_to("members", message["title"], message.get("description") or "", color=message.get("color") or 0x29B6E8,
                             url=message.get("url"), fields=message.get("fields"), image_url=message.get("image_url"), event_key=message["event_key"],
                             thread_id=thread_id, buttons=message.get("buttons"), embed=message.get("embed"), content=message.get("content"))
    if crossref_of:
        # Querverweis (#627): Titel, ein Satz, Knöpfe - nie der volle Inhalt; der Schalter galt schon für die volle Meldung.
        return await send_to(EVENTS[message["event_key"]]["target"], message["title"], message.get("description") or "", color=message.get("color") or 0x29B6E8,
                             url=message.get("url"), event_key=message["event_key"], footer=message.get("footer"), buttons=message.get("buttons"),
                             thread_id=thread_id, crossref_of=crossref_of)
    return await send_event(message["event_key"], message["title"], message.get("description") or "", item=tournament, color=message.get("color") or 0x29B6E8,
                            url=message.get("url"), fields=message.get("fields"), image_url=message.get("image_url"), thread_id=thread_id,
                            buttons=message.get("buttons"), guild_id=guild_id, route=False, embed=message.get("embed"), content=message.get("content"))


async def _deliver_on(db, tournament: dict, message: dict, in_thread: dict | None, guild: dict | None = None, crossref_of: str | None = None,
                      members: bool = False) -> dict:
    """Eine Meldung auf einem Server: in den Thread des Turniers dort; gibt es keinen, in den Kanal, der ihn öffnet.
    ``members`` (#910): im Mitglieder-Kanal am Hauptserver, mit eigenem Thread."""
    guild_id = str(guild["guild_id"]) if guild else None
    thread_id = thread_of(tournament, await events_channel(guild, members), guild_id, members)
    reopen = not thread_id
    if thread_id:
        result = await _send(in_thread or message, tournament, thread_id, guild_id, crossref_of, members)
        if result.get("ok"):
            await note_message(db, tournament["id"], result.get("message_id"), guild_id, members)
            return {**result, "thread_id": thread_id}
        if result.get("reason") not in FALLBACK_REASONS:
            return result
        # Thread gelöscht: neu im Kanal. Darf der Bot im Thread nicht schreiben: einzeln in den Kanal, ohne neuen Thread.
        reopen = result.get("reason") == "unknown_channel"
    result = await _send(message, tournament, None, guild_id, crossref_of, members)
    if result.get("ok") and reopen:
        state = await _open_thread(db, tournament, result, guild_id, members)
        result = {**result, "thread_id": state.get("thread_id")}
    return result


async def deliver(db, tournament: dict, message: dict, *, in_thread: dict | None = None) -> dict:
    """Eine Turnier-Meldung in den Thread des Turniers. Gibt es noch keinen, geht sie in den Kanal und öffnet ihn.
    ``in_thread`` ist die kurze Fassung für den Thread - ohne sie geht dieselbe Meldung hinein. Mit Spielserver (#627)
    entscheidet die Routing-Regel: voll dort, am Hauptserver voll, als Querverweis oder gar nicht."""
    from discord_service import EVENTS, _get_discord_config, event_enabled
    from services import discord_routing

    if tournament.get("discord_skip"):
        return {"ok": False, "reason": "author_opt_out"}
    members = members_only(tournament)
    if not members and not wants_discord(tournament):
        return {"ok": False, "reason": "private_visibility"}
    cfg = await _get_discord_config()
    event_key = message["event_key"]
    if not event_enabled(cfg, event_key):
        return {"ok": False, "reason": "event_disabled"}
    if members:
        # Nur für Mitglieder (#910): Mitglieder-Kanal am Hauptserver - keine Routing-Regel, kein Spielserver, kein Querverweis.
        return await _deliver_on(db, tournament, message, in_thread, members=True)
    plan = await discord_routing.plan(db, cfg, event_key, tournament, (EVENTS.get(event_key) or {}).get("target") or "events")
    if not plan["game"]:
        return await _deliver_on(db, tournament, message, in_thread)
    game_guild = str(plan["game"]["guild_id"])
    sent = await _deliver_on(db, tournament, message, in_thread, plan["game"])
    main_kind = plan["main"]
    if main_kind == "crossref" and not sent.get("ok") and sent.get("reason") in discord_routing.FALLBACK_REASONS:
        main_kind = "full"  # der Spielserver nimmt nichts an: voll an den Hauptserver
    main = None
    if main_kind == "full":
        main = await _deliver_on(db, tournament, message, in_thread)
    elif main_kind == "crossref":
        ref = discord_routing.crossref_message(message["title"], url=message.get("url"), server=plan["game"], game_name=plan["game_name"],
                                               sent=sent, color=message.get("color") or 0x29B6E8)
        main = await _deliver_on(db, tournament, {**ref, "event_key": event_key}, None, None, crossref_of=game_guild)
    primary = sent if sent.get("ok") or not (main and main_kind == "full" and main.get("ok")) else main
    return {**primary, "routing": plan["rule"], "game_guild_id": game_guild, "main": main}


async def status_changed(db, tournament: dict, prev: str | None, status: str) -> dict:
    """Ein Statuswechsel eines Turniers: die Meldung (in den Thread), danach das Bracket (#571).
    Ein Fehler im Discord hält den Wechsel nie auf."""
    from services import discord_bracket
    from services.discord_announcements import TOURNAMENT_STATUS, designed_tournament

    if not status or prev == status or not tournament.get("id"):
        return {"ok": False, "reason": "unchanged"}
    outcome: dict = {"ok": False, "reason": "no_message"}
    if status in TOURNAMENT_STATUS:
        try:
            current = {**(await db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0}) or tournament), "status": status}
            game = await db.games.find_one({"id": current.get("game_id")}, {"_id": 0, "name": 1, "logo_url": 1}) if current.get("game_id") else None
            # Im Aussehen der Gestaltung (#866 Teil 2): Ankündigung und kurze Fassung im Thread.
            outcome = await deliver(db, current, await designed_tournament(db, current, status, game),
                                    in_thread=await designed_tournament(db, current, status, game, in_thread=True))
        except Exception:  # noqa: BLE001
            logger.warning("[discord-threads] %s: Meldung „%s“ gescheitert", tournament.get("id"), status, exc_info=True)
            outcome = {"ok": False, "reason": "error"}
    if status in BRACKET_STATUSES:
        discord_bracket.request_refresh(tournament["id"], final=status in FINAL_STATUSES)
    return outcome


async def status_written(db, tournament_id: str, prev: str | None) -> dict:
    """Für Stellen, die den Status direkt schreiben (Station, Gruppen, Swiss): hat er sich geändert, wie oben melden."""
    current = await db.tournaments.find_one({"id": tournament_id}, {"_id": 0}) or {}
    if not current.get("status") or current.get("status") == prev:
        return {"ok": False, "reason": "unchanged"}
    try:
        return await status_changed(db, current, prev, current["status"])
    except Exception:  # noqa: BLE001
        logger.warning("[discord-threads] %s: Statuswechsel nicht gemeldet", tournament_id, exc_info=True)
        return {"ok": False, "reason": "error"}
