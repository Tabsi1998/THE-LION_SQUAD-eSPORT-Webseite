"""Printful-Adapter (#1705) gegen den Vertrags-Fake: Katalog, Kostenschätzung, Entwurf, Bestätigung, Dateien, Mockups,
Webhook-Signatur, Fehlerklassen und Wiederholungen.

Kein echter Aufruf an Printful (httpx-MockTransport über ``tests/printful_fake.py``), kein echter Schlüssel, keine
echten Personen. Die Datenbank ist mongomock - nur für Stufe, Notschalter, Schlüssel und den Idempotenzschutz."""
import asyncio
import inspect
from datetime import datetime, timedelta, timezone
import logging
import sys
import pathlib

import httpx
import pytest
import pytest_asyncio
from mongomock_motor import AsyncMongoMockClient

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import database  # noqa: E402

from printful_fake import API_KEY, WEBHOOK_SECRET_HEX, ContractViolation, FakePrintful, SPEC, validate  # noqa: E402
from services import printful_client, shop_config  # noqa: E402
from services.printful_client import PrintfulClient, verify_webhook_signature  # noqa: E402
from services.secret_store import encrypt_secret  # noqa: E402
from services.shop_fulfillment import (  # noqa: E402
    CatalogProductId, CatalogVariantId, DraftLine, DraftOrder, FulfillmentError, FulfillmentInvalid,
    FulfillmentPermanent, FulfillmentProvider, FulfillmentTransient, Placement, PrintfulOrderId, Recipient)

PRODUCT = CatalogProductId(71)
SHIRT_M, SHIRT_L = CatalogVariantId(4012), CatalogVariantId(4013)
FRONT = Placement(placement="front", technique="dtg", file_url="https://lsw.example.test/druck/loewe-v3.png")
BACK = Placement(placement="back", technique="dtg", file_url="https://lsw.example.test/druck/gamertag-test.png")
CLUB = Recipient(name="Testverein Löwen", address1="Teststraße 1", city="Testdorf", zip="6410", country_code="AT")


@pytest_asyncio.fixture
async def db():
    """Mit den Indizes, die jeder Start anlegt - die eindeutigen tragen die Claims beim Anlegen und Bestätigen."""
    instance = AsyncMongoMockClient()["printful_adapter"]
    await database.init_audit_indexes(instance)
    return instance


def stale() -> str:
    return "2026-01-01T00:00:00+00:00"


