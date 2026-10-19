"""Rundennamen aus einer Quelle (#1792): die gemeinsamen Fälle in frontend/src/lib/roundLabelCases.json.

Der Web-Baum zählt die Runden je Phase und Abschnitt fortlaufend ab 1 („Loser Runde 1“, auch wenn das Loser Bracket zur
Zeit der zweiten Runde beginnt). TV (Momente, Warteschlange, Aufruf-Tafel), Warteschlange der Leitung und App lesen
``round_label`` vom Server - er muss dieselbe Nummer nennen. Der Vitest-Test derselben Datei prüft, dass der Web-Baum
diese Namen unverändert zeigt.
"""
import copy
import json
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.round_labels import attach_round_labels, round_label, rounds_by_section, stage_kind  # noqa: E402

CASES = json.loads(
    (pathlib.Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib" / "roundLabelCases.json").read_text(encoding="utf-8")
)["cases"]


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_server_names_rounds_like_the_web_tree(case):
    matches = [{key: value for key, value in match.items() if key != "expected"} for match in copy.deepcopy(case["matches"])]
    attach_round_labels(matches, case["stages"], {"format": case["format"]})
    assert {match["id"]: match["round_label"] for match in matches} == {match["id"]: match["expected"] for match in case["matches"]}


def test_single_round_label_uses_the_same_numbers():
    """Team-Seite, Weg im Turnier und „in die Loser Runde 1“ rechnen mit ``round_label`` und ``rounds_by_section``."""
    case = CASES[0]
    matches = [{key: value for key, value in match.items() if key != "expected"} for match in case["matches"]]
    rounds = rounds_by_section(matches)
    kind = stage_kind("ffa_custom_bracket")
    by_id = {match["id"]: match for match in matches}
    assert round_label(by_id["LA"], rounds=rounds, kind=kind) == "Loser Runde 1"
    assert round_label(by_id["LF"], rounds=rounds, kind=kind) == "Loser Runde 4"
