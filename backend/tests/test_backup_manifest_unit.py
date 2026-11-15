"""Manifest eines Backup-Paares (#1009, #1010): bauen, vor dem Restore prüfen (Prüfsumme, Paar, Projekt, Datenbank,
Versionen, Zielbestand) und nach dem Restore vergleichen (Sammlungen, Summen, Uploads, Datei-Verweise)."""
import asyncio
import importlib.util
import io
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tarfile

import pytest
from mongomock_motor import AsyncMongoMockClient

BACKEND = pathlib.Path(__file__).resolve().parents[1]
REPO = BACKEND.parent
sys.path.insert(0, str(BACKEND))

from services import backup_inventory  # noqa: E402

_spec = importlib.util.spec_from_file_location("backup_manifest", REPO / "scripts" / "backup-manifest.py")
manifest_tool = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(manifest_tool)

BASH = shutil.which("bash") if os.name != "nt" else r"C:\Program Files\Git\bin\bash.exe"


def snapshot(**overrides):
    data = {
        "mongo_version": "7.0.40",
        "schema_version": 23,
        "code_schema_version": 23,
        "collections": {"users": 3, "tournament_registrations": 5, "billing_orders": 2, "sessions": 4},
        "figures": {"billing_orders": {"open": {"count": 2, "amount": 3000}}, "tournament_registrations": {"approved": {"count": 5}}},
        "uploads": {"count": 2, "bytes": 30, "digest": "a" * 64},
        "references": {"referenced_files": 2, "missing": 0, "missing_sample": []},
    }
    data.update(overrides)
    return data


def make_pair(directory: pathlib.Path, stamp="20261116_031500", *, project="the-lion-squad", db="tls_arena", pair="p1",
              before=None, after=None, content=b"mongo"):
    mongo = directory / f"tls_{db}_{stamp}.archive.gz.enc"
    uploads = directory / f"tls_uploads_{stamp}.tar.gz.enc"
    mongo.write_bytes(content + stamp.encode())
    uploads.write_bytes(b"uploads" + stamp.encode())
    before = before or snapshot()
    manifest = manifest_tool.build_manifest(
        project=project, db_name=db, timestamp=stamp, pair_id=pair, mongo_path=mongo, uploads_path=uploads,
        app_version="1.85.0", git_commit="abc123", before=before, after=after or before,
        uploads={"count": 2, "bytes": 30, "digest": "a" * 64}, pause={"mode": "pause", "drained": True}, retention_days=14)
    path = directory / f"tls_backup_{stamp}.manifest.json"
    path.write_text(json.dumps(manifest), encoding="utf-8")
    return manifest, path, mongo, uploads


def verify(manifest, path, **kwargs):
    options = {"mongo": None, "uploads": None, "project": "the-lion-squad", "db_name": "tls_arena", **kwargs}
    return manifest_tool.verify(manifest, path, **options)


# ------------------------------------------------------------------------------------------------- Manifest bauen

def test_the_manifest_names_the_pair_and_everything_needed(tmp_path):
    manifest, _path, mongo, uploads = make_pair(tmp_path)
    for key in ("pair_id", "project", "db_name", "created_at", "app_version", "git_commit", "mongo_version"):
        assert manifest[key]
    assert manifest["format_version"] == manifest_tool.FORMAT_VERSION
    assert manifest["files"]["mongo"]["sha256"] == manifest_tool.sha256_file(mongo)
    assert manifest["files"]["uploads"]["sha256"] == manifest_tool.sha256_file(uploads)
    assert manifest["collections"]["users"] == 3
    assert manifest["schema_version"] == 23
    assert manifest["unstable_collections"] == [] and manifest["unstable_figures"] == []
    assert manifest["references"] == {"referenced_files": 2, "missing": 0}


def test_writes_that_bypassed_the_pause_are_named(tmp_path):
    after = snapshot(collections={"users": 3, "tournament_registrations": 5, "billing_orders": 2, "sessions": 5})
    manifest, *_ = make_pair(tmp_path, after=after)
    assert manifest["unstable_collections"] == ["sessions"]


# ------------------------------------------------------------------------------------- Prüfen vor der Änderung

def test_a_correct_pair_passes(tmp_path):
    manifest, path, mongo, uploads = make_pair(tmp_path)
    assert verify(manifest, path) == {"mongo": str(mongo), "uploads": str(uploads)}
    assert verify(manifest, path, mongo=mongo, uploads=uploads)["mongo"] == str(mongo)


