"""Regelwerk als PDF (docs/LIGA.md, #1646): Version und Datum auf jeder Seite, Markierung geänderter Abschnitte, Bausteine wie auf der
Seite, reproduzierbar aus der Fassung, Text sicher gesetzt."""
import pytest

from pdf_service import MARK_INK, pdf_league_rules, pdf_rules_inline

pymupdf = pytest.importorskip("pymupdf", reason="pymupdf liest die erzeugten Seiten")

LONG_TEXT = " ".join(f"Satz {index} der Probe-Regeln mit etwas mehr Inhalt." for index in range(900))


def document(**extra) -> dict:
    return {
        "title": "Regelwerk Probe-Liga", "context": "Probe-Liga · Season 1", "version": 3, "label": "Version 3",
        "valid_from": "2030-03-05", "published_at": "2030-03-01T10:00:00+00:00", "change_reason": "Neuer Pool",
        "base_label": "Version 2", "removed": [],
        "sections": [
            {"anchor": "fairplay", "title": "§ 1 Fairplay", "level": 1, "kind": "main", "body_md": "Fair spielen.", "mark": None},
            {"anchor": "maps", "title": "§ 2 Maps", "level": 1, "kind": "main", "mark": "changed",
             "body_md": "| Modus | Maps |\n| --- | --- |\n| Stellung | Hafenkante, Nebelwerk |"},
        ],
        **extra,
    }


def pages_of(data: bytes) -> list:
    return list(pymupdf.open(stream=data, filetype="pdf"))


def text_of(data: bytes) -> str:
    return "\n".join(page.get_text() for page in pages_of(data))


def bars(page) -> list:
    """Die Randstriche: schmale senkrechte Linien in der Farbe der Markierung, links vom Text."""
    wanted = tuple(round(value, 2) for value in MARK_INK.rgb())
    out = []
    for drawing in page.get_drawings():
        color = drawing.get("color")
        if color and tuple(round(value, 2) for value in color) == wanted:
            out.append(drawing)
    return out


def test_every_page_carries_version_and_date():
    data = pdf_league_rules(document(sections=[
        {"anchor": "lang", "title": "Langer Abschnitt", "level": 1, "kind": "main", "body_md": LONG_TEXT, "mark": None}]))
    pages = pages_of(data)
    assert len(pages) > 2
    for page in pages:
        words = page.get_text()
        assert "Version 3" in words and "05.03.2030" in words, page.number


def test_blocks_and_annexes_stand_like_on_the_page():
    data = pdf_league_rules(document(sections=[
        *document()["sections"],
        {"anchor": "anlage-a", "title": "Anlage A: Strafen", "level": 1, "kind": "annex", "body_md": "- Verwarnung\n- Punktabzug", "mark": None}]))
    words = text_of(data)
    assert "Hafenkante, Nebelwerk" in words and "Anlage A: Strafen" in words and "Punktabzug" in words


def test_changed_sections_carry_a_bar_and_a_word_not_only_a_color():
    data = pdf_league_rules(document())
    words = text_of(data)
    assert "Neu in Version 3" in words and "Vergleich mit Version 2" in words
    assert "GEÄNDERT" in words
    assert sum(len(bars(page)) for page in pages_of(data)) >= 1


def test_without_marks_there_is_neither_bar_nor_list():
    source = document(base_label=None)
    source["sections"] = [{**row, "mark": None} for row in source["sections"]]
    data = pdf_league_rules(source)
    words = text_of(data)
    assert "Neu in Version" not in words and "GEÄNDERT" not in words
    assert sum(len(bars(page)) for page in pages_of(data)) == 0


def test_the_bar_follows_a_long_section_over_pages():
    data = pdf_league_rules(document(sections=[
        {"anchor": "lang", "title": "Langer Abschnitt", "level": 1, "kind": "main", "body_md": LONG_TEXT, "mark": "changed"}]))
    pages = pages_of(data)
    assert len(pages) > 2
    assert all(bars(page) for page in pages[1:]), "auch auf Folgeseiten ist der Abschnitt markiert"


def test_removed_sections_are_listed_by_title():
    assert "Alte Regel" in text_of(pdf_league_rules(document(removed=[{"anchor": "alte-regel", "title": "Alte Regel"}])))


def test_the_same_version_gives_the_same_file():
    assert pdf_league_rules(document()) == pdf_league_rules(document()), "reproduzierbar: keine Erzeugungszeit im Inhalt"


def test_html_in_the_text_stays_text():
    data = pdf_league_rules(document(sections=[
        {"anchor": "a", "title": "<b>Titel</b>", "level": 1, "kind": "main", "mark": None,
         "body_md": "<script>alert(1)</script> & <img src=x onerror=y> **fett** [Link](javascript:alert(1))"}]))
    words = text_of(data)
    assert "<script>alert(1)</script>" in words and "<b>Titel</b>" in words
    for page in pages_of(data):
        assert not [link for link in page.get_links() if "javascript" in str(link.get("uri"))]


