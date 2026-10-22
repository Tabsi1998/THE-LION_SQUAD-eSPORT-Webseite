"""Original-Bilder des Veranstalters je Termin (#1933) über die echten Routen.

Geprüft: neu kodiert als WebP ohne EXIF und Ort; nur echte Bilder (Inhalt, nicht Endung); Größe und Rate-Limit;
öffentlich nur, was öffentlich und freigegeben ist und zu einem veröffentlichten Termin einer sichtbaren Saison gehört;
Captain-Bilder erst mit der Freigabe; ein gelesenes Bild wird erst beim Übernehmen angehängt; Bilder bleiben beim
Verschieben und Archivieren; Löschen nur durch den Vorstand mit Protokoll. Nur erfundene Namen und erzeugte Bilder.
Aufrufe, die etwas ändern, stehen nie in einem ``assert`` (erst aufrufen, dann prüfen).
"""
import io
import pathlib
import sys
from datetime import date, timedelta

import pytest
import pytest_asyncio
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import result_image_fixture as fixture  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from routes import reference_original_routes  # noqa: E402
from services import migrations, reference_originals, reference_running_cache, result_image_ocr  # noqa: E402
from services.dolibarr_policy import club_today  # noqa: E402
from services.result_image_ocr import Read, Reading, RowReading  # noqa: E402

ADMIN = "/api/reference-series/admin"
PUBLIC = "/api/reference-series/public"
JPEG = {"Content-Type": "image/jpeg"}
PNG = {"Content-Type": "image/png"}
SOURCE = "https://veranstalter.example/r1"


@pytest_asyncio.fixture
async def flow(tmp_path, monkeypatch):
    # Das Rate-Limit schlüsselt das Konto mit dem Server-Geheimnis (``keyed_subject``).
    monkeypatch.setenv("JWT_SECRET", "originals-tests-secret-with-32-characters!")
    monkeypatch.setattr(reference_originals, "ORIGINAL_DIR", tmp_path / "reference-originals")
    reference_running_cache.reset()
    instance, shutdown = make_flow()
    await instance.db.mutation_locks.create_index("resource", unique=True)
    try:
        yield instance
    finally:
        await shutdown()


def _day(offset: int) -> str:
    return (date.fromisoformat(club_today()) + timedelta(days=offset)).isoformat()


def jpeg_with_gps(size=(1200, 500)) -> bytes:
    exif = Image.Exif()
    exif[0x010F] = "Probe-Telefon"
    exif[0x8825] = {1: "N", 2: (48.0, 12.0, 30.0), 3: "E", 4: (16.0, 22.0, 10.0)}
    buffer = io.BytesIO()
    Image.new("RGB", size, (30, 120, 200)).save(buffer, format="JPEG", exif=exif.tobytes())
    return buffer.getvalue()


def png(size=(400, 200), color=(20, 20, 30)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, color).save(buffer, format="PNG")
    return buffer.getvalue()


async def _setup(flow, *, kind: str = "racing"):
    await migrations.migrate_points_scheme_templates(flow.db)
    board = await flow.add_user(name="vorstand-vera")
    await flow.db.users.update_one({"id": board["id"]}, {"$set": {"areas": ["content"]}})
    board["areas"] = ["content"]
    flow.act_as(board)
    lineage = (await flow.post(f"{ADMIN}/lineages", json={"title": "Probe Liga", "kind": kind, "label": "F2"})).json()
    series = (await flow.post(f"{ADMIN}/series", json={
        "lineage_id": lineage["id"], "season": "2026", "status": "active", "points_scheme_id": "formula_1"})).json()
    race = (await flow.post(f"{ADMIN}/series/{series['id']}/rounds",
                            json={"day": _day(-7), "code": "R1", "venue": "Probering Nord"})).json()
    later = (await flow.post(f"{ADMIN}/series/{series['id']}/rounds",
                             json={"day": _day(7), "code": "R2", "venue": "Probering Süd"})).json()
    for name, number in (("Anna Probe", "7"), ("Bert Bolzt", "12")):
        added = await flow.post(f"{ADMIN}/series/{series['id']}/participants",
                                json={"name": name, "start_number": number})
        assert added.status_code == 200, added.text
    captain = await flow.add_user(name="captain-carla")
    await flow.db.memberships.insert_one({"user_id": captain["id"], "member_status": "active"})
    staff = await flow.post(f"{ADMIN}/series/{series['id']}/staff",
                            json={"user_id": captain["id"], "valid_until": _day(30)})
    assert staff.status_code == 200, staff.text
    stranger = await flow.add_user(name="fremd-fritz")
    return {"board": board, "captain": captain, "stranger": stranger, "lineage": lineage, "series": series,
            "race": race, "later": later}


