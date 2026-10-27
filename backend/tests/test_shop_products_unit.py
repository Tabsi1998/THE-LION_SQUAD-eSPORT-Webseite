"""Produktverwaltung (#1707) und Katalogabgleich (#1709) ohne Routen: Printful-Produkt laden, Farben und Größen
anbieten, Druckflächen mit Motiv, Vorgabe-Position und Größe (#2069), Druckdateien je Farbe, Preise, Vorab-Prüfung und
Stand, Abgleich und das Einfrieren je Fläche in der Bestellung.

Printful ist der Vertrags-Fake (``tests/printful_fake.py``) über den echten Adapter - kein echter Aufruf. Die Datenbank
ist mongomock mit den echten Indizes. Erfundene Testdaten: Produkt- und Variantennummern, Designs und Personen gibt es
so nicht."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio
from mongomock_motor import AsyncMongoMockClient

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from printful_fake import API_KEY, FakePrintful  # noqa: E402
from services import (  # noqa: E402
    printful_client, shop_catalog, shop_catalog_sync, shop_designs, shop_orders, shop_print_files, shop_products,
    shop_schema)
from models import now_utc  # noqa: E402
from services.printful_client import PrintfulClient  # noqa: E402
from services.shop_common import ShopConflict, ShopError  # noqa: E402
from shop_testdata import publish_unchecked, stored_design  # noqa: E402

ACTOR = "finanzen-test"
BY = {"actor_id": ACTOR, "reason": "Testdaten anlegen"}
PRINTFUL_PRODUCT = 71
BLACK_M, BLACK_L, WHITE_M, WHITE_L = 4012, 4013, 4014, 4015
# Das Testshirt aus #2062: Löwe vorne rechts (vom Träger aus), Gamertag gegenüber, Rückenlogo.
LION = {"kind": "motif", "preset": "chest_right", "width_cm": 8.9, "motif": {"key": "loewe-weiss"}}
GAMERTAG = {"kind": "gamertag", "preset": "text_opposite"}
BACK = {"kind": "motif", "preset": "back_large", "width_cm": 28.0, "motif": {"key": "ruecken-weiss"}}
PLACEMENTS = [{"key": "front", "layers": [LION, GAMERTAG]}, {"key": "back", "layers": [BACK]}]


@pytest.fixture(autouse=True)
def design_dir(monkeypatch, tmp_path):
    """Echte Dateien für den Generator (#2069) - in einem eigenen Ordner je Test."""
    import storage

    monkeypatch.setattr(storage, "SHOP_DESIGN_DIR", tmp_path / "shop-designs")
    monkeypatch.setattr(storage, "UPLOAD_DIR", tmp_path)
    return tmp_path / "shop-designs"
BILLING = {"name": "Testperson Eins", "street": "Probegasse 1", "zip": "1010", "city": "Wien", "country": "AT",
           "source": "dolibarr"}
SHIPPING = {"recipient": "Testperson Zwei", "street": "Musterweg 2", "zip": "8010", "city": "Graz", "country": "AT",
            "source": "checkout"}


@pytest.fixture
def fake():
    instance = FakePrintful()
    instance.add_product(PRINTFUL_PRODUCT, ((BLACK_M, "M", "Black"), (BLACK_L, "L", "Black"), (WHITE_M, "M", "White"),
                                            (WHITE_L, "L", "White")),
                         price="9.75", placement_prices={"front": "5.25", "back": "5.25"},
                         name="Unisex Testshirt | Gildan 5000")
    return instance


@pytest.fixture
def provider(fake, monkeypatch):
    async def no_wait(_seconds):
        return None

    monkeypatch.setattr(printful_client, "_sleep", no_wait)
    return PrintfulClient(API_KEY, transport=fake.transport())


@pytest_asyncio.fixture
async def db():
    instance = AsyncMongoMockClient()["shop_produkte"]
    await shop_schema.apply(instance)
    # Wie beim Start (database.init_audit_indexes): Sperren sind je Ressource eindeutig.
    await instance.mutation_locks.create_index("resource", unique=True)
    return instance


async def new_product(db, **fields):
    values = {"title": "Vereinsshirt Test", "visibility": "members", "personalization": "gamertag", **fields}
    return await shop_catalog.create_product(db, values, **BY)


async def design(db, key: str, placement: str, colors: list[str], *, width: int = 1200, height: int = 1200):
    return await stored_design(db, key, placement, colors, width=width, height=height, **BY)


async def club_designs(db, *, white_back: bool = True):
    await design(db, "loewe-weiss", "front_right", ["Black"])
    # Teil A (#2069): die Fassung für helle Shirts entsteht automatisch (Weiß wird dunkel umgefärbt).
    from services import shop_motifs

    await shop_motifs.refresh_auto_light(db, "loewe-weiss", **BY)
    await design(db, "loewe-schwarz", "front_right", ["White"], height=1300)
    await design(db, "ruecken-weiss", "back", ["Black"], width=3000, height=3000)
    if white_back:
        await design(db, "ruecken-schwarz", "back", ["White"], width=3000, height=3000)


async def configured(db, provider, *, white_back: bool = True, accept: bool = True, generate: bool = True,
                     **fields) -> dict:
    """Ein Testshirt wie in #2062: schwarz und weiß, M und L, Löwe vorne rechts, Gamertag gegenüber, Rückenlogo -
    mit erzeugten Druckdateien je Farbe."""
    product = await new_product(db, **fields)
    await shop_products.load_printful_product(db, product["id"], PRINTFUL_PRODUCT, provider=provider, **BY)
    await shop_products.set_offer(db, product["id"], technique="dtg", colors=["Black", "White"], sizes=["M", "L"],
                                  provider=provider, **BY)
    await club_designs(db, white_back=white_back)
    await shop_products.set_layout(db, product["id"], PLACEMENTS, included_placement="front", **BY)
    if generate:
        await shop_products.generate_print_files(db, product["id"], **BY)
    if accept:
        await shop_products.accept_prices(db, product["id"], **BY)
    return await shop_catalog.get_product(db, product["id"])


async def variant_for(db, product_id: str, printful_variant_id: int) -> dict:
    for variant in await shop_catalog.variants_of(db, product_id):
        mapping = await shop_catalog.printful_variant_for(db, variant["id"])
        if mapping and mapping["printful_variant_id"] == printful_variant_id:
            return variant
    raise AssertionError(f"keine Variante zu {printful_variant_id}")


def check_item(view: dict, key: str) -> dict:
    return next(item for item in view["check"]["items"] if item["key"] == key)


# ---------------------------------------------------------------- Produkt: Sichtbarkeit, Personalisierung, Stand

@pytest.mark.asyncio
async def test_public_products_never_carry_a_personalization(db):
    for personalization in ("gamertag", "member_number", "both"):
        with pytest.raises(ShopError, match="Öffentlich"):
            await new_product(db, visibility="public", personalization=personalization)
    members = await new_product(db, personalization="both")
    with pytest.raises(ShopError, match="Öffentlich"):
        await shop_catalog.update_product(db, members["id"], {"visibility": "public"}, **BY)
    public = await new_product(db, title="Kappe Test", visibility="public", personalization="none")
    with pytest.raises(ShopError, match="Öffentlich"):
        await shop_catalog.update_product(db, public["id"], {"personalization": "gamertag"}, **BY)
    assert await db.shop_products.count_documents({"visibility": "public", "personalization": {"$ne": "none"}}) == 0


@pytest.mark.asyncio
async def test_the_personalization_decides_whether_a_gamertag_may_be_ordered(db):
    product = await new_product(db, personalization="member_number")
    assert product["gamertag_allowed"] is False
    changed, _ = await shop_catalog.update_product(db, product["id"], {"personalization": "both"}, **BY)
    assert changed["gamertag_allowed"] is True
    with pytest.raises(ShopError):
        await shop_catalog.update_product(db, product["id"], {"personalization": "alles"}, **BY)


@pytest.mark.asyncio
async def test_a_new_product_needs_only_a_title_and_gets_a_slug(db):
    product = await new_product(db, title="Löwen-Shirt Größe Spaß")
    assert product["slug"] == "loewen-shirt-groesse-spass"
    assert product["status"] == "draft" and product["base_price_cents"] is None and product["markup_cents"] is None


@pytest.mark.asyncio
async def test_the_status_changes_only_through_the_check(db):
    with pytest.raises(ShopError, match="Prüfung"):
        await new_product(db, status="active")
    product = await new_product(db)
    with pytest.raises(ShopError, match="Prüfung"):
        await shop_catalog.update_product(db, product["id"], {"status": "active"}, **BY)
    assert (await shop_catalog.get_product(db, product["id"]))["status"] == "draft"


# ---------------------------------------------------------------- Printful-Katalog

@pytest.mark.asyncio
async def test_loading_a_printful_product_keeps_colors_sizes_and_print_areas_without_prices(db, provider, fake):
    product = await new_product(db)
    loaded = await shop_products.load_printful_product(db, product["id"], PRINTFUL_PRODUCT, provider=provider, **BY)
    printful = loaded["printful"]
    assert printful["product_id"] == PRINTFUL_PRODUCT and "Gildan 5000" in printful["name"]
    assert [color["name"] for color in printful["colors"]] == ["Black", "White"]
    assert printful["sizes"] == ["M", "L"]
    assert [(row["placement"], row["technique"]) for row in printful["placements"]] == [("front", "dtg"), ("back", "dtg")]
    assert {row["id"] for row in printful["variants"]} == {BLACK_M, BLACK_L, WHITE_M, WHITE_L}
    assert fake.calls_to("getVariantPricesById") == [], "Preise erst für die angebotenen Varianten"


@pytest.mark.asyncio
async def test_a_variant_number_is_not_accepted_as_a_product_number(db, provider):
    product = await new_product(db)
    with pytest.raises(ShopError, match="kein Produkt"):
        await shop_products.load_printful_product(db, product["id"], BLACK_M, provider=provider, **BY)
    for wrong in ("71", 0, -3, True, 7.1):
        with pytest.raises(ShopError):
            await shop_products.load_printful_product(db, product["id"], wrong, provider=provider, **BY)
    assert (await shop_catalog.get_product(db, product["id"])).get("printful") is None


@pytest.mark.asyncio
async def test_offering_colors_and_sizes_creates_variants_with_printful_numbers_and_purchase_prices(db, provider, fake):
    product = await new_product(db)
    await shop_products.load_printful_product(db, product["id"], PRINTFUL_PRODUCT, provider=provider, **BY)
    await shop_products.set_offer(db, product["id"], technique="dtg", colors=["Black"], sizes=["M", "L"],
                                  provider=provider, **BY)
    variants = await shop_catalog.variants_of(db, product["id"])
    assert sorted(variant["label"] for variant in variants) == ["Black / L", "Black / M"]
    medium = await variant_for(db, product["id"], BLACK_M)
    mapping = await shop_catalog.printful_variant_for(db, medium["id"])
    assert mapping["printful_product_id"] == PRINTFUL_PRODUCT
    assert mapping["base_cost_cents"] == 975 and mapping["placement_costs"] == {"front": 525, "back": 525}
    assert mapping["in_stock"] is True and mapping["synced_at"]
    # Nur die zwei angebotenen Varianten kosten einen Preisaufruf.
    assert sorted(call["path"] for call in fake.calls_to("getVariantPricesById")) == [
        "/v2/catalog-variants/4012/prices", "/v2/catalog-variants/4013/prices"]
    # Weniger anbieten: die Variante bleibt (Bestellungen zeigen auf sie), ist aber nicht mehr aktiv.
    await shop_products.set_offer(db, product["id"], technique="dtg", colors=["Black"], sizes=["M"],
                                  provider=provider, **BY)
    large = await variant_for(db, product["id"], BLACK_L)
    assert large["active"] is False


@pytest.mark.asyncio
async def test_the_offer_takes_only_colors_sizes_and_techniques_of_the_printful_product(db, provider):
    product = await new_product(db)
    with pytest.raises(ShopError, match="Printful-Produkt"):
        await shop_products.set_offer(db, product["id"], technique="dtg", colors=["Black"], sizes=["M"],
                                      provider=provider, **BY)
    await shop_products.load_printful_product(db, product["id"], PRINTFUL_PRODUCT, provider=provider, **BY)
    for colors, sizes, technique in ((["Pink"], ["M"], "dtg"), (["Black"], ["XXXL"], "dtg"), (["Black"], ["M"], "laser"),
                                     ([], ["M"], "dtg")):
        with pytest.raises(ShopError):
            await shop_products.set_offer(db, product["id"], technique=technique, colors=colors, sizes=sizes,
                                          provider=provider, **BY)


@pytest.mark.asyncio
async def test_a_printful_number_of_another_product_is_refused_as_mapping(db, provider):
    product = await configured(db, provider)
    medium = await variant_for(db, product["id"], BLACK_M)
    with pytest.raises(ShopError, match="gehört nicht"):
        await shop_catalog.set_printful_variant(db, medium["id"], printful_variant_id=9999,
                                                printful_product_id=PRINTFUL_PRODUCT, **BY)
    with pytest.raises(ShopError, match="gehört nicht"):
        await shop_catalog.set_printful_variant(db, medium["id"], printful_variant_id=WHITE_L,
                                                printful_product_id=72, **BY)


# ---------------------------------------------------------------- Druckflächen (#2069)

@pytest.mark.asyncio
async def test_the_print_areas_come_from_the_printful_template_with_exact_file_sizes(db, provider):
    product = await new_product(db)
    await shop_products.load_printful_product(db, product["id"], PRINTFUL_PRODUCT, provider=provider, **BY)
    view = await shop_products.admin_view(db, product["id"])
    areas = {row["key"]: row for row in view["available_placements"]}
    assert set(areas) == {"front", "back"}
    front = areas["front"]["file"]
    assert (front["width_px"], front["height_px"], front["dpi"], front["width_cm"]) == (1800, 2400, 150, 30.48)
    assert areas["front"]["label"] == "Vorderseite" and areas["front"]["preview"]["image_path"].endswith("/images/0")
    assert "chest_right" in areas["front"]["presets"]["motif"]
    assert "back_large" not in areas["front"]["presets"]["motif"]
    assert "text_opposite" in areas["front"]["presets"]["text"]
    assert view["print_template"]["loaded"] is True
    item = check_item(view, "template")
    assert item["ok"] is True and "2 Flächen" in item["detail"]


@pytest.mark.asyncio
async def test_the_layout_takes_a_motif_a_preset_and_a_size_in_cm(db, provider):
    product = await configured(db, provider, accept=False, generate=False)
    rows = {row["key"]: row for row in product["placements"]}
    assert rows["front"]["layers"][0] == {"kind": "motif", "preset": "chest_right", "offset_x_cm": 0.0,
                                          "offset_y_cm": 0.0, "width_cm": 8.9,
                                          "motif": {"key": "loewe-weiss", "by_color": {}}}
    assert rows["front"]["layers"][1]["kind"] == "gamertag" and rows["back"]["mode"] == "layout"
    view = await shop_products.admin_view(db, product["id"])
    front = next(row for row in view["placements"] if row["key"] == "front")
    assert front["included"] is True and {state["color"] for state in front["files"]} == {"Black", "White"}
    black = next(state for state in front["files"] if state["color"] == "Black")
    lion = black["plan"]["layers"][0]
    assert (lion["width_px"], lion["height_px"], lion["width_cm"]) == (526, 526, 8.91)
    assert black["state"] == "missing", "noch nicht erzeugt"
    # Die Fassung je Shirtfarbe kommt automatisch (Teil A): Schwarz die Hauptdatei, Weiß die Fassung für helle Shirts.
    assert lion["source"] == {"source": "motif", "design_key": "loewe-weiss", "variant": "dark", "version": 1,
                              "sha256": lion["source"]["sha256"]}
    white = next(state for state in front["files"] if state["color"] == "White")
    assert white["plan"]["layers"][0]["source"]["design_key"] == "loewe-weiss"
    assert (white["plan"]["layers"][0]["source"]["variant"], white["plan"]["layers"][0]["source"]["version"]) == (
        "light", 2)
    assert white["plan"]["layers"][0]["height_px"] == 526, "dieselbe Form, nur umgefärbt"


@pytest.mark.asyncio
async def test_layouts_outside_the_area_or_the_rules_are_refused(db, provider):
    product = await configured(db, provider, accept=False, generate=False)
    wrong = [
        [{"key": "sleeve_left", "layers": [LION]}],  # das Testshirt hat keine Ärmelfläche
        [{"key": "front", "layers": [{**LION, "offset_x_cm": -10}]}],  # ragt links hinaus
        [{"key": "front", "layers": [{**LION, "width_cm": 35}]}],  # breiter als die Fläche
        [{"key": "front", "layers": [LION]}, {"key": "front", "layers": [LION]}],
        [{"key": "front", "layers": [{**LION, "preset": "back_large"}]}],  # Rückenvorgabe vorne
        [{"key": "front", "layers": [{**LION, "preset": "text_opposite"}]}],  # Vorgabe für Namen
        [{"key": "front", "layers": [{**LION, "kind": "zauber"}]}],
        [{"key": "front", "layers": [LION, {"kind": "member_number", "preset": "text_below"}]}],  # nur Gamertag
        [{"key": "front", "layers": [{**LION, "motif": {"key": "gibt-es-nicht"}}]}],
        [{"key": "front", "layers": [{**LION, "motif": {"key": "loewe-weiss", "by_color": {"Pink": "loewe-schwarz"}}}]}],
        [{"key": "front", "layers": [{"kind": "gamertag", "preset": "text_opposite"}]}],  # gegenüber - kein Motiv
        [{"key": "front", "layers": []}],
    ]
    for placements in wrong:
        with pytest.raises(ShopError):
            await shop_products.set_layout(db, product["id"], placements, included_placement=None, **BY)
    with pytest.raises(ShopError):
        await shop_products.set_layout(db, product["id"], PLACEMENTS, included_placement="sleeve_left", **BY)
    with pytest.raises(ShopError) as outside:
        await shop_products.set_layout(db, product["id"], [{"key": "front", "layers": [{**LION, "offset_y_cm": 40}]}],
                                       included_placement=None, **BY)
    assert "ragt unten" in str(outside.value) and "px = " in str(outside.value) and "Zoll" in str(outside.value)
    assert (await shop_catalog.get_product(db, product["id"]))["placements"] == product["placements"]


@pytest.mark.asyncio
async def test_a_color_exception_replaces_the_motif_for_one_color(db, provider):
    product = await configured(db, provider, accept=False, generate=False)
    await design(db, "loewe-gold", "front_right", [])
    layout = [{"key": "front", "layers": [{**LION, "motif": {"key": "loewe-weiss", "by_color": {"white": "loewe-gold"}}},
                                          GAMERTAG]}, PLACEMENTS[1]]
    await shop_products.set_layout(db, product["id"], layout, included_placement="front", **BY)
    view = await shop_products.admin_view(db, product["id"])
    front = next(row for row in view["placements"] if row["key"] == "front")
    white = next(state for state in front["files"] if state["color"] == "White")
    assert white["plan"]["layers"][0]["source"]["design_key"] == "loewe-gold"
    stored = await shop_catalog.get_product(db, product["id"])
    assert stored["placements"][0]["layers"][0]["motif"]["by_color"] == {"White": "loewe-gold"}


@pytest.mark.asyncio
async def test_print_files_are_generated_per_color_in_the_exact_printful_size(db, provider, design_dir):
    from PIL import Image

    product = await configured(db, provider, accept=False)
    rows = await db.shop_print_files.find({"product_id": product["id"]}, {"_id": 0}).to_list(20)
    assert sorted((row["placement"], row["color"], row["version"]) for row in rows) == [
        ("back", "Black", 1), ("back", "White", 1), ("front", "Black", 1), ("front", "White", 1)]
    for row in rows:
        assert (row["width_px"], row["height_px"], row["dpi"]) == (1800, 2400, 150)
        path = shop_designs._path_of(row["file_ref"])
        with Image.open(path) as img:
            assert img.size == (1800, 2400) and img.mode == "RGBA" and tuple(map(round, img.info["dpi"])) == (150, 150)
            assert img.getpixel((0, 0))[3] == 0 and img.getpixel((1799, 2399))[3] == 0, "Rest transparent"
            assert set(img.info) <= {"dpi"}, "keine Metadaten außer der DPI"
    front = next(row for row in rows if row["placement"] == "front" and row["color"] == "Black")
    with Image.open(shop_designs._path_of(front["file_ref"])) as img:
        assert img.getpixel((223 + 263, 295 + 263))[3] == 255, "der Löwe sitzt an seinem Rahmen"
        assert img.getpixel((1800 - 223 - 263, 295 + 263))[3] == 0, "der Gamertag ist nur ein Platzhalter"
    view = await shop_products.admin_view(db, product["id"])
    assert check_item(view, "files")["ok"] is True
    # Noch einmal erzeugen ändert nichts: gleiche Eingaben, gleiche Dateien.
    again = await shop_products.generate_print_files(db, product["id"], **BY)
    assert again["created"] == [] and again["unchanged"] == 4
    assert await db.shop_print_files.count_documents({}) == 4
    entry = await db.audit_logs.find_one({"action": "shop.print_file.add"}, {"_id": 0})
    assert len(entry["data"]["created"]) == 4 and entry["actor_id"] == ACTOR


@pytest.mark.asyncio
async def test_a_changed_layout_or_template_makes_the_files_outdated_until_they_are_generated_again(db, provider,
                                                                                                    fake):
    product = await configured(db, provider)
    moved = [{"key": "front", "layers": [{**LION, "width_cm": 9.5}, GAMERTAG]}, PLACEMENTS[1]]
    await shop_products.set_layout(db, product["id"], moved, included_placement="front", **BY)
    view = await shop_products.admin_view(db, product["id"])
    files = check_item(view, "files")
    assert files["ok"] is False and "front / Black: veraltet" in files["detail"] and "back" not in files["detail"]
    result = await shop_products.generate_print_files(db, product["id"], **BY)
    assert sorted((item["placement"], item["color"], item["version"]) for item in result["created"]) == [
        ("front", "Black", 2), ("front", "White", 2)]
    assert check_item(await shop_products.admin_view(db, product["id"]), "files")["ok"] is True
    # Printful ändert die Rückseite: die Dateien dort gelten nicht mehr, die Prüfung sagt es.
    fake.set_print_area(PRINTFUL_PRODUCT, "back", 12, 18, display_name="Back print")
    sync = await shop_catalog_sync.sync_product(db, product["id"], provider=provider, **BY)
    assert sync["template"]["changed"] is True and "Rückseite" in sync["template"]["changes"][0]
    files = check_item(await shop_products.admin_view(db, product["id"]), "files")
    assert files["ok"] is False and "back / Black: veraltet" in files["detail"]
    await shop_products.generate_print_files(db, product["id"], **BY)
    newest = await shop_print_files.latest_base(db, product["id"], "back", "all", "Black")
    assert (newest["width_px"], newest["height_px"], newest["version"]) == (1800, 2700, 2)


@pytest.mark.asyncio
async def test_a_raster_motif_with_too_little_resolution_is_refused_with_numbers(db, provider):
    product = await configured(db, provider, accept=False, generate=False)
    await design(db, "klein", "back", [], width=300, height=300)
    small = [PLACEMENTS[0], {"key": "back", "layers": [{**BACK, "motif": {"key": "klein"}}]}]
    await shop_products.set_layout(db, product["id"], small, included_placement="front", **BY)
    result = await shop_products.generate_print_files(db, product["id"], **BY)
    assert {(item["placement"], item["color"]) for item in result["failed"]} == {("back", "Black"), ("back", "White")}
    text = result["failed"][0]["detail"]
    assert "Zu wenig Auflösung" in text and "300 px" in text and "28 cm (" in text and "DPI" in text
    # Kleiner gesetzt reicht es für eine Warnung (unter 150 DPI), nicht für eine Ablehnung.
    smaller = [PLACEMENTS[0], {"key": "back", "layers": [{**BACK, "width_cm": 6.0, "motif": {"key": "klein"}}]}]
    await shop_products.set_layout(db, product["id"], smaller, included_placement="front", **BY)
    result = await shop_products.generate_print_files(db, product["id"], **BY)
    assert not result["failed"] and any("Knapp" in warning for item in result["created"] for warning in item["warnings"])


# ---------------------------------------------------------------- Preise

@pytest.mark.asyncio
async def test_members_pay_the_cost_price_and_the_public_price_is_a_suggestion(db, provider):
    await db.settings.update_one({"id": "shop"}, {"$set": {"id": "shop", "public_markup_cents": 300}}, upsert=True)
    product = await configured(db, provider, accept=False)
    view = await shop_products.admin_view(db, product["id"])
    medium = next(row for row in view["variants"] if row["printful_variant_id"] == BLACK_M)
    # Einkauf 9,75 € plus Rückseite 5,25 € (vorne steckt im Grundpreis).
    assert medium["cost_cents"] == 1500 and medium["price_cents"] is None
    assert medium["suggested_public_cents"] == 1800
    await shop_products.accept_prices(db, product["id"], **BY)
    view = await shop_products.admin_view(db, product["id"])
    medium = next(row for row in view["variants"] if row["printful_variant_id"] == BLACK_M)
    assert medium["price_cents"] == 1500 and medium["public_price_cents"] == 1800
    # Ein eigener Aufschlag ersetzt den allgemeinen.
    await shop_catalog.update_product(db, product["id"], {"markup_cents": 200}, **BY)
    view = await shop_products.admin_view(db, product["id"])
    medium = next(row for row in view["variants"] if row["printful_variant_id"] == BLACK_M)
    assert medium["public_price_cents"] == 1700
    assert view["pricing"]["effective_markup_cents"] == 200 and view["pricing"]["source"] == "product"


# ---------------------------------------------------------------- Vorab-Prüfung und Stand

@pytest.mark.asyncio
async def test_a_complete_product_passes_the_review_but_the_open_mockup_check_blocks_publishing(db, provider):
    product = await configured(db, provider)
    view = await shop_products.admin_view(db, product["id"])
    assert all(item["ok"] for item in view["check"]["items"] if item["key"] != "mockup"), view["check"]
    assert check_item(view, "mockup")["state"] == "open"
    assert view["check"]["review_ready"] is True and view["check"]["publish_ready"] is False
    with pytest.raises(ShopConflict, match="Prüfung"):
        await shop_products.set_status(db, product["id"], "active", **BY)
    reviewed = await shop_products.set_status(db, product["id"], "reviewed", **BY)
    assert reviewed["status"] == "reviewed"
    with pytest.raises(ShopConflict, match="Mockup"):
        await shop_products.set_status(db, product["id"], "active", **BY)
    assert (await shop_catalog.get_product(db, product["id"]))["status"] == "reviewed"


@pytest.mark.asyncio
async def test_with_a_passed_mockup_check_the_product_can_be_published_and_archived(db, provider, monkeypatch):
    async def mockups_ok(_db, _product):
        return {"ok": True, "state": "passed", "detail": "Test: Mockups geprüft"}

    monkeypatch.setattr(shop_products, "mockup_check", mockups_ok)
    product = await configured(db, provider)
    await shop_products.set_status(db, product["id"], "reviewed", **BY)
    published = await shop_products.set_status(db, product["id"], "active", **BY)
    assert published["status"] == "active" and published["published_at"]
    # Veröffentlicht: Inhalt nur nach dem Zurückziehen ändern.
    with pytest.raises(ShopConflict, match="zurückziehen"):
        await shop_products.set_layout(db, product["id"], PLACEMENTS[:1], included_placement="front", **BY)
    archived = await shop_products.set_status(db, product["id"], "archived", **BY)
    assert archived["status"] == "archived"
    assert (await shop_catalog.get_product(db, product["id"]))["title"] == "Vereinsshirt Test"


@pytest.mark.asyncio
async def test_without_a_file_for_an_offered_color_the_product_cannot_be_reviewed(db, provider, design_dir):
    product = await configured(db, provider, white_back=False, generate=False)
    view = await shop_products.admin_view(db, product["id"])
    files = check_item(view, "files")
    assert files["ok"] is False and "back / White: fehlt" in files["detail"] and "erzeugen" in files["detail"]
    with pytest.raises(ShopConflict, match="Prüfung"):
        await shop_products.set_status(db, product["id"], "reviewed", **BY)
    # Erzeugt, aber eine Datei verschwindet von der Platte: wieder „fehlt“ bzw. „veraltet“ - nie still weiter.
    await shop_products.generate_print_files(db, product["id"], **BY)
    assert check_item(await shop_products.admin_view(db, product["id"]), "files")["ok"] is True
    gone = await shop_print_files.latest_base(db, product["id"], "back", "all", "White")
    shop_designs._path_of(gone["file_ref"]).unlink()
    files = check_item(await shop_products.admin_view(db, product["id"]), "files")
    assert files["ok"] is False and "back / White" in files["detail"]


@pytest.mark.asyncio
async def test_unaccepted_prices_or_a_variant_out_of_stock_fail_the_check(db, provider, fake):
    product = await configured(db, provider, accept=False)
    view = await shop_products.admin_view(db, product["id"])
    assert check_item(view, "prices")["ok"] is False
    await shop_products.accept_prices(db, product["id"], **BY)
    fake.stock[WHITE_L] = "out of stock"
    await shop_catalog_sync.sync_product(db, product["id"], provider=provider, **BY)
    view = await shop_products.admin_view(db, product["id"])
    stock = check_item(view, "stock")
    assert stock["ok"] is False and "White / L" in stock["detail"]


@pytest.mark.asyncio
async def test_a_change_to_a_reviewed_product_sends_it_back_to_draft(db, provider):
    product = await configured(db, provider)
    await shop_products.set_status(db, product["id"], "reviewed", **BY)
    await shop_products.set_layout(db, product["id"], PLACEMENTS, included_placement="back", **BY)
    assert (await shop_catalog.get_product(db, product["id"]))["status"] == "draft"


@pytest.mark.asyncio
async def test_every_step_is_logged_with_person_and_reason(db, provider):
    product = await configured(db, provider)
    await shop_products.set_status(db, product["id"], "reviewed", **BY)
    rows = await db.audit_logs.find({"target_id": product["id"]}, {"_id": 0}).sort("created_at", 1).to_list(50)
    actions = [row["action"] for row in rows]
    for action in ("shop.product.create", "shop.product.catalog", "shop.product.offer", "shop.product.layout",
                   "shop.print_file.add", "shop.product.price", "shop.product.status"):
        assert action in actions, action
    assert all(row["actor_id"] == ACTOR and row["data"]["reason"] == "Testdaten anlegen" for row in rows)
    status = next(row for row in rows if row["action"] == "shop.product.status")
    assert status["data"]["before"] == {"status": "draft"} and status["data"]["after"] == {"status": "reviewed"}


# ---------------------------------------------------------------- Abgleich (#1709)

@pytest.mark.asyncio
async def test_the_sync_blocks_unavailable_variants_and_frees_them_again(db, provider, fake):
    product = await configured(db, provider)
    fake.stock[BLACK_L] = "out of stock"
    result = await shop_catalog_sync.sync_product(db, product["id"], provider=provider, **BY)
    assert result["ok"] is True and result["blocked"] == ["Black / L"]
    large = await variant_for(db, product["id"], BLACK_L)
    assert large["blocked_reason"] and "nicht lieferbar" in large["blocked_reason"]
    fake.stock[BLACK_L] = "in stock"
    result = await shop_catalog_sync.sync_product(db, product["id"], provider=provider, **BY)
    assert result["unblocked"] == ["Black / L"]
    assert (await variant_for(db, product["id"], BLACK_L))["blocked_reason"] is None


@pytest.mark.asyncio
async def test_a_price_change_warns_but_changes_neither_the_price_nor_placed_orders(db, provider, fake):
    from decimal import Decimal

    product = await configured(db, provider)
    await publish_unchecked(db, product["id"])
    medium = await variant_for(db, product["id"], BLACK_M)
    order, _ = await shop_orders.place_order(
        db, user_id="konto-1", idempotency_key="bestellung-0001", buyer_kind="member",
        lines=[{"variant_id": medium["id"], "quantity": 1, "gamertag": "Testlöwe"}], shipping_estimate_cents=490,
        billing_address=dict(BILLING), shipping_address=dict(SHIPPING), actor_id="konto-1")
    fake.prices[BLACK_M] = Decimal("10.25")
    result = await shop_catalog_sync.sync_product(db, product["id"], provider=provider, **BY)
    assert result["price_changes"] == [{"label": "Black / M", "before_cents": 1500, "after_cents": 1550}]
    assert (await variant_for(db, product["id"], BLACK_M))["price_cents"] == 1500, "Preise nie ungeprüft übernehmen"
    view = await shop_products.admin_view(db, product["id"])
    shown = next(row for row in view["variants"] if row["printful_variant_id"] == BLACK_M)
    assert shown["price_warning"]["after_cents"] == 1550
    assert check_item(view, "prices")["ok"] is False
    stored = await shop_orders.items_for(db, order["id"])
    assert stored[0]["unit_price_cents"] == 1500
    # Übernehmen beendet die Warnung - mit Grund und Protokoll.
    await shop_products.accept_prices(db, product["id"], actor_id=ACTOR, reason="Printful teurer")
    view = await shop_products.admin_view(db, product["id"])
    shown = next(row for row in view["variants"] if row["printful_variant_id"] == BLACK_M)
    assert shown["price_cents"] == 1550 and shown["price_warning"] is None


@pytest.mark.asyncio
async def test_when_printful_fails_the_last_state_stays_with_its_date(db, provider, fake):
    product = await configured(db, provider)
    before = await shop_catalog.get_product(db, product["id"])
    first_ok = before["catalog_sync"]["last_ok_at"]
    fake.fail(500, times=50)
    result = await shop_catalog_sync.sync_product(db, product["id"], provider=provider, **BY)
    assert result["ok"] is False
    after = await shop_catalog.get_product(db, product["id"])
    assert after["catalog_sync"]["ok"] is False and after["catalog_sync"]["last_ok_at"] == first_ok
    assert after["catalog_sync"]["detail"]
    medium = await variant_for(db, product["id"], BLACK_M)
    assert (await shop_catalog.printful_variant_for(db, medium["id"]))["base_cost_cents"] == 975
    assert medium["blocked_reason"] is None


@pytest.mark.asyncio
async def test_the_daily_sync_runs_over_all_products_with_printful_except_archived(db, provider, fake):
    product = await configured(db, provider)
    other = await new_product(db, title="Ohne Printful")
    fake.calls.clear()
    summary = await shop_catalog_sync.sync_all(db, provider=provider)
    assert summary["products"] == 1 and summary["failed"] == 0
    assert len(fake.calls_to("getVariantPricesById")) == 4
    await db.shop_products.update_one({"id": product["id"]}, {"$set": {"status": "archived"}})
    assert (await shop_catalog_sync.sync_all(db, provider=provider))["products"] == 0
    assert (await shop_catalog.get_product(db, other["id"])).get("catalog_sync") is None


# ---------------------------------------------------------------- Bestellung friert alle Platzierungen ein

@pytest.mark.asyncio
async def test_an_order_freezes_one_print_file_per_area_and_its_own_file_with_the_gamertag(db, provider):
    from PIL import Image

    product = await configured(db, provider)
    await publish_unchecked(db, product["id"])
    white = await variant_for(db, product["id"], WHITE_M)
    common = {"user_id": "konto-1", "buyer_kind": "member", "shipping_estimate_cents": 490,
              "billing_address": dict(BILLING), "shipping_address": dict(SHIPPING), "actor_id": "konto-1"}
    order, _ = await shop_orders.place_order(
        db, idempotency_key="bestellung-0002", lines=[{"variant_id": white["id"], "quantity": 1, "gamertag": "Testlöwe"}],
        **common)
    (item,) = await shop_orders.items_for(db, order["id"])
    frozen = {row["placement"]: row for row in item["print_files"]}
    assert set(frozen) == {"front", "back"}
    base_back = await shop_print_files.latest_base(db, product["id"], "back", "all", "White")
    assert frozen["back"]["kind"] == "base" and frozen["back"]["file_id"] == base_back["id"]
    assert (frozen["back"]["version"], frozen["back"]["sha256"]) == (1, base_back["sha256"])
    assert frozen["front"]["kind"] == "personal" and frozen["front"]["technique"] == "dtg"
    assert (frozen["front"]["width_px"], frozen["front"]["height_px"], frozen["front"]["dpi"]) == (1800, 2400, 150)
    personal = await db.shop_print_files.find_one({"id": frozen["front"]["file_id"]}, {"_id": 0})
    assert personal["purpose"] == "order" and personal["user_id"] == "konto-1"
    assert (personal["order_id"], personal["order_item_id"]) == (order["id"], item["id"])
    assert "Testlöwe" not in str(personal), "nie der Name als Text"
    tag = await db.shop_gamertag_files.find_one({"id": frozen["front"]["gamertag_file_id"]}, {"_id": 0})
    assert tag["purpose"] == "order" and tag["order_id"] == order["id"]
    # Die eigene Datei = Grunddatei plus Gamertag am Anker: gegenüber dem Löwen, senkrecht auf dessen Mitte.
    base_front = await shop_print_files.latest_base(db, product["id"], "front", "all", "White")
    with Image.open(shop_designs._path_of(personal["file_ref"])) as mine, \
            Image.open(shop_designs._path_of(base_front["file_ref"])) as base:
        assert mine.size == (1800, 2400) and tuple(map(round, mine.info["dpi"])) == (150, 150)
        lion_center = (223 + 263, 295 + 263)  # Löwe für helle Shirts, 8,9 cm
        assert mine.getpixel(lion_center) == base.getpixel(lion_center)
        band = [mine.getpixel((x, lion_center[1]))[3] for x in range(1800 - 486 - 200, 1800 - 486 + 200)]
        assert max(band) == 255, "Gamertag auf der Höhe der Löwenmitte"
        assert max(base.getpixel((x, lion_center[1]))[3] for x in range(1800 - 486 - 200, 1800 - 486 + 200)) == 0
    # Die Motiv-Fassungen stehen an der Position (für die Aufbewahrung der Design-Adressen).
    sources = {(row["placement"], row["design_key"], row["variant"], row["version"]) for row in item["designs"]}
    assert sources == {("front", "loewe-weiss", "light", 2), ("back", "ruecken-weiss", "dark", 1)}
    assert item["design"]["design_key"] == "loewe-weiss", "das erste Design bleibt als Kurzform"
    assert item["printful"] == {"variant_id": WHITE_M, "product_id": PRINTFUL_PRODUCT}
    # Ein zweites Mitglied mit demselben Gamertag bekommt eine eigene Datei mit eigener Adresse.
    other, _ = await shop_orders.place_order(
        db, idempotency_key="bestellung-0012", lines=[{"variant_id": white["id"], "quantity": 1, "gamertag": "Testlöwe"}],
        **{**common, "user_id": "konto-2", "actor_id": "konto-2"})
    (second,) = await shop_orders.items_for(db, other["id"])
    mine_front = next(row for row in second["print_files"] if row["placement"] == "front")
    assert mine_front["file_id"] != frozen["front"]["file_id"]
    assert mine_front["sha256"] == frozen["front"]["sha256"], "gleiche Pixel - aber eigene Zeile und Adresse"
    rows = await db.shop_print_files.find({"purpose": "order"}, {"_id": 0}).to_list(10)
    assert len({row["public_id"] for row in rows}) == 2
    # Derselbe Aufruf noch einmal: dieselbe Bestellung, keine neue Datei.
    again, created = await shop_orders.place_order(
        db, idempotency_key="bestellung-0002", lines=[{"variant_id": white["id"], "quantity": 1, "gamertag": "Testlöwe"}],
        **common)
    assert created is False and again["id"] == order["id"]
    assert await db.shop_print_files.count_documents({"purpose": "order"}) == 2
    # Eine neue Design-Version danach ändert die Bestellung nicht; die Fassung bleibt öffentlich.
    await design(db, "ruecken-weiss", "back", ["Black"], width=3100, height=3100)
    (unchanged,) = await shop_orders.items_for(db, order["id"])
    assert next(row for row in unchanged["print_files"] if row["placement"] == "back")["version"] == 1
    later = await shop_designs.retention_plan(db, now=now_utc() + timedelta(days=365))
    assert ("ruecken-weiss", 1) not in {(row["design_key"], row["version"]) for row in later["public_off"]}


@pytest.mark.asyncio
async def test_an_order_without_current_print_files_is_refused_and_leaves_no_files(db, provider):
    product = await configured(db, provider)
    await publish_unchecked(db, product["id"])
    black = await variant_for(db, product["id"], BLACK_M)
    # Ein neuer Löwe nach dem Erzeugen: die Grunddatei vorne ist veraltet - bestellen geht erst nach „erzeugen“.
    await design(db, "loewe-weiss", "front_right", ["Black"], width=1250, height=1250)
    with pytest.raises(ShopError, match="veraltet"):
        await shop_orders.place_order(
            db, user_id="konto-1", idempotency_key="bestellung-0030", buyer_kind="member",
            lines=[{"variant_id": black["id"], "quantity": 1, "gamertag": "Testlöwe"}], shipping_estimate_cents=490,
            billing_address=dict(BILLING), shipping_address=dict(SHIPPING), actor_id="konto-1")
    assert await db.shop_print_files.count_documents({"purpose": "order"}) == 0
    assert await db.shop_gamertag_files.count_documents({"purpose": "order"}) == 0
    assert await db.shop_orders.count_documents({}) == 0


@pytest.mark.asyncio
async def test_files_of_an_order_that_loses_the_race_are_removed(db, provider, monkeypatch):
    product = await configured(db, provider)
    await publish_unchecked(db, product["id"])
    black = await variant_for(db, product["id"], BLACK_M)
    real = shop_orders._existing
    calls = {"n": 0}

    async def nobody_yet(db_, key):
        calls["n"] += 1
        return None if calls["n"] == 1 else await real(db_, key)

    common = {"user_id": "konto-1", "idempotency_key": "bestellung-0040", "buyer_kind": "member",
              "lines": [{"variant_id": black["id"], "quantity": 1, "gamertag": "Testlöwe"}],
              "shipping_estimate_cents": 490, "billing_address": dict(BILLING), "shipping_address": dict(SHIPPING),
              "actor_id": "konto-1"}
    winner, _ = await shop_orders.place_order(db, **common)
    monkeypatch.setattr(shop_orders, "_existing", nobody_yet)
    loser, created = await shop_orders.place_order(db, **common)
    assert created is False and loser["id"] == winner["id"]
    assert await db.shop_print_files.count_documents({"purpose": "order"}) == 1
    assert await db.shop_gamertag_files.count_documents({"purpose": "order"}) == 1


@pytest.mark.asyncio
async def test_erasing_an_account_takes_its_personal_print_files_off_line(db, provider):
    product = await configured(db, provider)
    await publish_unchecked(db, product["id"])
    black = await variant_for(db, product["id"], BLACK_M)
    order, _ = await shop_orders.place_order(
        db, user_id="konto-9", idempotency_key="bestellung-0050", buyer_kind="member",
        lines=[{"variant_id": black["id"], "quantity": 1, "gamertag": "Testlöwe"}], shipping_estimate_cents=490,
        billing_address=dict(BILLING), shipping_address=dict(SHIPPING), actor_id="konto-9")
    row = await db.shop_print_files.find_one({"purpose": "order"}, {"_id": 0})
    path = shop_designs._path_of(row["file_ref"])
    assert path.is_file()
    assert await shop_print_files.public_file(db, row["public_id"], shop_print_files.file_name(row)) == path
    assert await shop_print_files.public_file(db, row["public_id"], "falsch.png") is None
    # Ein offener Printful-Auftrag braucht die Datei noch: erst nach dem Abschluss weg.
    await db.shop_orders.update_one({"id": order["id"]}, {"$set": {"printful_order_id": 9100}})
    assert await shop_print_files.erase_for_user(db, "konto-9") == {"removed": 0, "pending": 1}
    assert path.is_file() and (await db.shop_print_files.find_one({"id": row["id"]}))["user_id"] is None
    await db.shop_orders.update_one({"id": order["id"]}, {"$set": {"status": "delivered"}})
    assert await shop_print_files.complete_pending_erasures(db) == 1
    gone = await db.shop_print_files.find_one({"id": row["id"]}, {"_id": 0})
    assert gone["public_disabled_at"] and gone["file_deleted_at"] and not path.exists()
    assert await shop_print_files.public_file(db, row["public_id"], shop_print_files.file_name(row)) is None
    # Grunddateien des Katalogs haben kein Konto und bleiben.
    assert await db.shop_print_files.count_documents({"purpose": "base", "public_disabled_at": None}) == 4


@pytest.mark.asyncio
async def test_a_product_with_a_gamertag_placement_needs_a_gamertag_and_blocked_variants_cannot_be_ordered(
        db, provider, fake):
    product = await configured(db, provider)
    await publish_unchecked(db, product["id"])
    medium = await variant_for(db, product["id"], BLACK_M)
    base = {"user_id": "konto-1", "buyer_kind": "member", "shipping_estimate_cents": 490,
            "billing_address": dict(BILLING), "shipping_address": dict(SHIPPING), "actor_id": "konto-1"}
    with pytest.raises(ShopError, match="Gamertag"):
        await shop_orders.place_order(db, idempotency_key="bestellung-0003",
                                      lines=[{"variant_id": medium["id"], "quantity": 1}], **base)
    fake.stock[BLACK_M] = "discontinued"
    await shop_catalog_sync.sync_product(db, product["id"], provider=provider, **BY)
    with pytest.raises(ShopError, match="nicht bestellbar"):
        await shop_orders.place_order(db, idempotency_key="bestellung-0004",
                                      lines=[{"variant_id": medium["id"], "quantity": 1, "gamertag": "Testlöwe"}],
                                      **base)
    assert await db.shop_orders.count_documents({}) == 0


# ---------------------------------------------------------------- Befunde aus der Prüfung (Codex)

@pytest.mark.asyncio
async def test_published_products_take_no_direct_price_offer_or_visibility_changes(db, provider):
    """Befund 1: die alten Wege (PATCH Produkt/Variante) umgehen den Aufbau nicht."""
    product = await configured(db, provider)
    await publish_unchecked(db, product["id"])
    medium = await variant_for(db, product["id"], BLACK_M)
    for fields in ({"price_cents": 0}, {"price_cents": 990}, {"active": False}):
        with pytest.raises(ShopConflict, match="zurückziehen"):
            await shop_catalog.update_variant(db, medium["id"], fields, **BY)
    for fields in ({"visibility": "hidden"}, {"markup_cents": 0}, {"base_price_cents": 100}, {"tax_profile": None,
                                                                                            "design_key": "x"}):
        with pytest.raises(ShopConflict, match="zurückziehen"):
            await shop_catalog.update_product(db, product["id"], fields, **BY)
    with pytest.raises(ShopConflict, match="zurückziehen"):
        await shop_catalog.create_variant(db, product["id"], {"sku": "NEU-1", "label": "Neu"}, **BY)
    # Titel und Beschreibung gehen auch veröffentlicht.
    changed, _ = await shop_catalog.update_product(db, product["id"], {"title": "Vereinsshirt 2026"}, **BY)
    assert changed["title"] == "Vereinsshirt 2026" and changed["status"] == "active"
    assert (await variant_for(db, product["id"], BLACK_M))["price_cents"] == 1500


@pytest.mark.asyncio
async def test_printful_variants_get_prices_and_offer_only_through_the_guided_steps(db, provider):
    product = await configured(db, provider)
    medium = await variant_for(db, product["id"], BLACK_M)
    for fields in ({"price_cents": 1200}, {"active": False}, {"sku": "ANDERS-1"}):
        with pytest.raises(ShopError, match="Preise übernehmen|Farben und Größen"):
            await shop_catalog.update_variant(db, medium["id"], fields, **BY)
    with pytest.raises(ShopError, match="Farben und Größen"):
        await shop_catalog.create_variant(db, product["id"], {"sku": "NEU-2", "label": "Neu"}, **BY)


@pytest.mark.asyncio
async def test_a_change_through_the_old_ways_sends_a_reviewed_product_back_to_draft(db, provider):
    product = await configured(db, provider)
    await shop_products.set_status(db, product["id"], "reviewed", **BY)
    await shop_catalog.update_product(db, product["id"], {"markup_cents": 250}, **BY)
    assert (await shop_catalog.get_product(db, product["id"]))["status"] == "draft"
    await shop_products.set_status(db, product["id"], "reviewed", **BY)
    medium = await variant_for(db, product["id"], BLACK_M)
    await shop_catalog.update_variant(db, medium["id"], {"label": "Schwarz / M"}, **BY)
    assert (await shop_catalog.get_product(db, product["id"]))["status"] == "draft"
    await shop_products.set_status(db, product["id"], "reviewed", **BY)
    await shop_catalog.update_product(db, product["id"], {"title": "Nur der Titel"}, **BY)
    assert (await shop_catalog.get_product(db, product["id"]))["status"] == "reviewed"


@pytest.mark.asyncio
async def test_an_unknown_stock_blocks_the_variant_and_the_order_needs_in_stock(db, provider, fake):
    """Befund 2: „Lager unbekannt“ ist nicht lieferbar - fail-closed, auch in der Bestellung."""
    product = await configured(db, provider)
    await publish_unchecked(db, product["id"])
    medium = await variant_for(db, product["id"], BLACK_M)
    fake.stock[BLACK_M] = "out of stock"
    await shop_catalog_sync.sync_product(db, product["id"], provider=provider, **BY)
    del fake.stock[BLACK_M]  # Printful meldet für diese Variante nichts mehr
    real = fake._op_getProductStockAvailabilityById

    def without_black_m(args, params, body):
        status, payload = real(args, params, body)
        payload["data"] = [row for row in payload["data"] if row["catalog_variant_id"] != BLACK_M]
        return status, payload

    fake.stock[BLACK_M] = "in stock"
    fake._op_getProductStockAvailabilityById = without_black_m
    result = await shop_catalog_sync.sync_product(db, product["id"], provider=provider, **BY)
    assert result["unblocked"] == [], "unbekannt entsperrt nicht"
    medium = await variant_for(db, product["id"], BLACK_M)
    assert medium["blocked_reason"]
    # Eine Variante ohne Sperre, deren Lager aber nicht „lieferbar“ ist, nimmt die Bestellung trotzdem nicht.
    white = await variant_for(db, product["id"], WHITE_M)
    await shop_catalog.set_catalog_mapping(db, white["id"], {"in_stock": None}, actor_id=ACTOR)
    with pytest.raises(ShopError, match="nicht bestellbar"):
        await shop_orders.place_order(
            db, user_id="konto-1", idempotency_key="bestellung-0010", buyer_kind="member",
            lines=[{"variant_id": white["id"], "quantity": 1, "gamertag": "Testlöwe"}], shipping_estimate_cents=490,
            billing_address=dict(BILLING), shipping_address=dict(SHIPPING), actor_id="konto-1")


@pytest.mark.asyncio
async def test_a_new_variant_with_unknown_stock_is_blocked_with_its_own_reason(db, provider, fake):
    real = fake._op_getProductStockAvailabilityById

    def without_white_l(args, params, body):
        status, payload = real(args, params, body)
        payload["data"] = [row for row in payload["data"] if row["catalog_variant_id"] != WHITE_L]
        return status, payload

    fake._op_getProductStockAvailabilityById = without_white_l
    product = await configured(db, provider)
    large = await variant_for(db, product["id"], WHITE_L)
    assert large["blocked_reason"] == "Lager bei Printful unbekannt."


@pytest.mark.asyncio
async def test_the_sync_discards_its_result_when_the_product_changed_meanwhile(db, provider, fake):
    """Befund 3: der Abgleich schreibt nur auf den Stand, den er gelesen hat."""
    from decimal import Decimal

    product = await configured(db, provider)
    fake.prices[BLACK_M] = Decimal("11.00")
    real = provider.catalog_variants

    async def changed_meanwhile(*args, **kwargs):
        rows = await real(*args, **kwargs)
        await shop_products.set_layout(db, product["id"], PLACEMENTS[:1], included_placement="front",
                                           actor_id=ACTOR, reason="Rückseite weg")
        return rows

    provider.catalog_variants = changed_meanwhile
    result = await shop_catalog_sync.sync_product(db, product["id"], provider=provider, **BY)
    assert result["ok"] is False and result["skipped"] is True
    assert "übersprungen" in result["detail"]
    medium = await variant_for(db, product["id"], BLACK_M)
    assert (await shop_catalog.printful_variant_for(db, medium["id"]))["base_cost_cents"] == 975
    stored = await shop_catalog.get_product(db, product["id"])
    assert "übersprungen" in stored["catalog_sync"]["detail"]


@pytest.mark.asyncio
async def test_only_one_sync_runs_at_a_time(db, provider):
    """Befund 4: eine Sperre mit Ablauf - ein zweiter Abgleich bekommt „läuft gerade“."""
    from services.mutation_lock import mutation_lock

    product = await configured(db, provider)
    async with mutation_lock(db, shop_catalog_sync.SYNC_RESOURCE, wait_seconds=0, lease_seconds=30):
        with pytest.raises(ShopConflict, match="läuft gerade"):
            await shop_catalog_sync.sync_product(db, product["id"], provider=provider, **BY)
        summary = await shop_catalog_sync.sync_all(db, provider=provider)
        assert summary["skipped"] == "Abgleich läuft gerade"
    assert (await shop_catalog_sync.sync_product(db, product["id"], provider=provider, **BY))["ok"] is True


@pytest.mark.asyncio
async def test_the_daily_sync_pages_through_all_products(db, provider, monkeypatch):
    """Befund 5: keine stille Grenze bei 500 - seitenweise alle."""
    seen = []

    async def record(_db, product_id, **_kwargs):
        seen.append(product_id)
        return {"ok": True}

    for index in range(7):
        product = await new_product(db, title=f"Seitentest {index}")
        await db.shop_products.update_one({"id": product["id"]}, {"$set": {"printful": {"product_id": 71}}})
    monkeypatch.setattr(shop_catalog_sync, "PAGE_SIZE", 3)
    monkeypatch.setattr(shop_catalog_sync, "_sync_product_unlocked", record)
    summary = await shop_catalog_sync.sync_all(db, provider=provider)
    assert summary["products"] == 7 and len(set(seen)) == 7


@pytest.mark.asyncio
async def test_a_purchase_price_of_zero_blocks_the_variant(db, provider, fake):
    """Befund 6: Einkauf 0,00 € oder fehlend ist kein Preis - die Variante wird gesperrt („Preis fehlt“)."""
    from decimal import Decimal

    fake.prices[WHITE_M] = Decimal("0.00")
    product = await configured(db, provider, accept=False)
    white = await variant_for(db, product["id"], WHITE_M)
    assert white["blocked_reason"] == "Preis fehlt bei Printful."
    view = await shop_products.admin_view(db, product["id"])
    assert next(row for row in view["variants"] if row["label"] == "White / M")["cost_cents"] is None
    with pytest.raises(ShopError, match="Einkaufspreis"):
        await shop_products.accept_prices(db, product["id"], **BY)
    fake.prices[WHITE_M] = Decimal("9.75")
    result = await shop_catalog_sync.sync_product(db, product["id"], provider=provider, **BY)
    assert result["unblocked"] == ["White / M"]


@pytest.mark.asyncio
async def test_a_sales_price_needs_the_minimum_price(db, provider):
    """Befund 6: Verkaufspreis mindestens der Mindestpreis (einstellbar, Vorgabe 1 €)."""
    plain = await new_product(db, title="Kappe Test", personalization="none")
    with pytest.raises(ShopError, match="Mindestpreis"):
        await shop_catalog.update_product(db, plain["id"], {"base_price_cents": 0}, **BY)
    with pytest.raises(ShopError, match="Mindestpreis"):
        await shop_catalog.create_variant(db, plain["id"], {"sku": "K-1", "label": "Eine", "price_cents": 99}, **BY)
    variant = await shop_catalog.create_variant(db, plain["id"], {"sku": "K-2", "label": "Eine", "price_cents": 100},
                                                **BY)
    with pytest.raises(ShopError, match="Mindestpreis"):
        await shop_catalog.update_variant(db, variant["id"], {"price_cents": 0}, **BY)
    product = await configured(db, provider)
    await db.settings.update_one({"id": "shop"}, {"$set": {"id": "shop", "min_price_cents": 2000}}, upsert=True)
    view = await shop_products.admin_view(db, product["id"])
    prices = check_item(view, "prices")
    assert prices["ok"] is False and "Mindestpreis" in prices["detail"]


# ---------------------------------------------------------------- Grund optional (Entscheidung Obmann 27.10.2026)

@pytest.mark.asyncio
async def test_without_a_reason_everything_works_except_publishing(db, provider, monkeypatch):
    async def mockups_ok(_db, _product):
        return {"ok": True, "state": "passed", "detail": "Test: Mockups geprüft"}

    monkeypatch.setattr(shop_products, "mockup_check", mockups_ok)
    product = await configured(db, provider)
    nothing = {"actor_id": ACTOR, "reason": None}
    await shop_products.set_layout(db, product["id"], PLACEMENTS, included_placement="front", **nothing)
    await shop_products.set_status(db, product["id"], "reviewed", **nothing)
    await shop_catalog_sync.sync_product(db, product["id"], provider=provider, **nothing)
    for blank in (None, "", "  ", "ok"):
        with pytest.raises(ShopError, match="Grund"):
            await shop_products.set_status(db, product["id"], "active", actor_id=ACTOR, reason=blank)
    published = await shop_products.set_status(db, product["id"], "active", actor_id=ACTOR, reason="Geht live")
    assert published["status"] == "active"
    await shop_products.set_status(db, product["id"], "draft", **nothing)
    rows = await db.audit_logs.find({"action": "shop.product.status"}, {"_id": 0}).to_list(10)
    assert [row["data"]["reason"] for row in rows] == ["", "Geht live", ""]


# ---------------------------------------------------------------- Nachprüfung (Codex, zweite Runde)

@pytest.mark.asyncio
async def test_creating_a_product_respects_the_minimum_price(db):
    with pytest.raises(ShopError, match="Mindestpreis"):
        await new_product(db, title="Gratis-Kappe", base_price_cents=0)
    with pytest.raises(ShopError, match="Mindestpreis"):
        await new_product(db, title="Billig-Kappe", base_price_cents=99)
    assert (await new_product(db, title="Kappe Test", base_price_cents=100))["base_price_cents"] == 100


@pytest.mark.asyncio
async def test_prices_below_the_minimum_are_not_accepted(db, provider):
    await db.settings.update_one({"id": "shop"}, {"$set": {"id": "shop", "min_price_cents": 2000}}, upsert=True)
    product = await configured(db, provider, accept=False)
    with pytest.raises(ShopError) as refused:
        await shop_products.accept_prices(db, product["id"], **BY)
    assert "Selbstkosten 15,00 €" in str(refused.value) and "Mindestpreis 20,00 €" in str(refused.value)
    assert (await variant_for(db, product["id"], BLACK_M))["price_cents"] is None


@pytest.mark.asyncio
async def test_a_sync_blocks_variants_that_fall_below_the_minimum(db, provider):
    """Ein veröffentlichtes Produkt verkauft nicht still unter dem Mindestpreis weiter."""
    product = await configured(db, provider)
    await publish_unchecked(db, product["id"])
    await db.settings.update_one({"id": "shop"}, {"$set": {"id": "shop", "min_price_cents": 2000}}, upsert=True)
    result = await shop_catalog_sync.sync_product(db, product["id"], provider=provider, **BY)
    assert sorted(result["blocked"]) == ["Black / L", "Black / M", "White / L", "White / M"]
    medium = await variant_for(db, product["id"], BLACK_M)
    assert "Mindestpreis" in medium["blocked_reason"]
    with pytest.raises(ShopError, match="nicht bestellbar"):
        await shop_orders.place_order(
            db, user_id="konto-1", idempotency_key="bestellung-0020", buyer_kind="member",
            lines=[{"variant_id": medium["id"], "quantity": 1, "gamertag": "Testlöwe"}], shipping_estimate_cents=490,
            billing_address=dict(BILLING), shipping_address=dict(SHIPPING), actor_id="konto-1")
    await db.settings.update_one({"id": "shop"}, {"$set": {"min_price_cents": 100}})
    result = await shop_catalog_sync.sync_product(db, product["id"], provider=provider, **BY)
    assert len(result["unblocked"]) == 4
