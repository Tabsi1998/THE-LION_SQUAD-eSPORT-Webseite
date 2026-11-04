"""Erlaubte Ausrüstung im Regelwerk (docs/LIGA.md, C.4 #2287, Fabian Nr. 99) - ohne Datenbank.

Der Baustein zeigt, was ERLAUBT ist: je Kategorie und Unterkategorie die aktiven Einträge der Bibliothek ohne die Sperren, mit Hinweis
„nicht in …“ (nur in Modi gesperrt) und „nicht an …“ (Aufsatz an einzelnen Waffen gesperrt). Eine ganz gesperrte Klasse ist eine kurze
Zeile „nicht erlaubt“. Web mit Karten, PDF als Tabelle Kategorie · Unterkategorie · Erlaubt · Einschränkungen. Ältere Fassungen (Sperren,
ohne ``layout``) bleiben Wort für Wort. Erfundene Namen.
"""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import pdf_service  # noqa: E402
from services import loadout_bans, markdown_text  # noqa: E402

IMAGE = "/api/static/uploads/blitz-1.webp"
ICON = "/api/static/uploads/klasse-1.png"
OLD = {"list": True, "groups": [{"label": "Waffen", "entries": [{"name": "Blitz 9", "image_url": IMAGE, "modes": []},
                                                              {"name": "Donner 4", "image_url": None, "modes": ["Suchen"]}]}],
       "weapons": [{"name": "Hagel", "image_url": None, "modes": [], "attachments": ["Griff", "Lauf"]}]}


def test_older_frozen_data_renders_word_for_word_as_before():
    assert loadout_bans.render_block(OLD, "markdown") == (
        "*Gesperrt ist nur, was hier steht – alles andere ist erlaubt.*\n\n**Waffen**\n\n| Bild | Name | Gilt in |\n| --- | --- | --- |\n"
        f"| ![Blitz 9]({IMAGE}) | Blitz 9 | alle Modi |\n| – | Donner 4 | Suchen |\n\n**Aufsätze an erlaubten Waffen**\n\n"
        "| Bild | Waffe | Gesperrte Aufsätze | Gilt in |\n| --- | --- | --- | --- |\n| – | Hagel | Griff, Lauf | alle Modi |")
    assert loadout_bans.render_block(OLD, "text") == (
        "*Gesperrt ist nur, was hier steht – alles andere ist erlaubt.*\n\n**Waffen**\n\n- Blitz 9 – gilt in: alle Modi\n"
        "- Donner 4 – gilt in: Suchen\n\n**Aufsätze an erlaubten Waffen**\n\n- Hagel: Griff, Lauf – gilt in: alle Modi")
    assert loadout_bans.block_images(OLD) == [IMAGE]
    assert "keine Sperrliste" in loadout_bans.render_block({"list": False, "groups": [], "weapons": []})


CATEGORIES = [
    {"key": "waffen", "label": "Waffen", "role": "weapon", "subcategories": [
        {"key": "sturm", "label": "Sturmgewehr", "icon_url": ICON}, {"key": "schrot", "label": "Schrotflinte", "icon_url": None},
        {"key": "pistole", "label": "Pistole", "icon_url": None}, {"key": "leer", "label": "Raketenwerfer", "icon_url": None}]},
    {"key": "aufsaetze", "label": "Aufsätze", "role": "attachment", "subcategories": [{"key": "optik", "label": "Optik", "icon_url": None}]},
    {"key": "perks", "label": "Perks", "role": "item", "subcategories": []},
]


def item(item_id: str, category: str, name: str, sub: str | None = None, **extra) -> dict:
    return {"id": item_id, "category": category, "subcategory": sub, "name": name, "image_url": None, "status": "active", **extra}


ITEMS = [
    item("w1", "waffen", "Blitz 9", "sturm", image_url=IMAGE), item("w2", "waffen", "Donner 4", "sturm"),
    item("s1", "waffen", "Hagel", "schrot"), item("s2", "waffen", "Bö", "schrot"),
    item("p1", "waffen", "Funke", "pistole"), item("p2", "waffen", "Zunder", "pistole"),
    item("o1", "waffen", "Ohne Klasse"), item("x1", "waffen", "Alt", "sturm", status="inactive"),
    item("a1", "aufsaetze", "Rotpunkt", "optik", weapon_class_ids=["sturm"]), item("a2", "aufsaetze", "Griff", weapon_ids=["w1"]),
    item("k1", "perks", "Leise Sohlen"), item("k2", "perks", "Kaltblut"), item("k3", "perks", "Weg", status="archived"),
]


def ban(kind: str, **extra) -> dict:
    return {"kind": kind, "item_id": None, "name": "", "modes": [], "mode_labels": [], "attachments": [], **extra}


DOC = {"entries": [
    ban("class", subcategory="schrot", name="Schrotflinte"),
    ban("class", subcategory="pistole", name="Pistole", mode_labels=["Suchen"]),
    ban("item", item_id="w2", name="Donner 4", mode_labels=["Suchen"]),
    ban("item", item_id="k2", name="Kaltblut"),
    ban("item", item_id="p2", name="Zunder", mode_labels=["Stellung"]),
    ban("attachments", item_id="w1", name="Blitz 9", attachments=[{"item_id": "a1", "name": "Rotpunkt"}]),
    ban("attachments", item_id="w2", name="Donner 4", mode_labels=["Suchen"], attachments=[{"item_id": "a1", "name": "Rotpunkt"}]),
]}


