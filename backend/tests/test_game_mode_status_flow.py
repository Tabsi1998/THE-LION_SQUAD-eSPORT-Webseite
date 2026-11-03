"""Spielmodi mit Zustand und Ergebnisregel (#2206, C.1) - durch die echten Routen. Vertrag in docs/LIGA.md.

Alte Spiele ohne neue Felder bleiben Zeichen für Zeichen gleich. Ein verwendeter Modus lässt sich nur deaktivieren oder
archivieren, nicht entfernen - auch direkt über die API. Die Kennung bleibt beim Umbenennen. Inaktiv heißt: für Neues
nicht mehr wählbar, alles Bestehende (Pool, Reihenfolge, Spiele, Dauer) bleibt. Erfundene Namen und Werte.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_match_world import GAME_ID, ids, two_nil, world  # noqa: E402
from models import new_id, now_utc  # noqa: E402
from services import match_duration  # noqa: E402

MODES = [{"mode": "stellung", "label": "Stellung", "minutes": 12, "per_game": False},
         {"mode": "suchen", "label": "Suchen & Zerstören", "minutes": None, "per_game": False}]
RULE = {"kind": "rounds", "target": 4, "round_limit": 7, "time_limit_minutes": 2, "draw_allowed": False, "overtime": True}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def as_admin(flow) -> dict:
    admin = await flow.add_user(role="superadmin", name="Leitung")
    flow.act_as(admin)
    return admin


async def new_game(flow, modes=None) -> dict:
    created = await flow.post("/api/games", json={"name": f"Probe Shooter {new_id()[:6]}", "match_modes": modes if modes is not None else MODES})
    assert created.status_code == 200, created.text
    return created.json()


async def stored_modes(flow, game: dict) -> list:
    return (await flow.db.games.find_one({"id": game["id"]}, {"_id": 0, "match_modes": 1}))["match_modes"]


async def patch_modes(flow, game: dict, modes):
    return await flow.patch(f"/api/games/{game['id']}", json={"match_modes": modes})


def with_status(status: str, key: str = "suchen") -> list:
    return [{**mode, "status": status} if mode["mode"] == key else mode for mode in MODES]


# ---------------------------------------------------------------- Felder und alte Spiele


@pytest.mark.asyncio
async def test_an_old_game_stays_unchanged_when_saved_without_new_fields(flow):
    await as_admin(flow)
    old = [{"mode": "stellung", "label": "Stellung", "minutes": 12, "per_game": False}]
    now = now_utc().isoformat()
    await flow.db.games.insert_one({"id": "alt", "name": "Altspiel", "slug": "altspiel", "kind": "standalone", "match_modes": old,
                                    "created_at": now, "updated_at": now})

    other = await flow.patch("/api/games/alt", json={"short_name": "AS"})
    assert other.status_code == 200, other.text
    assert await stored_modes(flow, {"id": "alt"}) == old
    again = await patch_modes(flow, {"id": "alt"}, [{**old[0], "status": "active"}])
    assert again.status_code == 200, again.text
    assert await stored_modes(flow, {"id": "alt"}) == old, "„aktiv“ wird nicht geschrieben, keine leeren Felder dazu"


@pytest.mark.asyncio
async def test_new_fields_are_saved_and_read_back(flow):
    await as_admin(flow)
    game = await new_game(flow)
    modes = [{**MODES[0], "status": "inactive", "description": "  Zwei Zonen wechseln.  ", "players_per_side": 4,
              "format": " Standard   Regeln ", "result_rule": RULE}, MODES[1]]

    saved = await patch_modes(flow, game, modes)

    assert saved.status_code == 200, saved.text
    first = (await stored_modes(flow, game))[0]
    assert first == {"mode": "stellung", "label": "Stellung", "minutes": 12, "per_game": False, "status": "inactive",
                     "description": "Zwei Zonen wechseln.", "players_per_side": 4, "format": "Standard Regeln", "result_rule": RULE}
    listed = {row["id"]: row for row in (await flow.get("/api/games")).json()}
    assert listed[game["id"]]["match_modes"][0]["result_rule"] == RULE
    assert [mode["mode"] for mode in listed[game["id"]]["match_modes"]] == ["stellung", "suchen"], "inaktive bleiben in der Antwort"


@pytest.mark.asyncio
@pytest.mark.parametrize("rule, words", [
    ({"kind": "score"}, "Ziel angeben"),
    ({"kind": "highest", "target": 100}, "kein Ziel"),
    ({"kind": "score", "target": 100, "round_limit": 3}, "nur bei der Art"),
    ({"kind": "rounds", "target": 6, "round_limit": 5}, "kleiner als das Ziel"),
    ({"kind": "anders", "target": 1}, ""),
    ({"kind": "score", "target": 0}, ""),
])
async def test_a_rule_that_does_not_fit_is_refused(flow, rule, words):
    await as_admin(flow)
    game = await new_game(flow)
    refused = await patch_modes(flow, game, [{**MODES[0], "result_rule": rule}])
    assert refused.status_code == 422
    assert words in refused.text
    assert await stored_modes(flow, game) == MODES


@pytest.mark.asyncio
async def test_limits_of_description_format_players_and_status(flow):
    await as_admin(flow)
    game = await new_game(flow)
    for extra in ({"description": "x" * 501}, {"format": "x" * 61}, {"players_per_side": 0}, {"players_per_side": 65},
                  {"status": "weg"}):
        assert (await patch_modes(flow, game, [{**MODES[0], **extra}])).status_code == 422, extra


# ---------------------------------------------------------------- Entfernen nur unbenutzt


async def used_by(flow, game: dict, kind: str) -> None:
    """Den Modus „suchen“ auf genau eine Art verwenden."""
    if kind == "pool":
        hafen = (await flow.post(f"/api/games/{game['id']}/maps", json={"name": "Hafen", "modes": ["suchen"]})).json()
        tournament = await flow.create_tournament(game_id=game["id"])
        saved = await flow.put(f"/api/map-pools/tournaments/{tournament['id']}", json={"modes": [{"mode": "suchen", "map_ids": [hafen["id"]]}]})
        assert saved.status_code == 200, saved.text
        # Eine neue Version ohne den Modus: die alte Version hält ihn weiter fest (ein Spiel kann sie festhalten).
        await flow.put(f"/api/map-pools/tournaments/{tournament['id']}", json={"modes": [{"mode": "stellung", "map_ids": []}, {"mode": "suchen", "map_ids": [hafen["id"]]}]})
    elif kind == "season":
        league = (await flow.post("/api/admin/leagues", json={"name": f"Probe Liga {new_id()[:4]}", "game_id": game["id"]})).json()
        await flow.db.league_seasons.insert_one({"id": new_id(), "league_id": league["id"], "game_mode_order": ["stellung", "suchen"]})
    elif kind == "staffel":
        await flow.create_tournament(game_id=game["id"], game_mode_order=["suchen"])
    elif kind == "tournament":
        await flow.create_tournament(game_id=game["id"], game_mode="suchen")
    elif kind == "stage":
        tournament = await flow.create_tournament(game_id=game["id"])
        await flow.db.tournament_stages.insert_one({"id": new_id(), "tournament_id": tournament["id"], "settings": {"game_mode": "suchen"}})
    elif kind in ("match", "report", "held"):
        tournament = await flow.create_tournament(game_id=game["id"])
        games = [{"position": 1, "mode": "suchen", "map_id": "m1"}]
        field = {"match": {"games": games}, "report": {"reports": [{"registration_id": "r1", "games": games}]},
                 "held": {"pending_result": {"games": games}}}[kind]
        await flow.db.matches_v2.insert_one({"id": new_id(), "tournament_id": tournament["id"], **field})
    elif kind in ("sheet", "draft", "revision"):
        lineage = {"id": new_id(), "game_id": game["id"]}
        await flow.db.reference_lineages.insert_one(lineage)
        series = {"id": new_id(), "lineage_id": lineage["id"]}
        await flow.db.reference_series.insert_one(series)
        content = {"matches": [{"home": "A", "away": "B", "maps": [{"map_id": "m1", "mode": "suchen"}]}]}
        if kind == "revision":
            await flow.db.reference_round_result_revisions.insert_one({"id": new_id(), "series_id": series["id"], "content": content})
        else:
            sheet = content if kind == "sheet" else {"matches": [], "pending_draft": content}
            await flow.db.reference_round_results.insert_one({"id": new_id(), "series_id": series["id"], "round_id": new_id(), **sheet})
    else:  # pragma: no cover
        raise AssertionError(kind)


USES = ["pool", "season", "staffel", "tournament", "stage", "match", "report", "held", "sheet", "draft", "revision"]


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", USES)
async def test_a_used_mode_cannot_be_removed_only_deactivated(flow, kind):
    await as_admin(flow)
    game = await new_game(flow)
    await used_by(flow, game, kind)

    refused = await patch_modes(flow, game, MODES[:1])
    assert refused.status_code == 409, refused.text
    assert "Suchen & Zerstören" in refused.json()["detail"] and "inaktiv" in refused.json()["detail"]
    assert await stored_modes(flow, game) == MODES, "nichts geschrieben"
    assert (await flow.put(f"/api/games/{game['id']}", json={"match_modes": MODES[:1]})).status_code == 409, "auch über PUT"
    assert (await patch_modes(flow, game, None)).status_code == 409, "auch beim Leeren aller Modi"

    usage = (await flow.get(f"/api/games/{game['id']}/usage")).json()["modes"]
    assert usage["suchen"]["in_use"] is True
    assert usage["stellung"]["in_use"] is (kind == "season"), "leere Gruppen eines Pools zählen nicht"

    for status in ("inactive", "archived"):
        changed = await patch_modes(flow, game, with_status(status))
        assert changed.status_code == 200, changed.text
        assert (await stored_modes(flow, game))[1]["status"] == status


@pytest.mark.asyncio
async def test_a_mode_of_another_game_with_the_same_key_does_not_count(flow):
    await as_admin(flow)
    game = await new_game(flow)
    other = await new_game(flow)
    await used_by(flow, other, "tournament")
    await used_by(flow, other, "match")

    removed = await patch_modes(flow, game, MODES[:1])
    assert removed.status_code == 200, removed.text


@pytest.mark.asyncio
async def test_an_unused_mode_with_maps_is_removed_and_cleaned_as_before(flow):
    await as_admin(flow)
    game = await new_game(flow)
    await flow.post(f"/api/games/{game['id']}/maps", json={"name": "Hafen", "modes": ["stellung", "suchen"]})
    # Der Standard-Pool ist nur eine Vorlage des Spiels und hält keinen Modus fest.
    hafen = (await flow.get(f"/api/games/{game['id']}/maps")).json()["maps"][0]
    assert (await flow.put(f"/api/games/{game['id']}/default-pool", json={"modes": [{"mode": "suchen", "map_ids": [hafen["id"]]}]})).status_code == 200

    removed = await patch_modes(flow, game, MODES[:1])

    assert removed.status_code == 200, removed.text
    assert removed.json()["maps_cleaned"] == 1
    assert (await flow.get(f"/api/games/{game['id']}/usage")).json()["modes"]["stellung"]["in_use"] is False


# ---------------------------------------------------------------- Kennung bleibt


@pytest.mark.asyncio
async def test_renaming_keeps_the_key_also_through_the_api(flow):
    await as_admin(flow)
    game = await new_game(flow)
    await used_by(flow, game, "season")

    renamed = await patch_modes(flow, game, [{**MODES[0], "label": "Zonen"}, MODES[1]])
    assert renamed.status_code == 200, renamed.text
    assert [mode["mode"] for mode in await stored_modes(flow, game)] == ["stellung", "suchen"]

    # Nur Namen, ohne Kennung: gleiche Namen behalten ihre Kennung, auch nach einem früheren Umbenennen.
    names_only = await patch_modes(flow, game, [{"label": "zonen", "minutes": 12}, {"label": "Suchen & Zerstören"}])
    assert names_only.status_code == 200, names_only.text
    assert [(mode["mode"], mode["label"]) for mode in await stored_modes(flow, game)] == [("stellung", "zonen"), ("suchen", "Suchen & Zerstören")]

    # Ein neuer Name ohne Kennung wäre ein neuer Modus - der alte, verwendete fiele weg: 409.
    refused = await patch_modes(flow, game, [{"label": "Ganz neu"}, {"label": "Suchen & Zerstören"}])
    assert refused.status_code == 409
    # Eine andere Kennung für einen verwendeten Modus gibt es nicht.
    assert (await patch_modes(flow, game, [{"mode": "neu", "label": "zonen"}, MODES[1]])).status_code == 409


@pytest.mark.asyncio
async def test_two_entries_on_one_key_are_refused(flow):
    await as_admin(flow)
    game = await new_game(flow)
    await patch_modes(flow, game, [{**MODES[0], "label": "Zonen"}, MODES[1]])
    # „Zonen“ bekommt die Kennung „stellung“, ein neuer Modus „Stellung“ hieße genauso.
    refused = await patch_modes(flow, game, [{"label": "Zonen"}, {"label": "Stellung"}, MODES[1]])
    assert refused.status_code == 422
    assert "eigenen Namen" in refused.text


# ---------------------------------------------------------------- Inaktiv: nicht mehr neu wählbar


@pytest.mark.asyncio
async def test_inactive_modes_do_not_go_into_new_pools_but_keep_existing_ones(flow):
    await as_admin(flow)
    game = await new_game(flow)
    hafen = (await flow.post(f"/api/games/{game['id']}/maps", json={"name": "Hafen", "modes": ["stellung", "suchen"]})).json()
    kept = await flow.create_tournament(game_id=game["id"])
    url = f"/api/map-pools/tournaments/{kept['id']}"
    assert (await flow.put(url, json={"modes": [{"mode": "suchen", "map_ids": [hafen["id"]]}]})).status_code == 200
    assert (await patch_modes(flow, game, with_status("inactive"))).status_code == 200

    fresh = await flow.create_tournament(game_id=game["id"])
    refused = await flow.put(f"/api/map-pools/tournaments/{fresh['id']}", json={"modes": [{"mode": "suchen", "map_ids": [hafen["id"]]}]})
    assert refused.status_code == 422
    assert "inaktiv" in refused.json()["detail"]
    empty_group = await flow.put(f"/api/map-pools/tournaments/{fresh['id']}",
                                 json={"modes": [{"mode": "stellung", "map_ids": [hafen["id"]]}, {"mode": "suchen", "map_ids": []}]})
    assert empty_group.status_code == 200, "eine leere Gruppe stört nicht"

    again = await flow.put(url, json={"modes": [{"mode": "stellung", "map_ids": [hafen["id"]]}, {"mode": "suchen", "map_ids": [hafen["id"]]}]})
    assert again.status_code == 200, "was der Pool schon hat, hält das Speichern nicht auf"
    admin = (await flow.get(f"{url}/admin")).json()
    assert {mode["mode"]: mode["status"] for mode in admin["game"]["modes"]} == {"stellung": "active", "suchen": "inactive"}


@pytest.mark.asyncio
async def test_inactive_modes_are_not_chosen_anew_for_a_season_order(flow):
    await as_admin(flow)
    game = await new_game(flow)
    league = (await flow.post("/api/admin/leagues", json={"name": "Probe Liga", "game_id": game["id"]})).json()
    season = (await flow.post(f"/api/admin/leagues/{league['id']}/seasons",
                              json={"name": "Season 1", "start_date": "2030-01-07T18:00:00+00:00", "game_mode_order": ["suchen"]})).json()
    assert (await patch_modes(flow, game, with_status("archived"))).status_code == 200
    url = f"/api/admin/leagues/seasons/{season['id']}"

    assert (await flow.patch(url, json={"name": "Season Eins", "game_mode_order": ["suchen"]})).status_code == 200
    moved = await flow.patch(url, json={"game_mode_order": ["stellung", "suchen", "suchen"]})
    assert moved.status_code == 200, "dieselbe Kennung an anderer Stelle ist nichts Neues"
    other = (await flow.post(f"/api/admin/leagues/{league['id']}/seasons",
                             json={"name": "Season 2", "start_date": "2031-01-06T18:00:00+00:00", "game_mode_order": ["suchen"]}))
    assert other.status_code == 422
    assert "archiviert" in other.text


@pytest.mark.asyncio
async def test_inactive_modes_are_not_chosen_anew_for_a_tournament(flow):
    await as_admin(flow)
    game = await new_game(flow, [*MODES, {"mode": "kontrolle", "label": "Kontrolle"}])
    await patch_modes(flow, game, [*with_status("inactive"), {"mode": "kontrolle", "label": "Kontrolle"}])
    body = {"title": "Probe Cup", "game_id": game["id"], "format": "single_elim", "team_mode": "solo", "team_size": 1}

    refused = await flow.post("/api/tournaments", json={**body, "game_mode": "suchen"})
    assert refused.status_code == 422, refused.text
    created = await flow.post("/api/tournaments", json={**body, "title": "Probe Cup 2", "game_mode": "stellung"})
    assert created.status_code == 200, created.text

    tournament = await flow.create_tournament(game_id=game["id"], game_mode="suchen")
    kept = await flow.patch(f"/api/tournaments/{tournament['id']}", json={"game_mode": "suchen", "title": "Neu"})
    assert kept.status_code == 200, kept.text
    switched = await flow.patch(f"/api/tournaments/{created.json()['id']}", json={"game_mode": "suchen"})
    assert switched.status_code == 422
    assert (await flow.patch(f"/api/tournaments/{created.json()['id']}", json={"game_mode": "kontrolle"})).status_code == 200


@pytest.mark.asyncio
async def test_switching_the_game_does_not_carry_a_same_named_inactive_mode(flow):
    """Prüfung #2206: Der alte Schlüssel gilt nach einem Spielwechsel nicht als „schon gesetzt“ - auch ohne ``game_mode`` im
    Aufruf wird der übernommene Modus gegen das neue Spiel geprüft."""
    await as_admin(flow)
    first = await new_game(flow)
    second = await new_game(flow)
    await patch_modes(flow, second, with_status("inactive"))
    tournament = await flow.create_tournament(game_id=first["id"], game_mode="suchen")

    named = await flow.patch(f"/api/tournaments/{tournament['id']}", json={"game_id": second["id"], "game_mode": "suchen"})
    assert named.status_code == 422, named.text
    carried = await flow.patch(f"/api/tournaments/{tournament['id']}", json={"game_id": second["id"]})
    assert carried.status_code == 422, carried.text
    assert "inaktiv" in carried.json()["detail"]
    assert (await flow.db.tournaments.find_one({"id": tournament["id"]}))["game_id"] == first["id"]
    cleared = await flow.patch(f"/api/tournaments/{tournament['id']}", json={"game_id": second["id"], "game_mode": None})
    assert cleared.status_code == 200, cleared.text
    kept = await flow.patch(f"/api/tournaments/{tournament['id']}", json={"game_id": second["id"], "game_mode": "stellung", "title": "X"})
    assert kept.status_code == 200, kept.text


@pytest.mark.asyncio
async def test_a_stage_does_not_take_an_inactive_mode_anew(flow):
    await as_admin(flow)
    game = await new_game(flow)
    await patch_modes(flow, game, with_status("archived"))
    tournament = await flow.create_tournament(game_id=game["id"])
    url = f"/api/tournaments/{tournament['id']}/stages"
    stage = {"name": "Baum", "stage_type": "single_elimination", "match_type": "duel"}

    refused = await flow.post(url, json={**stage, "settings": {"game_mode": "suchen"}})
    assert refused.status_code == 422, refused.text
    assert "archiviert" in refused.json()["detail"]
    created = await flow.post(url, json={**stage, "settings": {"game_mode": "stellung"}})
    assert created.status_code == 200, created.text
    stage_id = created.json()["id"]
    assert (await flow.patch(f"{url}/{stage_id}", json={"settings": {"game_mode": "suchen"}})).status_code == 422
    # Schon gesetzt (Altbestand oder vor dem Archivieren): ein anderes Speichern hängt nicht daran.
    await flow.db.tournament_stages.update_one({"id": stage_id}, {"$set": {"settings": {"game_mode": "suchen"}}})
    kept = await flow.patch(f"{url}/{stage_id}", json={"name": "Finale", "settings": {"game_mode": "suchen", "best_of": 3}})
    assert kept.status_code == 200, kept.text


@pytest.mark.asyncio
async def test_archived_modes_are_not_assigned_anew_to_maps(flow):
    await as_admin(flow)
    game = await new_game(flow)
    hafen = (await flow.post(f"/api/games/{game['id']}/maps", json={"name": "Hafen", "modes": ["suchen"]})).json()
    await patch_modes(flow, game, with_status("archived"))

    refused = await flow.post(f"/api/games/{game['id']}/maps", json={"name": "Turm", "modes": ["suchen"]})
    assert refused.status_code == 422
    kept = await flow.patch(f"/api/games/{game['id']}/maps/{hafen['id']}", json={"name": "Hafen Neu", "modes": ["suchen", "stellung"]})
    assert kept.status_code == 200, kept.text
    assert (await flow.post(f"/api/games/{game['id']}/maps/assign-modes", json={"modes": ["suchen"]})).status_code == 422
    listing = (await flow.get(f"/api/games/{game['id']}/maps")).json()
    assert [mode["status"] for mode in listing["game"]["modes"]] == ["active", "archived"]

    await patch_modes(flow, game, with_status("inactive"))
    inactive_ok = await flow.post(f"/api/games/{game['id']}/maps", json={"name": "Turm", "modes": ["suchen"]})
    assert inactive_ok.status_code == 200, "an Maps darf ein inaktiver Modus - nur Pools, Reihenfolgen und Turniere sperren ihn"


def test_the_duration_ignores_the_status():
    """Dauerplanung bleibt: der erste Modus gilt weiter, auch wenn er inaktiv ist."""
    game = {"match_modes": [{**MODES[0], "status": "archived"}, {"mode": "suchen", "label": "S", "minutes": 4, "per_game": True}]}
    assert match_duration.game_duration(game) == 12
    assert match_duration.game_duration(game, tournament={"game_mode": "suchen", "best_of": 3}) == 10


# ---------------------------------------------------------------- Laufende Liga bleibt


@pytest.mark.asyncio
async def test_an_inactive_mode_still_reports_from_the_pool_of_a_running_match(flow):
    w = await world(flow)
    now = now_utc().isoformat()
    await flow.db.games.insert_one({"id": GAME_ID, "name": "Probe Shooter", "slug": GAME_ID, "kind": "standalone",
                                    "match_modes": [{"mode": "stellung", "label": "Stellung"}, {"mode": "suchen", "label": "Suchen & Zerstören"}],
                                    "created_at": now, "updated_at": now})
    await as_admin(flow)
    archived = await patch_modes(flow, {"id": GAME_ID}, [{"mode": "stellung", "label": "Stellung"},
                                                         {"mode": "suchen", "label": "Suchen & Zerstören", "status": "archived"}])
    assert archived.status_code == 200, archived.text

    flow.act_as(w["users"]["Kapitaen"])
    reported = await flow.post(f"/api/matches/{w['match']['id']}/report", json=two_nil(w, lineup=ids(w, "Kapitaen", "Mila")))
    assert reported.status_code == 200, reported.text
    flow.act_as(w["users"]["Falke1"])
    confirmed = await flow.post(f"/api/matches/{w['match']['id']}/report", json=two_nil(w, lineup=ids(w, "Falke1", "Falke2"), side="reg_h"))
    assert confirmed.status_code == 200, confirmed.text
    done = await flow.db.matches_v2.find_one({"id": w["match"]["id"]}, {"_id": 0})
    assert [(game["mode"], game["mode_label"]) for game in done["games"]] == [("stellung", "Stellung"), ("suchen", "Suchen & Zerstören")]

    flow.act_as(await flow.add_user(role="superadmin", name="Leitung 2"))
    assert (await patch_modes(flow, {"id": GAME_ID}, [{"mode": "stellung", "label": "Stellung"}])).status_code == 409
