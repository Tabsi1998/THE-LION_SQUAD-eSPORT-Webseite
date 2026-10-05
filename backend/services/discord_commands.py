"""Antworten der neuen Slash-Befehle (#573) - Rechnung mit den Daten der Website, ohne Discord-Bibliothek.

``/rangliste`` (Top 10 der laufenden Saison), ``/bracket`` (Auswahl aus laufenden Turnieren), ``/wer-streamt``,
``/mitglied`` (eigener Stand, nur verknüpft) und ``/verknuepfen`` (der Weg zum Verknüpfen). Jede Antwort sieht
nur die fragende Person (Wunsch des Betreibers, 25.09.). Was um die eigene Person geht, braucht ein verknüpftes
Konto und nennt nie Daten anderer; Beitrags- und Zahlungsdaten bleiben auf der Website - Discord ist ein
fremder Dienst.

Eine Antwort ist ``{"content": str | None, "embed": dict | None, "buttons": [...]}``; ``BotRunner`` macht daraus
die Discord-Nachricht (``discord_bot.answer_kwargs``).
"""
from __future__ import annotations

from datetime import date

from models import now_utc

RUNNING_STATUSES = ("live", "paused")
LINK_PATH = "/profile?tab=socials"
NOT_LINKED = "Dein Discord-Konto ist nicht mit der Website verknüpft – mit `/verknuepfen` steht, wie es geht."
MEMBER_AREA_PATH = "/member-area"
APPLY_PATH = "/membership/apply"


def answer(content: str | None = None, *, embed: dict | None = None, buttons: list[dict] | None = None) -> dict:
    return {"content": content, "embed": embed, "buttons": list(buttons or [])}


async def _linked_user_id(db, discord_user_id) -> str | None:
    from services.discord_bot import linked_discord_ids

    return (await linked_discord_ids(db)).get(str(discord_user_id))


# ---------------------------------------------------------------- /rangliste und /wer-streamt

async def answer_rangliste(db) -> dict:
    """Dieselbe Rechnung wie die angepinnte Rangliste (#569)."""
    from services.discord_embeds import build

    embed = (await build(db, "ranking"))["embed"]
    return answer(embed=embed, buttons=[{"label": "Rangliste ansehen", "url": embed.get("url")}])


async def answer_wer_streamt(db) -> dict:
    """Wer aus dem Verein gerade streamt - dieselbe Regel wie die Startseite (nur freigegebene Kanäle)."""
    from services.discord_embeds import build

    return answer(embed=(await build(db, "live"))["embed"])


# ---------------------------------------------------------------- /bracket

async def bracket_choices(db, typed: str = "", limit: int = 25, *, guild_id=None) -> list[dict]:
    """Die laufenden öffentlichen Turniere zur Auswahl - ohne „Ohne Discord“ (#572); Discord zeigt höchstens 25.
    Auf einem Spielserver nur dessen Spiele (#630)."""
    from services.discord_threads import wants_discord

    query: dict = {"status": {"$in": list(RUNNING_STATUSES)}, "is_public": {"$ne": False}}
    scope = await server_scope(db, guild_id)
    if scope["games"] is not None:
        query["game_id"] = {"$in": sorted(scope["games"])}
    rows = await db.tournaments.find(query, {"_id": 0, "id": 1, "title": 1, "visibility": 1, "is_public": 1, "discord_skip": 1, "start_date": 1}
                                     ).sort("start_date", -1).to_list(200)
    needle = (typed or "").strip().casefold()
    out = []
    for row in rows:
        if not wants_discord(row) or (needle and needle not in str(row.get("title") or "").casefold()):
            continue
        out.append({"name": str(row.get("title") or "Turnier")[:100], "value": row["id"]})
        if len(out) >= limit:
            break
    return out


