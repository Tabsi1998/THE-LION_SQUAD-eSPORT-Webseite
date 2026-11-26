"""Ruhezeit (#1206, Fabians Wahl A): von–bis in Wiener Zeit, Standard aus. In der Ruhezeit kein Push, keine Browser-Meldung
und keine Discord-Direktnachricht - alles liegt in der Glocke; danach genau eine Sammelmeldung. Ausnahmen: Aufruf zum eigenen
Spiel, „Match startet jetzt“, Liga-Check-in und Veto am Zug, „Braucht Aufmerksamkeit“ während des eigenen Turniers."""
import asyncio
import pathlib
import sys
import types
from datetime import datetime, timezone

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

pytest.importorskip("email_validator")

from pymongo.errors import DuplicateKeyError

from services import quiet_hours, quiet_hours_rules
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
        if key == "$or":
            if not any(_matches(row, part) for part in expected):
                return False
            continue
        actual = _value(row, key)
        if isinstance(expected, dict):
            if "$gte" in expected and not (actual is not None and actual >= expected["$gte"]):
                return False
            if "$lte" in expected and not (actual is not None and actual <= expected["$lte"]):
                return False
            if "$lt" in expected and not (actual is not None and actual < expected["$lt"]):
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
        keys = key if isinstance(key, list) else [(key, direction)]
        for field, way in reversed(keys):
            self.rows.sort(key=lambda row, field=field: row.get(field) or "", reverse=way < 0)
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

    async def distinct(self, key, query=None):
        return sorted({row.get(key) for row in self.rows if _matches(row, query or {})})

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

    async def delete_one(self, query):
        for index, row in enumerate(self.rows):
            if _matches(row, query):
                del self.rows[index]
                return _Result(1)
        return _Result(0)


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
    dm.EXCLUDED_KINDS = {"moderation", "invoice_ready"}
    events = types.ModuleType("services.change_events")

    async def _publish(*_args, **_kwargs):
        return None

    events.publish_user_change = _publish
    for name, module in (("services.push_notifications", push), ("services.web_push", web),
                         ("services.discord_dm", dm), ("services.change_events", events)):
        monkeypatch.setitem(sys.modules, name, module)
    return sent


def _rd(result):
    """Freigegeben und Sammelmeldungen eines Laufs."""
    return result["released"], result["digests"]


def _at(monkeypatch, db, when):
    monkeypatch.setattr("services.user_notifications.get_db", lambda: db)
    monkeypatch.setattr("services.quiet_hours.now_utc", lambda: _utc(when))
    # Auch ``created_at`` der Meldungen nach dieser Uhr - die Windows-Uhr ist zu grob, um zwei Nächte sicher zu trennen.
    monkeypatch.setattr("services.user_notifications.now_utc", lambda: _utc(when))


# ---------------------------------------------------------------- Zeitfenster

def test_off_by_default_and_suggested_from_22_to_7():
    assert quiet_hours.quiet_until({}, _utc("2026-11-16T02:00:00")) is None
    assert quiet_hours_rules.settings_payload({}) == {"enabled": False, "start": "22:00", "end": "07:00"}
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
    assert not quiet_hours_rules.crosses_midnight(user) and quiet_hours_rules.crosses_midnight({"quiet_hours": NIGHT})


def test_times_are_checked_without_regex():
    assert quiet_hours_rules.parse_time("07:05") == 425
    for bad in ("7:00", "24:00", "12:60", "aa:bb", "", None, "12:000", "12-00"):
        assert quiet_hours_rules.parse_time(bad) is None


def test_the_profile_model_accepts_only_clock_times():
    from pydantic import ValidationError

    from models import UserUpdate

    body = UserUpdate(quiet_hours={"enabled": True, "start": "22:00", "end": "07:00"})
    assert body.model_dump(exclude_unset=True)["quiet_hours"] == NIGHT
    # Ein Teil-PATCH bleibt ein Teil - die Route führt ihn mit dem gespeicherten Stand zusammen (Lücke prüft sie dort).
    assert UserUpdate(quiet_hours={"enabled": True}).model_dump(exclude_unset=True)["quiet_hours"] == {"enabled": True}
    for bad in ({"enabled": True, "start": "25:00"}, {"end": "7:00"}, {"start": "１２:00"}):
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
    assert _rd(early) == (0, 0) and wires == []
    done = await quiet_hours.release_due(db, _utc("2026-11-17T06:00:00"))
    assert _rd(done) == (4, 1)
    digest = [row for row in db.notifications.rows if row["kind"] == "quiet_digest"]
    assert len(digest) == 1
    assert digest[0]["title"] == "In der Nacht: 4 Meldungen"
    assert digest[0]["body"] == "Turnier-Updates 4 – alles liegt in der Glocke."
    assert digest[0]["in_app_visible"] is False, "die Meldungen liegen schon in der Glocke"
    assert sorted(channel for channel, _kind, _user in wires) == ["browser", "push"]
    assert all("quiet_hold_until" not in row for row in db.notifications.rows)
    # Ein zweiter Lauf findet nichts mehr.
    again = await quiet_hours.release_due(db, _utc("2026-11-17T06:05:00"))
    assert _rd(again) == (0, 0) and len(wires) == 2


