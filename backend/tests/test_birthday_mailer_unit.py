import asyncio
import pathlib
import sys
import types
from datetime import date, datetime, timedelta, timezone

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import birthday_mailer


class _Cursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, _limit):
        return self.rows


class _Users:
    def __init__(self, rows):
        self.rows = rows
        self.last_query = None

    def find(self, query, _projection):
        self.last_query = query
        return _Cursor(self.rows)


class _Db:
    def __init__(self, rows):
        self.users = _Users(rows)


def test_birthday_is_today_handles_feb_29_policy():
    assert birthday_mailer.birthday_is_today("2000-02-29", date(2025, 2, 28))
    assert birthday_mailer.birthday_is_today("2000-02-29", date(2024, 2, 29))
    assert not birthday_mailer.birthday_is_today("2000-02-29", date(2024, 2, 28))
    assert birthday_mailer.birthday_is_today("1998-05-08", date(2026, 5, 8))


def test_queue_birthday_greetings_queues_due_users(monkeypatch):
    rows = [
        {
            "id": "u1",
            "email": "one@example.test",
            "username": "one",
            "display_name": "One",
            "birth_date": "1998-05-08",
            "notification_preferences": {},
        },
        {
            "id": "u2",
            "email": "two@example.test",
            "username": "two",
            "birth_date": "1998-05-09",
            "notification_preferences": {},
        },
    ]
    fake_db = _Db(rows)
    sent = []

    async def fake_base_url():
        return "https://example.test"

    async def fake_send_user_template(user, template_key, **kwargs):
        sent.append((user, template_key, kwargs))
        return {"ok": True}

    monkeypatch.setitem(sys.modules, "database", types.SimpleNamespace(get_db=lambda: fake_db))
    monkeypatch.setattr(birthday_mailer, "_site_base_url", fake_base_url)
    monkeypatch.setattr(birthday_mailer, "send_user_template", fake_send_user_template)

    result = asyncio.run(birthday_mailer.queue_birthday_greetings(
        datetime(2026, 5, 8, 8, 0, tzinfo=timezone(timedelta(hours=2)))
    ))

    assert result["checked"] == 2
    assert result["due"] == 1
    assert result["queued"] == 1
    assert len(sent) == 1
    assert sent[0][1] == "birthday_greeting"
    assert sent[0][2]["dedupe_key"] == "birthday_greeting:2026:u1"
