"""Teams aus den Spielen den Zeilen der Tabelle laut Veranstalter zuordnen (Prüfung #1931).

Hat ein Spieltag die Tabelle des Veranstalters (``official_table``), ist sie für Teams und Plätze maßgeblich. Die Spiele
desselben Spieltags schreiben ein Team aber manchmal anders („Gegner B e.V.“ statt „Gegner B“). ``align_to_table`` sagt,
zu welcher Tabellenzeile ein Name aus den Spielen gehört:

1. wörtlich gleich (ohne Groß/klein und doppelte Leerzeichen) - diese Zeile;
2. derselbe Schlüssel (``series_identity.normalize_name``: ohne Akzente, Leer- und Satzzeichen), und nur eine Zeile hat
   ihn - diese Zeile;
3. ein Name beginnt mit allen **ganzen Wörtern** des anderen, und der Rest sind nur Zusätze (``ADDITIONS``: Rechtsform
   wie „e.V.“ oder „GmbH“, „eSports“, „Gaming“; ein Kürzel in Klammern wie „(TLS)“ zählt immer als Zusatz) - in beide
   Richtungen, und das trifft auf genau eine Zeile zu. „Gegner B e.V.“ passt zu „Gegner B“ (und umgekehrt), „Team A“
   nicht zu „Team Alpha“, „Probe Adler Nord“ nicht zu „Probe Adler“.

Alles andere ist unklar: der Name bekommt keine eigene Zeile, die Prüfung des Ergebnisblatts nennt ihn. Eigene Teams
sind vorher schon über Name und Alias auf ihren Namen gebracht (``own_teams.Matcher``). Ohne Datenbank, ohne andere
Module außer ``series_identity`` - Stand und Prüfung nutzen es beide.
"""
from __future__ import annotations

from services.series_identity import normalize_name

# Zusätze hinter einem Teamnamen, die kein anderes Team machen - als Schlüssel wie ``normalize_name`` („e. V.“ → „ev“,
# „E-Sports“ → „esports“). Längere zuerst, damit „esports“ nicht als „esport“ + „s“ gelesen wird.
ADDITIONS = ("esports", "esport", "gaming", "gmbh", "ev", "ug")
OPENING, CLOSING = "([", ")]"


def _clean(value) -> str:
    return " ".join(str(value or "").split())


def _words(name: str) -> list[str]:
    """Die Wörter eines Namens als Schlüssel - ohne alles in Klammern (ein Kürzel dort ist immer ein Zusatz)."""
    outside, depth = [], 0
    for char in name:
        if char in OPENING:
            depth += 1
            outside.append(" ")
        elif char in CLOSING and depth:
            depth -= 1
            outside.append(" ")
        elif not depth:
            outside.append(char)
    return [key for key in (normalize_name(word) for word in "".join(outside).split()) if key]


def _only_additions(words: list[str]) -> bool:
    rest = "".join(words)
    while rest:
        addition = next((item for item in ADDITIONS if rest.startswith(item)), None)
        if addition is None:
            return False
        rest = rest[len(addition):]
    return True


def _extends(short: list[str], long: list[str]) -> bool:
    """Beginnt ``long`` mit allen ganzen Wörtern von ``short``, und der Rest sind nur Zusätze?"""
    return bool(short) and long[:len(short)] == short and _only_additions(long[len(short):])


def _target(name: str, table: list[str]) -> str | None:
    literal = name.casefold()
    for team in table:
        if team.casefold() == literal:
            return team
    key = normalize_name(name)
    if not key:
        return None
    same = [team for team in table if normalize_name(team) == key]
    if same:
        return same[0] if len(same) == 1 else None
    mine = _words(name)
    fits = [team for team in table if _extends(mine, _words(team)) or _extends(_words(team), mine)]
    return fits[0] if len(fits) == 1 else None


def align_to_table(names, table) -> tuple[dict[str, str], list[str]]:
    """``({Name aus den Spielen: Name in der Tabelle}, [unklare Namen])``. Im Ergebnis stehen nur Namen, die anders
    geschrieben sind als ihre Zeile; die unklaren in der Reihenfolge, in der sie zuerst vorkommen."""
    rows = [_clean(team) for team in table or [] if _clean(team)]
    mapping: dict[str, str] = {}
    unclear: list[str] = []
    seen: set[str] = set()
    for raw in names or []:
        name = _clean(raw)
        if not name or name in seen:
            continue
        seen.add(name)
        target = _target(name, rows)
        if target is None:
            unclear.append(name)
        elif target != name:
            mapping[name] = target
    return mapping, unclear
