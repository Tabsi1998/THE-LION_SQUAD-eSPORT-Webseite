"""Team auflösen (#1274) und wiederherstellen (#2128, TM8): nur mit dem eingetippten Teamnamen, und vorher steht da, was passiert.

Bisher stand „Löschen“ rot neben „Bearbeiten“ - zwischen einem Fehlgriff am Handy und einem gelöschten Team lag nur
ein „Ja“. Jetzt liegt „Team auflösen“ ganz unten im Bearbeiten-Blatt und nennt vorher, was passiert:

- alle Mitglieder verlieren das Team, Einladungs-Link und offene Einladungen sind weg;
- Anmeldungen für Turniere, die noch nicht begonnen haben, werden zurückgezogen (wie „Vom Turnier abmelden“:
  der Platz wird frei, ein offener Startgeld-Auftrag schließt) - auch nach dem Wiederherstellen bleiben sie das;
- läuft ein Turnier gerade (Check-in, live, Pause) oder ist das Team dort schon eingecheckt oder hat Spiele, geht es
  nicht - das klärt erst die Turnierleitung. Die Rückfrage nennt diese Turniere.
- fertige Turniere bleiben, wie sie sind (Ergebnisse und Auszeichnungen gehören zur Geschichte).

Auflösen darf die Teamleitung (und der Club-Admin) - wie bisher; die Co-Leitung bearbeitet, löst aber nicht auf.

**Weich:** Team, Mitgliederzeilen und Co-Teams wandern in einem Zug nach ``dissolved_teams``. Alles, was ``teams`` liest -
öffentliche Listen, Suche, Beitritt, Team-Prüfungen, Liga, App -, kennt das Team damit nicht mehr, ohne dass irgendwo ein
Filter stehen müsste. Der Chat bleibt liegen, ist aber ohne Team für niemanden erreichbar.
``DISSOLVED_TEAM_RETENTION_DAYS`` Tage lang stellen die frühere Teamleitung oder ein Admin das Team wieder her
(mit neuem Beitrittscode und neuem Einladungs-Link; der alte Code wird nicht mitgespeichert). Danach räumt der tägliche
Job auf: Chat und Daten sind weg, nur Name und Kürzel bleiben, damit alte Turniere einen Namen zeigen
(``services/team_history.py``). Löscht eine Person ihr Konto, verschwindet sie sofort auch aus den aufgelösten Teams
(``forget_person``).
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta

from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError

from models import TEAM_TAG_MAX_LENGTH, TEAM_TAG_MIN_LENGTH, new_id, now_utc
from services.log_safe import log_safe

logger = logging.getLogger("tls.teams")

NOT_STARTED = {"draft", "scheduled", "registration_open", "registration_closed"}
FINISHED = {"completed", "results_published", "archived", "cancelled"}
ACTIVE_REGISTRATIONS = ("pending", "approved", "checked_in", "waitlist")
OPEN_MATCH_STATUSES = ["preview", "pending", "ready", "scheduled", "cancelled"]
LEAGUE_SQUAD_REASON = "Ein Co-Team des Teams ist dieser Liga-Staffel zugeteilt – das klärt die Turnierleitung."
# So lange lässt sich ein aufgelöstes Team wiederherstellen; der Wert steht auch in den Texten der Oberfläche (Vorschau).
DISSOLVED_TEAM_RETENTION_DAYS = 30
RESTORE_ONLY_FIELDS = ("dissolved_at", "dissolved_by", "purge_at", "squads", "memberships")
GONE_AFTER_PURGE = {"_id": 0, "id": 1, "name": 1, "tag": 1, "is_public": 1, "dissolved_at": 1}


def same_name(team: dict, typed: str | None) -> bool:
    """Eingetippt wie der Teamname - Groß/klein und doppelte Leerzeichen zählen nicht."""
    def norm(value):
        return re.sub(r"\s+", " ", str(value or "")).strip().casefold()
    return bool(norm(typed)) and norm(typed) == norm(team.get("name"))


async def dissolve_preview(db, team: dict) -> dict:
    """Was beim Auflösen passiert - für den Satz im Bearbeiten-Blatt und die Prüfung beim Auflösen selbst."""
    regs = await db.tournament_registrations.find(
        {"team_id": team["id"], "status": {"$in": list(ACTIVE_REGISTRATIONS)}}, {"_id": 0, "identity_key": 0},
    ).to_list(200)
    ids = sorted({reg.get("tournament_id") for reg in regs if reg.get("tournament_id")})
    tournaments = {row["id"]: row for row in await db.tournaments.find(
        {"id": {"$in": ids}}, {"_id": 0, "id": 1, "slug": 1, "title": 1, "status": 1, "start_date": 1},
    ).to_list(len(ids) or 1)}
    withdraw, blocked = [], []
    for reg in regs:
        tournament = tournaments.get(reg.get("tournament_id"))
        if not tournament or tournament.get("status") in FINISHED:
            continue
        card = {"registration_id": reg["id"], "tournament_id": tournament["id"], "slug": tournament.get("slug"),
                "title": tournament.get("title") or "Turnier", "start_date": tournament.get("start_date")}
        if reg.get("squad_id"):
            # Zugeteiltes Co-Team einer Liga (#1649): herausnehmen kann nur die Turnierleitung.
            blocked.append({**card, "reason": LEAGUE_SQUAD_REASON})
            continue
        played = await db.matches_v2.count_documents({
            "tournament_id": tournament["id"], "slots.registration_id": reg["id"], "status": {"$nin": OPEN_MATCH_STATUSES},
        })
        if tournament.get("status") not in NOT_STARTED:
            blocked.append({**card, "reason": "Das Turnier läuft gerade – das klärt die Turnierleitung."})
        elif reg.get("status") == "checked_in" or played:
            blocked.append({**card, "reason": "Das Team ist schon eingecheckt oder hat Spiele – das klärt die Turnierleitung."})
        else:
            withdraw.append(card)
    # Auch ausgetretene oder disqualifizierte Co-Teams stehen bis zum Ende der Staffel in Tabelle und Spielplan.
    from services.squad_registration import active_league_registration

    listed = {row["registration_id"] for row in blocked}
    for squad in await db.team_squads.find({"team_id": team["id"]}, {"_id": 0, "id": 1}).to_list(200):
        active = await active_league_registration(db, squad["id"])
        if active and active["id"] not in listed:
            listed.add(active["id"])
            blocked.append({"registration_id": active["id"], "tournament_id": active.get("tournament_id"), "slug": active.get("tournament_slug"),
                            "title": active.get("tournament_title") or "Liga-Staffel", "start_date": None,
                            "reason": LEAGUE_SQUAD_REASON})
    chat = await db.team_chat_messages.count_documents({"team_id": team["id"], "deleted_at": {"$exists": False}})
    return {
        "member_count": len(team.get("member_ids") or []),
        "chat_messages": chat,
        "withdraw": withdraw,
        "blocked": blocked,
        "can_dissolve": not blocked,
        "restore_days": DISSOLVED_TEAM_RETENTION_DAYS,
    }


async def dissolve(db, team: dict, actor: dict) -> dict:
    """Das Team auflösen - vorher prüfen, was ``dissolve_preview`` nennt."""
    preview = await dissolve_preview(db, team)
    if preview["blocked"]:
        names = ", ".join(row["title"] for row in preview["blocked"])
        raise HTTPException(status_code=409, detail=f"Auflösen geht gerade nicht: {names}. Das klärt erst die Turnierleitung.")
    from routes.tournament_common import _audit_tournament_action
    from routes.tournament_registration_routes import _refresh_tournament_previews_after_registration
    from services import tournament_fees
    from services.mutation_lock import MutationLockBusy, mutation_lock, tournament_write_resource

    for row in preview["withdraw"]:
        try:
            async with mutation_lock(db, tournament_write_resource(row["tournament_id"])):
                reg = await db.tournament_registrations.find_one({"id": row["registration_id"]}, {"_id": 0})
                if not reg:
                    continue
                await tournament_fees.close_price(db, reg, "Team aufgelöst")
                await db.tournament_registrations.delete_one({"id": reg["id"]})
                tournament = await db.tournaments.find_one({"id": row["tournament_id"]}, {"_id": 0})
                if tournament:
                    await _refresh_tournament_previews_after_registration(db, tournament, actor.get("id"))
                await _audit_tournament_action(db, "tournament.registration.delete", actor.get("id"), row["tournament_id"],
                                               {"registration_id": reg["id"], "team_id": team["id"], "team_dissolved": True})
        except MutationLockBusy:
            raise HTTPException(status_code=409, detail="Eine Turnieraktion wird gerade verarbeitet. Bitte gleich noch einmal versuchen.")

    team_id = team["id"]
    now = now_utc()
    purge_at = (now + timedelta(days=DISSOLVED_TEAM_RETENTION_DAYS)).isoformat()
    # Erst sichern, dann löschen - bricht es dazwischen ab, ist nichts verloren.
    archive = {key: value for key, value in team.items() if key not in ("_id", "join_code", "members", "leader")}
    archive.update({
        "dissolved_at": now.isoformat(), "dissolved_by": actor.get("id"), "purge_at": purge_at,
        "squads": await db.team_squads.find({"team_id": team_id}, {"_id": 0}).to_list(500),
        "memberships": await db.team_members.find({"team_id": team_id}, {"_id": 0}).to_list(2000),
    })
    await db.dissolved_teams.replace_one({"id": team_id}, archive, upsert=True)
    await db.teams.delete_one({"id": team_id})
    await db.team_members.delete_many({"team_id": team_id})
    await db.team_squads.delete_many({"team_id": team_id})
    await db.team_invite_links.delete_many({"team_id": team_id})
    await db.team_invites.update_many({"team_id": team_id, "status": "pending"},
                                      {"$set": {"status": "cancelled", "updated_at": now.isoformat()}})
    await db.audit_logs.insert_one({
        "id": new_id(), "action": "team.dissolve", "target_id": team_id, "actor_id": actor.get("id"),
        "data": {"name": team.get("name"), "members": preview["member_count"], "withdrawn": [row["tournament_id"] for row in preview["withdraw"]],
                 "purge_at": purge_at},
        "created_at": now.isoformat(),
    })
    await _tell_members(team, actor, title=f"[{team.get('tag')}] wurde aufgelöst",
                        body=f"{team.get('name')} gibt es nicht mehr. Die frühere Teamleitung kann es "
                             f"{DISSOLVED_TEAM_RETENTION_DAYS} Tage lang wiederherstellen.",
                        url="/teams", kind="team_dissolved")
    from services.change_events import publish_user_change
    await publish_user_change(list(team.get("member_ids") or []), "teams")
    return {"ok": True, "withdrawn": len(preview["withdraw"]), "restore_until": purge_at}


async def _tell_members(team: dict, actor: dict, **note) -> None:
    from services.user_notifications import create_user_notification

    for user_id in sorted(set(team.get("member_ids") or []) - {actor.get("id")}):
        try:
            await create_user_notification(user_id, meta={"team_id": team["id"]}, **note)
        except Exception:  # noqa: BLE001 - das Team ist schon aufgelöst bzw. zurück; eine Nachricht hält das nicht auf
            logger.warning("[teams] Nachricht an %s nicht verschickt", log_safe(user_id), exc_info=True)


def is_restorable(row: dict | None, now: datetime | None = None) -> bool:
    """Noch in der Frist? Ist sie vorbei, hilft kein Wiederherstellen mehr - auch wenn der Job noch nicht lief."""
    return bool(row and row.get("purge_at") and not row.get("purged_at")
                and str(row["purge_at"]) > (now or now_utc()).isoformat())


def dissolved_view(row: dict, now: datetime | None = None) -> dict:
    """Eine Zeile für „Aufgelöste Teams“ - ohne Mitgliederlisten und Rollen."""
    until = datetime.fromisoformat(str(row["purge_at"]))
    return {
        "id": row["id"], "name": row.get("name"), "tag": row.get("tag"), "logo_url": row.get("logo_url"),
        "is_public": row.get("is_public", True), "member_count": len(row.get("member_ids") or []),
        "squad_count": len(row.get("squads") or []), "dissolved_at": row.get("dissolved_at"), "purge_at": row["purge_at"],
        "days_left": max((until - (now or now_utc())).days + 1, 0),
    }


async def dissolved_for_leader(db, user_id: str) -> list[dict]:
    """Was diese Person als frühere Teamleitung noch wiederherstellen kann."""
    rows = await db.dissolved_teams.find({"leader_id": user_id, "purged_at": {"$exists": False}}, {"_id": 0}).sort("dissolved_at", -1).to_list(50)
    return [dissolved_view(row) for row in rows if is_restorable(row)]


async def _next_leader(db, row: dict) -> str | None:
    """Wer das Team nach dem Wiederherstellen führt: die frühere Teamleitung, ist ihr Konto weg die Co-Leitung, dann ein Mitglied."""
    order = [row.get("leader_id"), *(row.get("co_leader_ids") or []), *(row.get("member_ids") or [])]
    wanted = list(dict.fromkeys(user_id for user_id in order if user_id))
    usable = {user["id"] async for user in db.users.find(
        {"id": {"$in": wanted}, "is_active": {"$ne": False}, "anonymized_at": {"$exists": False}}, {"_id": 0, "id": 1})}
    return next((user_id for user_id in wanted if user_id in usable), None)


async def restore(db, row: dict, actor: dict, tag: str | None = None) -> dict:
    """Das Team zurückholen - mit neuem Beitrittscode. Zurückgezogene Anmeldungen bleiben zurückgezogen."""
    from services.team_page import new_join_code

    team_id = row["id"]
    if not is_restorable(row):
        raise HTTPException(status_code=409, detail=f"Die {DISSOLVED_TEAM_RETENTION_DAYS} Tage sind vorbei – dieses Team lässt sich nicht mehr wiederherstellen.")
    final_tag = (tag or "").strip().upper() or row.get("tag")
    if tag is not None and not TEAM_TAG_MIN_LENGTH <= len(final_tag) <= TEAM_TAG_MAX_LENGTH:
        raise HTTPException(status_code=400, detail=f"Das Kürzel braucht {TEAM_TAG_MIN_LENGTH} bis {TEAM_TAG_MAX_LENGTH} Zeichen.")
    if await db.teams.find_one({"tag": final_tag}, {"_id": 1}):
        raise HTTPException(status_code=409, detail=f"Das Kürzel {final_tag} hat inzwischen ein anderes Team – bitte gib ein neues an.")
    if final_tag != row.get("tag"):
        from services import word_filter
        await word_filter.screen_field(db, final_tag, kind="team_name", user_id=actor.get("id"), ref_id=team_id)
    leader_id = await _next_leader(db, row)
    if not leader_id:
        raise HTTPException(status_code=409, detail="Niemand aus dem Team hat noch ein aktives Konto – so ließe es sich nicht führen.")
    now = now_utc().isoformat()
    team = {key: value for key, value in row.items() if key not in (*RESTORE_ONLY_FIELDS, "_id")}
    co_leaders = [user_id for user_id in row.get("co_leader_ids") or [] if user_id != leader_id]
    team.update({"tag": final_tag, "leader_id": leader_id, "co_leader_ids": co_leaders, "join_code": new_join_code(), "updated_at": now})
    try:
        await db.teams.insert_one(dict(team))
    except DuplicateKeyError:  # schon wiederhergestellt - zwei Klicks, zwei Geräte
        raise HTTPException(status_code=409, detail="Dieses Team ist schon wiederhergestellt.") from None
    if row.get("squads"):
        await db.team_squads.insert_many([dict(squad) for squad in row["squads"]])
    rows = [dict(member) for member in row.get("memberships") or []]
    for member in rows:
        if member.get("user_id") == leader_id:
            member["role"] = "leader"
    if rows:
        await db.team_members.insert_many(rows)
    await db.dissolved_teams.delete_one({"id": team_id})
    await db.audit_logs.insert_one({
        "id": new_id(), "action": "team.restore", "target_id": team_id, "actor_id": actor.get("id"),
        "data": {"name": team.get("name"), "tag": final_tag, "leader_id": leader_id, "members": len(team.get("member_ids") or []),
                 "leader_changed": leader_id != row.get("leader_id")},
        "created_at": now,
    })
    await _tell_members(team, actor, title=f"[{final_tag}] ist wieder da",
                        body=f"{team.get('name')} wurde wiederhergestellt – du bist wieder dabei.",
                        url=f"/teams/{team_id}", kind="team_restored")
    from services.change_events import publish_user_change
    await publish_user_change(list(team.get("member_ids") or []), "teams")
    return team


async def _final_cleanup(db, row: dict, now: str) -> None:
    """Nur Name und Kürzel bleiben - für alte Turniere; Chat und Daten sind weg."""
    if not await db.teams.find_one({"id": row["id"]}, {"_id": 1}):
        await db.team_chat_messages.delete_many({"team_id": row["id"]})
    keep = {key: row.get(key) for key in GONE_AFTER_PURGE if key != "_id" and key in row}
    await db.dissolved_teams.replace_one({"id": row["id"]}, {**keep, "purged_at": now})


async def purge_dissolved_teams(db, now: datetime | None = None) -> int:
    """Der tägliche Job: aufgelöste Teams, deren Frist vorbei ist, endgültig aufräumen."""
    stamp = (now or now_utc()).isoformat()
    rows = await db.dissolved_teams.find({"purged_at": {"$exists": False}, "purge_at": {"$lte": stamp}}, GONE_AFTER_PURGE).to_list(500)
    for row in rows:
        await _final_cleanup(db, row, stamp)
    return len(rows)


def _without_person(row: dict, user_id: str) -> dict:
    """Die Person aus Mitgliedern, Rollen, Co-Teams und Mitgliederzeilen nehmen - das Team bleibt bis zum Ende der Frist."""
    changes: dict = {
        "member_ids": [uid for uid in row.get("member_ids") or [] if uid != user_id],
        "co_leader_ids": [uid for uid in row.get("co_leader_ids") or [] if uid != user_id],
        "memberships": [member for member in row.get("memberships") or [] if member.get("user_id") != user_id],
    }
    if row.get("leader_id") == user_id:
        changes["leader_id"] = None
    if row.get("dissolved_by") == user_id:
        changes["dissolved_by"] = None
    squads = []
    for squad in row.get("squads") or []:
        clean = {**squad, "member_ids": [uid for uid in squad.get("member_ids") or [] if uid != user_id]}
        for field in ("captain_id", "vice_captain_id"):
            if clean.get(field) == user_id:
                clean.pop(field)
        if clean.get("created_by") == user_id:
            clean["created_by"] = None
        squads.append(clean)
    changes["squads"] = squads
    return changes


async def forget_person(db, user_id: str) -> int:
    """Personenlöschung: gilt auch für aufgelöste Teams. Bleibt niemand übrig, ist auch das Team vorzeitig aufgeräumt.
    Beim Nachzug einer Löschung läuft das wieder - es ändert dann nichts."""
    rows = await db.dissolved_teams.find({"purged_at": {"$exists": False}, "$or": [
        {"member_ids": user_id}, {"leader_id": user_id}, {"co_leader_ids": user_id}, {"dissolved_by": user_id},
        {"memberships.user_id": user_id}, {"squads.member_ids": user_id}, {"squads.captain_id": user_id},
        {"squads.vice_captain_id": user_id}, {"squads.created_by": user_id},
    ]}, {"_id": 0}).to_list(200)
    for row in rows:
        changes = _without_person(row, user_id)
        if changes["member_ids"]:
            await db.dissolved_teams.update_one({"id": row["id"]}, {"$set": changes})
        else:
            await _final_cleanup(db, row, now_utc().isoformat())
    return len(rows)
