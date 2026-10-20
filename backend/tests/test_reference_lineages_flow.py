"""Serien und Ligen auf der Referenzen-Übersicht (#1878) über die echte Route
``GET /api/reference-series/public/lineages``:
je sichtbarer Spur ihre sichtbaren Saisons (Saison, Stufe, Status, unser Platz) - der Liga-Weg. Gesammelt geladen, nie
je Spur oder Saison; Sichtbarkeit wie die übrigen öffentlichen Serien-Endpunkte; keine fremden Namen.
Nur erfundene Namen."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from routes import reference_round_routes, reference_series_public_routes  # noqa: E402
from services import migrations  # noqa: E402

ADMIN = "/api/reference-series/admin"
LINEAGES = "/api/reference-series/public/lineages"
OWN = "Probe Löwen"


@pytest_asyncio.fixture
async def flow(monkeypatch):
    instance, shutdown = make_flow()
    monkeypatch.setattr(reference_round_routes, "club_today", lambda: "2026-11-09")
    monkeypatch.setattr(reference_series_public_routes, "club_today", lambda: "2026-11-09")
    try:
        yield instance
    finally:
        await shutdown()


async def _lineage(flow, title, kind, **extra):
    response = await flow.post(f"{ADMIN}/lineages", json={
        "title": title, "kind": kind, "game_name": "Probespiel", **extra})
    assert response.status_code == 200, response.text
    return response.json()


async def _series(flow, lineage, season, *, status="completed", visibility="public", **extra):
    response = await flow.post(f"{ADMIN}/series", json={
        "lineage_id": lineage["id"], "season": season, "status": status, "visibility": visibility, **extra})
    assert response.status_code == 200, response.text
    return response.json()


async def _standing(flow, series, seq, scope, rows):
    await flow.db.reference_standings.insert_one({
        "series_id": series["id"], "round_id": f"runde-{series['id']}-{seq}", "round_seq": seq, "scope": scope,
        "rows": rows})


async def _setup(flow):
    await migrations.migrate_points_scheme_templates(flow.db)
    admin = await flow.add_user(role="club_admin", name="vorstand")
    flow.act_as(admin)
    await flow.db.club_member_profiles.insert_one(
        {"id": "profil-a", "slug": "probe-a", "display_name": "Probe Alpha", "is_active": True})
    cup = await _lineage(flow, "Probe Monatscup", "series", organizer="Probe Verband")
    early = await _series(flow, cup, "2024", tier="Liga 2")
    middle = await _series(flow, cup, "2025", tier="Liga 1")
    current = await _series(flow, cup, "2026", tier="Liga 1", status="active")
    for series in (early, middle, current):
        await flow.db.reference_participants.insert_many([
            {"id": f"alpha-{series['id']}", "series_id": series["id"], "name": "Probe Alpha", "link": "member",
             "profile_id": "profil-a", "is_club_member": True, "name_hidden": False},
            {"id": f"fremd-{series['id']}", "series_id": series["id"], "name": "Fremd Beta", "link": "external",
             "is_club_member": False, "name_hidden": False},
        ])
    await _standing(flow, early, 1, "drivers", [
        {"participant_id": f"fremd-{early['id']}", "rank": 1}, {"participant_id": "x1", "rank": 2},
        {"participant_id": "x2", "rank": 3}, {"participant_id": f"alpha-{early['id']}", "rank": 4}])
    await _standing(flow, middle, 1, "drivers", [
        {"participant_id": f"alpha-{middle['id']}", "rank": 1}, {"participant_id": f"fremd-{middle['id']}", "rank": 2}])
    # Zwei Stände der laufenden Saison: der jüngste zählt.
    await _standing(flow, current, 1, "drivers", [
        {"participant_id": f"fremd-{current['id']}", "rank": 1}, {"participant_id": "x3", "rank": 2},
        {"participant_id": f"alpha-{current['id']}", "rank": 3}])
    await _standing(flow, current, 2, "drivers", [
        {"participant_id": f"fremd-{current['id']}", "rank": 1},
        {"participant_id": f"alpha-{current['id']}", "rank": 2}, {"participant_id": "x3", "rank": 3}])

    league = await _lineage(flow, "Probe Liga 4vs4", "team_league", label="4vs4")
    before = await _series(flow, league, "2025", tier="Division 3", team_name=OWN)
    await _series(flow, league, "2026", tier="Division 2", status="active", team_name=OWN)
    await _standing(flow, before, 1, "table", [
        {"team": "Fremd Füchse", "rank": 1}, {"team": OWN, "rank": 2}, {"team": "Fremd Bären", "rank": 3}])
    return admin, cup, (early, middle, current), league


@pytest.mark.asyncio
async def test_lineages_list_the_visible_seasons_with_tier_status_and_our_place(flow):
    admin, cup, (early, middle, current), _ = await _setup(flow)
    champion = (await flow.post("/api/references", json={
        "title": "Probe Monatscup 2025", "series_id": middle["id"],
        "entries": [{"kind": "solo", "lineup": ["Probe Alpha"], "placement": 1}]})).json()
    flow.act_as(None)
    response = await flow.get(LINEAGES)
    assert response.status_code == 200, response.text
    body = response.json()
    by_title = {item["lineage"]["title"]: item for item in body["items"]}
    assert sorted(by_title) == ["Probe Liga 4vs4", "Probe Monatscup"]

    cup_item = by_title["Probe Monatscup"]
    assert cup_item["lineage"]["slug"] == cup["slug"] and cup_item["lineage"]["kind"] == "series"
    assert cup_item["lineage"]["organizer"] == "Probe Verband" and cup_item["lineage"]["game_name"] == "Probespiel"
    seasons = cup_item["seasons"]
    assert [(item["season"], item["tier"], item["status"]) for item in seasons] == [
        ("2024", "Liga 2", "completed"), ("2025", "Liga 1", "completed"), ("2026", "Liga 1", "active")]
    assert [item["club"] for item in seasons] == [{"rank": 4, "of": 4}, {"rank": 1, "of": 2}, {"rank": 2, "of": 3}]
    assert [item["season_slug"] for item in seasons] == [
        early["season_slug"], middle["season_slug"], current["season_slug"]]
    assert seasons[1]["reference_ids"] == [champion["id"]] and seasons[0]["reference_ids"] == []

    league_item = by_title["Probe Liga 4vs4"]
    assert [(item["tier"], item["club"]) for item in league_item["seasons"]] == [
        ("Division 3", {"rank": 2, "of": 3}), ("Division 2", None)]
    # Fremde Namen kommen nicht mit - weder Fahrer noch Teams; das eigene Team auch nicht.
    for name in ("Fremd Beta", "Fremd Füchse", "Fremd Bären", "Probe Alpha", OWN):
        assert name not in response.text


@pytest.mark.asyncio
async def test_lineages_hide_archived_and_hidden_lineages_seasons_and_references(flow):
    admin, cup, (early, middle, current), league = await _setup(flow)
    hidden = await _lineage(flow, "Nur Mitglieder", "series", visibility="members")
    await _series(flow, hidden, "2026", status="active")
    gone = await _lineage(flow, "Archiviert", "series")
    await _series(flow, gone, "2026", status="active")
    assert (await flow.post(f"{ADMIN}/lineages/{gone['id']}/archive")).status_code == 200
    members_only = await _lineage(flow, "Saison nur intern", "series")
    await _series(flow, members_only, "2026", status="active", visibility="internal")
    await _series(flow, cup, "2027", status="planned", visibility="members")
    assert (await flow.post(f"{ADMIN}/series/{early['id']}/archive")).status_code == 200
    secret = (await flow.post("/api/references", json={
        "title": "Intern", "series_id": middle["id"], "visibility": "members",
        "entries": [{"kind": "solo", "lineup": ["Probe Alpha"], "placement": 1}]})).json()

    flow.act_as(None)
    response = await flow.get(LINEAGES)
    items = response.json()["items"]
    assert sorted(item["lineage"]["title"] for item in items) == ["Probe Liga 4vs4", "Probe Monatscup"]
    cup_item = next(item for item in items if item["lineage"]["title"] == "Probe Monatscup")
    assert [item["season"] for item in cup_item["seasons"]] == ["2025", "2026"]
    assert secret["id"] not in response.text

    # Wer Mitglieder-Inhalte sehen darf, sieht auch die Mitglieder-Spur und -Saison.
    flow.act_as(admin)
    titles = [item["lineage"]["title"] for item in (await flow.get(LINEAGES)).json()["items"]]
    assert "Nur Mitglieder" in titles and "Archiviert" not in titles


@pytest.mark.asyncio
async def test_lineages_sort_seasons_naturally_and_follow_the_admin_order(flow):
    await migrations.migrate_points_scheme_templates(flow.db)
    admin = await flow.add_user(role="club_admin", name="vorstand")
    flow.act_as(admin)
    second = await _lineage(flow, "B Serie", "series", order_index=2)
    first = await _lineage(flow, "Z Serie", "series", order_index=1)
    for season in ("Saison 10", "Saison 2", "Saison 1"):
        await _series(flow, second, season)
    await _series(flow, first, "2026")
    flow.act_as(None)
    items = (await flow.get(LINEAGES)).json()["items"]
    assert [item["lineage"]["title"] for item in items] == ["Z Serie", "B Serie"]
    assert [item["season"] for item in items[1]["seasons"]] == ["Saison 1", "Saison 2", "Saison 10"]


@pytest.mark.asyncio
async def test_lineages_are_empty_without_series(flow):
    flow.act_as(None)
    response = await flow.get(LINEAGES)
    assert response.status_code == 200
    assert response.json()["items"] == []


class _CountingCollection:
    def __init__(self, collection, name, calls):
        self._collection, self._name, self._calls = collection, name, calls

    def __getattr__(self, attribute):
        target = getattr(self._collection, attribute)
        if attribute not in ("find", "find_one", "aggregate", "count_documents", "distinct"):
            return target

        def counted(*args, **kwargs):
            self._calls.append((self._name, attribute))
            return target(*args, **kwargs)
        return counted


class _CountingDb:
    def __init__(self, db, calls):
        self._db, self._calls = db, calls

    def __getattr__(self, name):
        return _CountingCollection(getattr(self._db, name), name, self._calls)


@pytest.mark.asyncio
async def test_lineages_load_in_a_fixed_number_of_queries(flow, monkeypatch):
    """Keine Abfrage je Spur oder Saison: drei Spuren mit je drei Saisons kosten so viele Abfragen wie eine."""
    await migrations.migrate_points_scheme_templates(flow.db)
    admin = await flow.add_user(role="club_admin", name="vorstand")
    flow.act_as(admin)
    one = await _lineage(flow, "Probe Eins", "series")
    await _series(flow, one, "2026", status="active")
    calls: list = []
    monkeypatch.setattr(reference_series_public_routes, "get_db", lambda: _CountingDb(flow.db, calls))
    flow.act_as(None)
    assert (await flow.get(LINEAGES)).status_code == 200
    small = len(calls)

    flow.act_as(admin)
    for number in range(3):
        lineage = await _lineage(flow, f"Probe Viele {number}", "team_league", game_name=None)
        for season in ("2024", "2025", "2026"):
            await _series(flow, lineage, season, team_name=OWN)
    calls.clear()
    flow.act_as(None)
    assert len((await flow.get(LINEAGES)).json()["items"]) == 4
    assert len(calls) == small, calls
