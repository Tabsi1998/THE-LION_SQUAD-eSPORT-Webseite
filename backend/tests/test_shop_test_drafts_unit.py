"""Testentwurf an Printful (#2062) ohne Routen: Vorschau == gesendete Daten, Protokoll als eigene Art ``test_draft``,
nicht in Bestellungen, Umsatz oder Dolibarr, Notschalter aus → Entwurf erlaubt, kein Bestätigen, Löschen, Doppelklick.

Printful ist der Vertrags-Fake (``tests/printful_fake.py``) über den echten Adapter - kein echter Aufruf, nie
Produktion. Erfundene Testdaten: Produkte, Motive (synthetische Bilder), Gamertags und die Vereinsadresse."""
import asyncio
import inspect
import pathlib
import sys
from datetime import timedelta

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from printful_fake import API_KEY  # noqa: E402
from services import printful_client, shop_print_files, shop_test_drafts  # noqa: E402
from services.shop_common import ShopConflict, ShopError  # noqa: E402
from services.shop_config import PrintfulDraftsBlocked  # noqa: E402
from services.shop_fulfillment import FulfillmentInvalid, PrintfulOrderId  # noqa: E402
from test_shop_products_unit import (  # noqa: E402,F401 - Fixtures und Helfer der Produktverwaltung
    WHITE_M, configured, db, design_dir, fake, provider, variant_for)

ACTOR = "finanzen-test"
NAME = "Testlöwe"
ADDRESS = {"name": "Testverein Löwen", "street": "Vereinsgasse 1", "street2": "", "zip": "6020", "city": "Innsbruck",
           "country": "AT"}


@pytest.fixture(autouse=True)
def public_base(monkeypatch):
    monkeypatch.setenv("PUBLIC_BACKEND_URL", "https://lsw.example.test")
    for name in ("PUBLIC_BASE_URL", "FRONTEND_URL", "SHOP_PRINTFUL_DASHBOARD_ORDER_URL"):
        monkeypatch.delenv(name, raising=False)


async def shop_ready(db, *, stage: str = "admins", switch: bool = False, key: bool = True) -> None:
    from services.secret_store import encrypt_secret

    await db.settings.update_one({"id": "shop"}, {"$set": {
        "id": "shop", "stage": stage, "orders_to_printful": switch,
        "printful_api_key": encrypt_secret(API_KEY) if key else ""}}, upsert=True)


async def prepared(db, provider):
    product = await configured(db, provider)
    await shop_ready(db)
    return product, await variant_for(db, product["id"], WHITE_M)


async def preview(db, provider, product, variant, **extra):
    values = {"product_id": product["id"], "variant_id": variant["id"], "gamertag": NAME, "address": dict(ADDRESS),
              "actor_id": ACTOR, "provider": provider, **extra}
    return await shop_test_drafts.preview(db, **values)


