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

import asyncio

from services.image_variants import (
    VARIANT_WIDTHS,
    build_all_variants,
    build_variant,
    is_resizable,
    normalize_width,
    resolve_variant,
    schedule_variants,
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


def test_the_small_widths_for_profile_pictures_and_logos(bild):
    """#1227: 160 und 320 gibt es dazu - alles dazwischen bleibt abgelehnt."""
    assert normalize_width(160) == 160 and normalize_width(320) == 320
    for wert in (150, 161, 240, 319, 321):
        assert normalize_width(wert) is None
    quelle = bild(width=1200, height=1200)
    klein = build_variant(quelle, 160)
    with Image.open(klein) as im:
        assert im.size == (160, 160)
    assert klein.stat().st_size < quelle.stat().st_size


# ---------------------------------------------------------------- Erzeugen

# Seit nginx die Uploads von der Platte liefert (#232), entstehen die Fassungen
# gleich beim Upload - sonst ginge je Breite noch ein erster Abruf durch die API.

def test_all_smaller_widths_are_built_after_an_upload(bild):
    quelle = bild(width=1000, height=700)

    fertig = build_all_variants(quelle)

    assert [pfad.name for pfad in fertig] == ["foto-160.webp", "foto-320.webp", "foto-400.webp", "foto-800.webp"]
    assert not variant_path(quelle, 1600).exists()


def test_all_widths_come_from_a_single_reading(bild, monkeypatch):
    """#1227: fünf Breiten, aber das Bild wird nur einmal geöffnet und dekodiert.

    Vorher hieß jede Breite ein eigenes Öffnen - unter Windows hielt das die
    Datei fest, während die Bildprüfung sie in die Quarantäne verschieben wollte.
    """
    # Das Modul liest Bilder über dasselbe PIL-Modul wie dieser Test - Image.open hier zu zählen reicht.
    quelle = bild(width=2400, height=1600)
    geoeffnet = []
    original = Image.open

    def zaehlen(*args, **kwargs):
        geoeffnet.append(args[0])
        return original(*args, **kwargs)

    monkeypatch.setattr(Image, "open", zaehlen)
    fertig = build_all_variants(quelle)

    assert [pfad.name for pfad in fertig] == [f"foto-{breite}.webp" for breite in VARIANT_WIDTHS]
    assert len(geoeffnet) == 1


def test_scheduling_outside_the_event_loop_builds_right_away(bild):
    quelle = bild()

    assert schedule_variants(quelle) is None
    assert all(variant_path(quelle, breite).is_file() for breite in VARIANT_WIDTHS)


def test_scheduling_inside_the_event_loop_does_not_block_the_upload(bild):
    quelle = bild()

    async def hochladen():
        aufgabe = schedule_variants(quelle)
        assert aufgabe is not None
        return await aufgabe

    fertig = asyncio.run(hochladen())
    assert len(fertig) == len(VARIANT_WIDTHS)


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


@pytest.mark.parametrize("weg", ["resolve", "build", "build_all"])
def test_an_empty_variant_from_an_interrupted_write_is_rebuilt(bild, weg):
    """Ein abgebrochener Schreibvorgang ließ eine leere Datei liegen. Sie galt als fertig und wurde als leeres Bild ausgeliefert -
    in der Ausrüstung blieben so einzelne Waffen ohne Bild. Eine leere Fassung wird neu gebaut."""
    quelle = bild(width=1280, height=480, name="waffe.png")
    leer = variant_path(quelle, 160)
    leer.parent.mkdir(parents=True, exist_ok=True)
    leer.write_bytes(b"")

    if weg == "resolve":
        fertig = resolve_variant(quelle, 160)
    elif weg == "build":
        fertig = build_variant(quelle, 160)
    else:
        fertig = next(path for path in build_all_variants(quelle) if path == leer)

    assert fertig == leer and leer.stat().st_size > 0
    with Image.open(fertig) as im:
        assert im.size == (160, 60)


def test_a_failed_write_leaves_no_empty_variant_behind(bild, monkeypatch):
    """Scheitert das Schreiben, bleibt weder eine leere Fassung noch eine Zwischendatei - ausgeliefert wird das Original."""
    quelle = bild(width=1280, height=480, name="waffe.png")

    def kaputt(self, fp, *args, **kwargs):
        open(fp, "wb").close()
        raise OSError("Platte voll")

    monkeypatch.setattr(Image.Image, "save", kaputt)

    assert resolve_variant(quelle, 160) is None
    ordner = variant_path(quelle, 160).parent
    assert not ordner.exists() or list(ordner.iterdir()) == []


def test_any_other_error_while_writing_leaves_no_temp_file(bild, monkeypatch):
    quelle = bild(width=1280, height=480, name="waffe.png")

    def kaputt(self, fp, *args, **kwargs):
        open(fp, "wb").write(b"halb")
        raise RuntimeError("unerwartet")

    monkeypatch.setattr(Image.Image, "save", kaputt)

    with pytest.raises(RuntimeError):
        build_variant(quelle, 160)
    ordner = variant_path(quelle, 160).parent
    assert list(ordner.iterdir()) == [], "keine Zwischendatei, keine Fassung"


def test_the_start_sweep_clears_empty_variants_and_stale_temps(bild, tmp_path):
    """nginx liefert, was auf der Platte liegt - darum räumt der Start leere Fassungen und alte Zwischendateien weg."""
    import os
    import time

    from services.image_variants import remove_broken_variants

    quelle = bild(width=1280, height=480, name="waffe.png")
    gut = build_variant(quelle, 320)
    leer = variant_path(quelle, 160)
    leer.write_bytes(b"")
    alt = gut.parent / ".waffe-400.abc.tmp"
    alt.write_bytes(b"x")
    os.utime(alt, (time.time() - 7200, time.time() - 7200))
    frisch = gut.parent / ".waffe-800.def.tmp"
    frisch.write_bytes(b"x")

    assert remove_broken_variants(tmp_path) == 2
    assert not leer.exists() and not alt.exists()
    assert frisch.exists(), "eine laufende Zwischendatei bleibt"
    assert gut.stat().st_size > 0


def test_a_stopped_sweep_ends_early_and_keeps_the_deep_check_for_next_time(bild, tmp_path):
    """Beim Herunterfahren hört der Lauf auf; der Merker bleibt weg, damit der nächste Start gründlich weitermacht."""
    import threading

    from services.image_variants import CHECKED_MARKER, sweep_variants

    quelle = bild(width=1280, height=480, name="waffe.png")
    leer = variant_path(quelle, 160)
    leer.parent.mkdir(parents=True, exist_ok=True)
    leer.write_bytes(b"")
    stop = threading.Event()
    stop.set()

    assert sweep_variants(tmp_path, stop) == 0
    assert leer.exists() and not (tmp_path / CHECKED_MARKER).exists()


def test_erasing_an_upload_also_removes_temp_files_of_its_variants(bild, tmp_path, monkeypatch):
    """Zwischendateien eines abgebrochenen Builds gehören zum Bild der Person - die Kontolöschung nimmt sie mit, fremde nicht."""
    from services import account_erasure

    monkeypatch.setattr(account_erasure, "PUBLIC_UPLOAD_DIR", tmp_path)
    monkeypatch.setattr(account_erasure, "UPLOAD_DIR", tmp_path / "andere")
    quelle = bild(width=1280, height=480, name="waffe.png")
    build_variant(quelle, 320)
    ordner = variant_path(quelle, 160).parent
    eigene = ordner / ".waffe-160.abc.tmp"
    eigene.write_bytes(b"x")
    fremde = ordner / ".schild-160.abc.tmp"
    fremde.write_bytes(b"x")

    class Sammlung:
        async def delete_many(self, query):
            return None

    class Db:
        media_uploads = Sammlung()
        media_scans = Sammlung()

    assert asyncio.run(account_erasure._remove(Db(), "waffe.png", [])) is None
    assert not eigene.exists() and not quelle.exists() and not variant_path(quelle, 320).exists()
    assert fremde.exists()


def test_the_deep_sweep_also_clears_cut_off_variants_with_content(bild, tmp_path):
    """Vor dem atomaren Schreiben konnte eine Fassung auch mit Inhalt abgebrochen sein. Das gründliche Lesen läuft einmal."""
    from services.image_variants import CHECKED_MARKER, remove_broken_variants, sweep_variants

    quelle = bild(width=1280, height=480, name="waffe.png")
    gut = build_variant(quelle, 320)
    halb = build_variant(quelle, 400)
    halb.write_bytes(halb.read_bytes()[:40])

    assert remove_broken_variants(tmp_path) == 0, "ohne gründliches Lesen bleibt sie"
    assert sweep_variants(tmp_path) == 1
    assert not halb.exists() and gut.is_file()
    assert (tmp_path / CHECKED_MARKER).exists()
    halb.write_bytes(b"kaputt")
    assert sweep_variants(tmp_path) == 0, "das gründliche Lesen läuft nur einmal"


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
    assert srcset_widths(900) == [160, 320, 400, 800]
    assert srcset_widths(300) == [160]
    assert srcset_widths(120) == []
    assert srcset_widths(4096) == [160, 320, 400, 800, 1600]
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
