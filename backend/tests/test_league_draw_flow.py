"""Los auf mehrere Staffeln einer Liga N (#1623, docs/LIGA.md „B.4 Los auf mehrere Staffeln“): Auslosen, Vorschau, Tausch mit Grund,
Übernehmen, Protokoll, Befangenheit und gleichzeitige Aufrufe. Über die echten Routen; die gleichzeitigen Aufrufe rufen den Dienst direkt
(die Harness kennt je Anfrage eine Person) - exklusiv ist das nur auf echtem MongoDB (``FLOW_MONGO_URL``). Erfundene Namen."""
import asyncio
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_application_world import add_team, application_world, decide, submitted  # noqa: E402
from league_rules_world import ADMIN_LEAGUES  # noqa: E402
from league_start_world import ok  # noqa: E402
from models import new_id, now_utc  # noqa: E402
from services import league_applications as applications  # noqa: E402
from services import league_draw, league_staffel_plan  # noqa: E402
from services import league_service as leagues  # noqa: E402
from services.league_service import LeagueProblem  # noqa: E402
from squad_world import make_squad  # noqa: E402

REASON = "Terminwunsch beider Teams"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def draws_url(w: dict, division: dict | None = None, action: str = "") -> str:
    base = f"{ADMIN_LEAGUES}/seasons/{w['season']['id']}/draws"
    if not division:
        return base
    return f"{base}/{division['id']}{'/' + action if action else ''}"


async def world(flow, *, teams: int = 5, staffeln: int = 2, **season) -> dict:
    """Eine Season mit Liga 1 und ``staffeln`` leeren Staffeln; alle Co-Teams sind angenommen, keines ist zugeteilt."""
    w = await application_world(flow, teams=teams, staffeln=staffeln, **season)
    w["applications"] = [ok(await decide(flow, w, await submitted(flow, w, side), "accept")) for side in w["teams"]]
    flow.act_as(w["lead"])
    return w


async def twin_of(flow, w: dict, side: dict) -> dict:
    """Ein zweites Co-Team desselben Hauptteams, angenommen."""
    extra = [await flow.add_user(name=f"Zweit {index}") for index in range(4)]
    await flow.db.teams.update_one({"id": side["team"]["id"]}, {"$addToSet": {"member_ids": {"$each": [user["id"] for user in extra]}}})
    squad = await make_squad(flow, side["team"], "Zweite Reihe", extra, captain=extra[0], vice=extra[1], game_id=w["game"]["id"])
    twin = {**side, "squad": squad, "captain": extra[0], "vice": extra[1], "member": extra[3], "people": extra}
    ok(await decide(flow, w, await submitted(flow, w, twin), "accept"))
    flow.act_as(w["lead"])
    return twin


async def division_view(flow, w: dict) -> dict:
    flow.act_as(w["lead"])
    return ok(await flow.get(draws_url(w)))["divisions"][0]


async def drawn(flow, w: dict) -> dict:
    flow.act_as(w["lead"])
    return ok(await flow.post(draws_url(w, w["division"]), json={}))["draw"]


def placement(draw: dict) -> dict[str, str]:
    return {team["squad_id"]: staffel["tournament_id"] for staffel in draw["staffeln"] for team in staffel["teams"]}


async def assignments(flow, w: dict) -> dict[str, str]:
    rows = await flow.db.league_applications.find({"season_id": w["season"]["id"], "assignment": {"$exists": True}}, {"_id": 0}).to_list(50)
    return {row["squad_id"]: row["assignment"]["tournament_id"] for row in rows}


async def no_preview(_db, _tournament, _actor_id):
    return None


# ---------------------------------------------------------------- Vorschau

@pytest.mark.asyncio
async def test_the_overview_counts_waiting_teams_and_suggests_staffeln(flow):
    w = await world(flow, teams=5, staffeln=2, max_staffel_size=4)
    view = await division_view(flow, w)
    assert len(view["waiting"]) == 5 and view["draw"] is None
    assert view["can_draw"] is True and view["problem"] is None
    # 5 Co-Teams, höchstens 4 je Staffel: zwei Staffeln mit 3 und 2 - die gibt es.
    assert (view["suggestion"]["needed"], view["suggestion"]["sizes"], view["suggestion"]["fits"]) == (2, [3, 2], True)