@pytest.mark.asyncio
async def test_the_preview_is_exactly_what_is_sent_and_printful_saves_nothing_before(db, provider, fake):
    product, variant = await prepared(db, provider)
    shown = await preview(db, provider, product, variant)
    assert fake.calls_to("createOrder") == [] and fake.orders == {}, "die Vorschau legt bei Printful nichts an"
    assert len(fake.calls_to("createOrderEstimationTask")) == 1
    assert shown["state"] == "preview" and shown["kind"] == "test_draft"
    assert shown["external_id"].startswith("lswtest-") and shown["payload"]["external_id"] == shown["external_id"]
    # Printful nimmt höchstens 32 Zeichen je external_id (#2133) - Auftrag und Position.
    assert len(shown["external_id"]) <= 32
    assert all(len(item["external_id"]) <= 32 for item in shown["payload"]["order_items"])
    assert set(shown["payload"]) == {"external_id", "shipping", "recipient", "order_items"}, "kein Feld zum Bestätigen"
    assert shown["payload"]["recipient"] == {"name": "Testverein Löwen", "address1": "Vereinsgasse 1", "city": "Innsbruck",
                                             "zip": "6020", "country_code": "AT"}
    (item,) = shown["payload"]["order_items"]
    assert item["catalog_variant_id"] == WHITE_M and item["quantity"] == 1
    # Je Fläche genau eine Datei: vorne die eigene mit Gamertag, hinten die Grunddatei - mit Prüfsumme und Adresse.
    files = {row["placement"]: row for row in shown["files"]}
    assert set(files) == {"front", "back"}
    assert files["front"]["kind"] == "personal" and files["back"]["kind"] == "base"
    base_back = await shop_print_files.latest_base(db, product["id"], "back", "all", "White")
    assert files["back"]["sha256"] == base_back["sha256"] and files["back"]["version"] == base_back["version"]
    personal = await db.shop_print_files.find_one({"id": files["front"]["file_id"]}, {"_id": 0})
    assert personal["purpose"] == "order" and personal["order_id"] == shown["id"] and personal["sha256"] == files["front"]["sha256"]
    for place in item["placements"]:
        assert place["layers"][0]["url"] == files[place["placement"]]["url"]
        assert place["layers"][0]["url"].startswith("https://lsw.example.test/api/shop/print-files/")
    assert shown["estimate"]["subtotal_cents"] == 975 and shown["estimate"]["shipping_cents"] == 495
    assert shown["mockup"] == {"state": "pending", "detail": "Mockup folgt (#1710)."}
    assert shown["price_check"]["level"] in ("ok", "warn") and shown["price_check"]["shop_cents"] == variant["price_cents"]

    sent = await shop_test_drafts.send(db, shown["id"], idempotency_key="klick-0001", actor_id=ACTOR, provider=provider)
    (call,) = fake.calls_to("createOrder")
    assert call["body"] == shown["payload"], "gesendet wird genau die Vorschau"
    assert sent["state"] == "sent" and sent["printful_status"] == "draft"
    assert fake.orders[sent["printful_order_id"]]["status"] == "draft" and fake.confirmations == []
    assert sent["deviation_summary"]["error"] == 0 and sent["deviation_summary"]["ok"] >= 6
    labels = {row["label"] for row in sent["deviations"]}
    assert {"Externe Kennung", "Stand bei Printful", "Position 1: Printful-Variante"} <= labels
    assert str(sent["printful_order_id"]) in sent["dashboard_url"]
    assert sent["dashboard_url"].startswith("https://www.printful.com/")
    log = await db.audit_logs.find_one({"action": "shop.test_draft.send"}, {"_id": 0})
    assert log["target_id"] == shown["id"] and log["data"]["printful_order_id"] == sent["printful_order_id"]
    assert NAME not in str(log) and "Vereinsgasse" not in str(log), "nie Gamertag oder Anschrift im Protokoll"
    record = await db.shop_test_drafts.find_one({"id": shown["id"]}, {"_id": 0})
    assert NAME not in str(record), "der Gamertag steht nur in der Datei, nie als Text"
    listed = await shop_test_drafts.list_drafts(db)
    assert [row["id"] for row in listed] == [shown["id"]] and "send_key" not in listed[0]


@pytest.mark.asyncio
async def test_a_test_draft_is_no_order_and_counts_nowhere(db, provider, fake, monkeypatch):
    from services import dolibarr_client

    def no_dolibarr(*_args, **_kwargs):
        raise AssertionError("ein Testentwurf ruft nie Dolibarr")

    monkeypatch.setattr(dolibarr_client.DolibarrClient, "__init__", no_dolibarr)
    product, variant = await prepared(db, provider)
    shown = await preview(db, provider, product, variant)
    await shop_test_drafts.send(db, shown["id"], idempotency_key="klick-0002", actor_id=ACTOR, provider=provider)
    for collection in ("shop_orders", "shop_order_items", "shop_order_events", "billing_cases", "shop_carts"):
        assert await db[collection].count_documents({}) == 0, collection
    assert await db.shop_test_drafts.count_documents({"kind": "test_draft"}) == 1


@pytest.mark.asyncio
async def test_drafts_go_with_the_kill_switch_off_but_never_get_confirmed(db, provider, fake):
    product, variant = await prepared(db, provider)
    shown = await preview(db, provider, product, variant)
    sent = await shop_test_drafts.send(db, shown["id"], idempotency_key="klick-0003", actor_id=ACTOR, provider=provider)
    assert sent["state"] == "sent", "Notschalter aus - der Entwurf geht trotzdem"
    # Auch mit Notschalter an: confirm_order lehnt einen Testentwurf ab, ohne Printful zu fragen.
    await shop_ready(db, switch=True)
    with pytest.raises(FulfillmentInvalid) as refused:
        await provider.confirm_order(db, PrintfulOrderId(sent["printful_order_id"]), idempotency_key="bestaetigen-01")
    assert refused.value.reason == "test_draft"
    assert fake.confirmations == [] and fake.calls_to("confirmOrder") == []
    assert await db.shop_printful_confirmations.count_documents({}) == 0
    # Die Testansicht hat keinen Weg zum Bestätigen.
    source = inspect.getsource(shop_test_drafts)
    assert "confirm_order(" not in source and not hasattr(shop_test_drafts, "confirm")


