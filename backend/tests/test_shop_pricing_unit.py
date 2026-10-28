"""Bruttopreise aus der Kostenschätzung von Printful (#2135): Kasse mit Schätzung, Einfrieren, Toleranz beim Auslösen,
Rechnungspositionen, Schätzung je Variante und der Rückfall ohne Printful.

Printful ist der Vertrags-Fake (``tests/printful_fake.py``) über den echten Adapter - kein echter Aufruf, nie
Produktion. Der Fake rechnet wie Printful in Österreich: Ware 9,75 € je Stück (ohne Aufpreis für die Rückseite - genau
die Abweichung aus #2135), Versand 4,95 € je Bestellung, 20 % Steuer auf Ware und Versand. Erfundene Testdaten."""
import pathlib
import sys
from decimal import Decimal

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from services import shop_catalog, shop_catalog_sync, shop_config, shop_orders, shop_pricing, shop_products  # noqa: E402
from services.shop_common import ShopError  # noqa: E402
from services.shop_fulfillment import Costs  # noqa: E402
from shop_testdata import publish_unchecked  # noqa: E402
from test_shop_products_unit import (  # noqa: E402,F401 - Fixtures und Helfer der Produktverwaltung
    BILLING, BLACK_L, BLACK_M, BY, SHIPPING, WHITE_M, configured, db, design_dir, fake, provider, variant_for)

NAME = "Testlöwe"


@pytest.fixture(autouse=True)
def public_base(monkeypatch):
    """Printful holt Druckdateien nur über https - die erfundene Adresse der Website."""
    monkeypatch.setenv("PUBLIC_BACKEND_URL", "https://lsw.example.test")
    for name in ("PUBLIC_BASE_URL", "FRONTEND_URL"):
        monkeypatch.delenv(name, raising=False)


def costs(subtotal, shipping, total, *, tax=None, vat=None, discount=None, currency="EUR") -> Costs:
    return Costs(currency=currency, calculation_status="done", subtotal_cents=subtotal, discount_cents=discount,
                 shipping_cents=shipping, tax_cents=tax, vat_cents=vat, total_cents=total)


async def ready_product(db, provider):
    product = await configured(db, provider)
    await publish_unchecked(db, product["id"])
    return product


async def order(db, provider, lines, *, key="bestellung-2135", buyer_kind="member", estimate=None, use_provider=True):
    return await shop_orders.place_order(
        db, user_id="konto-1", idempotency_key=key, buyer_kind=buyer_kind, lines=lines,
        shipping_estimate_cents=estimate, billing_address=dict(BILLING), shipping_address=dict(SHIPPING),
        actor_id="konto-1", provider=provider if use_provider else None)


# ---------------------------------------------------------------- Rechnen

def test_the_example_from_the_issue_splits_into_goods_shipping_and_tax_that_add_up():
    # Testentwurf aus #2135: Ware 12,90 €, Versand 4,49 €, Steuer 3,48 €, gesamt 20,87 €.
    parts = shop_pricing.split(costs(1290, 449, 2087, tax=348))
    assert parts == {"goods_cents": 1290, "shipping_cents": 449, "fees_cents": 0, "tax_cents": 348,
                     "total_cents": 2087}
    shares = shop_pricing.breakdown(parts, [1])
    # Die Steuer verteilt sich auf Ware und Versand - zusammen genau der Gesamtbetrag.
    assert shares["lines"] == [{"net_cents": 1290, "tax_cents": 258, "gross_cents": 1548}]
    assert shares["shipping"] == {"net_cents": 449, "tax_cents": 90, "gross_cents": 539}
    assert shares["goods_gross_cents"] + shares["shipping"]["gross_cents"] + shares["fees"]["gross_cents"] == 2087


def test_vat_discount_and_extra_fees_are_kept_and_nothing_gets_lost():
    parts = shop_pricing.split(costs(2000, 500, 3170, vat=500, discount=100, tax=0))
    # Ware nach Rabatt 19,00 €; was Printful im Gesamt mehr rechnet, sind Zusatzkosten (etwa Digitalisierung).
    assert parts == {"goods_cents": 1900, "shipping_cents": 500, "fees_cents": 270, "tax_cents": 500,
                     "total_cents": 3170}
    shares = shop_pricing.breakdown(parts, [3, 1, 1])
    assert sum(line["gross_cents"] for line in shares["lines"]) + shares["shipping"]["gross_cents"] \
        + shares["fees"]["gross_cents"] == 3170
    assert sum(line["net_cents"] for line in shares["lines"]) == 1900


@pytest.mark.parametrize("bad", [costs(1000, 400, 1400, currency="USD"), costs(1000, 400, 1300),
                                 costs(None, 400, 1400), costs(0, 400, 400), costs(1000, -1, 1400)])
def test_an_estimate_that_does_not_add_up_is_never_used(bad):
    with pytest.raises(shop_pricing.EstimateUnusable):
        shop_pricing.split(bad)


@pytest.mark.parametrize("amount,weights", [(100, [1, 1, 1]), (1, [5, 5]), (999, [0, 0]), (348, [1290, 449, 0]),
                                            (7, [3, 0, 4])])
def test_allocation_always_adds_up_exactly(amount, weights):
    shares = shop_pricing.allocate(amount, weights)
    assert sum(shares) == amount and len(shares) == len(weights) and min(shares) >= 0


