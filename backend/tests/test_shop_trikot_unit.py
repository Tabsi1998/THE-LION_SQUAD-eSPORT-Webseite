"""Trikot (#2142): Grenzen je Druckfläche statt fest, eigene Größe der Vereinsnummer (nur Ziffern, Kontur), Ebene
„Fester Text“ in der Grunddatei, Sportschrift, Trikot-Vorlagen und „unter der Ebene davor“.

Geprüft: eine große Rückennummer und ein großer Name gehen bis zur Fläche (die Meldung nennt die Grenze in cm), der Name
kommt in exakter Größe in die Bestelldatei, der feste Text liegt in der Grunddatei und macht sie bei einer Änderung
„veraltet“, die Vorlage „Trikot Rücken“ setzt drei Ebenen untereinander mit Abstand in cm. Nur synthetische Bilder,
erfundene Namen und Nummern - keine Vereinsgrafik."""
import hashlib
import pathlib
import sys
from io import BytesIO

import pytest
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from services import shop_catalog, shop_designs, shop_gamertag, shop_orders, shop_print_files, shop_products  # noqa: E402
from services import shop_print_templates as templates  # noqa: E402
from services.shop_common import ShopConflict, ShopError  # noqa: E402
from shop_testdata import publish_unchecked  # noqa: E402
from test_shop_allover_unit import NAVY, background, upload  # noqa: E402
from test_shop_products_unit import (  # noqa: E402,F401 - Fixtures und Helfer der Produktverwaltung
    BACK, BILLING, BY, LION, SHIPPING, WHITE_M, configured, db, design_dir, fake, provider, variant_for)

CM = 2.54
SPORT = "saira-condensed-900"
CLUB = {"kind": "text", "preset": "jersey_back_club", "text": "TESTVEREIN", "text_height_cm": 3.0, "max_width_cm": 25.0}


async def plan_of(db, product_id: str, color: str, placement: str = "back") -> shop_print_files.Plan:
    product = await shop_catalog.get_product(db, product_id)
    plans, _context = await shop_print_files.plans_for(db, product)
    return next(plan for row, plan, plan_color, _ids in plans if row["key"] == placement and plan_color == color)


def px(cm: float, dpi: int = 150) -> float:
    return cm / CM * dpi


# ---------------------------------------------------------------- Schrift, Nummer, Kontur (rein)

def test_the_sport_font_is_licensed_and_renders_umlauts():
    font = shop_gamertag.FONTS[SPORT]
    assert (shop_gamertag.FONT_DIR / font["license"]).read_text(encoding="utf-8").count("SIL Open Font License")
    rules = shop_gamertag.layer_rules(shop_gamertag.clean_rules({}), {"font": SPORT})
    assert rules["font"] == SPORT and shop_gamertag.rules_hash(rules) != shop_gamertag.rules_hash(
        shop_gamertag.clean_rules({}))
    assert shop_gamertag.render("Löwenbräu", rules).meta["font"] == SPORT
    # Herkunft nachprüfbar (#2142, Review N5): unverändert aus @fontsource/saira-condensed@5.3.0.
    assert hashlib.sha256((shop_gamertag.FONT_DIR / font["file"]).read_bytes()).hexdigest() == font["sha256"]
    assert font["package"] == "@fontsource/saira-condensed@5.3.0"


def test_a_number_takes_only_digits_and_its_canvas_is_as_high_as_the_digits():
    rules = shop_gamertag.layer_rules(shop_gamertag.clean_rules({}), {"text_height_cm": 20.0, "max_width_cm": 25.0,
                                                                      "font": SPORT})
    for wrong in ("", "12a", "1 2", "12345", "１２"):
        with pytest.raises(ShopError):
            shop_gamertag.render(wrong, rules, kind="number")
    number = shop_gamertag.render("07", rules, kind="number")
    name_height = shop_gamertag.canvas(rules)[1]
    assert number.meta["height_px"] < name_height * 0.6, "keine Luft für Akzente und Unterlängen"
    with Image.open(BytesIO(number.payload)) as img:
        top, bottom = img.getchannel("A").getbbox()[1::2]
    # Die Ziffern sind so hoch wie die Texthöhe (Großbuchstaben) - auf ein paar Prozent genau.
    assert (bottom - top) == pytest.approx(20.0 / CM * 300, rel=0.04)


