"""Deploy mit langer Migration (#1006): Healthcheck und ``update.sh`` warten lange genug auf die Bereit-Meldung, und
``update.sh`` liest seine Wartezeit aus ``BACKEND_READY_TIMEOUT``."""
from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
BASH = shutil.which("bash") if os.name != "nt" else r"C:\Program Files\Git\bin\bash.exe"


def _seconds(value: str) -> int:
    value = str(value).strip()
    units = {"s": 1, "m": 60, "h": 3600}
    return int(value[:-1]) * units[value[-1]] if value[-1] in units else int(value)


def test_the_backend_healthcheck_gives_a_long_migration_ten_minutes():
    compose = yaml.safe_load((ROOT / "docker-compose.yml").read_text(encoding="utf-8"))
    check = compose["services"]["backend"]["healthcheck"]
    assert _seconds(check["start_period"]) >= 600
    assert "/api/health" in " ".join(check["test"])


def _timeout_block() -> str:
    """Die Zeilen aus ``update.sh``, die die Wartezeit bestimmen - ausgeführt ohne den Rest des Skripts."""
    lines = (ROOT / "update.sh").read_text(encoding="utf-8").splitlines()
    start = next(i for i, line in enumerate(lines) if line.startswith("BACKEND_READY_TIMEOUT="))
    end = next(i for i in range(start, len(lines)) if lines[i].startswith('info "Waiting for backend health'))
    return "set -euo pipefail\n" + "\n".join(lines[start:end]) + '\necho "$BACKEND_READY_TIMEOUT"\n'


def test_update_sh_has_no_fixed_120_second_limit_any_more():
    text = (ROOT / "update.sh").read_text(encoding="utf-8")
    assert "Backend did not become healthy within 120s" not in text
    assert "docker compose logs" in text.split("BACKEND_READY_TIMEOUT", 1)[1]


@pytest.mark.skipif(not BASH or not Path(BASH).exists(), reason="ohne bash")
@pytest.mark.parametrize(("env_value", "dotenv", "expected"), [
    (None, None, "600"),
    ("900", None, "900"),
    (None, "BACKEND_READY_TIMEOUT=1200\n", "1200"),
    ("kaputt", None, "600"),
    # Dezimal, nicht oktal: führende Nullen, 08 und 09 sind gültige Zahlen.
    ("0600", None, "600"),
    ("090", None, "90"),
    ("08", None, "30"),
    ("09", None, "30"),
    ("000", None, "30"),
    (None, "BACKEND_READY_TIMEOUT=0900\n", "900"),
    # Untergrenze 30 s, Obergrenze ein Tag.
    ("5", None, "30"),
    ("100000", None, "86400"),
    ("99999999999999999999", None, "86400"),
])
def test_update_sh_reads_its_ready_timeout(tmp_path, env_value, dotenv, expected):
    script = tmp_path / "probe.sh"
    script.write_text(_timeout_block(), encoding="utf-8", newline="\n")
    if dotenv is not None:
        (tmp_path / ".env").write_text(dotenv, encoding="utf-8", newline="\n")
    env = {key: value for key, value in os.environ.items() if key != "BACKEND_READY_TIMEOUT"}
    if env_value is not None:
        env["BACKEND_READY_TIMEOUT"] = env_value
    result = subprocess.run([BASH, script.name], cwd=tmp_path, env=env, capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == expected


def test_the_operations_guide_names_the_real_compose_limit():
    """BETRIEB.md nennt, wann schon ``docker compose up`` aufgibt: start_period plus alle Fehlversuche."""
    compose = yaml.safe_load((ROOT / "docker-compose.yml").read_text(encoding="utf-8"))
    check = compose["services"]["backend"]["healthcheck"]
    limit = _seconds(check["start_period"]) + check["retries"] * _seconds(check["interval"])
    guide = (ROOT / "docs" / "BETRIEB.md").read_text(encoding="utf-8")
    assert f"rund {round(limit / 60)} Minuten" in guide
    assert "depends_on: service_healthy" in guide and "docker-compose.override.yml" in guide