@pytest.mark.asyncio
async def test_drawing_stores_the_seed_and_writes_no_assignment(flow):
    w = await world(flow)
    draw = await drawn(flow, w)
    assert draw["seed"] and draw["number"] == 1 and draw["status"] == "draft" and draw["stale"] is False
    assert sorted(placement(draw)) == sorted(side["squad"]["id"] for side in w["teams"])
    # Vorschau ohne Schreiben: keine Anmeldung, keine Zuteilung, keine Nachricht.
    assert await flow.db.tournament_registrations.count_documents({"tournament_id": {"$in": w["tids"]}}) == 0
    assert await assignments(flow, w) == {}
    assert await flow.db.notifications.count_documents({"meta.reason": "league_application_assigned"}) == 0
    # Neu laden würfelt nicht neu - und ein zweites „Auslosen“ bei gleicher Eingabe auch nicht.
    again = (await division_view(flow, w))["draw"]
    replay = ok(await flow.post(draws_url(w, w["division"]), json={}))
    assert (again["seed"], placement(again)) == (draw["seed"], placement(draw))
    assert replay["replay"] is True and replay["draw"]["seed"] == draw["seed"] and replay["draw"]["number"] == 1
    assert await flow.db.audit_logs.count_documents({"action": "league.draw.create"}) == 1


@pytest.mark.asyncio
async def test_the_stored_draw_is_the_pure_function_of_inputs_and_seed(flow):
    w = await world(flow, teams=7, staffeln=3)
    draw = await drawn(flow, w)
    entries = [{"key": side["squad"]["id"], "team_id": side["team"]["id"]} for side in w["teams"]]
    groups = [{"id": tid, "staffel": letter, "capacity": 16, "team_ids": []} for tid, letter in zip(w["tids"], "ABC")]
    assert placement(draw) == league_staffel_plan.draw(entries, groups, draw["seed"])["placements"]
    sizes = sorted(staffel["size"] for staffel in draw["staffeln"])
    assert sizes == [2, 2, 3]


@pytest.mark.asyncio
async def test_sibling_squads_are_drawn_into_different_staffeln(flow):
    w = await world(flow, teams=3)
    twin = await twin_of(flow, w, w["teams"][0])
    for _ in range(4):
        found = placement(await drawn(flow, w))
        assert found[w["teams"][0]["squad"]["id"]] != found[twin["squad"]["id"]]
        ok(await flow.post(draws_url(w, w["division"], "redraw"), json={"reason": "Probe mit neuem Seed"}))


@pytest.mark.asyncio
async def test_the_draw_fills_up_around_seated_teams(flow):
    w = await world(flow, teams=5)
    first = w["applications"][0]
    ok(await decide(flow, w, first, "assign", tournament_id=w["tids"][0]))
    draw = await drawn(flow, w)
    sizes = {staffel["tournament_id"]: staffel["size"] for staffel in draw["staffeln"]}
    assert sizes == {w["tids"][0]: 3, w["tids"][1]: 2}
    assert w["teams"][0]["squad"]["id"] not in placement(draw)  # wer schon zugeteilt ist, wird nicht gelost


@pytest.mark.asyncio
async def test_the_draw_stays_out_of_the_season_page_and_the_division_answer(flow):
    """Das Los trägt Teamnamen und wer was getan hat: Es steht nur unter ``…/draws`` (Zuständigkeit „Anmeldungen“)."""
    w = await world(flow)
    await drawn(flow, w)
    page = ok(await flow.get(f"{ADMIN_LEAGUES}/seasons/{w['season']['id']}"))
    assert all("draw" not in row for row in page["divisions"])
    saved = ok(await flow.patch(f"{ADMIN_LEAGUES}/divisions/{w['division']['id']}", json={"nickname": "Elite"}))
    assert "draw" not in saved and saved["nickname"] == "Elite"
    # Gegenprobe: Gespeichert ist es weiter, das Bearbeiten der Liga N nimmt es nicht weg.
    assert (await division_view(flow, w))["draw"]["status"] == "draft"


