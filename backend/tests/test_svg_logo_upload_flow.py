"""Logos als SVG (#1952) über die echten Routen:
- SVG geht nur über die Logo-Routen mit Rechteprüfung (``/uploads/logo``, ``/uploads/sponsor-logo``,
  ``/uploads/team-logo`` für die Leitung des Teams); ``/uploads/image``, Fotos, Avatare und die Mediathek bleiben ohne
  SVG, und eine SVG-Adresse lässt sich nur in Logo-Feldern speichern;
- gespeichert wird die bereinigte Fassung und daneben die PNG-Fassung;
- ausgeliefert mit strengen Kopfzeilen;
- nur die App bekommt in GET-Antworten die PNG-Adresse, alle anderen das SVG; speichert ein Formular die PNG zurück,
  bleibt das SVG;
- ein zu aufwendiges SVG bekommt 422, SVG-Uploads sind je Konto begrenzt;
- Mediathek, Löschen und Bildprüfung nehmen die PNG-Fassung mit."""
import pathlib
import sys

import pytest
import pytest_asyncio
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from routes import phase_fg_routes, upload_routes  # noqa: E402
from services import account_erasure, image_upload, image_variants, media_scan, svg_logo  # noqa: E402

LOGO = (b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200" onload="alert(1)">'
        b'<script>alert(2)</script><rect x="100" y="50" width="200" height="100" fill="#29B6E8"/></svg>')
BROWSER = {"Sec-Fetch-Mode": "cors", "Sec-Fetch-Site": "same-origin"}
APP = {"User-Agent": "okhttp/4.12.0"}


@pytest_asyncio.fixture
async def flow(tmp_path, monkeypatch):
    public = tmp_path / "public"
    public.mkdir()
    for module in (upload_routes, svg_logo):
        monkeypatch.setattr(module, "PUBLIC_UPLOAD_DIR", public)
    monkeypatch.setattr(phase_fg_routes, "UPLOAD_DIR", tmp_path)
    monkeypatch.setattr(phase_fg_routes, "PUBLIC_UPLOAD_DIR", public)
    monkeypatch.setattr(account_erasure, "PUBLIC_UPLOAD_DIR", public)
    monkeypatch.setattr(account_erasure, "UPLOAD_DIR", tmp_path)
    monkeypatch.setattr(media_scan, "QUARANTINE_DIR", tmp_path / "quarantine")
    monkeypatch.setattr(media_scan, "auto_process", False)
    # Die kleineren Fassungen gleich bauen statt im Hintergrund - Windows sperrt eine offene Datei beim Löschen.
    monkeypatch.setattr(upload_routes, "schedule_variants", image_variants.build_all_variants)
    media_scan.fake_results.clear()
    instance, shutdown = make_flow()
    import server
    monkeypatch.setattr(server, "public_upload_dir", public)
    monkeypatch.setattr(server, "upload_dir", tmp_path)
    try:
        yield instance
    finally:
        await shutdown()
        media_scan.fake_results.clear()


def svg_file(name="logo.svg", body=LOGO, mime="image/svg+xml"):
    return {"file": (name, body, mime)}


async def web(flow, method: str, url: str, **kwargs):
    """Ein Abruf wie aus dem Browser (mit ``Sec-Fetch-Mode``) - der bekommt das SVG."""
    return await getattr(flow, method)(url, headers=BROWSER, **kwargs)


async def admin(flow):
    user = await flow.add_staff("Vorstand")
    flow.act_as(user)
    return user


@pytest.mark.asyncio
async def test_logo_upload_stores_the_clean_svg_and_a_png_next_to_it(flow, tmp_path):
    await admin(flow)
    response = await web(flow, "post", "/api/uploads/logo", files=svg_file())
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["url"].endswith(".svg") and result["mime"] == "image/svg+xml"
    assert result["raster_url"] == result["url"][:-4] + ".png"
    public = tmp_path / "public"
    stored = (public / result["filename"]).read_text(encoding="utf-8")
    assert "script" not in stored and "onload" not in stored and "<rect" in stored
    # Zugeschnitten wie ein Raster-Logo: die viewBox liegt um das Rechteck.
    x, y, w, h = (float(v) for v in stored.split('viewBox="', 1)[1].split('"', 1)[0].split())
    assert 80 < x < 100 and 30 < y < 50 and 200 < w < 240 and 100 < h < 140
    # Die PNG ist der Ausschnitt aus dem einen Bild mit RASTER_PX an der längeren Seite.
    with Image.open(public / result["filename"].replace(".svg", ".png")) as png:
        assert png.format == "PNG" and svg_logo.RASTER_PX // 2 < max(png.size) <= svg_logo.RASTER_PX
        assert abs(png.width / png.height - w / h) < 0.02
    row = await flow.db.media_uploads.find_one({"url": result["url"]}, {"_id": 0})
    assert row["mime"] == "image/svg+xml" and row["media_type"] == "image" and row["raster_url"] == result["raster_url"]
    assert row["media_scope"] == "branding"

    sponsor = await web(flow, "post", "/api/uploads/sponsor-logo", files=svg_file())
    assert sponsor.status_code == 200 and sponsor.json()["url"].endswith(".svg")


