"""Seite Team-Liga (#1747) über die echte Route: Tabelle aus dem gespeicherten Stand (eigenes Team markiert, Form aus den
eigenen Spielen), Spielplan mit Gegner, Ergebnis und Maps aus eigener Sicht, Aufstellung (Einsätze je Spieler, Gäste
getrennt, Einsätze über alle Saisons nur für Vereinsmitglieder) und der Liga-Weg über die Saisons der Spur.

Gerechnet wird nur, was schon gespeichert ist - der Rechenkern bleibt unberührt. Fremde Namen nur als Text, ein
ausgeblendeter Name gar nicht; nicht sichtbare Saisons fehlen im Liga-Weg. Nur erfundene Namen."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from routes import reference_round_routes  # noqa: E402
from services import migrations, reference_series  # noqa: E402

ADMIN = "/api/reference-series/admin"
PUBLIC = "/api/reference-series/public"
OWN = "Probe Löwen"
RULES = {"points_mode": "organizer", "match_points": {"win": 2, "draw": 1, "loss": 0},
         "table_tiebreakers": ["score_diff", "wins"]}


@pytest_asyncio.fixture
async def flow(monkeypatch):
    instance, shutdown = make_flow()
    monkeypatch.setattr(reference_round_routes, "club_today", lambda: "2026-11-20")
    try:
        yield instance
    finally:
        await shutdown()


async def _season(flow, lineage, season, codes, **extra):
    series = (await flow.post(f"{ADMIN}/series", json={
        "lineage_id": lineage["id"], "season": season, "rules": RULES, "team_name": OWN, **extra})).json()
    rounds = {}
    for code, day, opponent in codes:
        response = await flow.post(f"{ADMIN}/series/{series['id']}/rounds",
                                   json={"code": code, "day": day, "opponent": opponent})
        assert response.status_code == 200, response.text
        rounds[code] = response.json()["id"]
    return series, rounds


async def _publish(flow, series, round_id, **sheet):
    await flow.db.reference_round_results.insert_one({
        "id": f"blatt-{round_id}", "series_id": series["id"], "round_id": round_id, "status": "published",
        "rows": [], **sheet})
    await flow.db.reference_rounds.update_one({"id": round_id}, {"$set": {"status": "scored"}})


async def _recompute(flow, series):
    await reference_series.recompute_standings(
        flow.db, await flow.db.reference_series.find_one({"id": series["id"]}, {"_id": 0}))


async def _setup(flow):
    await migrations.migrate_points_scheme_templates(flow.db)
    admin = await flow.add_user(role="club_admin", name="vorstand")
    flow.act_as(admin)
    lineage = (await flow.post(f"{ADMIN}/lineages", json={
        "title": "Probe Liga 4vs4", "kind": "team_league", "organizer": "Probe Verband", "label": "4vs4"})).json()
    await flow.db.club_member_profiles.insert_one({"id": "profil-alpha", "slug": "probe-alpha",
                                                   "display_name": "Probe Alpha", "is_active": True})

    # Vorsaison: ein Spiel, Platz 2 von 3 laut Veranstalter.
    old, old_rounds = await _season(flow, lineage, "2025", [("ST1", "2025-11-03", "Fremd Füchse")], tier="Division 2",
                                    status="completed")
    await flow.db.reference_participants.insert_one({
        "id": "alt-alpha", "series_id": old["id"], "name": "Probe Alpha", "link": "member",
        "profile_id": "profil-alpha", "is_club_member": True, "name_hidden": False})
    await _publish(flow, old, old_rounds["ST1"],
                   matches=[{"home": OWN, "away": "Fremd Füchse", "home_score": 1, "away_score": 3, "maps": [],
                             "lineup": ["alt-alpha"]}],
                   official_table=[{"team": "Fremd Füchse", "rank": 1, "points": 6},
                                   {"team": OWN, "rank": 2, "points": 4},
                                   {"team": "Fremd Bären", "rank": 3, "points": 1}])
    await _recompute(flow, old)

    series, rounds = await _season(flow, lineage, "2026", [
        ("ST1", "2026-11-02", "Fremd Füchse"), ("ST2", "2026-11-09", "Fremd Bären"),
        ("ST3", "2026-11-30", "Fremd Adler")], tier="Division 1", status="active")
    people = [
        {"id": "p-alpha", "name": "Probe Alpha", "link": "member", "profile_id": "profil-alpha",
         "is_club_member": True},
        {"id": "p-delta", "name": "Gast Delta", "link": "guest"},
        {"id": "p-gamma", "name": "Fremd Gamma", "link": "external", "name_hidden": True},
    ]
    await flow.db.reference_participants.insert_many([
        {"series_id": series["id"], "is_club_member": False, "name_hidden": False, **person} for person in people])
    await _publish(flow, series, rounds["ST1"], matches=[{
        "home": OWN, "away": "Fremd Füchse", "home_score": 3, "away_score": 1,
        "maps": [{"name": "Karte Nord", "home_score": 6, "away_score": 2},
                 {"name": "Karte Süd", "home_score": 4, "away_score": 6}],
        "lineup": ["p-alpha", "p-delta"]}])
    await _publish(flow, series, rounds["ST2"], matches=[{
        "home": "Fremd Bären", "away": OWN, "home_score": 3, "away_score": 1,
        "maps": [{"name": "Karte West", "home_score": 6, "away_score": 1}],
        "lineup": ["p-alpha", "p-gamma"]}])
    await _recompute(flow, series)
    return admin, lineage, old, series, rounds


def _url(lineage, series):
    return f"{PUBLIC}/{lineage['slug']}/{series['season_slug']}"


@pytest.mark.asyncio
async def test_table_rules_form_and_rank_history(flow):
    _, lineage, _, series, rounds = await _setup(flow)
    flow.act_as(None)
    response = await flow.get(_url(lineage, series))
    assert response.status_code == 200, response.text
    league = response.json()["team_league"]

    assert league["team_name"] == OWN
    assert league["rules"] == {"match_points": {"win": 2, "draw": 1, "loss": 0},
                               "table_tiebreakers": ["score_diff", "wins"]}
    table = league["table"]
    assert table["round_id"] == rounds["ST2"]
    assert [(row["team"], row["rank"], row["points"], row["own"]) for row in table["rows"]] == [
        ("Fremd Bären", 1, 2, False), (OWN, 2, 2, True), ("Fremd Füchse", 3, 0, False)]
    own = table["rows"][1]
    assert (own["played"], own["won"], own["lost"], own["score_for"], own["score_against"], own["score_diff"]) == (
        2, 1, 1, 4, 4, 0)
    assert own["previous_rank"] == 1
    # Form nur fürs eigene Team (die anderen Spiele kennt die Seite nicht), ältestes zuerst.
    assert own["form"] == ["W", "L"] and table["rows"][0]["form"] == []
    assert [(item["round_id"], item["rank"], item["teams"]) for item in league["rank_history"]] == [
        (rounds["ST1"], 1, 2), (rounds["ST2"], 2, 3)]


@pytest.mark.asyncio
async def test_schedule_from_the_own_point_of_view(flow):
    _, lineage, _, series, rounds = await _setup(flow)
    flow.act_as(None)
    days = (await flow.get(_url(lineage, series))).json()["team_league"]["matchdays"]
    assert [day["round"]["code"] for day in days] == ["ST1", "ST2", "ST3"]
    first, second, third = (day["match"] for day in days)
    assert (first["opponent"], first["home"], first["score_for"], first["score_against"], first["outcome"],
            first["points"]) == ("Fremd Füchse", True, 3, 1, "win", 2)
    assert first["maps"] == [{"name": "Karte Nord", "score_for": 6, "score_against": 2, "outcome": "win"},
                             {"name": "Karte Süd", "score_for": 4, "score_against": 6, "outcome": "loss"}]
    assert (second["opponent"], second["home"], second["score_for"], second["score_against"], second["outcome"]) == (
        "Fremd Bären", False, 1, 3, "loss")
    assert second["maps"] == [{"name": "Karte West", "score_for": 1, "score_against": 6, "outcome": "loss"}]
    assert first["lineup_size"] == 2
    assert third is None and days[2]["round"]["opponent"] == "Fremd Adler"


@pytest.mark.asyncio
async def test_lineup_counts_appearances_and_keeps_guests_apart(flow):
    _, lineage, _, series, rounds = await _setup(flow)
    flow.act_as(None)
    response = await flow.get(_url(lineage, series))
    lineup = response.json()["team_league"]["lineup"]
    assert lineup["round_ids"] == [rounds["ST1"], rounds["ST2"]]
    players = {(player["name"] or "-"): player for player in lineup["players"]}
    alpha = players["Probe Alpha"]
    assert (alpha["club_member"], alpha["profile_slug"], alpha["guest"], alpha["appearances"]) == (
        True, "probe-alpha", False, 2)
    assert alpha["round_ids"] == [rounds["ST1"], rounds["ST2"]]
    # Über alle sichtbaren Saisons der Spur - nur für Vereinsmitglieder.
    assert alpha["all_seasons"] == 3
    delta = players["Gast Delta"]
    assert (delta["guest"], delta["club_member"], delta["profile_slug"], delta["all_seasons"]) == (
        True, False, None, None)
    hidden = players["-"]
    assert hidden["name_hidden"] is True and hidden["appearances"] == 1
    assert "Fremd Gamma" not in response.text and "profil-alpha" not in response.text
    # Vereinsmitglieder zuerst, Gäste danach.
    assert lineup["players"][0]["name"] == "Probe Alpha"


@pytest.mark.asyncio
async def test_league_path_over_the_visible_seasons(flow):
    admin, lineage, old, series, _ = await _setup(flow)
    flow.act_as(None)
    path = (await flow.get(_url(lineage, series))).json()["team_league"]["path"]
    assert [(item["season"], item["tier"], item["rank"], item["teams"], item["points"], item["current"])
            for item in path] == [("2025", "Division 2", 2, 3, 4, False), ("2026", "Division 1", 2, 3, 2, True)]
    assert path[0]["season_slug"] == old["season_slug"]

    flow.act_as(admin)
    await flow.patch(f"{ADMIN}/series/{old['id']}", json={"visibility": "members"})
    flow.act_as(None)
    league = (await flow.get(_url(lineage, series))).json()["team_league"]
    assert [item["season"] for item in league["path"]] == ["2026"]
    alpha = next(player for player in league["lineup"]["players"] if player["name"] == "Probe Alpha")
    assert alpha["all_seasons"] == 2


@pytest.mark.asyncio
async def test_other_kinds_and_empty_seasons(flow):
    await migrations.migrate_points_scheme_templates(flow.db)
    admin = await flow.add_user(role="club_admin", name="vorstand")
    flow.act_as(admin)
    cup = (await flow.post(f"{ADMIN}/lineages", json={"title": "Probe Cup", "kind": "series"})).json()
    cup_series = (await flow.post(f"{ADMIN}/series", json={"lineage_id": cup["id"], "season": "2026"})).json()
    league = (await flow.post(f"{ADMIN}/lineages", json={"title": "Probe Leer", "kind": "team_league"})).json()
    empty = (await flow.post(f"{ADMIN}/series", json={"lineage_id": league["id"], "season": "2027"})).json()
    flow.act_as(None)
    assert (await flow.get(_url(cup, cup_series))).json()["team_league"] is None
    body = (await flow.get(_url(league, empty))).json()["team_league"]
    assert body["table"] is None and body["matchdays"] == [] and body["rank_history"] == []
    assert body["lineup"] == {"round_ids": [], "players": []}
    assert [(item["season"], item["rank"], item["current"]) for item in body["path"]] == [("2027", None, True)]
