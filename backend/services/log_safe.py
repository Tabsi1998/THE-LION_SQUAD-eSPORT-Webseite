"""Werte sicher ins Protokoll schreiben (#1408).

Was von außen kommt - aus der Adresse, einem Formular oder der Antwort einer Plattform -, kann Zeilenumbrüche
enthalten. Im Protokoll sähe das aus wie eine zweite, echte Zeile, die nie geschrieben wurde. Darum werden alle
Zeilenumbrüche zu Leerzeichen, und lange Werte werden gekürzt.
"""
from __future__ import annotations

from typing import Any

# Was Python außer \r und \n noch als Zeilenende liest (str.splitlines) - auch das wird zum Leerzeichen.
_OTHER_LINE_BREAKS = str.maketrans({char: " " for char in "\v\f\x1c\x1d\x1e\x85  "})


def log_safe(value: Any, limit: int = 200) -> str:
    """``value`` als Teil einer einzigen Protokollzeile: ohne Zeilenumbrüche, höchstens ``limit`` Zeichen."""
    text = "" if value is None else str(value)
    return text.translate(_OTHER_LINE_BREAKS).replace("\r", " ").replace("\n", " ")[:limit]
