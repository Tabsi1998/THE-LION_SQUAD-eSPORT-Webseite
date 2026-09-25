"""Rechtliches II (#326 Teil 1): Vereinsdaten und Obmann aus Dolibarr liegen über den Handfeldern,
sobald der Schalter gesetzt ist; ohne Einwilligung kein Name; ein Ausfall lässt den alten Stand mit
Datum stehen; die Datenschutzerklärung baut sich aus den Schaltern, die wirklich an sind."""
import pathlib
import sys
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from dolibarr_fake import API_KEY, BASE_URL, FakeDolibarr, statute_pdf_bytes  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from services import club_facts, dolibarr_client, privacy_facts  # noqa: E402
from services.dolibarr_client import DolibarrClient, DolibarrError, load_settings  # noqa: E402
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
        {"channels": {"news": "100000000000000002"}, "bot_enabled": False},
        {"provider": "resend", "resend_api_key": "enc"},
        {"mode": "live", "write_enabled": True, "api_key": "geheim"},
    )
    assert facts == {
        "analytics": "plausible", "google_login": True, "passkeys": True, "discord": {"channels": True, "bot": False}, "twitch_embed": True, "steam_status": False,
        "email_provider": "resend", "dolibarr": True, "dolibarr_billing": True, "app": {"push": True, "crash_reports": True, "app_lock": True},
        "hosting": {"provider": "Eigenhosting", "country": "Österreich"},
        "media_scan": {"enabled": False, "provider": "off"},
        "platforms": [],
    }
    assert privacy_facts.facts_from({}, {}, {}, {}, {}, media_scan={"provider": "local"})["media_scan"] == {"enabled": True, "provider": "local"}
    # Plattformen (#545): nur eingerichtete, mit Betreiber - nie Client-ID oder Secret.
    rows = privacy_facts.platform_facts({"discord_client_id": "id", "discord_client_secret": "enc", "twitch_client_id": "id"})
    # Steam, Lichess, Mastodon und Bluesky brauchen keine App - sie stehen immer in der Liste.
    assert [row["key"] for row in rows] == ["discord", "steam", "lichess", "mastodon", "bluesky"] and rows[0]["operator"] == "Discord Inc., USA" and "enc" not in str(rows)
    assert "geheim" not in str(facts) and "enc" not in str(facts)
    bare = privacy_facts.facts_from({}, {}, {}, {}, {})
    assert bare["analytics"] == "" and bare["google_login"] is False and bare["discord"] == {"channels": False, "bot": False} and bare["email_provider"] == "none" and bare["dolibarr"] is False
    assert privacy_facts.email_provider({"smtp_host": "mail.example.test"}) == "smtp"
    assert privacy_facts.email_provider({"provider": "smtp"}) == "none", "SMTP ohne Server versendet nichts"
    assert privacy_facts.email_provider({"provider": "resend"}) == "none", "Resend ohne Schlüssel versendet nichts"


@pytest.mark.asyncio
async def test_public_settings_carry_the_privacy_facts(flow):
    await flow.db.settings.update_one({"id": "email"}, {"$set": {"id": "email", "provider": "smtp", "smtp_host": "mail.example.test"}}, upsert=True)
    await flow.db.settings.update_one({"id": "discord"}, {"$set": {"id": "discord", "bot_enabled": True}}, upsert=True)
    public = (await flow.get("/api/settings/public")).json()
    facts = public["privacy_facts"]
    assert facts["email_provider"] == "smtp" and facts["discord"] == {"channels": False, "bot": True} and facts["dolibarr"] is False
    assert set(facts) == {"analytics", "google_login", "passkeys", "discord", "twitch_embed", "steam_status", "email_provider", "dolibarr", "dolibarr_billing", "app", "hosting", "media_scan", "platforms"}
    # Bildprüfung (#415): im Testbetrieb läuft der Testanbieter - das steht ehrlich so drin.
    assert facts["media_scan"]["enabled"] is True and "google_api_key" not in str(facts)


