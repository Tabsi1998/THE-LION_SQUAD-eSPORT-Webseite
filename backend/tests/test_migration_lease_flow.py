"""Migrationen beim Start (#1006): Readiness-Barriere und verlängerbare Sperre.

Zwei Starts gegen dieselbe Datenbank laufen hier als zwei Aufgaben im selben Prozess, jede mit eigenem Token. Die
Zeiten sind auf Bruchteile einer Sekunde verkürzt. Mit ``FLOW_MONGO_URL`` läuft dieselbe Datei gegen ein echtes MongoDB
(``scripts/flow_mongo_tests.py``)."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from time import monotonic
from types import SimpleNamespace

import pytest
import pytest_asyncio
from flow_harness import make_flow
from pymongo.errors import AutoReconnect

from services import migrations

LEASE = 1.2
RENEW = 0.3
REAL_RENEW_SECONDS = migrations.renew_seconds


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def fast(monkeypatch):
    monkeypatch.setattr(migrations, "lease_seconds", lambda: LEASE)
    monkeypatch.setattr(migrations, "renew_seconds", lambda: RENEW)
    monkeypatch.setattr(migrations, "wait_seconds", lambda: 10.0)
    monkeypatch.setattr(migrations, "WAIT_POLL_SECONDS", 0.02)
    monkeypatch.setattr(migrations, "_STATUS", {"state": "not_started"})


async def _clean(db):
    await db.schema_migration_lock.delete_many({})
    await db.schema_migrations.delete_many({})


async def _foreign_lock(db, seconds: float, owner: str = "anderer-start:1:x"):
    """Ein anderer Start hält die Sperre (oder hielt sie und ist gestorben - dann wird sie nie verlängert)."""
    until = datetime.now(timezone.utc) + timedelta(seconds=seconds)
    await db.schema_migration_lock.update_one(
        {"_id": "global"}, {"$set": {"owner": owner, "locked_until": until}}, upsert=True)


async def _ready(flow) -> bool:
    res = await flow.get("/api/health/ready")
    return res.json()["checks"]["migrations"]


@pytest.mark.asyncio
async def test_two_parallel_starts_one_migrates_and_the_other_waits(flow, fast, monkeypatch):
    db = flow.db
    await _clean(db)
    events = []

    async def slow(_database):
        events.append("beginn")
        await asyncio.sleep(0.4)
        events.append("ende")
        return "ok"

    monkeypatch.setattr(migrations, "MIGRATIONS", ((1, "langsam", slow),))

    async def start(name):
        applied = await migrations.ensure_migrations(db)
        events.append((name, len(applied)))

    await asyncio.gather(start("a"), start("b"))
    # Genau einer migriert; der andere geht erst weiter, nachdem die Migration fertig und vermerkt ist.
    assert events[:2] == ["beginn", "ende"]
    assert sorted(count for _, count in events[2:]) == [0, 1]
    assert await db.schema_migrations.count_documents({"version": 1}) == 1
    lock = await db.schema_migration_lock.find_one({"_id": "global"})
    assert "owner" not in lock, "nach dem Lauf ist die Sperre frei"


@pytest.mark.asyncio
async def test_a_long_migration_keeps_its_lease_and_nobody_else_gets_in(flow, fast, monkeypatch):
    db = flow.db
    await _clean(db)
    taken = []
    until = []

    async def long_running(database):
        # Ohne eigenen Schritt und ohne ``extend_migration_lease``: der Takt im Hintergrund verlängert.
        for _ in range(8):
            await asyncio.sleep(LEASE / 3)
            until.append((await database.schema_migration_lock.find_one({"_id": "global"}))["locked_until"])
            taken.append(await migrations._acquire_lease(database))
        return "lang"

    monkeypatch.setattr(migrations, "MIGRATIONS", ((1, "lang", long_running),))
    started = monotonic()
    applied = await migrations.ensure_migrations(db)
    assert monotonic() - started > 2 * LEASE, "die Migration lief länger als die Sperre ohne Verlängerung"
    assert [item["version"] for item in applied] == [1]
    assert taken == [None] * 8, "solange der Halter lebt, bekommt kein anderer Start die Sperre"
    assert until[-1] > until[0], "die Sperre wurde im Takt verlängert"
    assert migrations.migration_status()["state"] == "done"


@pytest.mark.asyncio
async def test_a_dead_holder_expires_and_the_waiting_start_takes_over(flow, fast, monkeypatch):
    db = flow.db
    await _clean(db)
    runs = []

    async def migration(_database):
        runs.append(monotonic())
        return "ok"

    monkeypatch.setattr(migrations, "MIGRATIONS", ((1, "nachgezogen", migration),))
    # Der Halter ist gestorben: seine Sperre steht noch, wird aber nie mehr verlängert.
    await _foreign_lock(db, 0.5, owner="toter-start:1:x")
    started = monotonic()
    applied = await migrations.ensure_migrations(db)
    assert [item["version"] for item in applied] == [1]
    assert len(runs) == 1 and runs[0] - started >= 0.4, "übernommen wird erst nach Ablauf der alten Sperre"
    assert migrations.migration_status()["state"] == "done"


@pytest.mark.asyncio
async def test_a_lost_lease_stops_at_the_next_step_and_the_rerun_finishes_without_doubles(flow, fast, monkeypatch):
    db = flow.db
    await _clean(db)
    await db.lease_items.delete_many({})
    await db.lease_items.insert_many([{"id": f"i{n}", "done": False, "runs": 0} for n in range(6)])

    async def stepwise(database):
        # Je Eintrag ein abgeschlossener Schritt, idempotent: ein zweiter Lauf zieht nur das Fehlende nach.
        async for item in database.lease_items.find({"done": False}, {"_id": 0, "id": 1}).sort("id", 1):
            if not await migrations.extend_migration_lease(database):
                raise migrations.MigrationIncomplete("lease lost")
            await database.lease_items.update_one({"id": item["id"], "done": False},
                                                  {"$set": {"done": True}, "$inc": {"runs": 1}})
            if item["id"] == "i2":
                # Mitten im Lauf übernimmt ein anderer Start (etwa nach einer langen Pause dieses Prozesses).
                await database.schema_migration_lock.update_one(
                    {"_id": "global"}, {"$set": {"owner": "anderer-start:2:y",
                                                 "locked_until": datetime.now(timezone.utc) + timedelta(seconds=30)}})
        return "fertig"

    monkeypatch.setattr(migrations, "MIGRATIONS", ((1, "schritte", stepwise),))
    with pytest.raises(migrations.MigrationLeaseLost):
        await migrations.ensure_migrations(db)
    assert migrations.migration_status()["state"] == "lost"
    assert not migrations.migrations_ready()
    assert await db.schema_migrations.count_documents({}) == 0, "die abgebrochene Migration ist nicht vermerkt"
    done = sorted(item["id"] for item in await db.lease_items.find({"done": True}).to_list(None))
    assert done == ["i0", "i1", "i2"], "nach dem Verlust schreibt die alte Migration keinen Schritt mehr"
    lock = await db.schema_migration_lock.find_one({"_id": "global"})
    assert lock["owner"] == "anderer-start:2:y", "die Sperre des neuen Halters bleibt unangetastet"

    # Der andere Start ist fertig (gibt frei); der nächste Lauf zieht nach - jeder Schritt genau einmal.
    await db.schema_migration_lock.update_one({"_id": "global"}, {"$unset": {"owner": ""},
                                                                  "$set": {"locked_until": datetime.now(timezone.utc)}})
    applied = await migrations.ensure_migrations(db)
    assert [item["version"] for item in applied] == [1]
    rows = await db.lease_items.find({}, {"_id": 0, "done": 1, "runs": 1}).to_list(None)
    assert all(row["done"] for row in rows) and [row["runs"] for row in rows] == [1] * 6


@pytest.mark.asyncio
async def test_a_migration_without_steps_is_cancelled_when_another_start_owns_the_lease(flow, fast, monkeypatch):
    db = flow.db
    await _clean(db)
    seen = []

    async def stubborn(database):
        await database.schema_migration_lock.update_one(
            {"_id": "global"}, {"$set": {"owner": "anderer-start:3:z",
                                         "locked_until": datetime.now(timezone.utc) + timedelta(seconds=30)}})
        try:
            await asyncio.sleep(30)
        except asyncio.CancelledError:
            seen.append("abgebrochen")
            raise
        seen.append("weitergeschrieben")
        return "nie"

    monkeypatch.setattr(migrations, "MIGRATIONS", ((1, "stur", stubborn),))
    started = monotonic()
    with pytest.raises(migrations.MigrationLeaseLost):
        await migrations.ensure_migrations(db)
    # Der Takt merkt die Übernahme bei der nächsten Verlängerung und bricht sofort ab - ohne Nachfrist.
    assert monotonic() - started < RENEW * 3
    assert seen == ["abgebrochen"]
    assert await db.schema_migrations.count_documents({}) == 0


@pytest.mark.asyncio
async def test_without_renewal_the_holder_gives_up_before_the_lease_runs_out(flow, fast, monkeypatch):
    db = flow.db
    await _clean(db)
    state = {}

    async def hanging(database):
        lock = await database.schema_migration_lock.find_one({"_id": "global"})
        state["until"] = lock["locked_until"]

        async def unreachable(*_args, **_kwargs):
            raise AutoReconnect("Datenbank weg")

        # Ab jetzt erreicht keine Verlängerung mehr die Datenbank.
        migrations._LEASE.get().db = SimpleNamespace(schema_migration_lock=SimpleNamespace(update_one=unreachable))
        await asyncio.sleep(30)
        return "nie"

    monkeypatch.setattr(migrations, "MIGRATIONS", ((1, "haengt", hanging),))
    with pytest.raises(migrations.MigrationLeaseLost):
        await migrations.ensure_migrations(db)
    stopped = datetime.now(timezone.utc)
    until = state["until"] if state["until"].tzinfo else state["until"].replace(tzinfo=timezone.utc)
    # Aufgegeben, bevor die Sperre in der Datenbank abläuft - also bevor ein anderer Start übernehmen darf.
    assert stopped < until
    assert migrations.migration_status()["state"] == "lost"
    assert await db.schema_migrations.count_documents({}) == 0


@pytest.mark.asyncio
async def test_readiness_waits_for_the_migration_run(flow, fast, monkeypatch):
    db = flow.db
    await _clean(db)

    async def migration(_database):
        return "ok"

    monkeypatch.setattr(migrations, "MIGRATIONS", ((1, "bereit", migration),))
    assert await _ready(flow) is False, "vor dem Lauf nicht bereit"
    await _foreign_lock(db, 30)
    start = asyncio.ensure_future(migrations.ensure_migrations(db))
    await asyncio.sleep(0.2)
    assert migrations.migration_status()["state"] == "waiting"
    assert await _ready(flow) is False, "solange ein anderer Start migriert, nicht bereit"
    # Der andere Start ist fertig und gibt frei.
    await db.schema_migration_lock.update_one({"_id": "global"}, {"$unset": {"owner": ""},
                                                                  "$set": {"locked_until": datetime.now(timezone.utc)}})
    await asyncio.wait_for(start, timeout=5)
    assert await _ready(flow) is True
    assert await db.schema_migrations.count_documents({"version": 1}) == 1


@pytest.mark.asyncio
async def test_a_start_with_everything_recorded_is_ready_without_the_lease(flow, fast, monkeypatch):
    db = flow.db
    await _clean(db)

    async def must_not_run(_database):
        raise AssertionError("schon vermerkte Migration lief erneut")

    monkeypatch.setattr(migrations, "MIGRATIONS", ((1, "fertig", must_not_run),))
    await db.schema_migrations.insert_one({"version": 1, "name": "fertig"})
    await _foreign_lock(db, 30)
    assert await migrations.ensure_migrations(db) == []
    assert await _ready(flow) is True


@pytest.mark.asyncio
async def test_a_deliberately_open_migration_does_not_block_readiness(flow, fast, monkeypatch):
    db = flow.db
    await _clean(db)

    async def unfinished(_database):
        raise migrations.MigrationIncomplete("eine Saison fehlt noch")

    monkeypatch.setattr(migrations, "MIGRATIONS", ((1, "offen", unfinished),))
    assert await migrations.ensure_migrations(db) == []
    assert migrations.migration_status() | {"since": None} == {"state": "incomplete", "open": [1], "since": None}
    assert await _ready(flow) is True


@pytest.mark.asyncio
async def test_waiting_ends_after_the_time_limit_with_a_clear_message(flow, fast, monkeypatch):
    db = flow.db
    await _clean(db)
    monkeypatch.setattr(migrations, "wait_seconds", lambda: 0.3)
    ran = []

    async def migration(_database):
        ran.append(1)
        return "ok"

    monkeypatch.setattr(migrations, "MIGRATIONS", ((1, "wartet", migration),))
    await _foreign_lock(db, 60, owner="haengender-start:4:w")
    started = monotonic()
    with pytest.raises(migrations.MigrationWaitTimeout) as caught:
        await migrations.ensure_migrations(db)
    assert 0.25 <= monotonic() - started < 3
    assert "MIGRATION_WAIT_SECONDS" in str(caught.value) and "haengender-start" in str(caught.value)
    assert ran == [] and migrations.migration_status()["state"] == "timeout"
    assert await _ready(flow) is False
    lock = await db.schema_migration_lock.find_one({"_id": "global"})
    assert lock["owner"] == "haengender-start:4:w", "die fremde Sperre bleibt unangetastet"


@pytest.mark.asyncio
async def test_deleted_account_cleanup_stops_before_the_next_account_without_lease(flow, fast):
    db = flow.db
    await db.users.delete_many({})
    await db.users.insert_one({"id": "weg-1", "anonymized_at": "2026-01-01T00:00:00+00:00", "is_active": False,
                               "display_name": "Gelöschter User", "email": "deleted_weg-1@deleted.invalid"})
    lease = migrations._Lease(db, "dieser-start", LEASE, RENEW, monotonic() + LEASE)
    lease.mark_lost("Test")
    token = migrations._LEASE.set(lease)
    try:
        with pytest.raises(migrations.MigrationIncomplete):
            await migrations.migrate_deleted_account_leftovers(db)
    finally:
        migrations._LEASE.reset(token)


def _cut_off_renewal(record: dict) -> None:
    """Ab jetzt erreicht keine Verlängerung der laufenden Sperre mehr die Datenbank; ``record`` bekommt die Sperre."""
    async def unreachable(*_args, **_kwargs):
        raise AutoReconnect("Datenbank weg")

    lease = migrations._LEASE.get()
    lease.db = SimpleNamespace(schema_migration_lock=SimpleNamespace(update_one=unreachable))
    record["lease"] = lease


@pytest.fixture
def lost_at(monkeypatch):
    """Wann die Sperre als verloren galt (eigene Uhr)."""
    seen = {}
    original = migrations._Lease.mark_lost

    def mark_lost(self, reason, *, taken=False):
        seen.setdefault("at", monotonic())
        original(self, reason, taken=taken)

    monkeypatch.setattr(migrations._Lease, "mark_lost", mark_lost)
    return seen


@pytest.mark.asyncio
async def test_after_a_missed_renewal_the_step_may_finish_within_the_grace(flow, fast, monkeypatch, lost_at):
    db = flow.db
    await _clean(db)
    monkeypatch.setattr(migrations, "GRACE_MARGIN_SECONDS", 0.05)
    state = {}

    async def stepwise(_database):
        _cut_off_renewal(state)
        while migrations.migration_lease_ok():
            await asyncio.sleep(0.01)
        # Der angefangene Schritt läuft noch zu Ende - innerhalb der Nachfrist -, dann hört die Migration auf.
        await asyncio.sleep(0.05)
        state["step_done"] = monotonic()
        raise migrations.MigrationIncomplete("lease lost")

    monkeypatch.setattr(migrations, "MIGRATIONS", ((1, "nachfrist", stepwise),))
    with pytest.raises(migrations.MigrationLeaseLost):
        await migrations.ensure_migrations(db)
    lease = state["lease"]
    assert "step_done" in state, "der Schritt wurde nicht abgebrochen, er durfte zu Ende laufen"
    # Mit echtem Abstand vor dem Ablauf: mindestens ein halber Takt (hier mehr als die 0,05 s Mindestabstand).
    assert lease.valid_until - state["step_done"] >= RENEW / 2 - 0.05
    assert await db.schema_migrations.count_documents({}) == 0


@pytest.mark.asyncio
async def test_a_migration_that_ignores_the_loss_is_cancelled_with_margin_before_expiry(flow, fast, monkeypatch,
                                                                                         lost_at):
    db = flow.db
    await _clean(db)
    monkeypatch.setattr(migrations, "GRACE_MARGIN_SECONDS", 0.05)
    state = {}

    async def stubborn(_database):
        _cut_off_renewal(state)
        try:
            await asyncio.sleep(30)
        except asyncio.CancelledError:
            state["cancelled"] = monotonic()
            raise
        return "nie"

    monkeypatch.setattr(migrations, "MIGRATIONS", ((1, "stur", stubborn),))
    with pytest.raises(migrations.MigrationLeaseLost):
        await migrations.ensure_migrations(db)
    lease = state["lease"]
    # Abgebrochen erst nach der Nachfrist, aber mit Abstand vor dem Ablauf auf der eigenen Uhr.
    assert state["cancelled"] - lost_at["at"] >= 0.05
    assert lease.valid_until - state["cancelled"] >= RENEW / 2 - 0.05


@pytest.mark.asyncio
async def test_an_unexpected_error_while_renewing_counts_as_a_lost_lease(flow, fast, monkeypatch):
    db = flow.db
    await _clean(db)
    seen = []

    async def broken(*_args, **_kwargs):
        raise ValueError("unerwartet")

    async def stubborn(_database):
        migrations._LEASE.get().db = SimpleNamespace(schema_migration_lock=SimpleNamespace(update_one=broken))
        try:
            await asyncio.sleep(30)
        except asyncio.CancelledError:
            seen.append("abgebrochen")
            raise
        return "nie"

    monkeypatch.setattr(migrations, "MIGRATIONS", ((1, "takt-fehler", stubborn),))
    # Ohne Absicherung stürbe der Takt still, und die Migration liefe ohne Sperre weiter (hier: 30 s).
    with pytest.raises(migrations.MigrationLeaseLost):
        await asyncio.wait_for(migrations.ensure_migrations(db), timeout=5)
    assert seen == ["abgebrochen"]
    assert "ValueError" in migrations.migration_status()["reason"]


def test_the_grace_keeps_at_least_the_safety_margin():
    lease = migrations._Lease(None, "x", 180, 45, monotonic() + 40)
    # 40 s Rest, Abstand mindestens ein halber Takt (22,5 s): 17,5 s Nachfrist.
    assert lease.grace_seconds() == pytest.approx(17.5, abs=0.2)
    short = migrations._Lease(None, "x", 30, 2, monotonic() + 4)
    assert short.grace_seconds() == 0.0, "unter fünf Sekunden Rest gibt es keine Nachfrist"
    short.taken = True
    assert short.grace_seconds() == 0.0


def test_lease_settings_have_bounds(monkeypatch):
    for name in ("MIGRATION_LEASE_SECONDS", "MIGRATION_LEASE_RENEW_SECONDS", "MIGRATION_WAIT_SECONDS"):
        monkeypatch.delenv(name, raising=False)
    assert (migrations.lease_seconds(), migrations.renew_seconds(), migrations.wait_seconds()) == (180, 45, 1800)
    monkeypatch.setenv("MIGRATION_LEASE_SECONDS", "5")
    monkeypatch.setenv("MIGRATION_LEASE_RENEW_SECONDS", "999")
    monkeypatch.setenv("MIGRATION_WAIT_SECONDS", "kaputt")
    # Die Sperre nie unter 30 s, der Takt höchstens ein Drittel der Sperre, ein unlesbarer Wert gibt den Standard.
    assert (migrations.lease_seconds(), migrations.renew_seconds(), migrations.wait_seconds()) == (30, 10, 1800)


@pytest.mark.asyncio
async def test_the_longest_allowed_renewal_interval_keeps_the_lease(flow, fast, monkeypatch):
    """Der Takt an der Obergrenze (``renew_seconds`` aus der Umgebung, nicht ersetzt): Die Sperre hält über mehrere
    Takte; bei der früheren Obergrenze (halbe Sperre) war sie schon bei der ersten Verlängerung verloren."""
    db = flow.db
    await _clean(db)
    monkeypatch.setattr(migrations, "renew_seconds", REAL_RENEW_SECONDS)
    monkeypatch.setenv("MIGRATION_LEASE_RENEW_SECONDS", "999")
    assert migrations.renew_seconds() == pytest.approx(LEASE / 3)

    async def long_running(_database):
        await asyncio.sleep(LEASE * 2.5)
        return "lang"

    monkeypatch.setattr(migrations, "MIGRATIONS", ((1, "obergrenze", long_running),))
    applied = await migrations.ensure_migrations(db)
    assert [item["version"] for item in applied] == [1]
    assert migrations.migration_status()["state"] == "done"


def test_the_start_waits_for_migrations_before_serving():
    from pathlib import Path

    source = (Path(__file__).resolve().parents[1] / "server.py").read_text(encoding="utf-8")
    assert "await ensure_migrations(get_db())" in source
    assert "run_pending_migrations" not in source
    assert 'checks["migrations"] = migrations_ready()' in source


@pytest.mark.asyncio
async def test_a_failed_migration_start_stops_the_background_sweep(monkeypatch):
    import server

    calls = []

    async def no_indexes():
        return None

    async def timeout(_db):
        raise migrations.MigrationWaitTimeout("Test")

    async def stop_sweep():
        calls.append("gestoppt")

    for name in ("validate_runtime_env", "ensure_wiring", "ensure_storage_directories", "_start_variant_sweep"):
        monkeypatch.setattr(server, name, lambda: None)
    monkeypatch.setattr(server, "init_indexes", no_indexes)
    monkeypatch.setattr(server, "_stop_variant_sweep", stop_sweep)
    monkeypatch.setattr(migrations, "ensure_migrations", timeout)
    with pytest.raises(migrations.MigrationWaitTimeout):
        async with server.lifespan(server.app):
            pass
    assert calls == ["gestoppt"]
