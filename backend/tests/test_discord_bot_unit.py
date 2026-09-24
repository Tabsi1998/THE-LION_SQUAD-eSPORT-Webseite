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
