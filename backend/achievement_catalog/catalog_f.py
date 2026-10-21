"""Erfolge, Katalog F (#1750): Abzeichen aus externen Wettbewerben - Referenzen und abgeschlossene Saisons.

Entscheidung des Obmanns (Epic #1762): externe Ergebnisse zählen in der Jahreswertung nur als Abzeichen, nie mit
Punkten. Die Abzeichen sind normale Vereins-Erfolge (nur für Mitglieder) mit den XP ihrer Stufe; Saisonpunkte entstehen
dabei keine. Gezählt wird aus den Referenzen je Eintrag, in dem die Person steht (services/achievement_counters.py,
Abschnitt „Externe Wettbewerbe“).
"""
from __future__ import annotations

from .catalog_a import _group

REPLACED: dict[str, str] = {}
REDEFINED: tuple[str, ...] = ()


def _f(*args, **kwargs):
    return _group(*args, catalog="F", **kwargs)


EXTERNAL = [
    _f("external_podium", "Podest extern", "club", "Steh bei externen Turnieren und Ligen auf dem Podest.",
       "Platz 1, 2 oder 3 in einer Referenz des Vereins - als Team oder im Einzel; jeder Eintrag zählt einmal.",
       "medal", "trophy-case", "external_podiums", [1, 3, 7, 15, 30], "{n} Podestplätze bei externen Wettbewerben.",
       sort_order=930),
    _f("external_seasons", "Dauerbrenner", "club", "Spiel externe Ligen und Serien Saison für Saison zu Ende.",
       "Eine abgeschlossene Saison mit Endplatz, in der du für den Verein gespielt hast - jede Saison zählt einmal.",
       "calendar-range", "calendar-link", "external_seasons", [1, 3, 5, 10, 20],
       "{n} externe Saisons zu Ende gespielt.", sort_order=931),
]
for _external_group, _external_tiers in EXTERNAL:
    _external_group["member_only"] = True
    for _tier in _external_tiers:
        _tier["member_only"] = True

GROUPS_F: list[dict] = [group for group, _tiers in EXTERNAL]
TIERS_F: list[dict] = [t for _group, tiers in EXTERNAL for t in tiers]
