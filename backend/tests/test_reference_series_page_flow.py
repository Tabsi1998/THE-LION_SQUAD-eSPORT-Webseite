"""Seite Turnierserie (#1745) über die echte Route: Kopf, Regeln, Rundenfortschritt, die gespeicherte Gesamtwertung mit
gezählten und gestrichenen Runden, Bewegung seit der Runde davor, Finalgrenze und das Finale als eigene Runde.

Die Seite rechnet nichts - sie liest den gespeicherten Stand. Fremde Namen erscheinen nur als Text (ohne Profil-Link),
ein ausgeblendeter Name gar nicht; Sichtbarkeit und Archiv gelten wie beim Kalender. Nur erfundene Namen."""
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
RULES = {"points_mode": "scheme", "points_by_place": [10, 8, 6, 4], "count_mode": "drop_n", "count_n": 1,
         "final_top_n": 2, "tiebreakers": ["wins", "latest_result"]}


@pytest_asyncio.fixture
async def flow(monkeypatch):
    instance, shutdown = make_flow()
    monkeypatch.setattr(reference_round_routes, "club_today", lambda: "2026-11-20")
    try:
        yield instance
    finally:
        await shutdown()


async def _setup(flow):
    await migrations.migrate_points_scheme_templates(flow.db)
    admin = await flow.add_user(role="club_admin", name="vorstand")
    flow.act_as(admin)
    lineage = (await flow.post(f"{ADMIN}/lineages", json={
        "title": "Probe Monatscup", "kind": "series", "organizer": "Probe Liga", "label": "1vs1",
        "game_name": "Probespiel"})).json()
    series = (await flow.post(f"{ADMIN}/series", json={
        "lineage_id": lineage["id"], "season": "2026", "rules": RULES, "default_time": "20:00"})).json()
    rounds = {}
    for code, day, extra in (("Q1", "2026-11-01", {}), ("Q2", "2026-11-08", {}), ("Q3", "2026-11-15", {}),
                             ("Q4", "2026-11-29", {}), ("FIN", "2026-12-06", {"kind": "final", "counts": False})):
        response = await flow.post(f"{ADMIN}/series/{series['id']}/rounds", json={"code": code, "day": day, **extra})
        assert response.status_code == 200, response.text
        rounds[code] = response.json()["id"]
    await flow.db.club_member_profiles.insert_one({"id": "profil-alpha", "slug": "probe-alpha",
                                                   "display_name": "Probe Alpha", "is_active": True})
    people = [
        {"id": "p-alpha", "name": "Probe Alpha", "link": "member", "profile_id": "profil-alpha",
         "is_club_member": True},
        {"id": "p-beta", "name": "Fremd Beta", "link": "external"},
        {"id": "p-gamma", "name": "Fremd Gamma", "link": "external", "name_hidden": True},
        {"id": "p-delta", "name": "Gast Delta", "link": "guest", "profile_id": "profil-alpha"},
    ]
    await flow.db.reference_participants.insert_many([
        {"series_id": series["id"], "is_club_member": False, "name_hidden": False, **person} for person in people])
    sheets = {
        "Q1": ["p-beta", "p-alpha", "p-gamma", "p-delta"],
        "Q2": ["p-alpha", "p-beta", "p-delta", "p-gamma"],
        "Q3": ["p-alpha", "p-gamma", "p-beta", "p-delta"],
        "FIN": ["p-beta", "p-alpha"],
    }
    for code, order in sheets.items():
        await flow.db.reference_round_results.insert_one({
            "id": f"blatt-{code}", "series_id": series["id"], "round_id": rounds[code], "status": "published",
            "rows": [{"participant_id": pid, "place": place} for place, pid in enumerate(order, start=1)]})
        await flow.db.reference_rounds.update_one({"id": rounds[code]}, {"$set": {"status": "scored"}})
    stored = await flow.db.reference_series.find_one({"id": series["id"]}, {"_id": 0})
    await reference_series.recompute_standings(flow.db, stored)
    return admin, lineage, series, rounds


def _url(lineage, series):
    return f"{PUBLIC}/{lineage['slug']}/{series['season_slug']}"


@pytest.mark.asyncio
async def test_the_page_shows_head_rules_progress_standings_and_the_final(flow):
    _, lineage, series, rounds = await _setup(flow)
    flow.act_as(None)
    response = await flow.get(_url(lineage, series))
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["lineage"] == {"title": "Probe Monatscup", "slug": lineage["slug"], "kind": "series",
                               "label": "1vs1", "organizer": "Probe Liga", "game_name": "Probespiel",
                               "external_url": None}
    assert body["series"]["season"] == "2026"
    assert (body["rules"]["final_top_n"], body["rules"]["count_mode"], body["rules"]["count_n"]) == (2, "drop_n", 1)
    assert body["rules"]["points_by_place"] == [10, 8, 6, 4]
    assert body["rules"]["tiebreakers"] == ["wins", "latest_result"]

    # Drei von vier Wertungsrunden gewertet, Q4 ist der nächste Termin; das Finale zählt nicht mit.
    progress = body["progress"]
    assert (progress["total"], progress["scored"], progress["remaining"]) == (4, 3, 1)
    assert progress["next"]["code"] == "Q4" and progress["next"]["club_day"] == "2026-11-29"

    # Vier Runden, ein Streichergebnis: von drei Ergebnissen zählt alles.
    rows = body["standings"]["rows"]
    assert [(row["key"], row["rank"], row["points"]) for row in rows] == [
        ("p-alpha", 1, 28), ("p-beta", 2, 24), ("p-gamma", 3, 18), ("p-delta", 4, 14)]
    alpha = rows[0]
    assert alpha["previous_rank"] == 1 and rows[2]["previous_rank"] == 4
    assert [(item["round_id"], item["place"], item["points"], item["counted"], item["dropped"])
            for item in alpha["results"]] == [
        (rounds["Q1"], 2, 8, True, False), (rounds["Q2"], 1, 10, True, False), (rounds["Q3"], 1, 10, True, False)]
    assert body["standings"]["round_id"] == rounds["Q3"]

    final = body["final"]
    assert final["round"]["code"] == "FIN" and final["round"]["kind"] == "final"
    assert [(row["key"], row["place"]) for row in final["rows"]] == [("p-beta", 1), ("p-alpha", 2)]


