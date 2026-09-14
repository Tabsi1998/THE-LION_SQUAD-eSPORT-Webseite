import importlib.util
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location(
    "ci_changed_areas", Path(__file__).resolve().parents[2] / "scripts/ci-changed-areas.py"
)
areas = importlib.util.module_from_spec(spec)
spec.loader.exec_module(areas)

ALL = set(areas.AREAS)


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        ("backend/routes/tournament_crud_routes.py", {"backend", "container"}),
        ("backend/requirements.txt", {"backend", "container"}),
        ("frontend/src/pages/HomePage.jsx", {"frontend", "container"}),
        # test_security_hardening_unit.py liest die nginx-Konfiguration.
        ("frontend/nginx.conf", {"backend", "frontend", "container"}),
        ("frontend/Dockerfile", {"frontend", "container"}),
        ("mobile/app/index.tsx", {"mobile"}),
        ("scripts/check-secrets.py", {"backend"}),
        # Beide Skripte ruft der Frontend-Job auf.
        ("scripts/check-public-routes.sh", {"backend", "frontend"}),
        ("scripts/compose-backup-target.py", {"backend", "frontend"}),
        ("scripts/check-web-update.py", {"backend", "container"}),
        ("docker-compose.yml", {"frontend", "container"}),
        ("docker-compose.staging.yml", {"frontend", "container"}),
        (".env.staging.example", {"frontend", "container"}),
        ("install.sh", {"backend"}),
        (".flake8", {"backend"}),
        # Dokumentation braucht nur die Linkprüfung im Backend-Job.
        ("README.md", {"backend"}),
        ("mobile/RELEASES.md", {"backend"}),
        (".gitignore", set()),
    ],
)
def test_paths_start_only_the_jobs_they_can_break(path, expected):
    assert areas.areas_for(path) == expected


@pytest.mark.parametrize(
    "path",
    [
        ".github/workflows/ci.yml",
        ".github/dependabot.yml",
        "scripts/ci-changed-areas.py",
        # Unbekannte Pfade lieber zu oft prüfen als gar nicht.
        "tools/new-generator.py",
        ".gitattributes",
    ],
)
def test_workflow_changes_and_unknown_paths_start_every_job(path):
    assert areas.areas_for(path) == ALL


def test_output_lists_every_area_for_github_outputs(monkeypatch, capsys):
    monkeypatch.setattr(areas.sys, "argv", ["ci-changed-areas.py", "--all"])
    assert areas.main() == 0
    lines = capsys.readouterr().out.splitlines()
    assert lines == [f"{area}=true" for area in areas.AREAS]


def test_unreadable_history_falls_back_to_every_job(monkeypatch, capsys):
    def broken(*_args):
        raise areas.subprocess.CalledProcessError(128, ["git"], stderr="bad revision")

    monkeypatch.setattr(areas, "git_lines", broken)
    monkeypatch.setattr(areas.sys, "argv", ["ci-changed-areas.py", "--base", "missing", "--head", "HEAD"])
    assert areas.main() == 0
    assert capsys.readouterr().out.splitlines() == [f"{area}=true" for area in areas.AREAS]
