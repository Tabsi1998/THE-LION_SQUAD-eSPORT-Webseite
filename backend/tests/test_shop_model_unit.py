"""Shop-Datenmodell (#1703): Bestellungen frieren alles ein, Ereignisse werden nur angehängt, Idempotenzschlüssel sind
eindeutig, Rechnungs- und Lieferanschrift stehen getrennt mit Quelle und Zeitpunkt, personenbezogene Felder sind für
Auskunft und Löschung markiert, und im Modell gibt es keinen Platz für Bank- oder Zugangsdaten.

Gegen mongomock mit den echten Indizes aus ``services/shop_schema``. Erfundene Testdaten, keine echten Personen."""
import pytest
from mongomock_motor import AsyncMongoMockClient

from services import shop_catalog, shop_common, shop_orders, shop_schema

ACTOR = "finanzen-test"
BY = {"actor_id": ACTOR, "reason": "Testdaten anlegen"}
BILLING = {"name": "Testperson Eins", "street": "Probegasse 1", "zip": "1010", "city": "Wien", "country": "AT",
           "source": "dolibarr"}
SHIPPING = {"recipient": "Testperson Zwei", "street": "Musterweg 2/3", "zip": "8010", "city": "Graz", "country": "AT",
            "source": "checkout"}


@pytest.fixture
def db():
    return AsyncMongoMockClient()["shop_modell"]


async def catalog(db, *, gamertag_allowed=True, markup_cents=500, tax_profile=None):
    await shop_schema.apply(db)
    product = await shop_catalog.create_product(db, {
        "slug": "loewen-shirt", "title": "Löwen-Shirt", "base_price_cents": 2490, "markup_cents": markup_cents,
        "gamertag_allowed": gamertag_allowed, "tax_profile": tax_profile, "design_key": "loewe-vorne"}, **BY)
    variant = await shop_catalog.create_variant(db, product["id"], {"sku": "SHIRT-M-SCHWARZ", "label": "M, Schwarz",
                                                                    "size": "M", "color": "Schwarz"}, **BY)
    await shop_catalog.add_design_version(db, "loewe-vorne", file_ref="designs/loewe-v1.png", sha256="a" * 64,
                                          placement="front_right", **BY)
    await shop_catalog.set_printful_variant(db, variant["id"], printful_variant_id=4012, printful_product_id=71,
                                            **BY)
    await shop_catalog.update_product(db, product["id"], {"status": "active"}, **BY)
    return product, variant


async def place(db, variant, *, key="bestellung-0001", buyer_kind="member", gamertag="Testlöwe", user_id="konto-1",
                shipping_cents=590, billing=None, shipping=None, quantity=2):
    return await shop_orders.place_order(
        db, user_id=user_id, idempotency_key=key, buyer_kind=buyer_kind,
        lines=[{"variant_id": variant["id"], "quantity": quantity, "gamertag": gamertag}],
        shipping_estimate_cents=shipping_cents, billing_address=billing or dict(BILLING),
        shipping_address=shipping or dict(SHIPPING), actor_id=user_id)


# ---------------------------------------------------------------- Einfrieren

@pytest.mark.asyncio
async def test_an_order_freezes_prices_markup_shipping_tax_profile_gamertag_design_and_printful(db):
    _product, variant = await catalog(db, tax_profile="standard")
    order, created = await place(db, variant, buyer_kind="public", gamertag=None)
    assert created is True
    frozen = order["frozen"]
    # Öffentlich: Vereinsaufschlag je Artikel; Mitglieder zahlen ihn nicht.
    assert frozen == {**frozen, "currency": "EUR", "items_cents": 2 * 2490, "markup_cents": 2 * 500,
                      "shipping_cents": 590, "total_cents": 2 * 2490 + 2 * 500 + 590, "tax_profile": "standard",
                      "buyer_kind": "public"}
    items = await shop_orders.items_for(db, order["id"])
    assert len(items) == 1
    item = items[0]
    assert item["unit_price_cents"] == 2490 and item["markup_cents"] == 500 and item["line_total_cents"] == 2 * 2990
    assert (item["product_title"], item["variant_label"], item["sku"]) == ("Löwen-Shirt", "M, Schwarz",
                                                                           "SHIRT-M-SCHWARZ")
    assert item["design"] == {"design_key": "loewe-vorne", "version": 1, "sha256": "a" * 64}
    assert item["printful"] == {"variant_id": 4012, "product_id": 71}
    assert item["tax_profile"] == "standard"
    assert order["printful_external_id"] == f"lsw-{order['id']}"


