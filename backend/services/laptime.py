"""Rundenzeiten als Text (#1584): ein Parser für Website, App und Server.

Dieselben Fälle prüfen alle drei (``frontend/src/lib/laptime.cases.json``): Komma oder Punkt, ``m:ss.mmm`` oder
``ss.mmm``, eine nackte Zahl sind Sekunden; mit Minuten höchstens 59 Sekunden, höchstens drei Nachkommastellen.
Dazu die Plausibilitätswarnung je Strecke - Standard unter 20 Sekunden oder über 10 Minuten."""
from __future__ import annotations

import re

DEFAULT_MIN_PLAUSIBLE_MS = 20_000
DEFAULT_MAX_PLAUSIBLE_MS = 10 * 60_000

_PATTERN = re.compile(r"^(?:([0-9]{1,3}):)?([0-9]{1,2}|[0-9]{1,3}(?=\.|$))(?:\.([0-9]{1,3}))?$")


def parse_lap_time(text) -> int | None:
    """Text → Millisekunden. Leer heißt keine Zeit (``None``), Unlesbares wirft ``ValueError``."""
    raw = str(text if text is not None else "").strip().replace(",", ".", 1)
    if not raw:
        return None
    match = _PATTERN.match(raw)
    if not match:
        raise ValueError("Zeit bitte als m:ss.mmm angeben, z. B. 1:24.587.")
    minutes, seconds, fraction = match.group(1), int(match.group(2)), match.group(3)
    if minutes is not None and seconds >= 60:
        raise ValueError("Mit Minuten höchstens 59 Sekunden, z. B. 1:24.587.")
    return int(minutes or 0) * 60_000 + seconds * 1000 + (int(fraction.ljust(3, "0")) if fraction else 0)


def format_lap_time(ms) -> str:
    total = int(round(float(ms)))
    return f"{total // 60_000}:{(total % 60_000) // 1000:02d}.{total % 1000:03d}"


def plausible_range(track: dict | None) -> tuple[int, int]:
    track = track or {}
    low = track.get("min_plausible_ms")
    high = track.get("max_plausible_ms")
    return (DEFAULT_MIN_PLAUSIBLE_MS if low is None else int(low), DEFAULT_MAX_PLAUSIBLE_MS if high is None else int(high))


def plausibility_warning(ms: int, track: dict | None) -> str | None:
    """``too_fast`` unter der Grenze der Strecke, ``too_slow`` darüber, sonst ``None``."""
    low, high = plausible_range(track)
    if ms < low:
        return "too_fast"
    if ms > high:
        return "too_slow"
    return None
