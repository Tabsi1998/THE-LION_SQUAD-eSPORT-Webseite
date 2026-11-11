"""Anmeldungen je Season automatisch annehmen (docs/LIGA.md, B.4, #2348, Entscheidung Nr. 126). Erfundene Namen.

Aus (Vorgabe): wie bisher, jede Anmeldung bleibt „eingereicht“, bis die Leitung entscheidet. An: Eine gültige Anmeldung ist beim Einreichen angenommen und
belegt einen Startplatz; sind alle vergeben (oder wartet schon jemand), steht sie auf der Warteliste. Mit nur einer Staffel ist sie gleich zugeteilt.
"""
import asyncio
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from league_application_world import application_world, base_url, decide, inbox_url, submit, submitted  # noqa: E402
from league_rules_world import ADMIN_LEAGUES  # noqa: E402
from league_start_world import ok  # noqa: E402
from models import now_utc  # noqa: E402
from services import league_applications as applications  # noqa: E402
from services.league_service import LeagueProblem  # noqa: E402
from squad_world import make_squad  # noqa: E402

AUTO = {"application_auto_accept": True}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def stored(flow, application: dict) -> dict:
    return await flow.db.league_applications.find_one({"id": application["id"]}, {"_id": 0})


async def inbox(flow, w: dict) -> dict:
    flow.act_as(w["lead"])
    return ok(await flow.get(inbox_url(w)))


async def reasons(flow, user: dict) -> list[str]:
    """Nur die Nachrichten zum Antrag - Hinweise auf fehlende Angaben (#2313) und Spiel-IDs gehen daneben weiter."""
    rows = await flow.db.notifications.find({"user_id": user["id"], "meta.reason": {"$regex": "^league_application_"}}, {"_id": 0}).to_list(50)
    return sorted(row["meta"]["reason"] for row in rows)


async def no_preview(_db, _tournament, _actor_id):
    return None


async def attempt(coroutine):
    try:
        return (await coroutine)["status"]
    except LeagueProblem as problem:
        return problem.status


async def my_row(flow, w: dict, side: dict) -> dict:
    flow.act_as(side["captain"])
    view = ok(await flow.get(f"{base_url(w)}/application"))
    return next(row for row in view["squads"] if row["squad_id"] == side["squad"]["id"])


async def holder(flow, w: dict, capabilities: list[str]) -> dict:
    user = await flow.add_user(name=f"Zuständig {new_id()[:6]}")
    await flow.db.league_staff.insert_one({"id": new_id(), "league_id": w["league"]["id"], "user_id": user["id"], "capabilities": capabilities,
                                           "created_at": now_utc().isoformat(), "created_by": "test"})
    return user


# ---------------------------------------------------------------- Aus und an

@pytest.mark.asyncio
async def test_switched_off_the_application_waits_for_the_lead(flow):
    w = await application_world(flow, teams=1)
    side = w["teams"][0]

    answer = await submitted(flow, w, side)

    assert answer["status"] == "submitted"
    assert (await stored(flow, answer))["status"] == "submitted" and "auto_accepted" not in await stored(flow, answer)
    assert await flow.db.tournament_registrations.count_documents({"squad_id": side["squad"]["id"]}) == 0
    assert await reasons(flow, side["captain"]) == ["league_application_submitted"]
    assert await flow.db.audit_logs.find_one({"action": {"$in": ["league.application.auto_accept", "league.application.auto_waitlist"]}}, {"_id": 1}) is None
    flow.act_as(None)
    assert ok(await flow.get(base_url(w)))["application"]["auto_accept"] is False


@pytest.mark.asyncio
async def test_switched_on_with_one_staffel_the_squad_is_accepted_and_assigned(flow):
    w = await application_world(flow, teams=1, application_slots=4, one_team_per_season=True, **AUTO)
    side = w["teams"][0]

    answer = await submitted(flow, w, side)

    assert answer["status"] == "accepted" and answer["staffel"] == "Liga 1 · Staffel A"
    row = await stored(flow, answer)
    assert row["auto_accepted"] is True and row["decided_by"] is None and row["decided_at"]
    assert row["assignment"]["auto"] is True and row["assignment"]["tournament_id"] == w["tid"] and row["assignment"]["assigned_by"] is None
    assert [step["status"] for step in row["history"]] == ["submitted", "accepted"]
    assert row["history"][1]["auto"] is True and row["history"][1]["by"] is None
    reg = await flow.db.tournament_registrations.find_one({"squad_id": side["squad"]["id"]}, {"_id": 0})
    assert reg["status"] == "approved" and reg["tournament_id"] == w["tid"] and reg["application_id"] == answer["id"]
    assert reg["registered_via"] == "league_application" and reg["registered_by"] == side["captain"]["id"] and reg["created_by"] is None
    assert reg["accepted_rules"] is True and reg["league_squad_key"] == f"{w['season']['id']}:{side['squad']['id']}"
    assert await flow.db.league_rosters.count_documents({"season_id": w["season"]["id"]}) == 4, "der Kader steht wie beim Zuteilen fest"
    # Protokoll und Nachrichten: „automatisch angenommen“, das Team hört die übliche Annahme, die Leitung erfährt es.
    entry = await flow.db.audit_logs.find_one({"action": "league.application.auto_accept"}, {"_id": 0})
    assert entry["actor_id"] is None and entry["data"]["tournament_id"] == w["tid"] and entry["data"]["application_id"] == answer["id"]
    assert await flow.db.audit_logs.find_one({"action": "league.application.submit"}, {"_id": 1})
    assert await reasons(flow, side["captain"]) == ["league_application_accepted"]
    note = await flow.db.notifications.find_one({"user_id": side["captain"]["id"], "meta.reason": "league_application_accepted"}, {"_id": 0})
    assert note["title"] == "Anmeldung angenommen" and "Liga 1 · Staffel A" in note["body"]
    lead_note = await flow.db.notifications.find_one({"user_id": w["lead"]["id"], "meta.reason": "league_application_accepted"}, {"_id": 0})
    assert "automatisch angenommen" in lead_note["body"] and lead_note["url"].endswith("#anmeldungen")
    # Startplätze zählen die Angenommene, die Ligaseite zeigt den Stand.
    flow.act_as(None)
    assert ok(await flow.get(base_url(w)))["application"]["slots_free"] == 3
    mine = await my_row(flow, w, side)
    assert mine["state"] == "accepted" and mine["application"]["staffel"] == "Liga 1 · Staffel A"
    items = (await inbox(flow, w))["items"]
    assert items[0]["auto_accepted"] is True and items[0]["history"][1]["by_name"] == "automatisch" and items[0]["history"][1]["auto"] is True


