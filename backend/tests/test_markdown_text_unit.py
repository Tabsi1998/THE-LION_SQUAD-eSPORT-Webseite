"""Bausteinwerte im Regelwerk (#2218): Kein Zeichen aus dem Bereich des Zwischenformats verlässt den Server, auch aus Altfassungen."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import markdown_text  # noqa: E402

RESERVED = [chr(code) for code in markdown_text.RESERVED]


def test_served_and_plain_drop_every_reserved_character():
    legacy = "Alt" + "".join(RESERVED) + "fassung"
    for result in (markdown_text.served(legacy), markdown_text.plain(legacy)):
        assert not any(char in result for char in RESERVED), result
        assert result.startswith("Alt") and result.endswith("fassung")


def test_protected_values_come_back_as_escapes_or_plain_text():
    cell = markdown_text.text_cell("[Klick](https://evil.example) **x**")
    assert markdown_text.plain(cell) == "[Klick](https://evil.example) **x**"
    assert markdown_text.served(cell) == "\\[Klick\\]\\(https://evil.example\\) \\*\\*x\\*\\*"
    assert markdown_text.served("frei \\ text") == "frei \\\\ text"
