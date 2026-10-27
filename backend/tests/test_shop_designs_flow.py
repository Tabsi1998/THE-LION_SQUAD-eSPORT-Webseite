"""Designs und Druckdateien des Vereins (#1708): Upload nur für Finanzen mit Zwei-Faktor, neu kodiert ohne Metadaten,
geprüft je Platzierung (Zoll und cm), jede Datei eine neue Version mit eigener, nicht erratbarer Adresse für Printful.

Durch die echte Anwendung (flow_harness). Alle Bilder entstehen hier synthetisch - keine echten Vereinsbilder."""
import hashlib
import pathlib
import sys
from io import BytesIO

import pytest
import pytest_asyncio
from PIL import Image, ImageDraw
from PIL.PngImagePlugin import PngInfo

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402

BASE = "/api/admin/shop"
NEW = {"title": "Löwe weiß", "placement": "front_right", "garment_colors": "Schwarz, Navy"}
SECRET_TEXT = "Geheim-Testperson-Standort"


@pytest_asyncio.fixture
async def flow(tmp_path, monkeypatch):
    import storage
    from services import shop_schema

    monkeypatch.setattr(storage, "SHOP_DESIGN_DIR", tmp_path / "shop-designs")
    instance, shutdown = make_flow()
    try:
        await shop_schema.apply(instance.db)
        instance.design_dir = tmp_path / "shop-designs"
        yield instance
    finally:
        await shutdown()


def logo(width: int, height: int, *, mode: str = "RGBA", fmt: str = "PNG", **save) -> bytes:
    """Ein weißes Rechteck mit Rand als „Logo“ - mit durchsichtigem Hintergrund, solange der Modus es kann."""
    background = (0, 0, 0, 0) if mode == "RGBA" else (40, 40, 40)
    img = Image.new(mode, (width, height), background)
    ImageDraw.Draw(img).rectangle((width // 8, height // 8, width * 7 // 8, height * 7 // 8),
                                  fill=(255, 255, 255, 255) if mode == "RGBA" else (255, 255, 255))
    out = BytesIO()
    img.save(out, format=fmt, **save)
    return out.getvalue()


async def finance(flow) -> dict:
    user = await flow.add_user(role="player", name="kassier")
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"areas": ["finance"]}})
    user["areas"] = ["finance"]
    flow.act_as(user)
    return user


async def upload(flow, data: bytes, *, key: str = "loewe-weiss", reason: str = "Druckdatei vom Obmann",
                 filename: str = "loewe.png", content_type: str = "image/png", **form):
    return await flow.post(f"{BASE}/designs/upload", data={"design_key": key, "reason": reason, **form},
                           files={"file": (filename, data, content_type)})


def stored_files(flow) -> list[pathlib.Path]:
    return sorted(flow.design_dir.glob("*")) if flow.design_dir.exists() else []


def design(answer, key: str = "loewe-weiss") -> dict:
    return next(item for item in answer.json()["designs"] if item["design_key"] == key)


# ---------------------------------------------------------------- Prüfung je Platzierung

@pytest.mark.asyncio
async def test_a_file_too_small_for_the_print_width_is_refused_in_inches_and_cm(flow):
    await finance(flow)
    answer = await upload(flow, logo(300, 300), **NEW)
    assert answer.status_code == 400, answer.text
    detail = answer.json()["detail"]
    assert "bei 3,5 Zoll (8,9 cm) Breite hat die Datei nur 85 DPI, nötig sind 300" in detail
    assert "mindestens 1050 Pixel" in detail
    assert await flow.db.shop_designs.count_documents({}) == 0
    assert await flow.db.shop_design_profiles.count_documents({}) == 0
    assert await flow.db.audit_logs.count_documents({}) == 0
    assert stored_files(flow) == []


@pytest.mark.asyncio
async def test_exactly_enough_pixels_pass_and_a_too_tall_motif_is_refused(flow):
    await finance(flow)
    assert (await upload(flow, logo(1050, 1050), **NEW)).status_code == 200
    tall = await upload(flow, logo(1050, 2000), key="loewe-hoch", **{**NEW, "garment_colors": ""})
    assert tall.status_code == 400
    assert "Zu hoch für den Druckbereich" in tall.json()["detail"]
    assert "erlaubt sind 5 Zoll (12,7 cm)" in tall.json()["detail"]