async def second_division(flow, w: dict, *, with_staffel: bool = True) -> str | None:
    flow.act_as(w["lead"])
    division = ok(await flow.post(f"{ADMIN_LEAGUES}/seasons/{w['season']['id']}/divisions", json={}))
    if not with_staffel:
        return None
    return ok(await flow.post(f"{ADMIN_LEAGUES}/divisions/{division['id']}/staffeln", json={}))["tournament_id"]


@pytest.mark.asyncio
@pytest.mark.parametrize("shape", ["two_staffeln", "two_divisions", "second_division_without_staffel"])
async def test_with_several_staffeln_the_lead_assigns(flow, shape):
    """Automatisch zugeteilt wird nur bei genau einer aktiven Liga N mit genau einer Staffel - auch eine zweite Liga N ohne Staffel lässt die Wahl der Leitung."""
    w = await application_world(flow, teams=1, staffeln=2 if shape == "two_staffeln" else 1, **AUTO)
    if shape != "two_staffeln":
        await second_division(flow, w, with_staffel=shape == "two_divisions")
    side = w["teams"][0]

    answer = await submitted(flow, w, side)

    assert answer["status"] == "accepted" and answer["staffel"] is None
    assert "assignment" not in await stored(flow, answer)
    assert await flow.db.tournament_registrations.count_documents({"squad_id": side["squad"]["id"]}) == 0
    note = await flow.db.notifications.find_one({"user_id": side["captain"]["id"], "meta.reason": "league_application_accepted"}, {"_id": 0})
    assert "Liga und Staffel teilt die Liga-Leitung noch zu" in note["body"]
    stats = (await inbox(flow, w))["stats"]
    assert stats["unassigned"] == 1 and stats["taken"] == 1
    # Die Leitung teilt wie bisher zu - danach ist es eine Zuteilung der Leitung.
    assigned = ok(await decide(flow, w, answer, "assign", tournament_id=w["tid"]))
    assert assigned["assignment"]["tournament_id"] == w["tid"] and "auto" not in assigned["assignment"]


@pytest.mark.asyncio
async def test_a_staffel_that_already_started_is_not_assigned_automatically(flow):
    w = await application_world(flow, teams=1, **AUTO)
    await flow.db.tournaments.update_one({"id": w["tid"]}, {"$set": {"status": "live"}})

    answer = await submitted(flow, w, w["teams"][0])

    assert answer["status"] == "accepted" and "assignment" not in await stored(flow, answer)
    # Der Grund steht am Antrag, im Eingang und im Hinweis an die Leitung (Review #2348).
    assert (await stored(flow, answer))["auto_problem"] == applications.AUTO_STAFFEL_STARTED
    assert (await inbox(flow, w))["items"][0]["auto_problem"] == applications.AUTO_STAFFEL_STARTED
    lead_note = await flow.db.notifications.find_one({"user_id": w["lead"]["id"], "meta.reason": "league_application_accepted"}, {"_id": 0})
    assert f"Automatisch zuteilen ging nicht: {applications.AUTO_STAFFEL_STARTED}" in lead_note["body"]


