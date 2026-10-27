"""Produktverwaltung (#1707) und Katalogabgleich (#1709) ohne Routen: Printful-Produkt laden, Farben und Größen
anbieten, Platzierungen mit Positionen, Designs je Platzierung und Farbe, Preise, Vorab-Prüfung und Stand, Abgleich
und das Einfrieren mehrerer Platzierungen in der Bestellung.

Printful ist der Vertrags-Fake (``tests/printful_fake.py``) über den echten Adapter - kein echter Aufruf. Die Datenbank
ist mongomock mit den echten Indizes. Erfundene Testdaten: Produkt- und Variantennummern, Designs und Personen gibt es
so nicht."""
import hashlib
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio
from mongomock_motor import AsyncMongoMockClient

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from printful_fake import API_KEY, FakePrintful  # noqa: E402
from services import (  # noqa: E402
    printful_client, shop_catalog, shop_catalog_sync, shop_designs, shop_orders, shop_products, shop_schema)
from models import now_utc  # noqa: E402
from services.printful_client import PrintfulClient  # noqa: E402
from services.shop_common import ShopConflict, ShopError  # noqa: E402
from shop_testdata import publish_unchecked  # noqa: E402

ACTOR = "finanzen-test"
BY = {"actor_id": ACTOR, "reason": "Testdaten anlegen"}
PRINTFUL_PRODUCT = 71
BLACK_M, BLACK_L, WHITE_M, WHITE_L = 4012, 4013, 4014, 4015
PLACEMENTS = [{"key": "front_right", "kind": "design"}, {"key": "front_left", "kind": "gamertag"},
              {"key": "back", "kind": "design"}]
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
    await shop_designs.create_profile(db, key, title=key, placement=placement, garment_colors=colors, **BY)
    digest = hashlib.sha256(key.encode()).hexdigest()
    await shop_catalog.add_design_version(
        db, key, file_ref=f"shop-designs/{digest[:32]}.png", sha256=digest, placement=placement,
        details={"public_id": (digest + digest)[:43], "width_px": width, "height_px": height}, **BY)


async def club_designs(db, *, white_back: bool = True):
    await design(db, "loewe-weiss", "front_right", ["Black"])
    await design(db, "loewe-schwarz", "front_right", ["White"])
    await design(db, "ruecken-weiss", "back", ["Black"], width=3000, height=3000)
    if white_back:
        await design(db, "ruecken-schwarz", "back", ["White"], width=3000, height=3000)


async def configured(db, provider, *, white_back: bool = True, accept: bool = True, **fields) -> dict:
    """Ein Testshirt wie in #2062: schwarz und weiß, M und L, Löwe vorne rechts, Gamertag vorne links, Rückenlogo."""
    product = await new_product(db, **fields)
    await shop_products.load_printful_product(db, product["id"], PRINTFUL_PRODUCT, provider=provider, **BY)
    await shop_products.set_offer(db, product["id"], technique="dtg", colors=["Black", "White"], sizes=["M", "L"],
                                  provider=provider, **BY)
    await shop_products.set_placements(db, product["id"], PLACEMENTS, included_placement="front", **BY)
    await club_designs(db, white_back=white_back)
    view = await shop_products.admin_view(db, product["id"])
    await shop_products.set_designs(db, product["id"], view["design_suggestions"], **BY)
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


# ---------------------------------------------------------------- Platzierungen

@pytest.mark.asyncio
async def test_placements_come_from_the_printful_print_areas_with_positions_in_inches_and_cm(db, provider):
    product = await new_product(db)
    await shop_products.load_printful_product(db, product["id"], PRINTFUL_PRODUCT, provider=provider, **BY)
    saved = await shop_products.set_placements(db, product["id"], PLACEMENTS, included_placement="front", **BY)
    by_key = {row["key"]: row for row in saved["placements"]}
    assert {key: row["printful_placement"] for key, row in by_key.items()} == {
        "front_right": "front", "front_left": "front", "back": "back"}
    # Vorlage aus den Druckbereichen (#1708): Löwe 3,5 Zoll breit, vom Träger aus rechts = von vorne gesehen links.
    lion = by_key["front_right"]["position"]
    assert lion["width_in"] == 3.5 and lion["left_in"] < by_key["front_left"]["position"]["left_in"]
    view = await shop_products.admin_view(db, product["id"])
    shown = next(row for row in view["placements"] if row["key"] == "front_right")
    assert shown["position_text"]["width"] == "3,5 Zoll (8,9 cm)"
    # Die Rückseite ist eine eigene Fläche mit eigenem Aufpreis; vorne steckt im Grundpreis.
    assert {row["key"]: row["included"] for row in view["placements"]} == {
        "front_right": True, "front_left": True, "back": False}


@pytest.mark.asyncio
async def test_placements_outside_the_product_or_the_print_area_are_refused(db, provider):
    product = await new_product(db)
    await shop_products.load_printful_product(db, product["id"], PRINTFUL_PRODUCT, provider=provider, **BY)
    wrong = [
        [{"key": "sleeve_left", "kind": "design"}],  # das Testshirt hat keine Ärmelfläche
        [{"key": "front_right", "kind": "design", "position": {"left_in": 10, "top_in": 1, "width_in": 3.5,
                                                               "height_in": 3.5}}],  # ragt aus 12 Zoll heraus
        [{"key": "back", "kind": "design"}, {"key": "back", "kind": "design"}],
        [{"key": "front_left", "kind": "zauber"}],
        [{"key": "front_left", "kind": "member_number"}],  # Personalisierung ist nur Gamertag
    ]
    for placements in wrong:
        with pytest.raises(ShopError):
            await shop_products.set_placements(db, product["id"], placements, included_placement=None, **BY)
    with pytest.raises(ShopError):
        await shop_products.set_placements(db, product["id"], PLACEMENTS, included_placement="sleeve_left", **BY)


