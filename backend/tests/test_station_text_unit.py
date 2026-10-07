"""Station im Klartext (#1220): der Server liefert einen fertigen Text wie „Station A · Switch 2“ - „Station“ genau
einmal, das Gerät als Name aus der Liste statt als Kürzel, ohne Gerät nur der Name, nie eine interne Kennung."""
import pathlib
import sys

import pytest
from mongomock_motor import AsyncMongoMockClient

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.station_labels import attach_station_info, device_label, station_text  # noqa: E402


def test_name_and_device_once_in_plain_words():
    assert station_text("Station A", "switch2") == "Station A · Switch 2"
    assert station_text("A", "switch2") == "Station A · Switch 2"
    assert station_text("3", "pc") == "Station 3 · PC"
    assert station_text("Racing Rig Alpha", "racing_rig") == "Racing Rig Alpha · Renn-Setup"


def test_no_double_station_and_no_double_device():
    assert station_text("Station Station A", None) == "Station Station A"  # so eingetragen - nichts dazu
    assert station_text("station b", "beamer") == "station b · Beamer"
    assert station_text("Switch 2 Station 1", "switch2") == "Switch 2 Station 1"
    assert station_text("Switch Station 3", "switch") == "Switch Station 3"
    assert station_text("Beamer Hauptbühne", "beamer") == "Beamer Hauptbühne"
    assert "Station Station" not in station_text("Station A", "switch2")


def test_without_device_or_name():
    assert station_text("Station A") == "Station A"
    assert station_text("  Ecke   Nord  ", "") == "Ecke Nord"
    assert station_text("", "switch2") == "Switch 2"
    assert station_text(None, None) == ""


def test_unknown_device_is_made_readable():
    assert device_label("vr_set") == "Vr Set"
    assert device_label("SWITCH2") == "Switch 2"
    assert station_text("B", "vr_set") == "Station B · Vr Set"


@pytest.mark.asyncio
async def test_attach_station_info_adds_the_text_and_never_an_id():
    db = AsyncMongoMockClient()["tls_station_text"]
    await db.stations.insert_many([
        {"id": "s1", "name": "Station A", "device_type": "switch2", "status": "free"},
        {"id": "s2", "name": "B", "device_type": None, "status": "busy"},
    ])
    matches = [{"id": "m1", "station_id": "s1"}, {"id": "m2", "station_id": "s2"}, {"id": "m3", "station_id": "weg"}, {"id": "m4"}]
    await attach_station_info(db, matches)
    assert matches[0]["station_text"] == "Station A · Switch 2"
    assert matches[0]["station_label"] == "Station A - switch2"  # das alte Feld bleibt für ältere Apps
    assert matches[1]["station_text"] == "Station B"
    assert matches[2]["station_text"] == ""
    assert "station_text" not in matches[3]