@pytest.mark.asyncio
async def test_a_full_staffel_leaves_the_squad_accepted_without_staffel_and_names_the_reason(flow):
    w = await application_world(flow, teams=2, **AUTO)
    await flow.db.tournaments.update_one({"id": w["tid"]}, {"$set": {"max_participants": 1}})
    direct = w["teams"][1]
    flow.act_as(w["lead"])
    ok(await flow.post(f"/api/tournaments/{w['tid']}/squad-registrations", json={"team_id": direct["team"]["id"], "squad_id": direct["squad"]["id"]}))

    answer = await submitted(flow, w, w["teams"][0])

    row = await stored(flow, answer)
    assert answer["status"] == "accepted" and "assignment" not in row and row["auto_problem"]
    assert await flow.db.tournament_registrations.count_documents({"squad_id": w["teams"][0]["squad"]["id"]}) == 0
    entry = await flow.db.audit_logs.find_one({"action": "league.application.auto_accept"}, {"_id": 0})
    assert entry["data"]["problem"] == row["auto_problem"]
    lead_note = await flow.db.notifications.find_one({"user_id": w["lead"]["id"], "meta.reason": "league_application_accepted"}, {"_id": 0})
    assert f"Automatisch zuteilen ging nicht: {row['auto_problem']}" in lead_note["body"]
    # Teilt die Leitung später zu, ist der Grund erledigt.
    await flow.db.tournaments.update_one({"id": w["tid"]}, {"$set": {"max_participants": 8}})
    ok(await decide(flow, w, answer, "assign", tournament_id=w["tid"]))
    assert "auto_problem" not in await stored(flow, answer)


async def second_squad(flow, w: dict, side: dict) -> dict:
    extra = [await flow.add_user(name=f"Zweit {index}") for index in range(4)]
    await flow.db.teams.update_one({"id": side["team"]["id"]}, {"$addToSet": {"member_ids": {"$each": [user["id"] for user in extra]}}})
    squad = await make_squad(flow, side["team"], "Zweite Reihe", extra, captain=extra[0], vice=extra[1], game_id=w["game"]["id"])
    return {**side, "squad": squad, "captain": extra[0], "vice": extra[1], "member": extra[3], "people": extra}


@pytest.mark.asyncio
@pytest.mark.parametrize("siblings_allowed", [False, True])
async def test_a_sibling_squad_in_the_only_staffel_is_not_accepted_automatically(flow, siblings_allowed):
    w = await application_world(flow, teams=1, sibling_squads_in_staffel=siblings_allowed, **AUTO)
    side = w["teams"][0]
    twin = await second_squad(flow, w, side)
    assert (await submitted(flow, w, side))["status"] == "accepted"

    answer = await submitted(flow, w, twin)

    if siblings_allowed:
        assert answer["status"] == "accepted" and answer["staffel"] == "Liga 1 · Staffel A", "Gegenprobe: erlaubt die Season zwei Co-Teams, geht es"
        return
    assert answer["status"] == "submitted"
    row = await stored(flow, answer)
    assert "hat schon ein Co-Team in der einzigen Staffel" in row["auto_problem"] and "auto_accepted" not in row
    assert await flow.db.tournament_registrations.count_documents({"squad_id": twin["squad"]["id"]}) == 0
    assert await flow.db.audit_logs.count_documents({"action": "league.application.auto_accept"}) == 1
    lead_note = await flow.db.notifications.find_one({"user_id": w["lead"]["id"], "meta.reason": "league_application_submitted"}, {"_id": 0})
    assert "Automatisch annehmen ging nicht" in lead_note["body"] and "einzigen Staffel" in lead_note["body"]
    assert await reasons(flow, twin["captain"]) == ["league_application_submitted"]
    item = next(item for item in (await inbox(flow, w))["items"] if item["id"] == answer["id"])
    assert "einzigen Staffel" in item["auto_problem"]
    # Entscheidet die Leitung, ist der Grund erledigt.
    ok(await decide(flow, w, answer, "review"))
    assert "auto_problem" not in await stored(flow, answer)


# ---------------------------------------------------------------- Unerwartete Fehler kippen das Einreichen nicht

@pytest.mark.asyncio
async def test_an_unexpected_error_leaves_the_application_submitted(flow, monkeypatch):
    w = await application_world(flow, teams=1, **AUTO)
    side = w["teams"][0]

    async def broken(*_args, **_kwargs):
        raise RuntimeError("Datenbank weg")

    monkeypatch.setattr(applications, "_place", broken)
    answer = await submit(flow, w, side)

    assert answer.status_code == 200, answer.text
    assert answer.json()["status"] == "submitted"
    row = await flow.db.league_applications.find_one({"squad_id": side["squad"]["id"]}, {"_id": 0})
    assert row["status"] == "submitted" and "auto_accepted" not in row and [step["status"] for step in row["history"]] == ["submitted"]
    assert await flow.db.tournament_registrations.count_documents({"squad_id": side["squad"]["id"]}) == 0
    assert await flow.db.audit_logs.find_one({"action": "league.application.submit"}, {"_id": 1})
    assert await reasons(flow, side["captain"]) == ["league_application_submitted"]
    lead_note = await flow.db.notifications.find_one({"user_id": w["lead"]["id"], "meta.reason": "league_application_submitted"}, {"_id": 0})
    assert applications.AUTO_FAILED in lead_note["body"]


