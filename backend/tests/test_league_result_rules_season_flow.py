"""Ergebnisregeln an der Season (docs/LIGA.md, C.3, #1617): festgehaltene Kopie der Modus-Regeln, je Season abweichend, Punkte
Pflicht in neuen Seasons, Staffel trägt beides. Erfundene Namen und Werte."""

import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402

ADMIN = "/api/admin/leagues"
SCORE = {"kind": "score", "target": 250, "time_limit_seconds": 600, "draw_allowed": False, "overtime": False}
ROUNDS = {"kind": "rounds", "target": 6, "round_limit": 11, "draw_allowed": False, "overtime": False}
GAME = {"name": "Regel Shooter", "slug": "regel-shooter", "match_modes": [
    {"mode": "stellung", "label": "Stellung", "result_rule": SCORE},
    {"mode": "snd", "label": "Suchen & Zerstören", "result_rule": ROUNDS},
    {"mode": "frei", "label": "Frei"},
]}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def setup(flow):
    admin = await flow.add_staff()
    flow.act_as(admin)
    game = await flow.post("/api/games", json=GAME)
    assert game.status_code == 200, game.text
    league = (await flow.post(ADMIN, json={"name": "Regel-Liga", "game_id": game.json()["id"]})).json()
    season = await flow.post(f"{ADMIN}/{league['id']}/seasons", json={"start_date": "2026-11-10T00:00:00"})
    assert season.status_code == 200, season.text
    division = (await flow.post(f"{ADMIN}/seasons/{season.json()['id']}/divisions", json={})).json()
    return game.json(), season.json(), division


@pytest.mark.asyncio
async def test_a_new_season_keeps_a_copy_of_the_mode_rules_and_requires_scores(flow):
    game, season, _division = await setup(flow)

    assert season["result_rules"] == {"stellung": SCORE, "snd": ROUNDS}
    assert season["scores_required"] is True

    # Eine spätere Änderung am Modus ändert die Season nicht - die Verwaltung zeigt die Abweichung.
    modes = [{**GAME["match_modes"][0], "result_rule": {**SCORE, "target": 300}}, *GAME["match_modes"][1:]]
    changed = await flow.patch(f"/api/games/{game['id']}", json={"match_modes": modes})
    assert changed.status_code == 200, changed.text
    stored = await flow.db.league_seasons.find_one({"id": season["id"]}, {"_id": 0})
    assert stored["result_rules"]["stellung"]["target"] == 250

    overview = (await flow.get(f"{ADMIN}/seasons/{season['id']}/result-rules")).json()
    rows = {row["mode"]: row for row in overview["rules"]}
    assert overview["scores_required"] is True
    assert rows["stellung"]["differs"] is True and rows["stellung"]["game_rule"]["target"] == 300
    assert rows["snd"]["differs"] is False
    assert rows["frei"] == {"mode": "frei", "label": "Frei", "status": "active", "season_rule": None, "game_rule": None,
                            "differs": False, "season_settings": None, "game_settings": None, "settings_differ": False}


@pytest.mark.asyncio
async def test_the_season_deviates_per_mode_and_logs_it(flow):
    _game, season, _division = await setup(flow)
    url = f"{ADMIN}/seasons/{season['id']}/result-rules"

    saved = await flow.put(url, json={"scores_required": False, "rules": {
        "stellung": {"kind": "score", "target": 200}, "snd": None, "frei": {"kind": "highest"}}})

    assert saved.status_code == 200, saved.text
    stored = await flow.db.league_seasons.find_one({"id": season["id"]}, {"_id": 0})
    assert stored["scores_required"] is False
    assert stored["result_rules"] == {"stellung": {"kind": "score", "target": 200, "draw_allowed": False, "overtime": False},
                                      "frei": {"kind": "highest", "draw_allowed": False, "overtime": False}}
    log = await flow.db.audit_logs.find_one({"action": "league.season.result_rules"}, {"_id": 0})
    assert log["data"] == {"modes": ["frei", "snd", "stellung"], "scores_required": False}

    unknown = await flow.put(url, json={"scores_required": True, "rules": {"fremd": {"kind": "highest"}}})
    assert unknown.status_code == 422 and unknown.json()["detail"] == "Ergebnisregeln: Den Modus „fremd“ hat das Spiel nicht."
    bad = await flow.put(url, json={"scores_required": True, "rules": {"snd": {"kind": "rounds", "target": 6, "round_limit": 3}}})
    assert bad.status_code == 422
    assert bad.json()["detail"] == "Modus „Suchen & Zerstören“: Ergebnisregel: Das Rundenlimit (3) ist kleiner als das Ziel (6)."


@pytest.mark.asyncio
async def test_the_staffel_carries_the_rules_and_takes_changes_while_running(flow):
    _game, season, division = await setup(flow)
    created = (await flow.post(f"{ADMIN}/divisions/{division['id']}/staffeln", json={})).json()
    staffel = await flow.db.tournaments.find_one({"id": created["tournament_id"]}, {"_id": 0})
    assert staffel["result_rules"] == {"stellung": SCORE, "snd": ROUNDS} and staffel["scores_required"] is True

    # Nach dem ersten Ergebnis: die Regel gilt für neue Eingaben - das Übertragen nimmt sie trotzdem mit.
    await flow.db.matches_v2.insert_one({"id": new_id(), "tournament_id": staffel["id"], "status": "completed",
                                         "started_at": "2026-11-15T19:00:00+00:00",
                                         "results": [{"registration_id": "x", "rank": 1, "score": 2}]})
    saved = await flow.put(f"{ADMIN}/seasons/{season['id']}/result-rules",
                           json={"scores_required": False, "rules": {"stellung": SCORE}})
    assert saved.json()["staffeln_to_sync"] == 1
    synced = await flow.post(f"{ADMIN}/seasons/{season['id']}/sync")
    assert synced.status_code == 200, synced.text
    after = await flow.db.tournaments.find_one({"id": staffel["id"]}, {"_id": 0})
    assert after["result_rules"] == {"stellung": SCORE} and after["scores_required"] is False
    assert after["best_of"] == staffel["best_of"]


@pytest.mark.asyncio
async def test_an_older_season_without_the_fields_changes_nothing(flow):
    _game, season, division = await setup(flow)
    await flow.db.league_seasons.update_one({"id": season["id"]}, {"$unset": {"result_rules": "", "scores_required": "", "mode_settings": ""}})

    created = (await flow.post(f"{ADMIN}/divisions/{division['id']}/staffeln", json={})).json()
    staffel = await flow.db.tournaments.find_one({"id": created["tournament_id"]}, {"_id": 0})

    assert "result_rules" not in staffel and "scores_required" not in staffel and "mode_settings" not in staffel
    overview = (await flow.get(f"{ADMIN}/seasons/{season['id']}/result-rules")).json()
    assert overview["scores_required"] is False
    assert all(row["season_rule"] is None for row in overview["rules"])