@pytest.mark.asyncio
async def test_the_print_area_is_a_setting_per_placement_and_the_light_follows_it(flow):
    await finance(flow)
    first = await upload(flow, logo(1200, 1200), **NEW)
    latest = design(first)["latest"]
    assert latest["check"]["level"] == "snug" and latest["dpi"] == pytest.approx(342.9)
    assert latest["print_size"] == "3,5 × 3,5 Zoll (8,9 × 8,9 cm)"

    wider = await flow.put(f"{BASE}/designs/placements/front_right",
                           json={"print_width_in": 4.5, "reason": "Löwe etwas größer"})
    assert wider.status_code == 200, wider.text
    spec = next(item for item in wider.json()["placements"] if item["key"] == "front_right")
    assert spec["print_width"] == "4,5 Zoll (11,4 cm)" and spec["min_width_px"] == 1350
    latest = design(wider)["latest"]
    assert latest["check"]["level"] == "too_low" and "266 DPI" in latest["check"]["text"]
    # Die Version behält die Maße, mit denen sie geprüft wurde.
    assert latest["dpi"] == pytest.approx(342.9) and latest["print_width_in"] == 3.5

    too_wide = await flow.put(f"{BASE}/designs/placements/front_right",
                              json={"print_width_in": 6, "reason": "Größer als der Bereich"})
    assert too_wide.status_code == 400 and "breiter als der Druckbereich" in too_wide.json()["detail"]
    nonsense = await flow.put(f"{BASE}/designs/placements/front_right", json={"min_dpi": 10, "reason": "Test"})
    unknown = await flow.put(f"{BASE}/designs/placements/hosentasche", json={"min_dpi": 300, "reason": "Test"})
    assert (nonsense.status_code, unknown.status_code) == (422, 404)


# ---------------------------------------------------------------- Neu kodiert: ohne Metadaten, mit Transparenz

@pytest.mark.asyncio
async def test_metadata_is_stripped_and_transparency_is_kept(flow):
    await finance(flow)
    exif = Image.Exif()
    exif[0x013B] = SECRET_TEXT  # Artist
    exif[0x8825] = {2: (48.0, 12.0, 0.0)}  # GPS
    text = PngInfo()
    text.add_text("Comment", SECRET_TEXT)
    data = logo(1200, 1200, exif=exif.tobytes(), pnginfo=text)
    assert SECRET_TEXT.encode() in data
    answer = await upload(flow, data, **NEW)
    assert answer.status_code == 200, answer.text

    [path] = stored_files(flow)
    raw = path.read_bytes()
    assert SECRET_TEXT.encode() not in raw and b"eXIf" not in raw and b"tEXt" not in raw and b"iCCP" not in raw
    with Image.open(path) as stored:
        assert stored.format == "PNG" and stored.mode == "RGBA"
        assert "exif" not in stored.info and "Comment" not in stored.info
        assert stored.getpixel((0, 0))[3] == 0 and stored.getpixel((600, 600)) == (255, 255, 255, 255)
    latest = design(answer)["latest"]
    assert latest["has_alpha"] is True
    assert latest["sha256"] == hashlib.sha256(raw).hexdigest() and latest["sha256_short"] == latest["sha256"][:12]


@pytest.mark.asyncio
async def test_a_jpg_with_exif_is_accepted_as_png_without_metadata_and_with_a_warning(flow):
    await finance(flow)
    exif = Image.Exif()
    exif[0x013B] = SECRET_TEXT
    data = logo(1200, 1200, mode="RGB", fmt="JPEG", exif=exif.tobytes(), quality=95)
    answer = await upload(flow, data, filename="loewe.jpg", content_type="image/jpeg", **NEW)
    assert answer.status_code == 200, answer.text
    assert "JPG kann keine Transparenz" in " ".join(answer.json()["uploaded"]["warnings"])
    [path] = stored_files(flow)
    assert SECRET_TEXT.encode() not in path.read_bytes()
    with Image.open(path) as stored:
        assert stored.format == "PNG" and stored.mode == "RGB" and "exif" not in stored.info
    assert design(answer)["latest"]["source_format"] == "JPG"


