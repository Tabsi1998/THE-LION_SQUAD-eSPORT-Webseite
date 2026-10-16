#!/usr/bin/env python3
"""Bericht über verfügbare größere Updates (#1739).

Dependabot schlägt nur Minor- und Patch-Updates vor; Major-Updates und Expo-Pakete sind in
`.github/dependabot.yml` bewusst ausgeschlossen. Das schützt vor Brüchen, aber dadurch bemerkt
niemand, wenn eine neue Hauptversion erscheint. Dieses Skript listet sie auf - es ändert nichts.

Geprüft werden `frontend/package.json`, `mobile/package.json` und `backend/requirements*.txt`
gegen die öffentlichen Register (npm, PyPI). Pakete, die das Expo-SDK vorgibt, stehen nicht
einzeln im Bericht; dafür meldet er ein neues Expo-SDK.

  major-updates-report.py              Markdown auf stdout, Exit 0
  major-updates-report.py --out FILE   Markdown in FILE; Zeile `count=N` für $GITHUB_OUTPUT auf stdout
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Callable, Iterable

ROOT = Path(__file__).resolve().parents[1]
REPO_URL = "https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/blob/main"

# Diese Pakete gibt das Expo-SDK vor (wie die Ausnahmen in .github/dependabot.yml): sie kommen mit
# einem SDK-Wechsel, nicht einzeln. Der Bericht meldet stattdessen das neue SDK.
EXPO_MANAGED_EXACT = {
    "expo", "react", "react-dom", "react-native", "react-native-keyboard-controller",
    "react-native-reanimated", "react-native-safe-area-context", "react-native-screens",
    "react-native-worklets", "@shopify/react-native-skia", "react-native-svg", "jest-expo",
    "react-native-gesture-handler", "react-native-web", "@types/react",
}
EXPO_MANAGED_PREFIXES = ("expo-", "@expo/")

VERSION_RE = re.compile(r"(\d+)(?:\.(\d+))?(?:\.(\d+))?")


def parse_version(text: str) -> tuple[int, int, int] | None:
    """Erste Versionsnummer aus einer Angabe wie `^1.2.3`, `~57.0.30`, `==2.14.0`, `9.39.5`."""
    if not text:
        return None
    match = VERSION_RE.search(text)
    if not match:
        return None
    major, minor, patch = (int(part) if part else 0 for part in match.groups())
    return major, minor, patch


def is_breaking_jump(current: tuple[int, int, int], latest: tuple[int, int, int]) -> bool:
    """Neue Hauptversion. Unter 1.0 gilt nach SemVer schon eine neue Minor-Version als brechend."""
    if latest[0] != current[0]:
        return latest[0] > current[0]
    if current[0] == 0:
        return latest[1] > current[1]
    return False


def is_expo_managed(name: str) -> bool:
    return name in EXPO_MANAGED_EXACT or name.startswith(EXPO_MANAGED_PREFIXES)


def npm_dependencies(package_json: Path) -> dict[str, str]:
    data = json.loads(package_json.read_text(encoding="utf-8"))
    deps: dict[str, str] = {}
    for section in ("dependencies", "devDependencies"):
        for name, spec in (data.get(section) or {}).items():
            # Nur Versionsangaben aus dem Register; git-, file- und workspace-Angaben bleiben außen vor.
            if any(spec.startswith(prefix) for prefix in ("git", "file:", "link:", "workspace:", "http")):
                continue
            deps[name] = spec
    return deps


REQ_RE = re.compile(r"^\s*([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*==\s*([^\s;#]+)")


def pip_requirements(files: Iterable[Path]) -> dict[str, str]:
    deps: dict[str, str] = {}
    for path in files:
        if not path.is_file():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            match = REQ_RE.match(line)
            if match:
                deps[match.group(1)] = match.group(2)
    return deps


def _get_json(url: str) -> dict | None:
    request = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "lionsquad-major-updates"})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.load(response)
    except Exception:  # noqa: BLE001 - ein nicht erreichbares Paket soll den Bericht nicht abbrechen
        return None


def npm_latest(name: str) -> str | None:
    data = _get_json(f"https://registry.npmjs.org/{urllib.parse.quote(name, safe='@')}/latest")
    return (data or {}).get("version")


def pypi_latest(name: str) -> str | None:
    data = _get_json(f"https://pypi.org/pypi/{urllib.parse.quote(name)}/json")
    return ((data or {}).get("info") or {}).get("version")


def find_majors(deps: dict[str, str], latest_of: Callable[[str], str | None]) -> list[tuple[str, str, str]]:
    """(Name, aktuell, neueste) für jedes Paket mit brechendem Sprung, alphabetisch."""
    names = sorted(deps)
    with ThreadPoolExecutor(max_workers=12) as pool:
        latest_versions = list(pool.map(latest_of, names))
    found = []
    for name, latest in zip(names, latest_versions):
        current = parse_version(deps[name])
        newest = parse_version(latest or "")
        if current and newest and is_breaking_jump(current, newest):
            found.append((name, deps[name], latest))
    return found


def expo_sdk_update(mobile_deps: dict[str, str], latest_of: Callable[[str], str | None]) -> tuple[str, str] | None:
    current = parse_version(mobile_deps.get("expo", ""))
    latest = latest_of("expo")
    newest = parse_version(latest or "")
    if current and newest and newest[0] > current[0]:
        return f"SDK {current[0]}", f"SDK {newest[0]} ({latest})"
    return None


def render(sections: list[tuple[str, list[tuple[str, str, str]]]], expo: tuple[str, str] | None) -> tuple[str, int]:
    count = sum(len(rows) for _, rows in sections) + (1 if expo else 0)
    lines = [
        "Neue Hauptversionen, die Dependabot bewusst nicht vorschlägt (`.github/dependabot.yml`). "
        "Nichts davon passiert automatisch: jedes Update in einem eigenen PR, mit Changelog des Pakets "
        f"und grüner CI ([Ablauf]({REPO_URL}/docs/entwicklung/github.md#größere-updates)).",
        "",
    ]
    if expo:
        lines += [
            "### Expo",
            "",
            f"Neues **Expo-{expo[1]}** verfügbar (installiert: {expo[0]}). Ein SDK-Wechsel hebt React Native, "
            "React und alle `expo-*`-Pakete gemeinsam: `npx expo install expo@latest --fix`, danach die "
            f"Geräteabnahme ([App-Releases]({REPO_URL}/mobile/RELEASES.md)).",
            "",
        ]
    for title, rows in sections:
        if not rows:
            continue
        lines += [f"### {title}", "", "| Paket | im Repo | neueste |", "| --- | --- | --- |"]
        lines += [f"| `{name}` | {current} | {latest} |" for name, current, latest in rows]
        lines.append("")
    if count == 0:
        lines.append("Alles auf der neuesten Hauptversion.")
    return "\n".join(lines).rstrip() + "\n", count


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path)
    args = parser.parse_args(argv)

    frontend = npm_dependencies(ROOT / "frontend/package.json")
    mobile_all = npm_dependencies(ROOT / "mobile/package.json")
    mobile = {name: spec for name, spec in mobile_all.items() if not is_expo_managed(name)}
    backend = pip_requirements([ROOT / "backend/requirements.txt", ROOT / "backend/requirements-dev.txt"])

    sections = [
        ("Website (`frontend/`)", find_majors(frontend, npm_latest)),
        ("App (`mobile/`, ohne Expo-SDK-Pakete)", find_majors(mobile, npm_latest)),
        ("Backend (`backend/`)", find_majors(backend, pypi_latest)),
    ]
    report, count = render(sections, expo_sdk_update(mobile_all, npm_latest))
    if args.out:
        args.out.write_text(report, encoding="utf-8")
        print(f"count={count}")
    else:
        sys.stdout.write(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
