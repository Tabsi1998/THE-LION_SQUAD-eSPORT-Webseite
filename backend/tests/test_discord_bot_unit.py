"""Discord-Bot (#302), reine Logik ohne Netz: Rollen je Person, Abgleich nur der drei verwalteten
Rollen, Zählen nur für verknüpfte Konten, Antworttexte der Befehle."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from services import discord_bot  # noqa: E402


def test_settings_fall_back_to_defaults_and_never_carry_the_token():
    view = discord_bot.bot_settings({"bot_token": "enc", "bot_enabled": True, "bot_roles": {"member": " Mitglied:in ", "board": ""}})
    assert view == {"enabled": True, "configured": True, "guild_id": "", "roles": {"member": "Mitglied:in", "board": "Vorstand", "tournament": "Turnierleitung"}, "count_messages": True}
    assert discord_bot.bot_settings(None)["configured"] is False
    assert discord_bot.bot_settings({"bot_count_messages": False})["count_messages"] is False


def test_roles_follow_membership_and_areas_and_only_managed_roles_move():
    assert discord_bot.desired_roles(set(), False) == set()
    assert discord_bot.desired_roles(set(), True) == {"member"}
    assert discord_bot.desired_roles({"club", "tournaments"}, True) == {"member", "board", "tournament"}
    assert discord_bot.desired_roles({"tournaments"}, False) == {"tournament"}
    add, remove = discord_bot.role_diff({"member", "board"}, {"member", "tournament"})
    assert (add, remove) == ({"tournament"}, {"board"})
    add, remove = discord_bot.role_diff({"member", "admin"}, set())
    assert (add, remove) == (set(), {"member"}), "fremde Rollen wie „admin“ fasst der Bot nie an"


def test_only_linked_humans_count():
    links = {"123": "u1"}
    assert discord_bot.counted_user("123", False, links) == "u1"
    assert discord_bot.counted_user("123", True, links) is None
    assert discord_bot.counted_user("999", False, links) is None


def test_command_texts():
    assert "kein Event geplant" in discord_bot.next_event_text([])
    text = discord_bot.next_event_text([
        {"name": "Später", "start_date": "2026-12-01T18:00:00+01:00", "slug": "spaeter"},
        {"name": "LAN-Party", "start_date": "2026-10-03T17:00:00+02:00", "slug": "lan", "location": "Vereinsheim", "city": "Telfs"},
    ], "https://lionsquad.at")
    assert text.startswith("**LAN-Party** – 03.10.2026 17:00 · Vereinsheim, Telfs") and text.endswith("/events/lan")
    assert "keine Turnier-Anmeldung offen" in discord_bot.open_tournaments_text([{"title": "x", "status": "live"}])
    assert "• **Herbst-Cup** – 02.10.2026" in discord_bot.open_tournaments_text([{"title": "Herbst-Cup", "status": "registration_open", "start_date": "2026-10-02T17:00:00+00:00"}])
    assert "Noch kein Erfolg" in discord_bot.achievements_text([], 0)
    assert discord_bot.achievements_text([{"name": "Hallo Welt"}, {"name": "Talker"}], 30) == "Deine Erfolge (2, 30 Punkte): Hallo Welt, Talker"
    status = discord_bot.status_text({"connected": True, "guild_name": "LION", "linked_count": 3, "last_error": "x"})
    assert "Bot: online" in status and "Server: LION" in status and "Letzter Fehler: x" in status


def test_discord_errors_become_click_paths():
    class PrivilegedIntentsRequired(Exception):
        pass

    class LoginFailure(Exception):
        pass

    intents = discord_bot.friendly_bot_error(PrivilegedIntentsRequired("Shard ID None is requesting privileged intents that have not been explicitly enabled"))
    assert "Server Members Intent" in intents and "Save Changes" in intents and "fünf Minuten" in intents
    assert "Reset Token" in discord_bot.friendly_bot_error(LoginFailure("Improper token has been passed."))
    assert discord_bot.friendly_bot_error(RuntimeError("Netz weg")) == "Netz weg"
    assert discord_bot.friendly_bot_error(RuntimeError("")) == "RuntimeError"


def test_no_guild_becomes_a_click_path():
    """#515: statt „no_guild“ steht, was los ist - Server-ID passt nicht, oder der Bot ist auf keinem Server."""
    class Guild:
        def __init__(self, gid, name):
            self.id, self.name = gid, name

    class Client:
        def __init__(self, guilds):
            self.guilds = guilds

    wrong_id = discord_bot.no_guild_text({"guild_id": "999"}, Client([Guild(1, "LION")]))
    assert "999" in wrong_id and "LION (1)" in wrong_id and "Server-ID kopieren" in wrong_id
    nowhere = discord_bot.no_guild_text({"guild_id": ""}, Client([]))
    assert nowhere.startswith("Der Bot ist auf keinem Server") and "URL Generator" in nowhere
    assert "Bot verbinden" in discord_bot.SYNC_TEXTS["offline"]


