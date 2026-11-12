"""Auswahl der Ablauf-Tests auf echtem MongoDB (#2216): Gebiet für die CI, ``--all`` für alle Harness-Dateien, ``--chunk``."""
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "flow_mongo_tests", Path(__file__).resolve().parents[2] / "scripts/flow_mongo_tests.py"
)
script = importlib.util.module_from_spec(spec)
spec.loader.exec_module(script)


def test_all_takes_every_harness_file_and_the_area_is_a_part_of_it():
    area = script.selected_files()
    everything = script.selected_files(everything=True)
    assert area and set(area) < set(everything)
    assert "backend/tests/test_tournament_many_registrations_flow.py" in everything
    assert all("make_flow" in (script.ROOT / path).read_text(encoding="utf-8") for path in everything)


def test_options_are_taken_out_and_the_rest_goes_to_pytest():
    assert script.split_options(["--all", "--chunk", "60", "-n", "4"]) == (True, 60, ["-n", "4"])
    assert script.split_options(["-n", "4", "--list"]) == (False, 0, ["-n", "4", "--list"])


def test_chunks_cover_every_file_once_in_order():
    files = [f"f{i}" for i in range(7)]
    assert script.chunks(files, 3) == [["f0", "f1", "f2"], ["f3", "f4", "f5"], ["f6"]]
    assert script.chunks(files, 0) == [files]
