"""Partnerseite (#1934): „Ligen und Serien mit uns“ - Spuren und Saisons, an denen ein Partner beteiligt ist.

Nur sichtbare, nicht archivierte Spuren und Saisons; interne Spuren nie, auch nicht für den Vorstand. Der Platz des Vereins
kommt wie bei „Serien und Ligen“ der Übersicht aus dem letzten gespeicherten Stand (``reference_series_public_routes``),
für alle Saisons gesammelt geladen. Rollen und Erbe: ``services/series_partners.py``.
"""
from __future__ import annotations

from routes.reference_series_public_routes import _club_participant_ids, _club_place, _latest_snapshots, _natural
from services import series_logo
from services.series_partners import CONTRIBUTOR, ORGANIZER, effective
from services.visibility import user_can_see

# Auf der Partnerseite nie, egal wer schaut.
HIDDEN_ON_PARTNER_PAGE = {"internal"}
SEASON_FIELDS = ("season", "tier", "title", "season_slug", "status", "season_result")


async def for_partner(db, partner_id: str, user: dict | None) -> list[dict]:
    """„Ligen und Serien mit uns“ auf der Partnerseite: je Spur mit diesem Partner ihre Saisons (neueste zuerst) mit
    Status, „läuft gerade“ und dem Platz des Vereins - an der Spur alle Saisons, nur an einer Saison nur diese."""
    seen: dict = {}

    async def visible(level) -> bool:
        level = level or "public"
        if level in HIDDEN_ON_PARTNER_PAGE:
            return False
        if level not in seen:
            seen[level] = await user_can_see(user, level)
        return seen[level]

    own_seasons = [item async for item in db.reference_series.find(
        {"partner_ids": partner_id, "status": {"$ne": "archived"}}, {"_id": 0, "id": 1, "lineage_id": 1})]
    lineages = [item async for item in db.reference_lineages.find(
        {"is_archived": {"$ne": True},
         "$or": [{"partner_ids": partner_id}, {"id": {"$in": list({s["lineage_id"] for s in own_seasons})}}]},
        {"_id": 0, "id": 1, "title": 1, "slug": 1, "kind": 1, "label": 1, "game_id": 1, "game_name": 1,
         "visibility": 1, "order_index": 1, "partner_ids": 1, "partner_roles": 1, "logo_url": 1})]
    lineages = [item for item in lineages if await visible(item.get("visibility"))]
    if not lineages:
        return []
    by_lineage: dict = {item["id"]: [] for item in lineages}
    async for series in db.reference_series.find(
            {"lineage_id": {"$in": list(by_lineage)}, "status": {"$ne": "archived"}},
            {"_id": 0, "id": 1, "lineage_id": 1, "visibility": 1, "team_name": 1, "own_teams": 1, "order_index": 1,
             "partner_ids": 1, "partner_roles": 1, "logo_url": 1, **{key: 1 for key in SEASON_FIELDS}}):
        if await visible(series.get("visibility")):
            by_lineage[series["lineage_id"]].append(series)
    shown = []
    for lineage in lineages:
        seasons = [series for series in by_lineage[lineage["id"]]
                   if any(pid == partner_id for pid, _ in effective(lineage, series))]
        if seasons:
            shown.append((lineage, seasons))
    if not shown:
        return []
    ids = [series["id"] for _, seasons in shown for series in seasons]
    snapshots = await _latest_snapshots(db, ids)
    club_ids = await _club_participant_ids(db, ids)
    game_ids = list({lineage["game_id"] for lineage, _ in shown if lineage.get("game_id")})
    games = {item["id"]: item async for item in db.games.find(
        {"id": {"$in": game_ids}}, {"_id": 0, "id": 1, "name": 1})} if game_ids else {}

    items = []
    for lineage, seasons in shown:
        seasons.sort(key=lambda item: (_natural(item.get("season")), item.get("order_index") or 0,
                                       _natural(item.get("tier"))), reverse=True)
        lineage_role = dict(effective(lineage)).get(partner_id)
        role = lineage_role or dict(effective(lineage, seasons[0])).get(partner_id) or CONTRIBUTOR
        items.append({
            "lineage": {key: lineage.get(key) for key in ("title", "slug", "kind", "label")}
            | {"game_name": lineage.get("game_name") or (games.get(lineage.get("game_id")) or {}).get("name"),
               "logo_url": series_logo.effective(lineage)},  # #2014
            "role": role,
            "running": any(series.get("status") == "active" for series in seasons),
            "seasons": [{**{key: series.get(key) for key in SEASON_FIELDS},
                         "logo_url": series_logo.effective(lineage, series),
                         "running": series.get("status") == "active",
                         "club": _club_place(lineage, series, snapshots, club_ids)} for series in seasons],
        })
    items.sort(key=lambda item: (not item["running"], item["role"] != ORGANIZER,
                                 str(item["lineage"]["title"] or "").casefold()))
    return items
