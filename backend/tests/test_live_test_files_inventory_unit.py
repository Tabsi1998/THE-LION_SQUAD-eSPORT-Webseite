"""Live-Tests bleiben gezählt (#932): Wer einen laufenden Server braucht, steht in ``LIVE_TEST_FILES`` - und nur der.

Die CI wählt diese Dateien mit ``-m "not live"`` ab. Steht eine neue Datei mit ``REACT_APP_BACKEND_URL`` nicht in der
Liste, liefe sie in der CI gegen keinen Server; steht eine gelöschte noch drin, beschreibt die Liste (und das Inventar in
docs/entwicklung/altetests-932.md) etwas, das es nicht mehr gibt. Neue Abläufe gehören in Flow-Tests (flow_harness.py).
"""
import ast
import pathlib

TESTS = pathlib.Path(__file__).resolve().parent


def listed_live_files() -> set[str]:
    tree = ast.parse((TESTS / "conftest.py").read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(getattr(t, "id", None) == "LIVE_TEST_FILES" for t in node.targets):
            return set(ast.literal_eval(node.value))
    raise AssertionError("LIVE_TEST_FILES fehlt in conftest.py")


def files_needing_a_server() -> set[str]:
    return {
        path.name for path in TESTS.glob("test_*.py")
        if path.name != pathlib.Path(__file__).name and "REACT_APP_BACKEND_URL" in path.read_text(encoding="utf-8")
    }


def test_live_list_names_exactly_the_files_that_need_a_running_server():
    assert sorted(listed_live_files() - files_needing_a_server()) == [], "gelistet, aber nicht (mehr) vorhanden"
    assert sorted(files_needing_a_server() - listed_live_files()) == [], "braucht einen Server, fehlt in der Liste"


def test_the_live_list_only_shrinks():
    # Stand nach #932. Ein neuer Live-Test ist ein Rückschritt: lieber einen Flow-Test schreiben.
    assert len(listed_live_files()) <= 14
