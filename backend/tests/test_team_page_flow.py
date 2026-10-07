"""Team-Seite (#1191): „Angemeldet für“ und „Letzte Spiele“ aus den Team-Anmeldungen, Einladungs-Link mit QR-Code.

Der Link öffnet das Team mit „Beitreten“; neu erzeugen sperrt den alten; wer schon drin ist, bleibt einfach drin;
ein privates Team zeigt sich nur mit gültigem Schlüssel. Erfundene Daten, keine echten Personen."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def make_team(flow, captain, *members, co=(), is_public=True):
    team = {
        "id": new_id(), "name": "Lions Rocket", "tag": "LRK", "leader_id": captain["id"], "co_leader_ids": [c["id"] for c in co],
        "member_ids": [captain["id"], *[m["id"] for m in members]], "join_code": "Kx7pQ2", "is_public": is_public,
        "created_at": "2026-01-10T10:00:00+00:00",
    }
    await flow.db.teams.insert_one(dict(team))
    for user in (captain, *members):
        await flow.db.team_members.insert_one({"team_id": team["id"], "user_id": user["id"], "role": "member"})
    return team


async def team_registration(flow, tournament, team, status="approved"):
    reg = {"id": new_id(), "tournament_id": tournament["id"], "team_id": team["id"], "user_id": team["leader_id"],
           "display_name": f"[{team['tag']}] {team['name']}", "status": status}
    await flow.db.tournament_registrations.insert_one(dict(reg))
    return reg


async def other_registration(flow, tournament, name):
    reg = {"id": new_id(), "tournament_id": tournament["id"], "team_id": new_id(), "display_name": name, "status": "approved"}
    await flow.db.tournament_registrations.insert_one(dict(reg))
    return reg


async def finished_match(flow, tournament, own, other, own_score, other_score, *, round_no=1, rounds=1, when="2026-09-20T18:00:00+00:00"):
    match = {
        "id": new_id(), "tournament_id": tournament["id"], "stage_id": "stage-1", "stage_number": 1, "round": round_no,
        "round_name": f"Runde {round_no}", "section": "WB", "match_type": "duel", "status": "completed", "scheduled_at": when,
        "slots": [{"slot": 1, "registration_id": own["id"], "status": "filled"}, {"slot": 2, "registration_id": other["id"], "status": "filled"}],
        "results": [
            {"registration_id": own["id"], "rank": 1 if own_score > other_score else 2, "score": own_score},
            {"registration_id": other["id"], "rank": 1 if other_score > own_score else 2, "score": other_score},
        ],
    }
    await flow.db.matches_v2.insert_one(dict(match))
    if rounds > round_no:
        # Spätere Runde im selben Baum, noch offen - so weiß die Beschriftung, welche Runde das Finale ist.
        await flow.db.matches_v2.insert_one({"id": new_id(), "tournament_id": tournament["id"], "stage_id": "stage-1", "stage_number": 1,
                                             "round": rounds, "round_name": f"Runde {rounds}", "section": "WB", "match_type": "duel",
                                             "status": "pending", "slots": [], "results": []})
    return match


@pytest.mark.asyncio
async def test_overview_shows_upcoming_and_recent_from_the_team_registrations(flow):
    captain = await flow.add_user(role="player", name="neonfalke")
    mate = await flow.add_user(role="player", name="lunabyte")
    guest_viewer = await flow.add_user(role="player", name="zuschauer")
    team = await make_team(flow, captain, mate)

    upcoming = await flow.create_tournament(title="Rocket League Herbst-Cup", status="registration_open", team_mode="team", team_size=2,
                                            start_date="2026-10-17T14:00:00+00:00")
    await team_registration(flow, upcoming, team, status="approved")
    members_only = await flow.create_tournament(title="Vereinsabend-Cup", status="registration_open", team_mode="team", team_size=2,
                                                visibility="members", start_date="2026-10-10T17:00:00+00:00")
    await team_registration(flow, members_only, team, status="pending")
    draft = await flow.create_tournament(title="Entwurf", status="draft", team_mode="team")
    await team_registration(flow, draft, team)

    league = await flow.create_tournament(title="Liga Herbst", status="results_published", team_mode="team", team_size=2)
    own = await team_registration(flow, league, team)
    pirates = await other_registration(flow, league, "Pixelpiraten")
    cactus = await other_registration(flow, league, "Team Kaktus")
    await finished_match(flow, league, own, cactus, 1, 2, round_no=1, rounds=2, when="2026-09-25T18:00:00+00:00")
    await finished_match(flow, league, own, pirates, 3, 1, round_no=2, rounds=2, when="2026-10-02T18:00:00+00:00")

    flow.act_as(mate)
    data = (await flow.get(f"/api/teams/{team['id']}/overview")).json()
    titles = [row["tournament"]["title"] for row in data["upcoming"]]
    assert titles == ["Vereinsabend-Cup", "Rocket League Herbst-Cup"], "nach Datum, Entwurf und fertige Turniere nicht"
    assert [row["status_label"] for row in data["upcoming"]] == ["Angemeldet – wartet auf Freigabe", "Angemeldet"]
    recent = data["recent"]
    assert [(row["score"], row["opponent"], row["outcome"]) for row in recent] == [("3:1", "Pixelpiraten", "win"), ("1:2", "Team Kaktus", "loss")]
    assert [row["round_label"] for row in recent] == ["Finale", "Halbfinale"], "Runden in Alltagsworten"
    assert recent[0]["tournament"]["title"] == "Liga Herbst"

    # Außenstehende sehen nur, was sie auch sonst sehen dürften: kein Mitglieder-Turnier.
    flow.act_as(guest_viewer)
    outside = (await flow.get(f"/api/teams/{team['id']}/overview")).json()
    assert [row["tournament"]["title"] for row in outside["upcoming"]] == ["Rocket League Herbst-Cup"]
    flow.act_as(None)
    assert len((await flow.get(f"/api/teams/{team['id']}/overview")).json()["recent"]) == 2


@pytest.mark.asyncio
async def test_private_team_overview_is_hidden_from_outsiders(flow):
    captain = await flow.add_user(role="player", name="neonfalke")
    team = await make_team(flow, captain, is_public=False)
    flow.act_as(None)
    assert (await flow.get(f"/api/teams/{team['id']}/overview")).status_code == 404
    flow.act_as(captain)
    assert (await flow.get(f"/api/teams/{team['id']}/overview")).status_code == 200


@pytest.mark.asyncio
async def test_invite_link_join_renew_and_already_member(flow):
    captain = await flow.add_user(role="player", name="neonfalke")
    co = await flow.add_user(role="player", name="pixelpanther")
    mate = await flow.add_user(role="player", name="lunabyte")
    newcomer = await flow.add_user(role="player", name="kiwikomet")
    late = await flow.add_user(role="player", name="mondmaus")
    team = await make_team(flow, captain, co, mate, co=(co,))

    flow.act_as(mate)
    assert (await flow.get(f"/api/teams/{team['id']}/invite-link")).status_code == 403, "nur Kapitän und Co-Kapitän laden ein"
    flow.act_as(co)
    first = (await flow.get(f"/api/teams/{team['id']}/invite-link")).json()
    assert first["url"].endswith(f"/teams/{team['id']}?einladung={first['token']}")
    again = (await flow.get(f"/api/teams/{team['id']}/invite-link")).json()
    assert again["token"] == first["token"], "derselbe Link, bis jemand einen neuen erzeugt"
    # Normale Mitglieder lesen den Schlüssel nicht über die Team-Daten mit.
    flow.act_as(mate)
    assert first["token"] not in str((await flow.get(f"/api/teams/{team['id']}")).json())

    # Mit dem Link: Kurzinfo, dann nur noch „Beitreten“.
    flow.act_as(newcomer)
    check = (await flow.get(f"/api/teams/{team['id']}/invite-link/check", params={"token": first["token"]})).json()
    assert check["valid"] is True and check["team"]["name"] == "Lions Rocket" and check["already_member"] is False
    joined = await flow.post(f"/api/teams/{team['id']}/join-link", json={"token": first["token"]})
    assert joined.status_code == 200 and joined.json() == {"ok": True, "already_member": False}
    stored = await flow.db.teams.find_one({"id": team["id"]})
    assert newcomer["id"] in stored["member_ids"]
    assert await flow.db.team_members.find_one({"team_id": team["id"], "user_id": newcomer["id"]})
    note = await flow.db.notifications.find_one({"user_id": captain["id"], "kind": "team_invite_accepted"})
    assert note and "kiwikomet" in note["title"]
    # Schon drin: nichts passiert doppelt.
    assert (await flow.post(f"/api/teams/{team['id']}/join-link", json={"token": first["token"]})).json() == {"ok": True, "already_member": True}

    # Neu erzeugen sperrt den alten Link.
    flow.act_as(captain)
    renewed = (await flow.post(f"/api/teams/{team['id']}/invite-link")).json()
    assert renewed["token"] != first["token"]
    flow.act_as(late)
    old = await flow.post(f"/api/teams/{team['id']}/join-link", json={"token": first["token"]})
    assert old.status_code == 403 and "gilt nicht mehr" in old.json()["detail"]
    assert (await flow.get(f"/api/teams/{team['id']}/invite-link/check", params={"token": first["token"]})).json()["valid"] is False
    assert (await flow.post(f"/api/teams/{team['id']}/join-link", json={"token": renewed["token"]})).json()["already_member"] is False
    # Der Join-Code bleibt als Rückfall.
    assert (await flow.get(f"/api/teams/{team['id']}")).json()["is_member"] is True


@pytest.mark.asyncio
async def test_private_team_shows_itself_only_with_a_valid_link(flow):
    captain = await flow.add_user(role="player", name="neonfalke")
    stranger = await flow.add_user(role="player", name="fremd")
    team = await make_team(flow, captain, is_public=False)
    flow.act_as(captain)
    token = (await flow.get(f"/api/teams/{team['id']}/invite-link")).json()["token"]
    flow.act_as(stranger)
    assert (await flow.get(f"/api/teams/{team['id']}/invite-link/check", params={"token": "falsch-123"})).status_code == 404
    valid = (await flow.get(f"/api/teams/{team['id']}/invite-link/check", params={"token": token})).json()
    assert valid["valid"] is True and valid["team"]["is_public"] is False
    flow.act_as(None)
    assert (await flow.post(f"/api/teams/{team['id']}/join-link", json={"token": token})).status_code == 401
