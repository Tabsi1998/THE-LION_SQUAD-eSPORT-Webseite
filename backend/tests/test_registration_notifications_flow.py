"""Turnier-Anmeldung (#1133): wer sich anmeldet oder dessen Anmeldung sich ändert, bekommt Bescheid.

Nach der eigenen Anmeldung „Du bist dabei“ oder „Warteliste“; ändert die Turnierleitung den Stand (bestätigt,
abgelehnt mit Grund, von der Warteliste geholt), eine Nachricht im Postfach, per Push und - wenn erlaubt - per Mail.
Bei Teams an die Verantwortlichen (#1136). „Turnier beendet“ einmal je Person.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402

BODY = {"accept_rules": True, "accept_privacy": True, "ingame_name": "Spieler"}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def notes(flow, user=None) -> list[dict]:
    query = {"kind": "tournament_registration", **({"user_id": user["id"]} if user else {})}
    return await flow.db.notifications.find(query, {"_id": 0}).sort("created_at", 1).to_list(100)


async def mails(flow, key: str) -> list[dict]:
    return await flow.db.mail_jobs.find({"template_key": key}, {"_id": 0}).to_list(100)


@pytest.mark.asyncio
async def test_own_registration_confirms_and_staff_changes_are_announced(flow):
    staff = await flow.add_staff()
    tournament = await flow.create_tournament(max_participants=1, check_in_from="2026-11-14T17:00:00+00:00")
    first, second = await flow.add_user(name="Erste"), await flow.add_user(name="Zweite")

    flow.act_as(first)
    response = await flow.post(f"/api/tournaments/{tournament['id']}/register", json=BODY)
    assert response.status_code == 200, response.text
    [own] = await notes(flow, first)
    assert own["title"] == "Du bist dabei: Testturnier"
    assert "Check-in ab 14.11.2026, 18:00 Uhr" in own["body"], "der Check-in-Hinweis in Wiener Zeit"
    assert own["meta"]["in_app_only"] is True, "wer selbst angemeldet hat, sieht es schon - kein Push"
    approved_mails = await mails(flow, "registration_approved")
    assert [mail["to"] for mail in approved_mails] == [first["email"]]

    flow.act_as(second)
    response = await flow.post(f"/api/tournaments/{tournament['id']}/register", json=BODY)
    assert response.json()["status"] == "waitlist"
    [waiting] = await notes(flow, second)
    assert waiting["title"] == "Warteliste: Testturnier"
    received_mails = await mails(flow, "registration_received")
    assert [mail["to"] for mail in received_mails] == [second["email"]]

    registration = await flow.db.tournament_registrations.find_one({"user_id": second["id"]}, {"_id": 0})
    flow.act_as(staff)
    promoted = await flow.patch(f"/api/tournaments/{tournament['id']}/registrations/{registration['id']}", json={"status": "approved"})
    assert promoted.status_code == 200, promoted.text
    second_notes = await notes(flow, second)
    latest = second_notes[-1]
    assert latest["title"] == "Nachgerückt: Testturnier" and "nachgerückt" in latest["body"]
    assert "in_app_only" not in latest["meta"], "die Entscheidung der Turnierleitung kommt auch per Push"
    approved_mails = await mails(flow, "registration_approved")
    assert "nachgerückt" in approved_mails[-1]["html"]

    again = await flow.patch(f"/api/tournaments/{tournament['id']}/registrations/{registration['id']}", json={"status": "approved"})
    assert again.json()["idempotent_replay"] is True
    second_notes = await notes(flow, second)
    assert len(second_notes) == 2, "derselbe Stand noch einmal - keine zweite Nachricht"

    rejected = await flow.patch(f"/api/tournaments/{tournament['id']}/registrations/{registration['id']}",
                                json={"status": "rejected", "status_reason": "Team nicht vollständig"})
    assert rejected.status_code == 200, rejected.text
    second_notes = await notes(flow, second)
    latest = second_notes[-1]
    assert latest["title"] == "Anmeldung abgelehnt: Testturnier" and "Grund: Team nicht vollständig" in latest["body"]
    rejected_mails = await mails(flow, "registration_rejected")
    assert "Team nicht vollständig" in rejected_mails[-1]["html"]
    stored = await flow.db.tournament_registrations.find_one({"id": registration["id"]}, {"_id": 0})
    assert "status_reason" not in stored, "der Grund steht nur in der Nachricht"

    # Einchecken ändert nichts daran, dass jemand dabei ist - dafür gibt es keine Nachricht.
    own_reg = await flow.db.tournament_registrations.find_one({"user_id": first["id"]}, {"_id": 0})
    checked_in = await flow.patch(f"/api/tournaments/{tournament['id']}/registrations/{own_reg['id']}", json={"status": "checked_in"})
    assert checked_in.status_code == 200, checked_in.text
    first_notes = await notes(flow, first)
    assert len(first_notes) == 1


@pytest.mark.asyncio
async def test_mail_only_when_allowed_and_teams_reach_their_responsible_people(flow):
    staff = await flow.add_staff()
    quiet = await flow.add_user(name="Leise")
    await flow.db.users.update_one({"id": quiet["id"]}, {"$set": {"notification_preferences": {"email:tournament_updates": False}}})
    tournament = await flow.create_tournament(team_mode="team", max_participants=8)
    leader, co_leader, member = [await flow.add_user(name=name) for name in ("Leitung", "Co", "Mitglied")]
    team = {"id": new_id(), "name": "Loewen", "tag": "LOE", "leader_id": leader["id"], "co_leader_ids": [co_leader["id"]],
            "member_ids": [leader["id"], co_leader["id"], member["id"]]}
    await flow.db.teams.insert_one(dict(team))

    flow.act_as(staff)
    added = await flow.post(f"/api/tournaments/{tournament['id']}/registrations", json={"team_id": team["id"], "status": "approved"})
    assert added.status_code == 200, added.text
    all_notes = await notes(flow)
    told = {row["user_id"] for row in all_notes}
    assert told == {leader["id"], co_leader["id"]}, "ein Team ohne anmeldende Person läuft über die Leitung - einfache Mitglieder nicht"

    solo = await flow.create_tournament(max_participants=8)
    added_solo = await flow.post(f"/api/tournaments/{solo['id']}/registrations", json={"user_id": quiet["id"], "status": "approved"})
    assert added_solo.status_code == 200, added_solo.text
    quiet_notes = await notes(flow, quiet)
    assert [row["user_id"] for row in quiet_notes] == [quiet["id"]]
    approved_mails = await mails(flow, "registration_approved")
    assert quiet["email"] not in {mail["to"] for mail in approved_mails}, "ohne Mail-Erlaubnis keine Mail"


@pytest.mark.asyncio
async def test_tournament_finished_reaches_every_player_once(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, users, _registrations = await flow.with_participants(2)
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"status": "live"}})

    done = await flow.post(f"/api/tournaments/{tournament['id']}/status", json={"status": "completed"})
    assert done.status_code == 200, done.text
    published = await flow.post(f"/api/tournaments/{tournament['id']}/status", json={"status": "results_published"})
    assert published.status_code == 200, published.text

    finished = await flow.db.notifications.find({"kind": "tournament_finished"}, {"_id": 0}).to_list(10)
    assert sorted(row["user_id"] for row in finished) == sorted(user["id"] for user in users)
    finished_mails = await mails(flow, "tournament_finished")
    assert sorted(mail["to"] for mail in finished_mails) == sorted(user["email"] for user in users)
