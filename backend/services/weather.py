"""Echtes Wetter für die Jahreszeiten (#666): Open-Meteo ohne Schlüssel, alle zehn Minuten für den Vereinsort
(Vorgabe Innsbruck), zwischengespeichert in ``settings`` unter ``seasons_weather``. Fällt der Dienst aus, bleibt
der letzte Stand (als ``stale`` markiert), sonst gelten Vorgaben - die Deko fällt nie aus. Sonnenauf- und
-untergang kommen aus der Rechnung (Sonnenstandsformel), nicht vom Dienst, damit „Nacht“ auch ohne Netz stimmt.
"""
from __future__ import annotations

import logging
import math
from datetime import date, datetime, timedelta, timezone

import httpx

from services.seasons import DEFAULT_LOCATION, SETTINGS_ID, VIENNA, location_from, to_vienna

logger = logging.getLogger("tls.seasons.weather")

CACHE_ID = "seasons_weather"
OPEN_METEO = "https://api.open-meteo.com/v1/forecast"
REFRESH_MINUTES = 10
STALE_AFTER = timedelta(hours=3)
DEFAULT_WIND_KMH = 8.0
# Tests hängen hier einen httpx.MockTransport ein.
_transport = None


# ------------------------------------------------------------------ Sonne

def _julian_day(day: date) -> float:
    return day.toordinal() + 1721424.5


def _from_julian(jd: float) -> datetime:
    return datetime.fromtimestamp((jd - 2440587.5) * 86400.0, tz=timezone.utc)


def sun_times(day: date, lat: float, lon: float) -> tuple[datetime, datetime]:
    """(Aufgang, Untergang) in Europe/Vienna nach der üblichen Sonnenstandsformel - auf wenige Minuten genau."""
    # Ganze Tage seit J2000 (aufgerundet, wie in der Formel) - ohne das Aufrunden läge der Mittag zwölf Stunden daneben.
    n = math.ceil(_julian_day(day) - 2451545.0 + 0.0008)
    mean_solar = n - lon / 360.0
    anomaly = (357.5291 + 0.98560028 * mean_solar) % 360.0
    center = 1.9148 * math.sin(math.radians(anomaly)) + 0.02 * math.sin(math.radians(2 * anomaly)) + 0.0003 * math.sin(math.radians(3 * anomaly))
    ecliptic = (anomaly + center + 180.0 + 102.9372) % 360.0
    transit = 2451545.0 + mean_solar + 0.0053 * math.sin(math.radians(anomaly)) - 0.0069 * math.sin(math.radians(2 * ecliptic))
    declination = math.asin(math.sin(math.radians(ecliptic)) * math.sin(math.radians(23.44)))
    phi = math.radians(lat)
    cos_hour = (math.sin(math.radians(-0.833)) - math.sin(phi) * math.sin(declination)) / (math.cos(phi) * math.cos(declination))
    cos_hour = max(-1.0, min(1.0, cos_hour))
    hour_angle = math.degrees(math.acos(cos_hour))
    rise = _from_julian(transit - hour_angle / 360.0).astimezone(VIENNA)
    set_ = _from_julian(transit + hour_angle / 360.0).astimezone(VIENNA)
    return rise, set_


def night_at(now: datetime | None, lat: float, lon: float) -> bool:
    """Nacht heißt: vor dem Aufgang oder ab dem Untergang des Tages."""
    now = to_vienna(now)
    rise, set_ = sun_times(now.date(), lat, lon)
    return now < rise or now >= set_


# ------------------------------------------------------------------ Open-Meteo

def _num(value) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def parse_open_meteo(data: dict) -> dict:
    """Die Antwort auf das Nötige eindampfen: Temperatur, Wind (km/h, Richtung), Regen, Schnee, Wettercode, Tag/Nacht."""
    current = data.get("current") or {}
    daily = data.get("daily") or {}
    return {
        "temp_c": _num(current.get("temperature_2m")),
        "wind_kmh": _num(current.get("wind_speed_10m")),
        "wind_dir": int(_num(current.get("wind_direction_10m")) or 0),
        "rain_mm": _num(current.get("rain")) or 0.0,
        "snow_cm": _num(current.get("snowfall")) or 0.0,
        "code": int(_num(current.get("weather_code")) or 0),
        "is_day": bool(current.get("is_day", 1)),
        "sunrise": (daily.get("sunrise") or [None])[0],
        "sunset": (daily.get("sunset") or [None])[0],
    }


