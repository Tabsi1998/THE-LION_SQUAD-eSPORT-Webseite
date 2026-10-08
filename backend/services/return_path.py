"""Wohin es nach Registrieren und Mail-Bestätigung geht (#1225).

Dieselbe Prüfregel wie im Web (frontend/src/lib/returnPath.js): erlaubt ist nur ein Pfad auf dieser Website, der mit
genau einem „/“ beginnt - kein „//“, keine Adresse mit Schema, kein Backslash, keine Steuerzeichen, höchstens 512
Zeichen. Alles andere wird verworfen; dann führt die Seite zum Dashboard.
"""
from __future__ import annotations

MAX_LENGTH = 512


def safe_next_path(value) -> str | None:
    """Das geprüfte Ziel - oder ``None``, wenn es keines auf dieser Website ist."""
    if not isinstance(value, str) or not value or len(value) > MAX_LENGTH:
        return None
    if not value.startswith("/") or value.startswith("//"):
        return None
    if "\\" in value or any(ord(char) < 32 or ord(char) == 127 for char in value):
        return None
    return value
