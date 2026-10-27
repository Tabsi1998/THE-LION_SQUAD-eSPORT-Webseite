"""Produktverwaltung (#1707) und Katalogabgleich (#1709) durch die echte Anwendung (flow_harness): Routen, Wächter,
Datenbank. Printful ist der Vertrags-Fake über den echten Adapter (``printful_client.TRANSPORT``) - kein echter
Aufruf. Erfundene Testdaten, keine echten Personen.

Abgedeckt: Rechte je Rolle und Zwei-Faktor, „öffentlich + Personalisierung“ abgelehnt, Pflicht-Grund, der Weg vom
Printful-Produkt bis „geprüft“, Veröffentlichen scheitert an der offenen Mockup-Prüfung, „Mit Printful abgleichen“
sperrt eine nicht lieferbare Variante, und das Protokoll nennt Person und Grund."""
import hashlib
import inspect
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from printful_fake import API_KEY, FakePrintful  # noqa: E402
from test_shop_admin_flow import ALLOWED, REFUSED, people, without_second_factor  # noqa: E402

BASE = "/api/admin/shop/products"
BY = {"actor_id": "test", "reason": "Testdaten"}
NEW = {"title": "Vereinsshirt Test", "visibility": "members", "personalization": "gamertag",
       "reason": "Testshirt für #2062 anlegen"}
PLACEMENTS = [{"key": "front_right", "kind": "design"}, {"key": "front_left", "kind": "gamertag"},
              {"key": "back", "kind": "design"}]


@pytest_asyncio.fixture
async def flow():
    from services import shop_schema

    instance, shutdown = make_flow()
    try:
        await shop_schema.apply(instance.db)
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def fake(monkeypatch):
    from services import printful_client

    instance = FakePrintful()
    instance.add_product(71, ((4012, "M", "Black"), (4013, "L", "Black"), (4014, "M", "White"), (4015, "L", "White")),
                         price="9.75", placement_prices={"front": "5.25", "back": "5.25"},
                         name="Unisex Testshirt | Gildan 5000")

    async def no_wait(_seconds):
        return None

    monkeypatch.setattr(printful_client, "TRANSPORT", instance.transport())
    monkeypatch.setattr(printful_client, "_sleep", no_wait)
    return instance


async def with_key(flow) -> None:
    from services.secret_store import encrypt_secret

    await flow.db.settings.update_one({"id": "shop"}, {"$set": {"id": "shop", "printful_api_key": encrypt_secret(API_KEY)}},
                                      upsert=True)


async def club_designs(flow) -> None:
    from services import shop_catalog, shop_designs

    for key, placement, color, width in (("loewe-weiss", "front_right", "Black", 1200),
                                         ("loewe-schwarz", "front_right", "White", 1200),
                                         ("ruecken-weiss", "back", "Black", 3000),
                                         ("ruecken-schwarz", "back", "White", 3000)):
        await shop_designs.create_profile(flow.db, key, title=key, placement=placement, garment_colors=[color], **BY)
        digest = hashlib.sha256(key.encode()).hexdigest()
        await shop_catalog.add_design_version(flow.db, key, file_ref=f"shop-designs/{digest[:32]}.png", sha256=digest,
                                              placement=placement, details={"public_id": (digest * 2)[:43],
                                                                            "width_px": width, "height_px": width},
                                              **BY)


async def build(flow) -> str:
    """Der geführte Weg bis „Preise übernommen“ - so wie die Seite ihn geht."""
    created = await flow.post(BASE, json=NEW)
    assert created.status_code == 200, created.text
    product_id = created.json()["product"]["id"]
    steps = [
        ("post", f"{BASE}/{product_id}/printful", {"printful_product_id": 71, "reason": "Gildan 5000 gewählt"}),
        ("put", f"{BASE}/{product_id}/offer", {"technique": "dtg", "colors": ["Black", "White"], "sizes": ["M", "L"],
                                               "reason": "Schwarz und Weiß in M und L"}),
        ("put", f"{BASE}/{product_id}/placements", {"placements": PLACEMENTS, "included_placement": "front",
                                                    "reason": "Löwe, Gamertag, Rückenlogo"}),
    ]
    for method, url, body in steps:
        answer = await getattr(flow, method)(url, json=body)
        assert answer.status_code == 200, (url, answer.text)
    view = answer.json()
    designs = await flow.put(f"{BASE}/{product_id}/designs",
                             json={"assignments": view["design_suggestions"], "reason": "Vorschläge übernommen"})
    assert designs.status_code == 200, designs.text
    prices = await flow.post(f"{BASE}/{product_id}/prices/accept", json={"reason": "Selbstkosten geprüft"})
    assert prices.status_code == 200, prices.text
    return product_id


