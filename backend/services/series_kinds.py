"""Art-Profil je Spur-Art (#2024): was eine Art zeigt, wie sie spricht und womit eine neue Saison startet - an einer
Stelle statt verstreuter Weichen in Web, App und Server.

Ein Profil hat vier Teile:

- ``fields``: welche Felder es gibt - Ort, Land (Flagge), Läufe, Gegner, Rennergebnis (Startnummer, Startplatz, Zeit,
  Abstand, Strafsekunden), schnellste Runde und Fahrer des Tages, F1-Boni (schnellste Runde, Pole, Ausfall),
  Teamwertung, Turniertag mit Runden, Double Up, Namen ohne Tag, die Marken im Ergebnisblatt und ob ein gewerteter
  Termin ein Datum braucht.
- ``vocab``: die Begriffe - Termin (Einzahl, Mehrzahl, „von 9 …“), Person, nächster Termin, Kürzel-Vorsatz,
  Überschriften, Wendungen der Gesamtwertung („seit dem Turniertag davor“).
- ``default_rules``: die Regeln, mit denen eine neue Saison ohne Vorlage startet (vollständig, ``normalize_rules``).
  Bestehende Saisons behalten ihre Regeln - ein Profil ändert nie still eine gespeicherte Saison.
- ``templates``: die Punkteschema-Vorlagen, die zur Art passen (``reference_series.POINTS_SCHEME_TEMPLATES``), dazu
  ``placeholders`` und ``examples`` für die Formulare.

Ausgeliefert wird das Profil mit der Übersicht der Verwaltung (alle Arten), der Saison in der Verwaltung, dem
Ausgangsstand zum Eintragen, der Serienseite und „Läuft gerade“. Web und App lesen es; fehlt es (ältere Antwort),
gilt dort das bisherige Verhalten.

**So kommt ein neues Spiel dazu:** Passt es zu einer vorhandenen Art (Rennen mit Plätzen → ``racing``, Turniertage mit
Runden → ``series``, Spiele Team gegen Team → ``team_league``), reicht im Admin eine neue Spur dieser Art samt Vorlage.
Braucht es eigene Begriffe oder Felder, ist es ein neuer Eintrag in ``PROFILES`` (und in ``SERIES_KINDS``); nur ein
ganz neues Feld oder eine neue Rechnung muss programmiert werden. Siehe ``docs/entwicklung/serien-ergebnisse.md``.
"""
from __future__ import annotations

import copy

from services.scoring_rules import normalize_rules

FIELD_KEYS = ("venue", "country", "session", "opponent", "race_details", "race_extras", "race_bonuses",
              "team_scoring", "start_number", "day_rounds", "double_up", "name_tags", "marks", "result_needs_day",
              "original_kinds")
VOCAB_KEYS = ("round_one", "round_many", "round_dative", "progress_verb", "next_round", "code_prefix",
              "person_one", "person_many", "club_people", "place_title", "standings_label", "team_scoring",
              "venue_label", "no_round", "open_round", "since_previous", "after_first")

# Turnierserie (TFT): Tagesplatz nach der Summe der Runden, Saisonpunkte je Tagesplatz wie im Abnahmefall aus #1961.
TFT_SEASON_POINTS = [35, 30, 26, 23, 20, 18, 16, 14, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 1, 1, 1, 1, 1]
TFT_RULES = {
    "points_mode": "scheme", "points_by_place": TFT_SEASON_POINTS,
    "tiebreakers": ["wins", "top_n", "countback"], "tiebreak_top_n": 4,
    "day_rounds": {"count": 5, "points_by_place": [8, 7, 6, 5, 4, 3, 2, 1]},
    "double_up": False, "double_up_points": "best_player_place",
}

_COMMON_VOCAB = {"no_round": "Noch kein Termin", "open_round": "Termin folgt"}

