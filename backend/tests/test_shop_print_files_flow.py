"""Die öffentliche Adresse der Druckdateien für Printful (#1708): je Version eine neue, nicht erratbare Adresse, die
ohne Anmeldung genau die gespeicherte Datei liefert; keine Liste, keine Aufzählung; alte Versionen bleiben für ihre
Bestellungen abrufbar. Dazu der Bericht zur Aufbewahrung. Synthetische Bilder, keine echten Vereinsbilder."""
import hashlib
import pathlib
import re
import sys
from datetime import timedelta

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from test_shop_designs_flow import NEW, design, finance, logo, stored_files, upload  # noqa: E402
from test_shop_designs_flow import flow as designs_flow  # noqa: E402

flow = designs_flow  # dieselbe Anwendung mit eigenem Ablageordner je Test


@pytest.mark.asyncio
async def test_a_new_file_is_a_new_version_with_a_new_address_and_the_old_one_stays(flow):
    await finance(flow)
    first = await upload(flow, logo(1200, 1200), **NEW)
    second = await upload(flow, logo(1400, 1400), reason="Linien dicker")
    assert first.status_code == 200 and second.status_code == 200, second.text
    assert second.json()["uploaded"]["version"] == 2
    versions = design(second)["versions"]
    assert [item["version"] for item in versions] == [2, 1]
    new, old = versions
    assert new["public_path"] != old["public_path"]
    assert new["public_path"].endswith("/loewe-weiss-v2.png") and old["public_path"].endswith("/loewe-weiss-v1.png")
    assert len(stored_files(flow)) == 2

    flow.act_as(None)  # Printful meldet sich nicht an
    for item in (new, old):
        answer = await flow.get(item["public_path"])
        assert answer.status_code == 200
        assert answer.headers["content-type"] == "image/png"
        assert answer.headers["x-content-type-options"] == "nosniff"
        assert hashlib.sha256(answer.content).hexdigest() == item["sha256"]


@pytest.mark.asyncio
async def test_the_public_address_is_not_guessable_and_nothing_can_be_listed(flow):
    await finance(flow)
    answer = await upload(flow, logo(1200, 1200), **NEW)
    path = design(answer)["latest"]["public_path"]
    match = re.fullmatch(r"/api/shop/print-files/([A-Za-z0-9_-]{43})/loewe-weiss-v1\.png", path)
    assert match, path
    public_id = match.group(1)
    row = await flow.db.shop_designs.find_one({"design_key": "loewe-weiss"})
    assert public_id not in (row["id"], row["sha256"]) and row["sha256"][:12] not in public_id

    flow.act_as(None)
    wrong_id = public_id[:-1] + ("A" if public_id[-1] != "A" else "B")
    for url in (f"/api/shop/print-files/{wrong_id}/loewe-weiss-v1.png",
                f"/api/shop/print-files/{public_id}/loewe-weiss-v2.png",
                f"/api/shop/print-files/{public_id}/loewe-weiss-v1.PNG",
                f"/api/shop/print-files/{public_id}/",
                f"/api/shop/print-files/{public_id}",
                "/api/shop/print-files/",
                "/api/shop/print-files",
                "/api/shop/print-files/kurz/loewe-weiss-v1.png",
                f"/api/shop/print-files/{public_id}/..%2F..%2Fserver.py"):
        refused = await flow.get(url)
        assert refused.status_code in (404, 405), (url, refused.status_code)
        assert refused.headers["content-type"] == "application/json" and public_id not in refused.text
    # Eine abgeschaltete Version (Aufbewahrung) ist dieselbe 404.
    await flow.db.shop_designs.update_one({"design_key": "loewe-weiss"}, {"$set": {"public_disabled_at": "x"}})
    assert (await flow.get(path)).status_code == 404


@pytest.mark.asyncio
async def test_an_order_keeps_its_version_after_a_new_upload(flow):
    from services import shop_catalog, shop_orders

    await finance(flow)
    assert (await upload(flow, logo(1200, 1200), **NEW)).status_code == 200
    by = {"actor_id": "test", "reason": "Testdaten"}
    product = await shop_catalog.create_product(
        flow.db, {"slug": "loewe", "title": "Löwen-Shirt", "base_price_cents": 2000, "status": "active",
                  "design_key": "loewe-weiss"}, **by)
    variant = await shop_catalog.create_variant(flow.db, product["id"], {"sku": "L-SCHWARZ-M", "label": "M",
                                                                         "color": "Schwarz"}, **by)
    address = {"street": "Probegasse 1", "zip": "1010", "city": "Wien", "country": "AT"}
    order, _ = await shop_orders.place_order(
        flow.db, user_id="konto-test", idempotency_key="design-0001", buyer_kind="member",
        lines=[{"variant_id": variant["id"], "quantity": 1}], shipping_estimate_cents=590,
        billing_address={"name": "Testperson", "source": "dolibarr", **address},
        shipping_address={"recipient": "Testperson", "source": "checkout", **address}, actor_id="konto-test")
    assert (await upload(flow, logo(1400, 1400), reason="Neue Linien")).status_code == 200

    [item] = await shop_orders.items_for(flow.db, order["id"])
    assert item["design"]["version"] == 1
    old = await flow.db.shop_designs.find_one({"design_key": "loewe-weiss", "version": 1}, {"_id": 0})
    assert item["design"]["sha256"] == old["sha256"]
    flow.act_as(None)
    assert (await flow.get(f"/api/shop/print-files/{old['public_id']}/loewe-weiss-v1.png")).status_code == 200


@pytest.mark.asyncio
async def test_the_retention_plan_keeps_the_latest_and_ordered_versions_public(flow):
    from models import now_utc
    from services import shop_designs

    await finance(flow)
    for size, reason in ((1200, "eins"), (1300, "zwei"), (1400, "drei")):
        assert (await upload(flow, logo(size, size), reason=f"Version {reason}", **NEW)).status_code == 200
    await flow.db.shop_order_items.insert_one({"id": "p1", "design": {"design_key": "loewe-weiss", "version": 1}})

    soon = await shop_designs.retention_plan(flow.db)
    assert soon["public_off"] == [] and soon["kept_public"] == 3
    later = await shop_designs.retention_plan(flow.db, now=now_utc() + timedelta(days=shop_designs.PUBLIC_GRACE_DAYS))
    assert [(item["design_key"], item["version"]) for item in later["public_off"]] == [("loewe-weiss", 2)]
    assert await flow.db.shop_designs.count_documents({"public_disabled_at": {"$exists": True}}) == 0
