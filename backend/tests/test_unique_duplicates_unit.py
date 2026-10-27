"""Altdubletten vor eindeutigen Indizes (#1043).

Scheitert ein eindeutiger Index beim Start an alten Dubletten, bleibt ein gewöhnlicher (#930). Das muss für die Admins
sichtbar sein (Betrieb → Checks), nicht nur im Log. Bereinigt wird nur kontrolliert: erst ein Trockenlauf, der nichts
ändert, dann ein ausdrücklicher Lauf mit Protokoll der entfernten Zeilen. Wo die Wahl der bleibenden Zeile eine
fachliche Entscheidung ist, löscht das Werkzeug nie selbst.
"""
import asyncio
import importlib.util
import io
import json
import pathlib

from bson import ObjectId
from mongomock_motor import AsyncMongoMockClient

import database
from services import ops_checks, unique_duplicates

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "unique_index_duplicates.py"


def fresh():
    return AsyncMongoMockClient()["dubletten"]


def run(coro):
    return asyncio.run(coro)


async def with_xp_duplicates(db):
    first, second, third = ObjectId("650000000000000000000001"), ObjectId("650000000000000000000002"), ObjectId("650000000000000000000003")
    await db.user_xp.insert_many([
        {"_id": second, "user_id": "u1", "total": 5},
        {"_id": first, "user_id": "u1", "total": 10},
        {"_id": third, "user_id": "u1", "total": 1},
        {"user_id": "u2", "total": 7},
    ])
    await database.init_audit_indexes(db)
    return first


def test_a_blocked_unique_index_is_listed_and_turns_the_check_yellow():
    async def scenario():
        db = fresh()
        await database.init_audit_indexes(db)
        assert await database.blocked_unique_indexes(db) == []
        clean = await ops_checks.check_unique_indexes(db)
        assert clean["key"] == "unique_indexes" and clean["status"] == "ok"

        await db.user_xp.drop_indexes()
        await db.user_xp.insert_many([{"user_id": "u1", "total": 10}, {"user_id": "u1", "total": 5}])
        await database.init_audit_indexes(db)
        assert await database.blocked_unique_indexes(db) == ["user_xp.user"]
        check = await ops_checks.check_unique_indexes(db)
        assert check["status"] == "warn"
        assert "user_xp.user" in check["detail"] and "scripts/unique_index_duplicates.py" in check["detail"]
    run(scenario())


def test_the_check_is_part_of_every_run():
    keys = {key for key, _label, _runner in ops_checks.default_checks(fresh())}
    assert {"unique_indexes", "file_cleanups"} <= keys


def test_the_dry_run_reports_and_changes_nothing():
    async def scenario():
        db = fresh()
        await with_xp_duplicates(db)
        report = await unique_duplicates.plan(db)
        by_index = {row["index"]: row for row in report}
        assert by_index["user_xp.user"] == {
            "index": "user_xp.user", "unique_active": False, "groups": 1, "surplus": 2, "mode": "auto",
            "rule": by_index["user_xp.user"]["rule"],
        }
        assert all(row["groups"] == 0 for name, row in by_index.items() if name != "user_xp.user")
        assert await db.user_xp.count_documents({}) == 4
        assert "user_plain" in await db.user_xp.index_information()
        text = unique_duplicates.render_text(report)
        assert "user_xp.user" in text and "Trockenlauf" in text and "u1" not in text
    run(scenario())


