"""Maps und Pools absichern, Prüfung vor der Veröffentlichung (#2207, Paket C.2 - Vertrag in docs/LIGA.md).

Durch die echten Routen: Zustand einer Map (inaktiv), Warnung bei Verwendung, Pool-Versionen vergleichen, Mindestgröße je Modus,
Länge von „Modus je Map“, Map in einem Schritt sperren und die Prüfung vor dem Veröffentlichen. Erfundene Namen und Werte.
"""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from league_rules_world import publish  # noqa: E402
from league_start_world import ok  # noqa: E402
from models import now_utc  # noqa: E402
from services import map_pools  # noqa: E402

ADMIN = "/api/admin/leagues"
GAME = {"name": "Pool-Shooter", "slug": "pool-shooter", "match_modes": [
    {"mode": "stellung", "label": "Stellung"}, {"mode": "suchen", "label": "Suchen"}]}
MAPS = (("Hafenkante", ["stellung", "suchen"]), ("Nebelwerk", ["suchen"]), ("Turmblick", ["stellung"]), ("Glutsenke", ["stellung"]))


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    # Die Sperren brauchen den eindeutigen Index (auf echtem MongoDB legt ihn init_indexes an).
    await instance.db.mutation_locks.create_index("resource", unique=True)
    try:
        yield instance
    finally:
        await shutdown()


def season_body(**extra) -> dict:
    start = (now_utc() + timedelta(days=8)).date().isoformat()
    return {"start_date": f"{start}T00:00:00", "weeks_total": 12, "best_of": 3, "team_size": 4,
            "game_mode_order": ["stellung", "suchen", "stellung"], "map_repeat": "other_mode", **extra}


async def build(flow, *, season: dict | None = None, pool: dict | None = None, divisions: bool = True, staffel: bool = True,
                rules: bool = True) -> dict:
    lead = await flow.add_staff()
    flow.act_as(lead)
    game = ok(await flow.post("/api/games", json=GAME))
    maps = {name: ok(await flow.post(f"/api/games/{game['id']}/maps", json={"name": name, "modes": modes})) for name, modes in MAPS}
    league = ok(await flow.post(ADMIN, json={"name": "Pool-Liga", "game_id": game["id"]}))
    row = ok(await flow.post(f"{ADMIN}/{league['id']}/seasons", json=season_body(**(season or {}))))
    world = {"lead": lead, "game": game, "maps": maps, "league": league, "season": row}
    wanted = pool if pool is not None else {"stellung": ["Hafenkante", "Turmblick"], "suchen": ["Nebelwerk"]}
    if wanted:
        await save_pool(flow, world, wanted)
    if divisions:
        world["division"] = ok(await flow.post(f"{ADMIN}/seasons/{row['id']}/divisions", json={}))
        if staffel:
            world["tid"] = ok(await flow.post(f"{ADMIN}/divisions/{world['division']['id']}/staffeln", json={}))["tournament_id"]
    if rules:
        await publish(flow, world)
    flow.act_as(lead)
    return world


async def save_pool(flow, world: dict, modes: dict) -> dict:
    flow.act_as(world["lead"])
    return ok(await flow.put(f"{ADMIN}/seasons/{world['season']['id']}/map-pool", json={"modes": [
        {"mode": mode, "map_ids": [world["maps"][name]["id"] for name in names]} for mode, names in modes.items()]}))


def codes(items: list[dict]) -> set[str]:
    return {item["code"] for item in items}


async def actions(flow) -> list[dict]:
    return await flow.db.audit_logs.find({}, {"_id": 0}).to_list(None)


# ---------------------------------------------------------------- Zustand einer Map

