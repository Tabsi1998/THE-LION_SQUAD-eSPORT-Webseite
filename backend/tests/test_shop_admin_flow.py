"""Shop im Bereich Finanzen (#1704): wer Produkte sehen, anlegen und ändern und Bestellungen lesen darf, und was davon
im Protokoll der Adminaktionen steht.

Durch die echte Anwendung (flow_harness): Routen, Wächter und Datenbank sind die echten. Je Rolle erlaubt und verboten;
ohne bestätigte Zwei-Faktor-Anmeldung kein Zugriff. Der Shop hat keine öffentlichen Routen. Erfundene Daten, keine
echten Personen."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from shop_testdata import publish_unchecked  # noqa: E402

BASE = "/api/admin/shop"
BY = {"actor_id": "test", "reason": "Testdaten"}
SHOP_ACTIONS = {"action": {"$regex": "^shop\\."}}
PRODUCT = {"slug": "loewen-shirt", "title": "Löwen-Shirt", "base_price_cents": 2490, "markup_cents": 500,
           "personalization": "gamertag", "reason": "Erstes Vereinsshirt anlegen"}
BILLING = {"name": "Testperson Eins", "street": "Probegasse 1", "zip": "1010", "city": "Wien", "country": "AT",
           "source": "dolibarr"}
SHIPPING = {"recipient": "Testperson Zwei", "street": "Musterweg 2", "zip": "8010", "city": "Graz", "country": "AT",
            "source": "checkout"}


@pytest_asyncio.fixture
async def flow():
    from services import shop_schema

    instance, shutdown = make_flow()
    try:
        # Wie beim Start: die Shop-Indizes stehen (die Ablauf-Tests legen sonst keine an).
        await shop_schema.apply(instance.db)
        yield instance
    finally:
        await shutdown()


def without_second_factor(user: dict) -> dict:
    return {**user, "auth_mfa_verified": False}


async def people(flow) -> dict:
    player = await flow.add_user(role="player", name="spieler")
    member = await flow.add_user(role="player", name="mitglied")
    await flow.db.memberships.insert_one({"user_id": member["id"], "member_status": "active"})
    lead = await flow.add_user(role="tournament_admin", name="turnierleitung")
    finance = await flow.add_user(role="player", name="kassier")
    await flow.db.users.update_one({"id": finance["id"]}, {"$set": {"areas": ["finance"]}})
    finance["areas"] = ["finance"]
    club_admin = await flow.add_user(role="club_admin", name="clubadmin")
    root = await flow.add_user(role="superadmin", name="root")
    return {"spieler": player, "mitglied": member, "turnierleitung": lead, "finanzen": finance,
            "club-admin": club_admin, "superadmin": root}


ALLOWED = ("finanzen", "club-admin", "superadmin")
REFUSED = ("spieler", "mitglied", "turnierleitung")


async def seeded_order(flow) -> dict:
    from services import shop_catalog, shop_orders

    fields = {"slug": "bestellt", "title": "Bestellt", "base_price_cents": 2000}
    product = await shop_catalog.create_product(flow.db, fields, **BY)
    await publish_unchecked(flow.db, product["id"])
    variant = await shop_catalog.create_variant(flow.db, product["id"], {"sku": "B-1", "label": "M"}, **BY)
    order, _ = await shop_orders.place_order(
        flow.db, user_id="konto-test", idempotency_key="flow-0001", buyer_kind="member",
        lines=[{"variant_id": variant["id"], "quantity": 1}], shipping_estimate_cents=590,
        billing_address=dict(BILLING), shipping_address=dict(SHIPPING), actor_id="konto-test")
    return order


async def requests(flow, product_id: str, variant_id: str, order_id: str) -> dict:
    """Je Route eine Anfrage - lesend und schreibend."""
    return {
        "products": await flow.get(f"{BASE}/products"),
        "create": await flow.post(f"{BASE}/products", json={**PRODUCT, "slug": f"neu-{flow.user['id'][:8]}"}),
        "product": await flow.get(f"{BASE}/products/{product_id}"),
        "update": await flow.patch(f"{BASE}/products/{product_id}",
                                   json={"title": "Neuer Titel", "reason": "Tippfehler"}),
        "variant": await flow.post(f"{BASE}/products/{product_id}/variants",
                                   json={"sku": f"V-{flow.user['id'][:8]}", "label": "L", "reason": "Größe L dazu"}),
        "variant_update": await flow.patch(f"{BASE}/variants/{variant_id}",
                                           json={"label": "XL", "reason": "Umbenannt"}),
        "orders": await flow.get(f"{BASE}/orders"),
        "order": await flow.get(f"{BASE}/orders/{order_id}"),
    }


async def setup_catalog(flow) -> tuple[str, str, str]:
    from services import shop_catalog

    product = await shop_catalog.create_product(flow.db, {"slug": "basis", "title": "Basis", "base_price_cents": 1000},
                                                **BY)
    variant = await shop_catalog.create_variant(flow.db, product["id"], {"sku": "BASIS-M", "label": "M"}, **BY)
    order = await seeded_order(flow)
    return product["id"], variant["id"], order["id"]


# ---------------------------------------------------------------- Wer darf

@pytest.mark.asyncio
async def test_finance_club_admin_and_superadmin_may_everything_in_the_shop(flow):
    who = await people(flow)
    product_id, variant_id, order_id = await setup_catalog(flow)
    for name in ALLOWED:
        flow.act_as(who[name])
        answers = await requests(flow, product_id, variant_id, order_id)
        for route, answer in answers.items():
            assert answer.status_code == 200, (name, route, answer.text)


@pytest.mark.asyncio
async def test_player_member_and_tournament_lead_may_nothing_in_the_shop(flow):
    who = await people(flow)
    product_id, variant_id, order_id = await setup_catalog(flow)
    before = await flow.db.shop_products.count_documents({})
    logged = await flow.db.audit_logs.count_documents({})
    for name in REFUSED:
        flow.act_as(who[name])
        answers = await requests(flow, product_id, variant_id, order_id)
        for route, answer in answers.items():
            assert answer.status_code == 403, (name, route, answer.text)
            assert "Finanzen" in answer.json()["detail"]
    assert await flow.db.shop_products.count_documents({}) == before
    assert await flow.db.audit_logs.count_documents({}) == logged


@pytest.mark.asyncio
async def test_without_the_second_factor_no_one_gets_in(flow):
    who = await people(flow)
    product_id, variant_id, order_id = await setup_catalog(flow)
    logged = await flow.db.audit_logs.count_documents({})
    for name in ALLOWED:
        flow.act_as(without_second_factor(who[name]))
        answers = await requests(flow, product_id, variant_id, order_id)
        for route, answer in answers.items():
            assert answer.status_code == 403, (name, route, answer.text)
            assert "Zwei-Faktor" in answer.json()["detail"]
    assert await flow.db.audit_logs.count_documents({}) == logged


@pytest.mark.asyncio
async def test_without_login_the_shop_admin_answers_401(flow):
    product_id, variant_id, order_id = await setup_catalog(flow)
    flow.act_as(None)
    answers = await requests_anonymous(flow, product_id, order_id)
    assert {route: answer.status_code for route, answer in answers.items()} == {route: 401 for route in answers}


async def requests_anonymous(flow, product_id: str, order_id: str) -> dict:
    return {"products": await flow.get(f"{BASE}/products"), "product": await flow.get(f"{BASE}/products/{product_id}"),
            "create": await flow.post(f"{BASE}/products", json=PRODUCT), "orders": await flow.get(f"{BASE}/orders"),
            "order": await flow.get(f"{BASE}/orders/{order_id}")}


@pytest.mark.asyncio
async def test_the_only_public_shop_route_is_the_print_file_for_printful(flow):
    from server import app

    paths = sorted({getattr(route, "path", "") for route in _routes(app.routes)})
    shop = [path for path in paths if "shop" in path]
    public = [path for path in shop if not (path.startswith(f"{BASE}/") or path == BASE)]
    # Bewusst öffentlich (#1708, Regel 3 in scripts/check-code-patterns.py): Printful holt die Druckdateien.
    assert shop and public == ["/api/shop/print-files/{public_id}/{filename}"], shop


def _routes(routes):
    for route in routes or []:
        original = getattr(route, "original_router", None)
        if original is not None:
            yield from _routes(getattr(original, "routes", []))
            continue
        nested = getattr(route, "routes", None)
        if nested and not getattr(route, "path", None):
            yield from _routes(nested)
            continue
        yield route


# ---------------------------------------------------------------- Was geschrieben wird und was im Protokoll steht

@pytest.mark.asyncio
async def test_creating_and_changing_a_product_is_logged_with_person_and_reason(flow):
    who = await people(flow)
    flow.act_as(who["finanzen"])
    created = await flow.post(f"{BASE}/products", json=PRODUCT)
    assert created.status_code == 200, created.text
    product = created.json()["product"]
    assert product["visibility"] == "hidden" and product["status"] == "draft"

    changed = await flow.patch(f"{BASE}/products/{product['id']}", json={
        "base_price_cents": 2990, "visibility": "members", "title": "Löwen-Shirt 2026",
        "reason": "Neuer Einkaufspreis"})
    assert changed.status_code == 200, changed.text
    assert changed.json()["product"]["base_price_cents"] == 2990

    rows = await flow.db.audit_logs.find(SHOP_ACTIONS, {"_id": 0}).sort("created_at", 1).to_list(20)
    assert [row["action"] for row in rows] == ["shop.product.create", "shop.product.price", "shop.product.visibility",
                                               "shop.product.update"]
    for row in rows:
        assert row["actor_id"] == who["finanzen"]["id"] and row["target_id"] == product["id"]
        assert row["data"]["reason"] in ("Erstes Vereinsshirt anlegen", "Neuer Einkaufspreis")
    price = rows[1]["data"]
    assert price["before"] == {"base_price_cents": 2490} and price["after"] == {"base_price_cents": 2990}
    visibility = rows[2]["data"]
    assert visibility["before"] == {"visibility": "hidden"} and visibility["after"] == {"visibility": "members"}


@pytest.mark.asyncio
async def test_a_write_without_reason_or_with_unknown_fields_is_refused(flow):
    who = await people(flow)
    flow.act_as(who["finanzen"])
    no_reason = await flow.post(f"{BASE}/products",
                                json={key: value for key, value in PRODUCT.items() if key != "reason"})
    blank = await flow.post(f"{BASE}/products", json={**PRODUCT, "reason": "   "})
    unknown = await flow.post(f"{BASE}/products", json={**PRODUCT, "iban": "AT00 0000"})
    negative = await flow.post(f"{BASE}/products", json={**PRODUCT, "base_price_cents": -1})
    assert [no_reason.status_code, blank.status_code, unknown.status_code, negative.status_code] == [422, 422, 422, 422]
    assert await flow.db.shop_products.count_documents({}) == 0
    assert await flow.db.audit_logs.count_documents({}) == 0


@pytest.mark.asyncio
async def test_an_unchanged_save_writes_no_log_entry(flow):
    who = await people(flow)
    flow.act_as(who["finanzen"])
    product = (await flow.post(f"{BASE}/products", json=PRODUCT)).json()["product"]
    same = await flow.patch(f"{BASE}/products/{product['id']}",
                            json={"title": PRODUCT["title"], "reason": "Nur gespeichert"})
    assert same.status_code == 200 and same.json()["changed"] == []
    assert await flow.db.audit_logs.count_documents({"action": {"$regex": "^shop\\."}}) == 1


@pytest.mark.asyncio
async def test_variant_prices_are_logged_as_price_changes(flow):
    who = await people(flow)
    flow.act_as(who["club-admin"])
    product = (await flow.post(f"{BASE}/products", json=PRODUCT)).json()["product"]
    variant = await flow.post(f"{BASE}/products/{product['id']}/variants",
                              json={"sku": "SHIRT-XL", "label": "XL", "price_cents": 2690, "reason": "XL kostet mehr"})
    assert variant.status_code == 200, variant.text
    variant_id = variant.json()["variant"]["id"]
    changed = await flow.patch(f"{BASE}/variants/{variant_id}", json={"price_cents": 2790, "reason": "Einkauf teurer"})
    assert changed.status_code == 200, changed.text
    actions = [row["action"] async for row in flow.db.audit_logs.find(SHOP_ACTIONS).sort("created_at", 1)]
    assert actions == ["shop.product.create", "shop.variant.create", "shop.product.price"]
    duplicate = await flow.post(f"{BASE}/products/{product['id']}/variants",
                                json={"sku": "SHIRT-XL", "label": "XL", "reason": "doppelt"})
    assert duplicate.status_code == 409


@pytest.mark.asyncio
async def test_unknown_products_and_orders_answer_404(flow):
    who = await people(flow)
    flow.act_as(who["finanzen"])
    for answer in (await flow.get(f"{BASE}/products/gibt-es-nicht"), await flow.get(f"{BASE}/orders/gibt-es-nicht"),
                   await flow.patch(f"{BASE}/products/gibt-es-nicht", json={"title": "x", "reason": "Test"}),
                   await flow.patch(f"{BASE}/variants/gibt-es-nicht", json={"label": "x", "reason": "Test"})):
        assert answer.status_code == 404, answer.text


@pytest.mark.asyncio
async def test_the_order_list_shows_no_addresses_and_the_detail_its_events(flow):
    who = await people(flow)
    order = await seeded_order(flow)
    logged = await flow.db.audit_logs.count_documents({})
    flow.act_as(who["finanzen"])
    listed = await flow.get(f"{BASE}/orders")
    assert listed.status_code == 200
    text = listed.text
    assert order["id"] in text and "Probegasse" not in text and "Musterweg" not in text and "Testperson" not in text
    detail = (await flow.get(f"{BASE}/orders/{order['id']}")).json()
    assert detail["order"]["frozen"]["total_cents"] == 2000 + 590
    assert [item["sku"] for item in detail["items"]] == ["B-1"]
    assert [event["kind"] for event in detail["events"]] == ["order.placed"]
    # Lesen ist keine Adminaktion.
    assert await flow.db.audit_logs.count_documents({}) == logged


@pytest.mark.asyncio
async def test_no_log_entry_of_the_shop_carries_an_address(flow):
    from services import shop_common

    with pytest.raises(shop_common.ShopError):
        await shop_common.record_admin_action(flow.db, "shop.order.cancel", actor_id="a", target_id="o",
                                              reason="Storno auf Wunsch", data={"shipping_address": SHIPPING})
    with pytest.raises(shop_common.ShopError):
        await shop_common.record_admin_action(flow.db, "shop.erfunden", actor_id="a", target_id="o", reason="Test")
    with pytest.raises(shop_common.ShopError):
        await shop_common.record_admin_action(flow.db, "shop.config", actor_id="a", target_id="shop", reason=" ")
    entry = await shop_common.record_admin_action(flow.db, "shop.config", actor_id="a", target_id="shop",
                                                  reason="Rückfrage an test@example.test\nzweite Zeile")
    assert "\n" not in entry["data"]["reason"] and "test@example.test" not in entry["data"]["reason"]
    # Alle Aktionen aus dem Issue haben einen Namen im Protokoll.
    assert {"shop.product.create", "shop.product.update", "shop.product.price", "shop.product.visibility",
            "shop.order.release", "shop.order.printful_confirm", "shop.order.cancel", "shop.order.club",
            "shop.order.prize", "shop.config"} <= set(shop_common.ADMIN_ACTIONS)
