"""Partner-Plattformen (#1964): woher eine Turnierserie ihre Turniertage lesen darf - und wie.

- **Feste Positivliste:** Je Plattform stehen die erlaubten Adressen hier im Code (``PLATFORMS``). Eine Saison wählt
  daraus, frei eingeben lässt sich keine Adresse - so wird der Server nie zu einem beliebigen Ziel geschickt. Nur
  ``https``, ohne Port, Pfad, Zugangsdaten oder Anhang. Pfade setzt dieses Modul aus festen Teilen und Kennungen, die
  nur aus Ziffern bestehen (``tft_dashboard.valid_ref``).
- **Abruf:** nur lesend (GET), ohne Weiterleitungen, mit Zeitlimit je Schritt und insgesamt (``TOTAL_SECONDS``) und
  Größenlimit (``MAX_BYTES``, auch ohne Längenangabe beim Lesen gezählt). Jeder Fehler wird ``SourceError`` mit fester
  Meldung - nie Text aus der Antwort oder der Ausnahme. Ein Fehler stoppt nur den Abruf, nie eine Seite.
- **Zwischenspeicher:** im Speicher des Prozesses, ``CACHE_SECONDS`` lang, und nur das schon eingedampfte Ergebnis des
  Adapters (``services/tft_dashboard.py``) - keine Rohantwort, keine Riot-Kennungen, keine Avatare. Fehler werden nicht
  gespeichert. Gegen zu viele Abrufe zählen die Routen zusätzlich je Konto (``rate_limit``).

Tests hängen über ``_transport`` einen ``httpx.MockTransport`` ein - kein Test ruft ins Internet.
"""
from __future__ import annotations

import asyncio
import copy
import json
import logging
import time
from dataclasses import dataclass
from typing import Any, Callable
from urllib.parse import urlsplit

import httpx

from services import tft_dashboard

logger = logging.getLogger("tls.partner_platforms")


@dataclass(frozen=True)
class Platform:
    key: str
    label: str
    provider: str  # Name des Partners für den Hinweis „Daten von …“ auf der Serienseite
    base_urls: tuple[str, ...]


PLATFORMS: dict[str, Platform] = {
    "tft_dashboard": Platform("tft_dashboard", "TFT-Dashboard", "PineApps", ("https://tft.pineapps.at",)),
}
TFT_PATHS = {"series_list": "/api/series", "series": "/api/series/{ref}", "tournament": "/api/tournaments/{ref}"}

CONNECT_SECONDS = 5.0
READ_SECONDS = 10.0
TOTAL_SECONDS = 20.0
MAX_BYTES = 2_000_000
CACHE_SECONDS = 600
CACHE_ENTRIES = 64
HEADERS = {"Accept": "application/json", "User-Agent": "THE-LION-SQUAD-Referenzen/1.0 (nur lesend)"}

NOT_ALLOWED = "Diese Adresse bzw. Kennung ist für die Partner-Plattform nicht erlaubt."
TIMEOUT_MESSAGE = "Die Partner-Plattform hat nicht rechtzeitig geantwortet - bitte später noch einmal holen."
UNREACHABLE_MESSAGE = "Die Partner-Plattform ist gerade nicht erreichbar - bitte später noch einmal holen."
STATUS_MESSAGE = "Die Partner-Plattform hat die Anfrage nicht beantwortet - bitte später noch einmal holen."
SIZE_MESSAGE = "Die Antwort der Partner-Plattform ist zu groß - abgebrochen."
FORMAT_MESSAGE = tft_dashboard.FORMAT_MESSAGE

# Tests hängen hier einen httpx.MockTransport ein.
_transport = None
_cache: dict[str, tuple[float, Any]] = {}
_locks: dict[str, asyncio.Lock] = {}


class SourceError(Exception):
    """Abruf gescheitert - ``str(error)`` ist immer eine der festen Meldungen oben."""


def _now() -> float:
    return time.monotonic()


def clear_cache() -> None:
    _cache.clear()
    _locks.clear()


# ---------------------------------------------------------------- Positivliste
def platform(key) -> Platform | None:
    return PLATFORMS.get(key) if isinstance(key, str) else None


def choices() -> list[dict]:
    """Für die Verwaltung: Plattformen mit ihren erlaubten Adressen."""
    return [{"key": item.key, "label": item.label, "provider": item.provider, "base_urls": list(item.base_urls)}
            for item in PLATFORMS.values()]


