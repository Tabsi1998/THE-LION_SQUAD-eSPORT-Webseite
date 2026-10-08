#!/usr/bin/env python3
"""Muster, für die GitHubs Code-Scanning (CodeQL) einen Pull Request rot färbt - schon vor dem Push finden (#1408).

Regel 1 - Aufruf mit Wirkung in einem assert (CodeQL „py/side-effect-in-assert“, Stufe Fehler), im ganzen
Backend, Tests eingeschlossen. Python lässt assert weg, sobald es mit -O läuft; der Aufruf fiele dann mit weg.
Es zählen die Namen, die CodeQL als Wirkung liest (delete, open, write, append, pop, remove, discard, close,
print, exit, subprocess.call/check_call/check_output, yield), dazu Schreibzugriffe auf die Datenbank. Anfragen
wie post, put, patch oder get liest CodeQL nicht als Wirkung - so geprüfte Tests bleiben erlaubt.

Regel 2 - unbenutzte Importe und Variablen (flake8 F401/F841), nur in Python-Dateien, die gegenüber origin/main
geändert oder neu sind, und nur, was dort neu dazukommt: was eine Datei schon vorher hatte, hält niemanden auf.
Ohne flake8 oder ohne origin/main (flacher Checkout) wird Regel 2 übersprungen.

    python scripts/check-code-patterns.py [--python PFAD-ZU-PYTHON-MIT-FLAKE8] [--base origin/main]
"""
from __future__ import annotations

import argparse
import ast
import collections
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import NamedTuple

ROOT = Path(__file__).resolve().parents[1]
IGNORED = {".git", ".venv", "venv", "node_modules", "__pycache__", ".pytest_cache"}
# Was CodeQL in einem assert als Wirkung liest (py/side-effect-in-assert) ...
CODEQL_EFFECTS = {"print", "write", "append", "pop", "remove", "discard", "delete", "close", "open", "exit"}
# ... und Schreibzugriffe auf die Datenbank, die ebenso mit dem assert wegfielen.
DATABASE_WRITES = {"insert_one", "insert_many", "update_one", "update_many", "replace_one", "delete_one",
                   "delete_many", "save"}
EFFECTS = CODEQL_EFFECTS | DATABASE_WRITES
SUBPROCESS_CALLS = {"call", "check_call", "check_output"}
LINT_RULES = {"F401": "Import wird nicht benutzt - den Import entfernen",
              "F841": "Variable wird gesetzt, aber nie benutzt - die Zuweisung entfernen oder den Wert benutzen"}
Lint = tuple[str, int, str, str]  # Datei, Zeile, Regel, Text


class Finding(NamedTuple):
    path: str
    line: int
    name: str


def effect_of(node: ast.AST) -> str | None:
    """Der Name, unter dem ein Ausdruck als Wirkung zählt - sonst None."""
    if isinstance(node, (ast.Yield, ast.YieldFrom)):
        return "yield"
    if not isinstance(node, ast.Call):
        return None
    func = node.func
    if isinstance(func, ast.Attribute):
        if isinstance(func.value, ast.Name) and func.value.id == "subprocess" and func.attr in SUBPROCESS_CALLS:
            return f"subprocess.{func.attr}"
        return func.attr if func.attr in EFFECTS else None
    if isinstance(func, ast.Name) and func.id in EFFECTS:
        return func.id
    return None


def first_effect(node: ast.Assert) -> str | None:
    """Die erste Wirkung irgendwo im assert - in der Bedingung wie in der Meldung."""
    for inner in ast.walk(node):
        effect = effect_of(inner)
        if effect:
            return effect
    return None


def python_files(root: Path, folder: str = "backend"):
    for path in sorted((root / folder).rglob("*.py")):
        if not IGNORED.intersection(path.relative_to(root).parts):
            yield path


def side_effect_asserts(root: Path = ROOT) -> list[Finding]:
    """Regel 1: jedes assert im Backend, das einen Aufruf mit Wirkung enthält - einmal je assert."""
    found = []
    for path in python_files(root):
        name = path.relative_to(root).as_posix()
        try:
            tree = ast.parse(path.read_bytes(), filename=name)
        except SyntaxError as error:
            found.append(Finding(name, error.lineno or 0, "Syntaxfehler"))
            continue
        for node in ast.walk(tree):
            effect = first_effect(node) if isinstance(node, ast.Assert) else None
            if effect:
                found.append(Finding(name, node.lineno, effect))
    return sorted(found, key=lambda item: (item.path, item.line))


def git(root: Path, *arguments: str) -> subprocess.CompletedProcess | None:
    try:
        return subprocess.run(["git", "-C", str(root), *arguments], capture_output=True, check=False, timeout=120)
    except (OSError, subprocess.SubprocessError):
        return None


