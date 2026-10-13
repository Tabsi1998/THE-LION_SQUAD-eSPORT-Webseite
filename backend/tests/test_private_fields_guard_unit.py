"""Private Kontofelder stehen an einer Stelle (#1492): services/private_fields.py.

Der Wächter liest den Quelltext des Backends und hält jede Abfrage auf ``users`` und jede Bereinigung an der zentralen
Liste fest:

- Jede ``find``/``find_one`` auf ``users`` nimmt ``private_projection()`` oder wählt nur Felder aus (Wert 1, kein
  privates Feld darunter). Ebenso ``find_one_and_update``/``_replace``/``_delete``, sobald ihr Ergebnis gebraucht
  wird. Erkannt wird ``users`` auch als ``db["users"]``, ``get_collection("users")``, ``getattr(db, "users")`` und
  über Aliase wie ``users = db.users``.
- ``aggregate`` auf ``users`` braucht eine ``$group``-, ``$count``- oder sichere ``$project``-Stufe; ein ``$lookup``
  oder ``$graphLookup`` auf ``users`` aus jeder Sammlung braucht eine eigene ``pipeline`` mit sicherer ``$project``-
  Stufe. Wer das ganze Konto liest, steht begründet auf ``AUSNAHMEN``.
- Außerhalb von services/private_fields.py zählt niemand private Felder selbst auf: keine eigene Projektion mit 0,
  keine eigene Feldliste, kein ``pop`` eines privaten Feldes. Bereinigungen nehmen ``strip_private``.

Damit genügt für ein neues privates Feld ein Eintrag in ``PRIVATE_USER_FIELDS``; die Rückgabetests in
test_private_fields_flow.py prüfen das an den Antworten.
"""
import ast
import pathlib

from services.private_fields import PRIVATE_USER_FIELDS, private_projection, strip_private

BACKEND = pathlib.Path(__file__).resolve().parents[1]
CENTRAL = "services/private_fields.py"
READ_METHODS = {"find", "find_one"}
# Schreiben mit Rückgabe des Dokuments: Stelle der Projektion als Positionsargument.
RETURNING_WRITES = {"find_one_and_update": 2, "find_one_and_replace": 2, "find_one_and_delete": 1}
SHAPING_STAGES = {"$group", "$count"}

# Wer ein Konto ganz liest, braucht die privaten Felder zum Prüfen oder gibt nichts davon zurück.
# Schlüssel: (Datei, Funktion); "*" gilt für die ganze Datei.
AUSNAHMEN = {
    **{("routes/auth_routes.py", name): "Anmeldung, Registrierung, Google, Zwei-Faktor, Passwort: prüft Passwort-Hash "
       "und Zwei-Faktor-Werte; was zurückgeht, läuft durch _public_user (strip_private)"
       for name in ("_rotate_session", "register", "login", "_unique_username", "google_session", "google_link",
                    "google_unlink", "mobile_register", "mobile_login", "forgot_password", "resend_verification",
                    "verify_email", "complete_mfa_login", "setup_mfa", "enable_mfa", "disable_mfa", "change_password")},
    ("routes/auth_routes.py", "mfa_status"): "wählt die Recovery-Code-Hashes nur aus, um sie zu zählen; "
       "zurück geht die Zahl",
    **{("routes/passkey_routes.py", name): "Passkeys: prüft das Passwort bzw. liest das Konto für die Anmeldung; "
       "die Antwort läuft durch _public_user (strip_private)"
       for name in ("_management_proof", "registration_verify", "_verified_login_user", "mobile_registration_options")},
    ("routes/dsgvo_routes.py", "*"): "Auskunft und Anonymisierung (#1029/#1030): eigene Regeln für die Auskunft, "
       "wird in #1493 umgebaut - danach auf die zentrale Liste umstellen",
    ("seed.py", "*"): "Startdaten auf der Kommandozeile, keine Antwort",
    ("setup_cli.py", "*"): "Einrichtung auf der Kommandozeile, keine Antwort",
    ("services/match_audience.py", "users_for"): "Projektion als Parameter; ohne Angabe die Auswahl USER_FIELDS "
       "(nur Felder mit 1) - kein Aufrufer gibt eine eigene mit",
}