@pytest.mark.asyncio
async def test_an_error_after_the_assignment_keeps_it(flow, monkeypatch):
    w = await application_world(flow, teams=1, **AUTO)
    side = w["teams"][0]

    async def broken(*_args, **_kwargs):
        raise RuntimeError("Vorschau weg")

    monkeypatch.setattr(applications, "_after_assign", broken)
    answer = await submit(flow, w, side)

    assert answer.status_code == 200, answer.text
    assert answer.json()["status"] == "accepted" and answer.json()["staffel"] == "Liga 1 · Staffel A"
    assert await flow.db.tournament_registrations.count_documents({"squad_id": side["squad"]["id"]}) == 1
    assert await reasons(flow, side["captain"]) == ["league_application_accepted"]


@pytest.mark.asyncio
async def test_missing_details_do_not_stop_the_automatic_acceptance(flow):
    """Nr. 118: Fehlende Angaben halten nichts auf - auch nicht die automatische Annahme."""
    w = await application_world(flow, teams=1, min_age=18, **AUTO)
    side = w["teams"][0]

    answer = await submitted(flow, w, side)

    assert answer["status"] == "accepted"
    assert (await my_row(flow, w, side))["warnings"], "das Fehlende steht weiter dabei"


@pytest.mark.asyncio
async def test_hard_rules_still_refuse_with_auto_accept(flow):
    w = await application_world(flow, teams=1, entry_policy="members", **AUTO)
    side = w["teams"][0]
    flow.act_as(None)
    assert ok(await flow.get(base_url(w)))["application"]["auto_accept"] is True

    refused = await submit(flow, w, side)

    assert refused.status_code == 400 and "nur für Mitglieder" in refused.json()["detail"]
    assert await flow.db.league_applications.count_documents({}) == 0


# ---------------------------------------------------------------- Plätze und Warteliste

@pytest.mark.asyncio
async def test_free_seats_but_a_full_waitlist_with_someone_waiting_stays_submitted(flow):
    """Jemand wartet, also nicht vorbei an der Warteliste - die ist aber voll: Der Antrag bleibt eingereicht, die Leitung entscheidet."""
    w = await application_world(flow, teams=2, application_slots=2, application_waitlist_limit=1, **AUTO)
    first = await submitted(flow, w, w["teams"][0])
    ok(await decide(flow, w, first, "waitlist", reason="Erst die Kader prüfen"))
    stats = (await inbox(flow, w))["stats"]
    assert stats["free"] == 2 and stats["waiting"] == 1

    second = await submitted(flow, w, w["teams"][1])

    assert second["status"] == "submitted"
    row = await stored(flow, second)
    assert [step["status"] for step in row["history"]] == ["submitted"] and "auto_accepted" not in row
    assert await flow.db.audit_logs.count_documents({"action": {"$in": ["league.application.auto_accept", "league.application.auto_waitlist"]},
                                                     "data.application_id": second["id"]}) == 0
    assert await reasons(flow, w["teams"][1]["captain"]) == ["league_application_submitted"]


@pytest.mark.asyncio
async def test_a_locked_staffel_leaves_the_squad_accepted_without_staffel(flow):
    from routes.tournament_common import TOURNAMENT_MUTATION_LOCKED_DETAIL

    w = await application_world(flow, teams=1, **AUTO)
    await flow.db.tournaments.update_one({"id": w["tid"]}, {"$set": {"locked_at": "2026-01-01T00:00:00+00:00"}})

    answer = await submitted(flow, w, w["teams"][0])

    assert answer["status"] == "accepted" and answer["staffel"] is None
    row = await stored(flow, answer)
    assert "assignment" not in row and row["auto_problem"] == TOURNAMENT_MUTATION_LOCKED_DETAIL
    assert await flow.db.tournament_registrations.count_documents({"tournament_id": w["tid"]}) == 0
    assert (await inbox(flow, w))["stats"]["unassigned"] == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("auto,second_status", [(True, "waitlist"), (False, "submitted")])
async def test_full_seats_put_the_next_on_the_waitlist(flow, auto, second_status):
    w = await application_world(flow, teams=2, application_slots=1, application_auto_accept=auto)
    first = await submitted(flow, w, w["teams"][0])
    if not auto:
        ok(await decide(flow, w, first, "accept"))

    second = await submitted(flow, w, w["teams"][1])

    assert second["status"] == second_status
    if auto:
        row = await stored(flow, second)
        assert row["history"][-1]["auto"] is True and "auto_accepted" not in row
        assert await flow.db.audit_logs.find_one({"action": "league.application.auto_waitlist"}, {"_id": 1})
        assert await reasons(flow, w["teams"][1]["captain"]) == ["league_application_waitlist"]


@pytest.mark.asyncio
@pytest.mark.parametrize("staffeln", [1, 2])
async def test_two_at_once_on_the_last_seat_one_is_accepted_the_other_waits(flow, staffeln):
    """Die Dienste direkt, weil die Harness je Anfrage nur eine Person kennt (wie test_league_application_race_flow)."""
    w = await application_world(flow, teams=2, application_slots=1, staffeln=staffeln, **AUTO)
    league = await flow.db.leagues.find_one({"id": w["league"]["id"]}, {"_id": 0})
    season = await flow.db.league_seasons.find_one({"id": w["season"]["id"]}, {"_id": 0})

    def body(side: dict) -> dict:
        return {"squad_id": side["squad"]["id"], "rule_version_id": w["rule"]["id"], "accept_rules": True, "accept_privacy": True}

    answers = await asyncio.gather(*(attempt(applications.submit(flow.db, league, season, body(side), side["captain"], refresh_previews=no_preview))
                                     for side in w["teams"]))

    assert sorted(answers) == ["accepted", "waitlist"], answers
    assert await flow.db.league_applications.count_documents({"status": "accepted"}) == 1
    assert await flow.db.tournament_registrations.count_documents({"tournament_id": {"$in": w["tids"]}}) == (1 if staffeln == 1 else 0)
    assert (await inbox(flow, w))["stats"]["full"] is True


