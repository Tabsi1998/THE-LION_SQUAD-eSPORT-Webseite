"""Teilnehmerliste einmal je Spiel (docs/LIGA.md, B.3, #2204): Maps, Modi und Endstände bleiben je Map Pflicht, wer gespielt hat, steht einmal
am Schluss. Mindestens drei, auch sechs und mehr. Das Ergebnis bleibt auch ohne Liste gültig. Erfundene Namen."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_match_world import duel, ids, staffel, two_nil  # noqa: E402
from models import now_utc  # noqa: E402
from services import league_games, match_deadline_sweep  # noqa: E402
from squad_world import make_squad, squad_registration  # noqa: E402
from test_league_eligibility_flow import born, rules  # noqa: E402
from test_league_roster_flow import id_world, page  # noqa: E402

HOME = ("Kapitaen", "Mila", "Tom")
AWAY = ("Falke1", "Falke2", "Falke3")


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def series_world(flow, *, minimum: int = 3) -> dict:
    w = await id_world(flow)
    await rules(flow, w, lineup_mode="series", lineup_min_players=minimum)
    await flow.db.tournaments.update_one({"id": w["tournament"]["id"]}, {"$set": {
        "lineup_mode": "series", "lineup_min_players": minimum, "team_size": 4, "min_squad_size": 3}})
    await flow.db.team_squads.update_one({"id": w["squad_a"]["id"]}, {"$addToSet": {"member_ids": w["users"]["Ida"]["id"]}})
    w["captain_a"], w["captain_h"] = w["users"]["Kapitaen"], w["users"]["Falke1"]
    return w


def report_body(w: dict, *names: str) -> dict:
    return {**two_nil(w), "lineup": ids(w, *names)}


async def report(flow, w: dict, *names: str):
    flow.act_as(w["captain_a"])
    return await flow.post(f"/api/matches/{w['match']['id']}/report", json=report_body(w, *names))


async def confirm(flow, w: dict, *names: str):
    flow.act_as(w["captain_h"])
    return await flow.post(f"/api/matches/{w['match']['id']}/report", json=report_body(w, *names))


async def confirm_from_the_app(flow, w: dict):
    flow.act_as(w["captain_h"])
    return await flow.post(f"/api/matches/{w['match']['id']}/report", json={"results": two_nil(w)["results"]})


async def stored(flow, w: dict) -> dict:
    return await flow.db.matches_v2.find_one({"id": w["match"]["id"]}, {"_id": 0})


async def amend(flow, w: dict, actor: dict, *names: str, **extra):
    flow.act_as(actor)
    return await flow.put(f"/api/matches/{w['match']['id']}/lineups", json={"lineup": ids(w, *names), **extra})


# ---------------------------------------------------------------- Melden und Bestätigen


@pytest.mark.asyncio
async def test_maps_stay_per_map_and_the_list_comes_once(flow):
    w = await series_world(flow)

    reported = await report(flow, w, *HOME)
    assert reported.status_code == 200, reported.text
    match = await stored(flow, w)
    own = match["reports"][-1]
    assert own["lineup"] == ids(w, *HOME)
    assert own["games"][0]["map_id"] == "map-hafen" and own["games"][0]["lineups"] == {}
    assert set(match["lineup_user_ids"]) == set(ids(w, *HOME))

    confirmed = await confirm(flow, w, *AWAY)
    assert confirmed.status_code == 200, confirmed.text
    match = await stored(flow, w)
    assert match["status"] == "completed"
    assert match["lineups"] == {w["reg_a"]["id"]: ids(w, *HOME), w["reg_h"]["id"]: ids(w, *AWAY)}
    assert match["lineups_missing"] == []
    assert [game["map_id"] for game in match["games"]] == ["map-hafen", "map-turm"], "je Map bleibt alles da"
    assert all(game["lineups"] == {} for game in match["games"]), "keine Eingabe je Map"
    assert set(match["lineup_user_ids"]) == set(ids(w, *HOME)) | set(ids(w, *AWAY))
    assert set(league_games.participants(match)) == set(ids(w, *HOME)) | set(ids(w, *AWAY))


@pytest.mark.asyncio
@pytest.mark.parametrize(("count", "code"), [(0, 422), (2, 422), (3, 200), (4, 200)])
async def test_at_least_the_minimum_and_open_upwards(flow, count, code):
    w = await series_world(flow)
    names = ("Kapitaen", "Mila", "Tom", "Ida")[:count]

    reported = await report(flow, w, *names)

    assert reported.status_code == code, reported.text
    if code == 422:
        assert "mindestens 3" in reported.json()["detail"]


@pytest.mark.asyncio
async def test_six_players_with_substitutions_are_allowed(flow):
    w = await series_world(flow)
    extra = [await flow.add_user(name=f"Wechsler{index}") for index in range(2)]
    for person in extra:
        w["users"][person["username"]] = person
        await flow.db.teams.update_one({"id": w["lions"]["id"]}, {"$addToSet": {"member_ids": person["id"]}})
        await flow.db.team_squads.update_one({"id": w["squad_a"]["id"]}, {"$addToSet": {"member_ids": person["id"]}})
        await flow.db.users.update_one({"id": person["id"]}, {"$set": {"game_ids": {"probe-hauptspiel": {"activision_id": f"Wechsler#{person['id'][:6]}"}}}})

    reported = await report(flow, w, "Kapitaen", "Mila", "Tom", "Ida", *[person["username"] for person in extra])

    assert reported.status_code == 200, reported.text
    assert len((await stored(flow, w))["reports"][-1]["lineup"]) == 6


@pytest.mark.asyncio
async def test_the_minimum_comes_from_the_season(flow):
    w = await series_world(flow, minimum=4)

    assert (await report(flow, w, *HOME)).status_code == 422
    assert (await report(flow, w, *HOME, "Ida")).status_code == 200


@pytest.mark.asyncio
async def test_only_the_roster_of_the_own_side(flow):
    w = await series_world(flow)

    foreign = await report(flow, w, "Kapitaen", "Mila", "Fremd")
    assert foreign.status_code == 422
    assert "Kader" in foreign.json()["detail"]
    twice = await report(flow, w, "Kapitaen", "Mila", "Mila")
    assert twice.status_code == 422


@pytest.mark.asyncio
async def test_never_on_both_sides_also_when_confirming_and_amending(flow):
    w = await series_world(flow)
    both = w["users"]["Mila"]
    await flow.db.team_squads.update_one({"id": w["horst"]["id"]}, {"$addToSet": {"member_ids": both["id"]}})
    await flow.db.teams.update_one({"id": w["falcons"]["id"]}, {"$addToSet": {"member_ids": both["id"]}})
    assert (await report(flow, w, *HOME)).status_code == 200

    refused = await confirm(flow, w, "Falke1", "Falke2", "Mila")
    assert refused.status_code == 422, refused.text
    assert "beiden Seiten" in refused.json()["detail"]

    assert (await confirm_from_the_app(flow, w)).status_code == 200
    late = await amend(flow, w, w["captain_h"], "Falke1", "Falke2", "Mila")
    assert late.status_code == 422, late.text
    assert "beiden Seiten" in late.json()["detail"]


@pytest.mark.asyncio
async def test_only_eligible_players_on_the_list(flow):
    w = await series_world(flow)
    await rules(flow, w, min_age=18)
    for name in w["users"]:
        await born(flow, w, name, "1990-01-01")
    await born(flow, w, "Tom", None)

    refused = await report(flow, w, *HOME)
    assert refused.status_code == 422
    assert "Tom" in refused.json()["detail"] and "Geburtsdatum fehlt" in refused.json()["detail"]

    await flow.db.league_rosters.update_one(
        {"season_id": w["season_id"], "user_id": w["users"]["Ida"]["id"]},
        {"$set": {f"wait_from.{w['squad_a']['id']}": now_utc().isoformat()}}, upsert=True)
    await rules(flow, w, new_player_wait_days=7)
    waiting = await report(flow, w, "Kapitaen", "Mila", "Ida")
    assert waiting.status_code == 422
    assert "darf ab" in waiting.json()["detail"]

    await flow.db.users.update_one({"id": w["users"]["Mila"]["id"]}, {"$set": {"is_banned": True}})
    banned = await report(flow, w, "Kapitaen", "Mila", "Tom")
    assert banned.status_code == 422


@pytest.mark.asyncio
async def test_a_list_counts_for_double_use_on_the_same_matchday(flow):
    w = await series_world(flow)
    rudel_c = await make_squad(flow, w["lions"], "Rudel C", [w["users"][name] for name in ("Mila", "Ida", "LoeLeitung")], game_id="probe-shooter")
    other = await staffel(flow, w["season_id"], "B", lineup_mode="series", lineup_min_players=3)
    reg_c = await squad_registration(flow, other, w["lions"], rudel_c)
    reg_x = await squad_registration(flow, other, w["falcons"], w["horst"])
    match_b = await duel(flow, other, reg_c, reg_x)
    assert (await report(flow, w, *HOME)).status_code == 200

    flow.act_as(w["users"]["LoeLeitung"])
    body = {"results": [{"registration_id": reg_c["id"], "rank": 1, "score": 2}, {"registration_id": reg_x["id"], "rank": 2, "score": 0}],
            "games": [{"position": 1, "mode": "stellung", "map_id": "map-hafen", "winner_registration_id": reg_c["id"]},
                      {"position": 2, "mode": "suchen", "map_id": "map-turm", "winner_registration_id": reg_c["id"]}],
            "lineup": ids(w, "Mila", "Ida", "LoeLeitung")}
    refused = await flow.post(f"/api/matches/{match_b['id']}/report", json=body)

    assert refused.status_code == 409, refused.text
    assert "an diesem Spieltag" in refused.json()["detail"]


# ---------------------------------------------------------------- App und Automatik


@pytest.mark.asyncio
async def test_the_app_confirms_without_maps_and_without_a_list(flow):
    w = await series_world(flow)
    assert (await report(flow, w, *HOME)).status_code == 200

    confirmed = await confirm_from_the_app(flow, w)

    assert confirmed.status_code == 200, confirmed.text
    match = await stored(flow, w)
    assert match["status"] == "completed", "das Ergebnis bleibt gültig"
    assert match["lineups"] == {w["reg_a"]["id"]: ids(w, *HOME)}
    assert match["lineups_missing"] == [w["reg_h"]["id"]]
    assert len(match["games"]) == 2
    note = await flow.db.notifications.find_one({"meta.reason": "lineup_missing", "user_id": w["captain_h"]["id"]}, {"_id": 0})
    assert note["title"] == "Teilnehmerliste fehlt noch"
    assert "Das Ergebnis gilt" in note["body"]


@pytest.mark.asyncio
async def test_a_first_report_from_the_app_is_still_refused(flow):
    w = await series_world(flow)
    flow.act_as(w["captain_a"])

    refused = await flow.post(f"/api/matches/{w['match']['id']}/report", json={"results": two_nil(w)["results"]})

    assert refused.status_code == 422
    assert "im Web" in refused.json()["detail"]


@pytest.mark.asyncio
async def test_the_automatic_confirmation_takes_the_list_of_the_report(flow):
    w = await series_world(flow)
    assert (await report(flow, w, *HOME)).status_code == 200
    match = await stored(flow, w)
    old = (now_utc() - timedelta(hours=72)).isoformat()
    match["reports"][-1]["at"] = old
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"reports": match["reports"]}})

    done = await match_deadline_sweep._auto_confirm(flow.db, w["tournament"], match["id"], None, now_utc() + timedelta(days=10))

    assert done == 1
    match = await stored(flow, w)
    assert match["status"] == "completed"
    assert match["lineups"] == {w["reg_a"]["id"]: ids(w, *HOME)}
    assert match["lineups_missing"] == [w["reg_h"]["id"]]


# ---------------------------------------------------------------- Nachtrag


async def confirmed_without_list(flow, w: dict) -> None:
    assert (await report(flow, w, *HOME)).status_code == 200
    assert (await confirm_from_the_app(flow, w)).status_code == 200


@pytest.mark.asyncio
@pytest.mark.parametrize("actor", ["Falke1", "vice"])
async def test_captain_or_vice_add_the_list_later(flow, actor):
    w = await series_world(flow)
    await flow.db.team_squads.update_one({"id": w["horst"]["id"]}, {"$set": {"vice_captain_id": w["users"]["Falke2"]["id"]}})
    await confirmed_without_list(flow, w)

    saved = await amend(flow, w, w["users"]["Falke1"] if actor == "Falke1" else w["users"]["Falke2"], *AWAY)

    assert saved.status_code == 200, saved.text
    match = await stored(flow, w)
    assert match["lineups"][w["reg_h"]["id"]] == ids(w, *AWAY)
    assert match["lineups_missing"] == []
    assert set(ids(w, *AWAY)) <= set(match["lineup_user_ids"])
    assert match["status"] == "completed"
    log = await flow.db.audit_logs.find_one({"action": "match.lineup.amend"}, {"_id": 0})
    assert log["data"]["registration_id"] == w["reg_h"]["id"]


@pytest.mark.asyncio
async def test_only_the_own_side_and_only_with_the_rules(flow):
    w = await series_world(flow)
    await confirmed_without_list(flow, w)

    assert (await amend(flow, w, w["users"]["Falke3"], *AWAY)).status_code == 403, "ein Spieler trägt nichts nach"
    too_few = await amend(flow, w, w["captain_h"], "Falke1", "Falke2")
    assert too_few.status_code == 422
    # Der Captain nennt nie eine fremde Seite - ohne Leitungsrecht bleibt es die eigene.
    own = await amend(flow, w, w["captain_h"], *AWAY, registration_id=w["reg_a"]["id"])
    assert own.status_code == 200, own.text
    match = await stored(flow, w)
    assert match["lineups"][w["reg_a"]["id"]] == ids(w, *HOME), "die Liste der anderen Seite bleibt"


@pytest.mark.asyncio
async def test_after_the_deadline_the_case_goes_to_the_league_office(flow):
    w = await series_world(flow)
    await confirmed_without_list(flow, w)
    past = (now_utc() - timedelta(hours=49)).isoformat()
    await flow.db.matches_v2.update_one({"id": w["match"]["id"]}, {"$set": {"completed_at": past}})

    late = await amend(flow, w, w["captain_h"], *AWAY)
    assert late.status_code == 409, late.text
    assert "Frist" in late.json()["detail"]

    await match_deadline_sweep.sweep(flow.db)
    await match_deadline_sweep.sweep(flow.db)

    match = await stored(flow, w)
    assert match["status"] == "completed", "das Ergebnis bleibt gültig"
    assert match["lineup_overdue_at"]
    rows = await flow.db.notifications.find({"meta.reason": "lineup_overdue"}, {"_id": 0}).to_list(50)
    assert w["staff"]["id"] in {row["user_id"] for row in rows}
    assert w["captain_h"]["id"] not in {row["user_id"] for row in rows}
    assert len([row for row in rows if row["user_id"] == w["staff"]["id"]]) == 1, "doppelter Lauf, eine Nachricht"
    assert await flow.db.audit_logs.count_documents({"action": "match.lineup.overdue"}) == 1

    flow.act_as(w["staff"])
    no_reason = await flow.put(f"/api/matches/{w['match']['id']}/lineups", json={"lineup": ids(w, *AWAY), "registration_id": w["reg_h"]["id"]})
    assert no_reason.status_code == 422
    done = await flow.put(f"/api/matches/{w['match']['id']}/lineups", json={"lineup": ids(w, *AWAY), "registration_id": w["reg_h"]["id"], "reason": "Screenshot aus dem Chat"})
    assert done.status_code == 200, done.text
    match = await stored(flow, w)
    assert match["lineups_missing"] == [] and "lineup_overdue_at" not in match


@pytest.mark.asyncio
async def test_the_sweep_leaves_open_deadlines_and_other_formats_alone(flow):
    w = await series_world(flow)
    await confirmed_without_list(flow, w)

    await match_deadline_sweep.sweep(flow.db)

    assert "lineup_overdue_at" not in await stored(flow, w)
    assert not await flow.db.notifications.find_one({"meta.reason": "lineup_overdue"})


# ---------------------------------------------------------------- Liga-Leitung


@pytest.mark.asyncio
async def test_staff_writes_both_lists_each_side_optional(flow):
    w = await series_world(flow)
    flow.act_as(w["staff"])

    saved = await flow.post(f"/api/matches/{w['match']['id']}/result", json={**two_nil(w), "lineups": {w["reg_a"]["id"]: ids(w, *HOME)}})

    assert saved.status_code == 200, saved.text
    match = await stored(flow, w)
    assert match["lineups"] == {w["reg_a"]["id"]: ids(w, *HOME)}
    assert match["lineups_missing"] == [w["reg_h"]["id"]]
    assert all(game["lineups"] == {} for game in match["games"])


@pytest.mark.asyncio
async def test_staff_hold_publishes_and_undo_takes_the_list_back(flow):
    w = await series_world(flow)
    flow.act_as(w["staff"])

    held = await flow.post(f"/api/matches/{w['match']['id']}/result", json={**two_nil(w), "hold": True, "lineups": {w["reg_a"]["id"]: ids(w, *HOME)}})
    assert held.status_code == 200, held.text
    match = await stored(flow, w)
    assert match["pending_result"]["lineups"] == {w["reg_a"]["id"]: ids(w, *HOME)}
    assert set(ids(w, *HOME)) <= set(match.get("lineup_user_ids") or set(ids(w, *HOME)))

    from services.result_hold import publish_due_holds
    assert await publish_due_holds(flow.db, now=now_utc() + timedelta(minutes=5), match_id=w["match"]["id"]) == 1
    match = await stored(flow, w)
    assert match["lineups"] == {w["reg_a"]["id"]: ids(w, *HOME)}

    undone = await flow.post(f"/api/matches/{w['match']['id']}/result/undo", json={})
    assert undone.status_code == 200, undone.text
    match = await stored(flow, w)
    assert "lineups" not in match and "lineup_user_ids" not in match


@pytest.mark.asyncio
async def test_a_forfeit_takes_the_list_away(flow):
    w = await series_world(flow)
    assert (await report(flow, w, *HOME)).status_code == 200
    assert (await confirm(flow, w, *AWAY)).status_code == 200
    from services.match_forfeit import apply_forfeit

    await apply_forfeit(flow.db, await stored(flow, w), w["reg_h"]["id"], note="Nicht angetreten", actor_id=w["staff"]["id"], force=True, reason="Nicht angetreten")

    match = await stored(flow, w)
    assert match["lineups"] == {} and match["games"] == []
    assert "lineup_user_ids" not in match


# ---------------------------------------------------------------- Sichtbarkeit


@pytest.mark.asyncio
async def test_lists_are_for_the_match_and_the_office_only(flow):
    w = await series_world(flow)
    assert (await report(flow, w, *HOME)).status_code == 200
    assert (await confirm(flow, w, *AWAY)).status_code == 200

    flow.act_as(w["captain_a"])
    own = await page(flow, w)
    assert own["league"]["lineup_mode"] == "series"
    assert own["league"]["lineup_min_players"] == 3
    assert {row["name"] for row in own["league"]["participants"][w["reg_a"]["id"]]} == set(HOME)
    assert [row["id"] for row in own["league"]["own_lineup"]] == ids(w, *HOME)

    flow.act_as(None)
    guest = await flow.get(f"/api/matches/{w['match']['id']}/page")
    assert guest.status_code == 200, guest.text
    assert "lineups" not in guest.json()["match"]
    assert guest.json()["league"]["participants"] == {}
    for user_id in ids(w, *HOME):
        assert user_id not in str(guest.json()["match"])
    plain = await flow.get(f"/api/matches/{w['match']['id']}")
    assert "lineups" not in plain.json()


@pytest.mark.asyncio
async def test_the_other_side_sees_no_eligibility_reason(flow):
    w = await series_world(flow)
    await rules(flow, w, min_age=18)
    for name in w["users"]:
        await born(flow, w, name, "1990-01-01")
    await born(flow, w, "Tom", None)

    flow.act_as(w["captain_h"])
    other = await page(flow, w)

    lobby = {row["registration_id"]: row for row in other["league"]["lobby_ids"]}[w["reg_a"]["id"]]
    tom = next(row for row in lobby["players"] if row["id"] == w["users"]["Tom"]["id"])
    assert tom["reason"] is None and tom["ok"] is True
    flow.act_as(w["captain_a"])
    own = await page(flow, w)
    blocked = next(row for row in own["league"]["roster"] if row["id"] == w["users"]["Tom"]["id"])
    assert "Geburtsdatum fehlt" in blocked["lineup_blocked"]


# ---------------------------------------------------------------- Altbestand


@pytest.mark.asyncio
async def test_a_staffel_without_the_field_stays_per_map(flow):
    w = await id_world(flow)
    flow.act_as(w["users"]["Kapitaen"])

    refused = await flow.post(f"/api/matches/{w['match']['id']}/report", json={**two_nil(w), "lineup": ids(w, *HOME)})

    assert refused.status_code == 422, "ohne Feld gilt weiter die Aufstellung je Map"
    assert "Aufstellung" in refused.json()["detail"]
    ok = await flow.post(f"/api/matches/{w['match']['id']}/report", json=two_nil(w, lineup=ids(w, "Kapitaen", "Mila")))
    assert ok.status_code == 200, ok.text
    assert "lineup" not in (await stored(flow, w))["reports"][-1]


@pytest.mark.asyncio
async def test_a_season_per_map_keeps_per_map_with_all_other_rules(flow):
    w = await id_world(flow)
    await rules(flow, w, lineup_mode="per_map", min_age=18)
    await flow.db.tournaments.update_one({"id": w["tournament"]["id"]}, {"$set": {"lineup_mode": "per_map"}})
    for name in w["users"]:
        await born(flow, w, name, "1990-01-01")
    await born(flow, w, "Mila", None)
    flow.act_as(w["users"]["Kapitaen"])

    refused = await flow.post(f"/api/matches/{w['match']['id']}/report", json=two_nil(w, lineup=ids(w, "Kapitaen", "Mila")))

    assert refused.status_code == 422
    assert "Geburtsdatum fehlt" in refused.json()["detail"]


@pytest.mark.asyncio
async def test_old_results_stay_readable_in_a_series_staffel(flow):
    w = await series_world(flow)
    body = two_nil(w)
    games = [{**game, "mode_label": None, "map_name": None, "map_image_url": None, "scores": game.get("scores") or {},
              "lineups": {w["reg_a"]["id"]: ids(w, "Kapitaen", "Mila")}} for game in body["games"]]
    await flow.db.matches_v2.update_one({"id": w["match"]["id"]}, {"$set": {
        "games": games, "status": "completed", "results": body["results"], "completed_at": now_utc().isoformat()}})

    flow.act_as(w["captain_a"])
    own = await page(flow, w)

    assert own["league"]["games"][0]["lineups"][w["reg_a"]["id"]][0]["name"] == "Kapitaen"
    assert set(league_games.participants(await stored(flow, w))) == set(ids(w, "Kapitaen", "Mila"))
