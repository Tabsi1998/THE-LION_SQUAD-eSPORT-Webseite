"""Produktoptionen von Printful (#2158), etwa die Nahtfarbe bei Zuschnitt und Naht: Katalog lesen, Wahl in Schritt 2,
Prüfpunkt, ``product_options`` in Schätzung, Testentwurf und Auftrag, eingefroren in der Bestellung.

Printful ist der Vertrags-Fake (``tests/printful_fake.py``) über den echten Adapter - wie Printful lehnt er Schätzung
und Auftrag ohne Pflichtoption mit 400 ab. Kein echter Aufruf, nie Produktion. Erfundene Testdaten."""
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from printful_fake import API_KEY  # noqa: E402
from services import printful_client, shop_catalog, shop_orders, shop_products, shop_test_drafts  # noqa: E402
from services.shop_common import ShopError  # noqa: E402
from services.shop_fulfillment import (  # noqa: E402
    CatalogProductId, CatalogVariantId, DraftLine, FulfillmentInvalid, Placement)
from shop_testdata import publish_unchecked  # noqa: E402
from test_shop_products_unit import (  # noqa: E402,F401 - Fixtures und Helfer der Produktverwaltung
    BILLING, BY, PRINTFUL_PRODUCT, SHIPPING, WHITE_M, configured, db, design_dir, fake, provider, variant_for)

STITCH = {"name": "stitch_color", "techniques": ["cut-sew"], "type": "string", "values": ["White", "Black"]}
POCKET = {"name": "inside_pocket", "techniques": ["cut-sew"], "type": "boolean", "values": [True, False]}
ADDRESS = {"name": "Testverein Löwen", "street": "Vereinsgasse 1", "street2": "", "zip": "6020", "city": "Innsbruck",
           "country": "AT"}
URL = "https://lsw.example.test/api/shop/print-files/x/druck.png"


@pytest.fixture(autouse=True)
def public_base(monkeypatch):
    monkeypatch.setenv("PUBLIC_BACKEND_URL", "https://lsw.example.test")
    for name in ("PUBLIC_BASE_URL", "FRONTEND_URL", "SHOP_PRINTFUL_DASHBOARD_ORDER_URL"):
        monkeypatch.delenv(name, raising=False)


def with_stitch(fake):
    fake.set_product_options(PRINTFUL_PRODUCT, [STITCH, POCKET], required=("stitch_color",))


async def shop_ready(db):
    from services.secret_store import encrypt_secret

    await db.settings.update_one({"id": "shop"}, {"$set": {"id": "shop", "stage": "admins",
                                                           "printful_api_key": encrypt_secret(API_KEY)}}, upsert=True)


def line(*options) -> DraftLine:
    return DraftLine(variant=CatalogVariantId(WHITE_M), quantity=1,
                     placements=(Placement(placement="front", technique="dtg", file_url=URL),), options=tuple(options))


# ---------------------------------------------------------------- Adapter und Vertrag

@pytest.mark.asyncio
async def test_the_catalog_reads_options_row_by_row_and_skips_unreadable_ones(provider, fake):
    with_stitch(fake)
    product = await provider.catalog_product(CatalogProductId(PRINTFUL_PRODUCT))
    assert [(row.name, row.type, row.values, row.techniques) for row in product.options] == [
        ("stitch_color", "string", ("White", "Black"), ("cut-sew",)),
        ("inside_pocket", "boolean", (True, False), ("cut-sew",))]
    assert product.options_skipped == ()
    # Eine Zeile, die nicht passt, kostet nur sich selbst - mit Grund, ohne Werte.
    fake.off_contract.add("getProductById")
    fake.products[PRINTFUL_PRODUCT]["product_options"] = [STITCH, {"name": "kaputt", "values": "geheim"}, "x"]
    product = await provider.catalog_product(CatalogProductId(PRINTFUL_PRODUCT))
    assert [row.name for row in product.options] == ["stitch_color"]
    assert len(product.options_skipped) == 2 and "geheim" not in str(product.options_skipped)


def test_the_payload_sends_options_only_when_there_are_some():
    assert "product_options" not in printful_client._line_payload(line()), "andere Produkte bleiben unverändert"
    assert printful_client._line_payload(line(("stitch_color", "White")))["product_options"] == [
        {"name": "stitch_color", "value": "White"}]
    with pytest.raises(ValueError):
        line(("Stitch Color", "White"))
    with pytest.raises(ValueError):
        line(("stitch_color", "White"), ("stitch_color", "Black"))


