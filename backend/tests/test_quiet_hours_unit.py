"""Ruhezeit (#1206, Fabians Wahl A): von–bis in Wiener Zeit, Standard aus. In der Ruhezeit kein Push, keine Browser-Meldung
und keine Discord-Direktnachricht - alles liegt in der Glocke; danach genau eine Sammelmeldung. Ausnahmen: Aufruf zum eigenen
Spiel, „Match startet jetzt“, Liga-Check-in und Veto am Zug, „Braucht Aufmerksamkeit“ während des eigenen Turniers."""
import pathlib
import sys
import types
from datetime import datetime, timezone

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

pytest.importorskip("email_validator")

from pymongo.errors import DuplicateKeyError

from services import quiet_hours
from services.user_notifications import create_user_notification

NIGHT = {"enabled": True, "start": "22:00", "end": "07:00"}


def _utc(text):
    return datetime.fromisoformat(text).replace(tzinfo=timezone.utc)


# ---------------------------------------------------------------- kleine Datenbank im Speicher

def _value(row, dotted):
    value = row
    for part in dotted.split("."):
        if not isinstance(value, dict):
            return None
        value = value.get(part)
    return value


def _matches(row, query):
    for key, expected in query.items():
        actual = _value(row, key)
        if isinstance(expected, dict):
            if "$gte" in expected and not (actual is not None and actual >= expected["$gte"]):
                return False
            if "$lte" in expected and not (actual is not None and actual <= expected["$lte"]):
                return False
            if "$in" in expected and actual not in expected["$in"]:
                return False
            if "$ne" in expected and actual == expected["$ne"]:
                return False
            if "$exists" in expected and (actual is not None) != expected["$exists"]:
                return False
            continue
        if actual != expected:
            return False
    return True


class _Cursor:
    def __init__(self, rows):
        self.rows = rows

    def sort(self, key, direction=1):
        self.rows.sort(key=lambda row: row.get(key) or "", reverse=direction < 0)
        return self

    async def to_list(self, limit=None):
        return self.rows[:limit] if limit else self.rows


class _Result:
    def __init__(self, modified):
        self.modified_count = modified


class _Collection:
    def __init__(self, rows=None, unique=None):
        self.rows = [dict(row) for row in (rows or [])]
        self.unique = unique

    async def find_one(self, query, projection=None, **_kwargs):
        for row in self.rows:
            if _matches(row, query):
                return dict(row)
        return None

    def find(self, query, projection=None):
        return _Cursor([dict(row) for row in self.rows if _matches(row, query)])

    async def insert_one(self, doc):
        if self.unique and doc.get(self.unique[1]) is not None:
            if any(row.get(self.unique[0]) == doc.get(self.unique[0]) and row.get(self.unique[1]) == doc.get(self.unique[1]) for row in self.rows):
                raise DuplicateKeyError("doppelt")
        self.rows.append(dict(doc))

    def _apply(self, row, update):
        row.update(update.get("$set") or {})
        for key in update.get("$unset") or {}:
            row.pop(key, None)

    async def update_one(self, query, update):
        for row in self.rows:
            if _matches(row, query):
                self._apply(row, update)
                return _Result(1)
        return _Result(0)

    async def update_many(self, query, update):
        hit = [row for row in self.rows if _matches(row, query)]
        for row in hit:
            self._apply(row, update)
        return _Result(len(hit))

    async def count_documents(self, query):
        return sum(1 for row in self.rows if _matches(row, query))


class _Db:
    def __init__(self, users, tournaments=None):
        self.users = _Collection(users)
        self.notifications = _Collection([], unique=("user_id", "unique_dedupe_key"))
        self.tournaments = _Collection(tournaments or [])


