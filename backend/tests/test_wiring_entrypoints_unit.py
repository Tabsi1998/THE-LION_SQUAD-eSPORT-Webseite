"""Verdrahtung beim Import (#1420, nach Codex-Prüfung): jeder Einstiegspunkt hat sie, auch ohne ``server``.

Erfolge-Auswertung, Bot-Ereignisse und Zugriff auf Chat-Anhänge melden sich beim Import an (services/bootstrap.py).
Ein Scheduler oder Bot, der in einem eigenen Prozess startet, darf daran nicht scheitern. Darum laufen die Prüfungen
in einem frischen Interpreter, der ``server`` nie lädt.
"""
import os
import pathlib
import subprocess
import sys
import textwrap

BACKEND = pathlib.Path(__file__).resolve().parents[1]

PRELUDE = """
import asyncio, sys
from mongomock_motor import AsyncMongoMockClient
import database
database._db = AsyncMongoMockClient()["wiring_test"]
"""


def run_fresh(code: str) -> str:
    env = {**os.environ, "PYTHONPATH": str(BACKEND), "DISABLE_SCHEDULER": "true"}
    env.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
    env.setdefault("DB_NAME", "wiring_test")
    completed = subprocess.run([sys.executable, "-c", textwrap.dedent(PRELUDE) + textwrap.dedent(code)], cwd=BACKEND, env=env,
                               capture_output=True, text=True, timeout=180)
    assert completed.returncode == 0, completed.stdout + completed.stderr
    return completed.stdout


def test_the_achievement_queue_works_without_the_server():
    """Der Scheduler-Job „Warteschlange abarbeiten“ in einem Prozess, der badges nie geladen hat."""
    out = run_fresh("""
        from services import achievement_core, achievement_queue
        assert achievement_core._evaluator is None and "badges" not in sys.modules and "server" not in sys.modules
        result = asyncio.run(achievement_queue.process_queue())
        assert result == {"evaluated": 0, "awarded": 0}, result
        assert achievement_core._evaluator is not None and "server" not in sys.modules
        print("ok")
    """)
    assert out.strip() == "ok"


def test_starting_the_scheduler_wires_everything():
    out = run_fresh("""
        from services import achievement_core, chat_attachments, discord_runtime, scheduler, scheduler_state

        async def main():
            scheduler.start_scheduler()
            try:
                assert achievement_core._evaluator is not None
                assert discord_runtime._wiring is not None
                assert set(chat_attachments._CHAT_ACCESS) == {"team", "tournament", "match"}
                assert scheduler_state.get_scheduler_status()["running"] is True
            finally:
                scheduler.stop_scheduler()
            assert scheduler_state.get_scheduler_status() == {"running": False, "jobs": []}

        asyncio.run(main())
        assert "server" not in sys.modules
        print("ok")
    """)
    assert out.strip() == "ok"


def test_starting_the_discord_bot_wires_its_events():
    """Der Bot über die Laufzeit gestartet - ohne dass jemand services.discord_bot importiert hat."""
    out = run_fresh("""
        from services import discord_runtime
        assert discord_runtime._wiring is None and "services.discord_bot" not in sys.modules
        assert asyncio.run(discord_runtime.bot.start_if_enabled()) is False, "ohne Token bleibt er aus"
        from services import discord_bot
        assert discord_runtime.wiring() is discord_bot.wire and "server" not in sys.modules
        print("ok")
    """)
    assert out.strip() == "ok"


def test_the_getters_wire_on_their_own_as_a_safety_net():
    out = run_fresh("""
        from services import chat_attachments, discord_runtime
        assert chat_attachments._chat_check("team") is not None
        assert discord_runtime.wiring().__module__ == "services.discord_bot"
        assert chat_attachments._chat_check("direct") is None and chat_attachments._chat_check(None) is None
        print("ok")
    """)
    assert out.strip() == "ok"


def test_ensure_wiring_is_idempotent():
    from services import achievement_core, bootstrap, chat_attachments, discord_runtime

    bootstrap.ensure_wiring()
    bootstrap.ensure_wiring()
    assert achievement_core.evaluator() is not None and discord_runtime.wiring() is not None
    assert set(chat_attachments._CHAT_ACCESS) == {"team", "tournament", "match"}
