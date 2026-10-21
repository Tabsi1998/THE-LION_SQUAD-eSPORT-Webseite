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


async def _second_round(flow, series, code="ST2", day="2026-05-20"):
    return (await flow.post(f"{ADMIN}/series/{series['id']}/rounds", json={
        "code": code, "day": day, "opponent": "Probe Wölfe", "at_home": True})).json()


def _one_map(item):
    return {"matches": [{"home": OWN, "away": "Probe Wölfe", "home_score": 1, "away_score": 0,
                         "maps": [{"role": "picked", "by": "own", "home_score": 6, "away_score": 2, **item}]}]}


async def _codes(flow, series, round_doc, sheet):
    preview = await flow.post(f"{_base(series, round_doc)}/preview", json=sheet)
    assert preview.status_code == 200, preview.text
    return [item["code"] for item in preview.json()["errors"]]


# ---------------------------------------------------------------- Befund 1: nur aus dem geltenden Pool
@pytest.mark.asyncio
async def test_a_new_entry_takes_only_maps_of_the_current_season_pool(flow):
    game, maps, _lineage, series, round_doc = await _setup(flow)
    # Glutsenke gehört zum Spiel, steht aber nicht im Pool der Saison.
    assert "map_unknown" in await _codes(flow, series, round_doc, _one_map(
        {"name": "Glutsenke", "map_id": maps["Glutsenke"]["id"]}))
    # Sturmdeck stand im alten Pool, im neuen nicht mehr.
    await flow.put(f"/api/map-pools/reference-series/{series['id']}", json={"modes": [
        {"mode": "snd", "map_ids": [maps["Nebelwerk"]["id"], maps["Hafenkante"]["id"]]}]})
    assert "map_unknown" in await _codes(flow, series, round_doc, _one_map(
        {"name": "Sturmdeck", "map_id": maps["Sturmdeck"]["id"]}))
    # Je Modus: Hafenkante steht im Pool nur unter S&D.
    assert "map_unknown" in await _codes(flow, series, round_doc, _one_map(
        {"name": "Hafenkante", "map_id": maps["Hafenkante"]["id"], "mode": "stellung"}))
    assert await _codes(flow, series, round_doc, _one_map(
        {"name": "Hafenkante", "map_id": maps["Hafenkante"]["id"], "mode": "snd"})) == []


@pytest.mark.asyncio
async def test_without_season_pool_only_active_maps_of_the_game_are_taken(flow):
    game, maps, _lineage, series, round_doc = await _setup(flow, with_pool=False)
    await flow.patch(f"/api/games/{game['id']}/maps/{maps['Glutsenke']['id']}", json={"status": "archived"})
    assert "map_unknown" in await _codes(flow, series, round_doc, _one_map(
        {"name": "Glutsenke", "map_id": maps["Glutsenke"]["id"]}))
    assert "map_unknown" in await _codes(flow, series, round_doc, _one_map(
        {"name": "Nebelwerk", "map_id": maps["Nebelwerk"]["id"], "mode": "stellung"}))
    assert await _codes(flow, series, round_doc, _one_map({"name": "Nebelwerk", "map_id": maps["Nebelwerk"]["id"]})) == []


@pytest.mark.asyncio
async def test_a_saved_match_keeps_its_old_map_when_saved_again(flow):
    game, maps, _lineage, series, round_doc = await _setup(flow)
    sturm = maps["Sturmdeck"]["id"]
    first = await flow.put(_base(series, round_doc), json={
        **_one_map({"name": "Sturmdeck", "map_id": sturm}), "status": "published", "expected_version": 0})
    assert first.status_code == 200, first.text
    # Danach fliegt Sturmdeck aus dem Pool, wird umbenannt und archiviert.
    await flow.put(f"/api/map-pools/reference-series/{series['id']}", json={"modes": [
        {"mode": "snd", "map_ids": [maps["Nebelwerk"]["id"]]}]})
    await flow.patch(f"/api/games/{game['id']}/maps/{sturm}", json={"name": "Sturmdeck Neu", "status": "archived",
                                                                    "image_url": "/api/static/uploads/sturm-neu.webp"})
    again = await flow.put(_base(series, round_doc), json={
        **_one_map({"name": "Sturmdeck Neu", "map_id": sturm}), "status": "published", "expected_version": 1})
    assert again.status_code == 200, again.text
    stored = again.json()["sheet"]["matches"][0]["maps"][0]
    assert (stored["name"], stored["image_url"]) == ("Sturmdeck", "/api/static/uploads/sturmdeck.webp")
    # Ein neues Spiel nimmt die Map nicht mehr.
    second = await _second_round(flow, series)
    assert "map_unknown" in await _codes(flow, series, second, _one_map({"name": "Sturmdeck", "map_id": sturm}))