@pytest.mark.asyncio
@pytest.mark.parametrize("name, data, content_type, expected", [
    ("loewe.svg", b'<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="4000" height="4000">'
                  b'<script>alert(1)</script></svg>', "image/svg+xml", "SVG geht für Druckdateien nicht"),
    ("getarnt.png", b'<svg xmlns="http://www.w3.org/2000/svg"><rect width="9" height="9"/></svg>', "image/png",
     "SVG geht für Druckdateien nicht"),
    ("loewe.gif", None, "image/gif", "Erkannt: GIF"),
    ("loewe.webp", None, "image/webp", "Erkannt: WEBP"),
    ("text.png", b"kein Bild, nur Text", "image/png", "nur als PNG"),
])
async def test_svg_and_other_formats_are_refused(flow, name, data, content_type, expected):
    await finance(flow)
    if data is None:
        data = logo(1200, 1200, mode="RGB", fmt=content_type.split("/")[1].upper())
    answer = await upload(flow, data, filename=name, content_type=content_type, **NEW)
    assert answer.status_code == 400, answer.text
    assert expected in answer.json()["detail"]
    assert stored_files(flow) == [] and await flow.db.shop_designs.count_documents({}) == 0


@pytest.mark.asyncio
async def test_animated_and_oversized_uploads_are_refused(flow, monkeypatch):
    from services import shop_designs

    await finance(flow)
    frames = [Image.new("RGBA", (1200, 1200), (255, 255, 255, alpha)) for alpha in (0, 255)]
    out = BytesIO()
    frames[0].save(out, format="PNG", save_all=True, append_images=frames[1:])
    animated = await upload(flow, out.getvalue(), **NEW)
    assert animated.status_code == 400 and "Animierte" in animated.json()["detail"]

    monkeypatch.setattr(shop_designs, "MAX_BYTES", 1024)
    monkeypatch.setattr(shop_designs, "MAX_UPLOAD_MB", 1)
    big = await upload(flow, logo(1200, 1200) + b"\0" * 2048, **NEW)
    assert big.status_code == 413
    assert stored_files(flow) == []


def multipart(data: bytes, fields: dict) -> tuple[bytes, str]:
    boundary = "grenze1708"
    parts = [f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode()
             for name, value in fields.items()]
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="loewe.png"\r\n'
                 "Content-Type: image/png\r\n\r\n".encode() + data + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


@pytest.mark.asyncio
async def test_an_oversized_upload_is_refused_before_the_form_is_read(flow, monkeypatch):
    """Das Limit greift am Eingang (Content-Length bzw. beim Mitzählen), nicht erst nach dem Einlesen in den
    Zwischenspeicher - die Route kommt gar nicht dran."""
    from routes import shop_design_routes
    from services import shop_designs

    def never(*_args, **_kwargs):
        raise AssertionError("die Route hätte die Datei nie bekommen dürfen")

    await finance(flow)
    monkeypatch.setattr(shop_designs, "MAX_BYTES", 1024)
    monkeypatch.setattr(shop_designs, "MAX_UPLOAD_MB", 1)
    monkeypatch.setattr(shop_design_routes, "_read_upload_limited", never)
    body, content_type = multipart(logo(1200, 1200) + b"\0" * 300_000,
                                   {"design_key": "loewe-weiss", "reason": "Zu groß", **NEW})

    declared = await flow.post(f"{BASE}/designs/upload", content=body, headers={"content-type": content_type})
    assert declared.status_code == 413 and "zu groß" in declared.json()["detail"]

    async def chunks():  # ohne Content-Length: gezählt wird beim Lesen
        for start in range(0, len(body), 16_384):
            yield body[start:start + 16_384]

    streamed = await flow.post(f"{BASE}/designs/upload", content=chunks(), headers={"content-type": content_type})
    assert streamed.status_code == 413 and "zu groß" in streamed.json()["detail"]
    assert stored_files(flow) == [] and await flow.db.shop_designs.count_documents({}) == 0


# ---------------------------------------------------------------- Versionen

@pytest.mark.asyncio
async def test_the_same_file_again_is_no_new_version_and_nothing_is_overwritten(flow):
    await finance(flow)
    data = logo(1200, 1200)
    assert (await upload(flow, data, **NEW)).status_code == 200
    before = {path.name: path.read_bytes() for path in stored_files(flow)}
    again = await upload(flow, data, reason="Nochmal hochgeladen")
    assert again.status_code == 409 and "schon die aktuelle Version (v1)" in again.json()["detail"]
    assert {path.name: path.read_bytes() for path in stored_files(flow)} == before
    other_place = await upload(flow, logo(1300, 1300), reason="Andere Stelle", placement="back")
    assert other_place.status_code == 400 and "eigenes Design" in other_place.json()["detail"]


# ---------------------------------------------------------------- Shirtfarben

