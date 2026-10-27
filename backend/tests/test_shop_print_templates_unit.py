"""Druckvorlagen je Produkt direkt von Printful (#2069): Maße aus der API, Abgleich mit Meldung, Vorlagenbilder über
die Website und Positions-Vorgaben, umgerechnet auf verschiedene Flächen.

Printful ist der Vertrags-Fake (``tests/printful_fake.py``) über den echten Adapter - kein echter Aufruf. Die Maße der
Fake-Profile stammen aus den offiziellen Printful-Vorlagen (``contracts/printful/manifest.json``, „print_templates“).
"""
import asyncio
import pathlib
import sys
from io import BytesIO

import httpx
import pytest
import pytest_asyncio
from mongomock_motor import AsyncMongoMockClient
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from printful_fake import API_KEY, TEMPLATE_HOST, FakePrintful  # noqa: E402
from services import printful_client, shop_schema  # noqa: E402
from services import shop_print_templates as templates  # noqa: E402
from services.printful_client import PrintfulClient  # noqa: E402
from services.shop_common import ShopError  # noqa: E402
from services.shop_fulfillment import CatalogProductId  # noqa: E402

ACTOR = "finanzen-test"
SHIRT, JERSEY, CAP, MUG, TOWEL = 71, 72, 73, 74, 75


@pytest.fixture
def fake():
    instance = FakePrintful()
    instance.add_product(SHIRT, ((4012, "M", "Black"), (4013, "L", "Black")), name="Unisex | Gildan 5000")
    instance.use_profile(SHIRT, "gildan5000")
    instance.add_product(JERSEY, ((5012, "M", "White"),), name="All-Over Trikot")
    instance.use_profile(JERSEY, "jersey")
    instance.add_product(CAP, ((6012, "One size", "Black"),), name="Snapback")
    instance.use_profile(CAP, "snapback")
    instance.add_product(MUG, ((7011, "11 oz", "Black"), (7015, "15 oz", "Black")), name="Tasse schwarz")
    instance.print_areas[MUG], instance.templates[MUG] = [], []
    instance.set_print_area(MUG, "default", 7.5, 3.0833, dpi=300, technique="sublimation", variants=(7011,))
    instance.set_print_area(MUG, "default", 7.51, 3.6133, dpi=300, technique="sublimation", variants=(7015,))
    instance.add_product(TOWEL, ((8030, "30×60", "White"), (8036, "36×72", "White")), name="Badetuch")
    instance.print_areas[TOWEL], instance.templates[TOWEL] = [], []
    instance.set_print_area(TOWEL, "default", 62, 32, technique="sublimation", variants=(8030,))
    instance.set_print_area(TOWEL, "default", 74, 38, technique="sublimation", variants=(8036,))
    return instance


@pytest.fixture
def provider(fake, monkeypatch):
    async def no_wait(_seconds):
        return None

    monkeypatch.setattr(printful_client, "_sleep", no_wait)
    return PrintfulClient(API_KEY, transport=fake.transport())


@pytest_asyncio.fixture
async def db():
    instance = AsyncMongoMockClient()["shop_vorlagen"]
    await shop_schema.apply(instance)
    return instance


def sizes(template: dict) -> dict:
    return {(row["placement"], row["group"] if row["group"] == "all" else tuple(row["variant_ids"])):
            (row["width_px"], row["height_px"], row["dpi"]) for row in template["entries"]}


# ---------------------------------------------------------------- Maße aus der API

@pytest.mark.asyncio
async def test_the_print_file_sizes_come_from_printful_exactly_as_the_official_templates(db, provider):
    shirt = (await templates.refresh(db, SHIRT, provider=provider, actor_id=ACTOR))["template"]
    assert sizes(shirt) == {("front", "all"): (1800, 2400, 150), ("back", "all"): (1800, 2400, 150),
                            ("sleeve_left", "all"): (600, 525, 150), ("sleeve_right", "all"): (600, 525, 150),
                            ("label_inside", "all"): (450, 450, 150)}
    front = next(row for row in shirt["entries"] if row["placement"] == "front")
    assert (front["width_cm"], front["height_cm"]) == (30.48, 40.64) and front["family"] == "front"
    assert front["label"] == "Vorderseite" and front["aspect_ok"] is True
    jersey = (await templates.refresh(db, JERSEY, provider=provider, actor_id=ACTOR))["template"]
    assert sizes(jersey)[("front", "all")] == (4950, 6750, 150)
    assert sizes(jersey)[("sleeve_left", "all")] == (4950, 2250, 150)
    cap = (await templates.refresh(db, CAP, provider=provider, actor_id=ACTOR))["template"]
    assert sizes(cap) == {("front", "all"): (1350, 705, 300)}, "die API gilt, nicht die Produktseite (13,97 cm)"