# ---------------------------------------------------------------- Designs je Platzierung und Farbe

@pytest.mark.asyncio
async def test_designs_are_suggested_per_placement_and_color_through_design_for_color(db, provider):
    product = await configured(db, provider, accept=False)
    view = await shop_products.admin_view(db, product["id"])
    lion = next(row for row in view["placements"] if row["key"] == "front_right")
    assert {color: cell["design_key"] for color, cell in lion["designs"].items()} == {
        "Black": "loewe-weiss", "White": "loewe-schwarz"}
    gamertag = next(row for row in view["placements"] if row["key"] == "front_left")
    assert gamertag["kind"] == "gamertag" and gamertag["designs"] == {}, "die Datei erzeugt später #1711"
    # Ein Design einer anderen Platzierung passt nicht.
    with pytest.raises(ShopError, match="Platzierung"):
        await shop_products.set_designs(db, product["id"], [{"placement": "front_right", "color": "Black",
                                                             "design_key": "ruecken-weiss"}], **BY)
    with pytest.raises(ShopError):
        await shop_products.set_designs(db, product["id"], [{"placement": "front_right", "color": "Pink",
                                                             "design_key": "loewe-weiss"}], **BY)


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
        await shop_products.set_placements(db, product["id"], PLACEMENTS[:1], included_placement="front", **BY)
    archived = await shop_products.set_status(db, product["id"], "archived", **BY)
    assert archived["status"] == "archived"
    assert (await shop_catalog.get_product(db, product["id"]))["title"] == "Vereinsshirt Test"


@pytest.mark.asyncio
async def test_without_a_file_for_an_offered_color_the_product_cannot_be_reviewed(db, provider):
    product = await configured(db, provider, white_back=False)
    view = await shop_products.admin_view(db, product["id"])
    files = check_item(view, "files")
    assert files["ok"] is False and "White" in files["detail"] and "Rücken" in files["detail"]
    with pytest.raises(ShopConflict, match="Prüfung"):
        await shop_products.set_status(db, product["id"], "reviewed", **BY)


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
    await shop_products.set_placements(db, product["id"], PLACEMENTS, included_placement="back", **BY)
    assert (await shop_catalog.get_product(db, product["id"]))["status"] == "draft"


@pytest.mark.asyncio
async def test_every_step_is_logged_with_person_and_reason(db, provider):
    product = await configured(db, provider)
    await shop_products.set_status(db, product["id"], "reviewed", **BY)
    rows = await db.audit_logs.find({"target_id": product["id"]}, {"_id": 0}).sort("created_at", 1).to_list(50)
    actions = [row["action"] for row in rows]
    for action in ("shop.product.create", "shop.product.catalog", "shop.product.offer", "shop.product.placements",
                   "shop.product.designs", "shop.product.price", "shop.product.status"):
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
async def test_an_order_freezes_every_placement_with_its_design_version(db, provider):
    product = await configured(db, provider)
    await publish_unchecked(db, product["id"])
    white = await variant_for(db, product["id"], WHITE_M)
    order, _ = await shop_orders.place_order(
        db, user_id="konto-1", idempotency_key="bestellung-0002", buyer_kind="member",
        lines=[{"variant_id": white["id"], "quantity": 1, "gamertag": "Testlöwe"}], shipping_estimate_cents=490,
        billing_address=dict(BILLING), shipping_address=dict(SHIPPING), actor_id="konto-1")
    (item,) = await shop_orders.items_for(db, order["id"])
    frozen = {row["placement"]: row for row in item["designs"]}
    assert set(frozen) == {"front_right", "front_left", "back"}
    assert (frozen["front_right"]["design_key"], frozen["front_right"]["version"]) == ("loewe-schwarz", 1)
    assert frozen["back"]["design_key"] == "ruecken-schwarz" and len(frozen["back"]["sha256"]) == 64
    assert frozen["front_left"]["kind"] == "gamertag" and frozen["front_left"]["design_key"] is None
    assert frozen["front_right"]["printful_placement"] == "front" and frozen["front_right"]["technique"] == "dtg"
    assert frozen["front_right"]["position"]["width_in"] == 3.5
    assert item["design"]["design_key"] == "loewe-schwarz", "das erste Design bleibt als Kurzform"
    assert item["printful"] == {"variant_id": WHITE_M, "product_id": PRINTFUL_PRODUCT}
    # Eine neue Version danach ändert die Bestellung nicht.
    digest = hashlib.sha256(b"neu").hexdigest()
    await shop_catalog.add_design_version(db, "ruecken-schwarz", file_ref=f"shop-designs/{digest[:32]}.png",
                                          sha256=digest, placement="back", **BY)
    (again,) = await shop_orders.items_for(db, order["id"])
    assert {row["placement"]: row["version"] for row in again["designs"]}["back"] == 1
    # Auch die Rückseite (nicht nur das erste Design) bleibt für die Bestellung öffentlich.
    later = await shop_designs.retention_plan(db, now=now_utc() + timedelta(days=365))
    assert ("ruecken-schwarz", 1) not in {(row["design_key"], row["version"]) for row in later["public_off"]}


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
        await shop_products.set_placements(db, product["id"], PLACEMENTS[:2], included_placement="front",
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
    await shop_products.set_placements(db, product["id"], PLACEMENTS, included_placement="front", **nothing)
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
