"""Regelwerk (docs/LIGA.md, #1646): Abschnitte, Anker und Vergleich - reine Textlogik ohne Datenbank."""
from services import league_rules_text as text


def sections(body, annexes=(), **kwargs):
    return text.sections_of(body, list(annexes), **kwargs)


def anchors(rows):
    return [row["anchor"] for row in rows]


# ---------------------------------------------------------------- Abschnitte und Anker

def test_each_heading_starts_a_section_with_a_stable_anchor():
    rows = sections("Vorwort\n\n# § 1 Spielbetrieb\nText eins\n\n## 1.1 Größe der Teams\nText zwei\n\n### Details\nDrei")
    assert anchors(rows) == ["einleitung", "1-spielbetrieb", "1-1-groesse-der-teams", "details"]
    assert [row["level"] for row in rows] == [0, 1, 2, 3]
    assert rows[1]["title"] == "§ 1 Spielbetrieb"
    assert rows[1]["body_md"].strip() == "Text eins"
    assert rows[0]["title"] is None


def test_the_anchor_stays_when_only_the_text_changes():
    before = sections("# Fairplay\nAlt")
    after = sections("# Vorher\nNeu\n\n# Fairplay\nNeu und länger")
    assert before[0]["anchor"] in anchors(after)


def test_duplicate_headings_count_up():
    rows = sections("# Ablauf\nA\n\n# Ablauf\nB\n\n# Ablauf\nC")
    assert anchors(rows) == ["ablauf", "ablauf-2", "ablauf-3"]


def test_a_heading_without_letters_still_gets_an_anchor():
    assert anchors(sections("# §§§\nA\n\n# ???\nB")) == ["abschnitt", "abschnitt-2"]


def test_a_heading_inside_a_code_block_is_no_section():
    rows = sections("# Echt\n```\n# kein Abschnitt\n```\nDanach")
    assert anchors(rows) == ["echt"]
    assert "# kein Abschnitt" in rows[0]["body_md"]


def test_annexes_are_own_sections_with_letters_and_prefixed_anchors():
    rows = sections("# Regeln\nText", [
        {"key": "A", "title": "Map-Pool", "body_md": "Vorspann\n\n## Maps\nListe\n\n## Ablauf\nMehr"},
        {"key": "B", "title": "Strafen", "body_md": "Katalog"},
    ])
    assert anchors(rows) == ["regeln", "anlage-a", "anlage-a-maps", "anlage-a-ablauf", "anlage-b"]
    assert rows[1]["title"] == "Anlage A: Map-Pool"
    assert rows[1]["kind"] == "annex" and rows[0]["kind"] == "main"
    assert rows[1]["body_md"].strip() == "Vorspann"
    assert rows[2]["level"] == 2


def test_a_long_word_does_not_break_the_anchor():
    rows = sections("# " + "Donaudampfschifffahrt" * 20 + "\nA")
    assert len(rows[0]["anchor"]) <= text.ANCHOR_MAX


def test_empty_text_has_no_sections():
    assert sections("") == []
    assert sections("   \n\n") == []


# ---------------------------------------------------------------- Bausteine im Text

def test_block_tokens_are_found_and_replaced():
    body = "Vor [[baustein:map_pool]] und [[ baustein : mode_order ]] und [[baustein:map_pool]]"
    assert text.block_keys(body) == ["map_pool", "mode_order"]
    filled = text.fill_blocks(body, {"map_pool": "| Pool |", "mode_order": "1. Flagge"})
    assert "| Pool |" in filled and "1. Flagge" in filled and "baustein" not in filled
    assert "\n\n| Pool |\n\n" in filled, "ein Baustein steht als eigener Block"


def test_an_unfilled_block_stays_visible_as_a_hint():
    assert "nicht festgehalten" in text.fill_blocks("[[baustein:map_pool]]", {}, missing="*Hier nicht festgehalten.*")


def test_other_double_brackets_stay_untouched():
    assert text.block_keys("[[event:cup]] und [[turnier:x]]") == []
    assert text.fill_blocks("[[event:cup]]", {}) == "[[event:cup]]"


