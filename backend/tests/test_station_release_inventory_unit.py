"""Wächter (#2386): Jede Funktion, die Spiele löscht, gibt auch deren Stationen frei.

Sonst hängt eine Station als „belegt“ ohne Spiel, bis die Leitung sie über „Station räumen“ freigibt. Der Test liest den
Quelltext unter ``routes/`` und ``services/``: Wer ``matches_v2.delete_many`` aufruft, ruft in derselben Funktion
``free_stations_of_deleted_matches`` auf - oder steht unten mit Grund in der Ausnahmeliste.
"""
from __future__ import annotations

import ast
import pathlib

BACKEND = pathlib.Path(__file__).resolve().parents[1]

# (Datei, Funktion) -> Grund. Nur Wege, auf denen keine Station ein gelöschtes Spiel halten kann.
EXEMPT = {
    ("routes/tournament_format_routes.py", "swiss_undo_round"):
        "lehnt ab, solange ein Spiel der Runde an einer Station steht (#2120)",
    ("services/league_late_entry.py", "apply"):
        "nimmt nur gerade eingefügte Spiele eines gescheiterten Nachtrags zurück",
}


def _calls(node: ast.AST) -> list[ast.Call]:
    return [child for child in ast.walk(node) if isinstance(child, ast.Call)]


def _deletes_matches(call: ast.Call) -> bool:
    func = call.func
    return (isinstance(func, ast.Attribute) and func.attr == "delete_many"
            and isinstance(func.value, ast.Attribute) and func.value.attr == "matches_v2")


def _frees_stations(call: ast.Call) -> bool:
    func = call.func
    name = func.attr if isinstance(func, ast.Attribute) else getattr(func, "id", None)
    return name == "free_stations_of_deleted_matches"


def _deleting_functions():
    for folder in ("routes", "services"):
        for path in sorted((BACKEND / folder).rglob("*.py")):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    own = _calls(node)
                    if any(_deletes_matches(call) for call in own):
                        yield path.relative_to(BACKEND).as_posix(), node.name, own


def test_every_function_that_deletes_matches_frees_their_stations_unit():
    found = list(_deleting_functions())
    assert len(found) >= 10, "der Wächter findet die Löschwege nicht mehr - Suche prüfen"
    missing = [
        f"{path}:{name}"
        for path, name, calls in found
        if (path, name) not in EXEMPT and not any(_frees_stations(call) for call in calls)
    ]
    assert not missing, (
        "Diese Funktionen löschen Spiele, ohne deren Stationen freizugeben "
        "(services/station_runtime.free_stations_of_deleted_matches): " + ", ".join(missing)
    )


def test_the_exemptions_still_exist_and_still_delete_matches_unit():
    found = {(path, name) for path, name, _calls in _deleting_functions()}
    stale = sorted(f"{path}:{name}" for path, name in EXEMPT if (path, name) not in found)
    assert not stale, "Ausnahme ohne Löschweg - aus EXEMPT streichen: " + ", ".join(stale)
