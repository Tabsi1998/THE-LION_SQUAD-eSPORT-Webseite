"""Nächtlicher Abnahme-Test (#1656): Bericht aus den Playwright-Ergebnissen und Meldung als Issue - ohne Netz."""
import importlib.util
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "nightly_abnahme_report", Path(__file__).resolve().parents[2] / "scripts/nightly_abnahme_report.py"
)
report = importlib.util.module_from_spec(spec)
# dataclasses sucht das Modul in sys.modules.
sys.modules[spec.name] = report
spec.loader.exec_module(report)


def playwright_report(*tests, errors=()):
    """Kleiner Playwright-JSON-Bericht: Datei-Suite > describe > Tests (titel, status, fehlertext)."""
    specs = []
    for title, status, message in tests:
        result = {"status": "failed" if status == "unexpected" else "passed", "duration": 1000}
        if message:
            result["error"] = {"message": message}
            result["errors"] = [{"message": message}]
        specs.append({"title": title, "ok": status != "unexpected",
                      "tests": [{"projectName": "chromium", "status": status, "results": [] if status == "skipped" else [result]}]})
    return {
        "suites": [{"title": "abnahme/beispiel.spec.js", "file": "abnahme/beispiel.spec.js", "specs": [],
                    "suites": [{"title": "Abnahme: Beispiel", "specs": specs, "suites": []}]}],
        "errors": [{"message": message} for message in errors],
    }


def write_run(results: Path, name: str, seed_rc=0, seed_s=20, spec_rc=0, spec_s=95, data=None, seed_log="", spec_log=""):
    folder = results / name
    folder.mkdir(parents=True, exist_ok=True)
    if data is not None:
        (folder / "report.json").write_text(json.dumps(data), encoding="utf-8")
    (folder / "seed.log").write_text(seed_log, encoding="utf-8")
    (folder / "spec.log").write_text(spec_log, encoding="utf-8")
    with (results / "runs.tsv").open("a", encoding="utf-8") as handle:
        handle.write(f"{name}\t{seed_rc}\t{seed_s}\t{spec_rc}\t{spec_s}\n")


def test_first_error_line_drops_colours_and_blank_lines():
    text = "\x1b[31m\n  Error: expect(locator).toBeVisible() failed\x1b[39m\n\nLocator: getByText('x')"
    assert report.first_error_line(text) == "Error: expect(locator).toBeVisible() failed"
    assert len(report.first_error_line("x" * 500)) <= report.MAX_LINE
    assert report.first_error_line("") == ""


def test_green_spec_counts_tests_and_duration(tmp_path):
    write_run(tmp_path, "tv-abnahme", spec_s=130, seed_s=25,
              data=playwright_report(("Show", "expected", None), ("Sofort", "expected", None), ("Bahn", "expected", None)))
    outcomes = report.collect(tmp_path)
    assert [o.name for o in outcomes] == ["tv-abnahme"]
    tv = outcomes[0]
    assert tv.green and tv.passed == 3 and tv.failed == 0 and tv.failures == []
    text, green = report.render(outcomes)
    assert green
    assert "| `tv-abnahme` | grün | 3 von 3 | 2:10 (Seed 0:25) |" in text
    assert "Was rot ist" not in text


def test_red_spec_names_test_and_first_error_line(tmp_path):
    write_run(tmp_path, "advancement-modes-abnahme", spec_rc=1, data=playwright_report(
        ("Admin: Modus", "expected", None),
        ("Show-Auslosung | Runde", "unexpected", "\x1b[31mTimeoutError: locator.click: Timeout 10000ms exceeded.\x1b[39m\nCall log:"),
    ))
    write_run(tmp_path, "matchplan-abnahme", data=playwright_report(("Matchplan", "expected", None)))
    outcomes = report.collect(tmp_path)
    text, green = report.render(outcomes)
    assert not green
    red = outcomes[0]
    assert not red.green and red.passed == 1 and red.failed == 1
    assert red.failures == [("Abnahme: Beispiel › Show-Auslosung | Runde", "TimeoutError: locator.click: Timeout 10000ms exceeded.")]
    assert "| `advancement-modes-abnahme` | **rot** | 1 von 2, 1 rot |" in text
    # Ein „|“ im Testnamen bricht die Tabelle nicht, und die Fehlerzeile steht unter „Was rot ist“.
    assert "Show-Auslosung \\| Runde" in text
    assert "TimeoutError: locator.click: Timeout 10000ms exceeded." in text
    assert "| `matchplan-abnahme` | grün | 1 von 1 |" in text


def test_seed_failure_is_red_and_quotes_the_last_seed_line(tmp_path):
    write_run(tmp_path, "tv-abnahme", seed_rc=1, spec_s=0, seed_log="Seed läuft\nAssertionError: Datenbank nicht die der Abnahme\n")
    outcome = report.collect(tmp_path)[0]
    assert not outcome.green
    assert outcome.failures == [("Seed (scripts/seed_abnahme*.py)", "AssertionError: Datenbank nicht die der Abnahme")]
    assert "Seed rot" in report.render([outcome])[0]