@pytest.mark.asyncio
async def test_svg_only_where_a_logo_belongs(flow):
    user = await flow.add_user(name="kapitaen")
    stranger = await flow.add_user(name="fremd")
    await flow.db.teams.insert_one({"id": "team-kiwi", "name": "Kiwi", "tag": "KIW", "leader_id": user["id"],
                                    "member_ids": [user["id"]]})
    flow.act_as(user)
    # Ein Schalter des Aufrufers öffnet nichts mehr: /uploads/image bleibt ohne SVG.
    switch = await web(flow, "post", "/api/uploads/image?allow_svg=true", files=svg_file())
    assert switch.status_code == 400 and switch.json()["detail"] == image_upload.SVG_REFUSED_MESSAGE
    # Teamlogo: nur die Leitung des Teams.
    team_logo = await web(flow, "post", "/api/uploads/team-logo?team_id=team-kiwi", files=svg_file())
    assert team_logo.status_code == 200, team_logo.text
    assert team_logo.json()["media_scope"] == "user" and team_logo.json()["url"].endswith(".svg")
    assert (await web(flow, "post", "/api/uploads/team-logo?team_id=fehlt", files=svg_file())).status_code == 404
    flow.act_as(stranger)
    foreign = await web(flow, "post", "/api/uploads/team-logo?team_id=team-kiwi", files=svg_file())
    assert foreign.status_code == 403
    flow.act_as(user)
    avatar = await web(flow, "post", "/api/uploads/image", files=svg_file())
    assert avatar.status_code == 400 and avatar.json()["detail"] == image_upload.SVG_REFUSED_MESSAGE
    disguised = await web(flow, "post", "/api/uploads/image", files=svg_file("logo.png", mime="image/png"))
    assert disguised.status_code == 400 and disguised.json()["detail"] == image_upload.SVG_REFUSED_MESSAGE
    await admin(flow)
    media = await web(flow, "post", "/api/uploads/media?media_scope=admin", files=svg_file())
    assert media.status_code == 400 and media.json()["detail"] == image_upload.SVG_REFUSED_MESSAGE
    # Als PNG getarnt, aber im Logo-Feld: wird als SVG erkannt und bereinigt.
    sniffed = await web(flow, "post", "/api/uploads/logo", files=svg_file("logo.png", mime="image/png"))
    assert sniffed.status_code == 200 and sniffed.json()["url"].endswith(".svg")