@pytest.mark.asyncio
async def test_sizes_with_their_own_area_get_their_own_print_file(db, provider):
    mug = (await templates.refresh(db, MUG, provider=provider, actor_id=ACTOR))["template"]
    assert sizes(mug) == {("default", (7011,)): (2250, 925, 300), ("default", (7015,)): (2253, 1084, 300)}
    assert templates.entry_for_variant(mug, None, "default", 7015)["height_px"] == 1084
    groups = templates.groups_for(mug, None, "default", [7011, 7015])
    assert [(entry["width_px"], ids) for entry, ids in groups] == [(2250, [7011]), (2253, [7015])]
    towel = (await templates.refresh(db, TOWEL, provider=provider, actor_id=ACTOR))["template"]
    assert sizes(towel) == {("default", (8030,)): (9300, 4800, 150), ("default", (8036,)): (11100, 5700, 150)}


@pytest.mark.asyncio
async def test_the_stored_template_is_refreshed_and_a_change_is_reported(db, provider, fake):
    first = await templates.refresh(db, SHIRT, provider=provider, actor_id=ACTOR)
    assert first["ok"] is True and first["changed"] is False
    again = await templates.refresh(db, SHIRT, provider=provider, actor_id=ACTOR)
    assert again["changed"] is False and again["template"]["hash"] == first["template"]["hash"]
    assert await db.audit_logs.count_documents({"action": "shop.print_template.change"}) == 0
    fake.set_print_area(SHIRT, "back", 12, 18, display_name="Back print")  # Printful vergrößert den Rücken
    changed = await templates.refresh(db, SHIRT, provider=provider, actor_id=ACTOR, reason="Täglicher Abgleich")
    assert changed["changed"] is True
    assert changed["changes"] == ["Geändert: Rückseite (dtg) - 1800 × 2400 px bei 150 DPI → 1800 × 2700 px bei 150 DPI."]
    stored = await templates.get(db, SHIRT)
    assert stored["changes"] == changed["changes"] and stored["changed_at"] and stored["previous_hash"]
    entry = await db.audit_logs.find_one({"action": "shop.print_template.change"}, {"_id": 0})
    assert entry["target_id"] == str(SHIRT) and entry["data"]["changes"] == changed["changes"]


@pytest.mark.asyncio
async def test_when_printful_fails_the_last_template_stays(db, provider, fake):
    good = (await templates.refresh(db, SHIRT, provider=provider, actor_id=ACTOR))["template"]
    fake.fail(500, times=10)
    failed = await templates.refresh(db, SHIRT, provider=provider, actor_id=ACTOR)
    assert failed["ok"] is False and failed["detail"]
    stored = await templates.get(db, SHIRT)
    assert stored["hash"] == good["hash"] and stored["last_error"]["detail"]
    assert stored["entries"] == good["entries"]


# ---------------------------------------------------------------- Vorgaben auf verschiedenen Flächen

def entry_of(template: dict, placement: str) -> dict:
    return next(row for row in template["entries"] if row["placement"] == placement)


def preset(key: str) -> dict:
    return next(item for item in templates.clean_presets(templates.DEFAULT_PRESETS) if item["key"] == key)


