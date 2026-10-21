"""Ergebnis-Bilder auslesen (#1756) Ende-zu-Ende mit Tesseract und synthetischen Screenshots (``result_image_fixture``):
ein sauberes Bild wird ohne Korrektur vollständig richtig gelesen, ein unscharfes markiert jede falsche Zelle gelb.
Dazu die Grenzen beim Öffnen - die laufen auch ohne Tesseract.

Ohne Tesseract (etwa unter Windows) werden die Lese-Tests übersprungen; die CI installiert es und setzt
``REQUIRE_TESSERACT=1`` - dann schlägt ein fehlendes Tesseract fehl, statt still zu überspringen. Nur erfundene Namen.
"""
import io
import os
import pathlib
import random
import struct
import sys
import zlib

import pytest
from PIL import Image, ImageDraw

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
    # Wie in der Liga (#1981): Platz 1 im farbigen Kasten, Platzhalter statt Abstand, Zeiten mit Komma, Rand der
    # Tabelle - gespeichert mit Punkt, ohne Abstand beim Ersten, keine Punkte aus dem Rand.
    assert (out["rows"][0]["place"], out["rows"][0]["gap"], out["rows"][1]["time"]) == (1, None, "1:32:17.456")
    assert all(row["points"] is None for row in out["rows"])


@needs_tesseract
def test_quali_layout_without_grid_is_a_result():
    """Echter Fall (#1981): ein Quali-Bild (Pos | Nr. + Name | Team | Time | Gap) wurde als „keine Zeiten“ abgelehnt.
    Gelesen wird es vollständig - Platz 1 im Kasten, kein Abstand beim Ersten, keine Punkte; Platz, Zeit und Abstand
    ohne Gelb (die Schrift der Testhilfe liest die fette 5 als 6 - die Reihenfolge stellt das richtig)."""
    sheet = fixture.quali_sheet()
    out = _read(fixture.png_bytes(fixture.render(sheet, grid=False)), _people(sheet))
    assert out["is_result"] is True
    got = [(row["place"], row["start_number"], row["name"], row["team"], row["time"], row["gap"], row["points"])
           for row in out["rows"]]
    assert got == [(row.place, row.number, row.name, row.team, row.time, row.gap or None, None) for row in sheet.rows]
    assert not any({"place", "time", "gap", "points"} & set(row["uncertain"]) for row in out["rows"])


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


def _png_chunk(kind: bytes, body: bytes) -> bytes:
    return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)


def _png_in_two_blocks(side: int = 64) -> tuple[bytes, bytes, bytes]:
    """Eine gültige PNG-Datei mit zwei Datenblöcken (IDAT): Kopf, erster Block und der Rest getrennt - so lässt sich der
    zweite Block beim Fuzzen gezielt verderben. Pillow liest ihn erst beim Dekodieren."""
    raw = b"".join(b"\x00" + bytes((x * 3 + y) % 256 for x in range(side * 3)) for y in range(side))
    packed = zlib.compress(raw, 9)
    half = len(packed) // 2
    head = b"\x89PNG\r\n\x1a\n" + _png_chunk(b"IHDR", struct.pack(">IIBBBBB", side, side, 8, 2, 0, 0, 0))
    return head + _png_chunk(b"IDAT", packed[:half]), packed[half:], _png_chunk(b"IEND", b"")


def test_broken_png_chunks_give_400_never_an_error():
    """Kaputte Chunks: Pillow wirft beim Dekodieren auch ``SyntaxError`` („broken PNG file“). Das ist eine feste
    Meldung mit 400 - nie eine Ausnahme (500)."""
    first, rest, end = _png_in_two_blocks()
    assert result_image_ocr.open_image(first + _png_chunk(b"IDAT", rest) + end).image is not None
    bad_type = struct.pack(">I", len(rest)) + b"\x01\x02\x03\x04" + rest + b"\x00\x00\x00\x00"
    opened = result_image_ocr.open_image(first + bad_type + end)
    assert (opened.image, opened.status, opened.message) == (None, 400, result_image_ocr.BROKEN)

    # Fuzzen: Typ, Länge, Prüfsumme und Inhalt der Chunks verderben, abschneiden - fest gesetzter Zufall.
    good = first + _png_chunk(b"IDAT", rest) + end
    rng = random.Random(1756)
    for attempt in range(400):
        data = bytearray(good)
        kind = attempt % 4
        if kind == 0:
            data[len(first) + 4:len(first) + 8] = bytes(rng.randrange(256) for _ in range(4))  # Typ des 2. Blocks
        elif kind == 1:
            data[len(first):len(first) + 4] = struct.pack(">I", rng.randrange(2 ** 31))  # Länge
        elif kind == 2:
            data = data[:rng.randrange(20, len(good))]  # abgeschnitten
        else:
            for _ in range(rng.randint(1, 6)):
                data[rng.randrange(8, len(good))] ^= rng.randrange(1, 256)
        result = result_image_ocr.open_image(bytes(data))
        assert result.status in (200, 400, 413), attempt
        assert (result.image is None) == (result.status != 200), attempt
        assert result.message in ("", result_image_ocr.BROKEN, result_image_ocr.NOT_AN_IMAGE,
                                  result_image_ocr.WRONG_FORMAT, result_image_ocr.TOO_MANY_PIXELS,
                                  result_image_ocr.TOO_SMALL), attempt


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


