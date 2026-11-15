"""Zeitreise-Probe (#775): die Suite mit verstellter Uhr, damit kein Test „von selbst“ rot wird.

Feste Termine in Testdaten werden irgendwann vom echten Kalender überholt; der Test kippt dann ohne Änderung am Code.
Die Probe lässt die Suite so laufen, als wäre heute ``TLS_TEST_NOW`` (ISO-Datum, etwa ``2027-05-15`` oder
``2027-05-15T03:30:00+00:00``). Die Uhr läuft ab diesem Zeitpunkt weiter (``tick``), asyncio behält seine echte Uhr.

Ohne die Variable ändert sich nichts. Tests, die eine echte Uhr brauchen - Unterprozesse und Shell-Skripte mit eigener
Uhr, Zeitstempel des Dateisystems -, tragen den Marker ``real_clock`` und laufen in der Probe nicht mit.
Wöchentlich: ``.github/workflows/zeitreise-woche.yml``, lokal: ``python scripts/local_check.py --only zeitreise``.
"""

from __future__ import annotations

import importlib
import os
from datetime import datetime, timezone

import pytest

ENV = "TLS_TEST_NOW"
MARKER = "real_clock"
PRELOAD = ("pydantic.v1",)


def target_time(environ=os.environ) -> datetime | None:
    """Der Zeitpunkt der Probe als Zeit in UTC, ``None`` ohne Variable."""
    value = (environ.get(ENV) or "").strip()
    if not value:
        return None
    try:
        moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise pytest.UsageError(f'{ENV} als ISO-Datum angeben (etwa "2027-05-15"), nicht "{value}"') from error
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc)


def start(environ=os.environ):
    """Die Uhr verstellen, wenn ``TLS_TEST_NOW`` gesetzt ist. Gibt das laufende freezegun-Objekt zurück."""
    moment = target_time(environ)
    if moment is None:
        return None
    try:
        from freezegun import freeze_time
    except ImportError as error:  # nur in requirements-dev.txt, nie im Betrieb
        raise pytest.UsageError(f"{ENV} braucht freezegun aus backend/requirements-dev.txt") from error
    # Was beim Import eine eigene Klasse von ``date`` mit Metaklasse baut, muss vor dem Umstellen geladen sein - sonst
    # trifft die Klasse auf freezeguns Ersatz-Datum und scheitert („metaclass conflict“). FastAPI lädt pydantic.v1 erst
    # beim Anlegen der Routen nach.
    for module in PRELOAD:
        try:
            importlib.import_module(module)
        except ImportError:
            pass
    # Keine eigene Ausnahmeliste: freezegun nimmt für Aufrufe aus ausgenommenen Modulen die echte Uhr und prüft dazu
    # die obersten Aufrufer - ein Test direkt unter pytest bekäme sonst die echte Zeit.
    freezer = freeze_time(moment, tick=True, real_asyncio=True)
    freezer.start()
    return freezer


def deselect_real_clock(config, items) -> None:
    """In der Probe laufen Tests mit echter Uhr nicht mit; sie zählen als abgewählt, nicht als übersprungen."""
    if target_time() is None:
        return
    keep, dropped = [], []
    for item in items:
        (dropped if item.get_closest_marker(MARKER) else keep).append(item)
    if dropped:
        config.hook.pytest_deselected(items=dropped)
        items[:] = keep
