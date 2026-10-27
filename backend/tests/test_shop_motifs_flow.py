"""Motive mit Fassungen für dunkle und helle Shirts (#2069 Teil A) - durch die echte Anwendung.

- SVG als Hauptdatei: streng bereinigt (Ablehnung mit Fund), gerastert, das bereinigte SVG liegt privat daneben; die
  Fassung für helle Shirts entsteht automatisch (Weiß → Ersatzfarbe, die Markenfarbe bleibt).
- Eigene Datei für helle Shirts hat Vorrang; „zurück auf automatisch“.
- PNG: umgefärbt nur, wenn es sauber geht; sonst der Hinweis „bitte eigene Datei“.
- Shirtfarbe → Fassung nach Helligkeit, Ausnahme je Farbe; ``render_motif_png`` für Teil B.
- Migration 14 hin und zurück, Rechte (nur Finanzen mit Zwei-Faktor).

Alle Dateien sind synthetisch - die echten Vereinslogos kommen nicht ins Repo."""
import hashlib
import io
import pathlib
import sys

import pytest
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from test_shop_designs_flow import BASE, NEW, design, finance, logo, stored_files, upload  # noqa: E402
from test_shop_designs_flow import flow as designs_flow  # noqa: E402

flow = designs_flow

INK = (17, 17, 17)
CLUB = (39, 170, 225)
# Im Stil der Vereinslogos: nur Pfade, eine Klasse je Farbe, Weiß für die Linien, Blau für den Schriftzug.
CLUB_SVG = (
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<svg id="Ebene_1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">'
    '<defs><style>.cls-1{fill:#fff;}.cls-2{fill:#27aae1;}</style></defs>'
    '<path class="cls-1" d="M10 10 L190 10 L190 90 L10 90 Z"/>'
    '<path class="cls-2" d="M10 110 L190 110 L190 190 L10 190 Z"/>'
    '</svg>'
).encode()
MOTIF = {"title": "Löwe", "placement": "front_right"}


async def upload_svg(flow, data: bytes = CLUB_SVG, *, key: str = "loewe", **form):
    return await upload(flow, data, key=key, filename="loewe.svg", content_type="image/svg+xml", **form)


def png(data: bytes) -> Image.Image:
    image = Image.open(io.BytesIO(data))
    image.load()
    return image.convert("RGBA")


async def public_png(flow, version: dict) -> Image.Image:
    user = flow.user
    flow.act_as(None)
    answer = await flow.get(version["public_path"])
    flow.act_as(user)
    assert answer.status_code == 200, answer.text
    return png(answer.content)


# ---------------------------------------------------------------- SVG als Hauptdatei

@pytest.mark.asyncio
async def test_an_svg_motif_gets_a_print_file_and_an_automatic_light_version(flow):
    await finance(flow)
    answer = await upload_svg(flow, **MOTIF)
    assert answer.status_code == 200, answer.text
    motif = design(answer, "loewe")
    dark, light = motif["latest"], motif["light"]
    assert dark["version"] == 1 and dark["variant"] == "dark" and dark["source_format"] == "SVG"
    assert dark["is_vector"] is True and dark["colors"] == ["#27aae1", "#ffffff"] and dark["aspect_ratio"] == 1.0
    # Gerastert bei mindestens 300 DPI über die Druckbreite: die Ampel ist grün.
    assert dark["width_px"] == 1260 and dark["check"]["level"] == "good"
    assert light["state"] == "auto" and light["version"] == 2
    assert light["latest"]["variant"] == "light" and light["latest"]["origin"] == "auto_light"
    assert light["latest"]["derived_from"] == 1 and light["latest"]["colors"] == ["#111111", "#27aae1"]
    assert answer.json()["uploaded"]["light"]["state"] == "auto"

    # Je Fassung die Druckdatei und das bereinigte SVG daneben - nur die PNG ist öffentlich.
    names = sorted(path.suffix for path in stored_files(flow))
    assert names == [".png", ".png", ".svg", ".svg"]
    on_dark, on_light = await public_png(flow, dark), await public_png(flow, light["latest"])
    top, bottom = (630, 200), (630, 1000)
    assert on_dark.getpixel(top) == (255, 255, 255, 255) and on_dark.getpixel(bottom) == (*CLUB, 255)
    assert on_light.getpixel(top) == (*INK, 255) and on_light.getpixel(bottom) == (*CLUB, 255)
    assert on_light.getpixel((0, 630))[3] == 0  # der Rand bleibt durchsichtig
    row = await flow.db.shop_designs.find_one({"design_key": "loewe", "version": 1}, {"_id": 0})
    flow.act_as(None)
    hidden = dark["public_path"].replace(".png", ".svg")
    assert (await flow.get(hidden)).status_code == 404
    assert row["svg_ref"].endswith(".svg") and "svg_ref" not in dark  # der Ablageort steht nicht in der Ansicht


