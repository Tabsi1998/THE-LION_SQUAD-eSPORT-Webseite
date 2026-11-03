"""Werte sicher in Bausteine des Regelwerks setzen (#2218) - Blatt-Modul ohne eigene Importe aus ``services``.

Ein Name aus Bibliothek oder Modus ist Text: Jedes Markdown-Steuerzeichen darin wird beim Einsetzen durch ein Zeichen aus dem privaten
Bereich von Unicode ersetzt (``U+E000`` und folgende), das keine Markdown-Regel trifft. Das ist nur ein Zwischenformat auf dem Server: Das
PDF setzt das echte Zeichen wieder ein (``pdf_service.pdf_rules_inline``), Wort-Vergleiche nehmen ``plain``, und was die API ausliefert,
geht durch ``served`` - Namen mit Markdown-Backslash-Escapes, ein Backslash im frei geschriebenen Text verdoppelt. Das Web
(``markdownLite`` mit ``escapes``) zeigt so beides, wie es geschrieben ist; in keiner API-Antwort steht ein Schutzzeichen (Folge-Review C.4).
"""
from __future__ import annotations

# Dasselbe Zeichen-Set wie im Web (markdownLite BLOCK_TEXT_CHARS) und im PDF (pdf_service._RULES_BLOCK_CHARS).
MARKDOWN_SPECIAL = "\\`*_[]()!~+"
PROTECT_BASE = 0xE000
# Dieser Bereich gehört dem Zwischenformat: Eingegeben (freier Text, Namen) fällt ein Zeichen daraus weg.
RESERVED = range(PROTECT_BASE, PROTECT_BASE + 0x10)
_TO_PROTECTED = {ord(char): chr(PROTECT_BASE + index) for index, char in enumerate(MARKDOWN_SPECIAL)}
_TO_PLAIN = {PROTECT_BASE + index: char for index, char in enumerate(MARKDOWN_SPECIAL)}
_TO_ESCAPED = {PROTECT_BASE + index: f"\\{char}" for index, char in enumerate(MARKDOWN_SPECIAL)}
_STRIP = dict.fromkeys(RESERVED)


def strip_protected(text) -> str:
    """Eingegebener Text ohne Zeichen aus dem Bereich des Zwischenformats - sonst gäbe sich ein Zeichen als geschützter Bausteinwert aus."""
    return str(text or "").translate(_STRIP)


def text_cell(value) -> str:
    """Ein Name als Bausteinwert: Leerraum zusammengefasst, ein senkrechter Strich (zerlegte sonst die Tabelle) wird „/“, jedes übrige
    Steuerzeichen das geschützte Zeichen - „[x](https://…)“ wird nie ein Link, „**x**“ nie fett."""
    text = " ".join(strip_protected(value).replace("|", "/").split())
    return text.translate(_TO_PROTECTED)


def plain(text) -> str:
    """Die geschützten Zeichen wieder als echte Zeichen - für Wort-Vergleich und alles, was Text und kein Markdown zeigt."""
    return str(text or "").translate(_TO_PLAIN)


def served(markdown) -> str:
    """Markdown so, wie die API es ausliefert: jeder echte Backslash (nur im frei geschriebenen Text - im Bausteinwert ist er geschützt)
    verdoppelt, jedes geschützte Zeichen als Backslash-Escape. ``markdownLite`` mit ``escapes`` macht daraus genau das Geschriebene."""
    return str(markdown or "").replace("\\", "\\\\").translate(_TO_ESCAPED)
