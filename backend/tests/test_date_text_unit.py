"""Ein Datumsformat (#1307): der Server schreibt wie Website und App - dieselben Fälle aus docs/date-cases.json.

Wiener Zeit, Sommerzeit, Mitternacht in Wien, Jahreswechsel und Zeiträume über Monats- und Jahresgrenzen. Wer eine
Regel ändert, ändert sie dort für alle drei zugleich.
"""
import json
import pathlib
import re
from datetime import date, datetime, timezone

import pytest

from services import date_text

CASES = json.loads((pathlib.Path(__file__).resolve().parents[2] / "docs" / "date-cases.json").read_text(encoding="utf-8"))


def case_now(row: dict) -> str:
    return row.get("now") or CASES["now"]


@pytest.mark.parametrize("row", CASES["when"], ids=lambda row: row["note"])
def test_when(row):
    assert date_text.format_when(row["value"], now=case_now(row), time=row.get("time", True)) == row["expected"]


@pytest.mark.parametrize("row", CASES["when_fixed"], ids=lambda row: row["note"])
def test_when_without_today_and_tomorrow(row):
    assert date_text.format_when(row["value"], now=case_now(row), time=row.get("time", True), relative=False) == row["expected"]


@pytest.mark.parametrize("row", CASES["day"], ids=lambda row: row["note"])
def test_pure_day(row):
    assert date_text.format_when(row["value"], now=case_now(row)) == row["expected"]


@pytest.mark.parametrize("row", CASES["range"], ids=lambda row: row["note"])
def test_range(row):
    assert date_text.format_range(row["start"], row["end"], now=case_now(row)) == row["expected"]


@pytest.mark.parametrize("row", CASES["ago"], ids=lambda row: row["note"])
def test_ago(row):
    assert date_text.format_ago(row["value"], now=case_now(row)) == row["expected"]


@pytest.mark.parametrize("row", CASES["official"], ids=lambda row: row["note"])
def test_official(row):
    assert date_text.format_official_date(row["value"]) == row["expected"]


@pytest.mark.parametrize("row", CASES["edges"], ids=lambda row: row["note"])
def test_edges_like_the_web(row):
    """Randfälle (#1307, Review): Sommerzeit-Lücke, Tage, die es nicht gibt, reine Tage in format_ago, unlesbares now."""
    if row["fn"] == "ago":
        assert date_text.format_ago(row["value"], now=case_now(row)) == row["expected"]
    elif row["fn"] == "when_bad_now":
        assert date_text.format_when(row["value"], now="kein Datum") == row["expected"]
        assert date_text.format_range(row["value"], None, now="kein Datum")
        assert date_text.format_ago(row["value"], now="kein Datum")
    else:
        assert date_text.format_when(row["value"], now=case_now(row)) == row["expected"]


def test_moment_takes_the_year_from_now():
    """``now`` bestimmt das laufende Jahr - wie im Web (#1307, Review)."""
    assert date_text.format_moment("2026-05-23T16:00:00Z", now="2027-01-05T10:00:00Z") == "Sa 23. Mai 2026 · 18:00"
    assert date_text.format_moment("2026-05-23T16:00:00Z", now="2026-12-01T10:00:00Z") == "Sa 23. Mai · 18:00"


def test_official_moment_for_csv():
    """CSV-Ausfuhren: amtlich, sortierbar, mit Jahr - nie „heute“ (#1307, Review)."""
    assert date_text.format_official_moment("2026-03-14T17:05:00Z") == "14.03.2026 18:05"
    assert date_text.format_official_moment("2026-12-31T23:30:00Z") == "01.01.2027 00:30"
    assert date_text.format_official_moment("2026-03-14") == "14.03.2026"
    assert date_text.format_official_moment(None) == ""


def test_values_as_the_database_delivers_them():
    now = datetime(2026, 5, 20, 10, tzinfo=timezone.utc)
    # Ein datetime ohne Zone kommt aus MongoDB und ist UTC; ein Text ohne Zone ist die Wiener Uhr.
    assert date_text.format_when(datetime(2026, 5, 23, 16, 0), now=now) == "Sa 23. Mai · 18:00"
    assert date_text.format_when(datetime(2026, 5, 23, 16, 0, tzinfo=timezone.utc), now=now) == "Sa 23. Mai · 18:00"
    assert date_text.format_when("2026-05-23 18:00", now=now) == "Sa 23. Mai · 18:00"
    assert date_text.format_when(date(2026, 5, 23), now=now) == "Sa 23. Mai"
    assert date_text.format_date("2026-05-23T16:00:00Z", now=now) == "Sa 23. Mai"
    assert date_text.format_clock("2026-05-20T22:00:00Z") == "00:00"


def test_without_a_value_comes_the_fallback():
    assert date_text.format_when(None) == ""
    assert date_text.format_when("", fallback="Termin folgt") == "Termin folgt"
    assert date_text.format_when("kein Datum", fallback="Termin folgt") == "Termin folgt"
    assert date_text.format_range(None, None, fallback="offen") == "offen"
    assert date_text.format_ago(None) == ""
    assert date_text.format_clock(None) == ""
    assert date_text.format_official_date("kaputt") == ""


def test_far_future_in_ago_shows_the_date():
    assert date_text.format_ago("2026-05-23T16:00:00Z", now=CASES["now"]) == "Sa 23. Mai · 18:00"


def test_no_numeric_dates_and_no_uhr():
    for row in CASES["when"] + CASES["when_fixed"]:
        text = date_text.format_when(row["value"], now=case_now(row), time=row.get("time", True))
        assert not re.search(r"\d\.\d|\.,|Uhr", text), text
