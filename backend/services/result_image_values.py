"""Ergebnis-Bilder (#1756): Werte aus gelesenem Text - Platz oder Ausfall, Zahl, Zeit, Abstand, Platzhalter.

Blatt-Modul ohne eigene Importe aus dem Projekt: ``result_image_ocr`` braucht die Prüfungen grob (passt eine Spalte des
Bilds zur Spalte der Vorlage?), ``result_image_match`` genau (Wert je Zelle).
"""
from __future__ import annotations

from dataclasses import dataclass
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
    """Eine Zahl mit höchstens drei Ziffern; ``fix`` macht aus Buchstaben, die eigentlich Ziffern sind, Ziffern - aber
    nur neben mindestens einer echten Ziffer: ein einzelner Strich („|“, eine Tabellenlinie) ist keine 1."""
    key = compact(text).strip(".,:;'`´\"")  # Punkt oder Strich am Rand aus der Erkennung („44.“)
    if fix:
        if not any(char.isdigit() for char in key):
            return None
        key = key.translate(DIGIT_FIX)
    return key if key.isdigit() and len(key) <= 3 else None


def is_noise(text: str) -> bool:
    """Nur Linien, Striche oder Punkte - keine Lesung (etwa der Rand der Tabelle). Platzhalter sind kein Rauschen."""
    key = compact(text)
    return bool(key) and not any(char.isalnum() for char in key) and not is_placeholder(key)


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


def _laps(body: str) -> str | None:
    """„1Runde“, „2 Laps“ - die Überrundung als „+N Runde(n)“."""
    digits = ""
    while len(digits) < len(body) and body[len(digits)].isdigit():
        digits += body[len(digits)]
    word = body[len(digits):].casefold()
    return f"+{int(digits)} {LAP_WORDS[word]}" if digits and word in LAP_WORDS else None


def parse_gap(text: str, *, fix: bool = False, fmt: TimeFormat | None = None) -> tuple[str, float | None] | None:
    """„+2.333“, „+1:03.177“ (Sekunden) oder „+1 Runde“ (ohne Sekunden). Das Plus darf fehlen. Mit ``fmt`` setzt die
    Form des Veranstalters die Trennzeichen (``parse_clock``)."""
    key = compact(text)
    if not key:
        return None
    body = key[1:] if key[0] in "+-#" else key
    laps = _laps(body)
    if laps:
        return laps, None
    parsed = parse_clock(body, fmt, fix=fix) if fmt else parse_time(body, fix=fix)
    if parsed is None:
        return None
    return f"+{parsed[1]}", parsed[0]


# ---------------------------------------------------------------- Zeiten nach der Form des Veranstalters
@dataclass(frozen=True)
class TimeFormat:
    """Wie ein Veranstalter Zeiten schreibt: wie viele Nachkommastellen. Rennzeit „m:ss,mmm“ bzw. „mm:ss,mmm“ (mit
    Stunden „h:mm:ss,mmm“), Abstand „+s,mmm“ bzw. „+m:ss,mmm“ - welches Zeichen wo steht, ist egal: geliefert wird die
    gespeicherte Schreibweise mit Punkt vor den Nachkommastellen („1:28.783“, wie bisher; angezeigt wird im Web mit
    Komma, ``lib/raceTime.js``)."""
    decimals: int = 3


def time_format(spec: dict | None) -> TimeFormat | None:
    """Die Form aus der Vorlage (``time_format: {decimals}``) - ohne Angabe ``None`` (dann wie gelesen)."""
    if not spec:
        return None
    decimals = int(spec.get("decimals") or 3)
    return TimeFormat(decimals=min(max(decimals, 1), 3))


_SEPARATORS = ":.,;'"


def parse_clock(text: str, fmt: TimeFormat, *, fix: bool = False) -> tuple[float, str] | None:
    """Eine Zeit nach der Form des Veranstalters: Es zählen die Ziffern, die Trennzeichen setzt die Form - ein als
    „.“ statt „:“ gelesener Doppelpunkt („1.28,783“) oder ein fehlender („128,783“) ändert nichts. Stehen Trennzeichen
    da, müssen sie zur Form passen: vor dem letzten genau ``decimals`` Ziffern, zwischen zweien genau zwei - sonst fehlt
    eine Ziffer, und die Zeit gilt als nicht gelesen. Liefert Sekunden und die gespeicherte Schreibweise
    („1:28.783“)."""
    key = compact(text)
    if not any(char.isdigit() for char in key):
        return None
    if fix:
        key = key.translate(DIGIT_FIX)
    groups, current = [], ""
    for char in key:
        if char.isdigit():
            current += char
        elif char in _SEPARATORS:
            groups.append(current)
            current = ""
        else:
            return None
    groups.append(current)
    if len(groups) > 1 and (len(groups[-1]) != fmt.decimals or any(len(group) != 2 for group in groups[1:-1])
                            or not groups[0]):
        return None
    digits = "".join(groups)
    if not fmt.decimals < len(digits) <= fmt.decimals + 6:
        return None
    fraction, rest = digits[-fmt.decimals:], digits[:-fmt.decimals].lstrip("0") or "0"
    if len(rest) <= 2:
        clock, seconds = str(int(rest)), int(rest)
    elif len(rest) <= 4:
        minutes, secs = rest[:-2], rest[-2:]
        if int(secs) > 59:
            return None
        clock, seconds = f"{int(minutes)}:{secs}", int(minutes) * 60 + int(secs)
    else:
        hours, minutes, secs = rest[:-4], rest[-4:-2], rest[-2:]
        if int(minutes) > 59 or int(secs) > 59:
            return None
        clock, seconds = f"{int(hours)}:{minutes}:{secs}", (int(hours) * 60 + int(minutes)) * 60 + int(secs)
    return seconds + int(fraction) / (10 ** fmt.decimals), f"{clock}.{fraction}"