def _url(ctx, round_doc=None) -> str:
    return f"{ADMIN}/series/{ctx['series']['id']}/rounds/{(round_doc or ctx['race'])['id']}/originals"


def _results_url(ctx, round_doc=None) -> str:
    return f"{ADMIN}/series/{ctx['series']['id']}/rounds/{(round_doc or ctx['race'])['id']}/results"


def _public(ctx) -> str:
    return f"{PUBLIC}/{ctx['lineage']['slug']}/{ctx['series']['season_slug']}"


async def _upload(flow, ctx, content=None, *, round_doc=None, headers=None, **params):
    return await flow.post(_url(ctx, round_doc), params=params or {"kind": "race"}, content=content or jpeg_with_gps(),
                           headers=headers or JPEG)


async def _patch(flow, ctx, image_id: str, body: dict):
    return await flow.patch(f"{_url(ctx)}/{image_id}", json=body)


async def _results(flow, ctx, *, status="published", round_doc=None, expected=0, names=("Anna Probe", "Bert Bolzt")):
    rows = [{"place": place, "name": name} for place, name in enumerate(names, start=1)]
    body = {"rows": rows, "status": status, "expected_version": expected}
    saved = await flow.put(_results_url(ctx, round_doc), json=body)
    assert saved.status_code == 200, saved.text
    return saved.json()


async def _public_originals(flow, ctx) -> dict:
    page = await flow.get(_public(ctx))
    assert page.status_code == 200, page.text
    return page.json()["originals"]


async def _status(flow, url: str, **kwargs) -> int:
    """Nur für Lese-Aufrufe (GET)."""
    return (await flow.get(url, **kwargs)).status_code


# ---------------------------------------------------------------- Ablage
@pytest.mark.asyncio
async def test_upload_is_reencoded_as_webp_without_exif_and_location(flow):
    ctx = await _setup(flow)
    uploaded = await _upload(flow, ctx)
    assert uploaded.status_code == 200, uploaded.text
    item = uploaded.json()
    assert (item["kind"], item["public"], item["state"], item["origin"]) == ("race", True, "released", "upload")
    assert (item["width"], item["height"]) == (1200, 500)
    stored = await flow.db.reference_round_originals.find_one({"id": item["id"]}, {"_id": 0})
    assert stored["mime"] == "image/webp" and stored["round_id"] == ctx["race"]["id"]
    saved = reference_originals.ORIGINAL_DIR / stored["storage_key"]
    with Image.open(saved) as image:
        assert image.format == "WEBP"
        assert dict(image.getexif()) == {}, "neu kodiert - kein EXIF, kein GPS-Ort"
        assert "exif" not in image.info
    assert "/static/uploads" not in item["url"], "nie eine öffentliche Upload-Adresse"

    # Vorschaubild: eine kleinere Fassung für die Liste.
    thumb = await flow.get(item["url"], params={"w": 400})
    assert thumb.status_code == 200 and thumb.headers["content-type"] == "image/webp"
    assert "no-store" in thumb.headers["cache-control"]
    with Image.open(io.BytesIO(thumb.content)) as image:
        assert image.width == 400
    listed = (await flow.get(_url(ctx))).json()
    assert [row["id"] for row in listed["items"]] == [item["id"]]
    assert listed["max_mb"] == reference_originals.MAX_IMAGE_UPLOAD_MB and listed["can_delete"] is True