@pytest.mark.asyncio
async def test_a_preset_is_relative_to_the_area_and_lands_on_every_product(db, provider):
    shirt = entry_of((await templates.refresh(db, SHIRT, provider=provider, actor_id=ACTOR))["template"], "front")
    jersey = entry_of((await templates.refresh(db, JERSEY, provider=provider, actor_id=ACTOR))["template"], "front")
    cap = entry_of((await templates.refresh(db, CAP, provider=provider, actor_id=ACTOR))["template"], "front")
    # Brust rechts vom Träger aus: Mitte bei 27 % der Breite, 5 cm von oben, 8,9 cm breit (quadratisches Motiv).
    box = templates.place_motif(shirt, preset("chest_right"), width_cm=8.9, aspect=1.0)
    assert box.as_dict(150) == {"left_px": 223, "top_px": 295, "width_px": 526, "height_px": 526,
                                "left_cm": 3.78, "top_cm": 5.0, "width_cm": 8.91, "height_cm": 8.91}
    assert abs((box.left + box.width / 2) / shirt["width_px"] - 0.27) < 0.001
    # Dieselbe Vorgabe auf dem Trikot (4950 px breit): wieder 27 % - die Vorgabe ist relativ zur Fläche.
    wide = templates.place_motif(jersey, preset("chest_right"), width_cm=8.9, aspect=1.0)
    assert abs((wide.left + wide.width / 2) / jersey["width_px"] - 0.27) < 0.001 and round(wide.width) == 526
    # Kappe (1350 × 705 px bei 300 DPI): mittig, 10 cm breit bei einem Motiv 2:1.
    front = templates.place_motif(cap, preset("cap_front"), width_cm=10.0, aspect=0.5)
    left, top, width, height = front.rounded()
    assert (left, top, width, height) == (84, 57, 1182, 591), "Kanten gerundet, mittig in 1350 × 705"
    assert templates.problems(cap, front, "Löwe") == []
    # Vorne groß mit 28 cm passt aufs Shirt (30,48 cm), auf die Kappe nicht - mit Zahlen in px, cm und Zoll.
    too_big = templates.place_motif(cap, preset("front_large"), width_cm=28.0, aspect=0.5)
    found = templates.problems(cap, too_big, "Rückenlogo")
    assert found and "ragt" in found[0] and " px = " in found[0] and "cm (" in found[0] and "Zoll)" in found[0]
    assert templates.max_width_cm(cap, 0.5, templates.DEFAULT_RULES) == 11.4


@pytest.mark.asyncio
async def test_the_name_opposite_the_lion_sits_mirrored_with_its_middle_on_the_middle_of_the_lion(db, provider):
    shirt = entry_of((await templates.refresh(db, SHIRT, provider=provider, actor_id=ACTOR))["template"], "front")
    lion = templates.place_motif(shirt, preset("chest_right"), width_cm=8.9, aspect=1.2)
    name = templates.place_text(shirt, preset("text_opposite"), width_px=525, height_px=110, follow=lion)
    assert abs((name.left + name.width / 2) - (shirt["width_px"] - (lion.left + lion.width / 2))) < 1e-6
    assert abs((name.top + name.height / 2) - (lion.top + lion.height / 2)) < 1e-6
    below = templates.place_text(shirt, preset("text_below"), width_px=525, height_px=110, follow=lion)
    assert abs(below.top - (lion.bottom + templates.cm_to_px(1.0, 150))) < 1e-6
    with pytest.raises(ShopError, match="braucht ein Motiv"):
        templates.place_text(shirt, preset("text_opposite"), width_px=525, height_px=110, follow=None)


def test_the_safe_margin_keeps_motifs_away_from_the_edge():
    area = {"placement": "front", "family": "front", "label": "Vorderseite", "dpi": 150, "width_px": 4950,
            "height_px": 6750}
    rules = templates.clean_rules({"safe_margin_cm": {"front": 2.0}})
    box = templates.place_motif(area, preset("front_large"), width_cm=80.0, aspect=1.0, rules=rules)
    assert box.left >= templates.cm_to_px(2.0, 150) - 1e-6, "die Vorgabe bleibt im Sicherheitsrand"
    shifted = templates.place_motif(area, preset("front_large"), width_cm=80.0, aspect=1.0, offset_x_cm=-3,
                                    rules=rules)
    found = templates.problems(area, shifted, "Motiv", rules)
    assert found and "links" in found[0] and "Sicherheitsrand" in found[-1]


# ---------------------------------------------------------------- Vorgaben sind einstellbar

@pytest.mark.asyncio
async def test_presets_are_a_setting_with_reason_and_log(db):
    loaded = await templates.load_presets(db)
    assert loaded["is_default"] is True
    keys = {item["key"] for item in loaded["presets"]}
    assert {"chest_right", "chest_left", "front_center", "front_large", "back_large", "back_top", "neck", "sleeve",
            "label", "cap_front", "mug_wrap", "mug_side", "towel_center", "text_opposite"} <= keys
    changed = [dict(item) for item in loaded["presets"]]
    next(item for item in changed if item["key"] == "chest_right")["top_cm"] = 6.0
    changed.append({"key": "hip", "label": "Hüfte", "kind": "motif", "families": ["front"], "center_x": 0.8,
                    "anchor": "bottom", "top_cm": 3.0, "width_cm": 6.0})
    saved = await templates.save_presets(db, presets=changed, rules={"safe_margin_cm": {"front": 0.5}},
                                         actor_id=ACTOR, reason="Brust etwas tiefer")
    assert next(item for item in saved["presets"] if item["key"] == "chest_right")["top_cm"] == 6.0
    assert saved["rules"]["safe_margin_cm"]["front"] == 0.5 and saved["is_default"] is False
    entry = await db.audit_logs.find_one({"action": "shop.print.presets"}, {"_id": 0})
    assert entry["data"]["added"] == ["hip"] and entry["data"]["changed"] == ["chest_right"]
    assert entry["data"]["reason"] == "Brust etwas tiefer"
    for wrong in ([{"key": "X!", "label": "x", "kind": "motif", "families": ["front"], "width_cm": 5}],
                  [{"key": "ok_key", "label": "x", "kind": "motif", "families": ["mond"], "width_cm": 5}],
                  [{"key": "ok_key", "label": "x", "kind": "motif", "families": ["front"], "width_cm": 0}],
                  [{"key": "ok_key", "label": "x", "kind": "text", "families": ["front"], "follow": "irgendwo"}],
                  changed + [dict(changed[0])]):
        with pytest.raises(ShopError):
            await templates.save_presets(db, presets=wrong, actor_id=ACTOR, reason="Unsinn")
    with pytest.raises(ShopError):
        await templates.save_presets(db, rules={"min_dpi_ratio": 0.9, "warn_dpi_ratio": 0.5}, actor_id=ACTOR,
                                     reason="Unsinn")


