"""Eigener Upload-Host in der CSP: der Build trägt VITE_BACKEND_URL und VITE_UPLOAD_BACKEND_URL in connect-src ein.

Ohne den Eintrag blockierte der Browser jeden Upload an upload.lionsquad.at schon vor dem Senden - die Oberfläche zeigte
nur „Network Error“, Backend und nginx sahen keine Anfrage.
"""
from __future__ import annotations

import pathlib
import shutil
import subprocess

import pytest

FRONTEND = pathlib.Path(__file__).resolve().parents[2] / "frontend"
SCRIPT = FRONTEND / "csp-connect-origins.sh"
SH = shutil.which("sh")

pytestmark = pytest.mark.skipif(SH is None, reason="sh fehlt (läuft in der CI unter Linux)")


def connect_sources(conf: pathlib.Path) -> list[str]:
    lines = conf.read_text(encoding="utf-8").splitlines()
    policy = next(line for line in lines if line.strip().startswith('default "default-src'))
    directive = next(part.strip() for part in policy.split(";") if part.strip().startswith("connect-src"))
    return directive.split()[1:]


def run(tmp_path: pathlib.Path, *urls: str) -> tuple[subprocess.CompletedProcess, pathlib.Path]:
    conf = tmp_path / "default.conf"
    if not conf.exists():
        shutil.copy(FRONTEND / "nginx.conf", conf)
    result = subprocess.run([SH, str(SCRIPT), str(conf), *urls], capture_output=True, text=True, encoding="utf-8",
                            check=False)
    return result, conf


def test_without_addresses_the_policy_stays_as_it_is(tmp_path):
    result, conf = run(tmp_path, "", "")
    assert result.returncode == 0, result.stderr
    assert conf.read_text(encoding="utf-8") == (FRONTEND / "nginx.conf").read_text(encoding="utf-8")


def test_upload_host_lands_in_connect_src_only(tmp_path):
    result, conf = run(tmp_path, "", "https://upload.lionsquad.at/")
    assert result.returncode == 0, result.stderr
    sources = connect_sources(conf)
    assert sources[:2] == ["'self'", "https://upload.lionsquad.at"]
    assert conf.read_text(encoding="utf-8").count("https://upload.lionsquad.at") == 1


def test_path_is_cut_off_and_port_kept(tmp_path):
    result, conf = run(tmp_path, "https://api.example.at:8443/api/v1?x=1", "http://upload.example.at")
    assert result.returncode == 0, result.stderr
    sources = connect_sources(conf)
    assert "https://api.example.at:8443" in sources
    assert "http://upload.example.at" in sources


def test_running_twice_adds_nothing_twice(tmp_path):
    run(tmp_path, "https://upload.lionsquad.at")
    result, conf = run(tmp_path, "https://upload.lionsquad.at", "https://upload.lionsquad.at")
    assert result.returncode == 0, result.stderr
    assert connect_sources(conf).count("https://upload.lionsquad.at") == 1


@pytest.mark.parametrize("bad", ["upload.lionsquad.at", "https://evil.example; script-src *", "javascript:alert(1)",
                                 "https://host_x.example", "https://host x.example", "ftp://upload.example.at"])
def test_odd_addresses_stop_the_build(tmp_path, bad):
    result, conf = run(tmp_path, bad)
    assert result.returncode != 0
    assert "ungültige Adresse" in result.stderr
    assert conf.read_text(encoding="utf-8") == (FRONTEND / "nginx.conf").read_text(encoding="utf-8")


def test_the_image_runs_the_script_with_both_addresses():
    dockerfile = (FRONTEND / "Dockerfile").read_text(encoding="utf-8")
    final_stage = dockerfile.split("FROM nginx", 1)[1]
    assert 'csp-connect-origins.sh /etc/nginx/conf.d/default.conf "$VITE_BACKEND_URL" "$VITE_UPLOAD_BACKEND_URL"' in final_stage
    assert "ARG VITE_UPLOAD_BACKEND_URL" in final_stage
    assert "csp-connect-origins.sh" not in (FRONTEND / ".dockerignore").read_text(encoding="utf-8").split("\n# Pakete")[1]
