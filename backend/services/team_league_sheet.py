"""Team-Liga im Ergebnisblatt (#1931) - ohne Datenbank: was ein Spiel über Ergebnis, Maps und Aufstellung hinaus trägt.

``series_results.resolve`` ruft das je Spiel auf. Gespeichert wird nur, was angegeben ist - ein Blatt ohne diese Angaben
bleibt genau wie bisher:

- **Map:** ``picked_by`` - wer sie gewählt hat (``home``, ``away`` oder ``decider``, die übrig gebliebene Map) - und
  optional eine eigene Aufstellung (``lineup``, Kennungen wie beim Spiel). Die Aufstellung des Spiels ist dann die
  Vereinigung aus der Aufstellung des Spiels und denen der Maps: wer eine Map gespielt hat, hat das Spiel gespielt.
- **Banns:** ``bans`` - gesperrte Maps mit der Seite, die sie gesperrt hat (``home``, ``away`` oder offen).
- **Termin des Spiels:** ``club_day`` (Wiener Tag) und ``time`` („HH:MM“ Wiener Zeit), mit beidem dazu ``starts_at`` in
  UTC - etwa aus der eingefügten Begegnungsliste des Veranstalters. Ohne Tag gilt der Tag des Termins.

Das eigene Spiel und die übrigen Spiele des Spieltags stehen gemeinsam in ``matches``; welches das eigene ist, sagen die
eigenen Teams der Saison (``own_teams.Matcher``). So rechnet die Tabelle aus allen eingetragenen Spielen.
"""
from __future__ import annotations

from services.reference_calendar import ClockError, clock_gap_message, vienna_start

PICKS = ("home", "away", "decider")
BAN_SIDES = ("home", "away")
MAX_BANS = 15


def _clean(value) -> str:
    return " ".join(str(value or "").split())


def union(*lists) -> list[str]:
    """Kennungen aus mehreren Listen, jede einmal, in der Reihenfolge ihres ersten Auftretens."""
    return list(dict.fromkeys(pid for items in lists for pid in items or [] if pid))


def map_extras(raw: dict, lineup: list[str] | None) -> dict:
    """Wahl und Aufstellung einer Map - nur, was angegeben ist."""
    out = {}
    if raw.get("picked_by") in PICKS:
        out["picked_by"] = raw["picked_by"]
    if lineup:
        out["lineup"] = lineup
    return out


def bans(raw: dict) -> list[dict]:
    out = []
    for item in (raw.get("bans") or [])[:MAX_BANS]:
        name = _clean((item or {}).get("name"))[:80]
        if name:
            side = item.get("by")
            out.append({"name": name, "by": side if side in BAN_SIDES else None})
    return out


def match_extras(raw: dict) -> tuple[dict, str | None]:
    """Banns und Termin eines Spiels: ``(Felder, Meldung)`` - die Meldung, wenn es die Uhrzeit an dem Tag in Wien nicht
    gibt (dann ohne Termin)."""
    out: dict = {}
    found = bans(raw)
    if found:
        out["bans"] = found
    day, clock = raw.get("day") or None, raw.get("time") or None
    if day:
        out["club_day"] = day
    if clock:
        out["time"] = clock
    if day and clock:
        try:
            out["starts_at"] = vienna_start(day, clock)
        except ClockError:
            return {key: value for key, value in out.items() if key == "bans"}, clock_gap_message(day, clock)
    return out, None