def test_an_outline_lies_around_the_letters_in_the_most_contrasting_colour():
    plain = shop_gamertag.layer_rules(shop_gamertag.clean_rules({}), {"text_height_cm": 3.0, "max_width_cm": 20.0})
    framed = shop_gamertag.layer_rules(shop_gamertag.clean_rules({}), {"text_height_cm": 3.0, "max_width_cm": 20.0,
                                                                       "outline_cm": 0.3})
    assert "outline_in" not in plain and shop_gamertag.rules_hash(plain) != shop_gamertag.rules_hash(framed)
    white = shop_gamertag.render("TESTNAME", framed, color_key="reinweiss")
    assert white.meta["outline_key"] == "tiefschwarz" and white.meta["outline_px"] == round(0.3 / CM * 300)
    with Image.open(BytesIO(white.payload)) as img:
        colours = {pixel[:3] for pixel in img.get_flattened_data() if pixel[3] == 255}
    assert {(255, 255, 255), (0, 0, 0)} <= colours
    fixed = shop_gamertag.layer_rules(shop_gamertag.clean_rules({}), {"outline_cm": 0.3, "outline_ink": "vereinsblau"})
    assert shop_gamertag.render("TESTNAME", fixed, color_key="reinweiss").meta["outline_key"] == "vereinsblau"
    rules = shop_gamertag.clean_rules({})
    with pytest.raises(ShopError):
        shop_gamertag.layer_rules(rules, {"outline_cm": 5.0})
    # Beim Speichern streng ...
    for wrong in ({"outline_ink": "tiefschwarz"}, {"outline_cm": 0.3, "outline_ink": "lila"}, {"font": "comic-sans"},
                  {"font": ["liste"]}):
        with pytest.raises(ShopError):
            shop_gamertag.clean_layer_style(wrong, rules)
    # ... beim Rendern gilt eine entfernte Konturfarbe bzw. Schrift wieder automatisch (Review M2).
    gone = shop_gamertag.layer_rules(rules, {"outline_cm": 0.3, "outline_ink": "lila", "font": "comic-sans"})
    assert gone["font"] == rules["font"] and gone["outline_color"] is None
    assert shop_gamertag.render("TESTNAME", gone, color_key="reinweiss").meta["outline_key"] == "tiefschwarz"


def test_a_fixed_text_allows_punctuation_but_no_emoji():
    rules = shop_gamertag.clean_rules({})
    assert shop_gamertag.clean_fixed_text("  Testverein  e.V. & Co ", rules) == "Testverein e.V. & Co"
    for wrong in ("", "Löwen 🦁", "Zeile\nzwei", "a" * 41, "Preis: 5€"):
        with pytest.raises(ShopError):
            shop_gamertag.clean_fixed_text(wrong, rules)
    # Eine eigene feste Zeichenliste - unabhängig von den erlaubten Zeichen der Gamertag-Regeln (Review M2).
    strict = shop_gamertag.clean_rules({"allowed_chars": ""})
    assert shop_gamertag.clean_fixed_text("Löwen e.V. & Co", strict) == "Löwen e.V. & Co"


# ---------------------------------------------------------------- Grenzen je Fläche

@pytest.mark.asyncio
async def test_the_area_limits_name_and_number_and_the_message_names_it_in_cm(db, provider):
    product = await configured(db, provider, accept=False, generate=False, personalization="both")
    # Wie im Bericht des Obmanns: Vereinsnummer mit 10 cm - früher an „0,25 bis 5,08“ gescheitert.
    await shop_products.set_layout(db, product["id"], [
        {"key": "front", "layers": [LION]},
        {"key": "back", "layers": [{"kind": "gamertag", "preset": "text_back_top", "text_height_cm": 7.0,
                                    "max_width_cm": 28.0},
                                   {"kind": "member_number", "preset": "text_center", "text_height_cm": 10.0,
                                    "max_width_cm": 20.0}]}],
        included_placement="front", **BY)
    stored = await shop_catalog.get_product(db, product["id"])
    assert stored["placements"][1]["layers"][1]["text_height_cm"] == 10.0
    with pytest.raises(ShopError, match=r"Texthöhe: eine Zahl in cm von 0,25 bis [0-9,]+ - so viel lässt die Fläche "
                                        r"„Rückseite“ mit Sicherheitsrand zu"):
        await shop_products.set_layout(db, product["id"], [{"key": "back", "layers": [
            {"kind": "member_number", "preset": "text_center", "text_height_cm": 45.0}]}], included_placement=None,
            **BY)
    with pytest.raises(ShopError, match="Höchstbreite: eine Zahl in cm von 1,27 bis 30,48"):
        await shop_products.set_layout(db, product["id"], [{"key": "back", "layers": [
            {"kind": "gamertag", "preset": "text_center", "max_width_cm": 31.0}]}], included_placement=None, **BY)
    # Mit Sicherheitsrand wird die Grenze kleiner - dieselbe Rechnung für Planung, Vorschau und Datei.
    await templates.save_presets(db, rules={"safe_margin_cm": {"back": 2.0}}, actor_id="finanzen-test", reason="")
    with pytest.raises(ShopError, match="bis 26,48"):
        await shop_products.set_layout(db, product["id"], [{"key": "back", "layers": [
            {"kind": "gamertag", "preset": "text_center", "max_width_cm": 28.0}]}], included_placement=None, **BY)