def test_a_changed_archive_is_rejected(tmp_path):
    manifest, path, mongo, _uploads = make_pair(tmp_path)
    mongo.write_bytes(mongo.read_bytes() + b"x")
    with pytest.raises(manifest_tool.Rejected, match="Prüfsumme"):
        verify(manifest, path)


def test_a_missing_archive_is_rejected(tmp_path):
    manifest, path, _mongo, uploads = make_pair(tmp_path)
    uploads.unlink()
    with pytest.raises(manifest_tool.Rejected, match="fehlt"):
        verify(manifest, path)


def test_two_valid_backups_of_different_age_cannot_be_mixed(tmp_path):
    """Datenbank vom Montag, Uploads vom Dienstag - beide für sich gültig, zusammen falsch."""
    monday, monday_path, monday_mongo, _ = make_pair(tmp_path, "20261116_031500", pair="montag")
    _tuesday, _tp, _tm, tuesday_uploads = make_pair(tmp_path, "20261117_031500", pair="dienstag")
    with pytest.raises(manifest_tool.Rejected, match="dienstag"):
        verify(monday, monday_path, mongo=monday_mongo, uploads=tuesday_uploads)
    # Auch umbenannt (gleicher Name, fremder Inhalt) fällt es über die Prüfsumme auf.
    renamed = tmp_path / "x"
    renamed.mkdir()
    shutil.copy(tuesday_uploads, renamed / monday["files"]["uploads"]["name"])
    with pytest.raises(manifest_tool.Rejected, match="anderes Paar"):
        verify(monday, monday_path, mongo=monday_mongo, uploads=renamed / monday["files"]["uploads"]["name"])


def test_a_foreign_project_or_database_is_rejected(tmp_path):
    manifest, path, *_ = make_pair(tmp_path, project="tls-staging")
    with pytest.raises(manifest_tool.Rejected, match="Projekt"):
        verify(manifest, path)
    # Nur ausdrücklich mit dem Namen des fremden Projekts.
    assert verify(manifest, path, allow_project="tls-staging")
    with pytest.raises(manifest_tool.Rejected, match="Datenbank"):
        verify(manifest, path, db_name="tls_arena_staging", allow_project="tls-staging")


@pytest.mark.parametrize("change", [{"format": "etwas"}, {"format_version": 1}, {"pair_id": ""}, {"collections": {}}])
def test_an_incomplete_or_unknown_manifest_is_rejected(tmp_path, change):
    manifest, path, *_ = make_pair(tmp_path)
    manifest.update(change)
    with pytest.raises(manifest_tool.Rejected):
        verify(manifest, path)


def test_a_backup_newer_than_the_code_is_rejected():
    manifest = {"schema_version": 24, "mongo_version": "7.0.40", "git_commit": "abc", "app_version": "1.86.0"}
    with pytest.raises(manifest_tool.Rejected, match="Migration 24"):
        manifest_tool.compat(manifest, {"code_schema_version": 23, "mongo_version": "7.0.40"})
    notes = manifest_tool.compat(manifest, {"code_schema_version": 23, "mongo_version": "7.0.40"}, allow_version_mismatch=True)
    assert any("Übergangen" in note for note in notes)
    # Älteres Backup als Code: in Ordnung, die Migrationen laufen beim Start nach.
    assert "nach" in manifest_tool.compat({**manifest, "schema_version": 20}, {"code_schema_version": 23, "mongo_version": "7.0.40"})[0]


def test_a_backup_from_a_newer_mongodb_is_rejected():
    manifest = {"schema_version": 23, "mongo_version": "8.0.1"}
    with pytest.raises(manifest_tool.Rejected, match="MongoDB"):
        manifest_tool.compat(manifest, {"code_schema_version": 23, "mongo_version": "7.0.40"})
    assert manifest_tool.compat({**manifest, "mongo_version": "7.0.12"}, {"code_schema_version": 23, "mongo_version": "7.0.40"}) == []
    with pytest.raises(manifest_tool.Rejected, match="unbekannt"):
        manifest_tool.compat(manifest, {"mongo_version": "7.0.40"})


def test_extra_collections_in_the_target_are_listed():
    manifest = {"collections": {"users": 1, "news_posts": 2}}
    assert manifest_tool.extras(manifest, ["users", "news_posts", "neu_seit_backup", "system.views"]) == ["neu_seit_backup"]
    assert manifest_tool.extras(manifest, ["users"]) == []


