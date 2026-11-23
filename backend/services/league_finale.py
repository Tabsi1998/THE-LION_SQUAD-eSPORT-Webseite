"""Saisonfinale: Auf- und Absteiger je Liga N (#1641 TV, #1642 Discord).

Nach dem Sieger-Moment (#2410) zeigt der Turnierbaum-TV einer abgeschlossenen Liga-Staffel einen weiteren Schritt: je Liga N die
Teams, die auf- oder absteigen (bzw. ausscheiden), mit Ziel-Liga. Die Leitung steuert ihn im Reiter „Abschluss“ der Season mit
**Weiter** (nächste Liga N) und **Ende** (zurück zum gewohnten Bild). Der Stand steht an jeder abgeschlossenen Staffel der Season
(``tournaments.tv_finale``, nie an der Season - die Folge-Season übernimmt Season-Felder, F.2), damit jeder TV der Season mitgeht.

Gelesen wird nur der Endstand (``league_final_tables``, Zonen an jeder Zeile - F.2, #1627). Relegationsplätze haben noch keine
Wirkung (``league_zones.MOVES``) und erscheinen hier nicht. Am TV und im Discord steht nur, was Gäste sehen: Season öffentlich
(``profile_visibility.public_season``) und die Staffel als Turnier sichtbar - dieselbe Regel wie beim Podest (``awards._visible``).
"""
from __future__ import annotations

from models import new_id, now_utc

FIELD = "tv_finale"
UP, DOWN, OUT = "up", "down", "out"
MOVE_OF_ZONE = {"promotion": UP, "relegation": DOWN, "out": OUT}
MOVE_ORDER = (UP, DOWN, OUT)
ACTIONS = ("next", "end")
# Zeilen je Liga N am TV: Bei mehr als 12 wird es aus der Distanz unlesbar - die Leitung kann dann die Liga N auf der Ligaseite zeigen.
MAX_ROWS = 12
STAFFEL_LIMIT = 200


def _rank(row: dict) -> int:
    try:
        return int(row.get("rank") or 0) or 10**6
    except (TypeError, ValueError):
        return 10**6


def movers(rows: list[dict]) -> dict[str, list[dict]]:
    """Aus den Zeilen eines Endstands: wer aufsteigt, absteigt oder ausscheidet - je Gruppe nach Platz."""
    out: dict[str, list[dict]] = {move: [] for move in MOVE_ORDER}
    for row in rows or []:
        move = MOVE_OF_ZONE.get(row.get("zone"))
        if move and row.get("registration_id"):
            out[move].append(row)
    for move in MOVE_ORDER:
        out[move].sort(key=_rank)
    return out


def _label(division: dict) -> str:
    from services.league_service import division_label

    return division_label(division)


def build_pages(divisions: list[dict], finals: list[dict]) -> list[dict]:
    """Je Liga N (nach Stufe) eine Seite mit ihren Auf- und Absteigern - Liga N ohne Bewegung fallen weg.

    ``divisions``: die aktiven Liga N der Season; ``finals``: die geltenden Endstände (``division_id``, ``staffel``, ``rows``). Das Ziel
    ist die benachbarte Liga N nach Stufe (nicht Stufe ± 1: eine Lücke in der Nummerierung bleibt möglich)."""
    ordered = sorted((row for row in divisions if isinstance(row.get("level"), int)), key=lambda row: row["level"])
    position = {row["id"]: index for index, row in enumerate(ordered)}
    by_division: dict[str, list[dict]] = {}
    for final in finals:
        if final.get("division_id") in position:
            by_division.setdefault(final["division_id"], []).append(final)
    pages = []
    for division in ordered:
        own = sorted(by_division.get(division["id"]) or [], key=lambda final: str(final.get("staffel") or ""))
        if not own:
            continue
        index = position[division["id"]]
        targets = {UP: _label(ordered[index - 1]) if index > 0 else None,
                   DOWN: _label(ordered[index + 1]) if index + 1 < len(ordered) else None, OUT: None}
        several = len(own) > 1
        rows = []
        for move in MOVE_ORDER:
            for final in own:
                for row in movers(final.get("rows") or [])[move]:
                    rows.append({"registration_id": row["registration_id"], "name": row.get("display_name") or "Team",
                                 "rank": row.get("rank"), "move": move, "target": targets[move],
                                 "staffel": final.get("staffel") if several else None})
        if rows:
            pages.append({"division_id": division["id"], "level": division["level"], "label": _label(division), "staffeln": len(own),
                          "rows": rows[:MAX_ROWS], "more": max(0, len(rows) - MAX_ROWS)})
    return pages


