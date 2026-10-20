"""Ist ein Turnier für alle sichtbar? Die eine Regel, als Blatt-Modul ohne Importe.

Sie stand in ``tournament_streams`` (#579) und gilt dort weiter. Die Live-Meldungen (``change_events``, #1801) nennen
das Turnier nur unter derselben Regel - ein Import aus ``tournament_streams`` schlösse dort einen Import-Kreis.
"""


def public_tournament(tournament: dict | None) -> bool:
    """Kein Entwurf, nicht als „nicht öffentlich“ markiert und Sichtbarkeit öffentlich."""
    return bool(tournament) and tournament.get("status") != "draft" and tournament.get("is_public") is not False \
        and (tournament.get("visibility") or "public") == "public"
