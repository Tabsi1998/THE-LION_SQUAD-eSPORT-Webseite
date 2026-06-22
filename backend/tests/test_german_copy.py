from pathlib import Path
import re


BACKEND_ROOT = Path(__file__).resolve().parents[1]
SKIP_DIRS = {"__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", "venv", ".venv"}
DISALLOWED_VISIBLE_WORDS = [
    "Uebersicht",
    "uebersicht",
    "Begruendung",
    "begruendung",
    "Loeschen",
    "loeschen",
    "Oeffnen",
    "oeffnen",
    "Waehlen",
    "waehlen",
    "Zurueck",
    "zurueck",
    "Schliessen",
    "schliessen",
    "Groesse",
    "groesse",
    "Hinzufuegen",
    "hinzufuegen",
    "Aendern",
    "aendern",
    "Durchfuehren",
    "durchfuehren",
    "Bestaetigen",
    "bestaetigen",
    "Muessen",
    "muessen",
    "ueberfaellig",
    "gruen",
    "weiss",
    "fuer",
]


def source_files(root: Path):
    for path in root.rglob("*.py"):
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        if path.name.startswith("test_"):
            continue
        yield path


def test_german_backend_copy_uses_umlauts_instead_of_transliterations():
    pattern = re.compile(rf"\b({'|'.join(map(re.escape, DISALLOWED_VISIBLE_WORDS))})\b")
    findings = []

    for path in source_files(BACKEND_ROOT):
        text = path.read_text(encoding="utf-8")
        for line_number, line in enumerate(text.splitlines(), start=1):
            match = pattern.search(line)
            if match:
                findings.append(f"{path.relative_to(BACKEND_ROOT)}:{line_number} -> {match.group(0)}")

    assert findings == []