@pytest.mark.asyncio
async def test_board_page_follows_dolibarr_when_the_switch_is_on(flow, fake):
    """Vorstandsseite aus Dolibarr (#326 Teil 2): Funktionen und Inhaber von dort, Name nur mit Einwilligung,
    Foto nur über den eigenen Verzeichnis-Eintrag; ohne Schalter die Posten von Hand."""
    await connect(flow)
    await flow.db.settings.update_one({"id": "branding"}, {"$set": MANUAL}, upsert=True)
    settings = await load_settings(flow.db)
    assert (await club_facts.refresh(flow.db, settings, DolibarrClient(settings)))["ok"] is True

    # Schalter aus: die Posten von Hand (Standard Obmann, Kassier, Schriftführer).
    manual = (await flow.get("/api/board?active_only=true")).json()
    assert [p["slug"] for p in manual] == ["obmann", "kassier", "schriftfuehrer"] and all("source" not in p for p in manual)
    assert (await flow.get("/api/board/source")).json()["dolibarr"] is False

    # Schalter an: Obmann mit Namen, Kassier ohne Einwilligung, Rechnungsprüfer gar nicht.
    await flow.db.settings.update_one({"id": "branding"}, {"$set": {"legal_from_dolibarr": True}})
    board = (await flow.get("/api/board?active_only=true")).json()
    assert [p["slug"] for p in board] == ["obmann", "kassier"] and all(p["source"] == "dolibarr" for p in board)
    obmann, kassier = board
    assert obmann["user"]["display_name"] == "Otto Obmann" and obmann["user"]["avatar_url"] is None and obmann["user"]["profile_url"] is None
    assert obmann["represents"] is True and obmann["since"] == "2024-04-01" and obmann["display_title"] == "Obmann"
    assert kassier["user"] is None and kassier["name_withheld"] is True and kassier["vacant"] is False
    source = (await flow.get("/api/board/source")).json()
    assert source["dolibarr"] is True and source["functions"] == 2 and source["fetched_at"]
    # Der Admin sieht weiter die Posten von Hand als Rückfall.
    assert [p["slug"] for p in (await flow.get("/api/board?manual=true")).json()] == ["obmann", "kassier", "schriftfuehrer"]

    # Foto und Profil nur über ein Konto mit derselben Dolibarr-Funktion, das im Verzeichnis steht.
    otto = await flow.add_user(role="player", name="otto")
    await flow.db.memberships.insert_one({"id": "m-otto", "user_id": otto["id"], "member_status": "active", "source": "dolibarr", "dolibarr": {"functions": [{"code": "obmann", "label": "Obmann", "since": "2024-04-01"}]}})
    await flow.db.club_member_profiles.insert_one({"id": "cp-otto", "user_id": otto["id"], "slug": "otto", "display_name": "Otto Obmann", "gamertag": "OttoGG", "photo_url": "/api/static/uploads/otto.png", "is_active": True, "source": "member"})
    obmann = (await flow.get("/api/board?active_only=true")).json()[0]
    assert obmann["user"]["avatar_url"] == "/api/static/uploads/otto.png" and obmann["user"]["profile_url"] == "/members/otto" and obmann["user"]["gamertag"] == "OttoGG"
    # Aus dem Verzeichnis genommen: nur noch der Name aus Dolibarr.
    await flow.db.club_member_profiles.update_one({"id": "cp-otto"}, {"$set": {"directory_blocked": True}})
    obmann = (await flow.get("/api/board?active_only=true")).json()[0]
    assert obmann["user"]["display_name"] == "Otto Obmann" and obmann["user"]["profile_url"] is None


