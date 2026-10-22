"""Logo je Spur und optional je Saison (#2014) über die echten Routen:
- gesetzt wird es nur über den sicheren Logo-Upload bzw. die Mediathek - eine fremde Adresse oder eine Datei, die nie
  hochgeladen wurde, lehnt die Verwaltung ab;
- die Saison erbt das Logo der Spur, ein eigenes Saison-Logo geht vor; ohne Logo bleibt alles wie bisher (``None``);
- Serienseite, Rundenseite, „Läuft gerade“, „Serien und Ligen“ und die Partnerseite tragen es, nur bei sichtbarer Spur
  und Saison; die Teilen-Karte zeigt es als Bild;
- die Mediathek zählt es als verwendet.
Nur erfundene Namen."""
import io
import pathlib
import sys

import pytest
import pytest_asyncio
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from routes import reference_round_routes, reference_series_public_routes, upload_routes  # noqa: E402
from routes.seo_render_routes import reference_round_meta, reference_series_meta  # noqa: E402
from services import media_audit, media_scan, migrations, reference_running_cache  # noqa: E402

ADMIN = "/api/reference-series/admin"
PUBLIC = "/api/reference-series/public"
BASE = {"site_name": "Probe", "image": "https://probe.test/standard.png"}


@pytest_asyncio.fixture
async def flow(tmp_path, monkeypatch):
    public = tmp_path / "public"
    public.mkdir()
    monkeypatch.setattr(upload_routes, "PUBLIC_UPLOAD_DIR", public)
    monkeypatch.setattr(media_scan, "auto_process", False)
    monkeypatch.setattr(reference_round_routes, "club_today", lambda: "2026-11-09")
    monkeypatch.setattr(reference_series_public_routes, "club_today", lambda: "2026-11-09")
    reference_running_cache.reset()
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        reference_running_cache.reset()
        await shutdown()


def _png(color) -> bytes:
    img = Image.new("RGBA", (40, 40), (0, 0, 0, 0))
    for x in range(8, 32):
        for y in range(8, 32):
            img.putpixel((x, y), color)
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    return buffer.getvalue()


async def _upload(flow, name, color) -> str:
    response = await flow.post("/api/uploads/logo", files={"file": (name, _png(color), "image/png")})
    assert response.status_code == 200, response.text
    return response.json()["url"]


async def _setup(flow):
    await migrations.migrate_points_scheme_templates(flow.db)
    admin = await flow.add_user(role="club_admin", name="vorstand")
    flow.act_as(admin)
    lineage = (await flow.post(f"{ADMIN}/lineages", json={"title": "Probe Kiwi Liga", "kind": "series"})).json()
    old = (await flow.post(f"{ADMIN}/series", json={
        "lineage_id": lineage["id"], "season": "2025", "status": "completed"})).json()
    current = (await flow.post(f"{ADMIN}/series", json={
        "lineage_id": lineage["id"], "season": "2026", "status": "active"})).json()
    return admin, lineage, old, current


@pytest.mark.asyncio
async def test_logo_only_from_the_secure_upload(flow):
    admin, lineage, old, current = await _setup(flow)
    spur_logo = await _upload(flow, "kiwi.png", (40, 200, 90, 255))
    response = await flow.patch(f"{ADMIN}/lineages/{lineage['id']}", json={"logo_url": spur_logo})
    assert response.status_code == 200, response.text
    assert response.json()["logo_url"] == spur_logo

    # Eine fremde Adresse, ein Pfad außerhalb der Uploads oder eine nie hochgeladene Datei: abgelehnt, nichts geändert.
    for bad in ("https://fremd.example/logo.png", "/api/static/uploads/../geheim.png", "javascript:alert(1)",
                "/api/static/uploads/nie-hochgeladen.png"):
        refused = await flow.patch(f"{ADMIN}/lineages/{lineage['id']}", json={"logo_url": bad})
        assert refused.status_code in (404, 422), (bad, refused.text)
        refused = await flow.patch(f"{ADMIN}/series/{current['id']}", json={"logo_url": bad})
        assert refused.status_code in (404, 422), (bad, refused.text)
    created = await flow.post(f"{ADMIN}/lineages", json={"title": "Probe Fremd", "kind": "series",
                                                          "logo_url": "https://fremd.example/logo.png"})
    assert created.status_code == 422
    stored = await flow.db.reference_lineages.find_one({"id": lineage["id"]})
    assert stored["logo_url"] == spur_logo

    # Entfernen geht mit null.
    cleared = await flow.patch(f"{ADMIN}/lineages/{lineage['id']}", json={"logo_url": None})
    assert cleared.status_code == 200 and cleared.json()["logo_url"] is None


