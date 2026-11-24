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
        # Aus der Web-Abzeichenkunst erzeugt die App ihre Motive - der App-Job prüft den Abgleich.
        ("frontend/src/components/achievements/motifs/play.jsx", {"frontend", "mobile", "container"}),
        ("frontend/src/components/achievements/materials.js", {"frontend", "mobile", "container"}),
        ("frontend/src/components/achievements/Badge.jsx", {"frontend", "container"}),
        # Gemeinsame Testfälle von Website und App (#1132, #1140) prüft auch der App-Job.
        ("frontend/src/lib/matchReport.cases.json", {"frontend", "mobile", "container"}),
        ("frontend/src/lib/matchReport.js", {"frontend", "container"}),
        # Die App bündelt die öffentliche FAQ samt Regeln (#2449) - der App-Job prüft den Abgleich.
        ("frontend/src/hilfe/fragen.json", {"frontend", "mobile", "container"}),
        ("frontend/src/hilfe/themen/turniere.json", {"frontend", "mobile", "container"}),
        ("frontend/src/hilfe/index.js", {"frontend", "mobile", "container"}),
        ("frontend/src/hilfe/FaqClip.jsx", {"frontend", "container"}),
        ("scripts/check-secrets.py", {"backend"}),
        # Beide Skripte ruft der Frontend-Job auf.
        ("scripts/check-public-routes.sh", {"backend", "frontend"}),
        ("scripts/compose-backup-target.py", {"backend", "frontend"}),
        # Den gemeinsamen Audit-Auswerter samt Selbsttest rufen Website- und App-Job auf (#1055).
        ("scripts/dependency-audit-gate.cjs", {"backend", "frontend", "mobile"}),
        ("scripts/dependency-audit-gate.test.mjs", {"backend", "frontend", "mobile"}),
        ("scripts/check-web-update.py", {"backend", "container"}),
        # Das Mongo-Image steht hier - der Job „Backend-Abläufe auf MongoDB“ liest es (#2200).
        ("docker-compose.yml", {"backend", "frontend", "container"}),
        ("docker-compose.staging.yml", {"frontend", "container"}),
        (".env.staging.example", {"frontend", "container"}),
        ("install.sh", {"backend"}),
        (".flake8", {"backend"}),
        # Dokumentation braucht nur die Linkprüfung im Backend-Job.
        ("README.md", {"backend"}),
        ("mobile/RELEASES.md", {"backend"}),
        # Das Prüftor (#1660) liest seine Grenzen aus dieser Datei: Wer nur sie ändert, muss durchs Tor - aber nur
        # durchs Tor und die Linkprüfung, nicht durch den ganzen Frontend-Bereich (#2556).
        ("frontend/PERFORMANCE_BUDGETS.md", {"backend", "prueftor"}),
        ("frontend/motion-rules-allowlist.json", {"frontend", "container"}),
        ("frontend/e2e/prueftor-bekannt.json", {"frontend", "container"}),
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


# ---------------------------------------------------------------- Eigener Bereich fürs Prüftor (#2556)

CI_YML = Path(__file__).resolve().parents[2] / ".github/workflows/ci.yml"


def _job_block(text: str, job: str) -> str:
    """Der Text eines Jobs in ci.yml: von ``  <job>:`` bis zum nächsten Job auf derselben Ebene."""
    lines = text.splitlines()
    start = lines.index(f"  {job}:")
    end = next((i for i in range(start + 1, len(lines)) if lines[i].startswith("  ") and not lines[i].startswith("   ")
                and lines[i].strip() and not lines[i].lstrip().startswith("#")), len(lines))
    return "\n".join(lines[start:end])


def test_prueftor_area_reaches_the_gate_job():
    """Der Bereich ``prueftor`` steht in den Ausgaben von „changes“ und startet den Job „Prüftor“ - der Frontend-Bereich
    weiterhin auch."""
    assert "prueftor" in areas.AREAS
    text = CI_YML.read_text(encoding="utf-8")
    assert "prueftor: ${{ steps.areas.outputs.prueftor }}" in _job_block(text, "changes")
    gate = _job_block(text, "prueftor")
    assert "needs.changes.outputs.frontend == 'true'" in gate
    assert "needs.changes.outputs.prueftor == 'true'" in gate


def test_prueftor_runs_the_budget_self_test():
    """``check:bundle`` im Frontend-Job prüft die echten Werte aus PERFORMANCE_BUDGETS.md (check-bundle-budget.test.mjs).
    Startet eine Änderung nur an der Datei nur das Tor, muss das Tor diesen Selbsttest mitlaufen lassen."""
    gate = _job_block(CI_YML.read_text(encoding="utf-8"), "prueftor")
    assert "node --test --test-reporter=dot scripts/check-bundle-budget.test.mjs" in gate


def test_frontend_files_still_start_the_gate_through_the_frontend_area():
    assert "prueftor" not in areas.areas_for("frontend/src/pages/HomePage.jsx")
    assert "frontend" in areas.areas_for("frontend/motion-rules-allowlist.json")
