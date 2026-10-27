"""Shop-Einstellungen (#1706) ohne Routen: Notschalter für Printful, Preise je Kaufart, Versandland und
Ersatzpauschale.

Gegen mongomock. Printful wird nie angerufen: der Fake-Adapter unten zählt, was er schreiben würde. Erfundene Daten."""
import pathlib
import sys

import pytest
from mongomock_motor import AsyncMongoMockClient

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from services import shop_catalog, shop_config, shop_orders, shop_schema  # noqa: E402
from services.secret_store import encrypt_secret  # noqa: E402
from services.shop_common import ShopConflict, ShopError  # noqa: E402
from shop_testdata import publish_unchecked  # noqa: E402

FAKE_KEY = "pf-testschluessel-nicht-echt-0123456789"

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
    await settle(db, stage="off", orders_to_printful=True, printful_api_key=encrypt_secret(FAKE_KEY))
    await fake.confirm_order("lsw-test-2")
    assert fake.sent == ["lsw-test-2"]


@pytest.mark.asyncio
async def test_switch_on_without_a_readable_key_still_blocks_every_write(db):
    fake = FakePrintful(db)
    for stored in ("", None, "enc:v1:kaputt"):
        await settle(db, orders_to_printful=True, printful_api_key=stored)
        assert await shop_config.printful_writes_allowed(db) is False, stored
        with pytest.raises(shop_config.PrintfulWritesBlocked):
            await fake.confirm_order("lsw-test-3")
    assert fake.sent == []


@pytest.mark.asyncio
async def test_drafts_need_stage_admins_or_higher_and_a_readable_key_but_not_the_switch(db):
    """#1705/#2062: Entwürfe kosten nichts - sie gehen auch bei ausgeschaltetem Notschalter, aber nur ab der Stufe
    „Nur Admins (Test)“ und mit lesbarem Schlüssel. Bestätigen bleibt hinter dem Notschalter."""
    key = encrypt_secret(FAKE_KEY)
    for stage in ("admins", "members"):
        await settle(db, stage=stage, orders_to_printful=False, printful_api_key=key)
        await shop_config.require_printful_drafts(db)
        assert await shop_config.printful_drafts_allowed(db) is True
        with pytest.raises(shop_config.PrintfulWritesBlocked):
            await shop_config.require_printful_writes(db)
    # „Öffentlich“ mit Freigabe zählt als höchste Stufe.
    await settle(db, stage="public", tax_cleared={"at": "2026-10-27T10:00:00+00:00", "by": "root"},
                 printful_api_key=key)
    await shop_config.require_printful_drafts(db)


@pytest.mark.asyncio
async def test_drafts_stay_blocked_when_the_shop_is_off_or_the_key_is_missing(db):
    key = encrypt_secret(FAKE_KEY)
    blocked = [{"stage": "off", "printful_api_key": key},
               {"stage": "kaputt", "printful_api_key": key},
               # „Öffentlich“ ohne Freigabe gilt als „Aus“.
               {"stage": "public", "tax_cleared": None, "printful_api_key": key},
               {"stage": "admins", "printful_api_key": ""},
               {"stage": "admins", "printful_api_key": "enc:v1:kaputt"},
               # Der Notschalter allein öffnet keine Entwürfe.
               {"stage": "off", "orders_to_printful": True, "printful_api_key": key}]
    for fields in blocked:
        await db.settings.delete_many({})
        await settle(db, **fields)
        assert await shop_config.printful_drafts_allowed(db) is False, fields
        with pytest.raises(shop_config.PrintfulDraftsBlocked):
            await shop_config.require_printful_drafts(db)


@pytest.mark.asyncio
async def test_switching_on_while_the_key_is_removed_in_between_never_ends_with_switch_on_and_no_key(db, monkeypatch):
    """Codex-Befund: „Notschalter an“ liest die Einstellungen (Schlüssel da), dann entfernt jemand den Schlüssel, dann
    schreibt das Einschalten. Ohne bedingtes Update stünde danach Schalter an ohne Schlüssel."""
    actor = {"id": "finanzen-test"}
    await settle(db, orders_to_printful=False, printful_api_key=encrypt_secret(FAKE_KEY))
    original_load = shop_config.load
    state = {"interleaved": False}

    async def load_then_remove(database):
        config = await original_load(database)
        if not state["interleaved"]:
            state["interleaved"] = True
            await shop_config.remove_printful_key(database, actor={"id": "system-test"}, reason="Schlüssel ausgetauscht")
        return config

    monkeypatch.setattr(shop_config, "load", load_then_remove)
    with pytest.raises(ShopConflict):
        await shop_config.update(db, {"orders_to_printful": True}, actor=actor, is_superadmin=False,
                                 reason="Produktion starten")
    monkeypatch.setattr(shop_config, "load", original_load)
    stored = await db.settings.find_one({"id": "shop"}, {"_id": 0})
    assert stored["orders_to_printful"] is False and not stored["printful_api_key"]
    with pytest.raises(shop_config.PrintfulWritesBlocked):
        await FakePrintful(db).confirm_order("lsw-test-4")
    # Ins Protokoll kommt nur das Entfernen - das gescheiterte Einschalten nicht.
    rows = await db.audit_logs.find({"action": "shop.config"}, {"_id": 0}).to_list(10)
    assert [row["data"]["after"] for row in rows] == [{"printful_key": "entfernt"}]


