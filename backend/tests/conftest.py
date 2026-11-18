"""Shared pytest fixtures for TLS Arena backend tests."""
import os
import sys
from datetime import datetime

import flow_mongo
import mongomock_to_list
import pytest
import rate_limit_clock
import shard_plan
import zeitreise

# Parallel mit pytest-xdist (#2054): Jeder Worker ist ein eigener Prozess mit eigener Datenbank im Speicher
# (mongomock, siehe flow_harness), teilt sich aber das Dateisystem. Darum bekommt jeder Worker einen eigenen
# Upload-Ordner unter UPLOAD_DIR - gesetzt, bevor ein Test die Anwendung importiert und den Pfad liest.
_XDIST_WORKER = os.environ.get("PYTEST_XDIST_WORKER")
if _XDIST_WORKER and os.environ.get("UPLOAD_DIR"):
    os.environ["UPLOAD_DIR"] = os.path.join(os.environ["UPLOAD_DIR"], _XDIST_WORKER)

# Ältere Tests gegen einen laufenden Server (requests auf REACT_APP_BACKEND_URL) gibt es nicht mehr: 20 Dateien sind mit
# #932 entfallen, die letzten 13 mit #2395; ihre noch gültigen Fälle laufen als Flow-Tests (Inventar:
# docs/entwicklung/altetests-932.md und altetests-2395.md). Die Liste bleibt leer - der Wächter
# test_live_test_files_inventory_unit.py lässt keine neue Live-Datei zu. Neue Abläufe gehören in Flow-Tests.
LIVE_TEST_FILES = set()


def pytest_configure(config):
    # Zeitreise-Probe (#775): mit TLS_TEST_NOW läuft die Uhr ab diesem Tag - vor dem Sammeln, damit auch Werte zählen,
    # die eine Testdatei beim Import ausrechnet. Ohne die Variable ändert sich nichts.
    config._zeitreise = zeitreise.start()
    # CI in Teilen (TEST_SHARD=n/gesamt, #2054); ohne die Variable läuft die ganze Suite.
    shard_plan.configure(config)
    # Test-Mongo: ``to_list(n)`` liefert wie Motor höchstens n Einträge (#2357), in jedem Prozess.
    mongomock_to_list.install()
    # Ablauf-Tests gegen echtes MongoDB (#2200): eine Adresse, die nicht erlaubt ist, beendet den Lauf vor dem ersten Test.
    try:
        flow_mongo.configured_url()
    except flow_mongo.FlowMongoRefused as refused:
        raise pytest.UsageError(str(refused)) from refused


def pytest_sessionfinish(session, exitstatus):
    # Die Datenbank dieses Prozesses wieder weg - auch nach roten Tests.
    flow_mongo.drop_process_database()


def pytest_unconfigure(config):
    freezer = getattr(config, "_zeitreise", None)
    if freezer is not None:
        freezer.stop()


def pytest_collection_modifyitems(config, items):
    live_enabled = bool(
        os.environ.get("REACT_APP_BACKEND_URL")
        and os.environ.get("TEST_ADMIN_EMAIL")
        and os.environ.get("TEST_ADMIN_PASSWORD")
    )
    skip_live = pytest.mark.skip(
        reason="isolated live test requires REACT_APP_BACKEND_URL, TEST_ADMIN_EMAIL, and TEST_ADMIN_PASSWORD"
    )
    for item in items:
        if item.path.name in LIVE_TEST_FILES:
            item.add_marker(pytest.mark.live)
            if not live_enabled:
                item.add_marker(skip_live)
    # Tests mit echter Uhr (Marker real_clock) laufen in der Zeitreise-Probe nicht mit (#775).
    zeitreise.deselect_real_clock(config, items)


@pytest.fixture(autouse=True, scope="session")
def mongodb_answers_fast():
    """Ohne MongoDB-Server scheitert der echte Client nach einer halben Sekunde statt nach 30 (#2054).

    Die Tests ersetzen die Datenbank (mongomock, Fakes). Ruft Code nebenbei doch ``database.get_db()`` auf, etwa für
    eine Mitteilung, wartete pymongo bisher 30 Sekunden je Abfrage auf einen Server, den es nicht gibt - der Fehler
    landete trotzdem nur im Log. Ob das passierte, hing an der Reihenfolge der Tests: ein früherer Test hatte die
    Datenbank manchmal schon ersetzt. Mit parallelen Prozessen kostete das bis zu einer Minute je Test. Das Ergebnis
    bleibt dasselbe, nur ohne die Wartezeit. Läufe gegen einen echten Server (Live-Tests) bleiben unberührt.
    """
    if os.environ.get("REACT_APP_BACKEND_URL") or not os.environ.get("MONGO_URL"):
        yield
        return
    try:
        import database
        from motor.motor_asyncio import AsyncIOMotorClient
    except ImportError:
        yield
        return
    if database._client is None:
        database._client = AsyncIOMotorClient(os.environ["MONGO_URL"], serverSelectionTimeoutMS=500)
    yield


# Ein ruhiger Tag ohne Saison: Dienstag, 15. September 2026, zu Mittag (Wien).
SEASON_TEST_NOW = "2026-09-15T12:00:00"


@pytest.fixture(autouse=True)
def season_clock(monkeypatch):
    """Die Saison-Uhr steht in jedem Test auf einem ruhigen Tag.

    „Was läuft gerade“ fragt ohne Zeitangabe die echte Uhr (``seasons.to_vienna``). Tests, die das über die Routen
    tun, hingen damit am Datum des Laufs: in der Halloween-Woche läuft Halloween von selbst, und wer prüft, dass es
    nicht läuft oder dass es „erzwungen“ ist, wird rot. Wer eine bestimmte Zeit braucht, gibt sie wie bisher mit oder
    stellt die Uhr im Test um (``monkeypatch.setattr(seasons, "to_vienna", ...)``).
    """
    try:
        from services import seasons
    except ImportError:  # Live-Tests gegen einen laufenden Server laden die Dienste nicht
        yield None
        return
    real = seasons.to_vienna
    fixed = real(datetime.fromisoformat(SEASON_TEST_NOW))
    monkeypatch.setattr(seasons, "to_vienna", lambda now=None: real(now if now is not None else fixed))
    yield fixed


@pytest.fixture(autouse=True)
def printful_rate_window():
    """Das Rate-Limit des Printful-Adapters (#1709) gilt prozessweit je Schlüssel. Jeder Test beginnt mit leerem
    Fenster - sonst würden die Aufrufe früherer Tests (alle mit demselben Testschlüssel) ihn bremsen."""
    module = sys.modules.get("services.printful_client")
    if module is not None:
        module._RATE_WINDOWS.clear()
    yield


@pytest.fixture
def still_rate_limit_clock(monkeypatch):
    """Die Uhr der Drosselung steht für diesen Test still (#2512) - für jeden Test, der über mehrere Aufrufe eine 429 aus
    ``enforce_rate_limit`` erwartet. Sonst kippt er, wenn er über einen Fensterwechsel läuft. Fenster und Grenze bleiben
    die echten; Einzelheiten in ``rate_limit_clock.py``, der Wächter ist ``test_rate_limit_clock_inventory_unit.py``."""
    return rate_limit_clock.hold_still(monkeypatch)
