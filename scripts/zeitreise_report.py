#!/usr/bin/env python3
"""Zeitreise-Probe (#775): Zeitpunkte ausrechnen, Ergebnisse sammeln und rote Tests als Issue melden.

Die Probe lässt Backend (pytest), Web (Vitest) und App (Jest) mit verstellter Uhr laufen (``TLS_TEST_NOW``), so als
wäre heute in einem Monat, in sechs Monaten oder in einem Jahr. Was dort rot wird, kippt ohne Änderung am Code von
selbst, sobald der echte Kalender so weit ist. Ablauf und Regeln: docs/entwicklung/zeitreise.md.

  zeitreise_report.py when +6m                       ISO-Zeitpunkt in UTC (Sprünge: +Nd, +Nw, +Nm, +Ny oder ein Datum)
  zeitreise_report.py collect --part backend --jump +6m --now ISO --outcome success|failure \\
                              --input junit.xml|jest.json --out result.json
  zeitreise_report.py summary --results DIR --out FILE    Markdown-Bericht aller Teile
  zeitreise_report.py notify --results DIR --run-url URL --ref REF --expected 9
                                                     Issue anlegen, ergänzen oder schließen (gh, GH_TOKEN)

Im Issue stehen nur Testnamen, Teil und Zeitpunkt - keine Ausgaben der Tests.
"""
from __future__ import annotations

import argparse
import calendar
import json
import re
import subprocess
import xml.etree.ElementTree as ET  # nosec B405 - eigene Testberichte des Laufs, keine fremden Daten
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

TITLE_PREFIX = "Zeitreise: Test kippt ab"
LABELS = ("testing", "bug", "priority:P2")
MILESTONE = "Qualität: Performance, Tests und CI"
PARTS = {"backend": "Backend (pytest)", "web": "Web (Vitest)", "app": "App (Jest)"}
MAX_ROWS = 40
MAX_NAME = 200
JUMP = re.compile(r"\+(\d{1,3})([dwmy])")


# ------------------------------------------------------------------ Zeitpunkte

def add_months(day: date, months: int) -> date:
    """Monate dazu; gibt es den Tag im Zielmonat nicht (31.), gilt der letzte."""
    index = day.month - 1 + months
    year, month = day.year + index // 12, index % 12 + 1
    return day.replace(year=year, month=month, day=min(day.day, calendar.monthrange(year, month)[1]))


def when(spec: str, now: datetime | None = None) -> datetime:
    """Der Zeitpunkt der Probe in UTC: ein Sprung ab jetzt (+1m, +6m, +1y, +2w, +10d) oder ein ISO-Datum."""
    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc).replace(microsecond=0)
    text = (spec or "").strip()
    match = JUMP.fullmatch(text)
    if match:
        count, unit = int(match.group(1)), match.group(2)
        if unit in "dw":
            return now + timedelta(days=count * (7 if unit == "w" else 1))
        day = add_months(now.date(), count * (12 if unit == "y" else 1))
        return datetime.combine(day, now.timetz())
    try:
        moment = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        raise ValueError(f'Zeitpunkt als +1m, +6m, +1y, +2w, +10d oder ISO-Datum angeben, nicht "{spec}"') from None
    if len(text) == 10:  # nur ein Tag: die Uhrzeit von jetzt
        moment = datetime.combine(moment.date(), now.timetz())
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc)


def iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------- Ergebnisse

def failed_from_junit(path: Path) -> list[str]:
    """Rote Tests aus einem JUnit-Bericht (pytest, Vitest): ``Datei/Klasse::Test``."""
    names = []
    for case in ET.parse(path).getroot().iter("testcase"):  # nosec B314 - eigener Bericht dieses Laufs
        if case.find("failure") is not None or case.find("error") is not None:
            where, name = case.get("classname") or "", case.get("name") or ""
            names.append(f"{where}::{name}" if where else name)
    return names


def failed_from_jest(path: Path, root: str = "") -> list[str]:
    """Rote Tests aus ``jest --json``; eine Datei, die gar nicht lief, zählt mit ihrem Pfad."""
    data = json.loads(path.read_text(encoding="utf-8"))
    names = []
    for suite in data.get("testResults", []):
        file = str(suite.get("name") or "").replace("\\", "/")
        if root and file.startswith(root):
            file = file[len(root):].lstrip("/")
        failing = [test for test in suite.get("assertionResults", []) if test.get("status") == "failed"]
        for test in failing:
            names.append(f"{file}::{test.get('fullName') or test.get('title') or ''}")
        if suite.get("status") == "failed" and not failing:
            names.append(f"{file}::(Datei lief nicht)")
    return names


def collect(part: str, jump: str, now: str, outcome: str, source: Path | None, root: str = "") -> dict:
    failed: list[str] = []
    readable = True
    if source is not None and source.is_file():
        try:
            failed = failed_from_jest(source, root) if source.suffix == ".json" else failed_from_junit(source)
        except (ET.ParseError, json.JSONDecodeError, OSError):
            readable = False
    else:
        readable = False
    return {"part": part, "jump": jump, "now": now, "outcome": outcome, "failed": failed,
            "report": readable}


