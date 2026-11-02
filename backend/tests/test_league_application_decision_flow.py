"""Der Eingang der Leitung (docs/LIGA.md, B.4, #2205): prüfen, annehmen, ablehnen, Warteliste, zuteilen. Dazu Plätze, Sonderweg, Nachrichten, Datenschutz. Erfundene Namen."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_application_world import add_team, application_world, base_url, decide, inbox_url, submit, submitted  # noqa: E402
from league_rules_world import ADMIN_LEAGUES  # noqa: E402
from league_start_world import ok, start  # noqa: E402
from models import now_utc  # noqa: E402
from services import account_erasure, personal_data  # noqa: E402
from squad_world import make_squad  # noqa: E402


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


# ---------------------------------------------------------------- Übergänge

@pytest.mark.asyncio
async def test_review_accept_and_assign_build_the_registration(flow):
    w = await application_world(flow, one_team_per_season=True)
    side = w["teams"][0]
    application = await submitted(flow, w, side)

    assert ok(await decide(flow, w, application, "review"))["status"] == "in_review"
    accepted = ok(await decide(flow, w, application, "accept"))
    assert accepted["status"] == "accepted" and "assignment" not in accepted
    assert await flow.db.tournament_registrations.count_documents({"squad_id": side["squad"]["id"]}) == 0

    assigned = ok(await decide(flow, w, application, "assign", tournament_id=w["tid"]))

    assert assigned["status"] == "accepted"
    assert assigned["assignment"]["tournament_id"] == w["tid"] and assigned["assignment"]["staffel"] == "A"
    assert assigned["assignment"]["label"] == "Liga 1 · Staffel A"
    reg = await flow.db.tournament_registrations.find_one({"squad_id": side["squad"]["id"]}, {"_id": 0})
    assert reg["status"] == "approved" and reg["tournament_id"] == w["tid"]
    assert reg["registered_via"] == "league_application" and reg["source"] == "league_application" and reg["application_id"] == application["id"]
    assert reg["accepted_rules"] is True and reg["accepted_privacy"] is True
    assert reg["registered_by"] == side["captain"]["id"] and reg["created_by"] == w["lead"]["id"]
    assert reg["league_squad_key"] == f"{w['season']['id']}:{side['squad']['id']}"
    assert reg["identity_key"] == f"{w['tid']}:team:{side['team']['id']}"
    assert assigned["assignment"]["registration_id"] == reg["id"]
    assert await flow.db.league_rosters.count_documents({"season_id": w["season"]["id"]}) == 4, "der Kader steht wie beim Zuteilen fest"
    assert await flow.db.audit_logs.find_one({"action": "league.application.assign"}, {"_id": 1})


@pytest.mark.asyncio
async def test_accept_with_a_staffel_assigns_in_one_step(flow):
    w = await application_world(flow)
    application = await submitted(flow, w, w["teams"][0])

    done = ok(await decide(flow, w, application, "accept", tournament_id=w["tid"]))

    assert done["status"] == "accepted" and done["assignment"]["staffel"] == "A"
    assert await flow.db.tournament_registrations.count_documents({"application_id": application["id"]}) == 1


@pytest.mark.asyncio
async def test_rejecting_needs_a_reason_and_the_team_reads_it(flow):
    w = await application_world(flow)
    side = w["teams"][0]
    application = await submitted(flow, w, side)

    too_short = await decide(flow, w, application, "reject", reason="Nö")
    assert too_short.status_code == 422
    assert (await stored(flow, application))["status"] == "submitted"

    done = ok(await decide(flow, w, application, "reject", reason="Kader passt nicht zur Liga"))
    assert done["status"] == "rejected" and done["decision_reason"] == "Kader passt nicht zur Liga"
    assert "active_key" not in await stored(flow, application)
    note = await flow.db.notifications.find_one({"user_id": side["captain"]["id"], "meta.reason": "league_application_rejected"}, {"_id": 0})
    assert "Kader passt nicht zur Liga" in note["body"]
    assert await flow.db.notifications.find_one({"user_id": side["member"]["id"], "meta.reason": "league_application_rejected"}, {"_id": 1}) is None


@pytest.mark.asyncio
@pytest.mark.parametrize("final,action,body", [
    ("rejected", "accept", {}), ("rejected", "reject", {"reason": "Noch einmal ablehnen"}), ("rejected", "waitlist", {}), ("rejected", "review", {}), ("rejected", "assign", {"tournament_id": "T"}),
    ("withdrawn", "accept", {}), ("withdrawn", "reject", {"reason": "Noch einmal ablehnen"}), ("withdrawn", "waitlist", {}), ("withdrawn", "assign", {"tournament_id": "T"}),
])
async def test_a_closed_application_cannot_be_decided_again(flow, final, action, body):
    w = await application_world(flow)
    side = w["teams"][0]
    application = await submitted(flow, w, side)
    if final == "rejected":
        ok(await decide(flow, w, application, "reject", reason="Erst einmal nicht"))
    else:
        flow.act_as(side["captain"])
        ok(await flow.post(f"{base_url(w)}/applications/{application['id']}/withdraw", json={}))
    if body.get("tournament_id") == "T":
        body = {"tournament_id": w["tid"]}

    refused = await decide(flow, w, application, action, **body)

    assert refused.status_code == 409, refused.text
    assert (await stored(flow, application))["status"] == final
    assert await flow.db.tournament_registrations.count_documents({"squad_id": side["squad"]["id"]}) == 0


@pytest.mark.asyncio
async def test_review_only_from_submitted_and_assign_only_after_accept(flow):
    w = await application_world(flow)
    application = await submitted(flow, w, w["teams"][0])

    assert (await decide(flow, w, application, "assign", tournament_id=w["tid"])).status_code == 409
    ok(await decide(flow, w, application, "review"))
    assert (await decide(flow, w, application, "review")).status_code == 409


@pytest.mark.asyncio
async def test_an_assigned_application_stays_until_the_lead_takes_it_back(flow):
    w = await application_world(flow)
    application = await submitted(flow, w, w["teams"][0])
    ok(await decide(flow, w, application, "accept", tournament_id=w["tid"]))

    for action, body in (("reject", {"reason": "Doch nicht"}), ("waitlist", {}), ("assign", {"tournament_id": w["tid"]}), ("accept", {})):
        assert (await decide(flow, w, application, action, **body)).status_code == 409, action


@pytest.mark.asyncio
async def test_accepted_without_assignment_can_be_set_back_to_the_waitlist(flow):
    w = await application_world(flow, application_slots=1)
    application = await submitted(flow, w, w["teams"][0])
    ok(await decide(flow, w, application, "accept"))

    done = ok(await decide(flow, w, application, "waitlist", reason="Platz wird anders gebraucht"))

    assert done["status"] == "waitlist"
    assert (await inbox(flow, w))["stats"]["free"] == 1


# ---------------------------------------------------------------- Die Prüfung wiederholt sich

@pytest.mark.asyncio
async def test_assign_repeats_the_check_when_the_squad_shrank(flow):
    w = await application_world(flow, min_squad_size=4)
    side = w["teams"][0]
    application = await submitted(flow, w, side)
    ok(await decide(flow, w, application, "accept"))
    await flow.db.team_squads.update_one({"id": side["squad"]["id"]}, {"$pull": {"member_ids": side["people"][2]["id"]}})

    refused = await decide(flow, w, application, "assign", tournament_id=w["tid"])

    assert refused.status_code == 400 and "mindestens 4" in refused.json()["detail"]
    assert (await stored(flow, application)).get("assignment") is None
    assert await flow.db.tournament_registrations.count_documents({"squad_id": side["squad"]["id"]}) == 0


@pytest.mark.asyncio
async def test_assign_repeats_the_whole_check_not_only_the_staffel_part(flow):
    """Zulassung und Spielberechtigung gelten auch beim Zuteilen: Der Kader kann sich seit dem Annehmen geändert haben."""
    w = await application_world(flow, entry_policy="members")
    side = w["teams"][0]
    await flow.db.users.update_many({"id": {"$in": [user["id"] for user in side["people"]]}}, {"$set": {"is_club_member": True}})
    application = await submitted(flow, w, side)
    ok(await decide(flow, w, application, "accept"))
    outsider = await flow.add_user(name="Kein Mitglied")
    await flow.db.teams.update_one({"id": side["team"]["id"]}, {"$addToSet": {"member_ids": outsider["id"]}})
    await flow.db.team_squads.update_one({"id": side["squad"]["id"]}, {"$addToSet": {"member_ids": outsider["id"]}})

    refused = await decide(flow, w, application, "assign", tournament_id=w["tid"])

    assert refused.status_code == 400 and "nur für Mitglieder" in refused.json()["detail"]
    assert await flow.db.tournament_registrations.count_documents({"squad_id": side["squad"]["id"]}) == 0


@pytest.mark.asyncio
async def test_accept_repeats_the_check_and_the_inbox_names_it(flow):
    w = await application_world(flow, min_squad_size=4)
    side = w["teams"][0]
    application = await submitted(flow, w, side)
    await flow.db.team_squads.update_one({"id": side["squad"]["id"]}, {"$pull": {"member_ids": side["people"][2]["id"]}})

    row = (await inbox(flow, w))["items"][0]
    assert any("mindestens 4" in text for text in row["problems"])
    refused = await decide(flow, w, application, "accept")
    assert refused.status_code == 400 and (await stored(flow, application))["status"] == "submitted"


@pytest.mark.asyncio
async def test_a_full_staffel_refuses_the_assignment(flow):
    w = await application_world(flow, max_staffel_size=2, teams=3)
    apps = [await submitted(flow, w, side) for side in w["teams"]]
    ok(await decide(flow, w, apps[0], "accept", tournament_id=w["tid"]))
    ok(await decide(flow, w, apps[1], "accept", tournament_id=w["tid"]))
    ok(await decide(flow, w, apps[2], "accept"))

    refused = await decide(flow, w, apps[2], "assign", tournament_id=w["tid"])

    assert refused.status_code == 409 and "voll" in refused.json()["detail"]


@pytest.mark.asyncio
async def test_a_locked_staffel_refuses_the_assignment(flow):
    w = await application_world(flow)
    application = await submitted(flow, w, w["teams"][0])
    await flow.db.tournaments.update_one({"id": w["tid"]}, {"$set": {"locked_at": "2026-01-01T00:00:00+00:00"}})

    refused = await decide(flow, w, application, "accept", tournament_id=w["tid"])

    assert refused.status_code == 423
    assert (await stored(flow, application))["status"] == "submitted"


@pytest.mark.asyncio
async def test_a_staffel_of_another_season_is_404(flow):
    w = await application_world(flow)
    other = await application_world(flow, teams=0)
    application = await submitted(flow, w, w["teams"][0])
    flow.act_as(w["lead"])

    answer = await flow.post(f"{inbox_url(w)}/{application['id']}/accept", json={"tournament_id": other["tid"]})

    assert answer.status_code == 404
    assert (await stored(flow, application))["status"] == "submitted"


@pytest.mark.asyncio
async def test_an_application_of_another_season_is_404(flow):
    w = await application_world(flow)
    other = await application_world(flow, teams=0)
    application = await submitted(flow, w, w["teams"][0])

    for action, body in (("review", {}), ("accept", {}), ("reject", {"reason": "Fremder Antrag"}), ("waitlist", {}), ("assign", {"tournament_id": other["tid"]})):
        flow.act_as(other["lead"])
        answer = await flow.post(f"{inbox_url(other)}/{application['id']}/{action}", json=body)
        assert answer.status_code == 404, action
    assert (await stored(flow, application))["status"] == "submitted"


# ---------------------------------------------------------------- Plätze und Warteliste

@pytest.mark.asyncio
async def test_seats_count_assignments_and_accepted_but_not_the_waitlist(flow):
    w = await application_world(flow, application_slots=3)
    first, second, third = [await submitted(flow, w, side) for side in w["teams"]]
    ok(await decide(flow, w, first, "accept", tournament_id=w["tid"]))
    ok(await decide(flow, w, second, "accept"))
    ok(await decide(flow, w, third, "waitlist"))

    stats = (await inbox(flow, w))["stats"]

    assert stats["taken"] == 2 and stats["free"] == 1 and stats["waiting"] == 1 and stats["unassigned"] == 1
    flow.act_as(None)
    assert ok(await flow.get(base_url(w)))["application"]["slots_free"] == 1


@pytest.mark.asyncio
async def test_the_last_seat_goes_once_and_nobody_moves_up_by_themselves(flow):
    w = await application_world(flow, application_slots=1)
    first, second = await submitted(flow, w, w["teams"][0]), await submitted(flow, w, w["teams"][1])
    ok(await decide(flow, w, first, "accept"))

    refused = await decide(flow, w, second, "accept")
    assert refused.status_code == 409 and "Startplätze" in refused.json()["detail"]
    ok(await decide(flow, w, second, "waitlist"))

    flow.act_as(w["teams"][0]["captain"])
    ok(await flow.post(f"{base_url(w)}/applications/{first['id']}/withdraw", json={}))

    assert (await stored(flow, second))["status"] == "waitlist", "nichts rückt von selbst nach"
    assert ok(await decide(flow, w, second, "accept"))["status"] == "accepted"


@pytest.mark.asyncio
async def test_a_seat_taken_by_the_special_way_counts(flow):
    w = await application_world(flow, application_slots=1)
    direct, applicant = w["teams"][0], w["teams"][1]
    flow.act_as(w["lead"])
    ok(await flow.post(f"/api/tournaments/{w['tid']}/squad-registrations", json={"team_id": direct["team"]["id"], "squad_id": direct["squad"]["id"]}))
    application = await submitted(flow, w, applicant)

    assert (await decide(flow, w, application, "accept")).status_code == 409


@pytest.mark.asyncio
async def test_without_waitlist_full_seats_end_the_application(flow):
    w = await application_world(flow, application_slots=1, application_waitlist=False)
    first = await submitted(flow, w, w["teams"][0])
    ok(await decide(flow, w, first, "accept"))
    no_list = await decide(flow, w, first, "waitlist")
    assert no_list.status_code == 409 and "keine Warteliste" in no_list.json()["detail"]

    refused = await submit(flow, w, w["teams"][2])

    assert refused.status_code == 409 and "Startplätze" in refused.json()["detail"]


@pytest.mark.asyncio
async def test_with_waitlist_full_seats_still_take_applications_until_it_is_full(flow):
    w = await application_world(flow, application_slots=1, application_waitlist_limit=1, teams=4)
    first, second = await submitted(flow, w, w["teams"][0]), await submitted(flow, w, w["teams"][1])
    third = await submitted(flow, w, w["teams"][2])
    ok(await decide(flow, w, first, "accept"))
    ok(await decide(flow, w, second, "waitlist"))

    assert (await decide(flow, w, third, "waitlist")).status_code == 409, "die Warteliste ist voll"
    flow.act_as(None)
    assert ok(await flow.get(base_url(w)))["application"]["waitlist_full"] is True
    assert (await submit(flow, w, w["teams"][3])).status_code == 409


# ---------------------------------------------------------------- Zwei Co-Teams eines Hauptteams

async def second_squad(flow, w: dict, side: dict) -> dict:
    extra = [await flow.add_user(name=f"Zweit {index}") for index in range(4)]
    await flow.db.teams.update_one({"id": side["team"]["id"]}, {"$addToSet": {"member_ids": {"$each": [user["id"] for user in extra]}}})
    squad = await make_squad(flow, side["team"], "Zweite Reihe", extra, captain=extra[0], vice=extra[1], game_id=w["game"]["id"])
    return {**side, "squad": squad, "captain": extra[0], "vice": extra[1], "member": extra[3], "people": extra}


@pytest.mark.asyncio
async def test_two_squads_of_one_team_stay_apart_by_default(flow):
    w = await application_world(flow, staffeln=2)
    side = w["teams"][0]
    twin = await second_squad(flow, w, side)
    first, second = await submitted(flow, w, side), await submitted(flow, w, twin)
    ok(await decide(flow, w, first, "accept", tournament_id=w["tids"][0]))

    same = await decide(flow, w, second, "accept", tournament_id=w["tids"][0])
    assert same.status_code == 409 and "zwei Co-Teams" in same.json()["detail"]
    assert (await stored(flow, second))["status"] == "submitted"
    ok(await decide(flow, w, second, "accept", tournament_id=w["tids"][1]))


@pytest.mark.asyncio
async def test_the_switch_allows_two_squads_in_one_staffel_for_both_ways(flow):
    w = await application_world(flow, sibling_squads_in_staffel=True)
    side = w["teams"][0]
    twin = await second_squad(flow, w, side)
    first = await submitted(flow, w, side)
    ok(await decide(flow, w, first, "accept", tournament_id=w["tid"]))

    flow.act_as(w["lead"])
    direct = ok(await flow.post(f"/api/tournaments/{w['tid']}/squad-registrations", json={"team_id": twin["team"]["id"], "squad_id": twin["squad"]["id"]}))

    keys = sorted(row["identity_key"] for row in await flow.db.tournament_registrations.find({"tournament_id": w["tid"]}, {"_id": 0, "identity_key": 1}).to_list(5))
    assert keys == sorted(f"{w['tid']}:team:{side['team']['id']}:squad:{row['squad']['id']}" for row in (side, twin))
    assert direct["registration"]["squad_id"] == twin["squad"]["id"]
    again = await flow.post(f"/api/tournaments/{w['tid']}/squad-registrations", json={"team_id": twin["team"]["id"], "squad_id": twin["squad"]["id"]})
    assert again.status_code == 409


@pytest.mark.asyncio
async def test_two_squads_of_one_team_can_play_each_other_with_the_switch(flow):
    """Die Staffel startet, und jeder Captain handelt für sein eigenes Co-Team."""
    w = await application_world(flow, sibling_squads_in_staffel=True, teams=1)
    side = w["teams"][0]
    twin = await second_squad(flow, w, side)
    for row in (side, twin):
        ok(await decide(flow, w, await submitted(flow, w, row), "accept", tournament_id=w["tid"]))
    assert (await start(flow, w)).status_code == 200

    match = await flow.db.matches_v2.find_one({"tournament_id": w["tid"], "is_preview": {"$ne": True}}, {"_id": 0})
    regs = {row["squad_id"]: row["id"] for row in await flow.db.tournament_registrations.find({"tournament_id": w["tid"]}, {"_id": 0}).to_list(5)}
    for row in (side, twin):
        flow.act_as(row["captain"])
        page = ok(await flow.get(f"/api/matches/{match['id']}/page"))
        assert page["acting_registration_id"] == regs[row["squad"]["id"]]


@pytest.mark.asyncio
async def test_without_the_switch_the_admin_way_is_unchanged(flow):
    w = await application_world(flow)
    side = w["teams"][0]
    twin = await second_squad(flow, w, side)
    flow.act_as(w["lead"])
    ok(await flow.post(f"/api/tournaments/{w['tid']}/squad-registrations", json={"team_id": side["team"]["id"], "squad_id": side["squad"]["id"]}))

    refused = await flow.post(f"/api/tournaments/{w['tid']}/squad-registrations", json={"team_id": twin["team"]["id"], "squad_id": twin["squad"]["id"]})

    assert refused.status_code == 409 and "zwei Co-Teams" in refused.json()["detail"]
    reg = await flow.db.tournament_registrations.find_one({"squad_id": side["squad"]["id"]}, {"_id": 0})
    assert reg["registered_via"] == "league_assign" and reg["source"] == "staff_add" and reg["accepted_rules"] is False and "application_id" not in reg
    assert reg["identity_key"] == f"{w['tid']}:team:{side['team']['id']}"


# ---------------------------------------------------------------- Sonderweg

@pytest.mark.asyncio
async def test_the_admin_way_links_an_open_application_and_taking_it_back_keeps_the_seat(flow):
    w = await application_world(flow, application_slots=2)
    side = w["teams"][0]
    application = await submitted(flow, w, side)
    flow.act_as(w["lead"])

    reg = ok(await flow.post(f"/api/tournaments/{w['tid']}/squad-registrations", json={"team_id": side["team"]["id"], "squad_id": side["squad"]["id"]}))["registration"]

    linked = await stored(flow, application)
    assert linked["status"] == "accepted" and linked["assignment"]["registration_id"] == reg["id"]
    assert (await inbox(flow, w))["stats"]["taken"] == 1

    flow.act_as(w["lead"])
    ok(await flow.delete(f"/api/tournaments/{w['tid']}/squad-registrations/{reg['id']}"))

    cleared = await stored(flow, application)
    assert cleared["status"] == "accepted" and "assignment" not in cleared
    assert (await inbox(flow, w))["stats"]["taken"] == 1, "der Antrag hält seinen Platz, bis die Leitung neu entscheidet"
    ok(await decide(flow, w, application, "assign", tournament_id=w["tid"]))


@pytest.mark.asyncio
async def test_the_admin_way_ignores_closed_applications(flow):
    w = await application_world(flow)
    side = w["teams"][0]
    application = await submitted(flow, w, side)
    ok(await decide(flow, w, application, "reject", reason="Erst einmal nicht"))
    flow.act_as(w["lead"])

    ok(await flow.post(f"/api/tournaments/{w['tid']}/squad-registrations", json={"team_id": side["team"]["id"], "squad_id": side["squad"]["id"]}))

    assert (await stored(flow, application))["status"] == "rejected"


# ---------------------------------------------------------------- Nachrichten

@pytest.mark.asyncio
async def test_messages_reach_captain_vice_and_lead(flow):
    w = await application_world(flow)
    side = w["teams"][0]
    application = await submitted(flow, w, side)

    for person in (side["captain"], side["vice"]):
        note = await flow.db.notifications.find_one({"user_id": person["id"], "meta.reason": "league_application_submitted"}, {"_id": 0})
        assert note["meta"]["dedupe_key"].startswith(f"league-application:{application['id']}:submitted:")
        assert note["url"] == base_url(w).replace("/api/leagues", "/liga")
    lead_note = await flow.db.notifications.find_one({"user_id": w["lead"]["id"], "meta.reason": "league_application_submitted"}, {"_id": 0})
    assert lead_note["url"] == f"/admin/leagues/seasons/{w['season']['id']}#anmeldungen"
    assert await flow.db.notifications.find_one({"user_id": side["member"]["id"]}, {"_id": 1}) is None
    assert await flow.db.notifications.find_one({"user_id": w["teams"][1]["captain"]["id"], "meta.reason": "league_application_submitted"}, {"_id": 1}) is None

    ok(await decide(flow, w, application, "waitlist"))
    ok(await decide(flow, w, application, "accept", tournament_id=w["tid"]))
    reasons = {(row.get("meta") or {}).get("reason") for row in await flow.db.notifications.find({"user_id": side["captain"]["id"]}, {"_id": 0}).to_list(20)}
    assert {"league_application_submitted", "league_application_waitlist", "league_application_accepted"} <= reasons
    mails = await flow.db.mail_jobs.find({"template_key": "league_notice", "to": side["captain"]["email"]}, {"_id": 0}).to_list(10)
    assert len(mails) == 3


@pytest.mark.asyncio
async def test_a_second_accept_after_the_waitlist_tells_the_team_again(flow):
    w = await application_world(flow)
    side = w["teams"][0]
    application = await submitted(flow, w, side)
    ok(await decide(flow, w, application, "accept"))
    ok(await decide(flow, w, application, "waitlist"))
    ok(await decide(flow, w, application, "accept"))

    notes = await flow.db.notifications.find({"user_id": side["captain"]["id"], "meta.reason": "league_application_accepted"}, {"_id": 0}).to_list(5)

    assert len(notes) == 2


@pytest.mark.asyncio
async def test_a_failing_message_does_not_stop_the_decision(flow, monkeypatch):
    from services import league_applications

    w = await application_world(flow)
    application = await submitted(flow, w, w["teams"][0])

    async def broken(*_args, **_kwargs):
        raise RuntimeError("Postfach klemmt")

    monkeypatch.setattr(league_applications, "send_league_mail", broken)

    assert ok(await decide(flow, w, application, "accept"))["status"] == "accepted"


# ---------------------------------------------------------------- Eingang

@pytest.mark.asyncio
async def test_inbox_shows_consent_people_and_staffeln_without_birth_dates(flow):
    w = await application_world(flow, min_age=18)
    side = w["teams"][1]
    await flow.db.users.update_many({"id": {"$in": [user["id"] for user in side["people"]]}}, {"$set": {"birth_date": "1990-05-05"}})
    await submitted(flow, w, side)
    # Die nächste Person hat noch kein Datum: der Grund steht da, nie ein Datum.
    await flow.db.team_squads.update_one({"id": side["squad"]["id"]}, {"$addToSet": {"member_ids": w["teams"][1]["lead"]["id"]}})

    body = await inbox(flow, w)

    row = body["items"][0]
    assert row["rules_version"] == w["rule"]["version"] and row["rules_at"] and row["privacy_at"]
    assert row["applied_by_name"] == "TeamB S0" and row["captain_name"] == "TeamB S0" and row["vice_name"] == "TeamB S1"
    assert row["member_count"] == 5
    assert any("Geburtsdatum fehlt" in text for text in row["problems"])
    assert "1990" not in str(body)
    assert [staffel["staffel"] for staffel in body["divisions"][0]["staffeln"]] == ["A"]
    assert [step["status"] for step in row["history"]] == ["submitted"]


@pytest.mark.asyncio
async def test_inbox_names_shared_players_and_the_own_team(flow):
    w = await application_world(flow)
    side, other = w["teams"][0], w["teams"][1]
    await flow.db.teams.update_one({"id": side["team"]["id"]}, {"$addToSet": {"member_ids": other["people"][3]["id"]}})
    await flow.db.team_squads.update_one({"id": side["squad"]["id"]}, {"$addToSet": {"member_ids": other["people"][3]["id"]}})
    await submitted(flow, w, side)
    await submitted(flow, w, other)
    await flow.db.team_squads.update_one({"id": other["squad"]["id"]}, {"$addToSet": {"member_ids": w["lead"]["id"]}})

    items = {row["squad_id"]: row for row in (await inbox(flow, w))["items"]}

    assert items[side["squad"]["id"]]["shared_with"] == [other["team"]["name"] + " · " + other["squad"]["name"]]
    assert items[other["squad"]["id"]]["own_team"] is True and items[side["squad"]["id"]]["own_team"] is False
    flow.act_as(side["captain"])
    assert other["team"]["name"] not in str(ok(await flow.get(f"{base_url(w)}/application")))


@pytest.mark.asyncio
async def test_after_leaving_the_staffel_team_and_inbox_say_so(flow):
    w = await application_world(flow, application_slots=1)
    side = w["teams"][0]
    application = await submitted(flow, w, side)
    done = ok(await decide(flow, w, application, "accept", tournament_id=w["tid"]))
    await flow.db.tournament_registrations.update_one({"id": done["assignment"]["registration_id"]}, {"$set": {"status": "withdrawn"}})

    assert (await inbox(flow, w))["items"][0]["assignment"]["left"] is True
    assert (await inbox(flow, w))["stats"]["free"] == 1, "der Platz ist frei"
    flow.act_as(side["captain"])
    row = ok(await flow.get(f"{base_url(w)}/application"))["squads"][0]
    assert row["application"]["staffel_left"] is True
    assert ok(await flow.get("/api/me/league-applications"))["items"][0]["staffel_left"] is True


@pytest.mark.asyncio
async def test_the_answer_to_the_team_carries_no_ids_of_the_lead(flow):
    w = await application_world(flow)
    side = w["teams"][0]
    application = await submitted(flow, w, side)
    ok(await decide(flow, w, application, "waitlist", reason="Erst einmal warten"))
    flow.act_as(side["captain"])

    answer = ok(await flow.post(f"{base_url(w)}/applications/{application['id']}/withdraw", json={}))
    view = ok(await flow.get(f"{base_url(w)}/application"))

    assert w["lead"]["id"] not in str(answer) and w["lead"]["id"] not in str(view)
    assert answer["decision_reason"] == "Erst einmal warten"


# ---------------------------------------------------------------- Löschen und Auskunft

@pytest.mark.asyncio
async def test_a_season_with_applications_cannot_be_deleted(flow):
    w = await application_world(flow, rules=False)
    await flow.db.league_applications.insert_one({"id": "probe", "season_id": w["season"]["id"], "squad_id": "x", "team_id": "y", "status": "rejected"})
    flow.act_as(w["lead"])

    plan = ok(await flow.get(f"{ADMIN_LEAGUES}/seasons/{w['season']['id']}/delete-plan"))

    assert plan["deletable"] is False and any("Anmeldungen" in text for text in plan["blockers"])


@pytest.mark.asyncio
async def test_a_squad_with_an_open_application_stays(flow):
    w = await application_world(flow)
    side = w["teams"][0]
    application = await submitted(flow, w, side)
    flow.act_as(side["lead"])

    refused = await flow.delete(f"/api/teams/{side['team']['id']}/squads/{side['squad']['id']}")
    assert refused.status_code == 409 and "Anmeldung" in refused.json()["detail"]
    preview = ok(await flow.get(f"/api/teams/{side['team']['id']}/dissolve-preview"))
    assert preview["blocked"]

    flow.act_as(side["captain"])
    ok(await flow.post(f"{base_url(w)}/applications/{application['id']}/withdraw", json={}))
    flow.act_as(side["lead"])
    ok(await flow.delete(f"/api/teams/{side['team']['id']}/squads/{side['squad']['id']}"))


@pytest.mark.asyncio
async def test_erasing_an_account_keeps_the_application_without_the_person(flow):
    w = await application_world(flow)
    side = w["teams"][0]
    application = await submitted(flow, w, side)
    ok(await decide(flow, w, application, "accept", tournament_id=w["tid"]))
    captain = side["captain"]["id"]

    await account_erasure.erase_related(flow.db, side["captain"], now_utc().isoformat())

    row = await stored(flow, application)
    assert row["status"] == "accepted" and row["squad_id"] == side["squad"]["id"]
    assert captain not in str(row)
    assert await flow.db.league_rule_consents.count_documents({"user_id": captain}) == 0


def test_the_collection_is_on_the_personal_data_map():
    entry = personal_data.PERSONAL["league_applications"]

    assert entry.erasure == personal_data.OVERWRITTEN and "league_applications" in entry.export


@pytest.mark.asyncio
async def test_export_contains_the_own_application_without_the_lead(flow):
    from routes.dsgvo_routes import _user_data_sections

    w = await application_world(flow)
    side = w["teams"][0]
    application = await submitted(flow, w, side)
    ok(await decide(flow, w, application, "reject", reason="Passt noch nicht"))

    sections = dict(await _user_data_sections(flow.db, side["captain"]["id"]))
    kind, produce = sections["league_applications"]
    rows = [row async for row in produce()]

    assert [row["id"] for row in rows] == [application["id"]] and kind == "list"
    assert rows[0]["decision_reason"] == "Passt noch nicht"
    assert rows[0]["rule_consent"]["user_id"] == side["captain"]["id"] and rows[0]["privacy_consent"]["user_id"] == side["captain"]["id"]
    assert [step["status"] for step in rows[0]["my_steps"]] == ["submitted"]
    assert w["lead"]["id"] not in str(rows)


async def exported(flow, user_id: str) -> list[dict]:
    from routes.dsgvo_routes import _user_data_sections

    _kind, produce = dict(await _user_data_sections(flow.db, user_id))["league_applications"]
    return [row async for row in produce()]


@pytest.mark.asyncio
async def test_export_shows_the_lead_their_own_steps_without_the_team(flow):
    w = await application_world(flow)
    side = w["teams"][0]
    application = await submitted(flow, w, side)
    ok(await decide(flow, w, application, "review"))
    ok(await decide(flow, w, application, "accept", tournament_id=w["tid"]))

    rows = await exported(flow, w["lead"]["id"])

    assert [row["id"] for row in rows] == [application["id"]]
    assert [step["status"] for step in rows[0]["my_steps"]] == ["in_review", "accepted"]
    assert rows[0]["rule_consent"] is None and rows[0]["privacy_consent"] is None
    assert side["captain"]["id"] not in str(rows)


@pytest.mark.asyncio
async def test_export_for_a_vice_who_withdrew_leaves_out_the_captains_consent(flow):
    w = await application_world(flow)
    side = w["teams"][0]
    application = await submitted(flow, w, side)
    flow.act_as(side["vice"])
    ok(await flow.post(f"{base_url(w)}/applications/{application['id']}/withdraw", json={}))

    rows = await exported(flow, side["vice"]["id"])

    assert [row["id"] for row in rows] == [application["id"]] and rows[0]["withdrawn_at"]
    assert [step["status"] for step in rows[0]["my_steps"]] == ["withdrawn"]
    assert rows[0]["rule_consent"] is None and side["captain"]["id"] not in str(rows)


@pytest.mark.asyncio
async def test_other_team_tournaments_do_not_know_applications(flow):
    """Ein Team-Turnier ohne Liga-Rahmen bleibt, wie es ist: kein Schlüssel, kein Antrag, kein Season-Feld."""
    from squad_world import league_world

    w = await league_world(flow)
    flow.act_as(w["staff"])

    answer = await flow.post(f"/api/tournaments/{w['tournament']['id']}/squad-registrations",
                             json={"team_id": w["lions"]["id"], "squad_id": w["squad_a"]["id"]})

    assert answer.status_code == 200, answer.text
    reg = answer.json()["registration"]
    assert reg["registered_via"] == "league_assign" and "league_squad_key" not in reg and "application_id" not in reg
    assert await flow.db.league_applications.count_documents({}) == 0


@pytest.mark.asyncio
async def test_a_small_team_added_later_can_apply(flow):
    w = await application_world(flow, teams=0)
    side = await add_team(flow, w, "Spaet")

    assert (await submit(flow, w, side)).status_code == 200
