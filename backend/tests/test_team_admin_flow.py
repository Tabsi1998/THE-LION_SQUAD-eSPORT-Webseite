"""Teamverwaltung im Admin (#2128, TM7, TM10): Liste mit Suche - auch private und verwaiste Teams -, aufgelöste Teams und
„Alle Beitrittscodes erneuern“ mit Rückfrage und Protokoll. Keine Codes in Antworten und Protokollen. Erfundene Daten."""
import logging
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402


@pytest_asyncio.fixture
async def flow(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "team-admin-secret-with-at-least-32-characters")
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def add_team(flow, name, tag, leader, *, is_public=True, code=None):
    team = {"id": new_id(), "name": name, "tag": tag, "leader_id": leader["id"], "co_leader_ids": [], "member_ids": [leader["id"]],
            "join_code": code or f"Code-{tag}", "is_public": is_public, "created_at": "2026-01-10T10:00:00+00:00"}
    await flow.db.teams.insert_one(dict(team))
    return team


@pytest.mark.asyncio
async def test_list_search_and_rights(flow):
    leader = await flow.add_user(role="player", name="leitung")
    gone = await flow.add_user(role="player", name="weg")
    await flow.db.users.update_one({"id": gone["id"]}, {"$set": {"is_active": False, "anonymized_at": "2026-01-01T00:00:00+00:00"}})
    rudel = await add_team(flow, "Rudel", "RDL", leader)
    secret = await add_team(flow, "Geheim", "GHM", leader, is_public=False)
    orphan = await add_team(flow, "Waisen", "WAI", gone)
    await flow.db.team_squads.insert_one({"id": new_id(), "team_id": rudel["id"], "name": "Erste", "member_ids": []})

    flow.act_as(leader)
    assert (await flow.get("/api/admin/teams")).status_code == 403, "kein Adminbereich"

    flow.act_as(await flow.add_user(role="tournament_admin", name="turnierleitung"))
    listed = await flow.get("/api/admin/teams")
    assert listed.status_code == 200
    body = listed.json()
    assert body["total"] == 3 and body["can_renew_all"] is False and body["can_restore"] is False
    rows = {row["id"]: row for row in body["items"]}
    assert rows[secret["id"]]["is_public"] is False, "auch private Teams"
    assert rows[rudel["id"]]["squad_count"] == 1 and rows[rudel["id"]]["member_count"] == 1
    assert rows[rudel["id"]]["leader"]["username"] == leader["username"] and rows[rudel["id"]]["leader_gone"] is False
    assert rows[orphan["id"]]["leader_gone"] is True
    assert "join_code" not in str(body) and "Code-" not in str(body), "keine Codes in der Liste"
    assert "email" not in str(rows[rudel["id"]]["leader"])

    found = (await flow.get("/api/admin/teams", params={"q": "wai"})).json()
    assert [row["id"] for row in found["items"]] == [orphan["id"]] and found["total"] == 1
    paged = (await flow.get("/api/admin/teams", params={"limit": 1, "offset": 1})).json()
    assert len(paged["items"]) == 1 and paged["total"] == 3

    flow.act_as(await flow.add_user(role="club_admin", name="vorstand"))
    body = (await flow.get("/api/admin/teams")).json()
    assert body["can_renew_all"] is True and body["can_restore"] is True


@pytest.mark.asyncio
async def test_dissolved_tab_shows_what_can_still_come_back(flow):
    leader = await flow.add_user(role="player", name="leitung")
    team = await add_team(flow, "Altes Rudel", "ALT", leader)
    flow.act_as(leader)
    gone = await flow.delete(f"/api/teams/{team['id']}", params={"confirm": "Altes Rudel"})
    assert gone.status_code == 200

    flow.act_as(await flow.add_user(role="club_admin", name="vorstand"))
    active = (await flow.get("/api/admin/teams")).json()
    assert active["total"] == 0
    dissolved = (await flow.get("/api/admin/teams", params={"state": "dissolved"})).json()
    assert [row["id"] for row in dissolved["items"]] == [team["id"]] and dissolved["restore_days"] == 30
    assert dissolved["items"][0]["days_left"] == 30 and "member_ids" not in dissolved["items"][0]
    assert (await flow.get("/api/admin/teams", params={"state": "dissolved", "q": "xyz"})).json()["total"] == 0
    assert (await flow.post(f"/api/teams/{team['id']}/restore")).status_code == 200
    assert (await flow.get("/api/admin/teams")).json()["total"] == 1


