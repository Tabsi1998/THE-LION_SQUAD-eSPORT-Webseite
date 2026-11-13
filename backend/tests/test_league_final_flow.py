"""F.1 Saisonabschluss (#1645, docs/LIGA.md): Sperrgründe einzeln, der eingefrorene Endstand, Gleichstand auf Platz 1, Wiederöffnen
durch eine zweite Person, der Meister-Eintrag und gleichzeitiges Abschließen - über die echten Routen. Nur erfundene Namen.
"""
import asyncio
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from models import now_utc  # noqa: E402

ADMIN = "/api/admin/leagues"
STAFFELN = "/api/admin/leagues/staffeln"
PAGE = "/api/leagues/probe-shooter/season-1"
SEASON = {"start_date": "2026-01-05T00:00:00", "visibility": "public", "readiness_override_reason": "Testaufbau ohne Prüfung"}
LONG_AGO = (now_utc() - timedelta(days=90)).isoformat()


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def add_staffel(flow, division: dict, prefix: str, teams: int = 4) -> dict:
    created = (await flow.post(f"{ADMIN}/divisions/{division['id']}/staffeln", json={})).json()
    staffel = await flow.db.tournaments.find_one({"id": created["tournament_id"]}, {"_id": 0})
    for index in range(1, teams + 1):
        await flow.db.teams.insert_one({"id": f"{prefix}team-{index}", "name": f"Probe {prefix}{index}", "member_ids": [],
                                        "leader_id": f"{prefix}captain-{index}"})
        await flow.db.users.insert_one({"id": f"{prefix}captain-{index}", "username": f"{prefix}captain-{index}",
                                        "display_name": f"Captain {prefix}{index}", "role": "user", "is_active": True,
                                        "email": f"{prefix}captain-{index}@example.test"})
        await flow.db.tournament_registrations.insert_one({
            "id": f"{prefix}reg-{index}", "tournament_id": staffel["id"], "team_id": f"{prefix}team-{index}", "status": "approved",
            "registration_type": "team", "display_name": f"Probe {prefix}{index}",
            "identity_key": f"{staffel['id']}:team:{prefix}team-{index}"})
    started = await flow.post(f"/api/tournaments/{staffel['id']}/status", json={"status": "live"})
    assert started.status_code == 200, started.text
    return staffel


async def setup(flow, *, season: dict | None = None):
    admin = await flow.add_staff()
    flow.act_as(admin)
    game = (await flow.post("/api/games", json={"name": "Probe Shooter", "slug": "probe-shooter"})).json()
    league = (await flow.post(ADMIN, json={"name": "Probe-Liga", "game_id": game["id"]})).json()
    season_doc = (await flow.post(f"{ADMIN}/{league['id']}/seasons", json={**SEASON, **(season or {})})).json()
    division = (await flow.post(f"{ADMIN}/seasons/{season_doc['id']}/divisions", json={})).json()
    staffel = await add_staffel(flow, division, "")
    return admin, league, season_doc, division, staffel


async def matches_of(flow, staffel, round_number=None):
    query = {"tournament_id": staffel["id"], "is_preview": {"$ne": True}}
    if round_number is not None:
        query["round"] = round_number
    return await flow.db.matches_v2.find(query, {"_id": 0}).sort("order", 1).to_list(100)


async def result(flow, match, winner, *, score=(2, 0), at=LONG_AGO):
    loser = next(slot["registration_id"] for slot in match["slots"] if slot["registration_id"] != winner)
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {
        "status": "completed", "completed_at": at,
        "results": [{"registration_id": winner, "rank": 1, "score": score[0]}, {"registration_id": loser, "rank": 2, "score": score[1]}]}})


def stronger(match) -> str:
    """Das Team mit der kleineren Nummer gewinnt - so steht die Tabelle eindeutig: 1, 2, 3, 4."""
    return min((slot["registration_id"] for slot in match["slots"]), key=lambda value: int(value.rsplit("-", 1)[1]))


async def play_all(flow, staffel, *, skip: str | None = None):
    for match in await matches_of(flow, staffel):
        if match["id"] != skip:
            await result(flow, match, stronger(match))


async def bottom_match(flow, staffel) -> dict:
    """Das Spiel der beiden Letzten - bleibt es offen, steht oben trotzdem niemand gleich."""
    return next(match for match in await matches_of(flow, staffel) if {slot["registration_id"] for slot in match["slots"]} == {"reg-3", "reg-4"})


async def tie_on_top(flow, staffel):
    """Spieltag 1 gespielt (zwei Sieger 2:1), der Rest abgesagt: Die Sieger stehen in allem gleich auf Platz 1."""
    winners = []
    for match in await matches_of(flow, staffel, 1):
        winner = match["slots"][0]["registration_id"]
        await result(flow, match, winner, score=(2, 1))
        winners.append(winner)
    await flow.db.matches_v2.update_many({"tournament_id": staffel["id"], "round": {"$ne": 1}}, {"$set": {"status": "cancelled"}})
    return winners