# ---------------------------------------------------------------- Wiederholen und Tausch

@pytest.mark.asyncio
async def test_redrawing_needs_a_reason_and_is_logged(flow):
    w = await world(flow)
    draw = await drawn(flow, w)
    bare = await flow.post(draws_url(w, w["division"], "redraw"), json={})
    assert bare.status_code == 422 and "Grund" in bare.json()["detail"]
    again = ok(await flow.post(draws_url(w, w["division"], "redraw"), json={"reason": "Falsche Staffelzahl beim ersten Los"}))["draw"]
    assert again["number"] == 2 and again["seed"] != draw["seed"]
    log = await flow.db.audit_logs.find_one({"action": "league.draw.redraw"}, {"_id": 0})
    assert log["target_id"] == w["season"]["id"] and log["actor_id"] == w["lead"]["id"]
    assert log["data"]["reason"] == "Falsche Staffelzahl beim ersten Los" and log["data"]["number"] == 2 and log["data"]["division_id"] == w["division"]["id"]
    assert [step["action"] for step in again["log"]] == ["create", "redraw"]


@pytest.mark.asyncio
async def test_a_changed_input_makes_the_draw_stale_and_a_new_one_needs_no_reason(flow):
    w = await world(flow, teams=4)
    draw = await drawn(flow, w)
    late = await add_team(flow, w, "TeamSpaet")
    ok(await decide(flow, w, await submitted(flow, w, late), "accept"))
    view = await division_view(flow, w)
    assert view["draw"]["stale"] is True
    refused = await flow.post(draws_url(w, w["division"], "apply"), json={"fingerprint": draw["fingerprint"], "confirm": True})
    assert refused.status_code == 409 and "neu auslosen" in refused.json()["detail"]
    assert await flow.db.tournament_registrations.count_documents({"tournament_id": {"$in": w["tids"]}}) == 0
    fresh = ok(await flow.post(draws_url(w, w["division"]), json={}))
    assert fresh["replay"] is False and fresh["draw"]["number"] == 2 and fresh["draw"]["stale"] is False
    assert late["squad"]["id"] in placement(fresh["draw"])


@pytest.mark.asyncio
@pytest.mark.parametrize("change", ["rejected", "assigned_by_hand", "staffel_smaller"])
async def test_a_draw_on_changed_ground_is_not_applied(flow, change):
    """Fällt ein Co-Team weg, steht eines schon von Hand in einer Staffel oder ändert sich eine Staffel, gilt das Los nicht mehr -
    auch wenn jedes übrige Co-Team für sich noch zuteilbar wäre."""
    w = await world(flow, teams=5)
    draw = await drawn(flow, w)
    first = w["applications"][0]
    if change == "rejected":
        ok(await decide(flow, w, first, "reject", reason="Team hat abgesagt"))
    elif change == "assigned_by_hand":
        ok(await decide(flow, w, first, "assign", tournament_id=w["tids"][0]))
    else:
        await flow.db.tournaments.update_one({"id": w["tids"][1]}, {"$set": {"max_participants": 4}})
    before = await flow.db.tournament_registrations.count_documents({"tournament_id": {"$in": w["tids"]}})
    assert (await division_view(flow, w))["draw"]["stale"] is True
    refused = await flow.post(draws_url(w, w["division"], "apply"), json={"fingerprint": draw["fingerprint"], "confirm": True})
    assert refused.status_code == 409 and "neu auslosen" in refused.json()["detail"]
    assert await flow.db.tournament_registrations.count_documents({"tournament_id": {"$in": w["tids"]}}) == before
    swap = await flow.post(draws_url(w, w["division"], "swap"), json={"squad_id": "x", "other_squad_id": "y", "reason": REASON})
    assert swap.status_code == 409


