"""Wächter (#1307): Der Server schreibt Daten nur über ``services/date_text.py`` - „Sa 23. Mai · 18:00“.

Mails, Discord-Texte, Teilen-Bilder, Vorschauen, Kalender-Abo und Meldungen nehmen ``format_moment`` & Co. Das amtliche
„23.05.2026“ bleibt den Dokumenten: Rechnungen, Urkunden, PDF-Listen, CSV-Ausfuhren und dem Regelwerk. Wer sonst ein
Datum selbst baut (``%d.%m``, ``%d. %B``, ``%02d.%02d.``, ``{tag}.{monat}``, ``{x.day}. {MONATE[...]}``), steht hier
mit Grund in ``OFFICIAL`` - oder nimmt die Hilfe. CSV-Ausfuhren, die das amtliche Datum über ``format_official_*``
schreiben, stehen mit ihrer Ausfuhr-Funktion in ``CSV_OFFICIAL``: Diese Funktion ruft - auch über Hilfen derselben Datei -
nie die Anzeigeform. Eine neue CSV-Ausfuhr kommt hierher und bekommt einen Verhaltenstest in ``test_csv_dates_unit.py``.
"""
import ast
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

# CSV-Ausfuhren mit amtlichem Datum über die Hilfe (kein eigenes Muster, darum nicht in OFFICIAL):
# Datei -> (Ausfuhr-Funktion, Grund). Geprüft wird, was die Funktion aufruft - nicht nur, ob die Datei die Hilfe kennt.
CSV_OFFICIAL = {
    "services/event_lead.py": ("export_csv", "Teilnehmerliste eines Events („Angemeldet am“)"),
    "services/moderation_standing.py": ("export_csv", "Personen-CSV der Moderation („Chat gesperrt bis“, „Letzter Vorfall“)"),
}
# Die Anzeigeform - in einer CSV-Ausfuhr nie.
DISPLAY_FORMS = {"format_moment", "format_when", "format_date", "format_range", "format_ago", "format_clock"}

MONTH_WORDS = r"(?:Jänner|Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)"
PATTERNS = {
    "strftime mit Tag und Monat": re.compile(r"%-?d[./]\s?%-?[mbB]|%-?d\.?\s%-?[bB]"),
    "str.format mit Tag und Monat": re.compile(
        r"""["']\{[^{}]*\}\.\{[^{}]*\}\.(?:\{[^{}]*\})?["']\s*\.format\([^)]*\b(?:day|month|tag|monat)\b"""),
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
        # Nachprüfung: ohne führende Null und über str.format.
        'x.strftime("%-d.%-m.%Y")', 'x.strftime("%-d. %-B")', '"{}.{}.{}".format(d.day, d.month, d.year)',
        "'{}.{}.'.format(moment.day, moment.month)",
    ]
    for text in caught:
        assert own_form(text), text
    left_alone = [
        'x.strftime("%Y-%m-%d")', 'x.strftime("%H:%M")', 'f"{m}:{s:02d}.{mil:03d}"', 'f"{minutes}:{seconds:02d}.{millis:03d}"',
        'f"{ref.collection}.{ref.field}"', 'f"{rank}. Platz"', 'f"{count}. Spieltag"', 'f"{index}. Mai-Cup"',
        '"{}.{}.{}".format(major, minor, patch)', '"{}.{}".format(collection, field)',
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


def csv_calls(source: str, function: str) -> set[str]:
    """Alles, was ``function`` aufruft - auch über Hilfen derselben Datei (``export_csv`` -> ``_fmt`` -> ``format_moment``)
    und über Import-Namen (``format_moment as fm``)."""
    tree = ast.parse(source)
    aliases = {alias.asname or alias.name: alias.name for node in ast.walk(tree) if isinstance(node, ast.ImportFrom)
               for alias in node.names}
    functions = {node.name: node for node in ast.walk(tree) if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))}
    calls: set[str] = set()
    seen: set[str] = set()
    todo = [function]
    while todo:
        name = todo.pop()
        if name in seen or name not in functions:
            continue
        seen.add(name)
        for node in ast.walk(functions[name]):
            if isinstance(node, ast.Call):
                func = node.func
                called = func.id if isinstance(func, ast.Name) else func.attr if isinstance(func, ast.Attribute) else None
                if called:
                    calls.add(aliases.get(called, called))
                    todo.append(called)
    return calls


def csv_display_forms(source: str, function: str) -> set[str]:
    return csv_calls(source, function) & DISPLAY_FORMS


def test_gegenprobe_csv_ausfuhr():
    over_helper = (
        "from services.date_text import format_moment\n"
        "def _fmt(value):\n    return format_moment(value)\n"
        "def export_csv(rows):\n    return [_fmt(row['at']) for row in rows]\n"
        "def _csv_moment(value):\n    from services.date_text import format_official_moment\n    return format_official_moment(value)\n"
    )
    assert csv_display_forms(over_helper, "export_csv") == {"format_moment"}
    aliased = "from services.date_text import format_when as fw\nasync def export_csv(rows):\n    return fw(rows[0])\n"
    assert csv_display_forms(aliased, "export_csv") == {"format_when"}
    official = over_helper.replace("[_fmt(row['at'])", "[_csv_moment(row['at'])")
    assert csv_display_forms(official, "export_csv") == set()
    assert "format_official_moment" in csv_calls(official, "export_csv")


def test_csv_ausfuhren_bleiben_amtlich():
    """Die Ausfuhr-Funktion selbst (und was sie in der Datei aufruft) schreibt amtlich - eine Meldung daneben darf die
    Anzeigeform nehmen. Das Verhalten prüft ``test_csv_dates_unit.py``; eine neue CSV-Ausfuhr kommt hierher und dorthin."""
    texts = dict(sources())
    for rel, (function, reason) in CSV_OFFICIAL.items():
        defined = {node.name for node in ast.walk(ast.parse(texts[rel])) if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))}
        assert function in defined, f"{rel}: {function} gibt es nicht mehr - CSV_OFFICIAL anpassen"
        calls = csv_calls(texts[rel], function)
        assert not calls & DISPLAY_FORMS, f"{rel}: {reason} - {function} nimmt die Anzeigeform {sorted(calls & DISPLAY_FORMS)}"
        assert any(name.startswith("format_official_") for name in calls), f"{rel}: {reason} - amtlich über format_official_*"
