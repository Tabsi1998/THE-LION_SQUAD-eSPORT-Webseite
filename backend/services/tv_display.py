"""TV und Beamer (#1110-#1114): Grundwerte für alle Bildschirme und der Anzeige-Schlüssel für den Turnierbaum-TV.

Grundwerte: stehen in ``settings`` unter ``tv_display`` und sind ohne Anmeldung lesbar - nichts Geheimes darin, und
die TV-Seiten laufen ohne Anmeldung. Ein einzelner Bildschirm weicht über Werte im Link ab (Link-Baukasten im Admin,
dieselben Namen als Parameter). Was fehlt oder nicht passt, ist der Standard: Fabians Wahl aus der TV-Vorschau vom
07.10.2026. Regeln für alle TV-Tickets: immer nur ein Moment gleichzeitig (Ergebnis und Champion gehen vor), Ton ist
überall standardmäßig aus - es gongt nur, wo „Ton beim Ergebnis“ (#1118) oder „Gong beim Aufruf“ (#1122)
eingeschaltet ist. Meilenstein 60 bringt die Wiedergabeliste des Turnierbaum-TVs (#1121), die Aufrufe (#1122), die Zahlen
zwischendurch (#1124), die Sponsoren am TV (#1125) und den Streckenwechsel bei Meisterschaften (#1127).

Anzeige-Schlüssel: ein Speziallink (``access_links``) mit der einzigen Freigabe ``display`` für genau ein Turnier.
Gespeichert wird wie bei allen Speziallinks nur der Hash; den Schlüssel selbst sieht der Admin einmal beim Anlegen.
Er öffnet nur die TV-Daten dieses Turniers - keine Turnierseite, keine Anmeldung, kein Ergebnis - und ist im Admin
widerrufbar. Die Antwort für den Schlüssel ist schmaler als die für die Turnierleitung: nur, was der TV zeigt.
"""
from __future__ import annotations

import copy
from datetime import datetime, timedelta
from urllib.parse import urlencode

from services.access_links import parse_dt

SETTINGS_ID = "tv_display"

# Die Folien der Wiedergabeliste (#1121): Turnierbaum, laufende Spiele, Aufrufe, Sponsor und Zahlen. Sponsor und Zahlen
# kommen „zwischendurch“ - höchstens so oft, wie „Sponsoren am TV“ und „Zahlen zwischendurch“ es sagen.
PLAYLIST_SLIDES: tuple = ("tree", "live", "calls", "sponsor", "stats")
PLAYLIST_SECONDS: tuple = (3, 120)
DEFAULT_PLAYLIST: tuple = (
    {"slide": "tree", "seconds": 12},
    {"slide": "live", "seconds": 8},
    {"slide": "calls", "seconds": 8},
    {"slide": "sponsor", "seconds": 6},
    {"slide": "stats", "seconds": 8},
)

