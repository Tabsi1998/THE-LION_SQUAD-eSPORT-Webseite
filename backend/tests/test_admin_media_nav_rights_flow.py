"""Mediathek, Navigation, Streams und Bild-Übernahme im Admin: Rechte und Schutz (#932) - durch die echte Anwendung statt
gegen einen laufenden Server.

- Gäste kommen an Mediathek, Navigation und das Neuladen der Streams nicht heran (401).
- Löschen in der Mediathek nimmt nur einfache Dateinamen: ein Name mit führendem Punkt ist ungültig (400), eine fremde
  Endung gibt es nicht (404) - beides, bevor eine Datei angefasst wird.
- Die Übernahme externer Bilder meldet je Sammlung, was sie gelesen und geändert hat.

Ersetzt test_phase_fg_iter18.py::test_admin_media_traversal_protection, ::test_admin_media_anonymous_blocked,
::test_admin_nav_anonymous_blocked; test_phase_ef_iter17.py::test_admin_streams_refresh_requires_admin;
test_phase_a_quickwins.py::test_image_migration_endpoint. Erfundene Daten, keine echten Personen.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.mark.asyncio
async def test_gaeste_kommen_nicht_an_mediathek_navigation_und_streams(flow):
    flow.act_as(None)
    media = await flow.get("/api/admin/media")
    assert media.status_code == 401
    nav = await flow.put("/api/admin/nav", json={"items": []})
    assert nav.status_code == 401
    assert await flow.db.cms_nav.count_documents({}) == 0
    streams = await flow.post("/api/admin/streams/refresh")
    assert streams.status_code == 401


@pytest.mark.asyncio
async def test_mediathek_loeschen_nimmt_nur_einfache_dateinamen(flow):
    flow.act_as(await flow.add_staff())
    invalid = await flow.delete("/api/admin/media/..evil.png")
    assert invalid.status_code == 400 and invalid.json()["detail"] == "Ungültiger Dateiname."
    wrong_ext = await flow.delete("/api/admin/media/skript.exe")
    assert wrong_ext.status_code == 404 and wrong_ext.json()["detail"] == "Datei nicht gefunden."
    assert await flow.db.audit_logs.count_documents({}) == 0, "abgewiesen, bevor etwas geschieht"


@pytest.mark.asyncio
async def test_bilduebernahme_meldet_je_sammlung(flow):
    admin = await flow.add_staff()
    await flow.db.sponsors.insert_one({"id": "sp-1", "name": "Testsponsor", "logo_url": "/api/static/uploads/logo.png"})
    flow.act_as(admin)
    res = await flow.post("/api/uploads/migrate-external-images")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["ok"] is True
    summary = body["summary"]
    assert {"sponsors", "news_posts", "events", "users"} <= set(summary)
    assert summary["sponsors"] == {"scanned": 1, "updated": 0, "failed": 0}, "eine lokale Adresse bleibt, wie sie ist"
    assert summary["users"]["scanned"] == 1 and summary["users"]["updated"] == 0
