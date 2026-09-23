"""Auszeichnungen (#230): beim Veröffentlichen je Anmeldung Platz und Bilanz, Trophäen für Platz 1-3 mit
optionalem Bild, Korrektur überschreibt, Profil zeigt nur Öffentliches, Profilbanner nur aus eigenen."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import awards  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def test_pure_labels_and_image_cleaning():
    assert awards.award_kind(1) == "trophy" and awards.award_kind(3) == "trophy" and awards.award_kind(4) == "banner" and awards.award_kind(None) == "banner"
    assert awards.rank_label(1) == "1. Platz" and awards.rank_label(7) == "7. Platz" and awards.rank_label(None) == "Teilnahme"
    assert awards.record_line({"played": 4, "won": 3}) == "3 Siege · 1 Niederlage"
    assert awards.record_line({"played": 1, "won": 0}) == "0 Siege · 1 Niederlage"
    assert awards.record_line({"played": 0, "won": 0}) == "" and awards.record_line(None) == ""
    assert awards.clean_award_images({"1": " /api/static/uploads/gold.png ", "2": "", 3: "/api/static/uploads/bronze.png", "9": "x"}) == {"1": "/api/static/uploads/gold.png", "3": "/api/static/uploads/bronze.png"}
    assert awards.clean_award_images("nein") == {}


async def seed_tournament(flow, tid="t1", *, visibility="public", status="results_published", images=None):
    await flow.db.tournaments.insert_one({"id": tid, "slug": tid, "title": "Herbst-Cup", "status": status, "start_date": "2026-10-02T17:00:00+02:00",
                                          "visibility": visibility, "is_public": True, "format": "single_elim", "game_id": "g1", "award_images": images or {}})
    await flow.db.games.update_one({"id": "g1"}, {"$set": {"id": "g1", "name": "FIFA 26", "logo_url": "/api/static/uploads/fifa.png"}}, upsert=True)


@pytest.mark.asyncio
async def test_awards_follow_the_registrations_and_corrections(flow):
    paula = await flow.add_user(role="player", name="paula")
    max_ = await flow.add_user(role="player", name="max")
    ute = await flow.add_user(role="player", name="ute")
    await seed_tournament(flow, images={"1": "/api/static/uploads/gold.png"})
    await flow.db.tournament_registrations.insert_many([
        {"id": "r1", "tournament_id": "t1", "user_id": paula["id"], "status": "approved", "final_position": 1},
        {"id": "r2", "tournament_id": "t1", "user_id": max_["id"], "status": "approved", "final_position": 2},
        {"id": "r3", "tournament_id": "t1", "user_id": ute["id"], "status": "checked_in"},
        {"id": "r4", "tournament_id": "t1", "user_id": "weg", "status": "cancelled", "final_position": 3},
    ])
    assert await awards.record_tournament_awards(flow.db, "t1") == 3
    docs = {doc["registration_id"]: doc for doc in await flow.db.tournament_awards.find({}, {"_id": 0}).to_list(10)}
    assert set(docs) == {"r1", "r2", "r3"}, "abgemeldete bekommen nichts"
    assert docs["r1"]["rank"] == 1 and docs["r1"]["kind"] == "trophy" and docs["r3"]["rank"] is None and docs["r3"]["kind"] == "banner"
    assert docs["r1"]["participants"] == 3 and docs["r1"]["game"]["name"] == "FIFA 26" and docs["r1"]["matches"] == {"played": 0, "won": 0}
    first_id = docs["r1"]["id"]

    # Korrektur: Max gewinnt doch, Ute fällt weg - erneut veröffentlichen rechnet neu, die Kennung bleibt.
    await flow.db.tournament_registrations.update_one({"id": "r1"}, {"$set": {"final_position": 2}})
    await flow.db.tournament_registrations.update_one({"id": "r2"}, {"$set": {"final_position": 1}})
    await flow.db.tournament_registrations.update_one({"id": "r3"}, {"$set": {"status": "withdrawn"}})
    assert await awards.record_tournament_awards(flow.db, "t1") == 2
    docs = {doc["registration_id"]: doc for doc in await flow.db.tournament_awards.find({}, {"_id": 0}).to_list(10)}
    assert set(docs) == {"r1", "r2"} and docs["r1"]["rank"] == 2 and docs["r2"]["rank"] == 1 and docs["r1"]["id"] == first_id

    mine = await awards.awards_for_user(flow.db, max_["id"], public_only=False)
    assert len(mine) == 1 and mine[0]["rank_label"] == "1. Platz" and mine[0]["image_url"] == "/api/static/uploads/gold.png"
    assert mine[0]["tournament"]["title"] == "Herbst-Cup" and "registration_id" not in mine[0] and "user_id" not in mine[0]
    theirs = await awards.awards_for_user(flow.db, paula["id"], public_only=False)
    assert theirs[0]["rank_label"] == "2. Platz" and theirs[0]["image_url"] is None, "nur Platz 1 hat ein Bild hochgeladen"


@pytest.mark.asyncio
async def test_public_profile_shows_only_public_awards_and_own_banner_choice(flow):
    paula = await flow.add_user(role="player", name="paula")
    await flow.db.users.update_one({"id": paula["id"]}, {"$set": {"privacy_public_profile": True, "display_name": "Paula"}})
    await seed_tournament(flow, "t1")
    await seed_tournament(flow, "t2", visibility="members")
    await flow.db.tournament_registrations.insert_many([
        {"id": "r1", "tournament_id": "t1", "user_id": paula["id"], "status": "approved", "final_position": 3},
        {"id": "r2", "tournament_id": "t2", "user_id": paula["id"], "status": "approved", "final_position": 1},
    ])
    rebuilt = await awards.rebuild_all_awards(flow.db)
    assert rebuilt == {"tournaments": 2, "awards": 2}

    public = (await flow.get(f"/api/users/public/{paula['username']}")).json()
    assert [award["tournament"]["id"] for award in public["awards"]] == ["t1"], "das Mitglieder-Turnier bleibt draußen"
    assert public["awards"][0]["kind"] == "trophy" and public["featured_award"] is None

    flow.act_as(paula)
    mine = (await flow.get("/api/me/awards")).json()
    assert {award["tournament"]["id"] for award in mine["awards"]} == {"t1", "t2"} and mine["featured_award_id"] is None
    chosen = next(award for award in mine["awards"] if award["tournament"]["id"] == "t1")
    assert (await flow.post(f"/api/me/awards/{chosen['id']}/feature")).json()["featured_award"]["id"] == chosen["id"]
    assert (await flow.get(f"/api/users/public/{paula['username']}")).json()["featured_award"]["id"] == chosen["id"]
    assert (await flow.post("/api/me/awards/fremd/feature")).status_code == 404

    max_ = await flow.add_user(role="player", name="max")
    flow.act_as(max_)
    assert (await flow.post(f"/api/me/awards/{chosen['id']}/feature")).status_code == 404, "fremde Auszeichnung: nicht wählbar"
    assert (await flow.post("/api/admin/awards/rebuild")).status_code == 403

    flow.act_as(paula)
    assert (await flow.client.delete("/api/me/awards/feature")).json() == {"ok": True, "featured_award": None}
    assert (await flow.get(f"/api/users/public/{paula['username']}")).json()["featured_award"] is None


@pytest.mark.asyncio
async def test_admin_saves_award_images_only_for_the_first_three(flow):
    admin = await flow.add_user(role="superadmin", name="admin")
    await seed_tournament(flow, "t1", status="scheduled")
    flow.act_as(admin)
    saved = await flow.put("/api/tournaments/t1", json={"award_images": {"1": "/api/static/uploads/gold.png", "2": "", "7": "/api/static/uploads/x.png"}})
    assert saved.status_code == 200, saved.text
    row = await flow.db.tournaments.find_one({"id": "t1"}, {"_id": 0, "award_images": 1})
    assert row["award_images"] == {"1": "/api/static/uploads/gold.png"}


@pytest.mark.asyncio
async def test_team_awards_and_the_team_banner_are_for_the_leadership(flow):
    leader = await flow.add_user(role="player", name="leader")
    member = await flow.add_user(role="player", name="member")
    stranger = await flow.add_user(role="player", name="stranger")
    await flow.db.teams.insert_one({"id": "tm1", "name": "Team Lions", "tag": "LION", "leader_id": leader["id"], "co_leader_ids": [],
                                    "member_ids": [leader["id"], member["id"]], "is_public": True, "created_at": "2026-01-01T00:00:00+00:00"})
    await flow.db.team_members.insert_many([{"team_id": "tm1", "user_id": leader["id"], "role": "leader"}, {"team_id": "tm1", "user_id": member["id"], "role": "member"}])
    await seed_tournament(flow, "t1")
    await seed_tournament(flow, "t2", visibility="members")
    await flow.db.tournament_registrations.insert_many([
        {"id": "r1", "tournament_id": "t1", "team_id": "tm1", "status": "approved", "final_position": 2},
        {"id": "r2", "tournament_id": "t2", "team_id": "tm1", "status": "approved", "final_position": 1},
    ])
    await awards.rebuild_all_awards(flow.db)

    public = (await flow.get("/api/teams/tm1")).json()
    assert [award["tournament"]["id"] for award in public["awards"]] == ["t1"] and public["awards"][0]["team"]["name"] == "Team Lions"
    assert public["featured_award"] is None

    flow.act_as(member)
    inside = (await flow.get("/api/teams/tm1")).json()
    assert {award["tournament"]["id"] for award in inside["awards"]} == {"t1", "t2"}, "Mitglieder sehen auch das interne Turnier"
    # Die Team-Auszeichnung zählt auch im eigenen Profil des Mitglieds.
    assert {award["tournament"]["id"] for award in (await flow.get("/api/me/awards")).json()["awards"]} == {"t1", "t2"}
    chosen = next(award for award in inside["awards"] if award["tournament"]["id"] == "t1")
    assert (await flow.post(f"/api/teams/tm1/awards/{chosen['id']}/feature")).status_code == 403, "ein Mitglied ohne Leitung wählt nicht"

    flow.act_as(leader)
    assert (await flow.post(f"/api/teams/tm1/awards/{chosen['id']}/feature")).json()["featured_award"]["id"] == chosen["id"]
    assert (await flow.get("/api/teams/tm1")).json()["featured_award"]["rank_label"] == "2. Platz"
    assert (await flow.post("/api/teams/tm1/awards/fremd/feature")).status_code == 404
    flow.act_as(stranger)
    assert (await flow.post(f"/api/teams/tm1/awards/{chosen['id']}/feature")).status_code == 403
    flow.act_as(leader)
    assert (await flow.client.delete("/api/teams/tm1/awards/feature")).json()["featured_award"] is None
