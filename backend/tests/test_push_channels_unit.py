"""Android-Kanäle (#1138): jede Benachrichtigungsart genau einem Kanal zugeordnet - die Liste an einer Stelle.

Aufteilung des Betreibers vom 07.10.2026: „Aufrufe & Spielstart“ (mit Gong), „Turniere & Events“, „Chats“, „Verein“,
„Erfolge“. Chat-Nachrichten und Spielaufrufe kommen in getrennten Kanälen; Event-Hinweise unter „Turniere & Events“.
Geräte mit der alten App (ohne gemeldeten Kanal-Stand) bekommen weiter die zwei alten Kanäle.
"""
import ast
import asyncio
import pathlib
import re
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import push_notifications  # noqa: E402
from services.notification_preferences import NOTIFICATION_KIND_CATEGORY  # noqa: E402

PUSH_CHANNELS = push_notifications.PUSH_CHANNELS
_channel_for_kind = push_notifications._channel_for_kind
channel_for_device = push_notifications.channel_for_device
BACKEND = pathlib.Path(__file__).resolve().parents[1]
APP_CHANNELS = BACKEND.parent / "mobile" / "src" / "notifications" / "channels.ts"


def _kinds_in_code() -> set[str]:
    """Alle Arten, die das Backend an create_user_notification übergibt - fest oder aus einer Konstante."""
    kinds: set[str] = set()
    for path in BACKEND.rglob("*.py"):
        if path.relative_to(BACKEND).as_posix().startswith("tests/"):
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            name = node.func.attr if isinstance(node.func, ast.Attribute) else getattr(node.func, "id", "")
            if name != "create_user_notification":
                continue
            kind = next((kw.value for kw in node.keywords if kw.arg == "kind"), node.args[4] if len(node.args) >= 5 else None)
            if isinstance(kind, ast.Constant) and isinstance(kind.value, str):
                kinds.add(kind.value)
    # Aus Konstanten zusammengesetzt (Rechnung, Vereinsinternes).
    kinds |= {"invoice_ready", "news_member", "news_board", "event_member", "event_board"}
    return kinds


def test_every_kind_has_exactly_one_channel():
    missing = sorted((_kinds_in_code() | set(NOTIFICATION_KIND_CATEGORY)) - set(PUSH_CHANNELS))
    assert missing == [], f"Arten ohne Kanal: {missing}"
    assert set(PUSH_CHANNELS.values()) == {"lion_calls", "lion_tournaments", "lion_chats", "lion_club", "lion_achievements"}


def test_calls_and_chats_are_apart_and_events_are_with_tournaments():
    for kind in ("match_call", "match_station", "match_reminder", "match_attention", "team_presence_nudge"):
        assert _channel_for_kind(kind) == "lion_calls"
    for kind in ("match_chat_message", "tournament_chat_message", "direct_message", "team_chat_mention", "friend_request", "team_invite"):
        assert _channel_for_kind(kind) == "lion_chats"
    for kind in ("event_member", "event_board", "tournament_checkin", "match_result", "prize_pending", "feedback_request"):
        assert _channel_for_kind(kind) == "lion_tournaments"
    for kind in ("news_member", "membership_update", "invoice_ready", "ballot_open", "helper_call", "helper_reminder"):
        assert _channel_for_kind(kind) == "lion_club"
    for kind in ("achievement", "level", "crown_gained", "prestige", "year_review"):
        assert _channel_for_kind(kind) == "lion_achievements"


def test_the_app_creates_the_same_channels():
    text = APP_CHANNELS.read_text(encoding="utf-8")
    assert set(re.findall(r'id: "(lion_[a-z_]+)"', text)) == set(PUSH_CHANNELS.values())


def test_old_apps_keep_their_two_channels():
    assert channel_for_device("match_chat_message", None) == "tournaments"
    assert channel_for_device("news_member", None) == "default"
    assert channel_for_device("match_chat_message", 2) == "lion_chats"


def test_each_device_gets_its_own_channel(monkeypatch):
    sent = []

    class _Client:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, _url, json):
            sent.extend(json)
            return SimpleNamespace(raise_for_status=lambda: None, json=lambda: {"data": [{"status": "ok", "id": f"t{i}"} for i in range(len(json))]})

    class _Cursor:
        def __init__(self, rows):
            self.rows = rows

        async def to_list(self, _limit):
            return self.rows

    tokens = SimpleNamespace(
        find=lambda *_args, **_kwargs: _Cursor([
            {"token": "ExponentPushToken[neu]", "channel_set": 2},
            {"token": "ExponentPushToken[alt]"},
        ]),
        update_one=AsyncMock(), update_many=AsyncMock(),
    )
    monkeypatch.setattr(push_notifications, "get_db", lambda: SimpleNamespace(mobile_push_tokens=tokens))
    monkeypatch.setattr(push_notifications.httpx, "AsyncClient", _Client)

    count = asyncio.run(push_notifications.send_mobile_push_for_notification(
        {"id": "n1", "user_id": "u1", "kind": "match_call", "title": "Du bist dran", "body": "Station 3"}))
    assert count == 2
    assert {row["to"]: row["channelId"] for row in sent} == {"ExponentPushToken[neu]": "lion_calls", "ExponentPushToken[alt]": "tournaments"}
