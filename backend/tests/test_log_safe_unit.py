"""Werte sicher ins Protokoll (#1408): ein Wert von außen bleibt Teil einer einzigen Protokollzeile."""
import logging

from services.log_safe import log_safe


def test_line_breaks_become_spaces_so_no_second_line_can_be_faked():
    hostile = "discord\r\n2026-10-08 12:00:00 WARNING [auth] angemeldet\nnoch eine und\x85hier"
    safe = log_safe(hostile)
    assert len(safe.splitlines()) == 1
    assert "\r" not in safe and "\n" not in safe
    assert safe.startswith("discord  2026-10-08")


def test_long_values_are_cut_and_empty_values_stay_empty():
    assert len(log_safe("x" * 5000)) == 200
    assert len(log_safe("x" * 5000, 300)) == 300
    assert log_safe(None) == ""
    assert log_safe(0) == "0"


def test_an_exception_is_logged_with_its_text_in_one_line():
    assert log_safe(ValueError("erste Zeile\nzweite Zeile")) == "erste Zeile zweite Zeile"


def test_the_record_written_by_logging_stays_one_line(caplog):
    logger = logging.getLogger("tls.test.log_safe")
    with caplog.at_level(logging.WARNING, logger="tls.test.log_safe"):
        logger.warning("[test] %s: %s", log_safe("twitch\r\nFAKE"), log_safe(RuntimeError("a\nb"), 300))
    assert [record.getMessage() for record in caplog.records] == ["[test] twitch  FAKE: a b"]
