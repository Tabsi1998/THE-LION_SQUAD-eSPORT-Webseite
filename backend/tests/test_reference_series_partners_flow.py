"""Serien und Ligen mit Partnern (#1934) über die echten Routen:
- Spur und Saison tragen Partner mit Rolle (``partner_roles``: Veranstalter oder Mitwirkender), alte Aufrufe nur mit
  ``partner_ids`` bleiben gültig (Rolle dann „Mitwirkender“).
- Die Saison erbt die Partner der Spur und kann eigene ergänzen.
- Serienseite: ``partners.organizers`` und ``partners.contributors``; „Läuft gerade“ und „Serien und Ligen“ tragen die
  veranstaltenden Partner; die Partnerseite listet unter ``shared.series`` Spuren und Saisons mit dem Partner.
- Nur aktive Partner, nur sichtbare Spuren und Saisons, interne Spuren nie auf der Partnerseite.
Nur erfundene Namen."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from routes import reference_round_routes, reference_series_public_routes  # noqa: E402
from services import migrations, reference_running_cache  # noqa: E402

ADMIN = "/api/reference-series/admin"
PUBLIC = "/api/reference-series/public"


@pytest_asyncio.fixture
async def flow(monkeypatch):
    instance, shutdown = make_flow()
    monkeypatch.setattr(reference_round_routes, "club_today", lambda: "2026-11-09")
    monkeypatch.setattr(reference_series_public_routes, "club_today", lambda: "2026-11-09")
    reference_running_cache.reset()
    try:
        yield instance
    finally:
        reference_running_cache.reset()
        await shutdown()


async def _partner(flow, name, **extra):
    response = await flow.post("/api/partners", json={"name": name, "logo_url": f"/uploads/{name[:5]}.png", **extra})
    assert response.status_code == 200, response.text
    return response.json()


async def _setup(flow):
    await migrations.migrate_points_scheme_templates(flow.db)
    admin = await flow.add_user(role="club_admin", name="vorstand")
    flow.act_as(admin)
    host = await _partner(flow, "Probe Ananas")
    helper = await _partner(flow, "Probe Kokos")
    sponsor = await _partner(flow, "Probe Mango")
    lineage = (await flow.post(f"{ADMIN}/lineages", json={
        "title": "Probe Ananas Liga", "kind": "series", "organizer": "Probe Ananas",
        "partner_ids": [host["id"], helper["id"]], "partner_roles": {host["id"]: "organizer"}})).json()
    done = (await flow.post(f"{ADMIN}/series", json={
        "lineage_id": lineage["id"], "season": "2025", "status": "completed"})).json()
    running = (await flow.post(f"{ADMIN}/series", json={
        "lineage_id": lineage["id"], "season": "2026", "status": "active",
        "partner_ids": [sponsor["id"]], "partner_roles": {sponsor["id"]: "contributor"}})).json()
    await flow.db.club_member_profiles.insert_one(
        {"id": "profil-a", "slug": "probe-a", "display_name": "Probe Alpha", "is_active": True})
    for series, rank in ((done, 2), (running, 4)):
        await flow.db.reference_participants.insert_one(
            {"id": f"alpha-{series['id']}", "series_id": series["id"], "name": "Probe Alpha", "link": "member",
             "profile_id": "profil-a", "is_club_member": True, "name_hidden": False})
        await flow.db.reference_standings.insert_one({
            "series_id": series["id"], "round_id": "r1", "round_seq": 1, "scope": "drivers",
            "rows": [{"participant_id": "x1", "rank": 1}, {"participant_id": "x2", "rank": rank - 1 or 3},
                     {"participant_id": f"alpha-{series['id']}", "rank": rank},
                     {"participant_id": "x3", "rank": rank + 1}]})
    return admin, (host, helper, sponsor), lineage, (done, running)


def _names(rows):
    return [row["name"] for row in rows]


@pytest.mark.asyncio
async def test_lineage_keeps_partner_roles_cleaned_and_old_calls_stay_valid(flow):
    admin, (host, helper, sponsor), lineage, _ = await _setup(flow)
    assert lineage["partner_ids"] == [host["id"], helper["id"]]
    # Ohne Angabe ist ein Partner Mitwirkender.
    assert lineage["partner_roles"] == {host["id"]: "organizer", helper["id"]: "contributor"}

    # Unbekannte Partner und Rollen fremder Partner fallen weg.
    response = await flow.patch(f"{ADMIN}/lineages/{lineage['id']}", json={
        "partner_ids": [helper["id"], "gibt-es-nicht"], "partner_roles": {helper["id"]: "organizer", host["id"]: "organizer"}})
    assert response.status_code == 200, response.text
    assert response.json()["partner_ids"] == [helper["id"]]
    assert response.json()["partner_roles"] == {helper["id"]: "organizer"}

    # Ein älterer Aufruf schickt nur partner_ids - die Rolle bleibt, wo es den Partner noch gibt.
    response = await flow.patch(f"{ADMIN}/lineages/{lineage['id']}", json={"partner_ids": [helper["id"], host["id"]]})
    assert response.json()["partner_roles"] == {helper["id"]: "organizer", host["id"]: "contributor"}

    bad = await flow.patch(f"{ADMIN}/lineages/{lineage['id']}", json={"partner_roles": {helper["id"]: "chef"}})
    assert bad.status_code == 422

    # Eine Spur ohne Partner antwortet mit leeren Feldern.
    plain = (await flow.post(f"{ADMIN}/lineages", json={"title": "Ohne Partner", "kind": "series"})).json()
    assert plain["partner_ids"] == [] and plain["partner_roles"] == {}


@pytest.mark.asyncio
async def test_series_page_shows_organizer_and_contributors_and_the_season_adds_its_own(flow):
    admin, (host, helper, sponsor), lineage, (done, running) = await _setup(flow)
    assert running["partner_ids"] == [sponsor["id"]]
    flow.act_as(None)
    page = (await flow.get(f"{PUBLIC}/{lineage['slug']}/{running['season_slug']}")).json()
    partners = page["partners"]
    assert _names(partners["organizers"]) == ["Probe Ananas"]
    assert _names(partners["contributors"]) == ["Probe Kokos", "Probe Mango"]
    assert partners["organizers"][0]["slug"] == host["slug"] and partners["organizers"][0]["logo_url"]
    # Die abgeschlossene Saison hat nur die Partner der Spur.
    page = (await flow.get(f"{PUBLIC}/{lineage['slug']}/{done['season_slug']}")).json()
    assert _names(page["partners"]["contributors"]) == ["Probe Kokos"]

    # Die Saison kann die Rolle eines Spur-Partners für sich ändern.
    flow.act_as(admin)
    response = await flow.patch(f"{ADMIN}/series/{done['id']}", json={
        "partner_ids": [helper["id"]], "partner_roles": {helper["id"]: "organizer"}})
    assert response.status_code == 200, response.text
    flow.act_as(None)
    page = (await flow.get(f"{PUBLIC}/{lineage['slug']}/{done['season_slug']}")).json()
    assert _names(page["partners"]["organizers"]) == ["Probe Ananas", "Probe Kokos"]
    assert page["partners"]["contributors"] == []


@pytest.mark.asyncio
async def test_running_and_lineages_carry_the_organizing_partner(flow):
    admin, (host, helper, sponsor), lineage, (done, running) = await _setup(flow)
    flow.act_as(None)
    items = (await flow.get(f"{PUBLIC}/running")).json()["items"]
    assert [_names(item["organizers"]) for item in items] == [["Probe Ananas"]]
    paths = (await flow.get(f"{PUBLIC}/lineages")).json()["items"]
    assert _names(paths[0]["lineage"]["organizers"]) == ["Probe Ananas"]
    assert [_names(season["organizers"]) for season in paths[0]["seasons"]] == [["Probe Ananas"], ["Probe Ananas"]]


@pytest.mark.asyncio
async def test_partner_page_lists_lineage_with_both_seasons_place_and_running(flow):
    admin, (host, helper, sponsor), lineage, (done, running) = await _setup(flow)
    hidden = (await flow.post(f"{ADMIN}/lineages", json={
        "title": "Probe Intern", "kind": "series", "visibility": "internal",
        "partner_ids": [host["id"]], "partner_roles": {host["id"]: "organizer"}})).json()
    await flow.post(f"{ADMIN}/series", json={"lineage_id": hidden["id"], "season": "2026", "status": "active"})
    members = (await flow.post(f"{ADMIN}/lineages", json={
        "title": "Probe Mitglieder", "kind": "series", "visibility": "members", "partner_ids": [host["id"]]})).json()
    await flow.post(f"{ADMIN}/series", json={"lineage_id": members["id"], "season": "2026"})

    # Auch der Vorstand sieht die interne Spur nicht auf der Partnerseite.
    body = (await flow.get(f"/api/partners/{host['slug']}")).json()
    assert [item["lineage"]["title"] for item in body["shared"]["series"]] == ["Probe Ananas Liga", "Probe Mitglieder"]

    flow.act_as(None)
    body = (await flow.get(f"/api/partners/{host['slug']}")).json()
    series = body["shared"]["series"]
    assert len(series) == 1
    item = series[0]
    assert item["lineage"]["title"] == "Probe Ananas Liga" and item["lineage"]["slug"] == lineage["slug"]
    assert item["role"] == "organizer"
    assert [(season["season"], season["status"], season["running"], season["club"]) for season in item["seasons"]] == [
        ("2026", "active", True, {"rank": 4, "of": 4}), ("2025", "completed", False, {"rank": 2, "of": 4})]
    assert "Probe Alpha" not in str(series)

    # Ein Partner nur einer Saison sieht nur diese Saison - als Mitwirkender.
    body = (await flow.get(f"/api/partners/{sponsor['slug']}")).json()
    assert [(item["role"], [season["season"] for season in item["seasons"]]) for item in body["shared"]["series"]] == [
        ("contributor", ["2026"])]


@pytest.mark.asyncio
async def test_inactive_partner_disappears_everywhere(flow):
    admin, (host, helper, sponsor), lineage, (done, running) = await _setup(flow)
    response = await flow.patch(f"/api/partners/{host['id']}", json={"is_active": False})
    assert response.status_code == 200, response.text
    reference_running_cache.reset()
    flow.act_as(None)
    page = (await flow.get(f"{PUBLIC}/{lineage['slug']}/{running['season_slug']}")).json()
    assert page["partners"]["organizers"] == []
    assert _names(page["partners"]["contributors"]) == ["Probe Kokos", "Probe Mango"]
    assert (await flow.get(f"{PUBLIC}/running")).json()["items"][0]["organizers"] == []
    paths = (await flow.get(f"{PUBLIC}/lineages")).json()["items"]
    assert paths[0]["lineage"]["organizers"] == [] and paths[0]["seasons"][0]["organizers"] == []
    assert (await flow.get(f"/api/partners/{host['slug']}")).status_code == 404


@pytest.mark.asyncio
async def test_season_close_takes_the_partners_of_lineage_and_season(flow):
    admin, (host, helper, sponsor), lineage, (done, running) = await _setup(flow)
    body = (await flow.get(f"{ADMIN}/series/{running['id']}/close")).json()
    assert body["reference"]["partner_ids"] == [host["id"], helper["id"], sponsor["id"]]