@pytest.mark.asyncio
async def test_an_inactive_map_stays_where_it_is_but_comes_into_no_new_pool(flow):
    w = await build(flow)
    hafen = w["maps"]["Hafenkante"]
    changed = ok(await flow.patch(f"/api/games/{w['game']['id']}/maps/{hafen['id']}", json={"status": "inactive"}))
    assert changed["status"] == "inactive" and changed["archived_at"] is None

    # Schon im selben Modus: neu speichern geht. Im neuen Modus: nein. In einem neuen Pool: nein.
    await save_pool(flow, w, {"stellung": ["Hafenkante", "Turmblick", "Glutsenke"], "suchen": ["Nebelwerk"]})
    refused = await flow.put(f"{ADMIN}/seasons/{w['season']['id']}/map-pool", json={"modes": [
        {"mode": "stellung", "map_ids": [hafen["id"], w["maps"]["Turmblick"]["id"]]},
        {"mode": "suchen", "map_ids": [w["maps"]["Nebelwerk"]["id"], hafen["id"]]}]})
    assert refused.status_code == 422 and "„Hafenkante“ ist inaktiv" in refused.json()["detail"]
    other = ok(await flow.post(f"{ADMIN}/{w['league']['id']}/seasons", json=season_body(name="Season Zwei", game_mode_order=[])))
    fresh = await flow.put(f"{ADMIN}/seasons/{other['id']}/map-pool", json={"modes": [{"mode": "stellung", "map_ids": [hafen["id"]]}]})
    assert fresh.status_code == 422 and "inaktiv" in fresh.json()["detail"]

    # Die Bibliothek der Verwaltung trägt sie mit Zustand, der Pool gilt als nicht veraltet.
    page = ok(await flow.get(f"{ADMIN}/seasons/{w['season']['id']}"))
    assert {row["id"]: row["status"] for row in page["library"]}[hafen["id"]] == "inactive"
    assert hafen["id"] not in page["map_pool"]["outdated_map_ids"]
    # Zurück auf aktiv: wieder frei wählbar.
    ok(await flow.patch(f"/api/games/{w['game']['id']}/maps/{hafen['id']}", json={"status": "active"}))
    ok(await flow.put(f"{ADMIN}/seasons/{other['id']}/map-pool", json={"modes": [{"mode": "stellung", "map_ids": [hafen["id"]]}]}))


@pytest.mark.asyncio
async def test_an_archived_map_stays_refused_even_in_the_same_pool(flow):
    w = await build(flow)
    nebel = w["maps"]["Nebelwerk"]
    ok(await flow.patch(f"/api/games/{w['game']['id']}/maps/{nebel['id']}", json={"status": "archived"}))
    again = await flow.put(f"{ADMIN}/seasons/{w['season']['id']}/map-pool", json={"modes": [
        {"mode": "stellung", "map_ids": [w["maps"]["Hafenkante"]["id"]]}, {"mode": "suchen", "map_ids": [nebel["id"]]}]})
    assert again.status_code == 422 and "archiviert" in again.json()["detail"]
    page = ok(await flow.get(f"{ADMIN}/seasons/{w['season']['id']}"))
    assert nebel["id"] not in {row["id"] for row in page["library"]}


@pytest.mark.asyncio
async def test_a_map_without_status_counts_as_active(flow):
    w = await build(flow)
    nebel = w["maps"]["Nebelwerk"]
    await flow.db.game_maps.update_one({"id": nebel["id"]}, {"$unset": {"status": ""}})
    page = ok(await flow.get(f"{ADMIN}/seasons/{w['season']['id']}"))
    assert {row["id"]: row["status"] for row in page["library"]}[nebel["id"]] == "active"
    assert nebel["id"] not in page["map_pool"]["outdated_map_ids"]


@pytest.mark.asyncio
async def test_deactivating_a_map_in_a_season_pool_warns_with_the_seasons(flow):
    w = await build(flow)
    nebel, glut = w["maps"]["Nebelwerk"], w["maps"]["Glutsenke"]
    usage = ok(await flow.get(f"/api/games/{w['game']['id']}/maps/{nebel['id']}/usage"))
    assert usage["pools"] == 2  # Season und Kopie der Staffel
    assert [(row["season_name"], row["in_season_pool"], row["staffeln"], row["status"]) for row in usage["affected_seasons"]] == [
        ("Season 1", True, 1, "draft")]
    changed = ok(await flow.patch(f"/api/games/{w['game']['id']}/maps/{nebel['id']}", json={"status": "inactive"}))
    assert changed["affected_seasons"][0]["season_id"] == w["season"]["id"]
    assert "Pool-Liga Season 1" in changed["warning"] and "Map aus dem Pool nehmen" in changed["warning"]
    archived = ok(await flow.patch(f"/api/games/{w['game']['id']}/maps/{nebel['id']}", json={"status": "archived"}))
    assert archived["warning"]

    # Eine Map, die nirgends steht: keine Warnung. Eine beendete Season zählt nicht.
    quiet = ok(await flow.patch(f"/api/games/{w['game']['id']}/maps/{glut['id']}", json={"status": "inactive"}))
    assert quiet["warning"] is None and quiet["affected_seasons"] == []
    await flow.db.league_seasons.update_one({"id": w["season"]["id"]}, {"$set": {"status": "completed"}})
    assert ok(await flow.get(f"/api/games/{w['game']['id']}/maps/{nebel['id']}/usage"))["affected_seasons"] == []