@pytest.fixture
def wires(monkeypatch):
    """Push, Browser und Discord als Zähler - jeder Versand landet in ``sent``."""
    sent = []

    def _module(name, attr, channel):
        module = types.ModuleType(name)

        async def _send(notification, *_args):
            sent.append((channel, notification["kind"], notification["user_id"]))
            return 1

        setattr(module, attr, _send)
        return module

    push = _module("services.push_notifications", "send_mobile_push_for_notification", "push")
    web = _module("services.web_push", "send_web_push_for_notification", "browser")

    async def _has_browser(_db, _user_id):
        return True

    web.has_browser_subscription = _has_browser
    dm = _module("services.discord_dm", "send_discord_dm_for_notification", "discord")
    events = types.ModuleType("services.change_events")

    async def _publish(*_args, **_kwargs):
        return None

    events.publish_user_change = _publish
    for name, module in (("services.push_notifications", push), ("services.web_push", web),
                         ("services.discord_dm", dm), ("services.change_events", events)):
        monkeypatch.setitem(sys.modules, name, module)
    return sent


def _at(monkeypatch, db, when):
    monkeypatch.setattr("services.user_notifications.get_db", lambda: db)
    monkeypatch.setattr("services.quiet_hours.now_utc", lambda: _utc(when))


# ---------------------------------------------------------------- Zeitfenster

def test_off_by_default_and_suggested_from_22_to_7():
    assert quiet_hours.quiet_until({}, _utc("2026-11-16T02:00:00")) is None
    assert quiet_hours.settings_payload({}) == {"enabled": False, "start": "22:00", "end": "07:00"}
    assert quiet_hours.quiet_until({"quiet_hours": {**NIGHT, "enabled": False}}, _utc("2026-11-16T02:00:00")) is None
    # Gleiche Zeiten sind keine Ruhezeit.
    assert quiet_hours.quiet_until({"quiet_hours": {"enabled": True, "start": "07:00", "end": "07:00"}}, _utc("2026-11-16T06:00:00")) is None


def test_over_midnight_in_vienna_winter_time():
    user = {"quiet_hours": NIGHT}
    # 16.11. ist Winterzeit (UTC+1): 22:00 Wien = 21:00 UTC, 7:00 Wien = 6:00 UTC.
    assert quiet_hours.quiet_until(user, _utc("2026-11-16T20:59:00")) is None
    assert quiet_hours.quiet_until(user, _utc("2026-11-16T21:00:00")) == _utc("2026-11-17T06:00:00")
    assert quiet_hours.quiet_until(user, _utc("2026-11-16T23:30:00")) == _utc("2026-11-17T06:00:00")
    assert quiet_hours.quiet_until(user, _utc("2026-11-17T05:59:00")) == _utc("2026-11-17T06:00:00")
    assert quiet_hours.quiet_until(user, _utc("2026-11-17T06:00:00")) is None


def test_summer_time_and_the_nights_of_the_clock_change():
    user = {"quiet_hours": NIGHT}
    # Sommerzeit (UTC+2): 7:00 Wien = 5:00 UTC.
    assert quiet_hours.quiet_until(user, _utc("2026-07-01T04:59:00")) == _utc("2026-07-01T05:00:00")
    assert quiet_hours.quiet_until(user, _utc("2026-07-01T05:00:00")) is None
    assert quiet_hours.quiet_until(user, _utc("2026-06-30T20:00:00")) == _utc("2026-07-01T05:00:00")
    # Umstellung auf Sommerzeit (29.03.2026): Beginn 22:00 MEZ, Ende 7:00 MESZ - die Nacht ist eine Stunde kürzer.
    assert quiet_hours.quiet_until(user, _utc("2026-03-28T21:00:00")) == _utc("2026-03-29T05:00:00")
    assert quiet_hours.quiet_until(user, _utc("2026-03-29T04:59:00")) == _utc("2026-03-29T05:00:00")
    assert quiet_hours.quiet_until(user, _utc("2026-03-29T05:00:00")) is None
    # Umstellung auf Winterzeit (25.10.2026): Beginn 22:00 MESZ, Ende 7:00 MEZ - eine Stunde länger.
    assert quiet_hours.quiet_until(user, _utc("2026-10-24T20:00:00")) == _utc("2026-10-25T06:00:00")
    assert quiet_hours.quiet_until(user, _utc("2026-10-25T05:30:00")) == _utc("2026-10-25T06:00:00")
    assert quiet_hours.quiet_until(user, _utc("2026-10-25T06:00:00")) is None