def test_an_own_upload_on_its_own_line_is_embedded_a_foreign_one_stays_a_hint(tmp_path, monkeypatch):
    import pdf_service
    from PIL import Image

    Image.new("RGB", (40, 20), (10, 20, 30)).save(tmp_path / "plan.png")
    monkeypatch.setattr(pdf_service, "PUBLIC_UPLOAD_DIR", tmp_path)
    monkeypatch.setattr(pdf_service, "UPLOAD_DIR", tmp_path)
    body = ("![Plan](/api/static/uploads/plan.png?v=2)\n\n![Fehlt](/api/static/uploads/gibtsnicht.png)\n\n"
            "![Fremd](https://bilder.example.test/x.png)\n\nText ![Mitten](/api/static/uploads/plan.png) drin")
    data = pdf_league_rules(document(sections=[{"anchor": "a", "title": "A", "level": 1, "kind": "main", "mark": None, "body_md": body}]))
    assert sum(len(page.get_images()) for page in pages_of(data)) >= 1
    words = text_of(data)
    assert "[Bild: Fehlt]" in words and "[Bild: Fremd]" in words and "[Bild: Mitten]" in words and "[Bild: Plan]" not in words


def test_a_broken_upload_stays_a_hint_and_does_not_break_the_file(tmp_path, monkeypatch):
    import pdf_service

    (tmp_path / "kaputt.png").write_bytes(b"kein Bild")
    monkeypatch.setattr(pdf_service, "PUBLIC_UPLOAD_DIR", tmp_path)
    monkeypatch.setattr(pdf_service, "UPLOAD_DIR", tmp_path)
    body = "![Plan](/api/static/uploads/kaputt.png)"
    data = pdf_league_rules(document(sections=[{"anchor": "a", "title": "A", "level": 1, "kind": "main", "mark": None, "body_md": body}]))
    assert "[Bild: Plan]" in text_of(data)


def test_inline_marks_become_only_our_own_tags():
    assert pdf_rules_inline("**fett** *schräg* `code` ~~weg~~ ++unter++") == (
        '<b>fett</b> <i>schräg</i> <font face="Courier">code</font> <strike>weg</strike> <u>unter</u>')
    assert pdf_rules_inline("a <b>c</b> & d") == "a &lt;b&gt;c&lt;/b&gt; &amp; d"
    assert pdf_rules_inline("[Seite](https://example.org/a?b=1&c=2)") == (
        '<a href="https://example.org/a?b=1&amp;c=2" color="#10688A"><u>Seite</u></a>')
    assert pdf_rules_inline("[Bild](javascript:alert)") == "Bild"
    assert pdf_rules_inline("[Sprung](#maps)", anchors={"maps"}) == '<a href="#maps" color="#10688A"><u>Sprung</u></a>'
    assert pdf_rules_inline("[Sprung](#gibtsnicht)", anchors={"maps"}) == "Sprung"
    assert pdf_rules_inline("![Plan](/api/uploads/plan.png)") == "[Bild: Plan]"


@pytest.mark.parametrize("text", ["**a*b**c*", "*a**b*c**", "`a**b`c**", "~~a++b~~c++", "| a **b | c** |\n| --- | --- |\n| *d | e* |", "- **a*b**c*\n> ~~d++e~~f++"])
def test_marks_that_cross_each_other_do_not_break_the_file(text):
    """Im Web verzeiht der Browser überkreuzte Marken, der PDF-Baukasten nicht - dann steht dort der Text ohne Formatierung."""
    data = pdf_league_rules(document(sections=[{"anchor": "a", "title": "Titel", "level": 1, "kind": "main", "mark": "changed", "body_md": text}]))
    assert pages_of(data)
    assert "Titel" in text_of(data)


def test_unusual_characters_and_long_words_do_not_break_the_file():
    word = "Donaudampfschifffahrtsgesellschaft" * 12
    data = pdf_league_rules(document(sections=[
        {"anchor": "a", "title": word, "level": 1, "kind": "main", "mark": "new",
         "body_md": f"{word}\n\n≥ 3 → ✓ 🦁 „Zitat“ – §\n\n```\nCode <x>\n```\n\n> Hinweis\n\n---\n\n1. Eins\n2. Zwei\n\n"
                    f"| {word} | B |\n| --- | --- |\n| {word} | **fett** |"}]))
    assert pages_of(data)
    assert "Zitat" in text_of(data)


def test_a_very_wide_table_stays_on_the_page():
    head = " | ".join(f"Spalte{index}" for index in range(12))
    data = pdf_league_rules(document(sections=[
        {"anchor": "a", "title": "Breit", "level": 1, "kind": "main", "mark": None,
         "body_md": f"| {head} |\n| {' | '.join(['---'] * 12)} |\n| {head} |"}]))
    for page in pages_of(data):
        for block in page.get_text("blocks"):
            assert block[2] <= page.rect.width, block[4]
