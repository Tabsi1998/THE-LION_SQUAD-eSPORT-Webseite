"""Map-Pools je Wettbewerb mit Snapshot (#1616) - Turnier, Phase und Saison einer Referenzen-Serie.

Ein Pool wählt je Modus Maps aus der Bibliothek des Spiels. Jede Änderung ist eine neue, unveränderliche Version mit
den Namen und Bildern von damals; spätere Änderungen an der Bibliothek ändern keine gespeicherte Version. Eine Phase
kann einen eigenen Pool haben (Herkunft sichtbar), sonst gilt der des Turniers. Ohne Pool bleibt alles wie bisher -
keine künstliche leere Map. Fremde Spiel-, Modus- oder Map-Kennungen lehnt der Server ab. Nur erfundene Map-Namen.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import new_id  # noqa: E402
from services import map_pools, migrations  # noqa: E402

SHOOTER = {
    "name": "Probe Shooter",
    "match_modes": [
        {"mode": "stellung", "label": "Stellung"},
        {"mode": "snd", "label": "Suchen & Zerstören", "minutes": 25},
        {"mode": "kontrolle", "label": "Kontrolle"},
    ],
}
SERIES = "/api/reference-series/admin"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def setup_library(flow):
    """Ein Spiel mit drei Modi und drei Maps: Hafenkante in Stellung und S&D, Nebelwerk nur in S&D, Glutsenke nur in
    Kontrolle - Hafenkante ist in Kontrolle also gesperrt."""
    admin = await flow.add_user(role="superadmin", name="admin")
    flow.act_as(admin)
    game = (await flow.post("/api/games", json=SHOOTER)).json()
    maps = {}
    for name, modes, image in (("Hafenkante", ["stellung", "snd"], "/api/static/uploads/hafen.webp"),
                               ("Nebelwerk", ["snd"], None), ("Glutsenke", ["kontrolle"], None)):
        created = await flow.post(f"/api/games/{game['id']}/maps", json={"name": name, "modes": modes, "image_url": image})
        assert created.status_code == 200, created.text
        maps[name] = created.json()
    return admin, game, maps


def pool_body(*groups, **extra):
    return {"modes": [{"mode": mode, "map_ids": [item["id"] for item in items]} for mode, items in groups], **extra}


def names(view, mode):
    group = next(group for group in view["modes"] if group["mode"] == mode)
    return [item["name"] for item in group["maps"]]


# ---------------------------------------------------------------- Turnier

@pytest.mark.asyncio
async def test_a_tournament_pool_takes_maps_per_mode_and_rejects_a_locked_combination(flow):
    _admin, game, maps = await setup_library(flow)
    tournament = await flow.create_tournament(game_id=game["id"])

    locked = await flow.put(f"/api/map-pools/tournaments/{tournament['id']}",
                            json=pool_body(("kontrolle", [maps["Hafenkante"]])))
    assert locked.status_code == 422
    assert "Hafenkante" in locked.json()["detail"] and "Kontrolle" in locked.json()["detail"]

    saved = await flow.put(f"/api/map-pools/tournaments/{tournament['id']}", json=pool_body(
        ("stellung", [maps["Hafenkante"]]), ("snd", [maps["Nebelwerk"], maps["Hafenkante"]])))
    assert saved.status_code == 200, saved.text
    view = saved.json()
    assert (view["version"], view["origin"], view["game_id"]) == (1, "tournament", game["id"])
    assert names(view, "snd") == ["Nebelwerk", "Hafenkante"]  # Reihenfolge wie gewählt
    assert next(group for group in view["modes"] if group["mode"] == "snd")["label"] == "Suchen & Zerstören"
    assert view["modes"][0]["maps"][0]["image_url"] == "/api/static/uploads/hafen.webp"

    flow.act_as(None)
    public = await flow.get(f"/api/map-pools/tournaments/{tournament['id']}")
    assert public.status_code == 200, public.text
    assert names(public.json()["tournament"], "stellung") == ["Hafenkante"]
    assert "saved_by" not in public.json()["tournament"]

    # Die Prüfung, die das Veto (#1618) nutzt: nur freigegebene Kombinationen.
    pool = public.json()["tournament"]
    assert map_pools.allowed(pool, "snd", maps["Hafenkante"]["id"])
    assert not map_pools.allowed(pool, "kontrolle", maps["Hafenkante"]["id"])
    assert not map_pools.allowed(pool, "stellung", maps["Nebelwerk"]["id"])


@pytest.mark.asyncio
async def test_two_tournaments_of_the_same_game_have_independent_pools_and_foreign_ids_are_refused(flow):
    _admin, game, maps = await setup_library(flow)
    kart = (await flow.post("/api/games", json={"name": "Probe Kart", "match_modes": [{"label": "Grand Prix"}]})).json()
    kart_map = (await flow.post(f"/api/games/{kart['id']}/maps", json={"name": "Kupfermine", "modes": ["grand_prix"]})).json()
    first = await flow.create_tournament(game_id=game["id"])
    second = await flow.create_tournament(game_id=game["id"])

    await flow.put(f"/api/map-pools/tournaments/{first['id']}", json=pool_body(("snd", [maps["Nebelwerk"]])))
    await flow.put(f"/api/map-pools/tournaments/{second['id']}", json=pool_body(("snd", [maps["Hafenkante"]])))
    assert names((await flow.get(f"/api/map-pools/tournaments/{first['id']}")).json()["tournament"], "snd") == ["Nebelwerk"]
    assert names((await flow.get(f"/api/map-pools/tournaments/{second['id']}")).json()["tournament"], "snd") == ["Hafenkante"]

    foreign_map = await flow.put(f"/api/map-pools/tournaments/{first['id']}", json=pool_body(("snd", [kart_map])))
    assert foreign_map.status_code == 422
    foreign_mode = await flow.put(f"/api/map-pools/tournaments/{first['id']}",
                                  json=pool_body(("grand_prix", [maps["Hafenkante"]])))
    assert foreign_mode.status_code == 422
    unknown = await flow.put(f"/api/map-pools/tournaments/{first['id']}",
                             json={"modes": [{"mode": "snd", "map_ids": [new_id()]}]})
    assert unknown.status_code == 422
    twice = await flow.put(f"/api/map-pools/tournaments/{first['id']}",
                           json=pool_body(("snd", [maps["Nebelwerk"], maps["Nebelwerk"]])))
    assert twice.status_code == 422


@pytest.mark.asyncio
async def test_rename_archive_and_a_new_image_leave_the_saved_version_unchanged(flow):
    _admin, game, maps = await setup_library(flow)
    tournament = await flow.create_tournament(game_id=game["id"])
    first = (await flow.put(f"/api/map-pools/tournaments/{tournament['id']}",
                            json=pool_body(("snd", [maps["Hafenkante"], maps["Nebelwerk"]])))).json()

    hafen = maps["Hafenkante"]["id"]
    await flow.patch(f"/api/games/{game['id']}/maps/{hafen}", json={"name": "Hafenkante Neu",
                                                                    "image_url": "/api/static/uploads/hafen-neu.webp"})
    await flow.patch(f"/api/games/{game['id']}/maps/{maps['Nebelwerk']['id']}", json={"status": "archived"})
    await flow.patch(f"/api/games/{game['id']}", json={"match_modes": [{"mode": "snd", "label": "S&D"}]})

    still = (await flow.get(f"/api/map-pools/tournaments/{tournament['id']}")).json()["tournament"]
    assert names(still, "snd") == ["Hafenkante", "Nebelwerk"]
    assert still["modes"][0]["label"] == "Suchen & Zerstören"
    assert still["modes"][0]["maps"][0]["image_url"] == "/api/static/uploads/hafen.webp"
    assert still["version"] == first["version"] == 1

    admin_view = (await flow.get(f"/api/map-pools/tournaments/{tournament['id']}/admin")).json()
    assert set(admin_view["tournament"]["outdated_map_ids"]) == {hafen, maps["Nebelwerk"]["id"]}

    # Eine archivierte Map kommt in keine neue Version.
    refused = await flow.put(f"/api/map-pools/tournaments/{tournament['id']}",
                             json=pool_body(("snd", [maps["Nebelwerk"]])))
    assert refused.status_code == 422
    second = (await flow.put(f"/api/map-pools/tournaments/{tournament['id']}",
                             json=pool_body(("snd", [maps["Hafenkante"]]), expected_version=1))).json()
    assert (second["version"], names(second, "snd"), second["modes"][0]["label"]) == (2, ["Hafenkante Neu"], "S&D")

    # Die alte Version bleibt nachlesbar (für Spiele, die sie festhalten - #1618).
    old = await map_pools.version_by_id(flow.db, first["id"])
    assert names(old, "snd") == ["Hafenkante", "Nebelwerk"]

    stale = await flow.put(f"/api/map-pools/tournaments/{tournament['id']}",
                           json=pool_body(("snd", [maps["Hafenkante"]]), expected_version=1))
    assert stale.status_code == 409


@pytest.mark.asyncio
async def test_a_stage_pool_overrides_the_tournament_with_visible_origin_and_falls_back_when_cleared(flow):
    _admin, game, maps = await setup_library(flow)
    tournament = await flow.create_tournament(game_id=game["id"])
    groups = {"id": new_id(), "tournament_id": tournament["id"], "number": 1, "name": "Gruppenphase", "type": "league"}
    final = {"id": new_id(), "tournament_id": tournament["id"], "number": 2, "name": "Finale", "type": "single_elim"}
    await flow.db.tournament_stages.insert_many([dict(groups), dict(final)])
    await flow.put(f"/api/map-pools/tournaments/{tournament['id']}", json=pool_body(("snd", [maps["Nebelwerk"]])))
    own = await flow.put(f"/api/map-pools/tournaments/{tournament['id']}/stages/{final['id']}",
                         json=pool_body(("snd", [maps["Hafenkante"], maps["Nebelwerk"]])))
    assert own.status_code == 200, own.text
    assert own.json()["origin"] == "stage"

    public = (await flow.get(f"/api/map-pools/tournaments/{tournament['id']}")).json()
    by_stage = {row["stage_id"]: row for row in public["stages"]}
    assert (by_stage[groups["id"]]["pool"]["origin"], names(by_stage[groups["id"]]["pool"], "snd")) == (
        "tournament", ["Nebelwerk"])
    assert (by_stage[final["id"]]["pool"]["origin"], names(by_stage[final["id"]]["pool"], "snd")) == (
        "stage", ["Hafenkante", "Nebelwerk"])

    effective = await map_pools.effective_pool(flow.db, tournament, stage=final)
    assert effective["origin"] == "stage"

    cleared = await flow.delete(f"/api/map-pools/tournaments/{tournament['id']}/stages/{final['id']}")
    assert cleared.status_code == 200, cleared.text
    again = {row["stage_id"]: row for row in (await flow.get(f"/api/map-pools/tournaments/{tournament['id']}")).json()["stages"]}
    assert again[final["id"]]["pool"]["origin"] == "tournament"

    foreign_stage = await flow.put(f"/api/map-pools/tournaments/{tournament['id']}/stages/{new_id()}",
                                   json=pool_body(("snd", [maps["Nebelwerk"]])))
    assert foreign_stage.status_code == 404


@pytest.mark.asyncio
async def test_a_match_that_holds_a_version_keeps_it_when_the_pool_changes(flow):
    _admin, game, maps = await setup_library(flow)
    tournament = await flow.create_tournament(game_id=game["id"])
    first = (await flow.put(f"/api/map-pools/tournaments/{tournament['id']}",
                            json=pool_body(("snd", [maps["Nebelwerk"]])))).json()
    await flow.put(f"/api/map-pools/tournaments/{tournament['id']}", json=pool_body(("snd", [maps["Hafenkante"]])))

    held = await map_pools.effective_pool(flow.db, tournament, match={"id": "spiel-1", "map_pool_id": first["id"]})
    fresh = await map_pools.effective_pool(flow.db, tournament, match={"id": "spiel-2"})
    assert (held["origin"], names(held, "snd")) == ("match", ["Nebelwerk"])
    assert (fresh["origin"], fresh["version"], names(fresh, "snd")) == ("tournament", 2, ["Hafenkante"])


@pytest.mark.asyncio
async def test_a_cup_without_maps_and_a_changed_edition_have_no_pool(flow):
    _admin, game, maps = await setup_library(flow)
    plain = await flow.create_tournament()
    nothing = await flow.get(f"/api/map-pools/tournaments/{plain['id']}")
    assert nothing.status_code == 200, nothing.text
    assert nothing.json()["tournament"] is None and nothing.json()["stages"] == []
    refused = await flow.put(f"/api/map-pools/tournaments/{plain['id']}", json=pool_body(("snd", [maps["Nebelwerk"]])))
    assert refused.status_code == 422
    assert await map_pools.effective_pool(flow.db, plain) is None

    tournament = await flow.create_tournament(game_id=game["id"])
    await flow.put(f"/api/map-pools/tournaments/{tournament['id']}", json=pool_body(("snd", [maps["Nebelwerk"]])))
    edition = (await flow.post("/api/games", json={**SHOOTER, "name": "Probe Shooter II", "kind": "standalone"})).json()
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"game_id": edition["id"]}})
    moved = (await flow.get(f"/api/map-pools/tournaments/{tournament['id']}")).json()
    assert moved["tournament"] is None
    admin_view = (await flow.get(f"/api/map-pools/tournaments/{tournament['id']}/admin")).json()
    assert admin_view["tournament"]["stale"] is True and admin_view["library"] == []


@pytest.mark.asyncio
async def test_only_structure_staff_writes_and_hidden_tournaments_stay_hidden(flow):
    _admin, game, maps = await setup_library(flow)
    tournament = await flow.create_tournament(game_id=game["id"])
    hidden = await flow.create_tournament(game_id=game["id"], visibility="hidden", status="draft")
    member = await flow.add_user(name="mitglied-mia")
    flow.act_as(member)
    saved = await flow.put(f"/api/map-pools/tournaments/{tournament['id']}", json=pool_body(("snd", [maps["Nebelwerk"]])))
    assert saved.status_code == 403
    assert (await flow.get(f"/api/map-pools/tournaments/{tournament['id']}/admin")).status_code == 403
    flow.act_as(None)
    assert (await flow.get(f"/api/map-pools/tournaments/{hidden['id']}")).status_code in (403, 404)


@pytest.mark.asyncio
async def test_a_game_without_modes_has_one_pool_without_mode(flow):
    admin = await flow.add_user(role="superadmin", name="admin")
    flow.act_as(admin)
    game = (await flow.post("/api/games", json={"name": "Probe Arena"})).json()
    arena = (await flow.post(f"/api/games/{game['id']}/maps", json={"name": "Sturmdeck"})).json()
    tournament = await flow.create_tournament(game_id=game["id"])
    saved = await flow.put(f"/api/map-pools/tournaments/{tournament['id']}",
                           json={"modes": [{"mode": None, "map_ids": [arena["id"]]}]})
    assert saved.status_code == 200, saved.text
    assert saved.json()["modes"][0]["mode"] is None and names(saved.json(), None) == ["Sturmdeck"]
    assert map_pools.allowed(saved.json(), None, arena["id"])

    with_mode = await flow.put(f"/api/map-pools/tournaments/{tournament['id']}",
                               json={"modes": [{"mode": "snd", "map_ids": [arena["id"]]}]})
    assert with_mode.status_code == 422


# ---------------------------------------------------------------- Saison einer Referenzen-Serie

async def setup_season(flow, game):
    await migrations.migrate_points_scheme_templates(flow.db)
    lineage = (await flow.post(f"{SERIES}/lineages", json={"title": "Probe Liga", "kind": "team_league",
                                                           "game_id": game["id"]})).json()
    previous = (await flow.post(f"{SERIES}/series", json={"lineage_id": lineage["id"], "season": "2025"})).json()
    season = (await flow.post(f"{SERIES}/series", json={"lineage_id": lineage["id"], "season": "2026"})).json()
    return lineage, previous, season


@pytest.mark.asyncio
async def test_a_season_picks_its_pool_and_the_series_page_shows_it(flow):
    _admin, game, maps = await setup_library(flow)
    lineage, previous, season = await setup_season(flow, game)

    await flow.put(f"/api/map-pools/reference-series/{previous['id']}", json=pool_body(("snd", [maps["Nebelwerk"]])))
    editor = (await flow.get(f"/api/map-pools/reference-series/{season['id']}")).json()
    assert editor["pool"] is None
    assert [item["name"] for item in editor["library"]] == ["Hafenkante", "Nebelwerk", "Glutsenke"]
    assert (names(editor["previous"], "snd"), editor["previous"]["source_season"]) == (["Nebelwerk"], "2025")

    saved = await flow.put(f"/api/map-pools/reference-series/{season['id']}",
                           json=pool_body(("stellung", [maps["Hafenkante"]]), ("snd", [maps["Hafenkante"], maps["Nebelwerk"]])))
    assert saved.status_code == 200, saved.text
    assert saved.json()["origin"] == "reference_series"

    await flow.patch(f"/api/games/{game['id']}/maps/{maps['Hafenkante']['id']}", json={"name": "Hafenkante Neu"})
    flow.act_as(None)
    page = await flow.get(f"/api/reference-series/public/{lineage['slug']}/{season['season_slug']}")
    assert page.status_code == 200, page.text
    pool = page.json()["map_pool"]
    assert names(pool, "snd") == ["Hafenkante", "Nebelwerk"]  # Snapshot - nicht der neue Name
    assert pool["modes"][0]["maps"][0]["image_url"] == "/api/static/uploads/hafen.webp"
    assert "saved_by" not in pool

    lookup = await map_pools.map_lookup(flow.db, "reference_series", season["id"])
    assert lookup[maps["Hafenkante"]["id"]]["name"] == "Hafenkante"


@pytest.mark.asyncio
async def test_a_captain_reads_the_season_pool_but_only_the_board_changes_it(flow):
    from datetime import date, timedelta

    from services.dolibarr_policy import club_today

    _admin, game, maps = await setup_library(flow)
    _lineage, _previous, season = await setup_season(flow, game)
    captain = await flow.add_user(name="captain-carla")
    await flow.db.memberships.update_one({"user_id": captain["id"]},
                                         {"$set": {"user_id": captain["id"], "member_status": "active"}}, upsert=True)
    until = (date.fromisoformat(club_today()) + timedelta(days=30)).isoformat()
    added = await flow.post(f"{SERIES}/series/{season['id']}/staff", json={"user_id": captain["id"], "valid_until": until})
    assert added.status_code == 200, added.text
    await flow.put(f"/api/map-pools/reference-series/{season['id']}", json=pool_body(("snd", [maps["Nebelwerk"]])))

    flow.act_as(captain)
    read = await flow.get(f"/api/map-pools/reference-series/{season['id']}")
    assert read.status_code == 200, read.text
    assert names(read.json()["pool"], "snd") == ["Nebelwerk"] and "saved_by" not in read.json()["pool"]
    saved = await flow.put(f"/api/map-pools/reference-series/{season['id']}", json=pool_body(("snd", [maps["Hafenkante"]])))
    cleared = await flow.delete(f"/api/map-pools/reference-series/{season['id']}")
    assert (saved.status_code, cleared.status_code) == (403, 403)


@pytest.mark.asyncio
async def test_a_lineage_without_game_keeps_free_text_and_has_no_pool(flow):
    _admin, game, maps = await setup_library(flow)
    await migrations.migrate_points_scheme_templates(flow.db)
    lineage = (await flow.post(f"{SERIES}/lineages", json={"title": "Freie Liga", "kind": "team_league"})).json()
    season = (await flow.post(f"{SERIES}/series", json={"lineage_id": lineage["id"], "season": "2026"})).json()
    editor = (await flow.get(f"/api/map-pools/reference-series/{season['id']}")).json()
    assert (editor["game"], editor["library"], editor["pool"]) == (None, [], None)
    refused = await flow.put(f"/api/map-pools/reference-series/{season['id']}", json=pool_body(("snd", [maps["Nebelwerk"]])))
    assert refused.status_code == 422
    page = (await flow.get(f"/api/reference-series/public/{lineage['slug']}/{season['season_slug']}")).json()
    assert page["map_pool"] is None


# ---------------------------------------------------------------- Gleichzeitig speichern

async def unique_versions(flow):
    """Wie database.py: je Wettbewerb jede Versionsnummer nur einmal - mongomock legt Indizes nicht von selbst an."""
    await flow.db.map_pools.create_index([("scope", 1), ("scope_id", 1), ("version", -1)], unique=True)


@pytest.mark.asyncio
async def test_two_parallel_saves_of_the_same_version_give_one_success_and_one_conflict(flow, monkeypatch):
    import asyncio

    import routes.map_pool_routes as pool_routes
    from flow_harness import InterleavedReads

    _admin, game, maps = await setup_library(flow)
    _lineage, _previous, season = await setup_season(flow, game)
    await unique_versions(flow)
    url = f"/api/map-pools/reference-series/{season['id']}"
    # Beide lesen den alten Stand, bevor einer schreibt - wie zwei Worker auf echtem MongoDB.
    gate = InterleavedReads(flow.db, "map_pools")
    monkeypatch.setattr(pool_routes, "get_db", lambda: gate)
    first, second = await asyncio.gather(
        flow.put(url, json=pool_body(("snd", [maps["Nebelwerk"]]), expected_version=0)),
        flow.put(url, json=pool_body(("snd", [maps["Hafenkante"]]), expected_version=0)))

    assert sorted([first.status_code, second.status_code]) == [200, 409]
    conflict = first if first.status_code == 409 else second
    assert "inzwischen geändert" in conflict.json()["detail"]
    assert await flow.db.map_pools.count_documents({"scope_id": season["id"]}) == 1


@pytest.mark.asyncio
async def test_two_parallel_tournament_saves_never_give_500(flow, monkeypatch):
    import asyncio

    import routes.map_pool_routes as pool_routes
    from flow_harness import InterleavedReads

    _admin, game, maps = await setup_library(flow)
    tournament = await flow.create_tournament(game_id=game["id"])
    await unique_versions(flow)
    url = f"/api/map-pools/tournaments/{tournament['id']}"
    gate = InterleavedReads(flow.db, "map_pools")
    monkeypatch.setattr(pool_routes, "get_db", lambda: gate)
    first, second = await asyncio.gather(
        flow.put(url, json=pool_body(("snd", [maps["Nebelwerk"]]), expected_version=0)),
        flow.put(url, json=pool_body(("snd", [maps["Hafenkante"]]), expected_version=0)))

    assert sorted([first.status_code, second.status_code]) == [200, 409]
    assert await flow.db.map_pools.count_documents({"scope_id": tournament["id"]}) == 1


@pytest.mark.asyncio
async def test_a_save_after_a_parallel_change_does_not_overwrite_it(flow, monkeypatch):
    """Ohne erwartete Version: zwei gleichzeitige Speicherungen bekommen nie dieselbe Nummer - die zweite ist 409."""
    import asyncio

    import routes.map_pool_routes as pool_routes
    from flow_harness import InterleavedReads

    _admin, game, maps = await setup_library(flow)
    _lineage, _previous, season = await setup_season(flow, game)
    await unique_versions(flow)
    url = f"/api/map-pools/reference-series/{season['id']}"
    await flow.put(url, json=pool_body(("snd", [maps["Nebelwerk"]])))
    gate = InterleavedReads(flow.db, "map_pools")
    monkeypatch.setattr(pool_routes, "get_db", lambda: gate)
    saved, cleared = await asyncio.gather(flow.put(url, json=pool_body(("snd", [maps["Hafenkante"]]))), flow.delete(url))

    assert sorted([saved.status_code, cleared.status_code]) == [200, 409]
    versions = [row["version"] async for row in flow.db.map_pools.find({"scope_id": season["id"]}, {"version": 1})]
    assert sorted(versions) == [1, 2]
