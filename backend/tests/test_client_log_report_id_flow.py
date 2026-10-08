"""Fehlerseite (#1230): die Kennung einer Meldung findet sich unter „Betrieb & Logs“ wieder.

Die Website zeigt Admins nach einem Absturz die Kennung, die der Server für die Meldung vergeben hat. Unter
Betrieb & Logs (App-Logs) findet die Suche den Eintrag über diese Kennung - auch über ihren Anfang.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from flow_harness import make_flow  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.mark.asyncio
async def test_kennung_der_meldung_findet_den_eintrag(flow):
    admin = await flow.add_user(role="superadmin", name="chef")
    flow.act_as(admin)
    sent = await flow.post("/api/mobile/client-logs", json={
        "level": "error", "message": "liste.map is not a function", "source": "web", "screen": "/servers", "platform": "web",
    })
    assert sent.status_code == 200
    report_id = sent.json()["id"]
    assert report_id

    # Derselbe Fehler gleich noch einmal: dieselbe Kennung (der Eintrag zählt nur hoch).
    again = await flow.post("/api/mobile/client-logs", json={
        "level": "error", "message": "liste.map is not a function", "source": "web", "screen": "/servers", "platform": "web",
    })
    assert again.json()["id"] == report_id

    other = await flow.post("/api/mobile/client-logs", json={"level": "error", "message": "etwas anderes", "source": "web", "platform": "web"})
    other_id = other.json()["id"]

    full = (await flow.get(f"/api/admin/mobile-logs?q={report_id}")).json()
    assert [row["id"] for row in full] == [report_id]
    start = (await flow.get(f"/api/admin/mobile-logs?q={report_id[:8]}")).json()
    assert report_id in [row["id"] for row in start]
    assert other_id not in [row["id"] for row in start] or other_id[:8] == report_id[:8]

    # Die Suche bleibt Text: Sonderzeichen sind keine Muster.
    assert (await flow.get("/api/admin/mobile-logs?q=.*")).json() == []
