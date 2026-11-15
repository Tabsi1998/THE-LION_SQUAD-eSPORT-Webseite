"""Zeitreise-Probe auf Knopfdruck (#775): ``local_check.py --only zeitreise [--zeit +6m]``."""
import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("local_check_zeitreise", ROOT / "scripts/local_check.py")
local_check = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = local_check  # @dataclass löst Typen über sys.modules auf
spec.loader.exec_module(local_check)


@pytest.fixture(autouse=True)
def jumps(monkeypatch):
    monkeypatch.setattr(local_check, "ZEITREISE_JUMPS", ["+1m", "+6m", "+1y"])


def listed(capsys, *argv):
    assert local_check.main([*argv, "--list"]) == 0
    return [line.split(None, 1) for line in capsys.readouterr().out.splitlines() if line.strip()]


def test_all_three_jumps_for_every_part(capsys):
    steps = listed(capsys, "--only", "zeitreise")
    assert {group for group, _ in steps} == {"zeitreise"}
    for jump in ("+1m", "+6m", "+1y"):
        for part in ("Backend suite", "Web unit suite", "App unit suite"):
            assert [part, jump] in [[text.rsplit(" with the clock at ", 1)[0], text.rsplit(" ", 1)[-1]]
                                    for _, text in steps if " with the clock at " in text]


def test_zeit_picks_one_jump(capsys):
    texts = [text for _, text in listed(capsys, "--only", "zeitreise", "--zeit", "+6m")]
    clocks = {text.rsplit(" ", 1)[-1] for text in texts if " with the clock at " in text}
    assert clocks == {"+6m"}


def test_the_probe_never_runs_without_being_asked(capsys):
    assert "zeitreise" not in {group for group, _ in listed(capsys)}
    assert "zeitreise" not in {group for group, _ in listed(capsys, "--all")}


@pytest.mark.parametrize("argv", [["--zeit", "+6m"], ["--only", "zeitreise", "--zeit", "6x"]])
def test_a_wrong_zeit_stops_before_anything_runs(argv):
    with pytest.raises(SystemExit) as stopped:
        local_check.main([*argv, "--list"])
    assert stopped.value.code == 2
