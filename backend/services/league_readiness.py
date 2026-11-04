"""Prüfung vor der Veröffentlichung einer Season (``season_readiness``, #2207, Paket C.2 - Vertrag in docs/LIGA.md).

Eine Liste im Klartext: **Probleme** halten das Veröffentlichen auf (von „aus“ oder der Vorschau „Nur Liga-Leitung“ auf Mitglieder oder
Öffentlich, 409), **Warnungen** nicht. Geprüft wird
immer der Stand, der gespeichert werden soll (``season`` darf ungespeicherte Änderungen tragen). Notausnahme: der Superadmin mit Grund
(``override``). Kein Wert eines Titels steht hier.
"""
from __future__ import annotations

from datetime import datetime, timezone

from services import game_maps, game_modes, league_pool_check, league_veto_rules, map_pools
from services.league_scope import ONLY_LEAGUE
from services.log_safe import log_safe
from services.permissions import is_superadmin

OVERRIDE_MIN = 5
OVERRIDE_MAX = 500
# „Nur Liga-Leitung“ (admins) ist Vorschau und wird nicht geprüft (Entscheidung zu #2207). Veröffentlicht ist erst, was Mitglieder
# oder alle sehen.
PUBLISHED = ("members", "public")
BLOCKED_HEAD = "Veröffentlichen geht noch nicht: "
OVERRIDE_MISSING = ("Für die Notausnahme bitte einen Grund angeben (mindestens 5 Zeichen) – er steht im Protokoll.")
OVERRIDE_ONLY_SUPERADMIN = " Nur der Superadmin kann mit Grund trotzdem veröffentlichen."


def _item(code: str, text: str) -> dict:
    return {"code": code, "text": text}


def _moment(value) -> datetime | None:
    if not value:
        return None
    try:
        moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def publishing(before: str | None, after: str | None) -> bool:
    """Wird die Season gerade veröffentlicht? Von „aus“, der Vorschau „Nur Liga-Leitung“ oder neu auf Mitglieder oder Öffentlich."""
    return (before or "off") not in PUBLISHED and after in PUBLISHED


async def _rules_items(db, league: dict, season: dict) -> list[tuple[str, dict]]:
    from services import league_rules

    state = await league_rules.rules_state(db, league, season)
    if state["current"]:
        return []
    if state["upcoming"]:
        return [("warning", _item("rules_upcoming", f"Das Regelwerk gilt erst ab {state['upcoming'].get('valid_from')} – "
                                                     "bis dahin gibt es keine gültige Fassung."))]
    return [("problem", _item("rules_missing", "Es gibt kein veröffentlichtes Regelwerk für die Season oder die Liga. Ein Regeltext "
                                               "allein reicht nicht – ohne Regelwerk geht auch keine Selbstanmeldung."))]


def _application_items(season: dict) -> list[tuple[str, dict]]:
    opens, closes = _moment(season.get("application_opens_at")), _moment(season.get("application_closes_at"))
    if not opens or not closes:
        return [("warning", _item("application_none", "Kein Anmeldefenster: Co-Teams können sich nicht selbst anmelden, die Leitung "
                                                      "teilt sie zu."))]
    out = []
    start = _moment(season.get("start_date"))
    if start and closes > start:
        out.append(("problem", _item("application_after_start", "Das Anmeldefenster endet nach dem Beginn der Season – bitte "
                                                                "spätestens zum Beginn schließen.")))
    if closes <= datetime.now(timezone.utc):
        out.append(("warning", _item("application_closed", "Das Anmeldefenster ist schon vorbei.")))
    return out


def _pool_state_items(pool: dict | None, game: dict | None, order: list, maps: dict) -> list[tuple[str, dict]]:
    out = []
    modes = {mode["mode"]: mode for mode in (game or {}).get("match_modes") or [] if isinstance(mode, dict) and mode.get("mode")}
    flagged: list[str] = []
    for key in [*[group.get("mode") for group in (pool or {}).get("modes") or []], *order]:
        mode = modes.get(key)
        if mode and game_modes.status_of(mode) != game_modes.ACTIVE and key not in flagged:
            flagged.append(key)
            out.append(("warning", _item("inactive_mode", f"Der Modus „{mode.get('label') or key}“ ist "
                                                          f"{game_modes.STATUS_WORDS[game_modes.status_of(mode)]}.")))
    seen: set = set()
    for group in (pool or {}).get("modes") or []:
        for item in group.get("maps") or []:
            map_id = item.get("map_id")
            if map_id in seen:
                continue
            seen.add(map_id)
            row = maps.get(map_id)
            if not row:
                out.append(("warning", _item("inactive_map", f"Die Map „{item.get('name')}“ gibt es in der Bibliothek nicht mehr.")))
            elif game_maps.status_of(row) != game_maps.ACTIVE:
                out.append(("warning", _item("inactive_map", f"Die Map „{item.get('name')}“ ist "
                                                             f"{game_maps.STATUS_WORDS[game_maps.status_of(row)]}.")))
    return out