@pytest.mark.asyncio
async def test_each_shirt_colour_has_one_design_per_placement(flow):
    from services import shop_designs

    await finance(flow)
    assert (await upload(flow, logo(1200, 1200), **NEW)).status_code == 200
    dark = await upload(flow, logo(1200, 1200, mode="RGB"), key="loewe-schwarz",
                        **{**NEW, "title": "Löwe schwarz", "garment_colors": "Weiß, navy"})
    assert dark.status_code == 409 and "„navy“" in dark.json()["detail"] and "loewe-weiss" in dark.json()["detail"]
    dark = await upload(flow, logo(1200, 1200, mode="RGB"), key="loewe-schwarz",
                        **{**NEW, "title": "Löwe schwarz", "garment_colors": "Weiß, Hellgrau"})
    assert dark.status_code == 200, dark.text
    assert design(dark, "loewe-schwarz")["garment_colors"] == ["Weiß", "Hellgrau"]

    on_black = await shop_designs.design_for_color(flow.db, "front_right", " schwarz ")
    on_white = await shop_designs.design_for_color(flow.db, "front_right", "WEISS".replace("SS", "ß"))
    assert on_black["profile"]["design_key"] == "loewe-weiss" and on_black["latest"]["version"] == 1
    assert on_white["profile"]["design_key"] == "loewe-schwarz"
    assert await shop_designs.design_for_color(flow.db, "front_right", "Rot") is None
    assert await shop_designs.design_for_color(flow.db, "back", "Schwarz") is None

    moved = await flow.patch(f"{BASE}/designs/loewe-weiss",
                             json={"garment_colors": ["Schwarz"], "reason": "Navy bekommt eigenes Design"})
    assert moved.status_code == 200 and design(moved)["garment_colors"] == ["Schwarz"]
    taken = await flow.patch(f"{BASE}/designs/loewe-schwarz",
                             json={"garment_colors": ["Weiß", "Schwarz"], "reason": "Versehen"})
    assert taken.status_code == 409
    missing = await flow.patch(f"{BASE}/designs/gibt-es-nicht", json={"title": "x", "reason": "Test"})
    assert missing.status_code == 404
    # Freigegebene Farben sind wieder frei: Navy kann jetzt ein anderes Design bekommen.
    navy = await flow.patch(f"{BASE}/designs/loewe-schwarz",
                            json={"garment_colors": ["Weiß", "Navy"], "reason": "Navy hell bedrucken"})
    assert navy.status_code == 200, navy.text


@pytest.mark.asyncio
async def test_two_designs_cannot_claim_the_same_colour_at_the_same_time(flow):
    """Zwei gleichzeitige Änderungen lesen beide „Navy ist frei“ - die Zuordnung entscheidet atomar, eine gewinnt."""
    import asyncio

    from flow_harness import InterleavedReads
    from services import shop_designs
    from services.shop_common import ShopConflict

    staff = await finance(flow)
    by = {"actor_id": staff["id"], "reason": "Testdaten"}
    for key, colour in (("loewe-weiss", "Schwarz"), ("loewe-schwarz", "Weiß")):
        await shop_designs.create_profile(flow.db, key, title=key, placement="front_right", garment_colors=[colour],
                                          **by)
    gate = InterleavedReads(flow.db, "shop_design_profiles")
    results = await asyncio.gather(
        shop_designs.update_profile(gate, "loewe-weiss", {"garment_colors": ["Schwarz", "Navy"]}, **by),
        shop_designs.update_profile(gate, "loewe-schwarz", {"garment_colors": ["Weiß", "navy"]}, **by),
        return_exceptions=True)
    assert sorted(type(item).__name__ for item in results) == sorted(["ShopConflict", "tuple"]), results
    assert any(isinstance(item, ShopConflict) for item in results)
    owners = [profile["design_key"] async for profile in flow.db.shop_design_profiles.find(
        {"garment_colors": {"$in": ["Navy", "navy"]}})]
    assert len(owners) == 1
    claims = await flow.db.shop_design_colors.find({"placement": "front_right"}, {"_id": 0}).to_list(10)
    assert sorted((claim["color_key"], claim["design_key"]) for claim in claims) == sorted(
        [("schwarz", "loewe-weiss"), ("weiss", "loewe-schwarz"), ("navy", owners[0])])


# ---------------------------------------------------------------- Rechte und Protokoll

