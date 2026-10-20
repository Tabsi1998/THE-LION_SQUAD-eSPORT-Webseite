"""Betriebsskripte im Backend-Image (#1583, #1050): Die Skripte liegen dort, wo der Container sie findet
(backend/scripts), und die .dockerignore lässt sie samt Laufzeitdateien im Image."""
import pathlib
import subprocess
import sys

import pytest

BACKEND = pathlib.Path(__file__).resolve().parents[1]
REPO = BACKEND.parent


@pytest.mark.parametrize("name", ["media-report.py", "uploads-inventory.py", "unique_index_duplicates.py"])
def test_betriebsskript_laeuft_aus_dem_backend_ordner(name):
    # Im Container ist der Arbeitsordner das Backend (/app): "python3 scripts/<name>" muss dort gehen.
    assert (BACKEND / "scripts" / name).is_file()
    result = subprocess.run(
        [sys.executable, f"scripts/{name}", "--help"],
        cwd=BACKEND, capture_output=True, text=True, timeout=60,
    )
    assert result.returncode == 0, result.stderr
    assert "usage" in result.stdout.lower()


@pytest.mark.parametrize("name", ["media-report.py", "uploads-inventory.py"])
def test_betriebsskript_liegt_nicht_mehr_im_repo_root(name):
    assert not (REPO / "scripts" / name).exists()


def test_dockerignore_laesst_laufzeitdateien_im_backend_image():
    lines = [
        line.strip().rstrip("/")
        for line in (BACKEND / ".dockerignore").read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.startswith("#")
    ]
    for needed in ("scripts", "static", "docker-entrypoint.py", "requirements.txt", "services", "routes"):
        assert needed not in lines
    for unwanted in ("tests", "uploads", ".env", "__pycache__"):
        assert unwanted in lines