def sections(data: dict, label: str) -> dict:
    category = next(row for row in data["categories"] if row["label"] == label)
    return {row["label"]: row for row in category["sections"]}


# Eingefrorene Fassungen mit ``layout: 3`` (#2287): so hat der Baustein bis #2299 für CATEGORIES/ITEMS mit DOC bzw. ohne Liste
# ausgesehen. Sie werden weiter Wort für Wort dargestellt - der neue Aufbau (layout 4) steht in test_loadout_allowed_by_weapon_unit.
V3 = json.loads((pathlib.Path(__file__).resolve().parent / "golden" / "loadout_allowed_v3.json").read_text(encoding="utf-8"))


def test_frozen_layout_3_keeps_its_structure():
    data = V3["DOC"]
    assert data["layout"] == 3 and [row["label"] for row in data["categories"]] == ["Waffen", "Aufsätze", "Perks"]
    sight = sections(data, "Aufsätze")["Optik"]["entries"][0]
    assert sight["not_at"] == [{"name": "Blitz 9", "modes": []}, {"name": "Donner 4", "modes": ["Suchen"]}]


def test_web_shows_cards_and_short_lines_the_pdf_a_table():
    data = V3["DOC"]
    web = markdown_text.plain(loadout_bans.render_block(data, "markdown"))
    assert web.startswith("*Erlaubt ist die Ausrüstung, die hier steht")
    assert "**Waffen**" in web and "- ++Ohne Klasse++" in web
    assert f"![Klassen-Symbol]({ICON}) *Sturmgewehr*" in web
    assert f"- ![Ausrüstung]({IMAGE}) ++Blitz 9++\n" in web and "- ++Donner 4++ *nicht in Suchen*" in web
    assert "*Schrotflinte* · **nicht erlaubt** (Bö, Hagel)" in web and "++Hagel++" not in web
    assert "*Pistole* · nicht in Suchen" in web and "- ++Funke++\n" in web and "- ++Zunder++ *nicht in Suchen, Stellung*" in web
    assert "- ++Rotpunkt++ *nicht an Blitz 9, Donner 4 (in Suchen)*" in web
    assert "Kaltblut" not in web and "Alt" not in web
    text = markdown_text.plain(loadout_bans.render_block(data, "text"))
    assert "![" not in text
    assert "| Kategorie | Unterkategorie | Erlaubt | Einschränkungen |" in text
    assert "| Waffen | – | alle: Ohne Klasse | – |" in text
    assert "| Waffen | Sturmgewehr | Blitz 9 | – |" in text and "| Waffen | Sturmgewehr | Donner 4 | nicht in Suchen |" in text
    assert "| Waffen | Schrotflinte | nicht erlaubt (Bö, Hagel) | – |" in text
    assert "| Waffen | Pistole | Funke | nicht in Suchen |" in text and "| Waffen | Pistole | Zunder | nicht in Suchen, Stellung |" in text
    assert "| Aufsätze | Optik | Rotpunkt | nicht an Blitz 9, Donner 4 (in Suchen) |" in text
    assert "| Aufsätze | – | alle: Griff | – |" in text
    assert loadout_bans.block_images(data) == [ICON, IMAGE]


def test_without_a_list_everything_active_is_allowed_and_a_class_says_all():
    data = V3["NONE"]
    assert data["list"] is False and sections(data, "Waffen")["Schrotflinte"]["state"] == "all"
    web = loadout_bans.render_block(data, "markdown")
    assert "nichts gesperrt" in web and "*Schrotflinte* · alle erlaubt" in markdown_text.plain(web)
    assert "| Waffen | Schrotflinte | alle: Bö, Hagel | – |" in markdown_text.plain(loadout_bans.render_block(data, "text"))
    assert "keine Ausrüstung erlaubt" in loadout_bans.render_block(loadout_bans.allowed_block(CATEGORIES, [], None))


def test_a_new_entry_changes_the_block_also_in_a_banned_class():
    before = loadout_bans.render_block(loadout_bans.allowed_block(CATEGORIES, ITEMS, DOC))
    for extra in (item("n1", "waffen", "Neu", "sturm"), item("n2", "waffen", "Sturm 12", "schrot")):
        assert loadout_bans.render_block(loadout_bans.allowed_block(CATEGORIES, [*ITEMS, extra], DOC)) != before


TRICKY = "[Klick](https://example.test/x) **fett** `code` |Rohr| \\pfad"


def test_every_card_carries_its_marker_also_without_image():
    """Codex Runde 1: Jede Karte trägt ihren Namen als Marke (++Name++, im Web <u>), auch ohne Bild - so stehen alle Kategorien gleich im
    Raster, nicht nur die mit Bildern."""
    for data in (V3["NONE"], loadout_bans.allowed_block(CATEGORIES, ITEMS, None)):
        web = loadout_bans.render_block(data, "markdown")
        cards = [line for line in web.splitlines() if line.startswith("- ")]
        assert cards and all("++" in line for line in cards)
        assert "++" not in loadout_bans.render_block(data, "text"), "das PDF zeigt keine Karten"


