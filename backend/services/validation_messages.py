"""Prüffehler (422) auf Deutsch (#2119 X1).

Pydantic meldet ungültige Eingaben auf Englisch („String should have at most 1000 characters“); die Oberfläche zeigt
`msg` 1:1 als Meldung. Hier wird `msg` für die häufigen Arten übersetzt - `type`, `loc` und `ctx` bleiben, wie sie
sind, damit Programme weiter danach unterscheiden können.

Bekannte Feldnamen bekommen ein deutsches Wort davor („Nachricht: höchstens 1000 Zeichen.“), unbekannte stehen in
Klammern dahinter („Mindestens 2 (max_participants).“) - lieber der technische Name als gar kein Hinweis, welches Feld.
"""
from __future__ import annotations

from typing import Any

FIELD_LABELS = {
    "message": "Nachricht", "name": "Name", "subject": "Betreff", "email": "E-Mail", "title": "Titel", "body": "Text",
    "text": "Text", "password": "Passwort", "new_password": "Neues Passwort", "status": "Status", "reason": "Grund",
    "description": "Beschreibung", "note": "Notiz", "username": "Benutzername", "display_name": "Anzeigename",
    "comment": "Kommentar", "phone": "Telefon", "topic": "Thema", "content": "Inhalt", "excerpt": "Auszug",
    "location": "Ort", "city": "Ort", "postal_code": "PLZ", "address": "Adresse", "first_name": "Vorname",
    "last_name": "Nachname", "birthday": "Geburtstag", "team_name": "Teamname", "gamertag": "Gamertag",
}

ROOTS = {"body", "query", "path", "header", "cookie"}


def _field(loc: Any) -> str:
    parts = [str(part) for part in (loc or ()) if not isinstance(part, int)]
    if len(parts) > 1 or (parts and parts[0] not in ROOTS):
        return parts[-1]
    return ""


def _text(error: dict) -> tuple[str, str | None]:
    """(Satz ohne Feld, eigener Satz ohne Feld oder None) - der zweite Wert gilt, wenn das Feld kein Wort hat."""
    kind = str(error.get("type") or "")
    ctx = error.get("ctx") or {}
    msg = str(error.get("msg") or "")
    if kind == "string_too_long":
        return f"höchstens {ctx.get('max_length')} Zeichen", None
    if kind == "string_too_short":
        if int(ctx.get("min_length") or 0) <= 1:
            return "bitte ausfüllen", "Bitte ausfüllen"
        return f"mindestens {ctx.get('min_length')} Zeichen", None
    if kind == "missing":
        return "bitte ausfüllen", "Pflichtangabe fehlt"
    if kind in {"int_parsing", "int_from_float", "int_type"}:
        return "bitte eine ganze Zahl eingeben", None
    if kind in {"float_parsing", "float_type", "decimal_parsing", "finite_number"}:
        return "bitte eine Zahl eingeben", None
    if kind == "greater_than_equal":
        return f"mindestens {ctx.get('ge')}", None
    if kind == "less_than_equal":
        return f"höchstens {ctx.get('le')}", None
    if kind == "greater_than":
        return f"muss größer als {ctx.get('gt')} sein", None
    if kind == "less_than":
        return f"muss kleiner als {ctx.get('lt')} sein", None
    if kind == "string_pattern_mismatch":
        return "Format stimmt nicht", None
    if kind in {"literal_error", "enum"}:
        return "dieser Wert ist nicht erlaubt", None
    if kind == "too_long":
        return f"höchstens {ctx.get('max_length')} Einträge", None
    if kind == "too_short":
        return f"mindestens {ctx.get('min_length')} Einträge", None
    if kind == "bool_parsing":
        return "bitte ja oder nein angeben", None
    if kind in {"url_parsing", "url_type", "url_scheme"}:
        return "bitte eine gültige Adresse (https://…) eingeben", None
    if kind.startswith(("date", "datetime", "time")):
        return "bitte ein gültiges Datum eingeben", None
    if kind == "json_invalid":
        return "die Anfrage ist kein gültiges JSON", None
    if kind == "value_error":
        if "email" in msg.lower():
            return "bitte eine gültige E-Mail-Adresse eingeben", None
        # Eigene Prüfungen (Passwortregeln u. a.) melden schon deutsch - nur das Präfix von Pydantic muss weg.
        own = msg.split("Value error, ", 1)[1] if msg.startswith("Value error, ") else ""
        if own:
            return own, own
    if kind == "assertion_error" and msg.startswith("Assertion failed, "):
        own = msg.split("Assertion failed, ", 1)[1]
        return own, own
    if kind in {"string_type", "int_type", "bool_type", "dict_type", "list_type", "model_type", "model_attributes_type", "none_required"}:
        return "Eingabe ungültig", None
    # Eigene Fehlerarten (etwa „password_policy“) melden schon deutsch und bleiben, wie sie sind.
    return "", msg


def german_message(error: dict) -> str:
    text, own = _text(error)
    if not text:
        return own
    field = _field(error.get("loc"))
    label = FIELD_LABELS.get(field)
    if label:
        sentence = f"{label}: {text}"
    elif own is not None and (error.get("type") in {"value_error", "assertion_error"} or not field):
        sentence = own
    else:
        lead = (own or text)
        lead = lead[:1].upper() + lead[1:]
        sentence = f"{lead} ({field})" if field else lead
    return sentence if sentence.endswith((".", "!", "?")) else sentence + "."


def germanize(errors: list[dict]) -> list[dict]:
    """Jede Fehlerzeile mit deutschem `msg` - der Rest bleibt."""
    out = []
    for error in errors:
        row = dict(error)
        try:
            row["msg"] = german_message(error)
        except Exception:  # noqa: BLE001 - lieber der englische Text als gar keine Antwort
            pass
        out.append(row)
    return out
