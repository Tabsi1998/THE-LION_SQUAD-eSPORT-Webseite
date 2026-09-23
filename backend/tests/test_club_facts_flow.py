"""Rechtliches II (#326 Teil 1): Vereinsdaten und Obmann aus Dolibarr liegen über den Handfeldern,
sobald der Schalter gesetzt ist; ohne Einwilligung kein Name; ein Ausfall lässt den alten Stand mit
Datum stehen; die Datenschutzerklärung baut sich aus den Schaltern, die wirklich an sind."""
import pathlib
import sys
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from dolibarr_fake import API_KEY, BASE_URL, FakeDolibarr  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from services import club_facts, dolibarr_client, privacy_facts  # noqa: E402
from services.dolibarr_client import DolibarrClient, load_settings  # noqa: E402
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


async def connect(flow, mode="live"):
    await flow.db.settings.update_one({"id": "dolibarr"}, {"$set": {
        "id": "dolibarr", "mode": mode, "environment": "production", "base_url": BASE_URL, "api_key": encrypt_secret(API_KEY), "instance": "verein", "entity": 1,
    }}, upsert=True)


MANUAL = {"id": "branding", "club_name": "THE LION SQUAD", "legal_name": "Handverein", "zvr_number": "999", "street_address": "Handgasse 9", "postal_code": "1010",
          "city": "Handstadt", "country": "Österreich", "register_authority": "BH Hand", "phone": "0664", "representative_name": "Hanna Hand", "representative_role": "Obfrau",
          "content_responsible": "Hanna Hand", "privacy_contact_email": "dsgvo@handverein-test.at", "contact_email": "office@handverein-test.at", "hosting_provider": "Eigenhosting", "hosting_country": "Österreich"}


def test_overlay_maps_organization_and_board_and_withholds_names_without_consent_or_when_stale():
    fake = FakeDolibarr()
    overlay = club_facts.legal_overlay(fake.organization, fake.board, fetched_at="2026-09-23T10:00:00+00:00", now=datetime(2026, 9, 23, 12, tzinfo=timezone.utc))
    assert overlay == {"legal_name": "Testverein Löwen", "zvr_number": "123456789", "register_authority": "Bezirkshauptmannschaft Testbezirk", "street_address": "Teststraße 1",
                       "postal_code": "6410", "city": "Testdorf", "country": "Österreich", "phone": "+43 5262 0", "representative_name": "Otto Obmann", "representative_role": "Obmann"}
    # Ohne Einwilligung kein Name - dann bleibt der Handeintrag (kein Schlüssel im Overlay).
    board = [{**fake.board[0], "holders": [{"name": None, "since": "2024-04-01"}]}]
    overlay = club_facts.legal_overlay(fake.organization, board, fetched_at="2026-09-23T10:00:00+00:00", now=datetime(2026, 9, 23, 12, tzinfo=timezone.utc))
    assert "representative_name" not in overlay and overlay["legal_name"] == "Testverein Löwen"
    # Ein Stand, der älter ist als zwei Tage, gibt keine Personennamen mehr her - Vereinsdaten schon.
    old = datetime(2026, 9, 23, 12, tzinfo=timezone.utc) - timedelta(hours=club_facts.NAME_MAX_AGE_HOURS + 1)
    overlay = club_facts.legal_overlay(fake.organization, fake.board, fetched_at=old.isoformat(), now=datetime(2026, 9, 23, 12, tzinfo=timezone.utc))
    assert "representative_name" not in overlay and overlay["zvr_number"] == "123456789"
    public = club_facts.board_public(fake.board, fetched_at="2026-09-23T10:00:00+00:00", now=datetime(2026, 9, 23, 12, tzinfo=timezone.utc))
    assert [row["code"] for row in public] == ["obmann", "kassier"], "Rechnungsprüfer sind kein Vorstand"
    assert public[0]["holders"][0]["name"] == "Otto Obmann" and public[1]["holders"][0]["name"] is None
    # Leere Werte kommen nie ins Overlay.
    assert club_facts.legal_overlay({"name": "", "address": {"street": " "}}, []) == {}


