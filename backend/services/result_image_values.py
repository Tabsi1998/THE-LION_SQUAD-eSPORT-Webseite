"""Ergebnis-Bilder (#1756): Werte aus gelesenem Text - Platz oder Ausfall, Zahl, Zeit, Abstand, Platzhalter.

Blatt-Modul ohne eigene Importe aus dem Projekt: ``result_image_ocr`` braucht die Prüfungen grob (passt eine Spalte des
Bilds zur Spalte der Vorlage?), ``result_image_match`` genau (Wert je Zelle).
"""
from __future__ import annotations

from difflib import SequenceMatcher

MARKS = ("dnf", "dns", "dsq")
OUT_WORDS = {"OUT", "0UT", "QUT", "OU7"}  # „OUT“ statt Platz, auch leicht verlesen
LAP_WORDS = {"runde": "Runde", "runden": "Runden", "lap": "Lap", "laps": "Laps"}
# In Zahlenspalten der Seitenlesung (ohne Whitelist): Buchstaben, die eigentlich Ziffern sind.
DIGIT_FIX = str.maketrans({"O": "0", "o": "0", "D": "0", "Q": "0", "I": "1", "l": "1", "|": "1", "i": "1",
                           "S": "5", "s": "5", "B": "8", "Z": "2", "z": "2", ",": "."})


def compact(text: str) -> str:
    return "".join(str(text or "").split())


def mark_of(text: str) -> str | None:
    """„dnf“, „dns“ oder „dsq“ - auch leicht verlesen („ONF“, „DNE“). „OUT“ (ausgeschieden) zählt als Ausfall."""
    key = compact(text).upper()
    if len(key) != 3 or key.isdigit():
        return None
    if key in OUT_WORDS:
        return "dnf"
    for mark in MARKS:
        if key == mark.upper():
            return mark
    best = max(MARKS, key=lambda mark: SequenceMatcher(None, key, mark.upper()).ratio())
    return best if SequenceMatcher(None, key, best.upper()).ratio() >= 0.66 and key[1:2] in ("N", "S") else None


def read_digits(text: str, *, fix: bool) -> str | None:
    """Eine Zahl mit höchstens drei Ziffern; ``fix`` macht aus Buchstaben, die eigentlich Ziffern sind, Ziffern."""
    key = compact(text).strip(".,:;'`´\"")  # Punkt oder Strich am Rand aus der Erkennung („44.“)
    if fix:
        key = key.translate(DIGIT_FIX)
    return key if key.isdigit() and len(key) <= 3 else None


def digits_of(text: str) -> str | None:
    """Eine Zahl mit höchstens drei Ziffern (Platz, Startnummer, Grid) - leicht verlesene Ziffern gehen."""
    return read_digits(text, fix=True)


def is_placeholder(text: str) -> bool:
    """Ein Platzhalter statt eines Werts, etwa „--:--:--,---“ oder „+--:--,---“ (keine Zeit, kein Abstand)."""
    key = compact(text)
    return (len(key) >= 3 and all(char in "-–—_:.,+" for char in key)
            and sum(char in "-–—_" for char in key) >= 2)


def parse_time(text: str, *, fix: bool = False) -> tuple[float, str] | None:
    """„1:32:15.123“, „32:15.123“ oder „1:31.207“ - Sekunden und die Schreibweise mit Punkt vor den Tausendsteln."""
    key = compact(text)
    if fix:
        key = key.translate(DIGIT_FIX)
    key = key.replace(",", ".")
    if key.count(".") != 1:
        return None
    clock, fraction = key.split(".")
    if not fraction.isdigit() or not 1 <= len(fraction) <= 3:
        return None
    parts = clock.split(":")
    if not 1 <= len(parts) <= 3 or not all(part.isdigit() for part in parts):
        return None
    if any(len(part) != 2 for part in parts[1:]) or len(parts[0]) > 2 or (len(parts) > 1 and int(parts[-1]) > 59):
        return None
    if len(parts) == 3 and int(parts[1]) > 59:
        return None
    seconds = 0.0
    for part in parts:
        seconds = seconds * 60 + int(part)
    return seconds + int(fraction) / (10 ** len(fraction)), f"{clock}.{fraction}"


def parse_gap(text: str, *, fix: bool = False) -> tuple[str, float | None] | None:
    """„+2.333“, „+1:03.177“ (Sekunden) oder „+1 Runde“ (ohne Sekunden). Das Plus darf fehlen."""
    key = compact(text)
    if not key:
        return None
    body = key[1:] if key[0] in "+-#" else key
    digits = ""
    while digits.__len__() < len(body) and body[len(digits)].isdigit():
        digits += body[len(digits)]
    word = body[len(digits):].casefold()
    if digits and word in LAP_WORDS:
        return f"+{int(digits)} {LAP_WORDS[word]}", None
    parsed = parse_time(body, fix=fix)
    if parsed is None:
        return None
    return f"+{parsed[1]}", parsed[0]
