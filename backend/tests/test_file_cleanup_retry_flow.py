"""Kontolöschung: Dateien, deren Löschung scheitert (#1046).

Jede gescheiterte Datei steht als Eintrag mit Status in ``pending_file_cleanups``. Der stündliche Aufräum-Job holt sie
nach - mit wachsendem Abstand und höchstens ``RETRY_LIMIT`` Versuchen, danach steht der Eintrag als aufgegeben da und
die Admins sehen ihn (Betrieb → Checks). Das Nacharbeiten ist idempotent, und weder Log noch Eintrag tragen den Pfad
oder anderes über die Person.
"""
import logging
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import account_erasure, ops_checks  # noqa: E402

UPLOADS = "/api/static/uploads/"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def public(tmp_path, monkeypatch):
    folder, quarantine = tmp_path / "public", tmp_path / "quarantine"
    (folder / "variants").mkdir(parents=True)
    quarantine.mkdir()
    monkeypatch.setattr(account_erasure, "PUBLIC_UPLOAD_DIR", folder)
    monkeypatch.setattr(account_erasure, "UPLOAD_DIR", tmp_path)
    monkeypatch.setattr(account_erasure, "QUARANTINE_DIR", quarantine)
    return folder


@pytest.fixture
def lock(monkeypatch):
    """Sperrt Dateien, deren Name einen der Teile enthält - wie eine Datei, die gerade in Verwendung ist."""
    real = account_erasure._unlink
    locked: set[str] = set()

    def unlink(path):
        if any(part in path.name for part in locked):
            raise PermissionError(13, "Permission denied", str(path))
        real(path)

    monkeypatch.setattr(account_erasure, "_unlink", unlink)
    return locked


async def upload(flow, public, name, owner):
    (public / name).write_bytes(b"bild")
    await flow.db.media_uploads.insert_one({"id": f"up-{name}", "filename": name, "url": UPLOADS + name,
                                            "owner_id": owner["id"], "media_scope": "user"})


async def delete_account(flow, user):
    flow.act_as(user)
    assert (await flow.post("/api/dsgvo/anonymize-me")).status_code == 200


def later(hours: float):
    return now_utc() + timedelta(hours=hours)


@pytest.mark.asyncio
async def test_a_failed_file_is_a_pending_entry_without_path_or_person_in_log_and_row(flow, public, lock, caplog):
    paula = await flow.add_user(role="player", name="paula")
    await upload(flow, public, "paula-gesperrt.webp", paula)
    lock.add("gesperrt")
    with caplog.at_level(logging.INFO):
        await delete_account(flow, paula)

    row = await flow.db[account_erasure.PENDING].find_one({"filename": "paula-gesperrt.webp"}, {"_id": 0})
    assert row["status"] == "pending" and row["attempts"] == 1 and row["source"] == "account_erasure"
    assert row["next_attempt_at"] > now_utc().isoformat(), "der nächste Versuch kommt später"
    assert "paula" not in row["last_error"] and str(public) not in row["last_error"]
    assert "PermissionError" in row["last_error"]
    logged = " ".join(record.getMessage() for record in caplog.records if "media" in record.getMessage())
    assert logged, "die gescheiterte Löschung steht im Log"
    assert "paula" not in logged and str(public) not in logged


@pytest.mark.asyncio
async def test_the_job_waits_for_the_next_attempt_and_then_cleans_up(flow, public, lock):
    paula = await flow.add_user(role="player", name="paula")
    await upload(flow, public, "zu.webp", paula)
    lock.add("zu.webp")
    await delete_account(flow, paula)
    lock.clear()

    assert await account_erasure.retry_file_cleanups(flow.db) == 0, "noch nicht fällig"
    assert (public / "zu.webp").exists()
    assert await account_erasure.retry_file_cleanups(flow.db, now=later(2)) == 1
    assert not (public / "zu.webp").exists()
    assert await flow.db[account_erasure.PENDING].count_documents({}) == 0
    # Idempotent: ein weiterer Lauf hat nichts zu tun und scheitert nicht.
    assert await account_erasure.retry_file_cleanups(flow.db, now=later(3)) == 0