@pytest.mark.asyncio
async def test_swapping_needs_a_reason_and_exchanges_two_teams(flow):
    w = await world(flow, teams=4)
    draw = await drawn(flow, w)
    found = placement(draw)
    left = next(squad for squad, tid in found.items() if tid == w["tids"][0])
    right = next(squad for squad, tid in found.items() if tid == w["tids"][1])
    bare = await flow.post(draws_url(w, w["division"], "swap"), json={"squad_id": left, "other_squad_id": right})
    assert bare.status_code == 422 and "Grund" in bare.json()["detail"]
    same = next(squad for squad, tid in found.items() if tid == w["tids"][0] and squad != left)
    assert (await flow.post(draws_url(w, w["division"], "swap"), json={"squad_id": left, "other_squad_id": same, "reason": REASON})).status_code == 422
    swapped = ok(await flow.post(draws_url(w, w["division"], "swap"), json={"squad_id": left, "other_squad_id": right, "reason": REASON}))["draw"]
    after = placement(swapped)
    assert (after[left], after[right]) == (w["tids"][1], w["tids"][0])
    assert swapped["seed"] == draw["seed"] and swapped["fingerprint"] != draw["fingerprint"]
    assert swapped["swaps"][0]["reason"] == REASON and swapped["swaps"][0]["by_name"]
    assert {team["squad_id"] for staffel in swapped["staffeln"] for team in staffel["teams"] if team["swapped"]} == {left, right}
    log = await flow.db.audit_logs.find_one({"action": "league.draw.swap"}, {"_id": 0})
    assert log["data"]["reason"] == REASON and sorted(log["data"]["squad_ids"]) == sorted([left, right])
    # Die Vorschau bleibt Vorschau.
    assert await assignments(flow, w) == {}


@pytest.mark.asyncio
async def test_a_swap_never_puts_siblings_into_one_staffel(flow):
    w = await world(flow, teams=3)
    twin = await twin_of(flow, w, w["teams"][0])
    found = placement(await drawn(flow, w))
    first, second = w["teams"][0]["squad"]["id"], twin["squad"]["id"]
    partner = next(squad for squad, tid in found.items() if tid == found[second] and squad != second)
    refused = await flow.post(draws_url(w, w["division"], "swap"), json={"squad_id": first, "other_squad_id": partner, "reason": REASON})
    assert refused.status_code == 422 and "Hauptteams" in refused.json()["detail"]
    assert placement((await division_view(flow, w))["draw"]) == found


@pytest.mark.asyncio
async def test_discarding_removes_the_draft(flow):
    w = await world(flow)
    await drawn(flow, w)
    # Verwerfen und danach neu auslosen wäre sonst ein Wiederholen ohne Grund.
    bare = await flow.post(draws_url(w, w["division"], "discard"), json={})
    assert bare.status_code == 422 and (await division_view(flow, w))["draw"] is not None
    ok(await flow.post(draws_url(w, w["division"], "discard"), json={"reason": "Wir teilen diesmal von Hand zu"}))
    assert (await division_view(flow, w))["draw"] is None
    log = await flow.db.audit_logs.find_one({"action": "league.draw.discard"}, {"_id": 0})
    assert log["data"]["reason"] == "Wir teilen diesmal von Hand zu"


# ---------------------------------------------------------------- Übernehmen