# Standard je Wert - die Reihenfolge ist die der Admin-Seite.
DEFAULTS: dict = {
    "text_size": "normal",   # Schrift (#1111): normal | large - „groß“ hebt alle Untergrenzen um die Hälfte an
    "contrast": False,       # Kontrast-Modus (#1112): kräftige Schrift, volle Farben, dickere Linien
    "safe_area": 0,          # Sicherer Bereich (#1112): Abstand zum Bildrand in Prozent, 0 | 3 | 5
    "pixel_shift": True,     # Pixel-Verschiebung (#1112): alle paar Minuten 1 bis 3 Punkte, gegen eingebrannte Logos
    "season_header": True,   # Jahreszeiten in der TV-Kopfleiste (#1114)
    "reduce_motion": False,  # Bewegung reduzieren (#1110): zusätzlich zur Einstellung des Geräts
    "result_sound": False,   # Ton beim Ergebnis (#1118): ein kurzer Gong, Standard aus (Fabians Wahl „ohne Ton“)
    # Wiedergabeliste (#1121): Reihenfolge und Dauer je Folie, Standard aus der TV-Vorschau.
    "playlist": [dict(entry) for entry in DEFAULT_PLAYLIST],
    "call_sound": False,        # Gong beim Aufruf (#1122): Standard aus
    "report_minutes": 2,        # Zeit zum Antreten (#1122): so lange läuft der Countdown, wenn das Spiel keine Uhrzeit hat
    "stats": True,              # Zahlen zwischendurch (#1124): an ...
    "stats_every": 10,          # ... höchstens alle 10 Minuten
    "sponsor_moment": True,     # Sponsoren am TV (#1125), Fabians Wahl C: Sponsor-Moment an ...
    "sponsor_every": 3,         # ... höchstens alle 3 Minuten,
    "sponsor_presented": True,  # „Runde 2 präsentiert von“ an,
    "sponsor_ticker": False,    # Laufband unten aus
    "track_seconds": 45,        # Streckenwechsel bei Meisterschaften (#1127): alle 45 Sekunden, wählbar 20 bis 120
}
CHOICES: dict = {
    "text_size": ("normal", "large"),
    "safe_area": (0, 3, 5),
}
# Ganze Zahlen mit Unter- und Obergrenze.
RANGES: dict = {
    "report_minutes": (1, 30),
    "stats_every": (1, 60),
    "sponsor_every": (1, 60),
    "track_seconds": (20, 120),
}
BOOLEANS: tuple = ("contrast", "pixel_shift", "season_header", "reduce_motion", "result_sound", "call_sound", "stats",
                   "sponsor_moment", "sponsor_presented", "sponsor_ticker")

DISPLAY_GRANT = "display"
KEY_LABEL_MAX = 80
KEY_INVALID = "Dieser TV-Link gilt nicht mehr. Im Admin unter eSports → TV & Beamer einen neuen Link erstellen."
KEY_DAYS_AFTER = 7
KEY_EXPIRED = ("Dieser TV-Link ist abgelaufen: TV-Links enden eine Woche nach dem Turnier von selbst. "
               "Im Admin unter eSports → TV & Beamer einen neuen Link erstellen.")


def key_expires_at(tournament: dict | None) -> datetime | None:
    """Bis wann ein Anzeige-Schlüssel gilt (Entscheidung vom 07.10.2026): eine Woche nach Turnierende, ohne Ende eine
    Woche nach dem Start, ohne Termin bis zum Widerruf. Gerechnet wird beim Öffnen - wird das Turnier verschoben,
    wandert das Ende mit."""
    for field in ("end_date", "start_date"):
        moment = parse_dt((tournament or {}).get(field))
        if moment:
            return moment + timedelta(days=KEY_DAYS_AFTER)
    return None


def key_expired(tournament: dict | None, now: datetime) -> bool:
    until = key_expires_at(tournament)
    return bool(until and now > until)


def valid_playlist(value) -> bool:
    """Eine Wiedergabeliste: eine bis fünf Folien, jede höchstens einmal, je 3 bis 120 Sekunden."""
    if not isinstance(value, list) or not 1 <= len(value) <= len(PLAYLIST_SLIDES):
        return False
    seen = set()
    low, high = PLAYLIST_SECONDS
    for entry in value:
        if not isinstance(entry, dict) or set(entry) != {"slide", "seconds"}:
            return False
        slide, seconds = entry.get("slide"), entry.get("seconds")
        if slide not in PLAYLIST_SLIDES or slide in seen or type(seconds) is not int or not low <= seconds <= high:
            return False
        seen.add(slide)
    return True


def valid_value(key: str, value) -> bool:
    """Passt der Wert? Wahrheitswerte nur als echte true/false, Auswahlwerte nur aus der Liste (0 ist nicht false),
    Zahlen nur ganz und in ihren Grenzen, die Wiedergabeliste nur mit bekannten Folien."""
    if key in BOOLEANS:
        return isinstance(value, bool)
    if key in CHOICES:
        return type(value) is type(DEFAULTS[key]) and value in CHOICES[key]
    if key in RANGES:
        low, high = RANGES[key]
        return type(value) is int and low <= value <= high
    if key == "playlist":
        return valid_playlist(value)
    return False