def test_old_text_manifests_check_names_database_and_checksums(tmp_path):
    mongo = tmp_path / "tls_tls_arena_20261001_031500.archive.gz.enc"
    uploads = tmp_path / "tls_uploads_20261001_031500.tar.gz.enc"
    mongo.write_bytes(b"m")
    uploads.write_bytes(b"u")
    text = "\n".join([
        "created_at=20261001_031500", "db_name=tls_arena", f"mongo_file={mongo.name}", f"uploads_file={uploads.name}",
        f"{manifest_tool.sha256_file(mongo)}  /opt/tls-arena/backups/{mongo.name}",
        f"{manifest_tool.sha256_file(uploads)}  /opt/tls-arena/backups/{uploads.name}",
    ])
    path = tmp_path / "tls_backup_20261001_031500.manifest.txt"
    assert manifest_tool.verify_legacy(text, path, mongo=mongo, uploads=uploads, db_name="tls_arena")["mongo"] == str(mongo)
    with pytest.raises(manifest_tool.Rejected, match="Datenbank"):
        manifest_tool.verify_legacy(text, path, mongo=mongo, uploads=uploads, db_name="tls_arena_staging")
    with pytest.raises(manifest_tool.Rejected, match="nicht das aus dem Manifest"):
        manifest_tool.verify_legacy(text, path, mongo=uploads, uploads=mongo, db_name="tls_arena")
    uploads.write_bytes(b"veraendert")
    with pytest.raises(manifest_tool.Rejected, match="Prüfsumme"):
        manifest_tool.verify_legacy(text, path, mongo=mongo, uploads=uploads, db_name="tls_arena")


# ------------------------------------------------------------------------------------ Vergleich nach dem Restore

def test_the_restored_state_must_match(tmp_path):
    manifest, *_ = make_pair(tmp_path)
    assert manifest_tool.compare(manifest, snapshot()) == ([], [])
    errors, _notes = manifest_tool.compare(manifest, snapshot(collections={"users": 3, "tournament_registrations": 4,
                                                                           "billing_orders": 2, "sessions": 4}))
    assert errors == ["tournament_registrations: 4 statt 5 Dokumente"]
    errors, _ = manifest_tool.compare(manifest, snapshot(figures={"billing_orders": {"open": {"count": 2, "amount": 2500}},
                                                                  "tournament_registrations": {"approved": {"count": 5}}}))
    assert errors and errors[0].startswith("Summen billing_orders")
    errors, _ = manifest_tool.compare(manifest, snapshot(uploads={"count": 1, "bytes": 10, "digest": "b" * 64}))
    assert errors and errors[0].startswith("Uploads: 1 Dateien")
    errors, _ = manifest_tool.compare(manifest, snapshot(references={"referenced_files": 2, "missing": 1}))
    assert errors == ["Datei-Verweise: 1 fehlende Dateien statt 0"]


def test_missing_surplus_and_kept_collections(tmp_path):
    manifest, *_ = make_pair(tmp_path)
    fewer = snapshot(collections={"users": 3, "tournament_registrations": 5, "billing_orders": 2})
    assert manifest_tool.compare(manifest, fewer)[0] == ["Sammlungen fehlen nach dem Restore: sessions"]
    more = snapshot(collections={**snapshot()["collections"], "neu": 1})
    assert manifest_tool.compare(manifest, more)[0] == ["Sammlungen zu viel nach dem Restore: neu"]
    # Bewusst behalten (RESTORE_EXTRA_COLLECTIONS=keep): kein Fehler.
    assert manifest_tool.compare(manifest, more, kept_extras=["neu"]) == ([], [])


def test_collections_with_a_ttl_index_may_shrink_but_never_grow(tmp_path):
    """Lokaler Restore-Test: rate_limits hatte nach dem Restore einen Eintrag weniger - MongoDB löscht Abgelaufenes selbst."""
    manifest, *_ = make_pair(tmp_path, before=snapshot(ttl_collections=["sessions"]))
    assert manifest["ttl_collections"] == ["sessions"]
    fewer = snapshot(collections={**snapshot()["collections"], "sessions": 1})
    errors, notes = manifest_tool.compare(manifest, fewer)
    assert errors == [] and notes == ["sessions: 1 statt 4 Dokumente (abgelaufene Einträge, TTL)"]
    more = snapshot(collections={**snapshot()["collections"], "sessions": 9})
    assert manifest_tool.compare(manifest, more)[0] == ["sessions: 9 statt 4 Dokumente"]


