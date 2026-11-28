"""Anmeldung als Person, Paket P2 (#1629, S7 und S8; docs/LIGA.md „S.2 Solo-Liga – Anmeldung als Spieler“).

Derselbe Antrag wie beim Co-Team (``league_applications`` mit ``user_id``, Schlüssel ``<season>:user:<id>``), dieselben Zustände, dasselbe
Fenster, dieselben Startplätze und dieselbe Warteliste. Die Person meldet sich selbst an und stimmt selbst zu (F4 A). Daneben eine Team-Liga,
die sich anmeldet wie vorher (Gegenprobe). Nur erfundene Namen.
"""
import asyncio
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_application_world import application_world, base_url, decide, inbox_url, submitted, window  # noqa: E402
from league_rules_world import ADMIN_LEAGUES  # noqa: E402
from league_solo_world import assign_person, solo_application_world, submit_person, submitted_person  # noqa: E402
from league_start_world import ok  # noqa: E402
from services import league_applications, league_participants  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def no_preview(_db, _tournament, _actor_id):
    return None


def season_url(world: dict) -> str:
    return f"{ADMIN_LEAGUES}/seasons/{world['season']['id']}"


# ---------------------------------------------------------------- Fenster und Einreichen

@pytest.mark.asyncio
async def test_a_solo_season_takes_an_application_window(flow):
    w = await solo_application_world(flow, open_window=False)
    flow.act_as(w["lead"])

    saved = await flow.patch(season_url(w), json=window())

    assert saved.status_code == 200, saved.text
    assert saved.json()["application_opens_at"]
    flow.act_as(None)
    block = ok(await flow.get(base_url(w)))["application"]
    assert block["state"] == "open"


@pytest.mark.asyncio
async def test_a_player_applies_for_themself_and_consents_themself(flow):
    w = await solo_application_world(flow)
    player = w["players"][0]

    answer = await submitted_person(flow, w, player)

    stored = await flow.db.league_applications.find_one({"id": answer["id"]}, {"_id": 0})
    assert stored["status"] == "submitted"
    assert stored["user_id"] == player["id"] and stored["team_id"] is None and stored["squad_id"] is None
    assert stored["active_key"] == f"{w['season']['id']}:user:{player['id']}"
    assert stored["applied_by"] == player["id"]
    assert stored["display_name"] == "Duellant A"
    assert stored["rule_consent"]["user_id"] == player["id"] and stored["rule_consent"]["rule_version_id"] == w["rule"]["id"]
    # Konto ohne Mitgliedschaft (#1665, #2600): bis zur Freigabe der Platzhalter - für Spieler formuliert.
    assert stored["privacy_consent"]["text"] == league_applications.PRIVACY_PLACEHOLDER_PERSON
    assert stored["privacy_consent"]["user_id"] == player["id"]
    consent = await flow.db.league_rule_consents.find_one({"user_id": player["id"]}, {"_id": 0})
    assert consent["rule_version_id"] == w["rule"]["id"] and consent["season_id"] == w["season"]["id"]
    assert await flow.db.tournament_registrations.count_documents({}) == 0, "die Staffel steht erst nach der Entscheidung fest"
    audit = await flow.db.audit_logs.find_one({"action": "league.application.submit"}, {"_id": 0})
    assert audit["data"]["user_id"] == player["id"]
    note = await flow.db.notifications.find_one({"user_id": player["id"], "meta.reason": "league_application_submitted"}, {"_id": 0})
    assert note and "Co-Team" not in note["body"] and "Du" in note["body"]
    lead_note = await flow.db.notifications.find_one({"user_id": w["lead"]["id"], "meta.reason": "league_application_submitted"}, {"_id": 0})
    assert lead_note and "Duellant A" in lead_note["body"]


