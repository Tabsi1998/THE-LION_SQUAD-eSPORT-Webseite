"""Shop-Einstellungen (#1706) ohne Routen: Notschalter für Printful, Preise je Kaufart, Versandland und
Ersatzpauschale.

Gegen mongomock. Printful wird nie angerufen: der Fake-Adapter unten zählt, was er schreiben würde. Erfundene Daten."""
import pytest
from mongomock_motor import AsyncMongoMockClient

from services import shop_catalog, shop_config, shop_orders, shop_schema
from services.shop_common import ShopError

BY = {"actor_id": "finanzen-test", "reason": "Testdaten anlegen"}
BILLING = {"name": "Testperson Eins", "street": "Probegasse 1", "zip": "1010", "city": "Wien", "country": "AT",
           "source": "dolibarr"}
SHIPPING = {"recipient": "Testperson Zwei", "street": "Musterweg 2", "zip": "8010", "city": "Graz", "country": "AT",
            "source": "checkout"}


@pytest.fixture
def db():
    return AsyncMongoMockClient()["shop_einstellungen"]


async def settle(db, **fields) -> None:
    await db.settings.update_one({"id": "shop"}, {"$set": {"id": "shop", **fields}}, upsert=True)


# ---------------------------------------------------------------- Notschalter

class FakePrintful:
    """So muss der spätere Adapter (#1705) schreiben: erst den Notschalter fragen, dann senden."""

    def __init__(self, db):
        self.db = db
        self.sent: list[str] = []

    async def confirm_order(self, external_id: str) -> None:
        await shop_config.require_printful_writes(self.db)
        self.sent.append(external_id)


@pytest.mark.asyncio
async def test_switch_off_means_nothing_is_written_to_printful(db):
    fake = FakePrintful(db)
    for stage in shop_config.STAGES:
        await settle(db, stage=stage, orders_to_printful=False)
        assert await shop_config.printful_writes_allowed(db) is False
        with pytest.raises(shop_config.PrintfulWritesBlocked):
            await fake.confirm_order("lsw-test-1")
    assert fake.sent == []


@pytest.mark.asyncio
async def test_without_settings_and_with_junk_values_the_switch_counts_as_off(db):
    fake = FakePrintful(db)
    with pytest.raises(shop_config.PrintfulWritesBlocked):
        await fake.confirm_order("lsw-test-1")
    for junk in ("true", 1, "ja", None):
        await settle(db, orders_to_printful=junk)
        assert await shop_config.printful_writes_allowed(db) is False, junk
    assert fake.sent == []


@pytest.mark.asyncio
async def test_switch_on_lets_the_adapter_write_independent_of_the_stage(db):
    fake = FakePrintful(db)
    await settle(db, stage="off", orders_to_printful=True)
    await fake.confirm_order("lsw-test-2")
    assert fake.sent == ["lsw-test-2"]


# ---------------------------------------------------------------- Preise und Versand

async def catalog(db, *, markup_cents=0):
    await shop_schema.apply(db)
    product = await shop_catalog.create_product(db, {"slug": "loewen-shirt", "title": "Löwen-Shirt",
                                                     "base_price_cents": 1890, "markup_cents": markup_cents}, **BY)
    variant = await shop_catalog.create_variant(db, product["id"], {"sku": "SHIRT-M", "label": "M"}, **BY)
    await shop_catalog.update_product(db, product["id"], {"status": "active"}, **BY)
    return variant


async def place(db, variant, *, buyer_kind, key="bestellung-0001", shipping=None):
    order, _ = await shop_orders.place_order(
        db, user_id="konto-1", idempotency_key=key, buyer_kind=buyer_kind,
        lines=[{"variant_id": variant["id"], "quantity": 2}], shipping_cents=590,
        billing_address=dict(BILLING), shipping_address=shipping or dict(SHIPPING), actor_id="konto-1")
    return order


@pytest.mark.asyncio
async def test_members_pay_cost_price_and_the_public_markup_applies_per_article_only_to_public(db):
    variant = await catalog(db)
    await settle(db, public_markup_cents=300)
    member = await place(db, variant, buyer_kind="member", key="mitglied-0001")
    public = await place(db, variant, buyer_kind="public", key="oeffentlich-0001")
    assert member["frozen"]["markup_cents"] == 0
    assert member["frozen"]["total_cents"] == 2 * 1890 + 590
    assert public["frozen"]["markup_cents"] == 2 * 300
    assert public["frozen"]["total_cents"] == 2 * (1890 + 300) + 590
    # Eine spätere Änderung des Aufschlags wirkt nicht zurück.
    await settle(db, public_markup_cents=900)
    stored = await shop_orders.get_order(db, public["id"])
    assert stored["frozen"]["markup_cents"] == 2 * 300


@pytest.mark.asyncio
async def test_a_product_markup_comes_on_top_of_the_shop_markup_for_public_buyers(db):
    variant = await catalog(db, markup_cents=200)
    await settle(db, public_markup_cents=300)
    member = await place(db, variant, buyer_kind="member", key="mitglied-0002")
    public = await place(db, variant, buyer_kind="public", key="oeffentlich-0002")
    assert member["frozen"]["markup_cents"] == 0
    assert public["frozen"]["markup_cents"] == 2 * 500


@pytest.mark.asyncio
async def test_the_shop_ships_only_to_austria(db):
    variant = await catalog(db)
    with pytest.raises(ShopError, match="Österreich"):
        await place(db, variant, buyer_kind="member", shipping={**SHIPPING, "country": "DE"})
    assert await db.shop_orders.count_documents({}) == 0
    assert (await place(db, variant, buyer_kind="member"))["shipping_address"]["country"] == "AT"


def test_shipping_takes_the_estimate_else_the_fallback_else_refuses():
    config = shop_config.normalized({"fallback_shipping_cents": 690})
    assert shop_config.shipping_cents(config, 450) == 450
    assert shop_config.shipping_cents(config, 0) == 0
    assert shop_config.shipping_cents(config, None) == 690
    with pytest.raises(ShopError, match="Versand"):
        shop_config.shipping_cents(shop_config.normalized({}), None)
    for junk in (-1, True, "450"):
        assert shop_config.shipping_cents(config, junk) == 690, junk


def test_normalized_settings_fail_closed():
    config = shop_config.normalized({"stage": "alle", "orders_to_printful": "true", "public_markup_cents": -5,
                                     "fallback_shipping_cents": 0})
    assert config["stage"] == "off" and config["orders_to_printful"] is False
    assert config["public_markup_cents"] == 0 and config["fallback_shipping_cents"] is None
    assert shop_config.effective_stage(shop_config.normalized({"stage": "public"})) == "off"
    cleared = {"at": "2026-10-27T10:00:00+00:00", "by": "root", "reason": "geklärt"}
    assert shop_config.effective_stage(shop_config.normalized({"stage": "public", "tax_cleared": cleared})) == "public"