def _sources():
    for path in sorted(BACKEND.rglob("*.py")):
        rel = path.relative_to(BACKEND).as_posix()
        if rel.startswith(("tests/", "venv/", ".venv/")) or "/site-packages/" in rel:
            continue
        yield rel, ast.parse(path.read_text(encoding="utf-8"))


def _enclosing(tree, target):
    """Die Funktionsdefinitionen, in denen ``target`` liegt - von innen nach außen, zuletzt das Modul."""
    chain = []

    def walk(node, stack):
        if node is target:
            chain.extend(reversed(stack))
            return True
        is_fn = isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        for child in ast.iter_child_nodes(node):
            if walk(child, stack + [node] if is_fn else stack):
                return True
        return False

    walk(tree, [])
    return chain + [tree]


def _is_users_name(node) -> bool:
    return isinstance(node, ast.Constant) and node.value == "users"


def _is_users_collection(node, aliases: set[str]) -> bool:
    """``db.users``, ``db["users"]``, ``db.get_collection("users")``, ``getattr(db, "users")`` oder ein Alias davon."""
    if isinstance(node, ast.Attribute):
        return node.attr == "users"
    if isinstance(node, ast.Subscript):
        return _is_users_name(node.slice)
    if isinstance(node, ast.Name):
        return node.id in aliases
    if isinstance(node, ast.Call):
        func = node.func
        if isinstance(func, ast.Attribute) and func.attr == "get_collection":
            return bool(node.args) and _is_users_name(node.args[0])
        if isinstance(func, ast.Name) and func.id == "getattr":
            return len(node.args) >= 2 and _is_users_name(node.args[1])
    return False


def _aliases(tree) -> set[str]:
    """Namen, unter denen die Sammlung ``users`` in der Datei steht (``users = db.users``) - auch Alias vom Alias."""
    aliases: set[str] = set()
    while True:
        found = set(aliases)
        for node in ast.walk(tree):
            if isinstance(node, ast.Assign):
                targets = node.targets
            elif isinstance(node, ast.AnnAssign):
                targets = [node.target]
            else:
                continue
            if node.value is not None and _is_users_collection(node.value, aliases):
                found |= {target.id for target in targets if isinstance(target, ast.Name)}
        if found == aliases:
            return aliases
        aliases = found


def _keyword(call, name):
    return next((kw.value for kw in call.keywords if kw.arg == name), None)


def _result_discarded(call, parents) -> bool:
    node = parents.get(call)
    if isinstance(node, ast.Await):
        node = parents.get(node)
    return isinstance(node, ast.Expr)


def _calls_private_projection(node) -> bool:
    func = node.func if isinstance(node, ast.Call) else None
    return bool(func is not None and getattr(func, "id", getattr(func, "attr", None)) == "private_projection")


def _is_one(node) -> bool:
    return isinstance(node, ast.Constant) and node.value in (1, True)


def _selection_ok(node: ast.Dict) -> bool:
    """Eine reine Auswahl: jeder Wert 1/True, kein privates Feld; ``**{k: 1 for ...}`` zählt mit.

    ``{"_id": 0}`` allein wählt nichts aus und liest damit das ganze Konto."""
    picked = False
    for key, value in zip(node.keys, node.values):
        if key is None:
            if not (isinstance(value, ast.DictComp) and _is_one(value.value)):
                return False
            picked = True
        elif not isinstance(key, ast.Constant) or key.value in PRIVATE_USER_FIELDS:
            return False
        elif key.value == "_id":
            picked = picked or _is_one(value)
        elif _is_one(value):
            picked = True
        else:
            return False
    return picked


