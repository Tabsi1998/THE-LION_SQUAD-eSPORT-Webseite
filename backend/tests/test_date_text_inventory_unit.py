"""Wächter (#1307): Der Server schreibt Daten nur über ``services/date_text.py`` - „Sa 23. Mai · 18:00“.

Mails, Discord-Texte, Teilen-Bilder, Vorschauen, Kalender-Abo und Meldungen nehmen ``format_moment`` & Co. Das amtliche
„23.05.2026“ bleibt den Dokumenten: Rechnungen, Urkunden, PDF-Listen, CSV-Ausfuhren und dem Regelwerk. Wer sonst ein
Datum selbst baut (``%d.%m``, ``%d. %B``, ``%02d.%02d.``, ``{tag}.{monat}``, ``{x.day}. {MONATE[...]}``), steht hier
mit Grund in ``OFFICIAL`` - oder nimmt die Hilfe. CSV-Ausfuhren, die das amtliche Datum über ``format_official_*``
schreiben, stehen in ``CSV_OFFICIAL``: dort muss es amtlich bleiben, nie die Anzeigeform.
"""
import pathlib
import re

BACKEND = pathlib.Path(__file__).resolve().parents[1]

# Datei -> warum sie selbst ein Datum schreiben darf.
OFFICIAL = {
    "services/date_text.py": "die Hilfe selbst (format_official_date)",
    "pdf_service.py": "Urkunden und PDF-Listen - amtliches Datum",
    "services/billing_facts.py": "Rechnungen - amtliches Datum",
    "routes/finance_routes.py": "Rechnungsliste als CSV für den Kassier - amtliches Datum",
    "routes/admin_routes.py": "Texte, die auch in der CSV-Ausfuhr stehen",
    "services/league_rule_facts.py": "Regelwerk - ein Dokument mit PDF-Fassung, amtliches Datum",
    "services/league_rule_vars.py": "Regelwerk-Platzhalter - wie das Regelwerk selbst",
    "services/team_league_calendar.py": "Meldung zur eingefügten Terminliste - nennt das Datum, wie es getippt wurde",
    "services/reference_calendar.py": "Meldung zur eingefügten Terminliste - nennt das Datum, wie es getippt wurde",
    "services/year_review.py": "Zeitraum aus der Einstellung („15.12. bis 31.01.“) - so, wie er eingetragen wird",
    "routes/mobile_routes.py": "Kurztext für die App („Sa 14.11. 18:30“) - zieht mit dem App-Teil von #1307 um",
    "services/advent_calendar.py": "Advent-Sonderform („am 12. Dezember um 6 Uhr“) - eigenes Folge-Issue #2619",
}

# CSV-Ausfuhren mit amtlichem Datum über die Hilfe (kein eigenes Muster, darum nicht in OFFICIAL).
CSV_OFFICIAL = {
    "services/event_lead.py": "Teilnehmerliste eines Events („Angemeldet am“)",
    "services/moderation_standing.py": "Personen-CSV der Moderation („Chat gesperrt bis“, „Letzter Vorfall“)",
}

MONTH_WORDS = r"(?:Jänner|Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)"
PATTERNS = {
    "strftime mit Tag und Monat": re.compile(r"%-?d[./]\s?%[mbB]|%-?d\.?\s%[bB]"),
    "%-Format „%02d.%02d.“": re.compile(r"%0?2?d\.%0?2?d\."),
    "Tag und Monat aus Platzhaltern": re.compile(
        r"\{[^{}]*:02d\}\.\{[^{}]*:02d\}\.|\{[^{}]*\}\.\s?\{[^{}]*\b(?:month|monat|MONTHS?\w*|MONATE?\w*)\b[^{}]*\}"),
    "Tag mit ausgeschriebenem Monat": re.compile(r"\{[^{}]*\}\.\s" + MONTH_WORDS + r"(?![-\w])"),
    "ISO-Tag umgedreht": re.compile(r"reversed\([^)]*isoformat\(\)|isoformat\(\)[^\n]*\[::-1\]"),
}


def own_form(line: str) -> str | None:
    return next((name for name, pattern in PATTERNS.items() if pattern.search(line)), None)


def sources():
    for path in sorted(BACKEND.rglob("*.py")):
        rel = path.relative_to(BACKEND).as_posix()
        if rel.startswith(("tests/", "static/")) or "/__pycache__/" in rel:
            continue
        yield rel, path.read_text(encoding="utf-8-sig")


def test_gegenprobe_die_muster_treffen_und_lassen_anderes_in_ruhe():
    caught = [
        'x.strftime("%d.%m.%Y")', "f\"{local:%d.%m.%Y, %H:%M} Uhr\"", "strftime('%d.%m. %H:%M')",
        'x.strftime("%d. %B %Y")', 'x.strftime("%d/%m/%Y")', 'return "%02d.%02d.%d" % (d.day, d.month, d.year)',
        'f"{value.day:02d}.{value.month:02d}."', 'f"{d.day:02d}.{d.month:02d}.{d.year}"', 'f"{int(day):02d}.{int(month):02d}."',
        'f"{moment.day}.{moment.month}.{moment.year}"', 'f"{int(day)}.{int(month)}."', 'f"{tag}.{monat}.{jahr}"',
        'return f"{local.day}. {MONTHS_DE[local.month - 1]} {local.year}"', 'f"am {when.day}. Dezember um {when.hour} Uhr"',
        '"-".join(reversed(day.isoformat().split("-")))',
    ]
    for text in caught:
        assert own_form(text), text
    left_alone = [
        'x.strftime("%Y-%m-%d")', 'x.strftime("%H:%M")', 'f"{m}:{s:02d}.{mil:03d}"', 'f"{minutes}:{seconds:02d}.{millis:03d}"',
        'f"{ref.collection}.{ref.field}"', 'f"{rank}. Platz"', 'f"{count}. Spieltag"', 'f"{index}. Mai-Cup"',
    ]
    for text in left_alone:
        assert not own_form(text), text


def test_kein_eigenes_datum_ausserhalb_der_amtlichen_stellen():
    found = [f"{rel}:{number} ({own_form(line)})" for rel, text in sources() if rel not in OFFICIAL
             for number, line in enumerate(text.splitlines(), 1) if own_form(line)]
    assert found == [], "services.date_text.format_moment & Co. nehmen - amtlich nur mit Grund in OFFICIAL"


def test_jede_ausnahme_wird_noch_gebraucht():
    texts = dict(sources())
    for rel in OFFICIAL:
        assert rel in texts, f"{rel} gibt es nicht mehr - aus OFFICIAL nehmen"
        assert any(own_form(line) for line in texts[rel].splitlines()), f"{rel} schreibt kein eigenes Datum mehr - aus OFFICIAL nehmen"


def test_csv_ausfuhren_bleiben_amtlich():
    texts = dict(sources())
    for rel, reason in CSV_OFFICIAL.items():
        assert "format_official_" in texts[rel], f"{rel}: {reason} - amtlich über format_official_date/_moment"