@pytest.mark.asyncio
async def test_a_freed_seat_goes_by_the_waitlist_not_to_the_next_newcomer(flow):
    w = await application_world(flow, teams=3, application_slots=1, **AUTO)
    first, second = [await submitted(flow, w, side) for side in w["teams"][:2]]
    assert (first["status"], second["status"]) == ("accepted", "waitlist")

    ok(await decide(flow, w, first, "reject", reason="Kader doppelt gemeldet"))
    third = await submitted(flow, w, w["teams"][2])

    assert third["status"] == "waitlist", "wer schon wartet, geht vor: über den freien Platz entscheidet die Leitung"
    assert (await stored(flow, second))["status"] == "waitlist", "nichts rückt von selbst nach"
    moved = ok(await decide(flow, w, second, "accept", tournament_id=w["tid"]))
    assert moved["status"] == "accepted" and "auto_accepted" not in await stored(flow, second)


# ---------------------------------------------------------------- Nachträglich: ablehnen und zurückstufen

@pytest.mark.asyncio
async def test_the_lead_rejects_an_auto_assigned_squad_and_frees_the_seat(flow):
    w = await application_world(flow, teams=2, application_slots=1, **AUTO)
    side = w["teams"][0]
    first, second = await submitted(flow, w, side), await submitted(flow, w, w["teams"][1])

    done = ok(await decide(flow, w, first, "reject", reason="Kader passt nicht zur Liga"))

    assert done["status"] == "rejected" and "assignment" not in done and "auto_accepted" not in done
    row = await stored(flow, first)
    assert "assignment" not in row and "active_key" not in row and row["decided_by"] == w["lead"]["id"]
    assert await flow.db.tournament_registrations.count_documents({"squad_id": side["squad"]["id"]}) == 0
    entry = await flow.db.audit_logs.find_one({"action": "league.application.reject"}, {"_id": 0})
    assert entry["data"]["tournament_id"] == w["tid"] and entry["data"]["registration_removed"]
    note = await flow.db.notifications.find_one({"user_id": side["captain"]["id"], "meta.reason": "league_application_rejected"}, {"_id": 0})
    assert "Kader passt nicht zur Liga" in note["body"]
    assert (await inbox(flow, w))["stats"]["free"] == 1
    # Nachrücken nach den Regeln der Warteliste: die Leitung nimmt an.
    assert ok(await decide(flow, w, second, "accept", tournament_id=w["tid"]))["status"] == "accepted"


@pytest.mark.asyncio
async def test_setting_an_auto_accepted_squad_back_needs_a_reason(flow):
    w = await application_world(flow, teams=1, **AUTO)
    side = w["teams"][0]
    application = await submitted(flow, w, side)

    without = await decide(flow, w, application, "waitlist")
    assert without.status_code == 422 and "Grund" in without.json()["detail"]
    assert (await stored(flow, application))["status"] == "accepted"
    assert await flow.db.tournament_registrations.count_documents({"squad_id": side["squad"]["id"]}) == 1

    done = ok(await decide(flow, w, application, "waitlist", reason="Erst die Kader der anderen prüfen"))

    assert done["status"] == "waitlist" and "assignment" not in await stored(flow, application)
    assert await flow.db.tournament_registrations.count_documents({"squad_id": side["squad"]["id"]}) == 0
    note = await flow.db.notifications.find_one({"user_id": side["captain"]["id"], "meta.reason": "league_application_waitlist"}, {"_id": 0})
    assert "Grund: Erst die Kader der anderen prüfen" in note["body"]


@pytest.mark.asyncio
async def test_an_auto_accepted_squad_without_staffel_also_needs_a_reason_to_go_back(flow):
    w = await application_world(flow, teams=1, staffeln=2, **AUTO)
    application = await submitted(flow, w, w["teams"][0])

    assert (await decide(flow, w, application, "waitlist")).status_code == 422
    assert ok(await decide(flow, w, application, "waitlist", reason="Platz wird anders gebraucht"))["status"] == "waitlist"


@pytest.mark.asyncio
async def test_a_fixed_plan_keeps_the_auto_assignment(flow):
    w = await application_world(flow, teams=1, **AUTO)
    application = await submitted(flow, w, w["teams"][0])
    registration = await flow.db.tournament_registrations.find_one({"application_id": application["id"]}, {"_id": 0})
    await flow.db.matches_v2.insert_one({"id": new_id(), "tournament_id": w["tid"], "slots": [{"registration_id": registration["id"]}], "status": "scheduled"})

    refused = await decide(flow, w, application, "reject", reason="Kader passt nicht zur Liga")

    assert refused.status_code == 409 and "Austritt eintragen" in refused.json()["detail"]
    assert (await stored(flow, application))["status"] == "accepted"
    assert await flow.db.tournament_registrations.count_documents({"id": registration["id"]}) == 1