def _resolve(expr, scopes, tree) -> bool | None:
    """True: sicher. False: eigene Liste oder ganzes Konto. None: nicht auflösbar."""
    if expr is None:
        return False
    if _calls_private_projection(expr):
        return True
    if isinstance(expr, ast.Dict):
        return _selection_ok(expr)
    if isinstance(expr, ast.BoolOp):
        parts = [_resolve(value, scopes, tree) for value in expr.values]
        return None if None in parts else all(parts)
    if isinstance(expr, ast.Name):
        found = []
        for scope in scopes:
            for node in ast.walk(scope):
                if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == expr.id for t in node.targets):
                    found.append(node.value)
                elif (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "update"
                      and isinstance(node.func.value, ast.Name) and node.func.value.id == expr.id and node.args):
                    found.append(node.args[0])
            if found:
                break
        if not found:
            return None
        parts = [_resolve(value, scopes, tree) for value in found]
        return None if None in parts else all(parts)
    if isinstance(expr, ast.Call) and isinstance(expr.func, ast.Name) and not expr.args:
        returns = [node.value for fn in tree.body if isinstance(fn, ast.FunctionDef) and fn.name == expr.func.id
                   for node in ast.walk(fn) if isinstance(node, ast.Return)]
        if not returns:
            return None
        parts = [_resolve(value, [tree], tree) for value in returns]
        return None if None in parts else all(parts)
    return None


def _function_name(tree, node) -> str:
    for scope in _enclosing(tree, node):
        if isinstance(scope, (ast.FunctionDef, ast.AsyncFunctionDef)):
            return scope.name
    return "<modul>"


def _resolve_list(expr, scopes):
    """Die Stufen einer Pipeline: Liste direkt oder über einen Namen in der Funktion/im Modul; sonst None."""
    if isinstance(expr, ast.List):
        return expr.elts
    if isinstance(expr, ast.Name):
        for scope in scopes:
            for node in ast.walk(scope):
                if (isinstance(node, ast.Assign) and isinstance(node.value, ast.List)
                        and any(isinstance(t, ast.Name) and t.id == expr.id for t in node.targets)):
                    return node.value.elts
    return None


def _stage(node, name):
    if isinstance(node, ast.Dict):
        for key, value in zip(node.keys, node.values):
            if isinstance(key, ast.Constant) and key.value == name:
                return value
    return None


def _pipeline_safe(stages, scopes, tree, shaping=frozenset()) -> bool:
    """Eine Stufe begrenzt, was aus ``users`` herauskommt: sichere ``$project`` oder (beim aggregate) ``$group``/``$count``."""
    for stage in stages or []:
        if any(_stage(stage, name) is not None for name in shaping):
            return True
        project = _stage(stage, "$project")
        if project is not None and _resolve(project, scopes, tree):
            return True
    return False


def _lookups_on_users(tree):
    for node in ast.walk(tree):
        for name in ("$lookup", "$graphLookup"):
            spec = _stage(node, name)
            if isinstance(spec, ast.Dict) and _is_users_name(_stage(spec, "from")):
                yield node, spec


def _findings(rel, tree):
    """(Zeile, Funktion, Hinweis) für jeden Zugriff auf ``users``, der das ganze Konto herausgeben kann."""
    aliases = _aliases(tree)
    parents = {child: parent for parent in ast.walk(tree) for child in ast.iter_child_nodes(parent)}
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                and _is_users_collection(node.func.value, aliases)):
            continue
        method = node.func.attr
        if method in READ_METHODS:
            scopes = _enclosing(tree, node)
            projection = _keyword(node, "projection") or (node.args[1] if len(node.args) >= 2 else None)
            if not _resolve(projection, scopes, tree):
                yield node.lineno, _function_name(tree, node), "private_projection() nehmen oder nur Felder auswählen"
        elif method in RETURNING_WRITES and not _result_discarded(node, parents):
            scopes = _enclosing(tree, node)
            index = RETURNING_WRITES[method]
            projection = _keyword(node, "projection") or (node.args[index] if len(node.args) > index else None)
            if not _resolve(projection, scopes, tree):
                yield node.lineno, _function_name(tree, node), f"{method} gibt das Konto zurück - projection setzen"
        elif method == "aggregate":
            scopes = _enclosing(tree, node)
            stages = _resolve_list(node.args[0] if node.args else _keyword(node, "pipeline"), scopes)
            if not _pipeline_safe(stages, scopes, tree, SHAPING_STAGES):
                yield node.lineno, _function_name(tree, node), "aggregate auf users ohne $group/$count/sichere $project"
    for node, spec in _lookups_on_users(tree):
        scopes = _enclosing(tree, node)
        stages = _resolve_list(_stage(spec, "pipeline"), scopes)
        if not _pipeline_safe(stages, scopes, tree):
            yield node.lineno, _function_name(tree, node), "$lookup auf users braucht eine pipeline mit sicherer $project"


