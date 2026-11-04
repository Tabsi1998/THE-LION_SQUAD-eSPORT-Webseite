"""Sperrliste im Regelwerk (docs/LIGA.md, C.4 #2218): Baustein ``[[baustein:loadout_bans]]`` mit Bildern im Web und als saubere Liste
im PDF, eingefroren je Fassung, Vorschlag einer neuen Fassung mit markierten Unterschieden, Bilder unveränderlich in der Mediathek.
Erfundene Namen.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_rules_world import make_world, publish, season_page, season_scope  # noqa: E402
from league_start_world import ok  # noqa: E402
from loadout_world import IMAGE, PERK_IMAGE, add_library, attachments, bans_url, item, save_bans, standard  # noqa: E402

BODY = "Vorwort.\n\n# § 1 Fairplay\nFair spielen.\n"
ANNEX = [{"title": "Sperrliste", "body_md": "[[baustein:loadout_bans]]"}]


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def ready(flow) -> dict:
    w = await make_world(flow)
    await add_library(flow, w)
    return w


def annex_body(page: dict) -> str:
    return next(row["body_md"] for row in page["sections"] if row["anchor"] == "anlage-a")


SPECIAL = "Schild [Test] *x* (neu) \\pfad"


def texts(value) -> list[str]:
    """Alle Zeichenketten in einer Antwort oder einem Datensatz (Schlüssel und Werte, auch verschachtelt)."""
    if isinstance(value, dict):
        return [text for key, item in value.items() for text in [str(key), *texts(item)]]
    if isinstance(value, (list, tuple)):
        return [text for item in value for text in texts(item)]
    return [value] if isinstance(value, str) else []


def protected(value) -> bool:
    """Steht irgendwo ein Schutzzeichen aus dem privaten Unicode-Bereich (nur Darstellungs-Zwischenformat, #2218)?"""
    return any(0xE000 <= ord(char) <= 0xF8FF for text in texts(value) for char in text)


def contains(value, needle: str) -> bool:
    return any(needle in text for text in texts(value))


@pytest.mark.asyncio
async def test_stored_versions_and_api_fields_carry_plain_text(flow):
    """Folge-Review C.4: Schutzzeichen nur beim Darstellen - gespeicherte Fassung, Antwort des Veröffentlichens, „Daten geändert“, Vergleich
    und PDF tragen Klartext bzw. strukturierte Werte."""
    import pymupdf

    w = await ready(flow)
    flow.act_as(w["lead"])
    special = ok(await flow.post(w["library_url"], json={"category": w["cats"]["Perks"], "name": SPECIAL}))
    # Erlaubte Ausrüstung (Nr. 99): Der Schild steht erst als erlaubt im Regelwerk, dann wird er gesperrt.
    ok(await save_bans(flow, w, standard(w)))
    first = await publish(flow, w, body=BODY, annexes=ANNEX)
    assert not protected(first) and contains(first["frozen"], SPECIAL)
    stored = await flow.db.league_rules.find_one({"id": first["id"]}, {"_id": 0})
    assert not protected(stored)

    ok(await save_bans(flow, w, [*standard(w), {"item_id": special["id"], "kind": "item", "modes": []}]))
    changes = ok(await flow.get(season_scope(w)))["data_changes"]
    row = next(row for row in changes["rows"] if row["block"] == "loadout_bans")
    assert not protected(changes) and SPECIAL in row["before"] and SPECIAL not in row["after"]

    prepared = ok(await flow.post(f"{season_scope(w)}/draft/from-version", json={}))
    second = await publish(flow, w, body=prepared["body_md"], annexes=prepared["annexes"], reason="Ohne den Schild")
    assert not protected(second)
    flow.act_as(None)
    diff = ok(await flow.get(f"{season_page(w)}/compare?base={first['id']}&target={second['id']}"))
    assert not protected(diff) and contains(diff, "Schild [Test] *x* (neu)")
    pdf = await flow.get(f"{season_page(w)}/versions/{first['id']}/pdf")
    words = "\n".join(sheet.get_text() for sheet in pymupdf.open(stream=pdf.content, filetype="pdf"))
    assert SPECIAL in words and not protected(words)


@pytest.mark.asyncio
async def test_a_version_frozen_with_protection_characters_reads_as_plain_text(flow):
    """Altbestand aus der Zeit nach dem Merge von #2272 (Schutzzeichen in ``frozen``): wird beim Lesen zurückgewandelt, keine Migration."""
    from services import markdown_text

    w = await ready(flow)
    ok(await save_bans(flow, w, standard(w)))
    first = await publish(flow, w, body=BODY, annexes=ANNEX)
    name = markdown_text.text_cell("Altname [x]")
    await flow.db.league_rules.update_one({"id": first["id"]}, {"$set": {f"frozen.{w['season']['id']}.loadout_bans": {
        "label": "Sperrliste", "source": {}, "markdown": f"- {name}", "text": f"- {name}"}}})
    ok(await save_bans(flow, w, standard(w)[:1]))
    changes = ok(await flow.get(season_scope(w)))["data_changes"]
    assert not protected(changes) and contains(changes, "Altname [x]")
    flow.act_as(None)
    pdf = await flow.get(f"{season_page(w)}/versions/{first['id']}/pdf")
    words = "\n".join(sheet.get_text() for sheet in __import__("pymupdf").open(stream=pdf.content, filetype="pdf"))
    assert "Altname [x]" in words and not protected(words)


def escaped(name: str) -> str:
    """So steht ein Name im ausgelieferten Markdown: jedes Markdown-Steuerzeichen mit Backslash (Folge-Review #2218)."""
    return "".join(f"\\{char}" if char in "\\`*_[]()!~+" else char for char in name)


@pytest.mark.asyncio
async def test_the_public_page_and_the_preview_deliver_no_protection_characters(flow):
    """Folge-Review #2218: Auch ``sections[].body_md`` der öffentlichen Seite und der Vorschau trägt keine Schutzzeichen. Namen im Baustein
    kommen mit Markdown-Backslash-Escapes, ein Backslash im frei geschriebenen Text verdoppelt - so zeigt das Web beides, wie geschrieben.
    Ein eingegebenes Schutzzeichen im freien Text fällt weg."""
    w = await ready(flow)
    flow.act_as(w["lead"])
    ok(await flow.post(w["library_url"], json={"category": w["cats"]["Perks"], "name": SPECIAL}))
    ok(await save_bans(flow, w, standard(w)))
    # Optional-Fund: Ein eingegebenes Schutzzeichen im Namen wird nicht gespeichert.
    cloak = ok(await flow.post(w["library_url"], json={"category": w["cats"]["Perks"], "name": "Mantel", "note": "ab"}))
    assert cloak["name"] == "Mantel" and cloak["note"] == "ab"
    body = "Vorwort mit C:\\Daten und \\_frei\\_ \ue000\ue003.\n\n# § 1 Fairplay\nFair spielen.\n"
    preview = ok(await flow.post(f"{season_scope(w)}/preview", json={"title": "A", "body_md": body, "annexes": ANNEX}))
    assert not protected(preview) and contains(preview, escaped(SPECIAL))
    assert contains(preview, "Vorwort mit C:\\\\Daten und \\\\_frei\\\\_ .")
    version = await publish(flow, w, body=body, annexes=ANNEX)
    flow.act_as(None)
    for page in (ok(await flow.get(season_page(w))), ok(await flow.get(f"{season_page(w)}?version={version['id']}"))):
        assert not protected(page) and escaped(SPECIAL) in annex_body(page)
        assert page["sections"][0]["body_md"] == "Vorwort mit C:\\\\Daten und \\\\_frei\\\\_ ."


@pytest.mark.asyncio
async def test_an_old_version_with_protection_characters_is_delivered_without_them(flow):
    """Altbestand mit Schutzzeichen in ``frozen`` (nach #2272): die öffentliche Seite liefert ihn mit Backslash-Escapes aus."""
    from services import markdown_text

    w = await ready(flow)
    ok(await save_bans(flow, w, standard(w)))
    first = await publish(flow, w, body=BODY, annexes=ANNEX)
    name = markdown_text.text_cell("Altname [x]")
    await flow.db.league_rules.update_one({"id": first["id"]}, {"$set": {f"frozen.{w['season']['id']}.loadout_bans": {
        "label": "Sperrliste", "source": {}, "markdown": f"- {name}", "text": f"- {name}"}}})
    flow.act_as(None)
    page = ok(await flow.get(season_page(w)))
    assert not protected(page) and annex_body(page) == "- Altname \\[x\\]"


@pytest.mark.asyncio
async def test_the_block_shows_images_on_the_web_and_a_clean_list_in_the_pdf(flow):
    w = await ready(flow)
    ok(await save_bans(flow, w, standard(w)))
    version = await publish(flow, w, body=BODY, annexes=ANNEX)
    from services import league_rule_blocks

    frozen = version["frozen"][w["season"]["id"]]["loadout_bans"]
    # Eingefroren wird strukturiert im Klartext; Markdown entsteht erst beim Darstellen (Folge-Review #2218). Gezeigt wird, was
    # erlaubt ist (Nr. 99): Blitz 9 ist ganz gesperrt und fehlt, Leise Sohlen ist erlaubt außer in „Suchen“.
    assert "markdown" not in frozen and frozen["data"]["layout"] == 3
    perks = frozen["data"]["categories"][-1]["sections"][0]["entries"]
    assert perks == [{"name": "Leise Sohlen", "image_url": PERK_IMAGE, "not_in": ["Suchen"], "not_at": []}]
    web, pdf_text = (league_rule_blocks.plain_value("loadout_bans", frozen, variant) for variant in ("markdown", "text"))
    assert f"- ![Ausrüstung]({PERK_IMAGE}) ++Leise Sohlen++ *nicht in Suchen*" in web and "Blitz 9" not in web
    assert "![" not in pdf_text and "| Perks | – | Leise Sohlen | nicht in Suchen |" in pdf_text
    # Nr. 81 (Codex Runde 1): Griff und Lauf passen nur zu Blitz 9 (gesperrt) und Donner 4 (dort gesperrt), Rotpunkt nur zu Blitz 9,
    # der Kompensator zu keiner Waffe - keiner davon ist erlaubt.
    assert "Aufsätze" not in pdf_text and "Griff" not in pdf_text
    assert frozen["source"]["loadout_ban_version"] == 1
    assert PERK_IMAGE in version["frozen_images"] and IMAGE not in version["frozen_images"]

    flow.act_as(None)
    page = ok(await flow.get(season_page(w)))
    assert f"![Ausrüstung]({PERK_IMAGE})" in annex_body(page) and "**Waffen**" in annex_body(page)

    from services import league_rules

    league = await flow.db.leagues.find_one({"id": w["league"]["id"]}, {"_id": 0})
    season = await flow.db.league_seasons.find_one({"id": w["season"]["id"]}, {"_id": 0})
    stored = await flow.db.league_rules.find_one({"id": version["id"]}, {"_id": 0})
    document = league_rules._pdf_document(league, season, stored, None, False)
    annex = next(row["body_md"] for row in document["sections"] if row["anchor"] == "anlage-a")
    assert "![" not in annex and "| Kategorie | Unterkategorie | Erlaubt | Einschränkungen |" in annex and "Donner 4" in annex
    pdf = await flow.get(f"{season_page(w)}/versions/{version['id']}/pdf")
    assert pdf.status_code == 200 and pdf.headers["content-type"].startswith("application/pdf")


@pytest.mark.asyncio
async def test_without_a_list_the_block_says_everything_is_allowed(flow):
    w = await ready(flow)
    version = await publish(flow, w, body=BODY, annexes=ANNEX)
    from services import league_rule_blocks

    frozen = version["frozen"][w["season"]["id"]]["loadout_bans"]
    # Mit Bibliothek (Nr. 99): die ganze aktive Ausrüstung als erlaubt.
    assert frozen["data"]["list"] is False and frozen["data"]["layout"] == 3
    assert "nichts gesperrt" in league_rule_blocks.value("loadout_bans", frozen)
    assert "| Waffen | – | alle: Blitz 9, Donner 4 | – |" in league_rule_blocks.plain_value("loadout_bans", frozen, "text")
    assert version["frozen_images"] == [IMAGE, PERK_IMAGE]


@pytest.mark.asyncio
async def test_without_a_library_the_block_keeps_the_old_sentence(flow):
    w = await make_world(flow)
    version = await publish(flow, w, body=BODY, annexes=ANNEX)
    from services import league_rule_blocks

    frozen = version["frozen"][w["season"]["id"]]["loadout_bans"]
    assert frozen["data"] == {"list": False, "groups": [], "weapons": []}
    assert "keine Sperrliste" in league_rule_blocks.value("loadout_bans", frozen)
    assert version["frozen_images"] == []


@pytest.mark.asyncio
async def test_the_word_diffs_show_names_with_special_characters_as_written(flow):
    """„Daten geändert“ und der Vergleich zweier Fassungen zeigen Namen so, wie sie eingegeben sind - ohne Schutzzeichen (Review C.4)."""
    w = await ready(flow)
    ok(await save_bans(flow, w, standard(w)))
    first = await publish(flow, w, body=BODY, annexes=ANNEX)
    flow.act_as(w["lead"])
    # Ein neuer aktiver Eintrag ist erlaubt (Nr. 99) - der Baustein ändert sich.
    ok(await flow.post(w["library_url"], json={"category": w["cats"]["Perks"], "name": "Schild [Test] *x* (neu)"}))
    row = next(row for row in ok(await flow.get(season_scope(w)))["data_changes"]["rows"] if row["block"] == "loadout_bans")
    inserted = "".join(op["text"] for op in row["ops"] if op["op"] == "ins")
    assert "Schild [Test] *x* (neu)" in inserted
    assert not any(0xE000 <= ord(char) < 0xF8FF or char == "\\" for op in row["ops"] for char in op["text"])

    prepared = ok(await flow.post(f"{season_scope(w)}/draft/from-version", json={}))
    second = await publish(flow, w, body=prepared["body_md"], annexes=prepared["annexes"], reason="Neue Sperrliste")
    flow.act_as(None)
    diff = ok(await flow.get(f"{season_page(w)}/compare?base={first['id']}&target={second['id']}"))
    shown = str(diff["sections"])
    assert "Schild [Test] *x* (neu)" in shown
    assert not any(0xE000 <= ord(char) < 0xF8FF for char in shown)


@pytest.mark.asyncio
async def test_a_changed_list_suggests_a_new_version_and_each_version_keeps_its_list(flow):
    w = await ready(flow)
    ok(await save_bans(flow, w, standard(w)))
    first = await publish(flow, w, body=BODY, annexes=ANNEX)
    view = ok(await flow.get(bans_url(w)))
    assert view["rules"] == {"uses_block": True, "outdated": False, "version": 1,
                             "admin_url": f"/admin/leagues/rules/league_season/{w['season']['id']}"}

    saved = ok(await save_bans(flow, w, [item(w, "Blitz 9", ["stellung"]), attachments(w, "Donner 4", ["Lauf"]), item(w, "Rotpunkt")]))
    assert saved["rules"]["outdated"] is True
    changes = ok(await flow.get(season_scope(w)))["data_changes"]
    row = next(row for row in changes["rows"] if row["block"] == "loadout_bans")
    assert row["status"] == "changed" and changes["version_id"] == first["id"]
    # Blitz 9 ist jetzt nur noch in „Stellung“ gesperrt und steht als erlaubt da (Nr. 99).
    assert "Blitz 9" in row["after"] and "Blitz 9" not in row["before"]
    assert any(op["op"] == "ins" and "Blitz 9" in op["text"] for op in row["ops"])
    assert not any("![" in op["text"] for op in row["ops"]), "markiert wird ohne Bild-Markdown"
    assert await flow.db.league_rules.count_documents({"status": "published"}) == 1, "nichts veröffentlicht sich selbst"

    prepared = ok(await flow.post(f"{season_scope(w)}/draft/from-version", json={}))
    second = await publish(flow, w, body=prepared["body_md"], annexes=prepared["annexes"], reason="Neue Sperrliste", requires_consent=True)
    assert second["requires_consent"] is True and "Blitz 9" in str(second["frozen"][w["season"]["id"]]["loadout_bans"]["data"])
    assert ok(await flow.get(bans_url(w)))["rules"]["outdated"] is False

    flow.act_as(None)
    old = ok(await flow.get(f"{season_page(w)}?version={first['id']}"))
    assert "Blitz 9" not in annex_body(old) and "Leise Sohlen" in annex_body(old)
    diff = ok(await flow.get(f"{season_page(w)}/compare?base={first['id']}&target={second['id']}"))
    assert "![" not in str(diff["sections"])


@pytest.mark.asyncio
async def test_a_season_without_the_block_gets_no_hint(flow):
    w = await ready(flow)
    await publish(flow, w, body=BODY, annexes=[])
    ok(await save_bans(flow, w, standard(w)))
    assert ok(await flow.get(bans_url(w)))["rules"]["uses_block"] is False
    assert ok(await flow.get(season_scope(w)))["data_changes"] is None


@pytest.mark.asyncio
async def test_the_media_library_keeps_images_of_a_published_list_unchanged(flow):
    from services import media_audit

    w = await ready(flow)
    ok(await save_bans(flow, w, standard(w)))
    # Schon die gespeicherte Version der Sperrliste ist unveränderlich, danach auch die Fassung des Regelwerks - sie zeigt die erlaubten
    # Einträge (Nr. 99): Leise Sohlen ist erlaubt (außer in „Suchen“), Blitz 9 gesperrt.
    assert await media_audit.frozen_usages(flow.db, "sohlen-2.png") == ["Sperrliste, Version 1"]
    assert await media_audit.still_referenced(flow.db, {"blitz-1.webp"}) == {"blitz-1.webp"}
    await publish(flow, w, body=BODY, annexes=ANNEX)
    assert await media_audit.frozen_usages(flow.db, "sohlen-2.png") == ["Regelwerk, Version 1", "Sperrliste, Version 1"]
    assert await media_audit.frozen_usages(flow.db, "blitz-1.webp") == ["Sperrliste, Version 1"]
    places = {(collection, field) async for collection, _doc, field, _name, _text in media_audit.iter_usages(flow.db, {"sohlen-2.png"})}
    assert {("game_equipment", "image_url"), ("loadout_bans", "entries.image_url"), ("league_rules", "frozen_images")} <= places
