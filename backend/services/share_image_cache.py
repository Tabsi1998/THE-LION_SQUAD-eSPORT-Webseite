"""Teilen-Bilder schonen den Server (#1412): einmal zeichnen, kurz behalten, öffentlich zwischenspeichern lassen.

Die öffentlichen Teilen-Bilder - das Ergebnis-Bild hoch und breit (#1194) und die Erfolgs-Karte (#619) - sind für
alle gleich. Darum:

- Im Server merkt sich ein kleiner Speicher je Bild das fertige PNG, zusammen mit einem Fingerabdruck der Daten, aus
  denen es gezeichnet wurde. Kommt dasselbe Bild mit denselben Daten noch einmal, wird nicht neu gezeichnet. Ändern
  sich die Daten (ein neues Ergebnis, ein anderer Name), passt der Fingerabdruck nicht mehr - dann wird sofort neu
  gezeichnet. Nach fünf Minuten wird ohnehin neu gezeichnet. Höchstens 200 Bilder und 32 MB; was am längsten nicht
  abgerufen wurde, fällt zuerst heraus. Der Speicher gilt je Server-Prozess und ist nach einem Neustart leer.
- Browser, Proxys und Cloudflare dürfen genau diese Bilder fünf Minuten behalten (`CACHE_CONTROL`, gesetzt in der
  Sicherheits-Middleware in server.py). Alles andere unter /api bleibt „no-store“ - auch das private Bild des
  Jahresrückblicks.

Ob ein Bild gezeigt werden darf, prüft die Route bei jedem Abruf neu, bevor sie hier nachfragt: ein Profil, das
privat geworden ist, bekommt sofort kein Bild mehr aus diesem Speicher.
"""
from __future__ import annotations

import hashlib
import json
import re
import time
from collections import OrderedDict
from typing import Any, Callable

MAX_AGE_SECONDS = 300
MAX_ENTRIES = 200
MAX_BYTES = 32 * 1024 * 1024

# Genau die öffentlichen Teilen-Bilder - ganzer Pfad, von Anfang bis Ende.
PUBLIC_IMAGE_PATH = re.compile(r"^/api/(?:share/result/[^/]+/[^/]+/(?:story|wide)|achievements/share/[^/]+)\.png$")
CACHE_CONTROL = f"public, max-age={MAX_AGE_SECONDS}"


def is_public_share_image(path: str) -> bool:
    """Ist das der Pfad eines öffentlichen Teilen-Bildes? Nur dann darf die Antwort zwischengespeichert werden."""
    return bool(PUBLIC_IMAGE_PATH.match(path or ""))


def fingerprint(data: Any) -> str:
    """Kurzer Fingerabdruck der Daten eines Bildes: gleiche Daten, gleicher Abdruck."""
    raw = json.dumps(data, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


class ImageCache:
    """Fertige Bilder je Schlüssel, solange Fingerabdruck und Alter passen - begrenzt nach Anzahl und Größe."""

    def __init__(self, max_entries: int = MAX_ENTRIES, max_bytes: int = MAX_BYTES, max_age: float = MAX_AGE_SECONDS,
                 clock: Callable[[], float] = time.monotonic):
        self.max_entries = max_entries
        self.max_bytes = max_bytes
        self.max_age = max_age
        self._clock = clock
        self._entries: OrderedDict[tuple, tuple[str, float, bytes]] = OrderedDict()
        self._bytes = 0

    def get_or_draw(self, key: tuple, data: Any, draw: Callable[[], bytes]) -> bytes:
        """Das gemerkte Bild, wenn es zu den Daten passt und jünger als fünf Minuten ist - sonst neu zeichnen."""
        stamp = fingerprint(data)
        now = self._clock()
        entry = self._entries.get(key)
        if entry and entry[0] == stamp and now - entry[1] < self.max_age:
            self._entries.move_to_end(key)
            return entry[2]
        png = draw()
        self._store(key, stamp, now, png)
        return png

    def _store(self, key: tuple, stamp: str, now: float, png: bytes) -> None:
        old = self._entries.pop(key, None)
        if old:
            self._bytes -= len(old[2])
        if len(png) > self.max_bytes:
            return  # zu groß zum Merken - wird einfach jedes Mal gezeichnet
        self._entries[key] = (stamp, now, png)
        self._bytes += len(png)
        while len(self._entries) > self.max_entries or self._bytes > self.max_bytes:
            dropped = self._entries.popitem(last=False)[1]
            self._bytes -= len(dropped[2])

    def __len__(self) -> int:
        return len(self._entries)

    def clear(self) -> None:
        self._entries.clear()
        self._bytes = 0


# Ein Speicher für alle Teilen-Bilder dieses Prozesses.
share_images = ImageCache()
