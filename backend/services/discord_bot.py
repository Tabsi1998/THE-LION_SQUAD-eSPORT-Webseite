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
  verknüpft), ``/status`` (nur Vorstand/System); seit #573 ``/rangliste``, ``/bracket``,
  ``/wer-streamt``, ``/mitglied`` (nur verknüpft) und ``/verknuepfen`` - die Antworten rechnet
  ``services/discord_commands.py``. Jede Antwort sieht nur die fragende Person.

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
# Turnier-Threads (#572): eine Woche - Discords längste Frist, bevor ein ruhiger Thread ins Archiv geht.
THREAD_ARCHIVE_MINUTES = 10080
# Link-Knöpfe (#573): höchstens fünf unter einer Nachricht (eine Discord-Zeile); sie führen zur Website, der Bot hört nichts zurück.
MAX_BUTTONS = 5


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


def clean_buttons(buttons: list[dict] | None) -> list[dict]:
    """Link-Knöpfe (#573): nur mit Beschriftung und http(s)-Adresse, jede Adresse einmal, höchstens fünf."""
    out: list[dict] = []
    seen: set[str] = set()
    for button in buttons or []:
        label = str((button or {}).get("label") or "").strip()[:80]
        url = str((button or {}).get("url") or "").strip()
        if not label or not url.startswith(("https://", "http://")) or len(url) > 512 or url in seen:
            continue
        seen.add(url)
        out.append({"label": label, "url": url})
        if len(out) >= MAX_BUTTONS:
            break
    return out


def link_view(buttons: list[dict] | None):
    """Die Knöpfe als discord.py-Ansicht - oder None. Link-Knöpfe brauchen keinen laufenden Bot-Rückruf."""
    rows = clean_buttons(buttons)
    if not rows:
        return None
    import discord

    view = discord.ui.View(timeout=None)
    for row in rows:
        view.add_item(discord.ui.Button(label=row["label"], url=row["url"], style=discord.ButtonStyle.link))
    return view


async def answer_kwargs(answer: dict) -> dict:
    """Eine Antwort aus discord_commands (#573) als Discord-Nachricht: Text, Embed wie bei Meldungen, Link-Knöpfe -
    immer nur für die fragende Person."""
    import discord
    from discord_service import build_embed, resolve_buttons

    kwargs: dict = {"ephemeral": True}
    if answer.get("content"):
        kwargs["content"] = str(answer["content"])[:2000]
    raw = answer.get("embed")
    if raw:
        kwargs["embed"] = discord.Embed.from_dict(await build_embed(
            raw["title"], raw.get("description") or "", color=raw.get("color") or 0x29B6E8, url=raw.get("url"),
            fields=raw.get("fields"), image_url=raw.get("image_url"), footer=raw.get("footer")))
    view = link_view(await resolve_buttons(answer.get("buttons")))
    if view is not None:
        kwargs["view"] = view
    return kwargs


def command_targets(rows: dict[str, dict], guild_ids: list[str], main_id: str = "") -> tuple[list[str], list[str]]:
    """Welche Server die Slash-Befehle bekommen (#630): der Hauptserver und jeder eingeschaltete Unterserver, auf dem der
    Bot ist - und welche sie nicht (mehr) haben sollen. Ohne Verzeichnis (allererster Start) nur der Hauptserver."""
    wanted: list[str] = []
    unwanted: list[str] = []
    for guild_id in guild_ids:
        row = rows.get(guild_id)
        if row is None:
            ok = not rows and (guild_id == main_id or (not main_id and guild_id == guild_ids[0]))
        else:
            ok = row.get("role") == "main" or (bool(row.get("enabled")) and not row.get("left_at"))
        (wanted if ok else unwanted).append(guild_id)
    return wanted, unwanted


def attachments(files: list[tuple[str, bytes]] | None) -> list:
    """Anhänge für Discord (#575): (Name, Bytes) → ``discord.File`` - etwa das Bracket als Bild."""
    import io

    import discord

    return [discord.File(io.BytesIO(data), filename=name) for name, data in files or []]


def guild_row(guild) -> dict:
    """Ein Server für das Verzeichnis (#624) - Name, Symbol, Mitgliederzahl und was der Bot dort darf."""
    from services.discord_guilds import permission_snapshot

    me = getattr(guild, "me", None)
    icon = getattr(guild, "icon", None)
    return {"guild_id": str(guild.id), "name": str(getattr(guild, "name", "") or ""), "icon_url": str(icon.url) if icon else None,
            "member_count": getattr(guild, "member_count", None),
            "bot_permissions": permission_snapshot(me.guild_permissions) if me is not None else {}}


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


