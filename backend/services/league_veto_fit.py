"""Passt eine Veto-Vorlage zu einer Staffel? (Fabian Nr. 200, #2528, docs/LIGA.md D.3)

Blatt-Modul ohne Rückweg zu ``league_service`` oder ``league_veto``: Beide brauchen die Prüfung - ``league_veto.store_template`` beim
Speichern und Nachziehen, ``league_service._sync_veto`` beim Übertragen, ``league_readiness`` für Liga N - und dürfen sich gegenseitig
nicht importieren (``test_import_cycles_unit``).

Nr. 200 gilt ohne Ausnahme, auch für eine Liga N mit eigenem Best of: Eine Staffel bekommt eine Vorlage nur, wenn sie zu **ihrem**
Best of, ihrer Modusfolge und ihrem Pool passt. Die Warnungen fasst ``warnings_for`` zusammen - ein Satz je Fall, höchstens drei Namen.
"""
from __future__ import annotations

from dataclasses import dataclass

from services import league_games, league_veto_rules as rules_mod, map_pools
from services.bracket_fill_in import has_started, is_auto_bye

SEASON, UNTIL_SYNC, KEEPS, BUSY = "season", "until_sync", "keeps", "busy"
SEASON_MISFIT = "Die Veto-Vorlage passt noch nicht zur Season (siehe Kasten Veto) – die Staffeln behalten ihre bisherige."
OWN_ORDER_AND_POOL = "mit ihrer Modusfolge und ihrem Map-Pool"
NAMES_SHOWN = 3


@dataclass(frozen=True)
class Misfit:
    """Warum eine Staffel die Vorlage (noch) nicht bekommt. ``kind``: ``season`` (die Vorlage passt schon zur Season nicht),
    ``until_sync`` (sie passt nach dem Übertragen), ``keeps`` (sie passt auch dann nicht - ``reason`` sagt, was die Staffel spielt),
    ``busy`` (die Staffel wird gerade bearbeitet)."""
    kind: str
    name: str
    reason: str = ""


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


async def staffel_pool(db, tournament: dict) -> dict | None:
    """Der Pool der Staffel - dieselbe Funktion wie beim Start des Vetos (``league_veto._match_setup``), nur ohne Phase und Spiel: Eine
    Liga-Staffel hat genau eine Phase ohne eigenen Pool, und ein Spiel mit festgehaltenem Pool behält ohnehin seinen."""
    return await map_pools.effective_pool(db, tournament)


async def season_pool(db, season: dict) -> dict | None:
    league = await db.leagues.find_one({"id": season.get("league_id")}, {"_id": 0, "game_id": 1}) or {}
    return map_pools.valid_for(await map_pools.current(db, "league_season", season["id"]), league.get("game_id"))


def fits(rules: dict, pool: dict | None, tournament: dict) -> bool:
    """Läuft die Vorlage mit Pool, Best of, Modusfolge und Wiederholungsregel von ``tournament`` - wie beim Check-in."""
    return not rules_mod.fits_problem(rules, pool=pool, best_of=int(tournament.get("best_of") or 1),
                                      order=league_games.effective_mode_order(tournament, pool), repeat=league_games.map_repeat_of(tournament))


async def staffel_mismatch(db, tournament: dict, rules: dict, season: dict, *, transferring: bool = False) -> Misfit | None:
    """Nr. 200: ``None``, wenn die Staffel die Vorlage bekommen darf - sie passt zu ihr, ist aus oder leer, oder die Staffel hat keinen
    Pool (dort läuft ohnehin kein Veto). Sonst die Einordnung für die Warnung:

    - ``season``: Die Vorlage geht schon mit Pool, Best of und Modusfolge der Season nicht auf.
    - ``until_sync``: Sie passt nach dem Übertragen - mit dem Pool der Season (der geht immer mit) und, ohne Ergebnis, Best of und
      Modusfolge der Season bzw. ihrer Liga N.
    - ``keeps``: Sie passt auch dann nicht (nach dem ersten Ergebnis bleiben Best of und Modusfolge) - die Staffel behält ihre bisherige.

    ``transferring``: beim Übertragen selbst - die Staffel trägt dann schon die Werte danach, es gibt kein „bis zum Übertragen“."""
    if not rules.get("enabled") or not rules.get("steps"):
        return None
    pool = await staffel_pool(db, tournament)
    if pool is None or fits(rules, pool, tournament):
        return None
    name = await staffel_name(db, tournament)
    s_pool = await season_pool(db, season)
    s_best_of = int(season.get("best_of") or 1)
    if rules_mod.template_problems(rules, pool=s_pool, best_of=s_best_of, order=season.get("game_mode_order"),
                                   repeat=season.get("map_repeat") or "other_mode"):
        return Misfit(SEASON, name)
    after = dict(tournament)
    if not transferring:
        result = await has_result(db, tournament["id"])
        if not result:
            context = tournament.get("league_context") or {}
            division = await db.league_divisions.find_one({"id": context.get("division_id")}, {"_id": 0, "overrides": 1}) or {}
            own = (division.get("overrides") or {}).get("best_of")
            after.update({"best_of": int(own or s_best_of), "game_mode_order": list(season.get("game_mode_order") or []),
                          "map_repeat": season.get("map_repeat") or "other_mode"})
        # Der Pool der Staffel nach dem Übertragen (``_sync_pool``): der der Season, wenn er zum Spiel passt; hat die Season keinen mehr,
        # fällt der der Staffel vor dem ersten Ergebnis weg, danach bleibt er.
        if s_pool:
            after_pool = s_pool if s_pool.get("game_id") == tournament.get("game_id") else pool
        else:
            after_pool = pool if result else None
        if after_pool is None or fits(rules, after_pool, after):
            return Misfit(UNTIL_SYNC, name)
    best_of = int(after.get("best_of") or 1)
    return Misfit(KEEPS, name, f"Best of {best_of}" if best_of != s_best_of else OWN_ORDER_AND_POOL)


