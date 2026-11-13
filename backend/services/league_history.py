"""Season-Historie an Team und Spieler (F.2, #1627, docs/LIGA.md „F.2 Neue Season aus dem Vorgänger“).

Je abgeschlossener Staffel eine Zeile: Liga, Season, Liga N, Staffel, Platz von wie vielen, Meister und die Zone (Auf- oder Abstieg).
Quelle ist allein der geltende Endstand (``league_final_tables``, ``active``) - was der Abschluss festhielt, steht hier; eine spätere
Änderung an Regeln oder Spielen ändert es nicht. Sichtbar nur Seasons, die die Person sehen darf.
"""
from __future__ import annotations

from services import league_zones

LIMIT = 100


async def _rows(db, query: dict, user: dict | None) -> list[dict]:
    from services.league_service import can_see_season

    finals = await db.league_final_tables.find({"active": True, **query}, {"_id": 0}).sort("closed_at", -1).to_list(LIMIT)
    season_ids = sorted({row.get("season_id") for row in finals if row.get("season_id")})
    seasons = {row["id"]: row for row in await db.league_seasons.find({"id": {"$in": season_ids}}, {"_id": 0}).to_list(len(season_ids) + 1)}
    league_ids = sorted({row.get("league_id") for row in seasons.values() if row.get("league_id")})
    leagues = {row["id"]: row for row in await db.leagues.find({"id": {"$in": league_ids}}, {"_id": 0, "id": 1, "name": 1, "slug": 1}).to_list(
        len(league_ids) + 1)}
    visible: dict[str, bool] = {}
    out = []
    for final in finals:
        season = seasons.get(final.get("season_id") or "")
        if not season:
            continue
        if season["id"] not in visible:
            visible[season["id"]] = season.get("status") != "archived" and await can_see_season(user, season)
        if not visible[season["id"]]:
            continue
        out.append((final, season, leagues.get(season.get("league_id") or "") or {}))
    return out


def _entry(final: dict, season: dict, league: dict, registration_id: str) -> dict | None:
    row = next((item for item in final.get("rows") or [] if item.get("registration_id") == registration_id), None)
    if not row:
        return None
    title = final.get("title") or {}
    champion = (final.get("champion") or {}).get("registration_id") == registration_id
    zone = row.get("zone") if "zone" in row else (final.get("promotion") or {}).get(registration_id)
    return {
        "season_id": season["id"], "season_name": season.get("name") or title.get("season"), "season_number": season.get("number"),
        "league_name": league.get("name") or title.get("league"),
        "url": f"/liga/{league.get('slug')}/{season.get('slug')}" if league.get("slug") and season.get("slug") else None,
        "division_label": title.get("division"), "staffel": final.get("staffel"), "display_name": row.get("display_name"),
        "rank": row.get("rank"), "of": len(final.get("rows") or []), "points": row.get("points"),
        "champion": champion, "zone": zone, "zone_label": league_zones.LABELS.get(zone or ""),
        "exit": (row.get("exit") or {}).get("kind") if isinstance(row.get("exit"), dict) else None,
        "closed_at": final.get("closed_at"),
    }


def _order(rows: list[dict]) -> list[dict]:
    return sorted(rows, key=lambda row: (str(row.get("closed_at") or "")), reverse=True)


async def for_team(db, team_id: str, user: dict | None) -> list[dict]:
    """Die Seasons eines Hauptteams - je Co-Team und Staffel eine Zeile."""
    out = []
    for final, season, league in await _rows(db, {"team_ids": team_id}, user):
        for registration_id, side in (final.get("sides") or {}).items():
            if side.get("team_id") == team_id:
                entry = _entry(final, season, league, registration_id)
                if entry:
                    out.append(entry)
    return _order(out)


async def for_player(db, user_id: str, viewer: dict | None) -> list[dict]:
    """Die Seasons einer Person: wo sie eingesetzt war (bzw. im Kader des Co-Teams, wenn es keine Aufstellung gab)."""
    out = []
    for final, season, league in await _rows(db, {"player_ids": user_id}, viewer):
        for registration_id, side in (final.get("sides") or {}).items():
            if user_id in (side.get("player_ids") or []):
                entry = _entry(final, season, league, registration_id)
                if entry:
                    out.append(entry)
    return _order(out)