@pytest.mark.asyncio
async def test_only_real_images_and_limited_size(flow, monkeypatch):
    ctx = await _setup(flow)
    gif = io.BytesIO()
    Image.new("RGB", (80, 80), (0, 0, 0)).save(gif, format="GIF")
    svg = b'<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"></svg>'
    for content, headers in ((gif.getvalue(), {"Content-Type": "image/gif"}), (svg, PNG),
                             (b"kein Bild, nur Text", PNG), (b"\x89PNG\r\n\x1a\n kaputt", PNG)):
        refused = await _upload(flow, ctx, content, headers=headers)
        assert refused.status_code == 400, refused.text
    # Der angegebene Typ zählt nicht - ein PNG als „octet-stream“ ist ein Bild.
    taken = await _upload(flow, ctx, png(), headers={"Content-Type": "application/octet-stream"})
    assert taken.status_code == 200, taken.text

    monkeypatch.setattr(reference_originals, "MAX_BYTES", 2000)
    too_big = await _upload(flow, ctx, jpeg_with_gps())
    assert too_big.status_code == 413, too_big.text

    unknown_kind = await flow.post(_url(ctx), params={"kind": "erfunden"}, content=png(), headers=PNG)
    map_on_race = await flow.post(_url(ctx), params={"kind": "race", "map": 2}, content=png(), headers=PNG)
    assert (unknown_kind.status_code, map_on_race.status_code) == (422, 422)
    assert await flow.db.reference_round_originals.count_documents({}) == 1


@pytest.mark.asyncio
async def test_upload_is_rate_limited_per_account(flow, monkeypatch):
    ctx = await _setup(flow)
    monkeypatch.setattr(reference_original_routes, "RATE_LIMIT", 2)
    first = await _upload(flow, ctx, png())
    second = await _upload(flow, ctx, png())
    limited = await _upload(flow, ctx, png())
    assert (first.status_code, second.status_code) == (200, 200)
    assert limited.status_code == 429, limited.text


@pytest.mark.asyncio
async def test_rights_follow_the_result_sheet(flow):
    ctx = await _setup(flow)
    flow.act_as(ctx["stranger"])
    stranger = await _upload(flow, ctx, png())
    assert stranger.status_code == 403 and await _status(flow, _url(ctx)) == 403
    flow.act_as(None)
    anonymous = await _upload(flow, ctx, png())
    assert anonymous.status_code == 401
    flow.act_as(ctx["board"])
    foreign = await flow.post(f"{ADMIN}/series/{ctx['series']['id']}/rounds/gibt-es-nicht/originals",
                              params={"kind": "race"}, content=png(), headers=PNG)
    assert foreign.status_code == 404
    assert await flow.db.reference_round_originals.count_documents({}) == 0


# ---------------------------------------------------------------- Öffentlich
@pytest.mark.asyncio
async def test_public_only_shows_public_released_images_of_published_rounds(flow):
    ctx = await _setup(flow)
    race = (await _upload(flow, ctx, kind="race")).json()
    table = (await _upload(flow, ctx, png(), kind="table")).json()
    board_view = await _patch(flow, ctx, table["id"], {"public": False, "source_url": SOURCE})
    assert board_view.status_code == 200, board_view.text
    assert (board_view.json()["public"], board_view.json()["source_url"]) == (False, SOURCE)

    flow.act_as(None)
    assert await _public_originals(flow, ctx) == {}, "ohne veröffentlichtes Ergebnis nichts"
    assert await _status(flow, f"{_public(ctx)}/originals/{race['id']}") == 404

    flow.act_as(ctx["board"])
    await _results(flow, ctx)
    flow.act_as(None)
    shown = await _public_originals(flow, ctx)
    assert list(shown) == [ctx["race"]["id"]]
    assert [(item["id"], item["kind"]) for item in shown[ctx["race"]["id"]]] == [(race["id"], "race")]
    item = shown[ctx["race"]["id"]][0]
    assert item["url"] == f"{_public(ctx)}/originals/{race['id']}"
    assert "created_by" not in item and "storage_key" not in item
    picture = await flow.get(item["url"])
    assert picture.status_code == 200 and picture.headers["content-type"] == "image/webp"
    assert picture.headers["x-content-type-options"] == "nosniff"
    assert await _status(flow, f"{_public(ctx)}/originals/{table['id']}") == 404, "nur Verwaltung"

    # Rundenseite (#1950): je Lauf die Originale.
    page = (await flow.get(f"{_public(ctx)}/rounds/1")).json()
    assert [entry["id"] for entry in page["sessions"][0]["originals"]] == [race["id"]]

    # Unveröffentlichte Saison: nichts mehr, auch nicht über die Adresse des Bilds.
    flow.act_as(ctx["board"])
    hidden = await flow.patch(f"{ADMIN}/series/{ctx['series']['id']}", json={"visibility": "internal"})
    assert hidden.status_code == 200, hidden.text
    flow.act_as(None)
    assert await _status(flow, _public(ctx)) == 404
    assert await _status(flow, f"{_public(ctx)}/originals/{race['id']}") == 404