def test_the_check_warns_only_on_a_strong_deviation():
    assert shop_pricing.strong_deviation(1500, 975) is True  # Rückseite doppelt im Katalog (#2135)
    assert shop_pricing.strong_deviation(1300, 1290) is False  # ein paar Cent sind keine Warnung
    assert shop_pricing.strong_deviation(10500, 10000) is False  # 5 € auf 100 € sind unter 10 %
    assert shop_pricing.strong_deviation(None, 975) is False


# ---------------------------------------------------------------- Kasse: Schätzung für den ganzen Warenkorb

@pytest.mark.asyncio
async def test_members_pay_the_printful_gross_amount_frozen_with_every_part(db, provider, fake):
    product = await ready_product(db, provider)
    white = await variant_for(db, product["id"], WHITE_M)
    black = await variant_for(db, product["id"], BLACK_L)
    placed, created = await order(db, provider, [{"variant_id": white["id"], "quantity": 2, "gamertag": NAME},
                                                 {"variant_id": black["id"], "quantity": 1, "gamertag": NAME}])
    assert created is True
    (call,) = fake.calls_to("createOrderEstimationTask")
    # Ein Auftrag für den ganzen Warenkorb, nur Land und PLZ - nie Name oder Straße.
    assert call["body"]["recipient"] == {"country_code": "AT", "zip": "8010"}
    assert [(item["catalog_variant_id"], item["quantity"]) for item in call["body"]["order_items"]] == [
        (WHITE_M, 2), (BLACK_L, 1)]
    frozen = placed["frozen"]
    # Ware 3 × 9,75 €, Versand einmal 4,95 € (die Artikel teilen ihn), 20 % Steuer: gesamt 41,04 €.
    assert frozen["price_source"] == "printful_estimate" and frozen["total_cents"] == 4104
    assert {key: frozen["printful_costs"][key] for key in ("goods_cents", "shipping_cents", "fees_cents", "tax_cents",
                                                           "total_cents")} == {
        "goods_cents": 2925, "shipping_cents": 495, "fees_cents": 0, "tax_cents": 684, "total_cents": 4104}
    assert frozen["printful_costs"]["estimated_at"] and frozen["printful_costs"]["country"] == "AT"
    assert (frozen["items_cents"], frozen["shipping_cents"], frozen["fees_cents"], frozen["markup_cents"]) == (
        3510, 594, 0, 0)
    assert frozen["shipping_source"] == "estimate"
    items = await shop_orders.items_for(db, placed["id"])
    assert [item["gross"] for item in items] == [{"net_cents": 1950, "tax_cents": 390, "gross_cents": 2340},
                                                 {"net_cents": 975, "tax_cents": 195, "gross_cents": 1170}]
    assert [(item["unit_price_cents"], item["line_total_cents"]) for item in items] == [(1170, 2340), (1170, 1170)]
    events = await shop_orders.events_for(db, placed["id"])
    assert [event["kind"] for event in events] == ["order.placed"] and events[0]["data"]["total_cents"] == 4104


@pytest.mark.asyncio
async def test_the_same_order_again_asks_printful_nothing_and_old_keys_stay_valid(db, provider, fake):
    product = await ready_product(db, provider)
    white = await variant_for(db, product["id"], WHITE_M)
    lines = [{"variant_id": white["id"], "quantity": 1, "gamertag": NAME}]
    first, _ = await order(db, provider, lines)
    fake.calls.clear()
    again, created = await order(db, provider, lines)
    assert created is False and again["id"] == first["id"] and again["frozen"] == first["frozen"]
    assert fake.calls_to("createOrderEstimationTask") == [], "Idempotenz vor der Schätzung"
    # Der Bestellschlüssel kennt die Schätzung nicht: derselbe Aufruf ohne Anbieter ist dieselbe Bestellung.
    same, created = await order(db, provider, lines, use_provider=False)
    assert created is False and same["id"] == first["id"]
    assert await db.shop_orders.count_documents({}) == 1 and await db.shop_order_items.count_documents({}) == 1


@pytest.mark.asyncio
async def test_public_buyers_pay_the_gross_amount_plus_the_markup(db, provider, fake):
    from test_shop_products_unit import BACK, LION, PRINTFUL_PRODUCT, club_designs, new_product

    await db.settings.update_one({"id": "shop"}, {"$set": {"id": "shop", "public_markup_cents": 300}}, upsert=True)
    # Öffentlich gibt es keine Personalisierung: Löwe vorne, Rückenlogo, kein Gamertag.
    product = await new_product(db, personalization="none", visibility="public")
    await shop_products.load_printful_product(db, product["id"], PRINTFUL_PRODUCT, provider=provider, **BY)
    await shop_products.set_offer(db, product["id"], technique="dtg", colors=["Black", "White"], sizes=["M", "L"],
                                  provider=provider, **BY)
    await club_designs(db)
    await shop_products.set_layout(db, product["id"], [{"key": "front", "layers": [LION]},
                                                       {"key": "back", "layers": [BACK]}],
                                   included_placement="front", **BY)
    await shop_products.generate_print_files(db, product["id"], **BY)
    await shop_products.accept_prices(db, product["id"], **BY)
    await publish_unchecked(db, product["id"])
    white = await variant_for(db, product["id"], WHITE_M)
    placed, _ = await order(db, provider, [{"variant_id": white["id"], "quantity": 2, "gamertag": None}],
                            buyer_kind="public")
    frozen = placed["frozen"]
    # 2 × 9,75 € + 4,95 € + 20 % = 29,34 €; dazu 2 × 3,00 € Aufschlag.
    assert frozen["printful_costs"]["total_cents"] == 2934
    assert frozen["markup_cents"] == 600 and frozen["total_cents"] == 3534
    (item,) = await shop_orders.items_for(db, placed["id"])
    assert item["line_total_cents"] == item["gross"]["gross_cents"] + 600