def test_all_skipped_or_missing_report_is_red_not_green(tmp_path):
    write_run(tmp_path, "fastlap-abnahme", data=playwright_report(("Helfer", "skipped", None), ("TV", "skipped", None)))
    write_run(tmp_path, "vor-ort-abnahme", spec_rc=1, spec_log="Error: Cannot find module '@playwright/test'\n")
    skipped, missing = report.collect(tmp_path)
    assert not skipped.green and skipped.skipped == 2
    assert skipped.failures == [("Spec", "kein Test gelaufen (alle übersprungen) - passt der Seed-Stand?")]
    assert not missing.green
    assert missing.failures == [("Playwright (Exit 1)", "Error: Cannot find module '@playwright/test'")]


def test_skipped_tests_beside_passing_ones_stay_green_but_are_counted(tmp_path):
    write_run(tmp_path, "matchplan-praxis-abnahme", data=playwright_report(("A", "expected", None), ("B", "skipped", None)))
    outcome = report.collect(tmp_path)[0]
    assert outcome.green
    assert "| `matchplan-praxis-abnahme` | grün | 1 von 2, 1 übersprungen |" in report.render([outcome])[0]


def test_errors_outside_tests_and_non_zero_exit_turn_the_spec_red(tmp_path):
    write_run(tmp_path, "tv-abnahme", spec_rc=1,
              data=playwright_report(("A", "expected", None), errors=["Error: No tests found.\nMake sure..."]))
    outcome = report.collect(tmp_path)[0]
    assert not outcome.green
    assert outcome.failures == [("Playwright (Exit 1)", "Error: No tests found.")]


def test_missing_results_mean_the_setup_failed(tmp_path):
    assert report.collect(tmp_path / "gibt-es-nicht") == []
    text, green = report.render([])
    assert not green
    assert "kam nicht bis zu den Tests" in text


def test_summary_command_writes_markdown_and_status_for_github_output(tmp_path, capsys):
    results = tmp_path / "ergebnisse"
    write_run(results, "tv-abnahme", data=playwright_report(("A", "expected", None)))
    out = tmp_path / "summary.md"
    assert report.main(["summary", "--results", str(results), "--out", str(out)]) == 0
    assert capsys.readouterr().out.splitlines() == ["status=green", "failed=0"]
    assert "grün" in out.read_text(encoding="utf-8")


class FakeGh:
    """Nimmt die gh-Aufrufe entgegen statt GitHub; `issues` sind die offenen Issues (Nummer, Titel)."""

    def __init__(self, issues=()):
        self.issues = list(issues)
        self.calls = []

    def __call__(self, args, stdin=None):
        self.calls.append((args, stdin))
        if args[:2] == ["issue", "list"]:
            return json.dumps([{"number": number, "title": title} for number, title in self.issues])
        if args[:2] == ["issue", "create"]:
            return "https://github.com/beispiel/repo/issues/77\n"
        return ""

    def commands(self):
        return [args[:2] + args[2:3] for args, _ in self.calls if args[:2] != ["issue", "list"]]


NOW = datetime(2026, 10, 20, 1, 5, tzinfo=timezone.utc)
RUN = "https://github.com/beispiel/repo/actions/runs/1"


def test_red_without_open_issue_creates_one_with_report_and_run_link():
    gh = FakeGh(issues=[(5, "Nächtlicher Abnahme-Test rot (alt, anderer Titel)")])
    assert report.notify(False, "BERICHT", RUN, gh=gh, now=NOW) == "angelegt"
    args, body = gh.calls[-1]
    assert args[:2] == ["issue", "create"]
    assert args[args.index("--title") + 1] == report.ISSUE_TITLE
    assert args[args.index("--label") + 1] == "testing"
    assert "BERICHT" in body and RUN in body and "20.10.2026" in body


def test_red_with_open_issue_only_adds_a_comment():
    gh = FakeGh(issues=[(12, report.ISSUE_TITLE)])
    assert report.notify(False, "BERICHT", RUN, gh=gh, now=NOW) == "kommentiert"
    assert gh.commands() == [["issue", "comment", "12"]]
    assert "BERICHT" in gh.calls[-1][1]


def test_green_after_red_comments_and_closes_the_issue():
    gh = FakeGh(issues=[(12, report.ISSUE_TITLE)])
    assert report.notify(True, "BERICHT", RUN, gh=gh, now=NOW) == "geschlossen"
    assert gh.commands() == [["issue", "comment", "12"], ["issue", "close", "12"]]
    assert gh.calls[1][1].startswith("Wieder grün")


def test_green_without_open_issue_does_nothing():
    gh = FakeGh()
    assert report.notify(True, "BERICHT", RUN, gh=gh, now=NOW) == "nichts zu tun"
    assert gh.commands() == []
