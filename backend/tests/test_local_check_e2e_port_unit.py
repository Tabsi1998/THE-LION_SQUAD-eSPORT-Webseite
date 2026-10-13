"""Port der Browser-Tests je Arbeitsordner (#1464): Zwei Ordner dürfen nie denselben Vite-Server benutzen."""
import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("local_check", ROOT / "scripts/local_check.py")
local_check = importlib.util.module_from_spec(spec)
sys.modules["local_check"] = local_check  # @dataclass löst Typen über sys.modules auf
spec.loader.exec_module(local_check)

pick = local_check.pick_e2e_port
FREE = lambda port: False  # noqa: E731


def test_environment_value_wins():
    assert pick("lsw-2", {"E2E_PORT": "4321"}, FREE) == 4321
    assert pick(local_check.MAIN_FOLDER, {"E2E_PORT": "4321"}, lambda port: True) == 4321


def test_invalid_environment_value_is_ignored():
    assert pick(local_check.MAIN_FOLDER, {"E2E_PORT": "abc"}, FREE) == 3000


def test_main_checkout_keeps_3000_when_free():
    assert pick(local_check.MAIN_FOLDER, {}, FREE) == 3000


def test_main_checkout_moves_on_when_3000_is_taken():
    port = pick(local_check.MAIN_FOLDER, {}, lambda port: port == 3000)
    assert 3100 <= port < 3900


def test_other_folder_gets_stable_port_not_3000():
    first = pick("lsw-2", {}, FREE)
    assert first == pick("lsw-2", {}, FREE)
    assert first != 3000 and 3100 <= first < 3900
    assert first != pick("lsw-12", {}, FREE)


def test_taken_port_gives_next_free_one():
    first = pick("lsw-2", {}, FREE)
    second = pick("lsw-2", {}, lambda port: port == first)
    assert second != first
    third = pick("lsw-2", {}, lambda port: port in (first, second))
    assert third not in (first, second)


def test_wraps_around_inside_the_range():
    start = pick("lsw-2", {}, FREE)
    port = pick("lsw-2", {}, lambda candidate: candidate >= start)
    assert 3100 <= port < start