@pytest.mark.asyncio
async def test_without_printful_the_order_falls_back_to_the_accepted_price_and_shipping(db, provider, fake):
    product = await ready_product(db, provider)
    white = await variant_for(db, product["id"], WHITE_M)
    lines = [{"variant_id": white["id"], "quantity": 1, "gamertag": NAME}]
    # Printful antwortet nicht: bestellt wird trotzdem - mit dem übernommenen Preis und der Versandschätzung.
    fake.fail(500, operation="createOrderEstimationTask", times=5)
    down, _ = await order(db, provider, lines, key="bestellung-2135-a", estimate=490)
    assert down["frozen"]["price_source"] == "fallback" and down["frozen"]["printful_costs"] is None
    assert down["frozen"]["total_cents"] == white["price_cents"] + 490
    (item,) = await shop_orders.items_for(db, down["id"])
    assert item["unit_price_cents"] == white["price_cents"] and "gross" not in item
    # Ohne Anbieter wie bisher; ohne Schätzung und ohne Pauschale wird nicht bestellt.
    fake.calls.clear()
    plain, _ = await order(db, provider, lines, key="bestellung-2135-b", estimate=490, use_provider=False)
    assert plain["frozen"]["price_source"] == "fallback" and fake.calls_to("createOrderEstimationTask") == []
    with pytest.raises(ShopError, match="Versand"):
        await order(db, provider, lines, key="bestellung-2135-c", estimate=None, use_provider=False)
    # Mit Anbieter, aber ohne https-Adresse der Druckdateien: Rückfall, und nichts bleibt liegen, wenn auch der
    # Versand fehlt.
    with pytest.MonkeyPatch.context() as patch:
        patch.setenv("PUBLIC_BACKEND_URL", "http://lsw.example.test")
        with pytest.raises(ShopError, match="Versand"):
            await order(db, provider, lines, key="bestellung-2135-d", estimate=None)
    assert await db.shop_orders.count_documents({}) == 2
    assert await db.shop_order_items.count_documents({}) == 2


# ---------------------------------------------------------------- Schätzung je Variante (Abgleich, Schritt 4)

@pytest.mark.asyncio
async def test_the_sync_estimates_each_price_group_once_and_step_4_shows_gross_member_price_and_shipping(
        db, provider, fake):
    product = await configured(db, provider, accept=False)
    fake.calls.clear()
    await shop_catalog_sync.sync_product(db, product["id"], provider=provider, **BY)
    # Vier Varianten mit gleichem Einkauf: eine Schätzung reicht (ein Stück nach Österreich).
    (call,) = fake.calls_to("createOrderEstimationTask")
    assert call["body"]["recipient"] == {"country_code": "AT", "zip": "1010"}
    view = await shop_products.admin_view(db, product["id"])
    row = next(row for row in view["variants"] if row["printful_variant_id"] == BLACK_M)
    # Ware 9,75 € + 20 % = 11,70 € brutto; Versand nach AT 4,95 € + 20 % = 5,94 €.
    assert (row["printful_gross_cents"], row["member_price_cents"], row["shipping_example_cents"]) == (1170, 1170, 594)
    assert row["price_source"] == "estimate" and row["estimated_at"]
    # Katalog netto 15,00 € (Rückseite als Aufpreis) gegen Printful netto 9,75 €: stark daneben - „prüfen“.
    assert row["cost_cents"] == 1500 and row["catalog_check"] is True
    assert row["suggested_public_cents"] == 1170
    assert view["pricing"]["note"] == "zzgl. Versand, genauer Betrag an der Kasse"
    # „Preise übernehmen“ nimmt Printful brutto; die Prüfung ist danach grün.
    await shop_products.accept_prices(db, product["id"], **BY)
    view = await shop_products.admin_view(db, product["id"])
    assert {row["price_cents"] for row in view["variants"] if row["active"]} == {1170}
    prices = next(item for item in view["check"]["items"] if item["key"] == "prices")
    assert prices["ok"] is True and "Printful brutto" in prices["detail"]


