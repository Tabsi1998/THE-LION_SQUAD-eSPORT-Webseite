"""Referenzen aus einer Saison (#1750): woher eine Referenz kommt, damit ihre Karte zur Saison-Seite führt.

Eine Referenz gehört zu einer Saison, wenn sie selbst darauf zeigt (``series_id``, Auswahl „Gehört zur Saison“) oder die
Saison sie als ihre Referenz vermerkt (``reference_id``, entsteht beim Abschluss). ``season_link`` trägt nur, was die
Karte braucht: Adresse von Spur und Saison, die Bezeichnung („Probe Liga · 2026 · Division 2“) und ``season_end`` -
ob es die Referenz des Saisonabschlusses ist, deren Endplatz in der Saison gepflegt wird. Nach außen nur, wenn Spur und
Saison für den Besucher sichtbar und nicht archiviert sind; sonst ``None``. Gesammelt geladen, nie je Referenz.
"""
from __future__ import annotations

from services.visibility import user_can_see

SERIES_FIELDS = {"_id": 0, "id": 1, "lineage_id": 1, "season": 1, "tier": 1, "season_slug": 1, "status": 1,
                 "visibility": 1, "reference_id": 1}
LINEAGE_FIELDS = {"_id": 0, "id": 1, "title": 1, "slug": 1, "visibility": 1, "is_archived": 1}


def season_label(lineage: dict, series: dict) -> str:
    return " · ".join(part for part in (lineage.get("title"), series.get("season"), series.get("tier")) if part)


async def attach_season_links(db, items: list[dict], user: dict | None) -> list[dict]:
    ids = [item["id"] for item in items if item.get("id")]
    if not ids:
        return items
    wanted = {item.get("series_id") for item in items if item.get("series_id")}
    by_id = {row["id"]: row async for row in db.reference_series.find(
        {"$or": [{"id": {"$in": list(wanted)}}, {"reference_id": {"$in": ids}}]}, SERIES_FIELDS)}
    closing = {row["reference_id"]: row for row in by_id.values() if row.get("reference_id")}
    lineages = {row["id"]: row async for row in db.reference_lineages.find(
        {"id": {"$in": list({row.get("lineage_id") for row in by_id.values()})}}, LINEAGE_FIELDS)} if by_id else {}
    seen: dict = {}

    async def visible(level) -> bool:
        if level not in seen:
            seen[level] = await user_can_see(user, level)
        return seen[level]

    for item in items:
        series = by_id.get(item.get("series_id")) or closing.get(item.get("id"))
        lineage = lineages.get((series or {}).get("lineage_id"))
        item["season_link"] = None
        if not series or not lineage or lineage.get("is_archived") or series.get("status") == "archived":
            continue
        if not await visible(lineage.get("visibility")) or not await visible(series.get("visibility")):
            continue
        item["season_link"] = {"lineage_slug": lineage.get("slug"), "season_slug": series.get("season_slug"),
                               "label": season_label(lineage, series),
                               "season_end": series.get("reference_id") == item["id"]}
    return items