@pytest.mark.asyncio
async def test_the_kept_old_map_is_bound_to_its_place_in_the_saved_match(flow):
    """Nachprüfung: die Ausnahme gilt nur für dieselbe Map an derselben Stelle - gleiches Spiel, gleiche Map-Nummer,
    gleiche Kennung, gleicher Modus. Sonst ließe sich eine aus dem Pool gefallene Map anderswo einschleusen."""
    _game, maps, _lineage, series, round_doc = await _setup(flow)
    sturm = maps["Sturmdeck"]["id"]
    saved = await flow.put(_base(series, round_doc), json={
        **_one_map({"name": "Sturmdeck", "map_id": sturm, "mode": "snd"}), "status": "published", "expected_version": 0})
    assert saved.status_code == 200, saved.text
    await flow.put(f"/api/map-pools/reference-series/{series['id']}", json={"modes": [
        {"mode": "snd", "map_ids": [maps["Nebelwerk"]["id"]]}]})
    same = _one_map({"name": "Sturmdeck", "map_id": sturm, "mode": "snd"})
    assert await _codes(flow, series, round_doc, same) == []

    # Andere Map-Nummer: eine Map davor eingeschoben.
    moved = _one_map({"name": "Sturmdeck", "map_id": sturm, "mode": "snd"})
    moved["matches"][0]["maps"].insert(0, {"name": "Karte Frei", "role": "banned", "by": "own"})
    assert "map_unknown" in await _codes(flow, series, round_doc, moved)
    # Anderer Modus an derselben Stelle.
    assert "map_unknown" in await _codes(flow, series, round_doc, _one_map(
        {"name": "Sturmdeck", "map_id": sturm, "mode": "stellung"}))
    # Anderes Spiel im selben Blatt.
    other = {"matches": [*same["matches"], {"home": "Probe Adler", "away": "Probe Eulen", "home_score": 1,
                                            "away_score": 0, "maps": [{"name": "Sturmdeck", "map_id": sturm,
                                                                       "mode": "snd", "home_score": 6, "away_score": 1}]}]}
    preview = await flow.post(f"{_base(series, round_doc)}/preview", json=other)
    problems = preview.json()["errors"]
    assert [(item["match"], item["map"]) for item in problems if item["code"] == "map_unknown"] == [(1, 0)]


@pytest.mark.asyncio
async def test_a_copied_match_with_the_same_teams_does_not_reuse_the_kept_map(flow):
    """Dritte Runde: dieselbe Begegnung ein zweites Mal ins Blatt kopiert - der gespeicherte Snapshot gilt nur für so
    viele Begegnungen, wie gespeichert waren (je Begegnung nach ihrer Reihenfolge im Blatt)."""
    _game, maps, _lineage, series, round_doc = await _setup(flow)
    sturm = maps["Sturmdeck"]["id"]
    sheet = _one_map({"name": "Sturmdeck", "map_id": sturm, "mode": "snd"})
    saved = await flow.put(_base(series, round_doc), json={**sheet, "status": "published", "expected_version": 0})
    assert saved.status_code == 200, saved.text
    await flow.put(f"/api/map-pools/reference-series/{series['id']}", json={"modes": [
        {"mode": "snd", "map_ids": [maps["Nebelwerk"]["id"]]}]})
    original = sheet["matches"][0]
    twice = {"matches": [original, {**original}]}
    preview = await flow.post(f"{_base(series, round_doc)}/preview", json=twice)
    problems = [(item["match"], item["map"]) for item in preview.json()["errors"] if item["code"] == "map_unknown"]
    assert problems == [(1, 0)]


# ---------------------------------------------------------------- Befund 2: Name und Bild nie aus der Eingabe
@pytest.mark.asyncio
async def test_name_and_image_of_a_library_map_never_come_from_the_input(flow):
    _game, maps, _lineage, series, round_doc = await _setup(flow)
    saved = await flow.put(_base(series, round_doc), json={**_one_map({
        "name": "Ganz anderer Name", "map_id": maps["Hafenkante"]["id"], "image_url": "https://example.org/fremd.png"}),
        "status": "published", "expected_version": 0})
    assert saved.status_code == 200, saved.text
    stored = saved.json()["sheet"]["matches"][0]["maps"][0]
    assert (stored["name"], stored["image_url"]) == ("Hafenkante", "/api/static/uploads/hafenkante.webp")


