"""Web Vitals je Seite (#265): LCP, INP, CLS, TTFB und FCP von echten
Besuchern, anonym.

Der Browser schickt am Ende eines Besuchs ein paar Messwerte mit der Route
(Vorlage wie ``/news/:slug``, nicht die konkrete Adresse). Gespeichert werden
nur Metrik, Wert, Route und Geräteklasse - keine Adresse, kein Nutzer, kein
Browserkennzeichen, keine Cookies. Nach 30 Tagen ist alles weg.

Die Auswertung rechnet Median und p75 je Route und Metrik in Python, damit
sie mit der In-Memory-Datenbank der Tests dasselbe Ergebnis liefert.
"""
from __future__ import annotations

import re
from datetime import timedelta
from typing import Any

from models import now_utc

# Obergrenzen je Metrik: alles darüber ist Unsinn oder ein Fehler im Browser.
METRIC_LIMITS = {"LCP": 60000.0, "INP": 60000.0, "CLS": 10.0, "TTFB": 60000.0, "FCP": 60000.0}
# Schwellen wie web.dev: gut / verbesserungswürdig / schlecht.
THRESHOLDS = {"LCP": (2500, 4000), "INP": (200, 500), "CLS": (0.1, 0.25), "TTFB": (800, 1800), "FCP": (1800, 3000)}
DEVICES = {"mobile", "desktop"}
RETENTION_DAYS = 30
MAX_ENTRIES = 12
ROUTE_LIMIT = 120
MAX_ROWS = 40000

_ROUTE_FORBIDDEN = re.compile(r"[^A-Za-z0-9/_:.\-]")
_ID_SEGMENT = re.compile(r"/(?:[0-9a-f]{8,}|\d{3,})(?=/|$)", re.IGNORECASE)


def normalize_route(value: Any) -> str:
    text = str(value or "/").split("?", 1)[0].split("#", 1)[0].strip()
    text = _ROUTE_FORBIDDEN.sub("", text)
    text = re.sub(r"/+", "/", text)
    text = _ID_SEGMENT.sub("/:id", text)
    if not text.startswith("/"):
        text = "/" + text
    if len(text) > 1:
        text = text.rstrip("/") or "/"
    return text[:ROUTE_LIMIT]


def rate_metric(name: str, value: float) -> str:
    good, poor = THRESHOLDS[name]
    if value <= good:
        return "good"
    if value > poor:
        return "poor"
    return "needs-improvement"


def clean_entry(raw: Any) -> dict | None:
    if not isinstance(raw, dict):
        return None
    name = str(raw.get("name") or "").upper()
    if name not in METRIC_LIMITS:
        return None
    try:
        value = float(raw.get("value"))
    except (TypeError, ValueError):
        return None
    if value != value or value < 0 or value > METRIC_LIMITS[name]:  # NaN, negativ, absurd
        return None
    device = str(raw.get("device") or "desktop").lower()
    if device not in DEVICES:
        device = "desktop"
    return {
        "name": name,
        "value": round(value, 3 if name == "CLS" else 0),
        "rating": rate_metric(name, value),
        "route": normalize_route(raw.get("route")),
        "device": device,
    }


def clean_batch(raw: Any) -> list[dict]:
    entries = raw.get("entries") if isinstance(raw, dict) else raw
    if not isinstance(entries, list):
        return []
    cleaned = []
    for item in entries[:MAX_ENTRIES]:
        entry = clean_entry(item)
        if entry:
            cleaned.append(entry)
    return cleaned


async def store_vitals(db, entries: list[dict]) -> int:
    if not entries:
        return 0
    now = now_utc()
    rows = [{**entry, "at": now.isoformat(), "expires_at": now + timedelta(days=RETENTION_DAYS)} for entry in entries]
    await db.ops_vitals.insert_many(rows)
    return len(rows)


def quantile(values: list[float], share: float) -> float:
    """Linear interpoliert - bei wenigen Messwerten ehrlicher als der nächste Rang."""
    if not values:
        return 0.0
    ordered = sorted(values)
    position = share * (len(ordered) - 1)
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def _metric_summary(values: list[float], ratings: list[str], name: str) -> dict:
    p50 = quantile(values, 0.5)
    p75 = quantile(values, 0.75)
    digits = 3 if name == "CLS" else 0
    return {
        "count": len(values),
        "p50": round(p50, digits) if digits else int(round(p50)),
        "p75": round(p75, digits) if digits else int(round(p75)),
        "good_share": round(sum(1 for r in ratings if r == "good") / len(values), 2) if values else 0,
        "rating": rate_metric(name, p75) if values else None,
    }


def aggregate(rows: list[dict], limit: int = 60) -> dict:
    """Je Route und Metrik: Anzahl, Median, p75, Anteil gut; dazu das Ganze über alle Routen."""
    per_route: dict[str, dict[str, tuple[list[float], list[str]]]] = {}
    overall: dict[str, tuple[list[float], list[str]]] = {}
    for row in rows:
        name = row.get("name")
        if name not in METRIC_LIMITS:
            continue
        value = float(row.get("value") or 0)
        rating = row.get("rating") or rate_metric(name, value)
        bucket = per_route.setdefault(row.get("route") or "/", {}).setdefault(name, ([], []))
        bucket[0].append(value)
        bucket[1].append(rating)
        total = overall.setdefault(name, ([], []))
        total[0].append(value)
        total[1].append(rating)
    routes = []
    for route, metrics in per_route.items():
        summary = {name: _metric_summary(values, ratings, name) for name, (values, ratings) in metrics.items()}
        samples = max((m["count"] for m in summary.values()), default=0)
        routes.append({"route": route, "samples": samples, "metrics": summary, "worst": _worst_rating(summary)})
    routes.sort(key=lambda item: (-item["samples"], item["route"]))
    return {
        "routes": routes[:limit],
        "overall": {name: _metric_summary(values, ratings, name) for name, (values, ratings) in overall.items()},
        "samples": len(rows),
    }


def _worst_rating(summary: dict) -> str | None:
    order = {"good": 0, "needs-improvement": 1, "poor": 2}
    worst = None
    for metric in summary.values():
        rating = metric.get("rating")
        if rating and (worst is None or order[rating] > order[worst]):
            worst = rating
    return worst


async def vitals_overview(db, days: int = 7) -> dict:
    since = (now_utc() - timedelta(days=days)).isoformat()
    rows = await db.ops_vitals.find({"at": {"$gte": since}}, {"_id": 0, "name": 1, "value": 1, "rating": 1, "route": 1, "device": 1}).to_list(MAX_ROWS)
    result = aggregate(rows)
    mobile = aggregate([row for row in rows if row.get("device") == "mobile"], limit=0)["overall"]
    return {"days": days, "retention_days": RETENTION_DAYS, "mobile_overall": mobile, **result}