@pytest.mark.asyncio
async def test_after_the_limit_the_entry_is_given_up_and_shown_red(flow, public, lock):
    paula = await flow.add_user(role="player", name="paula")
    await upload(flow, public, "fest.webp", paula)
    lock.add("fest.webp")
    await delete_account(flow, paula)

    check = await ops_checks.check_file_cleanups(flow.db)
    assert check["key"] == "file_cleanups" and check["status"] == "warn"

    when = now_utc()
    for _ in range(account_erasure.RETRY_LIMIT + 3):
        when += account_erasure.RETRY_MAX + timedelta(minutes=1)
        await account_erasure.retry_file_cleanups(flow.db, now=when)
    row = await flow.db[account_erasure.PENDING].find_one({"filename": "fest.webp"})
    assert row["status"] == "failed" and row["attempts"] == account_erasure.RETRY_LIMIT
    assert row["next_attempt_at"] is None and row["failed_at"]

    check = await ops_checks.check_file_cleanups(flow.db)
    assert check["status"] == "crit" and "1 aufgegeben" in check["value"]


def test_the_wait_grows_and_is_capped():
    waits = [account_erasure.retry_delay(attempt) for attempt in range(1, 12)]
    assert waits[0] == account_erasure.RETRY_BASE
    assert waits == sorted(waits) and max(waits) == account_erasure.RETRY_MAX


@pytest.mark.asyncio
async def test_entries_from_before_the_status_are_still_picked_up(flow, public):
    (public / "alt.webp").write_bytes(b"bild")
    await flow.db.media_uploads.insert_one({"id": "up-alt", "filename": "alt.webp", "owner_id": "weg", "media_scope": "user"})
    await flow.db[account_erasure.PENDING].insert_one({"filename": "alt.webp", "owner_id": "weg", "owned": True, "attempts": 3,
                                                       "last_error": "x", "updated_at": "2026-10-01T00:00:00+00:00"})
    assert await account_erasure.retry_file_cleanups(flow.db) == 1
    assert not (public / "alt.webp").exists()


@pytest.mark.asyncio
async def test_one_broken_entry_does_not_stop_the_others(flow, public, monkeypatch):
    (public / "gut.webp").write_bytes(b"bild")
    await flow.db[account_erasure.PENDING].insert_many([
        {"filename": "kaputt.webp", "owner_id": "a", "owned": True, "status": "pending", "attempts": 1, "next_attempt_at": None},
        {"filename": "gut.webp", "owner_id": "b", "owned": True, "status": "pending", "attempts": 1, "next_attempt_at": None},
    ])
    real = account_erasure._clean

    async def clean(db, owner_id, owned, untracked, **kwargs):
        if "kaputt.webp" in owned:
            raise RuntimeError("Datenbank weg")
        return await real(db, owner_id, owned, untracked, **kwargs)

    monkeypatch.setattr(account_erasure, "_clean", clean)
    assert await account_erasure.retry_file_cleanups(flow.db) == 1
    assert not (public / "gut.webp").exists()
    broken = await flow.db[account_erasure.PENDING].find_one({"filename": "kaputt.webp"})
    # Auch ein solcher Fehler zählt als Versuch: Abstand, Zähler und am Ende „aufgegeben“ (Codex-Prüfung zu #1046).
    assert broken["attempts"] == 2 and broken["status"] == "pending" and broken["last_error"] == "RuntimeError"
    assert broken["next_attempt_at"] > now_utc().isoformat()
    when = now_utc()
    for _ in range(account_erasure.RETRY_LIMIT + 3):
        when += account_erasure.RETRY_MAX + timedelta(minutes=1)
        await account_erasure.retry_file_cleanups(flow.db, now=when)
    broken = await flow.db[account_erasure.PENDING].find_one({"filename": "kaputt.webp"})
    assert broken["status"] == "failed" and broken["attempts"] == account_erasure.RETRY_LIMIT


