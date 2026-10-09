import importlib.util
from pathlib import Path

# CLAUDE.md lädt jede Claude-Sitzung beim Start (#929). Die Obergrenze hält
# die Datei klein; gezählt wird mit LF-Zeilenenden, damit ein Windows-Checkout
# (CRLF) und der Linux-Rechner von GitHub dieselbe Zahl sehen.

REPO = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "doc_links_check", REPO / "scripts/check-doc-links.py"
)
assert spec is not None and spec.loader is not None
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


def test_a_file_over_its_budget_is_named_with_both_numbers(tmp_path):
    (tmp_path / "CLAUDE.md").write_bytes(b"x" * 101)
    assert checker.over_budget(tmp_path, {"CLAUDE.md": 101}) == []
    found = checker.over_budget(tmp_path, {"CLAUDE.md": 100})
    assert len(found) == 1
    assert found[0].startswith("CLAUDE.md: 101 bytes, the budget is 100")


def test_crlf_counts_like_lf_and_a_missing_file_is_no_finding(tmp_path):
    (tmp_path / "CLAUDE.md").write_bytes(b"zeile\r\n" * 10)
    budgets = {"CLAUDE.md": 60, "FEHLT.md": 1}
    assert checker.over_budget(tmp_path, budgets) == []
    assert len(checker.over_budget(tmp_path, {"CLAUDE.md": 59})) == 1


def test_claude_md_of_this_repository_is_inside_its_budget():
    hint = "Einzelheiten in die privaten Projektnotizen verschieben, hier nur Regeln und Kurzkarte"
    assert checker.SIZE_BUDGETS == {"CLAUDE.md": 60_000}
    assert checker.over_budget() == [], hint
