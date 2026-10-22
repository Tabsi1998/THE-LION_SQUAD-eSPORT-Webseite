"""Referenzen bündeln (#1751) über die echten Routen: der Assistent schlägt aus noch nicht verknüpften Referenzen Gruppen
vor (Veranstalter bzw. Partner, Spiel, Modus, Bezeichnung; Saison aus Feld, Titel oder Datum), die Bestätigung legt
Spur und Saisons an bzw. wählt vorhandene, setzt ``series_id`` unter den Sperren von #1970 und protokolliert die Zahl.
Rückgängig löst die Verknüpfung und entfernt unverändert leer angelegte Saisons und Spuren. Die Referenzen bleiben unter
derselben Adresse abrufbar. Nur der Vorstand darf bündeln, ein Captain nicht; doppelt bündeln geht nicht.
Nur erfundene Namen und Daten."""
import pathlib
import sys
from datetime import date, timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import migrations  # noqa: E402
from services.dolibarr_policy import club_today  # noqa: E402

ADMIN = "/api/reference-series/admin"
BUNDLES = f"{ADMIN}/bundles"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def _ref(rid, title, *, start=None, season=None, league=None, placement=None, visibility="public", organizer="Probe Verband",
         game="Probespiel", fmt=None, team="Probe Löwen", **extra):
    entries = [{"id": f"e-{rid}", "kind": "team", "team_name": team, "member_profile_ids": [], "placement": placement,
                "team_count": 8}] if placement else []
    return {"id": rid, "title": title, "organizer": organizer, "game_name": game, "league": league, "season": season,
            "format": fmt, "start_date": start, "end_date": start, "entries": entries, "placement": placement,
            "visibility": visibility, "status": "completed", "is_active": True, "partner_ids": [],
            "created_at": "2025-01-01T00:00:00+00:00", "updated_at": "2025-01-01T00:00:00+00:00", **extra}


async def _board(flow):
    await migrations.migrate_points_scheme_templates(flow.db)
    board = await flow.add_user(role="user", name="vorstand-vera")
    await flow.db.users.update_one({"id": board["id"]}, {"$set": {"areas": ["content"]}})
    board["areas"] = ["content"]
    flow.act_as(board)
    return board


async def _legacy(flow):
    """Zwei Saisons einer Probe-Liga (4vs4), dazu eine 2vs2-Teilnahme, ein fremder Cup und eine schon verknüpfte."""
    await flow.db.references.insert_many([
        _ref("ref-s1", "Probe Liga 4vs4 Season 1", start="2024-03-10", league="Division 3", placement=2),
        _ref("ref-s2", "Probe Liga 4vs4 – Season 2", start="2024-09-15", league="Division 2", placement=1),
        _ref("ref-2v2", "Probe Liga 2vs2 Season 1", start="2024-04-01", placement=5),
        _ref("ref-cup", "Fremd Cup 4vs4", start="2024-05-01", organizer="Fremd Verband", placement=3),
        _ref("ref-linked", "Probe Liga 4vs4 Season 0", start="2023-09-01", placement=4, series_id="alte-saison"),
    ])


async def _proposals(flow):
    response = await flow.get(f"{BUNDLES}/proposals")
    assert response.status_code == 200, response.text
    return response.json()


def _group(body, *reference_ids):
    for group in body["groups"]:
        if sorted(ref["id"] for ref in group["references"]) == sorted(reference_ids):
            return group
    raise AssertionError(f"keine Gruppe mit {reference_ids}: {body['groups']}")


# ---------------------------------------------------------------- Vorschlag
@pytest.mark.asyncio
async def test_the_assistant_groups_unlinked_references_by_organizer_game_mode_and_label(flow):
    await _board(flow)
    await _legacy(flow)
    body = await _proposals(flow)
    assert len(body["groups"]) == 1
    group = _group(body, "ref-s1", "ref-s2")
    lineage = group["lineage"]
    assert lineage["id"] is None and lineage["title"] == "Probe Liga"
    assert (lineage["organizer"], lineage["label"], lineage["game_name"]) == ("Probe Verband", "4vs4", "Probespiel")
    assert lineage["kind"] == "team_league"
    seasons = group["seasons"]
    assert [(item["season"], item["tier"], item["id"]) for item in seasons] == [
        ("Season 1", "Division 3", None), ("Season 2", "Division 2", None)]
    assert [item["reference_ids"] for item in seasons] == [["ref-s1"], ["ref-s2"]]
    # Der Liga-Weg der Vorschau trägt nur, was die Referenzen haben: ihren Platz.
    assert [item["club"]["rank"] for item in seasons] == [2, 1]
    assert group["hints"] == []