def allowed_mentions(role_ids: list[str] | None):
    """Wen eine Nachricht erwähnen darf (#866): höchstens die gewählten Rollen - nie @everyone, @here oder Personen."""
    import discord

    roles = [discord.Object(id=int(role_id)) for role_id in role_ids or [] if str(role_id).isdigit()]
    return discord.AllowedMentions(everyone=False, users=False, roles=roles, replied_user=False)


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
        # Turnier-Threads (#572): öffnen und darin schreiben - fehlt eins, gehen Turnier-Meldungen einzeln in den Kanal.
        "can_thread": bool(getattr(permissions, "create_public_threads", False) and getattr(permissions, "send_messages_in_threads", False)),
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

async def linked_discord_ids(db) -> dict[str, str]:
    """Discord-Kennung → Nutzer, nur verknüpfte Konten (#260)."""
    rows = await db.platform_links.find({"platform": "discord"}, {"_id": 0, "user_id": 1, "external_id": 1}).to_list(5000)
    return {str(row["external_id"]): row["user_id"] for row in rows if row.get("external_id") and row.get("user_id")}


async def count_message(db, user_id: str) -> None:
    """Eine Nachricht zählt - Zahl, kein Inhalt (#302)."""
    now = now_utc().isoformat()
    await db.users.update_one({"id": user_id}, {"$inc": {"discord_messages_count": 1}, "$set": {"discord_last_message_at": now}})
    await db.discord_activity.update_one({"user_id": user_id, "day": club_day()}, {"$inc": {"count": 1}, "$setOnInsert": {"created_at": now}}, upsert=True)
    # XP (#617): ein Punkt je Nachricht, höchstens 50 am Tag.
    try:
        from services import xp
        await xp.grant(user_id, "discord_message", now)
    except Exception:  # noqa: BLE001
        pass
    # Erfolge „Discord-Aktiv“ sollen nicht auf den nächtlichen Durchlauf warten (#301: Schlange, je Person einmal).
    from services.achievement_queue import request_evaluation
    await request_evaluation([user_id], "discord_message", sources={"discord", "community"})


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
        self._tree = None
        self._commands_lock = asyncio.Lock()

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
        self._tree = tree
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
            # Erst das Server-Verzeichnis (#624), dann die Befehle je Server (#630): auf dem Hauptserver und jedem
            # eingeschalteten Unterserver als Server-Befehle - sofort da, ohne die Stunde globaler Befehle.
            await runner._sync_guilds(client, view)
            synced = await runner.sync_commands()
            if synced.get("registered"):
                runner.last_action = f"verbunden, Befehle auf {len(synced['registered'])} Server(n) registriert ({now_utc().strftime('%H:%M')} UTC)"
            if synced.get("errors"):
                runner.last_error = ("Befehle: " + "; ".join(synced["errors"]))[:300]
            # Die Server-ID merken: das Server-Widget für die Website (#581) braucht sie, auch ohne eingetragene ID.
            await record_state(db, connected=True, guild_name=runner.guild_name, guild_id=str(guild.id) if guild else "", last_error=runner.last_error,
                               last_action=runner.last_action, started_at=now_utc().isoformat())

        # Server-Verzeichnis (#624): beitreten, verlassen, umbenennen - das Verzeichnis zieht nach.
        @client.event
        async def on_guild_join(guild):
            await runner._sync_guilds(client, view)

        @client.event
        async def on_guild_remove(guild):
            await runner._sync_guilds(client, view)

        @client.event
        async def on_guild_update(before, after):
            await runner._sync_guilds(client, view)

        @client.event
        async def on_member_join(member):
            # „Du bist dabei“ (#626): Beitritt merken - nur für verknüpfte Konten.
            from services import discord_guilds
            try:
                await discord_guilds.note_membership(db, str(member.guild.id), str(member.id), True)
            except Exception as exc:  # noqa: BLE001
                logger.warning("[discord-bot] Mitgliedschaft: %s", type(exc).__name__)
            # Willkommensnachricht (#574): einmal je Person, nur wenn eingeschaltet - ohne Erlaubnis still.
            from services.discord_welcome import greet
            try:
                result = await greet(db, member.id, getattr(member, "display_name", "") or "", is_bot=bool(member.bot))
            except Exception as exc:  # noqa: BLE001 - ein Beitritt darf nie an der Website scheitern
                logger.warning("[discord-bot] Willkommen: %s", type(exc).__name__)
                return
            if result.get("ok"):
                runner.last_action = f"Willkommensnachricht gesendet ({now_utc().strftime('%H:%M')} UTC)"

        @client.event
        async def on_member_remove(member):
            # Austritt (#626): der Status im Mitgliederbereich und der Zähler „Überall dabei“ stimmen sofort.
            from services import discord_guilds
            try:
                await discord_guilds.note_membership(db, str(member.guild.id), str(member.id), False)
            except Exception as exc:  # noqa: BLE001
                logger.warning("[discord-bot] Mitgliedschaft: %s", type(exc).__name__)

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
        # Seit #630 je Server: auf einem Spielserver zeigen /turniere, /naechstes-event und /bracket nur dessen Spiele;
        # `spiel:` wählt ein anderes, `alle: True` zeigt alles. Die Antworten rechnet services/discord_commands.py.
        from services import discord_commands

        async def spiele(interaction, current: str):
            return [app_commands.Choice(name=row["name"], value=row["value"]) for row in await discord_commands.game_choices(db, current)]

        @tree.command(name="naechstes-event", description="Wann ist das nächste Event?")
        @app_commands.describe(spiel="Nur Events mit einem Turnier dieses Spiels", alle="Alle Spiele statt nur die dieses Servers")
        @app_commands.autocomplete(spiel=spiele)
        async def naechstes_event(interaction, spiel: str | None = None, alle: bool = False):
            await runner._reply(interaction, lambda: discord_commands.answer_naechstes_event(db, interaction.guild_id, spiel, alle, base_url))

        @tree.command(name="turniere", description="Welche Turnier-Anmeldungen sind offen?")
        @app_commands.describe(spiel="Nur dieses Spiel", alle="Alle Spiele statt nur die dieses Servers")
        @app_commands.autocomplete(spiel=spiele)
        async def turniere(interaction, spiel: str | None = None, alle: bool = False):
            await runner._reply(interaction, lambda: discord_commands.answer_turniere(db, interaction.guild_id, spiel, alle, base_url))

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

        # Seit #573: die Antworten rechnet services/discord_commands.py; Discord wartet nur drei Sekunden, darum erst
        # „denkt nach“ und dann die Antwort - auch sie nur für die fragende Person.
        @tree.command(name="rangliste", description="Die Top 10 der laufenden Saison")
        async def rangliste(interaction):
            await runner._reply(interaction, lambda: discord_commands.answer_rangliste(db))

        @tree.command(name="bracket", description="Das Bracket eines laufenden Turniers")
        @app_commands.describe(turnier="Welches laufende Turnier")
        async def bracket(interaction, turnier: str | None = None):
            await runner._reply(interaction, lambda: discord_commands.answer_bracket(db, turnier, guild_id=interaction.guild_id))

        @bracket.autocomplete("turnier")
        async def bracket_turniere(interaction, current: str):
            return [app_commands.Choice(name=row["name"], value=row["value"])
                    for row in await discord_commands.bracket_choices(db, current, guild_id=interaction.guild_id)]

        @tree.command(name="wer-streamt", description="Wer aus dem Verein gerade live ist")
        async def wer_streamt(interaction):
            await runner._reply(interaction, lambda: discord_commands.answer_wer_streamt(db))

        @tree.command(name="mitglied", description="Dein Stand im Verein (nur mit verknüpftem Konto)")
        async def mitglied(interaction):
            await runner._reply(interaction, lambda: discord_commands.answer_mitglied(db, interaction.user.id, base_url))

        @tree.command(name="verknuepfen", description="Discord-Konto mit der Website verknüpfen")
        async def verknuepfen(interaction):
            await runner._reply(interaction, lambda: discord_commands.answer_verknuepfen(db, interaction.user.id, base_url))

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
            # Je Server (#630): welcher Server das ist, seine Spiele, Kanäle und die letzte Aktualisierung der Einbettungen.
            lines = await discord_commands.server_status_lines(db, interaction.guild_id)
            await interaction.response.send_message("\n".join([status_text(state), *lines]), ephemeral=True)

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

    async def _reply(self, interaction, produce) -> None:
        """Erst „denkt nach“ (nur für die fragende Person), dann die Antwort - ein Fehler wird ein freundlicher Satz."""
        await interaction.response.defer(ephemeral=True, thinking=True)
        try:
            kwargs = await answer_kwargs(await produce())
        except Exception as exc:  # noqa: BLE001 - eine Frage im Discord darf nie im Leeren enden
            logger.warning("[discord-bot] Befehl: %s", type(exc).__name__)
            kwargs = {"content": "Das hat gerade nicht geklappt – versuch es gleich noch einmal.", "ephemeral": True}
        await interaction.followup.send(**kwargs)

    async def sync_commands(self) -> dict:
        """Slash-Befehle je Server (#630): auf dem Hauptserver und jedem eingeschalteten Unterserver registriert; ein
        ausgeschalteter oder zum Unterserver ohne Haken gewordener Server verliert sie wieder (nur, wo sie standen -
        ``commands_at`` am Server-Eintrag). Ein Server ohne Recht hält die anderen nicht auf."""
        client, tree = self._client, self._tree
        if client is None or tree is None or not self.connected:
            return {"ok": False, "reason": "bot_offline", "registered": [], "removed": [], "errors": []}
        from services.discord_guilds import COLLECTION

        db = get_db()
        fields = {"_id": 0, "guild_id": 1, "role": 1, "enabled": 1, "left_at": 1, "commands_at": 1}
        rows = {row["guild_id"]: row for row in await db[COLLECTION].find({}, fields).to_list(500)}
        guilds = {str(guild.id): guild for guild in client.guilds}
        wanted, unwanted = command_targets(rows, list(guilds), str((self._view or {}).get("guild_id") or ""))
        registered: list[str] = []
        removed: list[str] = []
        errors: list[str] = []
        async with self._commands_lock:
            for guild_id in wanted:
                try:
                    tree.copy_global_to(guild=guilds[guild_id])
                    await tree.sync(guild=guilds[guild_id])
                    registered.append(guild_id)
                except Exception as exc:  # noqa: BLE001 - ein Server ohne Recht hält die anderen nicht auf
                    errors.append(f"{getattr(guilds[guild_id], 'name', guild_id)}: {exc}"[:200])
            for guild_id in unwanted:
                if not (rows.get(guild_id) or {}).get("commands_at"):
                    continue
                try:
                    tree.clear_commands(guild=guilds[guild_id])
                    await tree.sync(guild=guilds[guild_id])
                    removed.append(guild_id)
                except Exception as exc:  # noqa: BLE001
                    errors.append(f"{getattr(guilds[guild_id], 'name', guild_id)}: {exc}"[:200])
        if registered:
            await db[COLLECTION].update_many({"guild_id": {"$in": registered}}, {"$set": {"commands_at": now_utc().isoformat()}})
        if removed:
            await db[COLLECTION].update_many({"guild_id": {"$in": removed}}, {"$unset": {"commands_at": ""}})
        return {"ok": not errors, "registered": registered, "removed": removed, "errors": errors}

    async def _sync_guilds(self, client, view: dict) -> None:
        """Die Server des Bots ins Verzeichnis (#624) - ein Fehler hier hält den Bot nie auf."""
        from services import discord_guilds

        try:
            await record_state(get_db(), application_id=str(getattr(client, "application_id", "") or ""))
            await discord_guilds.reconcile(get_db(), [guild_row(guild) for guild in client.guilds], configured_main=str(view.get("guild_id") or ""))
        except Exception as exc:  # noqa: BLE001
            logger.warning("[discord-bot] Server-Verzeichnis: %s", type(exc).__name__)

    def connected_guild_ids(self) -> set[str] | None:
        """Auf welchen Servern der Bot gerade ist - None, wenn er nicht verbunden ist (dann weiß es niemand)."""
        client = self._client
        if client is None or not self.connected:
            return None
        return {str(guild.id) for guild in client.guilds}

    def system_channel_id(self, guild_id: str) -> str:
        """Der Systemkanal eines Servers (dort grüßt Discord neue Mitglieder) - für den Test auf einem Unterserver."""
        client = self._client
        guild = client.get_guild(int(guild_id)) if client is not None and str(guild_id).isdigit() else None
        channel = getattr(guild, "system_channel", None) if guild is not None else None
        return str(channel.id) if channel is not None else ""

    async def create_invite(self, guild_id: str, channel_id: str = "") -> dict:
        """Einen unbegrenzt gültigen Einladungslink erzeugen (#624) - im angegebenen Kanal, sonst im Systemkanal oder im
        ersten Kanal, in dem der Bot einladen darf. Braucht „Einladung erstellen“."""
        client = self._client
        if client is None or not self.connected:
            return {"ok": False, "reason": "bot_offline"}
        import discord

        guild = client.get_guild(int(guild_id)) if str(guild_id).isdigit() else None
        if guild is None:
            return {"ok": False, "reason": "unknown_guild"}
        channel = guild.get_channel(int(channel_id)) if str(channel_id).isdigit() else None
        if channel is None:
            candidates = [guild.system_channel, *guild.text_channels]
            channel = next((entry for entry in candidates if entry is not None and entry.permissions_for(guild.me).create_instant_invite), None)
        if channel is None:
            return {"ok": False, "reason": "forbidden"}
        try:
            invite = await channel.create_invite(max_age=0, max_uses=0, unique=False, reason="LION Website: Einladungslink")
        except discord.Forbidden:
            return {"ok": False, "reason": "forbidden"}
        except discord.HTTPException as exc:
            return {"ok": False, "reason": "http", "error": f"Discord {exc.status}: {exc.text}"[:200]}
        return {"ok": True, "url": str(invite.url)}

    async def member_status(self, guild_ids: list[str], discord_user_id: str) -> dict[str, bool | None]:
        """Ist dieses Konto auf diesen Servern (#626)? True/False je Server; None, wenn es niemand weiß (Bot offline,
        Bot nicht auf dem Server, Discord antwortet nicht). Erst der Zwischenspeicher, dann eine Abfrage bei Discord -
        die braucht kein Recht und keinen zusätzlichen Intent."""
        client = self._client
        if client is None or not self.connected or not str(discord_user_id).isdigit():
            return {str(guild_id): None for guild_id in guild_ids}
        import discord

        out: dict[str, bool | None] = {}
        for guild_id in guild_ids:
            guild = client.get_guild(int(guild_id)) if str(guild_id).isdigit() else None
            if guild is None:
                out[str(guild_id)] = None
            elif guild.get_member(int(discord_user_id)) is not None:
                out[str(guild_id)] = True
            else:
                try:
                    await guild.fetch_member(int(discord_user_id))
                    out[str(guild_id)] = True
                except discord.NotFound:
                    out[str(guild_id)] = False
                except Exception:  # noqa: BLE001 - Discord antwortet nicht: unbekannt, nicht „nein“
                    out[str(guild_id)] = None
        return out

    async def list_roles(self) -> dict:
        """Die Rollen des Hauptservers für die Auswahl „Rolle erwähnen“ (#866) - ohne @everyone und ohne Rollen von
        Bots und Integrationen. Offline: leer mit Grund."""
        guild = self._guild() if self._client is not None and self.connected else None
        if guild is None:
            return {"ok": False, "reason": "offline", "roles": []}
        # „mentionable“: Discord pingt eine Rolle nur, wenn jeder sie erwähnen darf (oder der Bot @everyone erwähnen darf -
        # das bekommt er bewusst nicht).
        rows = [{"id": str(role.id), "name": role.name, "color": int(getattr(role.colour, "value", 0) or 0), "mentionable": bool(getattr(role, "mentionable", False))}
                for role in sorted(guild.roles, key=lambda role: role.position, reverse=True)
                if not role.is_default() and not getattr(role, "managed", False)]
        return {"ok": True, "roles": rows}

    def role_id(self, name: str | None, guild_id: str | None = None) -> str | None:
        """Die Kennung der Rolle mit diesem Namen auf einem Server (#629, Ping-Rollen) - ohne ``guild_id`` am
        Hauptserver. Gibt es die Rolle dort nicht oder ist der Bot nicht verbunden, gibt es nichts zu erwähnen."""
        if not name or self._client is None or not self.connected:
            return None
        guild = self._guild(guild_id=guild_id) if guild_id else self._guild()
        if guild is None:
            return None
        for role in guild.roles:
            if role.name == name and not role.is_default():
                return str(role.id)
        return None

    def _guild(self, view: dict | None = None, guild_id: str | None = None):
        """Der Hauptserver - oder, mit ``guild_id`` (#628), genau dieser Server (Termine auf Unterservern)."""
        client = self._client
        view = view or self._view or {}
        if client is None:
            return None
        wanted = str(guild_id or view.get("guild_id") or "")
        if guild_id:
            return client.get_guild(int(wanted)) if wanted.isdigit() else None
        return client.get_guild(int(wanted)) if wanted.isdigit() else (client.guilds[0] if client.guilds else None)

    async def _cache_channels(self, guild) -> list[dict]:
        rows = sorted_channels([channel_row(channel, channel.permissions_for(guild.me)) for channel in guild.text_channels])
        await record_state(get_db(), channels=rows, channels_at=now_utc().isoformat())
        return rows

    async def list_channels(self, guild_id: str = "") -> dict:
        """Die Textkanäle des Servers mit dem, was der Bot dort darf - für die Kanalwahl je Ziel (#566); mit ``guild_id``
        die eines bestimmten Servers (#625). Offline kommt die zuletzt gesehene Liste mit dem Hinweis, dass die
        Kanal-ID auch geht."""
        db = get_db()
        guild_id = str(guild_id or "")
        if guild_id:
            cached = ((await db.discord_guilds.find_one({"guild_id": guild_id}, {"_id": 0, "channel_list": 1})) or {}).get("channel_list") or []
        else:
            cached = (await read_state(db)).get("channels") or []
        if self._client is None or not self.connected:
            return {"ok": False, "reason": "offline", "text": CHANNEL_TEXTS["offline"], "channels": cached}
        guild = self._client.get_guild(int(guild_id)) if guild_id.isdigit() else (None if guild_id else self._guild())
        if guild is None:
            text = "Der Bot ist nicht auf diesem Server." if guild_id else no_guild_text(self._view, self._client)
            return {"ok": False, "reason": "no_guild", "text": text, "channels": cached}
        try:
            if not guild_id:
                return {"ok": True, "channels": await self._cache_channels(guild)}
            rows = sorted_channels([channel_row(channel, channel.permissions_for(guild.me)) for channel in guild.text_channels])
            await db.discord_guilds.update_one({"guild_id": guild_id}, {"$set": {"channel_list": rows}})
            return {"ok": True, "channels": rows}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "reason": "error", "text": f"{type(exc).__name__}: {exc}"[:200], "channels": cached}

    async def send_embed(self, channel_id: str, embed: dict, buttons: list[dict] | None = None, *, content: str | None = None,
                         mention_role_ids: list[str] | None = None, files: list[tuple[str, bytes]] | None = None) -> dict:
        """Ein Embed in genau diesen Kanal (#566), auf Wunsch mit Link-Knöpfen darunter (#573). Kein Rückfall:
        ist der Bot aus oder darf er dort nicht schreiben, kommt der Grund zurück - den Text dazu kennt
        discord_service.REASON_TEXTS. ``content`` (#866) steht über dem Kasten; erwähnt wird darin höchstens
        ``mention_role_ids`` - nie @everyone, @here oder einzelne Personen. ``files`` (#575): Anhänge als (Name, Bytes),
        im Embed über ``attachment://Name`` zu zeigen."""
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
            await self._reopen(channel)
            extra = {"files": attachments(files)} if files else {}
            message = await channel.send(content=content or None, embed=discord.Embed.from_dict(embed), view=link_view(buttons),
                                         allowed_mentions=allowed_mentions(mention_role_ids), **extra)
        except discord.Forbidden:
            return {"ok": False, "reason": "forbidden"}
        except discord.HTTPException as exc:
            return {"ok": False, "reason": "http", "error": f"Discord {exc.status}: {exc.text}"[:200]}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "reason": "error", "error": f"{type(exc).__name__}: {exc}"[:200]}
        self.last_action = f"Meldung in #{getattr(channel, 'name', channel_id)} ({now_utc().strftime('%H:%M')} UTC)"
        return {"ok": True, "message_id": str(message.id), "channel_id": str(channel.id)}

    @staticmethod
    async def _reopen(channel) -> None:
        """Ein Thread im Archiv (Discord: nach einer Woche Ruhe) wird vor dem Schreiben wieder geöffnet (#572) -
        ein gesperrter bleibt zu, dann scheitert das Schreiben mit seinem Grund."""
        if getattr(channel, "archived", False) and not getattr(channel, "locked", False):
            await channel.edit(archived=False)

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

    async def edit_embed(self, channel_id: str, message_id: str, embed: dict, buttons: list[dict] | None = None, *,
                         content: str | None = None, files: list[tuple[str, bytes]] | None = None) -> dict:
        """Eine eigene Nachricht bearbeiten (#569). Ist sie weg, kommt ``unknown_message`` - dann wird neu gepostet.
        Ohne ``buttons`` bleiben die Knöpfe, wie sie sind (#573); ohne ``content`` der Text darüber (#866) - ein
        bearbeiteter Text erwähnt niemanden neu. ``files`` (#575) ersetzt die Anhänge; ohne bleiben sie."""
        client = self._client
        if client is None or not self.connected:
            return {"ok": False, "reason": "bot_offline"}
        import discord

        channel, problem = await self._channel(client, channel_id)
        if problem:
            return problem
        try:
            await self._reopen(channel)
            message = await channel.fetch_message(int(message_id))
            changes = {"embed": discord.Embed.from_dict(embed)}
            if buttons is not None:
                changes["view"] = link_view(buttons)
            if content is not None:
                changes["content"] = content or None
                changes["allowed_mentions"] = allowed_mentions(None)
            if files is not None:
                changes["attachments"] = attachments(files)
            await message.edit(**changes)
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
            await self._reopen(channel)
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
        """Einen öffentlichen Thread unter einer eigenen Nachricht öffnen (#572) - braucht „Öffentliche Threads erstellen“.
        Hat die Nachricht schon einen, ist es dieser: Discord gibt einem Thread die ID der Nachricht, unter der er steht."""
        client = self._client
        if client is None or not self.connected:
            return {"ok": False, "reason": "bot_offline"}
        import discord

        channel, problem = await self._channel(client, channel_id)
        if problem:
            return problem
        try:
            message = await channel.fetch_message(int(message_id))
            thread = await message.create_thread(name=name[:100], auto_archive_duration=THREAD_ARCHIVE_MINUTES, reason="LION Website: Turnier-Thread")
        except (discord.NotFound, ValueError):
            return {"ok": False, "reason": "unknown_message"}
        except discord.Forbidden:
            return {"ok": False, "reason": "thread_forbidden"}
        except discord.HTTPException as exc:
            if getattr(exc, "code", None) == 160004:  # „Für diese Nachricht gibt es schon einen Thread“
                return {"ok": True, "thread_id": str(message_id)}
            return {"ok": False, "reason": "http", "error": f"Discord {exc.status}: {exc.text}"[:200]}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "reason": "error", "error": f"{type(exc).__name__}: {exc}"[:200]}
        self.last_action = f"Thread „{thread.name}“ geöffnet ({now_utc().strftime('%H:%M')} UTC)"
        return {"ok": True, "thread_id": str(thread.id)}

    async def delete_message(self, channel_id: str, message_id: str) -> dict:
        """Eine eigene Nachricht löschen (#572: der Endstand wandert ans Ende des Threads). Schon weg zählt als erledigt."""
        client = self._client
        if client is None or not self.connected:
            return {"ok": False, "reason": "bot_offline"}
        import discord

        channel, problem = await self._channel(client, channel_id)
        if problem:
            return problem
        try:
            await self._reopen(channel)
            await channel.get_partial_message(int(message_id)).delete()
        except (discord.NotFound, ValueError):
            return {"ok": True, "gone": True}
        except discord.Forbidden:
            return {"ok": False, "reason": "forbidden"}
        except discord.HTTPException as exc:
            return {"ok": False, "reason": "http", "error": f"Discord {exc.status}: {exc.text}"[:200]}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "reason": "error", "error": f"{type(exc).__name__}: {exc}"[:200]}
        return {"ok": True}

    async def create_scheduled_event(self, payload: dict, guild_id: str | None = None) -> dict:
        """Einen Discord-Termin anlegen (#570) - „extern“ mit Ort oder Link; braucht „Events verwalten“.
        ``guild_id`` (#628): auf diesem Server statt dem Hauptserver."""
        client = self._client
        if client is None or not self.connected:
            return {"ok": False, "reason": "bot_offline"}
        import discord
        from services.discord_scheduled import _dt

        guild = self._guild(guild_id=guild_id)
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

    async def _scheduled_event(self, event_id: str, guild_id: str | None = None):
        import discord

        guild = self._guild(guild_id=guild_id)
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

    async def edit_scheduled_event(self, event_id: str, payload: dict, guild_id: str | None = None) -> dict:
        """Einen Discord-Termin nachziehen (#570); ist er weg, kommt ``unknown_event`` - dann wird neu angelegt."""
        client = self._client
        if client is None or not self.connected:
            return {"ok": False, "reason": "bot_offline"}
        import discord
        from services.discord_scheduled import _dt

        event, problem = await self._scheduled_event(event_id, guild_id)
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

    async def cancel_scheduled_event(self, event_id: str, guild_id: str | None = None) -> dict:
        """Einen Discord-Termin absagen (#570); läuft er schon, wird er beendet bzw. gelöscht."""
        client = self._client
        if client is None or not self.connected:
            return {"ok": False, "reason": "bot_offline"}
        import discord

        event, problem = await self._scheduled_event(event_id, guild_id)
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

    async def send_dm(self, discord_user_id: str, embed: dict, buttons: list[dict] | None = None) -> dict:
        """Eine Direktnachricht an ein verknüpftes Konto (#567), auf Wunsch mit Link-Knöpfen (#573).
        Geschlossene Direktnachrichten melden „forbidden“."""
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
            message = await user.send(embed=discord.Embed.from_dict(embed), view=link_view(buttons))
        except discord.Forbidden:
            return {"ok": False, "reason": "forbidden"}
        except discord.HTTPException as exc:
            return {"ok": False, "reason": "http", "error": f"Discord {exc.status}: {exc.text}"[:200]}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "reason": "error", "error": f"{type(exc).__name__}: {exc}"[:200]}
        self.last_action = f"Direktnachricht gesendet ({now_utc().strftime('%H:%M')} UTC)"
        return {"ok": True, "message_id": str(message.id)}

    async def sync_roles(self) -> dict:
        """Rollen abgleichen - idempotent, je Server (#629): die drei Vereinsrollen auf dem Hauptserver und jedem
        eingeschalteten Unterserver, dazu Spiel-Rollen; nur verknüpfte Konten, nur die verwalteten Rollen, höchstens
        ``SYNC_LIMIT`` Änderungen je Lauf über alle Server (der Rest kommt im nächsten)."""
        from services import discord_roles

        db = get_db()
        client = self._client
        if client is None or not self.connected:
            return {"ok": False, "reason": "offline", "changes": 0, "text": SYNC_TEXTS["offline"]}
        settings = await db.settings.find_one({"id": "discord"}, {"_id": 0}) or {}
        view = bot_settings(settings)
        guilds = {str(guild.id): guild for guild in client.guilds}
        targets = await discord_roles.targets(db, list(guilds), view["guild_id"])
        if not targets:
            return {"ok": False, "reason": "no_guild", "changes": 0, "text": no_guild_text(view, client)}
        links = await linked_discord_ids(db)
        user_ids = list(set(links.values()))
        club = await wanted_roles_by_user(db, user_ids)
        games, parents = await discord_roles.load_games(db)
        holders = await discord_roles.game_holders(db, user_ids, games, parents)
        budget = SYNC_LIMIT
        servers: dict[str, dict] = {}
        for guild_id, row in targets:
            names = discord_roles.role_names(view["roles"], games, await discord_roles.scope_games(db, row, games, parents))
            result = await self._sync_guild_roles(guilds[guild_id], names, links, club, holders, budget, create=bool((row or {}).get("create_roles")))
            budget -= result["changes"]
            servers[guild_id] = result
            if row is not None:
                await discord_roles.record(db, guild_id, result)
        main = servers[targets[0][0]]
        changes = sum(result["changes"] for result in servers.values())
        errors = sum(result["errors"] for result in servers.values())
        if any(result.get("error") for result in servers.values()):
            self.last_error = "Rollen: " + "; ".join(f"{guilds[gid].name}: {result['error']}" for gid, result in servers.items() if result.get("error"))[:280]
        self.last_action = f"Rollenabgleich ({changes} Änderungen{', Rest im nächsten Lauf' if budget <= 0 else ''})"
        await record_state(db, last_sync_at=now_utc().isoformat(), last_sync_changes=changes, last_sync_errors=errors, missing_roles=main["missing"],
                           last_action=self.last_action)
        return {"ok": True, "changes": changes, "errors": errors, "missing_roles": main["missing"], "linked": len(links), "servers": servers}

    async def _sync_guild_roles(self, guild, names: dict, links: dict[str, str], club: dict[str, set], holders: dict[str, set], budget: int,
                                *, create: bool = False) -> dict:
        """Ein Server: Rollen über den Namen finden (mit „Fehlende Rollen anlegen“ auch anlegen), dann je verknüpfter Person,
        die dort ist, hinzufügen und entfernen. Ein fehlendes Recht zählt als Fehler und steht in Worten da."""
        from services import discord_roles

        roles = {key: next((role for role in guild.roles if role.name == name), None) for key, name in names.items()}
        held = {game_id for games in holders.values() for game_id in games}
        needed = {key for key in names if key[0] == "club" or key[1] in held}
        created: list[str] = []
        error = ""
        if create:
            for key in sorted(needed, key=str):
                if roles.get(key) is not None:
                    continue
                try:
                    roles[key] = await guild.create_role(name=names[key], mentionable=key[0] == "game", reason="LION Website: Rolle angelegt")
                    created.append(names[key])
                except Exception as exc:  # noqa: BLE001 - ohne „Rollen verwalten“ legt der Bot nichts an
                    error = f"Rolle „{names[key]}“ nicht angelegt: {exc}"[:200]
                    break
        # Fehlende Vereinsrollen sind eine Aufgabe; Spiel-Rollen gibt es nur, wo ihr sie anlegt - sie stehen getrennt.
        missing = [names[key] for key in sorted(needed, key=str) if key[0] == "club" and roles.get(key) is None]
        missing_games = [names[key] for key in sorted(needed, key=str) if key[0] == "game" and roles.get(key) is None]
        available = {key for key, role in roles.items() if role is not None}
        chunked = bool(getattr(guild, "chunked", False))
        changes = errors = 0
        limited = False
        for discord_id, user_id in links.items():
            if changes >= budget:
                limited = True
                break
            member = guild.get_member(int(discord_id)) if discord_id.isdigit() else None
            if member is None and not chunked and discord_id.isdigit():
                # Nur ohne vollständige Mitgliederliste fragen - sonst hieße jede Person, die nicht dort ist, ein Aufruf je Lauf.
                try:
                    member = await guild.fetch_member(int(discord_id))
                except Exception:  # noqa: BLE001 - nicht auf dem Server
                    member = None
            if member is None:
                continue
            wanted = {("club", key) for key in club.get(user_id, set())} | {("game", game_id) for game_id in holders.get(user_id, set())}
            current = {key for key in available if roles[key] in member.roles}
            add, remove = discord_roles.member_plan(current, wanted & set(names), available)
            try:
                if add:
                    await member.add_roles(*[roles[key] for key in sorted(add, key=str)], reason="LION Website: Rollenabgleich")
                if remove:
                    await member.remove_roles(*[roles[key] for key in sorted(remove, key=str)], reason="LION Website: Rollenabgleich")
                changes += len(add) + len(remove)
            except Exception as exc:  # noqa: BLE001 - eine Person ohne Erfolg hält die anderen nicht auf
                errors += 1
                error = f"{exc}"[:200]
        return {"changes": changes, "errors": errors, "missing": missing, "missing_games": missing_games, "created": created, "error": error,
                "limited": limited}


bot = BotRunner()
