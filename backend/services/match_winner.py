"""Wer hat ein Spiel gewonnen (#1796) - eine Regel für alle Sieg-Erfolge, egal auf welchem Weg das Ergebnis kam.

Die Wege schreiben verschieden:
- Eingetragene Ergebnisse in ``matches_v2`` (Leitung, Helfer, Spielermeldung mit Bestätigung, Ergebnis-Fenster,
  Wertung „nicht erschienen“, Läufe/FFA) tragen je Teilnehmer nur ``rank`` (dazu Stand, ``forfeit``, ``dnf``) -
  kein ``outcome``. Gleichstand, wo erlaubt, ist ein geteilter Platz 1.
- Ältere Daten und der Turnierbaum (``competition_snapshot``) schreiben ``outcome`` (winner/loser/draw/forfeit/dnf/placed).
- Die alte Engine kennt den Sieger nur als ``winner_id`` am Spiel.

Reihenfolge: ``outcome`` zuerst (wo eins steht, gilt es), dann ``winner_id``, dann der alleinige Platz 1. Ein geteilter
Platz 1 oder mehrere „winner“ sind ein Unentschieden; wer aufgegeben hat oder nicht ins Ziel kam, gewinnt nie; ein
Freilos (weniger als zwei Seiten) ist auf keinem Weg ein Sieg.
Duell-Erfolge (Zu Null, Entscheider, Comeback, Favoritenschreck) fragen zusätzlich ``is_duel``: genau zwei Seiten.
"""
from __future__ import annotations


def _rank(result: dict) -> int | None:
    try:
        return int(result.get("rank"))
    except (TypeError, ValueError):
        return None


def participant_ids(match: dict | None) -> set[str]:
    """Alle belegten Seiten eines Spiels - aus den Plätzen (``slots``) und dem Ergebnis."""
    match = match or {}
    ids = {slot.get("registration_id") for slot in match.get("slots") or [] if isinstance(slot, dict)}
    ids |= {row.get("registration_id") for row in match.get("results") or [] if isinstance(row, dict)}
    return {str(reg) for reg in ids if reg}


def is_duel(match: dict | None) -> bool:
    """Genau zwei Seiten: Duell bzw. Bo-Serie. Nur dort gibt es Zu Null, Entscheider, Comeback, Favoritenschreck."""
    return len(participant_ids(match)) == 2


def match_winner_id(match: dict | None) -> str | None:
    """Die Anmeldung, die das Spiel gewonnen hat - ``None`` bei Unentschieden, Freilos oder ohne Ergebnis."""
    match = match or {}
    # Freilos bzw. kampflos ohne Gegner: weniger als zwei Seiten - auf keinem Weg ein Sieg, auch nicht mit
    # ``outcome`` oder ``winner_id``.
    if len(participant_ids(match)) < 2:
        return None
    results = [row for row in match.get("results") or [] if isinstance(row, dict) and row.get("registration_id")]
    if any(row.get("outcome") for row in results):
        winners = {row["registration_id"] for row in results
                   if row.get("outcome") == "winner" and not row.get("forfeit") and not row.get("dnf")}
        return next(iter(winners)) if len(winners) == 1 else None
    # ``matches_v2`` schreibt heute kein ``winner_id`` (PATCH verwirft es, die Wertung „nicht erschienen“ leitet daraus
    # Plätze ab); der Rückgriff gilt für ältere oder übernommene Spiele der alten Engine.
    if match.get("winner_id"):
        return str(match["winner_id"])
    firsts = [row["registration_id"] for row in results if _rank(row) == 1 and not row.get("forfeit") and not row.get("dnf")]
    shared = sum(1 for row in results if _rank(row) == 1)
    return firsts[0] if len(firsts) == 1 and shared == 1 else None


def won_by(match: dict | None, registration_ids) -> bool:
    """Hat eine der Anmeldungen das Spiel gewonnen?"""
    winner = match_winner_id(match)
    return winner is not None and winner in set(registration_ids or ())
