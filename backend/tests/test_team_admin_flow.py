"""Teamverwaltung im Admin (#2128, TM7, TM10): Liste mit Suche - auch private und verwaiste Teams -, aufgelöste Teams und
„Alle Beitrittscodes erneuern“ mit Rückfrage und Protokoll. Keine Codes in Antworten und Protokollen. Erfundene Daten."""
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
    assert (await flow.delete(f"/api/teams/{team['id']}", params={"confirm": "Altes Rudel"})).status_code == 200

    flow.act_as(await flow.add_user(role="club_admin", name="vorstand"))
    active = (await flow.get("/api/admin/teams")).json()
    assert active["total"] == 0
    dissolved = (await flow.get("/api/admin/teams", params={"state": "dissolved"})).json()
    assert [row["id"] for row in dissolved["items"]] == [team["id"]] and dissolved["restore_days"] == 30
    assert dissolved["items"][0]["days_left"] == 30 and "member_ids" not in dissolved["items"][0]
    assert (await flow.get("/api/admin/teams", params={"state": "dissolved", "q": "xyz"})).json()["total"] == 0
    assert (await flow.post(f"/api/teams/{team['id']}/restore")).status_code == 200
    assert (await flow.get("/api/admin/teams")).json()["total"] == 1
