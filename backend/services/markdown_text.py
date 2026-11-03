"""Text sicher ins Markdown von Regelwerk-Bausteinen setzen (#2218) - Blatt-Modul ohne eigene Importe aus ``services``.

Ein Name aus Bibliothek oder Modus ist Text: Vor jedes Steuerzeichen kommt ein Backslash. Web (``markdownLite`` mit ``escapes``) und PDF
(``pdf_service.pdf_rules_inline``) zeigen das Zeichen dann so, wie es ist - ein Name wird nie Link oder Formatierung.
"""
from __future__ import annotations

# Dasselbe Zeichen-Set wie im Web (markdownLite.ESCAPABLE) und im PDF (pdf_service._RULES_ESCAPABLE).
MARKDOWN_SPECIAL = "\\`*_[]()!~+"


def text_cell(value) -> str:
    """Ein Name als Markdown-Text: Leerraum zusammengefasst, ein senkrechter Strich (zerlegte sonst die Tabelle) wird „/“, alle übrigen
    Steuerzeichen bekommen einen Backslash - so wird „[x](https://…)“ nie ein Link und „**x**“ nie fett."""
    text = " ".join(str(value or "").replace("|", "/").split())
    return "".join(f"\\{char}" if char in MARKDOWN_SPECIAL else char for char in text)
