"""TV und Beamer (#1110-#1114): Grundwerte für alle Bildschirme und der Anzeige-Schlüssel für den Turnierbaum-TV.

Grundwerte: stehen in ``settings`` unter ``tv_display`` und sind ohne Anmeldung lesbar - nichts Geheimes darin, und
die TV-Seiten laufen ohne Anmeldung. Ein einzelner Bildschirm weicht über Werte im Link ab (Link-Baukasten im Admin,
dieselben Namen als Parameter). Was fehlt oder nicht passt, ist der Standard: Fabians Wahl aus der TV-Vorschau vom
07.10.2026. Regeln für alle TV-Tickets: immer nur ein Moment gleichzeitig (Ergebnis und Champion gehen vor), Ton ist
überall standardmäßig aus. Weitere Werte (Wiedergabeliste #1121, Sponsoren #1125, Streckenwechsel #1127) kommen mit
ihren Tickets dazu.

Anzeige-Schlüssel: ein Speziallink (``access_links``) mit der einzigen Freigabe ``display`` für genau ein Turnier.
Gespeichert wird wie bei allen Speziallinks nur der Hash; den Schlüssel selbst sieht der Admin einmal beim Anlegen.
Er öffnet nur die TV-Daten dieses Turniers - keine Turnierseite, keine Anmeldung, kein Ergebnis - und ist im Admin
widerrufbar. Die Antwort für den Schlüssel ist schmaler als die für die Turnierleitung: nur, was der TV zeigt.
"""
from __future__ import annotations

from urllib.parse import urlencode

SETTINGS_ID = "tv_display"

# Standard je Wert - die Reihenfolge ist die der Admin-Seite.
DEFAULTS: dict = {
    "text_size": "normal",   # Schrift (#1111): normal | large - „groß“ hebt alle Untergrenzen um die Hälfte an
    "contrast": False,       # Kontrast-Modus (#1112): kräftige Schrift, volle Farben, dickere Linien
    "safe_area": 0,          # Sicherer Bereich (#1112): Abstand zum Bildrand in Prozent, 0 | 3 | 5
    "pixel_shift": True,     # Pixel-Verschiebung (#1112): alle paar Minuten 1 bis 3 Punkte, gegen eingebrannte Logos
    "season_header": True,   # Jahreszeiten in der TV-Kopfleiste (#1114)
    "reduce_motion": False,  # Bewegung reduzieren (#1110): zusätzlich zur Einstellung des Geräts
}
CHOICES: dict = {
    "text_size": ("normal", "large"),
    "safe_area": (0, 3, 5),
}
BOOLEANS: tuple = ("contrast", "pixel_shift", "season_header", "reduce_motion")

DISPLAY_GRANT = "display"
KEY_LABEL_MAX = 80
KEY_INVALID = "Dieser TV-Link gilt nicht mehr. Im Admin unter eSports → TV & Beamer einen neuen Link erstellen."


def valid_value(key: str, value) -> bool:
    """Passt der Wert? Wahrheitswerte nur als echte true/false, Auswahlwerte nur aus der Liste (0 ist nicht false)."""
    if key in BOOLEANS:
        return isinstance(value, bool)
    if key in CHOICES:
        return type(value) is type(DEFAULTS[key]) and value in CHOICES[key]
    return False


def merge(stored: dict | None) -> dict:
    """Gespeicherte Werte über dem Standard - nur, was es gibt und was passt."""
    merged = dict(DEFAULTS)
    for key, value in (stored or {}).items():
        if key in DEFAULTS and valid_value(key, value):
            merged[key] = value
    return merged


def public_payload(stored: dict | None) -> dict:
    """Was die TV-Seiten und der Admin lesen: die geltenden Werte, der Standard und wann zuletzt gespeichert."""
    stored = stored or {}
    return {
        "settings": merge(stored),
        "defaults": dict(DEFAULTS),
        "choices": {key: list(values) for key, values in CHOICES.items()},
        "updated_at": stored.get("updated_at"),
    }


