"""Rechtstexte an einem Ort (#545): Datenschutz, Impressum und Nutzungsbedingungen kommen als Abschnitte vom
Backend, die Crawler-Vorschau liefert denselben vollständigen Text, die Startseite erklärt sich ohne
JavaScript - und die Datenschutzerklärung nennt jede eingerichtete Verbindung von selbst, bei Google mit
dem verlangten Hinweis auf die API Services User Data Policy."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import site_texts  # noqa: E402
from services.secret_store import encrypt_secret  # noqa: E402

BRANDING = {
    "id": "branding", "club_name": "THE LION SQUAD", "legal_name": "Testverein Löwen", "contact_email": "office@lionsquad-test.at",
    "privacy_contact_email": "dsgvo@lionsquad-test.at", "street_address": "Teststraße 1", "postal_code": "6410", "city": "Testdorf", "country": "Österreich",
    "representative_name": "Otto Obmann", "representative_role": "Obmann", "zvr_number": "123456789", "hosting_provider": "Eigenhosting", "hosting_country": "Österreich",
    "privacy_extra": "Extra <script>alert(1)</script> Hinweis", "play_store_url": "https://play.google.com/store/apps/details?id=at.lionsquad",
}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def blocks(doc: dict, section_id: str) -> list[dict]:
    return next(sec for sec in doc["sections"] if sec["id"] == section_id)["blocks"]


def block(doc: dict, testid: str) -> dict:
    return next(b for sec in doc["sections"] for b in sec["blocks"] if b.get("testid") == testid)


@pytest.mark.asyncio
async def test_without_services_the_privacy_page_says_so_and_the_imprint_shows_the_public_values(flow):
    await flow.db.settings.replace_one({"id": "branding"}, BRANDING, upsert=True)
    privacy = (await flow.get("/api/settings/public/legal/privacy")).json()
    ids = [sec["id"] for sec in privacy["sections"]]
    assert "account-deletion" in ids and "google" not in ids and "discord" not in ids and "dolibarr" not in ids
    assert block(privacy, "privacy-no-google-login")
    assert "keinen Statistik- oder Tracking-Dienst" in block(privacy, "privacy-analytics")["text"]
    assert "kein E-Mail-Versand" in block(privacy, "privacy-email")["text"]
    assert "Crashlytics" in block(privacy, "privacy-app")["text"]
    assert any("eigener Infrastruktur des Vereins" in item for item in block(privacy, "privacy-recipients")["items"])
    # Steam braucht keine App - es ist die einzige Plattform, die ohne Einrichtung verknüpfbar ist.
    assert block(privacy, "privacy-platform-list")["items"] == ["Steam: SteamID64 und, falls ein Steam-API-Schlüssel hinterlegt ist, der Anzeigename – Betreiber: Valve Corporation, USA"]
    rows = dict((label, value) for label, value in blocks(privacy, "controller")[0]["rows"])
    assert rows["Verantwortlicher"] == "Testverein Löwen" and rows["Adresse"] == ["Teststraße 1", "6410 Testdorf", "Österreich"]
    assert rows["Datenschutz"] == "[dsgvo@lionsquad-test.at](mailto:dsgvo@lionsquad-test.at)"

    imprint = (await flow.get("/api/settings/public/legal/imprint")).json()
    operator = dict((label, value) for label, value in blocks(imprint, "operator")[0]["rows"])
    assert operator["Verein"] == "Testverein Löwen" and operator["ZVR-Zahl"] == "123456789"
    representation = dict((label, value) for label, value in blocks(imprint, "representation")[0]["rows"])
    assert representation["Vertretungsbefugt"] == "Otto Obmann" and representation["Inhaltlich verantwortlich"] == "Otto Obmann"
    terms = (await flow.get("/api/settings/public/legal/terms")).json()
    assert terms["title"] == "Nutzungsbedingungen" and "Testverein Löwen" in terms["intro"]
    assert (await flow.get("/api/settings/public/legal/nope")).status_code == 404


@pytest.mark.asyncio
async def test_configured_services_appear_with_googles_limited_use_notice_and_the_crawler_gets_the_full_text(flow):
    await flow.db.settings.replace_one({"id": "branding"}, {
        **BRANDING, "youtube_client_id": "yt-id", "youtube_client_secret": encrypt_secret("yt-secret"),
        "discord_client_id": "d-id", "discord_client_secret": encrypt_secret("d-secret"),
    }, upsert=True)
    await flow.db.settings.update_one({"id": "auth"}, {"$set": {"google_login_enabled": True, "google_client_id": "abc.apps.googleusercontent.com"}}, upsert=True)
    await flow.db.settings.update_one({"id": "email"}, {"$set": {"provider": "resend", "resend_api_key": encrypt_secret("re_x")}}, upsert=True)
    await flow.db.settings.update_one({"id": "discord"}, {"$set": {"webhook_url": "https://discord.com/api/webhooks/1/x", "bot_enabled": True}}, upsert=True)

    privacy = (await flow.get("/api/settings/public/legal/privacy")).json()
    assert "Mit Google anmelden" in block(privacy, "privacy-google-login")["text"]
    assert "youtube.readonly" in block(privacy, "privacy-youtube")["text"]
    limited = block(privacy, "privacy-google-limited-use")["text"]
    assert "Limited-Use" in limited and site_texts.GOOGLE_USER_DATA_POLICY in limited and "Testverein Löwen" in limited
    platforms = block(privacy, "privacy-platform-list")["items"]
    assert any(item.startswith("Discord:") and "Discord Inc." in item for item in platforms)
    assert any(item.startswith("YouTube:") and "Google Ireland" in item for item in platforms)
    assert "Discord, Steam, YouTube" in block(privacy, "privacy-platform-links")["text"]
    recipients = block(privacy, "privacy-recipients")["items"]
    assert any("Resend, Inc." in item for item in recipients) and any("Verknüpfung YouTube: Google Ireland Ltd." in item for item in recipients)
    assert block(privacy, "privacy-discord-bot") and block(privacy, "privacy-discord-webhooks")
    assert blocks(privacy, "extra")[0] == {"type": "text", "text": "Extra <script>alert(1)</script> Hinweis"}

    # Die Crawler-Vorschau: derselbe Text als HTML, Vereinstext escaped, Anker für Google Play bleibt.
    html = (await flow.get("/api/seo/preview", params={"path": "/privacy"})).text
    assert "<h2>Google-Nutzerdaten</h2>" in html and "Limited-Use-Anforderungen" in html
    assert '<section id="account-deletion">' in html and '<a href="/privacy-account">' in html
    assert "<script>alert(1)</script>" not in html and "&lt;script&gt;alert(1)&lt;/script&gt;" in html
    assert "<strong>Passkey</strong>" in html
    assert html.count("<h2>") >= 20

    home = (await flow.get("/api/seo/preview", params={"path": "/"})).text
    assert "ohne Konto und ohne Anmeldung erreichbar" in home and "<h1>THE LION SQUAD</h1>" in home
    assert '<a href="/privacy">Datenschutzerklärung</a>' in home and '<a href="/terms">Nutzungsbedingungen</a>' in home
    assert "play.google.com" in home

    imprint_html = (await flow.get("/api/seo/preview", params={"path": "/imprint"})).text
    assert "<dt>ZVR-Zahl</dt><dd>123456789</dd>" in imprint_html and "Teststraße 1<br />6410 Testdorf" in imprint_html


def test_inline_markup_allows_bold_and_safe_links_only():
    assert site_texts.inline_html("**fett** & [Kontakt](/contact) [Mail](mailto:a@b.c) [Web](https://x.y/) [böse](javascript:alert(1)) <b>") == (
        '<strong>fett</strong> &amp; <a href="/contact">Kontakt</a> <a href="mailto:a@b.c">Mail</a> <a href="https://x.y/">Web</a> '
        "[böse](javascript:alert(1)) &lt;b&gt;")
    assert site_texts.inline_html('[x](/a" onclick="y)') == '<a href="/a&quot; onclick=&quot;y">x</a>'