@pytest.mark.asyncio
async def test_an_existing_lineage_and_season_are_chosen_instead_of_new_ones(flow):
    await _board(flow)
    await _legacy(flow)
    lineage = (await flow.post(f"{ADMIN}/lineages", json={
        "title": "Probe Liga 4vs4", "kind": "team_league", "organizer": "Probe Verband", "label": "4vs4",
        "game_name": "Probespiel"})).json()
    season = (await flow.post(f"{ADMIN}/series", json={
        "lineage_id": lineage["id"], "season": "Season 2", "tier": "Division 2"})).json()
    group = _group(await _proposals(flow), "ref-s1", "ref-s2")
    assert group["lineage"]["id"] == lineage["id"]
    assert [item["id"] for item in group["seasons"]] == [None, season["id"]]


@pytest.mark.asyncio
async def test_the_check_reports_missing_dates_duplicates_and_conflicting_placements(flow):
    await _board(flow)
    await flow.db.references.insert_many([
        _ref("ref-a", "Probe Liga 4vs4 Season 1", start="2024-03-10", placement=2),
        _ref("ref-b", "Probe Liga 4vs4 Season 1", start="2024-03-12", placement=4),
        _ref("ref-c", "Probe Liga 4vs4 Season 2", placement=1),
    ])
    group = _group(await _proposals(flow), "ref-a", "ref-b", "ref-c")
    codes = sorted((hint["code"], tuple(sorted(hint["reference_ids"]))) for hint in group["hints"])
    assert codes == [("duplicate", ("ref-a", "ref-b")), ("missing_date", ("ref-c",)),
                     ("placement_conflict", ("ref-a", "ref-b"))]
    assert all(hint["text"] for hint in group["hints"])


# ---------------------------------------------------------------- Bestätigen
@pytest.mark.asyncio
async def test_confirming_creates_lineage_and_seasons_links_the_references_and_logs_the_count(flow):
    board = await _board(flow)
    await _legacy(flow)
    group = _group(await _proposals(flow), "ref-s1", "ref-s2")
    response = await flow.post(BUNDLES, json={"group_key": group["key"], "reference_ids": ["ref-s1", "ref-s2"]})
    assert response.status_code == 200, response.text
    bundle = response.json()
    assert bundle["linked"] == 2 and bundle["lineage_created"] is True and len(bundle["series_created"]) == 2
    lineage = await flow.db.reference_lineages.find_one({"id": bundle["lineage_id"]}, {"_id": 0})
    assert (lineage["title"], lineage["kind"], lineage["visibility"]) == ("Probe Liga", "team_league", "public")
    seasons = {item["id"]: item async for item in flow.db.reference_series.find({"lineage_id": lineage["id"]}, {"_id": 0})}
    refs = {item["id"]: item async for item in flow.db.references.find({"id": {"$in": ["ref-s1", "ref-s2"]}}, {"_id": 0})}
    for rid in ("ref-s1", "ref-s2"):
        season = seasons[refs[rid]["series_id"]]
        assert season["reference_id"] == rid
        # Nichts erfunden: keine Termine, Ergebnisblätter oder Stände - nur das eigene Team aus der Referenz.
        assert [team["name"] for team in season["own_teams"]] == ["Probe Löwen"]
    assert await flow.db.reference_rounds.count_documents({}) == 0
    assert await flow.db.reference_round_results.count_documents({}) == 0
    assert await flow.db.reference_standings.count_documents({}) == 0
    log = await flow.db.audit_logs.find_one({"action": "reference_series.bundle"}, {"_id": 0})
    assert log["actor_id"] == board["id"] and log["data"]["count"] == 2 and log["target_id"] == bundle["id"]
    # Der Liga-Weg der Übersicht zeigt die gebündelte Spur mit dem Platz aus der Referenz.
    items = (await flow.get("/api/reference-series/public/lineages")).json()["items"]
    [item] = items
    assert [(step["season"], step["club"]["rank"], step["reference_ids"]) for step in item["seasons"]] == [
        ("Season 1", 2, ["ref-s1"]), ("Season 2", 1, ["ref-s2"])]


@pytest.mark.asyncio
async def test_bundling_never_opens_visibility_and_follows_a_stricter_existing_lineage(flow):
    await _board(flow)
    await _legacy(flow)
    await flow.db.references.update_one({"id": "ref-s2"}, {"$set": {"visibility": "members"}})
    group = _group(await _proposals(flow), "ref-s1", "ref-s2")
    # Neu angelegt: die Saison so streng wie ihre Referenz, die Spur nicht strenger als die offenste.
    assert [item["visibility"] for item in group["seasons"]] == ["public", "members"]
    assert group["lineage"]["visibility"] == "public"
    bundle = (await flow.post(BUNDLES, json={"group_key": group["key"], "reference_ids": ["ref-s1", "ref-s2"]})).json()
    visibilities = {item["id"]: item["visibility"] async for item in flow.db.references.find({}, {"_id": 0})}
    assert (visibilities["ref-s1"], visibilities["ref-s2"]) == ("public", "members")
    # Gast sieht die öffentliche Saison, die Mitglieder-Saison nicht.
    flow.act_as(None)
    [item] = (await flow.get("/api/reference-series/public/lineages")).json()["items"]
    assert [step["season"] for step in item["seasons"]] == ["Season 1"]
    assert bundle["linked"] == 2