@pytest.mark.asyncio
async def test_refused_svg_says_why(flow):
    await admin(flow)
    xxe = (b'<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>'
           b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><text>&x;</text></svg>')
    response = await web(flow, "post", "/api/uploads/logo", files=svg_file(body=xxe))
    assert response.status_code == 400 and response.json()["detail"] == svg_logo.NO_DTD
    filler = b"x" * svg_logo.MAX_SVG_BYTES
    big = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><!--' + filler + b"--></svg>"
    response = await web(flow, "post", "/api/uploads/logo", files=svg_file(body=big))
    assert response.status_code == 413 and response.json()["detail"] == svg_logo.TOO_BIG
    assert await flow.db.media_uploads.count_documents({}) == 0


@pytest.mark.asyncio
async def test_svg_is_served_with_strict_headers(flow):
    await admin(flow)
    url = (await web(flow, "post", "/api/uploads/logo", files=svg_file())).json()["url"]
    flow.act_as(None)
    served = await flow.get(url, headers=BROWSER)
    assert served.status_code == 200
    assert served.headers["content-type"].startswith("image/svg+xml")
    assert served.headers["x-content-type-options"] == "nosniff"
    assert served.headers["content-security-policy"] == "default-src 'none'; style-src 'unsafe-inline'"
    raster = await flow.get(url[:-4] + ".png")
    assert raster.status_code == 200 and raster.headers["content-type"] == "image/png"


@pytest.mark.asyncio
async def test_the_app_gets_the_png_and_keeps_the_svg_when_saving_it_back(flow):
    await admin(flow)
    url = (await web(flow, "post", "/api/uploads/logo", files=svg_file())).json()["url"]
    png_url = url[:-4] + ".png"
    # Antworten auf Änderungen bleiben unverändert - auch für die App.
    created = await flow.post("/api/games", json={"name": "Probe Kiwi", "slug": "probe-kiwi", "logo_url": url},
                              headers=APP)
    assert created.status_code in (200, 201), created.text
    assert created.json()["logo_url"] == url
    browser = (await flow.get("/api/games", headers=BROWSER)).json()
    other = (await flow.get("/api/games")).json()
    app = (await flow.get("/api/games", headers=APP)).json()
    assert [game["logo_url"] for game in browser if game["slug"] == "probe-kiwi"] == [url]
    assert [game["logo_url"] for game in other if game["slug"] == "probe-kiwi"] == [url]
    assert [game["logo_url"] for game in app if game["slug"] == "probe-kiwi"] == [png_url]
    assert [game["logo_url"] for game in (await flow.get("/api/games", headers={"X-LionsApp": "1.8.0"})).json()
            if game["slug"] == "probe-kiwi"] == [png_url]

    # Branding: die App liest die PNG, schickt das Formular zurück - gespeichert bleibt das SVG.
    saved = await flow.put("/api/settings/branding", json={"logo_url": png_url, "favicon_url": url}, headers=APP)
    assert saved.status_code == 200, saved.text
    branding = await flow.db.settings.find_one({"id": "branding"})
    assert branding["logo_url"] == url and branding["favicon_url"] == url

    leader = await flow.add_user(name="kapitaen")
    team = {"id": "team-kiwi", "name": "Kiwi", "tag": "KIW", "leader_id": leader["id"], "member_ids": [leader["id"]],
            "logo_url": url}
    await flow.db.teams.insert_one(dict(team))
    flow.act_as(leader)
    saved = await flow.put("/api/teams/team-kiwi", json={"name": "Kiwi", "logo_url": png_url}, headers=APP)
    assert saved.status_code == 200, saved.text
    assert (await flow.db.teams.find_one({"id": "team-kiwi"}))["logo_url"] == url
    other = await flow.put("/api/teams/team-kiwi", json={"logo_url": "/api/static/uploads/anderes.png"})
    assert other.status_code == 200
    assert (await flow.db.teams.find_one({"id": "team-kiwi"}))["logo_url"] == "/api/static/uploads/anderes.png"


@pytest.mark.asyncio
async def test_media_library_hides_the_png_and_delete_takes_both(flow, tmp_path):
    await admin(flow)
    result = (await web(flow, "post", "/api/uploads/logo", files=svg_file())).json()
    items = (await web(flow, "get", "/api/admin/media?type=images")).json()
    names = [item["filename"] for item in items]
    assert result["filename"] in names and result["filename"].replace(".svg", ".png") not in names
    deleted = await web(flow, "delete", f"/api/admin/media/{result['filename']}?force=true")
    assert deleted.status_code == 200, deleted.text
    assert not list((tmp_path / "public").glob(result["filename"].replace(".svg", ".*")))


@pytest.mark.asyncio
async def test_image_check_scans_the_png_and_quarantines_both(flow, tmp_path):
    await admin(flow)
    result = (await web(flow, "post", "/api/uploads/logo", files=svg_file())).json()
    stem = result["filename"][:-4]
    media_scan.fake_results.append({"scores": {"nudity": 0.99, "violence": 0.0, "racy": 0.0}})
    await media_scan.process_pending()
    doc = await flow.db.media_scans.find_one({"url": result["url"]}, {"_id": 0})
    assert doc["state"] == "blocked"
    quarantine = tmp_path / "quarantine"
    assert (quarantine / f"{doc['id']}.svg").is_file() and (quarantine / f"{doc['id']}.png").is_file()
    assert not list((tmp_path / "public").glob(f"{stem}.*"))
    assert media_scan.preview_path(doc) == quarantine / f"{doc['id']}.png"
    flow.act_as(None)
    placeholder = await flow.get(result["raster_url"])
    assert placeholder.status_code == 200 and placeholder.headers.get("x-tls-placeholder") == "1"


@pytest.mark.asyncio
async def test_app_icons_and_series_logo_take_the_svg_and_point_to_the_png(flow):
    await admin(flow)
    url = (await web(flow, "post", "/api/uploads/logo", files=svg_file())).json()["url"]
    await flow.db.settings.insert_one({"id": "branding", "favicon_url": url, "favicon_light_url": url})
    manifest = (await flow.get("/api/manifest.webmanifest")).json()
    sources = {icon["src"] for icon in manifest["icons"]}
    assert url[:-4] + ".png" in sources and url not in sources
    assert {icon["type"] for icon in manifest["icons"] if icon["src"] == url[:-4] + ".png"} == {"image/png"}
    from services import series_logo
    assert series_logo.clean(url) == url


@pytest.mark.asyncio
async def test_an_svg_address_is_refused_outside_logo_fields(flow):
    await admin(flow)
    url = (await web(flow, "post", "/api/uploads/logo", files=svg_file())).json()["url"]
    user = await flow.add_user(name="kapitaen")
    await flow.db.teams.insert_one({"id": "team-kiwi", "name": "Kiwi", "tag": "KIW", "leader_id": user["id"],
                                    "member_ids": [user["id"]]})
    flow.act_as(user)
    for body in ({"avatar_url": url}, {"banner_url": f"https://lionsquad.example{url}"}):
        refused = await flow.put("/api/users/me", json=body)
        assert refused.status_code == 422 and refused.json()["detail"] == svg_logo.FIELD_REFUSED, body
    assert (await flow.db.users.find_one({"id": user["id"]})).get("avatar_url") in (None, "")
    raster = await flow.put("/api/users/me", json={"avatar_url": url[:-4] + ".png"})
    assert raster.status_code == 200, raster.text
    assert (await flow.put("/api/teams/team-kiwi", json={"banner_url": url})).status_code == 422
    assert (await flow.put("/api/teams/team-kiwi", json={"logo_url": url})).status_code == 200
    await admin(flow)
    assert (await flow.put("/api/settings/branding", json={"share_banner_url": url})).status_code == 422
    assert (await flow.put("/api/settings/branding", json={"mascot_url": url})).status_code == 200


@pytest.mark.asyncio
async def test_too_expensive_svg_gets_422_and_svg_uploads_are_limited_per_account(flow, monkeypatch):
    await admin(flow)
    monkeypatch.setattr(svg_logo, "RASTER_TIMEOUT_SECONDS", 1.5)
    heavy = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">'
             + "".join(f'<rect width="1000" height="1000" fill="#{i % 9}{i % 7}{i % 5}" opacity="0.5"/>'
                       for i in range(3900)) + "</svg>").encode()
    response = await web(flow, "post", "/api/uploads/logo", files=svg_file(body=heavy))
    assert response.status_code == 422 and response.json()["detail"] == svg_logo.TOO_COMPLEX
    assert await flow.db.media_uploads.count_documents({}) == 0
    monkeypatch.setattr(svg_logo, "SVG_UPLOAD_RATE_LIMIT", 2)
    statuses = [(await web(flow, "post", "/api/uploads/logo", files=svg_file())).status_code for _ in range(2)]
    assert statuses == [200, 429]