def test_channel_rows_carry_what_the_bot_may_do_and_writable_ones_come_first():
    """Kanalwahl je Ziel (#566): der Admin sieht je Kanal, ob der Bot dort schreiben und einbetten darf."""
    class Category:
        def __init__(self, name):
            self.name = name

    class Channel:
        def __init__(self, cid, name, category=None, position=0):
            self.id, self.name, self.category, self.position = cid, name, category, position

    class Permissions:
        def __init__(self, view=True, send=True, embed=True):
            self.view_channel, self.send_messages, self.embed_links = view, send, embed

    row = discord_bot.channel_row(Channel(1, "news", Category("Community"), 2), Permissions(embed=False))
    assert row == {"id": "1", "name": "news", "category": "Community", "position": 2, "can_send": True, "can_embed": False}
    assert discord_bot.channel_row(Channel(2, "regeln"), Permissions(send=False))["can_send"] is False
    rows = discord_bot.sorted_channels([
        {"id": "9", "name": "regeln", "category": "Info", "position": 0, "can_send": False},
        {"id": "2", "name": "news", "category": "Community", "position": 1, "can_send": True},
        {"id": "1", "name": "allgemein", "category": "Community", "position": 0, "can_send": True},
    ])
    assert [row["name"] for row in rows] == ["allgemein", "news", "regeln"]
    assert "Kanal-ID" in discord_bot.CHANNEL_TEXTS["offline"]


def test_ranking_text_names_the_season_and_the_top_ten():
    rows = [{"display_name": f"Spieler {i}", "points": 100 - i} for i in range(1, 13)]

    text = discord_bot.ranking_text({"name": "Saison 3"}, rows, "https://lionsquad.at")

    assert text.startswith("**Rangliste Saison 3**")
    assert "🥇 Spieler 1 – 99 Punkte" in text and "🥈 Spieler 2" in text and "🥉 Spieler 3" in text
    assert "4. Spieler 4" in text
    assert "Spieler 11" not in text, "nur die Top 10"
    assert text.endswith("https://lionsquad.at/ranking")
    assert discord_bot.ranking_text(None, [], "") == "Für die laufende Saison gibt es noch keine Wertung."


def test_bracket_text_says_the_stand_and_lists_running_tournaments_when_nothing_matches():
    text = discord_bot.bracket_text({"title": "Sommer-Cup", "slug": "cup"}, "https://lionsquad.at", played=3, total=7)
    assert "**Sommer-Cup**" in text and "3 von 7 Partien gespielt" in text
    assert text.endswith("https://lionsquad.at/tournaments/cup/bracket")

    assert "kenne ich nicht" in discord_bot.bracket_text(None)

    running = [{"title": "Sommer-Cup", "status": "live"}, {"title": "Winter-Cup", "status": "live"},
               {"title": "Alt", "status": "completed"}]
    listed = discord_bot.running_tournaments_text(running, "https://lionsquad.at")
    assert "**Sommer-Cup**" in listed and "**Winter-Cup**" in listed and "Alt" not in listed
    assert discord_bot.running_tournaments_text([]) == "Gerade läuft kein Turnier."


def test_streams_text_names_who_is_live_with_the_link():
    streams = [{"display_name": "Paula", "game_name": "Rocket League", "title": "Ranked bis Grand Champ",
                "twitch_login": "paula"}]

    text = discord_bot.streams_text(streams, "https://lionsquad.at")

    assert "**Paula**" in text and "Rocket League" in text and "Ranked bis Grand Champ" in text
    assert "https://twitch.tv/paula" in text and text.endswith("https://lionsquad.at/live")
    assert discord_bot.streams_text([]) == "Gerade streamt niemand aus dem Verein."


def test_membership_text_only_talks_about_the_own_state():
    view = {"membership": {"status": "active", "member_number": "42"}, "is_active_member": True}

    text = discord_bot.membership_text(view, "https://lionsquad.at")

    assert "**aktiv**" in text and "Nummer 42" in text and text.endswith("https://lionsquad.at/konto")
    assert "in Prüfung" in discord_bot.membership_text({"membership": {"status": "pending"}})
    assert "keine Mitgliedschaft" in discord_bot.membership_text(None, "https://lionsquad.at")


def test_link_account_text_points_at_the_profile():
    text = discord_bot.link_account_text("https://lionsquad.at")
    assert "Mit Discord verknüpfen" in text and "https://lionsquad.at/profil" in text
    assert "schon mit der Website verknüpft" in discord_bot.link_account_text("https://lionsquad.at", linked=True)


def test_only_http_links_become_buttons():
    rows = discord_bot.link_buttons([
        {"label": "Zur Anmeldung", "url": "https://lionsquad.at/tournaments/cup"},
        {"label": "", "url": "https://lionsquad.at"},
        {"label": "Ohne Ziel", "url": ""},
        {"label": "Kein Netz", "url": "javascript:alert(1)"},
        {"label": "Pfad", "url": "/tournaments/cup"},
    ])

    assert rows == [{"label": "Zur Anmeldung", "url": "https://lionsquad.at/tournaments/cup"}], \
        "ein Knopf ohne gültigen Link klickt ins Leere"
    assert len(discord_bot.link_buttons([{"label": f"L{i}", "url": "https://x.at"} for i in range(9)])) == 5