PROFILES: dict[str, dict] = {
    "racing": {
        "label": "Rennliga",
        "fields": {"venue": True, "country": True, "session": True, "opponent": False, "race_details": True,
                   "race_extras": True, "race_bonuses": True, "team_scoring": True, "start_number": True,
                   "day_rounds": False, "double_up": False, "name_tags": False,
                   "marks": ["dnf", "dns", "dsq", "fastest_lap", "pole"], "result_needs_day": True,
                   "original_kinds": ["qualifying", "sprint", "race", "table", "other"]},
        "vocab": {"round_one": "Rennen", "round_many": "Rennen", "round_dative": "Rennen",
                  "progress_verb": "gewertet", "next_round": "Nächstes Rennen", "code_prefix": "R",
                  "person_one": "Fahrer", "person_many": "Fahrer", "club_people": "Vereinsfahrer",
                  "place_title": "Bester Fahrer", "standings_label": "Fahrerwertung", "team_scoring": "Teamwertung",
                  "venue_label": "Strecke oder Ort", "since_previous": "seit der Runde davor",
                  "after_first": "nach der ersten gewerteten Runde", **_COMMON_VOCAB},
        "default_rules": {},
        "templates": ["organizer", "formula_1"],
        "placeholders": {"lineage_title": "Lion Racing F1", "lineage_label": "F1", "round_code": "R1"},
        "examples": {"calendar_paste": "R1 · 05.11. · Strecke\nR2 · 12.11. 20:00 · Strecke\nR3 Strecke",
                     "season_table": "Pos Fahrer Team R1 R2 R3 Pkt"},
    },
    "series": {
        "label": "Turnierserie",
        "fields": {"venue": False, "country": False, "session": False, "opponent": False, "race_details": False,
                   "race_extras": False, "race_bonuses": False, "team_scoring": False, "start_number": False,
                   "day_rounds": True, "double_up": True, "name_tags": True, "marks": ["dns", "dsq", "left"],
                   "result_needs_day": True, "original_kinds": ["scoreboard", "table", "other"]},
        "vocab": {"round_one": "Turniertag", "round_many": "Turniertage", "round_dative": "Turniertagen",
                  "progress_verb": "gewertet", "next_round": "Nächster Turniertag", "code_prefix": "T",
                  "person_one": "Spieler", "person_many": "Spieler", "club_people": "Vereinsspieler",
                  "place_title": "Gesamtwertung", "standings_label": "Gesamtwertung", "team_scoring": "Double Up",
                  "venue_label": "", "since_previous": "seit dem Turniertag davor",
                  "after_first": "nach dem ersten gewerteten Turniertag", **_COMMON_VOCAB},
        "default_rules": TFT_RULES,
        "templates": ["organizer", "tft"],
        "placeholders": {"lineage_title": "TFT Masters", "lineage_label": "TFT", "round_code": "T1"},
        "examples": {"calendar_paste": "T1 · offen\nT2 · 12.11. 20:00\nT3",
                     "season_table": "Pos Spieler T1 T2 T3 Pkt"},
    },
    "team_league": {
        "label": "Team-Liga",
        "fields": {"venue": True, "country": True, "session": False, "opponent": True, "race_details": False,
                   "race_extras": False, "race_bonuses": False, "team_scoring": False, "start_number": True,
                   "day_rounds": False, "double_up": False, "name_tags": False,
                   "marks": ["dnf", "dns", "dsq", "fastest_lap", "pole"], "result_needs_day": False,
                   "original_kinds": ["scoreboard", "table", "other"]},
        "vocab": {"round_one": "Spieltag", "round_many": "Spieltage", "round_dative": "Spieltagen",
                  "progress_verb": "gespielt", "next_round": "Nächster Spieltag", "code_prefix": "T",
                  "person_one": "Spieler", "person_many": "Spieler", "club_people": "Vereinsspieler",
                  "place_title": "Tabelle", "standings_label": "Gesamtwertung", "team_scoring": "Tabelle",
                  "venue_label": "Ort", "since_previous": "seit dem Spieltag davor",
                  "after_first": "nach dem ersten gewerteten Spieltag", **_COMMON_VOCAB},
        "default_rules": {},
        "templates": ["organizer", "team_league_3_1_0"],
        "placeholders": {"lineage_title": "Lion Liga", "lineage_label": "4vs4", "round_code": "ST1"},
        "examples": {"calendar_paste": "ST1 · 13.05.2026 20:30 · vs Team A\nST2 · 20.05.–24.05. · @ Team B\n"
                                       "ST3 · 27.05. · vs Team C",
                     "season_table": "Pos Spieler Team R1 R2 R3 Pkt"},
    },
}
FALLBACK_KIND = "series"


def kind_of(kind) -> str:
    """Die Art mit Profil - eine unbekannte oder fehlende gilt als Turnierserie (die allgemeinste Art)."""
    return kind if kind in PROFILES else FALLBACK_KIND


def default_rules(kind) -> dict:
    """Vollständige Standardregeln einer neuen Saison dieser Art."""
    return normalize_rules(copy.deepcopy(PROFILES[kind_of(kind)]["default_rules"]))


def profile(kind) -> dict:
    """Das ganze Profil (eine Kopie) mit vollständigen Standardregeln - für die Verwaltung."""
    key = kind_of(kind)
    out = copy.deepcopy(PROFILES[key])
    out["kind"] = key
    out["default_rules"] = default_rules(key)
    return out


def public_profile(kind) -> dict:
    """Was öffentliche Seiten brauchen: Art, Name, Felder und Begriffe - ohne Regeln und Vorlagen."""
    full = profile(kind)
    return {key: full[key] for key in ("kind", "label", "fields", "vocab")}


def all_profiles() -> dict[str, dict]:
    return {kind: profile(kind) for kind in PROFILES}


def shows(kind, field: str) -> bool:
    """Führt diese Art das Feld (``fields``)?"""
    return bool(PROFILES[kind_of(kind)]["fields"].get(field))


def word(kind, key: str) -> str:
    return PROFILES[kind_of(kind)]["vocab"][key]
