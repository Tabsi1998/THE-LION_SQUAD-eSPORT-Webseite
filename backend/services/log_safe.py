"""Werte sicher ins Protokoll schreiben (#1408).

Was von außen kommt - aus der Adresse, einem Formular oder der Antwort einer Plattform -, kann Zeilenumbrüche
enthalten. Im Protokoll sähe das aus wie eine zweite, echte Zeile, die nie geschrieben wurde. Darum werden alle
Zeilenumbrüche zu Leerzeichen, und lange Werte werden gekürzt. Mail-Adressen in einer Meldung kürzt
``mask_addresses`` - etwa in der Antwort eines Mailservers.
"""
from __future__ import annotations

import re
from typing import Any

# Was Python außer \r und \n noch als Zeilenende liest (str.splitlines) - auch das wird zum Leerzeichen.
_OTHER_LINE_BREAKS = str.maketrans({char: " " for char in "\v\f\x1c\x1d\x1e\x85  "})


def log_safe(value: Any, limit: int = 200) -> str:
    """``value`` als Teil einer einzigen Protokollzeile: ohne Zeilenumbrüche, höchstens ``limit`` Zeichen."""
    text = "" if value is None else str(value)
    return text.translate(_OTHER_LINE_BREAKS).replace("\r", " ").replace("\n", " ")[:limit]


# Eine Mail-Adresse in einer Meldung (etwa „550 <paula@example.test>: unbekannt“): erster Buchstabe, Rest bis zum @,
# Domain. Feste Höchstlängen halten die Suche auch bei langen Texten schnell.
_ADDRESS = re.compile(r"([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{0,63}@([A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,8})")


def mask_addresses(value: Any) -> str:
    """``value`` als Text, jede Mail-Adresse darin gekürzt: ``paula@example.test`` wird ``p***@example.test``.
    Für Protokollzeilen zusammen mit ``log_safe`` - erst die Adressen kürzen, dann auf eine Zeile bringen."""
    text = "" if value is None else str(value)
    return _ADDRESS.sub(lambda match: f"{match.group(1)}***@{match.group(2)}", text)