async def cockpit(flow, season, staffel=None):
    response = await flow.get(f"{ADMIN}/seasons/{season['id']}/closing")
    assert response.status_code == 200, response.text
    data = response.json()
    if staffel is None:
        return data
    return next(row for row in data["staffeln"] if row["tournament_id"] == staffel["id"])


async def close(flow, staffel, **body):
    return await flow.post(f"{STAFFELN}/{staffel['id']}/close", json={"confirm": True, **body})


async def reopen(flow, staffel, **body):
    return await flow.post(f"{STAFFELN}/{staffel['id']}/reopen", json={"reason": "Ergebnis war falsch eingetragen", **body})


async def must_close(flow, staffel, status: int = 200, **body):
    response = await close(flow, staffel, **body)
    assert response.status_code == status, response.text
    return response


async def must_reopen(flow, staffel, status: int = 200, **body):
    response = await reopen(flow, staffel, **body)
    assert response.status_code == status, response.text
    return response


async def lead(flow, league, name: str, *capabilities: str) -> dict:
    user = await flow.add_user(name=name)
    await flow.db.league_staff.insert_one({"id": new_id(), "league_id": league["id"], "user_id": user["id"],
                                           "capabilities": list(capabilities), "created_at": now_utc().isoformat()})
    return user


async def standings(flow, staffel):
    response = await flow.get(f"/api/tournaments/{staffel['id']}/standings")
    assert response.status_code == 200, response.text
    return response.json()


# ---------------------------------------------------------------- Sperrgründe (Nr. 154)

async def _open_match(flow, season, staffel):
    match = await bottom_match(flow, staffel)
    await play_all(flow, staffel, skip=match["id"])

    async def fix():
        await result(flow, match, stronger(match))
    return ["open_matches"], f"/matches/{match['id']}", fix


async def _incident(flow, season, staffel):
    match = await bottom_match(flow, staffel)
    await play_all(flow, staffel, skip=match["id"])
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"incidents": [
        {"id": "vorfall-1", "state": "in_review", "position": 1, "kind": "disconnect"}]}})

    async def fix():
        await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"incidents": []}})
        await result(flow, match, stronger(match))
    return ["open_matches", "incidents"], f"/matches/{match['id']}", fix


async def _procedure(flow, season, staffel):
    await play_all(flow, staffel)
    match = (await matches_of(flow, staffel))[0]
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"contested": True, "disputes": [
        {"id": "protest-1", "kind": "protest", "state": "open", "contested_mode": "counts", "at": LONG_AGO}]}})

    async def fix():
        await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"contested": False, "disputes": [
            {"id": "protest-1", "kind": "protest", "state": "decided", "resolved_at": LONG_AGO, "appeal_until": LONG_AGO}]}})
    return ["procedures"], f"/matches/{match['id']}#verfahren-protest-1", fix


def _sanction(season, staffel, **fields) -> dict:
    return {"id": new_id(), "season_id": season["id"], "league_id": season["league_id"], "tournament_id": staffel["id"],
            "registration_id": "reg-4", "kind": "team_ban", "target_type": "squad", "state": "final", "revoked_at": None,
            "appeal": None, "appeal_until": LONG_AGO, "created_at": LONG_AGO, **fields}


async def _provisional_sanction(flow, season, staffel):
    await play_all(flow, staffel)
    doc = _sanction(season, staffel, state="provisional", appeal_until=None)
    await flow.db.competition_sanctions.insert_one(dict(doc))

    async def fix():
        await flow.db.competition_sanctions.update_one({"id": doc["id"]}, {"$set": {"revoked_at": now_utc().isoformat()}})
    return ["sanctions"], f"/admin/leagues/seasons/{season['id']}#strafen", fix


async def _sanction_appeal(flow, season, staffel):
    await play_all(flow, staffel)
    doc = _sanction(season, staffel, appeal={"state": "open", "by": "jemand", "at": LONG_AGO})
    await flow.db.competition_sanctions.insert_one(dict(doc))

    async def fix():
        await flow.db.competition_sanctions.update_one({"id": doc["id"]}, {"$set": {"appeal.state": "upheld"}})
    return ["sanctions"], f"/admin/leagues/seasons/{season['id']}#strafen", fix


async def _protest_window(flow, season, staffel):
    await play_all(flow, staffel)
    match = (await matches_of(flow, staffel))[0]
    await result(flow, match, stronger(match), at=now_utc().isoformat())

    async def fix():
        await result(flow, match, stronger(match))
    return ["deadlines"], f"/matches/{match['id']}", fix


async def _appeal_window_after_decision(flow, season, staffel):
    await play_all(flow, staffel)
    match = (await matches_of(flow, staffel))[0]
    soon = (now_utc() + timedelta(hours=5)).isoformat()
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"disputes": [
        {"id": "protest-1", "kind": "protest", "state": "decided", "resolved_at": now_utc().isoformat(), "appeal_until": soon}]}})

    async def fix():
        await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"disputes.0.appeal_until": LONG_AGO}})
    return ["deadlines"], f"/matches/{match['id']}", fix