@pytest.mark.asyncio
async def test_an_assignment_by_the_lead_still_goes_through_the_participant_list(flow):
    """Gegenprobe: Nur die automatische Zuteilung nimmt der Eingang wieder heraus."""
    w = await application_world(flow, teams=1, staffeln=2, **AUTO)
    application = await submitted(flow, w, w["teams"][0])
    ok(await decide(flow, w, application, "assign", tournament_id=w["tid"]))

    assert (await decide(flow, w, application, "reject", reason="Kader passt nicht zur Liga")).status_code == 409
    side = w["teams"][0]
    assert (await my_row(flow, w, side))["application"]["can_withdraw"] is False
    refused = await flow.post(f"{base_url(w)}/applications/{application['id']}/withdraw", json={})
    assert refused.status_code == 409 and "Austritt" in refused.json()["detail"]


# ---------------------------------------------------------------- Zurückziehen nach automatischer Zuteilung

@pytest.mark.asyncio
async def test_the_team_withdraws_an_auto_assignment_and_the_waitlist_stays(flow):
    w = await application_world(flow, teams=2, application_slots=1, **AUTO)
    side = w["teams"][0]
    first, second = await submitted(flow, w, side), await submitted(flow, w, w["teams"][1])
    assert (first["status"], second["status"]) == ("accepted", "waitlist")
    assert first["can_withdraw"] is True, "die Antwort nach dem Einreichen bietet das Zurückziehen"
    assert (await my_row(flow, w, side))["application"]["can_withdraw"] is True

    done = ok(await flow.post(f"{base_url(w)}/applications/{first['id']}/withdraw", json={}))

    assert done["status"] == "withdrawn"
    row = await stored(flow, first)
    assert "assignment" not in row and "active_key" not in row and row["withdrawn_by"] == side["captain"]["id"]
    assert await flow.db.tournament_registrations.count_documents({"squad_id": side["squad"]["id"]}) == 0
    entry = await flow.db.audit_logs.find_one({"action": "league.application.withdraw"}, {"_id": 0})
    assert entry["data"]["tournament_id"] == w["tid"] and entry["data"]["registration_removed"]
    assert (await stored(flow, second))["status"] == "waitlist", "die Warteliste bleibt, über den freien Platz entscheidet die Leitung"
    assert (await inbox(flow, w))["stats"]["free"] == 1


@pytest.mark.asyncio
async def test_a_fixed_plan_stops_withdrawing_an_auto_assignment(flow):
    w = await application_world(flow, teams=1, **AUTO)
    side = w["teams"][0]
    application = await submitted(flow, w, side)
    registration = await flow.db.tournament_registrations.find_one({"application_id": application["id"]}, {"_id": 0})
    await flow.db.matches_v2.insert_one({"id": new_id(), "tournament_id": w["tid"], "slots": [{"registration_id": registration["id"]}], "status": "scheduled"})

    assert (await my_row(flow, w, side))["application"]["can_withdraw"] is False
    refused = await flow.post(f"{base_url(w)}/applications/{application['id']}/withdraw", json={})

    assert refused.status_code == 409 and "Austritt trägt die Liga-Leitung ein" in refused.json()["detail"]
    assert (await stored(flow, application))["status"] == "accepted"
    assert await flow.db.tournament_registrations.count_documents({"id": registration["id"]}) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("when", ["checked_in", "check_in_open", "live"])
async def test_after_check_in_or_start_the_team_cannot_withdraw_an_auto_assignment(flow, when):
    """Dieselbe Regel wie bei der Turnier-Abmeldung: eingecheckt, Check-in offen oder Staffel läuft - dann nur über die Liga-Leitung."""
    w = await application_world(flow, teams=1, **AUTO)
    side = w["teams"][0]
    application = await submitted(flow, w, side)
    registration = await flow.db.tournament_registrations.find_one({"application_id": application["id"]}, {"_id": 0})
    if when == "checked_in":
        await flow.db.tournament_registrations.update_one({"id": registration["id"]}, {"$set": {"status": "checked_in"}})
    else:
        await flow.db.tournaments.update_one({"id": w["tid"]}, {"$set": {"status": "check_in" if when == "check_in_open" else "live"}})

    assert (await my_row(flow, w, side))["application"]["can_withdraw"] is False
    refused = await flow.post(f"{base_url(w)}/applications/{application['id']}/withdraw", json={})

    assert refused.status_code == 409 and "nur über die Liga-Leitung" in refused.json()["detail"], refused.text
    assert (await stored(flow, application))["status"] == "accepted"
    assert await flow.db.tournament_registrations.count_documents({"id": registration["id"]}) == 1