# ---------------------------------------------------------------- Vorlagenbilder über die Website

def png(width: int = 40, height: int = 30) -> bytes:
    out = BytesIO()
    Image.new("RGBA", (width, height), (0, 0, 0, 90)).save(out, format="PNG")
    return out.getvalue()


@pytest.mark.asyncio
async def test_template_images_come_only_from_printful_hosts_once_and_re_encoded(db, provider, monkeypatch, tmp_path):
    import storage

    monkeypatch.setattr(storage, "UPLOAD_DIR", tmp_path)
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        assert request.url.host == TEMPLATE_HOST
        return httpx.Response(200, content=png(), headers={"content-type": "image/png"})

    monkeypatch.setattr(templates, "IMAGE_TRANSPORT", httpx.MockTransport(handler))
    template = (await templates.refresh(db, SHIRT, provider=provider, actor_id=ACTOR))["template"]
    first = await templates.template_image(db, SHIRT, 0)
    second = await templates.template_image(db, SHIRT, 0)
    assert first == second and len(seen) == 1, "zwischengespeichert"
    with Image.open(BytesIO(first)) as img:
        assert img.format == "PNG" and img.size == (40, 30) and "dpi" not in img.info
    with pytest.raises(LookupError):
        await templates.template_image(db, SHIRT, len(template["previews"]))
    with pytest.raises(LookupError):
        await templates.template_image(db, SHIRT, 0, layer="background")  # keine Hintergrund-Adresse gespeichert
    # Eine fremde Adresse in der Vorlage wird nie geholt (keine offene Weiterleitung).
    await db.shop_print_templates.update_one({"printful_product_id": SHIRT},
                                             {"$set": {"previews.1.image_url": "https://evil.example.test/x.png"}})
    with pytest.raises(LookupError):
        await templates.template_image(db, SHIRT, 1)
    assert len(seen) == 1
    for url in ("http://files.cdn.printful.com/a.png", "https://files.cdn.printful.com.evil.test/a.png",
                "https://user@files.cdn.printful.com/a.png", "https://files.cdn.printful.com:8443/a.png", None, 7):
        assert templates.allowed_image_url(url) is False, url


@pytest.mark.asyncio
async def test_template_images_refuse_redirects_wrong_types_and_oversize(db, provider, monkeypatch, tmp_path):
    import storage

    monkeypatch.setattr(storage, "UPLOAD_DIR", tmp_path)
    answers = iter([
        httpx.Response(302, headers={"location": "https://evil.example.test/"}),
        httpx.Response(200, content=b"<html>", headers={"content-type": "text/html"}),
        httpx.Response(200, content=b"x" * 100, headers={"content-type": "image/png",
                                                         "content-length": str(templates.IMAGE_MAX_BYTES + 1)}),
        httpx.Response(200, content=b"kein bild", headers={"content-type": "image/png"}),
    ])
    monkeypatch.setattr(templates, "IMAGE_TRANSPORT", httpx.MockTransport(lambda request: next(answers)))
    await templates.refresh(db, SHIRT, provider=provider, actor_id=ACTOR)
    for _ in range(4):
        with pytest.raises(templates.TemplateImageUnavailable):
            await templates.template_image(db, SHIRT, 0)
    cache = tmp_path / templates.CACHE_FOLDER
    assert not cache.exists() or not list(cache.glob("*.png")), "nichts Abgelehntes im Zwischenspeicher"