def _veto_items(season: dict, divisions: list[dict], pool: dict | None, game: dict | None) -> list[tuple[str, dict]]:
    """Veto (D.3, #1618): die gespeicherte Vorlage gegen den geltenden Pool, Best of und Modusfolge - nur, wenn sie an ist."""
    raw = season.get("veto_rules")
    if not isinstance(raw, dict) or not raw.get("enabled"):
        return []
    try:
        rules = league_veto_rules.normalize(raw)
    except league_veto_rules.VetoProblem as problem:
        return [("problem", _item("veto_invalid", f"Veto: {problem.detail}"))]
    labels = {mode["mode"]: mode["label"] for mode in game_maps.game_modes(game)}
    best_of = int(season.get("best_of") or 1)
    out: list[tuple[str, dict]] = [
        ("problem", _item("veto_invalid", f"Veto: {text}"))
        for text in league_veto_rules.template_problems(rules, pool=pool, best_of=best_of, order=season.get("game_mode_order"),
                                                        repeat=season.get("map_repeat") or "other_mode", labels=labels)]
    if not isinstance(season.get("checkin_rules"), dict):
        out.append(("problem", _item("veto_without_checkin", "Das Veto braucht den Check-in – bitte den Kasten „Check-in vor dem Spiel“ "
                                                            "einmal speichern.")))
    for division in sorted(divisions, key=lambda row: int(row.get("level") or 0)):
        own = (division.get("overrides") or {}).get("best_of")
        if (division.get("status") or "active") == "active" and own and int(own) != best_of:
            out.append(("warning", _item("veto_division_mismatch", f"Liga {division.get('level')} spielt Best of {int(own)}, die Veto-Vorlage "
                                                                   f"belegt {best_of} Positionen – dort läuft kein Veto, die Maps werden beim "
                                                                   "Ergebnis eingetragen.")))
    return out


async def season_readiness(db, league: dict, season: dict, user: dict | None = None) -> dict:
    """Die Prüfung für ``season`` (auch mit ungespeicherten Änderungen). Siehe Modulkopf und docs/LIGA.md."""
    items: list[tuple[str, dict]] = []
    game = await db.games.find_one({"id": league.get("game_id")}, {"_id": 0}) if league.get("game_id") else None
    divisions = await league_pool_check.divisions_of(db, season["id"])
    raw = await map_pools.current(db, "league_season", season["id"])
    pool = map_pools.valid_for(raw, league.get("game_id"))
    order = [mode for mode in season.get("game_mode_order") or [] if mode]
    need = league_pool_check.requirements(season, divisions, pool, game)
    if not raw:
        items.append(("problem", _item("pool_missing", "Die Season hat keinen Map-Pool – ohne ihn kann niemand mit Maps melden.")))
    elif not pool:
        items.append(("problem", _item("pool_stale", "Der Map-Pool gehört zu einem anderen Spiel – bitte neu wählen.")))
    else:
        items += [("problem", _item("pool_too_small", text)) for text in league_pool_check.pool_problems(season, divisions, pool, game)]
        missing = [mode for mode in dict.fromkeys(order) if mode not in {group.get("mode") for group in pool.get("modes") or []}]
        labels = {mode["mode"]: mode["label"] for mode in game_maps.game_modes(game)}
        for mode in missing:
            items.append(("problem", _item("mode_order_missing", f"Der Modus „{labels.get(mode) or mode}“ aus „Modus je Map“ fehlt im "
                                                                 "Map-Pool.")))
    problem = league_pool_check.order_length_problem(order, need["max_maps"])
    if problem:
        items.append(("problem", _item("mode_order_length", problem)))
    items += await _rules_items(db, league, season)
    active = [row for row in divisions if (row.get("status") or "active") == "active"]
    if not active:
        items.append(("problem", _item("divisions_missing", "Die Season hat noch keine Liga N – darin entstehen die Staffeln.")))
    else:
        with_staffel = set(await db.tournaments.distinct("league_context.division_id",
                                                         {"league_context.season_id": season["id"], **ONLY_LEAGUE}))
        for division in sorted(active, key=lambda row: int(row.get("level") or 0)):
            if division["id"] not in with_staffel:
                items.append(("problem", _item("staffel_missing", f"Liga {division.get('level')} hat noch keine Staffel.")))
    items += _application_items(season)
    map_ids = sorted({item.get("map_id") for group in (pool or {}).get("modes") or [] for item in group.get("maps") or []})
    maps = {row["id"]: row for row in await db.game_maps.find({"id": {"$in": map_ids}}, {"_id": 0, "id": 1, "status": 1}).to_list(None)}
    items += _pool_state_items(pool, game, order, maps)
    items += _veto_items(season, divisions, pool, game)
    problems = [item for kind, item in items if kind == "problem"]
    return {"ok": not problems, "problems": problems, "warnings": [item for kind, item in items if kind == "warning"],
            "requirements": need["rows"], "total": need["total"], "max_maps": need["max_maps"],
            "superadmin": bool(user and is_superadmin(user))}


class ReadinessBlocked(ValueError):
    """Veröffentlichen geht nicht - 409 mit deutschem Satz."""

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message
        self.status = 409


def blocked_text(result: dict, superadmin: bool) -> str:
    text = BLOCKED_HEAD + " ".join(item["text"] for item in result["problems"])
    return text + ("" if superadmin else OVERRIDE_ONLY_SUPERADMIN)


async def gate(db, league: dict, before: dict | None, after: dict, user: dict, override_reason) -> dict | None:
    """Vor dem Speichern: Wird veröffentlicht und gibt es Probleme, ``ReadinessBlocked`` - außer der Superadmin gibt einen Grund an.
    Gibt dann ``{reason, codes}`` für das Protokoll zurück, sonst ``None``."""
    if not publishing((before or {}).get("visibility"), after.get("visibility")):
        return None
    result = await season_readiness(db, league, after, user)
    if result["ok"]:
        return None
    superadmin = is_superadmin(user)
    reason = " ".join(str(override_reason or "").split())
    if not superadmin:
        raise ReadinessBlocked(blocked_text(result, False))
    if len(reason) < OVERRIDE_MIN:
        raise ReadinessBlocked(blocked_text(result, True) + " " + OVERRIDE_MISSING)
    return {"reason": log_safe(reason, OVERRIDE_MAX), "codes": [item["code"] for item in result["problems"]]}
