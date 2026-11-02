"""Weiches Auflösen (#2128, TM8): das Team verschwindet aus allem, was ``teams`` liest, bleibt aber 30 Tage wiederherstellbar.

Alte Turniere zeigen weiter einen Namen; wiederherstellen dürfen die frühere Teamleitung und Admins (mit Protokoll); danach
gilt ein neuer Beitrittscode. Der tägliche Job räumt nach der Frist auf, die Kontolöschung wirkt auch auf aufgelöste Teams.
Erfundene Daten, keine echten Personen. Zeiten immer relativ zu jetzt."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio
from fastapi import HTTPException

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from models import now_utc  # noqa: E402
from services.team_dissolve import DISSOLVED_TEAM_RETENTION_DAYS, dissolve as dissolve_team, forget_person, purge_dissolved_teams, restore, team_lock_resource  # noqa: E402


@pytest_asyncio.fixture
async def flow(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "team-soft-dissolve-secret-with-at-least-32-chars")
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def world(flow, *, is_public=True):
    leader = await flow.add_user(role="player", name="leitung")
    co = await flow.add_user(role="player", name="colena")
    member = await flow.add_user(role="player", name="mila")
    team = {"id": new_id(), "name": "Lions Rocket", "tag": "LRK", "leader_id": leader["id"], "co_leader_ids": [co["id"]],
            "member_ids": [leader["id"], co["id"], member["id"]], "join_code": "Alt-Code1", "is_public": is_public,
            "logo_url": "/uploads/lrk.png", "created_at": now_utc().isoformat()}
    await flow.db.teams.insert_one(dict(team))
    for user in (leader, co, member):
        await flow.db.team_members.insert_one({"team_id": team["id"], "user_id": user["id"], "role": "member", "joined_at": "2026-01-01T00:00:00+00:00"})
    squad = {"id": new_id(), "team_id": team["id"], "name": "Erste", "status": "active", "member_ids": [leader["id"], member["id"]],
             "captain_id": member["id"], "created_by": leader["id"]}
    await flow.db.team_squads.insert_one(dict(squad))
    await flow.db.team_chat_messages.insert_one({"id": new_id(), "team_id": team["id"], "user_id": member["id"], "message": "Hallo", "created_at": now_utc().isoformat()})
    return leader, co, member, team, squad


async def dissolve(flow, leader, team):
    flow.act_as(leader)
    response = await flow.delete(f"/api/teams/{team['id']}", params={"confirm": team["name"]})
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.asyncio
async def test_dissolved_team_is_gone_from_everything_that_reads_teams(flow):
    leader, _co, member, team, squad = await world(flow)
    outsider = await flow.add_user(role="player", name="fremd")
    flow.act_as(leader)
    await flow.get(f"/api/teams/{team['id']}/invite-link")

    done = await dissolve(flow, leader, team)
    assert done["ok"] is True and done["restore_until"] > now_utc().isoformat()

    assert not await flow.db.teams.find_one({"id": team["id"]})
    assert not await flow.db.team_members.find_one({"team_id": team["id"]})
    assert not await flow.db.team_squads.find_one({"id": squad["id"]})
    assert not await flow.db.team_invite_links.find_one({"team_id": team["id"]})
    stored = await flow.db.dissolved_teams.find_one({"id": team["id"]})
    assert "join_code" not in stored, "den alten Code heben wir nicht auf"
    assert stored["squads"][0]["id"] == squad["id"] and len(stored["memberships"]) == 3
    assert await flow.db.team_chat_messages.find_one({"team_id": team["id"]}), "der Chat bleibt für das Wiederherstellen liegen"

    for viewer in (outsider, member):
        flow.act_as(viewer)
        page = await flow.get(f"/api/teams/{team['id']}")
        assert page.status_code == 404 and "aufgelöst" in page.json()["detail"]
        assert team["id"] not in [row["id"] for row in (await flow.get("/api/teams")).json()]
        assert team["id"] not in [row["id"] for row in (await flow.get("/api/teams/my")).json()]
        assert (await flow.get(f"/api/teams/{team['id']}/chat")).status_code == 404
        assert (await flow.get(f"/api/teams/{team['id']}/squads")).status_code == 404
        assert (await flow.get(f"/api/teams/{team['id']}/overview")).status_code == 404
    flow.act_as(outsider)
    assert (await flow.post(f"/api/teams/{team['id']}/join", json={"join_code": "Alt-Code1"})).status_code == 404

    # Jeder im Team erfährt es, wer aufgelöst hat nicht.
    told = await flow.db.notifications.find({"kind": "team_dissolved"}, {"_id": 0}).to_list(10)
    assert {row["user_id"] for row in told} == {_co["id"], member["id"]}
    assert str(DISSOLVED_TEAM_RETENTION_DAYS) in told[0]["body"] and "frühere Teamleitung" in told[0]["body"]
    row = await flow.db.audit_logs.find_one({"action": "team.dissolve", "target_id": team["id"]})
    assert "Alt-Code1" not in str(row)


@pytest.mark.asyncio
async def test_old_tournaments_keep_the_name_also_after_the_deadline(flow):
    leader, _co, _member, team, _squad = await world(flow)
    done_cup = await flow.create_tournament(title="Sommer-Cup", status="results_published", team_mode="team")
    await flow.db.tournament_registrations.insert_one({"id": new_id(), "tournament_id": done_cup["id"], "team_id": team["id"],
                                                       "user_id": leader["id"], "display_name": "[LRK] Lions Rocket", "status": "approved"})
    await dissolve(flow, leader, team)

    async def shown():
        rows = (await flow.get(f"/api/tournaments/{done_cup['id']}/registrations")).json()
        return rows[0]["team"]

    flow.act_as(None)
    seen = await shown()
    assert seen["name"] == "Lions Rocket" and seen["tag"] == "LRK" and seen["dissolved"] is True

    gone = await purge_dissolved_teams(flow.db, now_utc() + timedelta(days=DISSOLVED_TEAM_RETENTION_DAYS + 1))
    assert gone == 1
    tombstone = await flow.db.dissolved_teams.find_one({"id": team["id"]}, {"_id": 0})
    assert set(tombstone) <= {"id", "name", "tag", "is_public", "dissolved_at", "purged_at"}, "keine Personen, kein Chat"
    assert not await flow.db.team_chat_messages.find_one({"team_id": team["id"]})
    assert (await shown())["name"] == "Lions Rocket", "der Name bleibt auch nach der Frist"
    assert await purge_dissolved_teams(flow.db, now_utc() + timedelta(days=DISSOLVED_TEAM_RETENTION_DAYS + 2)) == 0


@pytest.mark.asyncio
async def test_the_deadline_removes_attachments_invites_and_unused_images(flow, monkeypatch, tmp_path):
    """Prüfer-Probe: Nach der Frist sind Anhänge, Einladungen, Logo und Banner wirklich weg - was sonst noch genutzt wird, bleibt."""
    from services import chat_attachments

    removed = []
    monkeypatch.setattr(chat_attachments, "_remove_files", lambda row: removed.append(row["id"]))
    leader, _co, member, team, _squad = await world(flow)
    await flow.db.teams.update_one({"id": team["id"]}, {"$set": {"logo_url": "/api/static/uploads/nur-team.webp", "banner_url": "/api/static/uploads/geteilt.webp"}})
    await flow.db.news_posts.insert_one({"id": new_id(), "title": "Bild", "banner_url": "/api/static/uploads/geteilt.webp"})
    for name in ("nur-team.webp", "geteilt.webp"):
        await flow.db.media_uploads.insert_one({"filename": name, "media_scope": "user", "owner_id": leader["id"]})
    await flow.db.team_chat_messages.insert_one({"id": new_id(), "team_id": team["id"], "user_id": member["id"], "message": "x", "attachments": [{"id": "a1"}]})
    await flow.db.chat_attachments.insert_one({"id": "a1", "owner_id": member["id"], "status": "attached", "storage_key": "chat/a1.png", "context": {"type": "team", "team_id": team["id"]}})
    await flow.db.chat_attachments.insert_one({"id": "a2", "owner_id": member["id"], "status": "attached", "storage_key": "chat/a2.png", "context": {"type": "team", "team_id": "anderes-team"}})
    await flow.db.team_invites.insert_one({"id": new_id(), "team_id": team["id"], "user_id": member["id"], "status": "pending"})
    await dissolve(flow, leader, team)

    assert await flow.db.chat_attachments.count_documents({"context.team_id": team["id"]}) == 1, "in der Frist bleibt alles"
    assert await flow.db.media_uploads.find_one({"filename": "nur-team.webp"})

    await flow.db.dissolved_teams.update_one({"id": team["id"]}, {"$set": {"purge_at": (now_utc() - timedelta(minutes=1)).isoformat()}})
    assert await purge_dissolved_teams(flow.db) == 1
    assert await flow.db.team_chat_messages.count_documents({"team_id": team["id"]}) == 0
    assert await flow.db.chat_attachments.count_documents({"context.team_id": team["id"]}) == 0 and removed == ["a1"]
    assert await flow.db.chat_attachments.find_one({"id": "a2"}), "fremde Anhänge bleiben"
    assert await flow.db.team_invites.count_documents({"team_id": team["id"]}) == 0
    assert not await flow.db.media_uploads.find_one({"filename": "nur-team.webp"}), "Logo steht nirgends mehr"
    assert await flow.db.media_uploads.find_one({"filename": "geteilt.webp"}), "das Banner nutzt noch ein News-Beitrag"
    tombstone = await flow.db.dissolved_teams.find_one({"id": team["id"]}, {"_id": 0})
    assert "logo_url" not in tombstone and "banner_url" not in tombstone


@pytest.mark.asyncio
async def test_an_image_from_the_club_library_stays(flow):
    leader, _co, _member, team, _squad = await world(flow)
    await flow.db.teams.update_one({"id": team["id"]}, {"$set": {"logo_url": "/api/static/uploads/vereinslogo.webp"}})
    await flow.db.media_uploads.insert_one({"filename": "vereinslogo.webp", "media_scope": "branding"})
    await dissolve(flow, leader, team)
    await purge_dissolved_teams(flow.db, now_utc() + timedelta(days=DISSOLVED_TEAM_RETENTION_DAYS + 1))
    assert await flow.db.media_uploads.find_one({"filename": "vereinslogo.webp"})


@pytest.mark.asyncio
async def test_private_team_stays_hidden_after_dissolving(flow):
    leader, _co, _member, team, _squad = await world(flow, is_public=False)
    await dissolve(flow, leader, team)
    flow.act_as(None)
    page = await flow.get(f"/api/teams/{team['id']}")
    assert page.status_code == 404 and page.json()["detail"] == "Team nicht gefunden", "verrät nicht, dass es das Team gab"


@pytest.mark.asyncio
async def test_restore_by_the_former_lead_with_a_new_code(flow):
    leader, co, member, team, squad = await world(flow)
    await dissolve(flow, leader, team)

    listed = (await flow.get("/api/teams/dissolved/mine")).json()
    assert [row["id"] for row in listed] == [team["id"]]
    assert listed[0]["days_left"] == DISSOLVED_TEAM_RETENTION_DAYS and listed[0]["member_count"] == 3
    assert "member_ids" not in listed[0] and "join_code" not in listed[0]

    flow.act_as(member)
    assert (await flow.get("/api/teams/dissolved/mine")).json() == []
    assert (await flow.post(f"/api/teams/{team['id']}/restore")).status_code == 403, "nur die frühere Teamleitung"
    flow.act_as(co)
    assert (await flow.post(f"/api/teams/{team['id']}/restore")).status_code == 403, "die Co-Leitung nicht"

    flow.act_as(leader)
    done = await flow.post(f"/api/teams/{team['id']}/restore")
    assert done.status_code == 200 and done.json()["tag"] == "LRK"
    assert (await flow.post(f"/api/teams/{team['id']}/restore")).status_code == 404, "schon zurück"

    back = await flow.db.teams.find_one({"id": team["id"]}, {"_id": 0})
    assert back["leader_id"] == leader["id"] and back["co_leader_ids"] == [co["id"]] and back["logo_url"] == "/uploads/lrk.png"
    assert set(back["member_ids"]) == {leader["id"], co["id"], member["id"]}
    assert back["join_code"] and back["join_code"] != "Alt-Code1", "neuer Beitrittscode"
    assert not {"squads", "memberships", "dissolved_at", "purge_at"} & set(back)
    assert (await flow.db.team_squads.find_one({"id": squad["id"]}, {"_id": 0}))["captain_id"] == member["id"]
    assert await flow.db.team_members.count_documents({"team_id": team["id"]}) == 3
    assert not await flow.db.dissolved_teams.find_one({"id": team["id"]})
    assert await flow.db.team_chat_messages.find_one({"team_id": team["id"]}), "Chat ist wieder da"

    row = await flow.db.audit_logs.find_one({"action": "team.restore", "target_id": team["id"]})
    assert row["actor_id"] == leader["id"] and "join_code" not in str(row) and back["join_code"] not in str(row)
    told = await flow.db.notifications.find({"kind": "team_restored"}, {"_id": 0}).to_list(10)
    assert {note["user_id"] for note in told} == {co["id"], member["id"]}

    flow.act_as(member)
    page = await flow.get(f"/api/teams/{team['id']}")
    assert page.status_code == 200 and page.json()["is_member"] is True


@pytest.mark.asyncio
async def test_admin_restores_and_the_tag_may_be_taken_meanwhile(flow):
    leader, _co, _member, team, _squad = await world(flow)
    admin = await flow.add_user(role="club_admin", name="vorstand")
    await dissolve(flow, leader, team)
    await flow.db.teams.insert_one({"id": new_id(), "name": "Neue", "tag": "LRK", "leader_id": new_id(), "member_ids": []})

    flow.act_as(admin)
    taken = await flow.post(f"/api/teams/{team['id']}/restore")
    assert taken.status_code == 409 and "Kürzel LRK" in taken.json()["detail"]
    assert await flow.db.dissolved_teams.find_one({"id": team["id"]}), "nichts passiert"
    assert (await flow.post(f"/api/teams/{team['id']}/restore", json={"tag": "X"})).status_code == 400
    assert (await flow.post(f"/api/teams/{team['id']}/restore", json={"tag": "LRK"})).status_code == 409
    done = await flow.post(f"/api/teams/{team['id']}/restore", json={"tag": "lrk2"})
    assert done.status_code == 200 and done.json()["tag"] == "LRK2"
    row = await flow.db.audit_logs.find_one({"action": "team.restore", "target_id": team["id"]})
    assert row["actor_id"] == admin["id"]


@pytest.mark.asyncio
async def test_no_restore_after_the_deadline(flow):
    leader, _co, _member, team, _squad = await world(flow)
    await dissolve(flow, leader, team)
    past = (now_utc() - timedelta(minutes=1)).isoformat()
    await flow.db.dissolved_teams.update_one({"id": team["id"]}, {"$set": {"purge_at": past}})

    assert (await flow.get("/api/teams/dissolved/mine")).json() == []
    late = await flow.post(f"/api/teams/{team['id']}/restore")
    assert late.status_code == 409 and "vorbei" in late.json()["detail"]
    assert await purge_dissolved_teams(flow.db) == 1
    assert (await flow.post(f"/api/teams/{team['id']}/restore")).status_code == 404, "nur noch der Name ist übrig"


@pytest.mark.asyncio
async def test_erasure_removes_the_person_from_dissolved_teams(flow):
    leader, co, member, team, squad = await world(flow)
    await dissolve(flow, leader, team)

    await forget_person(flow.db, member["id"])
    row = await flow.db.dissolved_teams.find_one({"id": team["id"]}, {"_id": 0})
    assert member["id"] not in row["member_ids"] and all(m["user_id"] != member["id"] for m in row["memberships"])
    assert member["id"] not in row["squads"][0]["member_ids"] and "captain_id" not in row["squads"][0]
    assert member["id"] not in str(row), "nirgends mehr"

    # Die Teamleitung löscht ihr Konto: zurückholen kann ein Admin, die Leitung geht an die Co-Leitung.
    await flow.db.users.update_one({"id": leader["id"]}, {"$set": {"is_active": False, "anonymized_at": now_utc().isoformat()}})
    await forget_person(flow.db, leader["id"])
    row = await flow.db.dissolved_teams.find_one({"id": team["id"]}, {"_id": 0})
    assert row["leader_id"] is None and row["dissolved_by"] is None and leader["id"] not in str(row)
    admin = await flow.add_user(role="club_admin", name="vorstand")
    flow.act_as(admin)
    done = await flow.post(f"/api/teams/{team['id']}/restore")
    assert done.status_code == 200
    back = await flow.db.teams.find_one({"id": team["id"]}, {"_id": 0})
    assert back["leader_id"] == co["id"] and back["co_leader_ids"] == [] and back["member_ids"] == [co["id"]]
    assert (await flow.db.team_members.find_one({"team_id": team["id"], "user_id": co["id"]}))["role"] == "leader"
    assert squad["id"] == (await flow.db.team_squads.find_one({"team_id": team["id"]}, {"_id": 0}))["id"]


@pytest.mark.asyncio
async def test_a_new_lead_on_restore_gets_its_own_note_and_the_old_role_is_cleared(flow):
    leader, co, member, team, _squad = await world(flow)
    await flow.db.team_members.update_one({"team_id": team["id"], "user_id": leader["id"]}, {"$set": {"role": "leader"}})
    await dissolve(flow, leader, team)
    await flow.db.users.update_one({"id": leader["id"]}, {"$set": {"is_active": False}})

    flow.act_as(await flow.add_user(role="club_admin", name="vorstand"))
    assert (await flow.post(f"/api/teams/{team['id']}/restore")).status_code == 200

    back = await flow.db.teams.find_one({"id": team["id"]}, {"_id": 0})
    assert back["leader_id"] == co["id"] and leader["id"] not in back["co_leader_ids"]
    roles = {row["user_id"]: row["role"] async for row in flow.db.team_members.find({"team_id": team["id"]}, {"_id": 0})}
    assert roles[co["id"]] == "leader" and roles[leader["id"]] == "member", "die abgeschaltete Teamleitung behält die Rolle nicht"
    own = await flow.db.notifications.find({"user_id": co["id"]}, {"_id": 0}).to_list(10)
    kinds = [note["kind"] for note in own]
    assert "team_leader_transferred" in kinds and "team_restored" not in kinds
    assert "Teamleitung" in next(note for note in own if note["kind"] == "team_leader_transferred")["title"]
    assert await flow.db.notifications.find_one({"user_id": member["id"], "kind": "team_restored"})


@pytest.mark.asyncio
async def test_erasing_the_last_person_ends_the_deadline(flow):
    leader, co, member, team, _squad = await world(flow)
    await dissolve(flow, leader, team)
    for user in (member, co):
        await forget_person(flow.db, user["id"])
    assert await flow.db.team_chat_messages.find_one({"team_id": team["id"]})
    await forget_person(flow.db, leader["id"])
    row = await flow.db.dissolved_teams.find_one({"id": team["id"]}, {"_id": 0})
    assert not row["member_ids"] and not row["memberships"] and not row["squads"][0]["member_ids"], "sofort niemand mehr darin"
    assert await purge_dissolved_teams(flow.db) == 1, "der nächste Lauf des Jobs räumt auf"
    row = await flow.db.dissolved_teams.find_one({"id": team["id"]}, {"_id": 0})
    assert row.get("purged_at") and set(row) <= {"id", "name", "tag", "is_public", "dissolved_at", "purged_at"}
    assert not await flow.db.team_chat_messages.find_one({"team_id": team["id"]})
    await forget_person(flow.db, leader["id"])  # der Nachzug ändert nichts


@pytest.mark.asyncio
async def test_real_erasure_and_export_reach_dissolved_teams(flow):
    """Der echte Weg: Löschen über den Verein und die Auskunft kennen die Sammlung."""
    from services.account_erasure import erase_related

    leader, _co, member, team, _squad = await world(flow)
    await dissolve(flow, leader, team)
    user = await flow.db.users.find_one({"id": member["id"]}, {"_id": 0})
    await erase_related(flow.db, user, now_utc().isoformat())
    assert member["id"] not in str(await flow.db.dissolved_teams.find_one({"id": team["id"]}, {"_id": 0}))

    flow.act_as(leader)
    export = (await flow.get("/api/dsgvo/export-my-data")).json()
    assert [row["id"] for row in export["dissolved_teams"]] == [team["id"]]
    shown = export["dissolved_teams"][0]
    assert shown["my_role"] == "leader" and shown["name"] == team["name"] and shown["purge_at"]
    for other in ("memberships", "squads", "member_ids", "co_leader_ids", "leader_id", "dissolved_by"):
        assert other not in shown, "keine Kennungen anderer Personen"
    assert _co["id"] not in str(shown)
    flow.act_as(member)
    assert (await flow.get("/api/dsgvo/export-my-data")).json()["dissolved_teams"] == []


@pytest.mark.asyncio
async def test_a_new_tag_on_restore_goes_through_the_word_filter(flow, monkeypatch):
    from services import word_filter

    async def refuse(_db, text, **_kwargs):
        if "BOESE" in text or "Verboten" in text:
            raise HTTPException(status_code=400, detail="Dieses Wort geht nicht.")

    monkeypatch.setattr(word_filter, "screen_field", refuse)
    leader, _co, _member, team, _squad = await world(flow)
    await dissolve(flow, leader, team)
    await flow.db.teams.insert_one({"id": new_id(), "name": "Neue", "tag": "LRK", "leader_id": new_id(), "member_ids": []})
    refused = await flow.post(f"/api/teams/{team['id']}/restore", json={"tag": "boese"})
    assert refused.status_code == 400, refused.text
    assert await flow.db.dissolved_teams.find_one({"id": team["id"]}), "nichts passiert"
    assert (await flow.post(f"/api/teams/{team['id']}/restore", json={"tag": "GUT"})).status_code == 200


@pytest.mark.asyncio
async def test_a_name_that_is_forbidden_by_now_does_not_come_back(flow, monkeypatch):
    from services import word_filter

    leader, _co, _member, team, _squad = await world(flow)
    await dissolve(flow, leader, team)

    async def refuse(_db, text, **_kwargs):
        if "Lions" in text:
            raise HTTPException(status_code=400, detail="Dieses Wort geht nicht.")

    monkeypatch.setattr(word_filter, "screen_field", refuse)
    assert (await flow.post(f"/api/teams/{team['id']}/restore")).status_code == 400
    assert not await flow.db.teams.find_one({"id": team["id"]})


@pytest.mark.asyncio
async def test_what_an_admin_dissolved_only_admins_bring_back(flow):
    """Prüfer-Probe: Löst ein Admin ein Team auf, darf es die frühere Teamleitung nicht einfach zurückholen."""
    leader, _co, member, team, _squad = await world(flow)
    admin = await flow.add_user(role="club_admin", name="vorstand")
    flow.act_as(admin)
    gone = await flow.delete(f"/api/teams/{team['id']}", params={"confirm": team["name"]})
    assert gone.status_code == 200

    note = await flow.db.notifications.find_one({"user_id": member["id"], "kind": "team_dissolved"})
    assert "Vereinsverwaltung" in note["body"] and "frühere Teamleitung" not in note["body"]

    flow.act_as(leader)
    assert (await flow.get("/api/teams/dissolved/mine")).json() == [], "die Zeile fehlt bei der früheren Teamleitung"
    refused = await flow.post(f"/api/teams/{team['id']}/restore", json={})
    assert refused.status_code == 403 and "Vereinsverwaltung" in refused.json()["detail"]
    assert not await flow.db.teams.find_one({"id": team["id"]})

    flow.act_as(admin)
    assert (await flow.post(f"/api/teams/{team['id']}/restore", json={})).status_code == 200
    assert await flow.db.teams.find_one({"id": team["id"]})


@pytest.mark.asyncio
async def test_a_second_dissolve_does_not_wipe_the_archive(flow):
    """Prüfer-Probe: Der zweite Aufruf kommt mit einem vor dem Löschen gelesenen Team - das Archiv bleibt vollständig."""
    leader, _co, _member, team, _squad = await world(flow)
    await dissolve_team(flow.db, dict(team), leader)
    first = await flow.db.dissolved_teams.find_one({"id": team["id"]}, {"_id": 0})
    assert len(first["squads"]) == 1 and len(first["memberships"]) == 3

    with pytest.raises(HTTPException) as refused:
        await dissolve_team(flow.db, dict(team), leader)
    assert refused.value.status_code == 404
    assert await flow.db.dissolved_teams.find_one({"id": team["id"]}, {"_id": 0}) == first


@pytest.mark.asyncio
async def test_dissolving_and_restoring_wait_for_each_other(flow):
    from services.mutation_lock import mutation_lock

    await flow.db.mutation_locks.create_index("resource", unique=True)
    leader, _co, _member, team, _squad = await world(flow)
    async with mutation_lock(flow.db, team_lock_resource(team["id"])):
        flow.act_as(leader)
        busy = await flow.delete(f"/api/teams/{team['id']}", params={"confirm": team["name"]})
        assert busy.status_code == 409 and "gerade geändert" in busy.json()["detail"]
    assert await flow.db.teams.find_one({"id": team["id"]})


class _FailingTeams:
    """``teams``, dessen Einfügen scheitert - wie ein Abbruch mitten im Wiederherstellen."""

    def __init__(self, real):
        self._real = real

    def __getattr__(self, name):
        return getattr(self._real, name)

    async def insert_one(self, _doc):
        raise RuntimeError("Abbruch")


class _FailingDb:
    def __init__(self, real):
        self._real = real
        self.teams = _FailingTeams(real.teams)

    def __getattr__(self, name):
        return getattr(self._real, name)


@pytest.mark.asyncio
async def test_an_aborted_restore_loses_nothing_and_can_be_repeated(flow):
    leader, _co, _member, team, squad = await world(flow)
    await dissolve(flow, leader, team)
    row = await flow.db.dissolved_teams.find_one({"id": team["id"]}, {"_id": 0})

    with pytest.raises(RuntimeError):
        await restore(_FailingDb(flow.db), row, leader)
    assert await flow.db.dissolved_teams.find_one({"id": team["id"]}, {"_id": 0}) == row, "die Sicherung ist unberührt"
    assert not await flow.db.teams.find_one({"id": team["id"]})

    done = await flow.post(f"/api/teams/{team['id']}/restore")
    assert done.status_code == 200
    assert await flow.db.team_squads.count_documents({"id": squad["id"]}) == 1, "keine doppelten Co-Teams"
    assert await flow.db.team_members.count_documents({"team_id": team["id"]}) == 3
    assert not await flow.db.dissolved_teams.find_one({"id": team["id"]})


@pytest.mark.asyncio
async def test_a_leftover_archive_of_a_standing_team_is_cleared(flow):
    """Abbruch nach dem Einfügen: Das Team steht, die Sicherung ist überholt - kein zweites Team, keine ewige Sperre."""
    leader, _co, _member, team, _squad = await world(flow)
    await dissolve(flow, leader, team)
    row = await flow.db.dissolved_teams.find_one({"id": team["id"]}, {"_id": 0})
    assert (await flow.post(f"/api/teams/{team['id']}/restore")).status_code == 200
    await flow.db.dissolved_teams.insert_one(dict(row))

    again = await flow.post(f"/api/teams/{team['id']}/restore")
    assert again.status_code == 409 and "schon wiederhergestellt" in again.json()["detail"]
    assert not await flow.db.dissolved_teams.find_one({"id": team["id"]})
    assert await flow.db.teams.count_documents({"id": team["id"]}) == 1


class _BrokenCollection:
    """Eine Sammlung, deren ``delete_many`` für ein Team scheitert."""

    def __init__(self, real, team_id):
        self._real = real
        self._team_id = team_id

    def __getattr__(self, name):
        return getattr(self._real, name)

    async def delete_many(self, query):
        if query.get("team_id") == self._team_id:
            raise RuntimeError("Datenbank weg")
        return await self._real.delete_many(query)


class _BrokenStepDb:
    def __init__(self, real, name, team_id):
        self._real = real
        setattr(self, name, _BrokenCollection(getattr(real, name), team_id))

    def __getattr__(self, name):
        return getattr(self._real, name)


async def _two_expired_teams(flow):
    first = await world(flow)
    await dissolve(flow, first[0], first[3])
    other = {"id": new_id(), "name": "Zweites", "tag": "ZWE", "leader_id": first[0]["id"], "co_leader_ids": [], "member_ids": [first[0]["id"]], "is_public": True}
    await flow.db.teams.insert_one(dict(other))
    await dissolve(flow, first[0], other)
    past = (now_utc() - timedelta(minutes=1)).isoformat()
    await flow.db.dissolved_teams.update_many({}, {"$set": {"purge_at": past}})
    return first[3], other


@pytest.mark.asyncio
@pytest.mark.parametrize("broken", ["team_invites", "team_chat_messages"])
async def test_a_failing_step_keeps_the_row_for_the_next_run_and_stops_nothing_else(flow, broken):
    team, other = await _two_expired_teams(flow)
    await flow.db.team_chat_messages.insert_one({"id": new_id(), "team_id": team["id"], "user_id": "u", "message": "x"})
    await flow.db.team_invites.insert_one({"id": new_id(), "team_id": team["id"], "user_id": "u", "status": "cancelled"})

    assert await purge_dissolved_teams(_BrokenStepDb(flow.db, broken, team["id"])) == 1, "nur das andere Team ist fertig"
    stuck = await flow.db.dissolved_teams.find_one({"id": team["id"]}, {"_id": 0})
    assert "purged_at" not in stuck and stuck["squads"], "die Zeile bleibt für den nächsten Lauf"
    assert (await flow.db.dissolved_teams.find_one({"id": other["id"]}, {"_id": 0})).get("purged_at")
    other_step = "team_chat_messages" if broken == "team_invites" else "team_invites"
    assert await getattr(flow.db, other_step).count_documents({"team_id": team["id"]}) == 0, "die übrigen Schritte liefen trotzdem"

    assert await purge_dissolved_teams(flow.db) == 1, "der nächste Lauf holt es nach"
    assert (await flow.db.dissolved_teams.find_one({"id": team["id"]}, {"_id": 0})).get("purged_at")
    assert await getattr(flow.db, broken).count_documents({"team_id": team["id"]}) == 0


@pytest.mark.asyncio
async def test_a_locked_attachment_does_not_stop_the_others(flow, monkeypatch):
    from services import chat_attachments

    def locked(row):
        if row["id"] == "gesperrt":
            raise PermissionError("gesperrt")

    monkeypatch.setattr(chat_attachments, "_remove_files", locked)
    leader, _co, _member, team, _squad = await world(flow)
    await dissolve(flow, leader, team)
    for key in ("gesperrt", "frei"):
        await flow.db.chat_attachments.insert_one({"id": key, "context": {"type": "team", "team_id": team["id"]}})
    await flow.db.dissolved_teams.update_one({"id": team["id"]}, {"$set": {"purge_at": (now_utc() - timedelta(minutes=1)).isoformat()}})

    assert await purge_dissolved_teams(flow.db) == 0
    assert not await flow.db.chat_attachments.find_one({"id": "frei"})
    assert await flow.db.chat_attachments.find_one({"id": "gesperrt"})
    assert "purged_at" not in await flow.db.dissolved_teams.find_one({"id": team["id"]}, {"_id": 0})


@pytest.mark.asyncio
@pytest.mark.parametrize("failing", ["remove_upload", "still_referenced"])
async def test_a_failing_image_is_remembered_and_the_row_is_finished(flow, monkeypatch, failing):
    from services import account_erasure, media_audit

    async def boom(*_args, **_kwargs):
        raise OSError("gesperrt")

    monkeypatch.setattr(account_erasure if failing == "remove_upload" else media_audit, failing, boom)
    leader, _co, _member, team, _squad = await world(flow)
    await flow.db.teams.update_one({"id": team["id"]}, {"$set": {"logo_url": "/api/static/uploads/nur-team.webp"}})
    await dissolve(flow, leader, team)
    await purge_dissolved_teams(flow.db, now_utc() + timedelta(days=DISSOLVED_TEAM_RETENTION_DAYS + 1))

    assert (await flow.db.dissolved_teams.find_one({"id": team["id"]}, {"_id": 0})).get("purged_at")
    pending = await flow.db[account_erasure.PENDING].find_one({"filename": "nur-team.webp"}, {"_id": 0})
    assert pending and pending["source"] == account_erasure.SOURCE_MEDIA and pending["last_error"].startswith("OSError")