@pytest.mark.asyncio
async def test_without_stage_or_key_nothing_goes_out(db, provider, fake):
    product = await configured(db, provider)
    variant = await variant_for(db, product["id"], WHITE_M)
    await shop_ready(db, stage="off")
    with pytest.raises(PrintfulDraftsBlocked):
        await preview(db, provider, product, variant)
    await shop_ready(db, key=False)
    with pytest.raises(PrintfulDraftsBlocked):
        await preview(db, provider, product, variant)
    assert fake.calls_to("createOrderEstimationTask") == []
    assert (await shop_test_drafts.access(db))["allowed"] is False


@pytest.mark.asyncio
async def test_the_same_click_twice_sends_once(db, provider, fake):
    product, variant = await prepared(db, provider)
    shown = await preview(db, provider, product, variant)
    first = await shop_test_drafts.send(db, shown["id"], idempotency_key="klick-0004", actor_id=ACTOR, provider=provider)
    again = await shop_test_drafts.send(db, shown["id"], idempotency_key="klick-0004", actor_id=ACTOR, provider=provider)
    assert again["printful_order_id"] == first["printful_order_id"] and len(fake.calls_to("createOrder")) == 1
    with pytest.raises(ShopConflict, match="schon gesendet"):
        await shop_test_drafts.send(db, shown["id"], idempotency_key="klick-0005", actor_id=ACTOR, provider=provider)
    # Zwei gleichzeitige Klicks mit verschiedenen Schlüsseln: genau einer sendet.
    other = await preview(db, provider, product, variant)
    results = await asyncio.gather(
        shop_test_drafts.send(db, other["id"], idempotency_key="klick-0006", actor_id=ACTOR, provider=provider),
        shop_test_drafts.send(db, other["id"], idempotency_key="klick-0007", actor_id=ACTOR, provider=provider),
        return_exceptions=True)
    assert sum(1 for result in results if isinstance(result, dict)) == 1
    assert sum(1 for result in results if isinstance(result, ShopConflict)) == 1
    assert len(fake.calls_to("createOrder")) == 2


@pytest.mark.asyncio
async def test_deleting_removes_the_draft_and_the_own_files_and_keeps_the_log(db, provider, fake):
    product, variant = await prepared(db, provider)
    shown = await preview(db, provider, product, variant)
    sent = await shop_test_drafts.send(db, shown["id"], idempotency_key="klick-0008", actor_id=ACTOR, provider=provider)
    gone = await shop_test_drafts.delete(db, shown["id"], actor_id=ACTOR, provider=provider)
    assert gone["state"] == "deleted" and gone["dashboard_url"] is None
    assert sent["printful_order_id"] not in fake.orders and len(fake.calls_to("deleteOrder")) == 1
    assert await db.shop_print_files.count_documents({"order_id": shown["id"]}) == 0
    assert await db.shop_gamertag_files.count_documents({"order_id": shown["id"]}) == 0
    assert {row["sha256"] for row in gone["files"]} == {row["sha256"] for row in shown["files"]}, "Protokoll bleibt"
    assert await db.audit_logs.count_documents({"action": "shop.test_draft.delete"}) == 1
    again = await shop_test_drafts.delete(db, shown["id"], actor_id=ACTOR, provider=provider)
    assert again["state"] == "deleted" and len(fake.calls_to("deleteOrder")) == 1
    # Die external_id ist wieder frei (Claim des Adapters entfernt).
    assert await db.shop_printful_drafts.count_documents({"external_id": shown["external_id"]}) == 0


@pytest.mark.asyncio
async def test_a_draft_confirmed_in_the_dashboard_is_not_deleted_and_one_gone_there_counts_as_deleted(db, provider,
                                                                                                        fake):
    product, variant = await prepared(db, provider)
    shown = await preview(db, provider, product, variant)
    sent = await shop_test_drafts.send(db, shown["id"], idempotency_key="klick-0009", actor_id=ACTOR, provider=provider)
    fake.set_order_status(sent["printful_order_id"], "pending")
    with pytest.raises(ShopConflict, match="kein Entwurf mehr"):
        await shop_test_drafts.delete(db, shown["id"], actor_id=ACTOR, provider=provider)
    record = await db.shop_test_drafts.find_one({"id": shown["id"]}, {"_id": 0})
    assert record["state"] == "sent" and record["printful_status"] == "not_draft"
    assert sent["printful_order_id"] in fake.orders, "storniert wird hier nichts"
    # Im Dashboard gelöscht: Printful kennt ihn nicht mehr - im Protokoll gelöscht, mit Hinweis.
    del fake.orders[sent["printful_order_id"]]
    del fake.order_items[sent["printful_order_id"]]
    gone = await shop_test_drafts.delete(db, shown["id"], actor_id=ACTOR, provider=provider)
    assert gone["state"] == "deleted" and "nicht mehr vorhanden" in gone["delete_note"]


