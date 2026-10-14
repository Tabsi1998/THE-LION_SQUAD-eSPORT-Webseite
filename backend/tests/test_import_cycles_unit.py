"""Wächter gegen Import-Kreise im Backend (#1420).

Baut mit ``ast`` den Import-Graphen über ``backend/`` (ohne ``tests/``) und zählt die
Importe, die einen Kreis beginnen: eine Kante ``a -> b``, von der aus ``b`` wieder zu
``a`` zurückführt. Wie bei GitHub Code Scanning (``py/cyclic-import``) zählen auch
Importe innerhalb von Funktionen mit, denn ein Kreis bleibt ein Kreis, auch wenn er
erst zur Laufzeit geschlossen wird.

Ratsche: Die Zahl darf nicht steigen. Sinkt sie, die Grundlinie unten mitsenken.

Von Hand: ``python backend/tests/test_import_cycles_unit.py`` listet die Befunde.
"""

from __future__ import annotations

import ast
import sys
from collections import defaultdict
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
SKIP_DIRS = {"tests", "static", "__pycache__", ".venv", "venv"}

# Grundlinie nach #1420. Vorher: 94 Befunde in Code Scanning, 437 nach dieser Zählung.
MAX_CYCLIC_IMPORTS = 0


def _module_name(path: Path) -> str:
    parts = list(path.relative_to(BACKEND).with_suffix("").parts)
    if parts[-1] == "__init__":
        parts = parts[:-1]
    return ".".join(parts)


def _collect_modules() -> dict[str, Path]:
    modules: dict[str, Path] = {}
    for path in BACKEND.rglob("*.py"):
        rel = path.relative_to(BACKEND)
        if any(part in SKIP_DIRS for part in rel.parts[:-1]):
            continue
        name = _module_name(path)
        if name:
            modules[name] = path
    return modules


def _resolve(target: str, modules: dict[str, Path]) -> str | None:
    """Längster bekannter Modulname, der ``target`` beginnt."""
    parts = target.split(".")
    while parts:
        name = ".".join(parts)
        if name in modules:
            return name
        parts.pop()
    return None


def _imports_of(name: str, path: Path, modules: dict[str, Path]) -> list[tuple[int, str]]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    is_package = path.name == "__init__.py"
    package = name if is_package else name.rpartition(".")[0]
    found: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                target = _resolve(alias.name, modules)
                if target:
                    found.append((node.lineno, target))
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                base_parts = package.split(".") if package else []
                if node.level > 1:
                    base_parts = base_parts[: len(base_parts) - (node.level - 1)]
                base = ".".join(base_parts + ([node.module] if node.module else []))
            else:
                base = node.module or ""
            for alias in node.names:
                # ``from services import xp`` meint das Untermodul ``services.xp``.
                sub = f"{base}.{alias.name}" if base else alias.name
                target = sub if sub in modules else _resolve(base, modules)
                if target:
                    found.append((node.lineno, target))
    return [(line, target) for line, target in found if target != name]


def build_graph() -> tuple[dict[str, set[str]], dict[str, list[tuple[int, str]]]]:
    modules = _collect_modules()
    graph: dict[str, set[str]] = defaultdict(set)
    edges: dict[str, list[tuple[int, str]]] = {}
    for name, path in modules.items():
        imports = sorted(set(_imports_of(name, path, modules)))
        edges[name] = imports
        graph[name].update(target for _, target in imports)
    return graph, edges


def strongly_connected(graph: dict[str, set[str]]) -> list[set[str]]:
    """Tarjan, iterativ (der Graph ist zu tief für Rekursion)."""
    index: dict[str, int] = {}
    low: dict[str, int] = {}
    on_stack: set[str] = set()
    stack: list[str] = []
    result: list[set[str]] = []
    counter = 0
    nodes = set(graph) | {t for targets in graph.values() for t in targets}
    for root in sorted(nodes):
        if root in index:
            continue
        work = [(root, iter(sorted(graph.get(root, ()))))]
        index[root] = low[root] = counter
        counter += 1
        stack.append(root)
        on_stack.add(root)
        while work:
            node, children = work[-1]
            advanced = False
            for child in children:
                if child not in index:
                    index[child] = low[child] = counter
                    counter += 1
                    stack.append(child)
                    on_stack.add(child)
                    work.append((child, iter(sorted(graph.get(child, ())))))
                    advanced = True
                    break
                if child in on_stack:
                    low[node] = min(low[node], index[child])
            if advanced:
                continue
            work.pop()
            if work:
                low[work[-1][0]] = min(low[work[-1][0]], low[node])
            if low[node] == index[node]:
                component = set()
                while True:
                    member = stack.pop()
                    on_stack.discard(member)
                    component.add(member)
                    if member == node:
                        break
                if len(component) > 1:
                    result.append(component)
    return result