def load_results(folder: Path) -> list[dict]:
    results = []
    for path in sorted(folder.rglob("*.json")) if folder.is_dir() else []:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(data, dict) and data.get("part") in PARTS and data.get("now"):
            results.append(data)
    return results


def tipping(results: list[dict]) -> dict[tuple[str, str], str]:
    """Je (Teil, Test) der früheste Zeitpunkt, an dem er rot ist."""
    first: dict[tuple[str, str], str] = {}
    for result in results:
        for name in result.get("failed") or []:
            key = (result["part"], str(name))
            if key not in first or result["now"] < first[key]:
                first[key] = result["now"]
    return first


def green(results: list[dict], expected: int) -> bool:
    return len(results) >= expected and all(result.get("outcome") == "success" for result in results)


# ------------------------------------------------------------------- Bericht

def day(moment: str) -> str:
    return datetime.fromisoformat(moment.replace("Z", "+00:00")).strftime("%d.%m.%Y")


def cell(text: str) -> str:
    flat = " ".join(str(text).split()).replace("|", "\\|").replace("`", "'")
    return flat if len(flat) <= MAX_NAME else flat[: MAX_NAME - 1] + "…"


def earliest(results: list[dict]) -> str | None:
    red = [result["now"] for result in results if result.get("outcome") != "success"]
    return min(red) if red else None


def render(results: list[dict], expected: int) -> str:
    if not results:
        return ("## Zeitreise-Probe: **rot**\n\nKein Teil hat ein Ergebnis abgelegt - die Einrichtung ist vorher "
                "gescheitert. Die Schritte im Lauf zeigen, wo.\n")
    ok = green(results, expected)
    lines = [f"## Zeitreise-Probe: {'grün' if ok else '**rot**'}", "",
             "| Teil | Sprung | Uhr im Test | Ergebnis |", "| --- | --- | --- | --- |"]
    for result in sorted(results, key=lambda item: (list(PARTS).index(item["part"]), item["now"])):
        verdict = "grün" if result.get("outcome") == "success" else f"**rot** ({len(result.get('failed') or [])} Tests)"
        lines.append(f"| {PARTS[result['part']]} | {cell(result.get('jump', ''))} | {day(result['now'])} | {verdict} |")
    if len(results) < expected:
        lines += ["", f"Nur {len(results)} von {expected} Teilen haben ein Ergebnis abgelegt."]
    first = tipping(results)
    if first:
        lines += ["", "### Was kippt", "", "| Test | Teil | rot ab (frühester Probe-Tag) |", "| --- | --- | --- |"]
        ordered = sorted(first.items(), key=lambda item: (item[1], item[0]))
        for (part, name), moment in ordered[:MAX_ROWS]:
            lines.append(f"| `{cell(name)}` | {PARTS[part]} | {day(moment)} |")
        if len(ordered) > MAX_ROWS:
            lines.append(f"\n… und {len(ordered) - MAX_ROWS} weitere, siehe Lauf.")
    silent = [result for result in results if result.get("outcome") != "success" and not result.get("failed")]
    if silent:
        lines += ["", "Rot ohne Testnamen (Einrichtung, Abbruch oder Bericht fehlt): "
                  + ", ".join(f"{PARTS[item['part']]} {cell(item.get('jump', ''))}" for item in silent) + "."]
    return "\n".join(lines) + "\n"


# ------------------------------------------------------------------- Meldung

Gh = Callable[..., str]


def run_gh(args: list[str], stdin: str | None = None) -> str:
    return subprocess.run(["gh", *args], input=stdin, text=True, encoding="utf-8", capture_output=True,
                          check=True).stdout


def week_marker(now: datetime) -> str:
    year, week, _ = now.isocalendar()
    return f"<!-- zeitreise-woche:{year}-W{week:02d} -->"


def open_issue(gh: Gh) -> dict | None:
    # Nur über den Titel: Wer das Label von Hand ändert, bekommt sonst ein zweites Issue.
    listed = gh(["issue", "list", "--state", "open", "--search", f'in:title "{TITLE_PREFIX}"',
                 "--json", "number,title"])
    for issue in json.loads(listed or "[]"):
        if str(issue.get("title", "")).startswith(TITLE_PREFIX):
            return issue
    return None


def reported_this_week(gh: Gh, number: int, marker: str) -> bool:
    data = json.loads(gh(["issue", "view", str(number), "--json", "body,comments"]) or "{}")
    texts = [data.get("body") or ""] + [comment.get("body") or "" for comment in data.get("comments") or []]
    return any(marker in text for text in texts)


def milestone_exists(gh: Gh) -> bool:
    try:
        listed = gh(["api", "repos/{owner}/{repo}/milestones?state=open&per_page=100", "--jq", "[.[].title]"])
    except subprocess.CalledProcessError:
        return False
    return MILESTONE in json.loads(listed or "[]")