@pytest.mark.asyncio
async def test_a_big_name_comes_into_the_order_file_in_exact_size(db, provider):
    product = await configured(db, provider, generate=False)
    name = {"kind": "gamertag", "preset": "jersey_back_name", "text_height_cm": 6.0, "max_width_cm": 28.0,
            "font": SPORT, "ink": "reinweiss"}
    await shop_products.set_layout(db, product["id"], [{"key": "front", "layers": [LION]},
                                                       {"key": "back", "layers": [name]}],
                                   included_placement="front", **BY)
    await shop_products.generate_print_files(db, product["id"], **BY)
    await publish_unchecked(db, product["id"])
    white = await variant_for(db, product["id"], WHITE_M)
    order, _ = await shop_orders.place_order(
        db, idempotency_key="trikot-name-1", lines=[{"variant_id": white["id"], "quantity": 1, "gamertag": "TELL"}],
        user_id="konto-1", buyer_kind="member", shipping_estimate_cents=490, billing_address=dict(BILLING),
        shipping_address=dict(SHIPPING), actor_id="konto-1")
    (item,) = await shop_orders.items_for(db, order["id"])
    back = next(row for row in item["print_files"] if row["placement"] == "back")
    tag = await db.shop_gamertag_files.find_one({"id": back["gamertag_file_id"]}, {"_id": 0})
    assert tag["font"] == SPORT and tag["text_height_in"] == pytest.approx(6.0 / CM, abs=0.005)
    plan = await plan_of(db, product["id"], "White")
    left, top, width, height = plan.texts[0].box.rounded()
    personal = await db.shop_print_files.find_one({"id": back["file_id"]}, {"_id": 0})
    with Image.open(shop_designs._path_of(personal["file_ref"])) as img:
        assert img.size == (1800, 2400)
        white_rows = [y for y in range(top, top + height)
                      if any(img.getpixel((x, y))[:3] == (255, 255, 255) and img.getpixel((x, y))[3] > 200
                             for x in range(left, left + width, 3))]
    # Die Großbuchstaben 6 cm hoch: bei 150 DPI gut 354 px (flache Buchstaben, ein paar Pixel Kantenglättung).
    assert max(white_rows) - min(white_rows) == pytest.approx(px(6.0), abs=6)


# ---------------------------------------------------------------- Fester Text in der Grunddatei