def merge(stored: dict | None) -> dict:
    """Gespeicherte Werte über dem Standard - nur, was es gibt und was passt."""
    merged = copy.deepcopy(DEFAULTS)
    for key, value in (stored or {}).items():
        if key in DEFAULTS and valid_value(key, value):
            merged[key] = copy.deepcopy(value)
    return merged


def public_payload(stored: dict | None) -> dict:
    """Was die TV-Seiten und der Admin lesen: die geltenden Werte, der Standard und wann zuletzt gespeichert."""
    stored = stored or {}
    return {
        "settings": merge(stored),
        "defaults": copy.deepcopy(DEFAULTS),
        "choices": {key: list(values) for key, values in CHOICES.items()},
        "ranges": {key: list(values) for key, values in RANGES.items()},
        "playlist_slides": list(PLAYLIST_SLIDES),
        "playlist_seconds": list(PLAYLIST_SECONDS),
        "updated_at": stored.get("updated_at"),
    }


def display_path(tournament_id: str, token: str) -> str:
    """Die Adresse des Turnierbaum-TVs mit Schlüssel - Grundwerte und Abweichungen hängt der Baukasten an."""
    return f"/display/bracket/{tournament_id}?{urlencode({'key': token})}"


def key_label(value: str | None) -> str:
    cleaned = " ".join(str(value or "").split())[:KEY_LABEL_MAX]
    return cleaned or "Bildschirm"


# ------------------------------------------------------------------ Antwort für den Schlüssel
# Nur, was der TV zeigt. Keine Konten (user_id, Benutzername, Bild), keine Notizen, keine Nachweise. Die Startzeit
# braucht das Live-Spotlight (#1116, Spielzeit „12:34“), die Zeit des Ergebnisses der Ergebnis-Moment (#1118).
# Meilenstein 60: „aufgerufen um“ für die Aufruf-Tafel (#1122); Pause bis, Anmelde- und Check-in-Zeitraum und die
# Platzzahl für Pause-, Check-in- und Anmelde-Bildschirm (#1123); die Sponsoren je Runde (#1125). Für den Check-in
# kommen alle bestätigten Anmeldungen mit Namen und Stand („da“ oder nicht) - nie mit Konto, Bild oder Notiz.

TOURNAMENT_FIELDS = ("id", "slug", "title", "status", "format", "format_label", "format_display_name",
                     "public_phase", "start_date", "end_date", "team_mode", "paused_until", "registration_enabled",
                     "is_invite_only", "registration_open_from", "registration_open_until", "check_in_from",
                     "check_in_until", "max_participants", "round_sponsors")
STAGE_FIELDS = ("id", "name", "number", "stage_type", "match_type")
MATCH_FIELDS = ("id", "tournament_id", "stage_id", "stage_number", "stage_type", "match_type", "match_key", "section",
                "round", "round_name", "matchday_number", "matchday_label", "order", "match_index", "status",
                "scheduled_at", "started_at", "completed_at", "duration_minutes", "station_id", "station_name",
                "station_label", "winner_id", "is_preview", "called_at")
# Wer zum Check-in zählt (#1123) und wer einen Platz belegt (wie die Anmeldung: offen, bestätigt, eingecheckt).
CHECKIN_STATUSES = ("approved", "checked_in")
SEAT_STATUSES = ("pending", "approved", "checked_in")
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


def seat_summary(tournament: dict | None, registrations: list[dict] | None) -> dict:
    """Wie viele Plätze belegt sind und wie viele es gibt - für „Noch 6 von 16 Plätzen frei“ (#1123). Nur Zahlen."""
    taken = sum(1 for reg in registrations or [] if reg.get("status") in SEAT_STATUSES)
    try:
        capacity = int((tournament or {}).get("max_participants") or 0) or None
    except (TypeError, ValueError):
        capacity = None
    return {"taken": taken, "capacity": capacity}


