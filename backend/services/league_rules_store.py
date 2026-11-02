"""Regelwerk der Liga (docs/LIGA.md, #1646): was ``league_service`` davon braucht - ein Blatt-Modul, damit sich die beiden nicht im Kreis
importieren. Alles Weitere steht in ``league_rules``."""
from __future__ import annotations

LEAGUE = "league"
SEASON = "league_season"
PUBLISHED = "published"
# Steht in der Staffel statt des Regeltexts, sobald es ein Regelwerk gibt: reiner Text, die App zeigt das Feld zeilenweise.
STAFFEL_POINTER = "Das Regelwerk dieser Liga steht im Web auf der Regelseite der Liga: Liga-Seite der Season, Link „Regeln“."


async def staffel_rules(db, league: dict, season: dict) -> str | None:
    """Was eine Staffel als Regeltext trägt: ohne Regelwerk der Text der Season, sonst der Hinweis auf die Regelseite."""
    has_rules = await db.league_rules.find_one(
        {"status": PUBLISHED, "$or": [{"scope": SEASON, "scope_id": season["id"]}, {"scope": LEAGUE, "scope_id": league["id"]}]},
        {"_id": 1})
    return STAFFEL_POINTER if has_rules else season.get("rules_text")


async def deletion_blockers(db, kind: str, target: dict, seasons: list[dict]) -> list[str]:
    """Was das Löschen verbietet: Eine veröffentlichte Fassung und eine Zustimmung sind Nachweise, was galt und wer zustimmte. Sie
    bleiben - dann heißt es archivieren."""
    out: list[str] = []
    if kind == "league" and await db.league_rules.find_one({"scope": LEAGUE, "scope_id": target["id"], "status": PUBLISHED}, {"_id": 1}):
        out.append("Das Regelwerk der Liga hat veröffentlichte Versionen")
    ids = [season["id"] for season in seasons]
    if not ids:
        return out
    published = {row["scope_id"] for row in await db.league_rules.find(
        {"scope": SEASON, "scope_id": {"$in": ids}, "status": PUBLISHED}, {"_id": 0, "scope_id": 1}).to_list(None)}
    agreed = {row["season_id"] for row in await db.league_rule_consents.find(
        {"season_id": {"$in": ids}}, {"_id": 0, "season_id": 1}).to_list(None)}
    for season in seasons:
        if season["id"] in published:
            out.append(f"Das Regelwerk von {season.get('name')} hat veröffentlichte Versionen")
        if season["id"] in agreed:
            out.append(f"Zu {season.get('name')} gibt es Zustimmungen zum Regelwerk")
    return out


async def delete_drafts(db, *, league_id: str | None, season_ids: list[str]) -> None:
    """Entwürfe gehen mit einer gelöschten Season oder Liga. Veröffentlichtes kann hier nicht liegen (``deletion_blockers``)."""
    if season_ids:
        await db.league_rules.delete_many({"scope": SEASON, "scope_id": {"$in": season_ids}, "status": "draft"})
    if league_id:
        await db.league_rules.delete_many({"scope": LEAGUE, "scope_id": league_id, "status": "draft"})
