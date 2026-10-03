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
"""
from __future__ import annotations

import logging

from models import new_id, now_utc

logger = logging.getLogger("tls.discord.threads")

FIELD = "discord_thread"
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


def thread_of(tournament: dict, channel_id: str) -> str:
    """Der Thread des Turniers - nur, wenn er im heute gewählten Kanal liegt."""
    state = tournament.get(FIELD) or {}
    if state.get("thread_id") and channel_id and str(state.get("channel_id") or "") == str(channel_id):
        return str(state["thread_id"])
    return ""


async def events_channel() -> str:
    from discord_service import _get_discord_config, resolve_target

    return resolve_target(await _get_discord_config(), "events")["channel_id"]


async def note_message(db, tournament_id: str, message_id: str | None) -> None:
    """Eine neue Nachricht des Bots im Thread. Stand bis eben der Endstand zuletzt, muss er wieder nach unten."""
    from services import discord_bracket

    if not message_id:
        return
    tournament = await db.tournaments.find_one({"id": tournament_id}, {"_id": 0, FIELD: 1, discord_bracket.FIELD: 1}) or {}
    updates = {f"{FIELD}.last_message_id": str(message_id), f"{FIELD}.last_message_at": now_utc().isoformat()}
    bracket = tournament.get(discord_bracket.FIELD) or {}
    thread_id = str((tournament.get(FIELD) or {}).get("thread_id") or "")
    if bracket.get("final") and thread_id and str(bracket.get("channel_id") or "") == thread_id and str(bracket.get("message_id") or "") != str(message_id):
        updates[f"{discord_bracket.FIELD}.final"] = False
        discord_bracket.request_refresh(tournament_id, final=True)
    await db.tournaments.update_one({"id": tournament_id}, {"$set": updates})


async def _open_thread(db, tournament: dict, sent: dict) -> dict:
    """Unter der Ankündigung im Kanal den Thread öffnen und am Turnier festhalten."""
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
            await db.email_logs.insert_one({"id": new_id(), "channel": "discord", "target": sent.get("target") or "events", "event_key": "tournament.thread",
                                            "title": thread_name(tournament), "status": "failed", "reason": reason, "error": state["error"],
                                            "channel_id": channel_id, "created_at": now_utc().isoformat()})
    await db.tournaments.update_one({"id": tournament["id"]}, {"$set": {FIELD: state}})
    return state


async def _send(message: dict, tournament: dict, thread_id: str | None = None) -> dict:
    from discord_service import send_event

    return await send_event(message["event_key"], message["title"], message.get("description") or "", item=tournament, color=message.get("color") or 0x29B6E8,
                            url=message.get("url"), fields=message.get("fields"), image_url=message.get("image_url"), thread_id=thread_id,
                            buttons=message.get("buttons"))


async def deliver(db, tournament: dict, message: dict, *, in_thread: dict | None = None) -> dict:
    """Eine Turnier-Meldung in den Thread des Turniers. Gibt es noch keinen, geht sie in den Kanal und öffnet ihn.
    ``in_thread`` ist die kurze Fassung für den Thread - ohne sie geht dieselbe Meldung hinein."""
    if tournament.get("discord_skip"):
        return {"ok": False, "reason": "author_opt_out"}
    if not wants_discord(tournament):
        return {"ok": False, "reason": "private_visibility"}
    thread_id = thread_of(tournament, await events_channel())
    reopen = not thread_id
    if thread_id:
        result = await _send(in_thread or message, tournament, thread_id)
        if result.get("ok"):
            await note_message(db, tournament["id"], result.get("message_id"))
            return {**result, "thread_id": thread_id}
        if result.get("reason") not in FALLBACK_REASONS:
            return result
        # Thread gelöscht: neu im Kanal. Darf der Bot im Thread nicht schreiben: einzeln in den Kanal, ohne neuen Thread.
        reopen = result.get("reason") == "unknown_channel"
    result = await _send(message, tournament)
    if result.get("ok") and reopen:
        state = await _open_thread(db, tournament, result)
        result = {**result, "thread_id": state.get("thread_id")}
    return result


async def status_changed(db, tournament: dict, prev: str | None, status: str) -> dict:
    """Ein Statuswechsel eines Turniers: die Meldung (in den Thread), danach das Bracket (#571).
    Ein Fehler im Discord hält den Wechsel nie auf."""
    from services import discord_bracket
    from services.discord_announcements import TOURNAMENT_STATUS, tournament_message

    if not status or prev == status or not tournament.get("id"):
        return {"ok": False, "reason": "unchanged"}
    outcome: dict = {"ok": False, "reason": "no_message"}
    if status in TOURNAMENT_STATUS:
        try:
            current = {**(await db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0}) or tournament), "status": status}
            game = await db.games.find_one({"id": current.get("game_id")}, {"_id": 0, "name": 1}) if current.get("game_id") else None
            game_name = (game or {}).get("name")
            outcome = await deliver(db, current, tournament_message(current, status, game_name=game_name),
                                    in_thread=tournament_message(current, status, game_name=game_name, in_thread=True))
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
