"""Schlüssel der Spiel-ID-Felder (#2249, Codex-Prüfung Fund 3) - durch die echten Routen.

An einem Schlüssel hängen die IDs der Spieler (``users.game_ids.<spiel>.<schlüssel>``). Zwei Felder mit demselben Schlüssel
oder eines ohne Schlüssel lehnt der Server mit 422 ab. Altbestand bleibt speicherbar: Was schon doppelt oder leer gespeichert
ist, hält ein anderes Speichern nicht auf, nur Neues wird abgelehnt. Ein nicht kanonischer Schlüssel („PSN-ID“) bleibt, wie er
ist, und fremde Angaben am Feld auch. Erfundene Namen.
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


async def admin(flow):
    flow.act_as(await flow.add_user(role="superadmin", name="admin"))


def field(key, label=None, **extra):
    return {"key": key, "label": label or key or "Feld", "required": True, **extra}


@pytest.mark.asyncio
async def test_a_duplicate_or_empty_key_is_refused_when_creating_and_changing(flow):
    await admin(flow)
    twice = await flow.post("/api/games", json={"name": "Probe Shooter", "player_id_fields": [field("psn_id", "PSN-ID"), field("psn_id", "PSN ID")]})
    assert twice.status_code == 422
    assert "„psn_id“" in twice.json()["detail"]
    empty = await flow.post("/api/games", json={"name": "Probe Shooter", "player_id_fields": [field("  ", "ゲームID")]})
    assert empty.status_code == 422
    assert "Schlüssel" in empty.json()["detail"]

    created = await flow.post("/api/games", json={"name": "Probe Shooter", "player_id_fields": [field("psn_id", "PSN-ID")]})
    assert created.status_code == 200, created.text
    game = created.json()
    refused = await flow.patch(f"/api/games/{game['id']}", json={"player_id_fields": [field("psn_id", "PSN-ID"), field("psn_id", "PSN ID")]})
    assert refused.status_code == 422
    assert (await flow.get(f"/api/games/{game['id']}")).json()["player_id_fields"] == [field("psn_id", "PSN-ID")]


@pytest.mark.asyncio
async def test_old_doubles_and_empty_keys_stay_saveable_but_nothing_new_of_that_kind(flow):
    await admin(flow)
    await flow.db.games.insert_one({"id": "alt", "slug": "altspiel", "name": "Altspiel",
                                    "player_id_fields": [field("riot"), field("riot", "Riot 2"), field("", "Ohne")]})
    same = [field("riot", "Riot-Konto"), field("riot", "Riot 2"), field("", "Ohne")]
    kept = await flow.patch("/api/games/alt", json={"player_id_fields": same, "short_name": "ALT"})
    assert kept.status_code == 200, kept.text
    third = await flow.patch("/api/games/alt", json={"player_id_fields": [*same, field("riot", "Riot 3")]})
    assert third.status_code == 422
    another_empty = await flow.patch("/api/games/alt", json={"player_id_fields": [*same, field("", "Noch eins")]})
    assert another_empty.status_code == 422
    assert (await flow.patch("/api/games/alt", json={"short_name": "A"})).status_code == 200, "ohne ID-Felder prüft nichts"


@pytest.mark.asyncio
async def test_a_non_canonical_key_and_unknown_details_come_back_unchanged(flow):
    await admin(flow)
    created = await flow.post("/api/games", json={"name": "Probe Konsole", "player_id_fields": [field("PSN-ID", source="import")]})
    assert created.status_code == 200, created.text
    game = created.json()
    renamed = await flow.patch(f"/api/games/{game['id']}", json={"player_id_fields": [field("PSN-ID", "PlayStation-Konto", source="import")]})
    assert renamed.status_code == 200, renamed.text
    assert (await flow.get(f"/api/games/{game['id']}")).json()["player_id_fields"] == [field("PSN-ID", "PlayStation-Konto", source="import")]
