"""Kader unter Mindestgröße (docs/LIGA.md, #2202): Abgänge aus einem Co-Team bleiben möglich (Entscheidung des Obmanns).

Fällt der Kader eines aktiven Co-Teams, das in einer nicht beendeten Staffel steht, unter ``min_squad_size``, erfahren es die
Verantwortlichen und die Turnierleitung; ``open_shortages`` liefert den aktuellen Stand für die Aufgabe „Kader auffüllen“
auf der Startseite. Der Stand wird nie gespeichert - reicht der Kader wieder, ist die Aufgabe weg.
"""

from __future__ import annotations

import logging

from services.log_safe import log_safe
from services.league_eligibility import open_window
from services.league_roster import is_active_squad
from services.match_audience import kader_care_ids, roster_ids, teams_by_id
from services.squad_registration import ACTIVE_REGISTRATION_STATUSES, FINISHED_TOURNAMENT_STATUSES, min_squad_size

logger = logging.getLogger("tls.squad_shortage")

REGISTRATION_FIELDS = {"_id": 0, "id": 1, "tournament_id": 1, "team_id": 1, "squad_id": 1, "display_name": 1}
TOURNAMENT_FIELDS = {"_id": 0, "id": 1, "title": 1, "status": 1, "team_size": 1, "min_squad_size": 1, "lineup_mode": 1, "league_context": 1}


async def _open_tournaments(db, registrations: list[dict]) -> dict[str, dict]:
    ids = sorted({reg["tournament_id"] for reg in registrations if reg.get("tournament_id")})
    if not ids:
        return {}
    rows = await db.tournaments.find(
        {"id": {"$in": ids}, "status": {"$nin": sorted(FINISHED_TOURNAMENT_STATUSES)}}, TOURNAMENT_FIELDS,
    ).to_list(len(ids) + 5)
    return {row["id"]: row for row in rows}


async def _active_squads(db, squad_ids) -> dict[str, dict]:
    """Die Co-Teams, die spielen - archivierte warnen nicht und verlangen nichts mehr."""
    ids = sorted({squad_id for squad_id in squad_ids if squad_id})
    rows = await db.team_squads.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "name": 1, "status": 1}).to_list(len(ids) + 5) if ids else []
    return {row["id"]: row for row in rows if is_active_squad(row)}


async def open_shortages(db, registrations: list[dict]) -> list[dict]:
    """Die Co-Teams aus diesen aktiven Anmeldungen, deren Kader gerade zu klein ist - je Zeile Staffel, Größe, Mindestgröße
    und wer davon erfährt (``kader_care_ids``). Gezählt wird, wer aufgestellt werden dürfte (``roster_ids``)."""
    rows = [reg for reg in registrations if reg.get("squad_id") and reg.get("team_id")]
    tournaments = await _open_tournaments(db, rows)
    squads = await _active_squads(db, [reg["squad_id"] for reg in rows])
    rows = [reg for reg in rows if reg.get("tournament_id") in tournaments and reg["squad_id"] in squads]
    if not rows:
        return []
    teams = await teams_by_id(db, rows)
    out = []
    for reg in rows:
        team = teams.get(reg["team_id"])
        if not team or reg["squad_id"] not in (team.get("squads") or {}):
            continue
        tournament = tournaments[reg["tournament_id"]]
        size, minimum = len(roster_ids(reg, team)), min_squad_size(tournament)
        if size < minimum:
            out.append({
                "registration_id": reg.get("id"),
                "team_id": reg["team_id"],
                "squad_id": reg["squad_id"],
                "squad_name": squads[reg["squad_id"]].get("name") or reg.get("squad_name") or "Co-Team",
                "display_name": reg.get("display_name"),
                "tournament": tournament,
                "size": size,
                "min_size": minimum,
                "care_ids": kader_care_ids(reg, team),
            })
    return out


