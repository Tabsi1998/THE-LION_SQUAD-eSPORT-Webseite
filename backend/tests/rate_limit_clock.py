"""Die Uhr der Drosselung steht im Test still (#2512).

``services.rate_limit.enforce_rate_limit`` zählt in Fenstern, die an der Uhr hängen (``now.timestamp() // window``).
Ein Test, der N Aufrufe macht und beim N+1. eine 429 erwartet, wurde rot, wenn er über einen Fensterwechsel lief:
im neuen Fenster beginnt die Zählung von vorn, und der letzte Aufruf geht durch. Früher hatte jede Datei ihre eigene
Lösung (riesiges Fenster, eingefrorene Uhr an einem festen Tag); dieser Helfer ersetzt sie.

- Die Uhr steht nur für ``services.rate_limit`` still. Alle anderen Module sehen die echte (oder in der Zeitreise-Probe
  die verstellte) Uhr.
- Sie steht beim echten Jetzt, auf Sekunde 30 der laufenden Minute, also innerhalb desselben Fensters wie das echte
  Jetzt (alle Fenster sind ganze Minuten). Weil sie steht, wechselt das Fenster im Test nie. ``Retry-After`` bleibt positiv, und die Ablaufzeit der Zähler liegt in der Zukunft
  - echtes MongoDB räumt sie über den TTL-Index sonst mitten im Test ab (#2216).
- Fenster und Zahl der erlaubten Aufrufe bleiben die echte Vorgabe; auch fest verdrahtete Fenster wirken so.
- ``monkeypatch`` stellt die Uhr nach dem Test zurück.

Tests, die den Fensterwechsel oder ``Retry-After`` selbst prüfen, brauchen den Helfer nicht.
"""

from __future__ import annotations

from datetime import datetime, timezone


def hold_still(monkeypatch) -> datetime:
    """Hält die Uhr von ``services.rate_limit`` an; gibt den Zeitpunkt (UTC) zurück, an dem sie steht."""
    from services import rate_limit

    clock = rate_limit.datetime  # in der Zeitreise-Probe die Uhr von freezegun - der Helfer übernimmt ihren Tag
    moment = clock.now(timezone.utc).replace(second=30, microsecond=0)

    class StillClock(clock):
        @classmethod
        def now(cls, tz=None):
            return moment.astimezone(tz) if tz else moment.astimezone().replace(tzinfo=None)

    monkeypatch.setattr(rate_limit, "datetime", StillClock)
    return moment
