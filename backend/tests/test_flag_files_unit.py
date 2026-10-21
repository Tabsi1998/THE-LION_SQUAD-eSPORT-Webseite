"""Flaggen-Dateien der Website (#1925): Sie kommen von außen (hampusborgos/country-flags, gemeinfrei) und liegen unter
``frontend/public/assets/flags``. Jede Datei bleibt reine Zeichnung - kein Skript, keine Ereignis-Attribute, kein Link
nach außen, kein ``foreignObject``, keine Schriften oder Bilder von außen - und bleibt klein. Das Seitenverhältnis, mit
dem die Website den Kasten der Flagge baut (``frontend/src/lib/flagRatios.json``), passt zur Datei. Gilt auch für
jeden späteren Tausch der Dateien."""
import json
import pathlib
import xml.etree.ElementTree as ET

import pytest

REPO = pathlib.Path(__file__).resolve().parents[2]
FLAGS = REPO / "frontend/public/assets/flags"
RATIOS = json.loads((REPO / "frontend/src/lib/flagRatios.json").read_text(encoding="utf-8"))
MAX_BYTES = 60_000
# Wappen-Flaggen ohne Verkleinerung (kein svgo im Projekt): eigene Obergrenze, damit nichts unbemerkt wächst.
LARGE = {"mx": 170_000}
FORBIDDEN_TAGS = {"script", "foreignobject", "iframe", "embed", "object", "a", "image", "audio", "video", "animate",
                  "set", "handler", "listener"}
FORBIDDEN_TEXT = ("<!doctype", "<!entity", "@import", "@font-face", "javascript:", "data:")
FILES = sorted(FLAGS.glob("*.svg"))


def test_there_is_a_flag_for_every_country_and_nothing_else():
    assert {path.stem.upper() for path in FILES} == set(RATIOS)
    assert len(FILES) == 41


@pytest.mark.parametrize("path", FILES, ids=lambda path: path.stem)
def test_a_flag_is_a_plain_drawing(path):
    raw = path.read_bytes()
    assert len(raw) <= LARGE.get(path.stem, MAX_BYTES), f"{path.name}: {len(raw)} Bytes"
    text = raw.decode("utf-8")
    lowered = text.lower()
    for needle in FORBIDDEN_TEXT:
        assert needle not in lowered, f"{path.name}: {needle}"
    root = ET.fromstring(text)
    assert root.tag.split("}")[-1] == "svg"
    for node in root.iter():
        tag = node.tag.split("}")[-1].lower()
        assert tag not in FORBIDDEN_TAGS, f"{path.name}: <{tag}>"
        for name, value in node.attrib.items():
            local = name.split("}")[-1].lower()
            assert not local.startswith("on"), f"{path.name}: {local}"
            if local == "href":
                assert value.startswith("#"), f"{path.name}: Link nach außen {value[:40]}"
            if "url(" in value:
                assert value.replace(" ", "").count("url(") == value.replace(" ", "").count("url(#"), \
                    f"{path.name}: Verweis nach außen {value[:40]}"


@pytest.mark.parametrize("path", FILES, ids=lambda path: path.stem)
def test_the_website_knows_the_aspect_ratio_of_each_flag(path):
    box = [float(part) for part in ET.fromstring(path.read_text(encoding="utf-8")).attrib["viewBox"].replace(",", " ")
           .split()]
    assert abs(RATIOS[path.stem.upper()] - box[2] / box[3]) < 0.005