@pytest.mark.asyncio
async def test_later_catalog_changes_do_not_touch_a_placed_order(db):
    product, variant = await catalog(db)
    order, _ = await place(db, variant)
    before = await shop_orders.items_for(db, order["id"])
    await shop_catalog.update_product(db, product["id"], {"base_price_cents": 3990, "markup_cents": 900,
                                                          "title": "Neues Shirt", "tax_profile": "reduced"}, **BY)
    await shop_catalog.update_variant(db, variant["id"], {"label": "M, Weiß", "price_cents": 4500}, **BY)
    await shop_catalog.add_design_version(db, "loewe-vorne", file_ref="designs/loewe-v2.png", sha256="b" * 64,
                                          placement="front_right", **BY)
    await shop_catalog.set_printful_variant(db, variant["id"], printful_variant_id=9999, printful_product_id=72,
                                            **BY)
    stored = await shop_orders.get_order(db, order["id"])
    assert stored["frozen"] == order["frozen"]
    assert await shop_orders.items_for(db, order["id"]) == before
    # Eine neue Bestellung sieht den neuen Stand.
    newer, _ = await place(db, variant, key="bestellung-0002")
    item = (await shop_orders.items_for(db, newer["id"]))[0]
    assert (item["unit_price_cents"], item["design"]["version"], item["printful"]["variant_id"]) == (4500, 2, 9999)


@pytest.mark.asyncio
async def test_billing_and_shipping_addresses_are_frozen_separately_with_source_and_time(db):
    _product, variant = await catalog(db)
    billing, shipping = dict(BILLING), dict(SHIPPING)
    order, _ = await place(db, variant, billing=billing, shipping=shipping)
    stored = await shop_orders.get_order(db, order["id"])
    assert stored["billing_address"]["name"] == "Testperson Eins" and stored["billing_address"]["source"] == "dolibarr"
    shipped = stored["shipping_address"]
    assert shipped["recipient"] == "Testperson Zwei" and shipped["source"] == "checkout"
    assert stored["billing_address"]["confirmed_at"] and stored["shipping_address"]["captured_at"]
    # Nachträgliche Änderung am Profil bzw. an der Eingabe ändert die Bestellung nicht.
    billing["street"], shipping["city"] = "Andere Gasse 9", "Linz"
    again = await shop_orders.get_order(db, order["id"])
    assert again["billing_address"]["street"] == "Probegasse 1" and again["shipping_address"]["city"] == "Graz"


@pytest.mark.asyncio
async def test_addresses_take_only_known_fields_and_a_known_source(db):
    _product, variant = await catalog(db)
    with pytest.raises(shop_common.ShopError):
        await place(db, variant, billing={**BILLING, "iban": "AT00 0000 0000 0000 0000"})
    with pytest.raises(shop_common.ShopError):
        await place(db, variant, key="bestellung-0003", shipping={**SHIPPING, "source": "irgendwo"})
    with pytest.raises(shop_common.ShopError):
        await place(db, variant, key="bestellung-0004", shipping={**SHIPPING, "recipient": "  "})
    assert await db.shop_orders.count_documents({}) == 0


@pytest.mark.asyncio
async def test_the_gamertag_is_only_for_members_on_products_that_allow_it(db):
    _product, variant = await catalog(db)
    with pytest.raises(shop_common.ShopError):
        await place(db, variant, buyer_kind="public", gamertag="Testlöwe")
    plain_product = await shop_catalog.create_product(db, {"slug": "kappe", "title": "Kappe", "base_price_cents": 1500},
                                                      **BY)
    plain = await shop_catalog.create_variant(db, plain_product["id"], {"sku": "KAPPE-1", "label": "Einheitsgröße"},
                                              **BY)
    await shop_catalog.update_product(db, plain_product["id"], {"status": "active"}, **BY)
    with pytest.raises(shop_common.ShopError):
        await place(db, plain, key="bestellung-0005", gamertag="Testlöwe")
    member_without, _ = await place(db, plain, key="bestellung-0006", gamertag=None)
    assert (await shop_orders.items_for(db, member_without["id"]))[0]["gamertag"] is None