def display_bracket_payload(payload: dict) -> dict:
    """Die Turnierbaum-Antwort für einen Anzeige-Schlüssel: Turnier, Phasen, Spiele, die Namen der Anmeldungen, die in
    einem Spiel stehen oder zum Check-in zählen, und die Zahl der belegten Plätze - mehr braucht der TV nicht."""
    matches = [_display_match(match) for match in payload.get("matches_v2") or []]
    wanted = _referenced_registrations(matches)
    all_registrations = payload.get("registrations") or []
    registrations = [
        {"id": reg.get("id"), "display_name": reg.get("display_name") or reg.get("ingame_name"), "ingame_name": reg.get("ingame_name"),
         "status": reg.get("status")}
        for reg in all_registrations
        if reg.get("id") in wanted or reg.get("status") in CHECKIN_STATUSES
    ]
    tournament = payload.get("tournament") or {}
    return {
        "tournament": _pick(tournament, TOURNAMENT_FIELDS),
        "registrations": registrations,
        "stages": [_pick(stage, STAGE_FIELDS) for stage in payload.get("stages") or []],
        "matches": [],
        "matches_v2": matches,
        "engine": payload.get("engine"),
        "seats": seat_summary(tournament, all_registrations),
        "display_key": True,
    }


# ------------------------------------------------------------------ Was nur ein Turnier betrifft
# „Pause bis“ (#1123) und der Sponsor je Runde (#1125) stehen beim Turnier, nicht unter TV & Beamer. Die Felder sind
# allgemein gehalten: Die App kann dieselben Werte zeigen („Pause bis 14:30“, „Runde 2 präsentiert von …“).

PAUSE_MAX_HOURS = 24
PAUSE_TOO_LATE = "„Pause bis“ darf höchstens 24 Stunden in der Zukunft liegen."
PAUSE_INVALID = "„Pause bis“ ist keine gültige Uhrzeit."
ROUND_SPONSOR_MAX = 64
ROUND_SPONSOR_TWICE = "Jede Runde kann nur einen Sponsor haben."
ROUND_SPONSOR_NOT_TV = "Für „präsentiert von“ gehen nur aktive Sponsoren mit dem Haken „TV / Anzeige“."


def pause_until_value(raw, now: datetime) -> str | None:
    """„Pause bis“ als Zeitpunkt in UTC - leer heißt „Kurze Pause“ ohne Uhrzeit. Eine Zeit in der Vergangenheit ist
    erlaubt (der TV sagt dann „Gleich geht es weiter“), eine mehr als 24 Stunden entfernte ist ein Tippfehler."""
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return None
    moment = parse_dt(raw)
    if not moment:
        raise ValueError(PAUSE_INVALID)
    if moment > now + timedelta(hours=PAUSE_MAX_HOURS):
        raise ValueError(PAUSE_TOO_LATE)
    return moment.astimezone(now.tzinfo).isoformat() if now.tzinfo else moment.isoformat()


def round_key(stage_id, section, round_number) -> tuple:
    """Eine Runde: Phase, Bereich (Winner Bracket, Loser Bracket …) und Nummer - so wie die Spiele sie tragen."""
    return (str(stage_id or ""), str(section or "").upper(), int(round_number or 0))


def round_sponsor_rows(items: list[dict], tv_sponsor_ids: set[str]) -> list[dict]:
    """Die Sponsoren je Runde prüfen: jede Runde einmal, nur Sponsoren aus der TV-Liste („TV / Anzeige“, aktiv)."""
    rows: list[dict] = []
    seen: set[tuple] = set()
    for item in items:
        key = round_key(item.get("stage_id"), item.get("section"), item.get("round"))
        if key in seen:
            raise ValueError(ROUND_SPONSOR_TWICE)
        if item.get("sponsor_id") not in tv_sponsor_ids:
            raise ValueError(ROUND_SPONSOR_NOT_TV)
        seen.add(key)
        rows.append({"stage_id": key[0] or None, "section": key[1] or None, "round": key[2], "sponsor_id": item["sponsor_id"]})
    return rows
