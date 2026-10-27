"""Produktverwaltung (#1707) und Katalogabgleich (#1709) durch die echte Anwendung (flow_harness): Routen, Wächter,
Datenbank. Printful ist der Vertrags-Fake über den echten Adapter (``printful_client.TRANSPORT``) - kein echter
Aufruf. Erfundene Testdaten, keine echten Personen.

Abgedeckt: Rechte je Rolle und Zwei-Faktor, „öffentlich + Personalisierung“ abgelehnt, Pflicht-Grund, der Weg vom
Printful-Produkt bis „geprüft“, Veröffentlichen scheitert an der offenen Mockup-Prüfung, „Mit Printful abgleichen“
sperrt eine nicht lieferbare Variante, und das Protokoll nennt Person und Grund."""
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
LION = {"kind": "motif", "preset": "chest_right", "width_cm": 8.9, "motif": {"key": "loewe-weiss"}}
PLACEMENTS = [{"key": "front", "layers": [LION, {"kind": "gamertag", "preset": "text_opposite"}]},
              {"key": "back", "layers": [{"kind": "motif", "preset": "back_large", "width_cm": 28.0,
                                          "motif": {"key": "ruecken-weiss"}}]}]


@pytest.fixture(autouse=True)
def design_dir(monkeypatch, tmp_path):
    """Echte Dateien für den Druckdatei-Generator (#2069) - in einem eigenen Ordner je Test."""
    import storage

    monkeypatch.setattr(storage, "SHOP_DESIGN_DIR", tmp_path / "shop-designs")
    monkeypatch.setattr(storage, "UPLOAD_DIR", tmp_path)
    return tmp_path


@pytest_asyncio.fixture
async def flow():
    from services import shop_schema

    instance, shutdown = make_flow()
    try:
        await shop_schema.apply(instance.db)
        await instance.db.mutation_locks.create_index("resource", unique=True)
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
    from shop_testdata import stored_design

    for key, placement, color, width in (("loewe-weiss", "front_right", "Black", 1200),
                                         ("loewe-schwarz", "front_right", "White", 1200),
                                         ("ruecken-weiss", "back", "Black", 3000),
                                         ("ruecken-schwarz", "back", "White", 3000)):
        await stored_design(flow.db, key, placement, [color], width=width, height=width, **BY)


async def build(flow) -> str:
    """Der geführte Weg bis „Preise übernommen“ - so wie die Seite ihn geht."""
    created = await flow.post(BASE, json=NEW)
    assert created.status_code == 200, created.text
    product_id = created.json()["product"]["id"]
    steps = [
        ("post", f"{BASE}/{product_id}/printful", {"printful_product_id": 71, "reason": "Gildan 5000 gewählt"}),
        ("put", f"{BASE}/{product_id}/offer", {"technique": "dtg", "colors": ["Black", "White"], "sizes": ["M", "L"],
                                               "reason": "Schwarz und Weiß in M und L"}),
        ("put", f"{BASE}/{product_id}/layout", {"placements": PLACEMENTS, "included_placement": "front",
                                                "reason": "Löwe, Gamertag, Rückenlogo"}),
        ("post", f"{BASE}/{product_id}/print-files", {"reason": "Druckdateien erzeugt"}),
    ]
    for method, url, body in steps:
        answer = await getattr(flow, method)(url, json=body)
        assert answer.status_code == 200, (url, answer.text)
    assert len(answer.json()["result"]["created"]) == 4, answer.json()["result"]
    prices = await flow.post(f"{BASE}/{product_id}/prices/accept", json={"reason": "Selbstkosten geprüft"})
    assert prices.status_code == 200, prices.text
    return product_id


