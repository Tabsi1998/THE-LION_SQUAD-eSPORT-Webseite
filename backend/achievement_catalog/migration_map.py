"""Abbildung alt → neu (#611): welche alte Gruppe in welcher neuen aufgeht.

Ein Eintrag ``"alte_gruppe": "neue_gruppe"`` heißt: bestehende Vergaben werden über die Zähler der neuen
Gruppe neu ausgewertet, die höchste erreichte neue Stufe bekommt das ursprüngliche Datum, kein zweites
Fest. ``"alte_gruppe": None`` heißt: die Gruppe hat kein Gegenstück, ihre Vergaben bleiben als
„Vermächtnis“ sichtbar. Die Kataloge A–D (#612–#615) tragen ihre Gruppen hier ein; der Start wendet die
Abbildung einmal an (services/achievement_migration.py).
"""

GROUP_MAPPING: dict[str, str | None] = {}