def test_the_contract_describes_the_new_paths():
    from printful_fake import MANIFEST, SPEC

    assert "/v2/catalog-products/{id}/mockup-styles" in SPEC["paths"]
    assert "/v2/catalog-products/{id}/mockup-templates" in SPEC["paths"]
    assert MANIFEST["print_templates"]["file_size"]["operation"] == "retrieveMockupStylesByProductId"


# ---------------------------------------------------------------- Zeilenweise lesen (#2091)
# Echte Antworten weichen gelegentlich vom Vertrag ab - der Fake liefert sie hier bewusst so (``off_contract``).

STYLES, TEMPLATES = "retrieveMockupStylesByProductId", "getMockupTemplatesByProductId"


def row_of(rows: list[dict], placement: str) -> dict:
    return next(row for row in rows if row["placement"] == placement)


def no_values(lines, *values) -> bool:
    """Kein Wert aus der Antwort in den Gründen - weder Text noch Adresse."""
    return all(line.count(value) == 0 for line in lines for value in values)


@pytest.mark.asyncio
async def test_one_broken_row_costs_only_that_row_and_names_field_and_type(db, provider, fake, caplog):
    fake.off_contract.update({STYLES, TEMPLATES})
    row_of(fake.print_areas[SHIRT], "front")["dpi"] = "viel"
    row_of(fake.print_areas[SHIRT], "back")["print_area_width"] = "12"  # Zahl als Text geht
    row_of(fake.print_areas[SHIRT], "sleeve_left")["dpi"] = 150.0  # ganzzahliger float geht
    with caplog.at_level("WARNING", logger="tls.printful"):
        result = await templates.refresh(db, SHIRT, provider=provider, actor_id=ACTOR)
    assert result["ok"] is True
    stored = result["template"]
    assert sorted(sizes(stored)) == [("back", "all"), ("label_inside", "all"), ("sleeve_left", "all"),
                                     ("sleeve_right", "all")]
    assert sizes(stored)[("back", "all")] == (1800, 2400, 150)
    assert stored["skipped"] == [
        "Druckvorgabe front (dtg): Feld dpi fehlt oder passt nicht (erwartet: ganze Zahl von 72 bis 1200).",
        "Unvollständig geliefert, nicht übernommen, bis Printful sie vollständig liefert: Vorderseite (dtg)."]
    assert no_values(stored["skipped"], "viel")
    logged = [record.getMessage() for record in caplog.records if "übersprungen" in record.getMessage()]
    assert len(logged) == 1 and "1 von 5 Zeilen" in logged[0] and no_values(logged, "viel")


@pytest.mark.asyncio
async def test_float_pixels_are_rounded_and_the_background_colour_comes_as_int(db, provider, fake):
    fake.off_contract.add(TEMPLATES)
    front = row_of(fake.templates[SHIRT], "front")
    front.update(template_width=1000.0, template_height=1000.0, print_area_left=199.6, print_area_top="200",
                 background_color=0x0C0C0C)
    stored = (await templates.refresh(db, SHIRT, provider=provider, actor_id=ACTOR))["template"]
    preview = templates.preview_for(stored, entry_of(stored, "front"))
    assert (preview["template_width"], preview["area"]["left"], preview["area"]["top"]) == (1000, 200, 200)
    assert preview["background_color"] == "#0c0c0c"
    assert stored["skipped"] == []


@pytest.mark.asyncio
async def test_without_an_image_the_area_stays_selectable_and_only_the_preview_is_missing(db, provider, fake):
    fake.off_contract.add(TEMPLATES)
    del row_of(fake.templates[SHIRT], "front")["image_url"]
    row_of(fake.templates[SHIRT], "back")["image_url"] = f"http://{TEMPLATE_HOST}/ohne-tls.png"
    row_of(fake.templates[SHIRT], "sleeve_left")["background_url"] = ""  # nur der Hintergrund fehlt
    result = await templates.refresh(db, SHIRT, provider=provider, actor_id=ACTOR)
    stored = result["template"]
    assert result["ok"] is True and ("front", "all") in sizes(stored) and ("back", "all") in sizes(stored)
    assert templates.preview_for(stored, entry_of(stored, "front")) is None
    assert templates.preview_for(stored, entry_of(stored, "back")) is None
    assert templates.preview_for(stored, entry_of(stored, "sleeve_left"))["background_url"] is None
    assert len(stored["skipped"]) == 2
    assert all("Feld image_url" in line and "Vorschau ohne Bild" in line for line in stored["skipped"])
    assert no_values(stored["skipped"], TEMPLATE_HOST, "ohne-tls")


