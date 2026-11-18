"""Vereinsinterne Erfolge im Profil (#2516): eine Regel für Referenzen und Trophäen auf jedem Endpunkt.

Rechte-Matrix: Gast, angemeldetes Nicht-Mitglied, Vereinsmitglied mit Schalter an bzw. aus und die Person selbst - je
Referenzen und Trophäen, je Endpunkt (öffentliches Profil, App-Referenzen, eigene Trophäen, Turnierweg, Bilanz, Teamseite).
Ein Gast bekommt nie ``internal: true``.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import awards, profile_visibility  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


TOURNAMENTS = {
    # Kennung: (Sichtbarkeit, auf Public-Seiten)
    "t-offen": ("public", True),
    "t-verein": ("members", True),
    "t-community": ("community", True),
    "t-leitung": ("internal", True),
    "t-versteckt": ("public", False),
}
PUBLIC_TOURNAMENTS = {"t-offen"}
MEMBER_TOURNAMENTS = {"t-offen", "t-verein", "t-community"}


async def seed(flow):
    owner = await flow.add_user(role="player", name="pixelfuchs")
    await flow.db.users.update_one({"id": owner["id"]}, {"$set": {"privacy_public_profile": True}})
    member = await flow.add_user(role="player", name="nachtfalke")
    await flow.db.memberships.insert_one({"id": "m-1", "user_id": member["id"], "member_status": "active"})
    outsider = await flow.add_user(role="player", name="turbolurch")
    await flow.db.games.insert_one({"id": "g1", "name": "Rennspiel"})
    for index, (tid, (visibility, is_public)) in enumerate(TOURNAMENTS.items(), start=1):
        await flow.db.tournaments.insert_one({
            "id": tid, "slug": tid, "title": f"Cup {tid}", "status": "results_published", "visibility": visibility,
            "is_public": is_public, "format": "single_elim", "game_id": "g1", "start_date": f"2026-10-0{index}T18:00:00+02:00",
        })
        await flow.db.tournament_registrations.insert_one({"id": f"r-{tid}", "tournament_id": tid, "user_id": owner["id"],
                                                           "status": "approved", "final_position": 1})
        await flow.db.tournament_registrations.insert_one({"id": f"r2-{tid}", "tournament_id": tid, "user_id": outsider["id"],
                                                           "status": "approved", "final_position": 2})
    for cid, visibility in (("c-offen", "public"), ("c-verein", "members")):
        await flow.db.f1_challenges.insert_one({"id": cid, "slug": cid, "title": f"Hotlap {cid}", "status": "active", "visibility": visibility,
                                                "start_date": "2026-09-01T18:00:00+02:00"})
        await flow.db.f1_tracks.insert_one({"id": f"tr-{cid}", "name": "Teststrecke", "challenge_id": cid})
        await flow.db.f1_lap_times.insert_one({"id": f"lap-{cid}", "challenge_id": cid, "track_id": f"tr-{cid}", "user_id": owner["id"],
                                               "time_ms": 80000, "is_invalid": False, "created_at": "2026-09-02T18:00:00+00:00"})
    await awards.rebuild_all_awards(flow.db)
    return owner, member, outsider


def tournament_refs(payload) -> set[str]:
    return {item["target_id"] for item in payload["items"] if item["kind"] == "tournament"}


def lap_refs(payload) -> set[str]:
    return {item["target_id"] for item in payload["items"] if item["kind"] == "fastlap"}


def award_ids(rows) -> set[str]:
    return {row["tournament"]["id"] for row in rows}


def internal_flags(rows, key) -> dict[str, bool]:
    return {key(row): row["internal"] for row in rows}


async def public_profile(flow, owner, viewer, **params):
    flow.act_as(viewer)
    res = await flow.get(f"/api/users/public/{owner['username']}", params=params or None)
    assert res.status_code == 200, res.text
    return res.json()


@pytest.mark.asyncio
async def test_guest_and_outsider_never_see_internal(flow):
    owner, _member, outsider = await seed(flow)
    for viewer in (None, outsider):
        profile = await public_profile(flow, owner, viewer)
        assert tournament_refs(profile["references"]) == PUBLIC_TOURNAMENTS
        assert lap_refs(profile["references"]) == {"c-offen"}
        assert award_ids(profile["awards"]) == PUBLIC_TOURNAMENTS
        assert not any(item["internal"] for item in profile["references"]["items"]), "nie internal: true für Fremde"
        assert not any(row["internal"] for row in profile["awards"])
    # Auch mit ausgeschaltetem Schalter ändert sich für Gäste nichts - und angeschaltet sehen sie trotzdem nichts.
    await flow.db.users.update_one({"id": owner["id"]}, {"$set": {profile_visibility.SETTING: True}})
    assert tournament_refs((await public_profile(flow, owner, None))["references"]) == PUBLIC_TOURNAMENTS


@pytest.mark.asyncio
async def test_member_sees_internal_with_the_switch_on_and_only_what_a_member_may_see(flow):
    owner, member, _outsider = await seed(flow)
    profile = await public_profile(flow, owner, member)
    refs = profile["references"]
    assert tournament_refs(refs) == MEMBER_TOURNAMENTS, "keine Turniere der Vereinsverwaltung, keine versteckten"
    assert lap_refs(refs) == {"c-offen", "c-verein"}
    flags = internal_flags(refs["items"], lambda item: item["target_id"])
    assert flags == {"t-offen": False, "t-verein": True, "t-community": True, "c-offen": False, "c-verein": True}
    assert award_ids(profile["awards"]) == MEMBER_TOURNAMENTS
    assert internal_flags(profile["awards"], lambda row: row["tournament"]["id"]) == {"t-offen": False, "t-verein": True, "t-community": True}

    # Schalter aus: das Mitglied sieht wieder nur Öffentliches.
    await flow.db.users.update_one({"id": owner["id"]}, {"$set": {profile_visibility.SETTING: False}})
    off = await public_profile(flow, owner, member)
    assert tournament_refs(off["references"]) == PUBLIC_TOURNAMENTS and lap_refs(off["references"]) == {"c-offen"}
    assert award_ids(off["awards"]) == PUBLIC_TOURNAMENTS
    assert not any(item["internal"] for item in off["references"]["items"]) and not any(row["internal"] for row in off["awards"])


@pytest.mark.asyncio
async def test_self_sees_everything_marked_and_as_others_like_a_guest(flow):
    owner, _member, _outsider = await seed(flow)
    await flow.db.users.update_one({"id": owner["id"]}, {"$set": {profile_visibility.SETTING: False}})
    owner_now = {**owner, profile_visibility.SETTING: False}
    mine = await public_profile(flow, owner, owner_now)
    assert tournament_refs(mine["references"]) == set(TOURNAMENTS), "die Person selbst sieht immer alles"
    assert lap_refs(mine["references"]) == {"c-offen", "c-verein"}
    assert award_ids(mine["awards"]) == set(TOURNAMENTS)
    flags = internal_flags(mine["awards"], lambda row: row["tournament"]["id"])
    assert flags == {"t-offen": False, "t-verein": True, "t-community": True, "t-leitung": True, "t-versteckt": True}

    as_others = await public_profile(flow, owner, owner_now, view_as="public")
    assert tournament_refs(as_others["references"]) == PUBLIC_TOURNAMENTS and award_ids(as_others["awards"]) == PUBLIC_TOURNAMENTS
    assert not any(item["internal"] for item in as_others["references"]["items"])

    # App: eigenes Profil wie bisher alles, jetzt mit Kennzeichnung; die eigenen Trophäen ebenso.
    flow.act_as(owner_now)
    app_refs = (await flow.get("/api/mobile/profile/references")).json()
    assert tournament_refs(app_refs) == set(TOURNAMENTS) and lap_refs(app_refs) == {"c-offen", "c-verein"}
    assert internal_flags(app_refs["items"], lambda item: item["target_id"])["t-verein"] is True
    assert internal_flags(app_refs["items"], lambda item: item["target_id"])["t-offen"] is False
    my_awards = (await flow.get("/api/me/awards")).json()["awards"]
    assert award_ids(my_awards) == set(TOURNAMENTS) and internal_flags(my_awards, lambda row: row["tournament"]["id"])["t-leitung"] is True


@pytest.mark.asyncio
async def test_tournament_path_and_record_follow_the_same_rule(flow):
    owner, member, outsider = await seed(flow)
    path = f"/api/profile/{owner['username']}/tournaments/t-verein/path"
    flow.act_as(member)
    res = await flow.get(path)
    assert res.status_code == 200, res.text
    assert res.json()["public"] is True, "für Mitglieder ohne Namen privater Gegner"
    assert (await flow.get(f"/api/profile/{owner['username']}/tournaments/t-leitung/path")).status_code == 404
    for viewer in (None, outsider):
        flow.act_as(viewer)
        res = await flow.get(path)
        assert res.status_code == 404
    await flow.db.users.update_one({"id": owner["id"]}, {"$set": {profile_visibility.SETTING: False}})
    flow.act_as(member)
    res = await flow.get(path)
    assert res.status_code == 404, "Schalter aus: kein interner Weg für Mitglieder"
    flow.act_as(owner)
    res = await flow.get(path)
    assert res.status_code == 200, "die Person selbst sieht ihren Weg immer"


@pytest.mark.asyncio
async def test_team_page_shows_internal_trophies_to_club_members_only(flow):
    leader = await flow.add_user(role="player", name="kapitaen")
    member = await flow.add_user(role="player", name="nachtfalke")
    await flow.db.memberships.insert_one({"id": "m-1", "user_id": member["id"], "member_status": "active"})
    outsider = await flow.add_user(role="player", name="turbolurch")
    await flow.db.teams.insert_one({"id": "tm1", "name": "Team Test", "tag": "TST", "leader_id": leader["id"], "co_leader_ids": [],
                                    "member_ids": [leader["id"]], "is_public": True, "created_at": "2026-01-01T00:00:00+00:00"})
    await flow.db.team_members.insert_one({"team_id": "tm1", "user_id": leader["id"], "role": "leader"})
    for tid, visibility in (("t-offen", "public"), ("t-verein", "members"), ("t-leitung", "internal")):
        await flow.db.tournaments.insert_one({"id": tid, "slug": tid, "title": tid, "status": "results_published", "visibility": visibility,
                                              "is_public": True, "format": "single_elim", "start_date": "2026-10-02T17:00:00+02:00"})
        await flow.db.tournament_registrations.insert_one({"id": f"r-{tid}", "tournament_id": tid, "team_id": "tm1", "status": "approved",
                                                           "final_position": 1})
    await awards.rebuild_all_awards(flow.db)

    for viewer in (None, outsider):
        flow.act_as(viewer)
        team = (await flow.get("/api/teams/tm1")).json()
        assert award_ids(team["awards"]) == {"t-offen"} and not any(row["internal"] for row in team["awards"])
    flow.act_as(member)
    team = (await flow.get("/api/teams/tm1")).json()
    assert award_ids(team["awards"]) == {"t-offen", "t-verein"}
    assert internal_flags(team["awards"], lambda row: row["tournament"]["id"]) == {"t-offen": False, "t-verein": True}
    flow.act_as(leader)
    team = (await flow.get("/api/teams/tm1")).json()
    assert award_ids(team["awards"]) == {"t-offen", "t-verein", "t-leitung"}, "das Team selbst sieht alles"


@pytest.mark.asyncio
async def test_the_switch_is_saved_on_the_account(flow):
    owner, _member, _outsider = await seed(flow)
    flow.act_as(owner)
    res = await flow.put("/api/users/me", json={profile_visibility.SETTING: False})
    assert res.status_code == 200, res.text
    stored = await flow.db.users.find_one({"id": owner["id"]}, {"_id": 0, profile_visibility.SETTING: 1})
    assert stored == {profile_visibility.SETTING: False}
    assert res.json().get(profile_visibility.SETTING) is False, "die Antwort trägt den neuen Stand"
    assert profile_visibility.members_see_internal({}) is True, "ohne Feld gilt an - keine Migration"
    assert profile_visibility.members_see_internal(stored) is False
