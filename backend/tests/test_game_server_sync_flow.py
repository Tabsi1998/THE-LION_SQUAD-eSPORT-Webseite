"""Game-Server: echter Fehler und Demo-Knopf (#2129, SP6 und SP7) - durch die echten Routen, ohne echte Abfrage.

Scheitert der Abruf, steht der echte Fehler für die Verwaltung am Server und verschwindet beim nächsten Erfolg; öffentlich
erscheint er nie. Den Demo-Knopf gibt es nur außerhalb der Produktion.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import game_server_status  # noqa: E402

REFUSED = "[WinError 10061] connection refused von probe.example:25565"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def new_server(flow) -> dict:
    admin = await flow.add_user(role="superadmin", name="Leitung")
    flow.act_as(admin)
    created = await flow.post("/api/game-servers", json={"name": "Probe Server", "visibility": "public", "sync_provider": "auto_public", "address": "probe.example:25565"})
    assert created.status_code == 200, created.text
    return created.json()


def probe_answers(monkeypatch, outcome) -> None:
    async def probe(_server):
        if isinstance(outcome, Exception):
            raise outcome
        return outcome
    monkeypatch.setattr(game_server_status, "probe_game_server", probe)


@pytest.mark.asyncio
async def test_a_failed_sync_keeps_the_real_error_for_the_admin_only(flow, monkeypatch):
    server = await new_server(flow)
    probe_answers(monkeypatch, game_server_status.GameServerProbeError(REFUSED))

    answer = await flow.post(f"/api/game-servers/{server['id']}/sync")

    assert answer.status_code == 200 and answer.json()["ok"] is False
    admin_row = (await flow.get("/api/game-servers/admin")).json()[0]
    assert admin_row["last_sync_error"] == REFUSED, "die rote Box zeigt den echten Fehler"
    assert "Port geschlossen" in admin_row["last_sync_note"], "der Hinweis erklärt ihn"
    assert "probe.example" not in admin_row["last_sync_note"]

    flow.act_as(None)
    public = (await flow.get("/api/game-servers")).json()["items"][0]
    assert "last_sync_error" not in public and "last_sync_note" not in public


@pytest.mark.asyncio
async def test_an_unexpected_error_is_shown_too_and_a_later_success_clears_it(flow, monkeypatch):
    server = await new_server(flow)
    probe_answers(monkeypatch, ValueError("x" * 800))
    await flow.post(f"/api/game-servers/{server['id']}/sync")
    row = (await flow.get("/api/game-servers/admin")).json()[0]
    assert len(row["last_sync_error"]) == 500

    probe_answers(monkeypatch, {"status": "online", "player_count": 3})
    assert (await flow.post(f"/api/game-servers/{server['id']}/sync")).json()["ok"] is True
    row = (await flow.get("/api/game-servers/admin")).json()[0]
    assert row["last_sync_error"] is None and row["status"] == "online"


@pytest.mark.asyncio
async def test_the_demo_button_only_exists_outside_production(flow, monkeypatch):
    await new_server(flow)
    assert (await flow.get("/api/game-servers/admin/meta")).json() == {"demo_tools": True}
    monkeypatch.setenv("APP_ENV", "production")
    assert (await flow.get("/api/game-servers/admin/meta")).json() == {"demo_tools": False}
    monkeypatch.setenv("APP_ENV", "test")
    flow.act_as(await flow.add_user(name="Kein Admin"))
    assert (await flow.get("/api/game-servers/admin/meta")).status_code == 403


@pytest.mark.asyncio
async def test_removing_the_demo_list_is_refused_in_production(flow, monkeypatch):
    await new_server(flow)
    await flow.db.game_servers.insert_one({"id": "demo", "slug": "rust", "name": "Demo"})
    monkeypatch.setenv("APP_ENV", "production")
    refused = await flow.delete("/api/game-servers/seeded-defaults")
    assert refused.status_code == 403
    assert await flow.db.game_servers.find_one({"id": "demo"}), "nichts entfernt"

    monkeypatch.setenv("APP_ENV", "test")
    removed = await flow.delete("/api/game-servers/seeded-defaults")
    assert removed.status_code == 200 and removed.json()["deleted"] == 1


@pytest.mark.asyncio
async def test_switching_to_manual_clears_error_and_note(flow, monkeypatch):
    server = await new_server(flow)
    probe_answers(monkeypatch, game_server_status.GameServerProbeError(REFUSED))
    await flow.post(f"/api/game-servers/{server['id']}/sync")
    assert (await flow.get("/api/game-servers/admin")).json()[0]["last_sync_error"]

    other = await flow.patch(f"/api/game-servers/{server['id']}", json={"name": "Anderer Name", "sync_provider": "auto_public"})
    assert other.json()["last_sync_error"] == REFUSED, "solange abgerufen wird, bleibt der Fehler stehen"

    manual = await flow.patch(f"/api/game-servers/{server['id']}", json={"sync_provider": "manual"})

    assert manual.status_code == 200, manual.text
    assert manual.json()["last_sync_error"] is None and manual.json()["last_sync_note"] is None