@pytest.mark.asyncio
@pytest.mark.parametrize("body, expected", [
    (CLUB_SVG.replace(b"</svg>", b"<script>alert(1)</script></svg>"), "Gefunden: Skript"),
    (CLUB_SVG.replace(b'viewBox="0 0 200 200"', b'viewBox="0 0 200 200" onload="alert(1)"'),
     "Ereignis-Attribute"),
    (CLUB_SVG.replace(b"</svg>", b'<image href="data:image/png;base64,iVBORw0KGgo=" width="9" height="9"/></svg>'),
     "Kein echtes Vektor-SVG – enthält ein Pixelbild."),
    (CLUB_SVG.replace(b"</svg>", b'<use href="https://boese.example/a.svg#x"/></svg>'), "Verweise nach außen"),
    (CLUB_SVG.replace(b"<defs>", b"<defs><style>@import url(https://boese.example/x.css);</style>"),
     "Stylesheet mit @import"),
    (b'<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + CLUB_SVG[39:],
     "DTD oder Entities"),
], ids=["script", "onload", "pixelbild", "extern", "import", "xxe"])
async def test_a_dangerous_svg_is_refused_with_what_was_found_and_nothing_is_stored(flow, body, expected):
    await finance(flow)
    answer = await upload_svg(flow, body, **MOTIF)
    assert answer.status_code == 400, answer.text
    assert expected in answer.json()["detail"] and "boese.example" not in answer.json()["detail"]
    assert stored_files(flow) == [] and await flow.db.shop_designs.count_documents({}) == 0
    assert await flow.db.shop_design_profiles.count_documents({}) == 0


@pytest.mark.asyncio
async def test_a_too_big_svg_gets_413(flow, monkeypatch):
    from services import svg_safe

    await finance(flow)
    monkeypatch.setattr(svg_safe, "MAX_SVG_BYTES", 1024)
    answer = await upload_svg(flow, CLUB_SVG + b"<!--" + b"x" * 2000 + b"-->", **MOTIF)
    assert answer.status_code == 413 and "zu groß" in answer.json()["detail"]


# ---------------------------------------------------------------- Eigene Datei für helle Shirts

@pytest.mark.asyncio
async def test_an_own_light_file_wins_and_auto_comes_back_on_request(flow):
    staff = await finance(flow)
    assert (await upload_svg(flow, **MOTIF)).status_code == 200
    own = CLUB_SVG.replace(b"fill:#fff;", b"fill:#0a2540;")
    answer = await upload_svg(flow, own, variant="light", reason="Dunkelblau statt Schwarz")
    assert answer.status_code == 200, answer.text
    motif = design(answer, "loewe")
    assert motif["light_mode"] == "file" and motif["light"]["state"] == "file" and motif["light"]["version"] == 3
    assert motif["latest"]["version"] == 1, "die Hauptdatei bleibt"
    same = await upload_svg(flow, own, variant="light")
    assert same.status_code == 409 and "(v3)" in same.json()["detail"]

    # Eine neue Hauptdatei ändert an der eigenen Datei nichts.
    newer = await upload_svg(flow, CLUB_SVG.replace(b"190 190", b"180 190"), reason="Schriftzug kürzer")
    assert design(newer, "loewe")["light"]["state"] == "file"

    back = await flow.post(f"{BASE}/designs/loewe/light-auto", json={"reason": "Doch automatisch"})
    assert back.status_code == 200, back.text
    motif = design(back, "loewe")
    assert motif["light_mode"] == "auto" and motif["light"]["state"] == "auto"
    assert motif["light"]["latest"]["derived_from"] == 4
    logged = await flow.db.audit_logs.find({"action": "shop.design.light"}, {"_id": 0}).to_list(5)
    assert [(row["data"]["before"], row["data"]["after"]) for row in logged] == [("auto", "file"), ("file", "auto")]
    assert all(row["actor_id"] == staff["id"] for row in logged)
    # Ohne bestehendes Motiv gibt es keine Datei für helle Shirts.
    lonely = await upload_svg(flow, own, key="neu", variant="light", **MOTIF)
    assert lonely.status_code == 400 and "bestehenden Motiv" in lonely.json()["detail"]
    wrong = await upload_svg(flow, own, variant="grau")
    assert wrong.status_code == 422