async def requirements(db, squad_ids: list[str]) -> dict[str, dict]:
    """Je Co-Team, was die Staffel verlangt: für den Hinweis, bevor ein Abgang bestätigt wird. Nur aktive Co-Teams in einer nicht
    beendeten Staffel; steht eines in mehreren Seasons, gilt die strengste Vorgabe."""
    if not squad_ids:
        return {}
    regs = await db.tournament_registrations.find(
        {"squad_id": {"$in": sorted(squad_ids)}, "status": {"$in": list(ACTIVE_REGISTRATION_STATUSES)}}, REGISTRATION_FIELDS,
    ).to_list(500)
    tournaments = await _open_tournaments(db, regs)
    squads = await _active_squads(db, squad_ids)
    out: dict[str, dict] = {}
    season_of: dict[str, str] = {}
    for reg in regs:
        tournament = tournaments.get(reg.get("tournament_id"))
        if not tournament or reg["squad_id"] not in squads:
            continue
        minimum = min_squad_size(tournament)
        if minimum > out.get(reg["squad_id"], {}).get("min_size", 0):
            out[reg["squad_id"]] = {"min_size": minimum, "title": tournament.get("title")}
            season_of[reg["squad_id"]] = (tournament.get("league_context") or {}).get("season_id")
    # Was die Season sonst noch verlangt (#2204) - nur, was sie wirklich trägt.
    wanted = sorted({season_id for season_id in season_of.values() if season_id})
    seasons = {row["id"]: row for row in await db.league_seasons.find({"id": {"$in": wanted}}, {"_id": 0}).to_list(len(wanted) + 1)} if wanted else {}
    for squad_id, demand in out.items():
        season = seasons.get(season_of.get(squad_id))
        if not season:
            continue
        if season.get("max_squad_size"):
            demand["max_size"] = season["max_squad_size"]
        if season.get("min_age"):
            demand["min_age"] = season["min_age"]
        if season.get("one_team_per_season"):
            demand["transfers_open"] = bool(open_window(season))
    return out


async def _lead_ids(db, tournament: dict) -> list[str]:
    from services.league_scope import is_league_staffel
    from services.permissions import tournament_lead_filter

    if is_league_staffel(tournament):
        # Staffel (#2203): wer dort Kader prüft oder Teams freigibt, nicht die Turnierleitung.
        from services.league_permissions import staff_user_ids

        return sorted(await staff_user_ids(db, tournament["league_context"].get("league_id"), ("roster", "applications")))
    rows = await db.users.find(
        {**tournament_lead_filter(), "is_active": {"$ne": False}, "is_banned": {"$ne": True}}, {"_id": 0, "id": 1},
    ).to_list(200)
    return sorted(row["id"] for row in rows if row.get("id"))


async def _warn(db, row: dict) -> None:
    from services.dolibarr_policy import club_today
    from services.match_audience import users_for
    from services.user_notifications import create_user_notification

    tournament = row["tournament"]
    title = tournament.get("title") or "Liga"
    base = {"tournament_id": tournament.get("id"), "team_id": row["team_id"], "squad_id": row["squad_id"]}
    # Je Größe und Wiener Tag einmal: Ein weiterer Abgang warnt neu, ein erneuter nach dem Auffüllen am nächsten Tag auch.
    dedupe = f"league-squad-short:{row['registration_id']}:{row['size']}:{club_today()}"
    care = sorted(user["id"] for user in await users_for(db, row["care_ids"], {"_id": 0, "id": 1}))
    for user_id in care:
        await create_user_notification(
            user_id,
            f"Kader zu klein: {row['squad_name']}",
            f"{title}: Im Kader stehen noch {row['size']} Spieler, die Liga verlangt mindestens {row['min_size']}. Bitte den "
            "Kader auffüllen – das geht auf der Website unter Teams → Deine Teams.",
            url=f"/teams/{row['team_id']}",
            kind="tournament_registration",
            meta={**base, "reason": "league_squad_short", "dedupe_key": dedupe},
        )
    season_id = (tournament.get("league_context") or {}).get("season_id")
    for user_id in await _lead_ids(db, tournament):
        if user_id in care:
            continue
        await create_user_notification(
            user_id,
            f"Kader zu klein: {row.get('display_name') or row['squad_name']}",
            f"{title}: Im Kader stehen noch {row['size']} Spieler, die Liga verlangt mindestens {row['min_size']}.",
            url=f"/admin/leagues/seasons/{season_id}" if season_id else f"/tournaments/{tournament.get('id')}",
            kind="tournament_registration",
            meta={**base, "reason": "league_squad_short_lead", "dedupe_key": dedupe},
        )


async def warn_after_departure(db, before: list[dict]) -> None:
    """Nach einem Abgang: ``before`` sind die betroffenen Co-Teams, wie sie vorher standen. Gewarnt wird nur, wenn der Kader
    wirklich kleiner wurde. Der Abgang ist schon gespeichert - eine klemmende Nachricht hält ihn nicht auf."""
    sizes = {squad["id"]: len({uid for uid in squad.get("member_ids") or [] if uid}) for squad in before if squad.get("id")}
    if not sizes:
        return
    try:
        regs = await db.tournament_registrations.find(
            {"squad_id": {"$in": sorted(sizes)}, "status": {"$in": list(ACTIVE_REGISTRATION_STATUSES)}}, REGISTRATION_FIELDS,
        ).to_list(500)
        for row in await open_shortages(db, regs):
            if row["size"] < sizes[row["squad_id"]]:
                await _warn(db, row)
    except Exception:  # noqa: BLE001 - siehe oben
        logger.warning("[liga] Warnung zum Kader nicht verschickt: %s", log_safe(",".join(sorted(sizes))), exc_info=True)