def test_the_explicit_run_keeps_the_oldest_row_writes_a_protocol_and_sets_the_unique_index():
    async def scenario():
        db = fresh()
        first = await with_xp_duplicates(db)
        protocol = await unique_duplicates.apply(db, actor="test")
        entry = {row["index"]: row for row in protocol["indexes"]}["user_xp.user"]
        assert entry["removed"] == 2 and entry["unique_active"] is True
        assert sorted(doc["total"] for doc in entry["removed_documents"]) == [1, 5]
        rows = await db.user_xp.find({"user_id": "u1"}).to_list(10)
        assert [row["_id"] for row in rows] == [first], "die älteste Zeile bleibt - die hat die Anwendung gelesen"
        assert await db.user_xp.count_documents({"user_id": "u2"}) == 1
        info = await db.user_xp.index_information()
        assert "user_unique" in info and "user_plain" not in info
        assert await database.blocked_unique_indexes(db) == []
        audit = await db.audit_logs.find_one({"action": "ops.unique_duplicates.apply"})
        assert audit["data"]["removed"] == {"user_xp.user": 2}
        assert "removed_documents" not in json.dumps(audit["data"], default=str)
        # Ein zweiter Lauf findet nichts mehr.
        again = await unique_duplicates.apply(db, actor="test")
        assert all(row["removed"] == 0 for row in again["indexes"])
    run(scenario())


def test_indexes_that_need_a_decision_are_only_reported():
    async def scenario():
        db = fresh()
        await db.billing_orders.insert_many([
            {"id": "o1", "booking_key": "k1", "status": "open"},
            {"id": "o2", "booking_key": "k1", "status": "done"},
            {"id": "o3", "status": "open"}, {"id": "o4", "status": "open"},  # ohne Schlüssel zählen nicht
        ])
        await database.init_audit_indexes(db)
        assert await database.blocked_unique_indexes(db) == ["billing_orders.booking_key"]
        report = {row["index"]: row for row in await unique_duplicates.plan(db)}
        assert report["billing_orders.booking_key"]["mode"] == "manual"
        assert report["billing_orders.booking_key"]["groups"] == 1 and report["billing_orders.booking_key"]["surplus"] == 1
        protocol = await unique_duplicates.apply(db, actor="test")
        assert await db.billing_orders.count_documents({}) == 4
        assert {row["index"] for row in protocol["manual"]} == {"billing_orders.booking_key"}
        assert await database.blocked_unique_indexes(db) == ["billing_orders.booking_key"]
    run(scenario())


def test_only_limits_the_run_to_named_indexes():
    async def scenario():
        db = fresh()
        await db.news_reads.insert_many([{"user_id": "u1", "news_id": "n1"}, {"user_id": "u1", "news_id": "n1"}])
        await with_xp_duplicates(db)
        protocol = await unique_duplicates.apply(db, actor="test", only={"news_reads.user_news"})
        assert [row["index"] for row in protocol["indexes"]] == ["news_reads.user_news"]
        assert await db.news_reads.count_documents({}) == 1
        assert await db.user_xp.count_documents({}) == 4
    run(scenario())


def test_missing_and_null_keys_collide_like_in_the_index():
    async def scenario():
        db = fresh()
        await db.user_xp.insert_many([{"total": 1}, {"user_id": None, "total": 2}])
        report = {row["index"]: row for row in await unique_duplicates.plan(db)}
        assert report["user_xp.user"]["groups"] == 1 and report["user_xp.user"]["surplus"] == 1
    run(scenario())


def test_a_sparse_index_ignores_rows_without_the_field():
    # Druckdateien (#1708): ältere Versionen haben keinen öffentlichen Schlüssel. Der Index ist sparse und kennt sie
    # nicht - also sind sie auch keine Dubletten. Ein doppelter Schlüssel bleibt eine.
    async def scenario():
        db = fresh()
        await db.shop_designs.insert_many([{"design_key": "a", "version": 1}, {"design_key": "a", "version": 2}])
        report = {row["index"]: row for row in await unique_duplicates.plan(db)}
        assert report["shop_designs.public_id"]["groups"] == 0
        await db.shop_designs.insert_many([{"design_key": "b", "version": 1, "public_id": "k"},
                                           {"design_key": "b", "version": 2, "public_id": "k"}])
        report = {row["index"]: row for row in await unique_duplicates.plan(db)}
        assert report["shop_designs.public_id"]["groups"] == 1 and report["shop_designs.public_id"]["surplus"] == 1
    run(scenario())


