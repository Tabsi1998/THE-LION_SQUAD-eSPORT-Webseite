"""Vorlagen für Ergebnis-Bilder (#1756): je Veranstalter-Layout einmal festgelegt, welche Spalten es gibt, wie ihre
Kopfzeile heißt, wo sie ungefähr liegen und was im Kopf des Bilds steht.

Eine Vorlage ist reine Beschreibung - gelesen wird in ``result_image_ocr``, abgeglichen in ``result_image_match``.

- ``columns``: Reihenfolge von links nach rechts. ``field`` ist der Name in der Antwort (``place``, ``start_number``,
  ``name``, ``team``, ``grid``, ``time``, ``gap``), ``kind`` sagt, wie gelesen wird (``place``, ``number``, ``text``,
  ``time``, ``gap``), ``labels`` sind die Überschriften, an denen die Spalte im Bild wiedererkannt wird (leer: keine
  Überschrift), ``align`` die Ausrichtung des Inhalts und ``at`` die Lage des Ankers (linker Rand, Mitte oder rechter
  Rand) als Anteil der Tabellenbreite - zwischen dem Anker der ersten (0) und der letzten Spalte (1). Zugeordnet wird
  zuerst aus den Daten (``result_image_ocr.plan_columns``: Spalten des Bilds nach Inhalt, in dieser Reihenfolge);
  ``align`` und ``at`` braucht es nur, wenn das nicht aufgeht. ``needs_label``: die Spalte gilt nur, wenn ihre
  Überschrift im Bild steht (Punkte - sonst landen etwa Strafsekunden oder der Rand der Tabelle darin).
- ``time_format``: wie der Veranstalter Zeiten schreibt (``decimals``: Nachkommastellen). Die Trennzeichen setzt diese
  Form, nicht das gelesene Zeichen (``result_image_values.parse_clock``); geliefert wird wie gespeichert mit Punkt.
- ``header``: die Zeilen über der Tabelle. ``session`` ist die Art der Sitzung (eines der Wörter, etwa „Rennen“ oder
  „Qualifying“), ``track`` die oberste Zeile ohne eigene Beschriftung (ohne die Art);
  ``fastest_lap``, ``pole`` und ``driver_of_the_day`` haben ihren Wert hinter einer der ``labels`` oder darunter.
- ``background``: „dark“ (helle Schrift auf dunklem Grund - wird umgekehrt), „light“ oder „auto“.
- ``needs``: Felder, die in mindestens der Hälfte der Zeilen einen Wert haben müssen - sonst ist das Bild kein
  Ergebnis dieser Art (etwa eine Saisontabelle oder der Kalender) und wird abgelehnt.
- ``min_confidence``: darunter (0-100, Sicherheit der Texterkennung je Wort) gilt eine Zelle als unsicher.
- ``name_match``/``name_sure``: ab welcher Ähnlichkeit (0-1) ein gelesener Name einem bekannten Teilnehmer zugeordnet
  wird und ab wann ohne gelbe Markierung; ``team_match`` dasselbe für Teams (wenige und bekannt, darum niedriger).
  ``name_margin``: so viel ähnlicher als der Zweitbeste muss ein Name bzw. Team sein, damit er grün ist (#2012) - zwei
  Teilnehmer, die sich nur in l/1 unterscheiden, sind so nie eindeutig.

Welche Vorlage gilt, legt der Vorstand je Spur (``reference_lineages.result_image_template``) und - abweichend - je
Saison (``reference_series.result_image_template``) fest. Ohne Festlegung gilt die Standard-Vorlage der Art (Rennliga:
„Rennliga-Ergebnis (dunkel)“); ``NONE`` schaltet das Auslesen für die Spur oder Saison ab. Die Auswahl im Web steht in
``frontend/src/lib/referenceSeries.js`` (``RESULT_IMAGE_TEMPLATES``) - eine neue Vorlage gehört an beide Stellen.
"""
from __future__ import annotations

