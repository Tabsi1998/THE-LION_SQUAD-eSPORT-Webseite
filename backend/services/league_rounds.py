"""Runden ≤ aktive Wochen (docs/LIGA.md, Abschnitt 5) - reine Rechnung ohne Importe aus dem Projekt.

Ein Blatt-Modul, damit Spielplan (``custom_bracket``), Turnierstart (``tournament_lifecycle_routes``) und Liga-Service
dieselbe Prüfung nutzen, ohne einander zu importieren.
"""
from __future__ import annotations


def rounds_needed(teams: int, legs: int) -> int:
    """Spieltage jeder gegen jeden: n−1 bei gerader, n bei ungerader Zahl (ein Team hat spielfrei), je Runde."""
    teams = max(int(teams or 0), 0)
    if teams < 2:
        return 0
    return (teams - 1 if teams % 2 == 0 else teams) * max(int(legs or 1), 1)


def max_teams_for(active_weeks: int, legs: int) -> int:
    """Die größte Staffel, deren Spieltage in ``active_weeks`` passen."""
    best = 0
    for teams in range(2, 41):
        if rounds_needed(teams, legs) <= active_weeks:
            best = teams
    return best


def rounds_problem(teams: int, legs: int, weeks_total: int, blocked: list[int]) -> str | None:
    """Prüfung „Runden ≤ aktive Wochen“ - ``None`` heißt passt, sonst die Meldung mit Hinweis auf eine zweite Staffel."""
    active = int(weeks_total or 0) - len(blocked or [])
    needed = rounds_needed(teams, legs)
    if needed <= active:
        return None
    fits = max_teams_for(active, legs)
    legs_text = "Hin- und Rückrunde" if int(legs or 1) == 2 else "nur Hinrunde"
    hint = (f" Bitte die Staffelgröße auf höchstens {fits} senken und die übrigen Teams auf eine zweite Staffel "
            f"verteilen - oder mehr Wochen einplanen." if fits >= 2 else " Bitte mehr Wochen einplanen.")
    return (f"Mit bis zu {teams} Teams ({legs_text}) braucht die Staffel {needed} Spielwochen, die Season hat aber "
            f"nur {active} aktive Wochen ({weeks_total} Wochen, davon {len(blocked or [])} gesperrt).{hint}")
