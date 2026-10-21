"""Sponsoren- und Partner-Logos einfarbig (#1321): der Server sagt, ob ein Logo durchsichtig ist (dann färbt die Website
es weiß), und speichert eine eigene weiße Fassung (``logo_mono_url``) - leeren geht auch."""
import pathlib
import sys

import pytest
import pytest_asyncio
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import logo_tone  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def uploads(monkeypatch, tmp_path):
    monkeypatch.setattr(logo_tone, "UPLOAD_DIR", tmp_path)
    monkeypatch.setattr(logo_tone, "PUBLIC_UPLOAD_DIR", tmp_path / "public")
    logo_tone._transparent_cached.cache_clear()

    def save(name, mode, color, inner=None, fmt=None):
        image = Image.new(mode, (120, 60), color)
        if inner is not None:
            for x in range(30, 90):
                for y in range(15, 45):
                    image.putpixel((x, y), inner)
        image.save(tmp_path / name, format=fmt)
        return f"/api/static/uploads/{name}"

    return save


def test_transparency_from_the_file(uploads):
    clear = uploads("clear.png", "RGBA", (0, 0, 0, 0), inner=(255, 120, 0, 255))
    boxed = uploads("boxed.png", "RGBA", (255, 255, 255, 255), inner=(255, 120, 0, 255))
    jpeg = uploads("photo.jpg", "RGB", (255, 255, 255), inner=(255, 120, 0), fmt="JPEG")
    assert logo_tone.logo_transparent(clear) is True
    assert logo_tone.logo_transparent(boxed) is False, "weißer Kasten trotz Alphakanal"
    assert logo_tone.logo_transparent(jpeg) is False, "JPEG hat keinen Alphakanal"
    assert logo_tone.logo_transparent("https://example.org/logo.png") is None
    assert logo_tone.logo_transparent("/api/static/uploads/../geheim.png") is None
    assert logo_tone.logo_transparent("/api/static/uploads/fehlt.png") is None
    assert logo_tone.logo_transparent(None) is None


@pytest.mark.asyncio
async def test_sponsor_and_partner_carry_transparency_and_white_version(flow, uploads):
    clear = uploads("sponsor-clear.png", "RGBA", (0, 0, 0, 0), inner=(10, 200, 90, 255))
    boxed = uploads("partner-boxed.png", "RGBA", (0, 0, 0, 255), inner=(10, 200, 90, 255))
    mono = uploads("partner-mono.png", "RGBA", (0, 0, 0, 0), inner=(255, 255, 255, 255))
    admin = await flow.add_user(role="superadmin")
    flow.act_as(admin)

    sponsor = await flow.post("/api/sponsors", json={"name": "Alpha", "logo_url": clear, "tier": "gold"})
    assert sponsor.status_code == 200, sponsor.text
    partner = await flow.post("/api/partners", json={"name": "Gamma", "logo_url": boxed, "logo_mono_url": mono})
    assert partner.status_code == 200, partner.text

    public_sponsor = next(s for s in (await flow.get("/api/sponsors")).json() if s["name"] == "Alpha")
    assert public_sponsor["logo_transparent"] is True
    assert public_sponsor.get("logo_mono_url") is None
    public_partner = next(p for p in (await flow.get("/api/partners")).json() if p["name"] == "Gamma")
    assert public_partner["logo_transparent"] is False
    assert public_partner["logo_mono_url"] == mono

    admin_rows = (await flow.get("/api/partners/admin")).json()
    assert next(p for p in admin_rows if p["name"] == "Gamma")["logo_transparent"] is False
    admin_sponsors = (await flow.get("/api/sponsors/admin")).json()
    assert next(s for s in admin_sponsors if s["name"] == "Alpha")["logo_transparent"] is True

    # Weiße Fassung leeren und beim Sponsor setzen.
    cleared = await flow.patch(f"/api/partners/{partner.json()['id']}", json={"logo_mono_url": None})
    assert cleared.status_code == 200, cleared.text
    assert cleared.json().get("logo_mono_url") is None
    updated = await flow.patch(f"/api/sponsors/{sponsor.json()['id']}", json={"logo_mono_url": mono})
    assert updated.status_code == 200, updated.text
    assert updated.json()["logo_mono_url"] == mono
    public_sponsor = next(s for s in (await flow.get("/api/sponsors")).json() if s["name"] == "Alpha")
    assert public_sponsor["logo_mono_url"] == mono


def test_partner_badge_for_events_carries_white_version_and_transparency(uploads):
    from services.partner_pages import partner_badge

    clear = uploads("badge-clear.png", "RGBA", (0, 0, 0, 0), inner=(10, 200, 90, 255))
    doc = {"id": "p1", "slug": "gamma", "name": "Gamma", "logo_url": clear, "logo_mono_url": "/api/static/uploads/w.png"}
    assert "logo_mono_url" not in partner_badge(doc), "Referenzen und Turniere bleiben, wie sie waren"
    badge = partner_badge(doc, tone=True)
    assert badge["logo_transparent"] is True
    assert badge["logo_mono_url"] == "/api/static/uploads/w.png"


def _png_huge_in_header(width=30000, height=30000) -> bytes:
    """Ein kleines PNG, dessen Kopf ein Riesenbild ankündigt - so kostet es beim Dekodieren viel Speicher."""
    import struct
    import zlib
    from io import BytesIO

    buffer = BytesIO()
    Image.new("RGBA", (4, 4), (0, 0, 0, 0)).save(buffer, format="PNG")
    data = bytearray(buffer.getvalue())
    ihdr = data[12:29]  # Typ "IHDR" und 13 Bytes Inhalt
    ihdr[4:12] = struct.pack(">II", width, height)
    data[12:29] = ihdr
    data[29:33] = struct.pack(">I", zlib.crc32(bytes(ihdr)) & 0xFFFFFFFF)
    return bytes(data)


def test_huge_image_is_not_decoded_but_counts_as_unknown(uploads, monkeypatch, tmp_path):
    (tmp_path / "riesig.png").write_bytes(_png_huge_in_header())

    def no_decode(*_args, **_kwargs):
        raise AssertionError("Riesenbild darf nicht dekodiert werden")

    monkeypatch.setattr(Image.Image, "load", no_decode)
    assert logo_tone.logo_transparent("/api/static/uploads/riesig.png") is None


def test_dolibarr_image_that_is_huge_in_header_is_rejected():
    from io import BytesIO

    from services import sponsor_images

    assert sponsor_images.oversized(_png_huge_in_header()) is True
    assert sponsor_images.oversized(_png_huge_in_header(4096, 2)) is False
    small = BytesIO()
    Image.new("RGBA", (40, 20)).save(small, format="PNG")
    assert sponsor_images.oversized(small.getvalue()) is False
    assert sponsor_images.oversized(b"\x89PNG-kein-echtes-bild") is False
