"""Maps der Team-Liga (#1616 an #1931) über die echten Routen: Auswahl aus dem Map-Pool der Saison im Ergebnisblatt,
Name und Bild als Snapshot im gespeicherten Spiel, das Veto mit Bildern auf der Serienseite und die Statistik je Map
für die eigenen Teams. Fremde Map-Kennungen lehnt der Server ab, Freitext bleibt möglich. Nur erfundene Namen."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from routes import reference_round_routes, reference_series_public_routes  # noqa: E402
from services import migrations  # noqa: E402

ADMIN = "/api/reference-series/admin"
PUBLIC = "/api/reference-series/public"
OWN = "Probe Löwen"
SHOOTER = {"name": "Probe Shooter", "match_modes": [{"mode": "snd", "label": "Suchen & Zerstören"},
                                                     {"mode": "stellung", "label": "Stellung"}]}


@pytest_asyncio.fixture
async def flow(monkeypatch):
    instance, shutdown = make_flow()
    monkeypatch.setattr(reference_round_routes, "club_today", lambda: "2026-05-15")
    monkeypatch.setattr(reference_series_public_routes, "club_today", lambda: "2026-05-15")
    try:
        yield instance
    finally:
        await shutdown()


async def _setup(flow, *, with_game=True, with_pool=True):
    await migrations.migrate_points_scheme_templates(flow.db)
    admin = await flow.add_user(role="superadmin", name="vorstand")
    flow.act_as(admin)
    game = (await flow.post("/api/games", json=SHOOTER)).json()
    maps = {}
    for name, modes, aliases in (("Hafenkante", ["snd", "stellung"], ["Harbour Edge"]), ("Nebelwerk", ["snd"], []),
                                 ("Glutsenke", ["stellung"], []), ("Sturmdeck", ["snd"], [])):
        created = await flow.post(f"/api/games/{game['id']}/maps", json={
            "name": name, "modes": modes, "aliases": aliases, "image_url": f"/api/static/uploads/{name.lower()}.webp"})
        assert created.status_code == 200, created.text
        maps[name] = created.json()
    lineage = (await flow.post(f"{ADMIN}/lineages", json={
        "title": "Probe Liga S&D", "kind": "team_league", **({"game_id": game["id"]} if with_game else {})})).json()
    series = (await flow.post(f"{ADMIN}/series", json={
        "lineage_id": lineage["id"], "season": "2026", "team_name": OWN, "status": "active"})).json()
    if with_pool:
        pool = await flow.put(f"/api/map-pools/reference-series/{series['id']}", json={"modes": [
            {"mode": "snd", "map_ids": [maps["Nebelwerk"]["id"], maps["Hafenkante"]["id"], maps["Sturmdeck"]["id"]]}]})
        assert pool.status_code == 200, pool.text
    round_doc = (await flow.post(f"{ADMIN}/series/{series['id']}/rounds", json={
        "code": "ST1", "day": "2026-05-13", "opponent": "Probe Falken", "at_home": True})).json()
    return game, maps, lineage, series, round_doc


def _base(series, round_doc):
    return f"{ADMIN}/series/{series['id']}/rounds/{round_doc['id']}/results"


def _sheet(maps, *extra_maps):
    return {"matches": [
        {"home": OWN, "away": "Probe Falken", "home_score": 2, "away_score": 1,
         "maps": [{"name": "Nebelwerk", "map_id": maps["Nebelwerk"]["id"], "role": "banned", "by": "own"},
                  {"name": "Sturmdeck", "map_id": maps["Sturmdeck"]["id"], "role": "banned", "by": "opponent"},
                  {"name": "Hafenkante", "map_id": maps["Hafenkante"]["id"], "role": "picked", "by": "own",
                   "home_score": 6, "away_score": 3},
                  {"name": "Karte Ohne Bibliothek", "role": "picked", "by": "opponent", "home_score": 4, "away_score": 6},
                  *extra_maps]},
        {"home": "Probe Adler", "away": "Probe Eulen", "home_score": 0, "away_score": 2,
         "maps": [{"name": "Hafenkante", "map_id": maps["Hafenkante"]["id"], "home_score": 1, "away_score": 6}]},
    ]}


# ---------------------------------------------------------------- Auswahl im Ergebnisblatt
@pytest.mark.asyncio
async def test_the_sheet_offers_the_season_pool_with_images_and_aliases(flow):
    _game, maps, _lineage, series, round_doc = await _setup(flow)
    choices = (await flow.get(_base(series, round_doc))).json()["series"]["map_choices"]
    assert choices["source"] == "pool"
    assert [(group["mode"], [item["name"] for item in group["maps"]]) for group in choices["modes"]] == [
        ("snd", ["Nebelwerk", "Hafenkante", "Sturmdeck"])]
    hafen = choices["modes"][0]["maps"][1]
    assert (hafen["map_id"], hafen["image_url"], hafen["aliases"]) == (
        maps["Hafenkante"]["id"], "/api/static/uploads/hafenkante.webp", ["Harbour Edge"])


@pytest.mark.asyncio
async def test_without_season_pool_the_sheet_offers_the_game_library_and_without_game_free_text(flow):
    _game, _maps, _lineage, series, round_doc = await _setup(flow, with_pool=False)
    choices = (await flow.get(_base(series, round_doc))).json()["series"]["map_choices"]
    assert choices["source"] == "library"
    assert [(group["mode"], [item["name"] for item in group["maps"]]) for group in choices["modes"]] == [
        ("snd", ["Hafenkante", "Nebelwerk", "Sturmdeck"]), ("stellung", ["Hafenkante", "Glutsenke"])]


@pytest.mark.asyncio
async def test_a_lineage_without_game_has_no_choices(flow):
    _game, _maps, _lineage, series, round_doc = await _setup(flow, with_game=False, with_pool=False)
    assert (await flow.get(_base(series, round_doc))).json()["series"]["map_choices"] is None


# ---------------------------------------------------------------- Speichern mit Snapshot
@pytest.mark.asyncio
async def test_a_saved_match_keeps_name_and_image_of_its_maps_when_the_library_changes(flow):
    game, maps, lineage, series, round_doc = await _setup(flow)
    saved = await flow.put(_base(series, round_doc), json={**_sheet(maps), "status": "published", "expected_version": 0})
    assert saved.status_code == 200, saved.text
    stored = saved.json()["sheet"]["matches"][0]["maps"]
    assert [(item["name"], item.get("image_url")) for item in stored] == [
        ("Nebelwerk", "/api/static/uploads/nebelwerk.webp"), ("Sturmdeck", "/api/static/uploads/sturmdeck.webp"),
        ("Hafenkante", "/api/static/uploads/hafenkante.webp"), ("Karte Ohne Bibliothek", None)]

    hafen = maps["Hafenkante"]["id"]
    await flow.patch(f"/api/games/{game['id']}/maps/{hafen}", json={
        "name": "Hafenkante Neu", "image_url": "/api/static/uploads/hafen-neu.webp", "status": "archived"})

    flow.act_as(None)
    page = (await flow.get(f"{PUBLIC}/{lineage['slug']}/{series['season_slug']}")).json()
    veto = page["team_league"]["matchdays"][0]["match"]["veto"]
    assert [(step["name"], step["role"], step.get("by"), step.get("image_url")) for step in veto] == [
        ("Nebelwerk", "banned", "own", "/api/static/uploads/nebelwerk.webp"),
        ("Sturmdeck", "banned", "opponent", "/api/static/uploads/sturmdeck.webp"),
        ("Hafenkante", "picked", "own", "/api/static/uploads/hafenkante.webp"),
        ("Karte Ohne Bibliothek", "picked", "opponent", None)]
    assert veto[2]["outcome"] == "win" and veto[3]["outcome"] == "loss"


@pytest.mark.asyncio
async def test_a_foreign_map_id_is_refused_with_the_place_of_the_map(flow):
    _game, maps, _lineage, series, round_doc = await _setup(flow)
    other = (await flow.post("/api/games", json={"name": "Probe Kart"})).json()
    foreign = (await flow.post(f"/api/games/{other['id']}/maps", json={"name": "Kupfermine"})).json()
    sheet = _sheet(maps, {"name": "Kupfermine", "map_id": foreign["id"], "role": "decider", "home_score": 6,
                          "away_score": 2})
    preview = await flow.post(f"{_base(series, round_doc)}/preview", json=sheet)
    assert preview.status_code == 200, preview.text
    problem = next(item for item in preview.json()["errors"] if item["code"] == "map_unknown")
    assert (problem["match"], problem["map"], problem["map_field"]) == (0, 4, "name")
    refused = await flow.put(_base(series, round_doc), json={**sheet, "status": "published", "expected_version": 0})
    assert refused.status_code == 422


# ---------------------------------------------------------------- Statistik
@pytest.mark.asyncio
async def test_the_team_league_page_counts_bans_picks_plays_and_results_per_map_for_own_teams(flow):
    _game, maps, lineage, series, round_doc = await _setup(flow)
    await flow.put(_base(series, round_doc), json={**_sheet(maps), "status": "published", "expected_version": 0})
    second = (await flow.post(f"{ADMIN}/series/{series['id']}/rounds", json={
        "code": "ST2", "day": "2026-05-20", "opponent": "Probe Wölfe", "at_home": False})).json()
    await flow.put(_base(series, second), json={"matches": [
        {"home": "Probe Wölfe", "away": OWN, "home_score": 1, "away_score": 2,
         "maps": [{"name": "Nebelwerk", "map_id": maps["Nebelwerk"]["id"], "role": "banned", "by": "opponent"},
                  {"name": "Hafenkante", "map_id": maps["Hafenkante"]["id"], "role": "picked", "by": "opponent",
                   "home_score": 6, "away_score": 4},
                  {"name": "Sturmdeck", "map_id": maps["Sturmdeck"]["id"], "role": "decider",
                   "home_score": 2, "away_score": 6}]}], "status": "published", "expected_version": 0})

    flow.act_as(None)
    stats = (await flow.get(f"{PUBLIC}/{lineage['slug']}/{series['season_slug']}")).json()["team_league"]["map_stats"]
    by_name = {item["name"]: item for item in stats}
    hafen = by_name["Hafenkante"]
    assert {key: hafen[key] for key in ("played", "won", "lost", "picked_own", "picked_opponent")} == {
        "played": 2, "won": 1, "lost": 1, "picked_own": 1, "picked_opponent": 1}
    assert hafen["image_url"] == "/api/static/uploads/hafenkante.webp"
    assert {key: by_name["Nebelwerk"][key] for key in ("banned_own", "banned_opponent", "played")} == {
        "banned_own": 1, "banned_opponent": 1, "played": 0}
    assert {key: by_name["Sturmdeck"][key] for key in ("banned_opponent", "decider", "played", "won")} == {
        "banned_opponent": 1, "decider": 1, "played": 1, "won": 1}
    # Freitext zählt unter seinem Namen; Spiele anderer Teams zählen nie mit.
    assert by_name["Karte Ohne Bibliothek"]["lost"] == 1 and by_name["Karte Ohne Bibliothek"]["image_url"] is None
    assert hafen["played"] == 2, "das Spiel Adler gegen Eulen auf Hafenkante zählt nicht"
    assert stats[0]["name"] == "Hafenkante"  # meistgespielte zuerst


@pytest.mark.asyncio
async def test_a_map_image_in_a_saved_match_counts_as_used(flow):
    from services import media_audit

    _game, maps, _lineage, series, round_doc = await _setup(flow)
    await flow.put(_base(series, round_doc), json={**_sheet(maps), "status": "published", "expected_version": 0})
    places = {(collection, field) async for collection, _doc, field, _name, _text
              in media_audit.iter_usages(flow.db, {"sturmdeck.webp"})}
    assert ("reference_round_results", "matches.maps.image_url") in places
    assert media_audit.place_label("reference_round_results", "matches.maps.image_url") == "Ergebnisblatt · Bild einer Map"


# ---------------------------------------------------------------- Bibliothek: Schreibweisen
@pytest.mark.asyncio
async def test_a_map_keeps_other_spellings_for_matching(flow):
    admin = await flow.add_user(role="superadmin", name="admin")
    flow.act_as(admin)
    game = (await flow.post("/api/games", json=SHOOTER)).json()
    created = await flow.post(f"/api/games/{game['id']}/maps", json={"name": "Hafenkante",
                                                                      "aliases": [" Harbour  Edge ", "harbour edge", ""]})
    assert created.status_code == 200, created.text
    assert created.json()["aliases"] == ["Harbour Edge"]
    changed = await flow.patch(f"/api/games/{game['id']}/maps/{created.json()['id']}", json={"aliases": ["Hafen"]})
    assert changed.json()["aliases"] == ["Hafen"]
