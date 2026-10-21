"""Teams aus den Spielen den Zeilen der Tabelle laut Veranstalter zuordnen (Prüfung #1931).

Hat ein Spieltag die Tabelle des Veranstalters (``official_table``), ist sie für Teams und Plätze maßgeblich. Die Spiele
desselben Spieltags schreiben ein Team aber manchmal anders („Gegner B e.V.“ statt „Gegner B“). ``align_to_table`` sagt,
zu welcher Tabellenzeile ein Name aus den Spielen gehört:

1. wörtlich gleich (ohne Groß/klein und doppelte Leerzeichen) - diese Zeile;
2. derselbe Schlüssel (``series_identity.normalize_name``: ohne Akzente, Leer- und Satzzeichen), und nur eine Zeile hat
   ihn - diese Zeile;
3. ein Schlüssel ist der Anfang des anderen (mindestens ``MIN_PREFIX`` Zeichen), und das trifft auf genau eine Zeile zu
   - diese Zeile („Gegner B e.V.“ → „Gegner B“).

Alles andere ist unklar: der Name bekommt keine eigene Zeile, die Prüfung des Ergebnisblatts nennt ihn. Eigene Teams
sind vorher schon über Name und Alias auf ihren Namen gebracht (``own_teams.Matcher``). Ohne Datenbank, ohne andere
Module außer ``series_identity`` - Stand und Prüfung nutzen es beide.
"""
from __future__ import annotations

from services.series_identity import normalize_name

MIN_PREFIX = 4


def _clean(value) -> str:
    return " ".join(str(value or "").split())


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
    prefix = [team for team in table if min(len(key), len(normalize_name(team))) >= MIN_PREFIX
              and (key.startswith(normalize_name(team)) or normalize_name(team).startswith(key))]
    return prefix[0] if len(prefix) == 1 else None


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