@pytest.mark.asyncio
async def test_the_released_privacy_text_reaches_guests_and_members_see_the_season_text(flow):
    w = await solo_application_world(flow, application_privacy_text="Probe-Hinweis für Spieler.")
    member, guest = w["players"][0], w["players"][1]
    member["is_club_member"] = True

    flow.act_as(member)
    assert ok(await flow.get(f"{base_url(w)}/application"))["privacy"]["text"] == "Probe-Hinweis für Spieler."
    flow.act_as(guest)
    assert ok(await flow.get(f"{base_url(w)}/application"))["privacy"]["text"] == league_applications.PRIVACY_PLACEHOLDER_PERSON
    await flow.db.league_seasons.update_one({"id": w["season"]["id"]}, {"$set": {
        league_applications.PRIVACY_RELEASE: {"text": "Probe-Hinweis für Spieler.", "at": "2026-11-27T10:00:00+00:00", "by": "x"}}})
    assert ok(await flow.get(f"{base_url(w)}/application"))["privacy"]["text"] == "Probe-Hinweis für Spieler."


@pytest.mark.asyncio
async def test_the_own_view_of_a_solo_season_has_the_player_and_no_squads(flow):
    w = await solo_application_world(flow)
    player = w["players"][0]

    flow.act_as(player)
    view = ok(await flow.get(f"{base_url(w)}/application"))

    assert view["kind"] == "solo" and view["squads"] == []
    assert view["player"]["state"] == "open" and view["player"]["can_submit"] is True
    assert view["player"]["display_name"] == "Duellant A" and view["player"]["problems"] == []
    await submitted_person(flow, w, player)
    flow.act_as(player)
    after = ok(await flow.get(f"{base_url(w)}/application"))["player"]
    assert after["state"] == "submitted" and after["can_submit"] is False
    assert after["application"]["can_withdraw"] is True


@pytest.mark.asyncio
async def test_a_squad_in_a_solo_league_and_no_squad_in_a_team_league_are_refused(flow):
    solo = await solo_application_world(flow)
    team = await application_world(flow, teams=1)

    with_squad = await submit_person(flow, solo, solo["players"][0], squad_id=team["teams"][0]["squad"]["id"])
    without_squad = await submit_person(flow, team, team["teams"][0]["captain"])

    assert with_squad.status_code == 422 and with_squad.json()["detail"] == league_applications.PERSON_NO_SQUAD
    assert without_squad.status_code == 422 and without_squad.json()["detail"] == league_applications.SQUAD_NEEDED
    assert await flow.db.league_applications.count_documents({}) == 0


# ---------------------------------------------------------------- Prüfung je Person (S8)

@pytest.mark.asyncio
async def test_one_open_application_per_person_and_season(flow):
    w = await solo_application_world(flow)
    player = w["players"][0]

    await submitted_person(flow, w, player)
    again = await submit_person(flow, w, player)

    assert again.status_code == 409 and again.json()["detail"] == league_applications.ALREADY_OPEN_PERSON
    assert await flow.db.league_applications.count_documents({"user_id": player["id"]}) == 1


@pytest.mark.asyncio
async def test_two_parallel_applications_of_one_person_give_one(flow):
    w = await solo_application_world(flow)
    player = w["players"][0]

    first, second = await asyncio.gather(submit_person(flow, w, player), submit_person(flow, w, player))

    assert sorted([first.status_code, second.status_code]) == [200, 409], (first.text, second.text)
    assert await flow.db.league_applications.count_documents({"user_id": player["id"]}) == 1
    assert await flow.db.league_rule_consents.count_documents({"user_id": player["id"]}) == 1


@pytest.mark.asyncio
async def test_a_person_assigned_by_the_lead_cannot_apply_again(flow):
    w = await solo_application_world(flow)
    player = w["players"][0]
    flow.act_as(w["lead"])
    ok(await assign_person(flow, {"id": w["tid"]}, player))

    refused = await submit_person(flow, w, player)

    assert refused.status_code == 409 and "schon in einer Staffel" in refused.json()["detail"]
    assert await flow.db.league_applications.count_documents({}) == 0


