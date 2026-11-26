"""Welche Meldungsarten erzeugt der Code? (#1662) - aus dem Quelltext gelesen, ohne ihn auszuführen.

Gesucht werden alle Aufrufe von ``create_user_notification`` und von Hilfsfunktionen, die eine Art nur weiterreichen
(ein Parameter ``kind`` bzw. ``notification_kind`` oder ``**note``, der beim Aufruf von ``create_user_notification``
landet). Die Art eines Aufrufs ist ein Text, eine Konstante des Moduls (``KIND = "…"``), ein ``a if … else b`` aus
solchen oder - ohne Angabe - der Vorgabewert. Was sich so nicht lesen lässt, kommt mit Fundstelle in ``unresolved``.
"""
from __future__ import annotations

import ast
import pathlib

BACKEND = pathlib.Path(__file__).resolve().parents[1]
TARGET = "create_user_notification"
KIND_PARAMS = ("kind", "notification_kind")
DEFAULT_KIND = "general"


def _files() -> list[pathlib.Path]:
    return sorted([*BACKEND.glob("routes/**/*.py"), *BACKEND.glob("services/**/*.py")])


def _call_name(node: ast.Call) -> str:
    func = node.func
    if isinstance(func, ast.Attribute):
        return func.attr
    return func.id if isinstance(func, ast.Name) else ""


def _constants(tree: ast.Module) -> dict[str, str]:
    found: dict[str, str] = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    found[target.id] = node.value.value
    return found


class _Forwarder:
    def __init__(self, param: str | None, position: int | None, default: str | None, star: bool):
        self.param, self.position, self.default, self.star = param, position, default, star


def _kind_expression(call: ast.Call, param: str | None, position: int | None) -> ast.expr | None:
    for keyword in call.keywords:
        if keyword.arg in KIND_PARAMS or (param and keyword.arg == param):
            return keyword.value
    if position is not None and len(call.args) > position:
        return call.args[position]
    return None


def _functions(tree: ast.Module):
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            yield node


def _find_forwarders(trees: dict[pathlib.Path, ast.Module]) -> tuple[dict[str, _Forwarder], dict[tuple[pathlib.Path, str], _Forwarder]]:
    """Öffentliche Weiterreicher gelten überall, private (``_name``) nur im eigenen Modul."""
    public: dict[str, _Forwarder] = {}
    private: dict[tuple[pathlib.Path, str], _Forwarder] = {}

    def known(path: pathlib.Path, name: str) -> _Forwarder | None:
        if name == TARGET:
            return _Forwarder("kind", 4, DEFAULT_KIND, False)
        return private.get((path, name)) or (public.get(name) if not name.startswith("_") else None)

    changed = True
    while changed:
        changed = False
        for path, tree in trees.items():
            for func in _functions(tree):
                if func.name == TARGET or known(path, func.name):
                    continue
                params = [arg.arg for arg in [*func.args.posonlyargs, *func.args.args, *func.args.kwonlyargs]]
                star = func.args.kwarg.arg if func.args.kwarg else None
                for call in ast.walk(func):
                    if not isinstance(call, ast.Call):
                        continue
                    inner = known(path, _call_name(call))
                    if not inner:
                        continue
                    expression = _kind_expression(call, inner.param, inner.position)
                    forwarded = None
                    if isinstance(expression, ast.Name) and expression.id in params:
                        forwarded = expression.id
                    starred = star and any(k.arg is None and isinstance(k.value, ast.Name) and k.value.id == star for k in call.keywords)
                    if not forwarded and not (starred and expression is None):
                        continue
                    default = None
                    position = None
                    if forwarded:
                        positional = [*func.args.posonlyargs, *func.args.args]
                        names = [arg.arg for arg in positional]
                        if forwarded in names:
                            position = names.index(forwarded)
                            offset = len(positional) - len(func.args.defaults)
                            if position >= offset:
                                value = func.args.defaults[position - offset]
                                default = value.value if isinstance(value, ast.Constant) else None
                        else:
                            index = [arg.arg for arg in func.args.kwonlyargs].index(forwarded)
                            value = func.args.kw_defaults[index]
                            default = value.value if isinstance(value, ast.Constant) else None
                    if (isinstance(func.args.args[:1], list) and func.args.args[:1]
                            and func.args.args[0].arg in ("self", "cls") and position is not None):
                        position -= 1
                    forwarder = _Forwarder(forwarded, position, default if isinstance(default, str) else None, bool(starred))
                    if func.name.startswith("_"):
                        private[(path, func.name)] = forwarder
                    else:
                        public[func.name] = forwarder
                    changed = True
                    break
    return public, private


def _resolve(expression: ast.expr, constants: dict[str, str]) -> list[str] | None:
    if isinstance(expression, ast.Constant) and isinstance(expression.value, str):
        return [expression.value]
    if isinstance(expression, ast.Name) and expression.id in constants:
        return [constants[expression.id]]
    if isinstance(expression, ast.IfExp):
        left, right = _resolve(expression.body, constants), _resolve(expression.orelse, constants)
        return None if left is None or right is None else [*left, *right]
    return None


def scan() -> tuple[dict[str, list[str]], dict[str, str]]:
    """``(Art → Fundstellen, Fundstelle → nicht lesbarer Ausdruck)``. Fundstelle: ``pfad:funktion:ausdruck``."""
    trees = {path: ast.parse(path.read_text(encoding="utf-8")) for path in _files()}
    public, private = _find_forwarders(trees)
    kinds: dict[str, list[str]] = {}
    unresolved: dict[str, str] = {}
    for path, tree in trees.items():
        constants = _constants(tree)
        rel = path.relative_to(BACKEND).as_posix()
        for func in _functions(tree):
            params = {arg.arg for arg in [*func.args.posonlyargs, *func.args.args, *func.args.kwonlyargs]}
            for call in ast.walk(func):
                if not isinstance(call, ast.Call):
                    continue
                name = _call_name(call)
                # ``create`` als Parameter (league_rewards): dort wird ``create_user_notification`` hineingereicht.
                if name == TARGET or (name == "create" and "create" in params and isinstance(call.func, ast.Name)):
                    forwarder = _Forwarder("kind", 4, DEFAULT_KIND, False)
                else:
                    forwarder = private.get((path, name)) or (public.get(name) if not name.startswith("_") else None)
                if not forwarder:
                    continue
                expression = _kind_expression(call, forwarder.param, forwarder.position)
                if expression is None:
                    if any(k.arg is None for k in call.keywords):
                        # ``**note`` ohne eigene Art: die Art kommt aus dem Aufrufer dieser Funktion - dort gezählt.
                        continue
                    values = [forwarder.default] if forwarder.default else None
                    if values is None and forwarder.star:
                        continue
                    if values is None:
                        unresolved[f"{rel}:{func.name}:<{name} ohne Art>"] = "keine Art"
                        continue
                else:
                    if isinstance(expression, ast.Name) and expression.id in params and (
                            (path, func.name) in private or func.name in public):
                        continue  # nur weitergereicht - die Aufrufer dieser Funktion zählen
                    values = _resolve(expression, constants)
                    if values is None:
                        unresolved[f"{rel}:{func.name}:{ast.unparse(expression)}"] = ast.unparse(expression)
                        continue
                for value in values:
                    kinds.setdefault(value, []).append(f"{rel}:{call.lineno}")
    return kinds, unresolved


if __name__ == "__main__":
    found, missing = scan()
    for kind in sorted(found):
        print(kind, len(found[kind]), found[kind][0])
    print("--- unresolved")
    for where, what in sorted(missing.items()):
        print(where, "=>", what)