def just_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def far_future() -> str:
    """Ein Stempel aus einer vorgehenden Uhr (Clock-Skew) - darf nie unbegrenzt als frisch gelten."""
    return (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()


@pytest.fixture
def fake():
    instance = FakePrintful()
    instance.add_product(71, ((4012, "M"), (4013, "L")), price="12.50")
    return instance


@pytest.fixture
def pauses(monkeypatch):
    """Statt zu warten: merken, wie lange der Client gewartet hätte."""
    waited: list[float] = []

    async def no_wait(seconds):
        waited.append(seconds)

    monkeypatch.setattr(printful_client, "_sleep", no_wait)
    return waited


@pytest.fixture
def client(fake, pauses):
    return PrintfulClient(API_KEY, transport=fake.transport())


async def settle(db, *, stage="admins", switch=False, key=True) -> None:
    await db.settings.update_one({"id": "shop"}, {"$set": {
        "id": "shop", "stage": stage, "orders_to_printful": switch,
        "printful_api_key": encrypt_secret(API_KEY) if key else ""}}, upsert=True)


def draft(external_id="lsw-test-0001", lines=None) -> DraftOrder:
    return DraftOrder(external_id=external_id, recipient=CLUB,
                      lines=lines or (DraftLine(variant=SHIRT_M, quantity=2, placements=(FRONT, BACK)),))


# ---------------------------------------------------------------- Schnittstelle, Wege, Typen

def test_the_client_implements_the_exchangeable_interface(client):
    assert isinstance(client, FulfillmentProvider)
    assert printful_client.API_BASE == "https://api.printful.com"


def test_product_and_variant_numbers_cannot_be_mixed_up():
    assert CatalogProductId(5) != CatalogVariantId(5)
    for wrong in (True, 0, -1, "5", 5.0):
        with pytest.raises((TypeError, ValueError)):
            CatalogVariantId(wrong)
    with pytest.raises(TypeError):
        DraftLine(variant=CatalogProductId(71), quantity=1, placements=(FRONT,))
    with pytest.raises(TypeError):
        DraftLine(variant=4012, quantity=1, placements=(FRONT,))


@pytest.mark.asyncio
async def test_catalog_calls_refuse_plain_numbers_and_the_wrong_kind_of_number(client, fake):
    with pytest.raises(TypeError):
        await client.catalog_product(71)
    with pytest.raises(TypeError):
        await client.catalog_product(SHIRT_M)
    with pytest.raises(TypeError):
        await client.catalog_variants(SHIRT_M)
    with pytest.raises(TypeError):
        await client.create_mockup_task(SHIRT_M, (SHIRT_M,), (FRONT,))
    with pytest.raises(TypeError):
        await client.create_mockup_task(PRODUCT, (PRODUCT,), (FRONT,))
    assert fake.calls == []


def test_placements_only_take_https_files_and_plain_names():
    for bad in ("http://lsw.example.test/a.png", "file:///etc/passwd", "https://", "https://a b.test/x.png"):
        with pytest.raises(ValueError):
            Placement(placement="front", technique="dtg", file_url=bad)
    with pytest.raises(ValueError):
        Placement(placement="../front", technique="dtg", file_url="https://lsw.example.test/a.png")


@pytest.mark.asyncio
async def test_a_redirect_is_never_followed(client, fake):
    fake.fail(302, operation="getProductById")
    with pytest.raises(FulfillmentPermanent) as caught:
        await client.catalog_product(PRODUCT)
    assert caught.value.reason == "redirect"
    assert len(fake.calls) == 1


# ---------------------------------------------------------------- Katalog

@pytest.mark.asyncio
async def test_catalog_product_has_placements_and_techniques(client):
    product = await client.catalog_product(PRODUCT)
    assert product.id == PRODUCT and "Bella" in product.name
    assert [(row.placement, row.technique) for row in product.placements] == [("front", "dtg"), ("back", "dtg")]
    assert product.techniques == ("dtg",)
    assert product.is_discontinued is False


@pytest.mark.asyncio
async def test_catalog_variants_carry_size_color_number_price_and_stock(client, fake):
    fake.stock[4013] = "out of stock"
    variants = await client.catalog_variants(PRODUCT)
    by_size = {row.size: row for row in variants}
    assert set(by_size) == {"M", "L"}
    medium = by_size["M"]
    assert medium.id == SHIRT_M and medium.product_id == PRODUCT
    assert medium.color == "Black" and medium.color_code == "#0c0c0c"
    assert medium.prices == {"dtg": 1250} and medium.price_cents("dtg") == 1250
    assert medium.currency == "EUR"
    assert medium.in_stock is True and by_size["L"].in_stock is False
    price_calls = fake.calls_to("getVariantPricesById")
    assert {call["params"]["currency"] for call in price_calls} == {"EUR"}


# ---------------------------------------------------------------- Kostenschätzung

@pytest.mark.asyncio
async def test_the_estimate_splits_goods_shipping_and_tax_and_sends_no_name(client, fake, pauses):
    fake.estimation_polls = 3
    costs = await client.estimate_costs(draft().lines, country_code="AT", zip_code="6410")
    assert costs.currency == "EUR"
    assert costs.subtotal_cents == 2500 and costs.shipping_cents == 495
    assert costs.vat_cents == 599 and costs.tax_cents == 0
    assert costs.total_cents == 2500 + 495 + 599
    sent = fake.calls_to("createOrderEstimationTask")[0]["body"]
    assert sent["recipient"] == {"country_code": "AT", "zip": "6410"}
    assert len(fake.calls_to("getOrderEstimationTask")) == 3 and len(pauses) == 2


@pytest.mark.asyncio
async def test_a_failed_estimate_blocks_the_order(client, fake):
    lines = (DraftLine(variant=CatalogVariantId(999999), quantity=1, placements=(FRONT,)),)
    with pytest.raises(FulfillmentInvalid) as caught:
        await client.estimate_costs(lines, country_code="AT", zip_code="6410")
    assert caught.value.kind == "invalid" and "999999" in caught.value.provider_detail


@pytest.mark.asyncio
async def test_an_estimate_that_never_finishes_is_temporary(client, fake):
    fake.estimation_polls = 1000
    with pytest.raises(FulfillmentTransient) as caught:
        await client.estimate_costs(draft().lines, country_code="AT", zip_code="6410")
    assert caught.value.reason == "estimate_pending"


# ---------------------------------------------------------------- Entwurf

@pytest.mark.asyncio
async def test_a_draft_goes_out_with_the_switch_off_and_stays_a_draft(client, fake, db):
    await settle(db, stage="admins", switch=False)
    order = await client.create_draft(db, draft())
    assert order.status == "draft" and order.external_id == "lsw-test-0001"
    assert isinstance(order.id, PrintfulOrderId)
    assert fake.confirmations == [] and fake.calls_to("confirmOrder") == []
    created = fake.calls_to("createOrder")
    assert len(created) == 1 and created[0]["params"] == {}
    assert set(created[0]["body"]) == {"external_id", "shipping", "recipient", "order_items"}
    item = created[0]["body"]["order_items"][0]
    assert item["catalog_variant_id"] == 4012 and item["quantity"] == 2
    assert [place["placement"] for place in item["placements"]] == ["front", "back"]


def test_creating_can_not_confirm_by_design():
    """Es gibt keinen Weg, beim Anlegen zu bestätigen: kein Feld, kein Parameter, und der Vertrag lehnt ``confirm`` ab."""
    with pytest.raises(TypeError):
        DraftOrder(external_id="lsw-x", recipient=CLUB, lines=draft().lines, confirm=True)
    parameters = inspect.signature(PrintfulClient.create_draft).parameters
    assert not any("confirm" in name for name in parameters)
    body = printful_client.order_payload(draft())
    assert "confirm" not in body
    with pytest.raises(ContractViolation):
        validate({**body, "confirm": True}, SPEC["paths"]["/v2/orders"]["post"]["requestBody"]["content"]
                 ["application/json"]["schema"])


@pytest.mark.asyncio
async def test_creating_never_confirms_even_with_the_switch_on(client, fake, db):
    await settle(db, stage="members", switch=True)
    with pytest.raises(TypeError):
        await client.create_draft(db, draft(), confirm=True)
    await client.create_draft(db, draft())
    assert fake.calls_to("confirmOrder") == [] and fake.confirmations == []
    assert [row["status"] for row in fake.orders.values()] == ["draft"]


@pytest.mark.asyncio
async def test_the_request_layer_refuses_the_confirmation_path_outside_confirm(client, fake):
    with pytest.raises(RuntimeError):
        await client._request("POST", "/v2/orders/1/confirmation", operation="confirmOrder")
    assert fake.calls == []


@pytest.mark.asyncio
async def test_drafts_are_blocked_while_the_shop_is_off(client, fake, db):
    await settle(db, stage="off", switch=True)
    with pytest.raises(shop_config.PrintfulDraftsBlocked):
        await client.create_draft(db, draft())
    await settle(db, stage="admins", key=False)
    with pytest.raises(shop_config.PrintfulDraftsBlocked):
        await client.create_draft(db, draft())
    assert fake.calls == []


@pytest.mark.asyncio
async def test_the_same_external_id_never_creates_a_second_order(client, fake, db):
    await settle(db)
    first = await client.create_draft(db, draft())
    again = await client.create_draft(db, draft())
    assert again.id == first.id and len(fake.orders) == 1
    assert len(fake.calls_to("createOrder")) == 1


@pytest.mark.asyncio
async def test_creating_is_not_repeated_by_the_client(client, fake, db, pauses):
    await settle(db)
    fake.fail(503, operation="createOrder")
    with pytest.raises(FulfillmentTransient) as caught:
        await client.create_draft(db, draft())
    assert caught.value.status == 503
    assert len(fake.calls_to("createOrder")) == 1
    # Ausgang offen: gleich danach wartet ein neuer Versuch, statt ein zweites Mal zu senden.
    with pytest.raises(FulfillmentTransient) as waiting:
        await client.create_draft(db, draft())
    assert waiting.value.reason == "draft_in_progress" and len(fake.calls_to("createOrder")) == 1
    # Nach der Sperrfrist sucht er über die external_id nach; gibt es nichts, sendet er - genau einmal.
    await db[printful_client.DRAFTS].update_one({"external_id": "lsw-test-0001"}, {"$set": {"claimed_at": stale()}})
    order = await client.create_draft(db, draft())
    assert order.status == "draft" and len(fake.orders) == 1 and len(fake.calls_to("createOrder")) == 2
    claim = await db[printful_client.DRAFTS].find_one({"external_id": "lsw-test-0001"})
    assert claim["state"] == "created" and claim["printful_order_id"] == order.id.value


@pytest.mark.asyncio
async def test_two_parallel_creates_send_only_once(fake, db, pauses):
    """Codex-Befund: beide finden keinen Auftrag und senden beide. Der Claim per eindeutigem Index lässt nur einen."""
    await settle(db)

    async def interleaved(request: httpx.Request) -> httpx.Response:
        # Wie im Netz: jede Anfrage gibt die Kontrolle ab - so laufen Nachsuche und Senden beider ineinander.
        for _ in range(3):
            await asyncio.sleep(0)
        return fake._handle(request)

    client = PrintfulClient(API_KEY, transport=httpx.MockTransport(interleaved))
    results = await asyncio.gather(client.create_draft(db, draft()), client.create_draft(db, draft()),
                                   return_exceptions=True)
    assert len(fake.calls_to("createOrder")) == 1 and len(fake.orders) == 1
    orders = [row for row in results if not isinstance(row, Exception)]
    waits = [row for row in results if isinstance(row, Exception)]
    assert orders, results
    assert all(isinstance(row, FulfillmentTransient) and row.reason == "draft_in_progress" for row in waits), waits


@pytest.mark.asyncio
async def test_a_stale_sending_claim_is_taken_over_only_after_a_search(client, fake, db):
    """Hat Printful den Auftrag damals doch angelegt, kommt dieser zurück - kein zweiter POST."""
    await settle(db)
    await db[printful_client.DRAFTS].insert_one({"external_id": "lsw-test-0001", "state": "sending",
                                                 "claimed_at": stale(), "printful_order_id": None})
    fake._op_createOrder([], {}, printful_client.order_payload(draft()))
    order = await client.create_draft(db, draft())
    assert order.external_id == "lsw-test-0001" and fake.calls_to("createOrder") == []
    claim = await db[printful_client.DRAFTS].find_one({"external_id": "lsw-test-0001"})
    assert claim["state"] == "created" and claim["printful_order_id"] == order.id.value


@pytest.mark.asyncio
async def test_a_fresh_sending_claim_makes_the_second_caller_wait(client, fake, db):
    await settle(db)
    await db[printful_client.DRAFTS].insert_one({"external_id": "lsw-test-0001", "state": "sending",
                                                 "claimed_at": just_now(), "printful_order_id": None})
    with pytest.raises(FulfillmentTransient) as caught:
        await client.create_draft(db, draft())
    assert caught.value.reason == "draft_in_progress" and fake.calls_to("createOrder") == []


@pytest.mark.asyncio
async def test_a_draft_claim_from_the_future_counts_as_stale(client, fake, db):
    """Codex-Befund: ein Stempel in der Zukunft (Clock-Skew) blockierte bis dahin alles."""
    await settle(db)
    await db[printful_client.DRAFTS].insert_one({"external_id": "lsw-test-0001", "state": "sending",
                                                 "claimed_at": far_future(), "printful_order_id": None})
    order = await client.create_draft(db, draft())
    assert order.status == "draft" and len(fake.calls_to("createOrder")) == 1
    assert fake.calls_to("getOrder"), "erst nachsuchen, dann übernehmen"


@pytest.mark.asyncio
async def test_a_created_claim_whose_order_is_gone_is_taken_over(client, fake, db):
    """Codex-Befund: DELETE ging durch, der Claim blieb ``created`` liegen - die external_id war dauerhaft blockiert."""
    await settle(db)
    first = await client.create_draft(db, draft())
    del fake.orders[first.id.value]
    del fake.order_items[first.id.value]
    again = await client.create_draft(db, draft())
    assert again.id != first.id and again.status == "draft"
    assert len(fake.calls_to("createOrder")) == 2
    claim = await db[printful_client.DRAFTS].find_one({"external_id": "lsw-test-0001"})
    assert claim["state"] == "created" and claim["printful_order_id"] == again.id.value


@pytest.mark.asyncio
async def test_an_interrupted_delete_leaves_a_claim_that_is_checked_next_time(client, fake, db, monkeypatch):
    await settle(db)
    order = await client.create_draft(db, draft())
    store = db[printful_client.DRAFTS]
    collection_type = type(store)
    original = collection_type.delete_one

    async def crash(self, *args, **kwargs):
        raise RuntimeError("Abbruch nach dem DELETE (Test)")

    monkeypatch.setattr(collection_type, "delete_one", crash)
    with pytest.raises(RuntimeError):
        await client.delete_draft(db, order.id)
    monkeypatch.setattr(collection_type, "delete_one", original)
    assert fake.orders == {}
    assert (await store.find_one({"external_id": "lsw-test-0001"}))["state"] == "deleting"
    again = await client.create_draft(db, draft())
    assert again.status == "draft" and len(fake.calls_to("createOrder")) == 2


@pytest.mark.asyncio
async def test_a_refused_delete_keeps_the_claim_created(client, fake, db):
    await settle(db)
    order = await client.create_draft(db, draft())
    fake.fail(409, operation="deleteOrder")
    with pytest.raises(FulfillmentInvalid):
        await client.delete_draft(db, order.id)
    claim = await db[printful_client.DRAFTS].find_one({"external_id": "lsw-test-0001"})
    assert claim["state"] == "created" and claim["printful_order_id"] == order.id.value
    assert (await client.create_draft(db, draft())).id == order.id and len(fake.calls_to("createOrder")) == 1


@pytest.mark.asyncio
async def test_a_refused_draft_frees_the_external_id(client, fake, db):
    await settle(db)
    fake.fail(400, operation="createOrder")
    with pytest.raises(FulfillmentInvalid):
        await client.create_draft(db, draft())
    order = await client.create_draft(db, draft())
    assert order.status == "draft" and len(fake.calls_to("createOrder")) == 2


@pytest.mark.asyncio
async def test_invalid_data_blocks_the_order(client, fake, db):
    await settle(db)
    lines = (DraftLine(variant=CatalogVariantId(999999), quantity=1, placements=(FRONT,)),)
    with pytest.raises(FulfillmentInvalid) as caught:
        await client.create_draft(db, draft(lines=lines))
    assert caught.value.status == 400 and caught.value.kind == "invalid"
    assert "999999" in caught.value.provider_detail
    assert fake.orders == {}


@pytest.mark.asyncio
async def test_reading_a_draft_shows_status_items_files_and_costs(client, fake, db):
    await settle(db)
    created = await client.create_draft(db, draft())
    for ref in (created.id, "lsw-test-0001"):
        order = await client.get_order(ref)
        assert order.id == created.id and order.status == "draft"
        assert order.costs.subtotal_cents == 2500 and order.costs.shipping_cents == 495
        assert order.costs.calculation_status == "done"
        [item] = order.items
        assert item.variant_id == SHIRT_M and item.quantity == 2 and item.price_cents == 1250
        assert [(place.placement, place.file_urls) for place in item.placements] == [
            ("front", (FRONT.file_url,)), ("back", (BACK.file_url,))]
    with pytest.raises(ValueError):
        await client.get_order("lsw/../stores")


@pytest.mark.asyncio
async def test_a_draft_can_be_deleted_without_the_switch(client, fake, db):
    await settle(db, stage="admins", switch=False)
    order = await client.create_draft(db, draft())
    await client.delete_draft(db, order.id)
    assert fake.orders == {}
    assert len(fake.calls_to("deleteOrder")) == 1


@pytest.mark.asyncio
async def test_only_drafts_are_deleted(client, fake, db):
    await settle(db)
    order = await client.create_draft(db, draft())
    fake.set_order_status(order.id.value, "pending")
    with pytest.raises(FulfillmentInvalid) as caught:
        await client.delete_draft(db, order.id)
    assert caught.value.reason == "not_draft"
    assert fake.calls_to("deleteOrder") == [] and order.id.value in fake.orders


# ---------------------------------------------------------------- Bestätigen

@pytest.mark.asyncio
async def test_confirming_needs_the_switch(client, fake, db):
    await settle(db, stage="admins", switch=False)
    order = await client.create_draft(db, draft())
    with pytest.raises(shop_config.PrintfulWritesBlocked):
        await client.confirm_order(db, order.id, idempotency_key="test-confirm-0001")
    assert fake.calls_to("confirmOrder") == [] and fake.confirmations == []


@pytest.mark.asyncio
async def test_confirming_happens_once_per_key_and_never_twice_per_order(client, fake, db):
    await settle(db, stage="admins", switch=True)
    order = await client.create_draft(db, draft())
    confirmed = await client.confirm_order(db, order.id, idempotency_key="test-confirm-0001")
    assert confirmed.status == "pending" and fake.confirmations == [order.id.value]
    again = await client.confirm_order(db, order.id, idempotency_key="test-confirm-0001")
    assert again.status == "pending"
    # Auch ein neuer Schlüssel bestätigt nicht noch einmal: der Auftrag ist kein Entwurf mehr.
    await client.confirm_order(db, order.id, idempotency_key="test-confirm-0002")
    assert len(fake.calls_to("confirmOrder")) == 1 and fake.confirmations == [order.id.value]


@pytest.mark.asyncio
async def test_one_key_belongs_to_one_order(client, fake, db):
    await settle(db, switch=True)
    first = await client.create_draft(db, draft("lsw-test-0001"))
    second = await client.create_draft(db, draft("lsw-test-0002"))
    await client.confirm_order(db, first.id, idempotency_key="test-confirm-0001")
    with pytest.raises(FulfillmentInvalid) as caught:
        await client.confirm_order(db, second.id, idempotency_key="test-confirm-0001")
    assert caught.value.reason == "idempotency_conflict"
    assert fake.confirmations == [first.id.value]


async def confirmation_claim(db, order_id: int) -> dict | None:
    return await db[printful_client.CONFIRMATIONS].find_one({"order_id": order_id})


@pytest.mark.parametrize("status", [400, 409, 422])
@pytest.mark.asyncio
async def test_a_clear_refusal_frees_the_claim_and_a_new_try_may_send(client, fake, db, status):
    await settle(db, switch=True)
    order = await client.create_draft(db, draft())
    fake.fail(status, operation="confirmOrder")
    with pytest.raises(FulfillmentInvalid):
        await client.confirm_order(db, order.id, idempotency_key="test-confirm-0001")
    assert await confirmation_claim(db, order.id.value) is None
    confirmed = await client.confirm_order(db, order.id, idempotency_key="test-confirm-0001")
    assert confirmed.status == "pending" and fake.confirmations == [order.id.value]
    assert len(fake.calls_to("confirmOrder")) == 2


@pytest.mark.parametrize("what", ["timeout", "network", 500, 503, 429])
@pytest.mark.asyncio
async def test_an_unclear_confirmation_is_never_sent_again_automatically(client, fake, db, what):
    """Codex-Befund: Printful v2 kennt keinen Idempotenzschlüssel. Nach unklarem Ausgang wird nur nachgelesen."""
    await settle(db, switch=True)
    order = await client.create_draft(db, draft())
    fake.fail(what, operation="confirmOrder", retry_after="1")
    with pytest.raises(FulfillmentTransient):
        await client.confirm_order(db, order.id, idempotency_key="test-confirm-0001")
    assert (await confirmation_claim(db, order.id.value))["state"] == "unclear"
    for key in ("test-confirm-0001", "test-confirm-0002"):
        with pytest.raises(FulfillmentPermanent) as caught:
            await client.confirm_order(db, order.id, idempotency_key=key)
        assert caught.value.reason == "confirm_unclear" and "Printful prüfen" in str(caught.value)
    assert len(fake.calls_to("confirmOrder")) == 1 and fake.confirmations == []


@pytest.mark.asyncio
async def test_an_unclear_confirmation_that_went_through_is_recognised(client, fake, db):
    await settle(db, switch=True)
    order = await client.create_draft(db, draft())
    fake.fail("timeout", operation="confirmOrder")
    with pytest.raises(FulfillmentTransient):
        await client.confirm_order(db, order.id, idempotency_key="test-confirm-0001")
    fake.set_order_status(order.id.value, "pending")   # Printful hatte doch bestätigt
    current = await client.confirm_order(db, order.id, idempotency_key="test-confirm-0001")
    assert current.status == "pending" and len(fake.calls_to("confirmOrder")) == 1
    assert (await confirmation_claim(db, order.id.value))["state"] == "confirmed"


@pytest.mark.asyncio
async def test_sending_again_after_review_needs_the_explicit_parameter(client, fake, db):
    await settle(db, switch=True)
    order = await client.create_draft(db, draft())
    fake.fail(503, operation="confirmOrder")
    with pytest.raises(FulfillmentTransient):
        await client.confirm_order(db, order.id, idempotency_key="test-confirm-0001")
    confirmed = await client.confirm_order(db, order.id, idempotency_key="test-confirm-0001", force_after_review=True)
    assert confirmed.status == "pending" and fake.confirmations == [order.id.value]
    assert len(fake.calls_to("confirmOrder")) == 2
    assert (await confirmation_claim(db, order.id.value))["state"] == "confirmed"


@pytest.mark.asyncio
async def test_force_after_review_is_taken_by_exactly_one_caller(client, fake, db, monkeypatch):
    await settle(db, switch=True)
    order = await client.create_draft(db, draft())
    await db[printful_client.CONFIRMATIONS].insert_one({"idempotency_key": "test-confirm-0001", "order_id": order.id.value,
                                                        "state": "unclear", "claimed_at": stale()})
    store = db[printful_client.CONFIRMATIONS]
    collection_type = type(store)
    original = collection_type.update_one
    raced = {"done": False}

    async def someone_else_first(self, query, change, **kwargs):
        if not raced["done"] and query.get("state") == "unclear":
            raced["done"] = True
            await original(self, {"order_id": order.id.value}, {"$set": {"state": "sending"}})
        return await original(self, query, change, **kwargs)

    monkeypatch.setattr(collection_type, "update_one", someone_else_first)
    with pytest.raises(FulfillmentTransient) as caught:
        await client.confirm_order(db, order.id, idempotency_key="test-confirm-0001", force_after_review=True)
    assert caught.value.reason == "confirm_in_progress" and fake.calls_to("confirmOrder") == []


@pytest.mark.asyncio
async def test_a_failed_read_before_sending_leaves_no_claim(client, fake, db, pauses):
    await settle(db, switch=True)
    order = await client.create_draft(db, draft())
    fake.fail(500, operation="getOrder", times=3)
    with pytest.raises(FulfillmentTransient):
        await client.confirm_order(db, order.id, idempotency_key="test-confirm-0001")
    assert await confirmation_claim(db, order.id.value) is None and fake.calls_to("confirmOrder") == []
    confirmed = await client.confirm_order(db, order.id, idempotency_key="test-confirm-0001")
    assert confirmed.status == "pending"


@pytest.mark.asyncio
async def test_a_running_confirmation_makes_the_second_caller_wait(client, fake, db):
    await settle(db, switch=True)
    order = await client.create_draft(db, draft())
    await db[printful_client.CONFIRMATIONS].insert_one({"idempotency_key": "test-confirm-0001", "order_id": order.id.value,
                                                        "state": "sending", "claimed_at": just_now()})
    with pytest.raises(FulfillmentTransient) as caught:
        await client.confirm_order(db, order.id, idempotency_key="test-confirm-0001")
    assert caught.value.reason == "confirm_in_progress" and fake.calls_to("confirmOrder") == []


@pytest.mark.asyncio
async def test_a_confirmation_claim_from_the_future_is_unclear_and_not_sent(client, fake, db):
    await settle(db, switch=True)
    order = await client.create_draft(db, draft())
    await db[printful_client.CONFIRMATIONS].insert_one({"idempotency_key": "test-confirm-0001", "order_id": order.id.value,
                                                        "state": "sending", "claimed_at": far_future()})
    with pytest.raises(FulfillmentPermanent) as caught:
        await client.confirm_order(db, order.id, idempotency_key="test-confirm-0001")
    assert caught.value.reason == "confirm_unclear" and fake.calls_to("confirmOrder") == []
    assert (await confirmation_claim(db, order.id.value))["state"] == "unclear"


@pytest.mark.asyncio
async def test_a_stale_sending_claim_on_a_draft_is_unclear_and_not_sent(client, fake, db):
    """Ein Aufruf, der mitten im Senden abgebrochen ist: Ausgang offen - nachlesen, nicht noch einmal senden."""
    await settle(db, switch=True)
    order = await client.create_draft(db, draft())
    await db[printful_client.CONFIRMATIONS].insert_one({"idempotency_key": "test-confirm-0001", "order_id": order.id.value,
                                                        "state": "sending", "claimed_at": stale()})
    with pytest.raises(FulfillmentPermanent) as caught:
        await client.confirm_order(db, order.id, idempotency_key="test-confirm-0001")
    assert caught.value.reason == "confirm_unclear" and fake.calls_to("confirmOrder") == []
    assert (await confirmation_claim(db, order.id.value))["state"] == "unclear"


def test_a_store_number_must_be_a_real_number():
    for bad in (0, -3, "17", True):
        with pytest.raises(ValueError):
            PrintfulClient(API_KEY, store_id=bad)
    for bad in ("", "   ", None):
        with pytest.raises(FulfillmentPermanent):
            PrintfulClient(bad)


@pytest.mark.asyncio
async def test_confirming_rejects_a_sloppy_key(client, fake, db):
    await settle(db, switch=True)
    for bad in ("", "kurz", "mit leerzeichen 123", "x" * 200):
        with pytest.raises(ValueError):
            await client.confirm_order(db, PrintfulOrderId(1), idempotency_key=bad)
    assert fake.calls == []


# ---------------------------------------------------------------- Dateien und Mockups

@pytest.mark.asyncio
async def test_a_print_file_is_added_and_checked(client, fake, db):
    await settle(db)
    added = await client.add_file(db, FRONT.file_url, filename="loewe-v3.png")
    assert added.status == "ok" and added.dpi == 300 and added.width == 4500
    again = await client.get_file(added.id)
    assert again.id == added.id and again.url == FRONT.file_url
    fake.broken_file_urls.add(BACK.file_url)
    broken = await client.add_file(db, BACK.file_url)
    assert broken.status == "failed"
    with pytest.raises(ValueError):
        await client.add_file(db, "http://lsw.example.test/x.png")


@pytest.mark.asyncio
async def test_adding_a_file_follows_the_draft_rule(client, fake, db):
    await settle(db, stage="off")
    with pytest.raises(shop_config.PrintfulDraftsBlocked):
        await client.add_file(db, FRONT.file_url)
    assert fake.calls == []


@pytest.mark.asyncio
async def test_a_mockup_is_requested_and_fetched(client, fake):
    fake.mockup_polls = 2
    task = await client.create_mockup_task(PRODUCT, (SHIRT_M, SHIRT_L), (FRONT,))
    assert task.status == "pending" and task.mockups == ()
    first = await client.get_mockup_task(task.id)
    assert first.status == "pending"
    done = await client.get_mockup_task(task.id)
    assert done.status == "completed"
    assert {(image.variant_id, image.placement) for image in done.mockups} == {(SHIRT_M, "front"), (SHIRT_L, "front")}
    assert all(image.url.startswith("https://") for image in done.mockups)
    sent = fake.calls_to("createMockupGeneratorTasks")[0]["body"]["products"][0]
    assert sent["catalog_product_id"] == 71 and sent["catalog_variant_ids"] == [4012, 4013]


# ---------------------------------------------------------------- Webhook-Signatur

def test_the_webhook_signature_is_checked_over_the_raw_body():
    body = b'{"type":"package_shipped","occurred_at":"2026-10-27T10:00:00Z","retries":0,"store_id":17,"data":{}}'
    good = FakePrintful.sign(body)
    assert verify_webhook_signature(body, good, WEBHOOK_SECRET_HEX) is True
    assert verify_webhook_signature(body, good.upper(), WEBHOOK_SECRET_HEX) is True
    assert verify_webhook_signature(body + b" ", good, WEBHOOK_SECRET_HEX) is False
    assert verify_webhook_signature(body, good, "00" * 30) is False
    assert verify_webhook_signature(body, None, WEBHOOK_SECRET_HEX) is False
    assert verify_webhook_signature(body, "", WEBHOOK_SECRET_HEX) is False
    assert verify_webhook_signature(body, good, "kein-hex") is False
    assert verify_webhook_signature(body, good, "") is False
    # Den Kopf bestimmt der Absender: auch Unsinn darin ist nur „passt nicht“, nie eine Ausnahme.
    assert verify_webhook_signature(body, "ä" * 64, WEBHOOK_SECRET_HEX) is False
    assert verify_webhook_signature(body, good[:10], WEBHOOK_SECRET_HEX) is False
    with pytest.raises(TypeError):
        verify_webhook_signature(body.decode(), good, WEBHOOK_SECRET_HEX)


# ---------------------------------------------------------------- Fehlerklassen und Wiederholen

@pytest.mark.asyncio
async def test_reads_are_repeated_after_timeout_and_server_errors(client, fake, pauses):
    fake.fail("timeout", operation="getProductById")
    fake.fail(502, operation="getProductById")
    product = await client.catalog_product(PRODUCT)
    assert product.id == PRODUCT
    assert len(fake.calls_to("getProductById")) == 3
    assert pauses == list(printful_client.RETRY_PAUSES)


@pytest.mark.asyncio
async def test_a_read_respects_retry_after(client, fake, pauses):
    fake.fail(429, operation="getProductById", retry_after="3")
    await client.catalog_product(PRODUCT)
    assert pauses == [3.0]


@pytest.mark.asyncio
async def test_a_long_retry_after_is_handed_back_instead_of_waited(client, fake, pauses):
    fake.fail(429, operation="getProductById", retry_after="120")
    with pytest.raises(FulfillmentTransient) as caught:
        await client.catalog_product(PRODUCT)
    assert caught.value.reason == "rate_limited" and caught.value.retry_after == 120.0
    assert pauses == [] and len(fake.calls_to("getProductById")) == 1


@pytest.mark.asyncio
async def test_a_write_hit_by_the_rate_limit_is_not_repeated(client, fake, db, pauses):
    await settle(db)
    fake.fail(429, operation="createOrder", retry_after="2")
    with pytest.raises(FulfillmentTransient) as caught:
        await client.create_draft(db, draft())
    assert caught.value.retry_after == 2.0
    assert len(fake.calls_to("createOrder")) == 1 and pauses == []


@pytest.mark.asyncio
async def test_reads_give_up_after_three_tries(client, fake, pauses):
    fake.fail(500, operation="getProductById", times=5)
    with pytest.raises(FulfillmentTransient) as caught:
        await client.catalog_product(PRODUCT)
    assert caught.value.status == 500 and len(fake.calls_to("getProductById")) == 3


@pytest.mark.parametrize("status, cls, reason", [
    (401, FulfillmentPermanent, "unauthorized"),
    (403, FulfillmentPermanent, "forbidden"),
    (404, FulfillmentPermanent, "not_found"),
    (400, FulfillmentInvalid, "bad_request"),
    (422, FulfillmentInvalid, "bad_request"),
])
@pytest.mark.asyncio
async def test_status_codes_map_to_the_three_error_classes(client, fake, pauses, status, cls, reason):
    fake.fail(status, operation="getProductById")
    with pytest.raises(cls) as caught:
        await client.catalog_product(PRODUCT)
    assert caught.value.reason == reason and caught.value.status == status
    assert len(fake.calls_to("getProductById")) == 1 and pauses == []
    assert isinstance(caught.value, FulfillmentError)
    assert {FulfillmentPermanent: "permanent", FulfillmentInvalid: "invalid"}[cls] == caught.value.kind


@pytest.mark.asyncio
async def test_the_key_never_shows_up_in_errors_or_logs(caplog, pauses):
    """Auch wenn Printful den Schlüssel in einer Fehlermeldung zurückspielt."""
    caplog.set_level(logging.DEBUG)

    def echo(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"code": 400, "result": f"bad token {API_KEY} for paula@example.test",
                                         "error": {"reason": "x", "message": f"Bearer {API_KEY}"}})

    client = PrintfulClient(API_KEY, transport=httpx.MockTransport(echo))
    with pytest.raises(FulfillmentInvalid) as caught:
        await client.catalog_product(PRODUCT)
    error = caught.value
    for text in (str(error), repr(error), error.provider_detail, caplog.text):
        assert API_KEY not in text
    assert "paula@" not in error.provider_detail
    assert "[printful]" in caplog.text


