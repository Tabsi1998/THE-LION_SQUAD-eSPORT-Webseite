"""Symbol je Spielmodus (#2266, docs/LIGA.md C.1) - durch die echten Routen. Erfundene Namen und Dateien.

Nur eigene Uploads: Die Datei braucht ihren Eintrag in der Mediathek, ohne Medienrolle nur eigene Bilder, SVG nur mit Medienrolle. Was
das Spiel schon trägt, bleibt speicherbar. Pool-Versionen und Liga-Spiele halten das Symbol als Schnappschuss wie den Namen, die
Mediathek zählt beide als Verwendung, und in einer Pool-Version ist es eingefroren.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_match_world import ids, two_nil, world  # noqa: E402
from models import now_utc  # noqa: E402
from routes import phase_fg_routes  # noqa: E402
from services import account_erasure, map_pools, media_audit  # noqa: E402

UPLOADS = "/api/static/uploads/"
MODES = [{"mode": "stellung", "label": "Stellung"}, {"mode": "suchen", "label": "Suchen & Zerstören"}]


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def public(tmp_path, monkeypatch):
    folder = tmp_path / "public"
    (folder / "variants").mkdir(parents=True)
    for module in (phase_fg_routes, media_audit, account_erasure):
        monkeypatch.setattr(module, "PUBLIC_UPLOAD_DIR", folder)
        monkeypatch.setattr(module, "UPLOAD_DIR", tmp_path)
    return folder


async def upload(flow, name: str, *, owner: dict | None = None, scope: str = "admin") -> str:
    await flow.db.media_uploads.insert_one({"id": name, "filename": name, "url": UPLOADS + name, "media_type": "image",
                                            "media_scope": scope, "owner_id": (owner or {}).get("id"), "owner_role": (owner or {}).get("role")})
    return UPLOADS + name


async def lead(flow) -> dict:
    chef = await flow.add_user(role="superadmin", name="Leitung")
    flow.act_as(chef)
    return chef


async def granted(flow, name: str = "Helfer") -> dict:
    """Turnierleitung per Freigabe - ohne Medienrolle."""
    person = {**await flow.add_user(role="player", name=name), "areas": ["tournaments"]}
    await flow.db.users.update_one({"id": person["id"]}, {"$set": {"areas": ["tournaments"]}})
    flow.act_as(person)
    return person


async def add_game(flow, modes=None, game_id: str = "spiel") -> dict:
    now = now_utc().isoformat()
    doc = {"id": game_id, "name": "Probe Shooter", "slug": game_id, "kind": "standalone", "match_modes": modes or MODES,
           "created_at": now, "updated_at": now}
    await flow.db.games.insert_one(dict(doc))
    return doc


async def stored_modes(flow, game_id: str = "spiel") -> list:
    return (await flow.db.games.find_one({"id": game_id}, {"_id": 0, "match_modes": 1}))["match_modes"]


def with_icon(url: str | None, key: str = "stellung", modes=None) -> list:
    return [{**mode, "icon_url": url} if mode["mode"] == key else mode for mode in modes or MODES]


async def patch_modes(flow, modes, game_id: str = "spiel"):
    return await flow.patch(f"/api/games/{game_id}", json={"match_modes": modes})


# ---------------------------------------------------------------- Speichern und Prüfen


@pytest.mark.asyncio
async def test_an_icon_is_saved_read_back_and_left_out_when_missing(flow):
    await lead(flow)
    await add_game(flow)
    icon = await upload(flow, "stellung.png")

    saved = await patch_modes(flow, with_icon(icon))

    assert saved.status_code == 200, saved.text
    modes = await stored_modes(flow)
    assert modes[0]["icon_url"] == icon
    assert "icon_url" not in modes[1], "ohne Symbol wird nichts geschrieben"
    listed = next(row for row in (await flow.get("/api/games")).json() if row["id"] == "spiel")
    assert listed["match_modes"][0]["icon_url"] == icon
    removed = await patch_modes(flow, with_icon(None))
    assert removed.status_code == 200, removed.text
    assert all("icon_url" not in mode for mode in await stored_modes(flow))


@pytest.mark.asyncio
@pytest.mark.parametrize("address", ["https://fremd.example/bild.png", "/api/static/uploads/../geheim.png", "/uploads/bild.png"])
async def test_a_foreign_address_is_refused(flow, address):
    await lead(flow)
    await add_game(flow)

    response = await patch_modes(flow, with_icon(address))

    assert response.status_code == 422
    assert "Symbol bitte über „Hochladen“" in response.json()["detail"]
    assert all("icon_url" not in mode for mode in await stored_modes(flow))


@pytest.mark.asyncio
async def test_a_file_without_entry_in_the_media_library_is_refused(flow):
    await lead(flow)
    await add_game(flow)

    response = await patch_modes(flow, with_icon(UPLOADS + "unbekannt.png"))

    assert response.status_code == 422
    assert "kennt die Mediathek nicht" in response.json()["detail"]


@pytest.mark.asyncio
async def test_without_media_role_only_own_images_and_no_svg(flow):
    await add_game(flow)
    helper = await granted(flow)
    other = await flow.add_user(name="Andere")
    own = await upload(flow, "eigen.png", owner=helper, scope="user")
    foreign = await upload(flow, "fremd.png", owner=other, scope="user")
    club = await upload(flow, "verein.png", owner=other, scope="admin")
    vector = await upload(flow, "eigen.svg", owner=helper, scope="user")

    assert (await patch_modes(flow, with_icon(foreign))).status_code == 422
    assert (await patch_modes(flow, with_icon(club))).status_code == 422
    svg = await patch_modes(flow, with_icon(vector))
    assert svg.status_code == 422
    assert "SVG" in svg.json()["detail"]
    saved = await patch_modes(flow, with_icon(own))
    assert saved.status_code == 200, saved.text
    assert (await stored_modes(flow))[0]["icon_url"] == own


@pytest.mark.asyncio
async def test_with_media_role_club_images_and_svg_are_fine(flow):
    await lead(flow)
    await add_game(flow)
    vector = await upload(flow, "logo.svg", scope="branding")

    saved = await patch_modes(flow, with_icon(vector))

    assert saved.status_code == 200, saved.text


@pytest.mark.asyncio
async def test_an_icon_set_by_someone_else_stays_savable(flow):
    """Ein Symbol der Leitung hält das Speichern einer Freigabe-Person nicht auf - nur Neues wird geprüft."""
    await lead(flow)
    await add_game(flow)
    icon = await upload(flow, "verein.png", scope="admin")
    assert (await patch_modes(flow, with_icon(icon))).status_code == 200

    await granted(flow)
    renamed = await patch_modes(flow, [{**with_icon(icon)[0], "label": "Stellung neu"}, MODES[1]])

    assert renamed.status_code == 200, renamed.text
    assert (await stored_modes(flow))[0] == {"mode": "stellung", "label": "Stellung neu", "icon_url": icon}


# ---------------------------------------------------------------- Schnappschuss im Pool


async def add_maps(flow, game_id: str = "spiel") -> None:
    for name, modes in (("Hafen", ["stellung"]), ("Turm", ["suchen"])):
        await flow.db.game_maps.insert_one({"id": f"map-{name.lower()}", "game_id": game_id, "slug": name.lower(), "name": name,
                                            "modes": modes, "status": "active", "order": 1})


async def save_pool(flow, game: dict, user: dict, scope_id: str = "turnier") -> dict:
    body = map_pools.MapPoolSave(modes=[{"mode": "stellung", "map_ids": ["map-hafen"]}, {"mode": "suchen", "map_ids": ["map-turm"]}])
    return await map_pools.save(flow.db, scope="tournament", scope_id=scope_id, game=game, body=body, user=user)


@pytest.mark.asyncio
async def test_a_pool_version_keeps_the_icon_of_its_time(flow):
    chef = await lead(flow)
    await add_game(flow)
    await add_maps(flow)
    first, second = await upload(flow, "alt.png"), await upload(flow, "neu.png")
    assert (await patch_modes(flow, with_icon(first))).status_code == 200

    version = await save_pool(flow, await flow.db.games.find_one({"id": "spiel"}, {"_id": 0}), chef)
    assert (await patch_modes(flow, with_icon(second))).status_code == 200

    held = await flow.db.map_pools.find_one({"id": version["id"]}, {"_id": 0})
    assert held["modes"][0]["icon_url"] == first, "der Pool hält das Symbol von damals"
    assert "icon_url" not in held["modes"][1]
    view = map_pools.view(held)
    assert view["modes"][0]["icon_url"] == first and "icon_url" not in view["modes"][1]
    copied = await map_pools.copy_version(flow.db, held, scope="tournament", scope_id="staffel", user=chef)
    assert copied["modes"][0]["icon_url"] == first, "die Kopie Season → Staffel nimmt das Symbol mit"


@pytest.mark.asyncio
async def test_the_media_library_counts_the_icon_and_freezes_it_in_a_pool(flow, public):
    chef = await lead(flow)
    await add_game(flow)
    await add_maps(flow)
    (public / "symbol.png").write_bytes(b"bild")
    icon = await upload(flow, "symbol.png")
    assert (await patch_modes(flow, with_icon(icon))).status_code == 200

    places = {(collection, field) async for collection, _doc, field, _name, _text in media_audit.iter_usages(flow.db, {"symbol.png"})}
    assert places == {("games", "match_modes.icon_url")}
    asked = await flow.delete("/api/admin/media/symbol.png")
    assert asked.status_code == 409 and "Symbol eines Modus" in asked.json()["detail"], "verwendet: erst nachfragen"

    await save_pool(flow, await flow.db.games.find_one({"id": "spiel"}, {"_id": 0}), chef)
    places = {(collection, field) async for collection, _doc, field, _name, _text in media_audit.iter_usages(flow.db, {"symbol.png"})}
    assert ("map_pools", "modes.icon_url") in places
    refused = await flow.delete("/api/admin/media/symbol.png?force=true")
    assert refused.status_code == 409
    assert "gespeicherten Map-Pool" in refused.json()["detail"]
    assert (public / "symbol.png").exists()


@pytest.mark.asyncio
async def test_the_default_pool_of_a_game_does_not_freeze_the_icon(flow):
    doc = {"modes": [{"mode": "stellung", "icon_url": UPLOADS + "a.png"}], "scope": "game_default"}
    assert not media_audit.is_frozen("map_pools", doc, "modes.icon_url")
    assert media_audit.is_frozen("map_pools", {**doc, "scope": "tournament"}, "modes.icon_url")
    assert not media_audit.is_frozen("map_pools", {**doc, "scope": "tournament"}, "modes.maps.image_url"), "Map-Bilder wie bisher"


# ---------------------------------------------------------------- Liga-Spiel


@pytest.mark.asyncio
async def test_a_league_game_keeps_the_icon_from_the_pool(flow):
    w = await world(flow)
    icon = UPLOADS + "stellung.png"
    await flow.db.map_pools.update_one({"scope": "tournament", "scope_id": w["tournament"]["id"]}, {"$set": {"modes.0.icon_url": icon}})

    flow.act_as(w["users"]["Kapitaen"])
    reported = await flow.post(f"/api/matches/{w['match']['id']}/report", json=two_nil(w, lineup=ids(w, "Kapitaen", "Mila")))
    assert reported.status_code == 200, reported.text
    flow.act_as(w["users"]["Falke1"])
    confirmed = await flow.post(f"/api/matches/{w['match']['id']}/report", json=two_nil(w, lineup=ids(w, "Falke1", "Falke2"), side="reg_h"))
    assert confirmed.status_code == 200, confirmed.text

    done = await flow.db.matches_v2.find_one({"id": w["match"]["id"]}, {"_id": 0})
    assert done["games"][0]["mode_icon_url"] == icon
    assert "mode_icon_url" not in done["games"][1], "ohne Symbol im Pool nichts dazu"
    flow.act_as(None)
    page = (await flow.get(f"/api/matches/{w['match']['id']}")).json()
    assert page["games"][0]["mode_icon_url"] == icon