def test_a_window_within_one_day():
    user = {"quiet_hours": {"enabled": True, "start": "13:00", "end": "15:30"}}
    assert quiet_hours.quiet_until(user, _utc("2026-11-16T11:59:00")) is None
    assert quiet_hours.quiet_until(user, _utc("2026-11-16T12:00:00")) == _utc("2026-11-16T14:30:00")
    assert quiet_hours.quiet_until(user, _utc("2026-11-16T14:30:00")) is None
    assert not quiet_hours.crosses_midnight(user) and quiet_hours.crosses_midnight({"quiet_hours": NIGHT})


def test_times_are_checked_without_regex():
    assert quiet_hours.parse_time("07:05") == 425
    for bad in ("7:00", "24:00", "12:60", "aa:bb", "", None, "12:000", "12-00"):
        assert quiet_hours.parse_time(bad) is None


def test_the_profile_model_accepts_only_clock_times():
    from pydantic import ValidationError

    from models import UserUpdate

    body = UserUpdate(quiet_hours={"enabled": True, "start": "22:00", "end": "07:00"})
    assert body.model_dump(exclude_unset=True)["quiet_hours"] == NIGHT
    for bad in ({"enabled": True, "start": "25:00", "end": "07:00"}, {"enabled": True, "start": "07:00", "end": "07:00"}):
        with pytest.raises(ValidationError):
            UserUpdate(quiet_hours=bad)


# ---------------------------------------------------------------- Zurückhalten beim Versand

@pytest.mark.anyio
async def test_quiet_hours_hold_push_browser_and_discord_but_fill_the_bell(monkeypatch, wires):
    db = _Db([{"id": "u1", "quiet_hours": NIGHT, "notification_preferences": {"discord": True}}])
    _at(monkeypatch, db, "2026-11-16T23:00:00")
    doc = await create_user_notification("u1", "Neue Nachricht", kind="direct_message", meta={"dedupe_key": "dm-1"})
    assert doc is not None and wires == []
    row = db.notifications.rows[0]
    assert row["in_app_visible"] is True and row["read"] is False
    assert row["quiet_hold_until"] == "2026-11-17T06:00:00+00:00"
    assert row["quiet_held_channels"] == ["push", "browser", "discord"]
    assert row["push_sent_count"] == 0 and row["discord_sent_count"] == 0


@pytest.mark.anyio
async def test_outside_quiet_hours_everything_goes_as_before(monkeypatch, wires):
    db = _Db([{"id": "u1", "quiet_hours": NIGHT, "notification_preferences": {"discord": True}}])
    _at(monkeypatch, db, "2026-11-16T12:00:00")
    await create_user_notification("u1", "Neue Nachricht", kind="direct_message", meta={"dedupe_key": "dm-1"})
    assert sorted(channel for channel, _kind, _user in wires) == ["browser", "discord", "push"]
    assert "quiet_hold_until" not in db.notifications.rows[0]


@pytest.mark.anyio
async def test_a_topic_only_in_the_app_is_not_held_because_nothing_would_go_out(monkeypatch, wires):
    db = _Db([{"id": "u1", "quiet_hours": NIGHT, "notification_preferences": {"push:achievements": False, "browser:achievements": False}}])
    _at(monkeypatch, db, "2026-11-16T23:00:00")
    await create_user_notification("u1", "Erfolg", kind="achievement", meta={"dedupe_key": "a-1"})
    assert wires == [] and "quiet_hold_until" not in db.notifications.rows[0]


