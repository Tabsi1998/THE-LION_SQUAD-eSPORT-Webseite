"""Wächter für Code-Scanning-Muster (#1408): ein assert mit Wirkung im Backend und neue unbenutzte Namen in
geänderten Dateien. Die Beispiele stehen als Text im Test - als echte Datei würde das Code-Scanning sie selbst
bemängeln."""
import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("check_code_patterns", ROOT / "scripts/check-code-patterns.py")
patterns = importlib.util.module_from_spec(spec)
spec.loader.exec_module(patterns)

BAD = '''import io
import subprocess

from PIL import Image


async def test_bad(flow, db, items):
    assert (await flow.delete("/api/x")).status_code == 200
    assert Image.open(io.BytesIO(b"")).size == (1, 1)
    assert len((await flow.client.delete("/api/y")).json()["entries"]) == 1
    assert (await db.items.insert_one({"a": 1})).acknowledged
    assert items, items.pop()
    assert subprocess.check_output(["git", "status"])
'''

GOOD = '''async def test_good(flow, items):
    deleted = await flow.delete("/api/x")
    assert deleted.status_code == 200
    assert (await flow.post("/api/x", json={})).status_code == 200
    assert (await flow.get("/api/x")).json() == {}
    assert "delete" in str(items) and items.count(1) == 0
'''


def backend_file(root: Path, name: str, text: str) -> None:
    path = root / "backend" / "tests" / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def test_an_assert_with_an_effect_is_found_with_file_line_and_name(tmp_path):
    backend_file(tmp_path, "test_bad.py", BAD)
    backend_file(tmp_path, "test_good.py", GOOD)
    found = [(item.path, item.line, item.name) for item in patterns.side_effect_asserts(tmp_path)]
    assert found == [
        ("backend/tests/test_bad.py", 8, "delete"),
        ("backend/tests/test_bad.py", 9, "open"),
        ("backend/tests/test_bad.py", 10, "delete"),
        ("backend/tests/test_bad.py", 11, "insert_one"),
        ("backend/tests/test_bad.py", 12, "pop"),
        ("backend/tests/test_bad.py", 13, "subprocess.check_output"),
    ]


def test_the_report_names_place_rule_and_fix_in_german(tmp_path, capsys):
    backend_file(tmp_path, "test_bad.py", BAD)
    assert patterns.main(["--root", str(tmp_path), "--skip-lint"]) == 1
    out = capsys.readouterr().out
    assert "backend/tests/test_bad.py:8: assert mit Wirkung („delete“) - CodeQL py/side-effect-in-assert" in out
    assert "zuerst aufrufen, dann prüfen" in out


def test_calling_first_and_checking_after_passes(tmp_path):
    backend_file(tmp_path, "test_good.py", GOOD)
    assert patterns.main(["--root", str(tmp_path), "--skip-lint"]) == 0


def test_the_backend_has_no_assert_with_an_effect():
    # Regel 1 gilt hart für das ganze Backend - im CI über diesen Test, lokal zusätzlich im Schritt code-patterns.
    assert patterns.side_effect_asserts(ROOT) == []


def test_only_unused_names_a_change_brings_in_count(tmp_path):
    before, now = tmp_path / "vorher", tmp_path / "jetzt"
    for folder, text in ((before, "import os\n\n\ndef f():\n    wert = 1\n"),
                         (now, "import json\nimport os\n\n\ndef f():\n    wert = 1\n    neu = 2\n")):
        (folder / "backend").mkdir(parents=True)
        (folder / "backend" / "modul.py").write_text(text, encoding="utf-8")
    old = patterns.lint(sys.executable, before, ["backend/modul.py"])
    new = patterns.lint(sys.executable, now, ["backend/modul.py"])
    assert {(code, text) for _, _, code, text in old} == {
        ("F401", "'os' imported but unused"), ("F841", "local variable 'wert' is assigned to but never used")}
    fresh = patterns.new_findings(new, old)
    assert [(path, line, code) for path, line, code, _ in fresh] == [
        ("backend/modul.py", 1, "F401"), ("backend/modul.py", 7, "F841")]
