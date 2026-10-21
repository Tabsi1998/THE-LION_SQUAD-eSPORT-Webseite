"""Team-Liga im Ergebnisblatt (#1931) - ohne Datenbank: was ein Spiel über Ergebnis, Maps und Aufstellung hinaus trägt.

``series_results.resolve`` ruft das je Spiel und je Map auf. Gespeichert wird nur, was angegeben ist - ein Blatt ohne
diese Angaben bleibt genau wie bisher:

- **Map:** Name (Freitext) und optional ``map_id`` - die Kennung aus einer späteren Map-Bibliothek je Spiel (#1616), die
  hier schon mitgespeichert wird, damit die Bibliothek ohne Umbau andocken kann. Die **Rolle** im Veto: ``banned``
  (gesperrt, ohne Ergebnis), ``picked`` (gewählt), ``decider`` (die übrig gebliebene) oder ``played`` (gespielt, ohne
  Angabe zur Wahl - so gilt jede Map ohne Rolle). ``by`` sagt bei Bann und Wahl, wer: ``own`` (wir) oder ``opponent``.
  Gespielte Maps tragen das Ergebnis (``home_score``/``away_score``) und optional eine eigene Aufstellung (``lineup``).
  Die Reihenfolge der Liste ist die des Vetos.
- **Aufstellung des Spiels:** die Vereinigung aus der Aufstellung des Spiels und denen der Maps - wer eine Map gespielt
  hat, hat das Spiel gespielt.
- **Termin des Spiels:** ``club_day`` (Wiener Tag) und ``time`` („HH:MM“ Wiener Zeit), mit beidem dazu ``starts_at`` in
  UTC - etwa aus der eingefügten Begegnungsliste des Veranstalters. Ohne Tag gilt der Tag des Termins.

Das eigene Spiel und die übrigen Spiele des Spieltags stehen gemeinsam in ``matches``; welches das eigene ist, sagen die
eigenen Teams der Saison (``own_teams.Matcher``, ``own_match``). So rechnet die Tabelle aus allen eingetragenen Spielen.
"""
from __future__ import annotations

import math

from services.own_teams import Matcher
from services.reference_calendar import ClockError, clock_gap_message, vienna_start

ROLES = ("banned", "picked", "decider", "played")
SIDES = ("own", "opponent")
MAX_MAP_ID = 80


def _clean(value) -> str:
    return " ".join(str(value or "").split())


def _score(value):
    number = float(value or 0)
    return int(number) if math.isfinite(number) and number.is_integer() else number


def union(*lists) -> list[str]:
    """Kennungen aus mehreren Listen, jede einmal, in der Reihenfolge ihres ersten Auftretens."""
    return list(dict.fromkeys(pid for items in lists for pid in items or [] if pid))


def is_played(item: dict) -> bool:
    """Gespielt ist jede Map außer einer gesperrten - auch eine ohne Rolle (so sind ältere Blätter gespeichert)."""
    return item.get("role") != "banned"


def map_entry(raw: dict, lineup: list[str] | None) -> dict:
    """Eine Map des Blatts: Name, Ergebnis (nicht bei Bann) und - nur wenn angegeben - Kennung, Rolle, wer und
    Aufstellung."""
    out: dict = {"name": _clean(raw.get("name"))[:80]}
    map_id = _clean(raw.get("map_id"))[:MAX_MAP_ID]
    if map_id:
        out["map_id"] = map_id
    role = raw.get("role") if raw.get("role") in ROLES else None
    if role:
        out["role"] = role
    if role in ("banned", "picked") and raw.get("by") in SIDES:
        out["by"] = raw["by"]
    if role != "banned":
        out["home_score"] = _score(raw.get("home_score"))
        out["away_score"] = _score(raw.get("away_score"))
        if lineup:
            out["lineup"] = lineup
    return out


def own_matches(sheet: dict, teams) -> list[dict]:
    """Alle Spiele eigener Teams im Blatt, in der Reihenfolge des Blatts (``teams``: die eigenen Teams oder ein Name) -
    spielen zwei eigene Teams am selben Spieltag, sind es zwei. Ohne eigene Teams gilt das erste Spiel mit dem
    Heimteam als eigenes (so legt das Ergebnis-Blatt ein Spiel an). ``_own`` nennt das eigene Team, ``_away`` sagt, ob
    es auswärts spielt, ``_index`` die Stelle im Blatt."""
    own = Matcher(teams if isinstance(teams, (list, tuple)) else [teams])
    matches = sheet.get("matches") or []
    others = [str(match.get(side) or "").strip() for match in matches for side in ("home", "away")]
    found = []
    for index, match in enumerate(matches):
        home, away = str(match.get("home") or "").strip(), str(match.get("away") or "").strip()
        if not own:
            return [{**match, "_own": home, "_index": index}]
        if own.is_own(home, others):
            found.append({**match, "_own": own.canonical(home, others), "_index": index})
        elif own.is_own(away, others):
            found.append({**match, "_away": True, "_own": own.canonical(away, others), "_index": index})
    return found


def own_match(sheet: dict, teams) -> dict | None:
    """Das erste Spiel eines eigenen Teams im Blatt (``own_matches``) - oder ``None``."""
    found = own_matches(sheet, teams)
    return found[0] if found else None


def match_extras(raw: dict) -> tuple[dict, str | None]:
    """Termin eines Spiels: ``(Felder, Meldung)`` - die Meldung, wenn es die Uhrzeit an dem Tag in Wien nicht gibt
    (dann ohne Termin)."""
    out: dict = {}
    day, clock = raw.get("day") or None, raw.get("time") or None
    if day:
        out["club_day"] = day
    if clock:
        out["time"] = clock
    if day and clock:
        try:
            out["starts_at"] = vienna_start(day, clock)
        except ClockError:
            return {}, clock_gap_message(day, clock)
    return out, None
