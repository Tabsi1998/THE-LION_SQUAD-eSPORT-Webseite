"""Der Passwortvertrag (#1033) - die einzige Stelle, an der die Regeln stehen.

Gilt gleich für Registrierung (Web und App), Passwort ändern, Zurücksetzen, Einladung, Einrichtung und Anmeldung:

- Unicode wird nach NFC vereinheitlicht. Ein „ä“ ist ein Zeichen, egal ob das Gerät es zusammengesetzt
  oder als „a“ plus Punkte schickt.
- Leerzeichen bleiben, wie sie sind: nichts wird abgeschnitten, auch nicht am Anfang oder Ende.
- Ein neues Passwort hat mindestens ``MIN_PASSWORD_LENGTH`` Zeichen und höchstens ``MAX_PASSWORD_BYTES`` Byte
  in UTF-8 (die Grenze von bcrypt). Es besteht nicht nur aus Leerzeichen und enthält keine Steuerzeichen.
- Anmelden und Bestätigen prüfen nur gegen den gespeicherten Hash, nie gegen die Regel für neue Passwörter.
  Konten von vor diesem Vertrag melden sich weiter an (siehe ``verification_candidates``); neue Hashes tragen die
  Markierung ``password_contract`` am Konto und werden nur streng geprüft (``auth.password_fields``).

Web und App zeigen dieselben Regeln: ``frontend/src/lib/passwordRules.js`` und der Hinweis in der App.
"""
from __future__ import annotations

import unicodedata
from typing import Annotated, Optional

from pydantic import AfterValidator
from pydantic_core import PydanticCustomError

MIN_PASSWORD_LENGTH = 10
MAX_PASSWORD_BYTES = 72

MESSAGE_CONTROL = "Das Passwort darf keine Steuerzeichen wie Tabulator oder Zeilenumbruch enthalten."
MESSAGE_BLANK = "Das Passwort darf nicht nur aus Leerzeichen bestehen."
MESSAGE_TOO_SHORT = f"Das Passwort braucht mindestens {MIN_PASSWORD_LENGTH} Zeichen."
MESSAGE_TOO_LONG = (
    f"Das Passwort ist zu lang: höchstens {MAX_PASSWORD_BYTES} Byte. "
    "Umlaute zählen doppelt, Emojis vierfach."
)


def normalize_password(value: str) -> str:
    """Die eine Form, in der ein Passwort gehasht und geprüft wird. Leerzeichen bleiben unverändert."""
    return unicodedata.normalize("NFC", value)


def password_problem(value: str) -> Optional[str]:
    """Warum ``value`` als neues Passwort nicht geht - oder ``None``, wenn es passt."""
    normalized = normalize_password(value)
    if any(unicodedata.category(char) in ("Cc", "Cs") for char in normalized):
        return MESSAGE_CONTROL
    if normalized and not normalized.strip():
        return MESSAGE_BLANK
    if len(normalized) < MIN_PASSWORD_LENGTH:
        return MESSAGE_TOO_SHORT
    if len(normalized.encode("utf-8")) > MAX_PASSWORD_BYTES:
        return MESSAGE_TOO_LONG
    return None


def new_password_bytes(value: str) -> bytes:
    """Die Bytes, aus denen der Hash eines neuen Passworts entsteht. Außerhalb des Vertrags: ``ValueError``."""
    problem = password_problem(value)
    if problem:
        raise ValueError(problem)
    return normalize_password(value).encode("utf-8")


def contract_bytes(value: str) -> Optional[bytes]:
    """Die Eingabe in der Form des Vertrags (NFC, ungekürzt) - oder ``None``, wenn sie so nicht hashbar ist.

    Prüft nur die Form, nicht die Regeln für neue Passwörter: ein älteres, kürzeres Passwort lässt sich so neu hashen.
    """
    try:
        encoded = normalize_password(value).encode("utf-8")
    except UnicodeError:
        return None
    return encoded if len(encoded) <= MAX_PASSWORD_BYTES else None


def verification_candidates(value: str) -> list[bytes]:
    """Die Formen, die bei einem Konto ohne Vertragsmarkierung gegen den gespeicherten Hash geprüft werden.

    Zuerst die Form des Vertrags. Dazu kommt die Eingabe so, wie sie früher gehasht wurde: unverändert und
    ab Byte 72 abgeschnitten, so wie bcrypt es damals selbst getan hat. So melden sich bestehende Konten weiter an.
    Konten mit Markierung prüfen nur ``contract_bytes``.
    """
    candidates: list[bytes] = []
    for form in (normalize_password(value), value):
        encoded = form.encode("utf-8")[:MAX_PASSWORD_BYTES]
        if encoded not in candidates:
            candidates.append(encoded)
    return candidates


def _validated_new_password(value: str) -> str:
    problem = password_problem(value)
    if problem:
        raise PydanticCustomError("password_policy", problem)
    return normalize_password(value)


# Feldtyp für jedes neue Passwort in einem Anfragemodell. Liefert die vereinheitlichte Form.
NewPassword = Annotated[str, AfterValidator(_validated_new_password)]