@pytest.mark.asyncio
async def test_applying_assigns_every_team_once_and_tells_them(flow):
    w = await world(flow)
    draw = await drawn(flow, w)
    bare = await flow.post(draws_url(w, w["division"], "apply"), json={"fingerprint": draw["fingerprint"]})
    assert bare.status_code == 422
    wrong = await flow.post(draws_url(w, w["division"], "apply"), json={"fingerprint": "anders", "confirm": True})
    assert wrong.status_code == 409 and await assignments(flow, w) == {}
    done = ok(await flow.post(draws_url(w, w["division"], "apply"), json={"fingerprint": draw["fingerprint"], "confirm": True}))
    assert done["assigned"] == 5 and done["draw"]["status"] == "applied"
    assert await assignments(flow, w) == placement(draw)
    regs = await flow.db.tournament_registrations.find({"tournament_id": {"$in": w["tids"]}}, {"_id": 0}).to_list(20)
    assert {row["squad_id"]: row["tournament_id"] for row in regs} == placement(draw)
    assert all(row["status"] == "approved" and row["registered_via"] == "league_application" for row in regs)
    stored = await flow.db.league_applications.find_one({"id": w["applications"][0]["id"]}, {"_id": 0})
    assert stored["assignment"]["draw_id"] == draw["id"]
    for side in w["teams"]:
        assert await flow.db.notifications.count_documents({"user_id": side["captain"]["id"], "meta.reason": "league_application_assigned"}) == 1
    log = await flow.db.audit_logs.find_one({"action": "league.draw.apply"}, {"_id": 0})
    assert log["data"]["seed"] == draw["seed"] and log["data"]["placements"] == placement(draw)
    assert await flow.db.audit_logs.count_documents({"action": "league.application.assign", "data.draw_id": draw["id"]}) == 5
    # Zweimal übernehmen: nichts doppelt.
    again = await flow.post(draws_url(w, w["division"], "apply"), json={"fingerprint": draw["fingerprint"], "confirm": True})
    assert again.status_code == 409
    assert await flow.db.tournament_registrations.count_documents({"tournament_id": {"$in": w["tids"]}}) == 5
    view = await division_view(flow, w)
    assert view["waiting"] == [] and view["draw"]["status"] == "applied"


@pytest.mark.asyncio
async def test_applying_resumes_after_an_abort(flow, monkeypatch):
    w = await world(flow)
    draw = await drawn(flow, w)
    real = applications._place
    calls = {"count": 0}

    async def broken(*args, **kwargs):
        calls["count"] += 1
        if calls["count"] == 3:
            raise RuntimeError("Abbruch mitten im Übernehmen")
        return await real(*args, **kwargs)

    monkeypatch.setattr(applications, "_place", broken)
    league, season = await leagues.get_league(flow.db, w["league"]["id"]), await leagues.get_season(flow.db, w["season"]["id"])
    with pytest.raises(RuntimeError):
        await league_draw.apply(flow.db, league, season, w["division"]["id"], {"fingerprint": draw["fingerprint"], "confirm": True}, w["lead"],
                                refresh_previews=no_preview)
    assert len(await assignments(flow, w)) == 2
    monkeypatch.setattr(applications, "_place", real)
    # Die Vorschau gilt weiter (die zwei stehen, wo das Los sie hinsetzte), der zweite Versuch setzt nur noch die übrigen.
    view = await division_view(flow, w)
    assert view["draw"]["stale"] is False and view["draw"]["fingerprint"] == draw["fingerprint"]
    done = ok(await flow.post(draws_url(w, w["division"], "apply"), json={"fingerprint": draw["fingerprint"], "confirm": True}))
    assert done["assigned"] == 3
    assert await assignments(flow, w) == placement(draw)
    assert await flow.db.tournament_registrations.count_documents({"tournament_id": {"$in": w["tids"]}}) == 5
    for side in w["teams"]:
        assert await flow.db.notifications.count_documents({"user_id": side["captain"]["id"], "meta.reason": "league_application_assigned"}) == 1