@pytest.mark.asyncio
async def test_a_refusal_by_printful_keeps_the_preview_and_logs_only_a_short_reason(db, provider, fake):
    product, variant = await prepared(db, provider)
    shown = await preview(db, provider, product, variant)
    fake.fail(400, operation="createOrder")
    with pytest.raises(FulfillmentInvalid):
        await shop_test_drafts.send(db, shown["id"], idempotency_key="klick-0010", actor_id=ACTOR, provider=provider)
    record = await db.shop_test_drafts.find_one({"id": shown["id"]}, {"_id": 0})
    assert record["state"] == "preview" and record["last_error"]["reason"] == "bad_request"
    assert record["last_error"]["text"] == "Der Anbieter lehnt die Daten ab" and API_KEY not in str(record)
    # Ein neuer Versuch geht - derselbe Auftrag, kein zweiter.
    sent = await shop_test_drafts.send(db, shown["id"], idempotency_key="klick-0011", actor_id=ACTOR, provider=provider)
    assert sent["state"] == "sent" and len(fake.orders) == 1


@pytest.mark.asyncio
async def test_the_gamertag_is_checked_like_the_real_file(db, provider, fake):
    product, variant = await prepared(db, provider)
    with pytest.raises(ShopError, match="Emojis"):
        await preview(db, provider, product, variant, gamertag="Löwe 🦁")
    with pytest.raises(ShopError, match="Gamertag-Feld"):
        await preview(db, provider, product, variant, gamertag="  ")
    with pytest.raises(ShopError, match="höchstens"):
        await preview(db, provider, product, variant, gamertag="X" * 30)
    assert await db.shop_print_files.count_documents({"purpose": "order"}) == 0
    assert await db.shop_test_drafts.count_documents({}) == 0


@pytest.mark.asyncio
async def test_address_only_austria_and_a_public_https_address_is_needed(db, provider, fake, monkeypatch):
    product, variant = await prepared(db, provider)
    with pytest.raises(ShopError, match="Österreich"):
        await preview(db, provider, product, variant, address={**ADDRESS, "country": "DE"})
    with pytest.raises(ShopError, match="street fehlt"):
        await preview(db, provider, product, variant, address={**ADDRESS, "street": ""})
    monkeypatch.setenv("PUBLIC_BACKEND_URL", "http://localhost:8001")
    with pytest.raises(ShopError, match="https-Adresse"):
        await preview(db, provider, product, variant)
    assert await db.shop_print_files.count_documents({"purpose": "order"}) == 0, "keine Dateileichen"


@pytest.mark.asyncio
async def test_a_new_preview_replaces_the_old_one_and_an_old_preview_cannot_be_sent(db, provider, fake):
    from models import now_utc

    product, variant = await prepared(db, provider)
    first = await preview(db, provider, product, variant)
    second = await preview(db, provider, product, variant)
    assert await db.shop_test_drafts.count_documents({"id": first["id"]}) == 0
    assert await db.shop_print_files.count_documents({"order_id": first["id"]}) == 0
    with pytest.raises(LookupError):
        await shop_test_drafts.send(db, first["id"], idempotency_key="klick-0012", actor_id=ACTOR, provider=provider)
    await db.shop_test_drafts.update_one({"id": second["id"]},
                                         {"$set": {"expires_at": (now_utc() - timedelta(minutes=1)).isoformat()}})
    with pytest.raises(ShopError, match="abgelaufen"):
        await shop_test_drafts.send(db, second["id"], idempotency_key="klick-0013", actor_id=ACTOR, provider=provider)
    assert fake.calls_to("createOrder") == []


@pytest.mark.asyncio
async def test_only_so_many_test_drafts_lie_at_printful(db, provider, fake, monkeypatch):
    monkeypatch.setenv("SHOP_TEST_DRAFT_MAX_OPEN", "1")
    product, variant = await prepared(db, provider)
    shown = await preview(db, provider, product, variant)
    await shop_test_drafts.send(db, shown["id"], idempotency_key="klick-0014", actor_id=ACTOR, provider=provider)
    other = await preview(db, provider, product, variant)
    with pytest.raises(ShopConflict, match="erst einen löschen"):
        await shop_test_drafts.send(db, other["id"], idempotency_key="klick-0015", actor_id=ACTOR, provider=provider)


# ---------------------------------------------------------------- Review: unklarer Ausgang, Rennen, hängende Stände

def timeout_after_creating(fake):
    """Printful legt den Auftrag an, die Antwort geht aber verloren (Zeitüberschreitung nach dem Anlegen)."""
    import httpx

    original = fake._op_createOrder

    def create_then_time_out(args, params, body):
        original(args, params, body)
        fake._op_createOrder = original
        raise httpx.ReadTimeout("Antwort verloren (Test)")

    fake._op_createOrder = create_then_time_out