@pytest.mark.anyio
async def test_two_runs_at_once_send_one_digest(monkeypatch, wires):
    """Bricht ein Lauf nach der Sammelmeldung ab (vor der Freigabe), legt der nächste keine zweite an: Der Schlüssel steht vor
    dem Versand an den Zeilen, der eindeutige Index hält den zweiten Versuch auf."""
    db = _Db([{"id": "u1", "quiet_hours": NIGHT, "notification_preferences": {}}])
    await _night(monkeypatch, db, count=2)
    original = db.notifications.update_many

    async def broken(query, update):
        if "$unset" in update:
            raise RuntimeError("Lauf bricht ab")
        return await original(query, update)

    db.notifications.update_many = broken
    with pytest.raises(RuntimeError):
        await quiet_hours.release_due(db, _utc("2026-11-17T06:00:00"))
    db.notifications.update_many = original
    done = await quiet_hours.release_due(db, _utc("2026-11-17T06:01:00"))
    assert _rd(done) == (2, 0)
    assert len([row for row in db.notifications.rows if row["kind"] == "quiet_digest"]) == 1
    assert sorted(channel for channel, _kind, _user in wires) == ["browser", "push"]


@pytest.mark.anyio
async def test_no_digest_when_everything_was_read_already(monkeypatch, wires):
    db = _Db([{"id": "u1", "quiet_hours": NIGHT, "notification_preferences": {}}])
    await _night(monkeypatch, db, count=2)
    for row in db.notifications.rows:
        row["read"] = True
    done = await quiet_hours.release_due(db, _utc("2026-11-17T06:30:00"))
    assert _rd(done) == (2, 0) and wires == []


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
    assert _rd(await quiet_hours.release_due(db, _utc("2026-11-17T06:30:00"))) == (0, 0)
    assert _rd(await quiet_hours.release_due(db, _utc("2026-11-17T08:00:00"))) == (1, 1)


@pytest.mark.anyio
async def test_extended_window_sends_one_digest_not_two(monkeypatch, wires):
    """Meldung um 23:00 (Ende 7:00), um 1:00 auf 8:00 verlängert, noch eine Meldung: um 8:00 genau eine Sammelmeldung."""
    db = _Db([{"id": "u1", "quiet_hours": NIGHT, "notification_preferences": {}}])
    await _night(monkeypatch, db, count=1)
    db.users.rows[0]["quiet_hours"] = {"enabled": True, "start": "22:00", "end": "08:00"}
    _at(monkeypatch, db, "2026-11-17T00:00:00")
    await create_user_notification("u1", "Später", kind="tournament_registration",
                                   meta={"category": "tournament_updates", "dedupe_key": "spaet", "tournament_id": "tx"})
    assert {row["quiet_hold_until"] for row in db.notifications.rows} == {"2026-11-17T06:00:00+00:00", "2026-11-17T07:00:00+00:00"}
    # 7:00 Wien: noch still - die alte Zeile bekommt das neue Ende, nichts geht.
    early = await quiet_hours.release_due(db, _utc("2026-11-17T06:00:00"))
    assert _rd(early) == (0, 0) and early["restamped"] == 1 and wires == []
    done = await quiet_hours.release_due(db, _utc("2026-11-17T07:00:00"))
    assert _rd(done) == (2, 1)
    digest = [row for row in db.notifications.rows if row["kind"] == "quiet_digest"]
    assert len(digest) == 1 and digest[0]["title"] == "In der Nacht: 2 Meldungen"
    assert len(wires) == 2  # Push und Browser, je einmal


@pytest.mark.anyio
async def test_job_down_over_two_nights_sends_one_digest(monkeypatch, wires):
    db = _Db([{"id": "u1", "quiet_hours": NIGHT, "notification_preferences": {}}])
    await _night(monkeypatch, db, count=1)
    _at(monkeypatch, db, "2026-11-17T23:00:00")
    await create_user_notification("u1", "Zweite Nacht", kind="tournament_registration",
                                   meta={"category": "tournament_updates", "dedupe_key": "n2", "tournament_id": "t9"})
    # Der Job läuft erst in der zweiten Nacht wieder: alles wartet auf das zweite Ende.
    first = await quiet_hours.release_due(db, _utc("2026-11-18T02:00:00"))
    assert _rd(first) == (0, 0) and wires == []
    done = await quiet_hours.release_due(db, _utc("2026-11-18T06:00:00"))
    assert _rd(done) == (2, 1)
    assert len([row for row in db.notifications.rows if row["kind"] == "quiet_digest"]) == 1


@pytest.mark.anyio
@pytest.mark.parametrize("change", [{"enabled": False, "start": "22:00", "end": "07:00"}, {"enabled": True, "start": "22:00", "end": "00:30"}])
async def test_switched_off_or_shortened_releases_at_the_next_run(monkeypatch, wires, change):
    db = _Db([{"id": "u1", "quiet_hours": NIGHT, "notification_preferences": {}}])
    await _night(monkeypatch, db, count=2)
    db.users.rows[0]["quiet_hours"] = change
    done = await quiet_hours.release_due(db, _utc("2026-11-17T00:00:00"))
    assert _rd(done) == (2, 1)
    assert sorted(channel for channel, _kind, _user in wires) == ["browser", "push"]