def clamp_step(value, count: int) -> int:
    """Der Schritt der Leitung: 0 heißt aus, 1 bis ``count`` die Seite je Liga N."""
    if isinstance(value, bool):
        return 0
    try:
        step = int(value)
    except (TypeError, ValueError):
        return 0
    return max(0, min(int(count or 0), step))


def next_step(step: int, count: int) -> int:
    """„Weiter“: zur nächsten Liga N - auf der letzten bleibt es dort (erst „Ende“ schaltet zurück)."""
    return clamp_step(clamp_step(step, count) + 1, count)


# ---------------------------------------------------------------- Lesen

async def guest_sees_staffel(tournament: dict | None) -> bool:
    """Sähe ein Gast die Staffel als Turnier? Wie ``awards._visible`` ohne Person."""
    from services.visibility import user_can_see

    if not tournament or tournament.get("status") == "draft" or tournament.get("is_public") is False:
        return False
    return await user_can_see(None, tournament.get("visibility") or "public")


async def season_frame(db, season_id: str | None) -> tuple[dict | None, dict | None]:
    season = await db.league_seasons.find_one({"id": season_id}, {"_id": 0}) if season_id else None
    league = await db.leagues.find_one({"id": season.get("league_id")}, {"_id": 0, "id": 1, "name": 1, "slug": 1}) if season else None
    return season, league


async def closed_staffeln(db, season_id: str) -> list[dict]:
    from services.league_scope import ONLY_LEAGUE

    rows = await db.tournaments.find({"league_context.season_id": season_id, **ONLY_LEAGUE, "final_table": {"$type": "object"}},
                                     {"_id": 0, "id": 1, "slug": 1, "title": 1, "status": 1, "visibility": 1, "is_public": 1,
                                      "league_context": 1, "final_table": 1, FIELD: 1}).to_list(STAFFEL_LIMIT)
    return rows


async def season_finals(db, season: dict, *, guests_only: bool = True) -> tuple[list[dict], list[dict]]:
    """Die abgeschlossenen Staffeln der Season (mit ``guests_only`` nur die, die Gäste sehen) und ihre geltenden Endstände."""
    staffeln = await closed_staffeln(db, season["id"])
    if guests_only:
        staffeln = [row for row in staffeln if await guest_sees_staffel(row)]
    ids = [row["id"] for row in staffeln]
    finals = await db.league_final_tables.find({"tournament_id": {"$in": ids}, "active": True},
                                               {"_id": 0, "tournament_id": 1, "division_id": 1, "staffel": 1, "rows": 1, "champion": 1,
                                                "champion_place": 1}).to_list(len(ids) or 1) if ids else []
    return staffeln, finals


async def season_pages(db, season: dict, *, guests_only: bool = True) -> list[dict]:
    divisions = await db.league_divisions.find({"season_id": season["id"], "status": {"$ne": "archived"}},
                                               {"_id": 0, "id": 1, "level": 1, "nickname": 1}).to_list(50)
    _, finals = await season_finals(db, season, guests_only=guests_only)
    return build_pages(divisions, finals)