@pytest.mark.asyncio
async def test_a_stricter_existing_lineage_tightens_the_linked_reference_and_says_so(flow):
    await _board(flow)
    await _legacy(flow)
    lineage = (await flow.post(f"{ADMIN}/lineages", json={
        "title": "Probe Liga 4vs4", "kind": "team_league", "organizer": "Probe Verband", "label": "4vs4",
        "game_name": "Probespiel", "visibility": "members"})).json()
    group = _group(await _proposals(flow), "ref-s1", "ref-s2")
    assert group["lineage"]["id"] == lineage["id"]
    assert {hint["code"] for hint in group["hints"]} == {"tightened"}
    bundle = (await flow.post(BUNDLES, json={"group_key": group["key"], "reference_ids": ["ref-s1", "ref-s2"]})).json()
    assert bundle["lineage_created"] is False
    refs = {item["id"]: item async for item in flow.db.references.find({"id": {"$in": ["ref-s1", "ref-s2"]}}, {"_id": 0})}
    assert {ref["visibility"] for ref in refs.values()} == {"members"}
    log = await flow.db.audit_logs.find_one({"action": "reference_series.bundle"}, {"_id": 0})
    assert sorted(log["data"]["tightened"]) == ["ref-s1", "ref-s2"]


@pytest.mark.asyncio
async def test_a_reference_can_only_be_bundled_once(flow):
    await _board(flow)
    await _legacy(flow)
    group = _group(await _proposals(flow), "ref-s1", "ref-s2")
    first = await flow.post(BUNDLES, json={"group_key": group["key"], "reference_ids": ["ref-s1", "ref-s2"]})
    assert first.status_code == 200, first.text
    again = await flow.post(BUNDLES, json={"group_key": group["key"], "reference_ids": ["ref-s1", "ref-s2"]})
    assert again.status_code == 409
    assert (await _proposals(flow))["groups"] == []
    assert await flow.db.reference_lineages.count_documents({}) == 1
    assert await flow.db.audit_logs.count_documents({"action": "reference_series.bundle"}) == 1


@pytest.mark.asyncio
async def test_only_references_of_the_group_can_be_bundled(flow):
    await _board(flow)
    await _legacy(flow)
    group = _group(await _proposals(flow), "ref-s1", "ref-s2")
    response = await flow.post(BUNDLES, json={"group_key": group["key"], "reference_ids": ["ref-s1", "ref-cup"]})
    assert response.status_code == 409
    assert await flow.db.reference_lineages.count_documents({}) == 0


@pytest.mark.asyncio
async def test_a_captain_may_not_bundle(flow):
    await _board(flow)
    await _legacy(flow)
    group = _group(await _proposals(flow), "ref-s1", "ref-s2")
    lineage = (await flow.post(f"{ADMIN}/lineages", json={"title": "Probe Racing F1", "kind": "racing"})).json()
    series = (await flow.post(f"{ADMIN}/series", json={"lineage_id": lineage["id"], "season": "2026"})).json()
    captain = await flow.add_user(name="captain-carla")
    await flow.db.memberships.update_one({"user_id": captain["id"]},
                                         {"$set": {"user_id": captain["id"], "member_status": "active"}}, upsert=True)
    until = (date.fromisoformat(club_today()) + timedelta(days=30)).isoformat()
    added = await flow.post(f"{ADMIN}/series/{series['id']}/staff", json={"user_id": captain["id"], "valid_until": until})
    assert added.status_code == 200, added.text
    flow.act_as(captain)
    assert (await flow.get(f"{BUNDLES}/proposals")).status_code == 403
    denied = await flow.post(BUNDLES, json={"group_key": group["key"], "reference_ids": ["ref-s1", "ref-s2"]})
    assert denied.status_code == 403
    assert (await flow.get(BUNDLES)).status_code == 403
    assert await flow.db.references.count_documents({"series_id": {"$nin": [None, "alte-saison"]}}) == 0