@pytest.mark.anyio
@pytest.mark.parametrize("kind,meta", [
    ("match_call", {"reason": "match_call"}),                     # Aufruf zum eigenen Spiel (#1137)
    ("match_call", {"reason": "checkin_open"}),                   # Liga: Check-in offen fürs eigene Spiel
    ("match_call", {"reason": "veto_turn"}),                      # Liga: Veto – ihr seid am Zug
    ("match_station", {}),                                        # „Match startet jetzt“ an der Station
    ("match_schedule", {"reason": "checkin_started"}),            # „Match startet jetzt“ der Liga
])
async def test_calls_and_match_start_come_through(monkeypatch, wires, kind, meta):
    db = _Db([{"id": "u1", "quiet_hours": NIGHT, "notification_preferences": {}}])
    _at(monkeypatch, db, "2026-11-16T23:00:00")
    await create_user_notification("u1", "Jetzt", kind=kind, meta={"category": "match_reminders", "dedupe_key": "x", **meta})
    assert ("push", kind, "u1") in wires and ("browser", kind, "u1") in wires
    assert "quiet_hold_until" not in db.notifications.rows[0]


@pytest.mark.anyio
async def test_attention_for_the_lead_only_while_the_own_tournament_runs(monkeypatch, wires):
    tournaments = [
        {"id": "t-live", "status": "live"},
        {"id": "t-done", "status": "finished"},
        {"id": "t-league", "status": "live", "league_context": {"league_id": "l1"}},
    ]
    db = _Db([{"id": "lead", "quiet_hours": NIGHT, "notification_preferences": {}}], tournaments)
    _at(monkeypatch, db, "2026-11-16T23:00:00")
    for tournament_id in ("t-live", "t-done", "t-league"):
        await create_user_notification("lead", "Ergebnis fehlt", kind="match_attention",
                                       meta={"category": "tournament_updates", "tournament_id": tournament_id, "dedupe_key": tournament_id})
    held = {row["meta"]["tournament_id"]: "quiet_hold_until" in row for row in db.notifications.rows}
    assert held == {"t-live": False, "t-done": True, "t-league": True}
    assert wires.count(("push", "match_attention", "lead")) == 1


@pytest.mark.anyio
async def test_other_match_notices_are_held(monkeypatch, wires):
    db = _Db([{"id": "u1", "quiet_hours": NIGHT, "notification_preferences": {}}])
    _at(monkeypatch, db, "2026-11-16T23:00:00")
    await create_user_notification("u1", "Termin vorgeschlagen", kind="match_schedule",
                                   meta={"category": "match_reminders", "reason": "proposal", "dedupe_key": "s"})
    await create_user_notification("u1", "Spiel in 10 Minuten", kind="match_reminder", meta={"dedupe_key": "r"})
    assert wires == []


# ---------------------------------------------------------------- Sammelmeldung

async def _night(monkeypatch, db, count=4):
    _at(monkeypatch, db, "2026-11-16T23:00:00")
    for number in range(count):
        await create_user_notification("u1", f"Meldung {number}", kind="tournament_registration",
                                       meta={"category": "tournament_updates", "dedupe_key": f"n{number}", "tournament_id": f"t{number}"})