# ---------------------------------------------------------------- Befund 4: Mediathek ohne Vollscan der Blätter
@pytest.mark.asyncio
async def test_map_images_of_saved_matches_stay_used_without_scanning_result_sheets(flow):
    from services import media_audit

    game, maps, _lineage, series, round_doc = await _setup(flow, with_pool=False)
    await flow.put(_base(series, round_doc), json={
        **_one_map({"name": "Glutsenke", "map_id": maps["Glutsenke"]["id"]}), "status": "published",
        "expected_version": 0})
    # Ein neues Bild in der Bibliothek: das alte (im Blatt gespeicherte) bleibt über die Bibliothek verwendet.
    await flow.patch(f"/api/games/{game['id']}/maps/{maps['Glutsenke']['id']}",
                     json={"image_url": "/api/static/uploads/glut-neu.webp"})
    places = {(collection, field) async for collection, _doc, field, _name, _text
              in media_audit.iter_usages(flow.db, {"glutsenke.webp"})}
    assert places == {("game_maps", "image_history")}
    assert not any(collection.startswith("reference_round_result") for collection, _f, _t in media_audit.usage_places())
    # Gelöscht wird eine Map aus einem gespeicherten Spiel nie - archivieren.
    refused = await flow.delete(f"/api/games/{game['id']}/maps/{maps['Glutsenke']['id']}")
    assert refused.status_code == 409


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


# ---------------------------------------------------------------- Befund 3: Schreibweisen prüfen statt kürzen
@pytest.mark.asyncio
async def test_too_many_or_too_long_spellings_are_refused_not_cut(flow):
    admin = await flow.add_user(role="superadmin", name="admin")
    flow.act_as(admin)
    game = (await flow.post("/api/games", json=SHOOTER)).json()
    many = await flow.post(f"/api/games/{game['id']}/maps", json={"name": "Hafenkante",
                                                                   "aliases": [f"Hafen {index}" for index in range(11)]})
    assert many.status_code == 422
    assert "10" in many.text
    long = await flow.post(f"/api/games/{game['id']}/maps", json={"name": "Hafenkante", "aliases": ["H" * 81]})
    assert long.status_code == 422
    assert "80" in long.text


@pytest.mark.asyncio
async def test_a_spelling_may_not_point_to_another_map_of_the_game(flow):
    admin = await flow.add_user(role="superadmin", name="admin")
    flow.act_as(admin)
    game = (await flow.post("/api/games", json=SHOOTER)).json()
    base = f"/api/games/{game['id']}/maps"
    nebel = (await flow.post(base, json={"name": "Nebelwerk", "slug": "nebel-werk", "aliases": ["Fog Works"]})).json()
    for alias in ("nebelwerk", "Nebel-Werk", "fog works"):
        clash = await flow.post(base, json={"name": "Hafenkante", "aliases": [alias]})
        assert clash.status_code == 409, alias
        assert "Nebelwerk" in clash.json()["detail"]
    # Auch umgekehrt: ein Name, der schon Schreibweise einer anderen Map ist.
    named = await flow.post(base, json={"name": "Fog Works"})
    assert named.status_code == 409
    hafen = (await flow.post(base, json={"name": "Hafenkante"})).json()
    changed = await flow.patch(f"{base}/{hafen['id']}", json={"aliases": ["Fog-Works"]})
    assert changed.status_code == 409
    # Die eigene Map stört sich nicht an sich selbst.
    own = await flow.patch(f"{base}/{nebel['id']}", json={"aliases": ["Fog Works", "Nebel"]})
    assert own.status_code == 200, own.text


