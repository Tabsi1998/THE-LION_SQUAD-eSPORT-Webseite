"""Wetter (#666) im Zusammenspiel: Abruf speichert den Stand, ein Ausfall behält den letzten; die öffentliche
Abfrage trägt Wetter und Nacht nach der Sonne; der Admin sieht Wetter und Ort, ändert den Ort und stößt den
Abruf an - alles gegen die echte Anwendung mit einer Datenbank im Speicher und einem nachgestellten Open-Meteo."""
import pathlib
import sys
from datetime import datetime

import httpx
import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import seasons, weather  # noqa: E402

V = seasons.VIENNA
SAMPLE = {
    "current": {"temperature_2m": 11.3, "rain": 0.2, "snowfall": 0, "weather_code": 61, "wind_speed_10m": 14.8, "wind_direction_10m": 250, "is_day": 0},
    "daily": {"sunrise": ["2026-10-31T06:55"], "sunset": ["2026-10-31T16:52"]},
}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


class FakeOpenMeteo:
    def __init__(self):
        self.calls = []
        self.fail = False

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(dict(request.url.params))
        if self.fail:
            return httpx.Response(503, text="down")
        return httpx.Response(200, json=SAMPLE)


@pytest.fixture
def open_meteo(monkeypatch):
    fake = FakeOpenMeteo()
    monkeypatch.setattr(weather, "_transport", httpx.MockTransport(fake.handle))
    return fake


@pytest.mark.asyncio
async def test_abruf_speichert_und_ausfall_behaelt_den_letzten_stand(flow, open_meteo):
    doc = await weather.refresh(flow.db, datetime(2026, 10, 31, 18, 0, tzinfo=V))
    assert doc["weather"]["wind_kmh"] == 14.8 and doc["error"] is None
    assert doc["location"]["name"] == "Innsbruck"
    assert open_meteo.calls[0]["latitude"] == "47.2692" and open_meteo.calls[0]["timezone"] == "Europe/Vienna"
    saved = await flow.db.settings.find_one({"id": weather.CACHE_ID}, {"_id": 0})
    assert saved["weather"]["temp_c"] == 11.3
    open_meteo.fail = True
    doc = await weather.refresh(flow.db, datetime(2026, 10, 31, 18, 10, tzinfo=V))
    assert doc["weather"]["wind_kmh"] == 14.8, "der letzte Stand bleibt"
    assert doc["error"].startswith("HTTPStatusError") and doc["fetched_at"] == saved["fetched_at"]
    assert doc["error_at"].startswith("2026-10-31T18:10")


@pytest.mark.asyncio
async def test_oeffentliche_abfrage_traegt_wetter_und_nacht(flow, open_meteo):
    flow.act_as(None)
    before = (await flow.get("/api/seasonal/active")).json()
    assert before["weather"]["source"] == "default" and before["weather"]["stale"] is True
    assert before["weather"]["wind_factor"] == 0.62 and "sunset" in before["weather"]
    await weather.refresh(flow.db)
    after = (await flow.get("/api/seasonal/active")).json()
    assert after["weather"]["source"] == "open-meteo" and after["weather"]["wind_kmh"] == 14.8
    assert after["weather"]["wind_factor"] == 0.89 and after["weather"]["rain_mm"] == 0.2
    assert isinstance(after["weather"]["night"], bool)
    # Die Nacht kommt aus der Sonne, nicht aus festen Stunden: mit Vorschau um 12 Uhr ist es Tag ...
    admin = await flow.add_user(role="club_admin", name="Vorstand")
    flow.act_as(admin)
    token = (await flow.post("/api/settings/seasons/halloween/preview", json={"at": "2026-10-28T12:00"})).json()["token"]
    flow.act_as(None)
    noon = (await flow.get(f"/api/seasonal/active?preview={token}")).json()
    assert noon["weather"]["night"] is False and noon["seasons"][0]["data"]["night"] is False
    # ... und um 17:30 im Oktober schon Nacht, obwohl die alte Regel erst ab 18 Uhr galt.
    flow.act_as(admin)
    token = (await flow.post("/api/settings/seasons/halloween/preview", json={"at": "2026-10-28T17:30"})).json()["token"]
    flow.act_as(None)
    dusk = (await flow.get(f"/api/seasonal/active?preview={token}")).json()
    assert dusk["weather"]["night"] is True and dusk["seasons"][0]["data"]["night"] is True


@pytest.mark.asyncio
async def test_admin_sieht_wetter_und_ort_und_aendert_den_ort(flow, open_meteo):
    admin = await flow.add_user(role="club_admin", name="Vorstand")
    flow.act_as(admin)
    view = (await flow.get("/api/settings/seasons")).json()
    assert view["location"] == seasons.DEFAULT_LOCATION and view["weather"]["stale"] is True
    res = await flow.put("/api/settings/seasons", json={"location": {"lat": 47.3069, "lon": 11.0691, "name": "  Telfs "}})
    assert res.status_code == 200, res.text
    assert res.json()["location"] == {"lat": 47.3069, "lon": 11.0691, "name": "Telfs"}
    assert (await flow.put("/api/settings/seasons", json={"location": {"lat": 95, "lon": 11}})).status_code == 400
    refreshed = (await flow.post("/api/settings/seasons/weather/refresh")).json()
    assert refreshed["weather"]["source"] == "open-meteo" and refreshed["weather"]["location"] == "Telfs"
    assert open_meteo.calls[-1]["latitude"] == "47.3069"
    flow.act_as(None)
    assert (await flow.post("/api/settings/seasons/weather/refresh")).status_code == 401