@pytest.mark.anyio
async def test_exactly_one_digest_after_the_night(monkeypatch, wires):
    db = _Db([{"id": "u1", "quiet_hours": NIGHT, "notification_preferences": {}}])
    await _night(monkeypatch, db)
    assert wires == []
    # Noch Ruhezeit: nichts geht.
    early = await quiet_hours.release_due(db, _utc("2026-11-17T05:59:00"))
    assert early == {"released": 0, "digests": 0} and wires == []
    done = await quiet_hours.release_due(db, _utc("2026-11-17T06:00:00"))
    assert done == {"released": 4, "digests": 1}
    digest = [row for row in db.notifications.rows if row["kind"] == "quiet_digest"]
    assert len(digest) == 1
    assert digest[0]["title"] == "In der Nacht: 4 Meldungen"
    assert digest[0]["body"] == "Turnier-Updates 4 – alles liegt in der Glocke."
    assert digest[0]["in_app_visible"] is False, "die Meldungen liegen schon in der Glocke"
    assert sorted(channel for channel, _kind, _user in wires) == ["browser", "push"]
    assert all("quiet_hold_until" not in row for row in db.notifications.rows)
    # Ein zweiter Lauf findet nichts mehr.
    again = await quiet_hours.release_due(db, _utc("2026-11-17T06:05:00"))
    assert again == {"released": 0, "digests": 0} and len(wires) == 2


@pytest.mark.anyio
async def test_two_runs_at_once_send_one_digest(monkeypatch, wires):
    """Stürzt ein Lauf nach der Sammelmeldung ab, legt der nächste keine zweite an - der Schlüssel ist eindeutig."""
    db = _Db([{"id": "u1", "quiet_hours": NIGHT, "notification_preferences": {}}])
    await _night(monkeypatch, db, count=2)
    user = await db.users.find_one({"id": "u1"})
    rows = [row for row in db.notifications.rows if row.get("quiet_hold_until")]
    assert await quiet_hours._send_digest(db, user, rows[0]["quiet_hold_until"], rows, {"push"}) is True
    done = await quiet_hours.release_due(db, _utc("2026-11-17T06:00:00"))
    assert done == {"released": 2, "digests": 0}
    assert len([row for row in db.notifications.rows if row["kind"] == "quiet_digest"]) == 1
    assert [channel for channel, _kind, _user in wires] == ["push"]


@pytest.mark.anyio
async def test_no_digest_when_everything_was_read_already(monkeypatch, wires):
    db = _Db([{"id": "u1", "quiet_hours": NIGHT, "notification_preferences": {}}])
    await _night(monkeypatch, db, count=2)
    for row in db.notifications.rows:
        row["read"] = True
    done = await quiet_hours.release_due(db, _utc("2026-11-17T06:30:00"))
    assert done == {"released": 2, "digests": 0} and wires == []


@pytest.mark.anyio
async def test_digest_only_over_the_held_ways_and_singular(monkeypatch, wires):
    db = _Db([{"id": "u1", "quiet_hours": {"enabled": True, "start": "13:00", "end": "15:00"},
               "notification_preferences": {"browser": False, "discord": True}}])
    _at(monkeypatch, db, "2026-11-16T12:30:00")
    await create_user_notification("u1", "Gewinn bereit", kind="prize_status", meta={"category": "prize_updates", "dedupe_key": "p"})
    assert db.notifications.rows[0]["quiet_held_channels"] == ["push", "discord"]
    await quiet_hours.release_due(db, _utc("2026-11-16T14:00:00"))
    digest = next(row for row in db.notifications.rows if row["kind"] == "quiet_digest")
    assert digest["title"] == "In deiner Ruhezeit: 1 Meldung"
    assert sorted(channel for channel, _kind, _user in wires) == ["discord", "push"]


@pytest.mark.anyio
async def test_held_messages_wait_while_the_person_is_quiet_again(monkeypatch, wires):
    """Ruhezeit nachträglich verlängert: die Meldungen warten bis zum neuen Ende statt mitten in der Ruhe zu kommen."""
    db = _Db([{"id": "u1", "quiet_hours": NIGHT, "notification_preferences": {}}])
    await _night(monkeypatch, db, count=1)
    db.users.rows[0]["quiet_hours"] = {"enabled": True, "start": "22:00", "end": "09:00"}
    assert await quiet_hours.release_due(db, _utc("2026-11-17T06:30:00")) == {"released": 0, "digests": 0}
    assert await quiet_hours.release_due(db, _utc("2026-11-17T08:00:00")) == {"released": 1, "digests": 1}
