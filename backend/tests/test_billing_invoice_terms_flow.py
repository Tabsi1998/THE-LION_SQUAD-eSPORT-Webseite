"""Rechnungskonditionen und lesbare Belegtexte (#370): Zahlungsziel, Zahlungsart und Bankkonto
kommen aus den Einstellungen an jeden Beleg; ohne die drei wird nichts automatisch freigegeben.
Jede Zeile nennt den Vorgang, die Finanzverwaltung kann vor dem Beleg einen Zusatztext ergänzen."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from dolibarr_fake import API_KEY, BASE_URL, FakeDolibarr  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from services import billing_orders, dolibarr_billing, dolibarr_client  # noqa: E402
from services.secret_store import encrypt_secret  # noqa: E402


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


async def connect(flow, **extra):
    await flow.db.settings.update_one({"id": "dolibarr"}, {"$set": {
        "id": "dolibarr", "mode": "live", "environment": "production", "base_url": BASE_URL,
        "api_key": encrypt_secret(API_KEY), "instance": "verein", "entity": 1, "write_enabled": True, **extra,
    }}, upsert=True)


async def person(flow, name, *, role="player", **fields):
    user = await flow.add_user(role=role, name=name)
    fields.setdefault("email", f"{name}@example.test")
    fields.setdefault("display_name", name.capitalize())
    await flow.db.users.update_one({"id": user["id"]}, {"$set": fields})
    user.update(fields)
    return user


TERMS = {"invoice_payment_term_id": 2, "invoice_payment_mode_id": 2, "invoice_bank_account_id": 1}
OFFER = {"enabled": True, "positions": [{"key": "beitrag", "label": "Kostenbeitrag", "description": "Essen und Getränke", "amount": "20", "basis": "per_person"}]}


async def paid_event(flow, admin, **extra):
    flow.act_as(admin)
    response = await flow.post("/api/events", json={"name": "Weihnachtsfeier", "status": "registration_open", "visibility": "public", "has_registration": True,
                                                    "allow_companions": True, "max_companions_per_registration": 3,
                                                    "start_date": "2026-12-12T18:00:00+00:00", "billing": {**OFFER, **extra}})
    assert response.status_code == 200, response.text
    return response.json()


async def book(flow, user, event, companions=0):
    flow.act_as(user)
    response = await flow.post(f"/api/events/{event['id']}/registrations", json={"companion_count": companions})
    assert response.status_code == 200, response.text
    return response.json()


def test_line_context_names_the_booking():
    facts = {"kind": "event", "name": "Weihnachtsfeier", "date": "12.12.2026", "person": "Paula Beispiel", "companions": 1, "seats": 2}
    assert dolibarr_billing.line_context(facts, {"basis": "per_person", "quantity": 2}) == "Weihnachtsfeier am 12.12.2026 – 2 Personen (Paula Beispiel + 1 Begleitperson)"
    assert dolibarr_billing.line_context(facts, {"basis": "per_registration", "quantity": 1}) == "Weihnachtsfeier am 12.12.2026 – Paula Beispiel"
    assert dolibarr_billing.line_context({**facts, "companions": 2}, {"basis": "per_person", "quantity": 3}).endswith("(Paula Beispiel + 2 Begleitpersonen)")
    team = {"kind": "tournament", "name": "Herbst-Cup", "date": "02.10.2026", "person": "Captain", "team": "Lions", "players": 5}
    assert dolibarr_billing.line_context(team, {"basis": "per_person", "quantity": 5}) == "Herbst-Cup am 02.10.2026 – Team Lions, 5 Spieler"
    assert dolibarr_billing.line_context({**team, "team": ""}, {"basis": "per_team", "quantity": 1}) == "Herbst-Cup am 02.10.2026 – Captain"
    assert dolibarr_billing.source_label(team) == "Startgeld Herbst-Cup – Lions"


def test_terms_only_when_all_three_are_set():
    assert dolibarr_billing.invoice_terms({}) == {}
    assert dolibarr_billing.invoice_terms({"invoice_payment_term_id": 2, "invoice_payment_mode_id": "2"}) == {"cond_reglement_id": 2, "mode_reglement_id": 2}
    assert dolibarr_billing.terms_complete({"invoice_payment_term_id": 2, "invoice_payment_mode_id": 2}) is False
    assert dolibarr_billing.terms_complete(TERMS) is True


@pytest.mark.asyncio
async def test_invoice_carries_terms_and_a_readable_text_with_the_extra_line(flow, fake):
    await connect(flow, invoice_auto_validate=True, **TERMS)
    kassier = await person(flow, "kassier", role="club_admin")
    event = await paid_event(flow, kassier)
    paula = await person(flow, "paula", display_name="Paula Beispiel")
    booked = await book(flow, paula, event, companions=1)
    order = await flow.db.billing_orders.find_one({"registration_id": booked["id"]}, {"_id": 0})

    # Vor dem Beleg: die Finanzübersicht zeigt den Text, wie er käme, und nimmt einen Zusatz an.
    flow.act_as(kassier)
    overview = (await flow.get("/api/admin/finance/overview")).json()
    row = next(r for r in overview["open"] if r["id"] == order["id"])
    assert row["invoice_text"] == ["Kostenbeitrag – Essen und Getränke\nWeihnachtsfeier am 12.12.2026 – 2 Personen (Paula Beispiel + 1 Begleitperson)"]
    assert overview["dolibarr"]["terms_complete"] is True
    saved = await flow.put(f"/api/admin/finance/orders/{order['id']}/text", json={"extra_text": "  Tischreservierung Nr. 4 \n\n Menü vegetarisch  "})
    assert saved.status_code == 200, saved.text
    assert saved.json()["invoice_text"][0].endswith("\nTischreservierung Nr. 4\nMenü vegetarisch")

    assert (await billing_orders.classify_due())["invoiced"] == 1
    order = await flow.db.billing_orders.find_one({"id": order["id"]}, {"_id": 0})
    invoice = fake.core_invoices[order["invoice_id"]]
    assert (invoice["cond_reglement_id"], invoice["mode_reglement_id"], invoice["fk_account"]) == (2, 2, 1)
    assert invoice["statut"] == 1, "mit vollständigen Konditionen wird freigegeben"
    assert invoice["lines"][0]["desc"] == "Kostenbeitrag – Essen und Getränke\nWeihnachtsfeier am 12.12.2026 – 2 Personen (Paula Beispiel + 1 Begleitperson)\nTischreservierung Nr. 4\nMenü vegetarisch"
    assert invoice["note_public"] == "Anmeldung: Weihnachtsfeier – Paula Beispiel\nTischreservierung Nr. 4\nMenü vegetarisch"

    # Nach dem Beleg ist der Text in Dolibarr zu Hause.
    assert (await flow.put(f"/api/admin/finance/orders/{order['id']}/text", json={"extra_text": "zu spät"})).status_code == 409


@pytest.mark.asyncio
async def test_without_complete_terms_the_invoice_stays_a_draft_even_with_auto_validate(flow, fake):
    await connect(flow, invoice_auto_validate=True, invoice_payment_term_id=2)
    kassier = await person(flow, "kassier", role="club_admin")
    event = await paid_event(flow, kassier)
    gast = await person(flow, "gast")
    booked = await book(flow, gast, event)
    assert (await billing_orders.classify_due())["invoiced"] == 1
    order = await flow.db.billing_orders.find_one({"registration_id": booked["id"]}, {"_id": 0})
    invoice = fake.core_invoices[order["invoice_id"]]
    assert invoice["statut"] == 0 and order["invoice_status"] == "draft"
    assert invoice["cond_reglement_id"] == 2 and invoice["fk_account"] is None
    assert not any(p.endswith("/validate") for p, _ in fake.posts)


@pytest.mark.asyncio
async def test_settings_offer_the_dolibarr_lists_and_refuse_auto_validate_without_terms(flow, fake):
    await connect(flow)
    system = await person(flow, "chef", role="superadmin")
    flow.act_as(system)
    options = (await flow.get("/api/admin/dolibarr/invoice-options")).json()
    assert options["available"] is True
    assert [t["code"] for t in options["terms"]] == ["RECEP", "30D", "30DENDMONTH"]
    # Die API liefert Englisch - die Website zeigt Deutsch, unbekannte Codes bleiben, wie sie kommen.
    assert [t["label"] for t in options["terms"]] == ["Sofort bei Erhalt", "30 Tage", "30 Tage zum Monatsende"]
    assert [m["label"] for m in options["modes"]] == ["Banküberweisung", "Bar", "Kreditkarte"]
    assert options["accounts_reason"] is None
    assert options["suggested"] == {"payment_term_id": 2, "payment_mode_id": 2, "bank_account_id": 1}
    assert options["accounts"][0]["label"] == "Girokonto"

    refused = await flow.put("/api/admin/dolibarr/settings", json={"invoice_auto_validate": True})
    assert refused.status_code == 400 and "Zahlungsziel" in refused.json()["detail"]
    ok = await flow.put("/api/admin/dolibarr/settings", json={"invoice_auto_validate": True, **TERMS})
    assert ok.status_code == 200, ok.text
    status = (await flow.get("/api/admin/dolibarr/status")).json()
    assert status["invoice_terms"] == {"payment_term_id": 2, "payment_mode_id": 2, "bank_account_id": 1, "complete": True}
    assert status["invoice_auto_validate"] is True
    # 0 löscht eine Kondition - und damit die Vollständigkeit.
    assert (await flow.put("/api/admin/dolibarr/settings", json={"invoice_bank_account_id": 0})).status_code == 200
    assert (await flow.get("/api/admin/dolibarr/status")).json()["invoice_terms"]["complete"] is False

    # Darf der Website-Benutzer die Konten nicht lesen, bleibt die Liste leer - die Nummer wird getippt.
    fake.bank_readable = False
    options = (await flow.get("/api/admin/dolibarr/invoice-options")).json()
    assert options["available"] is True and options["accounts"] is None and options["terms"]
    assert options["accounts_reason"] == "forbidden"


@pytest.mark.asyncio
async def test_tournament_invoice_names_team_and_players(flow, fake):
    await connect(flow, **TERMS)
    kassier = await person(flow, "kassier", role="club_admin")
    await flow.db.games.insert_one({"id": "g1", "name": "Rocket League", "slug": "rocket-league"})
    flow.act_as(kassier)
    created = await flow.post("/api/tournaments", json={"title": "Herbst-Cup", "game_id": "g1", "status": "registration_open", "visibility": "public", "is_public": True,
                                                        "format": "single_elim", "team_mode": "team", "team_size": 5, "max_participants": 8,
                                                        "start_date": "2026-10-02T17:00:00+00:00",
                                                        "billing": {"enabled": True, "positions": [{"key": "startgeld", "label": "Startgeld", "amount": "10", "basis": "per_person"}]}})
    assert created.status_code == 200, created.text
    captain = await person(flow, "captain", display_name="Cap Tain")
    await flow.db.teams.insert_one({"id": "team-1", "name": "Lions", "tag": "TLS", "leader_id": captain["id"], "co_leader_ids": [], "member_ids": [captain["id"]]})
    flow.act_as(captain)
    booked = await flow.post(f"/api/tournaments/{created.json()['id']}/register", json={"accept_rules": True, "accept_privacy": True, "team_id": "team-1", "accept_costs": True})
    assert booked.status_code == 200, booked.text
    assert (await billing_orders.classify_due())["invoiced"] == 1
    order = await flow.db.billing_orders.find_one({"kind": "tournament"}, {"_id": 0})
    invoice = fake.core_invoices[order["invoice_id"]]
    assert invoice["lines"][0]["desc"] == "Startgeld\nHerbst-Cup am 02.10.2026 – Team [TLS] Lions, 5 Spieler"
    assert invoice["note_public"].startswith("Anmeldung: Startgeld Herbst-Cup – [TLS] Lions – Cap Tain")
    assert invoice["fk_account"] == 1