async def age_claim(db, external_id: str) -> None:
    from models import now_utc

    await db.shop_printful_drafts.update_one({"external_id": external_id}, {"$set": {
        "claimed_at": (now_utc() - timedelta(minutes=5)).isoformat()}})


@pytest.mark.asyncio
async def test_a_timeout_after_creating_keeps_the_draft_traceable_and_deletable(db, provider, fake):
    from services.shop_fulfillment import FulfillmentTransient

    product, variant = await prepared(db, provider)
    shown = await preview(db, provider, product, variant)
    timeout_after_creating(fake)
    with pytest.raises(FulfillmentTransient):
        await shop_test_drafts.send(db, shown["id"], idempotency_key="klick-0020", actor_id=ACTOR, provider=provider)
    assert len(fake.orders) == 1, "Printful hat den Entwurf trotzdem angelegt"
    record = await db.shop_test_drafts.find_one({"id": shown["id"]}, {"_id": 0})
    assert record["state"] == "unclear" and record["send_attempted_at"] and record["last_error"]["reason"] == "timeout"
    # Eine neue Vorschau (Aufräumen) und eine abgelaufene Frist verwerfen ihn nicht.
    await db.shop_test_drafts.update_one({"id": shown["id"]}, {"$set": {"expires_at": "2000-01-01T00:00:00+00:00"}})
    await preview(db, provider, product, variant)
    assert await db.shop_test_drafts.count_documents({"id": shown["id"]}) == 1
    assert await db.shop_print_files.count_documents({"order_id": shown["id"]}) == 1, "die Datei mit Gamertag bleibt"
    (listed,) = [row for row in await shop_test_drafts.list_drafts(db) if row["id"] == shown["id"]]
    assert listed["actions"] == {"resend": True, "delete": True, "recheck": False}
    # „Erneut senden / nachsehen“: derselbe Rumpf, der Claim findet den Auftrag über die external_id - kein zweiter.
    await age_claim(db, shown["external_id"])
    again = await shop_test_drafts.send(db, shown["id"], idempotency_key="klick-0021", actor_id=ACTOR, provider=provider)
    assert again["state"] == "sent" and len(fake.calls_to("createOrder")) == 1 and len(fake.orders) == 1
    assert again["actions"] == {"resend": False, "delete": True, "recheck": True}
    gone = await shop_test_drafts.delete(db, shown["id"], actor_id=ACTOR, provider=provider)
    assert gone["state"] == "deleted" and fake.orders == {}


@pytest.mark.asyncio
async def test_a_failed_read_after_creating_is_unclear_and_found_again(db, provider, fake):
    from services.shop_fulfillment import FulfillmentTransient

    product, variant = await prepared(db, provider)
    shown = await preview(db, provider, product, variant)
    original = fake._op_createOrder

    def create_then_break_reading(args, params, body):
        fake._op_createOrder = original
        fake.fail(503, operation="getOrder", times=3)  # das Nachlesen nach dem Anlegen scheitert dreimal
        return original(args, params, body)

    fake._op_createOrder = create_then_break_reading
    with pytest.raises(FulfillmentTransient):
        await shop_test_drafts.send(db, shown["id"], idempotency_key="klick-0022", actor_id=ACTOR, provider=provider)
    assert (await db.shop_test_drafts.find_one({"id": shown["id"]}))["state"] == "unclear"
    again = await shop_test_drafts.send(db, shown["id"], idempotency_key="klick-0023", actor_id=ACTOR, provider=provider)
    assert again["state"] == "sent" and len(fake.calls_to("createOrder")) == 1


