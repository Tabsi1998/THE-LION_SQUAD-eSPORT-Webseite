"""Zeitgesteuerte Statuswechsel überschreiben keine manuelle Pause und keine parallele Änderung (#1041)."""
import asyncio
import copy
from datetime import datetime, timedelta, timezone
import pathlib
import sys

from pymongo.errors import DuplicateKeyError

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import scheduler
from services.mutation_lock import tournament_write_resource


def _matches(doc: dict, query: dict) -> bool:
    for key, expected in query.items():
        actual = doc.get(key)
        if isinstance(expected, dict) and "$in" in expected:
            if actual not in expected["$in"]:
                return False
        elif actual != expected:
            return False
    return True


class _Result:
    def __init__(self, matched: int):
        self.matched_count = matched
        self.modified_count = matched


class _Cursor:
    def __init__(self, docs):
        self._docs = docs

    def __aiter__(self):
        self._iter = iter(self._docs)
        return self

    async def __anext__(self):
        try:
            return next(self._iter)
        except StopIteration:
            raise StopAsyncIteration


class _Collection:
    def __init__(self, docs=()):
        self.docs = [dict(doc) for doc in docs]
        self.after_find = None

    def find(self, query, _projection=None):
        snapshot = [copy.deepcopy(doc) for doc in self.docs if _matches(doc, query)]
        if self.after_find:
            # Ein anderer Schreiber ändert den Datensatz, nachdem der Scheduler ihn gelesen hat.
            self.after_find(self)
        return _Cursor(snapshot)

    async def find_one(self, query, _projection=None):
        for doc in self.docs:
            if _matches(doc, query):
                return copy.deepcopy(doc)
        return None

    async def update_one(self, query, update):
        for doc in self.docs:
            if _matches(doc, query):
                doc.update(update.get("$set", {}))
                return _Result(1)
        return _Result(0)

    def by_id(self, doc_id):
        return next(doc for doc in self.docs if doc["id"] == doc_id)


class _FakeLocks:
    """Sperren je Ressource, wie der eindeutige Index in MongoDB."""

    def __init__(self):
        self.documents = {}
        self._atomic = asyncio.Lock()

    async def find_one_and_update(self, query, update, **_kwargs):
        async with self._atomic:
            current = self.documents.get(query["resource"])
            now = query["$or"][0]["expires_at"]["$lte"]
            owner = query["$or"][1]["owner"]
            if current and current["expires_at"] > now and current["owner"] != owner:
                raise DuplicateKeyError("resource already leased")
            self.documents[query["resource"]] = dict(update["$set"])
            return dict(update["$set"])

    async def update_one(self, query, update):
        async with self._atomic:
            current = self.documents.get(query["resource"])
            matched = bool(current and current["owner"] == query["owner"])
            if matched:
                current.update(update["$set"])
            return _Result(int(matched))

    async def delete_one(self, query):
        async with self._atomic:
            current = self.documents.get(query["resource"])
            if current and current["owner"] == query["owner"]:
                del self.documents[query["resource"]]
                return type("Deleted", (), {"deleted_count": 1})()
            return type("Deleted", (), {"deleted_count": 0})()


class _FakeDb:
    def __init__(self, tournaments=(), events=(), f1=()):
        self.tournaments = _Collection(tournaments)
        self.events = _Collection(events)
        self.f1_challenges = _Collection(f1)
        self.mutation_locks = _FakeLocks()

    def __getitem__(self, name):
        return getattr(self, name)


def _past(minutes=5):
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()