@pytest.mark.asyncio
async def test_statutes_come_from_dolibarr_only_published_and_the_pdf_is_checked_against_the_file_hash(flow, fake, monkeypatch):
    """Statuten (#326 Teil 3): geltende und beschlossene Fassungen nur mit Schalter und Freigabe im Modul, nie mit
    Prüfsumme nach außen; das PDF nur für eine Fassung aus dem Stand und nur, wenn die Bytes zur Vereinsakte passen."""
    await connect(flow)
    await flow.db.settings.update_one({"id": "branding"}, {"$set": MANUAL}, upsert=True)
    settings = await load_settings(flow.db)
    assert (await club_facts.refresh(flow.db, settings, DolibarrClient(settings)))["statutes"] == "in_force"
    assert (await flow.get("/api/board/statutes")).json() == {"available": False, "reason": "switch_off"}

    await flow.db.settings.update_one({"id": "branding"}, {"$set": {"legal_from_dolibarr": True}})
    public = (await flow.get("/api/board/statutes")).json()
    assert public["available"] is True and public["state"] == "in_force" and public["fetched_at"]
    assert public["current"]["version"] == 2 and public["current"]["valid_from"] == "2026-04-20" and public["current"]["id"] == 3
    assert [(v["version"], v["state"]) for v in public["versions"]] == [(3, "future"), (2, "in_force"), (1, "repealed")]
    assert "sha256" not in public["current"] and all("sha256" not in v and "source" not in v for v in public["versions"])

    # Das PDF: die Bytes der Vereinsakte, als PDF mit Dateinamen; beim zweiten Mal aus dem Speicher.
    pdf = await flow.get("/api/board/statutes/3/pdf")
    assert pdf.status_code == 200 and pdf.headers["content-type"].startswith("application/pdf") and pdf.content == statute_pdf_bytes(3)
    assert 'filename="Statuten-Fassung-2.pdf"' in pdf.headers["content-disposition"]
    calls = len(fake.calls)
    assert (await flow.get("/api/board/statutes/3/pdf")).content == statute_pdf_bytes(3) and len(fake.calls) == calls
    assert (await flow.get("/api/board/statutes/99/pdf")).status_code == 404
    fake.tampered_pdf_ids.add(5)
    tampered = await flow.get("/api/board/statutes/5/pdf")
    assert tampered.status_code == 502 and "Prüfsumme" in tampered.json()["detail"]

    # Der Admin sieht den Stand im Reiter Rechtliches.
    admin = await flow.add_user(role="superadmin", name="admin")
    flow.act_as(admin)
    view = (await flow.get("/api/admin/dolibarr/public")).json()["statutes"]
    assert view["state"] == "in_force" and view["current"]["version"] == 2 and view["versions"] == 3 and view["error"] is None
    flow.act_as(None)

    # Nicht für die Öffentlichkeit freigegeben: nichts, auch nicht die alte Fassung oder ihr PDF.
    fake.statutes_public = False
    await club_facts.refresh(flow.db, settings, DolibarrClient(settings))
    assert (await flow.get("/api/board/statutes")).json() == {"available": False, "reason": "not_published"}
    assert (await flow.get("/api/board/statutes/3/pdf")).status_code == 404

    # Ein Modul ohne Statuten-API: Vereinsdaten und Vorstand kommen weiter, die Statuten sind „nicht abrufbar“.
    async def no_statutes(self):
        raise DolibarrError("not_found", 404)

    monkeypatch.setattr(DolibarrClient, "statutes", no_statutes)
    fake.statutes_public = True
    result = await club_facts.refresh(flow.db, settings, DolibarrClient(settings))
    assert result["ok"] is True and result["statutes"] is None and result["functions"] == len(fake.board)
    state = await club_facts.snapshot(flow.db)
    assert state["statutes_error"] == "not_found" and state["statutes"]["state"] == "not_published", "der letzte Stand bleibt, der Fehler steht daneben"


@pytest.mark.asyncio
async def test_channels_follow_dolibarr_only_with_the_switch_and_only_when_the_club_keeps_some(flow, fake):
    """Kanäle des Vereins (#326 Teil 4): mit Schalter die öffentlichen Kanäle aus dem Modul in dessen Reihenfolge
    (nur mit Adresse, Netzwerk → Plattform-Schlüssel); ohne Schalter oder ohne Kanäle die Liste von Hand."""
    await connect(flow)
    await flow.db.settings.update_one({"id": "branding"}, {"$set": {**MANUAL, "social_links": [{"platform": "instagram", "label": "Insta", "url": "https://instagram.com/hand", "enabled": True}]}}, upsert=True)
    settings = await load_settings(flow.db)
    assert (await club_facts.refresh(flow.db, settings, DolibarrClient(settings)))["ok"] is True
    public = (await flow.get("/api/settings/public")).json()
    assert [link["platform"] for link in public["social_links"]] == ["instagram"] and public["channels_from_dolibarr"] is False

    admin = await flow.add_user(role="superadmin", name="admin")
    flow.act_as(admin)
    assert (await flow.put("/api/settings/branding", json={"channels_from_dolibarr": True})).status_code == 200
    view = (await flow.get("/api/admin/dolibarr/public")).json()
    assert [c["platform"] for c in view["channels"]] == ["twitch", "discord"], "ohne Adresse zählt ein Kanal nicht"
    flow.act_as(None)
    public = (await flow.get("/api/settings/public")).json()
    assert public["channels_from_dolibarr"] is True
    assert [(link["platform"], link["label"], link["url"]) for link in public["social_links"]] == [
        ("twitch", "Hauptstream", "https://www.twitch.tv/testverein"), ("discord", "Community", "https://discord.gg/testverein")]
    assert public["social_links"][0]["stream"] is True and public["social_links"][0]["live_url"] == "https://www.twitch.tv/testverein"

    # Der Verein pflegt im Modul keine Kanäle: die Liste von Hand bleibt.
    fake.organization["channels"] = []
    await club_facts.refresh(flow.db, settings, DolibarrClient(settings))
    public = (await flow.get("/api/settings/public")).json()
    assert [link["platform"] for link in public["social_links"]] == ["instagram"]
    assert club_facts.channels_public({"channels": [{"network": "twitter", "url": "https://x.com/v"}]})[0]["platform"] == "x"