@pytest.mark.asyncio
async def test_a_map_from_a_match_is_not_deleted(flow):
    lead = await flow.add_staff()
    flow.act_as(lead)
    game = ok(await flow.post("/api/games", json=GAME))
    hafen = ok(await flow.post(f"/api/games/{game['id']}/maps", json={"name": "Hafenkante", "modes": ["stellung"]}))
    tournament = await flow.create_tournament(game_id=game["id"])
    await flow.db.matches_v2.insert_one({"id": new_id(), "tournament_id": tournament["id"],
                                         "reports": [{"games": [{"position": 1, "mode": "stellung", "map_id": hafen["id"]}]}]})
    refused = await flow.delete(f"/api/games/{game['id']}/maps/{hafen['id']}")
    assert refused.status_code == 409 and "archivieren" in refused.json()["detail"]
    assert await flow.db.game_maps.find_one({"id": hafen["id"]})


# ---------------------------------------------------------------- Versionen vergleichen

@pytest.mark.asyncio
async def test_two_pool_versions_are_compared_per_mode(flow):
    w = await build(flow)
    await save_pool(flow, w, {"stellung": ["Turmblick", "Glutsenke", "Hafenkante"], "suchen": ["Nebelwerk", "Hafenkante"]})
    versions = ok(await flow.get(f"{ADMIN}/seasons/{w['season']['id']}/map-pool/versions"))["versions"]
    assert [row["version"] for row in versions] == [2, 1] and versions[0]["maps"] == 5
    diff = ok(await flow.get(f"{ADMIN}/seasons/{w['season']['id']}/map-pool/compare", params={"base": 1, "target": 2}))
    rows = {row["mode"]: row for row in diff["modes"]}
    assert [item["name"] for item in rows["stellung"]["added"]] == ["Glutsenke"] and rows["stellung"]["removed"] == []
    assert rows["stellung"]["kept"] == 2 and rows["stellung"]["status"] == "changed"
    assert [item["name"] for item in rows["suchen"]["added"]] == ["Hafenkante"] and not diff["same"]
    same = ok(await flow.get(f"{ADMIN}/seasons/{w['season']['id']}/map-pool/compare", params={"base": 2, "target": 2}))
    assert same["same"]
    missing = await flow.get(f"{ADMIN}/seasons/{w['season']['id']}/map-pool/compare", params={"base": 1, "target": 9})
    assert missing.status_code == 404


def test_compare_counts_a_cleared_pool_as_empty():
    base = {"id": "a", "version": 1, "modes": [{"mode": "x", "label": "X", "maps": [{"map_id": "m1", "name": "Eins"}]}]}
    cleared = {"id": "b", "version": 2, "cleared": True, "modes": []}
    diff = map_pools.compare(base, cleared)
    assert diff["modes"] == [{"mode": "x", "label": "X", "added": [], "removed": [{"map_id": "m1", "name": "Eins"}], "kept": 0,
                              "status": "removed"}]


# ---------------------------------------------------------------- Mindestgröße und Länge der Reihenfolge

@pytest.mark.asyncio
async def test_a_too_small_pool_warns_on_saving(flow):
    w = await build(flow)
    saved = await save_pool(flow, w, {"stellung": ["Hafenkante"], "suchen": ["Nebelwerk"]})
    assert saved["warnings"] == ["Stellung braucht mindestens 2 Maps im Pool, hat 1."]
    # Überschreiben je Modus - nach unten und nach oben.
    ok(await flow.patch(f"{ADMIN}/seasons/{w['season']['id']}", json={"pool_min_maps": [{"mode": "stellung", "min_maps": 1},
                                                                                         {"mode": "suchen", "min_maps": 2}]}))
    saved = await save_pool(flow, w, {"stellung": ["Hafenkante"], "suchen": ["Nebelwerk"]})
    assert saved["warnings"] == ["Suchen braucht mindestens 2 Maps im Pool, hat 1."]
    unknown = await flow.patch(f"{ADMIN}/seasons/{w['season']['id']}", json={"pool_min_maps": [{"mode": "gibtsnicht", "min_maps": 1}]})
    assert unknown.status_code == 422


@pytest.mark.asyncio
async def test_never_repeat_needs_distinct_maps_across_modes(flow):
    w = await build(flow, season={"map_repeat": "never"})
    # Stellung zweimal, Suchen einmal: Hafenkante in beiden Modi reicht nicht für drei verschiedene Maps.
    saved = await save_pool(flow, w, {"stellung": ["Hafenkante", "Turmblick"], "suchen": ["Hafenkante"]})
    assert saved["warnings"] == ["Stellung und Suchen brauchen zusammen 3 verschiedene Maps, weil jede Map nur einmal je Serie "
                                 "läuft – der Pool hat 2."]
    assert (await save_pool(flow, w, {"stellung": ["Hafenkante", "Turmblick"], "suchen": ["Nebelwerk"]}))["warnings"] == []


