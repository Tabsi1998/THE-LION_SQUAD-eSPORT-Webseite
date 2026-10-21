"""Ergebnis-Bilder auslesen (#1756) Ende-zu-Ende mit Tesseract und synthetischen Screenshots (``result_image_fixture``):
ein sauberes Bild wird ohne Korrektur vollständig richtig gelesen, ein unscharfes markiert jede falsche Zelle gelb.
Dazu die Grenzen beim Öffnen - die laufen auch ohne Tesseract.

Ohne Tesseract (etwa unter Windows) werden die Lese-Tests übersprungen; die CI installiert es und setzt
``REQUIRE_TESSERACT=1`` - dann schlägt ein fehlendes Tesseract fehl, statt still zu überspringen. Nur erfundene Namen.
"""
import io
import os
import pathlib
import struct
import sys
import zlib

import pytest
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import result_image_fixture as fixture  # noqa: E402
from services import result_image_match, result_image_ocr, result_image_templates  # noqa: E402

TEMPLATE = result_image_templates.get(result_image_templates.DEFAULT_ID)
needs_tesseract = pytest.mark.skipif(
    not result_image_ocr.available() and os.environ.get("REQUIRE_TESSERACT") != "1",
    reason="Tesseract fehlt (siehe backend/Dockerfile; die CI installiert es)")


def _people(sheet: fixture.Sheet) -> list[dict]:
    return [{"id": f"p{index}", "name": row.name, "start_number": row.number, "default_team": row.team}
            for index, row in enumerate(sheet.rows)]


def _expected(row: fixture.Row) -> dict:
    return {"place": row.place, "dnf": row.place is None, "start_number": row.number, "name": row.name,
            "team": row.team, "grid": row.grid, "time": None if row.time == "DNF" else (row.time or None),
            "gap": row.gap or None}


def _read(data: bytes, people: list[dict]) -> dict:
    opened = result_image_ocr.open_image(data)
    assert opened.image is not None, opened.message
    return result_image_match.build(result_image_ocr.read(opened.image, TEMPLATE), TEMPLATE, people)


def _compare(out: dict, sheet: fixture.Sheet) -> tuple[list[str], list[str]]:
    """Falsche Zellen, die gelb sind, und falsche, die es nicht sind."""
    assert len(out["rows"]) == len(sheet.rows)
    flagged, silent = [], []
    for got, row in zip(out["rows"], sheet.rows):
        for key, value in _expected(row).items():
            if got[key] != value:
                field = "place" if key == "dnf" else key
                (flagged if field in got["uncertain"] else silent).append(f"{row.name}/{key}: {got[key]!r}")
    return flagged, silent


# ---------------------------------------------------------------- Lesen
@needs_tesseract
def test_clean_screenshot_is_read_completely_without_corrections():
    sheet = fixture.sample_sheet()
    out = _read(fixture.png_bytes(fixture.render(sheet)), _people(sheet))
    flagged, silent = _compare(out, sheet)
    assert (flagged, silent) == ([], [])
    assert out["uncertain_rows"] == 0
    assert [row["participant_id"] for row in out["rows"]] == [f"p{index}" for index in range(len(sheet.rows))]
    assert out["track"] == {"name": "Probering Nord", "uncertain": []}
    assert (out["fastest_lap"]["name"], out["fastest_lap"]["time"], out["fastest_lap"]["uncertain"]) == (
        "Mia Motorhaube", "1:31.207", [])
    assert (out["driver_of_the_day"]["name"], out["driver_of_the_day"]["uncertain"]) == ("Otto Ostwind", [])


@needs_tesseract
def test_clean_screenshot_without_known_participants_reads_every_value():
    sheet = fixture.sample_sheet()
    out = _read(fixture.png_bytes(fixture.render(sheet)), [])
    flagged, silent = _compare(out, sheet)
    assert (flagged, silent) == ([], [])
    assert all(row["participant_id"] is None for row in out["rows"])


@needs_tesseract
def test_blurry_screenshot_marks_every_wrong_cell():
    sheet = fixture.sample_sheet()
    out = _read(fixture.jpeg_bytes(fixture.blurry(fixture.render(sheet)), quality=90), _people(sheet))
    flagged, silent = _compare(out, sheet)
    assert silent == []
    assert out["uncertain_rows"] >= 1


@needs_tesseract
def test_scaled_and_cropped_screenshots():
    sheet = fixture.sample_sheet()
    img = fixture.render(sheet)
    small = img.resize((int(img.width * 0.6), int(img.height * 0.6)), Image.Resampling.LANCZOS)
    table_only = img.crop((0, 245, img.width, img.height))  # ohne Kopf und ohne Überschriften
    for picture in (small, table_only):
        out = _read(fixture.png_bytes(picture), _people(sheet))
        assert _compare(out, sheet)[1] == []
    assert out["track"] is None and out["fastest_lap"] is None


# ---------------------------------------------------------------- Öffnen und Grenzen
def _png_header(width: int, height: int) -> bytes:
    """Nur Signatur und Kopf (IHDR) einer PNG-Datei mit den angegebenen Maßen - ohne Bilddaten."""
    def chunk(kind: bytes, body: bytes) -> bytes:
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IEND", b"")


