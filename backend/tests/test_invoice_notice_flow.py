"""„Deine Rechnung ist da“ (#841): nach der Freigabe einmal je Beleg an die Person, die angemeldet hat - im Postfach
(Web und App), per Push und per Mail mit Link ins Konto, nie mit dem PDF als Anhang und nie über Discord. Nie für
Entwürfe, nie nach einer Abmeldung; Belege, die schon vor dem Update freigegeben waren, bleiben still. Die Meldung
wartet auf das PDF (#840), höchstens zwei Stunden."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from dolibarr_fake import FakeDolibarr  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import billing_orders, dolibarr_client, invoice_notice  # noqa: E402
from services.discord_dm import send_discord_dm_for_notification  # noqa: E402
from test_billing_invoice_terms_flow import TERMS, book, connect, paid_event, person  # noqa: E402

LIVE = {"invoice_auto_validate": True, "tax_confirmed_at": "2026-09-23T10:00:00+00:00", **TERMS}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def fake(monkeypatch):
    instance = FakeDolibarr()
    monkeypatch.setattr(dolibarr_client, "_transport", instance.transport())
    monkeypatch.setattr(dolibarr_client, "RETRY_PAUSES", (0, 0))
    return instance


async def invoiced(flow, fake, name="gast", **settings):
    await connect(flow, **{**LIVE, **settings})
    kassier = await person(flow, "kassier", role="club_admin")
    event = await paid_event(flow, kassier)
    guest = await person(flow, name)
    booked = await book(flow, guest, event)
    assert (await billing_orders.classify_due())["invoiced"] == 1
    order = await flow.db.billing_orders.find_one({"registration_id": booked["id"]}, {"_id": 0})
    return kassier, guest, order, booked


async def notices(flow, user_id=None):
    query = {"kind": "invoice_ready", **({"user_id": user_id} if user_id else {})}
    return await flow.db.notifications.find(query, {"_id": 0}).to_list(50)


async def mails(flow):
    return await flow.db.mail_jobs.find({"template_key": "invoice_ready"}, {"_id": 0}).to_list(50)


def test_texts_name_amount_due_date_and_paid():
    state = {"remote_total_cents": 123450, "due_on": "2026-10-17", "invoice_status": "validated", "payment_state": "open"}
    text = invoice_notice.notice_text("Weihnachtsfeier", state, {})
    assert text["title"] == "Deine Rechnung ist da"
    assert text["body"] == "Weihnachtsfeier: 1.234,50 €, zahlbar bis 17.10.2026."
    paid = invoice_notice.notice_text("Startgeld Herbst-Cup – Lions", {**state, "invoice_status": "paid"}, {})
    assert paid["body"] == "Startgeld Herbst-Cup – Lions: 1.234,50 € – schon bezahlt, danke!"
    assert invoice_notice.notice_text("Ausflug", {"remote_total_cents": None, "due_on": ""}, {"total_cents": 2000})["body"] == "Ausflug: 20,00 €."
    assert invoice_notice.invoice_path(42) == "/profile?tab=invoices&invoice=d-42"


@pytest.mark.asyncio
async def test_validated_invoice_notifies_once_in_app_and_by_mail_with_a_link_never_discord(flow, fake):
    kassier, guest, order, _ = await invoiced(flow, fake)
    rows = await notices(flow)
    assert [row["user_id"] for row in rows] == [guest["id"]], "nur die Person, die angemeldet hat"
    notice = rows[0]
    assert notice["title"] == "Deine Rechnung ist da"
    assert notice["body"].startswith("Weihnachtsfeier: 20,00 €, zahlbar bis ")
    assert notice["url"] == f"/profile?tab=invoices&invoice=d-{order['invoice_id']}"
    assert notice["meta"]["category"] == "billing_updates" and notice["meta"]["invoice_key"] == f"d-{order['invoice_id']}"

    queued = await mails(flow)
    assert len(queued) == 1 and queued[0]["to"] == "gast@example.test"
    assert queued[0]["subject"] == "Deine Rechnung zu Weihnachtsfeier ist da"
    assert f"/profile?tab=invoices&amp;invoice=d-{order['invoice_id']}" in queued[0]["html"] or f"/profile?tab=invoices&invoice=d-{order['invoice_id']}" in queued[0]["html"]
    assert "20,00 €" in queued[0]["html"] and not queued[0].get("attachments"), "Link statt Anhang - das PDF bleibt hinter der Anmeldung"

    # Der Abgleich läuft weiter, die Zahlung kommt: keine zweite Meldung, keine zweite Mail.
    await billing_orders.sync_due()
    fake.pay(order["invoice_id"])
    await billing_orders.sync_due()
    await billing_orders.reconcile_due()
    assert len(await notices(flow)) == 1 and len(await mails(flow)) == 1

    # Discord ist für Rechnungen kein Weg - auch nicht als Direktnachricht an die Person selbst.
    await flow.db.users.update_one({"id": guest["id"]}, {"$set": {"notification_preferences": {"discord": True}}})
    assert await send_discord_dm_for_notification(notice, "billing_updates") == 0
    assert await flow.db.email_logs.count_documents({"channel": "discord", "event_key": "notify.invoice_ready"}) == 0
    assert await flow.db.notifications.count_documents({"user_id": kassier["id"], "kind": "invoice_ready"}) == 0


@pytest.mark.asyncio
async def test_draft_stays_quiet_until_it_is_validated_in_dolibarr_then_once(flow, fake):
    _, guest, draft, _ = await invoiced(flow, fake, invoice_auto_validate=False)
    assert await notices(flow) == [] and await mails(flow) == [], "Entwürfe melden nichts"
    await billing_orders.sync_due()
    assert await notices(flow) == []

    fake.hand_validate(draft["invoice_id"])
    counts = await billing_orders.sync_due()
    assert counts["notices"] == 1
    assert [row["user_id"] for row in await notices(flow)] == [guest["id"]]
    assert len(await mails(flow)) == 1
    await billing_orders.sync_due(full=True)
    assert len(await notices(flow)) == 1 and len(await mails(flow)) == 1


@pytest.mark.asyncio
async def test_cancelled_before_validation_gets_no_notice(flow, fake):
    _, guest, draft, booked = await invoiced(flow, fake, invoice_auto_validate=False)
    await billing_orders.cancel_orders_for(flow.db, kind="event", registration_id=booked["id"], reason="Abgemeldet")
    fake.hand_validate(draft["invoice_id"])
    await billing_orders.sync_due()
    assert await notices(flow) == [] and await mails(flow) == []


@pytest.mark.asyncio
async def test_invoices_validated_before_the_update_stay_quiet(flow, fake):
    await connect(flow, **LIVE)
    guest = await person(flow, "gast")
    party = fake.add_thirdparty("Gast", "gast@example.test")
    fake.core_invoices[701] = {"id": 701, "ref": "FA2609-0701", "socid": party["id"], "statut": 1, "paye": 0, "total_ttc": 20.0, "remaintopay": 20.0,
                               "type": 0, "lines": [], "last_main_doc": "facture/FA2609-0701/FA2609-0701.pdf"}
    fake.core_pdfs.add(701)
    await flow.db.billing_orders.insert_one({"id": "o-alt", "user_id": guest["id"], "kind": "event", "source_id": "ev1", "registration_id": "r-alt",
                                             "status": "invoiced", "invoice_id": 701, "invoice_ref": "FA2609-0701", "invoice_status": "validated",
                                             "invoiced_at": "2026-09-01T10:00:00+00:00", "total_cents": 2000})
    await billing_orders.sync_due(full=True)
    assert await notices(flow) == [] and await mails(flow) == [], "kein Schwall alter Rechnungen nach dem Update"


@pytest.mark.asyncio
async def test_waits_for_the_pdf_and_sends_anyway_after_two_hours(flow, fake):
    fake.builddoc_status = 403
    _, guest, order, _ = await invoiced(flow, fake)
    assert order["pdf_missing"] is True
    assert await notices(flow) == [], "ohne PDF wartet die Meldung - der Link soll gleich funktionieren"
    await billing_orders.sync_due()
    assert await notices(flow) == []

    # Zwei Stunden später ohne PDF: die Meldung kommt trotzdem - der Download im Konto baut ein fehlendes PDF selbst.
    await flow.db.billing_orders.update_one({"id": order["id"]}, {"$set": {"invoice_notice_due_at": (now_utc() - timedelta(hours=2, minutes=1)).isoformat()}})
    await billing_orders.sync_due()
    assert [row["user_id"] for row in await notices(flow)] == [guest["id"]]


@pytest.mark.asyncio
async def test_pdf_arriving_with_the_next_sync_releases_the_notice(flow, fake):
    fake.builddoc_status = 500
    _, guest, order, _ = await invoiced(flow, fake)
    assert await notices(flow) == []
    fake.builddoc_status = None
    await flow.db.billing_orders.update_one({"id": order["id"]}, {"$set": {"pdf_error_at": (now_utc() - timedelta(minutes=61)).isoformat()}})
    await billing_orders.sync_due()
    assert [row["user_id"] for row in await notices(flow)] == [guest["id"]]


@pytest.mark.asyncio
async def test_preferences_decide_the_channels(flow, fake):
    await connect(flow, **LIVE)
    kassier = await person(flow, "kassier", role="club_admin")
    event = await paid_event(flow, kassier)
    guest = await person(flow, "gast", notification_preferences={"email:billing_updates": False})
    await book(flow, guest, event)
    await billing_orders.classify_due()
    assert len(await notices(flow)) == 1 and await mails(flow) == [], "Mail abbestellt - das Postfach bekommt sie trotzdem"

    quiet = await person(flow, "still", notification_preferences={"in_app:billing_updates": False, "push:billing_updates": False})
    await book(flow, quiet, event)
    await billing_orders.classify_due()
    assert await notices(flow, quiet["id"]) == []
    assert [mail["to"] for mail in await mails(flow)] == ["still@example.test"]


@pytest.mark.asyncio
async def test_settings_show_the_invoice_category_without_discord(flow):
    user = await person(flow, "gast")
    flow.act_as(user)
    payload = (await flow.get("/api/users/me/notification-preferences")).json()
    category = next(item for item in payload["categories"] if item["key"] == "billing_updates")
    assert category["label"] == "Rechnungen" and category["channels"] == ["in_app", "push", "email"]