@pytest.mark.asyncio
async def test_a_members_only_season_refuses_a_guest_and_takes_a_member(flow):
    w = await solo_application_world(flow, entry_policy="members")
    member, guest = w["players"][0], w["players"][1]
    member["is_club_member"] = True
    await flow.db.users.update_one({"id": member["id"]}, {"$set": {"is_club_member": True}})

    refused = await submit_person(flow, w, guest)
    taken = await submit_person(flow, w, member)

    assert refused.status_code == 400 and "nur für Mitglieder" in refused.json()["detail"]
    assert taken.status_code == 200, taken.text


@pytest.mark.asyncio
async def test_a_sanctioned_person_neither_applies_nor_gets_assigned(flow):
    w = await solo_application_world(flow)
    player = w["players"][0]
    await flow.db.competition_sanctions.insert_one({
        "id": "sperre-1", "league_id": w["league"]["id"], "season_id": w["season"]["id"], "kind": "league_exclusion", "target_type": "player",
        "user_id": player["id"], "state": "final", "revoked_at": None, "ends_at": None, "created_at": "2026-11-01T10:00:00+00:00"})

    refused = await submit_person(flow, w, player)
    flow.act_as(w["lead"])
    assigned = await assign_person(flow, {"id": w["tid"]}, player)

    assert refused.status_code == 403 and "ausgeschlossen" in refused.json()["detail"]
    assert assigned.status_code == 403 and "ausgeschlossen" in assigned.json()["detail"]
    assert await flow.db.league_applications.count_documents({}) == 0
    assert await flow.db.tournament_registrations.count_documents({}) == 0


@pytest.mark.asyncio
async def test_missing_age_and_game_id_are_open_points_not_blocks(flow):
    w = await solo_application_world(flow, min_age=16)
    player = w["players"][0]

    flow.act_as(player)
    before = ok(await flow.get(f"{base_url(w)}/application"))["player"]
    answer = await submit_person(flow, w, player)

    assert before["problems"] == [] and before["can_submit"] is True
    assert any("Geburtsdatum" in text for text in before["warnings"])
    assert all("Die Person" not in text for text in before["warnings"]), "die eigene Sicht spricht die Person an"
    assert answer.status_code == 200, answer.text


# ---------------------------------------------------------------- Eingang der Leitung

@pytest.mark.asyncio
async def test_the_inbox_lists_persons_with_their_checks(flow):
    w = await solo_application_world(flow, min_age=16)
    application = await submitted_person(flow, w, w["players"][0])

    flow.act_as(w["lead"])
    inbox = ok(await flow.get(inbox_url(w)))

    item = next(row for row in inbox["items"] if row["id"] == application["id"])
    assert item["kind"] == "solo" and item["user_id"] == w["players"][0]["id"]
    assert item["display_name"] == "Duellant A" and item["applied_by_name"] == "Duellant A"
    assert item["problems"] == [] and any("Duellant A" in text for text in item["warnings"])
    assert item["own_team"] is False
    assert inbox["kind"] == "solo"


@pytest.mark.asyncio
async def test_accepting_with_a_staffel_writes_the_single_registration_and_tells_the_person(flow):
    w = await solo_application_world(flow)
    player = w["players"][0]
    application = await submitted_person(flow, w, player)

    accepted = await decide(flow, w, application, "accept", tournament_id=w["tid"])

    assert accepted.status_code == 200, accepted.text
    reg = await flow.db.tournament_registrations.find_one({"tournament_id": w["tid"]}, {"_id": 0})
    assert reg["user_id"] == player["id"] and reg["team_id"] is None and "squad_id" not in reg
    assert reg["registration_type"] == "solo" and reg["status"] == "approved"
    assert reg["registered_via"] == league_applications.VIA and reg["source"] == league_applications.VIA
    assert reg["application_id"] == application["id"] and reg["registered_by"] == player["id"]
    assert reg["accepted_rules"] is True and reg["accepted_privacy"] is True
    assert reg["identity_key"] == f"{w['tid']}:user:{player['id']}"
    assert reg["league_squad_key"] == f"{w['season']['id']}:user:{player['id']}"
    stored = await flow.db.league_applications.find_one({"id": application["id"]}, {"_id": 0})
    assert stored["status"] == "accepted" and stored["assignment"]["registration_id"] == reg["id"]
    note = await flow.db.notifications.find_one({"user_id": player["id"], "meta.reason": "league_application_accepted"}, {"_id": 0})
    assert note and "Co-Team" not in note["body"]
    assert note["meta"]["dedupe_key"].startswith(f"league-application:{application['id']}:accepted:")
    mails = await flow.db.mail_jobs.find({"template_key": "league_notice", "to": player["email"]}, {"_id": 0}).to_list(10)
    assert len(mails) == 2, "eingereicht und angenommen"


