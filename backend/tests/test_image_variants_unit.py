"""Kleinere Fassungen eines Bildes, und was dabei nicht passieren darf.

Eine Rasterkachel ist rund 400 Pixel breit und bekam bisher das gespeicherte
Bild mit bis zu 4096 Pixeln - etwa hundertmal so viele Bildpunkte, wie sie
zeigt. Die Bytes fallen auf einer Handyverbindung ins Gewicht, das Dekodieren
noch mehr: elf Megapixel je Kachel bringt ein Telefon ins Stocken, unabhaengig
von der Kompression.
"""
import io

import pytest
from PIL import Image

from services.image_variants import (
    VARIANT_WIDTHS,
    build_variant,
    is_resizable,
    normalize_width,
    resolve_variant,
    srcset_widths,
    variant_path,
)


@pytest.fixture
def bild(tmp_path):
    def _make(width=2400, height=1600, name="foto.webp"):
        path = tmp_path / name
        Image.new("RGB", (width, height), (90, 120, 160)).save(path)
        return path
    return _make


# ---------------------------------------------------------------- Breiten

@pytest.mark.parametrize("width", VARIANT_WIDTHS)
def test_the_offered_widths_are_accepted(width):
    assert normalize_width(width) == width


@pytest.mark.parametrize("wert", [0, -1, 4095, 12000, "gross", None, "", 3.7])
def test_any_other_width_is_refused_rather_than_rounded(wert):
    """Ein offener Skalierer ist ein Weg, eine Platte vollzuschreiben."""
    assert normalize_width(wert) is None


def test_a_width_between_two_offers_is_not_silently_upgraded():
    assert normalize_width(401) is None
    assert normalize_width(799) is None


# ---------------------------------------------------------------- Erzeugen

def test_a_variant_is_written_once_and_then_reused(bild):
    quelle = bild()

    erste = build_variant(quelle, 400)

    assert erste is not None and erste.is_file()
    assert erste == variant_path(quelle, 400)
    with Image.open(erste) as im:
        assert im.width == 400
    stempel = erste.stat().st_mtime_ns
    assert build_variant(quelle, 400) == erste
    assert erste.stat().st_mtime_ns == stempel, "die zweite Anfrage rechnet nicht neu"


def test_a_picture_smaller_than_the_request_is_left_alone(bild):
    """Hochskalieren kostet Bytes und bringt nichts."""
    klein = bild(width=300, height=200, name="klein.webp")

    assert build_variant(klein, 400) is None
    assert resolve_variant(klein, 400) is None, "dann wird das Original ausgeliefert"


def test_the_aspect_ratio_is_kept(bild):
    quelle = bild(width=2400, height=1600)

    variante = build_variant(quelle, 800)

    with Image.open(variante) as im:
        assert im.width == 800
        assert im.height == pytest.approx(533, abs=2)


def test_variants_live_beside_the_original_not_in_place_of_it(bild):
    quelle = bild()

    variante = build_variant(quelle, 400)

    assert quelle.is_file(), "das Original bleibt unangetastet"
    assert variante.parent.name == "variants"


def test_a_broken_file_does_not_take_the_request_down(tmp_path):
    kaputt = tmp_path / "kaputt.webp"
    kaputt.write_bytes(b"das ist kein Bild")

    assert build_variant(kaputt, 400) is None
    assert resolve_variant(kaputt, 400) is None


def test_a_video_is_never_resized(tmp_path):
    video = tmp_path / "clip.mp4"
    video.write_bytes(b"\x00" * 32)

    assert is_resizable(video) is False
    assert resolve_variant(video, 400) is None


def test_a_missing_file_is_answered_with_none(tmp_path):
    assert resolve_variant(tmp_path / "gibtsnicht.webp", 400) is None


# ---------------------------------------------------------------- Auswahl

def test_only_widths_below_the_original_are_worth_offering():
    """Sonst laedt ein Browser dieselbe Datei unter zwei Namen."""
    assert srcset_widths(900) == [400, 800]
    assert srcset_widths(300) == []
    assert srcset_widths(4096) == [400, 800, 1600]
    assert srcset_widths(None) == list(VARIANT_WIDTHS)


# ---------------------------------------------------------------- Durch die Route

@pytest.mark.asyncio
async def test_the_route_serves_the_smaller_copy(tmp_path, monkeypatch):
    """Die Verdrahtung, die ein Unit-Test allein nicht prueft.

    Ohne ``w`` kommt das gespeicherte Bild, mit ``w=400`` die kleinere Fassung -
    und die muss deutlich weniger wiegen, sonst hat sich nichts geaendert.
    """
    import pathlib
    import sys

    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
    from flow_harness import make_flow

    instance, shutdown = make_flow()
    try:
        import server

        monkeypatch.setattr(server, "upload_dir", tmp_path)
        monkeypatch.setattr(server, "public_upload_dir", tmp_path)

        gross = tmp_path / "galerie.webp"
        Image.new("RGB", (3200, 2000), (70, 110, 150)).save(gross, format="WEBP", quality=88)

        original = await instance.get("/api/static/uploads/galerie.webp")
        verkleinert = await instance.get("/api/static/uploads/galerie.webp?w=400")

        assert original.status_code == 200
        assert verkleinert.status_code == 200
        assert verkleinert.headers["content-type"] == "image/webp"
        assert len(verkleinert.content) < len(original.content) / 2, (
            f"verkleinert {len(verkleinert.content)} B gegen Original {len(original.content)} B"
        )
        with Image.open(io.BytesIO(verkleinert.content)) as im:
            assert im.width == 400
    finally:
        await shutdown()


@pytest.mark.asyncio
async def test_the_route_refuses_a_width_it_does_not_keep(tmp_path, monkeypatch):
    """Eine unbekannte Breite liefert das Original, statt eine Datei anzulegen."""
    import pathlib
    import sys

    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
    from flow_harness import make_flow

    instance, shutdown = make_flow()
    try:
        import server

        monkeypatch.setattr(server, "upload_dir", tmp_path)
        monkeypatch.setattr(server, "public_upload_dir", tmp_path)
        quelle = tmp_path / "galerie.webp"
        Image.new("RGB", (3200, 2000), (70, 110, 150)).save(quelle, format="WEBP", quality=88)

        original = await instance.get("/api/static/uploads/galerie.webp")
        krumm = await instance.get("/api/static/uploads/galerie.webp?w=1234")

        assert krumm.status_code == 200
        assert len(krumm.content) == len(original.content)
        assert not (tmp_path / "variants").exists(), "keine Datei fuer eine Breite, die es nicht gibt"
    finally:
        await shutdown()