@pytest.mark.asyncio
async def test_without_the_required_option_printful_answers_400_with_it_the_estimate_works(provider, fake):
    with_stitch(fake)
    with pytest.raises(FulfillmentInvalid) as refused:
        await provider.estimate_costs((line(),), country_code="AT", zip_code="6020")
    assert refused.value.status == 400 and "stitch_color" in refused.value.provider_detail
    with pytest.raises(FulfillmentInvalid):
        await provider.estimate_costs((line(("stitch_color", "Rosa")),), country_code="AT", zip_code="6020")
    costs = await provider.estimate_costs((line(("stitch_color", "White")),), country_code="AT", zip_code="6020")
    assert costs.total_cents and costs.total_cents > 0


# ---------------------------------------------------------------- Schritt 2 und Prüfung

@pytest.mark.asyncio
async def test_step_2_stores_the_first_allowed_value_and_takes_only_catalog_values(db, provider, fake):
    with_stitch(fake)
    product = await configured(db, provider)
    assert product["printful"]["options"][0]["name"] == "stitch_color"
    assert product["offer"]["options"] == {"stitch_color": "White"}, "Vorgabe: der erste erlaubte Wert"
    view = await shop_products.admin_view(db, product["id"])
    options = view["product_options"]
    assert options["loaded"] is True and options["missing"] == []
    stitch = next(row for row in options["options"] if row["name"] == "stitch_color")
    assert stitch["label"] == "Nahtfarbe" and stitch["required"] is True and stitch["selected"] == "White"
    assert [row["label"] for row in stitch["values"]] == ["Weiß", "Schwarz"]
    assert next(row for row in options["options"] if row["name"] == "inside_pocket")["required"] is False
    check = next(item for item in view["check"]["items"] if item["key"] == "options")
    assert check["ok"] is True and "Nahtfarbe: Weiß" in check["detail"]
    changed = await shop_products.set_offer(db, product["id"], technique="dtg", colors=["Black", "White"],
                                            sizes=["M", "L"], product_options={"stitch_color": "Black"},
                                            provider=provider, actor_id="finanzen-test", reason="Schwarze Naht")
    assert changed["offer"]["options"] == {"stitch_color": "Black"}
    log = await db.audit_logs.find({"action": "shop.product.offer"}, {"_id": 0}).sort("created_at", -1).to_list(1)
    assert log[0]["data"]["options"] == {"stitch_color": "Black"}
    for bad in ({"stitch_color": "Rosa"}, {"inside_pocket": True}, {"stitch_color": 1}):
        with pytest.raises(ShopError):
            await shop_products.set_offer(db, product["id"], technique="dtg", colors=["Black"], sizes=["M"],
                                          product_options=bad, provider=provider, **BY)


@pytest.mark.asyncio
async def test_a_missing_required_option_is_red_and_the_product_cannot_be_ordered(db, provider, fake):
    with_stitch(fake)
    product = await configured(db, provider)
    await publish_unchecked(db, product["id"])
    await db.shop_products.update_one({"id": product["id"]}, {"$unset": {"offer.options": ""}})
    view = await shop_products.admin_view(db, product["id"])
    check = next(item for item in view["check"]["items"] if item["key"] == "options")
    assert check["ok"] is False and check["state"] == "failed" and "Nahtfarbe fehlt" in check["detail"]
    white = await variant_for(db, product["id"], WHITE_M)
    with pytest.raises(ShopError, match="nicht bestellbar"):
        await shop_orders.place_order(
            db, user_id="konto-1", idempotency_key="bestellung-2158", buyer_kind="member",
            lines=[{"variant_id": white["id"], "quantity": 1, "gamertag": "Testlöwe"}], shipping_estimate_cents=490,
            billing_address=dict(BILLING), shipping_address=dict(SHIPPING), actor_id="konto-1")
    assert await db.shop_print_files.count_documents({"purpose": "order"}) == 0
    await shop_ready(db)
    with pytest.raises(ShopError, match="Nahtfarbe fehlt"):
        await shop_test_drafts.preview(db, product_id=product["id"], variant_id=white["id"], gamertag="Testlöwe",
                                       address=dict(ADDRESS), actor_id="finanzen-test", provider=provider)