def cyclic_imports() -> list[str]:
    """Alle Import-Anweisungen, deren Ziel im selben Kreis liegt wie der Importeur."""
    graph, edges = build_graph()
    component_of: dict[str, int] = {}
    for number, component in enumerate(strongly_connected(graph)):
        for member in component:
            component_of[member] = number
    findings = []
    for name, imports in sorted(edges.items()):
        for line, target in imports:
            if name in component_of and component_of.get(target) == component_of[name]:
                findings.append(f"{name}:{line} -> {target}")
    return findings


def test_import_cycles_do_not_grow():
    findings = cyclic_imports()
    assert len(findings) <= MAX_CYCLIC_IMPORTS, (
        f"{len(findings)} Import-Kreis-Befunde (erlaubt: {MAX_CYCLIC_IMPORTS}). "
        "Gemeinsames in ein Blatt-Modul ziehen statt nach oben zu importieren:\n" + "\n".join(findings)
    )


# Die Blatt-Module aus #1420: Sie dürfen - auch über Umwege - nichts von dem importieren, was auf ihnen aufbaut.
LEAVES = (
    "services.achievement_core", "services.achievement_progress", "services.xp_view", "services.season_collections",
    "services.discord_runtime", "services.discord_links", "services.discord_targets", "services.discord_plain_text",
    "services.discord_embed_queue", "services.discord_bracket_state", "services.image_upload", "services.mail_templates",
    "services.mail_overrides", "services.mail_outbox", "services.scheduler_state", "services.dolibarr_ballot_state",
    "services.passkey_config", "services.wiring",
)
FEATURES = {
    "badges", "discord_service", "email_service", "services.discord_bot", "services.xp", "services.achievement_queue",
    "services.achievement_counters", "services.scheduler",
}


def _reachable(graph: dict[str, set[str]], start: str) -> set[str]:
    seen: set[str] = set()
    stack = [start]
    while stack:
        for target in graph.get(stack.pop(), ()):
            if target not in seen:
                seen.add(target)
                stack.append(target)
    return seen


def test_leaf_modules_do_not_reach_back_into_the_features():
    graph, _ = build_graph()
    problems = {}
    for leaf in LEAVES:
        assert leaf in graph, f"{leaf} fehlt"
        reached = _reachable(graph, leaf)
        bad = sorted(reached & FEATURES) + sorted(name for name in reached if name.startswith("routes."))
        if bad:
            problems[leaf] = bad
    assert problems == {}, problems


def test_counter_sees_a_known_cycle(tmp_path, monkeypatch):
    """Selbsttest: zwei Module, die sich gegenseitig importieren, ergeben zwei Befunde."""
    (tmp_path / "pkg").mkdir()
    (tmp_path / "pkg" / "__init__.py").write_text("", encoding="utf-8")
    (tmp_path / "pkg" / "a.py").write_text("from pkg import b\n", encoding="utf-8")
    (tmp_path / "pkg" / "b.py").write_text("def f():\n    from pkg.a import x\n", encoding="utf-8")
    (tmp_path / "pkg" / "c.py").write_text("from pkg import a\n", encoding="utf-8")
    monkeypatch.setattr(sys.modules[__name__], "BACKEND", tmp_path)
    assert cyclic_imports() == ["pkg.a:1 -> pkg.b", "pkg.b:2 -> pkg.a"]


if __name__ == "__main__":
    graph, _ = build_graph()
    for component in strongly_connected(graph):
        print("Kreis:", ", ".join(sorted(component)))
    found = cyclic_imports()
    print("\n".join(found))
    print(f"{len(found)} Befunde")
