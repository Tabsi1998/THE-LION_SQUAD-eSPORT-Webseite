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
  ``services/discord_commands.py``; seit #885 ``/anmelden`` und ``/abmelden`` (nur verknüpft, Antworten in
  ``services/discord_registration.py``, Knöpfe mit Kennung ``tls:...`` über ``RegistrationButton``).
  Jede Antwort sieht nur die fragende Person.

Bricht die Verbindung ab (fehlender Intent im Developer Portal, falscher Token, Netz), steht der
Grund als Klickweg in ``last_error`` (``friendly_bot_error``) und der Scheduler-Job
``discord_bot_watch`` startet den Bot alle fünf Minuten neu (``restart_if_down``), bis es klappt.

Die reine Logik (welche Rollen, was zählt, welcher Text) steht ohne Discord-Bibliothek hier
oben, damit sie sich ohne Netz testen lässt; ``BotRunner`` ist die dünne Schicht um discord.py.

Seit #1420 steht die Laufzeit (``BotRunner``, ``bot``, Einstellungen, Zustand, Text-Bausteine) in
``services/discord_runtime.py`` - ohne Importe aus den Discord-Funktionen, damit diese den Bot holen können, ohne
einen Import-Kreis zu schließen. Hier stehen die Ereignisse und Befehle (``wire``, beim Import angemeldet) und das
Zählen; alle alten Namen bleiben über dieses Modul erreichbar.
"""
from __future__ import annotations

import logging

from database import get_db
from models import now_utc
from services import discord_runtime
from services.discord_runtime import (  # noqa: F401 - die alten Namen bleiben hier erreichbar (#1420)
    ROLE_KEYS,
    bot_settings,
    desired_roles,
    role_diff,
    clean_buttons,
    link_view,
    answer_kwargs,
    command_targets,
    counted_user,
    club_day,
    next_event_text,
    open_tournaments_text,
    achievements_text,
    friendly_bot_error,
    no_guild_text,
    SYNC_TEXTS,
    CHANNEL_TEXTS,
    channel_row,
    sorted_channels,
    status_text,
    linked_discord_ids,
    wanted_roles_by_user,
    record_state,
    read_state,
    confirm_view,
    BotRunner,
    bot,
)
from services.private_fields import private_projection

# Bewusster Wiederexport (#1420): diese Namen holen andere Module und Tests weiterhin von hier.
__all__ = [
    "ROLE_KEYS",
    "bot_settings",
    "desired_roles",
    "role_diff",
    "clean_buttons",
    "link_view",
    "answer_kwargs",
    "command_targets",
    "next_event_text",
    "open_tournaments_text",
    "friendly_bot_error",
    "SYNC_TEXTS",
    "CHANNEL_TEXTS",
    "channel_row",
    "sorted_channels",
    "wanted_roles_by_user",
    "BotRunner",
    "bot",
]

logger = logging.getLogger("tls.discord.bot")


def guild_row(guild) -> dict:
    """Ein Server für das Verzeichnis (#624) - Name, Symbol, Mitgliederzahl und was der Bot dort darf."""
    from services.discord_guilds import permission_snapshot

    me = getattr(guild, "me", None)
    icon = getattr(guild, "icon", None)
    return {"guild_id": str(guild.id), "name": str(getattr(guild, "name", "") or ""), "icon_url": str(icon.url) if icon else None,
            "member_count": getattr(guild, "member_count", None),
            "bot_permissions": permission_snapshot(me.guild_permissions) if me is not None else {}}


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


async def handle_message(db, view: dict, guild_id: str, author_id: str, author_is_bot: bool) -> str | None:
    """Eine Nachricht auf einem Server des Bots (#302, #631): zählt für die Statistik dieses Servers und - bei
    verknüpftem Konto - für die Erfolge der Person. **Ein** Zähler je Person über alle Server. Gibt den Nutzer zurück,
    dem sie zählt; gelesen wird nie, was in der Nachricht steht."""
    if not view.get("count_messages") or author_is_bot:
        return None
    user_id = counted_user(author_id, author_is_bot, await linked_discord_ids(db))
    from services import discord_stats
    try:
        await discord_stats.note_message(db, guild_id, user_id)
    except Exception as exc:  # noqa: BLE001 - die Statistik hält das Zählen für die Erfolge nie auf
        logger.warning("[discord-bot] Statistik: %s", type(exc).__name__)
    if user_id:
        await count_message(db, user_id)
    return user_id


async def note_guild_member(db, guild_id: str, joined: bool, is_bot: bool = False) -> None:
    """Beitritt oder Austritt für die Statistik des Servers (#631): nur die Zahl; Bots zählen nicht, ein Fehler stört nie."""
    if is_bot:
        return
    from services import discord_stats
    try:
        await discord_stats.note_member(db, guild_id, joined)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[discord-bot] Statistik: %s", type(exc).__name__)


async def _sync_guilds(client, view: dict) -> None:
    """Die Server des Bots ins Verzeichnis (#624) - ein Fehler hier hält den Bot nie auf."""
    from services import discord_guilds

    try:
        await record_state(get_db(), application_id=str(getattr(client, "application_id", "") or ""))
        await discord_guilds.reconcile(get_db(), [guild_row(guild) for guild in client.guilds], configured_main=str(view.get("guild_id") or ""))
    except Exception as exc:  # noqa: BLE001
        logger.warning("[discord-bot] Server-Verzeichnis: %s", type(exc).__name__)


def wire(runner, client, tree, view: dict, db) -> None:
    """Ereignisse und Slash-Befehle an einen frischen Client hängen - ``BotRunner._run`` ruft das vor dem Verbinden."""
    import discord
    from discord import app_commands

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
        await _sync_guilds(client, view)
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
        await _sync_guilds(client, view)

    @client.event
    async def on_guild_remove(guild):
        await _sync_guilds(client, view)

    @client.event
    async def on_guild_update(before, after):
        await _sync_guilds(client, view)

    @client.event
    async def on_member_join(member):
        # „Du bist dabei“ (#626): Beitritt merken - nur für verknüpfte Konten.
        from services import discord_guilds
        try:
            await discord_guilds.note_membership(db, str(member.guild.id), str(member.id), True)
        except Exception as exc:  # noqa: BLE001
            logger.warning("[discord-bot] Mitgliedschaft: %s", type(exc).__name__)
        await note_guild_member(db, str(member.guild.id), True, bool(member.bot))
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
        await note_guild_member(db, str(member.guild.id), False, bool(member.bot))

    @client.event
    async def on_message(message):
        if message.guild is None:
            return
        # Auf jedem Server des Bots (#631): je Server eine Tageszahl, je Person ein Zähler über alle Server.
        if await handle_message(db, view, str(message.guild.id), str(message.author.id), bool(message.author.bot)):
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

    # Anmeldung im Discord (#885): privat, nur verknüpft, derselbe Dienst wie das Formular. Die Knöpfe tragen ihre
    # Kennung (tls:show|reg|unreg:...), Discord schickt sie mit - so überleben sie einen Neustart des Bots.
    from services import discord_registration

    class RegistrationButton(discord.ui.DynamicItem[discord.ui.Button], template=discord_registration.CUSTOM_ID_PATTERN):
        def __init__(self, button_id: str):
            super().__init__(discord.ui.Button(label="Anmelden", custom_id=button_id, style=discord.ButtonStyle.primary))
            self.button_id = button_id

        @classmethod
        async def from_custom_id(cls, interaction, item, match, /):
            return cls(match.group(0))

        async def callback(self, interaction):
            await runner._reply(interaction, lambda: discord_registration.handle_button(db, interaction.user.id, self.button_id))

    client.add_dynamic_items(RegistrationButton)

    @tree.command(name="anmelden", description="Zu einem Event oder Turnier anmelden (nur mit verknüpftem Konto)")
    @app_commands.describe(auswahl="Welches Event oder Turnier")
    async def anmelden(interaction, auswahl: str | None = None):
        async def produce():
            scope = await discord_commands.server_scope(db, interaction.guild_id)
            return await discord_registration.answer_anmelden(db, interaction.user.id, auswahl, scope.get("games"))
        await runner._reply(interaction, produce)

    @anmelden.autocomplete("auswahl")
    async def anmelden_auswahl(interaction, current: str):
        scope = await discord_commands.server_scope(db, interaction.guild_id)
        return [app_commands.Choice(name=row["name"], value=row["value"])
                for row in await discord_registration.choices(db, interaction.user.id, scope.get("games"), current)]

    @tree.command(name="abmelden", description="Eine Event-Anmeldung zurückziehen (nur mit verknüpftem Konto)")
    @app_commands.describe(auswahl="Welches Event")
    async def abmelden(interaction, auswahl: str | None = None):
        await runner._reply(interaction, lambda: discord_registration.answer_abmelden(db, interaction.user.id, auswahl))

    @abmelden.autocomplete("auswahl")
    async def abmelden_auswahl(interaction, current: str):
        return [app_commands.Choice(name=row["name"], value=row["value"])
                for row in await discord_registration.own_choices(db, interaction.user.id, current)]

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
        user = await db.users.find_one({"id": user_id}, private_projection()) if user_id else None
        areas = await areas_for(user, db) if user else set()
        if not ({"club", "system"} & areas):
            await interaction.response.send_message("Nur für den Vorstand.", ephemeral=True)
            return
        state = {**await read_state(db), **runner.status(), "linked_count": len(links)}
        # Je Server (#630): welcher Server das ist, seine Spiele, Kanäle und die letzte Aktualisierung der Einbettungen.
        lines = await discord_commands.server_status_lines(db, interaction.guild_id)
        await interaction.response.send_message("\n".join([status_text(state), *lines]), ephemeral=True)

    # Mitteilung an mehrere Server (#631): erst die Vorschau nur für die fragende Person, gesendet wird mit dem Knopf.
    from services import discord_distribute

    async def verteil_server(interaction, current: str):
        return [app_commands.Choice(name=row["name"], value=row["value"]) for row in await discord_distribute.server_choices(db, current)]

    @tree.command(name="verteilen", description="Eine Mitteilung an die Server des Vereins schicken (nur Turnierleitung und Vorstand)")
    @app_commands.describe(text="Die Mitteilung", ziel="In welchen Kanal – ohne Angabe Community",
                           server="Nur dieser Server – ohne Angabe alle eingeschalteten", titel="Überschrift – ohne Angabe „Mitteilung“")
    @app_commands.choices(ziel=[app_commands.Choice(name=label, value=key) for key, label in discord_distribute.TARGET_CHOICES])
    @app_commands.autocomplete(server=verteil_server)
    async def verteilen(interaction, text: str, ziel: str = "community", server: str | None = None, titel: str | None = None):
        await interaction.response.defer(ephemeral=True, thinking=True)
        try:
            draft = await discord_distribute.draft_from_discord(
                db, interaction.user.id, text, ziel, server, titel,
                author=str(getattr(interaction.user, "display_name", "") or ""), guild_id=interaction.guild_id)
        except Exception as exc:  # noqa: BLE001 - eine Frage im Discord darf nie im Leeren enden
            logger.warning("[discord-bot] verteilen: %s", type(exc).__name__)
            await interaction.followup.send("Das hat gerade nicht geklappt – versuch es gleich noch einmal.", ephemeral=True)
            return
        if not draft["ok"]:
            await interaction.followup.send(draft["text"], ephemeral=True)
            return

        async def send_now() -> str:
            # Die Berechtigung zählt beim Bestätigen, nicht nur bei der Vorschau (#1045).
            text = await discord_distribute.send_draft(db, interaction.user.id, draft)
            if text != discord_distribute.NOT_STAFF:
                runner.last_action = f"Mitteilung verteilt ({now_utc().strftime('%H:%M')} UTC)"
            return text

        extra = {"view": confirm_view(send_now)} if draft["sendable"] else {}
        await interaction.followup.send(content=draft["content"], embed=discord.Embed.from_dict(draft["embed"]), ephemeral=True, **extra)


discord_runtime.register_wiring(wire)
