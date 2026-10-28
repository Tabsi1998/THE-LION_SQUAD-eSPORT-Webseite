"""Testentwurf an Printful (#2062) durch die echte Anwendung (flow_harness): Rechte je Rolle mit Zwei-Faktor, Stufe und
Schlüssel, der ganze Weg Vorschau → Senden → Löschen, kein Bestätigen über die API, Bremse und Fehlertexte ohne
Interna. Printful ist der Vertrags-Fake über den echten Adapter (``printful_client.TRANSPORT``) - kein echter Aufruf.
Erfundene Testdaten, keine echten Personen, synthetische Bilder."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from printful_fake import API_KEY, FakePrintful  # noqa: E402
from test_shop_admin_flow import ALLOWED, REFUSED, people, without_second_factor  # noqa: E402

BASE = "/api/admin/shop/test-drafts"
WHITE_M = 4014
ADDRESS = {"name": "Testverein Löwen", "street": "Vereinsgasse 1", "street2": "", "zip": "6020", "city": "Innsbruck",
           "country": "AT"}


@pytest.fixture(autouse=True)
def design_dir(monkeypatch, tmp_path):
    import storage

    monkeypatch.setattr(storage, "SHOP_DESIGN_DIR", tmp_path / "shop-designs")
    monkeypatch.setattr(storage, "UPLOAD_DIR", tmp_path)
    monkeypatch.setenv("PUBLIC_BACKEND_URL", "https://lsw.example.test")
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


async def shop_ready(flow, *, stage: str = "admins", key: bool = True) -> None:
    from services.secret_store import encrypt_secret

    await flow.db.settings.update_one({"id": "shop"}, {"$set": {
        "id": "shop", "stage": stage, "orders_to_printful": False,
        "printful_api_key": encrypt_secret(API_KEY) if key else ""}}, upsert=True)


async def product_and_variant(flow) -> tuple[dict, dict]:
    from services.printful_client import PrintfulClient
    from test_shop_products_unit import configured, variant_for

    product = await configured(flow.db, PrintfulClient(API_KEY))
    return product, await variant_for(flow.db, product["id"], WHITE_M)


def preview_body(product: dict, variant: dict, **extra) -> dict:
    return {"product_id": product["id"], "variant_id": variant["id"], "gamertag": "Testlöwe",
            "address": dict(ADDRESS), **extra}


@pytest.mark.asyncio
async def test_only_finance_with_second_factor_reaches_the_test_drafts(flow, fake):
    await shop_ready(flow)
    who = await people(flow)
    routes = [("get", BASE, None), ("get", f"{BASE}/x", None), ("post", f"{BASE}/preview", {"product_id": "x", "variant_id": "y", "address": ADDRESS}),
              ("post", f"{BASE}/x/send", {"idempotency_key": "klick-0001"}), ("post", f"{BASE}/x/delete", None)]
    for name in REFUSED:
        flow.act_as(who[name])
        for method, url, body in routes:
            answer = await getattr(flow, method)(url, **({"json": body} if body is not None else {}))
            assert answer.status_code == 403, (name, url, answer.text)
    for name in ALLOWED:
        flow.act_as(without_second_factor(who[name]))
        for method, url, body in routes:
            answer = await getattr(flow, method)(url, **({"json": body} if body is not None else {}))
            assert answer.status_code == 403 and "Zwei-Faktor" in answer.json()["detail"], (name, url)
    for name in ALLOWED:
        flow.act_as(who[name])
        assert (await flow.get(BASE)).status_code == 200
    assert fake.calls == []


@pytest.mark.asyncio
async def test_the_whole_way_preview_send_delete_and_no_confirm(flow, fake):
    await shop_ready(flow)
    await flow.db.settings.insert_one({"id": "branding", "legal_name": "Testverein Löwen", "street_address": "Vereinsgasse 1",
                                       "postal_code": "6020", "city": "Innsbruck", "country": "Österreich"})
    product, variant = await product_and_variant(flow)
    who = await people(flow)
    flow.act_as(who["finanzen"])
    page = (await flow.get(BASE)).json()
    assert page["access"]["allowed"] is True and page["access"]["orders_to_printful"] is False
    assert page["address"]["complete"] is True and page["address"]["address"] == {**ADDRESS, "street2": ""}
    (listed,) = page["products"]
    assert listed["id"] == product["id"] and listed["gamertag"] is True and len(listed["variants"]) == 4
    assert page["mockup"] == "Mockup folgt (#1710)."

    shown = await flow.post(f"{BASE}/preview", json=preview_body(product, variant))
    assert shown.status_code == 200, shown.text
    draft = shown.json()
    sent = await flow.post(f"{BASE}/{draft['id']}/send", json={"idempotency_key": "klick-0001"})
    assert sent.status_code == 200, sent.text
    assert fake.calls_to("createOrder")[0]["body"] == draft["payload"]
    assert sent.json()["state"] == "sent" and sent.json()["dashboard_url"]
    # Kein Bestätigen über die API - es gibt die Route nicht.
    for path in (f"{BASE}/{draft['id']}/confirm", f"{BASE}/{draft['id']}/confirmation"):
        assert (await flow.post(path, json={})).status_code in (404, 405)
    assert fake.confirmations == []
    listed = (await flow.get(BASE)).json()["drafts"]
    assert [row["printful_order_id"] for row in listed] == [sent.json()["printful_order_id"]]
    gone = await flow.post(f"{BASE}/{draft['id']}/delete")
    assert gone.status_code == 200 and gone.json()["state"] == "deleted" and fake.orders == {}


@pytest.mark.asyncio
async def test_stage_off_or_missing_key_answers_409_and_sends_nothing(flow, fake):
    product, variant = await product_and_variant(flow)
    who = await people(flow)
    flow.act_as(who["finanzen"])
    before = len(fake.calls)  # das Anlegen des Testprodukts liest den Katalog - danach darf nichts mehr hinausgehen
    await shop_ready(flow, stage="off")
    answer = await flow.post(f"{BASE}/preview", json=preview_body(product, variant))
    assert answer.status_code == 409 and "Nur Admins (Test)" in answer.json()["detail"]
    await shop_ready(flow, key=False)
    answer = await flow.post(f"{BASE}/preview", json=preview_body(product, variant))
    assert answer.status_code == 409 and "Schlüssel" in answer.json()["detail"]
    page = (await flow.get(BASE)).json()
    assert page["access"]["allowed"] is False and page["access"]["problems"]
    assert len(fake.calls) == before


@pytest.mark.asyncio
async def test_errors_carry_fixed_sentences_without_internals(flow, fake):
    await shop_ready(flow)
    product, variant = await product_and_variant(flow)
    who = await people(flow)
    flow.act_as(who["finanzen"])
    draft = (await flow.post(f"{BASE}/preview", json=preview_body(product, variant))).json()
    fake.fail(400, operation="createOrder")
    answer = await flow.post(f"{BASE}/{draft['id']}/send", json={"idempotency_key": "klick-0002"})
    assert answer.status_code == 409
    detail = answer.json()["detail"]
    assert detail.startswith("Printful: Der Anbieter lehnt die Daten ab")
    assert "Fehler (Test)" not in detail and "Traceback" not in answer.text and API_KEY not in answer.text
    # Die Seite holt danach den Stand: wieder Vorschau, mit Ursache (die Begründung von Printful nur hier, gekürzt).
    current = (await flow.get(f"{BASE}/{draft['id']}")).json()
    assert current["state"] == "preview" and current["last_error"]["reason"] == "bad_request"
    assert "send_key" not in current and current["actions"] == {"resend": False, "delete": False}
    fake.fail(503, operation="createOrder")
    answer = await flow.post(f"{BASE}/{draft['id']}/send", json={"idempotency_key": "klick-0003"})
    assert answer.status_code == 503 and "noch einmal" in answer.json()["detail"]
    unknown = await flow.post(f"{BASE}/gibt-es-nicht/send", json={"idempotency_key": "klick-0004"})
    assert unknown.status_code == 404 and unknown.json()["detail"] == "Nicht gefunden."
    refused = await flow.post(f"{BASE}/preview", json=preview_body(product, variant, gamertag="Löwe 🦁"))
    assert refused.status_code == 400 and "Emojis" in refused.json()["detail"]
    extra = await flow.post(f"{BASE}/preview", json={**preview_body(product, variant), "confirm": True})
    assert extra.status_code == 422, "unbekannte Felder - etwa „confirm“ - lehnt die Route ab"


@pytest.mark.asyncio
async def test_send_and_delete_are_braked_per_account(flow, fake, monkeypatch):
    monkeypatch.setenv("SHOP_TEST_DRAFT_SEND_LIMIT", "1")
    await shop_ready(flow)
    product, variant = await product_and_variant(flow)
    who = await people(flow)
    flow.act_as(who["finanzen"])
    draft = (await flow.post(f"{BASE}/preview", json=preview_body(product, variant))).json()
    first = await flow.post(f"{BASE}/{draft['id']}/send", json={"idempotency_key": "klick-0005"})
    assert first.status_code == 200
    second = await flow.post(f"{BASE}/{draft['id']}/send", json={"idempotency_key": "klick-0005"})
    assert second.status_code == 429 and len(fake.calls_to("createOrder")) == 1
