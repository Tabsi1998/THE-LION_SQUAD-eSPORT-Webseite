"""Transfers in der Liga (docs/LIGA.md, Abschnitt 12, B.3, #2204): Wer in einer Season schon für ein Co-Team spielt oder gespielt hat, wechselt
nur im Transferfenster und nur mit Genehmigung der Liga-Leitung. Danach gilt dieselbe Wartezeit wie für jeden neuen Spieler.

Ein Transfer ist nur nötig, wenn die Season ``one_team_per_season`` trägt. Alle Entscheidungen stehen im Protokoll. Beantragen darf, wer den
Kader des Ziel-Co-Teams ändern darf; die Person steht schon im Hauptteam - dort stimmt sie durch ihren Beitritt zu.
"""

from __future__ import annotations

from pymongo.errors import DuplicateKeyError

from models import new_id, now_utc
from services import league_eligibility, league_roster
from services.dolibarr_policy import club_today

PENDING, APPROVED, REJECTED, WITHDRAWN = "pending", "approved", "rejected", "withdrawn"
NO_WINDOWS = "In dieser Season gibt es keine Transfers: Es ist kein Transferfenster eingetragen."
NOT_NEEDED = "Für diese Person ist kein Transfer nötig. Du kannst sie einfach in den Kader aufnehmen."
ALREADY_OPEN = "Für diese Person läuft schon ein Antrag. Die Liga-Leitung entscheidet ihn zuerst."
DECIDED = "Über diesen Antrag ist schon entschieden."
GONE = "Diesen Antrag gibt es nicht."
BUSY = "Eine andere Änderung am Kader läuft gerade. Bitte gleich noch einmal versuchen."


def _window_problem(season: dict) -> str | None:
    windows = season.get("transfer_windows") or []
    if not windows:
        return NO_WINDOWS
    if league_eligibility.open_window(season):
        return None
    coming = sorted(str(window.get("start_date")) for window in windows if str(window.get("start_date")) > club_today())
    if coming:
        return f"Das Transferfenster ist gerade zu. Das nächste öffnet am {coming[0]}."
    return "Das Transferfenster dieser Season ist vorbei."


async def _audit(db, action: str, row: dict, actor_id: str | None, **data) -> None:
    await db.audit_logs.insert_one({
        "id": new_id(), "action": action, "target_id": row.get("season_id"), "actor_id": actor_id,
        "data": {"transfer_id": row.get("id"), "user_id": row.get("user_id"), "from_squad_id": row.get("from_squad_id"),
                 "to_squad_id": row.get("to_squad_id"), **data},
        "created_at": now_utc().isoformat(),
    })


async def _tell(user_ids, *, title: str, body: str, url: str, reason: str, row: dict, status: str) -> None:
    from services.user_notifications import create_user_notification

    for user_id in sorted({uid for uid in user_ids if uid}):
        await create_user_notification(user_id, title, body, url=url, kind="tournament_registration",
                                       meta={"reason": reason, "dedupe_key": f"league-transfer:{row['id']}:{status}:{user_id}"})


async def _team_leads(db, team_id: str | None) -> list[str]:
    team = await db.teams.find_one({"id": team_id}, {"_id": 0, "leader_id": 1, "co_leader_ids": 1}) if team_id else None
    return [uid for uid in ((team or {}).get("leader_id"), *((team or {}).get("co_leader_ids") or [])) if uid]