def test_collections_changed_during_the_pause_are_only_a_note(tmp_path):
    after = snapshot(collections={"users": 3, "tournament_registrations": 5, "billing_orders": 2, "sessions": 5})
    manifest, *_ = make_pair(tmp_path, after=after)
    errors, notes = manifest_tool.compare(manifest, after)
    assert errors == [] and notes == ["sessions: 5 statt 4 Dokumente (in der Pause verändert)"]


# --------------------------------------------------------------------- Uploads: Archiv und Ordner gleich gerechnet

def test_archive_and_folder_give_the_same_fingerprint(tmp_path):
    folder = tmp_path / "uploads"
    (folder / "public" / "variants").mkdir(parents=True)
    (folder / "public" / "logo.webp").write_bytes(b"12345")
    (folder / "public" / "variants" / "logo-400.webp").write_bytes(b"12")
    (folder / "documents").mkdir()
    (folder / "documents" / "Satzung ä.pdf").write_bytes(b"x" * 100)
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as archive:
        archive.add(folder, arcname=".")
    buffer.seek(0)
    from_archive = manifest_tool.tar_digest(buffer)
    from_folder = backup_inventory.files_digest(folder)
    assert from_archive == from_folder
    assert from_folder["count"] == 3 and from_folder["bytes"] == 107
    (folder / "public" / "logo.webp").write_bytes(b"123456")
    assert backup_inventory.files_digest(folder)["digest"] != from_archive["digest"]


def test_a_broken_archive_is_reported(tmp_path):
    with pytest.raises(Exception):
        manifest_tool.tar_digest(io.BytesIO(b"kein archiv"))


# ------------------------------------------------------------------------------- Bestand aus der Datenbank zählen

def test_inventory_counts_collections_totals_and_references(tmp_path):
    async def scenario():
        db = AsyncMongoMockClient()["tls_inventory_tests"]
        await db.users.insert_many([{"id": "u1", "avatar_url": "/api/static/uploads/public/a.webp"}, {"id": "u2", "avatar_url": "/api/static/uploads/public/fehlt.webp"}])
        await db.tournament_registrations.insert_many([{"id": "r1", "status": "approved"}, {"id": "r2", "status": "approved"}, {"id": "r3", "status": "withdrawn"}])
        await db.billing_orders.insert_many([{"id": "b1", "status": "open", "total_cents": 1500}, {"id": "b2", "status": "open", "total_cents": 2500}, {"id": "b3", "status": "paid", "total_cents": 1000}])
        await db.shop_orders.insert_one({"id": "s1", "status": "placed", "frozen": {"total_cents": 2990}})
        await db.memberships.insert_one({"id": "m1"})
        await db.schema_migrations.insert_many([{"version": 1}, {"version": 7}])
        uploads = tmp_path / "uploads"
        (uploads / "public").mkdir(parents=True)
        (uploads / "public" / "a.webp").write_bytes(b"bild")
        return await backup_inventory.snapshot(db, uploads, with_references=True)

    data = asyncio.run(scenario())
    assert data["collections"]["users"] == 2 and data["collections"]["billing_orders"] == 3
    assert data["figures"]["tournament_registrations"] == {"approved": {"count": 2}, "withdrawn": {"count": 1}}
    assert data["figures"]["billing_orders"] == {"open": {"count": 2, "amount": 4000}, "paid": {"count": 1, "amount": 1000}}
    assert data["figures"]["shop_orders"] == {"placed": {"count": 1, "amount": 2990}}
    assert data["figures"]["memberships"] == {"(ohne)": {"count": 1}}
    assert data["schema_version"] == 7 and data["code_schema_version"] >= 23
    assert data["uploads"]["count"] == 1
    assert data["references"]["referenced_files"] == 2 and data["references"]["missing"] == 1


# ------------------------------------------------------------------------------------------- Kommandozeile

