"""Regelwerk der Liga (docs/LIGA.md, #1646): Was eine unveränderliche Fassung einmal gekostet hat, kostet sie nicht noch einmal.

PDF, Vergleich und die fertige Seite einer Fassung ändern sich nie - der Schlüssel nennt alle Fassungen, aus denen sie entstehen. Darum kein
Ablauf nach Zeit; was am längsten nicht abgerufen wurde, fällt zuerst heraus. Rechnen läuft neben dem Ablauf der Anfragen, gleichzeitige
Abrufe derselben Datei warten auf eine einzige Rechnung, und mehr als zwei verschiedene laufen nicht zugleich. Der Speicher gilt je
Server-Prozess und ist nach einem Neustart leer.

Ob jemand die Datei sehen darf, prüft die Route bei jedem Abruf vorher. Entwürfe und die Vorschau kommen hier nie an.
"""
from __future__ import annotations

import asyncio
import json
from collections import OrderedDict
from typing import Any, Callable

MAX_ENTRIES = 128
MAX_BYTES = 64 * 1024 * 1024
ENTRY_MAX_BYTES = 16 * 1024 * 1024
PARALLEL_MAKES = 2


class VersionCache:
    """Fertige Dateien je Schlüssel, begrenzt nach Anzahl und Größe."""

    def __init__(self, max_entries: int = MAX_ENTRIES, max_bytes: int = MAX_BYTES):
        self.max_entries = max_entries
        self.max_bytes = max_bytes
        self.entry_max = min(ENTRY_MAX_BYTES, max_bytes)
        self.bytes = 0
        self._entries: OrderedDict[tuple, bytes] = OrderedDict()
        self._running: dict[tuple, asyncio.Task] = {}
        self._gate: asyncio.Semaphore | None = None
        self._gate_loop = None

    def __len__(self) -> int:
        return len(self._entries)

    def __contains__(self, key: tuple) -> bool:
        return key in self._entries

    def clear(self) -> None:
        self._entries.clear()
        self._running.clear()
        self.bytes = 0

    def _semaphore(self) -> asyncio.Semaphore:
        loop = asyncio.get_running_loop()
        if self._gate is None or self._gate_loop is not loop:
            self._gate, self._gate_loop = asyncio.Semaphore(PARALLEL_MAKES), loop
        return self._gate

    def _store(self, key: tuple, data: bytes) -> None:
        if len(data) > self.entry_max:
            return  # zu groß zum Merken
        self._entries[key] = data
        self.bytes += len(data)
        while len(self._entries) > self.max_entries or self.bytes > self.max_bytes:
            self.bytes -= len(self._entries.popitem(last=False)[1])

    async def _make(self, key: tuple, make: Callable[[], bytes]) -> bytes:
        try:
            async with self._semaphore():
                data = await asyncio.to_thread(make)
            self._store(key, data)
            return data
        finally:
            self._running.pop(key, None)

    async def get_or_make(self, key: tuple, make: Callable[[], bytes]) -> bytes:
        if key in self._entries:
            self._entries.move_to_end(key)
            return self._entries[key]
        task = self._running.get(key)
        if task is None or task.get_loop() is not asyncio.get_running_loop():
            task = asyncio.ensure_future(self._make(key, make))
            self._running[key] = task
        # Bricht eine Anfrage ab, rechnet die Datei für die anderen weiter.
        return await asyncio.shield(task)

    async def get_or_make_json(self, key: tuple, make: Callable[[], Any]) -> Any:
        data = await self.get_or_make(key, lambda: json.dumps(make(), ensure_ascii=False).encode("utf-8"))
        return json.loads(data)


# Ein Speicher für alle Regelwerke dieses Prozesses.
rules_cache = VersionCache()
