"""Wächter (#2386): Jede Funktion, die Spiele löscht, gibt auch deren Stationen frei - genau die gelöschten.

Sonst hängt eine Station als „belegt“ ohne Spiel, bis die Leitung sie über „Station räumen“ freigibt. Der Test liest den
Quelltext unter ``routes/`` und ``services/``. Jedes Löschen in ``matches_v2`` (``delete_many``, ``delete_one``,
``find_one_and_delete``, auch über ``db["matches_v2"]``) braucht in derselben Funktion einen Aufruf von
``free_stations_of_deleted_matches`` mit einer Liste, die die gelöschte Menge abdeckt:

- Löschen nach Kennungen (``{"id": {"$in": ids}}`` bzw. ``{"id": match_id}``): freigegeben wird dieselbe Liste ``ids``.
- Löschen nach anderem Filter (Turnier, Phase …): freigegeben wird eine Liste aus ``distinct("id", …)`` - nicht eine
  gelesene Teilmenge (``to_list(3000)``), die mehr löschen als freigeben könnte (Review zu #2386).

Ausnahmen stehen unten mit Grund.
"""
from __future__ import annotations

import ast
import pathlib

BACKEND = pathlib.Path(__file__).resolve().parents[1]
FREE = "free_stations_of_deleted_matches"
DELETE_METHODS = {"delete_many", "delete_one", "find_one_and_delete"}

# (Datei, Funktion) -> Grund: Wege, auf denen keine Station ein gelöschtes Spiel halten kann.
EXEMPT = {
    ("routes/tournament_format_routes.py", "swiss_undo_round"):
        "lehnt ab, solange ein Spiel der Runde an einer Station steht (#2120)",
    ("services/league_late_entry.py", "apply"):
        "nimmt nur gerade eingefügte Spiele eines gescheiterten Nachtrags zurück",
}
# (Datei, Funktion, Liste) -> Grund: ein Rückbau gerade eingefügter Spiele.
EXEMPT_DELETES = {
    ("routes/tournament_structure_routes.py", "rebuild_bracket_from_tournament_format", "new_match_ids"):
        "Rückbau der eben eingefügten neuen Spiele, wenn das Einfügen scheitert",
    ("services/competition_structure_apply.py", "activate_structure_plan", "new_match_ids"):
        "Rückbau der eben eingefügten neuen Spiele, wenn das Anwenden scheitert",
}


def _functions(tree: ast.AST):
    return [node for node in ast.walk(tree) if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))]


def _is_matches_collection(node: ast.AST) -> bool:
    if isinstance(node, ast.Attribute):
        return node.attr == "matches_v2"
    if isinstance(node, ast.Subscript):
        key = node.slice
        return isinstance(key, ast.Constant) and key.value == "matches_v2"
    return False


def _deletes(function: ast.AST) -> list[ast.Call]:
    return [call for call in ast.walk(function) if isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute)
            and call.func.attr in DELETE_METHODS and _is_matches_collection(call.func.value)]


def _freed_names(function: ast.AST) -> set[str]:
    names = set()
    for call in ast.walk(function):
        if not isinstance(call, ast.Call):
            continue
        func = call.func
        name = func.attr if isinstance(func, ast.Attribute) else getattr(func, "id", None)
        if name != FREE or len(call.args) < 2:
            continue
        target = call.args[1]
        if isinstance(target, ast.Name):
            names.add(target.id)
        elif isinstance(target, ast.List):
            names.update(item.id for item in target.elts if isinstance(item, ast.Name))
    return names


def _distinct_id_names(function: ast.AST) -> set[str]:
    """Namen, die eine ``distinct("id", …)``-Abfrage bekommen."""
    names = set()
    for node in ast.walk(function):
        if not isinstance(node, ast.Assign) or len(node.targets) != 1 or not isinstance(node.targets[0], ast.Name):
            continue
        value = node.value.value if isinstance(node.value, ast.Await) else node.value
        if (isinstance(value, ast.Call) and isinstance(value.func, ast.Attribute) and value.func.attr == "distinct"
                and value.args and isinstance(value.args[0], ast.Constant) and value.args[0].value == "id"):
            names.add(node.targets[0].id)
    return names