async def _sanction_appeal_window(flow, season, staffel):
    await play_all(flow, staffel)
    doc = _sanction(season, staffel, appeal_until=(now_utc() + timedelta(hours=5)).isoformat())
    await flow.db.competition_sanctions.insert_one(dict(doc))

    async def fix():
        await flow.db.competition_sanctions.update_one({"id": doc["id"]}, {"$set": {"appeal_until": LONG_AGO}})
    return ["deadlines"], f"/admin/leagues/seasons/{season['id']}#strafen", fix


@pytest.mark.asyncio
@pytest.mark.parametrize("case", [_open_match, _incident, _procedure, _provisional_sanction, _sanction_appeal, _protest_window,
                                  _appeal_window_after_decision, _sanction_appeal_window], ids=lambda case: case.__name__.strip("_"))
async def test_every_blocker_alone_holds_the_close_and_names_the_case(flow, case):
    _admin, _league, season, _division, staffel = await setup(flow)
    codes, url, fix = await case(flow, season, staffel)

    row = await cockpit(flow, season, staffel)
    assert [blocker["code"] for blocker in row["blockers"]] == codes
    assert row["can_close"] is False and row["closed"] is False
    assert url in [item["url"] for blocker in row["blockers"] for item in blocker["items"]]
    refused = await close(flow, staffel)
    assert refused.status_code == 409 and "Abschließen geht noch nicht" in refused.json()["detail"]
    assert await flow.db.league_final_tables.count_documents({}) == 0

    # Gegenprobe: Ohne diesen einen Grund geht es.
    await fix()
    row = await cockpit(flow, season, staffel)
    assert row["blockers"] == [] and row["can_close"] is True
    closed = await close(flow, staffel)
    assert closed.status_code == 200, closed.text


@pytest.mark.asyncio
async def test_a_staffel_without_a_scored_game_or_before_the_start_cannot_be_closed(flow):
    _admin, _league, season, _division, staffel = await setup(flow)
    await flow.db.matches_v2.update_many({"tournament_id": staffel["id"]}, {"$set": {"status": "cancelled"}})
    assert [row["code"] for row in (await cockpit(flow, season, staffel))["blockers"]] == ["no_matches"]
    await flow.db.tournaments.update_one({"id": staffel["id"]}, {"$set": {"status": "draft"}})
    # Ein Entwurf steht gar nicht im Cockpit - und abschließen lässt er sich auch nicht.
    assert (await cockpit(flow, season))["staffeln"] == []
    refused = await close(flow, staffel)
    assert refused.status_code == 409
    unconfirmed = await flow.post(f"{STAFFELN}/{staffel['id']}/close", json={})
    assert unconfirmed.status_code == 422


# ---------------------------------------------------------------- Der Endstand bleibt

@pytest.mark.asyncio
async def test_the_final_table_stays_when_rules_points_or_results_change_later(flow):
    _admin, _league, season, _division, staffel = await setup(flow)
    await play_all(flow, staffel)
    before = await standings(flow, staffel)
    assert [row["registration_id"] for row in before] == ["reg-1", "reg-2", "reg-3", "reg-4"]
    closed = await close(flow, staffel)
    assert closed.status_code == 200, closed.text
    assert closed.json() == {"ok": True, "version": 1, "closed_at": closed.json()["closed_at"], "champion": "Probe 1",
                             "season_status": "completed"}

    # Später: andere Punkte, anderer Gleichstand, ein Punktabzug, ein gedrehtes Ergebnis - direkt in den Daten.
    await flow.db.tournaments.update_one({"id": staffel["id"]}, {"$set": {
        "scoring_rules.match_points": {"win": 1, "draw": 0, "loss": 5}, "scoring_rules.table_tiebreakers": ["score_for"],
        "point_deductions": [{"id": "abzug", "registration_id": "reg-1", "points": 9}]}})
    first = next(match for match in await matches_of(flow, staffel) if stronger(match) == "reg-1")
    await result(flow, first, next(slot["registration_id"] for slot in first["slots"] if slot["registration_id"] != "reg-1"))

    flow.act_as(None)
    after = await standings(flow, staffel)
    assert after == before
    page = (await flow.get(f"{PAGE}/staffeln/{staffel['slug']}")).json()
    assert page["standings"] == before
    assert page["staffel"]["final"]["version"] == 1 and page["staffel"]["final"]["champion"]["display_name"] == "Probe 1"
    assert page["staffel"]["status"] == "completed"
    # Gegenprobe: Gerechnet stünde jetzt etwas anderes da.
    from services.league_final import live_rows

    live = await live_rows(flow.db, await flow.db.tournaments.find_one({"id": staffel["id"]}, {"_id": 0}))
    assert [(row["registration_id"], row["points"]) for row in live] != [(row["registration_id"], row["points"]) for row in before]

    stored = await flow.db.league_final_tables.find_one({"tournament_id": staffel["id"]}, {"_id": 0})
    assert stored["active"] is True and stored["champion"]["registration_id"] == "reg-1" and stored["zones"] == []
    assert stored["rules"]["table"]["match_points"] == {"win": 3, "draw": 0, "loss": 0}
    assert [row["rank"] for row in stored["rows"]] == [1, 2, 3, 4]