@pytest.mark.anyio
async def test_discord_is_only_held_for_kinds_that_go_by_direct_message(monkeypatch, wires):
    db = _Db([{"id": "u1", "quiet_hours": NIGHT, "notification_preferences": {"discord": True}}])
    _at(monkeypatch, db, "2026-11-16T23:00:00")
    await create_user_notification("u1", "Rechnung", kind="invoice_ready", meta={"category": "billing_updates", "dedupe_key": "inv"})
    await create_user_notification("u1", "Nachricht", kind="direct_message", meta={"dedupe_key": "dm"})
    held = {row["kind"]: row["quiet_held_channels"] for row in db.notifications.rows}
    assert held == {"invoice_ready": ["push", "browser"], "direct_message": ["push", "browser", "discord"]}


@pytest.mark.anyio
async def test_the_push_test_of_the_admin_comes_through(monkeypatch, wires):
    db = _Db([{"id": "u1", "quiet_hours": NIGHT, "notification_preferences": {}}])
    _at(monkeypatch, db, "2026-11-16T23:00:00")
    await create_user_notification("u1", "Test: Push", kind="admin_push_test", meta={"dedupe_key": "t"})
    assert ("push", "admin_push_test", "u1") in wires
    assert "quiet_hold_until" not in db.notifications.rows[0]


def test_second_pass_of_the_fall_back_night_ends_in_the_future():
    """25.10.2026: 02:00–02:59 gibt es zweimal. Fenster 00:00–02:30, im zweiten Durchlauf um 02:15 MEZ (01:15 UTC)."""
    user = {"quiet_hours": {"enabled": True, "start": "00:00", "end": "02:30"}}
    first = quiet_hours_rules.quiet_until(user, _utc("2026-10-25T00:15:00"))   # 02:15 MESZ
    assert first == _utc("2026-10-25T00:30:00")
    second = quiet_hours_rules.quiet_until(user, _utc("2026-10-25T01:15:00"))  # 02:15 MEZ
    assert second == _utc("2026-10-25T01:30:00") and second > _utc("2026-10-25T01:15:00")


class _ForgetfulClock(datetime):
    """Wie ``FakeDatetime`` aus freezegun (Zeitreise-Probe, #2474): Umwandeln in eine Zeitzone baut ein neues Objekt
    aus Datum und Uhrzeit - ``fold`` geht dabei verloren."""

    def astimezone(self, tz=None):
        moment = datetime.astimezone(self, tz)
        return _ForgetfulClock(moment.year, moment.month, moment.day, moment.hour, moment.minute, moment.second,
                               moment.microsecond, tzinfo=moment.tzinfo)


def test_the_second_pass_does_not_depend_on_fold_surviving_the_conversion():
    """#2474: 02:15 MEZ ist 01:15 UTC. Geht ``fold`` beim Umrechnen verloren, darf daraus nicht 02:15 MESZ werden - das
    Ende läge sonst eine Stunde zu früh, schon vor dem Jetzt, und die Ruhezeit wäre vorbei."""
    user = {"quiet_hours": {"enabled": True, "start": "00:00", "end": "02:30"}}
    now = _ForgetfulClock(2026, 10, 25, 1, 15, tzinfo=timezone.utc)  # 02:15 MEZ, zweiter Durchlauf
    until = quiet_hours_rules.quiet_until(user, now)
    assert until == _utc("2026-10-25T01:30:00")
    assert until > now


def test_an_end_in_the_spring_gap_ends_with_the_gap():
    """#2514: 29.03.2026 springt die Uhr um 02:00 MEZ auf 03:00 MESZ. Fenster 00:00–02:30: 02:30 gibt es nicht - die Ruhezeit
    endet mit der Lücke um 03:00 MESZ (01:00 UTC), nicht erst um 03:30 MESZ."""
    user = {"quiet_hours": {"enabled": True, "start": "00:00", "end": "02:30"}}
    assert quiet_hours_rules.quiet_until(user, _utc("2026-03-28T23:00:00")) == _utc("2026-03-29T01:00:00")  # 00:00 MEZ
    assert quiet_hours_rules.quiet_until(user, _utc("2026-03-29T00:59:00")) == _utc("2026-03-29T01:00:00")  # 01:59 MEZ
    assert quiet_hours_rules.quiet_until(user, _utc("2026-03-29T01:00:00")) is None                         # 03:00 MESZ
    # Dasselbe in der Märznacht 2027 (28.03.).
    assert quiet_hours_rules.quiet_until(user, _utc("2027-03-27T23:30:00")) == _utc("2027-03-28T01:00:00")


