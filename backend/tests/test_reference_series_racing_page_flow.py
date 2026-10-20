"""Seite Rennliga (#1746) über die echte Route: zur Fahrerwertung der Serienseite kommen bei einer Spur der Art
``racing`` der Umschalter zwischen den Saisons der Spur, die gespeicherte Teamwertung, die Vereinsteams und je Fahrer
das Team (je Rennen und aktuell) sowie die Marke „Gast“.

Gerechnet wird nichts: die Teamwertung ist der gespeicherte Stand (``scope = teams``), das Team je Rennen kommt aus dem
gespeicherten Fahrerstand (Team der Zeile, sonst das Standard-Team). Fremde Namen bleiben reiner Text in den Tabellen,
ein ausgeblendeter Name kommt gar nicht erst mit. Nur erfundene Namen."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from routes import reference_round_routes  # noqa: E402
from services import migrations, reference_series, team_league_page  # noqa: E402

ADMIN = "/api/reference-series/admin"
PUBLIC = "/api/reference-series/public"
RULES = {"points_mode": "scheme", "points_by_place": [25, 18, 15, 12, 10, 8, 6, 4, 2, 1],
         "bonuses": {"fastest_lap": {"points": 1, "max_place": 10}},
         "tiebreakers": ["countback", "latest_result"],
         "team_scoring": {"enabled": True, "counting_drivers": 2, "guests_count": True}}
PEOPLE = [
    {"id": "p-lion1", "name": "Probe Lion Eins", "link": "member", "profile_id": "profil-lion1",
     "is_club_member": True, "default_team": "Probe Löwen"},
    {"id": "p-lion2", "name": "Probe Lion Zwei", "link": "member", "profile_id": "profil-lion2",
     "is_club_member": True, "default_team": "Probe Löwen"},
    {"id": "p-lion3", "name": "Probe Lion Drei", "link": "member", "profile_id": "profil-lion3",
     "is_club_member": True, "default_team": "Probe Löwen B"},
    {"id": "p-guest", "name": "Gast Probe", "link": "guest", "default_team": "Probe Löwen B"},
    {"id": "p-ext1", "name": "Fremd Eins", "link": "external", "default_team": "Fremd Rot", "start_number": "44"},
    {"id": "p-ext2", "name": "Fremd Zwei", "link": "external", "default_team": "Fremd Rot"},
    {"id": "p-hidden", "name": "Fremd Versteckt", "link": "external", "default_team": "Fremd Rot",
     "name_hidden": True},
]
# Platz je Rennen; (Kennung, Marken, Team im Rennen) - ohne Team gilt das Standard-Team.
SHEETS = {
    "R1": [("p-ext1", ["fastest_lap"], None), ("p-lion1", [], "Probe Löwen"), ("p-ext2", [], None),
           ("p-lion2", [], None), ("p-guest", [], None), ("p-lion3", [], None), ("p-hidden", [], None)],
    "R2": [("p-lion1", [], None), ("p-ext1", [], None), ("p-lion3", ["fastest_lap"], "Probe Löwen B"),
           ("p-guest", [], None), ("p-ext2", [], "Fremd Blau"), ("p-hidden", ["dnf"], None),
           ("p-lion2", ["dns"], None)],
}


@pytest_asyncio.fixture
async def flow(monkeypatch):
    instance, shutdown = make_flow()
    monkeypatch.setattr(reference_round_routes, "club_today", lambda: "2026-11-20")
    try:
        yield instance
    finally:
        await shutdown()


async def _series(flow, lineage_id: str, season: str, **extra) -> dict:
    response = await flow.post(f"{ADMIN}/series", json={"lineage_id": lineage_id, "season": season, **extra})
    assert response.status_code == 200, response.text
    return response.json()


async def _setup(flow, rules=RULES, **series_extra):
    await migrations.migrate_points_scheme_templates(flow.db)
    admin = await flow.add_user(role="club_admin", name="vorstand")
    flow.act_as(admin)
    lineage = (await flow.post(f"{ADMIN}/lineages", json={
        "title": "Probe Racing", "kind": "racing", "organizer": "Probe Liga", "label": "F1"})).json()
    series = await _series(flow, lineage["id"], "2026", tier="F1", status="active", rules=rules, **series_extra)
    rounds = {}
    for code, day in (("R1", "2026-11-01"), ("R2", "2026-11-08"), ("R3", "2026-11-29")):
        response = await flow.post(f"{ADMIN}/series/{series['id']}/rounds", json={"code": code, "day": day})
        assert response.status_code == 200, response.text
        rounds[code] = response.json()["id"]
    for number in (1, 2, 3):
        await flow.db.club_member_profiles.insert_one({"id": f"profil-lion{number}", "slug": f"probe-lion-{number}",
                                                       "display_name": f"Probe Lion {number}", "is_active": True})
    await flow.db.reference_participants.insert_many([
        {"series_id": series["id"], "is_club_member": False, "name_hidden": False, **person} for person in PEOPLE])
    for code, order in SHEETS.items():
        rows = []
        for place, (pid, marks, team) in enumerate(order, start=1):
            rows.append({"participant_id": pid, "place": None if "dns" in marks else place, "marks": marks,
                         "team": team})
        await flow.db.reference_round_results.insert_one({
            "id": f"blatt-{code}", "series_id": series["id"], "round_id": rounds[code], "status": "published",
            "rows": rows})
        await flow.db.reference_rounds.update_one({"id": rounds[code]}, {"$set": {"status": "scored"}})
    stored = await flow.db.reference_series.find_one({"id": series["id"]}, {"_id": 0})
    await reference_series.recompute_standings(flow.db, stored)
    return admin, lineage, series, rounds


def _url(lineage, series):
    return f"{PUBLIC}/{lineage['slug']}/{series['season_slug']}"


@pytest.mark.asyncio
async def test_racing_page_has_the_stored_team_standings_with_drivers_per_race(flow):
    _, lineage, series, rounds = await _setup(flow)
    flow.act_as(None)
    response = await flow.get(_url(lineage, series))
    assert response.status_code == 200, response.text
    body = response.json()

    # Die Fahrerwertung bleibt die der Serienseite.
    assert [(row["key"], row["points"]) for row in body["standings"]["rows"]] == [
        ("p-ext1", 44), ("p-lion1", 43), ("p-ext2", 25), ("p-lion3", 24), ("p-guest", 22), ("p-lion2", 12),
        ("p-hidden", 6)]

    racing = body["racing"]
    assert racing["team_scoring"] == {"enabled": True, "counting_drivers": 2, "guests_count": True}
    teams = racing["teams"]
    assert teams["round_id"] == rounds["R2"]
    assert [(row["key"], row["team"], row["rank"], row["points"], row["previous_rank"]) for row in teams["rows"]] == [
        ("Fremd Rot", "Fremd Rot", 1, 59, 1), ("Probe Löwen", "Probe Löwen", 2, 55, 2),
        ("Probe Löwen B", "Probe Löwen B", 3, 46, 3), ("Fremd Blau", "Fremd Blau", 4, 10, None)]
    lions = teams["rows"][1]
    # Je Rennen die gezählten Fahrer (die besten zwei), über die Saison alle Fahrer des Teams nach Punkten.
    assert lions["results"] == [
        {"round_id": rounds["R1"], "points": 30, "drivers": ["p-lion1", "p-lion2"]},
        {"round_id": rounds["R2"], "points": 25, "drivers": ["p-lion1", "p-lion2"]}]
    assert lions["drivers"] == ["p-lion1", "p-lion2"]
    assert teams["rows"][0]["drivers"] == ["p-ext1", "p-ext2", "p-hidden"]
    assert (lions["computed_points"], lions["official_points"], lions["deviation"]) == (55, None, None)

    # Vereinsteams: wo ein Vereinsmitglied zuletzt gefahren ist - in der Reihenfolge der Teamwertung.
    assert racing["club_teams"] == ["Probe Löwen", "Probe Löwen B"]


@pytest.mark.asyncio
async def test_each_driver_has_the_team_per_race_and_guests_are_marked(flow):
    _, lineage, series, rounds = await _setup(flow)
    flow.act_as(None)
    drivers = (await flow.get(_url(lineage, series))).json()["racing"]["drivers"]

    assert drivers["p-ext2"] == {"team": "Fremd Blau", "guest": False,
                                 "round_teams": {rounds["R1"]: "Fremd Rot", rounds["R2"]: "Fremd Blau"}}
    assert drivers["p-guest"]["guest"] is True and drivers["p-guest"]["team"] == "Probe Löwen B"
    # Auch ein Nichtstart fährt für sein Standard-Team.
    assert drivers["p-lion2"]["round_teams"] == {rounds["R1"]: "Probe Löwen", rounds["R2"]: "Probe Löwen"}
    assert set(drivers) == {person["id"] for person in PEOPLE}


@pytest.mark.asyncio
async def test_racing_extras_never_carry_hidden_names_or_link_details(flow):
    _, lineage, series, _ = await _setup(flow)
    flow.act_as(None)
    response = await flow.get(_url(lineage, series))
    racing = response.json()["racing"]

    assert "Fremd Versteckt" not in response.text
    # Vom Fahrer gehen nur Team, Team je Rennen und „Gast“ hinaus - keine Startnummer, kein Profil, keine Verknüpfung.
    for item in racing["drivers"].values():
        assert set(item) == {"team", "guest", "round_teams"}
    assert "profil-lion1" not in response.text and '"44"' not in response.text


@pytest.mark.asyncio
async def test_the_own_team_is_a_club_team_and_without_team_scoring_there_is_no_team_table(flow):
    rules = {**RULES, "team_scoring": {"enabled": False}}
    _, lineage, series, _ = await _setup(flow, rules=rules, team_name="Fremd Blau")
    flow.act_as(None)
    racing = (await flow.get(_url(lineage, series))).json()["racing"]

    assert racing["teams"] is None
    assert racing["team_scoring"]["enabled"] is False
    # Ohne Teamwertung nach Namen; das eigene Team aus der Saison zählt immer dazu.
    assert racing["club_teams"] == ["Fremd Blau", "Probe Löwen", "Probe Löwen B"]


@pytest.mark.asyncio
async def test_the_switcher_lists_the_visible_seasons_of_the_lineage(flow):
    admin, lineage, series, _ = await _setup(flow)
    flow.act_as(admin)
    await _series(flow, lineage["id"], "2025", tier="F1", status="completed")
    await _series(flow, lineage["id"], "2026", tier="F2", status="active", visibility="members")
    old = await _series(flow, lineage["id"], "2024", tier="F1")
    await flow.post(f"{ADMIN}/series/{old['id']}/archive")
    other = (await flow.post(f"{ADMIN}/lineages", json={"title": "Probe Andere", "kind": "racing"})).json()
    await _series(flow, other["id"], "2026")

    flow.act_as(None)
    seasons = (await flow.get(_url(lineage, series))).json()["racing"]["seasons"]
    assert [(item["season"], item["tier"], item["season_slug"], item["status"], item["current"])
            for item in seasons] == [
        ("2026", "F1", series["season_slug"], "active", True), ("2025", "F1", "2025-f1", "completed", False)]
    assert set(seasons[0]) == {"season", "tier", "title", "season_slug", "status", "current"}

    # Wer Mitglieder-Inhalte sieht, sieht auch die Saison „Nur Mitglieder“ - neueste Saison zuerst, darin nach Stufe.
    flow.act_as(admin)
    seasons = (await flow.get(_url(lineage, series))).json()["racing"]["seasons"]
    assert [(item["season"], item["tier"]) for item in seasons] == [("2026", "F1"), ("2026", "F2"), ("2025", "F1")]


@pytest.mark.asyncio
async def test_the_switcher_checks_each_visibility_once_not_each_season(flow, monkeypatch):
    admin, lineage, series, _ = await _setup(flow)
    flow.act_as(admin)
    for season in ("2025", "2024", "2023"):
        await _series(flow, lineage["id"], season, tier="F1")
    await _series(flow, lineage["id"], "2022", tier="F1", visibility="members")
    calls = []
    original = team_league_page.user_can_see

    async def counting(user, visibility, **kwargs):
        calls.append(visibility)
        return await original(user, visibility, **kwargs)

    monkeypatch.setattr(team_league_page, "user_can_see", counting)
    flow.act_as(None)
    seasons = (await flow.get(_url(lineage, series))).json()["racing"]["seasons"]
    assert [item["season"] for item in seasons] == ["2026", "2025", "2024", "2023"]
    assert sorted(calls) == ["members", "public"]


@pytest.mark.asyncio
async def test_other_kinds_carry_no_racing_block(flow):
    await migrations.migrate_points_scheme_templates(flow.db)
    admin = await flow.add_user(role="club_admin", name="vorstand")
    flow.act_as(admin)
    lineage = (await flow.post(f"{ADMIN}/lineages", json={"title": "Probe Cup", "kind": "series"})).json()
    series = await _series(flow, lineage["id"], "2026")
    flow.act_as(None)
    body = (await flow.get(_url(lineage, series))).json()
    assert body["racing"] is None


@pytest.mark.asyncio
async def test_a_racing_season_without_results_has_an_empty_racing_block(flow):
    await migrations.migrate_points_scheme_templates(flow.db)
    admin = await flow.add_user(role="club_admin", name="vorstand")
    flow.act_as(admin)
    lineage = (await flow.post(f"{ADMIN}/lineages", json={"title": "Probe Leer", "kind": "racing"})).json()
    series = await _series(flow, lineage["id"], "2027", points_scheme_id="formula_1")
    flow.act_as(None)
    racing = (await flow.get(_url(lineage, series))).json()["racing"]
    assert racing["teams"] is None and racing["drivers"] == {} and racing["club_teams"] == []
    assert [item["current"] for item in racing["seasons"]] == [True]
