"""Abschnittsnamen im Turnierbaum (#1591): frontend/src/lib/bracketSections.json spiegelt die Server-Listen 1:1.

Das Frontend liest die Datei (frontend/src/lib/bracketSections.js) - ändert sich eine Liste am Server, schlägt dieser
Test fehl, bis die Datei nachgezogen ist.
"""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import round_labels  # noqa: E402

SHARED = pathlib.Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib" / "bracketSections.json"


def test_shared_section_lists_match_the_server():
    shared = json.loads(SHARED.read_text(encoding="utf-8"))
    assert set(shared["main"]) == round_labels.MAIN_SECTIONS
    assert set(shared["loser"]) == round_labels.LOSER_SECTIONS
    assert set(shared["final"]) == round_labels.FINAL_SECTIONS
    assert set(shared["bronze"]) == round_labels.BRONZE_SECTIONS


def test_section_kind_reads_the_shared_lists():
    shared = json.loads(SHARED.read_text(encoding="utf-8"))
    expected = {"loser": "loser", "final": "grand_final", "bronze": "bronze"}
    for group, kind in expected.items():
        for name in shared[group]:
            assert round_labels.section_kind(name.upper()) == kind, name
