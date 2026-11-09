"""Eingefrorene Fassungen der erlaubten Ausrüstung mit ``layout: 4`` (#2299) - ohne Datenbank (docs/LIGA.md, C.4).

Bis #2305 hat der Baustein je Waffe einen Satz „alle passenden Aufsätze erlaubt, außer: …“ gezeigt (Web als Karte, PDF als Liste). Eine so
veröffentlichte Fassung und ein Schnappschuss am Spiel bleiben Wort für Wort, wie sie waren. ``golden/loadout_allowed_v4.json`` hält Daten
und beide Darstellungen fest, erzeugt mit dem Stand vor #2305; der neue Aufbau (``layout: 5``) steht in test_loadout_allowed_table_unit.
Erfundene Namen.
"""
import json
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import pdf_service  # noqa: E402
from services import league_rule_blocks, loadout_bans, markdown_text  # noqa: E402
from test_loadout_bans_grouped_unit import ICON, IMAGE, sections  # noqa: E402

V4 = json.loads((pathlib.Path(__file__).resolve().parent / "golden" / "loadout_allowed_v4.json").read_text(encoding="utf-8"))
TRICKY = "[Klick](https://example.test/x) **fett** `code` |Rohr| \\pfad"


def weapon(data: dict, section: str, name: str) -> dict:
    return next(row for row in sections(data, "Waffen")[section]["entries"] if row["name"] == name)


@pytest.mark.parametrize("case", sorted(V4))
def test_a_frozen_layout_4_renders_word_for_word(case):
    golden = V4[case]
    assert golden["data"]["layout"] == 4
    assert loadout_bans.render_block(golden["data"], "markdown") == golden["markdown"]
    assert loadout_bans.render_block(golden["data"], "text") == golden["text"]
    # Das PDF einer alten Fassung bleibt der Text ohne Bilder (#2218) - auch mit der Fassung ``pdf`` (#2305).
    assert loadout_bans.render_block(golden["data"], "pdf") == golden["text"]
    assert league_rule_blocks.value("loadout_bans", {"data": golden["data"]}, league_rule_blocks.PDF) == golden["text"]
    assert loadout_bans.block_images(golden["data"]) == golden["images"]


def test_the_pdf_of_layout_4_has_one_line_per_weapon():
    text = markdown_text.plain(V4["DOC"]["text"])
    assert "![" not in text and "++" not in text
    assert "**Waffen**" in text and "- Ohne Klasse\n" in text, "ohne passende Aufsätze nur der Name"
    assert "*Sturmgewehr*\n- Blitz 9 – alle passenden Aufsätze erlaubt, außer: Rotpunkt\n" in text
    assert "- Donner 4 (nicht in Suchen) – alle passenden Aufsätze erlaubt, außer: Rotpunkt (nicht in Suchen)" in text
    assert "*Schrotflinte* · **nicht erlaubt** (Bö, Hagel)" in text
    assert "*Pistole* · nicht in Suchen\n- Funke\n- Zunder (nicht in Suchen, Stellung)" in text
    assert "| Kategorie | Unterkategorie | Erlaubt | Einschränkungen |" in text and "| Perks | – | Leise Sohlen | – |" in text
    assert "Aufsätze |" not in text and "nicht an" not in text
    free = markdown_text.plain(V4["NONE"]["text"])
    assert "- Blitz 9 – alle passenden Aufsätze erlaubt\n" in free and "*Sturmgewehr* · alle erlaubt" in free
    for line in text.splitlines():
        assert "<u>" not in pdf_service.pdf_rules_inline(line)


def test_the_web_card_of_layout_4_names_the_attachments_under_the_weapon():
    web = markdown_text.plain(V4["DOC"]["markdown"])
    assert f"- ![Ausrüstung]({IMAGE}) ++Blitz 9++ alle passenden Aufsätze erlaubt, außer: Rotpunkt\n" in web
    assert "- ++Donner 4++ *nicht in Suchen* alle passenden Aufsätze erlaubt, außer: Rotpunkt (nicht in Suchen)" in web
    assert web.count("++Ohne Klasse++\n") == 1 and "**Aufsätze**" not in web and "nicht an" not in web
    assert f"![Klassen-Symbol]({ICON}) *Sturmgewehr*" in web
    assert "| Bild |" not in web, "layout 4 kennt keine Tabelle"


def test_layout_4_nowhere_allowed_and_only_in():
    data = V4["NOWHERE"]["data"]
    assert data["attachments_everywhere"] == [{"name": "Kompensator", "not_in": []},
                                              {"name": "Holo", "not_in": ["Stellung", "Kapern"], "only_in": ["Suchen"]}]
    text = markdown_text.plain(V4["NOWHERE"]["text"])
    assert "- Blitz 9 – alle passenden Aufsätze erlaubt, außer: Laser, Rotpunkt (nicht in Suchen)\n" in text
    assert "- Donner 4 – alle passenden Aufsätze erlaubt, außer: Rotpunkt (nicht in Stellung)\n" in text
    assert "**An keiner Waffe erlaubt:** Kompensator, Holo (nur in Suchen)" in text
    web = markdown_text.plain(V4["NOWHERE"]["markdown"])
    assert web.endswith("\n\n**An keiner Waffe erlaubt:** Kompensator, Holo (nur in Suchen)")
    assert "außer: Kompensator" not in web and "Holo (nur" not in web.split("**An keiner")[0]
    assert "- Blitz 9 – alle passenden Aufsätze erlaubt, außer: Rotpunkt (nur in Suchen)" in \
        markdown_text.plain(V4["ONLY_IN"]["text"])
    assert "- Blitz 9 – keine Aufsätze erlaubt (Griff, Rotpunkt)" in markdown_text.plain(V4["NONE_ALLOWED"]["text"])


def test_layout_4_names_stay_text():
    data = V4["TRICKY"]["data"]
    assert weapon(data, "Sturmgewehr", "Blitz 9")["attachments"]["banned"] == [TRICKY], "Daten sind Klartext"
    for variant in ("markdown", "text"):
        shown = V4["TRICKY"][variant]
        assert "[Klick](https://" not in shown and "**fett**" not in shown and "\\" not in shown
        assert f"außer: {TRICKY.replace('|', '/')}, {TRICKY.replace('|', '/')} 2 (nicht in {TRICKY.replace('|', '/')})" in \
            markdown_text.plain(shown)
    for line in V4["TRICKY"]["text"].splitlines():
        assert "<a " not in pdf_service.pdf_rules_inline(line) and "<b>fett" not in pdf_service.pdf_rules_inline(line)


def test_the_league_page_still_shows_a_layout_4_snapshot():
    """Liga- und Matchseite zeigen auch eine Fassung mit layout 4 (``public_allowed`` reicht sie durch, das Web kennt 3, 4 und 5)."""
    assert 4 in loadout_bans.LAYOUTS and 3 in loadout_bans.LAYOUTS and loadout_bans.LAYOUT == 5
