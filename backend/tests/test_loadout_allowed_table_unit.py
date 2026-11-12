"""Erlaubte Ausrüstung als Tabelle je Kategorie (#2305, ``layout: 5``) - ohne Datenbank (docs/LIGA.md, C.4).

Je Waffe eine Zeile: kleines Bild · Name mit Modus-Hinweis · Ausnahmen nach Slot („Optik: A, B“). Ohne Ausnahme „alle passenden Aufsätze
erlaubt“. Sind an einer Waffe mehr passende Aufsätze ganz gesperrt als erlaubt, steht „nur erlaubt: …“ (wie „nur in …“, #2298), bei
Gleichstand „gesperrt: …“. Nur in Modi gesperrte zählen als erlaubt und stehen mit Hinweis - unter „eingeschränkt:“ bzw. in „nur erlaubt:“.
Web (Markdown für ``markdownLite``), PDF (mit Bild und Zeilen je Slot) und Klartext (Vergleich). Erfundene Namen.
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from PIL import Image  # noqa: E402
from reportlab.platypus import Image as PlatypusImage, Table  # noqa: E402

import pdf_service  # noqa: E402
from services import league_rule_blocks, loadout_bans, markdown_text  # noqa: E402
from test_loadout_bans_grouped_unit import CATEGORIES, DOC, ICON, IMAGE, ITEMS, ban, item  # noqa: E402

SEASON = [("stellung", "Stellung"), ("kapern", "Kapern"), ("suchen", "Suchen")]
BREAK = loadout_bans.CELL_BREAK
SNIPER_IMAGE = "/api/static/uploads/falke-50.png"
GEAR = [
    {"key": "waffen", "label": "Waffen", "role": "weapon", "subcategories": [
        {"key": "sniper", "label": "Scharfschützengewehr", "icon_url": ICON}]},
    {"key": "aufsaetze", "label": "Aufsätze", "role": "attachment", "subcategories": [
        {"key": "optik", "label": "Optik", "icon_url": None}, {"key": "lauf", "label": "Lauf", "icon_url": None},
        {"key": "muendung", "label": "Mündung", "icon_url": None}]},
    {"key": "perks", "label": "Perks", "role": "item", "subcategories": []},
]


def modes(*keys: str) -> dict:
    labels = dict(SEASON)
    return {"modes": list(keys), "mode_labels": [labels[key] for key in keys]}


def gear_items() -> list[dict]:
    """Falke 50 und Habicht 7 (Scharfschützengewehre), je Slot Aufsätze für die ganze Klasse, ein Perk."""
    rows = [item("w1", "waffen", "Falke 50", "sniper", image_url=SNIPER_IMAGE), item("w2", "waffen", "Habicht 7", "sniper"),
            item("k1", "perks", "Leise Sohlen")]
    for slot, names in (("optik", ["Optik A", "Optik B", "Optik C", "Optik D"]), ("lauf", ["Lauf A", "Lauf B", "Lauf C"]),
                        ("muendung", ["Mündung A", "Mündung B"])):
        rows += [item(f"{slot}-{index}", "aufsaetze", name, slot, weapon_class_ids=["sniper"]) for index, name in enumerate(names)]
    return rows


def at_falke(*names: str, own: dict | None = None) -> dict:
    """Sperrt an Falke 50 die genannten Aufsätze (ganz), ``own``: Name → Modi (nur in diesen Modi gesperrt)."""
    ids = {row["name"]: row["id"] for row in gear_items()}
    rows = [{"item_id": ids[name], "name": name} for name in names]
    rows += [{"item_id": ids[name], "name": name, **modes(*keys)} for name, keys in (own or {}).items()]
    return ban("attachments", item_id="w1", name="Falke 50", attachments=rows)


def falke(data: dict) -> dict:
    return next(entry for entry in data["categories"][0]["sections"][0]["entries"] if entry["name"] == "Falke 50")


def row_of(text: str, name: str) -> str:
    # ``split("\n")`` wie Web und PDF - ``splitlines`` trennte auch am Zeilenwechsel in der Zelle (U+2028).
    return next(line for line in text.split("\n") if f"**{name}**" in line or f"++{name}++" in line)


# ---------------------------------------------------------------- Umkehrung

def test_more_banned_than_allowed_turns_into_only_allowed_by_slot():
    """9 passen: 6 ganz gesperrt, Mündung B nur in Suchen (zählt als erlaubt) - 6 > 3: „nur erlaubt“, je Slot, mit Hinweis."""
    doc = {"entries": [at_falke("Optik A", "Optik B", "Optik C", "Lauf A", "Lauf B", "Mündung A", own={"Mündung B": ["suchen"]})]}
    data = loadout_bans.allowed_block(GEAR, gear_items(), doc, SEASON)
    assert data["layout"] == 5
    found = falke(data)["attachments"]
    assert (found["count"], found["only_allowed"]) == (9, True)
    assert [(group["label"], group["banned"], [entry["name"] for entry in group["entries"]]) for group in found["groups"]] == [
        ("Optik", ["Optik A", "Optik B", "Optik C"], ["Optik D"]), ("Lauf", ["Lauf A", "Lauf B"], ["Lauf C"]),
        ("Mündung", ["Mündung A"], ["Mündung B"])]
    text = markdown_text.plain(loadout_bans.render_block(data, "text"))
    assert row_of(text, "Falke 50") == ("| **Falke 50** | **nur erlaubt:** *Optik:* Optik D · *Lauf:* Lauf C · "
                                        "*Mündung:* Mündung B (nicht in Suchen) |")
    pdf = markdown_text.plain(loadout_bans.render_block(data, "pdf"))
    assert row_of(pdf, "Falke 50") == (f"| ![Ausrüstung]({SNIPER_IMAGE}) | **Falke 50** | **nur erlaubt:**{BREAK}*Optik:* Optik D{BREAK}"
                                       f"*Lauf:* Lauf C{BREAK}*Mündung:* Mündung B (nicht in Suchen) |")
    web = markdown_text.plain(loadout_bans.render_block(data, "markdown"))
    assert row_of(web, "Falke 50") == (f"| ![Ausrüstung]({SNIPER_IMAGE}) | ++Falke 50++ | *nur erlaubt:* ++*Optik:* Optik D++ "
                                       "++*Lauf:* Lauf C++ ++*Mündung:* Mündung B (nicht in Suchen)++ |")
    # Habicht 7 hat keine Ausnahme.
    assert row_of(text, "Habicht 7") == "| **Habicht 7** | alle passenden Aufsätze erlaubt |"
    assert row_of(web, "Habicht 7") == "|  | ++Habicht 7++ | *alle passenden Aufsätze erlaubt* |"


def test_a_tie_stays_banned_and_modes_count_as_allowed():
    """Gleichstand: 4 ganz gesperrt, 4 erlaubt plus einer nur in Modi - hier 4 zu 5 - bleibt „gesperrt“; der nur in Modi gesperrte steht
    unter „eingeschränkt“ mit seinem Hinweis, nie unter „gesperrt“ (dort läse sich „nur in Suchen“ falsch herum)."""
    doc = {"entries": [at_falke("Optik A", "Optik B", "Lauf A", "Mündung A", own={"Optik C": ["stellung", "kapern"]})]}
    data = loadout_bans.allowed_block(GEAR, gear_items(), doc, SEASON)
    assert "only_allowed" not in falke(data)["attachments"]
    text = markdown_text.plain(loadout_bans.render_block(data, "text"))
    assert row_of(text, "Falke 50") == ("| **Falke 50** | **gesperrt:** *Optik:* Optik A, Optik B · *Lauf:* Lauf A · *Mündung:* Mündung A · "
                                        "**eingeschränkt:** *Optik:* Optik C (nur in Suchen) |")
    # Genau gleich viele: 4 gesperrt, 4 erlaubt (ein Aufsatz weniger in der Bibliothek).
    items = [row for row in gear_items() if row["name"] != "Optik D"]
    tie = loadout_bans.allowed_block(GEAR, items, {"entries": [at_falke("Optik A", "Optik B", "Lauf A", "Mündung A")]}, SEASON)
    assert falke(tie)["attachments"]["count"] == 8 and "only_allowed" not in falke(tie)["attachments"]
    one_more = loadout_bans.allowed_block(GEAR, items, {"entries": [at_falke("Optik A", "Optik B", "Lauf A", "Lauf B", "Mündung A")]}, SEASON)
    assert falke(one_more)["attachments"]["only_allowed"] is True, "5 zu 3: umgekehrt"
    web = markdown_text.plain(loadout_bans.render_block(data, "markdown"))
    assert row_of(web, "Falke 50").endswith("| **gesperrt:** ++*Optik:* Optik A, Optik B++ ++*Lauf:* Lauf A++ ++*Mündung:* Mündung A++ "
                                            "**eingeschränkt:** ++*Optik:* Optik C (nur in Suchen)++ |")


def test_without_an_exception_all_fitting_are_allowed():
    data = loadout_bans.allowed_block(GEAR, gear_items(), None, SEASON)
    assert "only_allowed" not in falke(data)["attachments"]
    for variant in ("text", "pdf"):
        assert row_of(markdown_text.plain(loadout_bans.render_block(data, variant)), "Falke 50").endswith(
            "| **Falke 50** | alle passenden Aufsätze erlaubt |")


def test_all_banned_says_none_allowed():
    doc = {"entries": [at_falke(*[row["name"] for row in gear_items() if row["category"] == "aufsaetze"])]}
    data = loadout_bans.allowed_block(GEAR, gear_items(), doc, SEASON)
    assert row_of(markdown_text.plain(loadout_bans.render_block(data, "text")), "Falke 50") == \
        "| **Falke 50** | **keine Aufsätze erlaubt** |"


def test_nowhere_allowed_stays_once_below_the_weapons_and_counts_for_the_turn():
    """An beiden Waffen ganz gesperrt (Optik A–C, Lauf A): einmal in „An keiner Waffe erlaubt“, am Falke 50 nur gezählt - mit Lauf B und
    Mündung A dort 6 zu 3: „nur erlaubt“. Mündung B ist an beiden nur in Suchen gesperrt: unten mit Hinweis und in „nur erlaubt“."""
    ids = {row["name"]: row["id"] for row in gear_items()}
    doc = {"entries": [*(ban("item", item_id=ids[name]) for name in ("Optik A", "Optik B", "Optik C", "Lauf A")),
                       ban("item", item_id=ids["Mündung B"], **modes("suchen")), at_falke("Lauf B", "Mündung A")]}
    data = loadout_bans.allowed_block(GEAR, gear_items(), doc, SEASON)
    assert data["attachments_everywhere"] == [{"name": name, "not_in": []} for name in ("Lauf A", "Optik A", "Optik B", "Optik C")] + [
        {"name": "Mündung B", "not_in": ["Suchen"]}]
    found = falke(data)["attachments"]
    assert (found["banned"], found["banned_everywhere"], found["only_allowed"]) == (["Lauf B", "Mündung A"], 4, True)
    text = markdown_text.plain(loadout_bans.render_block(data, "text"))
    assert row_of(text, "Falke 50") == "| **Falke 50** | **nur erlaubt:** *Optik:* Optik D · *Lauf:* Lauf C · *Mündung:* Mündung B (nicht in Suchen) |"
    assert row_of(text, "Habicht 7") == "| **Habicht 7** | alle passenden Aufsätze erlaubt |", "was überall gilt, steht nur unten"
    assert "\n\n**An keiner Waffe erlaubt:** Lauf A, Optik A, Optik B, Optik C, Mündung B (nicht in Suchen)\n" in text
    assert text.index("**An keiner Waffe erlaubt:**") > text.index("Habicht 7") and text.index("**An keiner Waffe") < text.index("Perks")


# ---------------------------------------------------------------- Aufbau der Tabelle

def test_slots_in_library_order_and_without_slot_named_when_needed():
    categories = [GEAR[0], {**GEAR[1], "subcategories": GEAR[1]["subcategories"][:1]}]
    items = [item("w1", "waffen", "Falke 50", "sniper"), item("a1", "aufsaetze", "Riemen", weapon_ids=["w1"]),
             item("a2", "aufsaetze", "Optik A", "optik", weapon_ids=["w1"]), item("a3", "aufsaetze", "Optik B", "optik", weapon_ids=["w1"]),
             item("a4", "aufsaetze", "Gurt", weapon_ids=["w1"])]
    doc = {"entries": [ban("attachments", item_id="w1", name="Falke 50", attachments=[
        {"item_id": "a1", "name": "Riemen"}, {"item_id": "a2", "name": "Optik A"}])]}
    data = loadout_bans.allowed_block(categories, items, doc)
    text = markdown_text.plain(loadout_bans.render_block(data, "text"))
    assert row_of(text, "Falke 50") == "| **Falke 50** | **gesperrt:** *Ohne Slot:* Riemen · *Optik:* Optik A |", \
        "ohne Unterkategorie zuerst, „Ohne Slot“ nur neben anderen Slots"
    alone = loadout_bans.allowed_block(categories, items, {"entries": [ban("attachments", item_id="w1", name="Falke 50", attachments=[
        {"item_id": "a1", "name": "Riemen"}])]})
    assert row_of(markdown_text.plain(loadout_bans.render_block(alone, "text")), "Falke 50") == "| **Falke 50** | **gesperrt:** Riemen |"


def test_one_table_per_category_with_class_rows():
    data = loadout_bans.allowed_block(CATEGORIES, ITEMS, DOC)
    web = markdown_text.plain(loadout_bans.render_block(data, "markdown"))
    assert "**Waffen**\n\n| Bild | ++Waffe++ | Aufsätze |\n| --- | --- | --- |\n|  | ++Ohne Klasse++ |  |\n" in web, \
        "Kopf mit Marke fürs Web, Waffen ohne Klasse zuerst, ohne passenden Aufsatz leer"
    assert f"| ![Klassen-Symbol]({ICON}) | *Sturmgewehr* |  |\n| ![Ausrüstung]({IMAGE}) | ++Blitz 9++ | **gesperrt:** ++*Optik:* Rotpunkt++ |" in web
    assert "|  | ++Donner 4++ *nicht in Suchen* | **eingeschränkt:** ++*Optik:* Rotpunkt (nicht in Suchen)++ |" in web
    assert "|  | *Schrotflinte* · **nicht erlaubt** (Bö, Hagel) |  |" in web and "++Hagel++" not in web
    assert "|  | *Pistole* · nicht in Suchen |  |\n|  | ++Funke++ |  |\n|  | ++Zunder++ *nicht in Suchen, Stellung* |  |" in web, \
        "der Hinweis der Klasse steht einmal in ihrer Zeile"
    assert web.count("| Bild |") == 1, "eine Tabelle je Kategorie"
    # Kategorien ohne Waffen bleiben wie in layout 4: im Web Karten, im PDF die Tabelle.
    assert web.endswith("**Perks**\n\n- ++Leise Sohlen++")
    pdf = markdown_text.plain(loadout_bans.render_block(data, "pdf"))
    assert "| Bild | Waffe | Aufsätze |" in pdf and "| *Sturmgewehr* |  |  |" in pdf and "++" not in pdf
    assert "| *Schrotflinte* · **nicht erlaubt** (Bö, Hagel) |  |  |" in pdf
    assert pdf.endswith("| Kategorie | Unterkategorie | Erlaubt | Einschränkungen |\n| --- | --- | --- | --- |\n| Perks | – | Leise Sohlen | – |")
    text = markdown_text.plain(loadout_bans.render_block(data, "text"))
    assert "| Waffe | Aufsätze |" in text and "![" not in text and BREAK not in text, "Klartext ohne Bilder und ohne Zeilenwechsel"


def test_the_pdf_variant_is_read_by_the_rule_blocks_and_older_text_stays():
    data = loadout_bans.allowed_block(CATEGORIES, ITEMS, DOC)
    assert league_rule_blocks.value("loadout_bans", {"data": data}, league_rule_blocks.PDF) == loadout_bans.render_block(data, "pdf")
    # Ältere Fassungen mit gespeichertem Markdown (vor #2218): das PDF liest ``text`` wie bisher.
    assert league_rule_blocks.value("loadout_bans", {"markdown": "Web", "text": "Text"}, league_rule_blocks.PDF) == "Text"
    assert league_rule_blocks.value("map_pool", {"data": {"rows": [{"label": "Suchen", "maps": ["Hafen"], "icon_url": ICON}]}},
                                    league_rule_blocks.PDF) == "| Modus | Maps |\n| --- | --- |\n| Suchen | Hafen |", "Symbole nur im Web"


def test_pdf_and_backend_agree_on_head_and_line_break():
    assert pdf_service._RULES_GEAR_HEAD == loadout_bans.GEAR_HEAD and pdf_service._RULES_CELL_BREAK == loadout_bans.CELL_BREAK
    assert markdown_text.text_cell(f"Name{BREAK}zwei") == "Name zwei", "kein Name bricht die Zelle"


# ---------------------------------------------------------------- PDF

def test_the_pdf_draws_a_small_image_lines_per_slot_and_spans_class_rows(tmp_path, monkeypatch):
    Image.new("RGB", (1600, 900), (41, 182, 232)).save(tmp_path / "falke-50.png")
    monkeypatch.setattr(pdf_service, "PUBLIC_UPLOAD_DIR", tmp_path)
    doc = {"entries": [at_falke("Optik A", "Optik B", "Optik C", "Lauf A", "Lauf B", "Mündung A")]}
    data = loadout_bans.allowed_block(GEAR, gear_items(), doc, SEASON)
    flowables = pdf_service._rules_blocks(loadout_bans.render_block(data, "pdf"), pdf_service._rules_styles(), 17 * pdf_service.cm,
                                          frozenset(), False)
    gear = next(row for row in flowables if isinstance(row, Table) and len(row._cellvalues[0]) == 3)
    head, klass, first, second = gear._cellvalues[:4]
    assert [cell.getPlainText() for cell in head] == ["Bild", "Waffe", "Aufsätze"]
    assert klass[0].getPlainText() == "Scharfschützengewehr · alle erlaubt" and klass[1:] == ["", ""]
    assert ("SPAN", (0, 1), (-1, 1)) in [tuple(command[:3]) for command in gear._spanCmds], "Kopf der Klasse über die ganze Breite"
    picture = first[0]
    assert isinstance(picture, PlatypusImage) and picture.drawWidth <= 2.4 * pdf_service.cm + 0.01
    assert picture.drawHeight <= 1.35 * pdf_service.cm + 0.01
    assert [paragraph.getPlainText() for paragraph in first[2]] == ["nur erlaubt:", "Optik: Optik D", "Lauf: Lauf C", "Mündung: Mündung B"]
    assert second[0] == "" and second[2].getPlainText() == "alle passenden Aufsätze erlaubt", "ohne Bild bleibt die Zelle leer"
    # Ohne Datei: leere Zelle statt „[Bild: …]“.
    monkeypatch.setattr(pdf_service, "PUBLIC_UPLOAD_DIR", tmp_path / "fehlt")
    monkeypatch.setattr(pdf_service, "UPLOAD_DIR", tmp_path / "fehlt")
    flowables = pdf_service._rules_blocks(loadout_bans.render_block(data, "pdf"), pdf_service._rules_styles(), 17 * pdf_service.cm,
                                          frozenset(), False)
    gear = next(row for row in flowables if isinstance(row, Table) and len(row._cellvalues[0]) == 3)
    assert gear._cellvalues[2][0] == ""


def test_other_tables_in_the_pdf_stay_as_they_were():
    """Nur der Kopf Bild · Waffe · Aufsätze macht die neue Tabelle - eine Tabelle im freien Text mit Bild bleibt beim Hinweis."""
    md = f"| Bild | Name |\n| --- | --- |\n| ![Karte]({SNIPER_IMAGE}) | Hafen |"
    [table, _space] = pdf_service._rules_blocks(md, pdf_service._rules_styles(), 17 * pdf_service.cm, frozenset(), False)
    assert table._cellvalues[1][0].getPlainText() == "[Bild: Karte]" and table._colWidths == [17 * pdf_service.cm / 2] * 2