def test_columns_come_from_the_data_not_from_fixed_positions():
    """Echtes Layout: „Name“ steht über der Startnummer, die Namen selbst haben keine Überschrift, Zeiten sind links
    bündig, im Qualifying fehlt Grid. Die Spalten ergeben sich aus dem, was in ihnen steht."""
    def line(top, *cells):
        return result_image_ocr.Line([
            result_image_ocr.Word(text, 95, left, top, 7 * len(text), 14, ("1", "1", str(top)))
            for text, left in cells])
    entries = [("45", "Probe_Anna", "Rotor", "1:28,783", "+--:--,---"),
               ("8", "Probe_Bert", "Blaupfeil", "1:29,142", "+0,359"),
               ("7", "Probe_Carl", "Kometen", "1:29,294", "+0,511"),
               ("13", "Probe_Dora", "Nordlicht", "1:29,778", "+0,995")]
    rows = [line(100 + 40 * index, (str(index + 1), 55), (number, 115), (name, 169), (team, 323), (time, 503),
                 (gap, 595))
            for index, (number, name, team, time, gap) in enumerate(entries)]
    columns = TEMPLATE["columns"]
    name_index = next(i for i, column in enumerate(columns) if column["field"] == "name")
    labels = {name_index: result_image_ocr.Cell([result_image_ocr.Word("Name", 95, 111, 60, 28, 14)])}
    planned = result_image_ocr.plan_columns(rows, columns, labels, 14)
    fields = [{columns[index]["field"]: " ".join(w.text for w in cell.words) for index, cell in row.items()}
              for row in planned]
    assert fields[1] == {"place": "2", "start_number": "8", "name": "Probe_Bert", "team": "Blaupfeil",
                         "time": "1:29,142", "gap": "+0,359"}
    assert all("grid" not in row for row in fields)


def test_header_values_below_labels_side_by_side():
    """Kopf wie bei echten Rennligen: drei Beschriftungen nebeneinander, Name und Zeit je darunter; die Strecke ohne
    die Art der Sitzung. Reste von Linien („|“) gehören nicht zur Zeit."""
    def words(top, *items):
        return result_image_ocr.Line([
            result_image_ocr.Word(text, 95, left, top, 10 * len(text), 20, ("1", "1", str(top)))
            for text, left in items])
    lines = [
        words(10, ("Probering", 100)),
        words(40, ("Rennen", 100)),
        words(100, ("Schnellste", 100), ("Rennrunde:", 210), ("Pole:", 400), ("Fahrer", 600), ("des", 670),
              ("Tages:", 710)),
        words(130, ("Probe_Anna", 100), ("Probe_Bert", 400), ("Probe_Carl", 600)),
        words(160, ("1:17,853", 100), ("1:16,119", 400), ("|", 900)),
    ]
    header = result_image_ocr._header_fields(lines, TEMPLATE)
    assert {key: value.text for key, value in header.items()} == {
        "fastest_lap": "Probe_Anna 1:17,853", "pole": "Probe_Bert 1:16,119", "driver_of_the_day": "Probe_Carl",
        "track": "Probering", "session": "Rennen"}
    session_only = result_image_ocr._header_fields([words(10, ("Qualifying", 100)), words(40, ("Probering", 100))],
                                                   TEMPLATE)
    assert session_only["track"].text == "Probering"
    assert session_only["session"].text == "Qualifying"


def test_text_color_is_the_color_of_the_letters():
    """Teamfarbe als Vorschlag: die Schriftfarbe einer Zelle, nicht ihr Grund."""
    img = Image.new("RGB", (200, 60), (21, 21, 30))
    ImageDraw.Draw(img).rectangle((20, 15, 80, 45), fill=(230, 40, 50))  # „Schrift“ in Rot
    cell = result_image_ocr.Cell([result_image_ocr.Word("44", 95, 30, 20, 120, 50)])  # bei Faktor 2 gelesen
    assert result_image_ocr.text_color(img, cell, 2.0) == "#e62832"
    empty = result_image_ocr.Cell([result_image_ocr.Word("x", 95, 300, 80, 40, 20)])
    assert result_image_ocr.text_color(img, empty, 2.0) is None


def _fake_page(rows: int = 12) -> list:
    words = []
    for index in range(rows):
        top = 40 + index * 40
        line = ("1", "1", str(index))
        words += [result_image_ocr.Word(str(index + 1), 95, 20, top, 20, 20, line),
                  result_image_ocr.Word(f"Probe{index}", 95, 200, top, 120, 20, line),
                  result_image_ocr.Word("1:32.123", 95, 900, top, 100, 20, line)]
    return words