@pytest.mark.asyncio
async def test_accept_then_assign_reject_and_waitlist_work_for_persons(flow):
    w = await solo_application_world(flow, application_slots=2)
    one, two, three = [await submitted_person(flow, w, player) for player in w["players"]]

    ok(await decide(flow, w, one, "accept"))
    ok(await decide(flow, w, one, "assign", tournament_id=w["tid"]))
    short = await decide(flow, w, two, "reject", reason="kurz")
    ok(await decide(flow, w, two, "reject", reason="Kein Platz für diese Probe."))
    ok(await decide(flow, w, three, "waitlist"))

    rows = {row["id"]: row for row in await flow.db.league_applications.find({}, {"_id": 0}).to_list(10)}
    assert short.status_code == 422
    assert rows[one["id"]]["assignment"]["tournament_id"] == w["tid"]
    assert rows[two["id"]]["status"] == "rejected" and "active_key" not in rows[two["id"]]
    assert rows[three["id"]]["status"] == "waitlist"
    rejected = await flow.db.notifications.find_one({"user_id": w["players"][1]["id"], "meta.reason": "league_application_rejected"}, {"_id": 0})
    assert "Kein Platz für diese Probe." in rejected["body"]
    waiting = await flow.db.notifications.find_one({"user_id": w["players"][2]["id"], "meta.reason": "league_application_waitlist"}, {"_id": 0})
    assert waiting and "Warteliste" in waiting["body"]


@pytest.mark.asyncio
async def test_the_waitlist_moves_up_by_the_lead_when_a_seat_frees(flow):
    w = await solo_application_world(flow, application_slots=1)
    first = await submitted_person(flow, w, w["players"][0])
    second = await submitted_person(flow, w, w["players"][1])
    ok(await decide(flow, w, first, "accept"))
    ok(await decide(flow, w, second, "waitlist"))

    full = await decide(flow, w, second, "accept")
    flow.act_as(w["players"][0])
    ok(await flow.post(f"{base_url(w)}/applications/{first['id']}/withdraw", json={}))
    moved = await decide(flow, w, second, "accept", tournament_id=w["tid"])

    assert full.status_code == 409
    assert moved.status_code == 200, moved.text
    reg = await flow.db.tournament_registrations.find_one({"tournament_id": w["tid"]}, {"_id": 0})
    assert reg["user_id"] == w["players"][1]["id"]


@pytest.mark.asyncio
async def test_a_person_does_not_decide_on_their_own_application(flow):
    w = await solo_application_world(flow)
    # Eine Person der Liga-Leitung (Zuständigkeit „applications“) meldet sich selbst als Spieler an.
    helper = w["players"][0]
    await flow.db.league_staff.insert_one({"id": "zust-1", "league_id": w["league"]["id"], "user_id": helper["id"], "capabilities": ["applications"],
                                           "created_at": "2026-11-01T10:00:00+00:00", "created_by": "test"})
    application = await submitted_person(flow, w, helper)

    refused = await decide(flow, w, application, "accept", actor=helper)
    boss = {**helper, "role": "superadmin"}
    no_reason = await decide(flow, w, application, "accept", actor=boss)
    with_reason = await decide(flow, w, application, "accept", actor=boss, conflict_reason="Niemand sonst erreichbar, Start morgen")

    assert refused.status_code == 403 and refused.json()["detail"] == league_applications.PERSON_CONFLICT_DETAIL
    assert no_reason.status_code == 403
    assert with_reason.status_code == 200, with_reason.text
    stored = await flow.db.league_applications.find_one({"id": application["id"]}, {"_id": 0})
    assert stored["history"][-1]["conflict_reason"] == "Niemand sonst erreichbar, Start morgen"
    flow.act_as(helper)
    inbox = ok(await flow.get(inbox_url(w)))
    assert next(row for row in inbox["items"] if row["id"] == application["id"])["own_team"] is True


