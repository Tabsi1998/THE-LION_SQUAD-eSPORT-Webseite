"""Referenzen als Turnierteilnahme mit Einträgen (#409): ein Team oder mehrere Einzelstarter,
je mit eigener Platzierung; Plattform, Format, Liga und Saison als Felder statt im Titel."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def _profiles(flow):
    await flow.db.club_member_profiles.insert_many([
        {"id": "p1", "display_name": "Anna Beispiel", "gamertag": "Anni", "slug": "anni", "is_active": True},
        {"id": "p2", "display_name": "Ben Beispiel", "gamertag": "Benny", "slug": "benny", "is_active": True},
    ])


@pytest.mark.asyncio
async def test_entries_carry_their_own_placement_and_mirror_the_best(flow):
    await _profiles(flow)
    admin = await flow.add_user(role="superadmin", name="admin")
    flow.act_as(admin)
    response = await flow.post("/api/references", json={
        "title": "Winter Cup",
        "organizer": "ESL",
        "league": "Liga X",
        "season": "Season 3",
        "format": "HC",
        "platforms": ["PS"],
        "entries": [
            {"kind": "solo", "member_profile_ids": ["p1"], "placement": 1},
            {"kind": "solo", "member_profile_ids": ["p2"], "placement": 4, "participant_count": 32},
        ],
    })
    assert response.status_code == 200, response.text
    body = response.json()
    assert [entry["placement"] for entry in body["entries"]] == [1, 4]
    assert body["entries"][0]["lineup_members"][0]["display_name"] == "Anni"
    assert body["entries"][0]["lineup_members"][0]["profile_url"] == "/members/anni"
    assert body["entries"][0]["medal"] == "gold" and body["entries"][1]["medal"] is None
    assert body["medal"] == "gold" and body["best_placement"] == 1

    # Spiegel für Startseite, SEO, Sitemap und die Profil-Suche über `member_profile_ids`.
    stored = await flow.db.references.find_one({"id": body["id"]}, {"_id": 0})
    assert stored["placement"] == 1 and stored["member_profile_ids"] == ["p1", "p2"]
    assert all(entry["id"] for entry in stored["entries"])

    flow.act_as(None)
    listing = await flow.get("/api/references")
    assert listing.status_code == 200, listing.text
    summary = listing.json()["summary"]
    assert summary["total"] == 1 and summary["entries"] == 2
    assert summary["gold"] == 1 and summary["podiums"] == 1 and summary["top10"] == 2
    assert summary["seasons"] == ["Season 3"]
    item = listing.json()["items"][0]
    assert item["display_title"] == "Winter Cup"
    assert item["platforms"] == ["PS"] and item["league"] == "Liga X" and item["format"] == "HC"


@pytest.mark.asyncio
async def test_legacy_reference_reads_as_one_entry_with_fields_from_the_title(flow):
    await _profiles(flow)
    await flow.db.references.insert_one({
        "id": "old1",
        "title": "[PS] HC | Liga A | Herbst Cup Season 2",
        "team_name": "THE LION SQUAD",
        "member_profile_ids": ["p1", "p2"],
        "lineup_members": [{"profile_id": "p1", "display_name": "Anni"}, {"profile_id": "p2", "display_name": "Benny"}],
        "lineup": ["Gast"],
        "placement": 2,
        "status": "completed",
    })
    flow.act_as(None)
    response = await flow.get("/api/references/old1")
    assert response.status_code == 200, response.text
    item = response.json()
    assert item["display_title"] == "Herbst Cup Season 2"
    assert item["platforms"] == ["PS"] and item["format"] == "HC"
    assert item["league"] == "Liga A" and item["season"] == "Season 2"
    assert len(item["entries"]) == 1
    entry = item["entries"][0]
    assert entry["kind"] == "team" and entry["placement"] == 2 and entry["medal"] == "silver"
    assert [member["display_name"] for member in entry["lineup_members"]] == ["Anni", "Benny"]
    assert entry["lineup"] == ["Gast"]


@pytest.mark.asyncio
async def test_update_with_entries_rewrites_the_mirror_and_profiles_count_their_own_entry(flow):
    await _profiles(flow)
    await flow.db.references.insert_one({
        "id": "old2", "title": "Cup", "member_profile_ids": ["p1"],
        "lineup_members": [{"profile_id": "p1", "display_name": "Anni"}], "placement": 5, "status": "completed",
    })
    admin = await flow.add_user(role="superadmin", name="admin")
    flow.act_as(admin)
    response = await flow.patch("/api/references/old2", json={"entries": [
        {"kind": "team", "team_name": "LION A", "member_profile_ids": ["p1", "p2"], "placement": 3},
        {"kind": "solo", "member_profile_ids": ["p2"], "placement": 1},
    ]})
    assert response.status_code == 200, response.text
    stored = await flow.db.references.find_one({"id": "old2"}, {"_id": 0})
    assert stored["placement"] == 1 and stored["team_name"] == "LION A"
    assert stored["member_profile_ids"] == ["p1", "p2"]
    assert [entry["kind"] for entry in stored["entries"]] == ["team", "solo"]

    # Anni steht nur im Team (Platz 3), Benny im Team und als Einzelstarter (Platz 1): das
    # Mitgliederprofil zählt den Eintrag, in dem die Person steht.
    flow.act_as(None)
    anni = await flow.get("/api/membership/profiles/anni")
    assert anni.status_code == 200, anni.text
    assert anni.json()["reference_stats"]["bronze"] == 1 and anni.json()["reference_stats"]["team"] == 1
    assert anni.json()["references"][0]["member_entry"]["placement"] == 3
    benny = await flow.get("/api/membership/profiles/benny")
    assert benny.status_code == 200, benny.text
    stats = benny.json()["reference_stats"]
    assert stats["team"] == 1 and stats["solo"] == 1
    assert stats["gold"] == 1 and stats["bronze"] == 1 and stats["podiums"] == 2
    assert benny.json()["references"][0]["member_entry"]["placement"] == 1


@pytest.mark.asyncio
async def test_old_clients_with_one_placement_still_save(flow):
    await _profiles(flow)
    admin = await flow.add_user(role="superadmin", name="admin")
    flow.act_as(admin)
    response = await flow.post("/api/references", json={
        "title": "[PC] Community Cup", "member_profile_ids": ["p2"], "placement": 3, "team_name": "",
    })
    assert response.status_code == 200, response.text
    body = response.json()
    assert len(body["entries"]) == 1
    assert body["entries"][0]["kind"] == "solo" and body["entries"][0]["placement"] == 3
    assert body["entries"][0]["lineup_members"][0]["display_name"] == "Benny"
    assert body["platforms"] == ["PC"] and body["display_title"] == "Community Cup"