@pytest.mark.asyncio
async def test_renew_all_join_codes(flow, caplog):
    first = await flow.add_user(role="player", name="erste")
    second = await flow.add_user(role="player", name="zweite")
    joiner = await flow.add_user(role="player", name="neu")
    rudel = await add_team(flow, "Rudel", "RDL", first, code="AltCodeA")
    secret = await add_team(flow, "Geheim", "GHM", second, is_public=False, code="AltCodeB")
    legacy = await add_team(flow, "Uralt", "UAL", first)
    await flow.db.teams.update_one({"id": legacy["id"]}, {"$unset": {"join_code": ""}})
    url = "/api/admin/teams/join-codes/renew"

    flow.act_as(first)
    assert (await flow.post(url, json={"confirm": True})).status_code == 403
    flow.act_as(await flow.add_user(role="tournament_admin", name="turnierleitung"))
    assert (await flow.post(url, json={"confirm": True})).status_code == 403, "nur Club-Admin und Superadmin"

    admin = await flow.add_user(role="club_admin", name="vorstand")
    flow.act_as(admin)
    assert (await flow.post(url, json={})).status_code == 400, "ohne Bestätigung nicht"
    assert (await flow.db.teams.find_one({"id": rudel["id"]}))["join_code"] == "AltCodeA"

    caplog.set_level(logging.INFO)
    await flow.db.team_invite_links.insert_one({"id": new_id(), "team_id": rudel["id"], "token": "AlterSchluessel"})
    done = await flow.post(url, json={"confirm": True})
    assert done.status_code == 200 and done.json() == {"ok": True, "renewed": 3, "links_renewed": True}
    assert await flow.db.team_invite_links.count_documents({}) == 0, "die Vorgabe nimmt die Links mit"

    codes = {row["id"]: row["join_code"] async for row in flow.db.teams.find({}, {"_id": 0, "id": 1, "join_code": 1})}
    assert codes[rudel["id"]] != "AltCodeA" and codes[secret["id"]] != "AltCodeB" and codes[legacy["id"]]
    assert len(set(codes.values())) == 3

    row = await flow.db.audit_logs.find_one({"action": "team.join_code.renew_all"}, {"_id": 0})
    assert row["actor_id"] == admin["id"] and row["data"] == {"teams": 3, "invite_links_renewed": True, "invite_links_removed": 1}
    told = await flow.db.notifications.find({"kind": "team_join_code_renewed"}, {"_id": 0}).to_list(10)
    assert {note["user_id"] for note in told} == {first["id"], second["id"]} and len(told) == 3
    assert "Einladungs-Link ist neu" in told[0]["body"]
    assert "AlterSchluessel" not in str(row)
    everything = str(row) + str(told) + str(done.json()) + caplog.text
    for code in [*codes.values(), "AltCodeA", "AltCodeB"]:
        assert code not in everything, "keine Codes in Antwort, Nachricht, Protokoll und Log"

    flow.act_as(joiner)
    assert (await flow.post(f"/api/teams/{rudel['id']}/join", json={"join_code": "AltCodeA"})).status_code == 403
    assert (await flow.post(f"/api/teams/{rudel['id']}/join", json={"join_code": codes[rudel["id"]]})).status_code == 200
    flow.act_as(first)
    page = (await flow.get(f"/api/teams/{rudel['id']}")).json()
    assert page["join_code"] == codes[rudel["id"]], "die Teamleitung sieht den neuen Code auf der Teamseite"