@pytest.mark.asyncio
async def test_dropped_results_are_marked_once_the_last_round_is_in(flow):
    admin, lineage, series, rounds = await _setup(flow)
    await flow.db.reference_round_results.insert_one({
        "id": "blatt-Q4", "series_id": series["id"], "round_id": rounds["Q4"], "status": "published",
        "rows": [{"participant_id": pid, "place": place}
                 for place, pid in enumerate(["p-delta", "p-gamma", "p-beta", "p-alpha"], start=1)]})
    await flow.db.reference_rounds.update_one({"id": rounds["Q4"]}, {"$set": {"status": "scored"}})
    await reference_series.recompute_standings(flow.db, await flow.db.reference_series.find_one({"id": series["id"]}))
    flow.act_as(None)
    body = (await flow.get(_url(lineage, series))).json()
    alpha = next(row for row in body["standings"]["rows"] if row["key"] == "p-alpha")
    dropped = [(item["round_id"], item["dropped"]) for item in alpha["results"] if item["dropped"]]
    assert dropped == [(rounds["Q4"], True)]
    assert alpha["points"] == 28
    assert body["progress"]["remaining"] == 0 and body["progress"]["next"] is None


@pytest.mark.asyncio
async def test_foreign_names_are_text_only_and_a_hidden_name_never_leaves(flow):
    _, lineage, series, _ = await _setup(flow)
    flow.act_as(None)
    response = await flow.get(_url(lineage, series))
    rows = {row["key"]: row for row in response.json()["standings"]["rows"]}

    assert (rows["p-alpha"]["name"], rows["p-alpha"]["club_member"], rows["p-alpha"]["profile_slug"]) == (
        "Probe Alpha", True, "probe-alpha")
    # Fremde und Gäste: nur der Name, kein Link, keine Profil-Kennung.
    for key in ("p-beta", "p-delta"):
        assert rows[key]["club_member"] is False and rows[key]["profile_slug"] is None
        assert "profile_id" not in rows[key] and "link" not in rows[key]
    assert rows["p-gamma"]["name"] is None and rows["p-gamma"]["name_hidden"] is True
    assert "Fremd Gamma" not in response.text
    assert "profil-alpha" not in response.text


@pytest.mark.asyncio
async def test_visibility_and_archive_hide_the_page(flow):
    admin, lineage, series, _ = await _setup(flow)
    url = _url(lineage, series)
    flow.act_as(None)
    assert (await flow.get(url)).status_code == 200

    flow.act_as(admin)
    await flow.patch(f"{ADMIN}/series/{series['id']}", json={"visibility": "members"})
    flow.act_as(None)
    assert (await flow.get(url)).status_code == 404

    flow.act_as(admin)
    await flow.patch(f"{ADMIN}/series/{series['id']}", json={"visibility": "public"})
    await flow.patch(f"{ADMIN}/lineages/{lineage['id']}", json={"visibility": "internal"})
    flow.act_as(await flow.add_user(role="player"))
    assert (await flow.get(url)).status_code == 404

    flow.act_as(admin)
    await flow.patch(f"{ADMIN}/lineages/{lineage['id']}", json={"visibility": "public"})
    await flow.post(f"{ADMIN}/series/{series['id']}/archive")
    flow.act_as(None)
    assert (await flow.get(url)).status_code == 404
    assert (await flow.get(f"{PUBLIC}/gibt-es-nicht/2026")).status_code == 404


@pytest.mark.asyncio
async def test_a_season_without_results_has_no_table_yet(flow):
    await migrations.migrate_points_scheme_templates(flow.db)
    admin = await flow.add_user(role="club_admin", name="vorstand")
    flow.act_as(admin)
    lineage = (await flow.post(f"{ADMIN}/lineages", json={"title": "Probe Leer", "kind": "series"})).json()
    series = (await flow.post(f"{ADMIN}/series", json={"lineage_id": lineage["id"], "season": "2027"})).json()
    flow.act_as(None)
    body = (await flow.get(_url(lineage, series))).json()
    assert body["standings"] is None and body["final"] is None
    assert body["progress"] == {"total": 0, "scored": 0, "cancelled": 0, "remaining": 0, "next": None}