async def answer_bracket(db, wanted: str | None = None, *, guild_id=None) -> dict:
    """Das Bracket wie im Turnier-Thread (#571) - für das gewählte Turnier; läuft nur eins, dieses. Auf einem Spielserver
    (#630) zählen ohne Angabe nur dessen Turniere; ein ausdrücklich gewähltes geht auf jedem Server."""
    from services import discord_bracket

    choices = await bracket_choices(db, guild_id=None if wanted else guild_id)
    if not choices:
        return answer("Gerade läuft kein Turnier – sobald eins live ist, steht sein Bracket hier.")
    pick = None
    if wanted:
        needle = str(wanted).strip().casefold()
        pick = next((c for c in choices if c["value"] == wanted), None) or next((c for c in choices if needle in c["name"].casefold()), None)
    elif len(choices) == 1:
        pick = choices[0]
    if not pick:
        names = ", ".join(f"„{c['name']}“" for c in choices[:10])
        return answer(f"Welches Turnier? Beim Befehl aus der Liste wählen – gerade laufen: {names}.")
    tournament = await db.tournaments.find_one({"id": pick["value"]}, {"_id": 0})
    if not tournament:
        return answer("Dieses Turnier läuft gerade nicht mehr.")
    embed = await discord_bracket.build(db, tournament)
    return answer(embed=embed, buttons=[{"label": "Bracket ansehen", "url": embed.get("url")}])


# ---------------------------------------------------------------- /mitglied

def _since_text(membership: dict) -> str:
    raw = str(membership.get("member_since") or "")[:10]
    try:
        day = date.fromisoformat(raw)
    except ValueError:
        return ""
    precision = membership.get("member_since_precision") or "day"
    if precision == "year":
        return f"seit {day.year}"
    if precision == "month":
        return f"seit {day.month:02d}/{day.year}"
    return f"seit {day.strftime('%d.%m.%Y')}"


def membership_text(membership: dict | None, base_url: str = "", today: str | None = None) -> str:
    """Der eigene Stand in einem Satz: aktiv mit Art und „seit“, Antrag offen, beendet oder keins - ohne Beitrag."""
    from services.member_card import _type_label, card_status

    membership = membership or {}
    status = membership.get("member_status")
    if status == "pending":
        return "Dein Mitgliedsantrag ist eingegangen und wartet auf den Vorstand."
    if status == "blocked":
        return "Zu deiner Mitgliedschaft wende dich bitte an den Vorstand."
    state = card_status(membership, today)
    if state == "valid":
        details = ", ".join(part for part in (_type_label(membership), _since_text(membership)) if part)
        return f"✅ Du bist aktives Vereinsmitglied ({details}). Mitgliederbereich: {base_url}{MEMBER_AREA_PATH}"
    if state == "ended":
        ends = str((membership.get("dolibarr") or {}).get("membership_ends") or "")[:10]
        try:
            ends = date.fromisoformat(ends).strftime("%d.%m.%Y")
        except ValueError:
            pass
        return f"Deine Mitgliedschaft ist am {ends} ausgelaufen. Wieder Mitglied werden: {base_url}{APPLY_PATH}"
    return f"Du bist (noch) kein Vereinsmitglied. Mitglied werden: {base_url}{APPLY_PATH}"


async def answer_mitglied(db, discord_user_id, base_url: str = "") -> dict:
    user_id = await _linked_user_id(db, discord_user_id)
    if not user_id:
        return answer(NOT_LINKED, buttons=[{"label": "Konto verknüpfen", "url": LINK_PATH}])
    membership = await db.memberships.find_one({"user_id": user_id}, {"_id": 0})
    button = {"label": "Mitgliederbereich", "url": MEMBER_AREA_PATH} if (membership or {}).get("member_status") in ("active", "honorary") \
        else {"label": "Mitglied werden", "url": APPLY_PATH}
    return answer(membership_text(membership, base_url), buttons=[button])


# ---------------------------------------------------------------- /verknuepfen

def link_text(linked: bool, base_url: str = "") -> str:
    if linked:
        return (f"✅ Dein Discord-Konto ist schon mit der Website verknüpft – Erfolge, Vereinsrollen und auf Wunsch Benachrichtigungen "
                f"laufen. Verwalten: {base_url}{LINK_PATH}")
    return (f"So verknüpfst du dein Discord-Konto: auf der Website anmelden → Profil → Socials → „Mit Discord verknüpfen“ "
            f"({base_url}{LINK_PATH}). Danach zählen deine Nachrichten für Erfolge, du bekommst deine Vereinsrollen und auf Wunsch "
            f"Benachrichtigungen als Direktnachricht.")


async def answer_verknuepfen(db, discord_user_id, base_url: str = "") -> dict:
    linked = bool(await _linked_user_id(db, discord_user_id))
    return answer(link_text(linked, base_url), buttons=[{"label": "Verknüpfung verwalten" if linked else "Konto verknüpfen", "url": LINK_PATH}])


