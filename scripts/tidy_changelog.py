#!/usr/bin/env python3
"""Changelog der Website lesbar machen (Fabian 19.10.2026).

release-please schreibt je Eintrag Issue-Link, PR-Link und Commit-Hash und je Version einen Vergleichs-Link. Für
Vorstand und Mitglieder bleibt nur, was man lesen will:

    ## 1.2.0 (19.10.2026)

    ### Neu

    * TV-Warteschlange nennt im Lauf die Namen (#1634)

Je Eintrag zählt die erste Nummer (das Issue aus dem PR-Titel); die Nummer, die GitHub beim Squash anhängt (der PR),
und der Commit-Hash fallen weg. Hat ein Titel keine Issue-Nummer, bleibt die PR-Nummer. GitHub verlinkt „#1634“
von selbst.

Aufruf:
    python3 scripts/tidy_changelog.py CHANGELOG.md               # Datei an Ort und Stelle aufräumen
    python3 scripts/tidy_changelog.py CHANGELOG.md --section 1.2.0  # Abschnitt einer Version (Release-Text) ausgeben
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

HEADER = re.compile(r"^##\s+\[?(?P<version>\d+\.\d+\.\d+)\]?(?:\([^)]*\))?\s*\((?P<date>\d{4}-\d{2}-\d{2})\)\s*$")
TIDY_HEADER = re.compile(r"^##\s+(?P<version>\d+\.\d+\.\d+)\s+\((?P<date>\d{2}\.\d{2}\.\d{4})\)\s*$")
COMMIT_LINK = re.compile(r"\s*\(\[[0-9a-f]{7,40}\]\([^)]*/commit/[0-9a-f]+\)\)")
REF_LINK = re.compile(r"\(\[#(\d+)\]\([^)]*\)\)")
PLAIN_REF = re.compile(r"\s*\(#(\d+)\)")


def tidy_header(line: str) -> str:
    match = HEADER.match(line)
    if not match:
        return line
    year, month, day = match.group("date").split("-")
    return f"## {match.group('version')} ({day}.{month}.{year})"


def tidy_entry(line: str) -> str:
    """Ein Eintrag: Commit-Hash weg, Links zu „(#123)“, nur die erste Nummer bleibt."""
    if not line.lstrip().startswith("*"):
        return line
    text = COMMIT_LINK.sub("", line)
    text = REF_LINK.sub(lambda match: f"(#{match.group(1)})", text)
    refs = PLAIN_REF.findall(text)
    if len(refs) <= 1:
        return text.rstrip()
    body = PLAIN_REF.sub("", text).rstrip()
    return f"{body} (#{refs[0]})"


def tidy(text: str) -> str:
    lines = [tidy_entry(tidy_header(line)) for line in text.splitlines()]
    out: list[str] = []
    for line in lines:
        # Höchstens eine Leerzeile hintereinander.
        if line.strip() == "" and out and out[-1].strip() == "":
            continue
        out.append(line)
    return "\n".join(out).rstrip() + "\n"


def section(text: str, version: str) -> str:
    """Der aufgeräumte Abschnitt einer Version ohne Überschrift - für den Text des GitHub-Release."""
    lines = tidy(text).splitlines()
    start = None
    for index, line in enumerate(lines):
        match = TIDY_HEADER.match(line)
        if match and match.group("version") == version:
            start = index + 1
            continue
        if start is not None and line.startswith("## "):
            return "\n".join(lines[start:index]).strip() + "\n"
    return "\n".join(lines[start:]).strip() + "\n" if start is not None else ""


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("path", type=Path)
    parser.add_argument("--section", metavar="VERSION")
    args = parser.parse_args(argv)
    text = args.path.read_text(encoding="utf-8")
    if args.section:
        body = section(text, args.section)
        if not body.strip():
            print(f"Version {args.section} nicht im Changelog", file=sys.stderr)
            return 1
        sys.stdout.write(body)
        return 0
    tidied = tidy(text)
    if tidied != text:
        args.path.write_text(tidied, encoding="utf-8", newline="\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