@pytest.mark.asyncio
async def test_a_closed_staffel_takes_no_table_decision_and_does_not_go_back_to_live_by_status(flow):
    _admin, _league, season, _division, staffel = await setup(flow)
    await play_all(flow, staffel)
    await must_close(flow, staffel)
    decision = await flow.put(f"{STAFFELN}/{staffel['id']}/table-decision", json={"registration_ids": ["reg-1", "reg-2"], "reason": "Losentscheid"})
    assert decision.status_code == 409 and "abgeschlossen" in decision.json()["detail"]
    back = await flow.post(f"/api/tournaments/{staffel['id']}/status", json={"status": "live"})
    assert back.status_code == 400 and "Wieder öffnen" in back.json()["detail"]
    again = await close(flow, staffel)
    assert again.status_code == 409 and again.json()["detail"] == "Diese Staffel ist schon abgeschlossen."


# ---------------------------------------------------------------- Gleichstand auf Platz 1 (Nr. 156)

@pytest.mark.asyncio
async def test_a_tie_on_first_place_needs_a_reasoned_decision_that_stands_in_the_final_table(flow):
    _admin, _league, season, _division, staffel = await setup(flow)
    winners = await tie_on_top(flow, staffel)

    row = await cockpit(flow, season, staffel)
    assert [blocker["code"] for blocker in row["blockers"]] == ["champion_tie"]
    assert sorted(row["ties"][0]["registration_ids"]) == sorted(winners) and row["can_decide"] is True and row["champion"] is None
    await must_close(flow, staffel, 409)

    wrong = await flow.put(f"{STAFFELN}/{staffel['id']}/table-decision",
                           json={"registration_ids": winners, "reason": "Entscheidungsspiel 2:1", "method": "wuerfel"})
    assert wrong.status_code == 422
    order = [winners[1], winners[0]]
    decided = await flow.put(f"{STAFFELN}/{staffel['id']}/table-decision",
                             json={"registration_ids": order, "reason": "Entscheidungsspiel 2:1 gewonnen", "method": "playoff"})
    assert decided.status_code == 200, decided.text

    row = await cockpit(flow, season, staffel)
    assert row["blockers"] == [] and row["champion"]["registration_id"] == order[0]
    await must_close(flow, staffel)
    stored = await flow.db.league_final_tables.find_one({"tournament_id": staffel["id"]}, {"_id": 0})
    assert stored["champion"]["registration_id"] == order[0]
    assert [(entry["registration_ids"], entry["reason"], entry["method"]) for entry in stored["decisions"]] == [
        (order, "Entscheidungsspiel 2:1 gewonnen", "playoff")]
    assert stored["rows"][0]["lead_decision"]["method"] == "playoff" and [item["rank"] for item in stored["rows"][:2]] == [1, 2]
    flow.act_as(None)
    final = (await flow.get(f"{PAGE}/staffeln/{staffel['slug']}")).json()["staffel"]["final"]
    assert final["decisions"] == [{"names": [f"Probe {order[0][-1]}", f"Probe {order[1][-1]}"], "reason": "Entscheidungsspiel 2:1 gewonnen",
                                   "method": "playoff", "method_label": "Entscheidungsspiel"}]


@pytest.mark.asyncio
async def test_below_the_top_league_a_shared_first_place_is_no_champion_and_no_blocker(flow):
    _admin, _league, season, _division, _staffel = await setup(flow)
    second = (await flow.post(f"{ADMIN}/seasons/{season['id']}/divisions", json={})).json()
    lower = await add_staffel(flow, second, "b")
    await tie_on_top(flow, lower)
    row = await cockpit(flow, season, lower)
    assert row["champion_place"] is False and row["blockers"] == [] and row["ties"] == []
    await must_close(flow, lower)
    stored = await flow.db.league_final_tables.find_one({"tournament_id": lower["id"]}, {"_id": 0})
    assert stored["champion"] is None and [item["rank"] for item in stored["rows"][:2]] == [1, 1]
    assert await flow.db.tournament_awards.count_documents({"tournament_id": lower["id"]}) == 0
    # Die Season ist erst abgeschlossen, wenn alle Staffeln abgeschlossen sind.
    assert (await flow.db.league_seasons.find_one({"id": season["id"]}, {"_id": 0}))["status"] == "active"
    assert (await cockpit(flow, season))["season"]["closed"] is False


# ---------------------------------------------------------------- Wieder öffnen (Nr. 155)