@pytest.mark.asyncio
async def test_extra_images_are_ignored_and_the_real_template_is_preferred(db, provider, fake):
    fake.off_contract.add(TEMPLATES)
    back = row_of(fake.templates[SHIRT], "back")
    fake.templates[SHIRT][:0] = [
        {**back, "role": "unknown", "image_url": f"https://{TEMPLATE_HOST}/upload/unknown.png"},
        {"placement": "back", "technique": "dtg", "role": "extra", "template_type": "custom"},  # unvollständig, egal
        {**back, "role": "advanced_template", "template_type": "advanced"},
    ]
    stored = (await templates.refresh(db, SHIRT, provider=provider, actor_id=ACTOR))["template"]
    assert stored["skipped"] == [], "Zusatzbilder sind kein Fehler"
    assert [row["role"] for row in stored["previews"]].count("unknown") == 1
    assert len(stored["previews"]) == len(fake.templates[SHIRT]) - 2
    preview = templates.preview_for(stored, entry_of(stored, "back"))
    assert preview["role"] == "template" and preview["image_url"] == back["image_url"]


@pytest.mark.asyncio
async def test_unexpected_types_cost_only_their_row_never_a_500(db, provider, fake):
    """Review #2091: ``role`` als Liste ist nicht hashbar - das durfte den Abgleich nicht mit TypeError abbrechen."""
    fake.off_contract.update({STYLES, TEMPLATES})
    row_of(fake.templates[SHIRT], "front").update(role=["x"], template_type={"a": 1})
    row_of(fake.templates[SHIRT], "back")["catalog_variant_ids"] = "alle"
    row_of(fake.print_areas[SHIRT], "label_inside")["mockup_styles"] = [{"restricted_to_variants": [[1], {"a": 1}]}]
    result = await templates.refresh(db, SHIRT, provider=provider, actor_id=ACTOR)
    stored = result["template"]
    assert result["ok"] is True and ("label_inside", "all") in sizes(stored)
    front = templates.preview_for(stored, entry_of(stored, "front"))
    assert front is not None and front["role"] is None, "role ohne Text: Vorlage bleibt, nur ohne Rolle"
    assert templates.preview_for(stored, entry_of(stored, "back"))["variant_ids"] == []
    assert stored["skipped"] == []

    def broken(_row):
        raise TypeError("unerwartet")

    from services.printful_client import _RowSkip

    with pytest.raises(_RowSkip) as skip:
        provider._read_row(broken, {})
    assert skip.value.text == "Feld unbekannt fehlt oder passt nicht (erwartet: Felder mit den Typen laut Printful-Schema)."


@pytest.mark.asyncio
async def test_when_no_row_fits_the_fetch_fails_with_the_most_common_reason(db, provider, fake):
    fake.off_contract.add(STYLES)
    for row in fake.print_areas[SHIRT]:
        row["dpi"] = 0
    row_of(fake.print_areas[SHIRT], "label_inside").update(dpi=150, print_area_height=None)
    result = await templates.refresh(db, SHIRT, provider=provider, actor_id=ACTOR)
    assert result["ok"] is False
    detail = result["detail"]
    assert detail == ("Der Anbieter liefert keine einzige brauchbare Zeile. Druckvorgaben (mockup-styles): keine der 5 "
                      "Zeilen brauchbar. Häufigster Grund (4 von 5, z. B. front (dtg)): Feld dpi fehlt oder passt nicht "
                      "(erwartet: ganze Zahl von 72 bis 1200).")
    assert (await templates.get(db, SHIRT))["last_error"]["detail"] == detail
    from services.shop_fulfillment import FulfillmentPermanent

    with pytest.raises(FulfillmentPermanent) as refused:
        await provider.print_areas(CatalogProductId(SHIRT))
    assert refused.value.reason == "no_usable_rows"


