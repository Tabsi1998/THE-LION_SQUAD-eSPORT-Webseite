"""Versandsperre im Abnahme-Stand (#1609, Codex): kein Push an Expo, keine Discord-DM, kein Discord-Bot - auch nicht
nach einer Änderung der Bot-Einstellungen. Mit einer Job-Auswahl startet der Bot nur mit „discord_bot“."""
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import discord_dm, push_notifications  # noqa: E402
from services.discord_runtime import BotRunner  # noqa: E402
from services.outbound_guard import discord_bot_allowed, outbound_disabled  # noqa: E402


class Explodes:
    """Jede Datenbank-Abfrage ist ein Fehler: die Sperre greift vorher."""

    def __getattr__(self, name):
        raise AssertionError(f"Datenbank angefragt ({name}) trotz Versandsperre")


@pytest.fixture
def no_selection(monkeypatch):
    monkeypatch.delenv("SCHEDULER_JOBS", raising=False)
    monkeypatch.delenv("OUTBOUND_DISABLED", raising=False)


def test_the_bot_is_allowed_without_selection_and_without_lock(no_selection):
    assert not outbound_disabled()
    assert discord_bot_allowed()


def test_the_bot_needs_its_name_in_a_selection(no_selection, monkeypatch):
    monkeypatch.setenv("SCHEDULER_JOBS", "result_holds,draw_show")
    assert not discord_bot_allowed()
    monkeypatch.setenv("SCHEDULER_JOBS", "result_holds,discord_bot")
    assert discord_bot_allowed()


def test_the_lock_beats_the_selection(no_selection, monkeypatch):
    monkeypatch.setenv("SCHEDULER_JOBS", "discord_bot")
    monkeypatch.setenv("OUTBOUND_DISABLED", "TRUE")
    assert outbound_disabled() and not discord_bot_allowed()


@pytest.mark.asyncio
async def test_no_push_and_no_direct_message_while_locked(no_selection, monkeypatch):
    monkeypatch.setenv("OUTBOUND_DISABLED", "true")
    monkeypatch.setattr(push_notifications, "get_db", lambda: Explodes())
    monkeypatch.setattr(discord_dm, "get_db", lambda: Explodes(), raising=False)
    notification = {"id": "n1", "user_id": "u1", "kind": "draw_show_reminder", "title": "Auslosung", "body": "jetzt"}
    assert await push_notifications.send_mobile_push_for_notification(notification) == 0
    assert await discord_dm.send_discord_dm_for_notification(notification, "tournaments") == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("env", [{"OUTBOUND_DISABLED": "true"}, {"SCHEDULER_JOBS": "result_holds,draw_show"}])
async def test_the_bot_does_not_start_even_after_a_settings_change(no_selection, monkeypatch, env):
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    import services.discord_runtime as runtime

    monkeypatch.setattr(runtime, "get_db", lambda: Explodes())
    bot = BotRunner()
    assert await bot.start_if_enabled() is False
    assert await bot.apply_settings() is False
    assert bot.status()["running"] is False
