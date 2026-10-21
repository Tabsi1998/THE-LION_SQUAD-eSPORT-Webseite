"""Strengere Sichtbarkeit einer Saison bzw. Spur gilt sofort für ihre Referenzen (#1970) - über die echten Routen.

- Saison oder Spur strenger gestellt: jede verknüpfte Referenz (``series_id`` an der Referenz oder ``reference_id`` an
  der Saison) wird mindestens so streng - anonym weder in der Liste, im Detail, im Profil noch in den laufenden Saisons.
- Das Adminprotokoll nennt die Zahl der angepassten Referenzen.
- Lockern öffnet nichts.
Nur erfundene Namen."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from routes import reference_round_routes  # noqa: E402
from services import migrations  # noqa: E402

ADMIN = "/api/reference-series/admin"
PUBLIC = "/api/reference-series/public"


@pytest_asyncio.fixture
async def flow(monkeypatch):
    instance, shutdown = make_flow()
    monkeypatch.setattr(reference_round_routes, "club_today", lambda: "2026-11-20")
    try:
        yield instance
    finally:
        await shutdown()


async def _setup(flow, *, visibility="public"):
    """Vorstand, eine laufende Saison mit Spur und eine öffentliche Referenz der Saison mit einem Mitglied."""
    await migrations.migrate_points_scheme_templates(flow.db)
    admin = await flow.add_user(role="club_admin", name="vorstand")
    flow.act_as(admin)
    await flow.db.club_member_profiles.insert_one(
        {"id": "profil-alpha", "slug": "probe-alpha", "display_name": "Probe Alpha", "is_active": True})
    lineage = (await flow.post(f"{ADMIN}/lineages", json={
        "title": "Probe Racing F1", "kind": "racing", "label": "F1"})).json()
    series = (await flow.post(f"{ADMIN}/series", json={
        "lineage_id": lineage["id"], "season": "2026", "status": "active", "visibility": visibility})).json()
    await flow.db.references.insert_many([
        {"id": "ref-saison", "title": "Probe Racing 2026", "series_id": series["id"], "visibility": "public",
         "is_active": True, "member_profile_ids": ["profil-alpha"],
         "entries": [{"kind": "team", "team_name": "Probe Löwen", "member_profile_ids": ["profil-alpha"]}],
         "updated_at": "2026-11-01T00:00:00+00:00"},
        {"id": "ref-fremd", "title": "Probe Cup ohne Saison", "visibility": "public", "is_active": True,
         "entries": [{"kind": "team", "team_name": "Probe Löwen"}]},
    ])
    return admin, lineage, series


async def _anonymous_sees(flow, reference_id: str) -> dict:
    flow.act_as(None)
    listed = (await flow.get("/api/references")).json()["items"]
    detail = await flow.get(f"/api/references/{reference_id}")
    profile = (await flow.get("/api/membership/profiles/probe-alpha")).json()
    lineages = (await flow.get(f"{PUBLIC}/lineages")).json()["items"]
    in_lineages = any(reference_id in (season.get("reference_ids") or [])
                      for item in lineages for season in item.get("seasons") or [])
    # Gemerkte Antwort der Startseite (services/reference_running_cache.py): die Saison der Referenz.
    running = (await flow.get(f"{PUBLIC}/running")).json()["items"]
    return {"list": reference_id in {item["id"] for item in listed}, "detail": detail.status_code == 200,
            "profile": reference_id in {item["id"] for item in profile.get("references") or []},
            "lineages": in_lineages, "running": any(item["series"]["season"] == "2026" for item in running)}


@pytest.mark.asyncio
async def test_stricter_season_hides_its_reference_from_anonymous_visitors(flow):
    admin, _, series = await _setup(flow)
    assert await _anonymous_sees(flow, "ref-saison") == {
        "list": True, "detail": True, "profile": True, "lineages": True, "running": True}  # vorher - auch im Cache

    flow.act_as(admin)
    response = await flow.patch(f"{ADMIN}/series/{series['id']}", json={"visibility": "members"})
    assert response.status_code == 200, response.text

    assert (await flow.db.references.find_one({"id": "ref-saison"}))["visibility"] == "members"
    assert await _anonymous_sees(flow, "ref-saison") == {
        "list": False, "detail": False, "profile": False, "lineages": False, "running": False}
    # Referenzen anderer Saisons bzw. ohne Saison bleiben, wie sie sind.
    assert (await flow.db.references.find_one({"id": "ref-fremd"}))["visibility"] == "public"


@pytest.mark.asyncio
async def test_admin_log_names_the_number_of_adjusted_references(flow):
    admin, _, series = await _setup(flow)
    await flow.db.references.insert_one(
        {"id": "ref-am-blatt", "title": "Probe Racing 2026 (an der Saison)", "visibility": "community",
         "is_active": True, "entries": []})
    await flow.db.references.insert_one(
        {"id": "ref-schon-streng", "title": "Probe Racing intern", "series_id": series["id"],
         "visibility": "internal", "is_active": True, "entries": []})
    await flow.db.reference_series.update_one({"id": series["id"]}, {"$set": {"reference_id": "ref-am-blatt"}})

    response = await flow.patch(f"{ADMIN}/series/{series['id']}", json={"visibility": "members"})
    assert response.status_code == 200, response.text

    log = await flow.db.audit_logs.find_one({"action": "reference_series.references_tightened"}, {"_id": 0})
    assert log["target_id"] == series["id"] and log["actor_id"] == admin["id"]
    assert log["data"]["count"] == 2
    assert sorted(log["data"]["reference_ids"]) == ["ref-am-blatt", "ref-saison"]
    assert log["data"]["visibility"] == "members"
    assert (await flow.db.references.find_one({"id": "ref-am-blatt"}))["visibility"] == "members"
    assert (await flow.db.references.find_one({"id": "ref-schon-streng"}))["visibility"] == "internal"


@pytest.mark.asyncio
async def test_loosening_the_season_opens_nothing(flow):
    admin, _, series = await _setup(flow, visibility="members")
    await flow.db.references.update_one({"id": "ref-saison"}, {"$set": {"visibility": "members"}})

    response = await flow.patch(f"{ADMIN}/series/{series['id']}", json={"visibility": "public"})
    assert response.status_code == 200, response.text

    assert (await flow.db.references.find_one({"id": "ref-saison"}))["visibility"] == "members"
    assert await flow.db.audit_logs.find_one({"action": "reference_series.references_tightened"}) is None
    assert (await _anonymous_sees(flow, "ref-saison"))["detail"] is False


@pytest.mark.asyncio
async def test_unchanged_strictness_writes_no_log(flow):
    _, _, series = await _setup(flow)
    response = await flow.patch(f"{ADMIN}/series/{series['id']}", json={"description": "Probe-Text"})
    assert response.status_code == 200, response.text
    assert (await flow.db.references.find_one({"id": "ref-saison"}))["visibility"] == "public"
    assert await flow.db.audit_logs.find_one({"action": "reference_series.references_tightened"}) is None


@pytest.mark.asyncio
async def test_a_new_members_season_linked_to_a_public_reference_tightens_it(flow):
    _, lineage, _ = await _setup(flow)
    response = await flow.post(f"{ADMIN}/series", json={
        "lineage_id": lineage["id"], "season": "2027", "visibility": "members", "reference_id": "ref-fremd"})
    assert response.status_code == 200, response.text
    assert (await flow.db.references.find_one({"id": "ref-fremd"}))["visibility"] == "members"
    log = await flow.db.audit_logs.find_one({"action": "reference_series.references_tightened"}, {"_id": 0})
    assert log["target_id"] == response.json()["id"] and log["data"]["count"] == 1


@pytest.mark.asyncio
async def test_stricter_lineage_tightens_the_references_of_all_its_seasons(flow):
    admin, lineage, series = await _setup(flow)
    other = (await flow.post(f"{ADMIN}/series", json={
        "lineage_id": lineage["id"], "season": "2025", "status": "completed"})).json()
    await flow.db.references.insert_one(
        {"id": "ref-vorjahr", "title": "Probe Racing 2025", "series_id": other["id"], "visibility": "public",
         "is_active": True, "entries": []})

    response = await flow.patch(f"{ADMIN}/lineages/{lineage['id']}", json={"visibility": "internal"})
    assert response.status_code == 200, response.text

    for rid in ("ref-saison", "ref-vorjahr"):
        assert (await flow.db.references.find_one({"id": rid}))["visibility"] == "internal"
    assert (await flow.db.references.find_one({"id": "ref-fremd"}))["visibility"] == "public"
    assert (await _anonymous_sees(flow, "ref-saison"))["detail"] is False
    log = await flow.db.audit_logs.find_one({"action": "reference_lineage.references_tightened"}, {"_id": 0})
    assert log["target_id"] == lineage["id"] and log["data"]["count"] == 2

    flow.act_as(admin)
    await flow.patch(f"{ADMIN}/lineages/{lineage['id']}", json={"visibility": "public"})
    assert (await flow.db.references.find_one({"id": "ref-vorjahr"}))["visibility"] == "internal"
