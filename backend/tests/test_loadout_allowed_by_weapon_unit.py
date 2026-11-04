"""Erlaubte Ausrüstung: Aufsätze je Waffe (#2299) und „nur in …“ (#2298) - ohne Datenbank (docs/LIGA.md, C.4).

Der Baustein (``layout: 4``) nennt die Aufsätze nur noch an der Waffe: je Waffe die passenden (über die Waffe oder ihre Waffenklasse),
davon gesperrt und je Slot die erlaubten. Ist ein Eintrag in mehr Modi der Season gesperrt als erlaubt, heißt der Hinweis „nur in …“.
PDF: je Waffe eine Zeile „… – alle passenden Aufsätze erlaubt, außer: …“. Erfundene Namen.
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import pdf_service  # noqa: E402
from services import loadout_bans, markdown_text  # noqa: E402
from test_loadout_bans_grouped_unit import CATEGORIES, DOC, ICON, IMAGE, ITEMS, ban, item, sections  # noqa: E402

SEASON = [("stellung", "Stellung"), ("kapern", "Kapern"), ("suchen", "Suchen")]
SIGHT = "/api/static/uploads/rotpunkt-3.webp"
SLOT_ICON = "/api/static/uploads/optik-4.png"


def modes(*keys: str) -> dict:
    labels = dict(SEASON)
    return {"modes": list(keys), "mode_labels": [labels.get(key, key.title()) for key in keys]}


def weapon(data: dict, section: str, name: str) -> dict:
    return next(row for row in sections(data, "Waffen")[section]["entries"] if row["name"] == name)


# ---------------------------------------------------------------- Aufbau

def test_attachments_stand_at_their_weapon_by_slot():
    data = loadout_bans.allowed_block(CATEGORIES, ITEMS, DOC)
    assert data["layout"] == 4 and data["list"] is True
    assert [(row["label"], row["role"]) for row in data["categories"]] == [("Waffen", "weapon"), ("Perks", "item")], \
        "keine eigene Aufsatz-Liste mehr"
    blitz, donner = sections(data, "Waffen")["Sturmgewehr"]["entries"]
    # Blitz 9: Rotpunkt über die Klasse Sturmgewehr (an Blitz 9 gesperrt), Griff über die Waffe selbst.
    assert blitz == {"name": "Blitz 9", "image_url": IMAGE, "not_in": [], "attachments": {
        "count": 2, "banned": ["Rotpunkt"], "groups": [{"label": None, "not_in": [], "entries": [{"name": "Griff", "image_url": None,
                                                                                                   "not_in": []}]}]}}
    # Donner 4: nur Rotpunkt passt (über die Klasse), an Donner 4 nur in Suchen gesperrt.
    assert donner["attachments"] == {"count": 1, "banned": [], "groups": [
        {"label": "Optik", "not_in": [], "entries": [{"name": "Rotpunkt", "image_url": None, "not_in": ["Suchen"]}]}]}
    assert "attachments" not in weapon(data, None, "Ohne Klasse"), "ohne passenden Aufsatz kein Feld"
    assert "attachments" not in weapon(data, "Pistole", "Funke")
    assert sections(data, "Waffen")["Schrotflinte"]["state"] == "banned"


def test_a_class_attachment_fits_every_weapon_of_the_class_a_weapon_attachment_only_its_weapon():
    categories = [{**CATEGORIES[0]}, {**CATEGORIES[1], "subcategories": [{"key": "optik", "label": "Optik", "icon_url": SLOT_ICON},
                                                                            {"key": "lauf", "label": "Lauf", "icon_url": None}]}]
    items = [item("w1", "waffen", "Blitz 9", "sturm"), item("w2", "waffen", "Donner 4", "sturm"), item("w3", "waffen", "Neu 1", "sturm"),
             item("s1", "waffen", "Hagel", "schrot"),
             item("a1", "aufsaetze", "Rotpunkt", "optik", weapon_class_ids=["sturm"], image_url=SIGHT),
             item("a2", "aufsaetze", "Langer Lauf", "lauf", weapon_ids=["w2", "s1"]),
             item("a3", "aufsaetze", "Kurzer Lauf", "lauf", weapon_class_ids=["schrot"], weapon_ids=["w1"])]
    data = loadout_bans.allowed_block(categories, items, None)

    def slots(name: str, section: str = "Sturmgewehr") -> list:
        found = weapon(data, section, name)["attachments"]
        return [(group["label"], [entry["name"] for entry in group["entries"]]) for group in found["groups"]]

    assert slots("Blitz 9") == [("Optik", ["Rotpunkt"]), ("Lauf", ["Kurzer Lauf"])], "Reihenfolge der Slots wie in der Bibliothek"
    assert slots("Donner 4") == [("Optik", ["Rotpunkt"]), ("Lauf", ["Langer Lauf"])]
    assert slots("Neu 1") == [("Optik", ["Rotpunkt"])], "eine neue Waffe der Klasse bekommt die Aufsätze der Klasse"
    assert slots("Hagel", "Schrotflinte") == [("Lauf", ["Kurzer Lauf", "Langer Lauf"])]
    optik = weapon(data, "Sturmgewehr", "Blitz 9")["attachments"]["groups"][0]
    assert optik["icon_url"] == SLOT_ICON and optik["entries"][0]["image_url"] == SIGHT
    assert weapon(data, "Sturmgewehr", "Blitz 9")["attachments"]["count"] == 2


def test_bans_of_an_attachment_class_an_attachment_and_one_at_a_weapon():
    categories = CATEGORIES[:2]
    items = [item("w1", "waffen", "Blitz 9", "sturm"), item("w2", "waffen", "Donner 4", "sturm"),
             item("a1", "aufsaetze", "Rotpunkt", "optik", weapon_class_ids=["sturm"]),
             item("a2", "aufsaetze", "Holo", "optik", weapon_class_ids=["sturm"]),
             item("a3", "aufsaetze", "Griff", weapon_class_ids=["sturm"]),
             item("a4", "aufsaetze", "Laser", weapon_class_ids=["sturm"])]
    doc = {"entries": [
        ban("class", subcategory="optik", **modes("suchen")),
        ban("item", item_id="a3", name="Griff"),  # „an allen Waffen sperren“ = der Aufsatz selbst
        ban("attachments", item_id="w1", name="Blitz 9", attachments=[
            {"item_id": "a1", "name": "Rotpunkt", **modes("stellung")}, {"item_id": "a4", "name": "Laser"}]),
    ]}
    data = loadout_bans.allowed_block(categories, items, doc)
    blitz = weapon(data, "Sturmgewehr", "Blitz 9")["attachments"]
    assert blitz["count"] == 4 and blitz["banned"] == ["Griff", "Laser"]
    [optik] = blitz["groups"]
    assert optik["label"] == "Optik" and optik["not_in"] == ["Suchen"], "die Klasse steht am Slot"
    assert [(entry["name"], entry["not_in"]) for entry in optik["entries"]] == [("Holo", ["Suchen"]), ("Rotpunkt", ["Suchen", "Stellung"])]
    donner = weapon(data, "Sturmgewehr", "Donner 4")["attachments"]
    assert donner["banned"] == ["Griff"], "Laser ist nur an Blitz 9 gesperrt"
    assert [entry["name"] for group in donner["groups"] for entry in group["entries"]] == ["Laser", "Holo", "Rotpunkt"]
    # Ganze Klasse in allen Modi: an jeder Waffe gesperrt.
    whole = loadout_bans.allowed_block(categories, items, {"entries": [ban("class", subcategory="optik")]})
    assert weapon(whole, "Sturmgewehr", "Donner 4")["attachments"]["banned"] == ["Holo", "Rotpunkt"]


# ---------------------------------------------------------------- „nur in …“ (#2298)

def perk_world(*bans: dict) -> tuple[list, list, dict]:
    categories = [{"key": "perks", "label": "Perks", "role": "item", "subcategories": [{"key": "laut", "label": "Laut", "icon_url": None}]}]
    items = [item("k1", "perks", "Eins"), item("k2", "perks", "Zwei"), item("k3", "perks", "Drei"), item("k4", "perks", "Vier"),
             item("k5", "perks", "Fünf", "laut")]
    return categories, items, {"entries": list(bans)}


def test_only_in_when_banned_in_more_season_modes_than_allowed():
    categories, items, doc = perk_world(
        ban("item", item_id="k1", **modes("suchen")),  # 1 von 3
        ban("item", item_id="k2", **modes("stellung", "kapern")),  # 2 von 3
        ban("item", item_id="k3", **modes("stellung", "kapern", "suchen")),  # alle 3 einzeln
        ban("item", item_id="k4"),  # alle Modi
        ban("class", subcategory="laut", **modes("suchen", "stellung")))
    data = loadout_bans.allowed_block(categories, items, doc, SEASON)
    rows = {entry["name"]: entry for section in data["categories"][0]["sections"] for entry in section["entries"]}
    assert rows["Eins"] == {"name": "Eins", "image_url": None, "not_in": ["Suchen"]}, "1 von 3: nicht in"
    assert rows["Zwei"]["only_in"] == ["Suchen"] and rows["Zwei"]["not_in"] == ["Stellung", "Kapern"], "2 von 3: nur in"
    assert "only_in" not in rows["Drei"], "kein erlaubter Modus bleibt: nicht in …"
    assert "Vier" not in rows, "in allen Modi gesperrt bleibt ganz gesperrt"
    laut = sections(data, "Perks")["Laut"]
    assert laut["only_in"] == ["Kapern"] and rows["Fünf"]["only_in"] == ["Kapern"]
    web = markdown_text.plain(loadout_bans.render_block(data, "markdown"))
    assert "- ++Eins++ *nicht in Suchen*" in web and "- ++Zwei++ *nur in Suchen*" in web
    assert "*Laut* · nur in Kapern" in web and "- ++Fünf++\n" in f"{web}\n", "die Karte wiederholt den Hinweis der Klasse nicht"
    text = markdown_text.plain(loadout_bans.render_block(data, "text"))
    assert "| Perks | – | Zwei | nur in Suchen |" in text and "| Perks | – | Eins | nicht in Suchen |" in text
    assert "| Perks | Laut | alle: Fünf | nur in Kapern |" in text


def test_a_tie_or_no_season_modes_keeps_not_in():
    categories, items, doc = perk_world(ban("item", item_id="k1", **modes("suchen")), ban("item", item_id="k2", **modes("stellung", "kapern")))
    two = [("stellung", "Stellung"), ("suchen", "Suchen")]
    rows = {entry["name"]: entry for entry in loadout_bans.allowed_block(categories, items, doc, two)["categories"][0]["sections"][0]["entries"]}
    assert "only_in" not in rows["Eins"], "Gleichstand 1:1 bleibt „nicht in“"
    # Kapern gehört nicht zur Season: gezählt wird nur Stellung - 1 von 2.
    assert "only_in" not in rows["Zwei"]
    four = [*SEASON, ("abschuss", "Abschuss")]
    rows = {entry["name"]: entry for entry in loadout_bans.allowed_block(categories, items, doc, four)["categories"][0]["sections"][0]["entries"]}
    assert "only_in" not in rows["Zwei"], "2 von 4: Gleichstand"
    rows = {entry["name"]: entry for entry in loadout_bans.allowed_block(categories, items, doc)["categories"][0]["sections"][0]["entries"]}
    assert "only_in" not in rows["Zwei"], "ohne Modi der Season kein „nur in“"


def test_only_in_also_for_an_attachment_at_a_weapon():
    categories = CATEGORIES[:2]
    items = [item("w1", "waffen", "Blitz 9", "sturm"), item("a1", "aufsaetze", "Rotpunkt", "optik", weapon_ids=["w1"])]
    doc = {"entries": [ban("attachments", item_id="w1", name="Blitz 9", **modes("stellung", "kapern"),
                           attachments=[{"item_id": "a1", "name": "Rotpunkt"}])]}
    data = loadout_bans.allowed_block(categories, items, doc, SEASON)
    entry = weapon(data, "Sturmgewehr", "Blitz 9")["attachments"]["groups"][0]["entries"][0]
    assert entry["only_in"] == ["Suchen"]
    text = markdown_text.plain(loadout_bans.render_block(data, "text"))
    assert "- Blitz 9 – alle passenden Aufsätze erlaubt, außer: Rotpunkt (nur in Suchen)" in text


# ---------------------------------------------------------------- Darstellung

def test_the_pdf_has_one_line_per_weapon():
    data = loadout_bans.allowed_block(CATEGORIES, ITEMS, DOC)
    text = markdown_text.plain(loadout_bans.render_block(data, "text"))
    assert "![" not in text and "++" not in text
    assert "**Waffen**" in text and "- Ohne Klasse\n" in text, "ohne passende Aufsätze nur der Name"
    assert "*Sturmgewehr*\n- Blitz 9 – alle passenden Aufsätze erlaubt, außer: Rotpunkt\n" in text
    assert "- Donner 4 (nicht in Suchen) – alle passenden Aufsätze erlaubt, außer: Rotpunkt (nicht in Suchen)" in text
    assert "*Schrotflinte* · **nicht erlaubt** (Bö, Hagel)" in text
    assert "*Pistole* · nicht in Suchen\n- Funke\n- Zunder (nicht in Suchen, Stellung)" in text
    assert "| Kategorie | Unterkategorie | Erlaubt | Einschränkungen |" in text and "| Perks | – | Leise Sohlen | – |" in text
    assert "Aufsätze |" not in text and "nicht an" not in text
    free = markdown_text.plain(loadout_bans.render_block(loadout_bans.allowed_block(CATEGORIES, ITEMS, None), "text"))
    assert "- Blitz 9 – alle passenden Aufsätze erlaubt\n" in free and "*Sturmgewehr* · alle erlaubt" in free
    for line in text.splitlines():
        assert "<u>" not in pdf_service.pdf_rules_inline(line)


def test_a_weapon_without_an_allowed_attachment_says_so():
    items = [item("w1", "waffen", "Blitz 9", "sturm"), item("a1", "aufsaetze", "Rotpunkt", "optik", weapon_ids=["w1"]),
             item("a2", "aufsaetze", "Griff", weapon_ids=["w1"])]
    doc = {"entries": [ban("attachments", item_id="w1", name="Blitz 9", attachments=[{"item_id": "a1", "name": "Rotpunkt"},
                                                                                    {"item_id": "a2", "name": "Griff"}])]}
    data = loadout_bans.allowed_block(CATEGORIES[:2], items, doc)
    assert weapon(data, "Sturmgewehr", "Blitz 9")["attachments"] == {"count": 2, "banned": ["Griff", "Rotpunkt"], "groups": []}
    assert "- Blitz 9 – keine Aufsätze erlaubt (Griff, Rotpunkt)" in markdown_text.plain(loadout_bans.render_block(data, "text"))


def test_the_web_card_names_the_attachments_under_the_weapon():
    data = loadout_bans.allowed_block(CATEGORIES, ITEMS, DOC)
    web = markdown_text.plain(loadout_bans.render_block(data, "markdown"))
    assert f"- ![Ausrüstung]({IMAGE}) ++Blitz 9++ alle passenden Aufsätze erlaubt, außer: Rotpunkt\n" in web
    assert "- ++Donner 4++ *nicht in Suchen* alle passenden Aufsätze erlaubt, außer: Rotpunkt (nicht in Suchen)" in web
    assert web.count("++Ohne Klasse++\n") == 1 and "**Aufsätze**" not in web and "nicht an" not in web
    assert f"![Klassen-Symbol]({ICON}) *Sturmgewehr*" in web


def test_images_of_attachments_and_slots_are_named():
    categories = [CATEGORIES[0], {**CATEGORIES[1], "subcategories": [{"key": "optik", "label": "Optik", "icon_url": SLOT_ICON}]}]
    items = [item("w1", "waffen", "Blitz 9", "sturm", image_url=IMAGE), item("a1", "aufsaetze", "Rotpunkt", "optik", weapon_ids=["w1"],
                                                                             image_url=SIGHT)]
    data = loadout_bans.allowed_block(categories, items, None)
    assert loadout_bans.block_images(data) == [ICON, IMAGE, SLOT_ICON, SIGHT]


# ---------------------------------------------------------------- Modi je Aufsatz in der Sperrliste (#2299)

def version(*attachment_rows: dict, row_modes=()) -> dict:
    return {"entries": [{**ban("attachments", item_id="w1", name="Blitz 9", **modes(*row_modes)), "attachments": list(attachment_rows)}]}


def test_compare_and_sync_count_the_modes_of_each_attachment():
    plain_row = version({"item_id": "a1", "name": "Rotpunkt"}, {"item_id": "a2", "name": "Griff"}, row_modes=("suchen",))
    # Dieselbe Wirkung anders geschrieben: Zeile ohne Modi, jeder Aufsatz mit „Suchen“ - nichts geändert, keine neue Kopie für Staffeln.
    spelled = version({"item_id": "a1", "name": "Rotpunkt", **modes("suchen")}, {"item_id": "a2", "name": "Griff", **modes("suchen")})
    assert loadout_bans.compare(plain_row, spelled)["same"] is True
    assert loadout_bans._rows_key(plain_row) == loadout_bans._rows_key(spelled)
    changed = version({"item_id": "a1", "name": "Rotpunkt", **modes("stellung")}, {"item_id": "a2", "name": "Griff", **modes("suchen")})
    diff = loadout_bans.compare(plain_row, changed)
    assert diff["same"] is False and diff["changed"][0]["attachments"] == ["Rotpunkt (in Stellung)", "Griff (in Suchen)"]
    assert loadout_bans._rows_key(plain_row) != loadout_bans._rows_key(changed)
    shown = loadout_bans.view({**changed, "id": "v", "version": 2})["entries"][0]["attachments"]
    assert shown[0] == {"item_id": "a1", "name": "Rotpunkt", "image_url": None, "modes": ["stellung"], "mode_labels": ["Stellung"]}
    assert "modes" not in loadout_bans.view({**plain_row, "id": "v", "version": 1})["entries"][0]["attachments"][0], "Altbestand wie bisher"


TRICKY = "[Klick](https://example.test/x) **fett** `code` |Rohr| \\pfad"


def test_names_of_attachments_and_slots_stay_text():
    categories = [CATEGORIES[0], {**CATEGORIES[1], "subcategories": [{"key": "optik", "label": TRICKY, "icon_url": None}]}]
    items = [item("w1", "waffen", "Blitz 9", "sturm"), item("a1", "aufsaetze", TRICKY, "optik", weapon_ids=["w1"]),
             item("a2", "aufsaetze", f"{TRICKY} 2", "optik", weapon_ids=["w1"])]
    doc = {"entries": [ban("attachments", item_id="w1", name="Blitz 9", attachments=[
        {"item_id": "a1", "name": TRICKY}, {"item_id": "a2", "name": f"{TRICKY} 2", "modes": ["x"], "mode_labels": [TRICKY]}])]}
    data = loadout_bans.allowed_block(categories, items, doc)
    assert weapon(data, "Sturmgewehr", "Blitz 9")["attachments"]["banned"] == [TRICKY], "Daten sind Klartext"
    for variant in ("markdown", "text"):
        shown = loadout_bans.render_block(data, variant)
        assert "[Klick](https://" not in shown and "**fett**" not in shown and "\\" not in shown
        assert f"außer: {TRICKY.replace('|', '/')}, {TRICKY.replace('|', '/')} 2 (nicht in {TRICKY.replace('|', '/')})" in \
            markdown_text.plain(shown)
    for line in loadout_bans.render_block(data, "text").splitlines():
        assert "<a " not in pdf_service.pdf_rules_inline(line) and "<b>fett" not in pdf_service.pdf_rules_inline(line)