@pytest.mark.asyncio
async def test_a_product_loaded_before_the_options_shows_a_hint_but_no_red_point(db, provider, fake):
    product = await configured(db, provider)
    await db.shop_products.update_one({"id": product["id"]}, {"$unset": {"printful.options": ""}})
    view = await shop_products.admin_view(db, product["id"])
    check = next(item for item in view["check"]["items"] if item["key"] == "options")
    assert check["ok"] is True and check["state"] == "warn" and "neu laden" in check["detail"]


# ---------------------------------------------------------------- Bestellung und Testentwurf

@pytest.mark.asyncio
async def test_the_order_freezes_the_options_and_later_changes_do_not_reach_it(db, provider, fake):
    with_stitch(fake)
    product = await configured(db, provider)
    await publish_unchecked(db, product["id"])
    white = await variant_for(db, product["id"], WHITE_M)
    order, _ = await shop_orders.place_order(
        db, user_id="konto-1", idempotency_key="bestellung-2158-a", buyer_kind="member",
        lines=[{"variant_id": white["id"], "quantity": 1, "gamertag": "Testlöwe"}], shipping_estimate_cents=490,
        billing_address=dict(BILLING), shipping_address=dict(SHIPPING), actor_id="konto-1")
    (item,) = await shop_orders.items_for(db, order["id"])
    assert item["product_options"] == [{"name": "stitch_color", "value": "White", "label": "Nahtfarbe",
                                        "value_label": "Weiß"}]
    await db.shop_products.update_one({"id": product["id"]}, {"$set": {"offer.options.stitch_color": "Black"}})
    (again,) = await shop_orders.items_for(db, order["id"])
    assert again["product_options"][0]["value"] == "White", "eingefroren"


@pytest.mark.asyncio
async def test_the_test_draft_sends_shows_and_compares_the_options(db, provider, fake):
    with_stitch(fake)
    product = await configured(db, provider)
    await shop_ready(db)
    white = await variant_for(db, product["id"], WHITE_M)
    shown = await shop_test_drafts.preview(db, product_id=product["id"], variant_id=white["id"], gamertag="Testlöwe",
                                           address=dict(ADDRESS), actor_id="finanzen-test", provider=provider)
    assert shown["estimate_error"] is None, "mit Nahtfarbe nimmt Printful die Schätzung an"
    (estimate,) = fake.calls_to("createOrderEstimationTask")
    assert estimate["body"]["order_items"][0]["product_options"] == [{"name": "stitch_color", "value": "White"}]
    assert shown["payload"]["order_items"][0]["product_options"] == [{"name": "stitch_color", "value": "White"}]
    assert shown["product_options"][0]["label"] == "Nahtfarbe" and shown["product_options"][0]["value_label"] == "Weiß"
    sent = await shop_test_drafts.send(db, shown["id"], idempotency_key="klick-2158", actor_id="finanzen-test",
                                       provider=provider)
    (call,) = fake.calls_to("createOrder")
    assert call["body"] == shown["payload"]
    row = next(row for row in sent["deviations"] if row["label"] == "Position 1: Produktoptionen")
    assert row["level"] == "ok" and row["printful"] == {"stitch_color": "White"}


@pytest.mark.asyncio
async def test_products_without_options_stay_exactly_as_before(db, provider, fake):
    product = await configured(db, provider)
    assert product["printful"]["options"] == [] and "options" not in product["offer"]
    view = await shop_products.admin_view(db, product["id"])
    assert "options" not in {item["key"] for item in view["check"]["items"]}
    await publish_unchecked(db, product["id"])
    white = await variant_for(db, product["id"], WHITE_M)
    order, _ = await shop_orders.place_order(
        db, user_id="konto-1", idempotency_key="bestellung-2158-b", buyer_kind="member",
        lines=[{"variant_id": white["id"], "quantity": 1, "gamertag": "Testlöwe"}], shipping_estimate_cents=490,
        billing_address=dict(BILLING), shipping_address=dict(SHIPPING), actor_id="konto-1")
    (item,) = await shop_orders.items_for(db, order["id"])
    assert "product_options" not in item
    await shop_ready(db)
    shown = await shop_test_drafts.preview(db, product_id=product["id"], variant_id=white["id"], gamertag="Testlöwe",
                                           address=dict(ADDRESS), actor_id="finanzen-test", provider=provider)
    assert "product_options" not in shown["payload"]["order_items"][0] and shown["product_options"] == []
    assert (await shop_catalog.get_product(db, product["id"]))["offer"] == product["offer"]