@pytest.mark.asyncio
async def test_new_players_start_in_the_lowest_division(flow):
    w = await solo_application_world(flow)
    flow.act_as(w["lead"])
    lower = ok(await flow.post(f"{season_url(w)}/divisions", json={}))
    lower_tid = ok(await flow.post(f"{ADMIN_LEAGUES}/divisions/{lower['id']}/staffeln", json={}))["tournament_id"]
    application = await submitted_person(flow, w, w["players"][0])

    higher = await decide(flow, w, application, "accept", tournament_id=w["tid"])
    lowest = await decide(flow, w, application, "accept", tournament_id=lower_tid)

    assert higher.status_code == 422 and "untersten Liga" in higher.json()["detail"]
    assert lowest.status_code == 200, lowest.text


# ---------------------------------------------------------------- Zurückziehen

@pytest.mark.asyncio
async def test_only_the_person_withdraws_and_not_after_the_assignment(flow):
    w = await solo_application_world(flow)
    player, other = w["players"][0], w["players"][1]
    application = await submitted_person(flow, w, player)

    flow.act_as(other)
    foreign = await flow.post(f"{base_url(w)}/applications/{application['id']}/withdraw", json={})
    ok(await decide(flow, w, application, "accept", tournament_id=w["tid"]))
    flow.act_as(player)
    after_assign = await flow.post(f"{base_url(w)}/applications/{application['id']}/withdraw", json={})

    assert foreign.status_code == 403 and foreign.json()["detail"] == league_applications.NOT_THE_PERSON
    assert after_assign.status_code == 409 and after_assign.json()["detail"] == league_applications.WITHDRAW_ASSIGNED_PERSON


@pytest.mark.asyncio
async def test_withdrawing_frees_the_seat_and_allows_a_new_application(flow):
    w = await solo_application_world(flow, application_slots=1)
    player = w["players"][0]
    application = await submitted_person(flow, w, player)
    ok(await decide(flow, w, application, "accept"))

    flow.act_as(player)
    done = ok(await flow.post(f"{base_url(w)}/applications/{application['id']}/withdraw", json={}))
    again = await submit_person(flow, w, player)

    assert done["status"] == "withdrawn"
    assert again.status_code == 200, again.text
    note = await flow.db.notifications.find_one({"user_id": w["lead"]["id"], "meta.reason": "league_application_withdrawn"}, {"_id": 0})
    assert note and "Duellant A" in note["body"]


# ---------------------------------------------------------------- Automatisch annehmen

@pytest.mark.asyncio
async def test_auto_accept_seats_a_person_in_the_only_staffel_and_the_person_withdraws_it(flow):
    w = await solo_application_world(flow, application_auto_accept=True, application_slots=4)
    player = w["players"][0]

    answer = await submitted_person(flow, w, player)

    assert answer["status"] == "accepted" and answer["staffel"]
    reg = await flow.db.tournament_registrations.find_one({"tournament_id": w["tid"]}, {"_id": 0})
    assert reg["user_id"] == player["id"] and reg["registered_by"] == player["id"]
    flow.act_as(player)
    done = ok(await flow.post(f"{base_url(w)}/applications/{answer['id']}/withdraw", json={}))
    assert done["status"] == "withdrawn"
    assert await flow.db.tournament_registrations.count_documents({"tournament_id": w["tid"]}) == 0