import copy

NONE = "none"
DEFAULT_ID = "rennliga-dunkel"

TEMPLATES: tuple[dict, ...] = (
    {
        "id": DEFAULT_ID,
        "name": "Rennliga-Ergebnis (dunkel)",
        "description": "Kopf mit Strecke, Art (Rennen, Qualifying), schnellster Rennrunde, Pole und Fahrer des Tages; "
                       "Spalten Pos, Startnummer, Name, Team, Grid, Time, Gap, Punkte (fehlende Spalten bleiben leer); "
                       "DNF oder OUT statt Platz; dunkler Hintergrund.",
        "kinds": ["racing"],
        "background": "dark",
        "header": {
            "track": {"labels": ["Strecke", "Track", "Circuit"]},
            "session": {"labels": ["Rennen", "Hauptrennen", "Sprint", "Sprintrennen", "Qualifying", "Quali", "Race",
                                   "Feature"]},
            "fastest_lap": {"labels": ["Schnellste Rennrunde", "Schnellste Runde", "Fastest Lap"]},
            "pole": {"labels": ["Pole", "Pole Position"]},
            "driver_of_the_day": {"labels": ["Fahrer des Tages", "Driver of the Day"]},
        },
        "columns": [
            {"field": "place", "kind": "place", "labels": ["Pos", "Pos.", "Platz", "Pl."], "align": "center",
             "at": 0.0},
            {"field": "start_number", "kind": "number", "labels": ["Nr.", "Nr", "No.", "#"], "align": "center",
             "at": 0.061},
            {"field": "name", "kind": "text", "labels": ["Name", "Fahrer", "Driver"], "align": "left", "at": 0.114},
            {"field": "team", "kind": "text", "labels": ["Team"], "align": "left", "at": 0.395},
            {"field": "grid", "kind": "number", "labels": ["Grid", "Start"], "align": "center", "at": 0.667},
            {"field": "time", "kind": "time", "labels": ["Time", "Zeit"], "align": "right", "at": 0.825},
            {"field": "gap", "kind": "gap", "labels": ["Gap", "Abstand", "Interval"], "align": "right", "at": 1.0},
            {"field": "points", "kind": "number", "labels": ["Punkte", "Pkt", "Pkt.", "Points", "Pts"],
             "align": "right", "at": 1.12, "needs_label": True},
        ],
        # Rennzeit „m:ss,mmm“ bzw. „mm:ss,mmm“, Abstand „+s,mmm“ bzw. „+m:ss,mmm“ (#1981).
        "time_format": {"decimals": 3},
        "needs": ["time"],
        "min_confidence": 80,
        "name_match": 0.72,
        "name_sure": 0.9,
        "name_margin": 0.1,
        "team_match": 0.6,
    },
)
DEFAULT_BY_KIND = {"racing": DEFAULT_ID}


def get(template_id: str | None) -> dict | None:
    """Eine Kopie der Vorlage oder ``None``."""
    for template in TEMPLATES:
        if template["id"] == template_id:
            return copy.deepcopy(template)
    return None


def ids() -> list[str]:
    return [template["id"] for template in TEMPLATES]


def effective_id(series: dict | None, lineage: dict | None) -> str | None:
    """Welche Vorlage gilt: die der Saison, sonst die der Spur, sonst die Standard-Vorlage der Art. ``None`` heißt: kein
    Auslesen (abgeschaltet oder für diese Art gibt es keine Vorlage)."""
    for chosen in ((series or {}).get("result_image_template"), (lineage or {}).get("result_image_template")):
        if chosen == NONE:
            return None
        if chosen and get(chosen):
            return chosen
    return DEFAULT_BY_KIND.get((lineage or {}).get("kind"))


def summary(template: dict | None) -> dict | None:
    if not template:
        return None
    return {"id": template["id"], "name": template["name"],
            "fields": [column["field"] for column in template["columns"]],
            "header": sorted(template.get("header") or {})}