def _future(hours=2):
    return (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()


def _due_tournament(**extra):
    return {"id": "t1", "status": "check_in", "start_date": _past(), "auto_start_enabled": True, **extra}


def _due_event(**extra):
    return {"id": "e1", "status": "scheduled", "start_date": _past(), **extra}


def _setup(monkeypatch, db, prepare=None):
    monkeypatch.setitem(sys.modules, "database", type("M", (), {"get_db": staticmethod(lambda: db)}))
    calls = {"prepare": [], "discord": []}

    async def default_prepare(_db, doc, nxt):
        return True

    async def recording_prepare(_db, doc, nxt):
        calls["prepare"].append((doc["id"], doc.get("status"), nxt))
        return await (prepare or default_prepare)(_db, doc, nxt)

    async def recording_discord(_db, doc, status):
        calls["discord"].append((doc["id"], status))

    monkeypatch.setattr(scheduler, "_prepare_tournament_transition", recording_prepare)
    monkeypatch.setattr(scheduler, "_discord_status_changed", recording_discord)
    return calls


def test_regular_transitions_still_happen(monkeypatch):
    db = _FakeDb(tournaments=[_due_tournament()], events=[_due_event()])
    calls = _setup(monkeypatch, db)

    asyncio.run(scheduler._safe_status_transitions())

    assert db.tournaments.by_id("t1")["status"] == "live"
    assert db.events.by_id("e1")["status"] == "live"
    assert calls["discord"] == [("t1", "live")]
    assert db.mutation_locks.documents == {}, "alle Sperren sind wieder frei"


def test_manual_pause_after_the_read_keeps_the_tournament_paused(monkeypatch):
    db = _FakeDb(tournaments=[_due_tournament()])
    db.tournaments.after_find = lambda col: col.by_id("t1").update(status="paused")
    calls = _setup(monkeypatch, db)

    asyncio.run(scheduler._safe_status_transitions())

    assert db.tournaments.by_id("t1")["status"] == "paused"
    assert calls["prepare"] == [], "ein pausiertes Turnier bekommt keinen Turnierbaum fertiggestellt"
    assert calls["discord"] == []


def test_pause_during_preparation_wins(monkeypatch):
    db = _FakeDb(tournaments=[_due_tournament()])

    async def pause_meanwhile(_db, doc, nxt):
        db.tournaments.by_id("t1")["status"] = "paused"
        return True

    calls = _setup(monkeypatch, db, prepare=pause_meanwhile)

    asyncio.run(scheduler._safe_status_transitions())

    assert db.tournaments.by_id("t1")["status"] == "paused"
    assert calls["discord"] == [], "kein Discord-Hinweis für einen Wechsel, der nicht stattfand"


def test_tournament_transition_runs_under_the_tournament_write_lock(monkeypatch):
    db = _FakeDb(tournaments=[_due_tournament()])
    seen = []

    async def check_lock(_db, doc, nxt):
        seen.append(tournament_write_resource("t1") in db.mutation_locks.documents)
        return True

    _setup(monkeypatch, db, prepare=check_lock)

    asyncio.run(scheduler._safe_status_transitions())

    assert seen == [True]
    assert db.tournaments.by_id("t1")["status"] == "live"


def test_busy_tournament_is_left_for_the_next_tick(monkeypatch):
    db = _FakeDb(tournaments=[_due_tournament()])
    db.mutation_locks.documents[tournament_write_resource("t1")] = {
        "resource": tournament_write_resource("t1"),
        "owner": "admin-aktion",
        "expires_at": datetime.now(timezone.utc) + timedelta(minutes=1),
    }
    monkeypatch.setattr(scheduler, "STATUS_LOCK_WAIT_SECONDS", 0.0, raising=False)
    calls = _setup(monkeypatch, db)

    asyncio.run(scheduler._safe_status_transitions())

    assert db.tournaments.by_id("t1")["status"] == "check_in"
    assert calls["prepare"] == []
    assert db.mutation_locks.documents[tournament_write_resource("t1")]["owner"] == "admin-aktion"


def test_parallel_status_change_of_an_event_is_not_overwritten(monkeypatch):
    db = _FakeDb(events=[_due_event()])
    db.events.after_find = lambda col: col.by_id("e1").update(status="cancelled")
    _setup(monkeypatch, db)

    asyncio.run(scheduler._safe_status_transitions())

    assert db.events.by_id("e1")["status"] == "cancelled"


def test_postponed_start_is_not_overwritten(monkeypatch):
    db = _FakeDb(events=[_due_event()])
    new_start = _future()
    db.events.after_find = lambda col: col.by_id("e1").update(start_date=new_start)
    _setup(monkeypatch, db)

    asyncio.run(scheduler._safe_status_transitions())

    assert db.events.by_id("e1")["status"] == "scheduled", "der Wechsel beruhte auf dem alten Startzeitpunkt"


def test_parallel_pause_of_an_f1_challenge_is_not_overwritten(monkeypatch):
    f1 = {"id": "f1", "status": "scheduled", "start_date": _past()}
    db = _FakeDb(f1=[f1])
    db.f1_challenges.after_find = lambda col: col.by_id("f1").update(status="paused")
    _setup(monkeypatch, db)

    asyncio.run(scheduler._safe_status_transitions())

    assert db.f1_challenges.by_id("f1")["status"] == "paused"