@pytest.mark.asyncio
async def test_reopening_needs_a_reason_and_a_second_person_and_keeps_the_old_version(flow):
    admin, league, season, _division, staffel = await setup(flow)
    await play_all(flow, staffel)
    first = await lead(flow, league, "Erste Leitung", "season")
    second = await lead(flow, league, "Zweite Leitung", "season")
    flow.act_as(first)
    await must_close(flow, staffel)
    row = await cockpit(flow, season, staffel)
    assert row["closed"] is True and row["closed_by_me"] is True and row["can_reopen"] is False

    own = await reopen(flow, staffel)
    assert own.status_code == 403 and "zweite Person" in own.json()["detail"]
    flow.act_as(second)
    assert (await cockpit(flow, season, staffel))["can_reopen"] is True
    short = await flow.post(f"{STAFFELN}/{staffel['id']}/reopen", json={"reason": "ups"})
    assert short.status_code == 422
    assert (await flow.db.tournaments.find_one({"id": staffel["id"]}, {"_id": 0}))["final_table"]["version"] == 1
    opened = await reopen(flow, staffel)
    assert opened.status_code == 200, opened.text
    assert opened.json()["season_status"] == "active"

    tournament = await flow.db.tournaments.find_one({"id": staffel["id"]}, {"_id": 0})
    assert tournament["final_table"] is None and tournament["status"] == "live"
    assert (await flow.db.league_seasons.find_one({"id": season["id"]}, {"_id": 0}))["status"] == "active"
    audit = await flow.db.audit_logs.find_one({"action": "league.final.reopen"}, {"_id": 0})
    assert audit["actor_id"] == second["id"] and audit["data"]["reason"] == "Ergebnis war falsch eingetragen"

    # Korrigieren und neu abschließen: neue Fassung, die alte bleibt im Verlauf.
    last = next(match for match in await matches_of(flow, staffel) if {slot["registration_id"] for slot in match["slots"]} == {"reg-1", "reg-2"})
    await result(flow, last, "reg-2")
    # reg-2 hat jetzt alle Spiele gewonnen und steht vor reg-1.
    await must_close(flow, staffel)
    row = await cockpit(flow, season, staffel)
    assert [(entry["version"], entry["active"], entry["champion"]) for entry in row["history"]] == [(2, True, "Probe 2"), (1, False, "Probe 1")]
    old = row["history"][1]
    assert old["reopen_reason"] == "Ergebnis war falsch eingetragen" and old["reopened_by_name"] == "Zweite Leitung"
    assert old["closed_by_name"] == "Erste Leitung"
    kept = (await flow.get(f"{STAFFELN}/{staffel['id']}/final-tables/1")).json()
    assert [item["registration_id"] for item in kept["standings"]][:2] == ["reg-1", "reg-2"]
    assert (await flow.get(f"{STAFFELN}/{staffel['id']}/final-tables/9")).status_code == 404
    flow.act_as(None)
    assert [item["registration_id"] for item in await standings(flow, staffel)][:2] == ["reg-2", "reg-1"]
    assert admin["id"] not in (first["id"], second["id"])


@pytest.mark.asyncio
async def test_a_superadmin_who_closed_reopens_only_as_an_emergency_with_a_reason(flow):
    admin, _league, season, _division, staffel = await setup(flow)
    await play_all(flow, staffel)
    await must_close(flow, staffel)
    assert (await cockpit(flow, season, staffel))["can_reopen"] is True  # Superadmin: nur über die Notausnahme
    refused = await reopen(flow, staffel)
    assert refused.status_code == 403 and "Notausnahme" in refused.json()["detail"]
    opened = await reopen(flow, staffel, emergency_reason="Niemand sonst erreichbar")
    assert opened.status_code == 200, opened.text
    override = await flow.db.audit_logs.find_one({"action": "league.conflict.override"}, {"_id": 0})
    assert override["actor_id"] == admin["id"] and override["data"]["action"] == "final_reopen_own"
    assert override["data"]["reason"] == "Niemand sonst erreichbar"
    again = await reopen(flow, staffel, emergency_reason="Niemand sonst erreichbar")
    assert again.status_code == 409


# ---------------------------------------------------------------- Rechte und Befangenheit (B.1)

@pytest.mark.asyncio
async def test_only_season_may_close_and_never_with_the_own_team_in_the_staffel(flow):
    _admin, league, season, _division, staffel = await setup(flow)
    await play_all(flow, staffel)
    planner = await lead(flow, league, "Planerin", "matches", "results")
    flow.act_as(planner)
    row = await cockpit(flow, season, staffel)
    assert row["can_close"] is False and (await cockpit(flow, season))["can_act"] is False
    await must_close(flow, staffel, 403)

    involved = await lead(flow, league, "Leitung im Team", "season")
    await flow.db.teams.update_one({"id": "team-3"}, {"$set": {"leader_id": involved["id"]}})
    flow.act_as(involved)
    row = await cockpit(flow, season, staffel)
    assert row["own_team"] is True and row["can_close"] is False
    conflict = await close(flow, staffel)
    assert conflict.status_code == 403 and "eigenes Team" in conflict.json()["detail"]
    assert await flow.db.league_final_tables.count_documents({}) == 0

    flow.act_as(await flow.add_user(name="Fremde"))
    assert (await flow.get(f"{ADMIN}/seasons/{season['id']}/closing")).status_code == 403
    flow.act_as(None)
    assert (await flow.get(f"{ADMIN}/seasons/{season['id']}/closing")).status_code == 401
    await must_close(flow, staffel, 401)


