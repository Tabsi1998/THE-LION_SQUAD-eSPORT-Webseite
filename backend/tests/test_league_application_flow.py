"""Selbstanmeldung mit Co-Team (docs/LIGA.md, B.4, #2205): einreichen, prüfen, zustimmen, zurückziehen. Erfundene Namen."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_application_world import add_team, application_world, base_url, decide, submit, submitted, window  # noqa: E402
from league_rules_world import ADMIN_LEAGUES, in_days, publish  # noqa: E402
from league_start_world import ok  # noqa: E402
from squad_world import make_squad  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


# ---------------------------------------------------------------- Ohne Feld wie vorher

@pytest.mark.asyncio
async def test_without_a_window_there_is_no_self_registration(flow):
    w = await application_world(flow, open_window=False)
    side = w["teams"][0]

    flow.act_as(None)
    assert ok(await flow.get(base_url(w)))["application"] is None
    flow.act_as(side["captain"])
    view = ok(await flow.get(f"{base_url(w)}/application"))
    assert view["application"] is None
    refused = await submit(flow, w, side)
    assert refused.status_code == 409
    assert "keine Selbstanmeldung" in refused.json()["detail"]
    assert await flow.db.league_applications.count_documents({}) == 0
    assert await flow.db.league_rule_consents.count_documents({}) == 0


@pytest.mark.asyncio
async def test_a_new_season_carries_the_defaults_and_no_window(flow):
    w = await application_world(flow, open_window=False)
    stored = await flow.db.league_seasons.find_one({"id": w["season"]["id"]}, {"_id": 0})

    assert stored["entry_policy"] == "all"
    assert stored["sibling_squads_in_staffel"] is False
    assert stored["application_waitlist"] is True
    assert "application_opens_at" not in stored and "application_slots" not in stored


@pytest.mark.asyncio
async def test_window_needs_both_ends_in_order(flow):
    w = await application_world(flow, open_window=False)
    flow.act_as(w["lead"])
    url = f"{ADMIN_LEAGUES}/seasons/{w['season']['id']}"
    times = window()

    only_start = await flow.patch(url, json={"application_opens_at": times["application_opens_at"]})
    assert only_start.status_code == 422 and "Anmeldefenster" in only_start.json()["detail"]
    backwards = await flow.patch(url, json={"application_opens_at": times["application_closes_at"], "application_closes_at": times["application_opens_at"]})
    assert backwards.status_code == 422 and "Anmeldefenster" in backwards.json()["detail"]
    ok(await flow.patch(url, json=times))
    cleared = ok(await flow.patch(url, json={"application_opens_at": None, "application_closes_at": None}))
    assert cleared["application_opens_at"] is None


@pytest.mark.asyncio
async def test_the_window_entered_without_zone_counts_as_vienna_time(flow):
    w = await application_world(flow, open_window=False)
    flow.act_as(w["lead"])

    saved = ok(await flow.patch(f"{ADMIN_LEAGUES}/seasons/{w['season']['id']}", json={
        "application_opens_at": "2030-07-01T18:00:00", "application_closes_at": "2030-07-02T18:00:00"}))

    assert saved["application_opens_at"].startswith("2030-07-01T16:00:00")


# ---------------------------------------------------------------- Einreichen

@pytest.mark.asyncio
async def test_captain_submits_and_consent_is_proven(flow):
    w = await application_world(flow, application_privacy_text="Probe-Hinweis zum Datenschutz.")
    side = w["teams"][0]

    application = await submitted(flow, w, side)

    stored = await flow.db.league_applications.find_one({"id": application["id"]}, {"_id": 0})
    assert stored["status"] == "submitted"
    assert stored["active_key"] == f"{w['season']['id']}:{side['squad']['id']}"
    assert stored["applied_by"] == side["captain"]["id"]
    assert stored["display_name"] == "TeamA · TeamA Eins"
    assert stored["rule_consent"]["rule_version_id"] == w["rule"]["id"]
    assert stored["rule_consent"]["user_id"] == side["captain"]["id"] and stored["rule_consent"]["at"]
    assert stored["privacy_consent"] == {"text": "Probe-Hinweis zum Datenschutz.", "user_id": side["captain"]["id"], "at": stored["privacy_consent"]["at"]}
    assert stored["privacy_consent"]["at"]
    assert [row["status"] for row in stored["history"]] == ["submitted"]
    consent = await flow.db.league_rule_consents.find_one({"squad_id": side["squad"]["id"]}, {"_id": 0})
    assert consent["rule_version_id"] == w["rule"]["id"] and consent["user_id"] == side["captain"]["id"] and consent["season_id"] == w["season"]["id"]
    assert stored["rule_consent"]["consent_id"] == consent["id"]
    assert await flow.db.tournament_registrations.count_documents({"squad_id": side["squad"]["id"]}) == 0, "die Staffel steht erst nach der Genehmigung fest"
    audit = await flow.db.audit_logs.find_one({"action": "league.application.submit"}, {"_id": 0})
    assert audit["target_id"] == w["season"]["id"] and audit["data"]["application_id"] == application["id"]


@pytest.mark.asyncio
async def test_vice_may_submit_too(flow):
    w = await application_world(flow)
    side = w["teams"][0]

    assert (await submit(flow, w, side, actor=side["vice"])).status_code == 200


@pytest.mark.asyncio
@pytest.mark.parametrize("who", ["member", "lead", "stranger", "other_captain"])
async def test_only_captain_or_vice_may_submit(flow, who):
    w = await application_world(flow)
    side, other = w["teams"][0], w["teams"][1]
    actor = {"member": side["member"], "lead": side["lead"], "stranger": await flow.add_user(name="Fremde Person"), "other_captain": other["captain"]}[who]

    refused = await submit(flow, w, side, actor=actor)

    assert refused.status_code == 403
    assert await flow.db.league_applications.count_documents({}) == 0


@pytest.mark.asyncio
async def test_unknown_squad_answers_like_a_foreign_one(flow):
    w = await application_world(flow)
    side = w["teams"][0]

    unknown = await submit(flow, w, side, squad_id="gibt-es-nicht")
    foreign = await submit(flow, w, side, squad_id=w["teams"][1]["squad"]["id"])

    assert unknown.status_code == foreign.status_code == 403
    assert unknown.json()["detail"] == foreign.json()["detail"]


@pytest.mark.asyncio
async def test_a_banned_captain_does_not_count(flow):
    w = await application_world(flow)
    side = w["teams"][0]
    await flow.db.team_squads.update_one({"id": side["squad"]["id"]}, {"$set": {"banned_role_ids": [side["captain"]["id"]]}})
    await flow.db.users.update_one({"id": side["captain"]["id"]}, {"$set": {"is_banned": True}})

    assert (await submit(flow, w, side)).status_code == 403


@pytest.mark.asyncio
@pytest.mark.parametrize("body", [{"accept_rules": False}, {"accept_privacy": False}])
async def test_consent_must_be_given_explicitly(flow, body):
    w = await application_world(flow)

    refused = await submit(flow, w, w["teams"][0], **body)

    assert refused.status_code == 422
    assert await flow.db.league_applications.count_documents({}) == 0
    assert await flow.db.league_rule_consents.count_documents({}) == 0


@pytest.mark.asyncio
async def test_a_stale_rule_version_is_refused(flow):
    w = await application_world(flow)
    old = w["rule"]
    newer = await publish(flow, w, reason="Neue Fassung für die Season")

    refused = await submit(flow, w, w["teams"][0], rule_version_id=old["id"])

    assert refused.status_code == 409 and "neu laden" in refused.json()["detail"]
    assert ok(await submit(flow, w, w["teams"][0], rule_version_id=newer["id"]))["rule_consent"]["rule_version_id"] == newer["id"]


@pytest.mark.asyncio
async def test_without_a_valid_rule_version_nobody_can_submit(flow):
    """Der Regeltext (``rules_text``) hat keine Version und taugt nicht als Nachweis - auch wenn er da ist."""
    w = await application_world(flow, rules=False)
    side = w["teams"][0]
    flow.act_as(side["captain"])

    view = ok(await flow.get(f"{base_url(w)}/application"))
    assert view["rules"] is None
    assert any("Regelwerk" in text for text in view["season_problems"])
    refused = await submit(flow, w, side, rule_version_id="egal")
    assert refused.status_code == 409 and "Regelwerk" in refused.json()["detail"]


@pytest.mark.asyncio
async def test_a_rule_version_valid_only_later_does_not_count(flow):
    w = await application_world(flow, rules=False)
    later = await publish(flow, w, valid_from=in_days(5))
    flow.act_as(w["teams"][0]["captain"])

    view = ok(await flow.get(f"{base_url(w)}/application"))

    assert view["rules"] is None and any("Regelwerk" in text for text in view["season_problems"])
    assert (await submit(flow, w, w["teams"][0], rule_version_id=later["id"])).status_code == 409


@pytest.mark.asyncio
async def test_a_league_wide_rule_version_counts_for_the_season(flow):
    from league_rules_world import league_scope

    w = await application_world(flow, rules=False)
    w["rule"] = await publish(flow, w, scope=league_scope(w))

    assert ok(await submit(flow, w, w["teams"][0]))["rule_consent"]["rule_version_id"] == w["rule"]["id"]


@pytest.mark.asyncio
@pytest.mark.parametrize("times,word", [({"opens_in_hours": 2}, "öffnet"), ({"opens_in_hours": -48, "closes_in_hours": -1}, "vorbei")])
async def test_outside_the_window_nobody_can_submit(flow, times, word):
    w = await application_world(flow, open_window=False, **window(**times))

    refused = await submit(flow, w, w["teams"][0])

    assert refused.status_code == 409 and word in refused.json()["detail"]


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["completed", "archived"])
async def test_a_finished_season_takes_no_application(flow, status):
    w = await application_world(flow)
    await flow.db.league_seasons.update_one({"id": w["season"]["id"]}, {"$set": {"status": status}})

    assert (await submit(flow, w, w["teams"][0])).status_code in (404, 409)


@pytest.mark.asyncio
async def test_a_hidden_season_stays_404(flow):
    w = await application_world(flow, visibility="off")

    assert (await submit(flow, w, w["teams"][0])).status_code == 404
    flow.act_as(w["teams"][0]["captain"])
    assert (await flow.get(f"{base_url(w)}/application")).status_code == 404


@pytest.mark.asyncio
async def test_a_guest_cannot_read_or_submit(flow):
    w = await application_world(flow)
    flow.act_as(None)

    assert (await flow.get(f"{base_url(w)}/application")).status_code == 401
    assert (await flow.post(f"{base_url(w)}/applications", json={"squad_id": "x", "rule_version_id": "y", "accept_rules": True, "accept_privacy": True})).status_code == 401


@pytest.mark.asyncio
async def test_a_second_open_application_is_refused_and_reapplying_after_rejection_works(flow):
    w = await application_world(flow)
    side = w["teams"][0]
    first = await submitted(flow, w, side)

    second = await submit(flow, w, side, actor=side["vice"])
    assert second.status_code == 409 and "läuft schon" in second.json()["detail"]

    ok(await decide(flow, w, first, "reject", reason="Bitte Kader klären"))
    again = await submitted(flow, w, side)
    assert again["id"] != first["id"]
    assert await flow.db.league_applications.count_documents({"squad_id": side["squad"]["id"]}) == 2
    assert (await flow.db.league_applications.find_one({"id": first["id"]}, {"_id": 0})).get("active_key") is None


@pytest.mark.asyncio
async def test_two_squads_of_one_team_may_apply_in_one_season(flow):
    w = await application_world(flow)
    side = w["teams"][0]
    extra = [await flow.add_user(name=f"Extra {index}") for index in range(4)]
    await flow.db.teams.update_one({"id": side["team"]["id"]}, {"$addToSet": {"member_ids": {"$each": [user["id"] for user in extra]}}})
    flow.act_as(side["lead"])
    second = ok(await flow.post(f"/api/teams/{side['team']['id']}/squads", json={
        "name": "TeamA Zwei", "game_id": w["game"]["id"], "member_ids": [user["id"] for user in extra], "captain_id": extra[0]["id"]}))

    await submitted(flow, w, side)
    flow.act_as(extra[0])
    answer = await flow.post(f"{base_url(w)}/applications", json={"squad_id": second["id"], "rule_version_id": w["rule"]["id"], "accept_rules": True, "accept_privacy": True})

    assert answer.status_code == 200


# ---------------------------------------------------------------- Prüfung im Klartext

async def problems_of(flow, w: dict, side: dict) -> dict:
    flow.act_as(side["captain"])
    view = ok(await flow.get(f"{base_url(w)}/application"))
    return next(row for row in view["squads"] if row["squad_id"] == side["squad"]["id"])


@pytest.mark.asyncio
async def test_too_small_squad_is_named_and_refused(flow):
    w = await application_world(flow, teams=0, min_squad_size=4)
    side = await add_team(flow, w, "Klein", players=2)

    row = await problems_of(flow, w, side)
    assert row["can_apply"] is True and row["state"] == "open"
    assert any("2 Spieler" in text and "mindestens 4" in text for text in row["problems"])
    refused = await submit(flow, w, side)
    assert refused.status_code in (400, 409) and "mindestens 4" in refused.json()["detail"]


@pytest.mark.asyncio
async def test_a_smaller_minimum_of_liga_n_counts_for_the_application(flow):
    w = await application_world(flow, teams=0, min_squad_size=4)
    flow.act_as(w["lead"])
    ok(await flow.post(f"{ADMIN_LEAGUES}/seasons/{w['season']['id']}/divisions", json={"overrides": {"min_squad_size": 2, "team_size": 2}}))
    side = await add_team(flow, w, "Klein", players=2)

    assert (await problems_of(flow, w, side))["problems"] == []


@pytest.mark.asyncio
async def test_missing_birth_dates_block_without_any_date_in_the_answer(flow):
    w = await application_world(flow, min_age=18)
    side = w["teams"][0]

    row = await problems_of(flow, w, side)

    assert any("Geburtsdatum fehlt" in text for text in row["problems"])
    assert "birth_date" not in str(row)
    assert (await submit(flow, w, side)).status_code in (400, 409)


@pytest.mark.asyncio
async def test_entry_policy_members_names_those_who_are_not(flow):
    w = await application_world(flow, entry_policy="members")
    side = w["teams"][0]

    row = await problems_of(flow, w, side)
    assert any("nur für Mitglieder" in text and "TeamA S0" in text for text in row["problems"])
    assert (await submit(flow, w, side)).status_code in (400, 409)

    await flow.db.users.update_many({"id": {"$in": [user["id"] for user in side["people"]]}}, {"$set": {"is_club_member": True}})
    assert (await problems_of(flow, w, side))["problems"] == []
    assert (await submit(flow, w, side)).status_code == 200


@pytest.mark.asyncio
async def test_default_policy_takes_external_accounts(flow):
    w = await application_world(flow)

    assert (await problems_of(flow, w, w["teams"][0]))["problems"] == []


@pytest.mark.asyncio
async def test_a_squad_already_in_the_season_cannot_apply(flow):
    w = await application_world(flow)
    side = w["teams"][0]
    flow.act_as(w["lead"])
    ok(await flow.post(f"/api/tournaments/{w['tid']}/squad-registrations", json={"team_id": side["team"]["id"], "squad_id": side["squad"]["id"]}))

    row = await problems_of(flow, w, side)

    assert any("schon" in text for text in row["problems"])
    assert (await submit(flow, w, side)).status_code == 409


@pytest.mark.asyncio
async def test_too_few_players_with_a_valid_id_block_and_the_others_are_warnings(flow):
    w = await application_world(flow, min_squad_size=4)
    await flow.db.games.update_one({"id": w["game"]["id"]}, {"$set": {"player_id_fields": [{"key": "probe_id", "label": "Probe-ID", "required": True}]}})
    side = w["teams"][0]

    row = await problems_of(flow, w, side)
    assert any("spielberechtigt" in text for text in row["problems"])

    await flow.db.games.update_one({"id": w["game"]["id"]}, {"$set": {"player_id_fields": []}})
    assert (await problems_of(flow, w, side))["problems"] == []


@pytest.mark.asyncio
async def test_missing_ids_beyond_the_minimum_only_warn(flow):
    w = await application_world(flow, min_squad_size=2, team_size=2)
    await flow.db.games.update_one({"id": w["game"]["id"]}, {"$set": {"player_id_fields": [{"key": "probe_id", "label": "Probe-ID", "required": True}]}})
    side = w["teams"][0]
    for user in side["people"][:2]:
        await flow.db.users.update_one({"id": user["id"]}, {"$set": {"game_ids": {w["game"]["slug"]: {"probe_id": f"Probe#{user['id'][:6]}"}}}})

    row = await problems_of(flow, w, side)

    assert row["problems"] == [], row
    assert any("TeamA S3" in text for text in row["warnings"])


# ---------------------------------------------------------------- Zurückziehen

@pytest.mark.asyncio
async def test_captain_withdraws_and_may_apply_again(flow):
    w = await application_world(flow)
    side = w["teams"][0]
    application = await submitted(flow, w, side)
    flow.act_as(side["vice"])

    done = ok(await flow.post(f"{base_url(w)}/applications/{application['id']}/withdraw", json={}))

    assert done["status"] == "withdrawn"
    stored = await flow.db.league_applications.find_one({"id": application["id"]}, {"_id": 0})
    assert stored["withdrawn_by"] == side["vice"]["id"] and "active_key" not in stored
    assert await flow.db.audit_logs.find_one({"action": "league.application.withdraw"}, {"_id": 1})
    row = await problems_of(flow, w, side)
    assert row["state"] == "withdrawn" and row["can_submit"] is True and row["application"]["can_withdraw"] is False
    await submitted(flow, w, side)


@pytest.mark.asyncio
@pytest.mark.parametrize("who", ["member", "lead", "other_captain"])
async def test_only_own_captain_or_vice_withdraws(flow, who):
    w = await application_world(flow)
    side = w["teams"][0]
    application = await submitted(flow, w, side)
    flow.act_as({"member": side["member"], "lead": side["lead"], "other_captain": w["teams"][1]["captain"]}[who])

    refused = await flow.post(f"{base_url(w)}/applications/{application['id']}/withdraw", json={})

    assert refused.status_code == 403
    assert (await flow.db.league_applications.find_one({"id": application["id"]}))["status"] == "submitted"


@pytest.mark.asyncio
async def test_withdrawing_twice_or_after_rejection_is_refused(flow):
    w = await application_world(flow)
    side = w["teams"][0]
    application = await submitted(flow, w, side)
    ok(await decide(flow, w, application, "reject", reason="Passt nicht"))
    flow.act_as(side["captain"])

    assert (await flow.post(f"{base_url(w)}/applications/{application['id']}/withdraw", json={})).status_code == 409


@pytest.mark.asyncio
async def test_withdrawing_after_assignment_goes_through_the_lead(flow):
    w = await application_world(flow)
    side = w["teams"][0]
    application = await submitted(flow, w, side)
    ok(await decide(flow, w, application, "accept", tournament_id=w["tid"]))
    flow.act_as(side["captain"])

    refused = await flow.post(f"{base_url(w)}/applications/{application['id']}/withdraw", json={})

    assert refused.status_code == 409 and "Leitung" in refused.json()["detail"]
    assert await flow.db.tournament_registrations.count_documents({"squad_id": side["squad"]["id"]}) == 1


@pytest.mark.asyncio
async def test_withdrawing_an_application_of_another_season_is_404(flow):
    w = await application_world(flow)
    side = w["teams"][0]
    application = await submitted(flow, w, side)
    flow.act_as(w["lead"])
    other = ok(await flow.post(f"{ADMIN_LEAGUES}/{w['league']['id']}/seasons", json={"name": "Season Zwei", "start_date": "2030-01-08T00:00:00", "visibility": "public"}))
    flow.act_as(side["captain"])

    answer = await flow.post(f"/api/leagues/{w['league']['slug']}/{other['slug']}/applications/{application['id']}/withdraw", json={})

    assert answer.status_code == 404


# ---------------------------------------------------------------- Wer was sieht

@pytest.mark.asyncio
async def test_guests_see_window_and_seats_but_nobody_else_sees_an_application(flow):
    w = await application_world(flow, application_slots=4, application_waitlist_note="Die Leitung entscheidet nach Eingang.")
    side = w["teams"][0]
    application = await submitted(flow, w, side)
    ok(await decide(flow, w, application, "accept"))

    flow.act_as(None)
    public = ok(await flow.get(base_url(w)))["application"]
    assert public["state"] == "open"
    assert public["slots"] == 4 and public["slots_free"] == 3
    assert public["waitlist"] is True and public["waitlist_note"] == "Die Leitung entscheidet nach Eingang."
    assert public["opens_at"] and public["closes_at"]
    assert set(public) == {"state", "opens_at", "closes_at", "slots", "slots_free", "waitlist", "waitlist_full", "waitlist_note", "entry_policy"}

    flow.act_as(w["teams"][1]["captain"])
    view = ok(await flow.get(f"{base_url(w)}/application"))
    assert [row["squad_id"] for row in view["squads"]] == [w["teams"][1]["squad"]["id"]]
    assert side["squad"]["name"] not in str(view)


@pytest.mark.asyncio
async def test_a_squad_member_sees_the_state_but_not_the_checks_or_the_reason(flow):
    w = await application_world(flow)
    side = w["teams"][0]
    application = await submitted(flow, w, side)
    ok(await decide(flow, w, application, "reject", reason="Geheim bleibender Grund"))

    flow.act_as(side["member"])
    row = ok(await flow.get(f"{base_url(w)}/application"))["squads"][0]
    assert row["can_apply"] is False and row["state"] == "rejected"
    assert "problems" not in row and "Geheim" not in str(row)

    flow.act_as(side["captain"])
    row = ok(await flow.get(f"{base_url(w)}/application"))["squads"][0]
    assert row["application"]["decision_reason"] == "Geheim bleibender Grund"


@pytest.mark.asyncio
async def test_a_team_lead_without_a_role_sees_the_hint(flow):
    w = await application_world(flow, teams=0)
    side = await add_team(flow, w, "Ohne")
    await flow.db.team_squads.update_one({"id": side["squad"]["id"]}, {"$unset": {"captain_id": "", "vice_captain_id": ""}})
    flow.act_as(side["lead"])

    view = ok(await flow.get(f"{base_url(w)}/application"))

    assert view["squads"][0]["can_apply"] is False
    assert "Captain" in view["hint"]


@pytest.mark.asyncio
async def test_a_squad_of_another_game_is_not_listed(flow):
    w = await application_world(flow, teams=0)
    side = await add_team(flow, w, "Fremdspiel")
    flow.act_as(w["lead"])
    other = ok(await flow.post("/api/games", json={"name": "Anderes Spiel", "slug": "anderes-spiel"}))
    await flow.db.team_squads.update_one({"id": side["squad"]["id"]}, {"$set": {"game_id": other["id"]}})
    flow.act_as(side["captain"])

    assert ok(await flow.get(f"{base_url(w)}/application"))["squads"] == []


@pytest.mark.asyncio
async def test_own_applications_list_for_the_team_page(flow):
    w = await application_world(flow)
    side = w["teams"][0]
    application = await submitted(flow, w, side)

    for person in (side["captain"], side["member"], side["lead"]):
        flow.act_as(person)
        items = ok(await flow.get("/api/me/league-applications"))["items"]
        assert [row["id"] for row in items] == [application["id"]]
        assert items[0]["url"] == base_url(w).replace("/api/leagues", "/liga")
    flow.act_as(w["teams"][1]["captain"])
    assert ok(await flow.get("/api/me/league-applications"))["items"] == []


@pytest.mark.asyncio
async def test_only_the_latest_application_counts_in_the_own_list(flow):
    w = await application_world(flow)
    side = w["teams"][0]
    first = await submitted(flow, w, side)
    ok(await decide(flow, w, first, "reject", reason="Bitte klären"))
    second = await submitted(flow, w, side)
    flow.act_as(side["captain"])

    items = ok(await flow.get("/api/me/league-applications"))["items"]

    assert [row["id"] for row in items] == [second["id"]]


@pytest.mark.asyncio
async def test_archived_squads_are_named_at_submit(flow):
    w = await application_world(flow, teams=0)
    side = await add_team(flow, w, "Archiv")
    await make_squad(flow, side["team"], "Andere", side["people"], captain=side["captain"])
    await flow.db.team_squads.update_one({"id": side["squad"]["id"]}, {"$set": {"status": "archived"}})

    refused = await submit(flow, w, side)

    assert refused.status_code in (400, 403, 409)
