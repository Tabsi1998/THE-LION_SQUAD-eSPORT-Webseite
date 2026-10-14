"""Text ohne HTML und Markdown für Discord-Meldungen (#1420: aus services/discord_announcements.py herausgelöst).

Ankündigungen und Discord-Termine kürzen damit Beschreibungen; ein Blatt, damit sich die beiden nicht gegenseitig
importieren.
"""
from __future__ import annotations

import re


def _without_tags(text: str) -> str:
    """HTML-Tags werden zu Leerzeichen (#1408). Ein Tag reicht von „<“ bis zum nächsten „>“, mit mindestens einem
    Zeichen dazwischen; „<>“ und ein „<“ ohne „>“ dahinter bleiben stehen. Das Ergebnis ist dasselbe wie früher mit
    ``re.sub(r"<[^>]+>", " ", text)`` - nur läuft es in einem Durchgang: ein langer Text voller „<“ ohne „>“ brauchte
    vorher quadratisch lange."""
    parts, pos = [], 0
    while True:
        start = text.find("<", pos)
        end = text.find(">", start + 1) if start >= 0 else -1
        if end < 0:  # kein „>“ mehr dahinter - dann auch hinter keinem späteren „<“
            break
        if end == start + 1:  # „<>“ ist kein Tag: stehen lassen, ab dem „>“ weitersuchen
            parts.append(text[pos:end])
            pos = end
        else:
            parts.append(text[pos:start] + " ")
            pos = end + 1
    parts.append(text[pos:])
    return "".join(parts)


def plain_text(value: str | None, limit: int = 300) -> str:
    text = _without_tags(value or "")
    text = re.sub(r"[#*_`>\[\]]", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"
