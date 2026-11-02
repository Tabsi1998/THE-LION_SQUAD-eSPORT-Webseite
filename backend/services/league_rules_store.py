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


async def delete_for(db, *, league_id: str | None, season_ids: list[str]) -> None:
    """Geht mit einer gelöschten Season oder Liga (nur Entwurfs-Seasons lassen sich löschen)."""
    if season_ids:
        await db.league_rules.delete_many({"scope": SEASON, "scope_id": {"$in": season_ids}})
        await db.league_rule_consents.delete_many({"season_id": {"$in": season_ids}})
    if league_id:
        await db.league_rules.delete_many({"scope": LEAGUE, "scope_id": league_id})