def new_routes(product_id: str) -> list[tuple[str, str, dict]]:
    return [
        ("post", f"{BASE}/{product_id}/printful", {"printful_product_id": 71, "reason": "Test"}),
        ("put", f"{BASE}/{product_id}/offer", {"technique": "dtg", "colors": ["Black"], "sizes": ["M"], "reason": "Test"}),
        ("put", f"{BASE}/{product_id}/placements", {"placements": PLACEMENTS, "included_placement": None,
                                                    "reason": "Test"}),
        ("put", f"{BASE}/{product_id}/designs", {"assignments": [{"placement": "back", "color": "Black",
                                                                  "design_key": None}], "reason": "Test"}),
        ("post", f"{BASE}/{product_id}/prices/accept", {"reason": "Test"}),
        ("post", f"{BASE}/{product_id}/sync", {}),
        ("post", f"{BASE}/{product_id}/status", {"status": "reviewed", "reason": "Test"}),
    ]


# ---------------------------------------------------------------- Rechte

@pytest.mark.asyncio
async def test_only_finance_with_second_factor_reaches_the_product_routes(flow, fake):
    from services import shop_catalog

    await with_key(flow)
    who = await people(flow)
    product = await shop_catalog.create_product(flow.db, {"title": "Rechte-Test"}, **BY)
    logged = await flow.db.audit_logs.count_documents({})
    for name in REFUSED:
        flow.act_as(who[name])
        for method, url, body in new_routes(product["id"]):
            answer = await getattr(flow, method)(url, json=body)
            assert answer.status_code == 403, (name, url, answer.text)
    for name in ALLOWED:
        flow.act_as(without_second_factor(who[name]))
        for method, url, body in new_routes(product["id"]):
            answer = await getattr(flow, method)(url, json=body)
            assert answer.status_code == 403 and "Zwei-Faktor" in answer.json()["detail"], (name, url)
    assert await flow.db.audit_logs.count_documents({}) == logged
    for name in ALLOWED:
        flow.act_as(who[name])
        answer = await flow.post(f"{BASE}/{product['id']}/printful", json={"printful_product_id": 71, "reason": "Test"})
        assert answer.status_code == 200, (name, answer.text)


@pytest.mark.asyncio
async def test_every_change_needs_a_reason(flow, fake):
    from services import shop_catalog

    await with_key(flow)
    who = await people(flow)
    flow.act_as(who["finanzen"])
    product = await shop_catalog.create_product(flow.db, {"title": "Grund-Test"}, **BY)
    for method, url, body in new_routes(product["id"]):
        if "reason" not in body:
            continue
        answer = await getattr(flow, method)(url, json={**body, "reason": "  "})
        assert answer.status_code == 422, (url, answer.text)


# ---------------------------------------------------------------- Regeln

@pytest.mark.asyncio
async def test_public_with_personalization_is_refused_by_the_server(flow):
    who = await people(flow)
    flow.act_as(who["finanzen"])
    refused = await flow.post(BASE, json={**NEW, "visibility": "public"})
    assert refused.status_code == 400 and "Öffentlich" in refused.json()["detail"]
    assert await flow.db.shop_products.count_documents({}) == 0
    product = (await flow.post(BASE, json=NEW)).json()["product"]
    switched = await flow.patch(f"{BASE}/{product['id']}", json={"visibility": "public", "reason": "Für alle"})
    assert switched.status_code == 400
    assert (await flow.get(f"{BASE}/{product['id']}")).json()["product"]["visibility"] == "members"
    status = await flow.patch(f"{BASE}/{product['id']}", json={"status": "active", "reason": "Schnell"})
    assert status.status_code == 422, "den Stand ändert nur die Prüfung"


