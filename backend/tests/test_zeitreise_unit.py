"""Die Zeitreise-Probe (#775) verstellt die Uhr nur mit TLS_TEST_NOW - und die Uhr läuft dann weiter."""
import asyncio
import time
from datetime import datetime, timezone

import pytest
import zeitreise


def test_without_the_variable_nothing_changes():
    assert zeitreise.target_time({}) is None
    assert zeitreise.target_time({"TLS_TEST_NOW": "  "}) is None
    assert zeitreise.start({}) is None


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("2027-05-15", datetime(2027, 5, 15, tzinfo=timezone.utc)),
        ("2027-05-15T03:30:00Z", datetime(2027, 5, 15, 3, 30, tzinfo=timezone.utc)),
        ("2027-05-15T05:30:00+02:00", datetime(2027, 5, 15, 3, 30, tzinfo=timezone.utc)),
    ],
)
def test_iso_dates_are_read_as_utc(value, expected):
    assert zeitreise.target_time({"TLS_TEST_NOW": value}) == expected


def test_a_wrong_value_stops_the_run_with_a_clear_message():
    with pytest.raises(pytest.UsageError, match="ISO-Datum"):
        zeitreise.target_time({"TLS_TEST_NOW": "+6m"})


def test_the_clock_jumps_and_keeps_running():
    freezer = zeitreise.start({"TLS_TEST_NOW": "2031-01-02T03:04:05+00:00"})
    try:
        first = datetime.now(timezone.utc)
        assert first.year == 2031 and (first.month, first.day) == (1, 2)
        assert abs(time.time() - first.timestamp()) < 5
        time.sleep(0.05)
        # Steht die Uhr still, kippen Tests, die auf vergangene Zeit warten (Spam-Sperre, Ablauf von Codes).
        assert datetime.now(timezone.utc) > first
        # asyncio misst weiter mit der echten Uhr, sonst warten Tests mit asyncio.sleep ewig.
        asyncio.run(asyncio.sleep(0.01))
    finally:
        freezer.stop()
    assert datetime.now(timezone.utc).year < 2031


def test_real_clock_tests_are_left_out_only_in_the_probe(monkeypatch):
    class Item:
        def __init__(self, marked):
            self.marked = marked

        def get_closest_marker(self, name):
            return object() if self.marked and name == zeitreise.MARKER else None

    class Hook:
        def __init__(self):
            self.deselected = []

        def pytest_deselected(self, items):
            self.deselected.extend(items)

    class Config:
        hook = Hook()

    plain, real = Item(False), Item(True)

    monkeypatch.delenv("TLS_TEST_NOW", raising=False)
    items = [plain, real]
    zeitreise.deselect_real_clock(Config, items)
    assert items == [plain, real]

    monkeypatch.setenv("TLS_TEST_NOW", "2027-05-15")
    items = [plain, real]
    zeitreise.deselect_real_clock(Config, items)
    assert items == [plain]
    assert Config.hook.deselected == [real]