@pytest.mark.asyncio
async def test_a_stale_estimate_never_falls_back_to_net_silently_and_blocks_accepting(db, provider, fake):
    product = await configured(db, provider, accept=False)
    await shop_catalog_sync.sync_product(db, product["id"], provider=provider, **BY)
    await shop_products.accept_prices(db, product["id"], **BY)
    # Printful wird teurer, die Schätzung scheitert diesmal: die alte passt nicht mehr zum Einkauf.
    fake.prices[BLACK_M] = Decimal("10.25")
    fake.fail(500, operation="createOrderEstimationTask", times=20)
    result = await shop_catalog_sync.sync_product(db, product["id"], provider=provider, **BY)
    assert result["ok"] is True
    view = await shop_products.admin_view(db, product["id"])
    row = next(row for row in view["variants"] if row["printful_variant_id"] == BLACK_M)
    # Brutto war bekannt: kein Netto-Vorschlag, sondern „neu schätzen“ (#2135, Review B2).
    assert row["estimate_stale"] is True and row["price_source"] == "stale" and row["member_price_cents"] is None
    assert row["printful_gross_cents"] is None and row["price_warning"]["after_cents"] is None
    assert row["price_warning"]["before_cents"] == 1170 and row["price_warning"]["stale"] is True
    medium = await variant_for(db, product["id"], BLACK_M)
    assert medium["blocked_reason"] is None, "veraltete Schätzung sperrt nicht - Katalogpreis ist da"
    prices = next(item for item in view["check"]["items"] if item["key"] == "prices")
    assert prices["ok"] is False
    # Übernehmen geht erst nach einer neuen Schätzung - nie gemischt brutto und netto.
    with pytest.raises(ShopError, match="erst „Brutto bei Printful schätzen“"):
        await shop_products.accept_prices(db, product["id"], **BY)
    assert (await variant_for(db, product["id"], BLACK_M))["price_cents"] == 1170
    shown = shop_pricing.display_price(await shop_config.load(db), product, medium,
                                       await shop_catalog.printful_variant_for(db, medium["id"]))
    assert shown == {**shown, "price_cents": 1170, "basis": "brutto", "stale": True, "source": "accepted"}
    fake.faults.clear()
    await shop_pricing.refresh_estimates(db, product["id"], provider=provider, actor_id="finanzen-test")
    await shop_products.accept_prices(db, product["id"], **BY)
    medium = await variant_for(db, product["id"], BLACK_M)
    assert medium["price_cents"] == 1230 and medium["price_source"] == "estimate"  # 10,25 € + 20 %


@pytest.mark.asyncio
async def test_without_any_estimate_the_catalog_net_is_shown_as_net_never_as_gross(db, provider, fake):
    product = await configured(db, provider)  # nie geschätzt: Katalog netto übernommen
    medium = await variant_for(db, product["id"], BLACK_M)
    assert medium["price_source"] == "catalog"
    shown = shop_pricing.display_price(await shop_config.load(db), product, medium,
                                       await shop_catalog.printful_variant_for(db, medium["id"]))
    assert shown["basis"] == "netto" and shown["stale"] is False and "ohne Steuer" in shown["note"]


@pytest.mark.asyncio
async def test_accepting_refuses_a_mix_of_estimated_and_unestimated_variants(db, provider, fake):
    product = await configured(db, provider, accept=False)
    await shop_pricing.refresh_estimates(db, product["id"], provider=provider, actor_id="finanzen-test")
    # Eine Variante verliert ihre Schätzung (etwa neu angeboten): nicht still mit Netto auffüllen.
    medium = await variant_for(db, product["id"], WHITE_M)
    await db.shop_printful_variants.update_one({"variant_id": medium["id"]}, {"$unset": {"gross_estimate": ""}})
    with pytest.raises(ShopError, match="Weiß / M"):
        await shop_products.accept_prices(db, product["id"], **BY)
    assert all(variant.get("price_cents") is None for variant in await shop_catalog.variants_of(db, product["id"]))


@pytest.mark.asyncio
async def test_estimating_in_step_4_changes_no_price_and_needs_print_files(db, provider, fake):
    product = await configured(db, provider, accept=False, generate=False)
    result = await shop_pricing.refresh_estimates(db, product["id"], provider=provider, actor_id="finanzen-test")
    assert result["estimated"] == 0 and "Druckdateien" in result["detail"]
    await shop_products.generate_print_files(db, product["id"], **BY)
    result = await shop_pricing.refresh_estimates(db, product["id"], provider=provider, actor_id="finanzen-test")
    assert result == {**result, "estimated": 4, "offered": 4}
    assert all(variant.get("price_cents") is None for variant in await shop_catalog.variants_of(db, product["id"]))
    medium = await variant_for(db, product["id"], BLACK_M)
    mapping = await shop_catalog.printful_variant_for(db, medium["id"])
    config = await shop_config.load(db)
    shown = shop_pricing.display_price(config, product, medium, mapping)
    assert shown == {**shown, "price_cents": 1170, "source": "estimate", "shipping_example_cents": 594,
                     "note": "zzgl. Versand, genauer Betrag an der Kasse"}


# ---------------------------------------------------------------- Vor dem Auslösen: Toleranz

async def placed_order(db, provider, key="bestellung-2135-r"):
    product = await ready_product(db, provider)
    white = await variant_for(db, product["id"], WHITE_M)
    placed, _ = await order(db, provider, [{"variant_id": white["id"], "quantity": 1, "gamertag": NAME}], key=key)
    assert placed["frozen"]["printful_costs"]["total_cents"] == 1764
    return placed


@pytest.mark.asyncio
async def test_an_unchanged_or_cheaper_price_is_released_and_the_difference_stays_with_the_club(db, provider, fake):
    placed = await placed_order(db, provider)
    same = await shop_orders.recheck_before_release(db, placed["id"], provider=provider, actor_id="system:test")
    assert same["decision"] == "release" and same["difference_cents"] == 0
    fake.shipping = Decimal("4.45")  # Printful wird günstiger: 0,50 € Versand plus Steuer weniger
    cheaper = await shop_orders.recheck_before_release(db, placed["id"], provider=provider, actor_id="system:test")
    assert cheaper["decision"] == "release" and cheaper["difference_cents"] == -60
    assert cheaper["club_keeps_cents"] == 60 and cheaper["club_bears_cents"] == 0
    stored = await shop_orders.get_order(db, placed["id"])
    assert stored["status"] == "placed" and stored["frozen"] == placed["frozen"], "eingefroren bleibt eingefroren"
    assert stored["price_check"]["decision"] == "release"
    kinds = [event["kind"] for event in await shop_orders.events_for(db, placed["id"])]
    assert kinds.count("order.price_checked") == 2


