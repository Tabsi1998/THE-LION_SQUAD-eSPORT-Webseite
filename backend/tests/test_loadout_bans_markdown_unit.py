"""Namen in Bausteinen des Regelwerks (docs/LIGA.md, C.4 #2218, Review): Was in Bibliothek oder Modus steht, ist Text, kein Markdown. Ein
Name wie „[Link](https://…)“ wird weder im Web noch im PDF zum Link, „**fett**“ nicht fett. Der frei geschriebene Regeltext bleibt davon
unberührt - ein Backslash darin bleibt, wie er ist. Gespeichert wird strukturiert im Klartext, Schutzzeichen gibt es nur beim Darstellen.
Erfundene Namen."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import pdf_service  # noqa: E402
from services import league_rule_blocks, loadout_bans, markdown_text  # noqa: E402

TRICKY = "[Klick](https://example.test/x) **fett** `code` ~~weg~~ ++unter++ !bang \\pfad"


def entry(name: str, **extra) -> dict:
    return {"kind": "item", "item_id": "i1", "name": name, "category_label": f"Kat {TRICKY}", "image_url": None, "modes": [],
            "mode_labels": [f"Modus {TRICKY}"], "attachments": [], **extra}


def test_names_are_protected_when_shown_and_plain_when_stored():
    doc = {"id": "v1", "version": 1, "entries": [
        entry(TRICKY),
        {**entry("Waffe [x](https://example.test)"), "kind": "attachments", "attachments": [{"item_id": "a1", "name": TRICKY}]},
    ]}
    data = loadout_bans.block_data(doc)
    assert data["groups"][0]["entries"][0]["name"] == TRICKY and data["weapons"][0]["attachments"] == [TRICKY], "gespeichert im Klartext"
    for variant in ("markdown", "text"):
        shown = loadout_bans.render_block(data, variant)
        assert "[Klick](https://" not in shown and "**fett**" not in shown and "\\" not in shown
        assert TRICKY in markdown_text.plain(shown), "als Text lesbar wie eingegeben"
    lines = loadout_bans.render_block(data, "text").splitlines()
    for line in lines:
        markup = pdf_service.pdf_rules_inline(line)
        assert "<a " not in markup and "<strike>" not in markup and "<u>" not in markup
        # Fett ist nur unsere eigene Überschrift der Kategorie, nie ein Name.
        assert markup.count("<b>") == (1 if line.startswith("**Kat") or line.startswith("**Aufs") else 0), line
    assert "[Klick](https://example.test/x) **fett**" in pdf_service.pdf_rules_inline(lines[-1])


def test_free_rules_text_keeps_its_backslashes_in_the_pdf():
    """Nur Bausteinwerte sind geschützt - ein bewusst geschriebener Backslash im Regeltext bleibt (Review C.4)."""
    assert pdf_service.pdf_rules_inline("Pfad C:\\Daten\\[x] und \\_frei\\_") == "Pfad C:\\Daten\\[x] und \\_frei\\_"


def test_map_pool_and_mode_order_names_are_protected():
    data = league_rule_blocks.pool_data({"modes": [{"label": "Stellung [x](https://example.test)", "maps": [{"name": "**Hafen**"}]}]})
    assert data == {"rows": [{"label": "Stellung [x](https://example.test)", "maps": ["**Hafen**"]}]}
    line = league_rule_blocks.pool_table(data)
    assert "[x](https://" not in line and "**Hafen**" not in line
    assert "Stellung [x](https://example.test)" in markdown_text.plain(line) and "**Hafen**" in markdown_text.plain(line)


def test_older_frozen_blocks_are_still_read():
    """Fassungen vor der strukturierten Ablage tragen ``markdown``/``text`` - auch mit Schutzzeichen; gelesen wird beides, als Klartext."""
    old = {"label": "Map-Pool", "markdown": "| Modus | Maps |\n| --- | --- |\n| Stellung | Hafen |"}
    assert league_rule_blocks.value("map_pool", old) == old["markdown"]
    protected = {"markdown": f"- {markdown_text.text_cell('Alt [x]')}", "text": f"- {markdown_text.text_cell('Alt [x]')}"}
    assert league_rule_blocks.plain_value("loadout_bans", protected) == "- Alt [x]"