async def tv_payload(db, tournament: dict | None) -> dict | None:
    """Für ``GET /bracket/display``: solange die Leitung den Schritt zeigt, die Seiten und welche gerade dran ist - sonst ``None``.

    Nur bei einer abgeschlossenen Staffel, die Gäste sehen, in einer öffentlichen Season. Eine interne oder Leitungs-Season kommt
    nie auf den TV, auch nicht mit Anzeige-Schlüssel."""
    from services.league_final_read import is_closed
    from services.league_scope import is_league_staffel
    from services.profile_visibility import public_season

    state = (tournament or {}).get(FIELD) or {}
    if not is_league_staffel(tournament) or not is_closed(tournament) or not state.get("step"):
        return None
    if not await guest_sees_staffel(tournament):
        return None
    season, league = await season_frame(db, ((tournament or {}).get("league_context") or {}).get("season_id"))
    if not public_season(season):
        return None
    pages = await season_pages(db, season)
    step = clamp_step(state.get("step"), len(pages))
    if not step:
        return None
    return {"step": step, "count": len(pages), "league": (league or {}).get("name"), "season": season.get("name"), "pages": pages,
            "updated_at": state.get("updated_at")}


# ---------------------------------------------------------------- Steuerung der Leitung

async def control_state(db, season: dict) -> dict:
    """Was der Reiter „Abschluss“ zur TV-Steuerung zeigt: Schritt, Seiten (Liga N) und warum der TV gegebenenfalls nichts zeigt."""
    from services.profile_visibility import public_season

    staffeln = await closed_staffeln(db, season["id"])
    pages = await season_pages(db, season)
    step = max((clamp_step((row.get(FIELD) or {}).get("step"), len(pages)) for row in staffeln), default=0)
    reason = None
    if not public_season(season):
        reason = "season_hidden"
    elif not staffeln:
        reason = "none_closed"
    elif not pages:
        reason = "no_movers"
    return {"step": step if reason is None else 0, "count": len(pages), "labels": [page["label"] for page in pages],
            "closed": len(staffeln), "reason": reason}


async def control(db, season: dict, action: str, actor: dict | None) -> dict:
    """„Weiter“ bzw. „Ende“ - an allen abgeschlossenen Staffeln der Season zugleich; danach laden ihre TVs sofort nach."""
    from services.change_events import publish_api_change

    state = await control_state(db, season)
    step = 0 if action == "end" or state["reason"] else next_step(state["step"], state["count"])
    now = now_utc().isoformat()
    staffeln = await closed_staffeln(db, season["id"])
    ids = [row["id"] for row in staffeln if clamp_step((row.get(FIELD) or {}).get("step"), state["count"]) != step]
    if ids:
        # Am Turnier nur Schritt und Zeit (die Turnier-Antworten sind öffentlich) - wer geschaltet hat, steht im Protokoll.
        await db.tournaments.update_many({"id": {"$in": ids}}, {"$set": {FIELD: {"step": step, "updated_at": now}}})
        await db.audit_logs.insert_one({"id": new_id(), "action": "league.season.tv_finale", "target_id": season["id"],
                                        "actor_id": (actor or {}).get("id"), "data": {"action": action, "step": step, "staffeln": ids},
                                        "created_at": now})
        for tournament_id in ids:
            await publish_api_change("POST", f"/api/tournaments/{tournament_id}/tv-finale", 200)
    return {**state, "step": step if state["reason"] is None else 0}


async def forget(db, season_id: str | None) -> None:
    """Den TV-Schritt an allen Staffeln der Season wegnehmen (Wiederöffnen): Ihre TVs zeigen wieder das gewohnte Bild, bis die Leitung
    nach dem nächsten Abschluss erneut „Weiter“ drückt."""
    from services.change_events import publish_api_change

    if not season_id:
        return
    rows = await db.tournaments.find({"league_context.season_id": season_id, FIELD: {"$exists": True}}, {"_id": 0, "id": 1}).to_list(STAFFEL_LIMIT)
    ids = [row["id"] for row in rows]
    if not ids:
        return
    await db.tournaments.update_many({"id": {"$in": ids}}, {"$unset": {FIELD: ""}})
    for tournament_id in ids:
        await publish_api_change("POST", f"/api/tournaments/{tournament_id}/tv-finale", 200)