@pytest.mark.asyncio
async def test_a_price_rise_within_the_tolerance_is_released_above_it_the_order_waits_for_the_board(
        db, provider, fake):
    placed = await placed_order(db, provider)
    fake.shipping = Decimal("5.25")  # +0,30 € Versand, mit Steuer +0,36 € - unter 0,50 €
    within = await shop_orders.recheck_before_release(db, placed["id"], provider=provider, actor_id="system:test")
    assert within["decision"] == "release" and within["difference_cents"] == 36 and within["club_bears_cents"] == 36
    fake.shipping = Decimal("5.45")  # +0,50 € Versand, mit Steuer +0,60 € - über 0,50 €
    held = await shop_orders.recheck_before_release(db, placed["id"], provider=provider, actor_id="system:test")
    assert held["decision"] == "hold" and held["difference_cents"] == 60 and held["tolerance_cents"] == 50
    stored = await shop_orders.get_order(db, placed["id"])
    assert stored["status"] == "price_changed" and shop_orders.STATUS_LABELS["price_changed"] == "Preis geändert"
    assert stored["frozen"] == placed["frozen"]
    changed = [event for event in await shop_orders.events_for(db, placed["id"])
               if event["kind"] == "order.price_changed"]
    assert len(changed) == 1 and changed[0]["data"] == {"frozen_cents": 1764, "estimate_cents": 1824,
                                                        "difference_cents": 60, "tolerance_cents": 50}
    # Wartet sie schon auf die Leitung, fragt eine weitere Prüfung Printful nicht noch einmal.
    fake.calls.clear()
    again = await shop_orders.recheck_before_release(db, placed["id"], provider=provider, actor_id="system:test")
    assert again["decision"] == "hold" and fake.calls_to("createOrderEstimationTask") == []


@pytest.mark.asyncio
async def test_the_tolerance_is_a_setting_and_printful_being_down_changes_nothing(db, provider, fake):
    placed = await placed_order(db, provider)
    config, changed = await shop_config.update(db, {"price_tolerance_cents": 0}, actor={"id": "finanzen-test"},
                                               is_superadmin=False, reason="Jede Verteuerung prüfen")
    assert changed == ["price_tolerance_cents"] and config["price_tolerance_cents"] == 0
    fake.fail("timeout", operation="createOrderEstimationTask", times=1)
    down = await shop_orders.recheck_before_release(db, placed["id"], provider=provider, actor_id="system:test")
    assert down["decision"] == "retry"
    assert (await shop_orders.get_order(db, placed["id"]))["status"] == "placed"
    fake.shipping = Decimal("4.96")
    held = await shop_orders.recheck_before_release(db, placed["id"], provider=provider, actor_id="system:test")
    assert held["decision"] == "hold" and held["difference_cents"] == 1


def test_the_tolerance_defaults_to_fifty_cents_and_refuses_nonsense():
    assert shop_config.normalized({})["price_tolerance_cents"] == 50
    assert shop_config.normalized({"price_tolerance_cents": -5})["price_tolerance_cents"] == 50
    assert shop_config.normalized({"price_tolerance_cents": True})["price_tolerance_cents"] == 50
    assert shop_config.normalized({"price_tolerance_cents": 0})["price_tolerance_cents"] == 0


@pytest.mark.asyncio
async def test_a_tolerance_outside_the_limits_is_refused(db):
    for value in (-1, 10_001, "50", None):
        with pytest.raises(ShopError, match="Toleranz"):
            await shop_config.update(db, {"price_tolerance_cents": value}, actor={"id": "finanzen-test"},
                                     is_superadmin=False, reason="Test")


# ---------------------------------------------------------------- Rechnung

@pytest.mark.asyncio
async def test_invoice_lines_carry_the_frozen_gross_amounts_and_tax_only_when_shown(db, provider, fake):
    product = await ready_product(db, provider)
    white = await variant_for(db, product["id"], WHITE_M)
    black = await variant_for(db, product["id"], BLACK_L)
    placed, _ = await order(db, provider, [{"variant_id": white["id"], "quantity": 2, "gamertag": NAME},
                                           {"variant_id": black["id"], "quantity": 1, "gamertag": NAME}])
    items = await shop_orders.items_view(db, await shop_orders.items_for(db, placed["id"]))
    # Bis #1701: brutto, ohne eigene Steuerzeile.
    lines = shop_pricing.invoice_lines(placed, items)
    assert [(line["kind"], line["quantity"], line["total_cents"], line["tax_cents"]) for line in lines] == [
        ("item", 2, 2340, None), ("item", 1, 1170, None), ("shipping", 1, 594, None)]
    assert lines[0]["unit_cents"] == 1170 and lines[0]["label"].startswith("Vereinsshirt Test - ")
    assert sum(line["total_cents"] for line in lines) == placed["frozen"]["total_cents"] == 4104
    # Mit Steuerausweis: netto je Zeile plus eine Steuerzeile - dieselbe Summe.
    shown = shop_pricing.invoice_lines(placed, items, show_tax=True)
    assert [(line["kind"], line["total_cents"]) for line in shown] == [
        ("item", 1950), ("item", 975), ("shipping", 495), ("tax", 684)]
    assert sum(line["total_cents"] for line in shown) == 4104