async def request(db, team: dict, squad: dict, user_id: str, actor: dict) -> dict:
    """Einen Transfer ins Co-Team ``squad`` beantragen. Wirft ``EligibilityError``."""
    seasons = await league_eligibility.open_seasons_of_squad(db, squad.get("id"))
    if user_id not in (team.get("member_ids") or []):
        raise league_eligibility.EligibilityError("Die Person steht noch nicht im Team. Bitte erst ins Team einladen, dann den Transfer beantragen.")
    for season, _tournament in seasons:
        if not season.get("one_team_per_season"):
            continue
        ctx = await league_roster.context_for_season(db, season, [user_id])
        others = await league_eligibility._other_squad_ids(db, season, squad["id"], [user_id], ctx.entries if ctx else {})
        if user_id not in others:
            continue
        problem = _window_problem(season)
        if problem:
            raise league_eligibility.EligibilityError(problem, 409)
        now = now_utc().isoformat()
        row = {"id": new_id(), "season_id": season["id"], "league_id": season.get("league_id"), "user_id": user_id,
               "from_squad_id": sorted(others[user_id])[0], "to_squad_id": squad["id"], "to_team_id": team["id"], "status": PENDING,
               "requested_by": actor.get("id"), "requested_at": now, "decided_by": None, "decided_at": None, "reason": None}
        if await db.league_transfers.find_one({"season_id": season["id"], "user_id": user_id, "status": PENDING}, {"_id": 1}):
            raise league_eligibility.EligibilityError(ALREADY_OPEN, 409)
        try:
            await db.league_transfers.insert_one(dict(row))
        except DuplicateKeyError:
            raise league_eligibility.EligibilityError(ALREADY_OPEN, 409) from None
        await _audit(db, "league.transfer.request", row, actor.get("id"))
        from services.league_permissions import staff_user_ids

        person = league_roster.person_name((ctx.people if ctx else {}).get(user_id))
        await _tell(await staff_user_ids(db, season.get("league_id"), ("roster",)), title="Transfer beantragt",
                    body=f"{team.get('name') or 'Ein Team'} möchte {person} ins Co-Team {squad.get('name') or ''} holen. Bitte entscheiden.",
                    url=f"/admin/leagues/seasons/{season['id']}", reason="league_transfer_requested", row=row, status=PENDING)
        return row
    raise league_eligibility.EligibilityError(NOT_NEEDED, 409)


async def _pending(db, season_id: str, transfer_id: str) -> dict:
    row = await db.league_transfers.find_one({"id": transfer_id, "season_id": season_id}, {"_id": 0})
    if not row:
        raise league_eligibility.EligibilityError(GONE, 404)
    if row.get("status") != PENDING:
        raise league_eligibility.EligibilityError(DECIDED, 409)
    return row


async def _decide(db, row: dict, status: str, actor: dict, reason: str | None) -> dict:
    now = now_utc().isoformat()
    written = await db.league_transfers.update_one(
        {"id": row["id"], "status": PENDING},
        {"$set": {"status": status, "decided_by": actor.get("id"), "decided_at": now, "reason": reason, "updated_at": now}})
    if not written.modified_count:
        raise league_eligibility.EligibilityError(DECIDED, 409)
    return {**row, "status": status, "decided_by": actor.get("id"), "decided_at": now, "reason": reason, "updated_at": now}


async def approve(db, season: dict, transfer_id: str, reason: str | None, actor: dict) -> dict:
    """Genehmigen: unter der Season-Sperre aus dem alten Co-Team ins neue, mit Wartezeit nach Spieltag 1 und Warnung, falls der alte Kader zu
    klein wird. Prüft Alter, Höchstkader und Rolle noch einmal; der Wechsel selbst ist genehmigt."""
    from services import squad_shortage

    async with league_eligibility.squad_change_lock(db, [season]):
        row = await _pending(db, season["id"], transfer_id)
        user_id = row["user_id"]
        target = await db.team_squads.find_one({"id": row["to_squad_id"]}, {"_id": 0})
        source = await db.team_squads.find_one({"id": row.get("from_squad_id")}, {"_id": 0})
        team = await db.teams.find_one({"id": row.get("to_team_id")}, {"_id": 0, "id": 1, "name": 1, "member_ids": 1})
        if not target or not team:
            raise league_eligibility.EligibilityError("Das Ziel-Co-Team gibt es nicht mehr.", 409)
        if user_id not in (team.get("member_ids") or []):
            raise league_eligibility.EligibilityError("Die Person steht nicht mehr im Team. Bitte erst ins Team einladen.", 409)
        tournament = next((staffel for found, staffel in await league_eligibility.open_seasons_of_squad(db, target["id"])
                           if found["id"] == season["id"]), None)
        if not tournament:
            raise league_eligibility.EligibilityError("Das Ziel-Co-Team spielt in dieser Season nicht mehr.", 409)
        if source and user_id in {source.get("captain_id"), source.get("vice_captain_id")}:
            role = "Captain" if source.get("captain_id") == user_id else "Vertreter"
            raise league_eligibility.EligibilityError(f"Die Person ist {role} im alten Co-Team. Die Teamleitung vergibt die Rolle zuerst neu.", 409)
        members = [uid for uid in target.get("member_ids") or [] if uid]
        added = [] if user_id in members else [user_id]
        problem = await league_eligibility.roster_addition_problem(db, season, tournament, target["id"], added, len(members) + len(added), transfer=True)
        if problem:
            raise league_eligibility.EligibilityError(problem[1], problem[0])
        row = await _decide(db, row, APPROVED, actor, (reason or "").strip() or None)
        if source and user_id in (source.get("member_ids") or []):
            await db.team_squads.update_one({"id": source["id"]}, {"$pull": {"member_ids": user_id}, "$set": {"updated_at": row["decided_at"]}})
        await db.team_squads.update_one({"id": target["id"]}, {"$addToSet": {"member_ids": user_id}, "$set": {"updated_at": row["decided_at"]}})
        ctx = await league_roster.context_for_tournament(db, tournament, [user_id])
        wait = bool(season.get("new_player_wait_days")) and league_roster.first_matchday_over(tournament)
        await league_roster.record_members(db, ctx, [user_id], via="transfer", actor_id=actor.get("id"), squad_id=target["id"], wait=wait)
    await _audit(db, "league.transfer.approve", row, actor.get("id"), **({"reason": row["reason"]} if row["reason"] else {}))
    url = f"/teams/{team['id']}"
    leads = {*await _team_leads(db, team["id"]), *await _team_leads(db, (source or {}).get("team_id"))}
    await _tell({user_id, *leads}, title="Transfer genehmigt", body=f"Die Liga-Leitung hat den Wechsel ins Co-Team {target.get('name') or ''} genehmigt.",
                url=url, reason="league_transfer_approved", row=row, status=APPROVED)
    if source:
        await squad_shortage.warn_after_departure(db, [source])
    return row