def test_every_users_query_hides_private_fields_or_is_an_exception():
    wrong, used = [], set()
    for rel, tree in _sources():
        for line, fn, hint in _findings(rel, tree):
            key = (rel, fn) if (rel, fn) in AUSNAHMEN else (rel, "*")
            if key in AUSNAHMEN:
                used.add(key)
                continue
            wrong.append(f"{rel}:{line} ({fn}) - {hint}")
    assert not wrong, "\n".join(wrong)
    assert not set(AUSNAHMEN) - used, f"Ausnahmen ohne Fundstelle: {sorted(set(AUSNAHMEN) - used)}"


def _probe(*lines: str) -> str:
    return "async def f(db):\n" + "\n".join(f"    {line}" for line in lines)


GEFAEHRLICH = {
    "Alias": _probe("users = db.users", "return await users.find_one({'id': 1})"),
    "Alias vom Alias": _probe("a = db.users", "b = a", "return await b.find({}, {'_id': 0}).to_list(9)"),
    "Index": _probe("return await db['users'].find_one({'id': 1}, {'_id': 0})"),
    "get_collection": _probe("return await db.get_collection('users').find_one({'id': 1})"),
    "getattr": _probe("return await getattr(db, 'users').find_one({'id': 1})"),
    "find_one_and_update": _probe(
        "res = await db.users.find_one_and_update({'id': 1}, {'$set': {'a': 1}}, return_document=True)", "return res"),
    "find_one_and_replace": _probe("return await db.users.find_one_and_replace({'id': 1}, {'id': 1})"),
    "find_one_and_delete": _probe("return await db.users.find_one_and_delete({'id': 1})"),
    "aggregate": _probe("return await db.users.aggregate([{'$match': {'id': 1}}]).to_list(9)"),
    "aggregate mit $project nur ohne _id": _probe("return await db.users.aggregate([{'$project': {'_id': 0}}]).to_list(9)"),
    "$lookup": _probe("return await db.teams.aggregate([{'$lookup': {'from': 'users', 'localField': 'a', "
                      "'foreignField': 'id', 'as': 'u'}}]).to_list(9)"),
    "$lookup mit pipeline ohne $project": _probe(
        "return await db.teams.aggregate([{'$lookup': {'from': 'users', 'pipeline': [{'$match': {}}], 'as': 'u'}}])"
        ".to_list(9)"),
    "$graphLookup": _probe("return await db.teams.aggregate([{'$graphLookup': {'from': 'users', 'as': 'u'}}]).to_list(9)"),
}
HARMLOS = {
    "Alias mit Auswahl": _probe("users = db.users", "return await users.find_one({'id': 1}, {'_id': 0, 'id': 1})"),
    "Index mit zentraler Projektion": _probe("return await db['users'].find_one({'id': 1}, private_projection())"),
    "Schreiben ohne Rückgabe": _probe("await db.users.find_one_and_update({'id': 1}, {'$inc': {'n': 1}})"),
    "Schreiben mit Auswahl": _probe("return await db.users.find_one_and_update({'id': 1}, {'$inc': {'n': 1}}, "
                                    "projection={'_id': 0, 'id': 1, 'n': 1}, return_document=True)"),
    "aggregate mit $group": _probe("return await db.users.aggregate([{'$match': {}}, {'$group': {'_id': '$a'}}])"
                                   ".to_list(9)"),
    "aggregate mit $project": _probe("steps = [{'$project': private_projection()}]",
                                     "return await db.users.aggregate(steps).to_list(9)"),
    "$lookup mit Auswahl": _probe("return await db.teams.aggregate([{'$lookup': {'from': 'users', "
                                  "'pipeline': [{'$project': {'_id': 0, 'username': 1}}], 'as': 'u'}}]).to_list(9)"),
    "andere Sammlung": _probe("return await db.teams.find_one_and_delete({'id': 1})"),
}


