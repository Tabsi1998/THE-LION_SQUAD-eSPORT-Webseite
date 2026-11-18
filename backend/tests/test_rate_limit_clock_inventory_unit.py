"""Wächter (#2512): Wer eine 429 aus ``enforce_rate_limit`` erwartet, hält die Uhr der Drosselung mit dem Helfer an.

Die Drosselung zählt in Fenstern, die an der Uhr hängen. Läuft ein Test über einen Fensterwechsel, beginnt die Zählung
von vorn und die erwartete 429 bleibt aus - selten, aber in der CI jederzeit und in der Zeitreise-Probe gehäuft. Darum
nutzt jeder Test, der eine 429 erwartet, die Fixture ``still_rate_limit_clock`` (``conftest.py``,
``rate_limit_clock.py``) - direkt, über ``usefixtures`` oder über eine Fixture derselben Datei, die sie anfordert.
Kommt die 429 nicht aus ``enforce_rate_limit``, steht die Datei (oder ``datei::test``) mit Grund in ``NOT_THE_BRAKE``.
Eigene Uhren oder riesige Fenster je Datei gibt es nicht mehr. Dateien ``test_rate_limit*`` prüfen den Fensterwechsel
und ``Retry-After`` selbst und sind ausgenommen.
"""
import ast
import pathlib
import re

TESTS = pathlib.Path(__file__).resolve().parent
HELPER = "still_rate_limit_clock"

# Die 429 kommt hier nicht aus enforce_rate_limit - eine stehende Uhr der Drosselung änderte nichts.
NOT_THE_BRAKE = {
    "test_discord_widget_flow.py": "die Discord-API (Fake) antwortet 429",
    "test_easter_hunt_flow.py": "Mindestabstand zwischen zwei Funden über gespeicherte Zeitstempel (easter_hunt.MIN_GAP_SECONDS)",
    "test_event_lead_flow.py": "Sperre über die Zeit der letzten Nachricht (event_lead.send_message), kein Zählfenster",
    "test_fetch_ocr_model_unit.py": "HTTP 429 beim Laden des Modells, ein Fehler der Gegenseite",
    "test_helper_calls_flow.py": "ein Aufruf je Veranstaltung und Tag (helper_calls.send_call, called_today)",
    "test_maintenance_write_pause_flow.py": "429 ist nur eine der erlaubten Absagen beim Anmelden, keine Erwartung",
    "test_printful_client_unit.py": "die Printful-API (Fake) antwortet 429",
    "test_result_image_routes_flow.py::test_one_image_per_account_and_decoding_only_with_a_free_place":
        "ein Bild je Konto zugleich (BUSY_ACCOUNT), keine Zählung",
    "test_shop_motif_pair_flow.py": "eine Paar-Verarbeitung je Prozess (shop_motifs.pair_semaphore)",
    "test_team_day_flow.py": "Anstupsen über die gespeicherte Zeit des letzten Anstupsens (team_day_routes)",
}

OWN_CLOCK = re.compile(r"""rate_limit\s*,\s*["']datetime["']|rate_limit\.datetime\s*=""")
HUGE_NUMBER = re.compile(r"setattr\(.*10\s*\*\*\s*\d")


def all_test_files() -> list[pathlib.Path]:
    return sorted(path for path in TESTS.glob("**/test_*.py") if path.name != pathlib.Path(__file__).name)


def checks_the_window_itself(path: pathlib.Path) -> bool:
    return path.name.startswith("test_rate_limit")


def text(path: pathlib.Path) -> str:
    return path.read_text(encoding="utf-8-sig")


def expects_429(node: ast.AST) -> bool:
    return any(isinstance(item, ast.Constant) and type(item.value) is int and item.value == 429 for item in ast.walk(node))


def functions(tree: ast.AST) -> list:
    return [node for node in ast.walk(tree) if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))]


def arguments(function) -> set[str]:
    return {argument.arg for argument in function.args.args + function.args.kwonlyargs}


def asks_for_the_helper_by_mark(node) -> bool:
    return any(HELPER in ast.unparse(decorator) for decorator in getattr(node, "decorator_list", []))