@pytest.mark.asyncio
async def test_old_error_texts_are_shown_without_path_or_name(flow):
    await flow.db[account_erasure.PENDING].insert_many([
        {"filename": "a.webp", "owned": True, "attempts": 1,
         "last_error": "[Errno 13] Permission denied: 'C:\\\\uploads\\\\paula-urlaub.webp'"},
        {"filename": "b.webp", "owned": True, "attempts": 1, "last_error": "Datei von paula ist in Verwendung"},
        {"filename": "c.webp", "owned": True, "attempts": 1, "status": "pending", "last_error": "PermissionError EACCES"},
    ])
    items = {item["filename"]: item for item in (await account_erasure.file_cleanup_overview(flow.db))["items"]}
    assert items["a.webp"]["last_error"] == "OSError EACCES"
    assert items["b.webp"]["last_error"] == "unbekannt"
    assert items["c.webp"]["last_error"] == "PermissionError EACCES"
    assert "paula" not in str(items)


def test_the_stored_error_is_class_and_code_only():
    assert account_erasure.safe_error(PermissionError(13, "Permission denied", "/uploads/paula.webp")) == "PermissionError EACCES"
    assert account_erasure.safe_error(RuntimeError("paula")) == "RuntimeError"


@pytest.mark.asyncio
async def test_admins_see_the_entries_and_can_try_again(flow, public, lock):
    paula = await flow.add_user(role="player", name="paula")
    await upload(flow, public, "fest.webp", paula)
    lock.add("fest.webp")
    await delete_account(flow, paula)
    await flow.db[account_erasure.PENDING].update_one({"filename": "fest.webp"}, {"$set": {
        "status": "failed", "attempts": account_erasure.RETRY_LIMIT, "next_attempt_at": None, "failed_at": now_utc().isoformat()}})

    player = await flow.add_user(role="player", name="spieler")
    flow.act_as(player)
    assert (await flow.get("/api/admin/ops/file-cleanups")).status_code == 403
    assert (await flow.post("/api/admin/ops/file-cleanups/retry")).status_code == 403

    admin = await flow.add_user(role="club_admin", name="clubadmin")
    flow.act_as(admin)
    view = await flow.get("/api/admin/ops/file-cleanups")
    assert view.status_code == 200, view.text
    data = view.json()
    assert data["counts"] == {"pending": 0, "failed": 1} and data["retry_limit"] == account_erasure.RETRY_LIMIT
    assert data["items"][0]["filename"] == "fest.webp" and data["items"][0]["status"] == "failed"
    assert "owner_id" not in data["items"][0] and "_id" not in data["items"][0]

    lock.clear()
    retried = await flow.post("/api/admin/ops/file-cleanups/retry")
    assert retried.status_code == 200, retried.text
    assert retried.json()["requeued"] == 1 and retried.json()["removed"] == 1
    assert not (public / "fest.webp").exists()
    assert await flow.db[account_erasure.PENDING].count_documents({}) == 0
    audit = await flow.db.audit_logs.find_one({"action": "ops.file_cleanups.retry"})
    assert audit["actor_id"] == admin["id"] and audit["data"] == {"requeued": 1, "removed": 1}


@pytest.mark.asyncio
async def test_a_retry_that_fails_again_starts_a_fresh_round(flow, public, lock):
    await flow.db[account_erasure.PENDING].insert_one({"filename": "fest.webp", "owner_id": "a", "owned": True, "status": "failed",
                                                       "attempts": account_erasure.RETRY_LIMIT, "next_attempt_at": None})
    (public / "fest.webp").write_bytes(b"bild")
    lock.add("fest.webp")
    assert await account_erasure.requeue_file_cleanups(flow.db) == 1
    assert await account_erasure.retry_file_cleanups(flow.db) == 0
    row = await flow.db[account_erasure.PENDING].find_one({"filename": "fest.webp"})
    assert row["status"] == "pending" and row["attempts"] == 1