@pytest.mark.asyncio
async def test_auto_accept_hands_out_the_last_seat_once(flow):
    w = await solo_application_world(flow, application_auto_accept=True, application_slots=1, players=3)
    league = await flow.db.leagues.find_one({"id": w["league"]["id"]}, {"_id": 0})
    season = await flow.db.league_seasons.find_one({"id": w["season"]["id"]}, {"_id": 0})
    body = {"rule_version_id": w["rule"]["id"], "accept_rules": True, "accept_privacy": True}

    # Die Harness kennt je Anfrage nur eine Person - drei Personen gleichzeitig gehen darum direkt über den Dienst (wie im Race-Test der Co-Teams).
    answers = await asyncio.gather(*(league_applications.submit(flow.db, league, season, body, player, refresh_previews=no_preview)
                                     for player in w["players"]))

    states = sorted(answer["status"] for answer in answers)
    assert states == ["accepted", "waitlist", "waitlist"]
    assert await flow.db.tournament_registrations.count_documents({"tournament_id": w["tid"]}) == 1


# ---------------------------------------------------------------- Zuteilen durch die Leitung (Sonderweg)

@pytest.mark.asyncio
async def test_assigning_a_person_with_an_open_application_accepts_it(flow):
    w = await solo_application_world(flow)
    player = w["players"][0]
    application = await submitted_person(flow, w, player)

    flow.act_as(w["lead"])
    ok(await assign_person(flow, {"id": w["tid"]}, player))

    stored = await flow.db.league_applications.find_one({"id": application["id"]}, {"_id": 0})
    assert stored["status"] == "accepted" and stored["assignment"]["tournament_id"] == w["tid"]
    audit = await flow.db.audit_logs.find_one({"action": "league.application.accept", "data.via": "squad_assign"}, {"_id": 0})
    assert audit and audit["data"]["user_id"] == player["id"]


@pytest.mark.asyncio
async def test_removing_the_assignment_keeps_the_application_accepted_and_seated(flow):
    w = await solo_application_world(flow, application_slots=1)
    player = w["players"][0]
    application = await submitted_person(flow, w, player)
    ok(await decide(flow, w, application, "accept", tournament_id=w["tid"]))
    reg = await flow.db.tournament_registrations.find_one({"tournament_id": w["tid"]}, {"_id": 0})

    flow.act_as(w["lead"])
    removed = await flow.delete(f"/api/tournaments/{w['tid']}/registrations/{reg['id']}")

    assert removed.status_code == 200, removed.text
    stored = await flow.db.league_applications.find_one({"id": application["id"]}, {"_id": 0})
    assert stored["status"] == "accepted" and "assignment" not in stored
    flow.act_as(w["lead"])
    assert ok(await flow.get(inbox_url(w)))["stats"]["taken"] == 1


@pytest.mark.asyncio
async def test_an_application_and_a_lead_assignment_race_for_the_last_staffel_seat(flow):
    w = await solo_application_world(flow)
    await flow.db.tournaments.update_one({"id": w["tid"]}, {"$set": {"max_participants": 1}})
    one, two = w["players"][0], w["players"][1]
    application = await submitted_person(flow, w, one)
    flow.act_as(w["lead"])

    answers = await asyncio.gather(flow.post(f"{inbox_url(w)}/{application['id']}/accept", json={"tournament_id": w["tid"]}),
                                   assign_person(flow, {"id": w["tid"]}, two))

    assert sorted(answer.status_code for answer in answers) == [200, 409], [answer.text for answer in answers]
    assert await flow.db.tournament_registrations.count_documents({"tournament_id": w["tid"]}) == 1


@pytest.mark.asyncio
async def test_accepting_and_assigning_the_same_person_into_two_staffeln_gives_one_seat(flow):
    w = await solo_application_world(flow, staffeln=2)
    player = w["players"][0]
    application = await submitted_person(flow, w, player)
    flow.act_as(w["lead"])

    answers = await asyncio.gather(flow.post(f"{inbox_url(w)}/{application['id']}/accept", json={"tournament_id": w["tids"][0]}),
                                   assign_person(flow, {"id": w["tids"][1]}, player))

    assert all(answer.status_code in (200, 409) for answer in answers), [answer.text for answer in answers]
    assert await flow.db.tournament_registrations.count_documents({"user_id": player["id"]}) == 1
    stored = await flow.db.league_applications.find_one({"id": application["id"]}, {"_id": 0})
    reg = await flow.db.tournament_registrations.find_one({"user_id": player["id"]}, {"_id": 0})
    assert stored["status"] == "accepted" and stored["assignment"]["registration_id"] == reg["id"]


