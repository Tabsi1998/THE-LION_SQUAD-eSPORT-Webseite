"""Zeitreise-Probe (#775): Zeitpunkte, Ergebnisse und Meldung als Issue - ohne Netz."""
import importlib.util
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location(
    "zeitreise_report", Path(__file__).resolve().parents[2] / "scripts/zeitreise_report.py"
)
report = importlib.util.module_from_spec(spec)
spec.loader.exec_module(report)

NOW = datetime(2026, 11, 16, 3, 30, tzinfo=timezone.utc)  # Montag, KW 47


@pytest.mark.parametrize(
    ("jump", "expected"),
    [
        ("+1m", "2026-12-16T03:30:00Z"),
        ("+6m", "2027-05-16T03:30:00Z"),
        ("+1y", "2027-11-16T03:30:00Z"),
        ("+2w", "2026-11-30T03:30:00Z"),
        ("+10d", "2026-11-26T03:30:00Z"),
        ("2027-03-01", "2027-03-01T03:30:00Z"),
        ("2027-03-01T12:00:00+01:00", "2027-03-01T11:00:00Z"),
    ],
)
def test_jumps_are_counted_from_now(jump, expected):
    assert report.iso(report.when(jump, NOW)) == expected


def test_a_month_jump_keeps_to_the_last_day_of_a_short_month():
    assert report.iso(report.when("+1m", datetime(2027, 1, 31, 8, tzinfo=timezone.utc))) == "2027-02-28T08:00:00Z"
    assert report.iso(report.when("+1y", datetime(2028, 2, 29, 8, tzinfo=timezone.utc))) == "2029-02-28T08:00:00Z"


@pytest.mark.parametrize("jump", ["", "6m", "+6x", "morgen", "+1m; rm -rf /"])
def test_a_wrong_jump_is_refused(jump):
    with pytest.raises(ValueError, match="Zeitpunkt"):
        report.when(jump, NOW)


def test_junit_reports_name_failures_and_errors(tmp_path):
    junit = tmp_path / "junit.xml"
    junit.write_text(
        '<testsuites><testsuite name="pytest">'
        '<testcase classname="backend.tests.test_season" name="test_ok"/>'
        '<testcase classname="backend.tests.test_season" name="test_deadline"><failure message="x"/></testcase>'
        '<testcase classname="" name="backend.tests.test_broken"><error message="collection failure"/></testcase>'
        '<testcase classname="src/lib/a.test.js" name="Frist &gt; läuft ab"><skipped/></testcase>'
        "</testsuite></testsuites>",
        encoding="utf-8",
    )
    assert report.failed_from_junit(junit) == ["backend.tests.test_season::test_deadline", "backend.tests.test_broken"]


def test_jest_reports_name_failed_tests_and_files_that_did_not_run(tmp_path):
    data = {"testResults": [
        {"name": "/w/mobile/src/lib/a.test.ts", "status": "failed",
         "assertionResults": [{"status": "passed", "fullName": "a ok"}, {"status": "failed", "fullName": "a Frist"}]},
        {"name": "/w/mobile/src/lib/b.test.ts", "status": "failed", "assertionResults": []},
        {"name": "/w/mobile/src/lib/c.test.ts", "status": "passed", "assertionResults": [{"status": "passed"}]},
    ]}
    path = tmp_path / "jest.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    assert report.failed_from_jest(path, "/w/mobile") == [
        "src/lib/a.test.ts::a Frist",
        "src/lib/b.test.ts::(Datei lief nicht)",
    ]


def test_collect_without_a_report_keeps_the_outcome(tmp_path):
    result = report.collect("web", "+6m", "2027-05-16T03:30:00Z", "failure", tmp_path / "fehlt.xml")
    assert result == {"part": "web", "jump": "+6m", "now": "2027-05-16T03:30:00Z", "outcome": "failure",
                      "failed": [], "report": False}


def result(part, jump, now, failed=()):
    return {"part": part, "jump": jump, "now": now, "outcome": "failure" if failed else "success",
            "failed": list(failed)}


def week(failing=()):
    """Neun Ergebnisse; ``failing`` = (Teil, Sprung, Testname)."""
    times = {"+1m": "2026-12-16T03:30:00Z", "+6m": "2027-05-16T03:30:00Z", "+1y": "2027-11-16T03:30:00Z"}
    rows = []
    for part in ("backend", "web", "app"):
        for jump, now in times.items():
            names = [name for p, j, name in failing if (p, j) == (part, jump)]
            rows.append(result(part, jump, now, names))
    return rows


def test_each_test_tips_at_its_earliest_probe_day():
    results = week([("backend", "+6m", "t::frist"), ("backend", "+1y", "t::frist"), ("web", "+1y", "w::termin")])
    assert report.tipping(results) == {("backend", "t::frist"): "2027-05-16T03:30:00Z",
                                       ("web", "w::termin"): "2027-11-16T03:30:00Z"}
    text = report.render(results, 9)
    assert "**rot**" in text
    assert "| `t::frist` | Backend (pytest) | 16.05.2027 |" in text
    assert text.index("t::frist") < text.index("w::termin")


