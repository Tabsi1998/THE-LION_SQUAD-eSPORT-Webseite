"""„Modus je Map“ und Pool der Staffel gehören zusammen (#2129) - durch die echten Routen, Best of 3, zweite Map.

Der Pool geht beim Übertragen immer auf die Staffel über, die Reihenfolge nach dem ersten Ergebnis nicht. Fehlt dem Pool
danach ein Modus der Reihenfolge, wäre für Spiele ohne festgehaltenen Pool keine Meldung möglich. Deshalb: Die Reihenfolge
gilt nur, wenn der geltende Pool alle ihre Modi hat; die Season nimmt so einen Pool gar nicht erst an; das Übertragen sagt es.
Erfundene Namen.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_match_world import GAME_ID, OLD_RULES, ids, two_nil, world  # noqa: E402
from models import new_id, now_utc  # noqa: E402

MODES = [{"mode": "stellung", "label": "Stellung"}, {"mode": "suchen", "label": "Suchen & Zerstören"}]
ONLY_STELLUNG = {"modes": [{"mode": "stellung", "map_ids": ["map-hafen", "map-nebel"]}]}
HINT = "nicht mehr alle Modi"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def real_season(flow, w, *, order=("stellung", "suchen"), with_result=True) -> str:
    """Macht aus der Staffel von ``world`` eine echte Season-Staffel; ``with_result``: ein anderes Spiel ist schon gelaufen."""
    now = now_utc().isoformat()
    await flow.db.games.insert_one({"id": GAME_ID, "name": "Probe Shooter", "slug": GAME_ID, "kind": "standalone", "match_modes": MODES,
                                    "created_at": now, "updated_at": now})
    for slug, modes in (("hafen", ["stellung"]), ("nebel", ["stellung", "suchen"]), ("turm", ["suchen"])):
        await flow.db.game_maps.insert_one({"id": f"map-{slug}", "game_id": GAME_ID, "slug": slug, "name": slug.title(), "status": "active",
                                            "modes": modes, "order": 1, "image_url": f"/uploads/maps/{slug}.webp"})
    flow.act_as(await flow.add_user(role="superadmin", name="Leitung"))
    league = await flow.post("/api/admin/leagues", json={"name": "Probe Liga", "game_id": GAME_ID})
    assert league.status_code == 200, league.text
    season = await flow.post(f"/api/admin/leagues/{league.json()['id']}/seasons",
                             json={**OLD_RULES, "name": "Season 1", "start_date": "2030-01-07T18:00:00+00:00", "best_of": 3, "team_size": 2,
                                   # Seit #2207 so lang wie die Serie - zyklisch dasselbe wie die kurze Reihenfolge.
                                   "game_mode_order": [order[index % len(order)] for index in range(3)] if order else []})
    assert season.status_code == 200, season.text
    season_id = season.json()["id"]
    # Die Season läuft (die Staffel spielt schon): eine kürzere Reihenfolge ist dann nur eine Warnung (#2207).
    await flow.db.league_seasons.update_one({"id": season_id}, {"$set": {"status": "active"}})
    division = await flow.post(f"/api/admin/leagues/seasons/{season_id}/divisions", json={"level": 1})
    assert division.status_code == 200, division.text
    await flow.db.tournaments.update_one({"id": w["tournament"]["id"]}, {"$set": {"league_context": {
        "league_id": league.json()["id"], "season_id": season_id, "division_id": division.json()["id"], "staffel": "A"}}})
    if with_result:
        await flow.db.matches_v2.insert_one({"id": new_id(), "tournament_id": w["tournament"]["id"], "status": "completed",
                                             "started_at": now, "slots": []})
    return season_id


async def remove_suchen(flow) -> None:
    """Altbestand von vor #2206: „Suchen“ wurde dem Spiel entfernt, obwohl Season und Pool ihn nutzen. Heute lehnt die API
    das ab (409, nur noch deaktivieren) - der Zustand kann aus alten Daten aber noch da sein und muss weiter tragen."""
    refused = await flow.patch(f"/api/games/{GAME_ID}", json={"match_modes": MODES[:1]})
    assert refused.status_code == 409, refused.text
    await flow.db.games.update_one({"id": GAME_ID}, {"$set": {"match_modes": MODES[:1]}})
    await flow.db.game_maps.update_many({"game_id": GAME_ID, "modes": "suchen"}, {"$pull": {"modes": "suchen"}})


async def sync(flow, season_id: str) -> dict:
    synced = await flow.post(f"/api/admin/leagues/seasons/{season_id}/sync")
    assert synced.status_code == 200, synced.text
    return synced.json()


def reasons(synced: dict) -> str:
    return " ".join(item["reason"] for row in synced["staffeln"] for item in row["skipped"])


def body_with(w, picks, lineup=None) -> dict:
    base = two_nil(w, lineup=lineup)
    return {**base, "games": [{**base["games"][index], "mode": mode, "map_id": map_id} for index, (mode, map_id) in enumerate(picks)]}


async def staffel_order(flow, w) -> list[str]:
    return (await flow.db.tournaments.find_one({"id": w["tournament"]["id"]}, {"_id": 0, "game_mode_order": 1}))["game_mode_order"]


async def assert_reports_with_the_new_pool(flow, w) -> None:
    """Die Staffel behält ihre alte Reihenfolge; ihr Pool hat nur noch Stellung: Beide Seiten melden und bestätigen."""
    captain = w["users"]["Kapitaen"]
    flow.act_as(captain)
    page = (await flow.get(f"/api/matches/{w['match']['id']}/page")).json()
    assert page["league"]["mode_order"] == [], "die Reihenfolge gilt nicht mehr, Web und Prüfung lesen denselben Wert"
    picks = [("stellung", "map-hafen"), ("stellung", "map-nebel")]
    reported = await flow.post(f"/api/matches/{w['match']['id']}/report", json=body_with(w, picks, ids(w, "Kapitaen", "Mila")))
    assert reported.status_code == 200, reported.text
    flow.act_as(w["users"]["Falke1"])
    confirmed = await flow.post(f"/api/matches/{w['match']['id']}/report", json=body_with(w, picks, ids(w, "Falke1", "Falke2")))
    assert confirmed.status_code == 200, confirmed.text
    done = await flow.db.matches_v2.find_one({"id": w["match"]["id"]}, {"_id": 0})
    assert [game["map_id"] for game in done["games"]] == ["map-hafen", "map-nebel"]


@pytest.mark.asyncio
@pytest.mark.parametrize("order_after", [["stellung"], []])
async def test_mode_removed_order_changed_pool_saved_and_transferred(flow, order_after):
    w = await world(flow)
    season_id = await real_season(flow, w)
    await remove_suchen(flow)
    patched = await flow.patch(f"/api/admin/leagues/seasons/{season_id}", json={"game_mode_order": order_after})
    assert patched.status_code == 200, patched.text
    saved = await flow.put(f"/api/admin/leagues/seasons/{season_id}/map-pool", json=ONLY_STELLUNG)
    assert saved.status_code == 200, saved.text

    synced = await sync(flow, season_id)

    assert await staffel_order(flow, w) == ["stellung", "suchen"], "nach dem ersten Ergebnis geht die Reihenfolge nicht über"
    assert HINT in reasons(synced), "das Übertragen sagt es"
    await assert_reports_with_the_new_pool(flow, w)


@pytest.mark.asyncio
async def test_the_season_refuses_a_pool_without_a_mode_of_its_order(flow):
    w = await world(flow)
    season_id = await real_season(flow, w)

    still_known = await flow.put(f"/api/admin/leagues/seasons/{season_id}/map-pool", json=ONLY_STELLUNG)

    assert still_known.status_code == 422
    assert "„Suchen & Zerstören“" in still_known.json()["detail"]
    assert "„Modus je Map“ zuerst ändern" in still_known.json()["detail"]
    assert await flow.db.map_pools.count_documents({"scope": "league_season", "scope_id": season_id}) == 0
    # Eine Gruppe ohne Maps zählt nicht als Modus im Pool.
    empty_group = await flow.put(f"/api/admin/leagues/seasons/{season_id}/map-pool", json={
        "modes": [*ONLY_STELLUNG["modes"], {"mode": "suchen", "map_ids": []}]})
    assert empty_group.status_code == 422
    # Schon dem Spiel entfernt: dieselbe Antwort, nie eine rohe Kennung.
    await remove_suchen(flow)
    removed = await flow.put(f"/api/admin/leagues/seasons/{season_id}/map-pool", json=ONLY_STELLUNG)
    assert removed.status_code == 422 and "suchen" not in removed.json()["detail"]
    assert "„Modus je Map“ zuerst ändern" in removed.json()["detail"]


@pytest.mark.asyncio
async def test_an_old_pool_that_already_lacks_the_mode_still_lets_everyone_report(flow):
    """Altbestand: Pool ohne „Suchen“, die Reihenfolge nennt ihn noch - am Server vorbei entstanden oder von vor der Prüfung."""
    w = await world(flow)
    season_id = await real_season(flow, w)
    await remove_suchen(flow)
    await flow.db.map_pools.insert_one({
        "id": new_id(), "scope": "league_season", "scope_id": season_id, "version": 1, "game_id": GAME_ID, "cleared": False, "created_at": now_utc().isoformat(),
        "modes": [{"mode": "stellung", "label": "Stellung", "maps": [{"map_id": "map-hafen", "slug": "hafen", "name": "Hafen", "image_url": None},
                                                                     {"map_id": "map-nebel", "slug": "nebel", "name": "Nebel", "image_url": None}]}]})

    synced = await sync(flow, season_id)

    assert HINT in reasons(synced)
    await assert_reports_with_the_new_pool(flow, w)


@pytest.mark.asyncio
async def test_the_last_archived_map_of_a_mode_takes_the_same_way(flow):
    w = await world(flow)
    season_id = await real_season(flow, w, order=("stellung", "suchen"))
    for map_id in ("map-turm", "map-nebel"):
        archived = await flow.patch(f"/api/games/{GAME_ID}/maps/{map_id}", json={"status": "archived"})
        assert archived.status_code == 200, archived.text
    only_hafen = {"modes": [{"mode": "stellung", "map_ids": ["map-hafen"]}]}
    refused = await flow.put(f"/api/admin/leagues/seasons/{season_id}/map-pool", json=only_hafen)
    assert refused.status_code == 422

    assert (await flow.patch(f"/api/admin/leagues/seasons/{season_id}", json={"game_mode_order": []})).status_code == 200
    assert (await flow.put(f"/api/admin/leagues/seasons/{season_id}/map-pool", json=only_hafen)).status_code == 200
    await sync(flow, season_id)

    flow.act_as(w["users"]["Kapitaen"])
    second_map = body_with(w, [("stellung", "map-hafen"), ("suchen", "map-turm")], ids(w, "Kapitaen", "Mila"))
    answer = await flow.post(f"/api/matches/{w['match']['id']}/report", json=second_map)
    assert answer.status_code == 422, "was nicht im Pool steht, bleibt abgelehnt"
    assert "Modus aus dem Pool" in answer.json()["detail"]


@pytest.mark.asyncio
async def test_a_held_pool_keeps_its_order(flow):
    """Das Spiel hält den alten Pool fest: Es meldet weiter nach der alten Reihenfolge, Map 2 ist „Suchen“."""
    w = await world(flow)
    held = await flow.db.map_pools.find_one({"scope": "tournament", "scope_id": w["tournament"]["id"]}, {"_id": 0, "id": 1})
    await flow.db.matches_v2.update_one({"id": w["match"]["id"]}, {"$set": {"map_pool_id": held["id"]}})
    season_id = await real_season(flow, w)
    await remove_suchen(flow)
    await flow.patch(f"/api/admin/leagues/seasons/{season_id}", json={"game_mode_order": []})
    await flow.put(f"/api/admin/leagues/seasons/{season_id}/map-pool", json=ONLY_STELLUNG)
    await sync(flow, season_id)

    flow.act_as(w["users"]["Kapitaen"])
    page = (await flow.get(f"/api/matches/{w['match']['id']}/page")).json()
    assert page["league"]["mode_order"] == ["stellung", "suchen"]
    lineup = ids(w, "Kapitaen", "Mila")
    wrong = await flow.post(f"/api/matches/{w['match']['id']}/report", json=body_with(w, [("stellung", "map-hafen"), ("stellung", "map-nebel")], lineup))
    assert wrong.status_code == 422 and "gespielt wird hier" in wrong.json()["detail"]
    right = await flow.post(f"/api/matches/{w['match']['id']}/report", json=body_with(w, [("stellung", "map-hafen"), ("suchen", "map-turm")], lineup))
    assert right.status_code == 200, right.text


@pytest.mark.asyncio
async def test_the_tournament_lead_enters_the_result_with_the_same_rule(flow):
    w = await world(flow)
    season_id = await real_season(flow, w)
    await remove_suchen(flow)
    await flow.patch(f"/api/admin/leagues/seasons/{season_id}", json={"game_mode_order": ["stellung"]})
    await flow.put(f"/api/admin/leagues/seasons/{season_id}/map-pool", json=ONLY_STELLUNG)
    await sync(flow, season_id)

    flow.act_as(w["staff"])
    page = (await flow.get(f"/api/matches/{w['match']['id']}/page")).json()
    assert page["league"]["mode_order"] == []
    entered = await flow.post(f"/api/matches/{w['match']['id']}/result", json=body_with(w, [("stellung", "map-hafen"), ("stellung", "map-nebel")]))
    assert entered.status_code == 200, entered.text


@pytest.mark.asyncio
async def test_before_the_first_result_order_and_pool_travel_together_without_a_hint(flow):
    w = await world(flow)
    season_id = await real_season(flow, w, with_result=False)
    await remove_suchen(flow)
    await flow.patch(f"/api/admin/leagues/seasons/{season_id}", json={"game_mode_order": ["stellung"]})
    await flow.put(f"/api/admin/leagues/seasons/{season_id}/map-pool", json=ONLY_STELLUNG)

    synced = await sync(flow, season_id)

    assert await staffel_order(flow, w) == ["stellung"]
    assert HINT not in reasons(synced)
    flow.act_as(w["users"]["Kapitaen"])
    page = (await flow.get(f"/api/matches/{w['match']['id']}/page")).json()
    assert page["league"]["mode_order"] == ["stellung"]
    answer = await flow.post(f"/api/matches/{w['match']['id']}/report", json=body_with(w, [("stellung", "map-hafen"), ("stellung", "map-nebel")], ids(w, "Kapitaen", "Mila")))
    assert answer.status_code == 200, answer.text


@pytest.mark.asyncio
async def test_a_matching_pool_stays_as_strict_as_before(flow):
    """Passt der Pool zur Reihenfolge, ändert sich nichts: Map 2 muss „Suchen“ sein, sonst 422."""
    w = await world(flow)
    await real_season(flow, w)
    flow.act_as(w["users"]["Kapitaen"])
    answer = await flow.post(f"/api/matches/{w['match']['id']}/report", json=body_with(w, [("stellung", "map-hafen"), ("stellung", "map-nebel")], ids(w, "Kapitaen", "Mila")))
    assert answer.status_code == 422 and "gespielt wird hier" in answer.json()["detail"]