@pytest.mark.asyncio
async def test_the_desk_lists_a_waiting_person(flow):
    w = await solo_application_world(flow)
    await submitted_person(flow, w, w["players"][0])
    flow.act_as(w["lead"])

    desk = ok(await flow.get(f"{season_url(w)}/desk"))

    titles = [item.get("title") for item in desk.get("tasks", desk.get("items", [])) if isinstance(item, dict)]
    assert "Duellant A" in str(desk), titles


@pytest.mark.asyncio
async def test_seats_of_the_season_count_assigned_persons(flow):
    w = await solo_application_world(flow, application_slots=1)
    flow.act_as(w["lead"])
    ok(await assign_person(flow, {"id": w["tid"]}, w["players"][0]))
    application = await submitted_person(flow, w, w["players"][1])

    refused = await decide(flow, w, application, "accept")

    assert refused.status_code == 409 and refused.json()["detail"] == league_applications.SEATS_TAKEN_PERSON


# ---------------------------------------------------------------- Kontolöschung und Los

@pytest.mark.asyncio
async def test_account_erasure_withdraws_an_open_application_and_frees_the_seat(flow):
    w = await solo_application_world(flow, application_slots=1)
    player = w["players"][0]
    application = await submitted_person(flow, w, player)
    ok(await decide(flow, w, application, "accept"))

    await league_applications.scrub_person(flow.db, player["id"])

    stored = await flow.db.league_applications.find_one({"id": application["id"]}, {"_id": 0})
    assert stored["status"] == "withdrawn" and "active_key" not in stored
    assert stored["user_id"] is None and stored["applied_by"] is None
    assert stored["display_name"] == league_applications.GONE_PERSON
    assert player["id"] not in str(stored)
    flow.act_as(w["lead"])
    assert ok(await flow.get(inbox_url(w)))["stats"]["taken"] == 0


@pytest.mark.asyncio
async def test_the_draw_follows_for_solo_leagues(flow):
    w = await solo_application_world(flow)
    application = await submitted_person(flow, w, w["players"][0])
    ok(await decide(flow, w, application, "accept"))
    flow.act_as(w["lead"])

    overview = ok(await flow.get(f"{season_url(w)}/draws"))
    drawn = await flow.post(f"{season_url(w)}/draws/{w['division']['id']}", json={})

    assert overview["solo_follows"] == league_participants.DRAW_FOLLOWS and overview["divisions"] == []
    assert drawn.status_code == 409 and drawn.json()["detail"] == league_participants.DRAW_FOLLOWS


# ---------------------------------------------------------------- Gegenprobe: Team-Liga daneben

@pytest.mark.asyncio
async def test_a_team_league_applies_as_before_next_to_a_solo_league(flow):
    solo = await solo_application_world(flow)
    team = await application_world(flow, teams=2)
    person = await submitted_person(flow, solo, solo["players"][0])
    side = team["teams"][0]

    application = await submitted(flow, team, side)
    flow.act_as(side["captain"])
    view = ok(await flow.get(f"{base_url(team)}/application"))
    ok(await decide(flow, team, application, "accept", tournament_id=team["tid"]))
    flow.act_as(team["lead"])
    inbox = ok(await flow.get(inbox_url(team)))

    stored = await flow.db.league_applications.find_one({"id": application["id"]}, {"_id": 0})
    assert stored["active_key"] == f"{team['season']['id']}:{side['squad']['id']}"
    assert "user_id" not in stored and stored["squad_id"] == side["squad"]["id"]
    assert "kind" not in view and "player" not in view and view["squads"]
    assert "kind" not in inbox and all("kind" not in row and "user_id" not in row for row in inbox["items"])
    reg = await flow.db.tournament_registrations.find_one({"tournament_id": team["tid"]}, {"_id": 0})
    assert reg["squad_id"] == side["squad"]["id"] and reg["registration_type"] == "team"
    flow.act_as(None)
    assert "participant_kind" not in ok(await flow.get(base_url(team)))["application"]
    assert ok(await flow.get(base_url(solo)))["application"]["participant_kind"] == "solo"
    assert (await flow.db.league_applications.find_one({"id": person["id"]}))["status"] == "submitted"


