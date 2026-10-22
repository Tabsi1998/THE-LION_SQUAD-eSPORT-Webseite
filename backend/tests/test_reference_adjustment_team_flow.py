"""Fahrer-Anpassung auch in der Teamwertung (#2000) über die echten Routen - nur erfundene Namen.

Vorgabe des Hakens je Saison, Ändern behält ihn, die Verwaltung erfährt das Team bzw. „als Ersatz gefahren“, die
Serienseite zeigt die Anpassung bei der Teamsumme und im Fahrer-Detail.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import migrations, reference_series  # noqa: E402

ADMIN = "/api/reference-series/admin"
PUBLIC = "/api/reference-series/public"
RULES = {"points_mode": "scheme", "points_by_place": [10, 6, 4, 3, 2, 1], "tiebreakers": ["countback"],
         "team_scoring": {"enabled": True, "guests_count": True, "adjustments_count_for_team": True}}
PEOPLE = [
    {"id": "p-anna", "name": "Anna Probe", "link": "external", "default_team": "Team Adler"},
    {"id": "p-bert", "name": "Bert Probe", "link": "external", "default_team": "Team Adler"},
    {"id": "p-carl", "name": "Carl Probe", "link": "external", "default_team": "Team Biber"},
]


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def _season(flow, rules):
    await migrations.migrate_points_scheme_templates(flow.db)
    flow.act_as(await flow.add_user(role="club_admin", name="vorstand"))
    lineage = (await flow.post(f"{ADMIN}/lineages", json={"title": "Probe Racing", "kind": "racing",
                                                          "organizer": "Probe Liga", "label": "F1"})).json()
    series = await flow.post(f"{ADMIN}/series", json={"lineage_id": lineage["id"], "season": "2026",
                                                      "status": "active", "rules": rules})
    assert series.status_code == 200, series.text
    series = series.json()
    rounds = {}
    for number, code in enumerate(("R1", "R2"), start=1):
        response = await flow.post(f"{ADMIN}/series/{series['id']}/rounds",
                                   json={"code": code, "day": f"2026-11-{number:02d}"})
        rounds[code] = response.json()["id"]
    await flow.db.reference_participants.insert_many([
        {"series_id": series["id"], "is_club_member": False, "name_hidden": False, **person} for person in PEOPLE])
    # R1: Anna (Adler) 10, Carl 6, Bert 4. R2: Anna fährt als Ersatz 10, Carl 6, Bert 4.
    for code, anna in (("R1", "Team Adler"), ("R2", "Ersatzfahrer")):
        await flow.db.reference_round_results.insert_one({
            "id": f"blatt-{code}", "series_id": series["id"], "round_id": rounds[code], "status": "published",
            "rows": [{"participant_id": "p-anna", "place": 1, "marks": [], "team": anna},
                     {"participant_id": "p-carl", "place": 2, "marks": [], "team": "Team Biber"},
                     {"participant_id": "p-bert", "place": 3, "marks": [], "team": "Team Adler"}]})
        await flow.db.reference_rounds.update_one({"id": rounds[code]}, {"$set": {"status": "scored"}})
    stored = await flow.db.reference_series.find_one({"id": series["id"]}, {"_id": 0})
    await reference_series.recompute_standings(flow.db, stored)
    return lineage, series, rounds


async def _teams(flow, lineage, series):
    body = (await flow.get(f"{PUBLIC}/{lineage['slug']}/{series['season_slug']}")).json()
    return body, {row["team"]: row for row in body["racing"]["teams"]["rows"]}


@pytest.mark.asyncio
async def test_the_season_default_the_admin_hint_and_the_public_team_table(flow):
    lineage, series, rounds = await _season(flow, RULES)
    url = f"{ADMIN}/series/{series['id']}/adjustments"
    created = await flow.post(url, json={"participant_id": "p-anna", "points": -5, "reason": "Video fehlt",
                                         "day": "2026-11-02", "round_id": rounds["R2"]})
    assert created.status_code == 200, created.text
    item = created.json()["adjustments"][0]
    # Vorgabe der Saison: zählt auch fürs Team.
    assert item["counts_for_team"] is True
    # Im Termin als Ersatz gefahren: für kein Team - die Verwaltung sagt es.
    admin = (await flow.get(f"{ADMIN}/series/{series['id']}")).json()
    assert admin["adjustment_teams"] == {item["id"]: {"team": None, "note": "substitute"}}
    _, teams = await _teams(flow, lineage, series)
    assert (teams["Team Adler"]["points"], teams["Team Adler"]["driver_adjustments"]) == (18, [])

    # Ohne Termin am Tag von R1: Annas letzte Fahrt mit Team war für Adler.
    changed = await flow.patch(f"{url}/{item['id']}", json={"participant_id": "p-anna", "points": -5,
                                                           "reason": "Video fehlt", "day": "2026-11-01"})
    assert changed.status_code == 200, changed.text
    assert changed.json()["adjustments"][0]["counts_for_team"] is True
    admin = (await flow.get(f"{ADMIN}/series/{series['id']}")).json()
    assert admin["adjustment_teams"] == {item["id"]: {"team": "Team Adler", "note": None}}
    body, teams = await _teams(flow, lineage, series)
    adler = teams["Team Adler"]
    assert (adler["points"], adler["driver_adjustment_points"], adler["adjustment_points"]) == (13, -5, 0)
    assert adler["driver_adjustments"] == [{"points": -5, "reason": "Video fehlt", "day": "2026-11-01",
                                            "round_id": None, "counts_for_team": True,
                                            "credited_team": "Team Adler", "driver": "p-anna"}]
    anna = next(row for row in body["standings"]["rows"] if row["key"] == "p-anna")
    assert anna["points"] == 15
    assert anna["adjustments"] == [{"points": -5, "reason": "Video fehlt", "day": "2026-11-01", "round_id": None,
                                    "counts_for_team": True, "credited_team": "Team Adler"}]

    # Haken weg: nur noch die Fahrerwertung.
    off = await flow.patch(f"{url}/{item['id']}", json={"participant_id": "p-anna", "points": -5,
                                                       "reason": "Video fehlt", "day": "2026-11-01",
                                                       "counts_for_team": False})
    assert off.status_code == 200 and off.json()["adjustments"][0]["counts_for_team"] is False
    body, teams = await _teams(flow, lineage, series)
    assert (teams["Team Adler"]["points"], teams["Team Adler"]["driver_adjustments"]) == (18, [])
    assert "counts_for_team" not in next(row for row in body["standings"]["rows"] if row["key"] == "p-anna")[
        "adjustments"][0]
    assert (await flow.get(f"{ADMIN}/series/{series['id']}")).json()["adjustment_teams"] == {}


@pytest.mark.asyncio
async def test_without_a_season_default_new_adjustments_count_for_drivers_only(flow):
    lineage, series, rounds = await _season(flow, {**RULES, "team_scoring": {"enabled": True}})
    created = await flow.post(f"{ADMIN}/series/{series['id']}/adjustments", json={
        "participant_id": "p-anna", "points": -5, "reason": "Video fehlt", "day": "2026-11-01"})
    assert created.status_code == 200, created.text
    assert created.json()["adjustments"][0]["counts_for_team"] is False
    team = await flow.post(f"{ADMIN}/series/{series['id']}/adjustments", json={
        "kind": "team", "team": "Team Biber", "points": -1, "reason": "Korrektur", "day": "2026-11-01",
        "counts_for_team": True})
    assert team.status_code == 200 and team.json()["adjustments"][1]["counts_for_team"] is None
    _, teams = await _teams(flow, lineage, series)
    assert (teams["Team Adler"]["points"], teams["Team Biber"]["points"]) == (18, 11)