def test_a_start_at_half_past_two_in_the_fall_back_night_begins_in_the_first_pass():
    """#2514: 25.10.2026 läuft 02:00–02:59 zweimal. Fenster 02:30–04:00: Die Ruhezeit beginnt im ersten Durchlauf um 02:30 MESZ.
    Springt die Uhr um 03:00 MESZ auf 02:00 MEZ zurück, liegt sie vor dem Beginn - die Ruhezeit läuft nicht durch die zweiten
    02:00–02:29 bis 04:00 MEZ weiter, sondern endet mit dem Sprung (01:00 UTC)."""
    user = {"quiet_hours": {"enabled": True, "start": "02:30", "end": "04:00"}}
    assert quiet_hours_rules.quiet_until(user, _utc("2026-10-25T00:29:00")) is None                         # 02:29 MESZ
    assert quiet_hours_rules.quiet_until(user, _utc("2026-10-25T00:30:00")) == _utc("2026-10-25T01:00:00")  # 02:30 MESZ
    assert quiet_hours_rules.quiet_until(user, _utc("2026-10-25T00:59:00")) == _utc("2026-10-25T01:00:00")  # 02:59 MESZ
    assert quiet_hours_rules.quiet_until(user, _utc("2026-10-25T01:15:00")) is None                         # 02:15 MEZ
    # Ab 02:30 MEZ zeigt die Wanduhr wieder das Fenster - bis zur eingestellten Endzeit 04:00 MEZ (03:00 UTC).
    assert quiet_hours_rules.quiet_until(user, _utc("2026-10-25T01:30:00")) == _utc("2026-10-25T03:00:00")
    # Ohne ``fold`` (Zeitreise-Probe) gilt dasselbe.
    assert quiet_hours_rules.quiet_until(user, _ForgetfulClock(2026, 10, 25, 0, 45, tzinfo=timezone.utc)) == _utc("2026-10-25T01:00:00")
    # Dasselbe in der Oktobernacht 2027 (31.10.).
    assert quiet_hours_rules.quiet_until(user, _utc("2027-10-31T00:30:00")) == _utc("2027-10-31T01:00:00")


def test_the_clock_change_is_found_without_fold_inside_the_module(monkeypatch):
    """#2514: freezegun ersetzt auch das ``datetime`` im Modul. Die Suche nach der Umstellung darf dann nicht an
    ``utcoffset()`` hängen - in der doppelten Stunde gäbe es ohne ``fold`` die Sommerzeit, und die Umstellung käme eine
    Stunde zu spät (02:30–04:00 liefe wieder bis 04:00 MEZ)."""
    monkeypatch.setattr(quiet_hours_rules, "datetime", _ForgetfulClock)
    fall = {"quiet_hours": {"enabled": True, "start": "02:30", "end": "04:00"}}
    assert quiet_hours_rules.quiet_until(fall, _utc("2026-10-25T00:30:00")) == _utc("2026-10-25T01:00:00")
    spring = {"quiet_hours": {"enabled": True, "start": "00:00", "end": "02:30"}}
    assert quiet_hours_rules.quiet_until(spring, _utc("2026-03-28T23:00:00")) == _utc("2026-03-29T01:00:00")


@pytest.mark.parametrize("start, end", [("22:00", "07:00"), ("00:00", "02:30"), ("02:30", "04:00"), ("23:00", "02:15"),
                                        ("02:15", "02:45"), ("01:30", "02:00"), ("02:59", "02:00"), ("21:00", "03:00"),
                                        ("03:00", "02:30"), ("02:30", "02:15"), ("02:45", "02:30")])
@pytest.mark.parametrize("night", ["2026-03-28T20:00:00", "2026-10-24T20:00:00", "2027-03-27T20:00:00", "2027-10-30T20:00:00",
                                   "2028-03-25T20:00:00", "2028-10-28T20:00:00", "2029-03-24T20:00:00", "2029-10-27T20:00:00"])
def test_every_minute_of_the_clock_change_nights_ends_when_the_wall_clock_leaves_the_window(start, end, night):
    """#2514, Minute für Minute: Still genau dann, wenn die Wiener Wanduhr im Fenster steht. Ende = erster Moment, in dem die
    Wanduhr das Fenster verlässt - auch wenn sie dabei springt. Alle stillen Minuten davor nennen dasselbe Ende."""
    from datetime import timedelta

    user = {"quiet_hours": {"enabled": True, "start": start, "end": end}}
    first, last = quiet_hours_rules.parse_time(start), quiet_hours_rules.parse_time(end)

    def inside(moment):
        local = moment.astimezone(quiet_hours_rules.VIENNA)
        minute = local.hour * 60 + local.minute
        return first <= minute < last if first < last else (minute >= first or minute < last)

    now, previous = _utc(night), None
    for _minute in range(12 * 60):
        until = quiet_hours_rules.quiet_until(user, now)
        assert (until is not None) == inside(now), now
        # Bis zum genannten Ende bleibt es still - mit demselben Ende.
        if previous is not None and now < previous:
            assert until == previous, (now, until, previous)
        if until is not None:
            assert until > now and inside(until - timedelta(minutes=1)), (now, until)
            assert not inside(until), (now, until)
        previous = until
        now += timedelta(minutes=1)


