"""Passt eine Veto-Vorlage zu einer Staffel? (Fabian Nr. 200, #2528, docs/LIGA.md D.3)

Blatt-Modul ohne Rückweg zu ``league_service`` oder ``league_veto``: Beide brauchen die Prüfung - ``league_veto.store_template`` beim
Speichern und Nachziehen, ``league_service._sync_veto`` beim Übertragen - und dürfen sich gegenseitig nicht importieren
(``test_import_cycles_unit``).
"""
from __future__ import annotations

from services import league_games, league_veto_rules as rules_mod, map_pools
from services.bracket_fill_in import has_started, is_auto_bye


async def has_result(db, tournament_id: str) -> bool:
    """Hat die Staffel schon ein Ergebnis (ein begonnenes Spiel, kein Freilos)? Ab dann überträgt „Übertragen“ Best of und Modusfolge
    nicht mehr (Gruppe ``before_result``)."""
    rows = await db.matches_v2.find({"tournament_id": tournament_id},
                                    {"_id": 0, "status": 1, "started_at": 1, "reports": 1, "pending_result": 1,
                                     "result_meta": 1}).to_list(None)
    return any(has_started(row) and not is_auto_bye(row) for row in rows)


async def staffel_name(db, tournament: dict) -> str:
    """„Liga 1 · Staffel A“ - kurz für Warnungen; ohne Liga-Rahmen der Titel."""
    context = tournament.get("league_context") or {}
    division = await db.league_divisions.find_one({"id": context.get("division_id")}, {"_id": 0, "level": 1}) if context else None
    if division and context.get("staffel"):
        return f"Liga {division.get('level')} · Staffel {context['staffel']}"
    return tournament.get("title") or "Eine Staffel"


async def staffel_mismatch(db, tournament: dict, rules: dict, season: dict, *, transferring: bool = False) -> str | None:
    """Nr. 200: Passt die Vorlage zu **dieser** Staffel - ihrem Best of, ihrer Modusfolge, ihrem Pool (``fits_problem`` wie beim
    Check-in)? ``None``: sie darf sie bekommen. Sonst der Satz für die Warnung. Immer erlaubt: eine ausgeschaltete oder leere Vorlage,
    eine Staffel ohne Pool (dort läuft ohnehin kein Veto) und eine Liga N mit eigenem Best of (Nr. 106: dort kein Veto, die Season-Vorlage
    geht wie bisher mit; „Was fehlt noch?“ warnt). ``transferring``: beim Übertragen selbst - dann gibt es kein „bis zum Übertragen“."""
    if not rules.get("enabled") or not rules.get("steps"):
        return None
    context = tournament.get("league_context") or {}
    division = await db.league_divisions.find_one({"id": context.get("division_id")}, {"_id": 0, "overrides": 1}) or {}
    season_best_of = int(season.get("best_of") or 1)
    own = (division.get("overrides") or {}).get("best_of")
    if own and int(own) != season_best_of:
        return None
    pool = await map_pools.current(db, "tournament", tournament["id"])
    if pool is None:
        return None
    best_of = int(tournament.get("best_of") or 1)
    if not rules_mod.fits_problem(rules, pool=pool, best_of=best_of, order=league_games.effective_mode_order(tournament, pool),
                                  repeat=league_games.map_repeat_of(tournament)):
        return None
    name = await staffel_name(db, tournament)
    if transferring or await has_result(db, tournament["id"]):
        if best_of != season_best_of:
            return f"{name} spielt weiter Best of {best_of} – dort bleibt die bisherige Veto-Vorlage."
        return f"{name} spielt weiter mit ihrer Modusfolge und ihrem Map-Pool – dort bleibt die bisherige Veto-Vorlage."
    what = f"Best of {best_of}" if best_of != season_best_of else "mit ihrer Modusfolge und ihrem Map-Pool"
    return f"{name} spielt bis zum Übertragen noch {what} – die neue Veto-Vorlage geht dort mit „Vorgaben auf Staffeln übertragen“ mit."