def test_names_cannot_break_the_table():
    text = report.render([result("app", "+1m", "2026-12-16T03:30:00Z", ["a|b`c\nd"])], 1)
    assert "`a\\|b'c d`" in text


class FakeGh:
    def __init__(self, issues=(), body="", comments=(), milestones=(report.MILESTONE,)):
        self.issues, self.body, self.comments, self.milestones = list(issues), body, list(comments), list(milestones)
        self.calls = []

    def __call__(self, args, stdin=None):
        self.calls.append((args, stdin))
        if args[:2] == ["issue", "list"]:
            return json.dumps(self.issues)
        if args[:2] == ["issue", "view"]:
            return json.dumps({"body": self.body, "comments": [{"body": text} for text in self.comments]})
        if args[0] == "api":
            return json.dumps(self.milestones)
        return ""

    def made(self, verb):
        return [call for call in self.calls if call[0][:2] == ["issue", verb]]


def test_red_opens_an_issue_with_labels_milestone_and_earliest_day():
    gh = FakeGh()
    done = report.notify(week([("app", "+6m", "src/x.test.ts::x")]), 9, "https://run", "refs/heads/main", gh, NOW)
    assert done == "angelegt"
    (args, body), = gh.made("create")
    assert args[args.index("--title") + 1] == "Zeitreise: Test kippt ab 16.05.2027"
    assert [args[i + 1] for i, arg in enumerate(args) if arg == "--label"] == ["testing", "bug", "priority:P2"]
    assert args[args.index("--milestone") + 1] == report.MILESTONE
    assert "src/x.test.ts::x" in body and "<!-- zeitreise-woche:2026-W47 -->" in body


def test_without_the_milestone_the_issue_is_opened_anyway():
    gh = FakeGh(milestones=[])
    report.notify(week([("app", "+6m", "x")]), 9, "https://run", "refs/heads/main", gh, NOW)
    (args, _), = gh.made("create")
    assert "--milestone" not in args


def test_a_failing_milestone_lookup_does_not_stop_the_report():
    class Broken(FakeGh):
        def __call__(self, args, stdin=None):
            if args[0] == "api":
                raise subprocess.CalledProcessError(1, "gh")
            return super().__call__(args, stdin)

    gh = Broken()
    assert report.notify(week([("app", "+6m", "x")]), 9, "https://run", "refs/heads/main", gh, NOW) == "angelegt"


def test_red_again_adds_one_comment_per_week_and_moves_the_title():
    issue = {"number": 7, "title": "Zeitreise: Test kippt ab 16.05.2027"}
    gh = FakeGh([issue], body="alt <!-- zeitreise-woche:2026-W46 -->")
    results = week([("backend", "+1m", "t::neu")])
    assert report.notify(results, 9, "https://run", "refs/heads/main", gh, NOW) == "ergänzt"
    assert len(gh.made("comment")) == 1
    (args, _), = gh.made("edit")
    assert args[args.index("--title") + 1] == "Zeitreise: Test kippt ab 16.12.2026"

    again = FakeGh([issue], comments=["<!-- zeitreise-woche:2026-W47 -->"])
    assert report.notify(results, 9, "https://run", "refs/heads/main", again, NOW) == "diese Woche schon gemeldet"
    assert again.made("comment") == [] and again.made("edit") == []


def test_only_a_full_green_week_closes_the_issue():
    issue = {"number": 7, "title": "Zeitreise: Test kippt ab 16.05.2027"}
    partial = FakeGh([issue])
    assert report.notify(week()[:8], 9, "https://run", "refs/heads/main", partial, NOW) == "ergänzt"
    assert partial.made("close") == [] and partial.made("edit") == []

    full = FakeGh([issue])
    assert report.notify(week(), 9, "https://run", "refs/heads/main", full, NOW) == "geschlossen"
    assert len(full.made("close")) == 1


def test_runs_off_main_are_never_reported():
    gh = FakeGh()
    assert report.notify(week([("web", "+1m", "x")]), 9, "https://run", "refs/heads/ci/775-zeitreise", gh, NOW) == (
        "nur Läufe auf main werden gemeldet"
    )
    assert gh.calls == []


def test_the_command_line_writes_results_and_a_summary(tmp_path):
    out = tmp_path / "ergebnis" / "web-1.json"
    junit = tmp_path / "junit.xml"
    junit.write_text('<testsuite><testcase classname="a.test.js" name="t"><failure/></testcase></testsuite>',
                     encoding="utf-8")
    assert report.main(["collect", "--part", "web", "--jump", "+1m", "--now", "2026-12-16T03:30:00Z",
                        "--outcome", "failure", "--input", str(junit), "--out", str(out)]) == 0
    assert json.loads(out.read_text(encoding="utf-8"))["failed"] == ["a.test.js::t"]
    summary = tmp_path / "summary.md"
    assert report.main(["summary", "--results", str(tmp_path / "ergebnis"), "--expected", "1",
                        "--out", str(summary)]) == 0
    assert "`a.test.js::t`" in summary.read_text(encoding="utf-8")