def test_display_and_effect_use_the_same_fallback():
    """Nur ``enabled`` gespeichert (alter Teil-PATCH): Anzeige 22–7, und genau dann wird auch zurückgehalten."""
    user = {"quiet_hours": {"enabled": True}}
    assert quiet_hours_rules.settings_payload(user) == {"enabled": True, "start": "22:00", "end": "07:00"}
    assert quiet_hours_rules.window(user) == (22 * 60, 7 * 60)
    assert quiet_hours_rules.quiet_until(user, _utc("2026-11-16T23:00:00")) == _utc("2026-11-17T06:00:00")


def test_a_gap_of_at_least_15_minutes_and_ascii_digits_only():
    assert quiet_hours_rules.gap_problem("07:05", "07:00")
    assert quiet_hours_rules.gap_problem("07:00", "07:00")
    assert quiet_hours_rules.gap_problem("07:15", "07:00") is None
    assert quiet_hours_rules.window({"quiet_hours": {"enabled": True, "start": "07:05", "end": "07:00"}}) is None
    assert quiet_hours_rules.parse_time("\u0661\u0662:00") is None  # arabisch-indische Ziffern
    assert quiet_hours_rules.parse_time("１２:00") is None  # breite Ziffern


class _Yielding(_Collection):
    """Gibt bei jedem Zugriff die Kontrolle ab - wie echte Netzwerk-Aufrufe (Nachprüfung, race_check)."""

    async def find_one(self, *args, **kwargs):
        await asyncio.sleep(0)
        return await super().find_one(*args, **kwargs)

    async def update_one(self, *args, **kwargs):
        await asyncio.sleep(0)
        return await super().update_one(*args, **kwargs)

    async def update_many(self, *args, **kwargs):
        await asyncio.sleep(0)
        return await super().update_many(*args, **kwargs)

    async def insert_one(self, *args, **kwargs):
        await asyncio.sleep(0)
        return await super().insert_one(*args, **kwargs)


def _digests(db):
    return [row for row in db.notifications.rows if row["kind"] == "quiet_digest"]


@pytest.mark.anyio
async def test_two_runs_at_the_same_time_send_one_digest(monkeypatch, wires):
    """F1: Zwei Läufe gleichzeitig rechnen denselben Schlüssel - eine Sammelmeldung, ein Push, ein Browser-Push."""
    db = _Db([{"id": "u1", "quiet_hours": NIGHT, "notification_preferences": {}}])
    await _night(monkeypatch, db, count=3)
    rows = db.notifications.rows
    db.notifications = _Yielding(unique=("user_id", "unique_dedupe_key"))
    db.notifications.rows = rows
    db.users.__class__ = _Yielding
    now = _utc("2026-11-17T06:01:00")
    first, second = await asyncio.gather(quiet_hours.release_due(db, now), quiet_hours.release_due(db, now))
    assert first["digests"] + second["digests"] == 1
    assert len(_digests(db)) == 1 and _digests(db)[0]["quiet_delivered"] is True
    assert sorted(channel for channel, _kind, _user in wires) == ["browser", "push"]
    assert all("quiet_hold_until" not in row for row in db.notifications.rows)


@pytest.mark.anyio
async def test_created_but_never_sent_then_quiet_again_comes_next_morning(monkeypatch, wires):
    """F2: Sammelmeldung angelegt, Lauf bricht vor dem Versand ab, die Person ist wieder still - die angelegte wird
    verworfen, am nächsten Morgen kommt eine für beide Nächte."""
    db = _Db([{"id": "u1", "quiet_hours": NIGHT, "notification_preferences": {}}])
    await _night(monkeypatch, db, count=2)

    async def broken(*_args, **_kwargs):
        raise RuntimeError("Lauf bricht ab")

    original = quiet_hours._deliver
    monkeypatch.setattr(quiet_hours, "_deliver", broken)
    with pytest.raises(RuntimeError):
        await quiet_hours.release_due(db, _utc("2026-11-17T06:01:00"))
    monkeypatch.setattr(quiet_hours, "_deliver", original)
    assert len(_digests(db)) == 1 and wires == []
    _at(monkeypatch, db, "2026-11-17T23:00:00")
    await create_user_notification("u1", "Zweite Nacht", kind="tournament_registration",
                                   meta={"category": "tournament_updates", "dedupe_key": "n2", "tournament_id": "t9"})
    quiet = await quiet_hours.release_due(db, _utc("2026-11-17T23:30:00"))
    assert quiet["restamped"] == 2 and _digests(db) == []
    done = await quiet_hours.release_due(db, _utc("2026-11-18T06:00:00"))
    assert _rd(done) == (3, 1)
    assert [row["title"] for row in _digests(db)] == ["In der Nacht: 3 Meldungen"]
    assert sorted(channel for channel, _kind, _user in wires) == ["browser", "push"]