def test_command_line_rejects_with_a_clear_message(tmp_path, capsys):
    _manifest, path, *_ = make_pair(tmp_path, project="fremd")
    code = manifest_tool.main(["verify", "--manifest", str(path), "--project", "the-lion-squad", "--db", "tls_arena"])
    assert code == 1
    assert "RESTORE_ALLOW_FOREIGN_PROJECT=fremd" in capsys.readouterr().err
    assert manifest_tool.main(["field", "--manifest", str(path), "--name", "files.mongo.name"]) == 0
    assert capsys.readouterr().out.strip().endswith(".archive.gz.enc")
    assert manifest_tool.main(["verify", "--manifest", str(tmp_path / "fehlt.json"), "--project", "p", "--db", "d"]) == 1


def test_compose_project_prints_only_the_name(monkeypatch, capsys):
    monkeypatch.setattr(sys, "stdin", io.StringIO(json.dumps({"name": "the-lion-squad", "services": {"backend": {"environment": {"JWT_SECRET": "geheim"}}}})))
    assert manifest_tool.main(["compose-project"]) == 0
    out = capsys.readouterr().out
    assert out.strip() == "the-lion-squad" and "geheim" not in out


@pytest.mark.skipif(not BASH or not pathlib.Path(BASH).exists(), reason="Bash required")
def test_the_scripts_find_the_manifest_next_to_the_pair(tmp_path):
    """restore-check.sh und restore.sh nutzen dieselbe Auflösung: JSON neben dem Paar, sonst das alte .txt."""
    (tmp_path / "tls_tls_arena_20261116_031500.archive.gz.enc").write_bytes(b"m")
    (tmp_path / "tls_uploads_20261116_031500.tar.gz.enc").write_bytes(b"u")
    (tmp_path / "tls_backup_20261116_031500.manifest.txt").write_text("alt", encoding="utf-8")
    script = ('source scripts/backup-target.sh; resolve_backup_pair "$@" || exit $?; '
              'printf "%s|%s\\n" "$(basename "$MANIFEST")" "$MANIFEST_LEGACY"')
    pair = [(tmp_path / "tls_tls_arena_20261116_031500.archive.gz.enc").as_posix(), (tmp_path / "tls_uploads_20261116_031500.tar.gz.enc").as_posix()]

    def resolve(*args):
        return subprocess.run([BASH, "-c", script, "resolve", *args], cwd=REPO, text=True, capture_output=True, timeout=30,
                              stdin=subprocess.DEVNULL)

    legacy = resolve(*pair)
    assert legacy.returncode == 0, legacy.stderr
    assert legacy.stdout.strip() == "tls_backup_20261116_031500.manifest.txt|true"
    (tmp_path / "tls_backup_20261116_031500.manifest.json").write_text("{}", encoding="utf-8")
    current = resolve(*pair)
    assert current.stdout.strip() == "tls_backup_20261116_031500.manifest.json|false"
    only_manifest = resolve((tmp_path / "tls_backup_20261116_031500.manifest.json").as_posix())
    assert only_manifest.stdout.strip() == "tls_backup_20261116_031500.manifest.json|false"
    assert resolve((tmp_path / "fehlt.manifest.json").as_posix()).returncode != 0
    # Ein altes .txt allein reicht nicht: es nennt keine vollständigen Pfade.
    assert resolve((tmp_path / "tls_backup_20261116_031500.manifest.txt").as_posix()).returncode != 0


def test_the_pause_document_never_blocks_a_restore(tmp_path):
    """Altes Backup ohne ops_maintenance ins Ziel mit Pause-Dokument (auch mit RESTORE_EXTRA_COLLECTIONS=drop) und
    umgekehrt: kein Abbruch, kein Fehler im Abgleich."""
    manifest, *_ = make_pair(tmp_path)
    assert "ops_maintenance" not in manifest["collections"]
    assert manifest_tool.extras(manifest, [*manifest["collections"], "ops_maintenance"]) == []
    with_pause_doc = snapshot(collections={**snapshot()["collections"], "ops_maintenance": 1})
    assert manifest_tool.compare(manifest, with_pause_doc) == ([], [])
    newer, *_ = make_pair(tmp_path, "20261117_031500", before=with_pause_doc)
    assert manifest_tool.compare(newer, snapshot()) == ([], [])


def test_a_pause_that_did_not_hold_marks_the_backup_unsafe(tmp_path):
    manifest, *_ = make_pair(tmp_path)
    assert manifest["consistent"] is True
    assert manifest_tool.consistent_pause({"mode": "writers_stopped", "drained": True}) is True
    assert manifest_tool.consistent_pause({"mode": "pause", "drained": True, "lease_lapsed": True}) is False
    assert manifest_tool.consistent_pause({"mode": "pause", "drained": False}) is False
    assert manifest_tool.consistent_pause({"mode": "none", "drained": True}) is False


