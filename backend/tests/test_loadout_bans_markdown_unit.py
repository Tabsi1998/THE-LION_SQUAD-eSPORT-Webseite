"""Namen in Bausteinen des Regelwerks (docs/LIGA.md, C.4 #2218, Review): Was in Bibliothek oder Modus steht, ist Text, kein Markdown. Ein
Name wie „[Link](https://…)“ wird weder im Web noch im PDF zum Link, „**fett**“ nicht fett. Erfundene Namen."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import pdf_service  # noqa: E402
from services import league_rule_blocks, loadout_bans  # noqa: E402

TRICKY = "[Klick](https://example.test/x) **fett** `code` ~~weg~~ ++unter++ !bang"


def entry(name: str, **extra) -> dict:
    return {"kind": "item", "item_id": "i1", "name": name, "category_label": f"Kat {TRICKY}", "image_url": None, "modes": [],
            "mode_labels": [f"Modus {TRICKY}"], "attachments": [], **extra}


def test_names_are_escaped_in_both_versions_of_the_ban_block():
    doc = {"id": "v1", "version": 1, "entries": [
        entry(TRICKY),
        {**entry("Waffe [x](https://example.test)"), "kind": "attachments", "attachments": [{"item_id": "a1", "name": TRICKY}]},
    ]}
    block = loadout_bans.block(doc)
    for text in (block["markdown"], block["text"]):
        assert "[Klick](https://" not in text and "**fett**" not in text
        assert "\\[Klick\\]\\(https://example.test/x\\)" in text and "\\*\\*fett\\*\\*" in text
    for line in block["text"].splitlines():
        markup = pdf_service.pdf_rules_inline(line)
        assert "<a " not in markup and "<strike>" not in markup and "\\" not in markup
        # Fett ist nur unsere eigene Überschrift der Kategorie, nie ein Name.
        assert markup.count("<b>") == (1 if line.startswith("**Kat") or line.startswith("**Aufs") else 0), line


def test_the_pdf_shows_an_escaped_name_as_plain_text():
    markup = pdf_service.pdf_rules_inline("- \\[Klick\\]\\(https://example.test/x\\) \\*\\*fett\\*\\*")
    assert markup == "- [Klick](https://example.test/x) **fett**"


def test_map_pool_and_mode_order_names_are_escaped():
    pool = {"modes": [{"label": "Stellung [x](https://example.test)", "maps": [{"name": "**Hafen**"}]}]}
    line = league_rule_blocks.pool_table(pool)
    assert "\\[x\\]\\(https://example.test\\)" in line and "\\*\\*Hafen\\*\\*" in line