@pytest.mark.anyio
async def test_sent_but_not_released_then_quiet_again_keeps_the_second_night(monkeypatch, wires):
    """F2: Sammelmeldung verschickt, Lauf bricht vor der Freigabe ab, die Person ist wieder still - die gemeldeten Zeilen
    werden freigegeben, die zweite Nacht bekommt ihre eigene Sammelmeldung (nicht verschluckt, nichts doppelt)."""
    db = _Db([{"id": "u1", "quiet_hours": NIGHT, "notification_preferences": {}}])
    await _night(monkeypatch, db, count=2)
    original = db.notifications.update_many

    async def broken(query, update):
        if "$unset" in update:
            raise RuntimeError("Lauf bricht ab")
        return await original(query, update)

    db.notifications.update_many = broken
    with pytest.raises(RuntimeError):
        await quiet_hours.release_due(db, _utc("2026-11-17T06:01:00"))
    db.notifications.update_many = original
    assert len(wires) == 2  # die erste Sammelmeldung ging hinaus
    _at(monkeypatch, db, "2026-11-17T23:00:00")
    await create_user_notification("u1", "Zweite Nacht", kind="tournament_registration",
                                   meta={"category": "tournament_updates", "dedupe_key": "n2", "tournament_id": "t9"})
    quiet = await quiet_hours.release_due(db, _utc("2026-11-17T23:30:00"))
    assert quiet["released"] == 2 and quiet["restamped"] == 0  # die neue Zeile hat schon das jetzige Ende
    done = await quiet_hours.release_due(db, _utc("2026-11-18T06:00:00"))
    assert _rd(done) == (1, 1)
    assert [row["title"] for row in _digests(db)] == ["In der Nacht: 2 Meldungen", "In der Nacht: 1 Meldung"]
    assert len(wires) == 4


@pytest.mark.anyio
async def test_claimed_but_not_sent_is_sent_later(monkeypatch, wires):
    """F2: Ein Lauf beansprucht den Versand und bricht ab - erst nach Ablauf des Anspruchs holt ein anderer Lauf nach."""
    db = _Db([{"id": "u1", "quiet_hours": NIGHT, "notification_preferences": {}}])
    await _night(monkeypatch, db, count=2)

    def broken_push(*_args, **_kwargs):
        raise SystemExit("Prozess weg")

    sys.modules["services.push_notifications"].send_mobile_push_for_notification = broken_push
    with pytest.raises(SystemExit):
        await quiet_hours.release_due(db, _utc("2026-11-17T06:01:00"))
    del sys.modules["services.push_notifications"].send_mobile_push_for_notification
    push = types.ModuleType("services.push_notifications")

    async def _send(notification, *_args):
        wires.append(("push", notification["kind"], notification["user_id"]))
        return 1

    push.send_mobile_push_for_notification = _send
    monkeypatch.setitem(sys.modules, "services.push_notifications", push)
    soon = await quiet_hours.release_due(db, _utc("2026-11-17T06:05:00"))
    assert _rd(soon) == (0, 0) and wires == []
    later = await quiet_hours.release_due(db, _utc("2026-11-17T06:12:00"))
    assert _rd(later) == (2, 1)
    assert len(_digests(db)) == 1 and _digests(db)[0]["quiet_delivered"] is True
    assert sorted(channel for channel, _kind, _user in wires) == ["browser", "push"]


@pytest.mark.anyio
async def test_more_rows_than_one_batch_still_one_digest(monkeypatch, wires):
    """F3: Mehr zurückgehaltene Zeilen als eine Charge - eine Sammelmeldung mit allen, alle freigegeben."""
    monkeypatch.setattr(quiet_hours, "RELEASE_BATCH", 2)
    db = _Db([{"id": "u1", "quiet_hours": NIGHT, "notification_preferences": {}}])
    await _night(monkeypatch, db, count=5)
    done = await quiet_hours.release_due(db, _utc("2026-11-17T06:01:00"))
    assert _rd(done) == (5, 1)
    assert [row["title"] for row in _digests(db)] == ["In der Nacht: 5 Meldungen"]
    again = await quiet_hours.release_due(db, _utc("2026-11-17T06:10:00"))
    assert _rd(again) == (0, 0) and len(wires) == 2


