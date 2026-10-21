"""Saison abschließen (#1750) über die echten Routen: Vorschlag mit Endständen, Bestätigung legt die Referenz an oder
aktualisiert die bestehende - die Vitrine zählt sie genau einmal.

- Team: Platz aus der Tabelle (laut Veranstalter, sonst eigener Stand) bzw. der Teamwertung, „von N Teams“; Spieler aus
  den Aufstellungen bzw. den Fahrern des Teams - nur Vereinsmitglieder, keine Gäste, keine ausgeblendeten Namen.
- Einzelwertungen (Fahrer bzw. Gesamtwertung, Finale vor der Gesamtwertung) als Eintrag ``kind: solo``.
- Eine abgebrochene Saison (Status ab #1960) bekommt keine Platzierung.
- Keine Punkte in der Jahreswertung.
Nur erfundene Namen."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from routes import reference_round_routes  # noqa: E402
from services import migrations, reference_series  # noqa: E402

ADMIN = "/api/reference-series/admin"
OWN = "Probe Löwen"
RULES = {"points_mode": "organizer", "match_points": {"win": 2, "draw": 1, "loss": 0},
         "table_tiebreakers": ["score_diff", "wins"]}
OTHERS = ["Fremd Füchse", "Fremd Bären", "Fremd Adler", "Fremd Wölfe", "Fremd Luchse", "Fremd Ottern", "Fremd Dachse"]


@pytest_asyncio.fixture
async def flow(monkeypatch):
    instance, shutdown = make_flow()
    monkeypatch.setattr(reference_round_routes, "club_today", lambda: "2026-11-20")
    try:
        yield instance
    finally:
        await shutdown()


def _close(series):
    return f"{ADMIN}/series/{series['id']}/close"


async def _board(flow):
    await migrations.migrate_points_scheme_templates(flow.db)
    admin = await flow.add_user(role="club_admin", name="vorstand")
    flow.act_as(admin)
    await flow.db.club_member_profiles.insert_many([
        {"id": "profil-alpha", "slug": "probe-alpha", "display_name": "Probe Alpha", "gamertag": "Alpha",
         "is_active": True, "user_id": "nutzer-alpha"},
        {"id": "profil-beta", "slug": "probe-beta", "display_name": "Probe Beta", "is_active": True},
        {"id": "profil-alt", "slug": "probe-alt", "display_name": "Probe Alt", "is_active": False},
    ])
    return admin


async def _team_league(flow, *, status="completed", rank=6):
    """Team-Liga mit zwei Spieltagen; die Tabelle des Veranstalters (8 Teams) setzt das eigene Team auf ``rank``."""
    lineage = (await flow.post(f"{ADMIN}/lineages", json={
        "title": "Probe Liga 4vs4", "kind": "team_league", "organizer": "Probe Verband", "label": "4vs4",
        "game_name": "Probespiel"})).json()
    series = (await flow.post(f"{ADMIN}/series", json={
        "lineage_id": lineage["id"], "season": "Season 3", "tier": "Division 2", "rules": RULES, "team_name": OWN,
        "status": status, "official_table_url": "https://example.test/tabelle"})).json()
    rounds = []
    for code, day in (("ST1", "2026-05-13"), ("ST2", "2026-05-20")):
        response = await flow.post(f"{ADMIN}/series/{series['id']}/rounds", json={"code": code, "day": day})
        assert response.status_code == 200, response.text
        rounds.append(response.json()["id"])
    await flow.db.reference_participants.insert_many([
        {"id": "tl-alpha", "series_id": series["id"], "name": "Alpha", "link": "member", "profile_id": "profil-alpha",
         "is_club_member": True, "name_hidden": False},
        {"id": "tl-beta", "series_id": series["id"], "name": "Beta", "link": "member", "profile_id": "profil-beta",
         "is_club_member": True, "name_hidden": False},
        {"id": "tl-gast", "series_id": series["id"], "name": "Probe Gast", "link": "guest", "is_club_member": False,
         "name_hidden": False},
        {"id": "tl-versteckt", "series_id": series["id"], "name": "Versteckt", "link": "member",
         "profile_id": "profil-alt", "is_club_member": True, "name_hidden": True},
    ])
    table = [{"team": name, "rank": index + (1 if index < rank - 1 else 2), "points": 20 - index}
             for index, name in enumerate(OTHERS)]
    table.append({"team": OWN, "rank": rank, "points": 5})
    lineups = [["tl-alpha", "tl-gast", "tl-versteckt"], ["tl-alpha", "tl-beta"]]
    for round_id, lineup in zip(rounds, lineups):
        await flow.db.reference_round_results.insert_one({
            "id": f"blatt-{round_id}", "series_id": series["id"], "round_id": round_id, "status": "published",
            "rows": [], "matches": [{"home": OWN, "away": "Fremd Füchse", "home_score": 1, "away_score": 3,
                                     "maps": [], "lineup": lineup}],
            "official_table": table})
        await flow.db.reference_rounds.update_one({"id": round_id}, {"$set": {"status": "scored"}})
    await reference_series.recompute_standings(
        flow.db, await flow.db.reference_series.find_one({"id": series["id"]}, {"_id": 0}))
    return lineage, series


async def _racing(flow, *, final=False):
    """Rennliga mit Team- und Fahrerwertung als gespeicherter Stand (zwei Stände - der jüngste zählt)."""
    lineage = (await flow.post(f"{ADMIN}/lineages", json={
        "title": "Probe Racing F1", "kind": "racing", "label": "F1"})).json()
    series = (await flow.post(f"{ADMIN}/series", json={
        "lineage_id": lineage["id"], "season": "2026", "status": "active", "own_teams": [{"name": OWN}]})).json()
    await flow.db.reference_participants.insert_many([
        {"id": "rc-alpha", "series_id": series["id"], "name": "Alpha", "link": "member", "profile_id": "profil-alpha",
         "is_club_member": True, "name_hidden": False, "default_team": OWN},
        {"id": "rc-gast", "series_id": series["id"], "name": "Probe Gast", "link": "guest", "is_club_member": False,
         "name_hidden": False, "default_team": OWN},
        {"id": "rc-fremd", "series_id": series["id"], "name": "Fremd Fahrer", "link": "external",
         "is_club_member": False, "name_hidden": False},
    ])
    drivers = [{"participant_id": f"x{index}", "rank": index} for index in range(1, 13)]
    drivers[2] = {"participant_id": "rc-alpha", "rank": 3, "results": [{"round_id": "r1", "team": None}]}
    drivers[4] = {"participant_id": "rc-gast", "rank": 5, "results": [{"round_id": "r1", "team": OWN}]}
    await flow.db.reference_standings.insert_many([
        {"series_id": series["id"], "round_id": "r0", "round_seq": 1, "scope": "drivers",
         "rows": [{"participant_id": "rc-alpha", "rank": 1}]},
        {"series_id": series["id"], "round_id": "r1", "round_seq": 2, "scope": "drivers", "rows": drivers},
        {"series_id": series["id"], "round_id": "r1", "round_seq": 2, "scope": "teams",
         "rows": [{"team": "Fremd Team", "rank": 1}, {"team": OWN, "rank": 2}, {"team": "Fremd Zwei", "rank": 3},
                  {"team": "Fremd Drei", "rank": 4}, {"team": "Fremd Vier", "rank": 5}]},
    ])
    if final:
        await flow.db.reference_rounds.insert_one({
            "id": "finale", "series_id": series["id"], "kind": "final", "status": "scored", "archived_at": None,
            "club_day": "2026-12-01", "order": 9})
        await flow.db.reference_round_results.insert_one({
            "id": "blatt-finale", "series_id": series["id"], "round_id": "finale", "status": "published",
            "rows": [{"participant_id": "x1", "place": 1}, {"participant_id": "rc-alpha", "place": 2},
                     {"participant_id": "x2", "place": 3}, {"participant_id": "x4", "place": 4}]})
    return lineage, series


@pytest.mark.asyncio
async def test_team_league_proposal_takes_the_organizer_table_and_the_lineup_members(flow):
    await _board(flow)
    lineage, series = await _team_league(flow)
    response = await flow.get(_close(series))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["cancelled"] is False and body["current"] is None and body["target_id"] is None
    assert body["candidates"] == []
    [team] = body["entries"]
    assert team["kind"] == "team" and team["team_name"] == OWN
    assert (team["placement"], team["team_count"], team["participant_count"]) == (6, 8, None)
    assert team["placement_label"] == "Tabelle"
    # Wer in einer Aufstellung stand - nur Vereinsmitglieder, ohne Gast und ohne ausgeblendeten Namen.
    assert team["member_profile_ids"] == ["profil-alpha", "profil-beta"]
    assert [member["name"] for member in team["members"]] == ["Alpha", "Probe Beta"]
    reference = body["reference"]
    assert reference["title"] == "Probe Liga 4vs4" and reference["season"] == "Season 3"
    assert reference["league"] == "Division 2" and reference["format"] == "4vs4"
    assert reference["organizer"] == "Probe Verband" and reference["game_name"] == "Probespiel"
    assert (reference["start_date"], reference["end_date"]) == ("2026-05-13", "2026-05-20")
    assert reference["result_url"] == "https://example.test/tabelle"
    assert "Probe Gast" not in response.text and "Versteckt" not in response.text


@pytest.mark.asyncio
async def test_racing_proposal_has_team_standing_and_member_drivers_as_solo_entries(flow):
    await _board(flow)
    _, series = await _racing(flow)
    body = (await flow.get(_close(series))).json()
    team, solo = body["entries"]
    assert (team["kind"], team["team_name"], team["placement"], team["team_count"]) == ("team", OWN, 2, 5)
    assert team["placement_label"] == "Teamwertung"
    # Das Standard-Team des Fahrers zählt; der Gast fährt mit, zählt aber nicht in die Vereinsstatistik.
    assert team["member_profile_ids"] == ["profil-alpha"]
    assert (solo["kind"], solo["member_profile_ids"], solo["placement"]) == ("solo", ["profil-alpha"], 3)
    assert (solo["participant_count"], solo["team_count"], solo["placement_label"]) == (12, None, "Fahrerwertung")
    assert len(body["entries"]) == 2


@pytest.mark.asyncio
async def test_published_final_decides_the_solo_placement(flow):
    await _board(flow)
    _, series = await _racing(flow, final=True)
    solo = (await flow.get(_close(series))).json()["entries"][1]
    assert (solo["placement"], solo["participant_count"], solo["placement_label"]) == (2, 4, "Finale")


@pytest.mark.asyncio
async def test_confirming_creates_the_reference_once_and_closing_again_updates_it(flow):
    await _board(flow)
    lineage, series = await _team_league(flow, status="active")
    response = await flow.post(_close(series), json={"reference_id": None})
    assert response.status_code == 200, response.text
    first = response.json()
    assert first["created"] is True
    saved = await flow.db.references.find_one({"id": first["reference_id"]}, {"_id": 0})
    assert saved["series_id"] == series["id"] and saved["status"] == "completed"
    assert saved["title"] == "Probe Liga 4vs4" and saved["season"] == "Season 3"
    [entry] = saved["entries"]
    assert (entry["kind"], entry["team_name"], entry["placement"], entry["team_count"]) == ("team", OWN, 6, 8)
    assert [member["profile_id"] for member in entry["lineup_members"]] == ["profil-alpha", "profil-beta"]
    stored = await flow.db.reference_series.find_one({"id": series["id"]}, {"_id": 0})
    assert stored["reference_id"] == first["reference_id"] and stored["status"] == "completed"
    assert stored["closed_by"] and stored["closed_at"]

    # Nach dem Abschluss kennt der Vorschlag die Referenz („Referenz: Platz 6 von 8“).
    preview = (await flow.get(_close(series))).json()
    assert preview["current"] == {"id": first["reference_id"], "title": "Probe Liga 4vs4", "placement": 6, "of": 8,
                                  "label": "Tabelle", "team": True}
    assert preview["target_id"] == first["reference_id"]

    # Erneut abschließen - etwa nach einer Korrektur der Tabelle - aktualisiert dieselbe Referenz.
    await flow.db.reference_standings.update_many(
        {"series_id": series["id"], "scope": "table", "rows.team": OWN}, {"$set": {"rows.$.rank": 4}})
    again = (await flow.post(_close(series), json={"reference_id": None})).json()
    assert again == {**again, "reference_id": first["reference_id"], "created": False}
    assert await flow.db.references.count_documents({}) == 1
    updated = await flow.db.references.find_one({"id": first["reference_id"]}, {"_id": 0})
    assert updated["entries"][0]["placement"] == 4 and updated["entries"][0]["id"] == entry["id"]

    # Die Vitrine zählt die Saison genau einmal.
    flow.act_as(None)
    summary = (await flow.get("/api/references")).json()["summary"]
    assert (summary["total"], summary["entries"], summary["podiums"]) == (1, 1, 0)


@pytest.mark.asyncio
async def test_existing_season_reference_is_proposed_and_updated_instead_of_doubled(flow):
    await _board(flow)
    _, series = await _team_league(flow)
    old = (await flow.post("/api/references", json={
        "title": "DeSBL Season 3 (alt)", "series_id": series["id"], "description": "Bericht von Hand",
        "entries": [{"kind": "team", "team_name": OWN, "lineup": ["Probe Gast"], "placement": 7,
                     "placement_label": "Endstand"}]})).json()
    preview = (await flow.get(_close(series))).json()
    assert [item["id"] for item in preview["candidates"]] == [old["id"]]
    assert preview["target_id"] == old["id"]

    result = (await flow.post(_close(series), json={"reference_id": old["id"]})).json()
    assert result == {**result, "reference_id": old["id"], "created": False}
    assert await flow.db.references.count_documents({}) == 1
    saved = await flow.db.references.find_one({"id": old["id"]}, {"_id": 0})
    # Der Endplatz kommt aus der Saison, Text und Handeingaben bleiben.
    assert saved["title"] == "DeSBL Season 3 (alt)" and saved["description"] == "Bericht von Hand"
    [entry] = saved["entries"]
    assert (entry["placement"], entry["team_count"], entry["placement_label"]) == (6, 8, "Endstand")
    assert entry["lineup"] == ["Probe Gast"] and entry["member_profile_ids"] == ["profil-alpha", "profil-beta"]
    assert (await flow.db.reference_series.find_one({"id": series["id"]}))["reference_id"] == old["id"]


@pytest.mark.asyncio
async def test_a_reference_of_another_season_cannot_be_the_target(flow):
    await _board(flow)
    _, series = await _team_league(flow)
    stranger = (await flow.post("/api/references", json={
        "title": "Fremder Cup", "entries": [{"kind": "team", "team_name": OWN, "placement": 1}]})).json()
    response = await flow.post(_close(series), json={"reference_id": stranger["id"]})
    assert response.status_code == 422, response.text
    assert await flow.db.references.count_documents({"series_id": series["id"]}) == 0


@pytest.mark.asyncio
async def test_cancelled_season_gets_no_placement(flow):
    """#1960 bringt den Status „abgebrochen“ - der Abschluss ist darauf schon vorbereitet."""
    await _board(flow)
    _, series = await _racing(flow)
    await flow.db.reference_series.update_one({"id": series["id"]}, {"$set": {"status": "cancelled"}})
    body = (await flow.get(_close(series))).json()
    assert body["cancelled"] is True
    assert [entry["placement"] for entry in body["entries"]] == [None, None]
    assert {entry["placement_label"] for entry in body["entries"]} == {"Saison abgebrochen"}
    result = (await flow.post(_close(series), json={"reference_id": None})).json()
    saved = await flow.db.references.find_one({"id": result["reference_id"]}, {"_id": 0})
    assert saved["placement"] is None and all(entry["placement"] is None for entry in saved["entries"])
    assert (await flow.db.reference_series.find_one({"id": series["id"]}))["status"] == "cancelled"


@pytest.mark.asyncio
async def test_closing_is_for_the_board_only_and_gives_no_annual_ranking_points(flow):
    await _board(flow)
    _, series = await _racing(flow)
    flow.act_as(await flow.add_user(role="user", name="mitglied"))
    assert (await flow.get(_close(series))).status_code == 403
    assert (await flow.post(_close(series), json={"reference_id": None})).status_code == 403
    flow.act_as(await flow.add_user(role="club_admin", name="vorstand-zwei"))
    assert (await flow.post(_close(series), json={"reference_id": None})).status_code == 200
    # Jahreswertung: nur Abzeichen, keine Punkte (Entscheidung des Obmanns).
    assert await flow.db.season_points.count_documents({}) == 0
    queued = await flow.db.achievement_eval_queue.find_one({"user_id": "nutzer-alpha"}, {"_id": 0})
    assert queued and "club" in queued.get("sources", [])
    assert (await flow.get(f"{ADMIN}/series/gibt-es-nicht/close")).status_code == 404
    assert (await flow.post(f"{ADMIN}/series/gibt-es-nicht/close", json={})).status_code == 404