@pytest.mark.asyncio
async def test_season_inherits_the_lineage_logo_and_its_own_wins(flow):
    admin, lineage, old, current = await _setup(flow)
    spur_logo = await _upload(flow, "kiwi.png", (40, 200, 90, 255))
    season_logo = await _upload(flow, "season2.png", (200, 40, 90, 255))
    await flow.patch(f"{ADMIN}/lineages/{lineage['id']}", json={"logo_url": spur_logo})
    response = await flow.patch(f"{ADMIN}/series/{current['id']}", json={"logo_url": season_logo})
    assert response.status_code == 200, response.text

    flow.act_as(None)
    page = (await flow.get(f"{PUBLIC}/{lineage['slug']}/{current['season_slug']}")).json()
    assert page["lineage"]["logo_url"] == spur_logo
    assert page["series"]["logo_url"] == season_logo
    page = (await flow.get(f"{PUBLIC}/{lineage['slug']}/{old['season_slug']}")).json()
    assert page["series"]["logo_url"] == spur_logo

    running = (await flow.get(f"{PUBLIC}/running")).json()["items"]
    assert [(item["lineage"]["logo_url"], item["series"]["logo_url"]) for item in running] == [(spur_logo, season_logo)]
    paths = (await flow.get(f"{PUBLIC}/lineages")).json()["items"]
    assert paths[0]["lineage"]["logo_url"] == spur_logo
    assert {season["season"]: season["logo_url"] for season in paths[0]["seasons"]} == {
        "2025": spur_logo, "2026": season_logo}

    # Teilen-Karte: das Logo der Saison als Bild, absolut.
    meta = await reference_series_meta(flow.db, lineage["slug"], current["season_slug"], dict(BASE),
                                       "https://probe.test")
    assert meta["image"] == f"https://probe.test{season_logo}"


@pytest.mark.asyncio
async def test_without_logo_everything_stays_as_before(flow):
    admin, lineage, old, current = await _setup(flow)
    flow.act_as(None)
    page = (await flow.get(f"{PUBLIC}/{lineage['slug']}/{current['season_slug']}")).json()
    assert page["lineage"]["logo_url"] is None and page["series"]["logo_url"] is None
    running = (await flow.get(f"{PUBLIC}/running")).json()["items"]
    assert running[0]["series"]["logo_url"] is None and running[0]["lineage"]["logo_url"] is None
    paths = (await flow.get(f"{PUBLIC}/lineages")).json()["items"]
    assert [season["logo_url"] for season in paths[0]["seasons"]] == [None, None]
    meta = await reference_series_meta(flow.db, lineage["slug"], current["season_slug"], dict(BASE),
                                       "https://probe.test")
    assert meta["image"] == BASE["image"]