@pytest.mark.asyncio
async def test_free_mode_choice_counts_pairs_or_maps(flow):
    w = await build(flow, season={"game_mode_order": [], "best_of": 5})
    assert (await save_pool(flow, w, {"stellung": ["Hafenkante", "Turmblick"], "suchen": ["Hafenkante"]}))["warnings"] == [
        "Für eine Serie mit 5 Maps braucht der Pool mindestens 5 Maps (über alle Modi gezählt), hat 3."]
    ok(await flow.patch(f"{ADMIN}/seasons/{w['season']['id']}", json={"map_repeat": "always"}))
    assert (await save_pool(flow, w, {"stellung": ["Hafenkante"]}))["warnings"] == []


@pytest.mark.asyncio
async def test_the_mode_order_must_match_the_longest_series_in_a_draft(flow):
    w = await build(flow)
    short = await flow.patch(f"{ADMIN}/seasons/{w['season']['id']}", json={"game_mode_order": ["stellung", "suchen"]})
    assert short.status_code == 422 and "längste Serie" in short.json()["detail"]
    longer = await flow.patch(f"{ADMIN}/seasons/{w['season']['id']}", json={"best_of": 5})
    assert longer.status_code == 422
    # Eine Liga N mit Best of 5 macht die Serie länger - auch das passt nicht zur Reihenfolge mit drei Einträgen.
    division = await flow.patch(f"{ADMIN}/divisions/{w['division']['id']}", json={"overrides": {"best_of": 5}})
    assert division.status_code == 422
    new_division = await flow.post(f"{ADMIN}/seasons/{w['season']['id']}/divisions", json={"overrides": {"best_of": 7}})
    assert new_division.status_code == 422
    # Beides zusammen passt. Leer (frei) passt immer. Anderes Speichern ohne Reihenfolge und Best of hält nichts auf.
    ok(await flow.patch(f"{ADMIN}/seasons/{w['season']['id']}", json={"best_of": 5, "game_mode_order": ["stellung", "suchen", "stellung", "suchen", "stellung"]}))
    ok(await flow.patch(f"{ADMIN}/seasons/{w['season']['id']}", json={"best_of": 1, "game_mode_order": []}))
    created = await flow.post(f"{ADMIN}/{w['league']['id']}/seasons", json=season_body(name="Season Kurz", game_mode_order=["stellung"]))
    assert created.status_code == 422


@pytest.mark.asyncio
async def test_a_running_season_only_gets_a_warning_for_the_mode_order(flow):
    w = await build(flow)
    await flow.db.league_seasons.update_one({"id": w["season"]["id"]}, {"$set": {"status": "active"}})
    saved = ok(await flow.patch(f"{ADMIN}/seasons/{w['season']['id']}", json={"best_of": 5}))
    assert saved["best_of"] == 5 and saved["warnings"] and "läuft schon" in saved["warnings"][0]
    division = ok(await flow.patch(f"{ADMIN}/divisions/{w['division']['id']}", json={"overrides": {"best_of": 7}}))
    assert division["warnings"]
    # Altbestand: eine Season mit zu kurzer Reihenfolge lässt sich weiter speichern, solange beides gleich bleibt.
    assert ok(await flow.patch(f"{ADMIN}/seasons/{w['season']['id']}", json={"name": "Season Eins"}))["warnings"] == []


# ---------------------------------------------------------------- Map in einem Schritt sperren