@pytest.mark.asyncio
async def test_a_hidden_name_in_the_result_keeps_the_original_inside(flow):
    ctx = await _setup(flow)
    race = (await _upload(flow, ctx)).json()
    await _results(flow, ctx)
    await flow.db.reference_participants.update_one({"series_id": ctx["series"]["id"], "name": "Bert Bolzt"},
                                                    {"$set": {"name_hidden": True}})
    flow.act_as(None)
    assert await _public_originals(flow, ctx) == {}
    assert await _status(flow, f"{_public(ctx)}/originals/{race['id']}") == 404
    flow.act_as(ctx["board"])
    listed = (await flow.get(_url(ctx))).json()["items"]
    assert listed[0]["shown"] is False and listed[0]["hidden_reason"] == "hidden_name"


@pytest.mark.asyncio
async def test_a_hidden_name_anywhere_in_the_season_keeps_season_wide_pictures_inside(flow):
    """Tabelle, Scoreboard und Sonstiges zeigen mehr als das Ergebnis des Termins (etwa die ganze Saison) - ist irgendwo
    in der Saison ein Name ausgeblendet, bleiben sie intern. Ein Rennergebnis zählt nur die Namen seines Blatts."""
    ctx = await _setup(flow)
    later = ctx["later"]
    await _results(flow, ctx)  # R1: Anna und Bert
    await _results(flow, ctx, round_doc=later, names=("Anna Probe",))  # R2: nur Anna
    race = (await _upload(flow, ctx, png(), round_doc=later, kind="race")).json()
    pictures = {kind: (await _upload(flow, ctx, png(color=(index, 0, 0)), round_doc=later, **params)).json()
                for index, (kind, params) in enumerate((("table", {"kind": "table"}), ("other", {"kind": "other"}),
                                                       ("scoreboard", {"kind": "scoreboard", "map": 1})), start=1)}
    flow.act_as(None)
    assert len((await _public_originals(flow, ctx))[later["id"]]) == 4, "vorher ist alles öffentlich"

    # Bert fuhr nur in R1 - sein Name wird ausgeblendet.
    await flow.db.reference_participants.update_one({"series_id": ctx["series"]["id"], "name": "Bert Bolzt"},
                                                    {"$set": {"name_hidden": True}})
    shown = await _public_originals(flow, ctx)
    assert [item["id"] for item in shown[later["id"]]] == [race["id"]], "nur das Rennergebnis ohne Bert bleibt"
    for picture in pictures.values():
        assert await _status(flow, f"{_public(ctx)}/originals/{picture['id']}") == 404
    assert await _status(flow, f"{_public(ctx)}/originals/{race['id']}") == 200
    flow.act_as(ctx["board"])
    listed = {item["id"]: item for item in (await flow.get(_url(ctx, later))).json()["items"]}
    assert listed[race["id"]]["shown"] is True
    assert {listed[picture["id"]]["hidden_reason"] for picture in pictures.values()} == {"hidden_name"}


