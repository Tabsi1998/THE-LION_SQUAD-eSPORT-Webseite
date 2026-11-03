"""Werte sicher in Bausteine des Regelwerks setzen (#2218) - Blatt-Modul ohne eigene Importe aus ``services``.

Ein Name aus Bibliothek oder Modus ist Text: Jedes Markdown-Steuerzeichen darin wird beim Einsetzen durch ein Zeichen aus dem privaten
Bereich von Unicode ersetzt (``U+E000`` und folgende), das keine Markdown-Regel trifft. Erst die Darstellung setzt das echte Zeichen wieder
ein - im Web ``markdownLite`` mit ``blockText``, im PDF ``pdf_service.pdf_rules_inline``, für Wort-Vergleiche ``plain``. So bleibt nur der
Bausteinwert geschützt; ein Backslash im frei geschriebenen Regeltext bleibt, wie er ist (Review C.4).
"""
from __future__ import annotations

# Dasselbe Zeichen-Set wie im Web (markdownLite BLOCK_TEXT_CHARS) und im PDF (pdf_service._RULES_BLOCK_CHARS).
MARKDOWN_SPECIAL = "\\`*_[]()!~+"
PROTECT_BASE = 0xE000
_TO_PROTECTED = {ord(char): chr(PROTECT_BASE + index) for index, char in enumerate(MARKDOWN_SPECIAL)}
_TO_PLAIN = {PROTECT_BASE + index: char for index, char in enumerate(MARKDOWN_SPECIAL)}


def text_cell(value) -> str:
    """Ein Name als Bausteinwert: Leerraum zusammengefasst, ein senkrechter Strich (zerlegte sonst die Tabelle) wird „/“, jedes übrige
    Steuerzeichen das geschützte Zeichen - „[x](https://…)“ wird nie ein Link, „**x**“ nie fett."""
    text = " ".join(str(value or "").replace("|", "/").split())
    return text.translate(_TO_PROTECTED)


def plain(text) -> str:
    """Die geschützten Zeichen wieder als echte Zeichen - für Wort-Vergleich und alles, was Text und kein Markdown zeigt."""
    return str(text or "").translate(_TO_PLAIN)