@pytest.mark.asyncio
async def test_removing_a_map_makes_a_new_version_and_transfers_it(flow):
    w = await build(flow, pool={"stellung": ["Hafenkante", "Turmblick", "Glutsenke"], "suchen": ["Nebelwerk", "Hafenkante"]})
    hafen = w["maps"]["Hafenkante"]
    tournament = await flow.db.tournaments.find_one({"id": w["tid"]}, {"_id": 0})
    held_pool = await map_pools.current(flow.db, "tournament", w["tid"])
    held = {"id": new_id(), "tournament_id": w["tid"], "map_pool_id": held_pool["id"]}
    await flow.db.matches_v2.insert_one(dict(held))
    await flow.db.tournaments.update_one({"id": w["tid"]}, {"$set": {"locked_at": now_utc().isoformat()}})

    no_reason = await flow.post(f"{ADMIN}/seasons/{w['season']['id']}/map-pool/remove-map", json={"map_id": hafen["id"]})
    assert no_reason.status_code == 422
    done = ok(await flow.post(f"{ADMIN}/seasons/{w['season']['id']}/map-pool/remove-map",
                              json={"map_id": hafen["id"], "reason": "Fehler im Spiel", "expected_version": 1}))
    assert done["pool"]["version"] == 2
    assert all(item["map_id"] != hafen["id"] for group in done["pool"]["modes"] for item in group["maps"])
    assert done["staffeln"] == [{"tournament_id": w["tid"], "title": tournament["title"], "applied": True, "notes": []}]
    assert done["warnings"] == []

    # Die Staffel spielt neue Spiele mit dem neuen Pool, das Spiel mit festgehaltenem Pool behält die Map. Version 1 bleibt.
    staffel_pool = await map_pools.effective_pool(flow.db, tournament)
    assert not map_pools.allowed(staffel_pool, "stellung", hafen["id"])
    kept = await map_pools.effective_pool(flow.db, tournament, match=held)
    assert map_pools.allowed(kept, "stellung", hafen["id"]) and kept["origin"] == "match"
    first = await flow.db.map_pools.find_one({"scope": "league_season", "scope_id": w["season"]["id"], "version": 1}, {"_id": 0})
    assert map_pools.allowed(first, "suchen", hafen["id"])
    log = [row for row in await actions(flow) if row["action"] == "league.season.map_pool.remove_map"]
    assert len(log) == 1 and log[0]["data"]["reason"] == "Fehler im Spiel" and log[0]["data"]["map_name"] == "Hafenkante"
    assert log[0]["data"]["staffeln"] == [{"tournament_id": w["tid"], "applied": True}]

    # Alte Version erwartet: 409. Eine Map, die nie im Pool stand: 404.
    stale = await flow.post(f"{ADMIN}/seasons/{w['season']['id']}/map-pool/remove-map",
                            json={"map_id": w["maps"]["Turmblick"]["id"], "reason": "Fehler im Spiel", "expected_version": 1})
    assert stale.status_code == 409
    other = ok(await flow.post(f"/api/games/{w['game']['id']}/maps", json={"name": "Neuland", "modes": ["stellung"]}))
    never = await flow.post(f"{ADMIN}/seasons/{w['season']['id']}/map-pool/remove-map", json={"map_id": other["id"], "reason": "Fehler im Spiel"})
    assert never.status_code == 404


async def second_staffel(flow, w: dict) -> str:
    flow.act_as(w["lead"])
    return ok(await flow.post(f"{ADMIN}/divisions/{w['division']['id']}/staffeln", json={}))["tournament_id"]


def pool_maps(doc: dict | None) -> list:
    return [(group.get("mode"), [item.get("map_id") for item in group.get("maps") or []]) for group in (doc or {}).get("modes") or []]


async def versions_of(flow, scope: str, scope_id: str) -> int:
    return await flow.db.map_pools.count_documents({"scope": scope, "scope_id": scope_id})


@pytest.mark.asyncio
async def test_removing_a_map_transfers_exactly_its_version_to_every_staffel(flow, monkeypatch):
    """Codex-Prüfung #2207: Auch wenn danach eine neuere Version entsteht, bekommen die Staffeln genau die Version ohne die Map."""
    w = await build(flow)
    other_tid = await second_staffel(flow, w)
    hafen, turm = w["maps"]["Hafenkante"], w["maps"]["Turmblick"]
    real = map_pools.without_map

    async def and_then_a_newer_one(db, **kwargs):
        previous, doc = await real(db, **kwargs)
        await db.map_pools.insert_one({**doc, "id": new_id(), "version": doc["version"] + 1, "note": "später",
                                       "modes": [{"mode": "stellung", "label": "Stellung", "maps": [doc["modes"][0]["maps"][0]]}]})
        return previous, doc

    monkeypatch.setattr(map_pools, "without_map", and_then_a_newer_one)
    done = ok(await flow.post(f"{ADMIN}/seasons/{w['season']['id']}/map-pool/remove-map",
                              json={"map_id": hafen["id"], "reason": "Fehler im Spiel"}))
    removed = await flow.db.map_pools.find_one({"id": done["pool"]["id"]}, {"_id": 0})
    assert pool_maps(removed) == [("stellung", [turm["id"]]), ("suchen", [w["maps"]["Nebelwerk"]["id"]])]
    assert {row["tournament_id"] for row in done["staffeln"] if row["applied"]} == {w["tid"], other_tid}
    for tid in (w["tid"], other_tid):
        assert pool_maps(await map_pools.current(flow.db, "tournament", tid)) == pool_maps(removed), tid