def earlier_than_title(moment: str, title: str) -> bool:
    """Liegt ``moment`` vor dem Tag im Titel? Ein Titel ohne lesbaren Tag gilt als später."""
    try:
        shown = datetime.strptime(title[len(TITLE_PREFIX):].strip()[:10], "%d.%m.%Y").date()
    except ValueError:
        return True
    return datetime.fromisoformat(moment.replace("Z", "+00:00")).date() < shown


def notify(results: list[dict], expected: int, run_url: str, ref: str, gh: Gh = run_gh,
           now: datetime | None = None) -> str:
    """Rot: Issue anlegen oder ergänzen (höchstens einmal je Woche). Volle Woche grün auf main: schließen."""
    if ref != "refs/heads/main":
        return "nur Läufe auf main werden gemeldet"
    now = now or datetime.now(timezone.utc)
    marker = week_marker(now)
    report = render(results, expected)
    footer = f"\n<sub>Lauf vom {now:%d.%m.%Y}: {run_url}</sub>\n{marker}\n"
    issue = open_issue(gh)
    if green(results, expected):
        if issue is None:
            return "nichts zu tun"
        gh(["issue", "comment", str(issue["number"]), "--body-file", "-"],
           stdin="Eine volle Woche grün: alle Teile, alle Zeitpunkte.\n\n" + report + footer)
        gh(["issue", "close", str(issue["number"]), "--reason", "completed"])
        return "geschlossen"
    first = earliest(results)
    # Ohne roten Teil (Ergebnisse fehlen) bleibt ein vorhandener Titel stehen.
    title = f"{TITLE_PREFIX} {day(first)}" if first else f"{TITLE_PREFIX} ? (Lauf unvollständig)"
    if issue is not None:
        number = str(issue["number"])
        if reported_this_week(gh, issue["number"], marker):
            return "diese Woche schon gemeldet"
        gh(["issue", "comment", number, "--body-file", "-"], stdin=report + footer)
        # Der Titel nennt den frühesten Tag, an dem etwas kippt: nur ein früherer Tag ersetzt ihn.
        if first and earlier_than_title(first, str(issue.get("title", ""))):
            gh(["issue", "edit", number, "--title", title])
        return "ergänzt"
    intro = ("Die wöchentliche Zeitreise-Probe (#775, docs/entwicklung/zeitreise.md) ist rot: Mit verstellter Uhr "
             "kippen diese Tests. Ohne Änderung am Code werden sie spätestens am genannten Tag auch in der normalen "
             "CI rot. Termine in den Testdaten relativ zu heute setzen oder die Uhr im Test feststellen. Rote Wochen "
             "kommen als Kommentar dazu; nach einer vollen grünen Woche auf main schließt sich das Issue.\n\n")
    args = ["issue", "create", "--title", title, "--body-file", "-"]
    for label in LABELS:
        args += ["--label", label]
    if milestone_exists(gh):
        args += ["--milestone", MILESTONE]
    gh(args, stdin=intro + report + footer)
    return "angelegt"


# ---------------------------------------------------------------------- main

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    when_cmd = sub.add_parser("when")
    when_cmd.add_argument("spec")
    collect_cmd = sub.add_parser("collect")
    collect_cmd.add_argument("--part", choices=sorted(PARTS), required=True)
    collect_cmd.add_argument("--jump", required=True)
    collect_cmd.add_argument("--now", required=True)
    collect_cmd.add_argument("--outcome", required=True)
    collect_cmd.add_argument("--input", type=Path)
    collect_cmd.add_argument("--root", default="")
    collect_cmd.add_argument("--out", type=Path, required=True)
    summary_cmd = sub.add_parser("summary")
    summary_cmd.add_argument("--results", type=Path, required=True)
    summary_cmd.add_argument("--expected", type=int, default=9)
    summary_cmd.add_argument("--out", type=Path, required=True)
    notify_cmd = sub.add_parser("notify")
    notify_cmd.add_argument("--results", type=Path, required=True)
    notify_cmd.add_argument("--expected", type=int, default=9)
    notify_cmd.add_argument("--run-url", required=True)
    notify_cmd.add_argument("--ref", required=True)
    args = parser.parse_args(argv)

    if args.command == "when":
        try:
            print(iso(when(args.spec)))
        except ValueError as error:
            parser.error(str(error))
        return 0
    if args.command == "collect":
        result = collect(args.part, args.jump, args.now, args.outcome, args.input, args.root.replace("\\", "/"))
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"{args.part} {args.jump}: {args.outcome}, {len(result['failed'])} rote Tests")
        return 0
    results = load_results(args.results)
    if args.command == "summary":
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(render(results, args.expected), encoding="utf-8")
        return 0
    print(f"Meldung: {notify(results, args.expected, args.run_url, args.ref)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
