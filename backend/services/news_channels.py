"""Wo eine News erscheint (#1532): Website und App, nur App oder nur Website - die Regel an einer Stelle.

``channels`` an der News ist eine Liste aus ``web`` und ``app``. Alte News ohne Feld (oder mit kaputtem Wert) gelten als
beides - ohne Migration, gerechnet beim Lesen. Die Sichtbarkeit (öffentlich, Community, Mitglieder, intern) bleibt davon
unabhängig und wird zusätzlich geprüft.

Wer fragt: Website und App teilen sich ``/api/news``, ``/api/news/{slug}``, ``/api/news-meta``, ``/api/search``, die
Event-Seite und die Mitglieder-Übersicht. Die Website sagt sich mit der Kopfzeile ``X-LSW-Channel: web`` an
(``frontend/src/lib/api.js``, für jeden Aufruf). Die veröffentlichte App sendet keine Kopfzeile - ohne Angabe gilt
deshalb ``app``. Wege, die nur einer Seite gehören, legen den Kanal selbst fest: Startseite, Sitemaps, Link-Vorschau
und Partnerseiten sind Web, ``/api/mobile/…`` ist App.

Ein direkter Link ist kein Kanal-Filter in der App: Android öffnet Website-Links auf ``/news/…`` in der App (App-Links),
dort öffnet jede News. Im Web zeigt die Detailseite bei „nur App“ statt des Inhalts den Hinweis auf die LionsAPP.
"""
from __future__ import annotations

from typing import Any, Iterable

CHANNELS = ("web", "app")
DEFAULT_CHANNELS = ["web", "app"]
CHANNEL_HEADER = "X-LSW-Channel"
APP_ONLY_CODE = "app_only"
APP_ONLY_MESSAGE = "Diese Nachricht gibt es nur in der LionsAPP. Öffne sie in der App."


def post_channels(post: dict | None) -> set[str]:
    """Die Kanäle einer News - ohne Feld, leer oder unbrauchbar: beide."""
    raw = (post or {}).get("channels")
    if not isinstance(raw, (list, tuple)):
        return set(CHANNELS)
    found = {value for value in raw if value in CHANNELS}
    return found or set(CHANNELS)


def in_channel(post: dict | None, channel: str) -> bool:
    return channel in post_channels(post)


def only_channel(post: dict | None) -> str | None:
    """``web`` oder ``app``, wenn die News nur dort erscheint - sonst None."""
    found = post_channels(post)
    return next(iter(found)) if len(found) == 1 else None


def filter_channel(posts: Iterable[dict], channel: str) -> list[dict]:
    return [post for post in posts if in_channel(post, channel)]


def clean_channels(value: Iterable[str]) -> list[str]:
    """Zum Speichern: feste Reihenfolge, nichts doppelt. Leer oder unbekannt ist ein Fehler."""
    values = list(value or [])
    if not values or any(item not in CHANNELS for item in values):
        raise ValueError("Bitte wählen, wo der Beitrag erscheint: Website, App oder beides.")
    return [channel for channel in CHANNELS if channel in values]


def request_channel(request: Any) -> str:
    """``web`` nur mit der Kopfzeile der Website - alles andere (die App sendet nichts) ist ``app``."""
    headers = getattr(request, "headers", None) or {}
    value = str(headers.get(CHANNEL_HEADER) or headers.get(CHANNEL_HEADER.lower()) or "").strip().lower()
    return "web" if value == "web" else "app"


def notification_meta(post: dict | None) -> dict:
    """Zusätze für ``create_user_notification`` je Kanal der News.

    Nur App: App-Push und App-Postfach; keine Browser-Meldung und keine Discord-Nachricht - deren Links führen zur
    Website. Nur Website: Glocke, Browser-Meldung und Discord, aber kein App-Push. ``only_channel`` hält die Meldung aus
    dem Postfach der anderen Seite heraus.
    """
    only = only_channel(post)
    if only == "app":
        return {"only_channel": "app", "no_browser": True, "no_discord": True}
    if only == "web":
        return {"only_channel": "web", "no_push": True}
    return {}


def inbox_query(channel: str) -> dict:
    """Teil der Abfrage für das Postfach einer Seite: Meldungen nur für die andere Seite bleiben draußen."""
    other = "app" if channel == "web" else "web"
    return {"meta.only_channel": {"$ne": other}}
