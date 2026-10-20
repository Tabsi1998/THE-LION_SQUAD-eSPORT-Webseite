"""Kurzer Server-Cache für ``GET /api/reference-series/public/running`` (#1753).

Seit „Heute im Einsatz“ auf der Startseite steht, fragt jeder Startseitenaufruf die laufenden Saisons ab. Die Antwort
hängt nur am Wiener Tag und daran, welche Sichtbarkeitsstufen (öffentlich, Community, Mitglieder, intern) die
anfragende Person sieht - nie an der Person selbst. Gemerkt wird sie deshalb je Tag und Stufe für ``TTL_SECONDS``.

Geleert wird auf zwei Wegen:
- sofort nach jedem schreibenden Aufruf der Serien-Verwaltung (Serien, Spuren, Termine, Ergebnisse, Teilnehmer,
  Captains): die Router hängen ``reset_after_write`` als Abhängigkeit an, die nach der Antwort-Erzeugung leert. So sieht
  der Vorstand eine Änderung sofort auf der Startseite.
- über die Frist für alles, was die Antwort nur mittelbar ändert (Mitgliederprofil deaktiviert, Konto gelöscht) - dort
  einen eigenen Reset einzubauen wäre fehleranfällig, 60 Sekunden Verzug sind auf der Startseite unkritisch.
"""
from __future__ import annotations

import time

from fastapi import Request

TTL_SECONDS = 60
MAX_ENTRIES = 32

_cache: dict[tuple, tuple[float, dict]] = {}


def _now() -> float:
    return time.monotonic()


def get(key: tuple) -> dict | None:
    entry = _cache.get(key)
    if entry and entry[0] > _now():
        return entry[1]
    return None


def put(key: tuple, value: dict) -> None:
    if key not in _cache and len(_cache) >= MAX_ENTRIES:
        _cache.pop(next(iter(_cache)))
    _cache[key] = (_now() + TTL_SECONDS, value)


def reset() -> None:
    _cache.clear()


async def reset_after_write(request: Request):
    """Router-Abhängigkeit der Serien-Verwaltung: nach jedem schreibenden Aufruf ist der Cache leer. Geleert wird nach
    dem Handler (``yield``), damit kein gleichzeitiger Lesezugriff den alten Stand wieder hineinlegt."""
    yield
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        reset()
