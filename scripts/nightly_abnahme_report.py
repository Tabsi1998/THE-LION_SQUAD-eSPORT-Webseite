#!/usr/bin/env python3
"""Bericht und Meldung des nächtlichen Abnahme-Tests (#1656).

`scripts/run_abnahme_all.sh run` spielt jede Abnahme-Spec mit frischem Seed davor durch und legt je Spec einen
Ordner an (seed.log, spec.log, report.json von Playwright) sowie eine Zeile in runs.tsv
(Name, Exit Seed, Sekunden Seed, Exit Spec, Sekunden Spec). Dieses Skript macht daraus einen kurzen Bericht und meldet
ein rotes Ergebnis als Issue - ein offenes Issue mit demselben Titel bekommt einen Kommentar, nach dem ersten grünen
Lauf wird es geschlossen. Der Bericht nennt nur Specs, Testnamen und Fehlerzeilen - Testdaten, keine Zugänge.

  nightly_abnahme_report.py summary --results DIR --out FILE   Markdown in FILE; `status=green|red`, `failed=N` auf stdout
  nightly_abnahme_report.py notify --results DIR --run-url URL Issue anlegen, kommentieren oder schließen (gh, GH_TOKEN)
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

ISSUE_TITLE = "Nächtlicher Abnahme-Test rot"
ISSUE_LABEL = "testing"
MAX_LINE = 200
ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")


@dataclass
class Outcome:
    name: str
    seed_seconds: int = 0
    spec_seconds: int = 0
    passed: int = 0
    failed: int = 0
    skipped: int = 0
    # (wo, erste Fehlerzeile) - wo ist der Testname mit describe davor, oder Seed/Playwright
    failures: list[tuple[str, str]] = field(default_factory=list)

    @property
    def green(self) -> bool:
        return not self.failures


def first_error_line(text: str) -> str:
    """Erste nicht leere Zeile einer Fehlermeldung, ohne Farbcodes, gekürzt."""
    for line in ANSI.sub("", text or "").splitlines():
        line = line.strip()
        if line:
            return line if len(line) <= MAX_LINE else line[: MAX_LINE - 1] + "…"
    return ""


def last_line(path: Path) -> str:
    try:
        lines = [line for line in path.read_text(encoding="utf-8", errors="replace").splitlines() if line.strip()]
    except OSError:
        return ""
    return first_error_line(lines[-1]) if lines else ""


def walk_tests(suite: dict, titles: list[str]):
    """(Titelpfad, Test) für jeden Test einer Suite samt Unter-Suites."""
    for spec in suite.get("specs", []):
        for test in spec.get("tests", []):
            yield [*titles, spec.get("title", "")], test
    for child in suite.get("suites", []):
        yield from walk_tests(child, [*titles, child.get("title", "")])


def read_playwright(outcome: Outcome, data: dict) -> None:
    for top in data.get("suites", []):
        # Die oberste Suite ist die Datei selbst - ihr Name steht schon in der Spalte „Spec“.
        for titles, test in walk_tests(top, []):
            status = test.get("status")
            if status == "skipped":
                outcome.skipped += 1
            elif status in ("expected", "flaky"):
                outcome.passed += 1
            else:
                outcome.failed += 1
                message = ""
                for result in test.get("results", []):
                    error = result.get("error") or next(iter(result.get("errors") or []), None)
                    if error:
                        message = error.get("message") or error.get("value") or ""
                        break
                where = " › ".join(title for title in titles if title)
                outcome.failures.append((where, first_error_line(message) or "ohne Fehlermeldung"))


def collect(results: Path) -> list[Outcome]:
    """Ein Ergebnis je Zeile in runs.tsv; leer, wenn der Lauf nicht bis zu den Tests kam."""
    runs = results / "runs.tsv"
    if not runs.is_file():
        return []
    outcomes = []
    for row in runs.read_text(encoding="utf-8").splitlines():
        if not row.strip():
            continue
        name, seed_rc, seed_s, spec_rc, spec_s = row.split("\t")
        outcome = Outcome(name, seed_seconds=int(seed_s), spec_seconds=int(spec_s))
        folder = results / name
        if seed_rc != "0":
            outcome.failures.append(("Seed (scripts/seed_abnahme*.py)", last_line(folder / "seed.log") or f"Exit {seed_rc}"))
            outcomes.append(outcome)
            continue
        report_file = folder / "report.json"
        data = None
        if report_file.is_file():
            try:
                data = json.loads(report_file.read_text(encoding="utf-8"))
            except ValueError:
                data = None
        if data is None:
            outcome.failures.append((f"Playwright (Exit {spec_rc})", last_line(folder / "spec.log") or "kein Bericht"))
            outcomes.append(outcome)
            continue
        read_playwright(outcome, data)
        if not outcome.failures:
            errors = data.get("errors") or []
            if errors or spec_rc != "0":
                message = first_error_line((errors[0].get("message") or "") if errors else "") or last_line(folder / "spec.log")
                outcome.failures.append((f"Playwright (Exit {spec_rc})", message or "Fehler außerhalb der Tests"))
            elif outcome.passed == 0:
                outcome.failures.append(("Spec", "kein Test gelaufen (alle übersprungen) - passt der Seed-Stand?"))
        outcomes.append(outcome)
    return outcomes


def clock(seconds: int) -> str:
    return f"{seconds // 60}:{seconds % 60:02d}"


def cell(text: str) -> str:
    return text.replace("|", "\\|").replace("`", "'")


def render(outcomes: list[Outcome]) -> tuple[str, bool]:
    """Markdown-Bericht und ob alles grün ist."""
    if not outcomes:
        return ("## Nächtlicher Abnahme-Test: **rot**\n\n"
                "Der Lauf kam nicht bis zu den Tests: Bau oder Start des Abnahme-Stands, Pakete oder Browser sind "
                "fehlgeschlagen. Die Schritte davor im Lauf zeigen, wo.\n", False)
    green = all(outcome.green for outcome in outcomes)
    red = [outcome for outcome in outcomes if not outcome.green]
    total = sum(outcome.seed_seconds + outcome.spec_seconds for outcome in outcomes)
    lines = [
        f"## Nächtlicher Abnahme-Test: {'grün' if green else '**rot**'}",
        "",
        f"{len(outcomes) - len(red)} von {len(outcomes)} Specs grün, Gesamtdauer {clock(total)}. "
        "Vor jeder Spec frisch geseedet.",
        "",
        "| Spec | Ergebnis | Tests | Dauer |",
        "| --- | --- | --- | --- |",
    ]
    for outcome in outcomes:
        count = outcome.passed + outcome.failed + outcome.skipped
        tests = f"{outcome.passed} von {count}" if count else "–"
        if outcome.failed:
            tests += f", {outcome.failed} rot"
        if outcome.skipped:
            tests += f", {outcome.skipped} übersprungen"
        if outcome.green:
            verdict = "grün"
        elif outcome.failures and outcome.failures[0][0].startswith("Seed"):
            verdict = "**rot** (Seed rot)"
        else:
            verdict = "**rot**"
        lines.append(f"| `{outcome.name}` | {verdict} | {tests} | {clock(outcome.spec_seconds)} "
                     f"(Seed {clock(outcome.seed_seconds)}) |")
    if red:
        lines += ["", "### Was rot ist", ""]
        for outcome in red:
            for where, message in outcome.failures:
                lines.append(f"- `{outcome.name}` – {cell(where)}: {cell(message)}")
    return "\n".join(lines) + "\n", green


Gh = Callable[..., str]


def run_gh(args: list[str], stdin: str | None = None) -> str:
    return subprocess.run(["gh", *args], input=stdin, text=True, encoding="utf-8", capture_output=True,
                          check=True).stdout


def open_issue(gh: Gh) -> int | None:
    listed = gh(["issue", "list", "--state", "open", "--search", f'in:title "{ISSUE_TITLE}"', "--json", "number,title"])
    for issue in json.loads(listed or "[]"):
        if issue.get("title") == ISSUE_TITLE:
            return int(issue["number"])
    return None


def vienna_now() -> datetime:
    try:
        from zoneinfo import ZoneInfo

        return datetime.now(ZoneInfo("Europe/Vienna"))
    except Exception:  # noqa: BLE001 - ohne Zeitzonendaten reicht UTC für das Datum
        return datetime.now(timezone.utc)


def notify(green: bool, summary: str, run_url: str, gh: Gh = run_gh, now: datetime | None = None) -> str:
    """Rot: Issue anlegen oder kommentieren. Grün nach Rot: kommentieren und schließen. Gibt zurück, was geschah."""
    stamp = (now or vienna_now()).strftime("%d.%m.%Y")
    footer = f"\n<sub>Lauf vom {stamp}: [Bericht, Bilder und Traces]({run_url})</sub>\n"
    number = open_issue(gh)
    if green:
        if number is None:
            return "nichts zu tun"
        gh(["issue", "comment", str(number), "--body-file", "-"], stdin="Wieder grün.\n\n" + summary + footer)
        gh(["issue", "close", str(number), "--reason", "completed"])
        return "geschlossen"
    if number is not None:
        gh(["issue", "comment", str(number), "--body-file", "-"], stdin=summary + footer)
        return "kommentiert"
    intro = ("Der nächtliche Abnahme-Test (Workflow „Nächtliche Abnahme“, docs/entwicklung/abnahme-lokal.md) ist rot. "
             "Weitere rote Nächte kommen als Kommentar dazu; nach dem ersten grünen Lauf schließt sich das Issue.\n\n")
    gh(["issue", "create", "--title", ISSUE_TITLE, "--label", ISSUE_LABEL, "--body-file", "-"],
       stdin=intro + summary + footer)
    return "angelegt"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    summary = sub.add_parser("summary")
    summary.add_argument("--results", type=Path, required=True)
    summary.add_argument("--out", type=Path, required=True)
    notify_cmd = sub.add_parser("notify")
    notify_cmd.add_argument("--results", type=Path, required=True)
    notify_cmd.add_argument("--run-url", required=True)
    args = parser.parse_args(argv)

    outcomes = collect(args.results)
    text, green = render(outcomes)
    if args.command == "summary":
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(text, encoding="utf-8")
        print(f"status={'green' if green else 'red'}")
        print(f"failed={sum(1 for outcome in outcomes if not outcome.green) if outcomes else 1}")
        return 0
    print(f"Meldung: {notify(green, text, args.run_url)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
