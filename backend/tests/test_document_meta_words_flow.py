"""Dokumente (#1367): das Formular nennt die Sichtbarkeit mit denselben Wörtern wie die Plakette in der Liste.

Nur die Beschriftung ändert sich - die Werte (`members`, `internal`) bleiben, gespeicherte Dokumente gelten weiter.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
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
async def test_visibility_labels_match_the_badge_and_keep_their_values(flow):
    response = await flow.get("/api/documents/meta")
    assert response.status_code == 200, response.text
    assert response.json()["visibilities"] == [
        {"k": "members", "l": "Mitglieder"},
        {"k": "internal", "l": "Vorstand"},
    ]