@pytest.mark.asyncio
async def test_unclear_and_hanging_entries_do_not_block_the_limit_and_a_hanging_delete_is_taken_over(
        db, provider, fake, monkeypatch):
    from models import now_utc

    monkeypatch.setenv("SHOP_TEST_DRAFT_MAX_OPEN", "1")
    product, variant = await prepared(db, provider)
    stuck = await preview(db, provider, product, variant)
    timeout_after_creating(fake)
    with pytest.raises(Exception):
        await shop_test_drafts.send(db, stuck["id"], idempotency_key="klick-0024", actor_id=ACTOR, provider=provider)
    shown = await preview(db, provider, product, variant)
    sent = await shop_test_drafts.send(db, shown["id"], idempotency_key="klick-0025", actor_id=ACTOR, provider=provider)
    assert sent["state"] == "sent", "ein unklarer Eintrag blockiert die Obergrenze nicht"
    # Ein frisches „wird gelöscht“ wartet; ein altes übernimmt der nächste Klick.
    await db.shop_test_drafts.update_one({"id": shown["id"]}, {"$set": {
        "state": "deleting", "deleting_at": now_utc().isoformat()}})
    with pytest.raises(ShopConflict, match="gerade gelöscht"):
        await shop_test_drafts.delete(db, shown["id"], actor_id=ACTOR, provider=provider)
    old = (now_utc() - timedelta(minutes=5)).isoformat()
    await db.shop_test_drafts.update_one({"id": shown["id"]}, {"$set": {"deleting_at": old}})
    assert (await shop_test_drafts.get_view(db, shown["id"]))["actions"]["delete"] is True
    gone = await shop_test_drafts.delete(db, shown["id"], actor_id=ACTOR, provider=provider)
    assert gone["state"] == "deleted" and sent["printful_order_id"] not in fake.orders
    # Ein altes „wird gesendet“ bietet „Erneut senden“ an.
    await db.shop_test_drafts.update_one({"id": stuck["id"]}, {"$set": {"state": "sending", "sending_at": old}})
    assert (await shop_test_drafts.get_view(db, stuck["id"]))["actions"]["resend"] is True


@pytest.mark.asyncio
async def test_discarding_a_preview_that_is_being_sent_keeps_everything(db, provider, fake, monkeypatch):
    product, variant = await prepared(db, provider)
    shown = await preview(db, provider, product, variant)
    stale = await db.shop_test_drafts.find_one({"id": shown["id"]}, {"_id": 0})
    await db.shop_test_drafts.update_one({"id": shown["id"]}, {"$set": {"state": "sending"}})
    assert await shop_test_drafts._discard(db, stale) is False
    assert await db.shop_print_files.count_documents({"order_id": shown["id"]}) == 1
    # Der Lösch-Knopf auf einer Vorschau, die gerade jemand sendet: 409, nichts verworfen.

    async def stale_get(_db, _draft_id):
        return dict(stale)

    monkeypatch.setattr(shop_test_drafts, "_get", stale_get)
    with pytest.raises(ShopConflict, match="gerade gesendet"):
        await shop_test_drafts.delete(db, shown["id"], actor_id=ACTOR, provider=provider)
    assert await db.shop_test_drafts.count_documents({"id": shown["id"]}) == 1
    assert await db.shop_print_files.count_documents({"order_id": shown["id"]}) == 1


@pytest.mark.asyncio
async def test_a_preview_with_a_claim_at_printful_is_never_discarded(db, provider, fake):
    product, variant = await prepared(db, provider)
    shown = await preview(db, provider, product, variant)
    await db.shop_printful_drafts.insert_one({"external_id": shown["external_id"], "state": "created",
                                              "printful_order_id": 9999})
    await preview(db, provider, product, variant)
    record = await db.shop_test_drafts.find_one({"id": shown["id"]}, {"_id": 0})
    assert record["state"] == "unclear"
    assert await db.shop_print_files.count_documents({"order_id": shown["id"]}) == 1


@pytest.mark.asyncio
async def test_open_test_drafts_can_be_deleted_with_the_shop_off_but_real_drafts_cannot(db, provider, fake):
    from services.shop_config import PrintfulDraftsBlocked as Blocked

    product, variant = await prepared(db, provider)
    shown = await preview(db, provider, product, variant)
    sent = await shop_test_drafts.send(db, shown["id"], idempotency_key="klick-0026", actor_id=ACTOR, provider=provider)
    await shop_ready(db, stage="off")
    with pytest.raises(Blocked):
        await preview(db, provider, product, variant)
    # Ein echter Entwurf (ohne Test-Präfix) bleibt hinter der Stufe - auch der Adapter-Weg für Testentwürfe lehnt ihn ab.
    await shop_ready(db)
    real = await provider.create_draft(db, shop_test_drafts.draft_from_payload(
        {**sent["payload"], "external_id": "lsw-auftrag-0001"}))
    await shop_ready(db, stage="off")
    with pytest.raises(Blocked):
        await provider.delete_draft(db, real.id)
    with pytest.raises(FulfillmentInvalid) as refused:
        await provider.delete_draft(db, real.id, test_draft=True)
    assert refused.value.reason == "not_test_draft" and real.id.value in fake.orders
    gone = await shop_test_drafts.delete(db, shown["id"], actor_id=ACTOR, provider=provider)
    assert gone["state"] == "deleted" and sent["printful_order_id"] not in fake.orders
    # Ohne Schlüssel geht auch das Aufräumen nicht.
    await shop_ready(db, stage="off", key=False)
    with pytest.raises(Blocked):
        await provider.delete_draft(db, real.id, test_draft=True)