@pytest.mark.asyncio
async def test_an_auto_assignment_during_check_in_is_not_offered_for_withdrawal(flow):
    """Teilt die Season während des Check-ins zu, bietet schon die Antwort nach dem Einreichen kein Zurückziehen an."""
    w = await application_world(flow, teams=1, **AUTO)
    await flow.db.tournaments.update_one({"id": w["tid"]}, {"$set": {"status": "check_in"}})

    answer = await submitted(flow, w, w["teams"][0])

    assert answer["status"] == "accepted" and answer["staffel"] == "Liga 1 · Staffel A"
    assert answer["can_withdraw"] is False


# ---------------------------------------------------------------- Befangenheit (Nr. 73)

@pytest.mark.asyncio
async def test_the_own_team_of_a_lead_is_accepted_but_the_lead_cannot_reject_it(flow):
    w = await application_world(flow, teams=1, **AUTO)
    side = w["teams"][0]
    await flow.db.league_staff.insert_one({"id": new_id(), "league_id": w["league"]["id"], "user_id": side["captain"]["id"], "capabilities": ["applications"],
                                           "created_at": now_utc().isoformat(), "created_by": "test"})

    application = await submitted(flow, w, side)
    assert application["status"] == "accepted", "keine Entscheidung einer Person: auch beim eigenen Team"

    for action, body in (("reject", {"reason": "Lieber doch nicht"}), ("waitlist", {"reason": "Lieber doch nicht"})):
        refused = await decide(flow, w, application, action, actor=side["captain"], **body)
        assert refused.status_code == 403 and "eigenes Team" in refused.json()["detail"], action
    assert (await stored(flow, application))["status"] == "accepted"
    # Die anderen Zuständigen sehen es im Eingang markiert: „Team der Leitung – automatisch angenommen“.
    item = (await inbox(flow, w))["items"][0]
    assert item["lead_team_auto"] is True and item["own_team"] is False


@pytest.mark.asyncio
async def test_an_auto_accepted_team_without_a_lead_is_not_marked(flow):
    """Gegenprobe: ohne Person der Liga-Leitung im Team keine Markierung, ebenso bei einer Annahme durch die Leitung."""
    w = await application_world(flow, teams=2, staffeln=2, **AUTO)
    auto = await submitted(flow, w, w["teams"][0])
    await flow.db.league_staff.insert_one({"id": new_id(), "league_id": w["league"]["id"], "user_id": w["teams"][1]["captain"]["id"],
                                           "capabilities": ["season"], "created_at": now_utc().isoformat(), "created_by": "test"})
    await flow.db.league_seasons.update_one({"id": w["season"]["id"]}, {"$set": {"application_auto_accept": False}})
    by_lead = await submitted(flow, w, w["teams"][1])
    ok(await decide(flow, w, by_lead, "accept"))

    items = {row["id"]: row for row in (await inbox(flow, w))["items"]}

    assert items[auto["id"]]["auto_accepted"] is True and items[auto["id"]]["lead_team_auto"] is False
    assert items[by_lead["id"]]["auto_accepted"] is False and items[by_lead["id"]]["lead_team_auto"] is False


@pytest.mark.asyncio
async def test_the_superadmin_rejects_the_auto_assigned_own_team_only_as_an_emergency(flow):
    """Notausnahme (#2245) auch beim Ablehnen einer automatischen Zuteilung: ohne Grund 403, mit Grund raus aus der Staffel und im Protokoll."""
    w = await application_world(flow, teams=1, **AUTO)
    side = w["teams"][0]
    application = await submitted(flow, w, side)
    boss = {**side["lead"], "role": "superadmin"}
    reason = "Niemand sonst erreichbar, Saisonstart morgen"

    refused = await decide(flow, w, application, "reject", actor=boss, reason="Kader passt nicht zur Liga")
    assert refused.status_code == 403
    assert (await stored(flow, application))["status"] == "accepted"
    assert await flow.db.tournament_registrations.count_documents({"squad_id": side["squad"]["id"]}) == 1

    done = ok(await decide(flow, w, application, "reject", actor=boss, reason="Kader passt nicht zur Liga", conflict_reason=reason))

    assert done["status"] == "rejected" and "assignment" not in await stored(flow, application)
    assert await flow.db.tournament_registrations.count_documents({"squad_id": side["squad"]["id"]}) == 0
    entry = await flow.db.audit_logs.find_one({"action": "league.application.reject"}, {"_id": 0})
    assert entry["actor_id"] == boss["id"] and entry["data"]["conflict_override"] == reason and entry["data"]["registration_removed"]
    override = await flow.db.audit_logs.find_one({"action": "league.conflict.override"}, {"_id": 0})
    assert override["data"]["action"] == "application_reject" and override["data"]["reason"] == reason


# ---------------------------------------------------------------- Einstellung: Rechte, Protokoll, später einschalten

