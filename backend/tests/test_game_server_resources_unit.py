from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from auth import get_current_user, get_optional_user
from routes import game_server_routes as routes


class Documents:
    def __init__(self, rows=()):
        self.rows = deepcopy(list(rows))

    def matches(self, row, query):
        return all(row.get(key) in value["$in"] if isinstance(value, dict) else row.get(key) == value for key, value in query.items())

    async def find_one(self, query, *_args):
        return next((deepcopy(row) for row in self.rows if self.matches(row, query)), None)

    async def insert_one(self, row):
        self.rows.append(deepcopy(row))

    async def update_one(self, query, update):
        for row in self.rows:
            if self.matches(row, query):
                row.update(deepcopy(update["$set"]))

    def find(self, query, *_args):
        cursor = SimpleNamespace(to_list=AsyncMock(return_value=[deepcopy(row) for row in self.rows if self.matches(row, query)]))
        cursor.sort = lambda *_args: cursor
        return cursor


@pytest.fixture
def setup(monkeypatch):
    game = {"id": "minecraft", "name": "Minecraft", "logo_url": "/api/static/uploads/game.png"}
    db = SimpleNamespace(games=Documents([game]), game_servers=Documents())
    monkeypatch.setattr(routes, "get_db", lambda: db)
    monkeypatch.setattr(routes, "unique_slug", AsyncMock(return_value="modded-server"))
    # Rechte nach Bereichen (#287): der Wächter fragt den Vorstand ab - hier ohne Datenbank.
    from services import permissions
    monkeypatch.setattr(permissions, "is_board_holder", AsyncMock(return_value=False))
    monkeypatch.setattr(permissions, "areas_from_dolibarr", AsyncMock(return_value=None))
    app = FastAPI()
    app.include_router(routes.router)
    app.dependency_overrides[get_current_user] = lambda: {"id": "admin", "role": "superadmin", "mfa_enabled": True, "auth_mfa_verified": True}
    app.dependency_overrides[get_optional_user] = lambda: None
    with TestClient(app) as client:
        yield client, db, app


def resource(**overrides):
    return {"kind": "modloader", "enabled": True, "label": "Loader", "version": "1.2", "url": "https://downloads.example/loader", **overrides}


@pytest.mark.parametrize("url", ["javascript:alert(1)", "data:text/html,test", "file:///etc/passwd", "http://example.test/mod", "//example.test/mod", "https://user:password@example.test/mod", "https://example.test\\@evil.test", "https://example.test/\nmod", "https://example.test:99999/mod", "https://example.test:0/mod", "https://"])
def test_unsafe_download_links_are_rejected_even_when_disabled(url):
    with pytest.raises(ValidationError):
        routes.ServerModResource(**resource(url=url, enabled=False))


def test_enabled_link_requires_url_and_resource_count_is_bounded():
    with pytest.raises(ValidationError):
        routes.ServerModResource(**resource(url=""))
    with pytest.raises(ValidationError):
        routes.GameServerPayload(name="Test", mod_resources=[resource()] * 9)
    assert routes.ServerModResource(enabled=False).url == ""
    assert routes.ServerModResource(**resource(url=" https://downloads.example/mod.zip?version=1#install ")).url.startswith("https://")


def test_legacy_server_defaults_and_disabled_public_data():
    payload = routes.GameServerPayload(name="Legacy").model_dump()
    assert payload["show_game_icon"] is True
    assert payload["modding_enabled"] is False
    original = {**payload, "modding_notes": "Draft instructions", "mod_resources": [resource()]}
    public = routes._public_doc(original)
    assert public["mod_resources"] == []
    assert "modding_notes" not in public
    assert routes._public_doc(original, include_admin_fields=True)["mod_resources"] == [resource()]
    assert original["modding_notes"] == "Draft instructions"


def test_create_edit_disable_and_reenable_roundtrip(setup):
    client, db, _app = setup
    payload = {"name": "Minecraft Modded", "game_id": "minecraft", "visibility": "public", "modding_enabled": True,
               "modding_notes": "Install loader first.", "mod_resources": [resource(), resource(kind="config", enabled=False, url="https://downloads.example/draft")]}
    created = client.post("/api/game-servers", json=payload)
    assert created.status_code == 200
    identifier = created.json()["id"]
    public = client.get("/api/game-servers").json()["items"][0]
    assert public["game"]["logo_url"].endswith("game.png")
    assert len(public["mod_resources"]) == 1
    assert "draft" not in str(public)
    assert client.patch(f"/api/game-servers/{identifier}", json={"modding_enabled": False, "show_game_icon": False}).status_code == 200
    assert client.get("/api/game-servers").json()["items"][0]["mod_resources"] == []
    saved = client.get("/api/game-servers/admin").json()[0]
    assert len(saved["mod_resources"]) == 2
    assert saved["modding_notes"] == "Install loader first."
    assert client.patch(f"/api/game-servers/{identifier}", json={"modding_enabled": True}).status_code == 200
    assert len(client.get("/api/game-servers").json()["items"][0]["mod_resources"]) == 1
    assert client.patch(f"/api/game-servers/{identifier}", json={"mod_resources": [], "modding_notes": "", "game_id": None}).status_code == 200
    assert db.game_servers.rows[0]["mod_resources"] == []
    assert db.game_servers.rows[0]["game_id"] is None


def test_missing_game_rejected_without_writing(setup):
    client, db, _app = setup
    assert client.post("/api/game-servers", json={"name": "Test", "game_id": "missing"}).status_code == 400
    assert db.game_servers.rows == []


@pytest.mark.parametrize("role", ["player", "moderator", "tournament_admin"])
def test_non_club_admin_cannot_publish_downloads(setup, role):
    client, _db, app = setup
    app.dependency_overrides[get_current_user] = lambda: {"id": "user", "role": role, "mfa_enabled": True, "auth_mfa_verified": True}
    assert client.post("/api/game-servers", json={"name": "Test", "mod_resources": [resource()]}).status_code == 403
    assert client.get("/api/game-servers/admin").status_code == 403


@pytest.mark.parametrize("visibility,user,visible", [("public", None, True), ("community", None, False), ("community", {"id": "user"}, True), ("members", {"id": "user"}, False), ("members", {"id": "user", "is_club_member": True}, True), ("internal", {"id": "admin", "role": "superadmin"}, False)])
def test_resource_visibility_follows_server_permissions(setup, visibility, user, visible):
    client, db, app = setup
    db.game_servers.rows = [{"id": "s1", "name": "Test", "visibility": visibility, "modding_enabled": True, "mod_resources": [resource()]}]
    app.dependency_overrides[get_optional_user] = lambda: user
    items = client.get("/api/game-servers").json()["items"]
    assert len(items) == int(visible)
    if visible:
        assert items[0]["mod_resources"] == [resource()]
