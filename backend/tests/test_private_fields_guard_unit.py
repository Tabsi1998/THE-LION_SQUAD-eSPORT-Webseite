"""Private Kontofelder stehen an einer Stelle (#1492): services/private_fields.py.

Der Wächter liest den Quelltext des Backends und hält jede Abfrage auf ``users`` und jede Bereinigung an der zentralen
Liste fest:

- Jede ``find``/``find_one`` auf ``users`` nimmt ``private_projection()`` oder wählt nur Felder aus (Wert 1, kein
  privates Feld darunter). Wer das ganze Konto liest, steht begründet auf ``AUSNAHMEN``.
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
QUERY_METHODS = {"find", "find_one"}

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


def _is_users_query(node) -> bool:
    return (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr in QUERY_METHODS
            and isinstance(node.func.value, ast.Attribute) and node.func.value.attr == "users")


def _projection(call):
    for kw in call.keywords:
        if kw.arg == "projection":
            return kw.value
    return call.args[1] if len(call.args) >= 2 else None


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


def _users_queries():
    for rel, tree in _sources():
        for node in ast.walk(tree):
            if _is_users_query(node):
                yield rel, tree, node


def test_every_users_query_hides_private_fields_or_is_an_exception():
    wrong, used = [], set()
    for rel, tree, call in _users_queries():
        scopes = _enclosing(tree, call)
        if _resolve(_projection(call), scopes, tree):
            continue
        fn = _function_name(tree, call)
        key = (rel, fn) if (rel, fn) in AUSNAHMEN else (rel, "*")
        if key in AUSNAHMEN:
            used.add(key)
            continue
        wrong.append(f"{rel}:{call.lineno} ({fn}) - private_projection() nehmen oder nur Felder auswählen")
    assert not wrong, "\n".join(wrong)
    assert not set(AUSNAHMEN) - used, f"Ausnahmen ohne Fundstelle: {sorted(set(AUSNAHMEN) - used)}"


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