@pytest.mark.asyncio
async def test_fallback_and_older_orders_invoice_their_frozen_amounts_without_tax(db, provider, fake):
    product = await ready_product(db, provider)
    white = await variant_for(db, product["id"], WHITE_M)
    placed, _ = await order(db, provider, [{"variant_id": white["id"], "quantity": 1, "gamertag": NAME}],
                            estimate=490, use_provider=False)
    items = await shop_orders.items_for(db, placed["id"])
    lines = shop_pricing.invoice_lines(placed, items, show_tax=True)
    assert [line["kind"] for line in lines] == ["item", "shipping"]
    assert sum(line["total_cents"] for line in lines) == placed["frozen"]["total_cents"]
    # Eine Bestellung von vor #2135 (ohne price_source, ohne fees): dieselben Zeilen, derselbe Betrag an Printful.
    older = {**placed, "frozen": {key: value for key, value in placed["frozen"].items()
                                  if key not in ("price_source", "fees_cents", "printful_costs", "tax_shares")}}
    assert [line["total_cents"] for line in shop_pricing.invoice_lines(older, items)] == [
        line["total_cents"] for line in lines]
    assert shop_pricing.printful_amount(older) == placed["frozen"]["total_cents"]

# ---------------------------------------------------------------- Testentwurf: „prüfen“ nur bei starker Abweichung

def test_the_test_draft_warns_only_when_shop_or_catalog_are_far_from_printful():
    from services import shop_test_drafts

    product = {"placements": [{"printful_placement": "front"}], "included_placement": "front"}
    mapping = {"base_cost_cents": 1290}
    estimate = costs(1290, 449, 2087, tax=348)  # Beispiel aus #2135
    # Mitgliederpreis = Printful brutto (15,48 €), Katalog netto = Printful netto: grün.
    close = shop_test_drafts.price_check(product, {"price_cents": 1548}, mapping, estimate)
    assert close == {"shop_cents": 1548, "printful_subtotal_cents": 1290, "printful_gross_cents": 1548,
                     "printful_net_cents": 1290, "catalog_net_cents": 1290, "level": "ok"}
    # Ein paar Cent daneben ist noch kein „prüfen“.
    assert shop_test_drafts.price_check(product, {"price_cents": 1550}, mapping, estimate)["level"] == "ok"
    # Der Katalog rechnet die Rückseite als Aufpreis (15,00 € netto), Printful nur 12,90 €: „prüfen“ - auch wenn der
    # Mitgliederpreis schon stimmt.
    two_sides = {**product, "placements": [{"printful_placement": "front"}, {"printful_placement": "back"}]}
    far = shop_test_drafts.price_check(two_sides, {"price_cents": 1548},
                                       {"base_cost_cents": 975, "placement_costs": {"back": 525}}, estimate)
    assert far["catalog_net_cents"] == 1500 and far["level"] == "warn"
    # Der Mitgliederpreis weit weg von Printful brutto: „prüfen“.
    wrong = shop_test_drafts.price_check(product, {"price_cents": 2087}, mapping, estimate)
    assert wrong["level"] == "warn"
    assert shop_test_drafts.price_check(product, {"price_cents": 1548}, mapping, None)["level"] == "open"

@pytest.mark.asyncio
async def test_the_checkout_quote_is_the_amount_the_order_then_freezes(db, provider, fake):
    product = await ready_product(db, provider)
    white = await variant_for(db, product["id"], WHITE_M)
    black = await variant_for(db, product["id"], BLACK_L)
    cart = [{"variant_id": white["id"], "quantity": 2, "gamertag": NAME},
            {"variant_id": black["id"], "quantity": 1, "gamertag": NAME}]
    quote = await shop_orders.quote_cart(db, cart, provider=provider, country="AT", zip_code="8010")
    assert quote["source"] == "printful_estimate" and quote["total_cents"] == 4104
    assert [line["line_total_cents"] for line in quote["lines"]] == [2340, 1170]
    assert (quote["shipping_cents"], quote["tax_cents"]) == (594, 684)
    assert await db.shop_print_files.count_documents({"purpose": "order"}) == 0, "die Kasse legt keine Datei an"
    placed, _ = await order(db, provider, cart)
    assert placed["frozen"]["total_cents"] == quote["total_cents"]
    # Ohne Printful: der übernommene Preis plus Ersatzpauschale - fehlt die, kein Betrag.
    with pytest.raises(ShopError, match="Versand"):
        await shop_orders.quote_cart(db, cart, provider=None, country="AT", zip_code="8010")
    await db.settings.update_one({"id": "shop"}, {"$set": {"id": "shop", "fallback_shipping_cents": 690}}, upsert=True)
    fallback = await shop_orders.quote_cart(db, cart, provider=None, country="AT", zip_code="8010")
    assert fallback["source"] == "fallback" and fallback["total_cents"] == 3 * white["price_cents"] + 690
    with pytest.raises(ShopError, match="Österreich"):
        await shop_orders.quote_cart(db, cart, provider=provider, country="DE", zip_code="10115")