@pytest.mark.asyncio
async def test_an_order_without_a_valid_quantity_or_with_negative_shipping_is_refused(db):
    _product, variant = await catalog(db)
    for kwargs in ({"quantity": 0}, {"quantity": 100}, {"shipping_cents": -1}):
        with pytest.raises(shop_common.ShopError):
            await place(db, variant, **kwargs)
    assert await db.shop_orders.count_documents({}) == 0


# ---------------------------------------------------------------- Idempotenz

@pytest.mark.asyncio
async def test_the_same_order_twice_gives_one_order_one_set_of_items_and_one_placed_event(db):
    _product, variant = await catalog(db)
    first, created = await place(db, variant)
    second, again = await place(db, variant)
    assert created is True and again is False and second["id"] == first["id"]
    assert await db.shop_orders.count_documents({}) == 1
    assert await db.shop_order_items.count_documents({}) == 1
    assert [event["kind"] for event in await shop_orders.events_for(db, first["id"])] == ["order.placed"]


@pytest.mark.asyncio
async def test_the_same_key_with_a_different_order_is_a_conflict(db):
    _product, variant = await catalog(db)
    await place(db, variant)
    with pytest.raises(shop_common.ShopConflict):
        await place(db, variant, quantity=3)
    assert await db.shop_orders.count_documents({}) == 1


@pytest.mark.asyncio
async def test_idempotency_keys_belong_to_one_account(db):
    _product, variant = await catalog(db)
    mine, _ = await place(db, variant, user_id="konto-1")
    theirs, created = await place(db, variant, user_id="konto-2")
    assert created is True and theirs["id"] != mine["id"]


@pytest.mark.asyncio
async def test_a_lost_race_on_the_key_leaves_no_second_order_and_no_stray_items(db, monkeypatch):
    """Zwei gleichzeitige Anfragen: beide sehen keine Bestellung, die zweite scheitert am eindeutigen Index."""
    _product, variant = await catalog(db)
    first, _ = await place(db, variant)
    real = shop_orders._existing
    calls = {"n": 0}

    async def nothing_yet(*args, **kwargs):
        calls["n"] += 1
        return None if calls["n"] == 1 else await real(*args, **kwargs)

    monkeypatch.setattr(shop_orders, "_existing", nothing_yet)
    second, created = await place(db, variant)
    assert created is False and second["id"] == first["id"]
    assert await db.shop_orders.count_documents({}) == 1
    assert await db.shop_order_items.count_documents({}) == 1


@pytest.mark.asyncio
async def test_the_unique_indexes_refuse_doubles_directly(db):
    from pymongo.errors import DuplicateKeyError

    _product, variant = await catalog(db)
    order, _ = await place(db, variant)
    stored = await db.shop_orders.find_one({"id": order["id"]}, {"_id": 0})
    with pytest.raises(DuplicateKeyError):
        await db.shop_orders.insert_one({**stored, "id": "anderer", "printful_external_id": "lsw-anderer"})
    with pytest.raises(DuplicateKeyError):
        await db.shop_orders.insert_one({**stored, "id": "dritter", "idempotency_key": "x:y"})


# ---------------------------------------------------------------- Ereignisse

@pytest.mark.asyncio
async def test_events_are_only_appended_and_a_one_time_event_happens_once(db):
    _product, variant = await catalog(db)
    order, _ = await place(db, variant)
    paid, created = await shop_orders.append_event(db, order["id"], "payment.received", event_key="payment.full",
                                                   actor_id="dolibarr", data={"amount_cents": 5570})
    again, repeated = await shop_orders.append_event(db, order["id"], "payment.received", event_key="payment.full",
                                                     actor_id="dolibarr", data={"amount_cents": 5570})
    assert created is True and repeated is False and again["id"] == paid["id"]
    note_a, _ = await shop_orders.append_event(db, order["id"], "note", actor_id=ACTOR)
    note_b, _ = await shop_orders.append_event(db, order["id"], "note", actor_id=ACTOR)
    assert note_a["id"] != note_b["id"]
    assert [event["kind"] for event in await shop_orders.events_for(db, order["id"])] == [
        "order.placed", "payment.received", "note", "note"]
    # Kein Weg im Service ändert oder löscht ein Ereignis.
    writers = ("update", "delete", "remove", "edit")
    assert not [name for name in dir(shop_orders) if "event" in name and name.startswith(writers)]


