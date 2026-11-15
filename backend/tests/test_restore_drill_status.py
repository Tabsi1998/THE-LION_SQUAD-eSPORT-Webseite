"""A restore that was never proven must not look the same as a proven one."""
import os
import shutil
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest


REPO = Path(__file__).resolve().parents[2]
SCRIPT = REPO / "scripts" / "restore-drill-status.sh"
BASH = shutil.which("bash") if os.name != "nt" else r"C:\Program Files\Git\bin\bash.exe"
# Das Skript rechnet mit der echten Uhr des Systems: in der Zeitreise-Probe (#775) läuft die Datei nicht mit.
pytestmark = [pytest.mark.skipif(not BASH or not Path(BASH).exists(), reason="Bash required"), pytest.mark.real_clock]


def run_status(log_path, max_age_days=None):
    env = {**os.environ, "RESTORE_DRILL_LOG": str(log_path)}
    if max_age_days is not None:
        env["RESTORE_DRILL_MAX_AGE_DAYS"] = str(max_age_days)
    return subprocess.run(
        [BASH, str(SCRIPT)],
        cwd=REPO,
        env=env,
        text=True,
        capture_output=True,
        stdin=subprocess.DEVNULL,
        timeout=30,
    )


def drill_line(days_ago, status="ok", archive="tls_tls_arena_20260908.archive.gz.enc"):
    stamp = (datetime.now(timezone.utc) - timedelta(days=days_ago)).strftime("%Y-%m-%dT%H:%M:%SZ")
    return f"{stamp} status={status} archive={archive} db=tls_arena summary={{collections:42,users:317}}"


def test_missing_log_is_reported_as_never_proven(tmp_path):
    result = run_status(tmp_path / "restore-drills.log")
    assert result.returncode == 2
    assert "never been proven" in result.stderr


def test_recent_success_passes(tmp_path):
    log = tmp_path / "restore-drills.log"
    log.write_text(drill_line(2) + "\n", encoding="utf8", newline="\n")
    result = run_status(log)
    assert result.returncode == 0, result.stderr
    assert "2 day(s) ago" in result.stdout


def test_stale_success_fails(tmp_path):
    log = tmp_path / "restore-drills.log"
    log.write_text(drill_line(90) + "\n", encoding="utf8", newline="\n")
    result = run_status(log)
    assert result.returncode == 1
    assert "90 days ago" in result.stderr


def test_custom_age_limit_is_respected(tmp_path):
    log = tmp_path / "restore-drills.log"
    log.write_text(drill_line(10) + "\n", encoding="utf8", newline="\n")
    assert run_status(log, max_age_days=7).returncode == 1
    assert run_status(log, max_age_days=30).returncode == 0


def test_only_failed_drills_do_not_count_as_proof(tmp_path):
    log = tmp_path / "restore-drills.log"
    log.write_text(drill_line(1, status="failed") + "\n", encoding="utf8", newline="\n")
    result = run_status(log)
    assert result.returncode == 1
    assert "no successful drill" in result.stderr


def test_latest_success_wins_over_older_entries(tmp_path):
    log = tmp_path / "restore-drills.log"
    log.write_text(
        "\n".join([drill_line(200), drill_line(120, status="failed"), drill_line(3)]) + "\n",
        encoding="utf8",
        newline="\n",
    )
    result = run_status(log)
    assert result.returncode == 0, result.stderr
    assert "3 day(s) ago" in result.stdout


def test_a_later_failure_does_not_erase_a_recent_success(tmp_path):
    """The check answers 'was a restore proven recently', not 'was the last run green'."""
    log = tmp_path / "restore-drills.log"
    log.write_text(drill_line(2) + "\n" + drill_line(1, status="failed") + "\n", encoding="utf8", newline="\n")
    assert run_status(log).returncode == 0