@pytest.mark.asyncio
async def test_a_client_without_a_stored_key_refuses_to_start(db):
    await settle(db, key=False)
    with pytest.raises(FulfillmentPermanent) as caught:
        await PrintfulClient.from_db(db)
    assert caught.value.reason == "no_key"
    await settle(db, key=True)
    assert isinstance(await PrintfulClient.from_db(db), PrintfulClient)


# ---------------------------------------------------------------- Verbindungstest

@pytest.mark.asyncio
async def test_the_connection_test_reads_the_stores_once(client, fake):
    result = await client.check_connection()
    assert result == {"ok": True, "detail": "Verbindung steht: 1 Store sichtbar."}
    assert [call["path"] for call in fake.calls] == ["/v2/stores"]


@pytest.mark.parametrize("what, words", [(401, "abgelehnt"), ("timeout", "Zeitüberschreitung"),
                                         ("network", "nicht erreichbar"), (503, "503")])
@pytest.mark.asyncio
async def test_the_connection_test_names_the_cause_and_never_raises(client, fake, what, words):
    fake.fail(what, operation="getStores")
    result = await client.check_connection()
    assert result["ok"] is False and words in result["detail"]
    assert len(fake.calls) == 1


# ---------------------------------------------------------------- Vertrag

def test_the_fake_refuses_paths_outside_the_contract(fake):
    with pytest.raises(ContractViolation):
        fake._handle(httpx.Request("GET", "https://api.printful.com/v2/orders/1/shipments",
                                   headers={"Authorization": f"Bearer {API_KEY}"}))
    with pytest.raises(ContractViolation):
        fake._handle(httpx.Request("POST", "https://api.printful.com/orders?confirm=true",
                                   headers={"Authorization": f"Bearer {API_KEY}"}, json={}))
