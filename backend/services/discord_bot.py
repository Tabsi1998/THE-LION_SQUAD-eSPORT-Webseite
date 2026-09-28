"""Discord-Bot (#302): Aktivität zählen, Mitgliederrollen abgleichen, Befehle beantworten.

Der Bot läuft **im Backend** als Hintergrundaufgabe (Entscheidung des Betreibers vom 22.09.):
Token und Schalter liegen verschlüsselt in ``settings.discord`` (``bot_token``, ``bot_enabled``,
``bot_guild_id``, ``bot_roles``, ``bot_count_messages``) und werden im Admin gepflegt - kein
eigener Container, nichts in der ``.env``. Eine Änderung der Einstellungen startet den Bot neu.

Drei Aufgaben, jede nur für **verknüpfte Konten** (#260, ``platform_links`` mit ``discord``):
- **Zählen:** je Nachricht eines verknüpften Nutzers ``discord_messages_count`` +1 und ein
  Tageszähler - nie der Inhalt. Nicht verknüpfte Konten werden ignoriert, Bots auch.
- **Rollen:** aktives Mitglied ↔ Rolle „Mitglied“, Vorstand (Bereich ``club``) ↔ „Vorstand“,
  Turnierleitung (Bereich ``tournaments``) ↔ „Turnierleitung“. Alle zehn Minuten und auf Knopfdruck;
  der Bot fasst nur die drei eingestellten Rollen an, nie andere.
- **Befehle:** ``/naechstes-event``, ``/turniere`` (offene Anmeldungen), ``/meine-erfolge`` (nur
  verknüpft, private Antwort), ``/status`` (nur Vorstand/System, private Antwort).

Bricht die Verbindung ab (fehlender Intent im Developer Portal, falscher Token, Netz), steht der
Grund als Klickweg in ``last_error`` (``friendly_bot_error``) und der Scheduler-Job
``discord_bot_watch`` startet den Bot alle fünf Minuten neu (``restart_if_down``), bis es klappt.

Die reine Logik (welche Rollen, was zählt, welcher Text) steht ohne Discord-Bibliothek hier
oben, damit sie sich ohne Netz testen lässt; ``BotRunner`` ist die dünne Schicht um discord.py.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from database import get_db
from models import now_utc
from services.dolibarr_policy import CLUB_TZ
from services.secret_store import decrypt_secret

logger = logging.getLogger("tls.discord.bot")

ROLE_KEYS = ("member", "board", "tournament")
DEFAULT_ROLES = {"member": "Mitglied", "board": "Vorstand", "tournament": "Turnierleitung"}
SYNC_LIMIT = 500


# ---------------------------------------------------------------- reine Logik

def bot_settings(settings: dict | None) -> dict:
    """Die Bot-Einstellungen mit Vorgaben - ohne den Token."""
    settings = settings or {}
    roles = {key: str((settings.get("bot_roles") or {}).get(key) or DEFAULT_ROLES[key]).strip() or DEFAULT_ROLES[key] for key in ROLE_KEYS}
    return {
        "enabled": bool(settings.get("bot_enabled")),
        "configured": bool(settings.get("bot_token")),
        "guild_id": str(settings.get("bot_guild_id") or "").strip(),
        "roles": roles,
        "count_messages": settings.get("bot_count_messages", True) is not False,
    }


def desired_roles(areas: set[str], is_member: bool) -> set[str]:
    """Welche der drei Rollen eine Person bekommt: Mitglied, Vorstand, Turnierleitung."""
    wanted = set()
    if is_member:
        wanted.add("member")
    if "club" in areas:
        wanted.add("board")
    if "tournaments" in areas:
        wanted.add("tournament")
    return wanted


def role_diff(current: set[str], wanted: set[str]) -> tuple[set[str], set[str]]:
    """Was der Bot hinzufügt und entfernt - nur innerhalb der drei verwalteten Rollen."""
    managed = set(ROLE_KEYS)
    return (wanted - current) & managed, (current - wanted) & managed


def counted_user(author_id: str, author_is_bot: bool, links: dict[str, str]) -> str | None:
    """Der Nutzer, dem eine Nachricht zählt - oder None (Bot, nicht verknüpft)."""
    if author_is_bot:
        return None
    return links.get(str(author_id))


def club_day(moment: datetime | None = None) -> str:
    moment = moment or datetime.now(timezone.utc)
    return moment.astimezone(CLUB_TZ).strftime("%Y-%m-%d")


def _when(value) -> str:
    if not value:
        return "Termin offen"
    try:
        moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return str(value)
    if moment.tzinfo is not None:
        moment = moment.astimezone(CLUB_TZ)
    return moment.strftime("%d.%m.%Y %H:%M")


def next_event_text(events: list[dict], base_url: str = "") -> str:
    upcoming = sorted((e for e in events if e.get("start_date")), key=lambda e: str(e.get("start_date")))
    if not upcoming:
        return "Gerade ist kein Event geplant – sobald eines angekündigt ist, steht es hier."
    event = upcoming[0]
    name = event.get("name") or event.get("title") or "Event"
    where = ", ".join(part for part in (event.get("location"), event.get("city")) if part)
    line = f"**{name}** – {_when(event.get('start_date'))}"
    if where:
        line += f" · {where}"
    if base_url and event.get("slug"):
        line += f"\n{base_url}/events/{event['slug']}"
    return line


def open_tournaments_text(tournaments: list[dict], base_url: str = "") -> str:
    rows = [t for t in tournaments if t.get("status") == "registration_open"]
    if not rows:
        return "Aktuell ist keine Turnier-Anmeldung offen."
    lines = []
    for t in sorted(rows, key=lambda t: str(t.get("start_date") or ""))[:8]:
        line = f"• **{t.get('title') or 'Turnier'}** – {_when(t.get('start_date'))}"
        if base_url and t.get("slug"):
            line += f" – {base_url}/tournaments/{t['slug']}"
        lines.append(line)
    return "Offene Anmeldungen:\n" + "\n".join(lines)


def achievements_text(awards: list[dict], total_points: int) -> str:
    if not awards:
        return "Noch kein Erfolg freigeschaltet – die ersten kommen mit dem ersten Turnier oder Event."
    names = [str(a.get("name") or a.get("tier_code") or "Erfolg") for a in awards[:10]]
    more = f" … und {len(awards) - 10} weitere" if len(awards) > 10 else ""
    return f"Deine Erfolge ({len(awards)}, {total_points} Punkte): " + ", ".join(names) + more


def ranking_text(season: dict | None, rows: list[dict], base_url: str = "") -> str:
    """Die Top 10 der laufenden Saison (#573). Dieselben Zahlen wie die Einbettung (#569)."""
    if not rows:
        return "Für die laufende Saison gibt es noch keine Wertung."
    lines = []
    for place, row in enumerate(rows[:10], start=1):
        name = row.get("display_name") or row.get("username") or "Mitglied"
        points = row.get("points") or row.get("total_points") or 0
        marker = {1: "🥇", 2: "🥈", 3: "🥉"}.get(place, f"{place}.")
        lines.append(f"{marker} {name} – {points} Punkte")
    head = f"Rangliste {season.get('name')}" if (season or {}).get("name") else "Rangliste"
    text = f"**{head}**\n" + "\n".join(lines)
    if base_url:
        text += f"\n{base_url}/ranking"
    return text


def running_tournaments_text(tournaments: list[dict], base_url: str = "") -> str:
    """Welche Turniere gerade laufen - die Antwort, wenn /bracket kein passendes findet."""
    rows = [t for t in tournaments if t.get("status") == "live"]
    if not rows:
        return "Gerade läuft kein Turnier."
    lines = [f"• **{t.get('title') or 'Turnier'}**" for t in rows[:8]]
    text = "Diese Turniere laufen gerade:\n" + "\n".join(lines)
    if base_url:
        text += f"\n{base_url}/tournaments"
    return text


def bracket_text(tournament: dict | None, base_url: str = "", *, played: int = 0, total: int = 0) -> str:
    """Der Link zum Bracket eines Turniers, mit dem Stand in einer Zeile."""
    if not tournament:
        return "Dieses Turnier kenne ich nicht – wähle eines aus der Liste."
    title = tournament.get("title") or "Turnier"
    line = f"**{title}**"
    if total:
        line += f" – {played} von {total} Partien gespielt"
    if base_url and tournament.get("slug"):
        line += f"\n{base_url}/tournaments/{tournament['slug']}/bracket"
    return line


def streams_text(streams: list[dict], base_url: str = "") -> str:
    """Wer gerade streamt (#573). Nur, wer auf der Startseite sichtbar wäre."""
    if not streams:
        return "Gerade streamt niemand aus dem Verein."
    lines = []
    for stream in streams[:8]:
        name = stream.get("display_name") or stream.get("username") or stream.get("twitch_login") or "Mitglied"
        title = (stream.get("title") or "").strip()
        line = f"• **{name}**"
        if stream.get("game_name"):
            line += f" · {stream['game_name']}"
        if title:
            line += f" – {title[:60]}"
        if stream.get("twitch_login"):
            line += f"\nhttps://twitch.tv/{stream['twitch_login']}"
        lines.append(line)
    text = "Gerade live:\n" + "\n".join(lines)
    if base_url:
        text += f"\n{base_url}/live"
    return text


def membership_text(view: dict | None, base_url: str = "") -> str:
    """Der eigene Mitgliedsstand - nur für einen selbst, nie Daten anderer (#573)."""
    if not view:
        return ("Zu deinem Konto gibt es keine Mitgliedschaft. Ein Mitgliedsantrag geht über die Website: "
                + (f"{base_url}/mitglied-werden" if base_url else "Mitglied werden"))
    membership = view.get("membership") or {}
    status = membership.get("status") or ("aktiv" if view.get("is_active_member") else "offen")
    labels = {"active": "aktiv", "pending": "in Prüfung", "paused": "ruhend", "ended": "beendet",
              "rejected": "abgelehnt", "cancelled": "gekündigt"}
    line = f"Dein Mitgliedsstand: **{labels.get(status, status)}**"
    if membership.get("member_number"):
        line += f" · Nummer {membership['member_number']}"
    if membership.get("joined_at"):
        line += f" · dabei seit {_when(membership['joined_at'])[:10]}"
    if base_url:
        line += f"\n{base_url}/konto"
    return line


def link_account_text(base_url: str = "", *, linked: bool = False) -> str:
    """Der Weg zum Verknüpfen - der Knopf sitzt im Profil, nicht im Discord."""
    where = f"{base_url}/profil" if base_url else "dein Profil auf der Website"
    if linked:
        return f"Dein Discord-Konto ist schon mit der Website verknüpft. Ändern kannst du das unter {where} → Socials."
    return ("So verknüpfst du dein Konto: Profil auf der Website öffnen, unter **Socials** auf "
            f"**Mit Discord verknüpfen** klicken.\n{where}")

def friendly_bot_error(exc: BaseException) -> str:
    """Discord-Fehler in Worte, die sagen, was zu tun ist - ohne die Bibliothek zu importieren."""
    name = type(exc).__name__
    text = str(exc).strip()
    lowered = text.lower()
    if name == "PrivilegedIntentsRequired" or "privileged intents" in lowered:
        return ("Discord lässt den Bot nicht verbinden: Im Developer Portal fehlt der Schalter „Server Members Intent“ "
                "(discord.com/developers → deine App → Bot → „Privileged Gateway Intents“ → einschalten → „Save Changes“). "
                "Der Bot versucht es alle fünf Minuten von selbst wieder.")
    if name == "LoginFailure" or "improper token" in lowered:
        return ("Discord kennt den Bot-Token nicht (falsch, unvollständig oder zurückgesetzt): "
                "Developer Portal → Bot → „Reset Token“, den neuen Token hier eintragen und speichern.")
    return (text or name)[:300]


def no_guild_text(view: dict, client) -> str:
    """Warum der Bot keinen Server findet - mit dem Klickweg, der es behebt (#515)."""
    guilds = [g for g in (getattr(client, "guilds", None) or []) if getattr(g, "name", None)]
    if view.get("guild_id") and guilds:
        names = ", ".join(f"{g.name} ({g.id})" for g in guilds[:5])
        return (f"Die eingetragene Server-ID {view['guild_id']} passt zu keinem Server, auf dem der Bot ist (er ist auf: {names}). "
                "Discord → Einstellungen → Erweitert → Entwicklermodus einschalten, Rechtsklick auf den Vereinsserver → „Server-ID kopieren“ "
                "und hier eintragen – oder das Feld leer lassen, dann nimmt der Bot den Server, auf dem er ist.")
    return ("Der Bot ist auf keinem Server. Developer Portal → deine App → OAuth2 → URL Generator: Scopes „bot“ und "
            "„applications.commands“, Rechte „View Channels“, „Send Messages“, „Read Message History“, „Manage Roles“ – die erzeugte "
            "Adresse im Browser öffnen und den Bot auf den Vereinsserver einladen.")


SYNC_TEXTS = {
    "offline": "Der Bot ist nicht verbunden – erst „Bot verbinden“ einschalten; der Stand steht unter dem Kasten.",
}
CHANNEL_TEXTS = {
    "offline": ("Der Bot ist nicht verbunden – die Kanal-Liste kommt, sobald er online ist. Bis dahin lässt sich die Kanal-ID "
                "eintragen (Discord → Einstellungen → Erweitert → Entwicklermodus, Rechtsklick auf den Kanal → „Kanal-ID kopieren“)."),
}


def channel_row(channel, permissions) -> dict:
    """Ein Textkanal für die Kanalwahl im Admin - mit dem, was der Bot dort darf (#566)."""
    category = getattr(channel, "category", None)
    return {
        "id": str(getattr(channel, "id", "")),
        "name": str(getattr(channel, "name", "") or ""),
        "category": str(getattr(category, "name", "") or "") if category is not None else "",
        "position": int(getattr(channel, "position", 0) or 0),
        "can_send": bool(getattr(permissions, "view_channel", False) and getattr(permissions, "send_messages", False)),
        "can_embed": bool(getattr(permissions, "embed_links", False)),
    }


def sorted_channels(rows: list[dict]) -> list[dict]:
    """Erst Kanäle, in denen der Bot schreiben darf, dann der Rest - je Kategorie in der Reihenfolge des Servers."""
    return sorted(rows, key=lambda row: (not row.get("can_send"), row.get("category") or "", row.get("position", 0), row.get("name") or ""))


def status_text(state: dict) -> str:
    parts = [
        f"Bot: {'online' if state.get('connected') else 'offline'}",
        f"Server: {state.get('guild_name') or '–'}",
        f"Verknüpfte Konten: {state.get('linked_count', 0)}",
        f"Letzter Rollenabgleich: {state.get('last_sync_at') or '–'} ({state.get('last_sync_changes', 0)} Änderungen)",
        f"Letzte Aktion: {state.get('last_action') or '–'}",
    ]
    if state.get("last_error"):
        parts.append(f"Letzter Fehler: {state['last_error']}")
    return "\n".join(parts)


# ---------------------------------------------------------------- Daten

def link_buttons(buttons: list[dict] | None) -> list[dict]:
    """Die Knöpfe, die Discord annimmt: Beschriftung und http(s)-Link, höchstens fünf.

    Link-Knöpfe brauchen keine Rückmeldung an den Bot - sie funktionieren auch, wenn er
    gerade offline ist. Alles andere wäre ein Knopf, der ins Leere klickt.
    """
    rows = []
    for button in buttons or []:
        label = str((button or {}).get("label") or "").strip()
        url = str((button or {}).get("url") or "").strip()
        if not label or not url.startswith(("http://", "https://")):
            continue
        rows.append({"label": label[:80], "url": url})
        if len(rows) == 5:
            break
    return rows


def _view(buttons: list[dict] | None):
    """Die Knöpfe als discord.ui.View, oder nichts - dann sendet Discord ohne Komponenten."""
    rows = link_buttons(buttons)
    if not rows:
        return {}
    import discord

    view = discord.ui.View()
    for row in rows:
        view.add_item(discord.ui.Button(style=discord.ButtonStyle.link, label=row["label"], url=row["url"]))
    return {"view": view}


async def linked_discord_ids(db) -> dict[str, str]:
    """Discord-Kennung → Nutzer, nur verknüpfte Konten (#260)."""
    rows = await db.platform_links.find({"platform": "discord"}, {"_id": 0, "user_id": 1, "external_id": 1}).to_list(5000)
    return {str(row["external_id"]): row["user_id"] for row in rows if row.get("external_id") and row.get("user_id")}


async def count_message(db, user_id: str) -> None:
    """Eine Nachricht zählt - Zahl, kein Inhalt (#302)."""
    now = now_utc().isoformat()
    await db.users.update_one({"id": user_id}, {"$inc": {"discord_messages_count": 1}, "$set": {"discord_last_message_at": now}})
    await db.discord_activity.update_one({"user_id": user_id, "day": club_day()}, {"$inc": {"count": 1}, "$setOnInsert": {"created_at": now}}, upsert=True)
    # Erfolge „Discord-Aktiv“ sollen nicht auf den nächtlichen Durchlauf warten (#301: Schlange, je Person einmal).
    from services.achievement_queue import request_evaluation
    await request_evaluation([user_id], "discord_message")


async def wanted_roles_by_user(db, user_ids: list[str]) -> dict[str, set[str]]:
    from services.membership_service import is_active_member
    from services.permissions import areas_for
    users = {u["id"]: u for u in await db.users.find({"id": {"$in": user_ids}, "is_active": {"$ne": False}}, {"_id": 0}).to_list(SYNC_LIMIT)}
    memberships = {m["user_id"]: m async for m in db.memberships.find({"user_id": {"$in": user_ids}}, {"_id": 0})}
    out = {}
    for user_id in user_ids:
        user = users.get(user_id)
        if not user:
            out[user_id] = set()
            continue
        out[user_id] = desired_roles(await areas_for(user, db), is_active_member(memberships.get(user_id)))
    return out


async def record_state(db, **fields) -> None:
    await db.settings.update_one({"id": "discord_bot_state"}, {"$set": {**fields, "updated_at": now_utc().isoformat()}, "$setOnInsert": {"id": "discord_bot_state"}}, upsert=True)


async def read_state(db) -> dict:
    row = await db.settings.find_one({"id": "discord_bot_state"}, {"_id": 0}) or {}
    row.pop("id", None)
    return row


# ---------------------------------------------------------------- Laufzeit (discord.py)

class BotRunner:
    """Eine Verbindung je Prozess. ``apply_settings`` startet neu, wenn sich etwas geändert hat."""

    def __init__(self):
        self._client = None
        self._task: asyncio.Task | None = None
        self._token_fingerprint = ""
        self.connected = False
        self.guild_name = ""
        self.last_error = ""
        self.last_action = ""
        self._view: dict = {}

    async def start_if_enabled(self) -> bool:
        db = get_db()
        settings = await db.settings.find_one({"id": "discord"}, {"_id": 0}) or {}
        view = bot_settings(settings)
        if not (view["enabled"] and view["configured"]):
            await self.stop()
            return False
        token = decrypt_secret(settings["bot_token"])
        fingerprint = f"{len(token)}:{token[-6:]}:{view['guild_id']}:{view['count_messages']}"
        if self._task and not self._task.done() and fingerprint == self._token_fingerprint:
            return True
        await self.stop()
        self._token_fingerprint = fingerprint
        self._task = asyncio.create_task(self._run(token, view), name="discord-bot")
        return True

    async def stop(self) -> None:
        client, task = self._client, self._task
        self._client, self._task = None, None
        self.connected = False
        if client is not None:
            try:
                await client.close()
            except Exception:
                pass
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass

    async def apply_settings(self) -> bool:
        """Nach einer Änderung im Admin: neu starten oder anhalten."""
        self._token_fingerprint = ""
        return await self.start_if_enabled()

    async def restart_if_down(self) -> bool:
        """Läuft der Bot nicht mehr, obwohl er eingeschaltet ist: neu versuchen (Scheduler, alle fünf
        Minuten) - so kommt er von selbst, sobald der Intent im Portal an oder der Token richtig ist."""
        if self._task and not self._task.done():
            return False
        self._token_fingerprint = ""
        return await self.start_if_enabled()

    def status(self) -> dict:
        return {"connected": self.connected, "guild_name": self.guild_name, "last_error": self.last_error, "last_action": self.last_action,
                "running": bool(self._task and not self._task.done())}

    async def _run(self, token: str, view: dict) -> None:
        import discord
        from discord import app_commands

        intents = discord.Intents.default()
        intents.members = True          # Rollenabgleich: braucht „Server Members Intent“ im Developer Portal
        intents.message_content = False  # Inhalte werden nie gelesen - gezählt wird nur, dass eine Nachricht kam
        client = discord.Client(intents=intents)
        tree = app_commands.CommandTree(client)
        self._client = client
        self._view = view
        runner = self
        db = get_db()

        @client.event
        async def on_ready():
            runner.connected = True
            guild = client.get_guild(int(view["guild_id"])) if view["guild_id"].isdigit() else (client.guilds[0] if client.guilds else None)
            runner.guild_name = guild.name if guild else ""
            # Kein Server heißt: Rollen und Befehle gehen ins Leere - das steht dann in Worten im Kasten, nicht als Code (#515).
            runner.last_error = "" if guild else no_guild_text(view, client)
            if guild:
                try:
                    await runner._cache_channels(guild)
                except Exception as exc:  # noqa: BLE001 - die Kanalliste ist Komfort, kein Muss
                    logger.warning("[discord-bot] Kanalliste: %s", exc)
            try:
                if guild:
                    tree.copy_global_to(guild=guild)
                    await tree.sync(guild=guild)
                else:
                    await tree.sync()
                runner.last_action = f"verbunden, Befehle registriert ({now_utc().strftime('%H:%M')} UTC)"
            except Exception as exc:
                runner.last_error = f"Befehle: {exc}"
            await record_state(db, connected=True, guild_name=runner.guild_name, last_error=runner.last_error, last_action=runner.last_action, started_at=now_utc().isoformat())

        @client.event
        async def on_message(message):
            if not view["count_messages"] or message.guild is None:
                return
            links = await linked_discord_ids(db)
            user_id = counted_user(str(message.author.id), bool(message.author.bot), links)
            if user_id:
                await count_message(db, user_id)
                runner.last_action = f"Nachricht gezählt ({now_utc().strftime('%H:%M')} UTC)"

        base_url = ""
        try:
            from services.platform_links import frontend_url
            base_url = frontend_url()
        except Exception:
            base_url = ""

        # Antworten auf Slash-Befehle sieht nur die fragende Person (Wunsch des Betreibers, 25.09.): sie
        # gelten nur ihr, und die Kanäle bleiben frei - was für alle gilt, steht in den gepinnten Einbettungen (#569).
        @tree.command(name="naechstes-event", description="Wann ist das nächste Event?")
        async def naechstes_event(interaction):
            events = await db.events.find({"status": {"$nin": ["draft", "cancelled"]}, "visibility": "public", "start_date": {"$gte": now_utc().isoformat()}},
                                          {"_id": 0, "name": 1, "title": 1, "slug": 1, "start_date": 1, "location": 1, "city": 1}).sort("start_date", 1).to_list(5)
            await interaction.response.send_message(next_event_text(events, base_url), ephemeral=True)

        @tree.command(name="turniere", description="Welche Turnier-Anmeldungen sind offen?")
        async def turniere(interaction):
            rows = await db.tournaments.find({"status": "registration_open", "is_public": {"$ne": False}, "visibility": "public"},
                                             {"_id": 0, "title": 1, "slug": 1, "start_date": 1, "status": 1}).to_list(20)
            await interaction.response.send_message(open_tournaments_text(rows, base_url), ephemeral=True)

        @tree.command(name="meine-erfolge", description="Deine Erfolge auf der Website (nur mit verknüpftem Konto)")
        async def meine_erfolge(interaction):
            links = await linked_discord_ids(db)
            user_id = links.get(str(interaction.user.id))
            if not user_id:
                await interaction.response.send_message("Dein Discord-Konto ist nicht mit der Website verknüpft – Profil → Socials → „Mit Discord verknüpfen“.", ephemeral=True)
                return
            awards = await db.user_achievements.find({"user_id": user_id}, {"_id": 0, "tier_code": 1, "earned_at": 1}).sort("earned_at", -1).to_list(200)
            tiers = {t["code"]: t async for t in db.achievements.find({"code": {"$in": [a["tier_code"] for a in awards]}}, {"_id": 0, "code": 1, "name": 1, "points": 1})}
            named = [{"name": tiers.get(a["tier_code"], {}).get("name") or a["tier_code"]} for a in awards]
            points = sum(int(tiers.get(a["tier_code"], {}).get("points") or 0) for a in awards)
            await interaction.response.send_message(achievements_text(named, points), ephemeral=True)

        @tree.command(name="status", description="Bot-Stand (nur Vorstand)")
        async def status(interaction):
            from services.permissions import areas_for
            links = await linked_discord_ids(db)
            user_id = links.get(str(interaction.user.id))
            user = await db.users.find_one({"id": user_id}, {"_id": 0}) if user_id else None
            areas = await areas_for(user, db) if user else set()
            if not ({"club", "system"} & areas):
                await interaction.response.send_message("Nur für den Vorstand.", ephemeral=True)
                return
            state = {**await read_state(db), **runner.status(), "linked_count": len(links)}
            await interaction.response.send_message(status_text(state), ephemeral=True)

        @tree.command(name="rangliste", description="Die Top 10 der laufenden Saison")
        async def rangliste(interaction):
            from services.season_service import _active_season, aggregate_leaderboard

            season = await _active_season(db)
            rows = await aggregate_leaderboard(season_id=season["id"], limit=10) if season else []
            await interaction.response.send_message(ranking_text(season, rows, base_url), ephemeral=True)

        @tree.command(name="bracket", description="Das Bracket eines laufenden Turniers")
        @app_commands.describe(turnier="Welches Turnier? Leer lassen zeigt die laufenden.")
        async def bracket(interaction, turnier: str = ""):
            running = await db.tournaments.find({"status": "live", "is_public": {"$ne": False}, "visibility": "public"},
                                                {"_id": 0, "id": 1, "title": 1, "slug": 1, "status": 1}).to_list(20)
            wanted = (turnier or "").strip().lower()
            picked = next((t for t in running if wanted and wanted in (t.get("title") or "").lower()
                           or wanted and wanted == (t.get("slug") or "").lower()), None)
            if picked is None and len(running) == 1 and not wanted:
                picked = running[0]
            if picked is None:
                await interaction.response.send_message(running_tournaments_text(running, base_url), ephemeral=True)
                return
            matches = await db.matches_v2.find({"tournament_id": picked["id"]}, {"_id": 0, "status": 1}).to_list(500)
            played = sum(1 for match in matches if match.get("status") == "completed")
            await interaction.response.send_message(
                bracket_text(picked, base_url, played=played, total=len(matches)), ephemeral=True)

        @bracket.autocomplete("turnier")
        async def bracket_choices(interaction, current: str):
            rows = await db.tournaments.find({"status": "live", "is_public": {"$ne": False}, "visibility": "public"},
                                             {"_id": 0, "title": 1}).to_list(20)
            titles = [row.get("title") or "" for row in rows if (current or "").lower() in (row.get("title") or "").lower()]
            return [app_commands.Choice(name=title[:100], value=title[:100]) for title in titles[:25]]

        @tree.command(name="wer-streamt", description="Wer aus dem Verein streamt gerade?")
        async def wer_streamt(interaction):
            from services.stream_visibility import homepage_visibility

            streams = await db.live_streams.find({}, {"_id": 0}).sort("viewer_count", -1).to_list(50)
            verdicts = await homepage_visibility(db, [stream.get("user_id") for stream in streams])
            visible = [stream for stream in streams if (verdicts.get(stream.get("user_id")) or {}).get("visible")]
            await interaction.response.send_message(streams_text(visible, base_url), ephemeral=True)

        @tree.command(name="mitglied", description="Dein eigener Mitgliedsstand (nur mit verknüpftem Konto)")
        async def mitglied(interaction):
            # Nur die eigene Person: Mitgliedsdaten anderer beantwortet der Bot nie (#573).
            links = await linked_discord_ids(db)
            user_id = links.get(str(interaction.user.id))
            if not user_id:
                await interaction.response.send_message(link_account_text(base_url), ephemeral=True)
                return
            from services.membership_service import get_membership, is_active_member

            membership = await get_membership(user_id)
            view = {"membership": membership, "is_active_member": is_active_member(membership)} if membership else None
            await interaction.response.send_message(membership_text(view, base_url), ephemeral=True)

        @tree.command(name="verknuepfen", description="So verbindest du Discord mit deinem Konto")
        async def verknuepfen(interaction):
            links = await linked_discord_ids(db)
            await interaction.response.send_message(
                link_account_text(base_url, linked=str(interaction.user.id) in links), ephemeral=True)

        try:
            await client.start(token)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            runner.connected = False
            runner.last_error = friendly_bot_error(exc)
            logger.warning("[discord-bot] %s", exc)
            await record_state(db, connected=False, last_error=runner.last_error)
        finally:
            runner.connected = False

    def _guild(self, view: dict | None = None):
        client = self._client
        view = view or self._view or {}
        if client is None:
            return None
        guild_id = str(view.get("guild_id") or "")
        return client.get_guild(int(guild_id)) if guild_id.isdigit() else (client.guilds[0] if client.guilds else None)

    async def _cache_channels(self, guild) -> list[dict]:
        rows = sorted_channels([channel_row(channel, channel.permissions_for(guild.me)) for channel in guild.text_channels])
        await record_state(get_db(), channels=rows, channels_at=now_utc().isoformat())
        return rows

    async def list_channels(self) -> dict:
        """Die Textkanäle des Servers mit dem, was der Bot dort darf - für die Kanalwahl je Ziel (#566).
        Offline kommt die zuletzt gesehene Liste mit dem Hinweis, dass die Kanal-ID auch geht."""
        db = get_db()
        cached = (await read_state(db)).get("channels") or []
        if self._client is None or not self.connected:
            return {"ok": False, "reason": "offline", "text": CHANNEL_TEXTS["offline"], "channels": cached}
        guild = self._guild()
        if guild is None:
            return {"ok": False, "reason": "no_guild", "text": no_guild_text(self._view, self._client), "channels": cached}
        try:
            return {"ok": True, "channels": await self._cache_channels(guild)}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "reason": "error", "text": f"{type(exc).__name__}: {exc}"[:200], "channels": cached}

    async def send_embed(self, channel_id: str, embed: dict, buttons: list[dict] | None = None) -> dict:
        """Ein Embed in genau diesen Kanal (#566), mit Link-Knöpfen darunter (#573).

        Kein Rückfall: ist der Bot aus oder darf er dort nicht schreiben, kommt der Grund
        zurück - den Text dazu kennt discord_service.REASON_TEXTS.
        """
        client = self._client
        if client is None or not self.connected:
            return {"ok": False, "reason": "bot_offline"}
        import discord

        try:
            channel = client.get_channel(int(channel_id)) or await client.fetch_channel(int(channel_id))
        except (discord.NotFound, ValueError):
            return {"ok": False, "reason": "unknown_channel"}
        except discord.Forbidden:
            return {"ok": False, "reason": "forbidden"}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "reason": "error", "error": f"{type(exc).__name__}: {exc}"[:200]}
        try:
            message = await channel.send(embed=discord.Embed.from_dict(embed), **_view(buttons))
        except discord.Forbidden:
            return {"ok": False, "reason": "forbidden"}
        except discord.HTTPException as exc:
            return {"ok": False, "reason": "http", "error": f"Discord {exc.status}: {exc.text}"[:200]}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "reason": "error", "error": f"{type(exc).__name__}: {exc}"[:200]}
        self.last_action = f"Meldung in #{getattr(channel, 'name', channel_id)} ({now_utc().strftime('%H:%M')} UTC)"
        return {"ok": True, "message_id": str(message.id), "channel_id": str(channel.id)}

    async def _channel(self, client, channel_id: str):
        import discord

        try:
            return client.get_channel(int(channel_id)) or await client.fetch_channel(int(channel_id)), None
        except (discord.NotFound, ValueError):
            return None, {"ok": False, "reason": "unknown_channel"}
        except discord.Forbidden:
            return None, {"ok": False, "reason": "forbidden"}
        except Exception as exc:  # noqa: BLE001
            return None, {"ok": False, "reason": "error", "error": f"{type(exc).__name__}: {exc}"[:200]}

    async def edit_embed(self, channel_id: str, message_id: str, embed: dict) -> dict:
        """Eine eigene Nachricht bearbeiten (#569). Ist sie weg, kommt ``unknown_message`` - dann wird neu gepostet."""
        client = self._client
        if client is None or not self.connected:
            return {"ok": False, "reason": "bot_offline"}
        import discord

        channel, problem = await self._channel(client, channel_id)
        if problem:
            return problem
        try:
            message = await channel.fetch_message(int(message_id))
            await message.edit(embed=discord.Embed.from_dict(embed))
        except (discord.NotFound, ValueError):
            return {"ok": False, "reason": "unknown_message"}
        except discord.Forbidden:
            return {"ok": False, "reason": "forbidden"}
        except discord.HTTPException as exc:
            return {"ok": False, "reason": "http", "error": f"Discord {exc.status}: {exc.text}"[:200]}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "reason": "error", "error": f"{type(exc).__name__}: {exc}"[:200]}
        self.last_action = f"Einbettung in #{getattr(channel, 'name', channel_id)} aktualisiert ({now_utc().strftime('%H:%M')} UTC)"
        return {"ok": True, "message_id": str(message.id), "channel_id": str(channel.id)}

    async def pin_message(self, channel_id: str, message_id: str) -> dict:
        """Eine eigene Nachricht anpinnen (#569); scheitert das (kein Recht, 50 Pins voll), bleibt sie trotzdem stehen."""
        client = self._client
        if client is None or not self.connected:
            return {"ok": False, "reason": "bot_offline"}
        import discord

        channel, problem = await self._channel(client, channel_id)
        if problem:
            return problem
        try:
            message = await channel.fetch_message(int(message_id))
            await message.pin(reason="LION Website: Einbettung")
        except (discord.NotFound, ValueError):
            return {"ok": False, "reason": "unknown_message"}
        except discord.Forbidden:
            return {"ok": False, "reason": "forbidden"}
        except discord.HTTPException as exc:
            return {"ok": False, "reason": "http", "error": f"Discord {exc.status}: {exc.text}"[:200]}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "reason": "error", "error": f"{type(exc).__name__}: {exc}"[:200]}
        return {"ok": True}

    async def create_thread(self, channel_id: str, message_id: str, name: str) -> dict:
        """Einen Thread unter einer eigenen Nachricht öffnen (#572); braucht „Öffentliche Threads erstellen“."""
        client = self._client
        if client is None or not self.connected:
            return {"ok": False, "reason": "bot_offline"}
        import discord

        from services.discord_threads import ARCHIVE_MINUTES

        channel, problem = await self._channel(client, channel_id)
        if problem:
            return problem
        try:
            message = await channel.fetch_message(int(message_id))
            thread = await message.create_thread(name=name[:100], auto_archive_duration=ARCHIVE_MINUTES,
                                                 reason="LION Website: Thread je Turnier")
        except (discord.NotFound, ValueError):
            return {"ok": False, "reason": "unknown_message"}
        except discord.Forbidden:
            return {"ok": False, "reason": "forbidden",
                    "error": "Der Bot darf hier keine Threads öffnen – Rolle braucht „Öffentliche Threads erstellen“."}
        except discord.HTTPException as exc:
            return {"ok": False, "reason": "http", "error": f"Discord {exc.status}: {exc.text}"[:200]}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "reason": "error", "error": f"{type(exc).__name__}: {exc}"[:200]}
        self.last_action = f"Thread „{name[:40]}“ geöffnet ({now_utc().strftime('%H:%M')} UTC)"
        return {"ok": True, "thread_id": str(thread.id)}

    async def create_scheduled_event(self, payload: dict) -> dict:
        """Einen Discord-Termin anlegen (#570) - „extern“ mit Ort oder Link; braucht „Events verwalten“."""
        client = self._client
        if client is None or not self.connected:
            return {"ok": False, "reason": "bot_offline"}
        import discord
        from services.discord_scheduled import _dt

        guild = self._guild()
        if guild is None:
            return {"ok": False, "reason": "no_guild"}
        try:
            event = await guild.create_scheduled_event(
                name=payload["name"], description=payload.get("description") or "", start_time=_dt(payload["start"]), end_time=_dt(payload["end"]),
                entity_type=discord.EntityType.external, location=payload.get("location") or payload.get("url") or "Website",
                privacy_level=discord.PrivacyLevel.guild_only, reason="LION Website: Termin",
            )
        except discord.Forbidden:
            return {"ok": False, "reason": "forbidden", "error": "Der Bot darf keine Termine anlegen – Rolle braucht „Events verwalten“."}
        except discord.HTTPException as exc:
            return {"ok": False, "reason": "http", "error": f"Discord {exc.status}: {exc.text}"[:200]}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "reason": "error", "error": f"{type(exc).__name__}: {exc}"[:200]}
        self.last_action = f"Termin „{payload['name'][:40]}“ angelegt ({now_utc().strftime('%H:%M')} UTC)"
        return {"ok": True, "event_id": str(event.id)}

    async def _scheduled_event(self, event_id: str):
        import discord

        guild = self._guild()
        if guild is None:
            return None, {"ok": False, "reason": "no_guild"}
        try:
            return await guild.fetch_scheduled_event(int(event_id)), None
        except (discord.NotFound, ValueError):
            return None, {"ok": False, "reason": "unknown_event"}
        except discord.Forbidden:
            return None, {"ok": False, "reason": "forbidden"}
        except Exception as exc:  # noqa: BLE001
            return None, {"ok": False, "reason": "error", "error": f"{type(exc).__name__}: {exc}"[:200]}

    async def edit_scheduled_event(self, event_id: str, payload: dict) -> dict:
        """Einen Discord-Termin nachziehen (#570); ist er weg, kommt ``unknown_event`` - dann wird neu angelegt."""
        client = self._client
        if client is None or not self.connected:
            return {"ok": False, "reason": "bot_offline"}
        import discord
        from services.discord_scheduled import _dt

        event, problem = await self._scheduled_event(event_id)
        if problem:
            return problem
        try:
            await event.edit(name=payload["name"], description=payload.get("description") or "", start_time=_dt(payload["start"]), end_time=_dt(payload["end"]),
                             location=payload.get("location") or payload.get("url") or "Website", reason="LION Website: Termin geändert")
        except discord.Forbidden:
            return {"ok": False, "reason": "forbidden"}
        except discord.HTTPException as exc:
            return {"ok": False, "reason": "http", "error": f"Discord {exc.status}: {exc.text}"[:200]}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "reason": "error", "error": f"{type(exc).__name__}: {exc}"[:200]}
        return {"ok": True, "event_id": str(event.id)}

    async def cancel_scheduled_event(self, event_id: str) -> dict:
        """Einen Discord-Termin absagen (#570); läuft er schon, wird er beendet bzw. gelöscht."""
        client = self._client
        if client is None or not self.connected:
            return {"ok": False, "reason": "bot_offline"}
        import discord

        event, problem = await self._scheduled_event(event_id)
        if problem:
            return problem
        try:
            if event.status is discord.EventStatus.scheduled:
                await event.cancel(reason="LION Website: abgesagt")
            elif event.status is discord.EventStatus.active:
                await event.end(reason="LION Website: beendet")
            else:
                await event.delete(reason="LION Website: entfernt")
        except discord.Forbidden:
            return {"ok": False, "reason": "forbidden"}
        except discord.HTTPException as exc:
            return {"ok": False, "reason": "http", "error": f"Discord {exc.status}: {exc.text}"[:200]}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "reason": "error", "error": f"{type(exc).__name__}: {exc}"[:200]}
        return {"ok": True}

    async def send_dm(self, discord_user_id: str, embed: dict) -> dict:
        """Eine Direktnachricht an ein verknüpftes Konto (#567). Geschlossene Direktnachrichten melden „forbidden“."""
        client = self._client
        if client is None or not self.connected:
            return {"ok": False, "reason": "bot_offline"}
        import discord

        try:
            user = client.get_user(int(discord_user_id)) or await client.fetch_user(int(discord_user_id))
        except (discord.NotFound, ValueError):
            return {"ok": False, "reason": "unknown_user"}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "reason": "error", "error": f"{type(exc).__name__}: {exc}"[:200]}
        try:
            message = await user.send(embed=discord.Embed.from_dict(embed))
        except discord.Forbidden:
            return {"ok": False, "reason": "forbidden"}
        except discord.HTTPException as exc:
            return {"ok": False, "reason": "http", "error": f"Discord {exc.status}: {exc.text}"[:200]}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "reason": "error", "error": f"{type(exc).__name__}: {exc}"[:200]}
        self.last_action = f"Direktnachricht gesendet ({now_utc().strftime('%H:%M')} UTC)"
        return {"ok": True, "message_id": str(message.id)}

    async def sync_roles(self) -> dict:
        """Rollen abgleichen - idempotent: nur die drei verwalteten Rollen, nur verknüpfte Konten."""
        db = get_db()
        client = self._client
        if client is None or not self.connected:
            return {"ok": False, "reason": "offline", "changes": 0, "text": SYNC_TEXTS["offline"]}
        settings = await db.settings.find_one({"id": "discord"}, {"_id": 0}) or {}
        view = bot_settings(settings)
        guild = client.get_guild(int(view["guild_id"])) if view["guild_id"].isdigit() else (client.guilds[0] if client.guilds else None)
        if guild is None:
            return {"ok": False, "reason": "no_guild", "changes": 0, "text": no_guild_text(view, client)}
        roles_by_key = {key: next((r for r in guild.roles if r.name == name), None) for key, name in view["roles"].items()}
        missing = [view["roles"][key] for key, role in roles_by_key.items() if role is None]
        links = await linked_discord_ids(db)
        wanted = await wanted_roles_by_user(db, list(set(links.values())))
        changes = 0
        errors = 0
        for discord_id, user_id in links.items():
            member = guild.get_member(int(discord_id)) if discord_id.isdigit() else None
            if member is None:
                try:
                    member = await guild.fetch_member(int(discord_id))
                except Exception:
                    continue
            current = {key for key, role in roles_by_key.items() if role is not None and role in member.roles}
            add, remove = role_diff(current, wanted.get(user_id, set()))
            try:
                if add:
                    await member.add_roles(*[roles_by_key[key] for key in add if roles_by_key[key] is not None], reason="LION Website: Rollenabgleich")
                if remove:
                    await member.remove_roles(*[roles_by_key[key] for key in remove if roles_by_key[key] is not None], reason="LION Website: Rollenabgleich")
                changes += len(add) + len(remove)
            except Exception as exc:
                errors += 1
                self.last_error = f"Rollen: {exc}"[:300]
        self.last_action = f"Rollenabgleich ({changes} Änderungen)"
        await record_state(db, last_sync_at=now_utc().isoformat(), last_sync_changes=changes, last_sync_errors=errors, missing_roles=missing, last_action=self.last_action)
        return {"ok": True, "changes": changes, "errors": errors, "missing_roles": missing, "linked": len(links)}


bot = BotRunner()