@pytest.mark.asyncio
async def test_round_page_and_its_share_card_carry_the_logo(flow):
    await migrations.migrate_points_scheme_templates(flow.db)
    admin = await flow.add_user(role="club_admin", name="vorstand")
    flow.act_as(admin)
    lineage = (await flow.post(f"{ADMIN}/lineages", json={"title": "Probe Rennliga", "kind": "racing"})).json()
    series = (await flow.post(f"{ADMIN}/series", json={
        "lineage_id": lineage["id"], "season": "2026", "status": "active"})).json()
    logo = await _upload(flow, "rennen.png", (90, 40, 200, 255))
    await flow.patch(f"{ADMIN}/lineages/{lineage['id']}", json={"logo_url": logo})
    pasted = await flow.post(f"{ADMIN}/series/{series['id']}/rounds/paste", json={
        "text": "R1 · 20.11.2026 · Probe Ring", "apply": True})
    assert pasted.status_code == 200, pasted.text
    flow.act_as(None)
    response = await flow.get(f"{PUBLIC}/{lineage['slug']}/{series['season_slug']}/rounds/1")
    assert response.status_code == 200, response.text
    assert response.json()["series"]["logo_url"] == logo
    meta = await reference_round_meta(flow.db, lineage["slug"], series["season_slug"], "1", dict(BASE),
                                      "https://probe.test")
    assert meta["image"] == f"https://probe.test{logo}"


@pytest.mark.asyncio
async def test_logo_only_public_with_a_visible_lineage(flow):
    admin, lineage, old, current = await _setup(flow)
    logo = await _upload(flow, "kiwi.png", (40, 200, 90, 255))
    await flow.patch(f"{ADMIN}/lineages/{lineage['id']}", json={"logo_url": logo, "visibility": "internal"})
    flow.act_as(None)
    assert (await flow.get(f"{PUBLIC}/{lineage['slug']}/{current['season_slug']}")).status_code == 404
    assert logo not in str((await flow.get(f"{PUBLIC}/running")).json())
    assert logo not in str((await flow.get(f"{PUBLIC}/lineages")).json())

    # Wieder öffentlich: jetzt kommt es mit.
    flow.act_as(admin)
    await flow.patch(f"{ADMIN}/lineages/{lineage['id']}", json={"visibility": "public"})
    flow.act_as(None)
    assert (await flow.get(f"{PUBLIC}/lineages")).json()["items"][0]["lineage"]["logo_url"] == logo


@pytest.mark.asyncio
async def test_partner_page_shows_the_lineage_and_season_logo(flow):
    admin, lineage, old, current = await _setup(flow)
    partner = (await flow.post("/api/partners", json={"name": "Probe Feige"})).json()
    spur_logo = await _upload(flow, "kiwi.png", (40, 200, 90, 255))
    season_logo = await _upload(flow, "season2.png", (200, 40, 90, 255))
    await flow.patch(f"{ADMIN}/lineages/{lineage['id']}", json={
        "logo_url": spur_logo, "partner_ids": [partner["id"]], "partner_roles": {partner["id"]: "organizer"}})
    await flow.patch(f"{ADMIN}/series/{current['id']}", json={"logo_url": season_logo})
    flow.act_as(None)
    item = (await flow.get(f"/api/partners/{partner['slug']}")).json()["shared"]["series"][0]
    assert item["lineage"]["logo_url"] == spur_logo
    assert {season["season"]: season["logo_url"] for season in item["seasons"]} == {
        "2026": season_logo, "2025": spur_logo}


@pytest.mark.asyncio
async def test_media_library_counts_lineage_and_season_logos(flow):
    admin, lineage, old, current = await _setup(flow)
    spur_logo = await _upload(flow, "kiwi.png", (40, 200, 90, 255))
    season_logo = await _upload(flow, "season2.png", (200, 40, 90, 255))
    await flow.patch(f"{ADMIN}/lineages/{lineage['id']}", json={"logo_url": spur_logo})
    await flow.patch(f"{ADMIN}/series/{old['id']}", json={"logo_url": season_logo})
    names = {spur_logo.rsplit("/", 1)[-1], season_logo.rsplit("/", 1)[-1]}
    found = {(collection, field, name) async for collection, _doc, field, name, _text
             in media_audit.iter_usages(flow.db, names)}
    assert found == {("reference_lineages", "logo_url", spur_logo.rsplit("/", 1)[-1]),
                     ("reference_series", "logo_url", season_logo.rsplit("/", 1)[-1])}
    assert media_audit.place_label("reference_lineages", "logo_url") == "Spur · Logo"
    assert media_audit.place_label("reference_series", "logo_url") == "Saison · Logo"