@pytest.mark.asyncio
async def test_after_an_abort_seated_teams_stay_where_they_are(flow, monkeypatch):
    """Nach einem abgebrochenen Übernehmen steht ein Teil schon in seiner Staffel: Diese Co-Teams tauschen nicht mehr, und ein neues Los
    verteilt nur die übrigen um sie herum."""
    w = await world(flow, teams=6)
    draw = await drawn(flow, w)
    real = applications._place
    calls = {"count": 0}

    async def broken(*args, **kwargs):
        calls["count"] += 1
        if calls["count"] == 3:
            raise RuntimeError("Abbruch mitten im Übernehmen")
        return await real(*args, **kwargs)

    monkeypatch.setattr(applications, "_place", broken)
    league, season = await leagues.get_league(flow.db, w["league"]["id"]), await leagues.get_season(flow.db, w["season"]["id"])
    with pytest.raises(RuntimeError):
        await league_draw.apply(flow.db, league, season, w["division"]["id"], {"fingerprint": draw["fingerprint"], "confirm": True}, w["lead"],
                                refresh_previews=no_preview)
    monkeypatch.setattr(applications, "_place", real)
    seated = await assignments(flow, w)
    assert len(seated) == 2
    view = (await division_view(flow, w))["draw"]
    teams = {team["squad_id"]: (staffel["tournament_id"], team["done"]) for staffel in view["staffeln"] for team in staffel["teams"]}
    assert {squad for squad, (_tid, done) in teams.items() if done} == set(seated)
    fixed = next(iter(seated))
    partner = next(squad for squad, (tid, done) in teams.items() if not done and tid != teams[fixed][0])
    refused = await flow.post(draws_url(w, w["division"], "swap"), json={"squad_id": fixed, "other_squad_id": partner, "reason": REASON})
    assert refused.status_code == 409 and "schon zugeteilt" in refused.json()["detail"]
    again = ok(await flow.post(draws_url(w, w["division"], "redraw"), json={"reason": "Nach dem Abbruch neu verteilen"}))["draw"]
    assert again["stale"] is False and set(placement(again)) == {side["squad"]["id"] for side in w["teams"]} - set(seated)
    assert sorted(staffel["size"] for staffel in again["staffeln"]) == [3, 3]
    ok(await flow.post(draws_url(w, w["division"], "apply"), json={"fingerprint": again["fingerprint"], "confirm": True}))
    final = await assignments(flow, w)
    assert len(final) == 6 and all(final[squad] == seated[squad] for squad in seated)
    assert await flow.db.tournament_registrations.count_documents({"tournament_id": {"$in": w["tids"]}}) == 6


@pytest.mark.asyncio
async def test_applying_checks_every_team_before_it_writes(flow):
    w = await world(flow, teams=4)
    draw = await drawn(flow, w)
    # Ein Kader schrumpft nach dem Los unter den Mindestkader: Übernehmen sagt, wer nicht geht, und schreibt nichts.
    side = w["teams"][2]
    await flow.db.team_squads.update_one({"id": side["squad"]["id"]}, {"$set": {"member_ids": [side["captain"]["id"]]}})
    refused = await flow.post(draws_url(w, w["division"], "apply"), json={"fingerprint": draw["fingerprint"], "confirm": True})
    assert refused.status_code == 409 and side["squad"]["name"] in refused.json()["detail"]
    assert await assignments(flow, w) == {}
    assert await flow.db.tournament_registrations.count_documents({"tournament_id": {"$in": w["tids"]}}) == 0


# ---------------------------------------------------------------- Was nicht geht

@pytest.mark.asyncio
async def test_one_staffel_is_not_drawn(flow):
    w = await world(flow, teams=3, staffeln=1)
    view = await division_view(flow, w)
    assert view["can_draw"] is False and "nur eine Staffel" in view["problem"]
    assert (await flow.post(draws_url(w, w["division"]), json={})).status_code == 409


@pytest.mark.asyncio
async def test_too_many_teams_are_named_instead_of_overfilling(flow):
    w = await world(flow, teams=5, staffeln=2, max_staffel_size=2)
    view = await division_view(flow, w)
    assert view["suggestion"]["fits"] is False and view["suggestion"]["needed"] == 3 and "fehlt" in view["suggestion"]["text"]
    refused = await flow.post(draws_url(w, w["division"]), json={})
    assert refused.status_code == 409 and "freie Plätze" in refused.json()["detail"]


@pytest.mark.asyncio
async def test_a_staffel_with_a_fixed_plan_blocks_the_draw(flow):
    w = await world(flow, teams=3)
    await flow.db.matches_v2.insert_one({"id": new_id(), "tournament_id": w["tids"][0], "is_preview": False, "status": "ready", "slots": []})
    view = await division_view(flow, w)
    assert view["can_draw"] is False and "Spielplan" in view["problem"]
    assert (await flow.post(draws_url(w, w["division"]), json={})).status_code == 409


