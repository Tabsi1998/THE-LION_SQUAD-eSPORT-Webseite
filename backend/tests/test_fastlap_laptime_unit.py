"""Ein Zeit-Parser für Fast-Lap-Rundenzeiten (#1584).

Website, App und Server lesen dieselben Fälle aus ``frontend/src/lib/laptime.cases.json``: Komma oder Punkt,
``m:ss.mmm`` oder ``ss.mmm``, eine nackte Zahl sind Sekunden. Dazu die Plausibilitätswarnung je Strecke
(Standard: unter 20 Sekunden oder über 10 Minuten)."""
import json
import pathlib

import pytest

from services.laptime import DEFAULT_MAX_PLAUSIBLE_MS, DEFAULT_MIN_PLAUSIBLE_MS, format_lap_time, parse_lap_time, plausibility_warning

CASES = json.loads((pathlib.Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib" / "laptime.cases.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", CASES["parse"], ids=[case["input"] for case in CASES["parse"]])
def test_parse_reads_the_shared_cases(case):
    assert parse_lap_time(case["input"]) == case["ms"]


@pytest.mark.parametrize("text", CASES["empty"])
def test_empty_is_no_time(text):
    assert parse_lap_time(text) is None


@pytest.mark.parametrize("text", CASES["invalid"])
def test_nonsense_is_refused(text):
    with pytest.raises(ValueError):
        parse_lap_time(text)


@pytest.mark.parametrize("case", CASES["format"], ids=[case["text"] for case in CASES["format"]])
def test_format_writes_the_shared_cases_and_reads_back(case):
    assert format_lap_time(case["ms"]) == case["text"]
    assert parse_lap_time(case["text"]) == case["ms"]


@pytest.mark.parametrize("case", CASES["plausibility"], ids=[f"{c['ms']}-{c['warning']}" for c in CASES["plausibility"]])
def test_plausibility_warning_per_track(case):
    assert plausibility_warning(case["ms"], case["track"]) == case["warning"]


def test_default_limits_are_twenty_seconds_and_ten_minutes():
    assert (DEFAULT_MIN_PLAUSIBLE_MS, DEFAULT_MAX_PLAUSIBLE_MS) == (20_000, 600_000)