@pytest.mark.asyncio
async def test_a_busy_staffel_stops_removing_before_anything_is_written(flow):
    from services.mutation_lock import mutation_lock, tournament_write_resource

    w = await build(flow)
    other_tid = await second_staffel(flow, w)
    before = await versions_of(flow, "league_season", w["season"]["id"])
    async with mutation_lock(flow.db, tournament_write_resource(other_tid), wait_seconds=1, lease_seconds=30, retry_seconds=0.05):
        busy = await flow.post(f"{ADMIN}/seasons/{w['season']['id']}/map-pool/remove-map",
                               json={"map_id": w["maps"]["Hafenkante"]["id"], "reason": "Fehler im Spiel"})
    assert busy.status_code == 409 and "gerade bearbeitet" in busy.json()["detail"]
    assert await versions_of(flow, "league_season", w["season"]["id"]) == before
    assert await versions_of(flow, "tournament", w["tid"]) == 1
    assert not [row for row in await actions(flow) if row["action"] == "league.season.map_pool.remove_map"]


@pytest.mark.asyncio
async def test_removing_and_saving_the_pool_wait_for_each_other(flow):
    from services.mutation_lock import league_season_pool_resource, mutation_lock

    w = await build(flow)
    before = await versions_of(flow, "league_season", w["season"]["id"])
    async with mutation_lock(flow.db, league_season_pool_resource(w["season"]["id"]), wait_seconds=1, lease_seconds=30, retry_seconds=0.05):
        removing = await flow.post(f"{ADMIN}/seasons/{w['season']['id']}/map-pool/remove-map",
                                   json={"map_id": w["maps"]["Hafenkante"]["id"], "reason": "Fehler im Spiel"})
        saving = await flow.put(f"{ADMIN}/seasons/{w['season']['id']}/map-pool", json={"modes": [
            {"mode": "stellung", "map_ids": [w["maps"]["Turmblick"]["id"], w["maps"]["Glutsenke"]["id"]]},
            {"mode": "suchen", "map_ids": [w["maps"]["Nebelwerk"]["id"]]}]})
        clearing = await flow.delete(f"{ADMIN}/seasons/{w['season']['id']}/map-pool")
    assert (removing.status_code, saving.status_code, clearing.status_code) == (409, 409, 409)
    assert await versions_of(flow, "league_season", w["season"]["id"]) == before


@pytest.mark.asyncio
async def test_removing_again_finishes_what_is_missing_and_creates_nothing_twice(flow):
    w = await build(flow)
    other_tid = await second_staffel(flow, w)
    hafen = w["maps"]["Hafenkante"]
    first = ok(await flow.post(f"{ADMIN}/seasons/{w['season']['id']}/map-pool/remove-map",
                               json={"map_id": hafen["id"], "reason": "Fehler im Spiel"}))
    # Wie nach einem Abbruch mitten im Übertragen: Die zweite Staffel spielt noch den alten Pool.
    old = await flow.db.map_pools.find_one({"scope": "league_season", "scope_id": w["season"]["id"], "version": 1}, {"_id": 0})
    await map_pools.copy_version(flow.db, old, scope="tournament", scope_id=other_tid, user=w["lead"], tournament_id=other_tid)
    seasons, own = await versions_of(flow, "league_season", w["season"]["id"]), await versions_of(flow, "tournament", w["tid"])

    again = ok(await flow.post(f"{ADMIN}/seasons/{w['season']['id']}/map-pool/remove-map",
                               json={"map_id": hafen["id"], "reason": "Fehler im Spiel"}))
    assert again["unchanged"] is True and again["pool"]["version"] == first["pool"]["version"]
    assert await versions_of(flow, "league_season", w["season"]["id"]) == seasons
    assert await versions_of(flow, "tournament", w["tid"]) == own, "die schon übertragene Staffel bekommt nichts doppelt"
    assert not map_pools.allowed(await map_pools.current(flow.db, "tournament", other_tid), "stellung", hafen["id"])
    log = [row for row in await actions(flow) if row["action"] == "league.season.map_pool.remove_map"]
    assert [row["data"]["new_version"] for row in log] == [True, False]