@pytest.mark.asyncio
async def test_without_a_printful_key_nothing_is_loaded(flow, fake):
    who = await people(flow)
    flow.act_as(who["finanzen"])
    product = (await flow.post(BASE, json=NEW)).json()["product"]
    answer = await flow.post(f"{BASE}/{product['id']}/printful", json={"printful_product_id": 71, "reason": "Test"})
    assert answer.status_code == 409 and "Schlüssel" in answer.json()["detail"]
    assert fake.calls == []


@pytest.mark.asyncio
async def test_a_variant_number_as_product_number_is_refused(flow, fake):
    await with_key(flow)
    who = await people(flow)
    flow.act_as(who["finanzen"])
    product = (await flow.post(BASE, json=NEW)).json()["product"]
    answer = await flow.post(f"{BASE}/{product['id']}/printful", json={"printful_product_id": 4012, "reason": "Test"})
    assert answer.status_code == 400 and "Variantennummer" in answer.json()["detail"]
    text = await flow.post(f"{BASE}/{product['id']}/printful", json={"printful_product_id": "71", "reason": "Test"})
    assert text.status_code == 422


# ---------------------------------------------------------------- Der ganze Weg

@pytest.mark.asyncio
async def test_the_guided_way_ends_at_reviewed_and_publishing_waits_for_the_mockup_check(flow, fake):
    await with_key(flow)
    await club_designs(flow)
    who = await people(flow)
    flow.act_as(who["finanzen"])
    product_id = await build(flow)
    view = (await flow.get(f"{BASE}/{product_id}")).json()
    assert view["check"]["review_ready"] is True and view["check"]["publish_ready"] is False
    medium = next(row for row in view["variants"] if row["label"] == "Black / M")
    assert medium["cost_cents"] == 1500 and medium["price_cents"] == 1500
    direct = await flow.post(f"{BASE}/{product_id}/status", json={"status": "active", "reason": "Gleich live"})
    assert direct.status_code == 409
    reviewed = await flow.post(f"{BASE}/{product_id}/status", json={"status": "reviewed", "reason": "Alles geprüft"})
    assert reviewed.status_code == 200 and reviewed.json()["product"]["status"] == "reviewed"
    publish = await flow.post(f"{BASE}/{product_id}/status", json={"status": "active", "reason": "Veröffentlichen"})
    assert publish.status_code == 409 and "Mockup" in publish.json()["detail"]
    listed = (await flow.get(BASE)).json()
    row = next(item for item in listed["overview"] if item["id"] == product_id)
    assert row["status"] == "reviewed" and row["variants"] == 4 and row["printful_name"].endswith("Gildan 5000")
    rows = await flow.db.audit_logs.find({"target_id": product_id}, {"_id": 0}).sort("created_at", 1).to_list(50)
    assert all(entry["actor_id"] == who["finanzen"]["id"] for entry in rows)
    reasons = {entry["action"]: entry["data"]["reason"] for entry in rows}
    assert reasons["shop.product.catalog"] == "Gildan 5000 gewählt"
    assert reasons["shop.product.designs"] == "Vorschläge übernommen"
    assert reasons["shop.product.status"] == "Alles geprüft"


@pytest.mark.asyncio
async def test_sync_from_the_admin_blocks_an_unavailable_variant_and_logs_it(flow, fake):
    await with_key(flow)
    await club_designs(flow)
    who = await people(flow)
    flow.act_as(who["club-admin"])
    product_id = await build(flow)
    fake.stock[4015] = "out of stock"
    answer = await flow.post(f"{BASE}/{product_id}/sync", json={})
    assert answer.status_code == 200, answer.text
    body = answer.json()
    assert body["result"]["blocked"] == ["White / L"]
    large = next(row for row in body["variants"] if row["label"] == "White / L")
    assert "nicht lieferbar" in large["blocked_reason"]
    assert body["sync"]["ok"] is True and body["sync"]["last_ok_at"]
    entry = await flow.db.audit_logs.find_one({"action": "shop.catalog.sync"}, {"_id": 0})
    assert entry["actor_id"] == who["club-admin"]["id"] and entry["data"]["blocked"] == ["White / L"]


@pytest.mark.asyncio
async def test_the_daily_sync_is_a_scheduled_job_and_needs_a_key(flow):
    from services import scheduler, shop_catalog_sync

    assert '"shop_catalog_sync"' in inspect.getsource(scheduler.start_scheduler)
    assert (await shop_catalog_sync.sync_all(flow.db))["skipped"] == "kein Printful-Schlüssel"