@pytest.mark.asyncio
async def test_confirm_refuses_every_test_external_id_even_without_a_record(db, provider, fake):
    product, variant = await prepared(db, provider)
    shown = await preview(db, provider, product, variant)
    order = await provider.create_draft(db, shop_test_drafts.draft_from_payload(shown["payload"]))
    await db.shop_test_drafts.delete_many({})  # die Protokollzeile fehlt - der Präfix allein reicht
    await shop_ready(db, switch=True)
    with pytest.raises(FulfillmentInvalid) as refused:
        await provider.confirm_order(db, order.id, idempotency_key="bestaetigen-02")
    assert refused.value.reason == "test_draft" and fake.calls_to("confirmOrder") == []
    assert await db.shop_printful_confirmations.count_documents({}) == 0


def test_deviations_are_marked_by_level():
    record = {"payload": {"external_id": "lsw-test-1", "order_items": [{
        "external_id": "p1", "catalog_variant_id": 4014, "quantity": 1,
        "placements": [{"placement": "front", "technique": "dtg", "layers": [{"type": "file", "url": "https://a/x.png"}]}]}]},
        "estimate": {"subtotal_cents": 975, "shipping_cents": 495, "total_cents": 1764}}
    order = {"external_id": "lsw-test-1", "status": "draft", "costs": {"subtotal_cents": 975, "shipping_cents": 595,
                                                                         "total_cents": 1864},
             "items": [{"external_id": "p1", "variant_id": 4015, "quantity": 1, "placements": [
                 {"placement": "front", "technique": "dtg", "file_urls": ["https://a/x.png"], "status": "waiting",
                  "status_explanation": ""},
                 {"placement": "back", "technique": "dtg", "file_urls": ["https://a/y.png"], "status": "ok"}]}]}
    rows = {row["label"]: row["level"] for row in shop_test_drafts.compare(record, order)}
    assert rows["Position 1: Printful-Variante"] == "error", "andere Variante = falsch übergeben"
    assert rows["Position 1: Fläche back"] == "error", "Fläche, die nicht gesendet wurde"
    assert rows["Position 1: Fläche front (dtg)"] == "ok"
    assert rows["Position 1: Datei front bei Printful"] == "warn"
    assert rows["Preis: Versand (Schätzung → Auftrag)"] == "warn" and rows["Preis: Ware (Schätzung → Auftrag)"] == "ok"


def test_the_dashboard_link_only_points_to_printful(monkeypatch):
    assert shop_test_drafts.dashboard_url(9001) == "https://www.printful.com/dashboard/default/orders?search=9001"
    monkeypatch.setenv("SHOP_PRINTFUL_DASHBOARD_ORDER_URL", "https://www.printful.com/dashboard/orders/{order_id}")
    assert shop_test_drafts.dashboard_url(9001) == "https://www.printful.com/dashboard/orders/9001"
    monkeypatch.setenv("SHOP_PRINTFUL_DASHBOARD_ORDER_URL", "https://boese.example.test/{order_id}")
    assert shop_test_drafts.dashboard_url(9001).startswith("https://www.printful.com/")
    assert shop_test_drafts.dashboard_url(None) is None


def test_the_preview_payload_round_trips_and_a_changed_one_is_refused():
    payload = {"external_id": "lsw-test-1", "shipping": "STANDARD",
               "recipient": {"name": "Testverein", "address1": "Gasse 1", "city": "Wien", "zip": "1010",
                             "country_code": "AT"},
               "order_items": [{"source": "catalog", "catalog_variant_id": 4014, "quantity": 1, "external_id": "p1",
                                "name": "Shirt", "placements": [{"placement": "front", "technique": "dtg", "layers": [
                                    {"type": "file", "url": "https://a.example.test/x.png"}]}]}]}
    assert printful_client.order_payload(shop_test_drafts.draft_from_payload(payload)) == payload
    with pytest.raises(ShopError, match="beschädigt"):
        shop_test_drafts.draft_from_payload({**payload, "confirm": True})


# ---------------------------------------------------------------- Nachprüfung: offenen Ausgang aufräumen (N1, N2)

async def unclear_draft(db, provider, fake) -> dict:
    """Ein Testentwurf mit offenem Ausgang, den Printful trotzdem angelegt hat."""
    from services.shop_fulfillment import FulfillmentTransient

    product, variant = await prepared(db, provider)
    shown = await preview(db, provider, product, variant)
    timeout_after_creating(fake)
    with pytest.raises(FulfillmentTransient):
        await shop_test_drafts.send(db, shown["id"], idempotency_key="klick-0030", actor_id=ACTOR, provider=provider)
    assert (await db.shop_test_drafts.find_one({"id": shown["id"]}))["state"] == "unclear"
    return shown