@pytest.mark.asyncio
async def test_removing_a_map_only_from_one_mode_and_the_limits(flow):
    w = await build(flow, pool={"stellung": ["Hafenkante", "Turmblick"], "suchen": ["Hafenkante", "Nebelwerk"]})
    hafen, nebel = w["maps"]["Hafenkante"], w["maps"]["Nebelwerk"]
    done = ok(await flow.post(f"{ADMIN}/seasons/{w['season']['id']}/map-pool/remove-map",
                              json={"map_id": hafen["id"], "mode": "suchen", "reason": "Nur in Suchen kaputt"}))
    groups = {group["mode"]: [item["map_id"] for item in group["maps"]] for group in done["pool"]["modes"]}
    assert groups == {"stellung": [hafen["id"], w["maps"]["Turmblick"]["id"]], "suchen": [nebel["id"]]}
    # Ein Modus aus „Modus je Map“ darf nicht leer werden.
    empty = await flow.post(f"{ADMIN}/seasons/{w['season']['id']}/map-pool/remove-map",
                            json={"map_id": nebel["id"], "reason": "Auch kaputt"})
    assert empty.status_code == 422 and "„Suchen“" in empty.json()["detail"]
    # Zu klein wird gewarnt, nicht gesperrt.
    smaller = ok(await flow.post(f"{ADMIN}/seasons/{w['season']['id']}/map-pool/remove-map",
                                 json={"map_id": hafen["id"], "reason": "Ganz raus"}))
    assert smaller["warnings"] == ["Stellung braucht mindestens 2 Maps im Pool, hat 1."]


# ---------------------------------------------------------------- Prüfung vor der Veröffentlichung

@pytest.mark.asyncio
async def test_a_ready_season_has_no_problems_and_publishes(flow):
    w = await build(flow)
    result = ok(await flow.get(f"{ADMIN}/seasons/{w['season']['id']}/readiness"))
    assert result["ok"] and result["problems"] == [] and result["max_maps"] == 3
    assert codes(result["warnings"]) == {"application_none"}
    assert {row["mode"]: (row["needed"], row["have"]) for row in result["requirements"]} == {"stellung": (2, 2), "suchen": (1, 1)}
    published = ok(await flow.patch(f"{ADMIN}/seasons/{w['season']['id']}", json={"visibility": "public"}))
    assert published["visibility"] == "public"
    assert not [row for row in await actions(flow) if row["action"] == "league.season.readiness_override"]


@pytest.mark.asyncio
async def test_an_unready_season_lists_its_problems_and_does_not_publish(flow):
    w = await build(flow, staffel=False, rules=False,
                    season={"application_opens_at": "2020-01-01T10:00:00+00:00", "application_closes_at": "2099-01-01T10:00:00+00:00"})
    # Altbestand von vor der Regel „Modus je Map braucht den Modus im Pool“: Suchen fehlt, Stellung hat zu wenig.
    pool = await map_pools.current(flow.db, "league_season", w["season"]["id"])
    await flow.db.map_pools.update_one({"id": pool["id"]}, {"$set": {"modes": [pool["modes"][0] | {"maps": pool["modes"][0]["maps"][:1]}]}})
    result = ok(await flow.get(f"{ADMIN}/seasons/{w['season']['id']}/readiness"))
    assert not result["ok"]
    assert codes(result["problems"]) == {"pool_too_small", "mode_order_missing", "rules_missing", "staffel_missing",
                                         "application_after_start"}
    club = await flow.add_user(role="club_admin", name="Vorstand")
    flow.act_as(club)
    blocked = await flow.patch(f"{ADMIN}/seasons/{w['season']['id']}", json={"visibility": "members", "readiness_override_reason": "Bitte trotzdem"})
    assert blocked.status_code == 409 and blocked.json()["detail"].startswith("Veröffentlichen geht noch nicht:")
    assert "Nur der Superadmin" in blocked.json()["detail"]
    stored = await flow.db.league_seasons.find_one({"id": w["season"]["id"]}, {"_id": 0})
    assert stored["visibility"] == "off"
    # Ohne Sichtbarkeit lässt sich alles andere speichern.
    ok(await flow.patch(f"{ADMIN}/seasons/{w['season']['id']}", json={"name": "Season Eins"}))


@pytest.mark.asyncio
async def test_the_superadmin_publishes_with_a_reason_and_it_is_logged(flow):
    w = await build(flow, divisions=False, rules=False)
    without = await flow.patch(f"{ADMIN}/seasons/{w['season']['id']}", json={"visibility": "members", "readiness_override_reason": "kurz"})
    assert without.status_code == 409 and "Grund" in without.json()["detail"]
    done = ok(await flow.patch(f"{ADMIN}/seasons/{w['season']['id']}",
                               json={"visibility": "members", "readiness_override_reason": "Saisonstart trotz Lücke"}))
    assert done["visibility"] == "members"
    log = [row for row in await actions(flow) if row["action"] == "league.season.readiness_override"]
    assert len(log) == 1 and log[0]["data"]["reason"] == "Saisonstart trotz Lücke"
    assert set(log[0]["data"]["problems"]) == {"rules_missing", "divisions_missing"}
    # Von „members“ weiter auf „public“ ist schon veröffentlicht - das prüft nichts mehr.
    assert ok(await flow.patch(f"{ADMIN}/seasons/{w['season']['id']}", json={"visibility": "public"}))["visibility"] == "public"