@pytest.mark.asyncio
async def test_rows_without_a_readable_placement_or_technique_never_change_the_measures(db, provider, fake):
    """Review #2091: eine Zeile, die sich keinem Paar zuordnen lässt, könnte die Gruppe irgendeiner Fläche sein."""
    fake.off_contract.add(STYLES)
    for placement in ("sleeve_left", "sleeve_right"):
        row_of(fake.print_areas[SHIRT], placement)["technique"] = "DTG mit Leerzeichen"
    fresh = await templates.refresh(db, SHIRT, provider=provider, actor_id=ACTOR)
    assert fresh["ok"] is False and not fresh["template"].get("entries"), "ohne gespeicherten Stand: nichts übernehmen"
    assert fresh["detail"] == ("Printful liefert Druckvorgaben ohne lesbare Platzierung oder Technik - neue Maße nicht "
                               "übernommen.")
    stored = fresh["template"]
    assert stored["last_error"]["detail"] == fresh["detail"]
    assert stored["skipped"][0] == ("Druckvorgabe sleeve_left (unbekannte Technik): Feld technique fehlt oder passt "
                                    "nicht (erwartet: Technik-Kennung (a-z, 0-9, -)).")
    assert stored["skipped"][1].startswith("Druckvorgabe sleeve_right (unbekannte Technik)")
    assert no_values(stored["skipped"], "Leerzeichen")
    for placement in ("sleeve_left", "sleeve_right"):
        row_of(fake.print_areas[SHIRT], placement)["technique"] = "dtg"
    good = (await templates.refresh(db, SHIRT, provider=provider, actor_id=ACTOR))["template"]
    row_of(fake.print_areas[SHIRT], "back")["placement"] = "Rücken!"
    kept = await templates.refresh(db, SHIRT, provider=provider, actor_id=ACTOR)
    assert kept["ok"] is False and kept["detail"].endswith("neue Maße nicht übernommen, der letzte Stand bleibt.")
    stored = await templates.get(db, SHIRT)
    assert stored["entries"] == good["entries"] and stored["hash"] == good["hash"]
    assert stored["skipped"] == ["Druckvorgabe unbekannte Platzierung (dtg): Feld placement fehlt oder passt nicht "
                                 "(erwartet: Platzierungskennung (a-z, 0-9, _))."]


@pytest.mark.asyncio
async def test_a_partial_answer_keeps_the_stored_area_without_flapping(db, provider, fake):
    """Review #2091: fällt eine Zeile weg, kein „Entfällt“ und beim nächsten vollständigen Abruf kein „Neu“."""
    good = (await templates.refresh(db, SHIRT, provider=provider, actor_id=ACTOR))["template"]
    fake.off_contract.add(STYLES)
    back = row_of(fake.print_areas[SHIRT], "back")
    back["dpi"] = "kaputt"
    partial = await templates.refresh(db, SHIRT, provider=provider, actor_id=ACTOR)
    assert partial["ok"] is True and partial["changed"] is False and partial["changes"] == []
    stored = partial["template"]
    assert stored["hash"] == good["hash"] and stored["entries"] == good["entries"]
    assert templates.entry_for_variant(stored, "dtg", "back", 4012)["height_px"] == 2400
    assert stored["skipped"] == [
        "Druckvorgabe back (dtg): Feld dpi fehlt oder passt nicht (erwartet: ganze Zahl von 72 bis 1200).",
        "Unvollständig geliefert, es gilt weiter der letzte vollständige Stand: Rückseite (dtg)."]
    back["dpi"] = 150
    full = await templates.refresh(db, SHIRT, provider=provider, actor_id=ACTOR)
    assert full["changed"] is False and full["template"]["hash"] == good["hash"] and full["template"]["skipped"] == []
    assert await db.audit_logs.count_documents({"action": "shop.print_template.change"}) == 0


def mixed_mug(fake) -> dict:
    """Tasse mit allgemeiner Fläche und einer eigenen für 15 oz - dazu eine zweite Fläche, damit etwas übrig bleibt."""
    fake.print_areas[MUG] = [row for row in fake.print_areas[MUG]
                             if row["mockup_styles"][0]["restricted_to_variants"] != [7011]]
    fake.set_print_area(MUG, "default", 7.5, 3.0833, dpi=300, technique="sublimation")
    fake.set_print_area(MUG, "back", 3, 3, dpi=300, technique="sublimation")
    return next(row for row in fake.print_areas[MUG] if row["mockup_styles"][0]["restricted_to_variants"] == [7015])


@pytest.mark.asyncio
async def test_a_missing_variant_group_never_falls_back_to_the_general_area(db, provider, fake):
    restricted = mixed_mug(fake)
    fake.off_contract.add(STYLES)
    restricted["dpi"] = None
    result = await templates.refresh(db, MUG, provider=provider, actor_id=ACTOR)
    stored = result["template"]
    assert result["ok"] is True and sizes(stored) == {("back", "all"): (900, 900, 300)}
    assert templates.entry_for_variant(stored, "sublimation", "default", 7015) is None, "nie die allgemeine Fläche"
    assert templates.groups_for(stored, "sublimation", "default", [7011, 7015]) == []
    assert stored["skipped"][-1] == ("Unvollständig geliefert, nicht übernommen, bis Printful sie vollständig liefert: "
                                     "Druckfläche (sublimation).")