# ---------------------------------------------------------------- PNG

@pytest.mark.asyncio
async def test_a_white_png_with_transparency_is_recoloured_and_an_opaque_one_asks_for_a_file(flow):
    await finance(flow)
    white = await upload(flow, logo(1200, 1200, fill=(255, 255, 255)), key="weiss", **NEW)
    motif = design(white, "weiss")
    assert motif["light"]["state"] == "auto" and motif["latest"]["is_vector"] is False
    recoloured = await public_png(flow, motif["light"]["latest"])
    assert recoloured.getpixel((600, 600)) == (*INK, 255) and recoloured.getpixel((0, 0))[3] == 0

    blue = await upload(flow, logo(1200, 1200), key="blau", **{**NEW, "garment_colors": ""})
    assert design(blue, "blau")["light"]["state"] == "same"
    assert design(blue, "blau")["light"]["latest"]["version"] == 1, "ohne Weiß gilt die Hauptdatei"

    opaque = await upload(flow, logo(1200, 1200, mode="RGB", fmt="JPEG", fill=(255, 255, 255)), key="foto",
                          filename="foto.jpg", content_type="image/jpeg", **{**NEW, "garment_colors": ""})
    assert opaque.status_code == 200
    assert design(opaque, "foto")["light"]["state"] == "missing"
    assert any("eigene Datei für helle Shirts" in text for text in opaque.json()["uploaded"]["warnings"])


def test_png_recolouring_only_when_it_is_clean():
    from services import shop_motifs

    def picture(colour, background=(0, 0, 0, 0)):
        image = Image.new("RGBA", (40, 40), background)
        for x in range(10, 30):
            for y in range(10, 30):
                image.putpixel((x, y), colour)
        return image

    light, state = shop_motifs.light_from_png(picture((255, 255, 255, 255)), "#111111")
    assert state == "auto" and light.getpixel((20, 20)) == (17, 17, 17, 255) and light.getpixel((0, 0))[3] == 0
    assert shop_motifs.light_from_png(picture((*CLUB, 255)), "#111111") == (None, "same")
    assert shop_motifs.light_from_png(picture((128, 128, 128, 255)), "#111111") == (None, "same")
    mixed = picture((255, 255, 255, 255))
    for x in range(10, 30):
        mixed.putpixel((x, 12), (128, 128, 128, 255))
    assert shop_motifs.light_from_png(mixed, "#111111") == (None, "gray")
    assert shop_motifs.light_from_png(picture((255, 255, 255, 255), (0, 0, 0, 255)), "#111111") == (None, "opaque")
    assert shop_motifs.light_from_png(Image.new("RGBA", (5, 5)), "#111111") == (None, "empty")


# ---------------------------------------------------------------- Ersatzfarbe und Schwelle

@pytest.mark.asyncio
async def test_a_new_ink_rebuilds_the_automatic_versions_and_keeps_the_old_ones(flow):
    staff = await finance(flow)
    assert (await upload_svg(flow, **MOTIF)).status_code == 200
    answer = await flow.put(f"{BASE}/designs/motif-settings",
                            json={"light_ink": "#0A2540", "threshold": 0.25, "reason": "Vereins-Dunkelblau"})
    assert answer.status_code == 200, answer.text
    assert sorted(answer.json()["changed"]) == ["light_ink", "threshold"]
    assert answer.json()["motif_settings"]["light_ink"] == "#0a2540"
    light = design(answer, "loewe")["light"]
    assert light["state"] == "auto" and light["version"] == 3 and light["latest"]["colors"] == ["#0a2540", "#27aae1"]
    assert await flow.db.shop_designs.count_documents({"design_key": "loewe"}) == 3, "v2 bleibt für Bestellungen"
    [entry] = await flow.db.audit_logs.find({"action": "shop.motif.settings"}, {"_id": 0}).to_list(5)
    assert entry["actor_id"] == staff["id"] and entry["data"]["after"] == {"light_ink": "#0a2540", "threshold": 0.25}

    same = await flow.put(f"{BASE}/designs/motif-settings", json={"light_ink": "#0a2540"})
    assert same.status_code == 200 and same.json()["changed"] == []
    for body, status in (({"light_ink": "#ffffff"}, 400), ({"light_ink": "blau!!!"}, 400), ({"threshold": 5}, 422),
                         ({"farbe": "#000000"}, 422)):
        refused = await flow.put(f"{BASE}/designs/motif-settings", json=body)
        assert refused.status_code == status, (body, refused.text)


