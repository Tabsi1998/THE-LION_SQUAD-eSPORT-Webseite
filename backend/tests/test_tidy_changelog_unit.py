"""Lesbares Changelog der Website (scripts/tidy_changelog.py): nur Version, Datum, Überschriften und Einträge mit
einer Nummer - ohne Vergleichs-, PR- und Commit-Links."""
import importlib.util
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location("tidy_changelog", ROOT / "scripts" / "tidy_changelog.py")
tidy_changelog = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(tidy_changelog)

REPO = "https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite"
RAW = f"""# Changelog

## [1.2.0]({REPO}/compare/v1.1.0...v1.2.0) (2026-10-19)


### Neu

* TV-Warteschlange nennt im Lauf die Namen ([#1634]({REPO}/issues/1634)) ([#1776]({REPO}/issues/1776)) ([5286c93]({REPO}/commit/5286c93eba8ea38d33d18c2c518ba16885589c31))
* **web:** Ohne Issue im Titel ([#1780]({REPO}/issues/1780)) ([abc1234]({REPO}/commit/abc1234def))

## 1.0.0 (2026-10-16)


### Dokumentation

* GitHub-Auftritt ([#1735]({REPO}/issues/1735)) ([4bf7229]({REPO}/commit/4bf72299be39279608503237a33d1b8278cb5d33))
"""


def test_entries_keep_only_the_issue_number_and_headers_show_a_german_date():
    text = tidy_changelog.tidy(RAW)
    assert "## 1.2.0 (19.10.2026)" in text
    assert "## 1.0.0 (16.10.2026)" in text
    assert "* TV-Warteschlange nennt im Lauf die Namen (#1634)\n" in text
    assert "* **web:** Ohne Issue im Titel (#1780)\n" in text
    assert "* GitHub-Auftritt (#1735)\n" in text
    assert "/commit/" not in text and "/compare/" not in text and "](" not in text
    assert "\n\n\n" not in text


def test_tidying_twice_changes_nothing():
    once = tidy_changelog.tidy(RAW)
    assert tidy_changelog.tidy(once) == once


def test_section_is_the_release_text_of_one_version():
    body = tidy_changelog.section(RAW, "1.2.0")
    assert body.startswith("### Neu")
    assert "(#1634)" in body and "GitHub-Auftritt" not in body
    assert tidy_changelog.section(RAW, "9.9.9") == ""


def test_versions_with_a_pre_release_or_build_suffix_are_found():
    raw = f"""# Changelog

## [1.3.0-rc.1]({REPO}/compare/v1.2.0...v1.3.0-rc.1) (2026-10-20)

### Neu

* Vorabversion ([#1800]({REPO}/issues/1800)) ([abc1234]({REPO}/commit/abc1234def))
"""
    assert "## 1.3.0-rc.1 (20.10.2026)" in tidy_changelog.tidy(raw)
    assert tidy_changelog.section(raw, "1.3.0-rc.1").startswith("### Neu")


def test_cli_rewrites_the_file_and_prints_a_section(tmp_path, capsys):
    path = tmp_path / "CHANGELOG.md"
    path.write_text(RAW, encoding="utf-8")
    assert tidy_changelog.main([str(path)]) == 0
    assert "](" not in path.read_text(encoding="utf-8")
    assert tidy_changelog.main([str(path), "--section", "1.0.0"]) == 0
    assert "GitHub-Auftritt (#1735)" in capsys.readouterr().out
    assert tidy_changelog.main([str(path), "--section", "9.9.9"]) == 1