# ---------------------------------------------------------------- Meister und Erfolge

@pytest.mark.asyncio
async def test_the_champion_gets_one_entry_and_a_corrected_close_moves_it_without_a_double(flow):
    admin, league, season, _division, staffel = await setup(flow)
    player = await flow.add_user(name="Spielerin Eins")
    bench = await flow.add_user(name="Mitglied ohne Einsatz")
    await flow.db.teams.update_one({"id": "team-1"}, {"$set": {"member_ids": [player["id"], bench["id"]]}})
    await flow.db.team_members.insert_many([{"id": new_id(), "team_id": "team-1", "user_id": person["id"], "role": "member"}
                                            for person in (player, bench)])
    await play_all(flow, staffel)
    first = next(match for match in await matches_of(flow, staffel) if stronger(match) == "reg-1")
    await flow.db.matches_v2.update_one({"id": first["id"]}, {"$set": {"lineups": {"reg-1": [player["id"]]}}})
    second = await lead(flow, league, "Zweite Leitung", "season")

    await must_close(flow, staffel)
    awards = await flow.db.tournament_awards.find({"tournament_id": staffel["id"]}, {"_id": 0}).to_list(10)
    assert len(awards) == 1
    award = awards[0]
    assert award["registration_id"] == "reg-1" and award["team_id"] == "team-1" and award["rank"] == 1
    assert award["player_ids"] == [player["id"]] and award["league"]["title"] == "Meister" and award["suspended"] is False

    flow.act_as(player)
    mine = (await flow.get("/api/me/awards")).json()["awards"]
    assert [(row["rank_label"], row["tournament"]["title"], row["league"]["staffel"]) for row in mine] == [("Meister", "Probe-Liga · Season 1", "A")]
    flow.act_as(bench)
    assert (await flow.get("/api/me/awards")).json()["awards"] == []

    # Wieder geöffnet: Der Eintrag ruht - niemand trägt einen Titel, der gerade geprüft wird.
    flow.act_as(second)
    await must_reopen(flow, staffel)
    flow.act_as(player)
    assert (await flow.get("/api/me/awards")).json()["awards"] == []
    assert await flow.db.tournament_awards.count_documents({"tournament_id": staffel["id"]}) == 1

    # Derselbe Meister nach neuem Abschluss: derselbe Eintrag, kein zweiter.
    flow.act_as(admin)
    await must_close(flow, staffel)
    same = await flow.db.tournament_awards.find({"tournament_id": staffel["id"]}, {"_id": 0}).to_list(10)
    assert [row["id"] for row in same] == [award["id"]] and same[0]["suspended"] is False and same[0]["league"]["version"] == 2

    # Korrigiert: Jetzt ist reg-2 Meister - der alte Eintrag ist weg, es gibt genau einen.
    flow.act_as(second)
    await must_reopen(flow, staffel)
    duel = next(match for match in await matches_of(flow, staffel) if {slot["registration_id"] for slot in match["slots"]} == {"reg-1", "reg-2"})
    await result(flow, duel, "reg-2")
    await must_close(flow, staffel)
    moved = await flow.db.tournament_awards.find({"tournament_id": staffel["id"]}, {"_id": 0}).to_list(10)
    assert [(row["registration_id"], row["team_id"]) for row in moved] == [("reg-2", "team-2")]
    flow.act_as(player)
    assert (await flow.get("/api/me/awards")).json()["awards"] == []


# ---------------------------------------------------------------- Gleichzeitig abschließen

@pytest.mark.asyncio
async def test_two_closes_at_once_give_one_final_table_and_one_conflict(flow):
    _admin, _league, _season, _division, staffel = await setup(flow)
    await play_all(flow, staffel)
    answers = await asyncio.gather(close(flow, staffel), close(flow, staffel))
    assert sorted(answer.status_code for answer in answers) == [200, 409]
    assert await flow.db.league_final_tables.count_documents({"tournament_id": staffel["id"]}) == 1
    assert await flow.db.tournament_awards.count_documents({"tournament_id": staffel["id"]}) == 1
    assert await flow.db.audit_logs.count_documents({"action": "league.final.close"}) == 1


@pytest.mark.asyncio
async def test_the_claim_on_the_tournament_refuses_a_second_final_table_without_the_lock(flow):
    """Auch ohne Schreibsperre (zwei Server): Wer das Turnier nicht als Erster markiert, schreibt keinen Endstand."""
    from services import league_final

    admin, _league, _season, _division, staffel = await setup(flow)
    await play_all(flow, staffel)
    stale = await flow.db.tournaments.find_one({"id": staffel["id"]}, {"_id": 0})
    await league_final.close(flow.db, dict(stale), admin)
    with pytest.raises(league_final.FinalProblem) as refused:
        await league_final.close(flow.db, dict(stale), admin)
    assert refused.value.status == 409
    assert await flow.db.league_final_tables.count_documents({"tournament_id": staffel["id"]}) == 1


