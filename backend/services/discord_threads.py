"""Ein Thread je Turnier (#572): Ankündigung, Check-in, Bracket und Endstand an einem Ort.

Bisher stand jede Meldung eines Turniers einzeln im Kanal „Events und Turniere“.
Bei mehreren Turnieren nebeneinander findet dort niemand mehr, was zusammengehört.
Jetzt steht im Kanal nur noch die Ankündigung „Anmeldung offen“, und alles Weitere
hängt als Thread darunter.

Der Bot archiviert nichts von Hand: Discord schließt einen Thread selbst, wenn
nichts mehr kommt. Die letzte Nachricht im Thread ist der Endstand.
"""
import logging

from models import now_utc

logger = logging.getLogger(__name__)

# Wo der Thread am Turnier steht. Wie beim Bracket (#571) ein eigenes Feld, damit
# ein Turnier ohne Discord gar nichts davon mitbekommt.
FIELD = "discord_thread"

# Discord erlaubt 100 Zeichen im Namen eines Threads.
MAX_NAME = 100

# Eine Woche ohne Nachricht, dann archiviert Discord den Thread. Das ist der
# längste Wert, den Discord erlaubt, und passt zu einem Turnierwochenende.
ARCHIVE_MINUTES = 10080


def thread_name(tournament: dict, *, game_name: str | None = None) -> str:
    """Wie der Thread heißt: Turniertitel, davor das Spiel, wenn es bekannt ist."""
    title = (tournament.get("title") or tournament.get("name") or "Turnier").strip()
    name = f"{game_name.strip()}: {title}" if (game_name or "").strip() else title
    if len(name) <= MAX_NAME:
        return name
    # Lieber den Titel abschneiden als den Namen des Spiels, der vorne steht.
    return name[: MAX_NAME - 1].rstrip() + "…"


def stored(tournament: dict | None) -> dict:
    """Was am Turnier über seinen Thread steht, auch wenn dort noch nichts steht."""
    state = (tournament or {}).get(FIELD) or {}
    return state if isinstance(state, dict) else {}


async def thread_id(db, tournament_id: str) -> str:
    """Die Thread-ID eines Turniers, oder leer. Leer heißt: Meldungen gehen in den Kanal."""
    if not tournament_id:
        return ""
    tournament = await db.tournaments.find_one({"id": tournament_id}, {"_id": 0, FIELD: 1})
    return str(stored(tournament).get("thread_id") or "")


async def ensure(db, tournament: dict, *, channel_id: str, message_id: str,
                 game_name: str | None = None) -> dict:
    """Den Thread unter der Ankündigung öffnen, einmal je Turnier.

    Gibt es ihn schon, passiert nichts: Ein zweiter Thread wäre genau das, was das
    Issue vermeiden will. Scheitert das Öffnen, bleibt es bei Meldungen im Kanal -
    eine fehlende Ordnung ist kein Grund, eine Meldung ausfallen zu lassen.
    """
    from services.discord_bot import bot

    tournament_id = str(tournament.get("id") or "")
    if not tournament_id or not channel_id or not message_id:
        return {"ok": False, "reason": "incomplete"}

    existing = await thread_id(db, tournament_id)
    if existing:
        return {"ok": True, "reason": "exists", "thread_id": existing}

    name = thread_name(tournament, game_name=game_name)
    try:
        result = await bot.create_thread(channel_id, message_id, name)
    except Exception as exc:  # noqa: BLE001 - ein Discord-Fehler darf den Statuswechsel nicht kippen
        logger.error("[discord] Thread für Turnier %s: %s", tournament_id, type(exc).__name__)
        return {"ok": False, "reason": "error", "error": type(exc).__name__}
    if not result.get("ok"):
        return result

    state = {"thread_id": str(result.get("thread_id") or ""), "channel_id": str(channel_id),
             "message_id": str(message_id), "name": name, "created_at": now_utc()}
    await db.tournaments.update_one({"id": tournament_id}, {"$set": {FIELD: state}})
    return {"ok": True, "reason": "created", "thread_id": state["thread_id"]}


async def forget(db, tournament_id: str) -> None:
    """Den gespeicherten Thread vergessen, wenn Discord ihn nicht mehr kennt."""
    await db.tournaments.update_one({"id": tournament_id}, {"$unset": {FIELD: ""}})