# ---------------------------------------------------------------- Captains und Freigabe
@pytest.mark.asyncio
async def test_captain_images_are_drafts_until_the_result_is_released(flow):
    ctx = await _setup(flow)
    flow.act_as(ctx["captain"])
    drafted = await _upload(flow, ctx, png(), kind="race")
    assert drafted.status_code == 200, drafted.text
    image = drafted.json()
    assert image["state"] == "draft" and "created_by" not in image and image["mine"] is True
    await _results(flow, ctx, status="draft")
    # Eigene Entwürfe darf der Captain noch einordnen - freigeben und löschen nicht.
    sorted_in = await _patch(flow, ctx, image["id"], {"kind": "table"})
    released_by_captain = await _patch(flow, ctx, image["id"], {"release": True})
    deleted_by_captain = await flow.delete(f"{_url(ctx)}/{image['id']}")
    assert (sorted_in.status_code, released_by_captain.status_code, deleted_by_captain.status_code) == (200, 403, 403)

    flow.act_as(ctx["board"])
    approved = await flow.post(f"{_results_url(ctx)}/approve", json={"expected_version": 1})
    assert approved.status_code == 200, approved.text
    stored = await flow.db.reference_round_originals.find_one({"id": image["id"]}, {"_id": 0})
    assert stored["state"] == "released" and stored["released_by"] == ctx["board"]["id"]
    log = await flow.db.audit_logs.find_one({"action": "reference_result.approve"}, {"_id": 0})
    assert log["data"]["released_originals"] == 1
    flow.act_as(None)
    assert [item["id"] for item in (await _public_originals(flow, ctx))[ctx["race"]["id"]]] == [image["id"]]

    # Ein weiteres Bild zum schon veröffentlichten Ergebnis: Entwurf, bis der Vorstand es einzeln freigibt.
    flow.act_as(ctx["captain"])
    later = (await _upload(flow, ctx, png(color=(200, 0, 0)), kind="table")).json()
    assert later["state"] == "draft"
    changed_released = await _patch(flow, ctx, image["id"], {"kind": "race"})
    assert changed_released.status_code == 403, "freigegebene Bilder ändert nur der Vorstand"
    flow.act_as(None)
    assert len((await _public_originals(flow, ctx))[ctx["race"]["id"]]) == 1
    flow.act_as(ctx["board"])
    released = await _patch(flow, ctx, later["id"], {"release": True})
    assert released.status_code == 200 and released.json()["state"] == "released"
    flow.act_as(None)
    assert len((await _public_originals(flow, ctx))[ctx["race"]["id"]]) == 2


@pytest.mark.asyncio
async def test_publishing_the_sheet_releases_drafts_of_the_round(flow):
    ctx = await _setup(flow)
    flow.act_as(ctx["captain"])
    image = (await _upload(flow, ctx, png())).json()
    flow.act_as(ctx["board"])
    await _results(flow, ctx)
    stored = await flow.db.reference_round_originals.find_one({"id": image["id"]}, {"_id": 0})
    assert stored["state"] == "released"


# ---------------------------------------------------------------- Bild-Erkennung
def _fake_reading() -> Reading:
    def read(text):
        return Read(text, 95, [(word, 95) for word in text.split()])
    rows = [RowReading(cells={"place": read(str(index)), "start_number": read(number), "name": read(name),
                              "time": read(f"1:3{index}.123")})
            for index, (name, number) in enumerate((("Anna Probe", "7"), ("Bert Bolzt", "12")), start=1)]
    return Reading(template_id="rennliga-dunkel", rows=rows, header_found=True, text_height=20, mean_conf=95,
                   header={"track": read("Probering Nord")})


@pytest.mark.asyncio
async def test_a_read_image_is_attached_when_taken_over_not_when_read(flow, monkeypatch):
    ctx = await _setup(flow)
    monkeypatch.setattr(result_image_ocr, "available", lambda: True)
    monkeypatch.setattr(result_image_ocr, "read", lambda image, template, *, max_rows=None: _fake_reading())
    screenshot = fixture.png_bytes(fixture.render())
    read = await flow.post(f"{_results_url(ctx)}/image", content=screenshot, headers=PNG)
    assert read.status_code == 200, read.text
    assert await flow.db.reference_round_originals.count_documents({}) == 0, "Lesen allein speichert nichts"
    assert not reference_originals.ORIGINAL_DIR.exists() or not any(reference_originals.ORIGINAL_DIR.iterdir())

    # Übernehmen: die Oberfläche hängt dasselbe Bild nach dem Speichern als Original an.
    await _results(flow, ctx)
    attached = await _upload(flow, ctx, screenshot, headers=PNG, kind="race", origin="reading")
    assert attached.status_code == 200, attached.text
    assert attached.json()["origin"] == "reading"


