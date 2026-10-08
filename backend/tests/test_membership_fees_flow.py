"""Mitgliedsbeitrag offen nennen (#1251, Variante A - aus Dolibarr): „Mitglied werden“ zeigt ohne Anmeldung die
Mitgliedsarten für Personen mit Betrag (nur die Felder von ``public_fee``), höchstens stündlich gelesen; fällt Dolibarr
aus, bleibt der letzte Stand mit Datum, ohne Stand gibt es keine Beträge. Dieselben Zahlen stehen im Antrag."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from dolibarr_fake import API_KEY, BASE_URL, FakeDolibarr  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import dolibarr_client  # noqa: E402
from services.secret_store import encrypt_secret  # noqa: E402

PUBLIC_FIELDS = {"id", "label", "description", "amount", "currency", "period_label", "amount_editable", "subscription_required", "admission_fee", "prorated", "proration", "year_starts_month"}


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


async def connect(flow, mode="live", **extra):
    await flow.db.settings.update_one({"id": "dolibarr"}, {"$set": {
        "id": "dolibarr", "mode": mode, "environment": "production", "base_url": BASE_URL, "api_key": encrypt_secret(API_KEY), "instance": "verein", "entity": 1, **extra,
    }}, upsert=True)


def fee_calls(fake) -> int:
    return sum(1 for path, _ in fake.calls if path == "/vereine/membershipfees")


@pytest.mark.asyncio
async def test_without_dolibarr_there_are_no_amounts(flow, fake):
    fees = (await flow.get("/api/membership/fees")).json()
    assert fees == {"available": False, "fees": [], "purpose": ""}
    assert fee_calls(fake) == 0


@pytest.mark.asyncio
async def test_public_fees_only_for_persons_cached_and_the_last_state_survives_an_outage(flow, fake):
    await connect(flow)
    first = (await flow.get("/api/membership/fees")).json()
    assert first["available"] is True and first["stale"] is False and first["as_of"]
    assert [(fee["label"], fee["amount"], fee["period_label"]) for fee in first["fees"]] == [("Ordentliches Mitglied", 50.0, "je Jahr"), ("Jugend", 20.0, "je Jahr")], "keine Firmen"
    assert all(set(fee) == PUBLIC_FIELDS for fee in first["fees"]), "nur die Felder von public_fee - nichts Internes"
    # Zwischengespeichert: der zweite Aufruf fragt Dolibarr nicht.
    assert (await flow.get("/api/membership/fees")).json()["fees"] == first["fees"] and fee_calls(fake) == 1

    # Ausfall nach Ablauf: der letzte Stand bleibt mit Datum stehen, als „alt“ markiert; nachgefragt wird erst später wieder.
    old = (now_utc() - timedelta(hours=3)).isoformat()
    await flow.db.dolibarr_public.update_one({"id": "membership_fees"}, {"$set": {"fetched_at": old}})
    fake.fail_with, fake.fail_paths = 503, {"/vereine/membershipfees"}
    down = (await flow.get("/api/membership/fees")).json()
    assert down["available"] is True and down["stale"] is True and down["as_of"] == old and down["fees"] == first["fees"]
    calls = fee_calls(fake)
    assert (await flow.get("/api/membership/fees")).json()["stale"] is True and fee_calls(fake) == calls, "nach einem Fehler erst in fünf Minuten wieder"

    # Wieder erreichbar und die Pause vorbei: frischer Stand, nicht mehr alt.
    fake.fail_with = None
    await flow.db.dolibarr_public.update_one({"id": "membership_fees"}, {"$set": {"error_at": old}})
    assert (await flow.get("/api/membership/fees")).json()["stale"] is False


@pytest.mark.asyncio
async def test_no_state_and_an_outage_means_no_amounts(flow, fake):
    await connect(flow)
    fake.fail_with = 503
    assert (await flow.get("/api/membership/fees")).json()["available"] is False


@pytest.mark.asyncio
async def test_join_page_texts_and_the_purpose_sentence(flow, fake):
    page = (await flow.get("/api/membership/join-page")).json()
    assert [row["icon"] for row in page["benefits"]] == ["vote", "gift", "trophy", "card"] and page["fee_purpose"] == ""
    admin = await flow.add_user(role="club_admin")
    flow.act_as(admin)
    saved = await flow.put("/api/membership/join-page", json={"fee_purpose": " Der Beitrag zahlt Hallenmiete und Technik. ", "benefits": [
        {"icon": "trophy", "title": "Turniere", "text": "Nur für Mitglieder."}, {"icon": "rakete", "title": "Mehr", "text": ""}, {"icon": "gift", "title": " ", "text": "leer"},
    ]})
    assert saved.status_code == 200, saved.text
    assert saved.json()["benefits"] == [{"icon": "trophy", "title": "Turniere", "text": "Nur für Mitglieder."}, {"icon": "star", "title": "Mehr", "text": ""}]
    flow.act_as(None)
    assert (await flow.get("/api/membership/fees")).json()["purpose"] == "Der Beitrag zahlt Hallenmiete und Technik."
    flow.act_as(await flow.add_user(role="player"))
    reply = await flow.put("/api/membership/join-page", json={"fee_purpose": "x"})
    assert reply.status_code == 403


@pytest.mark.asyncio
async def test_application_without_coupling_shows_and_keeps_the_same_amounts(flow, fake):
    await connect(flow, mode="live", applications_enabled=False)
    player = await flow.add_user(role="player")
    flow.act_as(player)
    form = (await flow.get("/api/membership/apply/form")).json()
    assert form["coupled"] is False and [fee["label"] for fee in form["fees"]] == ["Ordentliches Mitglied", "Jugend"] and form["fees_as_of"]
    wrong = await flow.post("/api/membership/apply", json={"motivation": "Ich möchte gerne beim Verein mitmachen.", "accept_statutes": True, "accept_privacy": True, "type_id": 4})
    assert wrong.status_code == 422, "Firmen-Mitgliedschaft steht nicht zur Wahl"
    sent = await flow.post("/api/membership/apply", json={"motivation": "Ich möchte gerne beim Verein mitmachen.", "accept_statutes": True, "accept_privacy": True, "type_id": 3})
    assert sent.status_code == 200, sent.text
    stored = await flow.db.membership_applications.find_one({"user_id": player["id"]})
    assert stored["type_id"] == 3 and stored["type_label"] == "Jugend" and stored["status"] == "pending"