async def fetch(location: dict) -> dict:
    params = {
        "latitude": location["lat"], "longitude": location["lon"],
        "current": "temperature_2m,rain,snowfall,weather_code,wind_speed_10m,wind_direction_10m,is_day",
        "daily": "sunrise,sunset", "timezone": "Europe/Vienna", "forecast_days": 1,
    }
    async with httpx.AsyncClient(timeout=8.0, transport=_transport) as client:
        response = await client.get(OPEN_METEO, params=params)
        response.raise_for_status()
        return parse_open_meteo(response.json())


async def load(db) -> tuple[dict, dict]:
    """(Cache-Dokument, Vereinsort) - der Ort kommt aus den Saison-Einstellungen."""
    stored = await db.settings.find_one({"id": SETTINGS_ID}, {"_id": 0}) or {}
    cache = await db.settings.find_one({"id": CACHE_ID}, {"_id": 0}) or {}
    return cache, location_from(stored)


async def refresh(db, now: datetime | None = None) -> dict:
    """Job und Admin-Knopf: holen und speichern; bei Fehler den letzten Stand behalten und den Fehler notieren."""
    cache, location = await load(db)
    now = to_vienna(now)
    try:
        weather = await fetch(location)
        doc = {"id": CACHE_ID, "location": location, "weather": weather, "fetched_at": now.isoformat(), "error": None, "error_at": None}
    except Exception as exc:  # noqa: BLE001 - jeder Ausfall wird gleich behandelt: alter Stand bleibt
        logger.warning("[weather] Abfrage fehlgeschlagen: %s", exc)
        doc = {"id": CACHE_ID, "location": location, "weather": cache.get("weather"), "fetched_at": cache.get("fetched_at"),
               "error": f"{type(exc).__name__}: {exc}"[:200], "error_at": now.isoformat()}
    await db.settings.update_one({"id": CACHE_ID}, {"$set": doc}, upsert=True)
    return doc


# ------------------------------------------------------------------ Für Web, App und Admin

def wind_factor(kmh: float | None) -> float:
    """0,3 (Flaute) bis 1,6 (kräftig): die Deko steht nie ganz still und tobt nie wie im Sturm."""
    if kmh is None:
        return wind_factor(DEFAULT_WIND_KMH)
    return round(max(0.3, min(1.6, 0.3 + kmh / 25.0)), 2)


def _parse_time(value) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(str(value))
    except (TypeError, ValueError):
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=VIENNA)


DEMO_RAIN_MM = 2.5
DEMO_WIND_KMH = 24.0
DEMO_CODE = 95  # WMO: Gewitter


def demo(conditions: dict) -> dict:
    """Der Stand für „Vorschau 60 Sekunden“ der Saison „Wetter“: ein Gewitterregen, damit es auch an einem
    trockenen Tag etwas zu sehen gibt. Ort, Sonne und Nacht bleiben echt; gespeichert wird nichts."""
    return {**conditions, "rain_mm": DEMO_RAIN_MM, "snow_cm": 0.0, "code": DEMO_CODE, "wind_kmh": DEMO_WIND_KMH,
            "wind_factor": wind_factor(DEMO_WIND_KMH), "stale": False, "error": None, "source": "demo", "demo": True}


def current(cache: dict | None, location: dict | None = None, now: datetime | None = None) -> dict:
    """Was Web und App bekommen: Nacht nach der Sonne, Wind als Faktor, Regen, Schnee, Temperatur - aus dem Cache oder Vorgaben."""
    now = to_vienna(now)
    location = location or dict(DEFAULT_LOCATION)
    rise, set_ = sun_times(now.date(), location["lat"], location["lon"])
    cache = cache or {}
    weather = cache.get("weather") or {}
    fetched = _parse_time(cache.get("fetched_at"))
    stale = fetched is None or now - fetched > STALE_AFTER or not weather
    wind = None if stale else weather.get("wind_kmh")
    return {
        "location": location["name"],
        "night": now < rise or now >= set_,
        "sunrise": rise.isoformat(),
        "sunset": set_.isoformat(),
        "temp_c": None if stale else weather.get("temp_c"),
        "wind_kmh": DEFAULT_WIND_KMH if wind is None else wind,
        "wind_dir": 270 if stale else int(weather.get("wind_dir") or 0),
        "wind_factor": wind_factor(wind),
        "rain_mm": 0.0 if stale else float(weather.get("rain_mm") or 0.0),
        "snow_cm": 0.0 if stale else float(weather.get("snow_cm") or 0.0),
        "code": None if stale else weather.get("code"),
        "fetched_at": cache.get("fetched_at"),
        "stale": stale,
        "error": cache.get("error"),
        "source": "default" if stale else "open-meteo",
    }