async def reject(db, season: dict, transfer_id: str, reason: str | None, actor: dict) -> dict:
    text = (reason or "").strip()
    if len(text) < league_roster.REASON_MIN_LENGTH:
        raise league_eligibility.EligibilityError(f"Bitte einen Grund angeben (mindestens {league_roster.REASON_MIN_LENGTH} Zeichen). Er steht im Protokoll.")
    row = await _decide(db, await _pending(db, season["id"], transfer_id), REJECTED, actor, text)
    await _audit(db, "league.transfer.reject", row, actor.get("id"), reason=text)
    await _tell({row["user_id"], *await _team_leads(db, row.get("to_team_id"))}, title="Transfer abgelehnt",
                body=f"Die Liga-Leitung hat den Wechsel abgelehnt: {text}", url=f"/teams/{row.get('to_team_id')}",
                reason="league_transfer_rejected", row=row, status=REJECTED)
    return row


async def withdraw(db, squad_id: str, transfer_id: str, actor: dict) -> dict:
    row = await db.league_transfers.find_one({"id": transfer_id, "to_squad_id": squad_id}, {"_id": 0})
    if not row:
        raise league_eligibility.EligibilityError(GONE, 404)
    if row.get("status") != PENDING:
        raise league_eligibility.EligibilityError(DECIDED, 409)
    row = await _decide(db, row, WITHDRAWN, actor, None)
    await _audit(db, "league.transfer.withdraw", row, actor.get("id"))
    return row


async def _view(db, rows: list[dict]) -> list[dict]:
    """Die Anträge mit Namen für die Anzeige."""
    user_ids = sorted({row["user_id"] for row in rows if row.get("user_id")})
    squad_ids = sorted({sid for row in rows for sid in (row.get("from_squad_id"), row.get("to_squad_id")) if sid})
    people = {row["id"]: league_roster.person_name(row) for row in await db.users.find(
        {"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "display_name": 1, "username": 1}).to_list(len(user_ids) + 1)} if user_ids else {}
    squads = {row["id"]: row.get("name") for row in await db.team_squads.find(
        {"id": {"$in": squad_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(len(squad_ids) + 1)} if squad_ids else {}
    return [{**row, "user_name": people.get(row.get("user_id"), "Gelöschter User"), "from_squad_name": squads.get(row.get("from_squad_id")),
             "to_squad_name": squads.get(row.get("to_squad_id"))} for row in rows]


async def for_season(db, season_id: str) -> list[dict]:
    rows = await db.league_transfers.find({"season_id": season_id}, {"_id": 0}).sort("requested_at", -1).to_list(200)
    return await _view(db, rows)


async def for_squad(db, squad_id: str, season_id: str | None = None) -> list[dict]:
    query = {"to_squad_id": squad_id, **({"season_id": season_id} if season_id else {})}
    rows = await db.league_transfers.find(query, {"_id": 0}).sort("requested_at", -1).to_list(50)
    return await _view(db, rows)