# ---------------------------------------------------------------- Shirtfarbe → Fassung

def test_the_variant_follows_the_brightness_of_the_shirt_unless_an_exception_says_otherwise():
    from services.shop_motifs import variant_for_garment

    assert variant_for_garment("#000000") == "dark" and variant_for_garment("#0c0c0c") == "dark"
    assert variant_for_garment("#1f2a44") == "dark"  # Navy
    assert variant_for_garment("#c8102e") == "dark"  # Rot trägt helle Motive
    assert variant_for_garment("#ffffff") == "light" and variant_for_garment("#FFF") == "light"
    assert variant_for_garment("#9b9b9b") == "light"  # Grau meliert
    assert variant_for_garment("#ffc72c") == "light"  # Gelb
    assert variant_for_garment("#9b9b9b", threshold=0.5) == "dark"
    exceptions = [{"color": "Navy", "variant": "light"}]
    assert variant_for_garment("#1f2a44", color=" navy ", exceptions=exceptions) == "light"
    assert variant_for_garment("#1f2a44", color="Royal", exceptions=exceptions) == "dark"
    assert variant_for_garment(None) is None and variant_for_garment("kein Wert") is None
    assert variant_for_garment(None, color="NAVY", exceptions=exceptions) == "light"


@pytest.mark.asyncio
async def test_file_for_garment_picks_the_version_and_keeps_old_fixed_colours_on_the_main_file(flow):
    from services import shop_motifs

    await finance(flow)
    assert (await upload_svg(flow, **{**MOTIF, "garment_colors": "Weiß"})).status_code == 200
    pick = shop_motifs.file_for_garment
    assert (await pick(flow.db, "loewe", color="Black", color_hex="#0c0c0c"))["version"] == 1
    assert (await pick(flow.db, "loewe", color="White", color_hex="#ffffff"))["version"] == 2
    # Feste Shirtfarben aus #1708 drucken wie bisher die Hauptdatei; ohne Farbwert ebenso.
    assert (await pick(flow.db, "loewe", color="weiß", color_hex="#ffffff"))["version"] == 1
    assert (await pick(flow.db, "loewe", color="Sand", color_hex=None))["version"] == 1

    answer = await flow.patch(f"{BASE}/designs/loewe", json={
        "color_variants": [{"color": "Black", "variant": "light"}, {"color": " black", "variant": "dark"}],
        "reason": "Test"})
    assert answer.status_code == 200, answer.text
    assert design(answer, "loewe")["color_variants"] == [{"color": "Black", "variant": "light"}]
    assert (await pick(flow.db, "loewe", color="BLACK", color_hex="#0c0c0c"))["version"] == 2
    bad = await flow.patch(f"{BASE}/designs/loewe", json={"color_variants": [{"color": "Navy", "variant": "grau"}]})
    assert bad.status_code == 422


# ---------------------------------------------------------------- Schnittstelle für Teil B