@pytest.mark.asyncio
async def test_renaming_or_a_new_slug_may_not_point_to_another_map(flow):
    """Nachprüfung: Umbenennen und neuer Slug werden wie beim Anlegen gegen Name, Slug und Schreibweisen der anderen
    Maps geprüft (ohne Groß/klein, Leer- und Satzzeichen)."""
    admin = await flow.add_user(role="superadmin", name="admin")
    flow.act_as(admin)
    game = (await flow.post("/api/games", json=SHOOTER)).json()
    base = f"/api/games/{game['id']}/maps"
    await flow.post(base, json={"name": "Nebelwerk", "aliases": ["Fog Works"]})
    hafen = (await flow.post(base, json={"name": "Hafenkante"})).json()
    renamed = await flow.patch(f"{base}/{hafen['id']}", json={"name": "Fog-Works"})
    new_slug = await flow.patch(f"{base}/{hafen['id']}", json={"slug": "fog-works"})
    assert (renamed.status_code, new_slug.status_code) == (409, 409)
    assert "Nebelwerk" in new_slug.json()["detail"]
    # Eigene Schreibweisen bleiben frei: Name und Slug der Map selbst.
    fine = await flow.patch(f"{base}/{hafen['id']}", json={"slug": "hafen-kante", "aliases": ["Hafen Kante"]})
    assert fine.status_code == 200, fine.text


async def _parallel_creates(flow, monkeypatch, gated: str, unique_keys: bool):
    import asyncio

    import routes.game_map_routes as map_routes
    from flow_harness import InterleavedReads

    admin = await flow.add_user(role="superadmin", name="admin")
    flow.act_as(admin)
    game = (await flow.post("/api/games", json=SHOOTER)).json()
    if unique_keys:
        await flow.db.game_map_keys.create_index([("game_id", 1), ("key", 1)], unique=True)
    gate = InterleavedReads(flow.db, gated)
    monkeypatch.setattr(map_routes, "get_db", lambda: gate)
    base = f"/api/games/{game['id']}/maps"
    # Verschiedene Namen und Slugs, aber dieselbe Schreibweise - nur eine darf sie bekommen.
    first, second = await asyncio.gather(flow.post(base, json={"name": "Hafenkante", "aliases": ["Fog Works"]}),
                                         flow.post(base, json={"name": "Nebelwerk", "aliases": ["Fog-Works"]}))
    return game, first, second


@pytest.mark.asyncio
async def test_two_parallel_creates_with_the_same_spelling_give_one_conflict(flow, monkeypatch):
    game, first, second = await _parallel_creates(flow, monkeypatch, "game_maps", unique_keys=True)
    assert sorted([first.status_code, second.status_code]) == [200, 409]
    assert await flow.db.game_maps.count_documents({"game_id": game["id"]}) == 1


@pytest.mark.asyncio
async def test_the_unique_spelling_index_decides_when_both_checks_pass(flow, monkeypatch):
    """Lesen beide den alten Stand der Schreibweisen, entscheidet der eindeutige Index (game_id, key) - 409, nie 500."""
    game, first, second = await _parallel_creates(flow, monkeypatch, "game_map_keys", unique_keys=True)
    assert sorted([first.status_code, second.status_code]) == [200, 409]
    assert await flow.db.game_maps.count_documents({"game_id": game["id"]}) == 1
    keys = [row["key"] async for row in flow.db.game_map_keys.find({"game_id": game["id"]})]
    assert sorted(keys).count("fogworks") == 1


@pytest.mark.asyncio
async def test_existing_maps_get_their_spellings_reserved_by_the_migration(flow):
    """Altbestand ohne belegte Schreibweisen: die Migration belegt sie; bei Doppelten gewinnt die erste Map."""
    admin = await flow.add_user(role="superadmin", name="admin")
    flow.act_as(admin)
    game = (await flow.post("/api/games", json=SHOOTER)).json()
    await flow.db.game_maps.insert_many([
        {"id": "alt-1", "game_id": game["id"], "slug": "hafenkante", "name": "Hafenkante", "aliases": ["Fog Works"],
         "modes": [], "order": 1, "status": "active"},
        {"id": "alt-2", "game_id": game["id"], "slug": "nebelwerk", "name": "Nebelwerk", "aliases": ["Fog-Works"],
         "modes": [], "order": 2, "status": "active"}])
    assert await migrations.migrate_game_map_keys(flow.db) == "3 map spellings reserved, 1 skipped"
    owners = {row["key"]: row["map_id"] async for row in flow.db.game_map_keys.find({"game_id": game["id"]})}
    assert owners == {"hafenkante": "alt-1", "fogworks": "alt-1", "nebelwerk": "alt-2"}
    clash = await flow.post(f"/api/games/{game['id']}/maps", json={"name": "Sturmdeck", "aliases": ["fog works"]})
    assert clash.status_code == 409
    assert any(version == 9 and name == "game_map_spelling_keys" for version, name, _ in migrations.MIGRATIONS)