def test_time_budget_per_image_leaves_the_rest_yellow(monkeypatch):
    """Alle Aufrufe von Tesseract zusammen haben ein Zeitbudget. Jeder Aufruf darf höchstens die Restzeit dauern; ist
    sie weg, bleiben die übrigen Spalten ohne zweite Lesung - und gelb. Reicht es nicht einmal für die Seite:
    ``OutOfTime``."""
    clock = [0.0]
    calls = []

    def fake_tesseract(img, *, psm, whitelist=None, timeout=None):
        calls.append(timeout)
        clock[0] += 10  # jeder Aufruf dauert zehn Sekunden
        return _fake_page()

    monkeypatch.setattr(result_image_ocr, "tesseract", fake_tesseract)
    monkeypatch.setattr(result_image_ocr, "_clock", lambda: clock[0])
    image = Image.new("RGB", (1200, 600), (20, 20, 30))
    # Schrifthöhe, zwei Seitenlesungen, die Platz-Spalte - dann ist das Budget von 35 s aufgebraucht.
    reading = result_image_ocr.read(image, TEMPLATE, budget_seconds=35)
    assert calls == [35, 25, 15, 5]
    assert reading.out_of_time and len(reading.rows) == 12
    assert {"name", "time"} <= reading.unchecked and "place" not in reading.unchecked
    out = result_image_match.build(reading, TEMPLATE, [])
    assert all({"name", "time"} <= set(row["uncertain"]) for row in out["rows"])
    # Mit genug Zeit ist nichts ungeprüft.
    clock[0] = 0.0
    plenty = result_image_ocr.read(image, TEMPLATE, budget_seconds=600)
    assert (plenty.out_of_time, plenty.unchecked) == (False, set())
    # Nicht einmal Zeit für die Seite.
    clock[0] = 0.0
    with pytest.raises(result_image_ocr.OutOfTime):
        result_image_ocr.read(image, TEMPLATE, budget_seconds=8)


def test_place_box_and_third_reading_of_digits(monkeypatch):
    """#1981: Ein Platz ohne brauchbare Lesung (Platz 1 im farbigen Kasten, gelesen als „@“) wird allein aus dem
    Originalbild gelesen - als einzelnes Zeichen (psm 10). Ziffern-Spalten bekommen eine dritte Lesung, größer und
    schwarz-weiß; Überschriften im Bild werden gemerkt."""
    calls = []

    def fake_tesseract(img, *, psm, whitelist=None, timeout=None):
        calls.append((psm, whitelist, img.size))
        if psm == 10:
            return [result_image_ocr.Word("1", 92, 30, 20, 20, 30, ("1", "1", "0"))]
        words = _fake_page(5)
        words[0] = result_image_ocr.Word("@", 60, 20, 40, 20, 20, ("1", "1", "0"))
        return words

    monkeypatch.setattr(result_image_ocr, "tesseract", fake_tesseract)
    reading = result_image_ocr.read(Image.new("RGB", (1200, 400), (20, 20, 30)), TEMPLATE)
    assert reading.rows[0].strips["place"].text == "1"
    assert any(psm == 10 and whitelist == result_image_ocr.WHITELISTS["place"] for psm, whitelist, _ in calls)
    # Dritte Lesung: Platz und Zeit (Ziffern), nicht der Name.
    assert {"place", "time"} <= set(reading.rows[1].alts) and "name" not in reading.rows[1].alts
    assert reading.labelled == set()  # keine Kopfzeile im Bild
    out = result_image_match.build(reading, TEMPLATE, [])
    assert [row["place"] for row in out["rows"]] == [1, 2, 3, 4, 5]
    assert "place" not in out["rows"][0]["uncertain"]


def test_too_many_rows_stop_before_the_column_reads(monkeypatch):
    """Mehr Ergebniszeilen als das Blatt nimmt: abbrechen, bevor die Spalten einzeln gelesen werden - die Antwort bleibt
    klein, der Server rechnet nicht weiter."""
    calls = []

    def fake_tesseract(img, *, psm, whitelist=None, timeout=None):
        calls.append(whitelist)
        words = []
        for index in range(12):
            top = 40 + index * 40
            line = ("1", "1", str(index))
            words += [result_image_ocr.Word(str(index + 1), 95, 20, top, 20, 20, line),
                      result_image_ocr.Word(f"Probe{index}", 95, 200, top, 120, 20, line),
                      result_image_ocr.Word("1:32.123", 95, 900, top, 100, 20, line)]
        return words

    monkeypatch.setattr(result_image_ocr, "tesseract", fake_tesseract)
    image = Image.new("RGB", (1200, 600), (20, 20, 30))
    full = result_image_ocr.read(image, TEMPLATE, max_rows=12)
    assert (full.too_many_rows, len(full.rows)) == (False, 12)
    assert any(whitelist for whitelist in calls)  # sonst werden Zahlenspalten mit Whitelist gelesen
    calls.clear()
    cut = result_image_ocr.read(image, TEMPLATE, max_rows=11)
    assert (cut.too_many_rows, cut.rows) == (True, [])
    assert calls and not any(whitelist for whitelist in calls)  # nur die Seite, keine Spalte