@pytest.mark.asyncio
async def test_render_motif_png_has_the_exact_width_is_transparent_and_deterministic(flow):
    from services import shop_motifs

    await finance(flow)
    assert (await upload_svg(flow, **MOTIF)).status_code == 200
    dark = await shop_motifs.render_motif_png(flow.db, "loewe", "dark", width_px=3000, dpi=300)
    light = await shop_motifs.render_motif_png(flow.db, "loewe", "light", width_px=3000, dpi=300)
    for data in (dark, light):
        image = png(data)
        with Image.open(io.BytesIO(data)) as raw:
            dpi = raw.info["dpi"]
        assert image.size == (3000, 3000) and image.getpixel((0, 1500))[3] == 0
        assert round(dpi[0]) == 300
    assert png(dark).getpixel((1500, 300)) == (255, 255, 255, 255)
    assert png(light).getpixel((1500, 300)) == (*INK, 255) and png(light).getpixel((1500, 2500)) == (*CLUB, 255)
    again = await shop_motifs.render_motif_png(flow.db, "loewe", "dark", width_px=3000, dpi=300)
    assert hashlib.sha256(again).hexdigest() == hashlib.sha256(dark).hexdigest()
    # Eine eingefrorene Version bleibt abrufbar - auch nach einer neuen Ersatzfarbe.
    await shop_motifs.set_settings(flow.db, {"light_ink": "#0a2540"}, actor_id="test", reason="Test")
    frozen = await shop_motifs.render_motif_png(flow.db, "loewe", "light", width_px=3000, dpi=300, version=2)
    assert frozen == light
    info = await shop_motifs.motif_info(flow.db, "loewe", "light")
    assert info["version"] == 3 and info["is_vector"] is True and info["aspect_ratio"] == 1.0

    # PNG-Motive werden skaliert, Seitenverhältnis erhalten.
    assert (await upload(flow, logo(1200, 1500), key="hoch", **NEW)).status_code == 200
    tall = png(await shop_motifs.render_motif_png(flow.db, "hoch", "dark", width_px=600, dpi=150))
    assert tall.size == (600, 750)
    for kwargs in ({"width_px": 0, "dpi": 300}, {"width_px": 100, "dpi": 0}, {"width_px": 1.5, "dpi": 300}):
        with pytest.raises(ValueError):
            await shop_motifs.render_motif_png(flow.db, "loewe", "dark", **kwargs)
    with pytest.raises(ValueError):
        await shop_motifs.render_motif_png(flow.db, "loewe", "grau", width_px=100, dpi=300)
    with pytest.raises(LookupError):
        await shop_motifs.render_motif_png(flow.db, "gibt-es-nicht", "dark", width_px=100, dpi=300)
    with pytest.raises(LookupError):
        await shop_motifs.render_motif_png(flow.db, "loewe", "dark", width_px=100, dpi=300, version=2)


@pytest.mark.asyncio
async def test_a_light_version_does_not_retire_the_main_file(flow):
    from models import now_utc
    from services import shop_designs
    from datetime import timedelta

    await finance(flow)
    assert (await upload_svg(flow, **MOTIF)).status_code == 200
    later = await shop_designs.retention_plan(flow.db, now=now_utc() + timedelta(days=shop_designs.PUBLIC_GRACE_DAYS))
    assert later["public_off"] == [] and later["kept_public"] == 2


# ---------------------------------------------------------------- Rechte

@pytest.mark.asyncio
async def test_only_finance_with_a_second_factor_may_upload_motifs_or_change_their_settings(flow):
    staff = await finance(flow)
    assert (await upload_svg(flow, **MOTIF)).status_code == 200
    rows, logged = await flow.db.shop_designs.count_documents({}), await flow.db.audit_logs.count_documents({})

    async def every(flow) -> dict:
        return {
            "svg": await upload_svg(flow, key="fremd", **MOTIF),
            "light": await upload_svg(flow, variant="light"),
            "auto": await flow.post(f"{BASE}/designs/loewe/light-auto", json={"reason": "x"}),
            "settings": await flow.put(f"{BASE}/designs/motif-settings", json={"light_ink": "#000000"}),
            "exceptions": await flow.patch(f"{BASE}/designs/loewe",
                                           json={"color_variants": [{"color": "Navy", "variant": "light"}]}),
        }

    for role in ("player", "moderator", "tournament_admin"):
        flow.act_as(await flow.add_user(role=role))
        for route, answer in (await every(flow)).items():
            assert answer.status_code == 403, (role, route, answer.text)
    flow.act_as({**staff, "auth_mfa_verified": False})
    for route, answer in (await every(flow)).items():
        assert answer.status_code == 403 and "Zwei-Faktor" in answer.json()["detail"], (route, answer.text)
    flow.act_as(None)
    for route, answer in (await every(flow)).items():
        assert answer.status_code == 401, (route, answer.text)
    assert await flow.db.shop_designs.count_documents({}) == rows
    assert await flow.db.audit_logs.count_documents({}) == logged


# ---------------------------------------------------------------- Migration 14

