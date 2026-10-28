"""Vereinsnummer im Druck (#2150, Teil von #1727): die Wunschnummer (#2034) kommt mit Einwilligung je Position in die
Bestelldatei - in exakter Größe, Farbe und Kontur wie in der Vorschau, als eigene personenbezogene Datei.

Geprüft: Größe der Nummer in der Bestelldatei, eine Fläche nur mit Nummer ergibt eine eigene Datei, ohne Einwilligung
bzw. ohne Nummer bzw. als Nicht-Mitglied wird abgelehnt (ohne Dateileichen, nie die Nummer im Log), Kontolöschung,
ausstehende Löschung und Datenauskunft, der Testentwurf mit Beispielnummer und die Vorab-Prüfung ohne Sperre.
Erfundene Nummern und Konten, nur synthetische Bilder."""
import logging
import pathlib
import re
import sys
from io import BytesIO

import pytest
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from services import shop_catalog, shop_designs, shop_gamertag, shop_orders  # noqa: E402
from services import shop_print_files, shop_products  # noqa: E402
from services.shop_common import ShopError  # noqa: E402
from shop_testdata import publish_unchecked  # noqa: E402
from test_shop_products_unit import (  # noqa: E402,F401 - Fixtures und Helfer der Produktverwaltung
    BACK, BILLING, BY, LION, SHIPPING, WHITE_M, configured, db, design_dir, fake, provider, variant_for)

CM = 2.54
SPORT = "saira-condensed-900"
MEMBER = "konto-nummer"
NUMBER = "8086"  # erfunden; im Log als ganzes Wort gesucht (Kennungen enthalten Ziffern nur mitten im Wort)
BIG_NUMBER = {"kind": "member_number", "preset": "text_center", "text_height_cm": 8.0, "max_width_cm": 25.0,
              "font": SPORT, "ink": "reinweiss", "outline_cm": 0.3}
CHEST_NUMBER = {"kind": "member_number", "preset": "text_opposite"}


def px(cm: float, dpi: int = 150) -> float:
    return cm / CM * dpi


async def member(db, user_id: str = MEMBER, *, number: str | None = NUMBER, status: str = "active") -> None:
    await db.memberships.insert_one({"user_id": user_id, "member_status": status})
    if number is not None:
        await db.jersey_numbers.insert_one({"id": f"jn-{user_id}", "user_id": user_id, "number": int(number),
                                            "number_key": str(int(number)), "can_choose": False, "log": []})


async def number_product(db, provider, back: list | None = None, front: list | None = None,
                         personalization: str = "both", **fields) -> dict:
    # Mit „beides“: der Aufbau von ``configured`` hat vorne einen Gamertag; danach ersetzt ``set_layout`` die Flächen.
    product = await configured(db, provider, generate=False, personalization=personalization, **fields)
    await shop_products.set_layout(db, product["id"], [{"key": "front", "layers": front or [LION]},
                                                       {"key": "back", "layers": back or [BACK, BIG_NUMBER]}],
                                   included_placement="front", **BY)
    await shop_products.generate_print_files(db, product["id"], **BY)
    await publish_unchecked(db, product["id"])
    return product


async def order(db, variant: dict, *, key: str = "nummer-0001", user_id: str = MEMBER, consent=True,
                buyer_kind: str = "member", gamertag: str | None = None, extra: list | None = None):
    line = {"variant_id": variant["id"], "quantity": 1, "gamertag": gamertag}
    if consent is not None:
        line["number_consent"] = consent
    return await shop_orders.place_order(
        db, idempotency_key=key, lines=[line, *(extra or [])], user_id=user_id, buyer_kind=buyer_kind,
        shipping_estimate_cents=490, billing_address=dict(BILLING), shipping_address=dict(SHIPPING), actor_id=user_id)


async def plan_of(db, product_id: str, color: str, placement: str) -> shop_print_files.Plan:
    product = await shop_catalog.get_product(db, product_id)
    plans, _context = await shop_print_files.plans_for(db, product)
    return next(plan for row, plan, plan_color, _ids in plans if row["key"] == placement and plan_color == color)