def changed_python_files(root: Path, base: str) -> tuple[str | None, list[str]]:
    """Der gemeinsame Stand mit ``base`` und die Python-Dateien, die seitdem geändert oder neu sind - committet,
    vorgemerkt, offen oder noch nicht versioniert. (None, []), wenn es ``base`` hier nicht gibt."""
    merge_base = git(root, "merge-base", base, "HEAD")
    if not merge_base or merge_base.returncode != 0:
        return None, []
    commit = merge_base.stdout.decode().strip()
    names = set()
    for arguments in (("diff", "--name-only", "--no-renames", "--diff-filter=AM", commit, "--", "*.py"),
                      ("ls-files", "--others", "--exclude-standard", "--", "*.py")):
        listed = git(root, *arguments)
        if listed and listed.returncode == 0:
            names.update(line.strip() for line in listed.stdout.decode("utf-8", "replace").splitlines() if line.strip())
    return commit, sorted(name for name in names if (root / name).is_file())


def flake8_available(python: str) -> bool:
    try:
        return subprocess.run([python, "-c", "import flake8"], capture_output=True, check=False,
                              timeout=120).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def lint(python: str, folder: Path, files: list[str]) -> list[Lint]:
    """flake8 F401/F841 über ``files`` (relativ zu ``folder``): (Datei, Zeile, Regel, Text) je Fund."""
    if not files:
        return []
    completed = subprocess.run(
        [python, "-m", "flake8", "--select=F401,F841", "--format=%(path)s|%(row)d|%(code)s|%(text)s", *files],
        cwd=folder, env={**os.environ, "PYTHONUTF8": "1"}, capture_output=True, text=True, encoding="utf-8",
        errors="replace", check=False, timeout=900)
    if completed.returncode not in (0, 1):
        raise RuntimeError(f"flake8 lief nicht: {completed.stderr.strip()[-500:]}")
    findings = []
    for line in completed.stdout.splitlines():
        parts = line.split("|", 3)
        if len(parts) == 4 and parts[1].isdigit():
            findings.append((Path(parts[0]).as_posix().removeprefix("./"), int(parts[1]), parts[2], parts[3]))
    return findings


def new_findings(now: list[Lint], before: list[Lint]) -> list[Lint]:
    """Was ``now`` mehr hat als ``before`` - verglichen ohne Zeilennummer, weil sich Zeilen verschieben."""
    known = collections.Counter((path, code, text) for path, _, code, text in before)
    fresh = []
    for path, line, code, text in now:
        if known[(path, code, text)]:
            known[(path, code, text)] -= 1
        else:
            fresh.append((path, line, code, text))
    return fresh


def new_unused_names(root: Path, python: str, base: str) -> tuple[list[Lint], str]:
    """Regel 2: neue unbenutzte Importe und Variablen in geänderten Dateien - dazu, was geprüft wurde."""
    if not flake8_available(python):
        return [], "Regel 2 übersprungen: flake8 fehlt (--python mit der Backend-Umgebung angeben)"
    commit, files = changed_python_files(root, base)
    if commit is None:
        return [], f"Regel 2 übersprungen: {base} gibt es hier nicht"
    if not files:
        return [], "keine geänderten Python-Dateien"
    now = lint(python, root, files)
    with tempfile.TemporaryDirectory(prefix="code-patterns-") as folder:
        older = []
        for name in files:
            shown = git(root, "show", f"{commit}:{name}")
            if shown and shown.returncode == 0:
                target = Path(folder) / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(shown.stdout)
                older.append(name)
        before = lint(python, Path(folder), older)
    return new_findings(now, before), f"{len(files)} geänderte Python-Datei(en)"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--python", default=sys.executable, help="Python mit flake8 (Standard: dieses)")
    parser.add_argument("--base", default="origin/main", help="Vergleichsstand für Regel 2")
    parser.add_argument("--root", type=Path, default=ROOT, help=argparse.SUPPRESS)
    parser.add_argument("--skip-lint", action="store_true", help="nur Regel 1")
    arguments = parser.parse_args(argv)
    root = arguments.root.resolve()
    # Umlaute auch dann lesbar, wenn die Ausgabe in eine Datei oder ein anderes Programm geht.
    if hasattr(sys.stdout, "reconfigure") and (sys.stdout.encoding or "").lower().replace("-", "") != "utf8":
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    asserts = side_effect_asserts(root)
    if arguments.skip_lint:
        unused, checked = [], "Regel 2 übersprungen"
    else:
        unused, checked = new_unused_names(root, arguments.python, arguments.base)
    for item in asserts:
        what = "Datei lässt sich nicht lesen" if item.name == "Syntaxfehler" else f"assert mit Wirkung („{item.name}“)"
        print(f"{item.path}:{item.line}: {what} - CodeQL py/side-effect-in-assert")
    if asserts:
        print("  So geht's: zuerst aufrufen, dann prüfen - z. B. antwort = await flow.delete(...) und danach "
              "assert antwort.status_code == 200. Python lässt assert mit -O weg, der Aufruf fiele mit weg.")
    for path, line, code, text in unused:
        print(f"{path}:{line}: {LINT_RULES.get(code, code)} ({code}: {text})")
    if asserts or unused:
        print(f"Code-Muster: {len(asserts)} assert mit Wirkung, {len(unused)} neue unbenutzte Namen ({checked}).")
        return 1
    print(f"Code-Muster: kein assert mit Wirkung im Backend, keine neuen unbenutzten Namen ({checked}).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