# ---------------------------------------------------------------- Vergleich

def test_compare_finds_new_changed_and_removed_sections():
    base = sections("# Bleibt\nGleich\n\n# Geändert\nAlter Text\n\n# Weg\nNiemand braucht das mehr hier")
    target = sections("# Bleibt\nGleich\n\n# Geändert\nNeuer Text\n\n# Dazu\nGanz etwas anderes steht jetzt da")
    result = text.compare(base, target)
    assert [row["anchor"] for row in result["changed"]] == ["geaendert"]
    assert [row["anchor"] for row in result["new"]] == ["dazu"]
    assert [row["title"] for row in result["removed"]] == ["Weg"]
    assert result["marks"] == {"geaendert": "changed", "dazu": "new"}


def test_compare_ignores_changes_in_white_space_only():
    result = text.compare(sections("# A\nEin Satz  mit\nLücken"), sections("# A\n\nEin Satz mit Lücken\n"))
    assert result["marks"] == {} and not result["removed"]


def test_a_renamed_heading_with_the_same_text_counts_as_changed_not_as_new_and_removed():
    body = "Ein längerer Absatz, der sich beim Umbenennen der Überschrift gar nicht ändert und so erkennbar bleibt."
    result = text.compare(sections(f"# Alter Name\n{body}"), sections(f"# Neuer Name\n{body}"))
    assert [row["anchor"] for row in result["changed"]] == ["neuer-name"]
    assert result["changed"][0]["previous_anchor"] == "alter-name"
    assert result["new"] == [] and result["removed"] == []


def test_compare_without_a_base_marks_nothing():
    assert text.compare(None, sections("# A\nB")) == {"new": [], "changed": [], "removed": [], "marks": {}}


def _joined(ops, *kinds):
    return "".join(row["text"] for row in ops if row["op"] in kinds)


def test_word_ops_rebuild_both_texts_and_show_removed_words():
    ops = text.word_ops("Ein Spiel dauert 20 Minuten pro Map.", "Ein Spiel dauert 25 Minuten je Map.")
    assert _joined(ops, "eq", "del") == "Ein Spiel dauert 20 Minuten pro Map."
    assert _joined(ops, "eq", "ins") == "Ein Spiel dauert 25 Minuten je Map."
    assert {row["text"] for row in ops if row["op"] == "del"} == {"20", "pro"}
    assert {row["text"] for row in ops if row["op"] == "ins"} == {"25", "je"}


def test_word_ops_stay_correct_for_very_long_texts():
    base = "\n".join(f"Zeile {index} mit einem Wort" for index in range(4000))
    target = base.replace("Zeile 2000 mit", "Zeile 2000 ohne")
    ops = text.word_ops(base, target)
    assert _joined(ops, "eq", "del") == base
    assert _joined(ops, "eq", "ins") == target
    assert _joined(ops, "del") == "mit"


def test_diff_view_lists_every_changed_section_with_its_words():
    base = sections("# Bleibt\nGleich\n\n# Anders\nAlt\n\n# Weg\nWeg ist dieser ganze lange Abschnitt")
    target = sections("# Bleibt\nGleich\n\n# Anders\nNeu\n\n# Dazu\nKomplett anderer Inhalt in diesem Abschnitt")
    rows = {row["anchor"]: row for row in text.diff_view(base, target)}
    assert rows["bleibt"]["status"] == "same" and "ops" not in rows["bleibt"]
    assert rows["anders"]["status"] == "changed"
    assert _joined(rows["anders"]["ops"], "del").strip() == "Alt"
    assert _joined(rows["anders"]["ops"], "ins").strip() == "Neu"
    assert rows["dazu"]["status"] == "new" and _joined(rows["dazu"]["ops"], "ins").startswith("Komplett")
    assert rows["weg"]["status"] == "removed" and _joined(rows["weg"]["ops"], "del").startswith("Weg ist")
    assert [row["anchor"] for row in text.diff_view(base, target)][-1] == "weg", "Entferntes steht am Ende"
