"""Wächter (#1307): Der Server schreibt Daten nur über ``services/date_text.py`` - „Sa 23. Mai · 18:00“.

Mails, Discord-Texte, Teilen-Bilder, Kalender-Abo und Meldungen nehmen ``format_moment`` & Co. Das amtliche
„23.05.2026“ bleibt den Dokumenten: Rechnungen, Urkunden, PDF-Listen, CSV-Exporte und dem Regelwerk. Wer sonst ein Datum
mit ``%d.%m`` oder aus ``{tag:02d}.{monat:02d}`` baut, steht hier mit Grund in ``OFFICIAL`` - oder nimmt die Hilfe.
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
}

STRFTIME_DAY = re.compile(r"%d\.%m")
# Tag und Monat aus Platzhaltern: zweistellig („{d:02d}.{m:02d}.“) oder mit Namen („{x.day}.{x.month}.“, „{int(day)}.{int(month)}.“).
HAND_BUILT = re.compile(r"\{[^{}]*:02d\}\.\{[^{}]*:02d\}\.|\{[^{}]*\b(?:day|date_?)\b[^{}]*\}\.\{[^{}]*\bmonth\b[^{}]*\}\.")


def sources():
    for path in sorted(BACKEND.rglob("*.py")):
        rel = path.relative_to(BACKEND).as_posix()
        if rel.startswith(("tests/", "static/")) or "/__pycache__/" in rel:
            continue
        yield rel, path.read_text(encoding="utf-8-sig")


def test_gegenprobe_die_muster_treffen_und_lassen_anderes_in_ruhe():
    for text in ['x.strftime("%d.%m.%Y")', "f\"{local:%d.%m.%Y, %H:%M} Uhr\"", "strftime('%d.%m. %H:%M')"]:
        assert STRFTIME_DAY.search(text), text
    for text in ['f"{value.day:02d}.{value.month:02d}."', 'f"{d.day:02d}.{d.month:02d}.{d.year}"', 'f"{int(day):02d}.{int(month):02d}."', 'f"{moment.day}.{moment.month}.{moment.year}"', 'f"{int(day)}.{int(month)}."']:
        assert HAND_BUILT.search(text), text
    for text in ['x.strftime("%Y-%m-%d")', 'x.strftime("%H:%M")', 'f"{m}:{s:02d}.{mil:03d}"', 'f"{minutes}:{seconds:02d}.{millis:03d}"']:
        assert not STRFTIME_DAY.search(text) and not HAND_BUILT.search(text), text


def test_kein_eigenes_datum_ausserhalb_der_amtlichen_stellen():
    found = [f"{rel}:{number}" for rel, text in sources() if rel not in OFFICIAL
             for number, line in enumerate(text.splitlines(), 1) if STRFTIME_DAY.search(line) or HAND_BUILT.search(line)]
    assert found == [], "services.date_text.format_moment & Co. nehmen - amtlich nur mit Grund in OFFICIAL"


def test_jede_ausnahme_wird_noch_gebraucht():
    texts = dict(sources())
    for rel in OFFICIAL:
        assert rel in texts, f"{rel} gibt es nicht mehr - aus OFFICIAL nehmen"
        text = texts[rel]
        assert STRFTIME_DAY.search(text) or HAND_BUILT.search(text), f"{rel} schreibt kein eigenes Datum mehr - aus OFFICIAL nehmen"