# ---------------------------------------------------------------- Server-Kontext (#630)

NO_GAMES = ("Diesem Server ist noch kein Spiel zugeordnet – mit `alle: True` siehst du alles. "
            "(Vorstand: Spiele → Spiel bearbeiten → Discord-Server.)")
GAME_FIELDS = {"_id": 0, "id": 1, "name": 1, "display_name": 1, "short_name": 1, "slug": 1, "parent_game_id": 1}


def _game_name(game: dict) -> str:
    return str(game.get("display_name") or game.get("name") or "")


async def find_game(db, wanted: str | None) -> dict | None:
    """Das Spiel aus dem Parameter ``spiel``: die gewählte ID (Autovervollständigung) oder getippt - Name, Kurzname, Slug."""
    needle = str(wanted or "").strip()
    if not needle:
        return None
    game = await db.games.find_one({"id": needle}, GAME_FIELDS)
    if game:
        return game
    folded = needle.casefold()
    rows = await db.games.find({}, GAME_FIELDS).to_list(500)
    exact = next((row for row in rows if folded in {str(row.get(key) or "").casefold() for key in ("name", "display_name", "short_name", "slug")}), None)
    return exact or next((row for row in rows if folded in _game_name(row).casefold()), None)


async def game_choices(db, typed: str = "", limit: int = 25) -> list[dict]:
    """Die Spiele zur Auswahl beim Parameter ``spiel`` - Hauptspiele zuerst; Discord zeigt höchstens 25."""
    rows = await db.games.find({}, GAME_FIELDS).to_list(500)
    needle = (typed or "").strip().casefold()
    out = []
    for row in sorted(rows, key=lambda row: (bool(row.get("parent_game_id")), _game_name(row).casefold())):
        name = _game_name(row)
        if not name or (needle and needle not in name.casefold()):
            continue
        out.append({"name": name[:100], "value": row["id"]})
        if len(out) >= limit:
            break
    return out


async def server_scope(db, guild_id=None, *, game: str | None = None, everything: bool = False) -> dict:
    """Welche Spiele eine Antwort zeigt (#630): am Hauptserver alles, auf einem eingeschalteten Spielserver nur seine Spiele
    (eigene und geerbte, wie im Reiter „Server“). ``spiel`` überschreibt das (samt Editionen), ``alle`` zeigt alles.
    ``games`` None heißt: kein Filter."""
    from services.discord_guilds import COLLECTION, games_by_guild

    if game:
        picked = await find_game(db, game)
        if not picked:
            return {"games": set(), "label": str(game).strip()[:60], "unknown_game": True}
        editions = await db.games.find({"parent_game_id": picked["id"]}, {"_id": 0, "id": 1}).to_list(500)
        return {"games": {picked["id"], *(row["id"] for row in editions)}, "label": _game_name(picked)}
    if everything or not guild_id:
        return {"games": None, "label": ""}
    row = await db[COLLECTION].find_one({"guild_id": str(guild_id)}, {"_id": 0, "role": 1, "enabled": 1, "left_at": 1})
    if not row or row.get("role") == "main" or not row.get("enabled") or row.get("left_at"):
        return {"games": None, "label": ""}
    games = (await games_by_guild(db)).get(str(guild_id)) or []
    names = [game_row["name"] for game_row in games if not game_row.get("inherited") and game_row.get("name")]
    return {"games": {game_row["id"] for game_row in games}, "label": ", ".join(names), "no_games": not games}


def scoped(text: str, scope: dict) -> str:
    """Gefiltert sagt die Antwort, wofür - und wie es alles gibt (Discord-Kleintext ``-#``)."""
    if scope.get("games") is None:
        return text
    return f"{text}\n-# Nur {scope.get('label') or 'die Spiele dieses Servers'} – `alle: True` zeigt alles."


def _scope_problem(scope: dict) -> dict | None:
    if scope.get("unknown_game"):
        return answer(f"Ein Spiel „{scope['label']}“ kenne ich nicht – beim Befehl aus der Liste wählen.")
    if scope.get("no_games"):
        return answer(NO_GAMES)
    return None