# ---------------------------------------------------------------- Nachträge aus der Prüfung (M1, g08, g10, g13)

def test_the_staffel_refusal_points_solo_players_to_the_league_page():
    from services import staffel_guard

    text = staffel_guard.registration_refused({"league_context": {"season_id": "s"}, "team_mode": "solo"})
    assert "folgt" not in text
    assert "auf der Ligaseite als Spieler an" in text and "Spieler zuteilen" in text


@pytest.mark.asyncio
async def test_erasure_of_an_assigned_person_keeps_no_id_in_the_application(flow):
    w = await solo_application_world(flow)
    player = w["players"][0]
    application = await submitted_person(flow, w, player)
    ok(await decide(flow, w, application, "accept", tournament_id=w["tid"]))

    await league_applications.scrub_person(flow.db, player["id"])

    stored = await flow.db.league_applications.find_one({"id": application["id"]}, {"_id": 0})
    assert stored["user_id"] is None and stored["status"] == "accepted"
    assert not {key: value for key, value in stored.items() if player["id"] in str(value)}
    assert stored["active_key"] == f"{w['season']['id']}:user:erased:{application['id']}"


@pytest.mark.asyncio
async def test_team_seat_count_ignores_single_registrations_in_a_team_staffel(flow):
    team = await application_world(flow, teams=2, application_slots=2)
    flow.act_as(team["lead"])
    before = ok(await flow.get(inbox_url(team)))["stats"]
    await flow.db.tournament_registrations.insert_one({"id": "alt-1", "tournament_id": team["tid"], "user_id": "u-alt", "team_id": None,
                                                       "status": "approved", "registration_type": "solo"})

    after = ok(await flow.get(inbox_url(team)))["stats"]

    assert after["taken"] == before["taken"], (before, after)


@pytest.mark.asyncio
async def test_the_solo_view_has_a_hint_for_old_app_clients(flow):
    w = await solo_application_world(flow)
    flow.act_as(w["players"][0])

    view = ok(await flow.get(f"{base_url(w)}/application"))

    assert view["squads"] == [] and view["hint"] == league_applications.PERSON_APP_HINT


@pytest.mark.asyncio
async def test_the_lead_reads_person_sentences_for_reasons_and_divisions(flow):
    w = await solo_application_world(flow)
    flow.act_as(w["lead"])
    lower = ok(await flow.post(f"{season_url(w)}/divisions", json={}))
    ok(await flow.post(f"{ADMIN_LEAGUES}/divisions/{lower['id']}/staffeln", json={}))
    application = await submitted_person(flow, w, w["players"][0])

    higher = await decide(flow, w, application, "accept", tournament_id=w["tid"])
    no_reason = await decide(flow, w, application, "reject", reason="kurz")
    ok(await decide(flow, w, application, "accept"))
    demote = await decide(flow, w, application, "waitlist")

    assert higher.status_code == 422 and higher.json()["detail"].startswith("Neue Spieler starten in der untersten Liga")
    assert no_reason.status_code == 422 and no_reason.json()["detail"].endswith("Der Spieler liest ihn.")
    assert demote.status_code == 422 and "der Spieler liest ihn" in demote.json()["detail"]
    for answer in (higher, no_reason, demote):
        assert "Co-Team" not in answer.json()["detail"] and "Team liest" not in answer.json()["detail"]