def allowed_base_url(key, value) -> str | None:
    """Die Adresse in ihrer festen Form, wenn sie auf der Liste der Plattform steht - sonst ``None``."""
    found = platform(key)
    if found is None or not isinstance(value, str) or not value.strip():
        return None
    try:
        parts = urlsplit(value.strip())
        port = parts.port
    except ValueError:
        return None
    if parts.scheme.lower() != "https" or parts.username or parts.password or port is not None:
        return None
    if parts.path not in ("", "/") or parts.query or parts.fragment or not parts.hostname:
        return None
    normal = f"https://{parts.hostname.lower()}"
    return normal if normal in found.base_urls else None


def public_hint(source, partners: dict | None) -> dict | None:
    """Hinweis „Daten von …“ für die Serienseite: Name des Partners der Plattform, ihre Adresse und - wenn in der
    Quelle gewählt und an der Saison verknüpft (#1934) - der Partner mit seiner Seite. Ohne Quelle ``None``."""
    found = platform(source.get("platform")) if isinstance(source, dict) else None
    if found is None:
        return None
    people = [*((partners or {}).get("organizers") or []), *((partners or {}).get("contributors") or [])]
    partner = next((item for item in people if item.get("id") and item.get("id") == source.get("partner_id")), None)
    return {"provider": found.provider,
            "url": allowed_base_url(found.key, source.get("base_url")) or found.base_urls[0],
            "partner": {key: partner.get(key) for key in ("id", "slug", "name")} if partner else None}


def _url(key: str, base_url, path: str, ref=None) -> str:
    base = allowed_base_url(key, base_url)
    if base is None or (ref is not None and not tft_dashboard.valid_ref(ref)):
        raise SourceError(NOT_ALLOWED)
    return base + (path.format(ref=str(ref)) if ref is not None else path)


# ---------------------------------------------------------------- Abruf
async def _download(url: str) -> bytes:
    timeout = httpx.Timeout(READ_SECONDS, connect=CONNECT_SECONDS)
    async with httpx.AsyncClient(timeout=timeout, transport=_transport, follow_redirects=False,
                                 headers=HEADERS) as client:
        async with client.stream("GET", url) as response:
            if response.status_code != 200:
                raise SourceError(STATUS_MESSAGE)
            declared = response.headers.get("content-length", "")
            if declared.isdigit() and int(declared) > MAX_BYTES:
                raise SourceError(SIZE_MESSAGE)
            body = bytearray()
            async for chunk in response.aiter_bytes():
                body.extend(chunk)
                if len(body) > MAX_BYTES:
                    raise SourceError(SIZE_MESSAGE)
            return bytes(body)


async def _fetch(url: str, parse: Callable[[Any], Any]) -> Any:
    try:
        body = await asyncio.wait_for(_download(url), TOTAL_SECONDS)
    except SourceError:
        raise
    except (asyncio.TimeoutError, httpx.TimeoutException):
        raise SourceError(TIMEOUT_MESSAGE) from None
    except httpx.HTTPError:
        raise SourceError(UNREACHABLE_MESSAGE) from None
    try:
        return parse(json.loads(body))
    except ValueError:  # kein JSON oder unerwartete Form (``SourceFormatError`` ist ein ValueError)
        raise SourceError(FORMAT_MESSAGE) from None


async def _cached(url: str, parse: Callable[[Any], Any]) -> Any:
    """Aus dem Zwischenspeicher oder frisch geholt - immer als Kopie, damit niemand den gespeicherten Stand ändert."""
    hit = _cache.get(url)
    if hit and hit[0] > _now():
        return copy.deepcopy(hit[1])
    lock = _locks.setdefault(url, asyncio.Lock())
    async with lock:
        hit = _cache.get(url)
        if hit and hit[0] > _now():
            return copy.deepcopy(hit[1])
        try:
            value = await _fetch(url, parse)
        except SourceError as error:
            logger.warning("[partner] Abruf gescheitert: %s", error)
            raise
        if len(_cache) >= CACHE_ENTRIES:
            _cache.pop(min(_cache, key=lambda item: _cache[item][0]), None)
        _cache[url] = (_now() + CACHE_SECONDS, value)
        return copy.deepcopy(value)


async def series_list(key: str, base_url) -> list[dict]:
    return await _cached(_url(key, base_url, TFT_PATHS["series_list"]), tft_dashboard.series_list)


async def series_tournaments(key: str, base_url, ref) -> list[dict]:
    return await _cached(_url(key, base_url, TFT_PATHS["series"], ref), tft_dashboard.series_tournaments)


async def tournament(key: str, base_url, ref) -> dict:
    return await _cached(_url(key, base_url, TFT_PATHS["tournament"], ref), tft_dashboard.tournament)