@pytest.mark.asyncio
async def test_more_siblings_than_staffeln_are_named(flow):
    w = await world(flow, teams=2)
    side = w["teams"][0]
    await twin_of(flow, w, side)
    extra = [await flow.add_user(name=f"Dritt {index}") for index in range(4)]
    await flow.db.teams.update_one({"id": side["team"]["id"]}, {"$addToSet": {"member_ids": {"$each": [user["id"] for user in extra]}}})
    squad = await make_squad(flow, side["team"], "Dritte Reihe", extra, captain=extra[0], vice=extra[1], game_id=w["game"]["id"])
    ok(await decide(flow, w, await submitted(flow, w, {**side, "squad": squad, "captain": extra[0]}), "accept"))
    flow.act_as(w["lead"])
    refused = await flow.post(draws_url(w, w["division"]), json={})
    assert refused.status_code == 409 and side["team"]["name"] in refused.json()["detail"]


# ---------------------------------------------------------------- Rechte und Befangenheit

async def staff_of(flow, w: dict, person: dict) -> dict:
    await flow.db.league_staff.insert_one({"id": new_id(), "league_id": w["league"]["id"], "user_id": person["id"], "capabilities": ["applications"],
                                           "created_at": now_utc().isoformat(), "created_by": "test"})
    return person


@pytest.mark.asyncio
async def test_only_the_applications_duty_may_draw(flow):
    w = await world(flow)
    flow.act_as(w["teams"][0]["captain"])
    assert (await flow.get(draws_url(w))).status_code == 403
    assert (await flow.post(draws_url(w, w["division"]), json={})).status_code == 403
    flow.act_as(None)
    assert (await flow.get(draws_url(w))).status_code == 401


@pytest.mark.asyncio
async def test_someone_with_a_team_in_the_pool_cannot_draw_swap_or_apply(flow):
    w = await world(flow, teams=4)
    draw = await drawn(flow, w)
    found = placement(draw)
    left = next(squad for squad, tid in found.items() if tid == w["tids"][0])
    right = next(squad for squad, tid in found.items() if tid == w["tids"][1])
    insider = await staff_of(flow, w, w["teams"][1]["captain"])
    flow.act_as(insider)
    view = ok(await flow.get(draws_url(w)))["divisions"][0]
    assert view["own_team"] is True
    for action, body in (("", {}), ("redraw", {"reason": REASON}), ("swap", {"squad_id": left, "other_squad_id": right, "reason": REASON}),
                         ("apply", {"fingerprint": draw["fingerprint"], "confirm": True}), ("discard", {})):
        refused = await flow.post(draws_url(w, w["division"], action), json=body)
        assert refused.status_code == 403, action
    assert (await division_view(flow, w))["draw"]["fingerprint"] == draw["fingerprint"]
    assert await assignments(flow, w) == {}
    # Notausnahme: Der Superadmin geht mit Grund durch, und das steht im Protokoll.
    boss = {**w["teams"][1]["lead"], "role": "superadmin"}
    flow.act_as(boss)
    assert (await flow.post(draws_url(w, w["division"], "apply"), json={"fingerprint": draw["fingerprint"], "confirm": True})).status_code == 403
    ok(await flow.post(draws_url(w, w["division"], "apply"),
                       json={"fingerprint": draw["fingerprint"], "confirm": True, "conflict_reason": "Niemand sonst erreichbar, Start morgen"}))
    override = await flow.db.audit_logs.find_one({"action": "league.conflict.override", "data.action": "draw_apply"}, {"_id": 0})
    assert override["actor_id"] == boss["id"] and override["data"]["reason"] == "Niemand sonst erreichbar, Start morgen"


# ---------------------------------------------------------------- Gleichzeitig