RENEWER = """
source scripts/backup-target.sh
calls="$1/calls"; flag="$1/lapsed"; fail_after="$2"
backend_python() { echo "$*" >>"$calls"; [ "$(wc -l <"$calls")" -le "$fail_after" ]; }
PAUSE_TOKEN=t-1
start_lease_renewer 3 "$flag"
sleep "$3"   # ein langes Upload-Archiv
stop_lease_renewer
sleep 1.5
printf '%s|%s\n' "$(wc -l <"$calls" | tr -d ' ')" "$([ -f "$flag" ] && echo lapsed || echo held)"
"""


def run_renewer(tmp_path, fail_after, seconds):
    result = subprocess.run([BASH, "-c", RENEWER, "renewer", tmp_path.as_posix(), str(fail_after), str(seconds)], cwd=REPO,
                            text=True, capture_output=True, timeout=60, stdin=subprocess.DEVNULL)
    assert result.returncode == 0, result.stderr
    return result.stdout.strip().split("|")


@pytest.mark.skipif(not BASH or not pathlib.Path(BASH).exists(), reason="Bash required")
def test_the_lease_is_renewed_while_a_long_upload_archive_runs(tmp_path):
    """TTL 3 s, das Archiv braucht 5 s: ohne Verlängerung im Hintergrund wäre die Pause mittendrin vorbei."""
    calls, state = run_renewer(tmp_path, 100, 5)
    assert int(calls) >= 3 and state == "held"
    # Nach dem Stopp verlängert niemand mehr (kein verwaister Hintergrundprozess).
    assert open(tmp_path / "calls").read().count("renew --token t-1 --ttl 3") == int(calls)


@pytest.mark.skipif(not BASH or not pathlib.Path(BASH).exists(), reason="Bash required")
def test_a_failed_renewal_is_reported(tmp_path):
    calls, state = run_renewer(tmp_path, 1, 5)
    assert state == "lapsed" and int(calls) == 2


@pytest.mark.skipif(not BASH or not pathlib.Path(BASH).exists(), reason="Bash required")
def test_restore_check_resolves_the_project_itself(tmp_path):
    """Ein BACKUP_PROJECT aus der Umgebung darf die Prüfung nicht umgehen - maßgeblich ist das gewählte Compose-Projekt."""
    stubs = tmp_path / "bin"
    stubs.mkdir()
    config = {"name": "p-echt", "services": {"backend": {
        "environment": {"DB_NAME": "tls_arena", "UPLOAD_DIR": "/app/backend/uploads"},
        "volumes": [{"type": "volume", "source": "uploads_data", "target": "/app/backend/uploads"}]}},
        "volumes": {"uploads_data": {"name": "p-echt_uploads_data"}}}
    (tmp_path / "config.json").write_text(json.dumps(config), encoding="utf-8")
    (stubs / "docker").write_text(f'#!/usr/bin/env bash\ncat "{(tmp_path / "config.json").as_posix()}"\n', encoding="utf-8", newline="\n")
    python = pathlib.Path(sys.executable).as_posix()
    (stubs / "python3").write_text(f'#!/usr/bin/env bash\n"{python}" "$@" | tr -d \'\\r\'\nexit "${{PIPESTATUS[0]}}"\n',
                                   encoding="utf-8", newline="\n")
    for stub in stubs.iterdir():
        stub.chmod(0o755)
    _manifest, path, *_ = make_pair(tmp_path, project="fremd", db="tls_arena")
    password = tmp_path / "password"
    password.write_text("geheim", encoding="utf-8")
    env = {**os.environ, "BACKUP_PROJECT": "fremd", "DB_NAME": "", "BACKUP_ENCRYPTION_PASSWORD_FILE": password.as_posix()}
    script = 'export PATH="$(cd "$2" && pwd):$PATH"; exec bash scripts/restore-check.sh "$1"'
    result = subprocess.run([BASH, "-c", script, "check", path.as_posix(), stubs.as_posix()], cwd=REPO, env=env, text=True,
                            capture_output=True, timeout=60, stdin=subprocess.DEVNULL)
    assert result.returncode == 1
    assert "p-echt" in (result.stdout + result.stderr)