@pytest.mark.asyncio
async def test_an_unclear_draft_is_cleaned_up_with_the_shop_off(db, provider, fake):
    shown = await unclear_draft(db, provider, fake)
    (order_id,) = fake.orders
    await shop_ready(db, stage="off")
    with pytest.raises(PrintfulDraftsBlocked):  # erneut senden braucht die Stufe ...
        await shop_test_drafts.send(db, shown["id"], idempotency_key="klick-0031", actor_id=ACTOR, provider=provider)
    gone = await shop_test_drafts.delete(db, shown["id"], actor_id=ACTOR, provider=provider)  # ... aufräumen nicht
    assert gone["state"] == "deleted" and gone["printful_order_id"] == order_id and fake.orders == {}
    assert any(call["path"].endswith(f"/@{shown['external_id']}") for call in fake.calls_to("getOrder"))
    assert len(fake.calls_to("deleteOrder")) == 1 and len(fake.calls_to("createOrder")) == 1
    assert await db.shop_print_files.count_documents({"order_id": shown["id"]}) == 0
    log = await db.audit_logs.find_one({"action": "shop.test_draft.delete"}, {"_id": 0})
    assert log["data"]["printful_order_id"] == order_id


@pytest.mark.asyncio
async def test_an_unclear_draft_with_a_file_taken_off_line_can_still_be_deleted(db, provider, fake):
    shown = await unclear_draft(db, provider, fake)
    personal = next(row for row in shown["files"] if row["kind"] == "personal")
    await db.shop_print_files.update_one({"id": personal["file_id"]}, {"$set": {"public_disabled_at": "2026-10-27"}})
    with pytest.raises(ShopError, match="nicht mehr da"):
        await shop_test_drafts.send(db, shown["id"], idempotency_key="klick-0032", actor_id=ACTOR, provider=provider)
    gone = await shop_test_drafts.delete(db, shown["id"], actor_id=ACTOR, provider=provider)
    assert gone["state"] == "deleted" and fake.orders == {}


@pytest.mark.asyncio
async def test_an_unclear_draft_printful_never_shows_waits_for_the_grace_time_then_counts_as_deleted(db, provider,
                                                                                                    fake):
    from models import now_utc

    shown = await unclear_draft(db, provider, fake)
    fake.orders.clear()  # Printful kennt den Auftrag nicht (nie angelegt oder schon weg)
    fake.order_items.clear()
    with pytest.raises(ShopConflict, match="noch nicht"):
        await shop_test_drafts.delete(db, shown["id"], actor_id=ACTOR, provider=provider)
    record = await db.shop_test_drafts.find_one({"id": shown["id"]}, {"_id": 0})
    assert record["state"] == "unclear" and await db.shop_print_files.count_documents({"order_id": shown["id"]}) == 1
    old = (now_utc() - timedelta(minutes=11)).isoformat()
    await db.shop_printful_drafts.update_one({"external_id": shown["external_id"]}, {"$set": {"claimed_at": old}})
    await db.shop_test_drafts.update_one({"id": shown["id"]}, {"$set": {"send_attempted_at": old, "sending_at": old}})
    gone = await shop_test_drafts.delete(db, shown["id"], actor_id=ACTOR, provider=provider)
    assert gone["state"] == "deleted" and gone.get("printful_order_id") is None and "nicht angelegt" in gone["delete_note"]
    assert await db.shop_print_files.count_documents({"order_id": shown["id"]}) == 0
    assert await db.shop_printful_drafts.count_documents({"external_id": shown["external_id"]}) == 0
    assert fake.calls_to("deleteOrder") == []


@pytest.mark.asyncio
async def test_a_failed_lookup_puts_the_draft_back_to_unclear(db, provider, fake):
    shown = await unclear_draft(db, provider, fake)
    fake.fail(503, operation="getOrder", times=3)
    with pytest.raises(Exception):
        await shop_test_drafts.delete(db, shown["id"], actor_id=ACTOR, provider=provider)
    record = await db.shop_test_drafts.find_one({"id": shown["id"]}, {"_id": 0})
    assert record["state"] == "unclear" and record["last_error"]["reason"] == "server" and len(fake.orders) == 1


def test_the_printful_order_status_reads_german():
    """#2105: der Stand bei Printful steht deutsch daneben - ein unbekannter bleibt, wie Printful ihn liefert."""
    def label(status):
        return shop_test_drafts.view({"id": "t", "printful_status": status})["printful_status_label"]

    assert (label("draft"), label("inprocess"), label("wormhole"), label(None)) == (
        "Entwurf", "in Produktion", "wormhole", None)