@pytest.mark.asyncio
async def test_existing_records_stay_saveable_and_encoded_svg_is_refused(flow, tmp_path):
    await admin(flow)
    url = (await web(flow, "post", "/api/uploads/logo", files=svg_file())).json()["url"]
    stem = url.rsplit("/", 1)[1][:-4]
    # Ein älteres SVG ohne PNG-Fassung (frühere Bild-Migration) und ein Rich-Text mit SVG-Bildern bleiben speicherbar.
    (tmp_path / "public" / "altlast.svg").write_bytes(b"<svg/>")
    text = f"Partner ![Icon](/api/static/uploads/altlast.svg) und ![Logo]({url})"
    created = await flow.post("/api/news", json={"title": "Probe", "content": text})
    assert created.status_code in (200, 201), created.text
    news_id = created.json()["id"]
    updated = await flow.put(f"/api/news/{news_id}", json={"title": "Probe 2", "content": text})
    assert updated.status_code == 200, updated.text
    user = await flow.add_user(name="altkonto")
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"avatar_url": "/api/static/uploads/altlast.svg"}})
    flow.act_as(user)
    kept = await flow.put("/api/users/me", json={"avatar_url": "/api/static/uploads/altlast.svg", "bio": "Hallo"})
    assert kept.status_code == 200, kept.text
    # Ein SVG-Logo, kodiert oder als data-URI, kommt trotzdem nicht in ein Bildfeld.
    for value in (f"/api/static/uploads/{stem}%2Esvg", f"/api/static/uploads/{stem}.%73vg?w=1",
                  "data: image/svg+xml;base64,PHN2Zz48L3N2Zz4="):
        refused = await flow.put("/api/users/me", json={"avatar_url": value})
        assert refused.status_code == 422, value
    assert (await flow.db.users.find_one({"id": user["id"]}))["avatar_url"] == "/api/static/uploads/altlast.svg"


@pytest.mark.asyncio
async def test_branding_logo_takes_no_embedded_svg(flow):
    await admin(flow)
    inline = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cscript%3E%3C/script%3E%3C/svg%3E"
    refused = await flow.put("/api/settings/branding", json={"logo_url": inline})
    assert refused.status_code == 422 and refused.json()["detail"] == svg_logo.INLINE_REFUSED
    assert ((await flow.db.settings.find_one({"id": "branding"})) or {}).get("logo_url") != inline
