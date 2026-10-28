"""Printful-Kennungen (#2133): Printful nimmt je ``external_id`` höchstens 32 Zeichen. Neue Kennungen halten das ein,
die Prüfung meldet zu lange schon vor dem Senden, und Testentwürfe bleiben am Anfang erkennbar - der neue und der
frühere Anfang."""
import sys
import pathlib

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from services.shop_fulfillment import (  # noqa: E402
    EXTERNAL_ID_MAX, LEGACY_TEST_EXTERNAL_PREFIX, TEST_EXTERNAL_PREFIX, check_external_id, is_test_external_id,
    short_external_id)


def test_new_ids_fit_printful():
    assert EXTERNAL_ID_MAX == 32
    for prefix in ("", TEST_EXTERNAL_PREFIX):
        values = {short_external_id(prefix) for _ in range(50)}
        assert len(values) == 50, "zufällig, keine Wiederholung"
        for value in values:
            assert len(value) == 32 and value.startswith(prefix)
            assert check_external_id(value) == value


def test_too_long_is_rejected_before_sending():
    with pytest.raises(ValueError):
        check_external_id("x" * 33)
    with pytest.raises(ValueError):
        check_external_id(LEGACY_TEST_EXTERNAL_PREFIX + "0" * 36)


def test_test_drafts_recognised_old_and_new():
    assert is_test_external_id(short_external_id(TEST_EXTERNAL_PREFIX))
    assert is_test_external_id(LEGACY_TEST_EXTERNAL_PREFIX + "abc")
    # Bestellungen: nur Hex-Zeichen - beginnen nie mit einem der Anfänge.
    assert not any(is_test_external_id(short_external_id()) for _ in range(200))
    assert not is_test_external_id(None)


def test_prefix_too_long_is_refused():
    with pytest.raises(ValueError):
        short_external_id("p" * 20)
