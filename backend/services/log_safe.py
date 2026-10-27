"""Werte sicher ins Protokoll schreiben (#1408).

Was von außen kommt - aus der Adresse, einem Formular oder der Antwort einer Plattform -, kann Zeilenumbrüche
enthalten. Im Protokoll sähe das aus wie eine zweite, echte Zeile, die nie geschrieben wurde. Darum werden alle
Zeilenumbrüche zu Leerzeichen, und lange Werte werden gekürzt. Mail-Adressen in einer Meldung kürzt
``mask_addresses`` - etwa in der Antwort eines Mailservers.
"""
from __future__ import annotations

import logging
import re
from typing import Any

# Was Python außer \r und \n noch als Zeilenende liest (str.splitlines) - auch das wird zum Leerzeichen.
_OTHER_LINE_BREAKS = str.maketrans({char: " " for char in "\v\f\x1c\x1d\x1e\x85  "})


def log_safe(value: Any, limit: int = 200) -> str:
    """``value`` als Teil einer einzigen Protokollzeile: ohne Zeilenumbrüche, höchstens ``limit`` Zeichen."""
    text = "" if value is None else str(value)
    return text.translate(_OTHER_LINE_BREAKS).replace("\r", " ").replace("\n", " ")[:limit]


# Eine Mail-Adresse in einem Text (#1418, nach Codex-Prüfung): der zentrale Redactor für Protokoll und Verwaltung. Jede
# Adresse wird gekürzt - erster Buchstabe, „***“, Domain -, auch mehrere in einem Text („a@x.test, bob@x.test“), mit
# Anzeigenamen („"Bob" <bob@x.test>“), „mailto:“, Plus-Adressen, Großschreibung und Unicode. Lokaler Teil und Domain
# sind alles außer Leerraum und den Trennzeichen von Adresslisten. Der Anfang muss ein Wortanfang sein - das hält die
# Suche linear.
_ADDRESS_CHAR = r"[^\s@<>()\[\]{},;:\"'`\\/]"
# Nur am Anfang eines Wortes beginnen (kein Adresszeichen davor): sonst bliebe bei sehr langen Adressen der Anfang stehen.
_ADDRESS = re.compile(rf"(?<!{_ADDRESS_CHAR})({_ADDRESS_CHAR}){_ADDRESS_CHAR}*@({_ADDRESS_CHAR}+)")


# URL-kodiertes „@“ (``%40``, auch mehrfach kodiert: ``%2540``, ``%252540``): so steht eine Adresse in Links und Suchtexten.
_ENCODED_AT = re.compile(r"%(?:25)*40", re.IGNORECASE)


def mask_addresses(value: Any) -> str:
    """``value`` als Text, jede Mail-Adresse darin gekürzt: ``paula@example.test`` wird ``p***@example.test``.
    Für Protokollzeilen zusammen mit ``log_safe`` - erst die Adressen kürzen, dann auf eine Zeile bringen."""
    text = "" if value is None else str(value)
    text = _ENCODED_AT.sub("@", text)
    return _ADDRESS.sub(lambda match: f"{match.group(1)}***@{match.group(2)}", text)


def mask_addresses_deep(value: Any) -> Any:
    """Wie ``mask_addresses``, aber durch ganze Daten: Texte, Listen und Dicts - auch die Schlüssel eines Dicts (eine
    Zuordnung „Adresse → Stand“ verrät die Adresse sonst im Schlüssel)."""
    if isinstance(value, str):
        return mask_addresses(value)
    if isinstance(value, dict):
        return {mask_addresses(key) if isinstance(key, str) else key: mask_addresses_deep(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [mask_addresses_deep(item) for item in value]
    return value


# Adressen, deren Pfad selbst ein Schlüssel ist (#1189: der persönliche Kalender-Link; #1708: die Druckdateien für
# Printful) - im Zugriffsprotokoll steht statt des Schlüssels nur „***“. Feste Höchstlänge, damit die Suche auch bei
# langen Pfaden schnell bleibt.
_SECRET_PATHS = (re.compile(r"(/api/calendar/personal/)[^/?#\s]{1,256}"),
                 re.compile(r"(/api/shop/print-files/)[^/?#\s]{1,256}"))


def redact_secret_paths(value: Any) -> str:
    """``value`` als Text, jeder geheime Pfadteil durch „***“ ersetzt: ``/api/calendar/personal/abc.ics`` →
    ``/api/calendar/personal/***``."""
    text = "" if value is None else str(value)
    for pattern in _SECRET_PATHS:
        text = pattern.sub(lambda match: f"{match.group(1)}***", text)
    return text


class SecretPathFilter(logging.Filter):
    """Für das Zugriffsprotokoll von Uvicorn (``uvicorn.access``): kürzt geheime Pfade, bevor die Zeile geschrieben
    wird. Uvicorn übergibt den Pfad als Argument der Meldung (Adresse, Methode, Pfad, HTTP-Version, Status)."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple) and record.args:
            record.args = tuple(redact_secret_paths(arg) if isinstance(arg, str) else arg for arg in record.args)
        if isinstance(record.msg, str):
            record.msg = redact_secret_paths(record.msg)
        return True