@pytest.mark.asyncio
async def test_the_preview_for_the_league_lead_is_not_checked_but_leaving_it_is(flow):
    """Entscheidung des Orchestrators (#2207): „Nur Liga-Leitung“ ist Vorschau. Geprüft wird erst auf dem Weg zu Mitgliedern oder
    Öffentlichkeit - auch von der Vorschau aus."""
    w = await build(flow, divisions=False, rules=False)
    club = await flow.add_user(role="club_admin", name="Vorstand")
    flow.act_as(club)
    preview = ok(await flow.patch(f"{ADMIN}/seasons/{w['season']['id']}", json={"visibility": "admins"}))
    assert preview["visibility"] == "admins"
    for target in ("members", "public"):
        blocked = await flow.patch(f"{ADMIN}/seasons/{w['season']['id']}", json={"visibility": target})
        assert blocked.status_code == 409, target
    assert (await flow.db.league_seasons.find_one({"id": w["season"]["id"]}, {"_id": 0}))["visibility"] == "admins"
    # Zurück auf „aus“ geht immer, und eine neue Season darf gleich als Vorschau entstehen.
    assert ok(await flow.patch(f"{ADMIN}/seasons/{w['season']['id']}", json={"visibility": "off"}))["visibility"] == "off"
    created = ok(await flow.post(f"{ADMIN}/{w['league']['id']}/seasons", json=season_body(name="Season Vorschau", visibility="admins")))
    assert created["visibility"] == "admins"
    assert not [row for row in await actions(flow) if row["action"] == "league.season.readiness_override"]


@pytest.mark.asyncio
async def test_a_new_season_with_a_visibility_is_checked_too(flow):
    w = await build(flow)
    club = await flow.add_user(role="club_admin", name="Vorstand")
    flow.act_as(club)
    refused = await flow.post(f"{ADMIN}/{w['league']['id']}/seasons", json=season_body(name="Season Zwei", visibility="public"))
    assert refused.status_code == 409
    assert not await flow.db.league_seasons.find_one({"name": "Season Zwei"})
    assert ok(await flow.post(f"{ADMIN}/{w['league']['id']}/seasons", json=season_body(name="Season Zwei")))["visibility"] == "off"


@pytest.mark.asyncio
async def test_readiness_warns_about_inactive_modes_and_maps_in_the_pool(flow):
    w = await build(flow)
    ok(await flow.patch(f"/api/games/{w['game']['id']}/maps/{w['maps']['Nebelwerk']['id']}", json={"status": "inactive"}))
    await flow.db.games.update_one({"id": w["game"]["id"], "match_modes.mode": "suchen"}, {"$set": {"match_modes.$.status": "inactive"}})
    result = ok(await flow.get(f"{ADMIN}/seasons/{w['season']['id']}/readiness"))
    assert result["ok"]
    assert {"inactive_map", "inactive_mode"} <= codes(result["warnings"])
    texts = " ".join(item["text"] for item in result["warnings"])
    assert "„Nebelwerk“ ist inaktiv" in texts and "„Suchen“ ist inaktiv" in texts


@pytest.mark.asyncio
async def test_readiness_names_a_missing_or_foreign_pool_and_an_upcoming_rule(flow):
    w = await build(flow, pool={}, rules=False)
    from league_rules_world import in_days

    await publish(flow, w, valid_from=in_days(10))
    result = ok(await flow.get(f"{ADMIN}/seasons/{w['season']['id']}/readiness"))
    assert "pool_missing" in codes(result["problems"]) and "rules_upcoming" in codes(result["warnings"])
    assert "rules_missing" not in codes(result["problems"])
    await save_pool(flow, w, {"stellung": ["Hafenkante", "Turmblick"], "suchen": ["Nebelwerk"]})
    await flow.db.map_pools.update_many({"scope": "league_season"}, {"$set": {"game_id": "anderes-spiel"}})
    assert "pool_stale" in codes(ok(await flow.get(f"{ADMIN}/seasons/{w['season']['id']}/readiness"))["problems"])