# ---------------------------------------------------------------- Rückgängig
@pytest.mark.asyncio
async def test_undo_unlinks_and_removes_the_untouched_lineage_and_seasons(flow):
    board = await _board(flow)
    await _legacy(flow)
    before = {item["id"]: item async for item in flow.db.references.find({}, {"_id": 0})}
    group = _group(await _proposals(flow), "ref-s1", "ref-s2")
    bundle = (await flow.post(BUNDLES, json={"group_key": group["key"], "reference_ids": ["ref-s1", "ref-s2"]})).json()
    listed = (await flow.get(BUNDLES)).json()["items"]
    assert [(item["id"], item["status"], item["linked"]) for item in listed] == [(bundle["id"], "active", 2)]

    response = await flow.post(f"{BUNDLES}/{bundle['id']}/undo")
    assert response.status_code == 200, response.text
    result = response.json()
    assert (result["unlinked"], result["series_removed"], result["lineage_removed"]) == (2, 2, True)
    assert await flow.db.reference_lineages.count_documents({}) == 0
    assert await flow.db.reference_series.count_documents({}) == 0
    after = {item["id"]: item async for item in flow.db.references.find({}, {"_id": 0})}
    for rid in ("ref-s1", "ref-s2"):
        assert after[rid].get("series_id") is None
        assert {k: v for k, v in after[rid].items() if k not in ("series_id", "updated_at")} == \
            {k: v for k, v in before[rid].items() if k not in ("series_id", "updated_at")}
    log = await flow.db.audit_logs.find_one({"action": "reference_series.bundle_undo"}, {"_id": 0})
    assert log["actor_id"] == board["id"] and log["data"]["count"] == 2
    assert (await flow.post(f"{BUNDLES}/{bundle['id']}/undo")).status_code == 409
    # Danach lässt sich wieder bündeln.
    assert len((await _proposals(flow))["groups"]) == 1


@pytest.mark.asyncio
async def test_undo_keeps_seasons_changed_since_and_restores_tightened_visibility(flow):
    await _board(flow)
    await _legacy(flow)
    group = _group(await _proposals(flow), "ref-s1", "ref-s2")
    bundle = (await flow.post(BUNDLES, json={"group_key": group["key"], "reference_ids": ["ref-s1", "ref-s2"]})).json()
    changed = (await flow.db.references.find_one({"id": "ref-s2"}, {"_id": 0}))["series_id"]
    edited = await flow.patch(f"{ADMIN}/series/{changed}", json={"description": "Von Hand ergänzt"})
    assert edited.status_code == 200, edited.text
    result = (await flow.post(f"{BUNDLES}/{bundle['id']}/undo")).json()
    assert (result["unlinked"], result["series_removed"], result["lineage_removed"]) == (2, 1, False)
    assert result["series_kept"] == [changed]
    kept = await flow.db.reference_series.find_one({"id": changed}, {"_id": 0})
    assert kept["reference_id"] is None
    assert await flow.db.references.count_documents({"series_id": {"$in": [changed]}}) == 0


@pytest.mark.asyncio
async def test_undo_gives_back_the_visibility_a_bundle_tightened(flow):
    await _board(flow)
    await _legacy(flow)
    await flow.post(f"{ADMIN}/lineages", json={
        "title": "Probe Liga 4vs4", "kind": "team_league", "organizer": "Probe Verband", "label": "4vs4",
        "game_name": "Probespiel", "visibility": "members"})
    group = _group(await _proposals(flow), "ref-s1", "ref-s2")
    bundle = (await flow.post(BUNDLES, json={"group_key": group["key"], "reference_ids": ["ref-s1", "ref-s2"]})).json()
    result = (await flow.post(f"{BUNDLES}/{bundle['id']}/undo")).json()
    assert result["lineage_removed"] is False  # die Spur gab es schon vorher
    visibilities = {item["id"]: item["visibility"] async for item in flow.db.references.find({}, {"_id": 0})}
    assert (visibilities["ref-s1"], visibilities["ref-s2"]) == ("public", "public")


# ---------------------------------------------------------------- Adressen bleiben
@pytest.mark.asyncio
async def test_bundled_references_keep_their_address_and_seo(flow):
    await _board(flow)
    await _legacy(flow)
    before_api = (await flow.get("/api/references/ref-s1")).json()
    before_meta = (await flow.get("/api/seo/meta?path=/references/ref-s1")).json()
    group = _group(await _proposals(flow), "ref-s1", "ref-s2")
    assert (await flow.post(BUNDLES, json={"group_key": group["key"],
                                           "reference_ids": ["ref-s1", "ref-s2"]})).status_code == 200
    after = await flow.get("/api/references/ref-s1")
    assert after.status_code == 200
    after_api = after.json()
    assert after_api["id"] == before_api["id"] == "ref-s1"
    assert after_api["title"] == before_api["title"]
    assert after_api["season_link"]["label"] == "Probe Liga · Season 1 · Division 3"
    after_meta = (await flow.get("/api/seo/meta?path=/references/ref-s1")).json()
    for key in ("canonical", "url", "title", "description", "robots"):
        assert after_meta.get(key) == before_meta.get(key), key
    assert after_meta["canonical"].endswith("/references/ref-s1")
