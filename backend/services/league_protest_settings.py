"""Season-Einstellungen für Beanstandung, Protest, Einspruch und MOSS (E.2, #1619; docs/LIGA.md, „D.5/E.2-Vertrag“, „Season-Felder“).

Blatt-Modul ohne Datenbank. Die Felder stehen flach an ``league_seasons`` und an der Staffel (``tournaments``); zur Laufzeit zählt der
Wert der Staffel, ohne Feld der der Season, ohne beides die Vorgabe aus ``league_presets.PRESETS``. Übertragen wird in der Gruppe
``protests`` von ``league_service.SYNC_GROUPS``. Jedes Verfahren speichert seine berechneten Fristen - eine geänderte Einstellung
wirkt nur auf neue Fälle.
"""
from __future__ import annotations

import copy

from services.league_presets import PRESETS

# Die vier Gründe von „Problem melden“ (``match_disputes.CATEGORIES``, auch in der App): Sie bleiben in jeder Liste - hier als eigene
# Konstante, damit dieses Modul ein Blatt bleibt (``match_disputes`` liest die Einstellungen für das Fenster der Liga).
CATEGORIES = {"wrong_result": "Falsches Ergebnis", "rule_violation": "Regelverstoß", "technical": "Technik", "other": "Sonstiges"}

# Feld → (kleinster, größter Wert, Bezeichnung für die Meldung)
NUMBERS: dict[str, tuple[int, int, str]] = {
    "protest_hours": (1, 336, "Die Protestfrist"),
    "statement_hours": (1, 336, "Die Frist für die Stellungnahme"),
    "protest_target_hours": (1, 720, "Die Zielfrist der Leitung"),
    "appeal_hours": (1, 336, "Die Einspruchsfrist"),
    "moss_upload_hours": (1, 168, "Die Frist für die MOSS-Datei"),
    "evidence_keep_days": (0, 365, "Die Aufbewahrung der Nachweise"),
}
MODES = ("counts", "excluded")
FIELDS: tuple[str, ...] = (*NUMBERS, "protest_reasons", "contested_result_mode")
REASONS_MAX = 20
REASON_LABEL_MAX = 60
REASON_KEY_MAX = 40
REASON_KEY_CHARS = frozenset("abcdefghijklmnopqrstuvwxyz0123456789_")
# Der Grund, der das Ergebnis selbst betrifft: Dazu gehört das abweichende Ergebnis (Nr. 130).
RESULT_REASON = "wrong_result"


class SettingsProblem(Exception):
    def __init__(self, detail: str, status_code: int = 422):
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


def _number(key: str, value) -> int:
    low, high, label = NUMBERS[key]
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise SettingsProblem(f"{label} muss eine ganze Zahl von {low} bis {high} sein.")
    return value


def _reasons(value) -> list[dict]:
    if not isinstance(value, list) or not 1 <= len(value) <= REASONS_MAX:
        raise SettingsProblem(f"Bitte 1 bis {REASONS_MAX} Gründe angeben.")
    out: list[dict] = []
    seen: set[str] = set()
    for row in value:
        if not isinstance(row, dict):
            raise SettingsProblem("Jeder Grund braucht einen Schlüssel und eine Bezeichnung.")
        key = str(row.get("key") or "").strip().lower()
        label = " ".join(str(row.get("label") or "").split())
        if not key or len(key) > REASON_KEY_MAX or not set(key) <= REASON_KEY_CHARS:
            raise SettingsProblem("Der Schlüssel eines Grundes besteht aus Kleinbuchstaben, Ziffern und Unterstrich (höchstens "
                                  f"{REASON_KEY_MAX} Zeichen).")
        if key in seen:
            raise SettingsProblem("Jeder Grund darf nur einmal vorkommen.")
        if not label or len(label) > REASON_LABEL_MAX:
            raise SettingsProblem(f"Jeder Grund braucht eine Bezeichnung mit höchstens {REASON_LABEL_MAX} Zeichen.")
        seen.add(key)
        out.append({"key": key, "label": label, "ask_notified": bool(row.get("ask_notified"))})
    missing = [CATEGORIES[key] for key in CATEGORIES if key not in seen]
    if missing:
        # „Problem melden“ der App ohne neuen Build schickt weiter diese vier Schlüssel.
        raise SettingsProblem("Diese Gründe müssen in der Liste bleiben: " + ", ".join(missing) + ".")
    return out


def normalize(raw: dict) -> dict:
    """Alle Felder geprüft und in fester Form - fehlt eines, gilt die Vorgabe."""
    out: dict = {}
    for key in NUMBERS:
        out[key] = _number(key, raw.get(key, PRESETS[key]))
    mode = raw.get("contested_result_mode", PRESETS["contested_result_mode"])
    if mode not in MODES:
        raise SettingsProblem("Bitte wählen, ob ein angefochtenes Ergebnis vorläufig zählt oder bis zur Entscheidung nicht.")
    out["contested_result_mode"] = mode
    out["protest_reasons"] = _reasons(raw.get("protest_reasons", PRESETS["protest_reasons"]))
    return out


def defaults() -> dict:
    return {key: copy.deepcopy(PRESETS[key]) for key in FIELDS}


def stored(source: dict | None) -> dict | None:
    """Was an Season oder Staffel wirklich steht - ``None``, wenn sie keines der Felder trägt (ältere Season)."""
    found = {key: (source or {})[key] for key in FIELDS if key in (source or {})}
    return found or None


def _valid(key: str, value) -> bool:
    try:
        if key in NUMBERS:
            _number(key, value)
        elif key == "contested_result_mode":
            return value in MODES
        else:
            _reasons(value)
    except SettingsProblem:
        return False
    return True


def effective(tournament: dict | None, season: dict | None) -> dict:
    """Die geltenden Werte: Staffel, sonst Season, sonst Vorgabe - je Feld, ungültig Gespeichertes zählt nicht."""
    out = defaults()
    for key in FIELDS:
        for source in (tournament, season):
            if key in (source or {}) and _valid(key, source[key]):
                out[key] = copy.deepcopy(source[key])
                break
    return out


def reason_of(settings: dict, key: str | None) -> dict | None:
    return next((row for row in settings.get("protest_reasons") or [] if row.get("key") == key), None)


def reason_label(settings: dict, key: str | None) -> str:
    row = reason_of(settings, key)
    return row["label"] if row else CATEGORIES.get(str(key or ""), CATEGORIES["other"])
