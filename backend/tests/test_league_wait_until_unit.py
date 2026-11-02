"""Wartezeit und Aufhebung (docs/LIGA.md, B.3, #2204): Ältere Einträge tragen ``Z``, neue ``+00:00``. Verglichen wird der Zeitpunkt, nicht der Text."""
import pathlib
import sys
from types import SimpleNamespace

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.league_roster import wait_until  # noqa: E402


def context(waived_at: str | None, started_at: str = "2030-03-01T10:00:00Z") -> SimpleNamespace:
    entry = {"wait_from": {"s1": started_at}, "wait_waivers": [{"squad_id": "s1", "at": waived_at}]}
    return SimpleNamespace(season={"new_player_wait_days": 7}, entries={"u1": entry})


def test_a_waiver_counts_as_a_moment_not_as_text():
    assert wait_until(context("2030-03-01T10:00:00+00:00"), "u1", "s1") is None, "derselbe Zeitpunkt in anderer Schreibweise"
    assert wait_until(context("2030-03-01T12:00:00+02:00", "2030-03-01T10:00:00+00:00"), "u1", "s1") is None, "gleicher Zeitpunkt in anderer Zeitzone"
    assert wait_until(context("2030-03-02T08:00:00+00:00"), "u1", "s1") is None, "spätere Aufhebung gilt"
    assert wait_until(context("2030-03-01T08:00:00+00:00", "2030-03-01T10:00:00+02:00"), "u1", "s1") is None, "als Text älter, als Zeitpunkt gleich"


def test_an_older_waiver_does_not_free_a_new_transfer():
    assert wait_until(context("2030-02-20T08:00:00Z"), "u1", "s1") is not None
    assert wait_until(context("2030-03-01T11:00:00+02:00"), "u1", "s1") is not None, "als Text später, als Zeitpunkt früher"


def test_a_waiver_without_a_readable_date_still_counts():
    """Die Aufhebung selbst ist belegt, nur ihr Datum nicht: Lieber frei als eine aufgehobene Wartezeit, die wieder sperrt."""
    assert wait_until(context(None), "u1", "s1") is None
    assert wait_until(context("kaputt"), "u1", "s1") is None
