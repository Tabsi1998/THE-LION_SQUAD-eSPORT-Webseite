"""Wetter (#666): Sonnenzeiten für Innsbruck, Nacht nach der Sonne, Windfaktor mit Unter- und Obergrenze,
Vereinsort aus den Einstellungen, Open-Meteo eingedampft, Stand mit frischem, altem und ohne Cache, und die
Nacht überschreibt die festen Stunden der Saisonen."""
import pathlib
import sys
from datetime import date, datetime, timedelta

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from services import seasons, weather  # noqa: E402

V = seasons.VIENNA
INNSBRUCK = (47.2692, 11.4041)


def minutes(moment):
    local = moment.astimezone(V)
    return local.hour * 60 + local.minute


def test_sonnenzeiten_innsbruck():
    rise, set_ = weather.sun_times(date(2026, 10, 31), *INNSBRUCK)
    assert 400 <= minutes(rise) <= 435, rise
    assert 995 <= minutes(set_) <= 1030, set_
    rise, set_ = weather.sun_times(date(2026, 6, 21), *INNSBRUCK)
    assert 300 <= minutes(rise) <= 335, rise
    assert 1255 <= minutes(set_) <= 1290, set_


def test_nacht_nach_der_sonne():
    assert weather.night_at(datetime(2026, 10, 31, 20, 0, tzinfo=V), *INNSBRUCK) is True
    assert weather.night_at(datetime(2026, 10, 31, 12, 0, tzinfo=V), *INNSBRUCK) is False
    assert weather.night_at(datetime(2026, 10, 31, 6, 0, tzinfo=V), *INNSBRUCK) is True


def test_windfaktor():
    assert weather.wind_factor(None) == weather.wind_factor(8.0) == 0.62
    assert weather.wind_factor(0) == 0.3
    assert weather.wind_factor(25) == 1.3
    assert weather.wind_factor(100) == 1.6


def test_vereinsort_aus_einstellungen():
    assert seasons.location_from({}) == seasons.DEFAULT_LOCATION
    assert seasons.location_from({"location": {"lat": "47.1", "lon": 10.5, "name": " Telfs "}}) == {"lat": 47.1, "lon": 10.5, "name": "Telfs"}
    assert seasons.location_from({"location": {"lat": 95, "lon": 0}}) == seasons.DEFAULT_LOCATION
    assert seasons.location_from({"location": {"lat": "x", "lon": 0}}) == seasons.DEFAULT_LOCATION
    assert seasons.merge_settings({})["location"]["name"] == "Innsbruck"


def test_open_meteo_eingedampft():
    data = {"current": {"temperature_2m": 11.3, "rain": 0.2, "snowfall": 0, "weather_code": 61, "wind_speed_10m": 14.8, "wind_direction_10m": 250, "is_day": 0},
            "daily": {"sunrise": ["2026-10-31T06:55"], "sunset": ["2026-10-31T16:52"]}}
    assert weather.parse_open_meteo(data) == {"temp_c": 11.3, "wind_kmh": 14.8, "wind_dir": 250, "rain_mm": 0.2, "snow_cm": 0.0, "code": 61, "is_day": False,
                                              "sunrise": "2026-10-31T06:55", "sunset": "2026-10-31T16:52"}
    assert weather.parse_open_meteo({})["wind_kmh"] is None


def test_stand_mit_frischem_altem_und_ohne_cache():
    now = datetime(2026, 10, 31, 20, 0, tzinfo=V)
    empty = weather.current(None, None, now)
    assert empty["stale"] is True and empty["source"] == "default" and empty["night"] is True
    assert empty["wind_factor"] == 0.62 and empty["location"] == "Innsbruck" and empty["temp_c"] is None
    cache = {"weather": {"temp_c": 9.0, "wind_kmh": 30.0, "wind_dir": 90, "rain_mm": 1.5, "snow_cm": 0.0, "code": 63}, "fetched_at": (now - timedelta(minutes=5)).isoformat()}
    fresh = weather.current(cache, {"lat": INNSBRUCK[0], "lon": INNSBRUCK[1], "name": "Innsbruck"}, now)
    assert fresh["stale"] is False and fresh["source"] == "open-meteo"
    assert fresh["wind_kmh"] == 30.0 and fresh["wind_factor"] == 1.5 and fresh["wind_dir"] == 90
    assert fresh["rain_mm"] == 1.5 and fresh["temp_c"] == 9.0 and fresh["code"] == 63
    old = weather.current({**cache, "fetched_at": (now - timedelta(hours=4)).isoformat()}, None, now)
    assert old["stale"] is True and old["wind_kmh"] == 8.0 and old["rain_mm"] == 0.0


def test_nacht_ueberschreibt_die_festen_stunden():
    noon = datetime(2026, 10, 28, 12, 0, tzinfo=V)
    by_hours = seasons.active(noon, {})
    halloween = [s for s in by_hours["seasons"] if s["key"] == "halloween"][0]
    assert halloween["data"]["night"] is False
    by_sun = seasons.active(noon, {}, night=True)
    assert [s for s in by_sun["seasons"] if s["key"] == "halloween"][0]["data"]["night"] is True
    preview = seasons.active(noon, {}, preview_key="snow", night=True)
    assert preview["seasons"][0]["data"]["night"] is True
