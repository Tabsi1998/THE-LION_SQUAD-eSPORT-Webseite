"""Vorgaben „ab Runde X“ (#1930) - ohne Datenbank, für jede Einstellung einer Saison, die mitten in der Saison wechselt.

Gespeichert wird eine Liste von Abschnitten ``[{"from_round": 1, ...}, {"from_round": 5, ...}]``: Ein Abschnitt gilt ab
seiner Runde bis vor den nächsten. So wechselt etwa der Ablauf eines Rennwochenendes nach Runde 4 (Format 1 bis R4,
Format 2 ab R5). ``normalize_phases`` prüft und sortiert, ``phase_for`` liefert den Abschnitt einer Runde,
``phase_ranges`` die Bereiche zum Anzeigen („R1–R4“, „ab R5“). Was ein Abschnitt sonst enthält, prüft der Aufrufer
(``normalize_item``) - die Regel „ab Runde X“ selbst steht nur hier und lässt sich für weitere Vorgaben (etwa
Regeländerungen, #1960) wiederverwenden.
"""
from __future__ import annotations

from typing import Callable

MAX_PHASES = 20
MAX_ROUND = 1000


def _start(value, label: str) -> int:
    if value is None or value == "":
        return 1
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise ValueError(f"{label}: „ab Runde“ als ganze Zahl.")
    try:
        number = float(value)
    except ValueError as exc:
        raise ValueError(f"{label}: „ab Runde“ als ganze Zahl.") from exc
    if not number.is_integer() or number < 1 or number > MAX_ROUND:
        raise ValueError(f"{label}: „ab Runde“ zwischen 1 und {MAX_ROUND}.")
    return int(number)


def normalize_phases(items, normalize_item: Callable[[dict, str], dict], *, label: str = "Abschnitt",
                     max_phases: int = MAX_PHASES) -> list[dict]:
    """Abschnitte geprüft und nach ``from_round`` sortiert. Der erste gilt ab Runde 1, keine Runde zweimal.
    ``normalize_item(roh, bezeichnung)`` prüft den Rest eines Abschnitts. Leer oder ``None`` heißt keine Abschnitte."""
    if items is None:
        return []
    if not isinstance(items, (list, tuple)):
        raise ValueError(f"{label}: Liste erwartet.")
    if len(items) > max_phases:
        raise ValueError(f"Höchstens {max_phases} Abschnitte.")
    out = []
    for index, raw in enumerate(items, start=1):
        if not isinstance(raw, dict):
            raise ValueError(f"{label} {index}: Angaben fehlen.")
        start = _start(raw.get("from_round"), f"{label} {index}")
        out.append({**normalize_item(raw, f"{label} ab Runde {start}"), "from_round": start})
    out.sort(key=lambda item: item["from_round"])
    starts = [item["from_round"] for item in out]
    if len(set(starts)) != len(starts):
        raise ValueError(f"{label}: Jede Runde darf nur einen Abschnitt beginnen.")
    if out and out[0]["from_round"] != 1:
        raise ValueError(f"{label}: Der erste Abschnitt gilt ab Runde 1.")
    return out


def phase_for(phases: list[dict] | None, number: int | None) -> dict | None:
    """Der Abschnitt, der in Runde ``number`` gilt (Abschnitte sortiert wie aus ``normalize_phases``)."""
    if not phases or not number:
        return None
    chosen = None
    for phase in phases:
        if phase.get("from_round", 1) <= number:
            chosen = phase
    return chosen


def phase_ranges(phases: list[dict] | None) -> list[tuple[int, int | None]]:
    """Die Runden je Abschnitt: ``(von, bis)``, beim letzten ``bis`` = ``None`` (bis zum Ende)."""
    starts = [phase.get("from_round", 1) for phase in phases or []]
    return [(start, (starts[index + 1] - 1) if index + 1 < len(starts) else None)
            for index, start in enumerate(starts)]