def _id_list_of(call: ast.Call) -> str | None:
    """Die Liste hinter ``{"id": {"$in": ids}}`` bzw. ``{"id": match_id}`` - sonst ``None``."""
    query = call.args[0] if call.args else None
    if not isinstance(query, ast.Dict) or len(query.keys) != 1:
        return None
    key, value = query.keys[0], query.values[0]
    if not (isinstance(key, ast.Constant) and key.value == "id"):
        return None
    if isinstance(value, ast.Name):
        return value.id
    if (isinstance(value, ast.Dict) and len(value.keys) == 1 and isinstance(value.keys[0], ast.Constant)
            and value.keys[0].value == "$in" and isinstance(value.values[0], ast.Name)):
        return value.values[0].id
    return None


def uncovered(source: str, path: str) -> list[str]:
    """Löschaufrufe ohne passende Freigabe, als ``Datei:Funktion:Zeile``."""
    problems = []
    for function in _functions(ast.parse(source)):
        deletes = _deletes(function)
        if not deletes or (path, function.name) in EXEMPT:
            continue
        freed = _freed_names(function)
        distinct = freed & _distinct_id_names(function)
        for call in deletes:
            ids = _id_list_of(call)
            if ids is not None and (ids in freed or (path, function.name, ids) in EXEMPT_DELETES):
                continue
            if ids is None and distinct:
                continue
            problems.append(f"{path}:{function.name}:{call.lineno}")
    return problems


def _sources():
    for folder in ("routes", "services"):
        for file in sorted((BACKEND / folder).rglob("*.py")):
            yield file.relative_to(BACKEND).as_posix(), file.read_text(encoding="utf-8")


def _deleting_functions():
    for path, source in _sources():
        for function in _functions(ast.parse(source)):
            if _deletes(function):
                yield path, function.name


def test_every_match_deletion_frees_exactly_the_deleted_stations_unit():
    assert len(set(_deleting_functions())) >= 10, "der Wächter findet die Löschwege nicht mehr - Suche prüfen"
    missing = [problem for path, source in _sources() for problem in uncovered(source, path)]
    assert not missing, (
        "Diese Löschwege geben die Stationen der gelöschten Spiele nicht (vollständig) frei - "
        "free_stations_of_deleted_matches mit derselben Kennungsliste bzw. einer aus distinct(\"id\", …): "
        + ", ".join(missing)
    )


def test_the_guard_catches_a_partial_read_delete_one_and_subscript_access_unit():
    partial = '''
async def rebuild(db, tid):
    rows = await db.matches_v2.find({"tournament_id": tid}).to_list(3000)
    ids = [row["id"] for row in rows]
    await db.matches_v2.delete_many({"tournament_id": tid})
    await free_stations_of_deleted_matches(db, ids)
'''
    one = '''
async def drop(db, match_id):
    await db.matches_v2.delete_one({"id": match_id})
'''
    subscript = '''
async def drop_all(db, tid):
    await db["matches_v2"].delete_many({"tournament_id": tid})
'''
    exact = '''
async def rebuild(db, tid):
    ids = await db.matches_v2.distinct("id", {"tournament_id": tid})
    await db.matches_v2.delete_many({"tournament_id": tid})
    await free_stations_of_deleted_matches(db, ids)

async def drop(db, match_id):
    await db.matches_v2.delete_one({"id": match_id})
    await free_stations_of_deleted_matches(db, [match_id])
'''
    assert uncovered(partial, "x.py") == ["x.py:rebuild:5"], "gelesene Teilmenge statt distinct"
    assert uncovered(one, "x.py") == ["x.py:drop:3"]
    assert uncovered(subscript, "x.py") == ["x.py:drop_all:3"]
    assert uncovered(exact, "x.py") == []


def test_the_exemptions_still_exist_unit():
    found = set(_deleting_functions())
    wanted = {*EXEMPT, *((path, name) for path, name, _ids in EXEMPT_DELETES)}
    stale = sorted(f"{path}:{name}" for path, name in wanted if (path, name) not in found)
    assert not stale, "Ausnahme ohne Löschweg - streichen: " + ", ".join(stale)
