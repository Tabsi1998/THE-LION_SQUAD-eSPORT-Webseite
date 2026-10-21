"""Anpassungen einer Saison (#1960) - ohne Datenbank: ±Punkte in der Gesamtwertung ohne Rennergebnis.

Beispiele aus Regelwerken externer Ligen: −5 Punkte für Nichtteilnahme nach Anmeldung, verspätete Ab- oder Anmeldung,
fehlendes Video - oder eine Korrektur der Teamwertung. Gespeichert wird je Saison eine Liste (``reference_series``,
Feld ``adjustments``); der Rechenkern (``series_standings.compute_standings``) zählt sie dazu.

- **Wer:** ein Teilnehmer (``kind = participant``) für die Fahrerwertung oder ein Team (``kind = team``) für die
  Teamwertung - eine Fahrer-Anpassung ändert die Teamwertung nicht, eine Team-Anpassung nicht die Fahrer.
- **Was:** Punkte (±, nie 0), Grund (öffentlich, kurz), Tag (Wiener Tag) und optional der Termin, um den es geht.
- **Ab wann:** mit Termin ab dem Stand dieses Termins (ist er nicht gewertet, ab dem nächsten gewerteten; gibt es
  keinen, im letzten Stand). Ohne Termin ab dem Stand, der an ihrem Tag galt (der letzte gewertete Termin an oder vor
  dem Tag, sonst der erste). So stimmt der aktuelle Stand immer, und frühere Stände ändern sich nicht nachträglich.
"""
from __future__ import annotations

import math
from datetime import date

KINDS = ("participant", "team")
MAX_POINTS = 1000
MAX_REASON = 200
MAX_ADJUSTMENTS = 500
PUBLIC_FIELDS = ("id", "points", "reason", "day", "round_id")


def _text(value) -> str:
    return " ".join(str(value or "").split())


def _points(value) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise ValueError("Punkte als Zahl, etwa -5.")
    try:
        number = float(str(value).strip().replace(",", "."))
    except ValueError as exc:
        raise ValueError("Punkte als Zahl, etwa -5.") from exc
    if not math.isfinite(number) or number == 0 or abs(number) > MAX_POINTS:
        raise ValueError(f"Punkte zwischen -{MAX_POINTS} und {MAX_POINTS}, nicht 0.")
    return int(number) if number.is_integer() else number


def _day(value) -> str:
    try:
        return date.fromisoformat(str(value or "").strip()).isoformat()
    except ValueError as exc:
        raise ValueError("Tag als JJJJ-MM-TT, etwa 2026-03-04.") from exc


def normalize(raw: dict) -> dict:
    """Eine Anpassung geprüft und bereinigt - ohne Kennung und Stempel (die setzt die Route). Wirft ``ValueError``."""
    if not isinstance(raw, dict):
        raise ValueError("Angaben zur Anpassung fehlen.")
    kind = raw.get("kind") or "participant"
    if kind not in KINDS:
        raise ValueError("Für einen Teilnehmer oder ein Team.")
    participant_id = _text(raw.get("participant_id")) or None
    team = _text(raw.get("team")) or None
    if kind == "participant" and not participant_id:
        raise ValueError("Teilnehmer fehlt.")
    if kind == "team" and not team:
        raise ValueError("Team fehlt.")
    if team and len(team) > 120:
        raise ValueError("Teamname höchstens 120 Zeichen.")
    reason = _text(raw.get("reason"))
    if not reason:
        raise ValueError("Grund fehlt.")
    if len(reason) > MAX_REASON:
        raise ValueError(f"Grund höchstens {MAX_REASON} Zeichen.")
    return {
        "kind": kind,
        "participant_id": participant_id if kind == "participant" else None,
        "team": team if kind == "team" else None,
        "points": _points(raw.get("points")),
        "reason": reason,
        "day": _day(raw.get("day")),
        "round_id": _text(raw.get("round_id")) or None,
    }


def team_key(name) -> str:
    """Teamname zum Vergleichen: Leerraum zusammengefasst, Groß/klein egal."""
    return _text(name).casefold()


def _anchor(adjustment: dict, scored: list[dict], position: dict[str, int]) -> int:
    """Ab welchem Stand (Index in ``scored``) die Anpassung zählt."""
    if not scored:
        return 0
    round_id = adjustment.get("round_id")
    if round_id in position:
        start = position[round_id]
        return next((index for index, item in enumerate(scored) if position.get(item["id"], -1) >= start),
                    len(scored) - 1)
    day = str(adjustment.get("day") or "")
    before = [index for index, item in enumerate(scored) if str(item.get("club_day") or "") and
              str(item.get("club_day")) <= day]
    return before[-1] if before else 0


def active_per_snapshot(adjustments, calendar: list[dict], scored: list[dict]) -> list[list[dict]]:
    """Je gewertetem Termin (``scored`` in Kalender-Reihenfolge) die Anpassungen, die in seinem Stand zählen.
    ``calendar``: alle Termine der Saison in Kalender-Reihenfolge (ohne archivierte) - für „ab diesem Termin“."""
    items = [item for item in adjustments or [] if isinstance(item, dict) and item.get("points")]
    position = {item["id"]: index for index, item in enumerate(calendar)}
    anchors = [(_anchor(item, scored, position), item) for item in items]
    return [[item for start, item in anchors if start <= index] for index in range(len(scored))]


def public(adjustment: dict) -> dict:
    """Was ein Stand von einer Anpassung trägt (und die Serienseite zeigt): Punkte, Grund, Tag, Termin."""
    return {key: adjustment.get(key) for key in PUBLIC_FIELDS}
