"""Routentabelle und gültige Anfragen für Inventar-Tests (#1665, Rechte-Audit für Gäste). Ohne Datenbank.

``app_routes`` liest die Routen der Anwendung (eingebundene Router bleiben in dieser FastAPI-Version Hüllen, ``original_router``).
``example_body`` und ``required_query`` bauen aus der OpenAPI-Beschreibung eine **gültige** Anfrage: Pflichtfelder mit passenden
Werten (Typ, Auswahl, Länge, Grenzen), damit ein Test die Rechte-Prüfung einer Route wirklich erreicht und nicht schon an der
Form (422) scheitert. Werte, die eine bestimmte Route braucht, reicht der Test als ``overrides`` herein.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from functools import lru_cache

TEXT = "Grund für die Prüfung der Rechte"


def _server():
    """Die Anwendung so geladen wie in den Flow-Tests (``flow_harness``): mit deren Umgebung - ein eigener Import ohne sie hinterließe
    eine Anwendung mit anderen Hosts und Schlüsseln für alle folgenden Tests desselben Prozesses."""
    from flow_harness import load_application

    return load_application()[1]


def app_routes() -> list[tuple[str, str]]:
    server = _server()
    found: set[tuple[str, str]] = set()

    def walk(routes):
        for route in routes or []:
            original = getattr(route, "original_router", None)
            if original is not None:
                walk(getattr(original, "routes", []))
                continue
            nested = getattr(route, "routes", None)
            if nested and not getattr(route, "methods", None):
                walk(nested)
                continue
            for method in getattr(route, "methods", None) or ():
                if method not in {"HEAD", "OPTIONS"}:
                    found.add((method, route.path))

    walk(server.app.routes)
    return sorted(found)


@lru_cache(maxsize=1)
def _openapi() -> dict:
    return _server().app.openapi()


def _resolve(schema: dict) -> dict:
    components = _openapi().get("components", {}).get("schemas", {})
    while isinstance(schema, dict) and "$ref" in schema:
        schema = components[schema["$ref"].rsplit("/", 1)[-1]]
    return schema or {}


def _pick(schema: dict) -> dict:
    schema = _resolve(schema)
    for key in ("anyOf", "oneOf"):
        if key in schema:
            options = [_resolve(option) for option in schema[key] if _resolve(option).get("type") != "null"]
            return options[0] if options else {}
    if "allOf" in schema and schema["allOf"]:
        return _pick(schema["allOf"][0])
    return schema


def example(schema: dict, name: str = ""):
    """Ein gültiger Wert für ``schema``: Auswahl, Länge, Grenzen und verschachtelte Pflichtfelder."""
    schema = _pick(schema)
    if "const" in schema:
        return schema["const"]
    if "enum" in schema:
        return schema["enum"][0]
    kind = schema.get("type")
    if kind == "object" or "properties" in schema:
        props = schema.get("properties", {})
        return {key: example(props[key], key) for key in schema.get("required", []) if key in props}
    if kind == "array":
        count = int(schema.get("minItems") or 0)
        return [example(schema.get("items", {}), name) for _ in range(count)]
    if kind == "boolean":
        return True
    if kind in ("integer", "number"):
        low = schema.get("minimum", schema.get("exclusiveMinimum", 0) + (1 if "exclusiveMinimum" in schema else 0))
        value = max(int(low or 0), 1)
        if "maximum" in schema:
            value = min(value, int(schema["maximum"]))
        return value
    if kind == "string":
        stamp = datetime.now(timezone.utc) + timedelta(days=3)
        if schema.get("format") == "date-time":
            return stamp.isoformat()
        if schema.get("format") == "date":
            return stamp.date().isoformat()
        if schema.get("pattern") == "^[A-Za-z]$":
            return "B"
        hexed = re.fullmatch(r"\^\[0-9a-f\]\{(\d+)\}\$", schema.get("pattern") or "")
        if hexed:
            return "0" * int(hexed.group(1))
        text = TEXT
        low, high = int(schema.get("minLength") or 0), schema.get("maxLength")
        if len(text) < low:
            text = (text + " ") * (low // len(text) + 1)
        return text[:high] if high else text
    return None


def _operation(method: str, path: str) -> dict:
    return (_openapi().get("paths", {}).get(path) or {}).get(method.lower()) or {}


def example_body(method: str, path: str, overrides: dict | None = None):
    """Der Inhalt einer gültigen Anfrage - ``None``, wenn die Route keinen Inhalt nimmt."""
    content = ((_operation(method, path).get("requestBody") or {}).get("content") or {}).get("application/json")
    if not content:
        return dict(overrides) if overrides else None
    body = example(content.get("schema") or {})
    if isinstance(body, dict):
        body.update(overrides or {})
    return body if body is not None else {}


def required_query(method: str, path: str, values: dict | None = None) -> dict:
    """Pflichtangaben in der Adresse (``?…``), aus ``values`` oder passend erzeugt."""
    out = {}
    for parameter in _operation(method, path).get("parameters") or []:
        if parameter.get("in") != "query" or not parameter.get("required"):
            continue
        key = parameter["name"]
        out[key] = (values or {}).get(key, example(parameter.get("schema") or {}, key))
    return out
