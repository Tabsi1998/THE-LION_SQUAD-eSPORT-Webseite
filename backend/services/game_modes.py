"""Spielmodi: Zustand und Auswahl (#2206, Paket C.1 - Vertrag in docs/LIGA.md).

Ein Modus steht in ``games.match_modes[]`` und hat die Kennung ``mode`` als Identität. ``status`` fehlt = aktiv.

- **inaktiv**: steht für Neues nicht mehr zur Wahl - neuer Map-Pool, Modus je Map der Season, Spielmodus des Turniers.
- **archiviert**: dazu keine neue Zuordnung an Maps, und die Verwaltung blendet ihn in Auswahllisten aus.

„Neu“ heißt: vorher nicht gesetzt. Was schon gesetzt ist (``kept``), hält kein anderes Speichern auf - dasselbe Muster wie
``game_usage.chosen_is_archived``. Bestehende Spiele, festgehaltene Pools, ``effective_pool`` und die Dauerplanung lesen
den Zustand nicht. Bewusst ohne Importe aus dem Rest des Backends: ``game_maps`` und ``map_pools`` rufen diese Funktionen.
"""
from __future__ import annotations

import unicodedata
from typing import Iterable

ACTIVE = "active"
INACTIVE = "inactive"
ARCHIVED = "archived"
STATUSES = (ACTIVE, INACTIVE, ARCHIVED)
STATUS_WORDS = {ACTIVE: "aktiv", INACTIVE: "inaktiv", ARCHIVED: "archiviert"}


def _modes(game: dict | None) -> list[dict]:
    modes = (game or {}).get("match_modes")
    if not isinstance(modes, list):
        return []
    return [mode for mode in modes if isinstance(mode, dict) and mode.get("mode")]


def status_of(mode: dict | None) -> str:
    """Der Zustand eines Modus - alles Unbekannte und ein fehlendes Feld heißen aktiv."""
    value = (mode or {}).get("status")
    return value if value in (INACTIVE, ARCHIVED) else ACTIVE


def entries(game: dict | None) -> list[dict]:
    """Die Modi für Auswahllisten der Verwaltung: ``{mode, label, status}`` in ihrer Reihenfolge, dazu ``icon_url``, wenn der Modus
    ein Symbol hat (#2266)."""
    return [{"mode": mode["mode"], "label": mode.get("label") or mode["mode"], "status": status_of(mode),
             **({"icon_url": mode["icon_url"]} if mode.get("icon_url") else {})}
            for mode in _modes(game)]


def icon_of(game: dict | None, key: str | None) -> str | None:
    """Das Symbol eines Modus (#2266) - ``None`` ohne Symbol oder ohne den Modus."""
    for mode in _modes(game):
        if mode["mode"] == key:
            return mode.get("icon_url") or None
    return None


def choice_problem(game: dict | None, wanted: Iterable, kept: Iterable = (), *, inactive_ok: bool = False) -> str | None:
    """Wird ein Modus neu gewählt, der nicht mehr zur Wahl steht? Der deutsche Satz dazu, sonst ``None``.
    ``kept``: was schon gesetzt war. Unbekannte Kennungen prüft der Aufrufer wie bisher. ``inactive_ok``: nur
    archivierte sperren (Zuordnung an Maps)."""
    by_key = {mode["mode"]: mode for mode in _modes(game)}
    before = {str(key) for key in kept or () if key}
    for key in wanted or ():
        if not key or str(key) in before or str(key) not in by_key:
            continue
        mode = by_key[str(key)]
        status = status_of(mode)
        if status == ARCHIVED or (status == INACTIVE and not inactive_ok):
            label = mode.get("label") or mode["mode"]
            return (f"Der Modus „{label}“ ist {STATUS_WORDS[status]} und steht für Neues nicht mehr zur Wahl. "
                    "Auf der Spielseite (Spiele → Spiel → Modi) lässt er sich wieder aktivieren.")
    return None


def _label_key(value) -> str:
    text = unicodedata.normalize("NFKC", " ".join(str(value or "").split()))
    return text.casefold()


class ModeProblem(ValueError):
    """Eine Modusliste, die nicht passt - die Route macht daraus 422."""


def adopt_keys(entries_in: list[dict], given: list[bool], current: dict | None) -> list[dict]:
    """Ein Eintrag ohne Kennung, dessen Name einem bestehenden Modus gleicht, bekommt dessen Kennung (#2206) - so ändert
    ein Aufruf über die API, der nur Namen schickt, keine Kennung. Ein schon vergebener Schlüssel wird nie doppelt
    vergeben. Passt der Name zu mehreren noch freien Modi (Altbestand mit gleichen Namen), wird nicht geraten:
    ``ModeProblem``."""
    by_label: dict[str, list[str]] = {}
    for mode in _modes(current):
        by_label.setdefault(_label_key(mode.get("label")), []).append(mode["mode"])
    taken = {entry.get("mode") for entry, was_given in zip(entries_in, given) if was_given}
    out: list[dict] = []
    for entry, was_given in zip(entries_in, given):
        if not was_given:
            free = [key for key in by_label.get(_label_key(entry.get("label")), []) if key not in taken]
            if len(free) > 1:
                raise ModeProblem(f"Der Name „{entry.get('label')}“ passt zu mehreren Modi dieses Spiels - bitte die Kennung "
                                  "(mode) mitschicken.")
            if free:
                entry = {**entry, "mode": free[0]}
        taken.add(entry.get("mode"))
        out.append(entry)
    return out


def duplicate_name_problem(entries_in: list[dict] | None, current: dict | None = None) -> str | None:
    """Neue gleiche Namen innerhalb eines Spiels (ohne Groß und klein, Leerraum zusammengefasst) - der Satz für 422, sonst
    ``None``. Gleiche Namen, die das Spiel schon hatte, bleiben erlaubt, damit Altbestand speicherbar bleibt; nur mehr
    davon darf es nicht werden."""
    before: dict[str, int] = {}
    for mode in _modes(current):
        key = _label_key(mode.get("label"))
        before[key] = before.get(key, 0) + 1
    now: dict[str, int] = {}
    first: dict[str, str] = {}
    for entry in entries_in or []:
        key = _label_key(entry.get("label"))
        now[key] = now.get(key, 0) + 1
        first.setdefault(key, str(entry.get("label") or ""))
    for key, count in now.items():
        if count > 1 and count > before.get(key, 0):
            return f"Den Modus „{first[key]}“ gibt es in diesem Spiel schon - jeder Modus braucht einen eigenen Namen."
    return None