# ---------------------------------------------------------------- Nachricht an die Captains, Season, Archiv

@pytest.mark.asyncio
async def test_captains_hear_once_about_close_and_reopen_and_the_season_stays_public(flow):
    _admin, league, season, _division, staffel = await setup(flow)
    await play_all(flow, staffel)
    second = await lead(flow, league, "Zweite Leitung", "season")
    await must_close(flow, staffel)
    notes = await flow.db.notifications.find({"meta.reason": "league_final"}, {"_id": 0}).to_list(50)
    assert sorted(note["user_id"] for note in notes) == [f"captain-{index}" for index in range(1, 5)]
    assert {note["title"] for note in notes} == {"Staffel abgeschlossen"} and all("Meister: Probe 1" in note["body"] for note in notes)
    assert {note["url"] for note in notes} == {"/liga/probe-shooter/season-1"}

    # Die abgeschlossene Season bleibt öffentlich sichtbar - mit Endstand.
    assert (await flow.db.league_seasons.find_one({"id": season["id"]}, {"_id": 0}))["status"] == "completed"
    flow.act_as(None)
    listed = (await flow.get("/api/leagues")).json()["leagues"]
    assert [row["status"] for row in listed[0]["seasons"]] == ["completed"]
    assert (await flow.get(PAGE)).status_code == 200
    assert (await flow.get(f"{PAGE}/staffeln/{staffel['slug']}")).json()["staffel"]["final"]["champion"]["display_name"] == "Probe 1"

    flow.act_as(second)
    await must_reopen(flow, staffel)
    notes = await flow.db.notifications.find({"meta.reason": "league_final"}, {"_id": 0}).to_list(50)
    assert sorted(note["title"] for note in notes) == ["Staffel abgeschlossen"] * 4 + ["Staffel wieder geöffnet"] * 4
    assert all("Ergebnis war falsch" not in note["body"] for note in notes)  # der Grund bleibt bei der Leitung
    flow.act_as(None)
    assert (await flow.get(f"{PAGE}/staffeln/{staffel['slug']}")).json()["staffel"]["final"] is None


@pytest.mark.asyncio
async def test_a_season_set_to_completed_by_hand_is_not_reactivated_by_reopening(flow):
    admin, league, season, _division, staffel = await setup(flow)
    await play_all(flow, staffel)
    await flow.db.league_seasons.update_one({"id": season["id"]}, {"$set": {"status": "completed"}})
    second = await lead(flow, league, "Zweite Leitung", "season")
    closed = await must_close(flow, staffel)
    assert closed.json()["season_status"] is None
    flow.act_as(second)
    opened = await must_reopen(flow, staffel)
    assert opened.json()["season_status"] is None
    assert (await flow.db.league_seasons.find_one({"id": season["id"]}, {"_id": 0}))["status"] == "completed"
    assert admin["id"] != second["id"]


# ---------------------------------------------------------------- Nach dem Abschluss schreibt niemand mehr (H1)

CLOSED_DETAIL = "Die Staffel ist abgeschlossen."


@pytest.mark.asyncio
async def test_after_the_close_no_route_changes_a_result_or_status_anymore(flow):
    _admin, _league, season, _division, staffel = await setup(flow)
    await play_all(flow, staffel)
    before = await standings(flow, staffel)
    await must_close(flow, staffel)
    match = next(row for row in await matches_of(flow, staffel) if stronger(row) == "reg-1")
    stored = await flow.db.matches_v2.find_one({"id": match["id"]}, {"_id": 0})
    winner, loser = "reg-1", next(slot["registration_id"] for slot in match["slots"] if slot["registration_id"] != "reg-1")
    turned = {"results": [{"registration_id": loser, "rank": 1, "score": 2}, {"registration_id": winner, "rank": 2, "score": 0}]}
    calls = {
        "undo": ("POST", f"/api/matches/{match['id']}/result/undo", {}),
        "correction": ("POST", f"/api/matches/{match['id']}/result", {**turned, "reason": "Korrektur laut Protokoll"}),
        "forfeit": ("POST", f"/api/matches/{match['id']}/forfeit", {"forfeit_registration_id": winner, "note": "Nicht angetreten"}),
        "report": ("POST", f"/api/matches/{match['id']}/report", turned),
        "incident": ("POST", f"/api/matches/{match['id']}/incidents", {"kind": "disconnect", "position": 1}),
        "removal": ("POST", f"/api/tournaments/{staffel['id']}/registrations/reg-1/removal", {"kind": "disqualified", "reason": "Verstoß gegen die Regeln"}),
        "double_no_show": ("POST", f"{STAFFELN}/{staffel['id']}/matches/{match['id']}/double-no-show", {"note": "Beide nicht da"}),
    }
    for name, (method, url, body) in calls.items():
        response = await flow.client.request(method, url, json=body)
        assert response.status_code == 409, (name, response.status_code, response.text)
        assert CLOSED_DETAIL in response.json()["detail"] and "wieder öffnen" in response.json()["detail"], (name, response.text)
    assert await flow.db.matches_v2.find_one({"id": match["id"]}, {"_id": 0}) == stored
    assert (await flow.db.tournament_registrations.find_one({"id": "reg-1"}, {"_id": 0}))["status"] == "approved"
    flow.act_as(None)
    assert await standings(flow, staffel) == before
    assert season["id"]