def test_names_in_the_block_stay_text():
    categories = [{"key": "c", "label": TRICKY, "role": "weapon", "subcategories": [{"key": "s", "label": TRICKY, "icon_url": None},
                                                                                    {"key": "b", "label": TRICKY, "icon_url": None}]}]
    items = [item("i1", "c", TRICKY, "s"), item("i2", "c", TRICKY, "b")]
    doc = {"entries": [ban("class", subcategory="b"), ban("item", item_id="i1", mode_labels=[TRICKY])]}
    data = loadout_bans.allowed_block(categories, items, doc)
    for variant in ("markdown", "text"):
        shown = loadout_bans.render_block(data, variant)
        assert "[Klick](https://" not in shown and "**fett**" not in shown and "\\" not in shown
        assert TRICKY.replace("|", "/") in markdown_text.plain(shown)
    for line in loadout_bans.render_block(data, "text").splitlines():
        assert "<a " not in pdf_service.pdf_rules_inline(line)


def test_attachments_only_count_as_allowed_where_they_fit_an_allowed_weapon():
    """Codex Runde 1, Fund 3 (Nr. 81): Ein Aufsatz ohne Waffe und ohne Klasse passt zu keiner - er ist nicht erlaubt. Ebenso einer, der nur zu
    gesperrten Waffen oder Klassen passt oder an jeder passenden Waffe gesperrt ist. Die Verwaltung nennt sie."""
    items = [
        item("w1", "waffen", "Blitz 9", "sturm"), item("s1", "waffen", "Hagel", "schrot"), item("o1", "waffen", "Weg"),
        item("a1", "aufsaetze", "Rotpunkt", "optik", weapon_class_ids=["sturm"]),
        item("a2", "aufsaetze", "Kompensator"),
        item("a3", "aufsaetze", "Choke", weapon_class_ids=["schrot"]),
        item("a4", "aufsaetze", "Lauf", weapon_ids=["o1"]),
        item("a5", "aufsaetze", "Laser", weapon_ids=["w1"]),
        item("a6", "aufsaetze", "Griff", weapon_ids=["w1", "s1"]),
    ]
    doc = {"entries": [ban("class", subcategory="schrot"), ban("item", item_id="o1"),
                       ban("attachments", item_id="w1", name="Blitz 9", attachments=[{"item_id": "a5", "name": "Laser"}])]}
    data = loadout_bans.allowed_block(CATEGORIES, items, doc)
    assert [row["label"] for row in data["categories"]] == ["Waffen"], "Aufsätze stehen nur an der Waffe (#2299)"
    blitz = sections(data, "Waffen")["Sturmgewehr"]["entries"][0]["attachments"]
    shown = [entry["name"] for group in blitz["groups"] for entry in group["entries"]]
    assert shown == ["Griff", "Rotpunkt"] and blitz["banned"] == ["Laser"], "nur, was zur erlaubten Waffe passt"
    unusable = loadout_bans.unusable_attachments(CATEGORIES, items, doc)
    assert [(row["name"], row["reason"]) for row in unusable] == [
        ("Choke", "passt nur zu gesperrten Waffen"), ("Kompensator", "keiner Waffe zugeordnet"), ("Laser", "an jeder passenden Waffe gesperrt"),
        ("Lauf", "passt nur zu gesperrten Waffen")]

def test_a_name_with_plus_signs_stays_one_card_and_plain_text():
    """Codex Runde 2: „A++B“ - der Name selbst trägt die Zeichen der Kartenmarke. Er bleibt Text: keine weitere Marke, im PDF wörtlich,
    in der API ohne Schutzzeichen; die alte Fassung bleibt, wie sie war."""
    name = "A++B"
    data = loadout_bans.allowed_block([{"key": "w", "label": "Waffen", "role": "item", "subcategories": []}],
                                      [item("p1", "w", name)], None)
    web = loadout_bans.render_block(data, "markdown")
    served = markdown_text.served(web)
    assert "- ++A\\+\\+B++" in served and not any(0xE000 <= ord(char) <= 0xF8FF for char in served)
    assert markdown_text.plain(web).splitlines()[-1] == "- ++A++B++"
    text = loadout_bans.render_block(data, "text")
    assert "| Waffen | – | alle: A++B | – |" in markdown_text.plain(text)
    for line in text.splitlines():
        assert "<u>" not in pdf_service.pdf_rules_inline(line)
    assert "alle: A++B" in pdf_service.pdf_rules_inline(text.splitlines()[-1]), "im PDF wörtlich"
    old = {"list": True, "groups": [{"label": "Waffen", "entries": [{"name": name, "image_url": None, "modes": []}]}], "weapons": []}
    assert markdown_text.plain(loadout_bans.render_block(old, "markdown")).endswith("| – | A++B | alle Modi |")