def test_the_guard_catches_every_way_to_read_users():
    """Gegenprobe: jeder gefährliche Weg fällt auf, jeder sichere bleibt still."""
    missed = [name for name, code in GEFAEHRLICH.items() if not list(_findings("probe.py", ast.parse(code)))]
    noisy = {name: found for name, code in HARMLOS.items() if (found := list(_findings("probe.py", ast.parse(code))))}
    assert not missed, f"nicht erkannt: {missed}"
    assert not noisy, noisy


def _private_constant(node) -> bool:
    return isinstance(node, ast.Constant) and node.value in PRIVATE_USER_FIELDS


def test_no_one_lists_private_fields_outside_the_central_module():
    """Keine eigene Ausschlussliste und keine eigene Bereinigung - sonst fehlt ein neues Feld dort."""
    exempt_files = {rel for rel, fn in AUSNAHMEN if fn == "*"} | {CENTRAL}
    wrong = []
    for rel, tree in _sources():
        if rel in exempt_files:
            continue
        for node in ast.walk(tree):
            line = getattr(node, "lineno", "?")
            if isinstance(node, (ast.Tuple, ast.List, ast.Set)) and any(_private_constant(elt) for elt in node.elts):
                wrong.append(f"{rel}:{line}: Feldliste mit privatem Feld - PRIVATE_USER_FIELDS nehmen")
            elif isinstance(node, ast.Dict) and any(
                    _private_constant(k) and isinstance(v, ast.Constant) and v.value in (0, False)
                    for k, v in zip(node.keys, node.values)):
                wrong.append(f"{rel}:{line}: eigene Projektion - private_projection() nehmen")
            elif (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "pop"
                  and node.args and _private_constant(node.args[0])):
                wrong.append(f"{rel}:{line}: eigene Bereinigung - strip_private() nehmen")
            elif isinstance(node, ast.Delete) and any(
                    isinstance(t, ast.Subscript) and _private_constant(t.slice) for t in node.targets):
                wrong.append(f"{rel}:{line}: eigene Bereinigung - strip_private() nehmen")
    assert not wrong, "\n".join(wrong)


def test_the_account_sanitizers_use_strip_private():
    sanitizers = {("routes/user_routes.py", "_clean"), ("routes/auth_routes.py", "_public_user")}
    found = set()
    for rel, tree in _sources():
        for fn in ast.walk(tree):
            if isinstance(fn, ast.FunctionDef) and (rel, fn.name) in sanitizers:
                calls = {getattr(n.func, "id", None) for n in ast.walk(fn) if isinstance(n, ast.Call)}
                assert "strip_private" in calls, f"{rel}:{fn.name} bereinigt nicht über strip_private"
                found.add((rel, fn.name))
    assert found == sanitizers


def test_projection_and_sanitizer_cover_every_private_field():
    assert {"password_hash", "google_id", "mfa_secret", "mfa_pending_secret", "mfa_pending_created_at",
            "mfa_recovery_code_hashes", "mfa_totp_last_counter"} <= PRIVATE_USER_FIELDS
    projection = private_projection("email")
    assert projection == {"_id": 0, "email": 0, **{field: 0 for field in PRIVATE_USER_FIELDS}}
    doc = {"_id": "x", "id": "u1", "username": "loewe", **{field: "geheim" for field in PRIVATE_USER_FIELDS}}
    assert strip_private(doc) is doc
    assert doc == {"id": "u1", "username": "loewe"}
    assert strip_private(None) is None


def test_a_new_field_in_the_central_list_reaches_projection_and_sanitizer(monkeypatch):
    """Gegenprobe im Kleinen: Projektion und Bereinigung lesen die Liste beim Aufruf, nicht beim Import."""
    import services.private_fields as private_fields

    monkeypatch.setattr(private_fields, "PRIVATE_USER_FIELDS", PRIVATE_USER_FIELDS | {"neues_geheimnis"})
    assert private_fields.private_projection()["neues_geheimnis"] == 0
    assert "neues_geheimnis" not in private_fields.strip_private({"id": "u1", "neues_geheimnis": "x"})