@pytest.mark.anyio
async def test_a_run_that_finds_the_digest_keeps_its_bounds(monkeypatch, wires):
    """G1 (Nachprüfung, race_covers5): Lauf B liest eine neuere Zeile X mit, verliert aber beim Anlegen gegen Lauf A. B
    übernimmt die Abgrenzung von A - X bleibt zurückgehalten und bekommt später ihre eigene Sammelmeldung."""
    db = _Db([{"id": "u1", "quiet_hours": NIGHT, "notification_preferences": {}}])
    await _night(monkeypatch, db, count=3)
    rows = db.notifications.rows
    for index, row in enumerate(rows):
        row["created_at"] = f"2026-11-17T05:5{index}:00+00:00"
    db.notifications = _Yielding(unique=("user_id", "unique_dedupe_key"))
    db.notifications.rows = rows
    a_read, b_read, a_done = asyncio.Event(), asyncio.Event(), asyncio.Event()
    edge, create, release = quiet_hours._edge_row, quiet_hours._create_digest, quiet_hours._release

    def name():
        return asyncio.current_task().get_name()

    async def gated_edge(db_, user_id, direction):
        found = await edge(db_, user_id, direction)
        if direction == -1:
            (a_read if name() == "A" else b_read).set()
        return found

    async def gated_create(*args, **kwargs):
        await (b_read if name() == "A" else a_done).wait()
        return await create(*args, **kwargs)

    async def gated_release(*args, **kwargs):
        if name() == "A":
            await b_read.wait()
        return await release(*args, **kwargs)

    monkeypatch.setattr(quiet_hours, "_edge_row", gated_edge)
    monkeypatch.setattr(quiet_hours, "_create_digest", gated_create)
    monkeypatch.setattr(quiet_hours, "_release", gated_release)
    now = _utc("2026-11-17T06:01:00")

    async def run_a():
        try:
            return await quiet_hours.release_due(db, now)
        finally:
            a_done.set()

    async def run_b():
        await a_read.wait()
        db.notifications.rows.append({
            "id": "X", "user_id": "u1", "kind": "tournament_registration", "read": False, "in_app_visible": True,
            "meta": {"category": "tournament_updates"}, "created_at": "2026-11-17T05:59:30+00:00",
            "quiet_hold_until": "2026-11-17T06:00:00+00:00", "quiet_held_channels": ["push"]})
        return await quiet_hours.release_due(db, now)

    first, second = await asyncio.gather(asyncio.create_task(run_a(), name="A"), asyncio.create_task(run_b(), name="B"))
    assert first["digests"] + second["digests"] == 1
    held = [row["id"] for row in db.notifications.rows if row.get("quiet_hold_until")]
    assert held == ["X"], "X stand in keiner Sammelmeldung - sie darf nicht still freigegeben werden"
    monkeypatch.setattr(quiet_hours, "_edge_row", edge)
    monkeypatch.setattr(quiet_hours, "_create_digest", create)
    monkeypatch.setattr(quiet_hours, "_release", release)
    later = await quiet_hours.release_due(db, _utc("2026-11-17T06:06:00"))
    assert _rd(later) == (1, 1)
    assert [row["title"] for row in _digests(db)] == ["In der Nacht: 3 Meldungen", "In der Nacht: 1 Meldung"]


@pytest.mark.anyio
async def test_a_foreign_claim_keeps_delivered_unset(monkeypatch, wires):
    """G2: Übernimmt ein anderer Lauf den Anspruch, während dieser noch schickt, setzt dieser ``quiet_delivered`` nicht und
    gibt nichts frei - der andere schließt ab."""
    db = _Db([{"id": "u1", "quiet_hours": NIGHT, "notification_preferences": {}}])
    await _night(monkeypatch, db, count=2)
    push = types.ModuleType("services.push_notifications")

    async def slow_push(notification, *_args):
        for row in db.notifications.rows:
            if row["id"] == notification["id"]:
                row["quiet_claimed_at"] = "2026-11-17T06:20:00+00:00"  # ein anderer Lauf hat übernommen
        wires.append(("push", notification["kind"], notification["user_id"]))
        return 1

    push.send_mobile_push_for_notification = slow_push
    monkeypatch.setitem(sys.modules, "services.push_notifications", push)
    done = await quiet_hours.release_due(db, _utc("2026-11-17T06:01:00"))
    assert _rd(done) == (0, 0)
    assert _digests(db)[0]["quiet_delivered"] is False
    assert len([row for row in db.notifications.rows if row.get("quiet_hold_until")]) == 2


@pytest.mark.anyio
async def test_a_hanging_discord_does_not_hold_the_run(monkeypatch, wires):
    """G2: Discord antwortet nicht - nach ``DISCORD_TIMEOUT_SECONDS`` geht der Lauf weiter, die Sammelmeldung ist verschickt."""
    monkeypatch.setattr(quiet_hours, "DISCORD_TIMEOUT_SECONDS", 0.05)
    db = _Db([{"id": "u1", "quiet_hours": NIGHT, "notification_preferences": {"discord": True}}])
    _at(monkeypatch, db, "2026-11-16T23:00:00")
    await create_user_notification("u1", "Nachricht", kind="direct_message", meta={"dedupe_key": "dm"})
    dm = types.ModuleType("services.discord_dm")
    dm.EXCLUDED_KINDS = {"moderation", "invoice_ready"}

    async def hanging(*_args, **_kwargs):
        await asyncio.sleep(30)
        return 1

    dm.send_discord_dm_for_notification = hanging
    monkeypatch.setitem(sys.modules, "services.discord_dm", dm)
    done = await asyncio.wait_for(quiet_hours.release_due(db, _utc("2026-11-17T06:01:00")), 5)
    assert _rd(done) == (1, 1)
    assert _digests(db)[0]["quiet_delivered"] is True
    assert sorted(channel for channel, _kind, _user in wires) == ["browser", "push"]


# ---------------------------------------------------------------- Benachrichtigungs-Zentrum (#1662)

@pytest.mark.anyio
async def test_a_notice_marked_urgent_comes_through_the_quiet_hours(monkeypatch, wires):
    """Dringendes kommt trotzdem (#1662): auch eine Art ohne feste Ausnahme, wenn die Meldung selbst „dringend“ sagt."""
    db = _Db([{"id": "u1", "quiet_hours": NIGHT, "notification_preferences": {}}])
    _at(monkeypatch, db, "2026-11-16T23:00:00")
    await create_user_notification("u1", "Sofort an Station 2", kind="tournament_notice",
                                   meta={"dedupe_key": "n-1", "importance": "urgent"})
    assert ("push", "tournament_notice", "u1") in wires
    assert "quiet_hold_until" not in db.notifications.rows[0]


