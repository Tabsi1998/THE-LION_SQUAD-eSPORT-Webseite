"""Team auflösen (#1274): nur mit dem eingetippten Teamnamen, und vorher steht da, was passiert.

Bisher stand „Löschen“ rot neben „Bearbeiten“ - zwischen einem Fehlgriff am Handy und einem gelöschten Team lag nur
ein „Ja“. Jetzt liegt „Team auflösen“ ganz unten im Bearbeiten-Blatt und nennt vorher, was passiert:

- alle Mitglieder verlieren das Team, der Team-Chat ist weg (Nachrichten, Einladungs-Link, offene Einladungen);
- Anmeldungen für Turniere, die noch nicht begonnen haben, werden zurückgezogen (wie „Vom Turnier abmelden“:
  der Platz wird frei, ein offener Startgeld-Auftrag schließt);
- läuft ein Turnier gerade (Check-in, live, Pause) oder ist das Team dort schon eingecheckt oder hat Spiele, geht es
  nicht - das klärt erst die Turnierleitung. Die Rückfrage nennt diese Turniere.
- fertige Turniere bleiben, wie sie sind (Ergebnisse und Auszeichnungen gehören zur Geschichte).

Auflösen darf der Kapitän (und der Club-Admin) - wie bisher; Co-Kapitäne bearbeiten, lösen aber nicht auf.
"""
from __future__ import annotations

import re

from fastapi import HTTPException

from models import new_id, now_utc

NOT_STARTED = {"draft", "scheduled", "registration_open", "registration_closed"}
FINISHED = {"completed", "results_published", "archived", "cancelled"}
ACTIVE_REGISTRATIONS = ("pending", "approved", "checked_in", "waitlist")
OPEN_MATCH_STATUSES = ["preview", "pending", "ready", "scheduled", "cancelled"]


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
        played = await db.matches_v2.count_documents({
            "tournament_id": tournament["id"], "slots.registration_id": reg["id"], "status": {"$nin": OPEN_MATCH_STATUSES},
        })
        if tournament.get("status") not in NOT_STARTED:
            blocked.append({**card, "reason": "Das Turnier läuft gerade – das klärt die Turnierleitung."})
        elif reg.get("status") == "checked_in" or played:
            blocked.append({**card, "reason": "Das Team ist schon eingecheckt oder hat Spiele – das klärt die Turnierleitung."})
        else:
            withdraw.append(card)
    chat = await db.team_chat_messages.count_documents({"team_id": team["id"], "deleted_at": {"$exists": False}})
    return {
        "member_count": len(team.get("member_ids") or []),
        "chat_messages": chat,
        "withdraw": withdraw,
        "blocked": blocked,
        "can_dissolve": not blocked,
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
    await db.teams.delete_one({"id": team_id})
    await db.team_members.delete_many({"team_id": team_id})
    await db.team_squads.delete_many({"team_id": team_id})
    await db.team_chat_messages.delete_many({"team_id": team_id})
    await db.team_invite_links.delete_many({"team_id": team_id})
    await db.team_invites.update_many({"team_id": team_id, "status": "pending"},
                                      {"$set": {"status": "cancelled", "updated_at": now_utc().isoformat()}})
    await db.audit_logs.insert_one({
        "id": new_id(), "action": "team.dissolve", "target_id": team_id, "actor_id": actor.get("id"),
        "data": {"name": team.get("name"), "members": preview["member_count"], "withdrawn": [row["tournament_id"] for row in preview["withdraw"]]},
        "created_at": now_utc().isoformat(),
    })
    from services.change_events import publish_user_change
    await publish_user_change(list(team.get("member_ids") or []), "teams")
    return {"ok": True, "withdrawn": len(preview["withdraw"])}