def display_path(tournament_id: str, token: str) -> str:
    """Die Adresse des Turnierbaum-TVs mit Schlüssel - Grundwerte und Abweichungen hängt der Baukasten an."""
    return f"/display/bracket/{tournament_id}?{urlencode({'key': token})}"


def key_label(value: str | None) -> str:
    cleaned = " ".join(str(value or "").split())[:KEY_LABEL_MAX]
    return cleaned or "Bildschirm"


# ------------------------------------------------------------------ Antwort für den Schlüssel
# Nur, was der TV zeigt. Keine Konten (user_id, Benutzername, Bild), keine Notizen, keine Nachweise.

TOURNAMENT_FIELDS = ("id", "slug", "title", "status", "format", "format_label", "format_display_name",
                     "public_phase", "start_date", "end_date", "team_mode")
STAGE_FIELDS = ("id", "name", "number", "stage_type", "match_type")
MATCH_FIELDS = ("id", "tournament_id", "stage_id", "stage_number", "stage_type", "match_type", "match_key", "section",
                "round", "round_name", "matchday_number", "matchday_label", "order", "match_index", "status",
                "scheduled_at", "duration_minutes", "station_id", "station_name", "station_label", "winner_id",
                "is_preview")
SLOT_FIELDS = ("slot", "registration_id", "status", "seed", "source")
SOURCE_FIELDS = ("type", "flow", "match_key", "rank", "seed", "raw")
RESULT_FIELDS = ("registration_id", "rank", "score", "points", "qualified")
MATCH_SETTING_FIELDS = ("match_size", "qualifiers_per_match", "duration_minutes")
STATION_FIELDS = ("id", "name", "label", "device_type", "status")


def _pick(doc: dict | None, fields: tuple) -> dict:
    return {key: doc[key] for key in fields if isinstance(doc, dict) and key in doc}


def _display_match(match: dict) -> dict:
    out = _pick(match, MATCH_FIELDS)
    out["slots"] = []
    for slot in match.get("slots") or []:
        row = _pick(slot, SLOT_FIELDS)
        if isinstance(slot.get("source"), dict):
            row["source"] = _pick(slot["source"], SOURCE_FIELDS)
        out["slots"].append(row)
    out["results"] = [_pick(row, RESULT_FIELDS) for row in match.get("results") or []]
    out["settings"] = _pick(match.get("settings") or {}, MATCH_SETTING_FIELDS)
    if isinstance(match.get("station"), dict):
        out["station"] = _pick(match["station"], STATION_FIELDS)
    return out


def _referenced_registrations(matches: list[dict]) -> set[str]:
    ids: set[str] = set()
    for match in matches:
        ids.update(slot.get("registration_id") for slot in match.get("slots") or [])
        ids.update(row.get("registration_id") for row in match.get("results") or [])
        ids.add(match.get("winner_id"))
    ids.discard(None)
    ids.discard("")
    return ids


def display_bracket_payload(payload: dict) -> dict:
    """Die Turnierbaum-Antwort für einen Anzeige-Schlüssel: Turnier, Phasen, Spiele und die Namen der Anmeldungen,
    die in einem Spiel stehen - mehr braucht der TV nicht."""
    matches = [_display_match(match) for match in payload.get("matches_v2") or []]
    wanted = _referenced_registrations(matches)
    registrations = [
        {"id": reg.get("id"), "display_name": reg.get("display_name") or reg.get("ingame_name"), "ingame_name": reg.get("ingame_name")}
        for reg in payload.get("registrations") or []
        if reg.get("id") in wanted
    ]
    return {
        "tournament": _pick(payload.get("tournament") or {}, TOURNAMENT_FIELDS),
        "registrations": registrations,
        "stages": [_pick(stage, STAGE_FIELDS) for stage in payload.get("stages") or []],
        "matches": [],
        "matches_v2": matches,
        "engine": payload.get("engine"),
        "display_key": True,
    }