@pytest.mark.asyncio
async def test_events_carry_no_addresses(db):
    _product, variant = await catalog(db)
    order, _ = await place(db, variant)
    with pytest.raises(shop_common.ShopError):
        await shop_orders.append_event(db, order["id"], "note", actor_id=ACTOR, data={"shipping_address": SHIPPING})
    with pytest.raises(shop_common.ShopError):
        await shop_orders.append_event(db, order["id"], "note", actor_id=ACTOR, data={"x": {"street": "Probegasse 1"}})


@pytest.mark.asyncio
async def test_events_for_an_unknown_order_are_refused(db):
    await shop_schema.apply(db)
    with pytest.raises(shop_common.ShopError):
        await shop_orders.append_event(db, "gibt-es-nicht", "note", actor_id=ACTOR)


# ---------------------------------------------------------------- Katalog

@pytest.mark.asyncio
async def test_new_products_start_hidden_and_as_draft_without_a_tax_assumption(db):
    await shop_schema.apply(db)
    product = await shop_catalog.create_product(db, {"slug": "kappe", "title": "Kappe", "base_price_cents": 1500},
                                                **BY)
    assert product["visibility"] == "hidden" and product["status"] == "draft" and product["tax_profile"] is None
    with pytest.raises(shop_common.ShopError):
        await shop_catalog.create_product(db, {"slug": "kappe", "title": "Kappe 2", "base_price_cents": 1500}, **BY)
    with pytest.raises(shop_common.ShopError):
        await shop_catalog.create_product(db, {"slug": "steuer", "title": "X", "base_price_cents": 1,
                                               "tax_profile": "0%"}, **BY)


@pytest.mark.asyncio
async def test_a_draft_product_cannot_be_ordered(db):
    await shop_schema.apply(db)
    product = await shop_catalog.create_product(db, {"slug": "entwurf", "title": "Entwurf", "base_price_cents": 1000},
                                                **BY)
    variant = await shop_catalog.create_variant(db, product["id"], {"sku": "E-1", "label": "Einheitsgröße"}, **BY)
    with pytest.raises(shop_common.ShopError):
        await place(db, variant, gamertag=None)


@pytest.mark.asyncio
async def test_design_versions_count_up_and_need_a_checksum(db):
    await shop_schema.apply(db)
    one = await shop_catalog.add_design_version(db, "logo-hinten", file_ref="designs/l1.png", sha256="c" * 64,
                                                placement="back", **BY)
    two = await shop_catalog.add_design_version(db, "logo-hinten", file_ref="designs/l2.png", sha256="d" * 64,
                                                placement="back", **BY)
    assert (one["version"], two["version"]) == (1, 2)
    assert (await shop_catalog.latest_design(db, "logo-hinten"))["sha256"] == "d" * 64
    with pytest.raises(shop_common.ShopError):
        await shop_catalog.add_design_version(db, "logo-hinten", file_ref="designs/l3.png", sha256="kurz",
                                              placement="back", **BY)


# ---------------------------------------------------------------- Datenschutz und Sicherheit

def test_personal_fields_are_marked_for_export_and_erasure():
    assert shop_common.PERSONAL_FIELDS == {
        "shop_orders": ("user_id", "billing_address", "shipping_address"),
        "shop_order_items": ("user_id", "gamertag"),
        "shop_carts": ("user_id", "items"),
    }


def test_the_model_has_no_field_for_bank_or_access_data():
    fields = shop_common.model_field_names()
    assert fields, "die Feldliste ist nicht leer"
    bad = sorted(name for name in fields if any(part in name.lower() for part in shop_common.FORBIDDEN_FIELD_PARTS))
    assert not bad


@pytest.mark.asyncio
async def test_erasing_an_account_overwrites_addresses_and_gamertag_and_drops_the_cart(db):
    _product, variant = await catalog(db)
    order, _ = await place(db, variant)
    await shop_orders.save_cart(db, "konto-1", [{"variant_id": variant["id"], "quantity": 1}])
    counts = await shop_orders.anonymize_user(db, "konto-1")
    assert counts == {"orders": 1, "items": 1, "carts": 1}
    stored = await shop_orders.get_order(db, order["id"])
    assert "Testperson" not in str(stored) and "Probegasse" not in str(stored) and "Musterweg" not in str(stored)
    assert stored["frozen"] == order["frozen"], "Beträge bleiben für die Buchhaltung"
    assert stored["shipping_address"]["country"] == "AT"
    item = (await shop_orders.items_for(db, order["id"]))[0]
    assert item["gamertag"] is None
    assert await db.shop_carts.count_documents({}) == 0