def load_script():
    spec = importlib.util.spec_from_file_location("unique_index_duplicates_script", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_script_without_the_apply_flag_only_reads(monkeypatch):
    db = fresh()
    run(with_xp_duplicates(db))
    script = load_script()
    out, err = io.StringIO(), io.StringIO()
    assert run(script.main([], db=db, out=out, err=err)) == 0
    assert "user_xp.user" in out.getvalue() and "Trockenlauf" in out.getvalue()
    assert run(db.user_xp.count_documents({})) == 4

    out = io.StringIO()
    assert run(script.main(["--anwenden"], db=db, out=out, err=err)) == 0
    protocol = json.loads(out.getvalue())
    assert {row["index"]: row["removed"] for row in protocol["indexes"]}["user_xp.user"] == 2
    assert run(db.user_xp.count_documents({})) == 2


def test_the_script_refuses_unknown_index_names():
    script = load_script()
    err = io.StringIO()
    assert run(script.main(["--nur", "gibt_es.nicht"], db=fresh(), out=io.StringIO(), err=err)) == 2
    assert "gibt_es.nicht" in err.getvalue()


class ChangingWriter:
    """Ein Schreiber, der genau zwischen Suche und Löschung eine Zeile ändert - wie die laufende Anwendung."""

    def __init__(self, db, collection: str, change):
        self._db, self._collection, self._change, self.done = db, collection, change, False

    def __getattr__(self, name):
        target = getattr(self._db, name)
        if name != self._collection:
            return target
        owner = self

        class Collection:
            def __getattr__(self, attr):
                return getattr(target, attr)

            async def delete_one(self, query, *args, **kwargs):
                if not owner.done:
                    owner.done = True
                    await owner._change(target, query["_id"])
                return await target.delete_one(query, *args, **kwargs)

        return Collection()


def test_a_row_changed_by_a_running_writer_is_not_deleted():
    """Codex-Prüfung zu #1043: gelöscht wird je Zeile und nur mit dem Stand aus dem Protokoll."""
    async def scenario():
        db = fresh()
        await with_xp_duplicates(db)

        async def bump(collection, row_id):
            await collection.update_one({"_id": row_id}, {"$inc": {"total": 100}})

        protocol = await unique_duplicates.apply(ChangingWriter(db, "user_xp", bump), actor="test", only={"user_xp.user"})
        entry = protocol["indexes"][0]
        assert entry["removed"] == 1 and len(entry["skipped"]) == 1
        assert entry["unique_active"] is False, "die geänderte Dublette bleibt - der Index wartet auf den nächsten Lauf"
        totals = sorted(row["total"] for row in await db.user_xp.find({"user_id": "u1"}).to_list(10))
        assert len(totals) == 2 and totals[-1] > 100
        audit = await db.audit_logs.find_one({"action": "ops.unique_duplicates.apply"})
        assert audit["data"]["skipped"] == {"user_xp.user": 1}
    run(scenario())


def test_a_group_whose_kept_row_moved_is_left_alone():
    async def scenario():
        db = fresh()
        first = await with_xp_duplicates(db)
        real_groups = unique_duplicates._groups

        async def groups_then_move(*args, **kwargs):
            found = await real_groups(*args, **kwargs)
            await db.user_xp.update_one({"_id": first}, {"$set": {"user_id": "u9"}})
            return found

        unique_duplicates._groups = groups_then_move
        try:
            protocol = await unique_duplicates.apply(db, actor="test", only={"user_xp.user"})
        finally:
            unique_duplicates._groups = real_groups
        assert protocol["indexes"][0]["removed"] == 0 and len(protocol["indexes"][0]["skipped"]) == 2
        assert await db.user_xp.count_documents({"user_id": "u1"}) == 2
    run(scenario())


def test_the_report_says_it_is_better_done_in_a_quiet_hour():
    async def scenario():
        db = fresh()
        await with_xp_duplicates(db)
        assert "besser in ruhiger Zeit" in unique_duplicates.render_text(await unique_duplicates.plan(db))
    run(scenario())
