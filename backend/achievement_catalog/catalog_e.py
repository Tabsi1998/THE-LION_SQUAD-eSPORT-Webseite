"""Erfolge II, Katalog E (#678): Saison-Fundstücke - was man über die Jahreszeiten sammelt.

Drei Gruppen in der Kategorie Community, je fünf Stufen von Bronze bis Diamant. Die Zahlen kommen aus den Signalen,
die Web und App melden; der Server deckelt je Tag (30 Fledermäuse, 200 Schneeflocken), damit die oberen Stufen mehrere
Jahre brauchen und nicht einen Nachmittag. Türchenöffner und Eiersucher kommen mit dem Adventkalender (#641) und der
Eiersuche (#646) dazu - ohne die Aktion gäbe es dort nichts zu sammeln.
"""
from __future__ import annotations

from .catalog_a import _group

REPLACED: dict[str, str] = {}
REDEFINED: tuple[str, ...] = ()


def _e(*args, **kwargs):
    return _group(*args, catalog="E", **kwargs)


FINDS = [
    _e("bat_whisperer", "Fledermausflüsterer", "community", "Scheuch zu Halloween die Fledermäuse auf.",
       "In der Halloween-Woche die Fledermäuse anklicken, die an Menü, Karten und Überschriften hängen - höchstens 30 am Tag zählen.",
       "moon", "bat", "halloween_bats_scared", [5, 25, 100, 250, 500], "{n} Fledermäuse verscheucht.", sort_order=630),
    _e("snow_catcher", "Flockenfänger", "community", "Fang im Winter die Schneeflocke neben dem Logo.",
       "Vom 1. Advent bis Dreikönig die Schneeflocke neben dem Logo anklicken - höchstens 200 am Tag zählen.",
       "snowflake", "snow-catch", "snowflakes_clicked", [10, 50, 150, 400, 1000], "{n} Schneeflocken gefangen.", sort_order=631),
    _e("season_collector", "Jahreszeiten-Sammler", "community", "Sammle über alle Jahreszeiten - alles zählt zusammen.",
       "Fledermäuse, Geister, Schneeflocken, Türchen, Eier: jedes Fundstück aus jeder Jahreszeit zählt.",
       "package-open", "season-collector", "season_collectibles_total", [25, 100, 300, 750, 1500], "{n} Fundstücke gesammelt.", sort_order=632),
]

GROUPS_E: list[dict] = [group for group, _tiers in FINDS]
TIERS_E: list[dict] = [t for _group, tiers in FINDS for t in tiers]
CONDITION_KEYS_E: tuple[str, ...] = tuple(sorted({group["condition_key"] for group in GROUPS_E if group["condition_key"]}))