def unhelped_tests(path: pathlib.Path) -> list[str]:
    tree = ast.parse(text(path))
    module_mark = any(
        isinstance(node, ast.Assign) and any(getattr(target, "id", None) == "pytestmark" for target in node.targets)
        and HELPER in ast.unparse(node.value)
        for node in tree.body
    )
    helping = {HELPER} | {function.name for function in functions(tree) if HELPER in arguments(function)}
    return [
        function.name for function in functions(tree)
        if function.name.startswith("test_") and expects_429(function)
        and not module_mark and not asks_for_the_helper_by_mark(function) and not arguments(function) & helping
    ]


def watched_files() -> list[pathlib.Path]:
    return [path for path in all_test_files() if not checks_the_window_itself(path) and path.name not in NOT_THE_BRAKE]


def test_every_test_that_expects_a_429_holds_the_brake_clock():
    missing = [
        f"{path.name}::{name}" for path in watched_files() for name in unhelped_tests(path)
        if f"{path.name}::{name}" not in NOT_THE_BRAKE
    ]
    assert missing == [], (
        f"erwartet 429, hält aber die Uhr der Drosselung nicht an: Fixture {HELPER} nutzen "
        "oder - wenn die 429 nicht aus enforce_rate_limit kommt - mit Grund in NOT_THE_BRAKE eintragen"
    )


def test_the_exceptions_stay_current():
    by_name = {path.name: path for path in all_test_files()}
    stale = []
    for entry, reason in NOT_THE_BRAKE.items():
        file_name, _, test_name = entry.partition("::")
        path = by_name.get(file_name)
        if not reason.strip():
            stale.append(f"{entry}: ohne Grund")
        elif path is None:
            stale.append(f"{entry}: Datei gibt es nicht mehr")
        elif test_name and test_name not in unhelped_tests(path):
            stale.append(f"{entry}: der Test fehlt, erwartet keine 429 mehr oder nutzt den Helfer")
        elif not test_name and not unhelped_tests(path):
            stale.append(f"{entry}: erwartet keine 429 mehr oder nutzt den Helfer")
    assert stale == [], "NOT_THE_BRAKE ist überholt"


def test_no_file_brings_its_own_brake_clock_or_a_huge_window():
    own = sorted(path.name for path in all_test_files() if not checks_the_window_itself(path) and OWN_CLOCK.search(text(path)))
    assert own == [], f"eigene Uhr für services.rate_limit - stattdessen die Fixture {HELPER}"
    huge = sorted(
        f"{path.name}:{number}" for path in watched_files() if HELPER in text(path)
        for number, line in enumerate(text(path).splitlines(), start=1) if HUGE_NUMBER.search(line)
    )
    assert huge == [], "riesiges Fenster neben der stehenden Uhr - die Fixture reicht, das Fenster bleibt das echte"


def test_the_helper_is_a_shared_fixture():
    conftest = text(TESTS / "conftest.py")
    assert f"def {HELPER}(monkeypatch)" in conftest
    assert "rate_limit_clock.hold_still(monkeypatch)" in conftest


def test_the_watch_sees_a_missing_helper(tmp_path):
    """Gegenprobe: Ein Test mit erwarteter 429 ohne Helfer fällt auf, mit Helfer (auch über eine Fixture) nicht."""
    probe = tmp_path / "test_probe_flow.py"
    probe.write_text(
        "import pytest\n\n"
        "@pytest.fixture\n"
        f"def braked(monkeypatch, {HELPER}):\n    pass\n\n"
        "async def test_bare(flow):\n    assert (await flow.get('/x')).status_code == 429\n\n"
        f"async def test_direct(flow, {HELPER}):\n    assert 429\n\n"
        "async def test_through_a_fixture(flow, braked):\n    assert 429\n\n"
        f"@pytest.mark.usefixtures('{HELPER}')\nasync def test_marked(flow):\n    assert 429\n\n"
        "async def test_only_a_text(flow):\n    assert 'kein 429 hier'\n",
        encoding="utf-8",
    )
    assert unhelped_tests(probe) == ["test_bare"]