@pytest.mark.asyncio
async def test_a_missing_variant_group_keeps_the_stored_groups(db, provider, fake):
    restricted = mixed_mug(fake)
    good = (await templates.refresh(db, MUG, provider=provider, actor_id=ACTOR))["template"]
    assert sizes(good)[("default", (7015,))] == (2253, 1084, 300) and sizes(good)[("default", "all")] == (2250, 925, 300)
    fake.off_contract.add(STYLES)
    restricted["dpi"] = None
    stored = (await templates.refresh(db, MUG, provider=provider, actor_id=ACTOR))["template"]
    assert stored["hash"] == good["hash"] and sizes(stored) == sizes(good)
    assert templates.entry_for_variant(stored, "sublimation", "default", 7015)["height_px"] == 1084
    assert await db.audit_logs.count_documents({"action": "shop.print_template.change"}) == 0


@pytest.mark.asyncio
async def test_without_template_images_the_areas_stay(db, provider, fake):
    fake.fail(404, operation=TEMPLATES)
    result = await templates.refresh(db, SHIRT, provider=provider, actor_id=ACTOR)
    stored = result["template"]
    assert result["ok"] is True and len(stored["entries"]) == 5 and stored["previews"] == []
    assert stored["skipped"] == ["Vorlagenbilder nicht abrufbar (Beim Anbieter nicht gefunden (404)) - Vorschau ohne Bild."]


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [404, 401, 403])
async def test_a_permanent_template_failure_keeps_the_stored_previews(db, provider, fake, status):
    """Review #2091: ein dauerhafter Fehler bei mockup-templates schreibt keine leere Vorschau über einen guten Stand."""
    good = (await templates.refresh(db, SHIRT, provider=provider, actor_id=ACTOR))["template"]
    assert good["previews"] and entry_of(good, "front")["preview_indexes"]
    fake.fail(status, operation=TEMPLATES)
    result = await templates.refresh(db, SHIRT, provider=provider, actor_id=ACTOR)
    stored = result["template"]
    assert result["ok"] is True and stored["previews"] == good["previews"]
    assert [row["preview_indexes"] for row in stored["entries"]] == [row["preview_indexes"] for row in good["entries"]]
    assert stored["skipped"][-1].endswith("- die bisherigen bleiben.")


@pytest.mark.asyncio
async def test_a_temporary_template_failure_keeps_the_last_state(db, provider, fake):
    good = (await templates.refresh(db, SHIRT, provider=provider, actor_id=ACTOR))["template"]
    fake.fail(503, operation=TEMPLATES, times=10)
    failed = await templates.refresh(db, SHIRT, provider=provider, actor_id=ACTOR)
    assert failed["ok"] is False
    assert (await templates.get(db, SHIRT))["previews"] == good["previews"]


def test_an_empty_list_is_no_error_for_the_client(fake, provider):
    fake.print_areas[SHIRT] = []
    assert asyncio.run(provider.print_areas(CatalogProductId(SHIRT))) == ()


@pytest.mark.parametrize("data", [{"placement": "front"}, "front", None])
def test_the_client_still_refuses_a_response_without_a_list(data):
    """Zeilenweise lesen gilt nur für Zeilen - ist ``data`` gar keine Liste, ist die ganze Antwort unbrauchbar."""
    from services.shop_fulfillment import FulfillmentPermanent

    def answer(_request):
        return httpx.Response(200, json={"data": data, "paging": {"total": 1, "offset": 0, "limit": 100}})

    client = PrintfulClient(API_KEY, transport=httpx.MockTransport(answer))
    for read in (client.print_areas, client.mockup_templates):
        with pytest.raises(FulfillmentPermanent) as refused:
            asyncio.run(read(CatalogProductId(SHIRT)))
        assert refused.value.reason == "invalid_response"


def test_without_a_chosen_technique_direct_print_comes_first():
    """#2091: ohne Technik am Produkt und ohne Standard von Printful nicht die alphabetisch erste (dtfilm)."""
    entries = [{"technique": key, "placement": "front"} for key in ("dtfilm", "dtg", "embroidery")]
    template = {"entries": entries}
    assert {row["technique"] for row in templates.entries_for(template, None)} == {"dtg"}
    assert {row["technique"] for row in templates.entries_for(template, "embroidery")} == {"embroidery"}
    assert {row["technique"] for row in templates.entries_for(template, "laser")} == {"dtg"}
    assert {row["technique"] for row in templates.entries_for({"entries": entries[::2]}, None)} == {"dtfilm"}
    assert {row["technique"] for row in templates.entries_for({"entries": [{"technique": "uv", "placement": "default"}]},
                                                              None)} == {"uv"}