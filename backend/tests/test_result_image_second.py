"""Zweiter Leser (#2018, ``services/result_image_second.py``): laden nur aus der festen Modelldatei, Stapel im
Zeitbudget, Ausfall ohne Fehler - und mit dem echten Modell (im Image bzw. in der CI) ein synthetisches Bild. Nur
erfundene Namen."""
import os
import pathlib
import sys
import time

import pytest
from PIL import Image, ImageDraw

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import result_image_fixture as fixture  # noqa: E402
from services import result_image_match, result_image_ocr, result_image_second as second  # noqa: E402
from services import result_image_templates  # noqa: E402

needs_second_reader = pytest.mark.skipif(
    not (second.available() and result_image_ocr.available()) and os.environ.get("REQUIRE_SECOND_READER") != "1",
    reason="Zweiter Leser oder Tesseract fehlt (siehe backend/Dockerfile; die CI lädt das Modell)")


class FakeOut:
    def __init__(self, texts):
        self.txts = tuple(texts)
        self.scores = tuple(0.99 for _ in texts)


class FakeEngine:
    """Liest je Bild dessen Breite als Text - so sieht der Test, dass die Reihenfolge stimmt."""
    def __init__(self, delay=0.0, fail=False):
        self.delay, self.fail, self.calls = delay, fail, 0

    def recognize_txt(self, images):
        self.calls += 1
        if self.fail:
            raise RuntimeError("kaputt")
        time.sleep(self.delay)
        return FakeOut([str(image.shape[1]) for image in images])


@pytest.fixture
def engine(monkeypatch):
    def install(fake):
        monkeypatch.setattr(second, "_load", lambda: fake)
        return fake
    return install


def _cells(*widths):
    return [Image.new("RGB", (width, 20), "white") for width in widths]


def test_cells_are_read_in_batches_and_keep_their_order(engine, monkeypatch):
    fake = engine(FakeEngine())
    out = second.recognize(_cells(*range(43, 29, -1)))
    assert out.status == "ok"
    assert [item.text for item in out.reads] == [str(width) for width in range(43, 29, -1)]
    assert fake.calls == 14  # einzeln (``BATCH``)
    monkeypatch.setattr(second, "BATCH", 6)
    assert [item.text for item in second.recognize(_cells(*range(43, 29, -1))).reads] == [
        str(width) for width in range(43, 29, -1)]
    assert fake.calls == 14 + 3  # 14 Zellen in Stapeln zu 6


def test_out_of_time_leaves_the_rest_unread_and_a_failure_reads_nothing(engine):
    engine(FakeEngine(delay=0.2))
    out = second.recognize(_cells(*range(30, 34)), deadline=time.monotonic() + 0.5)
    assert out.status == "out_of_time"
    assert out.reads[0] is not None and out.reads[-1] is None
    engine(FakeEngine(fail=True))
    broken = second.recognize(_cells(30, 31))
    assert (broken.status, broken.reads) == ("failed", [None, None])


def test_missing_model_or_switched_off_means_no_reader(monkeypatch):
    """Fehlt die Modelldatei, lädt der Leser nichts nach - er ist aus, mit Grund für den Betrieb."""
    monkeypatch.setattr(second, "MODE", "on")
    monkeypatch.setattr(second, "MODEL_PATH", str(pathlib.Path(__file__).parent / "fehlt" / "modell.onnx"))
    second.reset()
    try:
        assert second.available() is False
        assert second.status() == {"status": "missing", "reason": "Modelldatei fehlt", "model": second.MODEL_NAME}
        assert second.recognize(_cells(30)).status == "missing"
        monkeypatch.setattr(second, "MODE", "off")
        second.reset()
        assert second.status()["status"] == "off"
    finally:
        second.reset()


def test_read_second_puts_the_reads_where_they_belong(monkeypatch):
    """``read_second``: je Auftrag die Lesung als ``Read`` (Sicherheit 0-100); mehrere Ausschnitte (Name, darunter die
    Zeit) mit Leerzeichen verbunden. Fehlt eine Lesung, bleibt das Feld ohne."""
    monkeypatch.setattr(second, "enabled", lambda: True)
    monkeypatch.setattr(second, "available", lambda: True)
    texts = iter(["Probe Wolf", "1:31,207", "Neues Team", None])

    def recognize(images, deadline=None):
        reads = [second.SecondRead(text, 0.95) if text else None for text in (next(texts) for _ in images)]
        return second.Result(reads, "ok")

    monkeypatch.setattr(second, "recognize", recognize)
    img = Image.new("RGB", (200, 100), "white")
    header, row = {}, {}
    jobs = [(header, "pole", [(0, 0, 50, 20), (0, 20, 50, 40)]), (row, "team", [(0, 40, 50, 60)]),
            (row, "name", [(0, 60, 50, 80)])]
    status = result_image_ocr.read_second(img, jobs)
    assert status == "ok"
    assert (header["pole"].text, header["pole"].conf) == ("Probe Wolf 1:31,207", 95.0)
    assert row["team"].text == "Neues Team" and "name" not in row
    monkeypatch.setattr(second, "available", lambda: False)
    monkeypatch.setattr(second, "status", lambda: {"status": "missing"})
    assert result_image_ocr.read_second(img, [(row, "name", [(0, 0, 10, 10)])]) == "missing"


@needs_second_reader
def test_the_real_reader_makes_agreed_names_green_without_roster():
    """Mit dem echten Modell: ein sauberes synthetisches Bild ohne Kader - was beide Leser gleich lesen, ist grün; was
    leicht verwechselte Zeichen hat oder sich widerspricht, bleibt gelb. Nichts Falsches ist grün."""
    sheet = fixture.sample_sheet()
    template = result_image_templates.get(result_image_templates.DEFAULT_ID)
    reading = result_image_ocr.read(fixture.render(sheet), template)
    assert reading.second == "ok"
    built = result_image_match.build(reading, template, [])
    for row, expected in zip(built["rows"], sheet.rows):
        if "name" not in row["uncertain"]:
            assert row["name"] == expected.name
        if "team" not in row["uncertain"]:
            assert row["team"] == expected.team
    assert sum("name" not in row["uncertain"] for row in built["rows"]) >= len(sheet.rows) // 2


@needs_second_reader
def test_the_real_reader_reads_a_cell():
    img = Image.new("RGB", (260, 48), "white")
    ImageDraw.Draw(img).text((8, 10), "Probe 2018", fill="black", font=fixture._font(26))
    out = second.recognize([second.cell_image(img, (0, 0, 260, 48))])
    assert out.status == "ok" and out.reads[0].text.replace(" ", "") == "Probe2018"