@pytest.mark.asyncio
async def test_switching_on_needs_the_season_capability_and_is_logged(flow):
    w = await application_world(flow, teams=0)
    url = f"{ADMIN_LEAGUES}/seasons/{w['season']['id']}"
    flow.act_as(await holder(flow, w, ["applications"]))
    assert (await flow.patch(url, json={"application_auto_accept": True})).status_code == 403
    assert (await flow.db.league_seasons.find_one({"id": w["season"]["id"]}))["application_auto_accept"] is False

    flow.act_as(await holder(flow, w, ["season"]))
    assert ok(await flow.patch(url, json={"application_auto_accept": True}))["application_auto_accept"] is True

    entry = await flow.db.audit_logs.find_one({"action": "league.season.update", "target_id": w["season"]["id"]}, {"_id": 0}, sort=[("created_at", -1)])
    assert "application_auto_accept" in entry["data"]["fields"]
    switched = await flow.db.audit_logs.find_one({"action": "league.season.auto_accept", "target_id": w["season"]["id"]}, {"_id": 0})
    assert switched["data"]["before"] is False and switched["data"]["after"] is True
    # ``null`` lässt den Wert stehen wie bei den übrigen Vorgaben - und schreibt kein Umschalten.
    assert ok(await flow.patch(url, json={"application_auto_accept": None}))["application_auto_accept"] is True
    assert ok(await flow.patch(url, json={"application_slots": 8}))["application_slots"] == 8
    assert await flow.db.audit_logs.count_documents({"action": "league.season.auto_accept"}) == 1
    ok(await flow.patch(url, json={"application_auto_accept": False}))
    back = await flow.db.audit_logs.find_one({"action": "league.season.auto_accept", "data.after": False}, {"_id": 0})
    assert back["data"]["before"] is True and back["actor_id"]


async def public_free(flow, w: dict) -> int | None:
    flow.act_as(None)
    return ok(await flow.get(base_url(w)))["application"]["slots_free"]


@pytest.mark.asyncio
async def test_the_league_page_shows_the_seats_a_newcomer_can_really_get(flow):
    """Mit automatischer Annahme zählen offene Anmeldungen auf der Ligaseite wie belegt, und wartet jemand, bekommt ein Neuer keinen Platz."""
    w = await application_world(flow, teams=4, application_slots=3)
    early = [await submitted(flow, w, side) for side in w["teams"][:2]]
    assert await public_free(flow, w) == 3, "Gegenprobe ohne Einstellung: wie bisher nur die belegten Plätze"
    flow.act_as(w["lead"])
    ok(await flow.patch(f"{ADMIN_LEAGUES}/seasons/{w['season']['id']}", json={"application_auto_accept": True}))

    assert await public_free(flow, w) == 1, "die zwei offenen halten ihren Platz"
    assert (await submitted(flow, w, w["teams"][2]))["status"] == "accepted"
    assert await public_free(flow, w) == 0
    ok(await decide(flow, w, early[0], "reject", reason="Kader doppelt gemeldet"))
    assert await public_free(flow, w) == 1
    assert (await submitted(flow, w, w["teams"][3]))["status"] == "accepted", "die Seite hat nicht zu viel versprochen"
    assert await public_free(flow, w) == 0
    stats = (await inbox(flow, w))["stats"]
    assert stats["free"] == 1 and stats["open"] == 1, "der Eingang zählt weiter nur belegte Plätze, offene stehen daneben"


@pytest.mark.asyncio
async def test_with_someone_waiting_a_newcomer_gets_no_free_seat(flow):
    w = await application_world(flow, teams=2, application_slots=2, **AUTO)
    first = await submitted(flow, w, w["teams"][0])
    ok(await decide(flow, w, first, "waitlist", reason="Erst die Kader prüfen"))

    assert (await inbox(flow, w))["stats"]["free"] == 2
    assert await public_free(flow, w) == 0
    assert (await submitted(flow, w, w["teams"][1]))["status"] == "waitlist"


@pytest.mark.asyncio
async def test_switching_on_later_leaves_open_applications_to_the_lead(flow):
    """Wer zuerst kommt, wird zuerst bedient: Offene Anmeldungen von vorher bleiben bei der Leitung und halten ihren Platz."""
    w = await application_world(flow, teams=4, application_slots=3)
    early = [await submitted(flow, w, side) for side in w["teams"][:2]]
    flow.act_as(w["lead"])
    url = f"{ADMIN_LEAGUES}/seasons/{w['season']['id']}"
    assert ok(await flow.get(url))["applications_waiting"] == 2

    ok(await flow.patch(url, json={"application_auto_accept": True}))

    assert [(await stored(flow, row))["status"] for row in early] == ["submitted", "submitted"], "nichts wird nachträglich angenommen"
    assert ok(await flow.get(url))["applications_waiting"] == 2
    third = await submitted(flow, w, w["teams"][2])
    assert third["status"] == "accepted", "der dritte Platz ist nach den zwei offenen noch frei"
    fourth = await submitted(flow, w, w["teams"][3])
    assert fourth["status"] == "waitlist", "die zwei offenen halten ihren Platz, auch wenn erst einer belegt ist"
    stats = (await inbox(flow, w))["stats"]
    assert stats["taken"] == 1 and stats["free"] == 2 and stats["open"] == 2 and stats["waiting"] == 1
    flow.act_as(w["lead"])
    assert ok(await flow.get(url))["applications_waiting"] == 2
    # Die Leitung nimmt die offenen wie bisher an - ihre Plätze waren frei gehalten.
    assert [ok(await decide(flow, w, row, "accept"))["status"] for row in early] == ["accepted", "accepted"]