@pytest.mark.asyncio
async def test_switch_puts_dolibarr_values_over_the_hand_fields_and_an_outage_keeps_the_last_state(flow, fake):
    await connect(flow)
    await flow.db.settings.update_one({"id": "branding"}, {"$set": MANUAL}, upsert=True)
    settings = await load_settings(flow.db)
    assert (await club_facts.refresh(flow.db, settings, DolibarrClient(settings)))["ok"] is True

    # Schalter aus: alles wie von Hand.
    public = (await flow.get("/api/settings/public")).json()
    assert public["legal_name"] == "Handverein" and public["representative_name"] == "Hanna Hand" and public["legal_source"] == {"dolibarr": False}

    # Schalter an: Dolibarr führt bei Name, ZVR, Behörde, Anschrift, Telefon und Obmann - Redaktionelles bleibt.
    await flow.db.settings.update_one({"id": "branding"}, {"$set": {"legal_from_dolibarr": True}})
    public = (await flow.get("/api/settings/public")).json()
    assert public["legal_name"] == "Testverein Löwen" and public["zvr_number"] == "123456789" and public["street_address"] == "Teststraße 1"
    assert public["representative_name"] == "Otto Obmann" and public["representative_role"] == "Obmann"
    assert public["content_responsible"] == "Hanna Hand" and public["privacy_contact_email"] == "dsgvo@handverein-test.at", "bleibt von Hand"
    assert public["legal_source"]["dolibarr"] is True and public["legal_source"]["fetched_at"] and "representative_name" in public["legal_source"]["fields"]

    # Ausfall: der alte Stand bleibt samt Zeitpunkt, der Fehler steht daneben - nichts wird „anders“.
    fetched_before = (await club_facts.snapshot(flow.db))["fetched_at"]
    fake.fail_with = 503
    result = await club_facts.refresh(flow.db, settings, DolibarrClient(settings))
    assert result["ok"] is False and result["kind"] == "unavailable"
    state = await club_facts.snapshot(flow.db)
    assert state["fetched_at"] == fetched_before and state["organization"]["name"] == "Testverein Löwen" and state["error"] == "unavailable" and state["error_at"]
    public = (await flow.get("/api/settings/public")).json()
    assert public["legal_name"] == "Testverein Löwen" and public["legal_source"]["error"] == "unavailable"

    # Wieder da: der Fehler verschwindet. Name in Dolibarr widerrufen → Obmann wieder von Hand.
    fake.fail_with = None
    fake.board[0]["holders"][0]["name"] = None
    assert (await club_facts.refresh(flow.db, settings, DolibarrClient(settings)))["ok"] is True
    state = await club_facts.snapshot(flow.db)
    assert "error" not in state
    public = (await flow.get("/api/settings/public")).json()
    assert public["representative_name"] == "Hanna Hand" and public["legal_name"] == "Testverein Löwen"


@pytest.mark.asyncio
async def test_admin_sees_the_state_and_only_system_may_refresh(flow, fake):
    await connect(flow)
    await flow.db.settings.update_one({"id": "branding"}, {"$set": MANUAL}, upsert=True)
    admin = await flow.add_user(role="superadmin", name="admin")
    player = await flow.add_user(role="player", name="paula")

    flow.act_as(player)
    assert (await flow.get("/api/admin/dolibarr/public")).status_code == 403
    assert (await flow.post("/api/admin/dolibarr/public/refresh")).status_code == 403

    flow.act_as(admin)
    before = (await flow.get("/api/admin/dolibarr/public")).json()
    assert before["has_data"] is False and before["enabled"] is False
    refreshed = await flow.post("/api/admin/dolibarr/public/refresh")
    assert refreshed.status_code == 200 and refreshed.json()["ok"] is True and refreshed.json()["functions"] == 3
    view = (await flow.get("/api/admin/dolibarr/public")).json()
    assert view["has_data"] is True and view["overlay"]["legal_name"] == "Testverein Löwen" and view["representative"]["name"] == "Otto Obmann"
    assert [row["code"] for row in view["board"]] == ["obmann", "kassier"] and view["organization"]["founded"] == "2019-03-01"
    assert "legal_name" in view["fields"] and view["names_withheld"] is False
    # Ohne Anbindung: klarer Grund statt Fehler.
    await connect(flow, mode="off")
    assert (await club_facts.refresh_due()) == {"ok": False, "kind": "not_configured"}


def test_privacy_facts_are_computed_from_the_real_switches_without_secrets():
    facts = privacy_facts.facts_from(
        {"analytics_provider": "plausible", "twitch_channel": "the_lion_squad", "hosting_provider": "Eigenhosting", "hosting_country": "Österreich"},
        {"google_login_enabled": True},
        {"webhook_url": "", "targets": {"news": {"webhook_url": "enc"}}, "bot_enabled": False},
        {"provider": "resend", "resend_api_key": "enc"},
        {"mode": "live", "write_enabled": True, "api_key": "geheim"},
    )
    assert facts == {
        "analytics": "plausible", "google_login": True, "passkeys": True, "discord": {"webhooks": True, "bot": False}, "twitch_embed": True,
        "email_provider": "resend", "dolibarr": True, "dolibarr_billing": True, "app": {"push": True, "crash_reports": True, "app_lock": True},
        "hosting": {"provider": "Eigenhosting", "country": "Österreich"},
    }
    assert "geheim" not in str(facts) and "enc" not in str(facts)
    bare = privacy_facts.facts_from({}, {}, {}, {}, {})
    assert bare["analytics"] == "" and bare["google_login"] is False and bare["discord"] == {"webhooks": False, "bot": False} and bare["email_provider"] == "none" and bare["dolibarr"] is False
    assert privacy_facts.email_provider({"smtp_host": "mail.example.test"}) == "smtp"
    assert privacy_facts.email_provider({"provider": "smtp"}) == "none", "SMTP ohne Server versendet nichts"
    assert privacy_facts.email_provider({"provider": "resend"}) == "none", "Resend ohne Schlüssel versendet nichts"


@pytest.mark.asyncio
async def test_public_settings_carry_the_privacy_facts(flow):
    await flow.db.settings.update_one({"id": "email"}, {"$set": {"id": "email", "provider": "smtp", "smtp_host": "mail.example.test"}}, upsert=True)
    await flow.db.settings.update_one({"id": "discord"}, {"$set": {"id": "discord", "bot_enabled": True}}, upsert=True)
    public = (await flow.get("/api/settings/public")).json()
    facts = public["privacy_facts"]
    assert facts["email_provider"] == "smtp" and facts["discord"] == {"webhooks": False, "bot": True} and facts["dolibarr"] is False
    assert set(facts) == {"analytics", "google_login", "passkeys", "discord", "twitch_embed", "email_provider", "dolibarr", "dolibarr_billing", "app", "hosting"}