def new_routes(product_id: str) -> list[tuple[str, str, dict]]:
    return [
        ("post", f"{BASE}/{product_id}/printful", {"printful_product_id": 71, "reason": "Test"}),
        ("put", f"{BASE}/{product_id}/offer", {"technique": "dtg", "colors": ["Black"], "sizes": ["M"], "reason": "Test"}),
        ("put", f"{BASE}/{product_id}/layout", {"placements": PLACEMENTS, "included_placement": None,
                                                "reason": "Test"}),
        ("post", f"{BASE}/{product_id}/print-files", {"reason": "Test"}),
        ("post", f"{BASE}/{product_id}/layout/preview", {"placements": PLACEMENTS}),
        ("post", f"{BASE}/{product_id}/print-templates/refresh", {"reason": "Test"}),
        ("get", f"{BASE}/{product_id}/preview?placement=front&color=Black", None),
        ("get", f"{BASE}/{product_id}/print-files/x", None),
        ("get", "/api/admin/shop/print-presets", None),
        ("put", "/api/admin/shop/print-presets", {"rules": {"min_width_cm": 2.0}, "reason": "Test"}),
        ("get", "/api/admin/shop/print-templates/71/images/0", None),
        ("get", "/api/admin/shop/printful-catalog?q=gildan", None),
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
            answer = await getattr(flow, method)(url, **({"json": body} if body is not None else {}))
            assert answer.status_code == 403, (name, url, answer.text)
    for name in ALLOWED:
        flow.act_as(without_second_factor(who[name]))
        for method, url, body in new_routes(product["id"]):
            answer = await getattr(flow, method)(url, **({"json": body} if body is not None else {}))
            assert answer.status_code == 403 and "Zwei-Faktor" in answer.json()["detail"], (name, url)
    assert await flow.db.audit_logs.count_documents({}) == logged
    for name in ALLOWED:
        flow.act_as(who[name])
        answer = await flow.post(f"{BASE}/{product['id']}/printful", json={"printful_product_id": 71, "reason": "Test"})
        assert answer.status_code == 200, (name, answer.text)


@pytest.mark.asyncio
async def test_the_reason_is_optional_but_publishing_needs_one(flow, fake, monkeypatch):
    """Entscheidung Obmann 27.10.2026: Grund optional - Pflicht nur bei kritischen Schritten, und „Veröffentlichen“
    ist kritisch (es geht live). Wer, wann und was stehen trotzdem im Protokoll."""
    from services import shop_products

    async def mockups_ok(_db, _product):
        return {"ok": True, "state": "passed", "detail": "Test: Mockups geprüft"}

    monkeypatch.setattr(shop_products, "mockup_check", mockups_ok)
    await with_key(flow)
    await club_designs(flow)
    who = await people(flow)
    flow.act_as(who["finanzen"])
    created = await flow.post(BASE, json={key: value for key, value in NEW.items() if key != "reason"})
    assert created.status_code == 200, created.text
    product_id = created.json()["product"]["id"]
    steps = [
        ("post", f"{BASE}/{product_id}/printful", {"printful_product_id": 71}),
        ("put", f"{BASE}/{product_id}/offer", {"technique": "dtg", "colors": ["Black", "White"], "sizes": ["M", "L"]}),
        ("put", f"{BASE}/{product_id}/layout", {"placements": PLACEMENTS, "included_placement": "front",
                                                "reason": ""}),
    ]
    for method, url, body in steps:
        answer = await getattr(flow, method)(url, json=body)
        assert answer.status_code == 200, (url, answer.text)
    for method, url, body in (
            ("post", f"{BASE}/{product_id}/print-files", {}),
            ("post", f"{BASE}/{product_id}/prices/accept", {}),
            ("post", f"{BASE}/{product_id}/status", {"status": "reviewed"})):
        answer = await getattr(flow, method)(url, json=body)
        assert answer.status_code == 200, (url, answer.text)
    live = await flow.post(f"{BASE}/{product_id}/status", json={"status": "active", "reason": "  "})
    assert live.status_code == 400 and "Grund" in live.json()["detail"]
    live = await flow.post(f"{BASE}/{product_id}/status", json={"status": "active", "reason": "Testshirt geht live"})
    assert live.status_code == 200 and live.json()["product"]["status"] == "active"
    rows = await flow.db.audit_logs.find({"target_id": product_id}, {"_id": 0}).to_list(50)
    assert {row["actor_id"] for row in rows} == {who["finanzen"]["id"]}
    assert {row["data"]["reason"] for row in rows if row["action"] != "shop.product.status"} == {""}
    published = [row for row in rows
                 if row["action"] == "shop.product.status" and row["data"]["after"] == {"status": "active"}]
    assert published[0]["data"]["reason"] == "Testshirt geht live"


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
    assert reasons["shop.product.layout"] == "Löwe, Gamertag, Rückenlogo"
    assert reasons["shop.print_file.add"] == "Druckdateien erzeugt"
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


# ---------------------------------------------------------------- Befunde aus der Prüfung (Codex)

@pytest.mark.asyncio
async def test_the_old_patch_ways_keep_the_rules_of_the_guided_setup(flow, fake):
    """Befund 1 und 6 über die Routen: veröffentlicht keine Preis-, Aktiv- oder Sichtbarkeitsänderung, Printful-Preise
    nur über „Preise übernehmen“, und kein Verkaufspreis unter dem Mindestpreis."""
    from services import shop_catalog
    from shop_testdata import publish_unchecked

    await with_key(flow)
    await club_designs(flow)
    who = await people(flow)
    flow.act_as(who["finanzen"])
    product_id = await build(flow)
    medium = next(row for row in (await flow.get(f"{BASE}/{product_id}")).json()["variants"] if row["label"] == "Black / M")
    price = await flow.patch(f"/api/admin/shop/variants/{medium['id']}", json={"price_cents": 1200, "reason": "Billiger"})
    assert price.status_code == 400 and "Preise übernehmen" in price.json()["detail"]
    await publish_unchecked(flow.db, product_id)
    for body in ({"price_cents": 0}, {"active": False}):
        answer = await flow.patch(f"/api/admin/shop/variants/{medium['id']}", json={**body, "reason": "Direkt"})
        assert answer.status_code == 409 and "zurückziehen" in answer.json()["detail"], body
    for body in ({"visibility": "hidden"}, {"markup_cents": 0}):
        answer = await flow.patch(f"{BASE}/{product_id}", json={**body, "reason": "Direkt"})
        assert answer.status_code == 409, body
    stored = await shop_catalog.get_product(flow.db, product_id)
    assert stored["visibility"] == "members" and stored["markup_cents"] is None
    plain = (await flow.post(BASE, json={**NEW, "title": "Kappe Test", "personalization": "none"})).json()["product"]
    zero = await flow.post(f"{BASE}/{plain['id']}/variants", json={"sku": "KAPPE-0", "label": "Eine", "price_cents": 0,
                                                                   "reason": "Gratis"})
    assert zero.status_code == 400 and "Mindestpreis" in zero.json()["detail"]


@pytest.mark.asyncio
async def test_the_minimum_price_is_a_setting_with_reason(flow):
    who = await people(flow)
    flow.act_as(who["finanzen"])
    shown = (await flow.get("/api/admin/shop/config")).json()["config"]
    assert shown["min_price_cents"] == 100
    changed = await flow.patch("/api/admin/shop/config", json={"min_price_cents": 500, "reason": "Mindestens 5 Euro"})
    assert changed.status_code == 200 and changed.json()["config"]["min_price_cents"] == 500
    refused = await flow.patch("/api/admin/shop/config", json={"min_price_cents": 0, "reason": "Gratis"})
    assert refused.status_code == 422


@pytest.mark.asyncio
async def test_a_second_sync_while_one_runs_answers_409(flow, fake):
    from services import shop_catalog_sync
    from services.mutation_lock import mutation_lock

    await with_key(flow)
    await club_designs(flow)
    who = await people(flow)
    flow.act_as(who["finanzen"])
    product_id = await build(flow)
    async with mutation_lock(flow.db, shop_catalog_sync.SYNC_RESOURCE, wait_seconds=0, lease_seconds=30):
        answer = await flow.post(f"{BASE}/{product_id}/sync", json={})
    assert answer.status_code == 409 and "läuft gerade" in answer.json()["detail"]

# ---------------------------------------------------------------- Druckvorlagen und Druckdateien (#2069)

@pytest.mark.asyncio
async def test_print_files_preview_presets_template_images_and_upload_through_the_routes(flow, fake, monkeypatch):
    from io import BytesIO

    import httpx
    from PIL import Image

    from services import shop_print_templates

    def png(width: int, height: int) -> bytes:
        out = BytesIO()
        Image.new("RGBA", (width, height), (0, 0, 0, 0)).save(out, format="PNG")
        return out.getvalue()

    monkeypatch.setattr(shop_print_templates, "IMAGE_TRANSPORT", httpx.MockTransport(
        lambda request: httpx.Response(200, content=png(1000, 1000), headers={"content-type": "image/png"})))
    await with_key(flow)
    await club_designs(flow)
    who = await people(flow)
    flow.act_as(who["finanzen"])
    product_id = await build(flow)
    view = (await flow.get(f"{BASE}/{product_id}")).json()
    front = next(row for row in view["placements"] if row["key"] == "front")
    black = next(state for state in front["files"] if state["color"] == "Black")
    assert black["state"] == "ok" and black["file"]["width_px"] == 1800
    # Die erzeugte Datei: für Printful öffentlich hinter dem Zufallsschlüssel, im Admin über die Produkt-Route.
    flow.act_as(None)
    from services import shop_print_files

    row = await flow.db.shop_print_files.find_one({"id": black["file"]["id"]}, {"_id": 0})
    public = await flow.get(shop_print_files.public_path(row))
    assert public.status_code == 200 and public.headers["content-type"] == "image/png"
    assert public.headers["cache-control"] == "no-store"
    flow.act_as(who["finanzen"])
    own = await flow.get(f"{BASE}/{product_id}/print-files/{black['file']['id']}")
    assert own.status_code == 200 and own.content == public.content
    # Vorschau über dem Vorlagenbild, das Vorlagenbild selbst über die Website.
    preview = await flow.get(f"{BASE}/{product_id}/preview", params={"placement": "front", "color": "White"})
    assert preview.status_code == 200 and preview.headers["content-type"] == "image/png"
    with Image.open(BytesIO(preview.content)) as img:
        assert img.size == (900, 900)
    image = await flow.get(view["available_placements"][0]["preview"]["image_path"])
    assert image.status_code == 200 and image.headers["x-content-type-options"] == "nosniff"
    assert (await flow.get("/api/admin/shop/print-templates/71/images/99")).status_code == 404
    # Vorgaben sind einstellbar (Grund optional, Protokoll).
    presets = (await flow.get("/api/admin/shop/print-presets")).json()
    assert presets["is_default"] is True and presets["labels"]["families"]["front"] == "Vorderseite"
    changed = await flow.put("/api/admin/shop/print-presets", json={"rules": {"min_width_cm": 2.0}})
    assert changed.status_code == 200 and changed.json()["rules"]["min_width_cm"] == 2.0
    refused = await flow.put("/api/admin/shop/print-presets", json={"presets": [{"key": "!"}]})
    assert refused.status_code == 400
    # Für Profis: fertige Datei - die falsche Größe verständlich abgelehnt, die richtige angenommen.
    layout = {"placements": [PLACEMENTS[0], {"key": "back", "mode": "upload", "layers": []}],
              "included_placement": "front"}
    assert (await flow.put(f"{BASE}/{product_id}/layout", json=layout)).status_code == 200
    form = {"product_id": product_id, "placement": "back", "color": "Black", "reason": "Fertige Datei"}
    wrong = await flow.post("/api/admin/shop/print-files/upload", data=form,
                            files={"file": ("ruecken.png", png(1000, 1000), "image/png")})
    assert wrong.status_code == 400 and "1800 × 2400 px" in wrong.json()["detail"]
    right = await flow.post("/api/admin/shop/print-files/upload", data=form,
                            files={"file": ("ruecken.png", png(1800, 2400), "image/png")})
    assert right.status_code == 200, right.text
    assert right.json()["uploaded"]["width_px"] == 1800

@pytest.mark.asyncio
async def test_the_product_search_finds_the_printful_number_without_typing_it(flow, fake):
    who = await people(flow)
    flow.act_as(who["finanzen"])
    without_key = await flow.get("/api/admin/shop/printful-catalog", params={"q": "gildan"})
    assert without_key.status_code == 409 and "Schlüssel" in without_key.json()["detail"]
    await with_key(flow)
    found = await flow.get("/api/admin/shop/printful-catalog", params={"q": "Gildan 5000"})
    assert found.status_code == 200, found.text
    body = found.json()
    assert [row["id"] for row in body["results"]] == [71] and body["products_total"] == 1
    assert body["categories"] and body["fetched_at"] and body["stale"] is False
    link = "https://www.printful.com/dashboard/custom/mens/shirts/unisex-testshirt-gildan-5000?technique=DTFILM&color=Black"
    by_link = (await flow.get("/api/admin/shop/printful-catalog", params={"link": link})).json()
    assert by_link["link"]["ok"] is True and by_link["results"][0]["id"] == 71
    assert len(fake.calls_to("getProducts")) == 1, "zwischengespeichert"