# ---------------------------------------------------------------- Termin verschieben und archivieren
@pytest.mark.asyncio
async def test_images_move_with_a_postponed_round_and_survive_archiving(flow):
    ctx = await _setup(flow)
    image = (await _upload(flow, ctx, png(), round_doc=ctx["later"])).json()
    calendar = f"{ADMIN}/series/{ctx['series']['id']}/rounds/{ctx['later']['id']}"
    moved = await flow.post(f"{calendar}/postpone", json={"day": _day(14)})
    assert moved.status_code == 200, moved.text
    assert [row["id"] for row in (await flow.get(_url(ctx, ctx["later"]))).json()["items"]] == [image["id"]]

    archived = await flow.post(f"{calendar}/archive")
    assert archived.status_code == 200, archived.text
    assert await flow.db.reference_round_originals.count_documents({"round_id": ctx["later"]["id"]}) == 1
    stored = await flow.db.reference_round_originals.find_one({"id": image["id"]}, {"_id": 0})
    assert (reference_originals.ORIGINAL_DIR / stored["storage_key"]).is_file()
    refused = await _upload(flow, ctx, png(), round_doc=ctx["later"])
    assert refused.status_code == 409, "an einen archivierten Termin kommt kein neues Bild"

    restored = await flow.post(f"{calendar}/restore")
    assert restored.status_code == 200, restored.text
    await _results(flow, ctx, round_doc=ctx["later"])
    flow.act_as(None)
    assert [item["id"] for item in (await _public_originals(flow, ctx))[ctx["later"]["id"]]] == [image["id"]]


# ---------------------------------------------------------------- Löschen
@pytest.mark.asyncio
async def test_only_the_board_deletes_and_it_is_logged(flow):
    ctx = await _setup(flow)
    image = (await _upload(flow, ctx)).json()
    stored = await flow.db.reference_round_originals.find_one({"id": image["id"]}, {"_id": 0})
    path = reference_originals.ORIGINAL_DIR / stored["storage_key"]
    assert await _status(flow, image["url"], params={"w": 400}) == 200
    for user in (ctx["captain"], ctx["stranger"]):
        flow.act_as(user)
        refused = await flow.delete(f"{_url(ctx)}/{image['id']}")
        assert refused.status_code == 403
    assert path.is_file()

    flow.act_as(ctx["board"])
    removed = await flow.delete(f"{_url(ctx)}/{image['id']}")
    assert removed.status_code == 200, removed.text
    assert await flow.db.reference_round_originals.count_documents({}) == 0
    assert not path.exists() and not any(path.parent.rglob(f"{path.stem}*")), "Datei und Vorschaubilder weg"
    log = await flow.db.audit_logs.find_one({"action": "reference_original.delete"}, {"_id": 0})
    assert log["actor_id"] == ctx["board"]["id"] and log["target_id"] == image["id"]
    assert (log["data"]["round_id"], log["data"]["kind"]) == (ctx["race"]["id"], "race")
    again = await flow.delete(f"{_url(ctx)}/{image['id']}")
    assert again.status_code == 404


@pytest.mark.asyncio
async def test_source_link_must_be_https_and_map_only_on_scoreboards(flow):
    ctx = await _setup(flow)
    image = (await _upload(flow, ctx, png())).json()
    for link in ("http://veranstalter.example/r1", "javascript:alert(1)", "https://", "https://bei spiel.example",
                 "//veranstalter.example/r1", "https://veranstalter.example/\nr1"):
        refused = await _patch(flow, ctx, image["id"], {"source_url": link})
        assert refused.status_code == 422, link
    cleared = await _patch(flow, ctx, image["id"], {"source_url": ""})
    assert cleared.status_code == 200 and cleared.json()["source_url"] is None
    scoreboard = await _patch(flow, ctx, image["id"], {"kind": "scoreboard", "map": 2})
    assert (scoreboard.json()["kind"], scoreboard.json()["map"]) == ("scoreboard", 2)
    too_far = await _patch(flow, ctx, image["id"], {"map": 99})
    assert too_far.status_code == 422
    # Eine andere Art nimmt die Map-Nummer mit.
    back = await _patch(flow, ctx, image["id"], {"kind": "race"})
    assert (back.json()["kind"], back.json()["map"]) == ("race", None)


# ---------------------------------------------------------------- Mediathek
@pytest.mark.asyncio
async def test_media_library_counts_the_originals(flow):
    ctx = await _setup(flow)
    first = (await _upload(flow, ctx)).json()
    await _upload(flow, ctx, png())
    audit = await flow.get("/api/admin/media/audit")
    assert audit.status_code == 200, audit.text
    counted = audit.json()["reference_originals"]
    sizes = [row["size"] async for row in flow.db.reference_round_originals.find({}, {"_id": 0, "size": 1})]
    assert counted == {"count": 2, "bytes": sum(sizes)}
    assert first["size"] in sizes