async def order_files(db) -> tuple[int, int]:
    return (await db.shop_print_files.count_documents({"purpose": "order"}),
            await db.shop_gamertag_files.count_documents({"purpose": "order"}))


# ---------------------------------------------------------------- Druck

@pytest.mark.asyncio
async def test_the_number_comes_into_the_order_file_in_exact_size_colour_and_outline(db, provider):
    await member(db)
    # Hinten nur die Nummer - so misst der Test ihre Pixel ohne das (weiße) Rückenmotiv darunter.
    product = await number_product(db, provider, back=[BIG_NUMBER])
    white = await variant_for(db, product["id"], WHITE_M)
    placed, created = await order(db, white)
    assert created
    (item,) = await shop_orders.items_for(db, placed["id"])
    assert item["print_number"] == NUMBER, "vom Server aus der Wunschnummer gelesen"
    consent = item["number_consent"]
    assert consent == {"given_at": placed["created_at"], **shop_orders.number_consent_terms()}
    assert consent["text"] == shop_orders.NUMBER_CONSENT_TEXT and consent["version"] == "2026-10-28"
    back = next(row for row in item["print_files"] if row["placement"] == "back")
    assert back["kind"] == "personal" and back["number_file_id"] and back["gamertag_file_id"] is None
    number_row = await db.shop_gamertag_files.find_one({"id": back["number_file_id"]}, {"_id": 0})
    assert number_row["kind"] == "number" and number_row["purpose"] == "order"
    assert (number_row["user_id"], number_row["order_id"], number_row["order_item_id"]) == (MEMBER, placed["id"],
                                                                                           item["id"])
    # Genau wie Vorschau und Plan: dieselben Regeln der Ebene (Größe, Schrift, Kontur), dieselbe Farbe.
    plan = await plan_of(db, product["id"], "White", "back")
    (layer,) = plan.texts
    rules = shop_gamertag.layer_rules(await shop_gamertag.load_rules(db), layer.spec)
    expected = shop_gamertag.render(NUMBER, rules, color_key=layer.ink, kind="number")
    assert number_row["sha256"] == expected.sha256 and number_row["color_key"] == "reinweiss"
    left, top, width, height = layer.box.rounded()
    assert (width, height) == pytest.approx((number_row["width_px"] * 150 / number_row["dpi"],
                                             number_row["height_px"] * 150 / number_row["dpi"]), abs=1)
    personal = await db.shop_print_files.find_one({"id": back["file_id"]}, {"_id": 0})
    assert personal["purpose"] == "order" and personal["number_file_id"] == number_row["id"]
    with Image.open(shop_designs._path_of(personal["file_ref"])) as img:
        assert img.size == (1800, 2400)
        white_rows = [y for y in range(top, top + height)
                      if any(img.getpixel((x, y))[:3] == (255, 255, 255) and img.getpixel((x, y))[3] > 200
                             for x in range(left, left + width, 3))]
        colours = {img.getpixel((x, top + height // 2))[:3] for x in range(left, left + width)
                   if img.getpixel((x, top + height // 2))[3] == 255}
    # Die Ziffern 8 cm hoch: bei 150 DPI gut 472 px (runde Ziffern ragen ein paar Prozent über, dazu Kantenglättung).
    assert max(white_rows) - min(white_rows) == pytest.approx(px(8.0), rel=0.04)
    assert {(255, 255, 255), (0, 0, 0)} <= colours, "weiße Ziffern mit schwarzer Kontur"
    # Vorne bleibt die Grunddatei (keine Nummer, kein Name).
    front = next(row for row in item["print_files"] if row["placement"] == "front")
    assert front["kind"] == "base"


@pytest.mark.asyncio
async def test_only_a_number_without_gamertag_gives_its_own_file(db, provider):
    await member(db, number="7")
    product = await number_product(db, provider, front=[LION, CHEST_NUMBER], back=[BACK])
    white = await variant_for(db, product["id"], WHITE_M)
    placed, _ = await order(db, white)
    (item,) = await shop_orders.items_for(db, placed["id"])
    files = {row["placement"]: row for row in item["print_files"]}
    assert files["front"]["kind"] == "personal" and files["back"]["kind"] == "base"
    assert files["front"]["number_file_id"] and not files["front"]["gamertag_file_id"]
    base = await shop_print_files.current_base(db, product["id"], await plan_of(db, product["id"], "White", "front"))
    assert files["front"]["sha256"] != base["sha256"], "die Nummer steht in der eigenen Datei"


@pytest.mark.asyncio
async def test_gamertag_and_number_on_one_area_come_into_one_file(db, provider):
    await member(db, number="23")
    name = {"kind": "gamertag", "preset": "text_back_top", "text_height_cm": 5.0, "max_width_cm": 25.0}
    product = await number_product(db, provider, back=[BACK, name, {**BIG_NUMBER, "preset": "text_center"}])
    white = await variant_for(db, product["id"], WHITE_M)
    placed, _ = await order(db, white, gamertag="TELL")
    (item,) = await shop_orders.items_for(db, placed["id"])
    back = next(row for row in item["print_files"] if row["placement"] == "back")
    assert back["kind"] == "personal" and back["gamertag_file_id"] and back["number_file_id"]
    assert await db.shop_print_files.count_documents({"purpose": "order"}) == 1, "eine Datei je Fläche"
    kinds = [row.get("kind", "gamertag") async for row in db.shop_gamertag_files.find({"order_id": placed["id"]})]
    assert sorted(kinds) == ["gamertag", "number"]


# ---------------------------------------------------------------- Ablehnen

@pytest.mark.asyncio
async def test_missing_consent_or_number_blocks_and_non_members_are_refused(db, provider, caplog):
    caplog.set_level(logging.DEBUG)
    await member(db)
    await member(db, "konto-ohne-nummer", number=None)
    await member(db, "konto-ausgetreten", status="former")
    product = await number_product(db, provider)
    white = await variant_for(db, product["id"], WHITE_M)
    cases = [
        ({"consent": None}, "Einwilligung"),
        ({"consent": False}, "Einwilligung"),
        ({"consent": "ja"}, "Einwilligung: ja oder nein"),
        ({"user_id": "konto-ohne-nummer"}, "noch keine Vereinsnummer"),
        ({"user_id": "konto-ausgetreten"}, "nur für Vereinsmitglieder"),
        ({"user_id": "konto-fremd"}, "nur für Vereinsmitglieder"),
        ({"buyer_kind": "public"}, "nur für Vereinsmitglieder"),
    ]
    for index, (kwargs, message) in enumerate(cases):
        with pytest.raises(ShopError, match=message):
            await order(db, white, key=f"abgelehnt-{index:04d}", **kwargs)
    assert await db.shop_orders.count_documents({}) == 0 and await order_files(db) == (0, 0)
    # Einwilligung für ein Produkt ohne Nummer (etwa, weil sich der Aufbau seit dem Warenkorb geändert hat): still
    # übergangen und nicht gespeichert.
    plain = await configured(db, provider, title="Shirt ohne Nummer")
    await publish_unchecked(db, plain["id"])
    without, _ = await order(db, await variant_for(db, plain["id"], WHITE_M), key="ohne-nummer-01", gamertag="TELL")
    (item,) = await shop_orders.items_for(db, without["id"])
    assert item["print_number"] is None and item["number_consent"] is None
    await db.shop_orders.delete_many({})
    await shop_print_files.discard_order_files(db, without["id"])
    # Eine spätere Position scheitert: die Nummerndatei der ersten ist wieder weg.
    with pytest.raises(ShopError):
        await order(db, white, key="zwei-positionen", extra=[{"variant_id": "gibt-es-nicht", "quantity": 1}])
    assert await order_files(db) == (0, 0)
    # Passt die Nummer nicht in die Ebene (Fläche zu klein für vier Stellen): nicht bestellbar - ohne Rat an die
    # Kundschaft, die Nummer zu ändern, und ohne die Nummer in Meldung oder Log.
    narrow = await number_product(db, provider, back=[BACK, {**BIG_NUMBER, "text_height_cm": 15.0,
                                                             "min_text_height_cm": 15.0}],
                                  title="Trikot zu schmal")
    with pytest.raises(ShopError, match=shop_print_files.NOT_ORDERABLE) as refused:
        await order(db, await variant_for(db, narrow["id"], WHITE_M), key="zu-schmal-0001")
    assert NUMBER not in str(refused.value) and await order_files(db) == (0, 0)
    assert not [record for record in caplog.records if re.search(rf"\b{NUMBER}\b", record.getMessage())], \
        "die Nummer steht nie im Log"


@pytest.mark.asyncio
async def test_the_cart_keeps_no_consent_and_a_repeat_gives_the_same_order(db, provider):
    await member(db)
    product = await number_product(db, provider)
    white = await variant_for(db, product["id"], WHITE_M)
    cart = await shop_orders.save_cart(db, MEMBER, [{"variant_id": white["id"], "quantity": 1, "number_consent": True}])
    assert "number_consent" not in cart["items"][0], "die Einwilligung gibt es nur im Checkout"
    first, created = await order(db, white)
    again, repeated = await order(db, white)
    assert created and not repeated and again["id"] == first["id"]
    events = await shop_orders.events_for(db, first["id"])
    assert NUMBER not in str(events), "Ereignisse (und damit Mails daraus) tragen nie die Nummer"


# ---------------------------------------------------------------- Löschen und Auskunft

@pytest.mark.asyncio
async def test_erasure_export_and_pending_deletion_cover_the_number_files(db, provider):
    from routes import dsgvo_routes

    await db.users.insert_one({"id": MEMBER, "username": "testmitglied", "email": "testmitglied@example.invalid"})
    await member(db)
    name = {"kind": "gamertag", "preset": "text_back_top", "text_height_cm": 5.0, "max_width_cm": 25.0}
    product = await number_product(db, provider, back=[BACK, name, BIG_NUMBER])
    white = await variant_for(db, product["id"], WHITE_M)
    done, _ = await order(db, white, key="nummer-fertig", gamertag="TELL")
    running, _ = await order(db, white, key="nummer-laeuft", gamertag="TELL")
    await db.shop_orders.update_one({"id": running["id"]}, {"$set": {"printful_order_id": 4711}})

    export = await dsgvo_routes._user_data_export(db, MEMBER)
    numbers = [row for row in export["shop_gamertag_files"] if row.get("kind") == "number"]
    assert sorted(row["order_id"] for row in numbers) == sorted([done["id"], running["id"]])
    assert all("file_ref" not in row and "public_id" not in row for row in numbers)
    assert {row["print_number"] for row in export["shop_order_items"]} == {NUMBER}

    # Die ganze Kontolöschung - wie „Konto löschen“ bzw. die Löschung durch den Vorstand.
    await dsgvo_routes._anonymize_user_data(db, MEMBER, "vorstand-test", "user.admin_anonymize")
    items = await db.shop_order_items.find({"user_id": MEMBER}, {"_id": 0}).to_list(None)
    assert len(items) == 2
    for item in items:
        assert item["print_number"] is None and item["number_consent"]["version"], "Nachweis bleibt, Nummer geht"
    rows = await db.shop_gamertag_files.find({"kind": "number"}, {"_id": 0}).to_list(None)
    assert sorted(bool(row.get("erase_pending_at")) for row in rows) == [False, True]
    assert all(row["user_id"] is None for row in rows)
    assert await db.shop_print_files.count_documents({"purpose": "order", "user_id": MEMBER}) == 0
    assert await db.shop_print_files.count_documents({"purpose": "order", "file_deleted_at": {"$exists": True}}) == 1
    pending = await db.shop_gamertag_files.find_one({"order_id": running["id"], "kind": "number"}, {"_id": 0})
    assert pending["erase_pending_at"] and pending["user_id"] is None
    assert pending["sha256"], "solange Printful die Datei braucht, bleibt sie samt Prüfsumme"
    erased_content(await db.shop_gamertag_files.find({"order_id": done["id"]}, {"_id": 0}).to_list(None),
                   await db.shop_print_files.find({"order_id": done["id"]}, {"_id": 0}).to_list(None),
                   await shop_orders.items_for(db, done["id"]))
    await db.shop_orders.update_one({"id": running["id"]}, {"$set": {"status": "shipped"}})
    assert await shop_gamertag.complete_pending_erasures(db) == 2  # Name und Nummer
    assert await shop_print_files.complete_pending_erasures(db) == 1
    rows = await db.shop_gamertag_files.find({"purpose": "order"}, {"_id": 0}).to_list(None)
    assert sorted(row.get("kind", "gamertag") for row in rows) == ["gamertag", "gamertag", "number", "number"]
    for row in rows:
        assert row["file_deleted_at"] and row["public_disabled_at"] and row["user_id"] is None
        assert not shop_designs._path_of(row["file_ref"]).exists()
    erased_content(rows, await db.shop_print_files.find({"purpose": "order"}, {"_id": 0}).to_list(None),
                   await shop_orders.items_for(db, done["id"]) + await shop_orders.items_for(db, running["id"]))


def erased_content(text_rows: list[dict], print_rows: list[dict], items: list[dict]) -> None:
    """Nach dem Löschen nichts mehr, woraus sich Name oder Nummer per Durchprobieren zurückrechnen ließen (#2150)."""
    assert text_rows and print_rows and items
    for row in text_rows:
        assert not set(row) & set(shop_gamertag.CONTENT_FIELDS), row
        assert row["file_deleted_at"] and row["width_px"] and row["rules_hash"], "Nachweis: Datei war da, gelöscht am"
    for row in print_rows:
        assert not set(row) & set(shop_print_files.CONTENT_FIELDS), row
        assert row["file_deleted_at"] and shop_print_files.file_name(row) == "druck-entfernt.png"
    for item in items:
        personal = [entry for entry in item["print_files"] if entry["kind"] == "personal"]
        assert personal and all(entry["sha256"] is None for entry in personal)
        assert all(entry["sha256"] for entry in item["print_files"] if entry["kind"] == "base"), "Grunddatei bleibt"


@pytest.mark.asyncio
async def test_a_number_file_needs_an_order_and_never_runs_the_word_filter(db, monkeypatch):
    async def no_filter(*_args, **_kwargs):
        raise AssertionError("eine Nummer läuft nie durch den Wortfilter")

    monkeypatch.setattr(shop_gamertag, "check_words", no_filter)
    with pytest.raises(ShopError):
        await shop_gamertag.store(db, "7", purpose="test", actor_id="finanzen-test", reason="Test", kind="number")
    stored = await shop_gamertag.store(db, "07", purpose="order", user_id=MEMBER, order_id="o-1", kind="number")
    assert stored["row"]["kind"] == "number" and stored["text"] == "07"
    with Image.open(BytesIO(shop_designs._path_of(stored["row"]["file_ref"]).read_bytes())) as img:
        assert img.getchannel("A").getbbox() is not None


# ---------------------------------------------------------------- Testentwurf (die Prüfung: test_shop_trikot_unit)

@pytest.mark.asyncio
async def test_the_test_draft_prints_the_sample_number(db, provider, monkeypatch):
    from services import shop_test_drafts
    from test_shop_test_drafts_unit import ADDRESS, shop_ready

    monkeypatch.setenv("PUBLIC_BACKEND_URL", "https://lsw.example.test")
    product = await number_product(db, provider)
    await shop_ready(db)
    white = await variant_for(db, product["id"], WHITE_M)
    listed = next(item for item in (await shop_test_drafts.overview(db))["products"] if item["id"] == product["id"])
    assert listed["member_number"] is True and listed["sample_number"] == "99"
    shown = await shop_test_drafts.preview(db, product_id=product["id"], variant_id=white["id"], gamertag="",
                                           address=dict(ADDRESS), actor_id="finanzen-test", provider=provider)
    files = {row["placement"]: row for row in shown["files"]}
    assert files["back"]["kind"] == "personal" and shown["with_number"] is True
    number_row = await db.shop_gamertag_files.find_one({"order_id": shown["id"], "kind": "number"}, {"_id": 0})
    plan = await plan_of(db, product["id"], "White", "back")
    rules = shop_gamertag.layer_rules(await shop_gamertag.load_rules(db), plan.texts[0].spec)
    assert number_row["sha256"] == shop_gamertag.render("99", rules, color_key=plan.texts[0].ink, kind="number").sha256