@pytest.mark.asyncio
async def test_the_estimates_carry_the_required_product_options(db, provider, fake):
    """#2158: ein Produkt mit Nahtfarbe - ohne sie lehnte Printful die Schätzung ab, dann gäbe es nur den Rückfall."""
    from test_shop_products_unit import PRINTFUL_PRODUCT

    fake.set_product_options(PRINTFUL_PRODUCT, [{"name": "stitch_color", "techniques": ["cut-sew"], "type": "string",
                                                 "values": ["White", "Black"]}], required=("stitch_color",))
    product = await ready_product(db, provider)
    white = await variant_for(db, product["id"], WHITE_M)
    cart = [{"variant_id": white["id"], "quantity": 1, "gamertag": NAME}]
    quote = await shop_orders.quote_cart(db, cart, provider=provider, country="AT", zip_code="8010")
    placed, _ = await order(db, provider, cart)
    assert quote["source"] == placed["frozen"]["price_source"] == "printful_estimate"
    for call in fake.calls_to("createOrderEstimationTask"):
        assert call["body"]["order_items"][0]["product_options"] == [{"name": "stitch_color", "value": "White"}]
    checked = await shop_orders.recheck_before_release(db, placed["id"], provider=provider, actor_id="system:test")
    assert checked["decision"] == "release"
    await shop_catalog_sync.sync_product(db, product["id"], provider=provider, **BY)
    medium = await variant_for(db, product["id"], BLACK_M)
    assert (await shop_catalog.printful_variant_for(db, medium["id"]))["gross_estimate"]["goods_gross_cents"] == 1170

# ---------------------------------------------------------------- Review: atomar, gleiche Grundlage, Gewichte, Budget

@pytest.mark.asyncio
async def test_two_concurrent_rechecks_release_only_once(db, provider, fake, monkeypatch):
    import asyncio

    placed = await placed_order(db, provider)
    real, arrived, both = shop_pricing.assess, [], asyncio.Event()

    async def together(*args, **kwargs):
        result = await real(*args, **kwargs)
        arrived.append(1)
        if len(arrived) == 2:
            both.set()
        await both.wait()  # beide haben gelesen und geschätzt, bevor einer schreibt
        return result

    monkeypatch.setattr(shop_pricing, "assess", together)
    first, second = await asyncio.gather(
        shop_orders.recheck_before_release(db, placed["id"], provider=provider, actor_id="system:a"),
        shop_orders.recheck_before_release(db, placed["id"], provider=provider, actor_id="system:b"))
    decisions = sorted([first["decision"], second["decision"]])
    assert decisions == ["hold", "release"], "nur eine Prüfung darf auslösen"
    lost = first if first["decision"] == "hold" else second
    assert lost["reason"] == shop_orders.STATE_CHANGED
    stored = await shop_orders.get_order(db, placed["id"])
    assert stored["status"] == "placed" and stored["price_check_rev"] == 1
    kinds = [event["kind"] for event in await shop_orders.events_for(db, placed["id"])]
    assert kinds.count("order.price_checked") == 1


@pytest.mark.asyncio
async def test_retry_and_blocked_are_kept_at_the_order_and_as_events(db, provider, fake):
    placed = await placed_order(db, provider)
    fake.fail("timeout", operation="createOrderEstimationTask", times=1)
    retry = await shop_orders.recheck_before_release(db, placed["id"], provider=provider, actor_id="system:test")
    assert retry["decision"] == "retry"
    stored = await shop_orders.get_order(db, placed["id"])
    assert stored["status"] == "placed" and stored["price_check"]["decision"] == "retry"
    # Eine Druckdatei ist vom Netz: so lässt sich nichts schätzen - die Leitung muss nachsehen.
    (item,) = await shop_orders.items_for(db, placed["id"])
    await db.shop_print_files.update_one({"id": item["print_files"][0]["file_id"]},
                                         {"$set": {"public_disabled_at": "2026-10-28T10:00:00+00:00"}})
    blocked = await shop_orders.recheck_before_release(db, placed["id"], provider=provider, actor_id="system:test")
    assert blocked["decision"] == "blocked"
    stored = await shop_orders.get_order(db, placed["id"])
    assert stored["price_check"]["decision"] == "blocked" and stored["status"] == "placed"
    events = {event["kind"]: event for event in await shop_orders.events_for(db, placed["id"])}
    assert "order.price_check_retry" in events and events["order.price_check_blocked"]["data"]["reason"]
    # Aus einem Stand, aus dem nicht ausgelöst wird, nie „release“ - und Printful wird gar nicht gefragt.
    await db.shop_orders.update_one({"id": placed["id"]}, {"$set": {"status": "cancelled"}})
    fake.calls.clear()
    other = await shop_orders.recheck_before_release(db, placed["id"], provider=provider, actor_id="system:test")
    assert other["decision"] == "hold" and fake.calls_to("createOrderEstimationTask") == []


@pytest.mark.asyncio
async def test_the_checkout_quote_refuses_what_the_order_refuses(db, provider, fake):
    product = await ready_product(db, provider)
    white = await variant_for(db, product["id"], WHITE_M)
    cart = [{"variant_id": white["id"], "quantity": 1, "gamertag": NAME}]
    mapping = await shop_catalog.printful_variant_for(db, white["id"])
    await shop_catalog.set_catalog_mapping(db, white["id"], {"in_stock": False}, actor_id="test")
    with pytest.raises(ShopError, match="nicht bestellbar"):
        await shop_orders.quote_cart(db, cart, provider=provider, country="AT", zip_code="8010")
    await shop_catalog.set_catalog_mapping(db, white["id"], {"in_stock": mapping["in_stock"]}, actor_id="test")
    await db.settings.update_one({"id": "shop"}, {"$set": {"id": "shop", "min_price_cents": 5000}}, upsert=True)
    with pytest.raises(ShopError, match="nicht bestellbar"):
        await shop_orders.quote_cart(db, cart, provider=provider, country="AT", zip_code="8010")
    await db.settings.update_one({"id": "shop"}, {"$set": {"min_price_cents": 100}})
    with pytest.raises(ShopError, match="Gamertag"):
        await shop_orders.quote_cart(db, cart, provider=provider, country="AT", zip_code="8010", buyer_kind="public")
    quote = await shop_orders.quote_cart(db, cart, provider=provider, country="AT", zip_code="8010")
    assert quote["source"] == "printful_estimate"