@pytest.mark.asyncio
async def test_the_write_functions_refuse_a_closed_staffel_even_without_a_route(flow):
    """Die Schreibfunktionen selbst lehnen ab - auch der Job, der ein bereitliegendes Ergebnis veröffentlicht."""
    from services import result_hold
    from services.match_v2_results import MatchV2ResultError
    from services.v2_result_submission import submit_v2_result

    admin, _league, _season, _division, staffel = await setup(flow)
    await play_all(flow, staffel)
    await must_close(flow, staffel)
    match = (await matches_of(flow, staffel))[0]
    rows = [{"registration_id": slot["registration_id"], "rank": index + 1, "score": 2 - 2 * index} for index, slot in enumerate(match["slots"])]
    with pytest.raises(MatchV2ResultError) as submit:
        await submit_v2_result(flow.db, match, rows, actor_id=admin["id"], proof_url=None, note=None, force=True, audit_action="match.result.admin",
                               reason="Korrektur")
    with pytest.raises(MatchV2ResultError) as undo:
        await result_hold.undo_result(flow.db, match, actor_id=admin["id"])
    with pytest.raises(MatchV2ResultError) as hold:
        await result_hold.hold_result(flow.db, match, rows, actor=admin, note=None, proof_url=None, force=True, reason="Korrektur")
    assert {submit.value.status_code, undo.value.status_code, hold.value.status_code} == {409}
    assert all(CLOSED_DETAIL in str(error.value) for error in (submit, undo, hold))


# ---------------------------------------------------------------- Meister nur unter den Aktiven (M1)

@pytest.mark.asyncio
async def test_a_leader_who_left_is_not_champion_the_best_active_team_is(flow):
    _admin, _league, season, _division, staffel = await setup(flow)
    await flow.db.tournaments.update_one({"id": staffel["id"]}, {"$set": {"scoring_rules.exit_rule": "half"}})
    await play_all(flow, staffel)
    await flow.db.tournament_registrations.update_one({"id": "reg-1"}, {"$set": {"status": "withdrawn", "withdrawn_at": LONG_AGO}})
    row = await cockpit(flow, season, staffel)
    assert [(item["registration_id"], item["rank"], bool(item.get("exit"))) for item in row["standings"]][:2] == [("reg-1", 1, True), ("reg-2", 2, False)]
    assert row["blockers"] == [] and row["champion"]["registration_id"] == "reg-2"
    await must_close(flow, staffel)
    stored = await flow.db.league_final_tables.find_one({"tournament_id": staffel["id"]}, {"_id": 0})
    assert stored["champion"]["registration_id"] == "reg-2"
    award = await flow.db.tournament_awards.find_one({"tournament_id": staffel["id"]}, {"_id": 0})
    assert award["registration_id"] == "reg-2"


@pytest.mark.asyncio
async def test_two_active_teams_level_behind_a_leader_who_left_need_a_decision_and_no_active_team_blocks(flow):
    _admin, _league, season, _division, staffel = await setup(flow)
    await flow.db.tournaments.update_one({"id": staffel["id"]}, {"$set": {"scoring_rules.exit_rule": "half"}})
    winners = await tie_on_top(flow, staffel)
    # Ein dritter Sieger gibt es nicht: Einer der beiden Sieger steigt aus - dann stehen die Verlierer als beste Aktive nicht vorn.
    await flow.db.tournament_registrations.update_one({"id": winners[0]}, {"$set": {"status": "withdrawn", "withdrawn_at": LONG_AGO}})
    row = await cockpit(flow, season, staffel)
    assert row["blockers"] == [] and row["champion"]["registration_id"] == winners[1]
    # Steigt auch der zweite aus, stehen die beiden Verlierer gleich - ohne Entscheid kein Meister.
    await flow.db.tournament_registrations.update_one({"id": winners[1]}, {"$set": {"status": "withdrawn", "withdrawn_at": LONG_AGO}})
    row = await cockpit(flow, season, staffel)
    assert [(blocker["code"], blocker["label"]) for blocker in row["blockers"]] == [("champion_tie", "Gleichstand um den Meistertitel")]
    assert row["ties"][0]["rank"] == 3 and row["champion"] is None
    await must_close(flow, staffel, 409)
    # Niemand mehr in der Wertung: eigener Sperrgrund statt eines stillen Abschlusses ohne Meister.
    await flow.db.tournament_registrations.update_many({"tournament_id": staffel["id"]}, {"$set": {"status": "withdrawn", "withdrawn_at": LONG_AGO}})
    row = await cockpit(flow, season, staffel)
    assert [blocker["code"] for blocker in row["blockers"]] == ["no_champion"]
    await must_close(flow, staffel, 409)