async def every_route(flow) -> dict:
    return {
        "list": await flow.get(f"{BASE}/designs"),
        "upload": await upload(flow, logo(1200, 1200), key=f"k-{(flow.user or {}).get('id', 'gast')[:6].lower()}",
                               **NEW),
        "profile": await flow.patch(f"{BASE}/designs/loewe-weiss", json={"title": "Löwe", "reason": "Umbenannt"}),
        "placement": await flow.put(f"{BASE}/designs/placements/back", json={"min_dpi": 250, "reason": "Test"}),
    }


@pytest.mark.asyncio
async def test_only_finance_with_a_second_factor_may_use_the_design_routes(flow):
    staff = await finance(flow)
    assert (await upload(flow, logo(1200, 1200), **NEW)).status_code == 200
    rows, logged = await flow.db.shop_designs.count_documents({}), await flow.db.audit_logs.count_documents({})

    for role in ("player", "moderator", "tournament_admin"):
        flow.act_as(await flow.add_user(role=role))
        for route, answer in (await every_route(flow)).items():
            assert answer.status_code == 403, (role, route, answer.text)
    flow.act_as({**staff, "auth_mfa_verified": False})
    for route, answer in (await every_route(flow)).items():
        assert answer.status_code == 403 and "Zwei-Faktor" in answer.json()["detail"], (route, answer.text)
    flow.act_as(None)
    for route, answer in (await every_route(flow)).items():
        assert answer.status_code == 401, (route, answer.text)
    assert await flow.db.shop_designs.count_documents({}) == rows
    assert await flow.db.audit_logs.count_documents({}) == logged

    for role in ("club_admin", "superadmin"):
        flow.act_as(await flow.add_user(role=role))
        assert (await flow.get(f"{BASE}/designs")).status_code == 200


@pytest.mark.asyncio
async def test_every_change_is_logged_with_person_and_reason_and_needs_one(flow):
    staff = await finance(flow)
    no_reason = await flow.post(f"{BASE}/designs/upload", data={"design_key": "loewe-weiss", **NEW},
                                files={"file": ("loewe.png", logo(1200, 1200), "image/png")})
    blank = await upload(flow, logo(1200, 1200), reason="   ", **NEW)
    assert (no_reason.status_code, blank.status_code) == (422, 400)
    assert await flow.db.audit_logs.count_documents({}) == 0 and stored_files(flow) == []

    assert (await upload(flow, logo(1200, 1200), reason="Druckdatei vom Obmann", **NEW)).status_code == 200
    await flow.patch(f"{BASE}/designs/loewe-weiss", json={"garment_colors": ["Schwarz"], "reason": "Navy raus"})
    await flow.put(f"{BASE}/designs/placements/back", json={"area_height_in": 14, "reason": "Rücken kürzer"})
    same = await flow.put(f"{BASE}/designs/placements/back", json={"area_height_in": 14, "reason": "Nochmal"})
    assert same.json()["changed"] == []

    rows = await flow.db.audit_logs.find({"action": {"$regex": "^shop\\.design"}}, {"_id": 0}).sort(
        "created_at", 1).to_list(20)
    assert [row["action"] for row in rows] == ["shop.design.profile", "shop.design.add", "shop.design.profile",
                                               "shop.design.placement"]
    assert all(row["actor_id"] == staff["id"] for row in rows)
    assert [row["data"]["reason"] for row in rows] == ["Druckdatei vom Obmann", "Druckdatei vom Obmann", "Navy raus",
                                                       "Rücken kürzer"]
    added = rows[1]["data"]
    assert added["version"] == 1 and len(added["sha256"]) == 64 and added["width_px"] == 1200
    assert "public_id" not in str(rows)  # der Schlüssel steht nicht im Protokoll
    assert rows[2]["data"]["before"] == {"garment_colors": ["Schwarz", "Navy"]}
    assert rows[3]["data"] == {"before": {"area_height_in": 16.0}, "after": {"area_height_in": 14.0},
                               "reason": "Rücken kürzer"}


def test_measures_are_always_in_inches_and_centimetres():
    from services import shop_designs

    assert shop_designs.inches(3.5) == "3,5 Zoll (8,9 cm)"
    assert shop_designs.inches(12) == "12 Zoll (30,5 cm)"
    assert set(shop_designs.PLACEMENT_LABELS) == set(shop_designs.shop_catalog.PLACEMENTS)
    assert set(shop_designs.DEFAULT_SPECS) == set(shop_designs.shop_catalog.PLACEMENTS)