@pytest.mark.anyio
async def test_the_same_notice_without_urgency_waits(monkeypatch, wires):
    db = _Db([{"id": "u1", "quiet_hours": NIGHT, "notification_preferences": {}}])
    _at(monkeypatch, db, "2026-11-16T23:00:00")
    await create_user_notification("u1", "Pause bis 14:30", kind="tournament_notice", meta={"dedupe_key": "n-2"})
    assert wires == [] and db.notifications.rows[0]["quiet_hold_until"]


@pytest.mark.anyio
async def test_every_new_notification_carries_topic_and_importance(monkeypatch, wires):
    db = _Db([{"id": "u1", "notification_preferences": {}}])
    _at(monkeypatch, db, "2026-11-16T12:00:00")
    await create_user_notification("u1", "Du bist dran", kind="match_call", meta={"dedupe_key": "c-1"})
    await create_user_notification("u1", "Rechte geändert", kind="rights_change", meta={"dedupe_key": "r-1"})
    rows = {row["kind"]: row for row in db.notifications.rows}
    assert (rows["match_call"]["topic"], rows["match_call"]["importance"]) == ("match_reminders", "urgent")
    assert (rows["rights_change"]["topic"], rows["rights_change"]["importance"]) == ("account", "important")


# ---------------------------------------------------------------- Zeitkritisch (Fabian 26.11., E und F)

@pytest.mark.anyio
@pytest.mark.parametrize("starts_at,through", [
    ("2026-11-17T09:30:00+00:00", False),  # 10:30 in Wien: der Push wartet bis 7:00
    ("2026-11-17T07:30:00+00:00", True),   # 08:30 in Wien, vor 9 Uhr am selben Morgen: sofort
])
async def test_a_cancellation_waits_unless_it_concerns_the_early_morning(monkeypatch, wires, starts_at, through):
    db = _Db([{"id": "u1", "quiet_hours": NIGHT, "notification_preferences": {}}])
    _at(monkeypatch, db, "2026-11-16T23:00:00")
    await create_user_notification("u1", "Turnier abgesagt", kind="tournament_cancelled",
                                   meta={"dedupe_key": "c-1", "starts_at": starts_at})
    row = db.notifications.rows[0]
    assert (("push", "tournament_cancelled", "u1") in wires) is through
    assert ("quiet_hold_until" not in row) is through


@pytest.mark.anyio
async def test_a_new_date_or_moving_up_marked_timely_follows_the_same_rule(monkeypatch, wires):
    db = _Db([{"id": "u1", "quiet_hours": NIGHT, "notification_preferences": {}}])
    _at(monkeypatch, db, "2026-11-16T23:00:00")
    await create_user_notification("u1", "Nachgerückt", kind="event_registration",
                                   meta={"dedupe_key": "n-1", "timely": True, "starts_at": "2026-11-17T07:00:00+00:00"})
    await create_user_notification("u1", "Termin geändert", kind="event_message",
                                   meta={"dedupe_key": "n-2", "timely": True, "starts_at": "2026-11-18T07:00:00+00:00"})
    assert [kind for _channel, kind, _user in wires] == ["event_registration", "event_registration"]
    assert [bool(row.get("quiet_hold_until")) for row in db.notifications.rows] == [False, True]



# ---------------------------------------------------------------- Dritte Prüfrunde (26.11.): Untergrenze und „Ende + 2 Stunden“

@pytest.mark.anyio
@pytest.mark.parametrize("quiet,now,starts_at,through", [
    (NIGHT, "2026-11-16T22:30:00", "2026-11-15T17:00:00+00:00", False),   # gestern 18:00 - vorbei, kein Grund zu wecken
    (NIGHT, "2026-11-16T22:30:00", "2026-11-09T17:00:00+00:00", False),   # vor einer Woche
    ({"enabled": True, "start": "22:00", "end": "10:00"}, "2026-11-16T23:00:00", "2026-11-17T10:30:00+00:00", True),   # 11:30 < 12:00
    ({"enabled": True, "start": "22:00", "end": "10:00"}, "2026-11-16T23:00:00", "2026-11-17T11:30:00+00:00", False),  # 12:30
    ({"enabled": True, "start": "13:00", "end": "15:00"}, "2026-11-16T12:30:00", "2026-11-16T13:00:00+00:00", True),   # Mittagsruhe, Termin 14:00
])
async def test_timely_comes_through_only_for_appointments_until_two_hours_after_the_quiet_hours(monkeypatch, wires, quiet, now,
                                                                                                  starts_at, through):
    db = _Db([{"id": "u1", "quiet_hours": quiet, "notification_preferences": {}}])
    _at(monkeypatch, db, now)
    await create_user_notification("u1", "Turnier abgesagt", kind="tournament_cancelled", meta={"dedupe_key": "c-9", "starts_at": starts_at})
    assert (("push", "tournament_cancelled", "u1") in wires) is through