# ---------------------------------------------------------------- Preise und Versand

async def catalog(db, *, markup_cents=None):
    await shop_schema.apply(db)
    fields = {"slug": "loewen-shirt", "title": "Löwen-Shirt", "base_price_cents": 1890}
    if markup_cents is not None:
        fields["markup_cents"] = markup_cents
    product = await shop_catalog.create_product(db, fields, **BY)
    variant = await shop_catalog.create_variant(db, product["id"], {"sku": "SHIRT-M", "label": "M"}, **BY)
    await publish_unchecked(db, product["id"])
    return variant


async def place(db, variant, *, buyer_kind, key="bestellung-0001", shipping=None, estimate=590):
    order, _ = await shop_orders.place_order(
        db, user_id="konto-1", idempotency_key=key, buyer_kind=buyer_kind,
        lines=[{"variant_id": variant["id"], "quantity": 2}], shipping_estimate_cents=estimate,
        billing_address=dict(BILLING), shipping_address=shipping or dict(SHIPPING), actor_id="konto-1")
    return order


@pytest.mark.asyncio
async def test_without_an_estimate_the_order_takes_the_fallback_and_freezes_it(db):
    variant = await catalog(db)
    await settle(db, fallback_shipping_cents=690)
    order = await place(db, variant, buyer_kind="member", estimate=None)
    assert order["frozen"]["shipping_cents"] == 690 and order["frozen"]["shipping_source"] == "fallback"
    assert order["frozen"]["total_cents"] == 2 * 1890 + 690
    # Eine spätere Pauschale wirkt nicht zurück.
    await settle(db, fallback_shipping_cents=990)
    assert (await shop_orders.get_order(db, order["id"]))["frozen"]["shipping_cents"] == 690


@pytest.mark.asyncio
async def test_without_an_estimate_and_without_a_fallback_there_is_no_order(db):
    variant = await catalog(db)
    with pytest.raises(ShopError, match="Versand"):
        await place(db, variant, buyer_kind="member", estimate=None)
    assert await db.shop_orders.count_documents({}) == 0
    assert await db.shop_order_items.count_documents({}) == 0


@pytest.mark.asyncio
async def test_free_shipping_only_when_the_estimate_says_zero(db):
    variant = await catalog(db)
    await settle(db, fallback_shipping_cents=690)
    order = await place(db, variant, buyer_kind="member", estimate=0)
    assert order["frozen"]["shipping_cents"] == 0 and order["frozen"]["shipping_source"] == "estimate"
    for junk in (-1, True, "590", 10_001):
        with pytest.raises(ShopError, match="Versand"):
            await place(db, variant, buyer_kind="member", key=f"falsch-{junk}-01", estimate=junk)



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
async def test_a_product_markup_replaces_the_shop_markup_for_public_buyers(db):
    """Entscheidung zu #1707: ein gesetzter Produkt-Aufschlag ersetzt den allgemeinen - er kommt nicht dazu."""
    variant = await catalog(db, markup_cents=200)
    await settle(db, public_markup_cents=300)
    member = await place(db, variant, buyer_kind="member", key="mitglied-0002")
    public = await place(db, variant, buyer_kind="public", key="oeffentlich-0002")
    assert member["frozen"]["markup_cents"] == 0
    assert public["frozen"]["markup_cents"] == 2 * 200


@pytest.mark.asyncio
async def test_a_product_markup_of_zero_is_set_and_means_no_markup(db):
    """0 ist eine Entscheidung („ohne Aufschlag“), leer heißt „der allgemeine gilt“."""
    variant = await catalog(db, markup_cents=0)
    await settle(db, public_markup_cents=300)
    public = await place(db, variant, buyer_kind="public", key="oeffentlich-0003")
    assert public["frozen"]["markup_cents"] == 0


def test_the_markup_rule_reads_unset_as_the_shop_markup():
    config = {"public_markup_cents": 300}
    assert shop_config.markup_cents(config, "public", {"markup_cents": None}) == 300
    assert shop_config.markup_cents(config, "public", {}) == 300
    assert shop_config.markup_cents(config, "public", {"markup_cents": 450}) == 450
    assert shop_config.markup_cents(config, "member", {"markup_cents": 450}) == 0


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