async def legacy(db):
    """Daten wie nach #1708/#1707 in Produktion: Fassungen ohne Variante, Designs mit Farbliste, ein Produkt mit
    einer weiteren Farbe für dasselbe Design."""
    await db.shop_designs.insert_many([
        {"id": "d1", "design_key": "loewe-weiss", "version": 1, "file_ref": "shop-designs/" + "a" * 32 + ".png",
         "sha256": "a" * 64, "placement": "front_right", "origin": "upload"},
        {"id": "d2", "design_key": "loewe-schwarz", "version": 1, "file_ref": "shop-designs/" + "b" * 32 + ".png",
         "sha256": "b" * 64, "placement": "front_right", "origin": "upload"},
    ])
    await db.shop_design_profiles.insert_many([
        {"design_key": "loewe-weiss", "title": "Löwe weiß", "placement": "front_right",
         "garment_colors": ["Schwarz", "Navy"], "version": 1},
        {"design_key": "loewe-schwarz", "title": "Löwe schwarz", "placement": "front_right",
         "garment_colors": ["Weiß"], "version": 1},
    ])
    await db.shop_products.insert_one({"id": "p1", "slug": "shirt", "title": "Shirt", "placements": [
        {"key": "front_right", "kind": "design", "designs": [{"color": "Black", "design_key": "loewe-weiss"},
                                                             {"color": "Sand", "design_key": "loewe-schwarz"}]}]})


@pytest.mark.asyncio
async def test_migration_there_and_back_again(flow):
    from services import migrations, shop_motifs

    db = flow.db
    await legacy(db)
    report = await shop_motifs.plan(db)
    assert report["versions_without_variant"] == 2 and report["motifs_without_mode"] == 2
    assert report["exceptions"] == {"loewe-schwarz": ["Weiß", "Sand"], "loewe-weiss": ["Schwarz", "Navy", "Black"]}
    assert await db.shop_designs.count_documents({"variant": {"$exists": True}}) == 0, "der Trockenlauf liest nur"

    entry = next(run for version, name, run in migrations.MIGRATIONS if name == "shop_motif_variants")
    assert "2 versions marked dark" in await entry(db)
    assert await db.shop_designs.count_documents({"variant": "dark"}) == 2
    black = await db.shop_design_profiles.find_one({"design_key": "loewe-schwarz"}, {"_id": 0})
    assert black["light_mode"] == "auto"
    assert black["color_variants"] == [{"color": "Weiß", "variant": "dark"}, {"color": "Sand", "variant": "dark"}]
    # Bisher zugeordnete Farben drucken weiter die bisherige Datei - auch die helle Farbe Sand.
    assert (await shop_motifs.file_for_garment(db, "loewe-schwarz", color="Sand", color_hex="#e0d6c0"))["version"] == 1
    assert "0 versions marked dark, 0 motifs" in await shop_motifs.apply(db), "ein zweiter Lauf ändert nichts"
    await db.schema_migrations.insert_one({"version": shop_motifs.MIGRATION_VERSION, "name": "shop_motif_variants"})

    preview = await shop_motifs.rollback(db)
    assert preview["applied"] is False and preview["blocked_by"] == {} and preview["versions"] == 2
    assert await db.shop_designs.count_documents({"variant": "dark"}) == 2
    done = await shop_motifs.rollback(db, apply=True)
    assert done["applied"] is True
    assert await db.shop_designs.count_documents({"variant": {"$exists": True}}) == 0
    assert await db.shop_design_profiles.count_documents({"light_mode": {"$exists": True}}) == 0
    assert await db.schema_migrations.count_documents({"version": shop_motifs.MIGRATION_VERSION}) == 0
    assert (await db.shop_design_profiles.find_one({"design_key": "loewe-weiss"}))["garment_colors"] == [
        "Schwarz", "Navy"], "die Farblisten bleiben unangetastet"
    # Und wieder hin.
    await shop_motifs.apply(db)
    assert (await shop_motifs.plan(db))["motifs_without_mode"] == 0


@pytest.mark.asyncio
async def test_the_way_back_refuses_while_light_versions_exist_and_the_tool_reads_by_default(flow, capsys):
    import importlib.util

    from services import shop_motifs

    await finance(flow)
    assert (await upload_svg(flow, **MOTIF)).status_code == 200
    refused = await shop_motifs.rollback(flow.db, apply=True)
    assert refused["applied"] is False and refused["blocked_by"] == {"light_versions": 1}
    assert await flow.db.shop_designs.count_documents({"variant": "light"}) == 1

    path = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "shop_motifs.py"
    spec = importlib.util.spec_from_file_location("shop_motifs_cli", path)
    cli = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cli)
    assert await cli.main([], db=flow.db) == 0
    assert "Fassungen für helle Shirts" in capsys.readouterr().out
    assert await cli.main(["--abbauen", "--anwenden"], db=flow.db) == 1
    assert "Rückweg verweigert" in capsys.readouterr().out