def test_pixel_limit_is_checked_on_the_header_before_decoding():
    side = int((result_image_ocr.MAX_IMAGE_PIXELS * 1.2) ** 0.5)
    opened = result_image_ocr.open_image(_png_header(side, side))
    assert (opened.image, opened.status, opened.message) == (None, 413, result_image_ocr.TOO_MANY_PIXELS)
    huge = result_image_ocr.open_image(_png_header(60000, 60000))  # weit über der Grenze: Pillow bricht schon ab
    assert (huge.status, huge.message) == (413, result_image_ocr.TOO_MANY_PIXELS)


def test_only_real_png_jpeg_or_webp_images_are_opened(monkeypatch):
    img = fixture.render()
    for fmt in ("PNG", "JPEG", "WEBP"):
        buffer = io.BytesIO()
        img.save(buffer, format=fmt)
        opened = result_image_ocr.open_image(buffer.getvalue())
        assert opened.image is not None and opened.image.mode == "RGB", fmt
    gif = io.BytesIO()
    img.convert("P").save(gif, format="GIF")
    assert result_image_ocr.open_image(gif.getvalue()).message == result_image_ocr.WRONG_FORMAT
    svg = b'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>'
    assert result_image_ocr.open_image(svg).status == 400
    assert result_image_ocr.open_image(b"").message == result_image_ocr.EMPTY
    assert result_image_ocr.open_image(_png_header(20, 20)).message == result_image_ocr.TOO_SMALL
    broken = _png_header(400, 300)  # Kopf ohne Bilddaten
    assert result_image_ocr.open_image(broken).message == result_image_ocr.BROKEN
    monkeypatch.setattr(result_image_ocr, "MAX_BYTES", 100)
    assert result_image_ocr.open_image(fixture.png_bytes(img)).status == 413


def test_reencoded_original_has_no_metadata_and_keeps_the_format():
    """Für #1933 (Original am Termin): das gelesene Bild neu kodiert - gedreht nach EXIF, ohne EXIF, im Format der
    Vorlage (Foto JPEG, Screenshot PNG). Gespeichert wird es hier nicht."""
    photo = Image.new("RGB", (300, 120), (20, 20, 30))
    exif = Image.Exif()
    exif[0x0112] = 6  # um 90 Grad gedreht aufgenommen
    exif[0x010F] = "Probe-Kamera"
    buffer = io.BytesIO()
    photo.save(buffer, format="JPEG", exif=exif.tobytes())
    opened = result_image_ocr.open_image(buffer.getvalue())
    data, content_type = result_image_ocr.encode_original(opened)
    again = Image.open(io.BytesIO(data))
    assert (content_type, again.format, again.size) == ("image/jpeg", "JPEG", (120, 300))
    assert dict(again.getexif()) == {}
    screenshot = result_image_ocr.open_image(fixture.png_bytes(fixture.render()))
    data, content_type = result_image_ocr.encode_original(screenshot)
    reopened = Image.open(io.BytesIO(data))
    assert (content_type, reopened.format) == ("image/png", "PNG")
    assert result_image_ocr.encode_original(result_image_ocr.open_image(b"")) == (b"", "")


def test_large_images_are_shrunk_for_reading():
    big = Image.new("RGB", (result_image_ocr.MAX_IMAGE_DIMENSION + 400, 300), (20, 20, 30))
    opened = result_image_ocr.open_image(fixture.png_bytes(big))
    assert max(opened.image.size) == result_image_ocr.MAX_IMAGE_DIMENSION


def test_tesseract_runs_without_shell_network_or_files(monkeypatch):
    """Feste Argumente, Eingabe über stdin, leere Umgebung ohne Proxy, Zeitlimit."""
    seen = {}

    class Done:
        returncode = 0
        stdout = (b"level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n"
                  b"5\t1\t1\t1\t1\t1\t10\t20\t30\t40\t96.5\tProbe\n")

    def fake_run(args, **kwargs):
        seen["args"], seen["kwargs"] = args, kwargs
        return Done()

    monkeypatch.setattr(result_image_ocr, "command", lambda: "/usr/bin/tesseract")
    monkeypatch.setattr(result_image_ocr, "languages", lambda: "eng")
    monkeypatch.setattr(result_image_ocr.subprocess, "run", fake_run)
    monkeypatch.setenv("HTTPS_PROXY", "http://proxy.example.test:3128")
    words = result_image_ocr.tesseract(Image.new("L", (50, 50), 255), psm=6, whitelist="0123456789")
    assert [(word.text, word.conf, word.left, word.top) for word in words] == [("Probe", 96.5, 10, 20)]
    args, kwargs = seen["args"], seen["kwargs"]
    assert args[:3] == ["/usr/bin/tesseract", "stdin", "stdout"]
    assert "tessedit_char_whitelist=0123456789" in args
    assert kwargs["input"].startswith(b"\x89PNG")
    assert kwargs["timeout"] == result_image_ocr.TIMEOUT_SECONDS
    assert "shell" not in kwargs
    assert set(kwargs["env"]) <= {"OMP_THREAD_LIMIT", "LC_ALL", "PATH", "TESSDATA_PREFIX"}
