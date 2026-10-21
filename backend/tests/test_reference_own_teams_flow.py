"""Mehrere eigene Teams je Saison (#1926) über die echten Routen: die Liste „Eigene Teams“ (das alte Feld wird
übernommen), Garage und Teamwertung der Rennliga mit allen eigenen Teams - auch in anderer Schreibweise -, „Unser Platz“
und Liga-Weg der Team-Liga mit dem besten eigenen Team. Alte Saisons bleiben, wie sie sind. Nur erfundene Namen."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from routes import reference_round_routes, reference_series_public_routes  # noqa: E402
from services import migrations, reference_running_cache, reference_series  # noqa: E402

ADMIN = "/api/reference-series/admin"
PUBLIC = "/api/reference-series/public"
TEAMS = [{"name": "Probe Löwen"}, {"name": "Probe-DarkFriday", "aliases": ["PDF Racing"]}, {"name": "Probe Löwen C"}]
# Punkteschema wie bei einer großen Rennliga (Platz 1 bis 20).
SCHEME = [35, 30, 26, 23, 20, 17, 15, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]
RULES = {"points_mode": "scheme", "points_by_place": SCHEME, "tiebreakers": ["countback"],
         "team_scoring": {"enabled": True, "counting_drivers": 2, "guests_count": True}}


@pytest_asyncio.fixture
async def flow(monkeypatch):
    reference_running_cache.reset()
    instance, shutdown = make_flow()
    monkeypatch.setattr(reference_round_routes, "club_today", lambda: "2026-11-20")
    monkeypatch.setattr(reference_series_public_routes, "club_today", lambda: "2026-11-20")
    try:
        yield instance
    finally:
        await shutdown()


async def _admin(flow):
    await migrations.migrate_points_scheme_templates(flow.db)
    admin = await flow.add_user(role="club_admin", name="vorstand")
    flow.act_as(admin)
    return admin


async def _lineage(flow, kind="racing", title="Probe Rennliga"):
    return (await flow.post(f"{ADMIN}/lineages", json={"title": title, "kind": kind})).json()


@pytest.mark.asyncio
async def test_the_season_keeps_a_list_of_own_teams_and_old_clients_still_work(flow):
    await _admin(flow)
    lineage = await _lineage(flow)
    created = await flow.post(f"{ADMIN}/series", json={"lineage_id": lineage["id"], "season": "2026",
                                                       "own_teams": TEAMS})
    assert created.status_code == 200, created.text
    series = created.json()
    assert [team["name"] for team in series["own_teams"]] == ["Probe Löwen", "Probe-DarkFriday", "Probe Löwen C"]
    assert series["own_teams"][1]["aliases"] == ["PDF Racing"]
    assert series["team_name"] == "Probe Löwen"

    # Ein älterer Aufruf schickt nur „Eigenes Team“: es wird das einzige Team der Liste.
    old = (await flow.post(f"{ADMIN}/series", json={"lineage_id": lineage["id"], "season": "2025",
                                                    "team_name": "Probe Löwen"})).json()
    assert old["own_teams"] == [{"name": "Probe Löwen", "aliases": []}]

    renamed = await flow.patch(f"{ADMIN}/series/{series['id']}", json={"own_teams": TEAMS[1:]})
    assert renamed.status_code == 200, renamed.text
    assert (renamed.json()["team_name"], len(renamed.json()["own_teams"])) == ("Probe-DarkFriday", 2)
    cleared = (await flow.patch(f"{ADMIN}/series/{series['id']}", json={"own_teams": []})).json()
    assert (cleared["own_teams"], cleared["team_name"]) == ([], None)


async def _racing(flow, teams=TEAMS):
    await _admin(flow)
    lineage = await _lineage(flow)
    series = (await flow.post(f"{ADMIN}/series", json={
        "lineage_id": lineage["id"], "season": "2026", "status": "active", "rules": RULES})).json()
    rounds = []
    for number in (1, 2):
        response = await flow.post(f"{ADMIN}/series/{series['id']}/rounds",
                                   json={"code": f"R{number}", "day": f"2026-11-0{number}"})
        rounds.append(response.json()["id"])
    await flow.db.club_member_profiles.insert_one({"id": "profil-a", "slug": "probe-a", "is_active": True})
    people = [
        {"id": "a", "name": "Probe A", "link": "member", "profile_id": "profil-a", "is_club_member": True,
         "default_team": "Probe Löwen"},
        # Ein Gast fährt allein für das zweite eigene Team - es kommt trotzdem in die Garage.
        {"id": "g", "name": "Probe Gast", "link": "guest", "default_team": "PDF Racing"},
        {"id": "x", "name": "Fremd X", "link": "external", "default_team": "Fremd Rot"},
    ]
    await flow.db.reference_participants.insert_many(
        [{"series_id": series["id"], "is_club_member": False, "name_hidden": False, **person} for person in people])
    # Ohne eigenes Team im Bild steht das Standard-Team im Feld (#1960: vorbelegt bzw. migriert).
    sheets = [
        [("a", "Probe Löwen"), ("g", "Probe DarkFriday"), ("x", "Fremd Rot")],
        [("g", "probe-darkfriday"), ("x", "Fremd Rot"), ("a", "Probe Löwen")],
    ]
    for round_id, order in zip(rounds, sheets):
        await flow.db.reference_round_results.insert_one({
            "id": f"blatt-{round_id}", "series_id": series["id"], "round_id": round_id, "status": "published",
            "rows": [{"participant_id": pid, "place": place, "team": team, "marks": []}
                     for place, (pid, team) in enumerate(order, start=1)]})
        await flow.db.reference_rounds.update_one({"id": round_id}, {"$set": {"status": "scored"}})
    response = await flow.patch(f"{ADMIN}/series/{series['id']}", json={"own_teams": teams})
    assert response.status_code == 200, response.text
    return lineage, series


@pytest.mark.asyncio
async def test_garage_and_team_standings_know_every_own_team_whatever_the_spelling(flow):
    lineage, series = await _racing(flow)
    flow.act_as(None)
    body = (await flow.get(f"{PUBLIC}/{lineage['slug']}/{series['season_slug']}")).json()
    racing = body["racing"]
    # Ein Team, auch wenn der Veranstalter es zweimal anders schreibt.
    assert [(row["team"], row["points"]) for row in racing["teams"]["rows"]] == [
        ("Probe-DarkFriday", 65), ("Probe Löwen", 61), ("Fremd Rot", 56)]
    # Alle drei eigenen Teams in der Garage, auch das ohne Rennen - in der Reihenfolge der Teamwertung.
    assert racing["club_teams"] == ["Probe-DarkFriday", "Probe Löwen", "Probe Löwen C"]
    assert racing["drivers"]["g"]["team"] == "Probe-DarkFriday"


@pytest.mark.asyncio
async def test_an_old_season_with_one_team_stays_as_it_was(flow):
    lineage, series = await _racing(flow, teams=[{"name": "Probe Löwen"}])
    flow.act_as(None)
    racing = (await flow.get(f"{PUBLIC}/{lineage['slug']}/{series['season_slug']}")).json()["racing"]
    # Ohne eigenes Team in dieser Schreibweise bleiben die Schreibweisen getrennt - wie bisher.
    assert [(row["team"], row["points"]) for row in racing["teams"]["rows"]] == [
        ("Probe Löwen", 61), ("Fremd Rot", 56), ("probe-darkfriday", 35), ("Probe DarkFriday", 30)]
    assert racing["club_teams"] == ["Probe Löwen"]


@pytest.mark.asyncio
async def test_team_league_place_and_path_use_the_best_own_team(flow):
    await _admin(flow)
    lineage = await _lineage(flow, kind="team_league", title="Probe Liga")
    series = (await flow.post(f"{ADMIN}/series", json={
        "lineage_id": lineage["id"], "season": "2026", "status": "active",
        "own_teams": [{"name": "Probe Löwen"}, {"name": "Probe Löwen B", "aliases": ["PLB"]}]})).json()
    round_id = (await flow.post(f"{ADMIN}/series/{series['id']}/rounds",
                                json={"code": "ST1", "day": "2026-11-05"})).json()["id"]
    await flow.db.reference_round_results.insert_one({
        "id": "blatt-st1", "series_id": series["id"], "round_id": round_id, "status": "published",
        "matches": [{"home": "Fremd Rot", "away": "PLB", "home_score": 1, "away_score": 2, "maps": [], "lineup": []}],
        "official_table": [{"team": "Fremd Rot", "rank": 1, "points": 9}, {"team": "plb", "rank": 2, "points": 6},
                           {"team": "Probe Löwen", "rank": 5, "points": 1}]})
    await flow.db.reference_rounds.update_one({"id": round_id}, {"$set": {"status": "scored"}})
    stored = await flow.db.reference_series.find_one({"id": series["id"]}, {"_id": 0})
    await reference_series.recompute_standings(flow.db, stored)

    flow.act_as(None)
    running = (await flow.get(f"{PUBLIC}/running")).json()
    assert running["items"][0]["club"] == {"rank": 2, "of": 3}
    page = (await flow.get(f"{PUBLIC}/{lineage['slug']}/{series['season_slug']}")).json()["team_league"]
    assert page["own_teams"] == ["Probe Löwen", "Probe Löwen B"]
    assert [(row["team"], row["own"]) for row in page["table"]["rows"]] == [
        ("Fremd Rot", False), ("Probe Löwen B", True), ("Probe Löwen", True)]
    match = page["matchdays"][0]["match"]
    assert (match["team"], match["opponent"], match["home"], match["outcome"]) == ("Probe Löwen B", "Fremd Rot",
                                                                                   False, "win")
    assert page["path"][0]["rank"] == 2
    lineages = (await flow.get(f"{PUBLIC}/lineages")).json()
    assert lineages["items"][0]["seasons"][0]["club"] == {"rank": 2, "of": 3}


@pytest.mark.asyncio
async def test_the_migration_takes_the_old_team_over_once(flow):
    base = {"lineage_id": "spur", "status": "active"}
    await flow.db.reference_series.insert_many([
        {**base, "id": "alt", "team_name": " Probe Löwen "},
        {**base, "id": "liste", "team_name": "Probe Löwen", "own_teams": [{"name": "Probe X", "aliases": []}]},
        {**base, "id": "ohne", "team_name": None},
    ])
    assert await migrations.migrate_series_own_teams(flow.db) == "1 series own teams taken over"
    stored = {item["id"]: item async for item in flow.db.reference_series.find({}, {"_id": 0})}
    assert stored["alt"]["own_teams"] == [{"name": "Probe Löwen", "aliases": []}]
    assert stored["liste"]["own_teams"] == [{"name": "Probe X", "aliases": []}]
    assert "own_teams" not in stored["ohne"]
    assert any(version == 8 for version, _, _ in migrations.MIGRATIONS)


@pytest.mark.asyncio
async def test_a_list_where_an_alias_is_another_own_team_is_refused_with_a_message(flow):
    await _admin(flow)
    lineage = await _lineage(flow)
    clash = [{"name": "Probe Alpha", "aliases": ["Probe Bravo"]}, {"name": "Probe Bravo"}]
    created = await flow.post(f"{ADMIN}/series", json={"lineage_id": lineage["id"], "season": "2026",
                                                       "own_teams": clash})
    assert created.status_code == 422
    assert "„Probe Bravo“ von „Probe Alpha“ ist der Name des eigenen Teams „Probe Bravo“" in created.json()["detail"]
    series = (await flow.post(f"{ADMIN}/series", json={"lineage_id": lineage["id"], "season": "2026",
                                                       "own_teams": clash[1:]})).json()
    patched = await flow.patch(f"{ADMIN}/series/{series['id']}", json={"own_teams": clash})
    assert patched.status_code == 422
    stored = await flow.db.reference_series.find_one({"id": series["id"]}, {"_id": 0})
    assert stored["own_teams"] == [{"name": "Probe Bravo", "aliases": []}]