async def answer_turniere(db, guild_id=None, spiel: str | None = None, alle: bool = False, base_url: str = "") -> dict:
    """Offene Turnier-Anmeldungen - auf einem Spielserver nur dessen Spiele (#630)."""
    from services.discord_bot import open_tournaments_text

    scope = await server_scope(db, guild_id, game=spiel, everything=alle)
    problem = _scope_problem(scope)
    if problem:
        return problem
    query: dict = {"status": "registration_open", "is_public": {"$ne": False}, "visibility": "public"}
    if scope["games"] is not None:
        query["game_id"] = {"$in": sorted(scope["games"])}
    rows = await db.tournaments.find(query, {"_id": 0, "title": 1, "slug": 1, "start_date": 1, "status": 1}).to_list(20)
    return answer(scoped(open_tournaments_text(rows, base_url), scope))


async def answer_naechstes_event(db, guild_id=None, spiel: str | None = None, alle: bool = False, base_url: str = "") -> dict:
    """Das nächste öffentliche Event - auf einem Spielserver das nächste mit einem Turnier seiner Spiele (Events selbst
    tragen kein Spiel), #630."""
    from services.discord_bot import next_event_text

    scope = await server_scope(db, guild_id, game=spiel, everything=alle)
    problem = _scope_problem(scope)
    if problem:
        return problem
    query: dict = {"status": {"$nin": ["draft", "cancelled"]}, "visibility": "public", "start_date": {"$gte": now_utc().isoformat()}}
    if scope["games"] is not None:
        hosts = await db.tournaments.find({"game_id": {"$in": sorted(scope["games"])}, "event_id": {"$nin": [None, ""]}},
                                          {"_id": 0, "event_id": 1}).to_list(2000)
        query["id"] = {"$in": sorted({row["event_id"] for row in hosts})}
    events = await db.events.find(query, {"_id": 0, "name": 1, "title": 1, "slug": 1, "start_date": 1, "location": 1, "city": 1}
                                  ).sort("start_date", 1).to_list(5)
    return answer(scoped(next_event_text(events, base_url), scope))


async def server_status_lines(db, guild_id=None) -> list[str]:
    """Für ``/status`` (#630): welcher Server das ist, seine Spiele, Kanalziele und die letzte Aktualisierung der Einbettungen."""
    from discord_service import _get_discord_config
    from services.discord_guilds import COLLECTION, games_by_guild

    row = await db[COLLECTION].find_one({"guild_id": str(guild_id or "")}, {"_id": 0}) if guild_id else None
    if not row:
        return ["Dieser Server: nicht im Server-Verzeichnis (Verbindungen → Discord → Server)."]
    main = row.get("role") == "main"
    state = "Hauptserver" if main else ("Unterserver · an" if row.get("enabled") and not row.get("left_at") else "Unterserver · aus")
    lines = [f"Dieser Server: {row.get('name') or row['guild_id']} ({state})"]
    games = (await games_by_guild(db)).get(str(row["guild_id"])) or []
    names = [game["name"] for game in games if game.get("name")]
    lines.append("Spiele: " + (", ".join(names) if names else ("alle ohne eigenen Server" if main else "noch keines zugeordnet")))
    cfg = await _get_discord_config()
    channels = (cfg.get("channels") or {}) if main else (row.get("channels") or {})
    named = [f"{TARGET_NAMES.get(target, target)} <#{channel}>" for target, channel in channels.items() if channel and target in TARGET_NAMES]
    lines.append("Kanäle: " + (", ".join(named) if named else "keine gewählt"))
    settings = await db.settings.find_one({"id": "discord"}, {"_id": 0, "embeds": 1}) or {}
    embeds = (settings.get("embeds") or {}) if main else (row.get("embeds") or {})
    stamps = sorted(str((state_row or {}).get("updated_at") or "") for state_row in embeds.values() if isinstance(state_row, dict))
    stamps = [stamp for stamp in stamps if stamp]
    lines.append(f"Einbettungen zuletzt aktualisiert: {_vienna(stamps[-1]) if stamps else '–'}")
    return lines


TARGET_NAMES = {"community": "Community", "news": "News", "events": "Events und Turniere", "members": "Mitglieder", "board": "Vorstand",
                "ops": "Betrieb", "test": "Test"}


def _vienna(stamp: str) -> str:
    from services.discord_announcements import vienna

    return vienna(stamp) or stamp