@pytest.mark.asyncio
async def test_the_goods_are_split_by_the_current_estimate_of_each_variant(db, provider, fake):
    fake.prices[BLACK_L] = Decimal("12.00")
    product = await ready_product(db, provider)  # beide übernommen mit 15,00 € bzw. 17,25 € Katalog netto
    await shop_pricing.refresh_estimates(db, product["id"], provider=provider, actor_id="finanzen-test")
    white = await variant_for(db, product["id"], WHITE_M)
    black = await variant_for(db, product["id"], BLACK_L)
    placed, _ = await order(db, provider, [{"variant_id": white["id"], "quantity": 1, "gamertag": NAME},
                                           {"variant_id": black["id"], "quantity": 1, "gamertag": NAME}])
    items = await shop_orders.items_for(db, placed["id"])
    # Ware 9,75 € + 12,00 €: die Anteile folgen der Schätzung je Variante, nicht dem übernommenen Katalogpreis.
    assert [item["gross"]["net_cents"] for item in items] == [975, 1200]
    assert sum(item["line_total_cents"] for item in items) + placed["frozen"]["shipping_cents"] == \
        placed["frozen"]["total_cents"]


class SlowProvider:
    """Der echte Adapter gegen den Fake, aber jede Schätzung dauert - und zählt, wie viele gleichzeitig laufen."""

    def __init__(self, inner, seconds: float):
        self.inner, self.seconds, self.running, self.most = inner, seconds, 0, 0

    async def estimate_costs(self, *args, **kwargs):
        import asyncio

        self.running += 1
        self.most = max(self.most, self.running)
        try:
            await asyncio.sleep(self.seconds)
            return await self.inner.estimate_costs(*args, **kwargs)
        finally:
            self.running -= 1


@pytest.mark.asyncio
async def test_estimates_run_in_parallel_with_a_limit_and_stop_at_the_time_budget(db, provider, fake, monkeypatch):
    for number, price in ((BLACK_M, "9.75"), (BLACK_L, "10.25"), (WHITE_M, "10.75"), (4015, "11.25")):
        fake.prices[number] = Decimal(price)  # vier Preisgruppen
    product = await configured(db, provider, accept=False)
    variants = await shop_catalog.variants_of(db, product["id"])
    mappings = await shop_catalog.printful_variants_for(db, [variant["id"] for variant in variants])
    slow = SlowProvider(provider, 0.05)
    done, open_groups = await shop_pricing.estimates_for(db, product, variants, mappings, provider=slow,
                                                         budget={"concurrency": 2, "deadline_seconds": 5.0})
    assert len(done) == 4 and open_groups == 0 and slow.most == 2
    background = SlowProvider(provider, 0.01)
    done, _ = await shop_pricing.estimates_for(db, product, variants, mappings, provider=background,
                                               budget={**shop_pricing.BACKGROUND, "pause_seconds": 0.0})
    assert len(done) == 4 and background.most == 1, "der Tagesjob schätzt nacheinander"
    # Zeitbudget: was nicht fertig wird, bleibt offen - die Admin-Anfrage wartet nicht darauf.
    monkeypatch.setitem(shop_pricing.INTERACTIVE, "deadline_seconds", 0.2)
    result = await shop_pricing.refresh_estimates(db, product["id"], provider=SlowProvider(provider, 5.0),
                                                  actor_id="finanzen-test")
    assert result["estimated"] == 0 and result["open"] == 4 and "noch offen" in result["detail"]

@pytest.mark.asyncio
async def test_a_one_cent_jitter_from_the_tax_split_is_no_price_change(db, provider, fake):
    """±1 Cent aus der anteiligen Steuerverteilung (etwa bei geändertem Versand) ist keine Preisänderung (#2135)."""
    product = await configured(db, provider, accept=False)
    await shop_catalog_sync.sync_product(db, product["id"], provider=provider, **BY)
    await shop_products.accept_prices(db, product["id"], **BY)
    medium = await variant_for(db, product["id"], BLACK_M)
    for accepted, warned in ((1171, False), (1169, False), (1172, True)):
        await shop_catalog.set_variant_state(db, medium["id"], {"price_cents": accepted}, actor_id="test")
        await shop_catalog.set_catalog_mapping(db, medium["id"], {"price_warning": None}, actor_id="test")
        await shop_catalog_sync.sync_product(db, product["id"], provider=provider, **BY)
        mapping = await shop_catalog.printful_variant_for(db, medium["id"])
        assert bool(mapping.get("price_warning")) is warned, accepted
        view = await shop_products.admin_view(db, product["id"])
        prices = next(item for item in view["check"]["items"] if item["key"] == "prices")
        assert prices["ok"] is not warned, accepted
    assert shop_pricing.same_price(1170, 1171) and not shop_pricing.same_price(1170, None)