@pytest.mark.asyncio
async def test_a_fixed_text_is_part_of_the_base_file_and_a_change_makes_it_outdated(db, provider):
    product = await configured(db, provider, generate=False)
    club = {**CLUB, "font": SPORT, "ink": "reinweiss"}
    layout = [{"key": "front", "layers": [LION]}, {"key": "back", "layers": [club]}]
    await shop_products.set_layout(db, product["id"], layout, included_placement="front", **BY)
    await shop_products.generate_print_files(db, product["id"], **BY)
    plan = await plan_of(db, product["id"], "Black")
    assert plan.needs_base and [item.kind for item in plan.base_layers] == ["text"]
    base = await shop_print_files.current_base(db, product["id"], plan)
    left, top, width, height = plan.base_layers[0].box.rounded()
    with Image.open(shop_designs._path_of(base["file_ref"])) as img:
        inside = img.crop((left, top, left + width, top + height)).getchannel("A").getbbox()
        outside = img.crop((0, 0, 1800, top)).getchannel("A").getbbox()
        assert inside is not None and outside is None, "nur der Text, der Rest durchsichtig"
        assert (255, 255, 255) in {img.getpixel((x, top + height // 2))[:3] for x in range(left, left + width)}
    # Unten mit 8 cm Abstand vom Rand (Vorgabe „Vereinsname unten“) - gemessen am Rahmen der Leinwand.
    assert plan.base_layers[0].box.bottom == pytest.approx(2400 - px(8.0), abs=1)
    states = await shop_print_files.states(db, await shop_catalog.get_product(db, product["id"]))
    assert {state["state"] for state in states if state["placement"] == "back"} == {"ok"}
    await shop_products.set_layout(db, product["id"], [layout[0], {"key": "back", "layers": [
        {**club, "text": "ANDERER VEREIN"}]}], included_placement="front", **BY)
    changed = await plan_of(db, product["id"], "Black")
    assert changed.layout_hash != plan.layout_hash
    states = await shop_print_files.states(db, await shop_catalog.get_product(db, product["id"]))
    assert {state["state"] for state in states if state["placement"] == "back"} == {"outdated"}
    with pytest.raises(ShopError, match="Fester Text"):
        await shop_products.set_layout(db, product["id"], [layout[0], {"key": "back", "layers": [
            {**club, "text": "Löwen 🦁"}]}], included_placement="front", **BY)
    with pytest.raises(ShopError, match="Motiv"):
        await shop_products.set_layout(db, product["id"], [{"key": "front", "layers": [{**LION, "text": "X"}]}],
                                       included_placement="front", **BY)


@pytest.mark.asyncio
async def test_the_preview_draws_the_fixed_text_and_the_sample_number(db, provider):
    product = await configured(db, provider, generate=False, personalization="both")
    await shop_products.set_layout(db, product["id"], [{"key": "front", "layers": [LION]}, {"key": "back", "layers": [
        {"kind": "member_number", "preset": "text_center", "text_height_cm": 15.0, "max_width_cm": 25.0, "font": SPORT,
         "ink": "reinweiss"},
        {**CLUB, "ink": "reinweiss"}]}], included_placement="front", **BY)
    stored = await shop_catalog.get_product(db, product["id"])
    payload = await shop_print_files.preview_png(db, stored, placement="back", color="Black")
    with Image.open(BytesIO(payload)) as img:
        whites = sum(1 for pixel in img.convert("RGB").get_flattened_data() if pixel == (255, 255, 255))
    assert whites > 500, "Beispielnummer und Vereinsname weiß auf schwarz"
    assert await shop_print_files.sample_number(db) == "99", "die höchste Wunschnummer (Vorgabe 0 bis 99)"
    await db.settings.insert_one({"id": "jersey_numbers", "max": 250})
    assert await shop_print_files.sample_number(db) == "250"


# ---------------------------------------------------------------- Trikot-Vorlagen

@pytest.mark.asyncio
async def test_the_jersey_back_template_sets_three_layers_one_below_the_other(db, provider):
    product = await configured(db, provider, generate=False, personalization="both")
    sets = {item["key"]: item for item in (await templates.load_presets(db))["sets"]}
    layers, skipped = templates.set_layers(sets["jersey_back"], personalization="both")
    assert [layer["kind"] for layer in layers] == ["gamertag", "member_number", "text"] and not skipped
    assert {layer["font"] for layer in layers} == {SPORT}
    # Auf dem Rücken eines T-Shirts (30,48 × 40,64 cm) etwas kleiner als auf dem Allover-Trikot.
    sizes = {"gamertag": 4.0, "member_number": 11.0, "text": 2.5}
    layers = [{**layer, "text_height_cm": sizes[layer["kind"]], "min_text_height_cm": sizes[layer["kind"]] / 2,
               "max_width_cm": 30.0} for layer in layers]
    await shop_products.set_layout(db, product["id"], [{"key": "front", "layers": [LION]},
                                                       {"key": "back", "layers": layers}],
                                   included_placement="front", **BY)
    plan = await plan_of(db, product["id"], "Black")
    assert not plan.problems
    name, number, club = plan.layers
    assert (name.kind, number.kind, club.kind) == ("gamertag", "member_number", "text")
    # Mittig, untereinander: zwischen den Großbuchstaben des Namens und den Ziffern genau 2 cm (Vorgabe).
    for item in plan.layers:
        assert item.box.left + item.box.width / 2 == pytest.approx(900, abs=1)
    assert number.visual[0] - name.visual[1] == pytest.approx(px(2.0), abs=1)
    assert name.box.top == pytest.approx(px(8.0), abs=1), "Name oben: 8 cm vom Rand der Fläche (Vorgabe)"
    assert number.visual[1] < club.visual[0], "die Nummer endet über dem Vereinsnamen"
    # Ohne Personalisierung Vereinsnummer fehlt sie - mit Satz.
    layers, skipped = templates.set_layers(sets["jersey_back"], personalization="gamertag")
    assert [layer["kind"] for layer in layers] == ["gamertag", "text"]
    assert skipped == ["Vereinsnummer ausgelassen - braucht die Personalisierung „Vereinsnummer“."]
    chest, _ = templates.set_layers(sets["jersey_chest"], personalization="both", motif_key="loewe-weiss")
    assert [layer["kind"] for layer in chest] == ["motif", "member_number"] and chest[0]["motif"]["key"] == "loewe-weiss"


@pytest.mark.asyncio
async def test_new_default_presets_join_a_saved_list_unless_removed_on_purpose(db):
    old = [item for item in templates.clean_presets(templates.DEFAULT_PRESETS)
           if item["key"] in templates.LEGACY_DEFAULT_KEYS]
    await db.settings.insert_one({"id": templates.SETTINGS_ID, "presets": old})
    loaded = await templates.load_presets(db)
    keys = [item["key"] for item in loaded["presets"]]
    assert {"jersey_back_name", "jersey_back_number", "jersey_back_club"} <= set(keys)
    assert [item["key"] for item in loaded["sets"]] == ["jersey_back", "jersey_chest"]
    without = [item for item in loaded["presets"] if item["key"] != "jersey_back_club"]
    saved = await templates.save_presets(db, presets=without, actor_id="finanzen-test", reason="")
    assert "jersey_back_club" not in [item["key"] for item in saved["presets"]], "bewusst entfernt bleibt weg"
    assert [item["key"] for item in saved["sets"]] == ["jersey_chest"], "die Vorlage ohne ihre Vorgabe fällt weg"
    with pytest.raises(ShopError, match="jersey_back_club"):
        await templates.save_presets(db, sets=templates.DEFAULT_SETS, actor_id="finanzen-test", reason="")


@pytest.mark.asyncio
async def test_a_stack_preset_needs_a_layer_before_it(db, provider):
    product = await configured(db, provider, accept=False, generate=False, personalization="both")
    with pytest.raises(ShopError, match="braucht eine Ebene davor"):
        await shop_products.set_layout(db, product["id"], [{"key": "back", "layers": [
            {"kind": "member_number", "preset": "jersey_back_number"}]}], included_placement=None, **BY)


# ---------------------------------------------------------------- Namen auf dem Hintergrund (Screenshot des Obmanns)

@pytest.mark.asyncio
async def test_names_on_a_background_take_their_colour_from_it(db, provider):
    product = await configured(db, provider, generate=False, personalization="both")
    await shop_products.set_layout(db, product["id"], [
        {"key": "front", "layers": [LION]},
        {"key": "back", "mode": "upload", "layers": [{"kind": "gamertag", "preset": "text_back_top"},
                                                     {"kind": "member_number", "preset": "text_center",
                                                      "text_height_cm": 10.0, "max_width_cm": 20.0}]}],
        included_placement="front", **BY)
    await upload(db, product["id"], "White", background(top=NAVY))
    plan = await plan_of(db, product["id"], "White")
    assert plan.background_ok and not plan.on_background
    for item in plan.texts:
        assert item.surface["source"] == "background" and item.surface["variant"] == "dark"
    state = next(state for state in await shop_print_files.states(db, await shop_catalog.get_product(db, product["id"]))
                 if state["placement"] == "back" and state["color"] == "White")
    assert state["background_ok"] is True
    assert {layer["surface"]["text"] for layer in state["plan"]["layers"]} == {"Fassung: dunkel (aus Hintergrund)"}


# ---------------------------------------------------------------- Review: echte Namen, Last, Freigabe

def _set_rules(item: dict, layer_kind: str) -> dict:
    layer = next(layer for layer in item["layers"] if layer["kind"] == layer_kind)
    return shop_gamertag.layer_rules(shop_gamertag.clean_rules({}), shop_print_files.layer_spec(layer))


@pytest.mark.parametrize("text", ["GAMERTAG", "LÖWENBRÄU", "W" * 16, "Testname_mit-16"[:16]])
def test_the_jersey_back_template_takes_real_names_rendered(text):
    back = next(item for item in templates.DEFAULT_SETS if item["key"] == "jersey_back")
    rules = _set_rules(back, "gamertag")
    rendered = shop_gamertag.render(text, rules)
    assert rendered.meta["width_px"] * rendered.meta["height_px"] <= shop_gamertag.MAX_CANVAS_PIXELS
    if text == "GAMERTAG":
        assert not rendered.meta["scaled"], "ein normaler Name in voller Höhe"
    with Image.open(BytesIO(rendered.payload)) as img:
        assert img.getchannel("A").getbbox()[2] <= img.width


@pytest.mark.parametrize("number", ["7", "23", "888", "8888", "9999"])
def test_the_jersey_templates_take_every_wish_number_rendered(number):
    for key in ("jersey_back", "jersey_chest"):
        item = next(entry for entry in templates.DEFAULT_SETS if entry["key"] == key)
        rendered = shop_gamertag.render(number, _set_rules(item, "member_number"), kind="number")
        assert rendered.meta["width_px"] * rendered.meta["height_px"] <= shop_gamertag.MAX_CANVAS_PIXELS
    club = shop_gamertag.render("THE LION SQUAD", _set_rules(next(entry for entry in templates.DEFAULT_SETS
                                                                  if entry["key"] == "jersey_back"), "text"),
                                kind="text")
    assert not club.meta["scaled"]


def test_a_canvas_over_20_million_pixels_is_refused():
    rules = shop_gamertag.layer_rules(shop_gamertag.clean_rules({}), {"text_height_cm": 30.0, "max_width_cm": 45.0})
    assert shop_gamertag.MAX_CANVAS_PIXELS == 20_000_000
    with pytest.raises(ShopError, match="20 Millionen Pixel"):
        shop_gamertag.render("TEST", rules)
    assert "Millionen Pixel" in shop_gamertag.fit_problem(rules, "TEST")


@pytest.mark.asyncio
async def test_saving_checks_the_highest_wish_number_and_the_fixed_text_and_hints_at_long_names(db, provider):
    product = await configured(db, provider, accept=False, generate=False, personalization="both")
    await db.settings.insert_one({"id": "jersey_numbers", "max": 9999})
    number = {"kind": "member_number", "preset": "text_center", "text_height_cm": 20.0, "max_width_cm": 30.0,
              "font": SPORT}
    with pytest.raises(ShopError, match=r"die höchste Wunschnummer \(4 Stellen\) passt nicht"):
        await shop_products.set_layout(db, product["id"], [{"key": "back", "layers": [
            {**number, "min_text_height_cm": 15.0}]}], included_placement=None, **BY)
    with pytest.raises(ShopError, match="Der Text ist zu breit"):
        await shop_products.set_layout(db, product["id"], [{"key": "back", "layers": [
            {**CLUB, "text": "EIN SEHR LANGER VEREINSNAME", "text_height_cm": 5.0, "min_text_height_cm": 5.0}]}],
            included_placement=None, **BY)
    name = {"kind": "gamertag", "preset": "text_back_top", "text_height_cm": 5.0, "max_width_cm": 28.0, "font": SPORT}
    await shop_products.set_layout(db, product["id"], [{"key": "front", "layers": [LION]}, {"key": "back", "layers": [
        name, {**number, "min_text_height_cm": 10.0}]}], included_placement="front", **BY)
    view = await shop_products.admin_view(db, product["id"])
    back = next(row for row in view["placements"] if row["key"] == "back")
    assert back["layer_hints"][0].startswith("Hinweis: der längste erlaubte Name (16 × „W“) passt nicht")
    assert back["layer_hints"][1] is None
    # Wie gespeichert, rendert die höchste Nummer wirklich.
    stored = (await shop_catalog.get_product(db, product["id"]))["placements"][1]["layers"][1]
    rules = shop_gamertag.layer_rules(await shop_gamertag.load_rules(db), shop_print_files.layer_spec(stored))
    assert shop_gamertag.render("9999", rules, kind="number").meta["scaled"]


@pytest.mark.asyncio
async def test_text_renderings_share_two_slots_outside_the_event_loop(monkeypatch):
    import asyncio
    import threading
    import time

    running, peak, threads = [0], [0], set()
    lock = threading.Lock()

    def slow(raw, rules, *, color_key=None, kind="gamertag"):
        with lock:
            running[0] += 1
            peak[0] = max(peak[0], running[0])
        threads.add(threading.get_ident())
        time.sleep(0.05)
        with lock:
            running[0] -= 1
        return "fertig"

    monkeypatch.setattr(shop_gamertag, "render", slow)
    rules = shop_gamertag.clean_rules({})
    results = await asyncio.gather(*(shop_gamertag.render_async("TEST", rules) for _ in range(6)))
    assert results == ["fertig"] * 6 and peak[0] == shop_gamertag.RENDER_SLOTS
    assert threading.get_ident() not in threads, "nie in der Ereignisschleife"
    slot = shop_gamertag.render_semaphore()
    for _ in range(shop_gamertag.RENDER_SLOTS):
        await slot.acquire()
    with pytest.raises(shop_gamertag.RenderBusy):
        await shop_gamertag.render_async("TEST", rules, wait=0.01)


@pytest.mark.asyncio
async def test_the_sample_comes_in_preview_resolution_within_the_area(db, provider):
    product = await configured(db, provider, accept=False, generate=False, personalization="both")
    layer = {"kind": "member_number", "text_height_cm": 20.0, "max_width_cm": 25.0, "font": SPORT}
    payload = await shop_print_files.sample_png(db, product, kind="member_number", color="Black", layer=layer)
    rules = shop_gamertag.layer_rules(await shop_gamertag.load_rules(db), layer)
    with Image.open(BytesIO(payload)) as img:
        assert img.size == shop_gamertag.canvas(shop_gamertag.preview_rules(rules), "number")
        assert img.info["dpi"][0] == pytest.approx(100, abs=1)
    bounds = await shop_products.text_bounds_for(db, product, "back", layer)
    assert bounds["width_cm"] == pytest.approx(30.48) and bounds["label"] == "Rückseite"
    with pytest.raises(ShopError, match="Rückseite"):
        await shop_print_files.sample_png(db, product, kind="member_number", color="Black",
                                          layer={**layer, "text_height_cm": 45.0}, bounds=bounds)
    with pytest.raises(LookupError):
        await shop_products.text_bounds_for(db, product, "nirgends", layer)


@pytest.mark.asyncio
async def test_a_member_number_layer_blocks_the_review_until_it_is_printed(db, provider):
    product = await configured(db, provider, generate=False, personalization="both")
    await shop_products.set_layout(db, product["id"], [
        {"key": "front", "layers": [LION, {"kind": "gamertag", "preset": "text_opposite"}]},
        {"key": "back", "layers": [BACK, {"kind": "member_number", "preset": "text_back_top"}]}],
        included_placement="front", **BY)
    await shop_products.generate_print_files(db, product["id"], **BY)
    check = await shop_products.run_check(db, await shop_catalog.get_product(db, product["id"]))
    item = next(entry for entry in check["items"] if entry["key"] == "member_number_print")
    assert not item["ok"] and item["for_review"] and "#1727" in item["detail"]
    assert not check["review_ready"]
    with pytest.raises(ShopConflict, match="Vereinsnummer im Druck"):
        await shop_products.set_status(db, product["id"], "reviewed", **BY)


@pytest.mark.asyncio
async def test_new_default_sets_join_a_saved_list_unless_removed_on_purpose(db):
    presets = templates.clean_presets(templates.DEFAULT_PRESETS)
    chest = next(item for item in templates.DEFAULT_SETS if item["key"] == "jersey_chest")
    await db.settings.insert_one({"id": templates.SETTINGS_ID, "presets": presets, "sets": [chest]})
    loaded = await templates.load_presets(db)
    assert [item["key"] for item in loaded["sets"]] == ["jersey_chest", "jersey_back"], "neu dazu"
    saved = await templates.save_presets(db, sets=[chest], actor_id="finanzen-test", reason="")
    assert [item["key"] for item in saved["sets"]] == ["jersey_chest"], "bewusst entfernt bleibt weg"
    for wrong in ([{"key": "x1", "label": "X", "families": [["back"]], "layers": []}],
                  [{"key": "x1", "label": "X", "families": ["back"], "layers": [{"kind": ["text"], "preset": "p"}]}]):
        with pytest.raises(ShopError):
            await templates.save_presets(db, sets=wrong, actor_id="finanzen-test", reason="")