def _names(names: list[str]) -> str:
    """„A“, „A und B“, „A, B und C“ - ab vier „A, B, C und 2 weitere“ (höchstens drei Namen)."""
    names = sorted(names)
    if len(names) > NAMES_SHOWN:
        rest = len(names) - NAMES_SHOWN
        return f"{', '.join(names[:NAMES_SHOWN])} und {'eine weitere' if rest == 1 else f'{rest} weitere'}"
    return names[0] if len(names) == 1 else f"{', '.join(names[:-1])} und {names[-1]}"


def warnings_for(misfits: list[Misfit]) -> list[str]:
    """Die Warnungen zusammengefasst - für alle Wege gleich (``store_template``, Übertragen): ein Satz für „passt nicht zur Season“, einer
    für alle „bis zum Übertragen“ (bei einer Staffel mit Namen), je Grund einer für „bleibt“ und einer für „gerade bearbeitet“."""
    out: list[str] = []
    if any(row.kind == SEASON for row in misfits):
        out.append(SEASON_MISFIT)
    until = [row.name for row in misfits if row.kind == UNTIL_SYNC]
    if until:
        where = until[0] if len(until) == 1 else f"{len(until)} Staffeln"
        out.append(f"Die neue Veto-Vorlage geht in {where} mit „Vorgaben auf Staffeln übertragen“ mit.")
    reasons: dict[str, list[str]] = {}
    for row in misfits:
        if row.kind == KEEPS:
            reasons.setdefault(row.reason, []).append(row.name)
    for reason, names in reasons.items():
        out.append(f"{_names(names)} {'spielt' if len(names) == 1 else 'spielen'} weiter {reason} – dort bleibt die bisherige "
                   "Veto-Vorlage.")
    busy = [row.name for row in misfits if row.kind == BUSY]
    if busy:
        out.append(f"{_names(busy)} {'wird' if len(busy) == 1 else 'werden'} gerade bearbeitet – dort geht die neue Veto-Vorlage mit dem "
                   "nächsten Übertragen mit.")
    return out


async def staffel_runs_veto(db, tournament: dict) -> bool:
    """Läuft in dieser Staffel ein Veto - ihre eigene Vorlage ist an und passt zu ihr?"""
    rules = rules_mod.rules_of(tournament)
    if not rules:
        return False
    pool = await staffel_pool(db, tournament)
    return pool is not None and fits(rules, pool, tournament)


async def division_veto_gaps(db, season: dict, divisions: list[dict]) -> list[str]:
    """Nr. 106 mit Nr. 200: Je aktiver Liga N mit eigenem, anderem Best of der Satz „dort läuft kein Veto“ - aber nur, wenn die Vorlage
    **ihrer Staffel** nicht passt (oder es noch keine Staffel gibt; sie bekäme die Vorlage der Season). Behält eine Staffel eine passende
    Vorlage, läuft dort das Veto weiter. Für „Was fehlt noch?“ und die Warnung beim Speichern eines neuen Best of."""
    best_of = int(season.get("best_of") or 1)
    out = []
    for division in sorted(divisions, key=lambda row: int(row.get("level") or 0)):
        own = (division.get("overrides") or {}).get("best_of")
        if (division.get("status") or "active") != "active" or not own or int(own) == best_of:
            continue
        staffeln = await db.tournaments.find({"league_context.season_id": season["id"], "league_context.division_id": division["id"]},
                                             {"_id": 0}).to_list(None)
        runs = [await staffel_runs_veto(db, row) for row in staffeln]
        if staffeln and all(runs):
            continue
        out.append(f"Liga {division.get('level')} spielt Best of {int(own)}, die Veto-Vorlage belegt {best_of} Positionen – dort läuft "
                   "kein Veto, die Maps werden beim Ergebnis eingetragen.")
    return out