async def attempt(coroutine):
    try:
        return await coroutine
    except LeagueProblem as problem:
        return problem.status


@pytest.mark.asyncio
async def test_two_draws_at_once_leave_one_seed(flow):
    w = await world(flow)
    league, season = await leagues.get_league(flow.db, w["league"]["id"]), await leagues.get_season(flow.db, w["season"]["id"])
    results = await asyncio.gather(*(attempt(league_draw.create(flow.db, league, season, w["division"]["id"], {}, w["lead"])) for _ in range(4)))
    seeds = {result["draw"]["seed"] for result in results if isinstance(result, dict)}
    assert len(seeds) == 1 and all(isinstance(result, dict) or result == 409 for result in results)
    assert len([result for result in results if isinstance(result, dict) and not result["replay"]]) == 1
    assert await flow.db.audit_logs.count_documents({"action": "league.draw.create"}) == 1


@pytest.mark.asyncio
async def test_two_applies_at_once_assign_every_team_once(flow):
    w = await world(flow, teams=6)
    draw = await drawn(flow, w)
    league, season = await leagues.get_league(flow.db, w["league"]["id"]), await leagues.get_season(flow.db, w["season"]["id"])
    body = {"fingerprint": draw["fingerprint"], "confirm": True}
    results = await asyncio.gather(*(attempt(league_draw.apply(flow.db, league, season, w["division"]["id"], body, w["lead"], refresh_previews=no_preview))
                                     for _ in range(3)))
    assert len([result for result in results if isinstance(result, dict)]) == 1
    assert all(isinstance(result, dict) or result == 409 for result in results)
    assert await assignments(flow, w) == placement(draw)
    assert await flow.db.tournament_registrations.count_documents({"tournament_id": {"$in": w["tids"]}}) == 6
    for side in w["teams"]:
        assert await flow.db.notifications.count_documents({"user_id": side["captain"]["id"], "meta.reason": "league_application_assigned"}) == 1


@pytest.mark.asyncio
async def test_assigning_by_hand_while_applying_never_doubles_a_team(flow):
    w = await world(flow, teams=4)
    draw = await drawn(flow, w)
    league, season = await leagues.get_league(flow.db, w["league"]["id"]), await leagues.get_season(flow.db, w["season"]["id"])
    body = {"fingerprint": draw["fingerprint"], "confirm": True}
    first = w["applications"][0]
    await asyncio.gather(
        attempt(league_draw.apply(flow.db, league, season, w["division"]["id"], body, w["lead"], refresh_previews=no_preview)),
        attempt(applications.assign(flow.db, league, season, first["id"], w["tids"][0], w["lead"], refresh_previews=no_preview)))
    regs = await flow.db.tournament_registrations.find({"tournament_id": {"$in": w["tids"]}}, {"_id": 0, "squad_id": 1}).to_list(20)
    squads = [row["squad_id"] for row in regs]
    assert len(squads) == len(set(squads)) and w["teams"][0]["squad"]["id"] in squads
    assert set(await assignments(flow, w)) == set(squads)


@pytest.mark.asyncio
async def test_a_new_draw_after_an_applied_one_keeps_the_old_log(flow):
    """Kommt nach dem Zuteilen noch ein Co-Team dazu, lost die Leitung noch einmal: Der Verlauf des ersten Loses bleibt stehen."""
    w = await world(flow, teams=4)
    draw = await drawn(flow, w)
    ok(await flow.post(draws_url(w, w["division"], "apply"), json={"fingerprint": draw["fingerprint"], "confirm": True}))
    for name in ("TeamSpaetEins", "TeamSpaetZwei"):
        late = await add_team(flow, w, name)
        ok(await decide(flow, w, await submitted(flow, w, late), "accept"))
    second = ok(await flow.post(draws_url(w, w["division"]), json={}))["draw"]
    assert second["number"] == 2 and second["status"] == "draft" and len(placement(second)) == 2
    assert [step["action"] for step in second["log"]] == ["create", "apply", "create"]
    assert [step.get("number") for step in second["log"]] == [1, None, 2]
