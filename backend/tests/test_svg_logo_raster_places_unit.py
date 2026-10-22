"""Logos als SVG (#1952): Wo kein SVG geht, kommt die PNG-Fassung - Mail, PDF, Teilen-Bild (auch die Teilen-Karte der
Serie aus #2014), Discord, Favicon bzw. App-Symbole und die Bild-Migration. Logos aus Dolibarr bleiben, wie sie kommen;
ein hochgeladenes SVG geht vor."""
import asyncio
import io
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
from PIL import Image  # noqa: E402

import email_service  # noqa: E402
import pdf_service  # noqa: E402
from routes import seo_render_routes  # noqa: E402
from services import (  # noqa: E402
    brand_favicon, discord_design, discord_links, image_migrate, mail_queue, sponsor_images, svg_logo,
)

SVG = "/api/static/uploads/kiwi123.svg"
PNG = "/api/static/uploads/kiwi123.png"
CLEAN = (b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">'
         b'<circle cx="20" cy="20" r="18" fill="#29B6E8"/></svg>')


@pytest.fixture
def uploads(tmp_path, monkeypatch):
    for module in (svg_logo, pdf_service, brand_favicon, image_migrate):
        monkeypatch.setattr(module, "PUBLIC_UPLOAD_DIR", tmp_path)
    (tmp_path / "kiwi123.svg").write_bytes(CLEAN)
    buffer = io.BytesIO()
    Image.new("RGBA", (64, 64), (41, 182, 232, 255)).save(buffer, format="PNG")
    (tmp_path / "kiwi123.png").write_bytes(buffer.getvalue())
    return tmp_path


def test_pdf_and_favicon_read_the_png(uploads):
    assert pdf_service._local_upload_path(SVG) == uploads / "kiwi123.png"
    assert pdf_service._brand_asset_path(f"https://lionsquad.example{SVG}") == uploads / "kiwi123.png"
    assert brand_favicon.asset_path(SVG) == uploads / "kiwi123.png"
    favicon = brand_favicon.universal_favicon_png(brand_favicon.asset_path(SVG).read_bytes(), None)
    with Image.open(io.BytesIO(favicon)) as icon:
        assert icon.size == (brand_favicon.SIZE, brand_favicon.SIZE)


def test_share_cards_and_discord_get_the_png(uploads):
    origin = "https://lionsquad.example"
    assert seo_render_routes.absolute_url(SVG, origin) == f"{origin}{PNG}"
    assert seo_render_routes._series_logo_image({"logo_url": SVG}, {}, origin) == {"image": f"{origin}{PNG}"}
    assert discord_design.public_url(f"{origin}{SVG}") == f"{origin}{PNG}"

    async def base():
        return origin

    original = discord_links._public_base_url
    discord_links._public_base_url = base
    try:
        assert asyncio.run(discord_links._public_avatar_url(SVG)) == f"{origin}{PNG}"
    finally:
        discord_links._public_base_url = original


def test_every_mail_carries_the_png(uploads, monkeypatch):
    sent = []

    async def smtp(cfg, to, subject, html):
        sent.append(html)
        return "id-1"

    monkeypatch.setattr(mail_queue, "_smtp_send", smtp)
    html = f'<img src="https://lionsquad.example{SVG}" alt="Kiwi">'
    smtp_config = {"provider": "smtp", "smtp_host": "mail.example"}
    asyncio.run(mail_queue._dispatch(smtp_config, "a@example.test", "Hallo", html))
    assert sent == [f'<img src="https://lionsquad.example{PNG}" alt="Kiwi">']

    captured = {}

    class FakeEmails:
        @staticmethod
        def send(params):
            captured.update(params)
            return {"id": "x"}

    class FakeLogs:
        async def insert_one(self, row):
            return None

    async def config():
        return {"enabled": True, "api_key": "re_test", "from_header": "Verein <noreply@example.test>"}

    monkeypatch.setattr(email_service, "_get_email_config", config)
    monkeypatch.setattr(email_service, "get_db", lambda: type("Db", (), {"email_logs": FakeLogs()})())
    monkeypatch.setattr(email_service.resend, "Emails", FakeEmails)
    asyncio.run(email_service.send_mail("a@example.test", "Hallo", html))
    assert PNG in captured["html"] and SVG not in captured["html"]


def test_uploaded_svg_beats_dolibarr_but_raster_uploads_keep_the_old_order():
    dolibarr = {"logo": {"dark": {"url": "/api/static/uploads/dolibarr-partner-1-logo-dark-aa.png"},
                         "light": {"url": "/api/static/uploads/dolibarr-partner-1-logo-light-bb.png"}}}
    with_svg = {"logo_url": SVG, "dolibarr_images": dolibarr}
    assert sponsor_images.pick(with_svg, "logo", "dark") == (SVG, "upload")
    assert sponsor_images.pick(with_svg, "logo", "light") == (SVG, "upload")
    with_png = {"logo_url": "/api/static/uploads/upload.png", "dolibarr_images": dolibarr}
    assert sponsor_images.pick(with_png, "logo", "dark")[1] == "dolibarr-dark"
    assert sponsor_images.pick(with_png, "logo", "light")[1] == "dolibarr-light"


class FakeResponse:
    def __init__(self, content: bytes, content_type: str):
        self.status_code = 200
        self.content = content
        self.headers = {"content-type": content_type}


class FakeClient:
    def __init__(self, response):
        self.response = response

    async def get(self, url, **kwargs):
        return self.response


def test_image_migration_stores_only_a_cleaned_svg(uploads):
    evil = (b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" onload="alert(1)"><script>alert(2)</script>'
            b'<rect width="40" height="40" fill="#29B6E8"/></svg>')
    client = FakeClient(FakeResponse(evil, "image/svg+xml"))
    url = asyncio.run(image_migrate._download_to_local("https://fremd.example/logo.svg", client))
    assert url and url.endswith(".svg")
    stored = (uploads / url.rsplit("/", 1)[1]).read_text(encoding="utf-8")
    assert "script" not in stored and "onload" not in stored
    assert (uploads / url.rsplit("/", 1)[1].replace(".svg", ".png")).is_file()
    empty = FakeClient(FakeResponse(b"<svg><script>alert(1)</script></svg>", "image/svg+xml"))
    nothing = asyncio.run(image_migrate._download_to_local("https://fremd.example/x.svg", empty))
    assert nothing is None
