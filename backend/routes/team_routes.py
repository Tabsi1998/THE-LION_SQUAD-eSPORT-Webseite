"""Team routes."""
import logging
import re
from typing import Optional, Literal
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from database import get_db
from services import game_usage, league_eligibility, league_roster, moderation_standing
from services.mutation_lock import MutationLockBusy
from auth import get_current_user, get_optional_user
from models import TEAM_NAME_MAX_LENGTH, TEAM_NAME_MIN_LENGTH, TEAM_TAG_MAX_LENGTH, TEAM_TAG_MIN_LENGTH, TeamCreate, TeamUpdate, now_utc, new_id
from services.notification_preferences import send_user_template
from services.user_notifications import build_public_url, create_user_notification
from services.chat_attachments import MAX_ATTACHMENTS_PER_MESSAGE, chat_message_preview, claim_attachments, register_chat_access
from services.query_filters import safe_regex
from services.team_page import new_join_code
from services import word_filter
from services.log_safe import log_safe
from services.private_fields import private_projection
from services.permissions import (
    MFA_MESSAGE,
    admin_role_without_second_factor,
    is_confirmed_admin_role,
    is_confirmed_tournament_lead,
    lead_without_second_factor,
)

router = APIRouter(prefix="/api/teams", tags=["teams"])
logger = logging.getLogger("tls.teams")


def _page_items(items: list[dict], limit: int, offset: int, paged: bool):
    safe_limit = max(1, min(int(limit or 48), 200))
    safe_offset = max(0, int(offset or 0))
    page = items[safe_offset:safe_offset + safe_limit]
    if not paged:
        return page
    return {"items": page, "total": len(items), "limit": safe_limit, "offset": safe_offset}


# Das Formular kennt nur noch das Spiel (#2128, TM3). ``tournament_id`` und ``season_id`` stehen an alten Co-Teams noch in
# der Datenbank, liest aber niemand - und sie werden nicht mehr geschrieben (ein älterer Aufruf, der sie schickt, stört nicht).
class TeamSquadCreate(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    description: Optional[str] = None
    game_id: Optional[str] = None
    member_ids: list[str] = Field(default_factory=list)
    status: Literal["active", "archived"] = "active"
    # Liga (docs/LIGA.md, #1649): Captain und Vertreter handeln für das Co-Team - beide aus dem Kader, verschieden.
    captain_id: Optional[str] = Field(default=None, max_length=64)
    vice_captain_id: Optional[str] = Field(default=None, max_length=64)


class TeamSquadUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=80)
    description: Optional[str] = None
    game_id: Optional[str] = None
    member_ids: Optional[list[str]] = None
    status: Optional[Literal["active", "archived"]] = None
    captain_id: Optional[str] = Field(default=None, max_length=64)
    vice_captain_id: Optional[str] = Field(default=None, max_length=64)


class TeamSquadRoles(BaseModel):
    captain_id: Optional[str] = Field(default=None, max_length=64)
    vice_captain_id: Optional[str] = Field(default=None, max_length=64)


SQUAD_ROLE_FIELDS = ("captain_id", "vice_captain_id")
SQUAD_ROLE_LABELS = {"captain_id": "Captain", "vice_captain_id": "Vertreter"}
# Die App kennt Captain und Vertreter noch nicht (L-D12, #2110) und zeigt den Text des Servers - darum steht der Weg
# auf der Website in jeder Meldung, die eine Rolle im Weg hat.
ROLES_ON_WEBSITE = "Captain und Vertreter vergibst du auf der Website unter Teams → Deine Teams (Co-Team bearbeiten)."
RESIGN_ON_WEBSITE = "Deine Rolle gibst du auf der Website unter Teams → Deine Teams mit „Rolle abgeben“ ab."
TAG_TAKEN = "Dieses Kürzel ist schon vergeben."
LEADER_CANNOT_LEAVE = ("Als Teamleitung kannst du das Team nicht verlassen. Übergib zuerst die Leitung (auf der Teamseite "
                       "unter „Mitglieder verwalten“ → „Zur Teamleitung machen“) oder löse das Team unter „Bearbeiten“ auf.")


class TeamInviteCreate(BaseModel):
    user_id: str


class TeamChatCreate(BaseModel):
    message: str = Field(default="", max_length=1500)
    attachment_ids: list[str] = Field(default_factory=list, max_length=MAX_ATTACHMENTS_PER_MESSAGE)
    sticker_id: str | None = Field(default=None, max_length=80)


MENTION_RE = re.compile(r"@([A-Za-z0-9_.-]{2,32})")


# Teams verwalten außer Leitung und Co-Leitung: Turnierleitung, Club-Admin, Superadmin (die Freigabe nur bei der Pflege,
# ``_can_edit_team``). Moderatoren
# moderieren (Wortfilter für Teamnamen, Bildprüfung für Logos und Banner). Mitglieder entfernen, Rollen ändern, die
# Leitung übergeben und auflösen dürfen außer der Leitung nur Club-Admin und Superadmin. Wie jeder Adminbereich nur mit
# bestätigter Zwei-Faktor-Anmeldung (#1469); Leitung und Co-Leitung brauchen sie für ihr eigenes Team nicht.
TEAM_ADMIN_ROLES = ("tournament_admin", "club_admin", "superadmin")
TEAM_OWNER_ADMIN_ROLES = ("club_admin", "superadmin")


def _team_admin(user: dict | None, roles=TEAM_ADMIN_ROLES) -> bool:
    return is_confirmed_admin_role(user, roles)


def _refuse(user: dict | None, detail: str, roles=TEAM_ADMIN_ROLES):
    """403 - mit dem Hinweis auf die Zwei-Faktor-Anmeldung, wenn nur sie fehlt."""
    if admin_role_without_second_factor(user, roles):
        raise HTTPException(status_code=403, detail=MFA_MESSAGE)
    raise HTTPException(status_code=403, detail=detail)


def _can_manage(team: dict, user: dict) -> bool:
    return (
        team.get("leader_id") == user["id"]
        or user["id"] in team.get("co_leader_ids", [])
        or _team_admin(user)
    )


def _can_edit_team(team: dict, user: dict) -> bool:
    """Die Pflege aus docs/ROLLEN.md (#2202): Team bearbeiten und Co-Teams. Dort zählt die Freigabe „Turnierleitung“ wie die
    Rolle - nur bei öffentlichen Teams, denn sie öffnet keine Inhalte: Chat, private Teams, Beitrittscode und Einladungen
    bleiben bei ``_can_manage`` und ``_is_staff``, ebenso das Banner."""
    return _can_manage(team, user) or (team.get("is_public") is not False and is_confirmed_tournament_lead(user))


def _grant_lacks_second_factor(team: dict, user: dict | None) -> bool:
    return team.get("is_public") is not False and lead_without_second_factor(user)


def _refuse_edit(team: dict, user: dict | None, detail: str):
    """403 für die Pflege - auch eine Freigabe, der nur die Zwei-Faktor-Anmeldung fehlt, bekommt den Hinweis darauf."""
    if _grant_lacks_second_factor(team, user):
        raise HTTPException(status_code=403, detail=MFA_MESSAGE)
    _refuse(user, detail)


def _leads_team(team: dict, user: dict) -> bool:
    return team.get("leader_id") == user["id"] or user["id"] in (team.get("co_leader_ids") or [])


async def _squad_staffeln(db, squad_id: str | None) -> list[dict]:
    """Die nicht beendeten Liga-Staffeln dieses Co-Teams - ein Turnier im Format Liga ohne Liga-Rahmen zählt nicht."""
    from services.squad_registration import active_league_registrations

    return [row for row in await active_league_registrations(db, squad_id) if isinstance(row.get("league_context"), dict)]


async def _may_change_squad(db, team: dict, squad_id: str | None, user: dict) -> bool:
    """Kader, Captain, Vertreter, Status und Löschen (#2203): Solange das Co-Team in einer nicht beendeten Staffel spielt, nur das
    eigene Team und die Liga-Leitung mit „Kader prüfen“ - in jeder Liga, in der es spielt. Sonst die Pflege wie bisher."""
    staffeln = await _squad_staffeln(db, squad_id)
    if not staffeln:
        return _can_edit_team(team, user)
    if _leads_team(team, user):
        return True
    from services.league_permissions import can

    for row in staffeln:
        if not await can(user, "roster", row["league_context"].get("league_id"), db=db):
            return False
    return True


async def _refuse_squad(db, team: dict, squad_id: str | None, user: dict, detail: str):
    staffeln = await _squad_staffeln(db, squad_id)
    if not staffeln:
        _refuse_edit(team, user, detail)
    from services.league_permissions import refuse

    refusal = await refuse(db, user, staffeln[0]["league_context"].get("league_id"))
    if refusal.detail == MFA_MESSAGE:
        raise refusal
    raise HTTPException(status_code=403, detail=f"Das Co-Team spielt in {staffeln[0].get('tournament_title') or 'einer Liga-Staffel'}. Kader und "
                                                "Rollen ändern jetzt nur das eigene Team und die Liga-Leitung mit „Kader prüfen“.")


def _is_staff(user: dict | None) -> bool:
    return _team_admin(user)


def _is_member(team: dict, user: dict | None) -> bool:
    return bool(user and user.get("id") in team.get("member_ids", []))


def _public_user(user: dict | None) -> dict | None:
    if not user:
        return None
    return {
        "id": user.get("id"),
        "username": user.get("username"),
        "display_name": user.get("display_name"),
        "avatar_url": user.get("avatar_url"),
    }


def _account_gone(user: dict | None) -> bool:
    """Gelöscht oder abgeschaltet - so ein Konto kann kein Team mehr führen (#2113)."""
    return not user or user.get("is_active") is False or bool(user.get("anonymized_at"))


def _public_member(user: dict | None) -> dict | None:
    """Wie ``_public_user``; ein gelöschtes Konto trägt dazu die Marke, damit die Seite „Zur Teamleitung machen“ weglässt."""
    view = _public_user(user)
    if view and _account_gone(user):
        view["is_gone"] = True
    return view


def _user_label(user: dict | None) -> str:
    return (user or {}).get("display_name") or (user or {}).get("username") or "Benutzer"


def _chat_allowed(team: dict, user: dict | None) -> bool:
    return bool(user and (_can_manage(team, user) or _is_member(team, user)))


async def _attachment_allowed(db, context: dict, user: dict | None) -> bool:
    """Anhänge im Team-Chat sieht, wer den Chat des Teams lesen darf (services/chat_attachments.py)."""
    team = await db.teams.find_one({"id": context.get("team_id")}, {"_id": 0})
    return bool(team and _chat_allowed(team, user))


register_chat_access("team", _attachment_allowed)


async def _team_audit(db, action: str, team_id: str, actor_id: str | None, data: dict) -> None:
    """Eine Zeile im Adminprotokoll - nie mit einem Beitrittscode oder Schlüssel darin."""
    await db.audit_logs.insert_one({
        "id": new_id(), "action": action, "target_id": team_id, "actor_id": actor_id, "data": data,
        "created_at": now_utc().isoformat(),
    })


async def _tell(user_id: str | None, **note) -> None:
    """Eine Nachricht in die Glocke - was schon gespeichert ist, hält sie nicht mehr auf."""
    try:
        await create_user_notification(user_id, **note)
    except Exception:  # noqa: BLE001
        logger.warning("[teams] Nachricht an %s nicht verschickt", log_safe(user_id), exc_info=True)


async def _add_team_member(db, team_id: str, user_id: str, role: str = "member") -> None:
    await db.teams.update_one(
        {"id": team_id},
        {"$addToSet": {"member_ids": user_id}, "$set": {"updated_at": now_utc().isoformat()}},
    )
    await db.team_members.update_one(
        {"team_id": team_id, "user_id": user_id},
        {"$set": {
            "team_id": team_id,
            "user_id": user_id,
            "role": role,
            "joined_at": now_utc().isoformat(),
        }},
        upsert=True,
    )
    try:
        from badges import on_team_joined
        await on_team_joined(user_id, team_id)
    except Exception:
        logger.warning("[achievements] Beitritt von %s zu Team %s nicht ausgewertet", log_safe(user_id), log_safe(team_id), exc_info=True)


async def _hydrate_invite(invite: dict) -> dict:
    db = get_db()
    team = await db.teams.find_one(
        {"id": invite.get("team_id")},
        {"_id": 0, "id": 1, "name": 1, "tag": 1, "logo_url": 1},
    )
    inviter = await db.users.find_one(
        {"id": invite.get("invited_by")},
        {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1},
    )
    invite["team"] = team
    invite["inviter"] = _public_user(inviter)
    return invite


async def _hydrate_team(team: dict) -> dict:
    db = get_db()
    members = await db.users.find(
        {"id": {"$in": team.get("member_ids", [])}},
        private_projection("email"),
    ).to_list(100)
    member_order = {uid: idx for idx, uid in enumerate(team.get("member_ids", []))}
    members.sort(key=lambda u: member_order.get(u["id"], 999))
    team["members"] = [_public_member(member) for member in members]
    leader = await db.users.find_one(
        {"id": team.get("leader_id")},
        private_projection("email"),
    )
    team["leader"] = _public_user(leader)
    team["squad_count"] = await db.team_squads.count_documents({"team_id": team["id"]})
    return team


async def _enrich_team_chat(messages: list[dict]) -> list[dict]:
    db = get_db()
    user_ids = list({m.get("user_id") for m in messages if m.get("user_id")})
    users = {u["id"]: u for u in await db.users.find(
        {"id": {"$in": user_ids}},
        {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1},
    ).to_list(300)}
    for message in messages:
        author = users.get(message.get("user_id")) or {}
        message["author"] = {
            "id": author.get("id"),
            "username": author.get("username"),
            "display_name": author.get("display_name") or author.get("username") or "Benutzer",
            "avatar_url": author.get("avatar_url"),
        }
    return messages


async def _notify_team_mentions(db, team: dict, sender: dict, message: dict) -> set[str]:
    handles = {m.lower() for m in MENTION_RE.findall(message.get("message") or "")}
    if not handles:
        return set()
    members = await db.users.find(
        {"id": {"$in": team.get("member_ids") or []}},
        {"_id": 0, "id": 1, "username": 1, "display_name": 1, "email": 1, "notification_preferences": 1, "newsletter_consent": 1},
    ).to_list(500)
    url = await build_public_url(f"/teams/{team['id']}")
    preferences_url = await build_public_url("/profile?tab=notifications")
    notified_ids: set[str] = set()
    for member in members:
        if member.get("id") == sender.get("id"):
            continue
        if (member.get("username") or "").lower() not in handles:
            continue
        await create_user_notification(
            member["id"],
            title=f"Erwähnung im Team-Chat [{team.get('tag')}]",
            body=f"{_user_label(sender)} hat dich erwähnt: {(message.get('message') or '')[:140]}",
            url=f"/teams/{team['id']}",
            kind="team_chat_mention",
            meta={"team_id": team["id"], "message_id": message["id"]},
        )
        await send_user_template(
            member,
            "team_chat_mention",
            display_name=_user_label(member),
            team_name=team.get("name") or team.get("tag") or "Team",
            sender_name=_user_label(sender),
            preview=(message.get("message") or "")[:300],
            url=url,
            preferences_url=preferences_url,
            dedupe_key=f"team_chat_mention:{message['id']}:{member['id']}",
            mail_meta={
                "kind": "team_chat_mention",
                "team_id": team["id"],
                "message_id": message["id"],
                "sender_id": sender.get("id"),
                "user_id": member["id"],
            },
        )
        notified_ids.add(member["id"])
    return notified_ids


async def _notify_team_chat_message(db, team: dict, sender: dict, message: dict, exclude_user_ids: set[str] | None = None) -> None:
    excluded = set(exclude_user_ids or set())
    excluded.add(sender.get("id"))
    recipient_ids = [uid for uid in team.get("member_ids") or [] if uid and uid not in excluded]
    if not recipient_ids:
        return
    for recipient_id in recipient_ids:
        await create_user_notification(
            recipient_id,
            title=f"Neue Teamnachricht [{team.get('tag')}]",
            body=f"{_user_label(sender)}: {chat_message_preview(message, 140)}",
            url=f"/teams/{team['id']}",
            kind="team_chat_message",
            meta={"team_id": team["id"], "message_id": message["id"]},
        )


def _team_summary(team: dict) -> dict:
    return {
        "id": team.get("id"),
        "name": team.get("name"),
        "tag": team.get("tag"),
        "description": team.get("description"),
        "logo_url": team.get("logo_url"),
        "banner_url": team.get("banner_url"),
        "discord_link": team.get("discord_link"),
        "is_public": team.get("is_public", True),
        "member_count": len(team.get("member_ids") or []),
        "squad_count": team.get("squad_count", 0),
        "created_at": team.get("created_at"),
        "updated_at": team.get("updated_at"),
    }


def _viewer_rights(team: dict, user: dict | None) -> dict:
    """Was die Person an diesem Team darf - dieselben Regeln wie die Aktionen (#1479). Web und App lesen diese Felder,
    statt Rollen selbst zu deuten. ``admin_needs_second_factor``: eine Admin-Rolle, der nur die bestätigte
    Zwei-Faktor-Anmeldung fehlt - dann zeigen sie „2FA einrichten“ statt der Verwaltung."""
    if not user:
        return {"can_manage": False, "can_edit_team": False, "can_remove_members": False, "can_dissolve": False,
                "can_change_roles": False, "admin_needs_second_factor": False}
    leads = team.get("leader_id") == user.get("id") or user.get("id") in (team.get("co_leader_ids") or [])
    owns = team.get("leader_id") == user.get("id") or _team_admin(user, TEAM_OWNER_ADMIN_ROLES)
    return {
        "can_manage": _can_manage(team, user),
        # Nur die Pflege (#2202): Wer das hat, aber nicht ``can_manage``, bekommt nur „Bearbeiten“ und die Co-Teams.
        "can_edit_team": _can_edit_team(team, user),
        "can_remove_members": _can_manage_team(team, user),
        "can_dissolve": owns,
        # Rollen ändern und die Leitung übergeben (#2128, TM6): Teamleitung, Club-Admin, Superadmin - auch für ein Team,
        # dessen Teamleitung nicht mehr da ist.
        "can_change_roles": owns,
        "admin_needs_second_factor": not leads and (admin_role_without_second_factor(user, TEAM_ADMIN_ROLES)
                                                    or _grant_lacks_second_factor(team, user)),
    }


def _team_response(team: dict, user: dict | None = None) -> dict:
    rights = _viewer_rights(team, user)
    can_manage = rights["can_manage"]
    is_member = _is_member(team, user)
    if not is_member and not can_manage:
        out = _team_summary(team)
        out["members"] = [_public_user(m) for m in team.get("members", [])]
        out["leader"] = _public_user(team.get("leader"))
        out["leader_id"] = team.get("leader_id")
        out["co_leader_ids"] = team.get("co_leader_ids", [])
        out["member_ids"] = team.get("member_ids", [])
        out["is_member"] = False
        out.update(rights)
        if rights["can_edit_team"]:
            # Das Formular schickt die Farbe mit - sonst setzte die Pflege sie zurück.
            out["color"] = team.get("color")
        return out

    team["member_count"] = len(team.get("member_ids") or [])
    team["is_member"] = is_member
    team.update(rights)
    if not can_manage:
        team.pop("join_code", None)
    return team


def _validate_squad_members(team: dict, member_ids: list[str]) -> list[str]:
    allowed = set(team.get("member_ids", []))
    clean = []
    for uid in member_ids or []:
        if uid not in allowed:
            raise HTTPException(status_code=400, detail="Mitglieder eines Co-Teams müssen im Team sein.")
        if uid not in clean:
            clean.append(uid)
    return clean


def _squad_roles(current: dict, requested: dict, member_ids: list[str], team: dict) -> dict:
    """Captain und Vertreter eines Co-Teams nach einer Änderung (docs/LIGA.md, Abschnitt 5; #1649).

    Beide stehen im Kader und im Hauptteam und sind verschiedene Personen. Wer eine Rolle hat, verlässt den Kader erst,
    wenn die Rolle neu vergeben ist - in derselben Änderung oder davor; sonst 409 mit dem Hinweis, was zu tun ist."""
    roles = {field: current.get(field) or None for field in SQUAD_ROLE_FIELDS}
    for field in SQUAD_ROLE_FIELDS:
        if field in requested:
            roles[field] = (requested.get(field) or "").strip() or None
    members = set(member_ids or [])
    in_team = set(team.get("member_ids") or [])
    for field, user_id in roles.items():
        if user_id and field in requested and user_id not in in_team:
            raise HTTPException(status_code=400, detail=f"{SQUAD_ROLE_LABELS[field]} muss Mitglied des Teams sein.")
        if not user_id or user_id in members:
            continue
        label = SQUAD_ROLE_LABELS[field]
        if field in requested:
            raise HTTPException(status_code=400, detail=f"{label} muss im Kader des Co-Teams stehen.")
        raise HTTPException(status_code=409, detail=f"Diese Person ist {label} des Co-Teams – bitte erst die Rolle neu "
                                                    f"vergeben, dann aus dem Kader nehmen. {ROLES_ON_WEBSITE}")
    if roles["captain_id"] and roles["captain_id"] == roles["vice_captain_id"]:
        raise HTTPException(status_code=400, detail="Captain und Vertreter müssen verschiedene Personen sein.")
    return roles


async def _after_squad_roles(db, team: dict, squad: dict, before: dict, after: dict, me: dict) -> None:
    """Geänderte Rollen: Protokoll ``team.squad.roles`` und eine Nachricht an die, die eine Rolle neu bekommen."""
    if all((before.get(field) or None) == (after.get(field) or None) for field in SQUAD_ROLE_FIELDS):
        return
    await db.audit_logs.insert_one({
        "id": new_id(), "action": "team.squad.roles", "target_id": team["id"], "actor_id": me["id"],
        "data": {"squad_id": squad.get("id"), "squad_name": squad.get("name"),
                 "before": {field: before.get(field) or None for field in SQUAD_ROLE_FIELDS},
                 "after": {field: after.get(field) or None for field in SQUAD_ROLE_FIELDS}},
        "created_at": now_utc().isoformat(),
    })
    for field in SQUAD_ROLE_FIELDS:
        user_id = after.get(field)
        if not user_id or user_id == before.get(field) or user_id == me["id"]:
            continue
        try:
            await create_user_notification(
                user_id,
                title=f"Du bist jetzt {SQUAD_ROLE_LABELS[field]}: {squad.get('name') or 'Co-Team'}",
                body=f"Im Co-Team {squad.get('name') or ''} von {team.get('name') or 'deinem Team'} vereinbarst du "
                     "Termine, meldest und bestätigst Ergebnisse.",
                url=f"/teams/{team['id']}",
                kind="team_role_changed",
                meta={"team_id": team["id"], "squad_id": squad.get("id"), "role": field.removesuffix("_id")},
            )
        except Exception:  # noqa: BLE001 - die Rolle ist schon gespeichert; eine Nachricht hält das nicht auf (#2110)
            logger.warning("[teams] Rollen-Nachricht an %s nicht verschickt", log_safe(user_id), exc_info=True)


SQUAD_CHANGED_MEANWHILE = ("Das Co-Team wurde gerade von jemand anderem geändert – bitte neu laden und noch einmal "
                           "speichern.")


def _unchanged_squad(current: dict) -> dict:
    """Schreiben nur, wenn Kader und Rollen noch so stehen wie gelesen - sonst könnten zwei gleichzeitige Änderungen
    einen Captain außerhalb des Kaders hinterlassen. Ein fehlendes Feld trifft ``None``."""
    return {
        "id": current["id"],
        "team_id": current["team_id"],
        "member_ids": current.get("member_ids"),
        **{field: current.get(field) for field in SQUAD_ROLE_FIELDS},
    }


GAME_UNKNOWN = ("Dieses Spiel gibt es hier nicht. Wähle es auf der Website unter Teams → Deine Teams aus der Liste – "
                "oder lass das Feld leer.")


async def _squad_game(db, value: str | None, current: str | None = None) -> str | None:
    """Das Spiel eines Co-Teams (#2128, TM3): eine Kennung aus ``games`` oder leer. Discord-Rollen und die Spielprüfung der
    Liga lesen es.

    Ein unveränderter Wert bleibt gültig - ein alter Freitext hält also keine andere Änderung am Co-Team auf. Die App hat
    noch ein Freitextfeld: ein genau passender Spielname wird zur Kennung, alles andere abgelehnt (der Text steht in der
    App als Meldung)."""
    text = (value or "").strip()
    if not text:
        return None
    if text == (current or ""):
        return text
    if await db.games.find_one({"id": text}, {"_id": 1}):
        game_id = text
    else:
        exactly = {"$regex": f"^{re.escape(text)}$", "$options": "i"}
        game = await db.games.find_one({"$or": [{"name": exactly}, {"short_name": exactly}, {"slug": exactly}]}, {"_id": 0, "id": 1})
        if not game:
            raise HTTPException(status_code=400, detail=GAME_UNKNOWN)
        game_id = game["id"]
    if await game_usage.chosen_is_archived(db, game_id, current):
        raise HTTPException(status_code=422, detail=game_usage.ARCHIVED_DETAIL)
    return game_id


async def _staffel_without_this_game(db, game_id: str | None, registrations: list[dict]) -> dict | None:
    """Die erste laufende Staffel, zu der das Spiel nicht passt. Hat sie ein Spiel, muss das Co-Team zum selben Hauptspiel
    gehören; leeren geht dann nicht - zugeteilt wurde es für dieses Spiel."""
    from services.discord_roles import load_games, top_game

    _games, parents = await load_games(db)
    for registration in registrations:
        wanted = registration.get("tournament_game_id")
        if wanted and (not game_id or top_game(game_id, parents) != top_game(wanted, parents)):
            return registration
    return None


async def _squad_role_holder(db, team_id: str, user_id: str) -> dict | None:
    """Ein Co-Team dieses Teams, in dem die Person Captain oder Vertreter ist."""
    return await db.team_squads.find_one(
        {"team_id": team_id, "$or": [{"captain_id": user_id}, {"vice_captain_id": user_id}]},
        {"_id": 0, "id": 1, "name": 1},
    )


@router.get("")
async def list_teams(q: str | None = None, limit: int = 100, offset: int = 0, paged: bool = False):
    db = get_db()
    query = {}
    if q:
        pattern = safe_regex(q)
        query["$or"] = [
            {"name": {"$regex": pattern, "$options": "i"}},
            {"tag": {"$regex": pattern, "$options": "i"}},
        ]
    query["is_public"] = {"$ne": False}
    fetch_limit = max(100, min(max(int(limit or 100), 1) + max(int(offset or 0), 0) + 40, 500))
    teams = await db.teams.find(query, {"_id": 0}).sort("created_at", -1).to_list(fetch_limit)
    summaries = [_team_summary(team) for team in teams]
    return _page_items(summaries, limit, offset, paged)


@router.get("/my")
async def my_teams(me: dict = Depends(get_current_user)):
    db = get_db()
    teams = await db.teams.find({"member_ids": me["id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
    for team in teams:
        await _hydrate_team(team)
        team["my_role"] = "leader" if team.get("leader_id") == me["id"] else (
            "co_leader" if me["id"] in team.get("co_leader_ids", []) else "member"
        )
        team.update(_viewer_rights(team, me))
        # Wie GET /teams/{id}: der Code gehört zur Teamleitung (#2126).
        if not _can_manage(team, me):
            team.pop("join_code", None)
    return teams


@router.get("/invites/my")
async def my_team_invites(me: dict = Depends(get_current_user)):
    db = get_db()
    invites = await db.team_invites.find(
        {"user_id": me["id"], "status": "pending"},
        {"_id": 0},
    ).sort("created_at", -1).to_list(100)
    return [await _hydrate_invite(invite) for invite in invites]


@router.get("/{team_id}")
async def get_team(team_id: str, user: dict | None = Depends(get_optional_user)):
    db = get_db()
    team = await db.teams.find_one({"id": team_id}, {"_id": 0})
    if not team:
        # Aufgelöst (#2128, TM8): alte Turniere verlinken das Team noch - die Seite sagt dann, was los ist.
        from services.team_history import team_by_id
        gone = await team_by_id(db, team_id)
        if gone and gone.get("is_public") is not False:
            raise HTTPException(status_code=404, detail=f"{gone.get('name') or 'Dieses Team'} wurde aufgelöst.")
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    if team.get("is_public") is False and not (_is_member(team, user) or _is_staff(user)):
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    await _hydrate_team(team)
    out = _team_response(team, user)
    # Auszeichnungen (#230): Team-Banner und -Trophäen; Außenstehende sehen nur öffentliche Turniere.
    from services.awards import awards_for_team
    insider = bool(user and (_is_member(team, user) or _can_manage(team, user) or _is_staff(user)))
    out["awards"] = await awards_for_team(db, team_id, public_only=not insider)
    out["featured_award"] = next((award for award in out["awards"] if award["id"] == team.get("featured_award_id")), None)
    return out


@router.post("/{team_id}/awards/{award_id}/feature")
async def feature_team_award(team_id: str, award_id: str, me: dict = Depends(get_current_user)):
    """Eine Auszeichnung des Teams als Teambanner zeigen - Teamleitung und Co-Leitung."""
    db = get_db()
    team = await db.teams.find_one({"id": team_id}, {"_id": 0})
    if not team:
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    if not _can_manage(team, me):
        _refuse(me, "Nur die Teamleitung wählt das Teambanner.")
    from services.awards import feature_award_for_team
    chosen = await feature_award_for_team(db, team_id, award_id)
    if not chosen:
        raise HTTPException(status_code=404, detail="Auszeichnung nicht gefunden.")
    return {"ok": True, "featured_award": chosen}


@router.delete("/{team_id}/awards/feature")
async def unfeature_team_award(team_id: str, me: dict = Depends(get_current_user)):
    db = get_db()
    team = await db.teams.find_one({"id": team_id}, {"_id": 0})
    if not team:
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    if not _can_manage(team, me):
        _refuse(me, "Nur die Teamleitung wählt das Teambanner.")
    from services.awards import feature_award_for_team
    await feature_award_for_team(db, team_id, None)
    return {"ok": True, "featured_award": None}


@router.get("/{team_id}/chat")
async def list_team_chat(team_id: str, me: dict = Depends(get_current_user)):
    db = get_db()
    team = await db.teams.find_one({"id": team_id}, {"_id": 0})
    if not team:
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    if not _chat_allowed(team, me):
        raise HTTPException(status_code=403, detail="Team-Chat ist nur für Teammitglieder sichtbar")
    messages = await db.team_chat_messages.find(
        {"team_id": team_id, "deleted_at": {"$exists": False}},
        {"_id": 0},
    ).sort("created_at", -1).to_list(150)
    messages.reverse()
    messages = [word_filter.public_moderation(m) for m in messages if word_filter.visible_to(m, me["id"])]
    return await _enrich_team_chat(messages)


@router.post("/{team_id}/chat")
async def post_team_chat(team_id: str, body: TeamChatCreate, me: dict = Depends(get_current_user)):
    db = get_db()
    await moderation_standing.require_chat_allowed(db, me)
    team = await db.teams.find_one({"id": team_id}, {"_id": 0})
    if not team:
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    if not _chat_allowed(team, me):
        raise HTTPException(status_code=403, detail="Team-Chat ist nur für Teammitglieder sichtbar")
    text = body.message.strip()
    if not text and not body.attachment_ids and not body.sticker_id:
        raise HTTPException(status_code=400, detail="Nachricht darf nicht leer sein")
    now = now_utc().isoformat()
    message_id = new_id()
    from services.stickers import sticker_for_message
    sticker = await sticker_for_message(db, body.sticker_id, text, body.attachment_ids, me["id"])
    attachments = await claim_attachments(db, me["id"], body.attachment_ids, {
        "type": "team", "team_id": team_id, "message_id": message_id,
    })
    message = {
        "id": message_id,
        "team_id": team_id,
        "user_id": me["id"],
        "message": text,
        "attachments": attachments,
        "sticker": sticker,
        "created_at": now,
        "updated_at": now,
    }
    verdict = await word_filter.screen_message(db, message, kind="team", context={"team_id": team_id, "member_ids": [*(team.get("member_ids") or []), me["id"]]})
    await db.team_chat_messages.insert_one(message)
    if verdict != "hold":
        try:
            from services import xp
            await xp.grant(me["id"], "team_chat", message["id"])
        except Exception as exc:  # noqa: BLE001 - XP hält keine Nachricht auf
            logger.warning("[xp] team_chat für Nachricht %s nicht gutgeschrieben type=%s", message["id"], type(exc).__name__)
    from services.change_events import publish_user_change
    if verdict == "hold":
        await publish_user_change([me["id"]], "teams")
        message.pop("_id", None)
        return (await _enrich_team_chat([word_filter.public_moderation(message)]))[0]
    # Team chat is not a public resource; only members (and the sender) are told.
    await publish_user_change([*(team.get("member_ids") or []), me["id"]], "teams")
    mentioned_user_ids = await _notify_team_mentions(db, team, me, message)
    await _notify_team_chat_message(db, team, me, message, mentioned_user_ids)
    try:
        # Über die Warteschlange (#2338): eine Auswertung je Person und Takt, nicht eine volle je Nachricht.
        from services.achievement_queue import request_chat_evaluation
        await request_chat_evaluation(me["id"])
    except Exception:
        logger.warning("[achievements] Teamchat-Nachricht in %s nicht vorgemerkt", log_safe(team_id), exc_info=True)
    message.pop("_id", None)
    enriched = await _enrich_team_chat([word_filter.public_moderation(message)])
    return enriched[0]


@router.get("/{team_id}/invite-candidates")
async def invite_candidates(team_id: str, q: str | None = None, me: dict = Depends(get_current_user)):
    db = get_db()
    team = await db.teams.find_one({"id": team_id}, {"_id": 0})
    if not team:
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    if not _can_manage(team, me):
        _refuse(me, "Keine Berechtigung")
    query = {
        "is_active": True,
        "is_banned": {"$ne": True},
        "id": {"$nin": team.get("member_ids") or []},
    }
    if q:
        pattern = safe_regex(q)
        query["$or"] = [
            {"username": {"$regex": pattern, "$options": "i"}},
            {"display_name": {"$regex": pattern, "$options": "i"}},
        ]
    users = await db.users.find(
        query,
        {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1},
    ).sort("display_name", 1).to_list(25)
    pending = await db.team_invites.find(
        {"team_id": team_id, "status": "pending", "user_id": {"$in": [u["id"] for u in users]}},
        {"_id": 0, "user_id": 1},
    ).to_list(100)
    pending_ids = {row["user_id"] for row in pending}
    for user in users:
        user["has_pending_invite"] = user["id"] in pending_ids
    return users


@router.get("/{team_id}/mention-candidates")
async def mention_candidates(team_id: str, q: str | None = None, me: dict = Depends(get_current_user)):
    db = get_db()
    team = await db.teams.find_one({"id": team_id}, {"_id": 0})
    if not team:
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    if not _chat_allowed(team, me):
        raise HTTPException(status_code=403, detail="Team-Chat ist nur für Teammitglieder sichtbar")
    query = {
        "id": {"$in": team.get("member_ids") or []},
        "is_active": True,
        "is_banned": {"$ne": True},
    }
    if q:
        pattern = safe_regex(q, 40)
        query["$or"] = [
            {"username": {"$regex": pattern, "$options": "i"}},
            {"display_name": {"$regex": pattern, "$options": "i"}},
        ]
    users = await db.users.find(
        query,
        {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1},
    ).sort("display_name", 1).to_list(12)
    return users


@router.post("/{team_id}/invites")
async def invite_team_member(team_id: str, body: TeamInviteCreate, me: dict = Depends(get_current_user)):
    db = get_db()
    team = await db.teams.find_one({"id": team_id}, {"_id": 0})
    if not team:
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    if not _can_manage(team, me):
        _refuse(me, "Keine Berechtigung")
    if body.user_id in (team.get("member_ids") or []):
        raise HTTPException(status_code=409, detail="Nutzer ist bereits im Team")
    user = await db.users.find_one(
        {"id": body.user_id, "is_active": True, "is_banned": {"$ne": True}},
        {"_id": 0, "id": 1, "username": 1, "display_name": 1},
    )
    if not user:
        raise HTTPException(status_code=404, detail="Nutzer nicht gefunden")
    existing = await db.team_invites.find_one(
        {"team_id": team_id, "user_id": body.user_id, "status": "pending"},
        {"_id": 0},
    )
    if existing:
        return await _hydrate_invite(existing)
    now = now_utc().isoformat()
    invite = {
        "id": new_id(),
        "team_id": team_id,
        "user_id": body.user_id,
        "invited_by": me["id"],
        "status": "pending",
        "created_at": now,
        "updated_at": now,
    }
    await db.team_invites.insert_one(invite)
    await create_user_notification(
        body.user_id,
        title=f"Team-Einladung: {team.get('name')}",
        body=f"{_user_label(me)} hat dich in das Team [{team.get('tag')}] eingeladen.",
        url="/profile?tab=teams",
        kind="team_invite",
        meta={"invite_id": invite["id"], "team_id": team_id},
    )
    invite.pop("_id", None)
    return await _hydrate_invite(invite)


@router.post("/invites/{invite_id}/accept")
async def accept_team_invite(invite_id: str, me: dict = Depends(get_current_user)):
    db = get_db()
    invite = await db.team_invites.find_one({"id": invite_id, "user_id": me["id"], "status": "pending"}, {"_id": 0})
    if not invite:
        raise HTTPException(status_code=404, detail="Einladung nicht gefunden")
    team = await db.teams.find_one({"id": invite["team_id"]}, {"_id": 0})
    if not team:
        await db.team_invites.update_one({"id": invite_id}, {"$set": {"status": "cancelled", "updated_at": now_utc().isoformat()}})
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    # In einem Zug (#2113): Zieht die Leitung im selben Moment zurück, gewinnt genau eine Seite - niemand landet im Team,
    # dessen Einladung gerade zurückgezogen wurde.
    claimed = await db.team_invites.update_one(
        {"id": invite_id, "status": "pending"},
        {"$set": {"status": "accepted", "acted_at": now_utc().isoformat(), "updated_at": now_utc().isoformat()}},
    )
    if not getattr(claimed, "modified_count", 0):
        raise HTTPException(status_code=404, detail="Einladung nicht gefunden")
    if me["id"] not in (team.get("member_ids") or []):
        await _add_team_member(db, team["id"], me["id"])
        await _team_audit(db, "team.join", team["id"], me["id"], {"via": "invite"})
    await db.notifications.update_many(
        {"user_id": me["id"], "meta.invite_id": invite_id},
        {"$set": {"read": True}},
    )
    notify_ids = list({invite.get("invited_by"), team.get("leader_id")} - {None, me["id"]})
    for uid in notify_ids:
        await create_user_notification(
            uid,
            title=f"{_user_label(me)} ist [{team.get('tag')}] beigetreten",
            body=f"Die Team-Einladung für {team.get('name')} wurde angenommen.",
            url=f"/teams/{team['id']}",
            kind="team_invite_accepted",
            meta={"invite_id": invite_id, "team_id": team["id"]},
        )
    return {"ok": True}


@router.post("/invites/{invite_id}/decline")
async def decline_team_invite(invite_id: str, me: dict = Depends(get_current_user)):
    db = get_db()
    invite = await db.team_invites.find_one({"id": invite_id, "user_id": me["id"], "status": "pending"}, {"_id": 0})
    if not invite:
        raise HTTPException(status_code=404, detail="Einladung nicht gefunden")
    claimed = await db.team_invites.update_one(
        {"id": invite_id, "status": "pending"},
        {"$set": {"status": "declined", "acted_at": now_utc().isoformat(), "updated_at": now_utc().isoformat()}},
    )
    if not getattr(claimed, "modified_count", 0):
        raise HTTPException(status_code=404, detail="Einladung nicht gefunden")
    await db.notifications.update_many(
        {"user_id": me["id"], "meta.invite_id": invite_id},
        {"$set": {"read": True}},
    )
    # Abgelehnt (#2113, L-A1): wer eingeladen hat und die Teamleitung erfahren es - wie bei der Annahme.
    team = await db.teams.find_one({"id": invite.get("team_id")}, {"_id": 0, "id": 1, "name": 1, "tag": 1, "leader_id": 1})
    for uid in sorted({invite.get("invited_by"), (team or {}).get("leader_id")} - {None, me["id"]}) if team else []:
        await create_user_notification(
            uid,
            title=f"Einladung abgelehnt: [{team.get('tag')}]",
            body=f"{_user_label(me)} hat die Einladung in {team.get('name')} abgelehnt.",
            url=f"/teams/{team['id']}",
            kind="team_invite_declined",
            meta={"invite_id": invite_id, "team_id": team["id"]},
        )
    return {"ok": True}


@router.get("/{team_id}/invites")
async def list_team_invites(team_id: str, me: dict = Depends(get_current_user)):
    """Offene Einladungen des Teams (#2113, L-A1) - für Leitung und Co-Leitung, damit sie sie sehen und zurückziehen."""
    db = get_db()
    team = await db.teams.find_one({"id": team_id}, {"_id": 0})
    if not team:
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    if not _can_manage(team, me):
        _refuse(me, "Offene Einladungen sieht nur die Teamleitung.")
    invites = await db.team_invites.find(
        {"team_id": team_id, "status": "pending"}, {"_id": 0},
    ).sort("created_at", -1).to_list(100)
    people = {row["id"]: row for row in await db.users.find(
        {"id": {"$in": list({i.get("user_id") for i in invites} | {i.get("invited_by") for i in invites})}},
        {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1},
    ).to_list(200)}
    return [{
        "id": invite["id"],
        "team_id": team_id,
        "status": invite.get("status"),
        "created_at": invite.get("created_at"),
        "user": _public_user(people.get(invite.get("user_id"))),
        "inviter": _public_user(people.get(invite.get("invited_by"))),
    } for invite in invites]


@router.delete("/{team_id}/invites/{invite_id}")
async def withdraw_team_invite(team_id: str, invite_id: str, me: dict = Depends(get_current_user)):
    """Einladung zurückziehen (#2113, L-A1): Leitung und Co-Leitung. Die Einladung verschwindet aus der Glocke der
    eingeladenen Person; eine schon beantwortete bleibt, wie sie ist."""
    db = get_db()
    team = await db.teams.find_one({"id": team_id}, {"_id": 0})
    if not team:
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    if not _can_manage(team, me):
        _refuse(me, "Einladungen zieht nur die Teamleitung zurück.")
    now = now_utc().isoformat()
    result = await db.team_invites.update_one(
        {"id": invite_id, "team_id": team_id, "status": "pending"},
        {"$set": {"status": "withdrawn", "acted_at": now, "withdrawn_by": me["id"], "updated_at": now}},
    )
    if not getattr(result, "modified_count", 0):
        raise HTTPException(status_code=404, detail="Diese Einladung ist nicht mehr offen.")
    invite = await db.team_invites.find_one({"id": invite_id}, {"_id": 0, "user_id": 1})
    await db.notifications.delete_many({"user_id": (invite or {}).get("user_id"), "kind": "team_invite",
                                        "meta.invite_id": invite_id})
    from services.change_events import publish_user_change
    await publish_user_change([(invite or {}).get("user_id")], "teams")
    return {"ok": True}


@router.post("")
async def create_team(body: TeamCreate, me: dict = Depends(get_current_user)):
    db = get_db()
    if await db.teams.find_one({"tag": body.tag}):
        raise HTTPException(status_code=409, detail=TAG_TAKEN)
    team_id = new_id()
    await word_filter.screen_field(db, f"{body.name} {body.tag}", kind="team_name", user_id=me["id"], ref_id=team_id)
    created_at = now_utc().isoformat()
    doc = {
        "id": team_id,
        "name": body.name,
        "tag": body.tag,
        "description": body.description,
        "logo_url": body.logo_url,
        "banner_url": body.banner_url,
        "discord_link": body.discord_link,
        "social_links": {},
        "leader_id": me["id"],
        "co_leader_ids": [],
        "member_ids": [me["id"]],
        "join_code": new_join_code(),
        "is_public": True,
        # Seit wann die Teamleitung führt (#2338, Kapitän) - die Übergabe setzt es neu.
        "leader_since": created_at,
        "created_at": created_at,
        "updated_at": created_at,
    }
    await db.teams.insert_one(doc)
    await db.team_members.update_one(
        {"team_id": team_id, "user_id": me["id"]},
        {"$set": {
            "team_id": team_id,
            "user_id": me["id"],
            "role": "leader",
            "joined_at": now_utc().isoformat(),
        }},
        upsert=True,
    )
    doc.pop("_id", None)
    try:
        from badges import on_team_created
        await on_team_created(me["id"], team_id)
    except Exception:
        logger.warning("[achievements] Neues Team %s nicht ausgewertet", log_safe(team_id), exc_info=True)
    return doc


def _team_label(value: str, current: str | None, what: str, low: int, high: int) -> str:
    """Name oder Kürzel beim Ändern (#2128, TM11): neue Werte in den Grenzen; ein älterer, unveränderter Wert bleibt gültig."""
    text = str(value or "").strip()
    if text == (current or "").strip():
        return current or text
    if not low <= len(text) <= high:
        raise HTTPException(status_code=400, detail=f"{what} braucht {low} bis {high} Zeichen.")
    return text


@router.put("/{team_id}")
@router.patch("/{team_id}")
async def update_team(team_id: str, body: TeamUpdate, me: dict = Depends(get_current_user)):
    db = get_db()
    team = await db.teams.find_one({"id": team_id})
    if not team:
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    if not _can_edit_team(team, me):
        _refuse_edit(team, me, "Keine Berechtigung")
    nullable_fields = {"description", "logo_url", "banner_url", "discord_link", "social_links"}
    raw = body.model_dump(exclude_unset=True)
    updates = {k: v for k, v in raw.items() if v is not None or k in nullable_fields}
    # Das Banner bleibt bei der Rolle (#2202): Die Freigabe darf es nicht ändern, eine ältere Maske schickt es unverändert mit.
    if "banner_url" in updates and (updates["banner_url"] or None) != (team.get("banner_url") or None) and not _can_manage(team, me):
        _refuse(me, "Das Banner ändern Teamleitung, Co-Leitung und die Rolle Turnierleitung.")
    if "name" in updates:
        updates["name"] = _team_label(updates["name"], team.get("name"), "Der Name", TEAM_NAME_MIN_LENGTH, TEAM_NAME_MAX_LENGTH)
    if "tag" in updates:
        updates["tag"] = _team_label(updates["tag"], team.get("tag"), "Das Kürzel", TEAM_TAG_MIN_LENGTH, TEAM_TAG_MAX_LENGTH)
        if updates["tag"] != team.get("tag") and await db.teams.find_one({"tag": updates["tag"]}):
            raise HTTPException(status_code=409, detail=TAG_TAKEN)
    visibility_changes = "is_public" in updates and updates["is_public"] != team.get("is_public", True)
    if visibility_changes and not (_is_team_leader(team, me["id"]) or _team_admin(me, TEAM_OWNER_ADMIN_ROLES)):
        _refuse(me, "Ob das Team öffentlich oder privat ist, entscheidet die Teamleitung.", TEAM_OWNER_ADMIN_ROLES)
    if updates.get("name") or updates.get("tag"):
        await word_filter.screen_field(db, f"{updates.get('name') or ''} {updates.get('tag') or ''}", kind="team_name", user_id=me["id"], ref_id=team_id)
    updates["updated_at"] = now_utc().isoformat()
    await db.teams.update_one({"id": team_id}, {"$set": updates})
    if visibility_changes:
        await _team_audit(db, "team.visibility", team_id, me["id"], {"is_public": updates["is_public"]})
    team = await db.teams.find_one({"id": team_id}, {"_id": 0})
    await _queue_team_leads(team, "team_update")
    if not _can_manage(team, me):
        team.pop("join_code", None)
    return team


async def _queue_team_leads(team: dict | None, reason: str, user_ids=None) -> None:
    """Teamauftritt und Kapitän (#2338): gleich beim Speichern bzw. bei einer Rollenänderung auswerten - für die
    Teamleitung und die Co-Leitung (oder die genannten Personen)."""
    if not team:
        return
    wanted = list(user_ids) if user_ids is not None else [team.get("leader_id"), *(team.get("co_leader_ids") or [])]
    try:
        from services.achievement_queue import request_evaluation
        await request_evaluation([user_id for user_id in wanted if user_id], reason, sources={"team"})
    except Exception:  # noqa: BLE001 - das Speichern des Teams ist schon geschehen
        logger.warning("[achievements] Team %s nicht vorgemerkt", log_safe(team.get("id")), exc_info=True)


@router.post("/{team_id}/join")
async def join_team(team_id: str, body: dict, me: dict = Depends(get_current_user)):
    db = get_db()
    team = await db.teams.find_one({"id": team_id})
    if not team:
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    if not team.get("join_code") or body.get("join_code") != team["join_code"]:
        raise HTTPException(status_code=403, detail="Dieser Beitrittscode stimmt nicht.")
    if me["id"] in team.get("member_ids", []):
        return {"ok": True, "already_member": True}
    await _add_team_member(db, team_id, me["id"])
    await _team_audit(db, "team.join", team_id, me["id"], {"via": "join_code"})
    if team.get("leader_id") and team.get("leader_id") != me["id"]:
        await _tell(
            team["leader_id"],
            title=f"{_user_label(me)} ist [{team.get('tag')}] beigetreten",
            body=f"Mit dem Beitrittscode von {team.get('name')}.",
            url=f"/teams/{team_id}",
            kind="team_invite_accepted",
            meta={"team_id": team_id, "via": "join_code"},
        )
    from services.change_events import publish_user_change
    await publish_user_change([*(team.get("member_ids") or []), me["id"]], "teams")
    return {"ok": True}


@router.post("/{team_id}/leave")
async def leave_team(team_id: str, me: dict = Depends(get_current_user)):
    db = get_db()
    team = await db.teams.find_one({"id": team_id})
    if not team:
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    if team["leader_id"] == me["id"]:
        # Geführt statt Sackgasse (#2113, L-C6): der Weg steht in der Meldung - auch für die App.
        raise HTTPException(status_code=400, detail=LEADER_CANNOT_LEAVE)
    held = await _squad_role_holder(db, team_id, me["id"])
    if held:
        raise HTTPException(status_code=409, detail=f"Du bist Captain oder Vertreter im Co-Team {held.get('name') or ''} – "
                                                    f"bitte erst die Rolle abgeben, dann das Team verlassen. {RESIGN_ON_WEBSITE}")
    await db.teams.update_one({"id": team_id}, {"$pull": {"member_ids": me["id"], "co_leader_ids": me["id"]}})
    await db.team_members.delete_one({"team_id": team_id, "user_id": me["id"]})
    await _leave_squads(db, team_id, me["id"])
    await _team_audit(db, "team.leave", team_id, me["id"], {})
    await _tell(
        team.get("leader_id"),
        title=f"{_user_label(me)} hat [{team.get('tag')}] verlassen",
        body=f"{_user_label(me)} ist nicht mehr in {team.get('name')}.",
        url=f"/teams/{team_id}",
        kind="team_member_left",
        meta={"team_id": team_id, "user_id": me["id"]},
    )
    from services.change_events import publish_user_change
    await publish_user_change([*(team.get("member_ids") or []), me["id"]], "teams")
    return {"ok": True}


async def _leave_squads(db, team_id: str, user_id: str, actor_id: str | None = None) -> None:
    """Wer das Team verlässt, verlässt auch jeden Kader seiner Co-Teams (#1649) - sonst bliebe er Liga-Spieler. Reicht ein
    Kader danach nicht mehr für seine Staffel, erfahren es Verantwortliche und Turnierleitung (#2202). In einer Staffel steht es
    im Protokoll (#2204)."""
    from services import squad_shortage

    before = await db.team_squads.find({"team_id": team_id, "member_ids": user_id}, {"_id": 0, "id": 1, "member_ids": 1}).to_list(200)
    await db.team_squads.update_many({"team_id": team_id, "member_ids": user_id},
                                     {"$pull": {"member_ids": user_id}, "$set": {"updated_at": now_utc().isoformat()}})
    for squad in before:
        if await _squad_staffeln(db, squad["id"]):
            await _audit_squad_roster(db, team_id, actor_id or user_id, squad["id"], [], [user_id])
    await squad_shortage.warn_after_departure(db, before)


async def _audit_squad_roster(db, team_id: str, actor_id: str | None, squad_id: str, added: list[str], removed: list[str]) -> None:
    """Kaderänderung eines Co-Teams in einer nicht beendeten Staffel (#2204): wer rein, wer raus - für die Leitung nachvollziehbar."""
    await _team_audit(db, "league.squad.roster", team_id, actor_id, {"squad_id": squad_id, "added": sorted(added), "removed": sorted(removed)})


async def _tell_squad_edited(db, team: dict, before: dict, after: dict, me: dict, *, fields: list[str]) -> None:
    """Griff von außen in ein Co-Team einer Staffel (#2204): Leitung und Co-Leitung des Hauptteams erfahren wer, was, wann. Der Kader
    ist schon gespeichert - eine klemmende Nachricht hält das nicht auf."""
    from services.league_mail import send_league_mail
    from services.matchday_schedule import LOCAL_TZ

    added = [uid for uid in after.get("member_ids") or [] if uid not in (before.get("member_ids") or [])]
    removed = [uid for uid in before.get("member_ids") or [] if uid not in (after.get("member_ids") or [])]
    role_ids = [after.get(field) for field in SQUAD_ROLE_FIELDS if after.get(field) != before.get(field) and after.get(field)]
    people = {row["id"]: row for row in await db.users.find(
        {"id": {"$in": sorted({*added, *removed, *role_ids})}}, {"_id": 0, "id": 1, "username": 1, "display_name": 1, "is_deleted": 1}).to_list(100)}

    def names(ids) -> str:
        return ", ".join(_user_label(people.get(uid)) for uid in ids)

    parts = []
    if added:
        parts.append(f"neu im Kader: {names(added)}")
    if removed:
        parts.append(f"nicht mehr im Kader: {names(removed)}")
    for field in SQUAD_ROLE_FIELDS:
        if after.get(field) != before.get(field):
            parts.append(f"{SQUAD_ROLE_LABELS[field]}: {names([after[field]]) if after.get(field) else 'nicht mehr vergeben'}")
    if not parts:
        parts.append("Angaben geändert (" + ", ".join(sorted(fields)) + ")")
    moment = now_utc()
    when = moment.astimezone(LOCAL_TZ).strftime("%d.%m.%Y, %H:%M")
    name = after.get("name") or before.get("name") or "Co-Team"
    for user_id in sorted({team.get("leader_id"), *(team.get("co_leader_ids") or [])} - {me["id"], None}):
        try:
            await create_user_notification(
                user_id,
                title=f"Liga-Leitung hat den Kader geändert: {name}",
                body=f"{_user_label(me)} hat am {when} im Co-Team {name} geändert: {'; '.join(parts)}.",
                url=f"/teams/{team['id']}",
                kind="team_role_changed",
                meta={"team_id": team["id"], "squad_id": before.get("id"), "reason": "league_squad_edit",
                      "dedupe_key": f"league-squad-edit:{before.get('id')}:{moment.isoformat()}:{user_id}"},
            )
            await send_league_mail(db, user_id, f"Liga-Leitung hat den Kader geändert: {name}",
                                   f"{_user_label(me)} hat am {when} im Co-Team {name} geändert: {'; '.join(parts)}.",
                                   f"/teams/{team['id']}", f"league-squad-edit:{before.get('id')}:{moment.isoformat()}:{user_id}:mail")
        except Exception:  # noqa: BLE001 - siehe oben
            logger.warning("[teams] Nachricht zum Kader an %s nicht verschickt", log_safe(user_id), exc_info=True)


def _is_team_leader(team: dict, user_id: str) -> bool:
    return team.get("leader_id") == user_id


def _can_manage_team(team: dict, user: dict) -> bool:
    return (
        _is_team_leader(team, user["id"])
        or user["id"] in (team.get("co_leader_ids") or [])
        or _team_admin(user, TEAM_OWNER_ADMIN_ROLES)
    )


@router.delete("/{team_id}/members/{user_id}")
async def kick_member(team_id: str, user_id: str, me: dict = Depends(get_current_user)):
    """Teamleitung, Co-Leitung und Admin nehmen ein Mitglied aus dem Team; die Teamleitung selbst bleibt."""
    db = get_db()
    team = await db.teams.find_one({"id": team_id})
    if not team:
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    if not _can_manage_team(team, me):
        _refuse(me, "Mitglieder entfernen nur Teamleitung und Co-Leitung.", TEAM_OWNER_ADMIN_ROLES)
    if team.get("leader_id") == user_id:
        raise HTTPException(status_code=400, detail="Die Teamleitung lässt sich nicht entfernen – bitte zuerst die Leitung übergeben.")
    if user_id == me["id"]:
        raise HTTPException(status_code=400, detail="Dich selbst nimmst du mit „Team verlassen“ aus dem Team.")
    if user_id not in (team.get("member_ids") or []):
        raise HTTPException(status_code=404, detail="Diese Person ist nicht im Team.")
    held = await _squad_role_holder(db, team_id, user_id)
    if held:
        raise HTTPException(status_code=409, detail=f"Diese Person ist Captain oder Vertreter im Co-Team "
                                                    f"{held.get('name') or ''} – bitte erst die Rolle neu vergeben. "
                                                    f"{ROLES_ON_WEBSITE}")
    await db.teams.update_one(
        {"id": team_id},
        {"$pull": {"member_ids": user_id, "co_leader_ids": user_id}, "$set": {"updated_at": now_utc().isoformat()}},
    )
    await db.team_members.delete_many({"team_id": team_id, "user_id": user_id})
    await _leave_squads(db, team_id, user_id, me["id"])
    await _team_audit(db, "team.kick", team_id, me["id"], {"kicked_user_id": user_id})
    await _tell(
        user_id,
        title=f"Du bist nicht mehr in [{team.get('tag')}]",
        body=f"{_user_label(me)} hat dich aus {team.get('name')} entfernt.",
        url="/teams",
        kind="team_member_removed",
        meta={"team_id": team_id},
    )
    from services.change_events import publish_user_change
    await publish_user_change(list(team.get("member_ids") or []), "teams")
    return {"ok": True}


@router.post("/{team_id}/members/{user_id}/role")
async def set_member_role(team_id: str, user_id: str, body: dict, me: dict = Depends(get_current_user)):
    """Rolle setzen: ``member`` oder ``co_leader`` - nur Teamleitung und Admin."""
    role = (body.get("role") or "").strip().lower()
    if role not in ("member", "co_leader"):
        raise HTTPException(status_code=400, detail="Diese Rolle gibt es nicht – möglich sind Mitglied und Co-Leitung.")
    db = get_db()
    team = await db.teams.find_one({"id": team_id})
    if not team:
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    if not (_is_team_leader(team, me["id"]) or _team_admin(me, TEAM_OWNER_ADMIN_ROLES)):
        _refuse(me, "Rollen ändert nur die Teamleitung.", TEAM_OWNER_ADMIN_ROLES)
    if user_id not in (team.get("member_ids") or []):
        raise HTTPException(status_code=404, detail="Diese Person ist nicht im Team.")
    if team.get("leader_id") == user_id:
        raise HTTPException(status_code=400, detail="Die Teamleitung behält ihre Rolle – übergib dafür die Leitung.")
    if role == "co_leader":
        await db.teams.update_one(
            {"id": team_id}, {"$addToSet": {"co_leader_ids": user_id}, "$set": {"updated_at": now_utc().isoformat()}},
        )
    else:
        await db.teams.update_one(
            {"id": team_id}, {"$pull": {"co_leader_ids": user_id}, "$set": {"updated_at": now_utc().isoformat()}},
        )
    await db.team_members.update_one(
        {"team_id": team_id, "user_id": user_id},
        {"$set": {"role": role, "updated_at": now_utc().isoformat()}},
        upsert=True,
    )
    await create_user_notification(
        user_id,
        title=f"Teamrolle aktualisiert: [{team.get('tag')}]",
        body=f"Deine Rolle in {team.get('name')} ist jetzt {('Co-Leitung' if role == 'co_leader' else 'Mitglied')}.",
        url=f"/teams/{team_id}",
        kind="team_role_changed",
        meta={"team_id": team_id, "role": role},
    )
    await db.audit_logs.insert_one({
        "id": new_id(), "action": "team.role_change", "target_id": team_id,
        "actor_id": me["id"], "data": {"user_id": user_id, "role": role},
        "created_at": now_utc().isoformat(),
    })
    if role == "co_leader":
        # Teamauftritt zählt auch für die Co-Leitung (#2338).
        await _queue_team_leads(team, "team_role", [user_id])
    return {"ok": True, "role": role}


@router.post("/{team_id}/transfer-leader")
async def transfer_leader(team_id: str, body: dict, me: dict = Depends(get_current_user)):
    """Die Teamleitung übergeben; die bisherige wird Co-Leitung."""
    new_leader_id = body.get("new_leader_id") or body.get("user_id")
    if not new_leader_id:
        raise HTTPException(status_code=400, detail="Bitte wähle, wer die Teamleitung übernimmt.")
    db = get_db()
    team = await db.teams.find_one({"id": team_id})
    if not team:
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    if not (_is_team_leader(team, me["id"]) or _team_admin(me, TEAM_OWNER_ADMIN_ROLES)):
        _refuse(me, "Die Leitung übergibt nur die Teamleitung.", TEAM_OWNER_ADMIN_ROLES)
    if new_leader_id not in (team.get("member_ids") or []):
        raise HTTPException(status_code=404, detail="Diese Person ist nicht im Team.")
    if new_leader_id == team.get("leader_id"):
        raise HTTPException(status_code=400, detail="Diese Person hat die Teamleitung schon.")
    # Sonst ließe sich die Leitung auf ein gelöschtes Konto schieben - und das Team stünde ohne Teamleitung da (#2113).
    if _account_gone(await db.users.find_one({"id": new_leader_id}, {"_id": 0, "id": 1, "is_active": 1, "anonymized_at": 1})):
        raise HTTPException(status_code=400, detail="Dieses Konto ist gelöscht oder abgeschaltet – bitte ein aktives Mitglied wählen.")
    old_leader = team.get("leader_id")
    handed_over = now_utc().isoformat()
    await db.teams.update_one({"id": team_id}, {
        # Kapitän zählt ab der Übernahme (#2338).
        "$set": {"leader_id": new_leader_id, "leader_since": handed_over, "updated_at": handed_over},
        # Die neue Teamleitung ist nicht zugleich Co-Leitung; die bisherige wird es.
        "$pull": {"co_leader_ids": new_leader_id},
    })
    # Ein gelöschtes Konto rückt nicht in die Co-Leitung (Admin übergibt ein verwaistes Team, #2128 TM6).
    if old_leader and not _account_gone(await db.users.find_one({"id": old_leader}, {"_id": 0, "id": 1, "is_active": 1, "anonymized_at": 1})):
        await db.teams.update_one({"id": team_id}, {"$addToSet": {"co_leader_ids": old_leader}})
        await db.team_members.update_one(
            {"team_id": team_id, "user_id": old_leader},
            {"$set": {"role": "co_leader", "updated_at": now_utc().isoformat()}},
            upsert=True,
        )
    await db.team_members.update_one(
        {"team_id": team_id, "user_id": new_leader_id},
        {"$set": {"role": "leader", "updated_at": now_utc().isoformat()}},
        upsert=True,
    )
    await create_user_notification(
        new_leader_id,
        title=f"Du hast jetzt die Teamleitung: [{team.get('tag')}]",
        body=f"Die Leitung von {team.get('name')} wurde an dich übertragen.",
        url=f"/teams/{team_id}",
        kind="team_leader_transferred",
        meta={"team_id": team_id, "old_leader": old_leader},
    )
    await db.audit_logs.insert_one({
        "id": new_id(), "action": "team.transfer_leader", "target_id": team_id,
        "actor_id": me["id"], "data": {"old_leader": old_leader, "new_leader": new_leader_id},
        "created_at": now_utc().isoformat(),
    })
    fresh = await db.teams.find_one({"id": team_id}, {"_id": 0})
    await _queue_team_leads(fresh, "team_transfer", [new_leader_id, old_leader])
    return fresh


@router.delete("/{team_id}")
async def delete_team(team_id: str, confirm: str | None = None, me: dict = Depends(get_current_user)):
    db = get_db()
    team = await db.teams.find_one({"id": team_id}, {"_id": 0})
    if not team:
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    if team["leader_id"] != me["id"] and not _team_admin(me, TEAM_OWNER_ADMIN_ROLES):
        _refuse(me, "Keine Berechtigung", TEAM_OWNER_ADMIN_ROLES)
    # Team auflösen (#1274): nur mit dem eingetippten Teamnamen; was dabei passiert, regelt services/team_dissolve.
    from services.team_dissolve import dissolve, same_name
    if not same_name(team, confirm):
        raise HTTPException(status_code=400, detail="Zum Auflösen bitte den Teamnamen genau so eintippen, wie er dasteht.")
    return await dissolve(db, team, me)


@router.get("/{team_id}/squads")
async def list_squads(team_id: str, me: dict = Depends(get_current_user)):
    db = get_db()
    team = await db.teams.find_one({"id": team_id}, {"_id": 0})
    if not team:
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    squads = await db.team_squads.find({"team_id": team_id}, {"_id": 0}).sort("created_at", -1).to_list(200)
    # Je Co-Team: Darf die Person es ändern (#2203)? Die Liga-Leitung mit „Kader prüfen“ liest nur die Co-Teams ihrer Liga.
    for squad in squads:
        squad["can_edit"] = await _may_change_squad(db, team, squad.get("id"), me)
    if me["id"] not in team.get("member_ids", []) and not _can_edit_team(team, me):
        squads = [squad for squad in squads if squad["can_edit"]]
        if not squads:
            _refuse_edit(team, me, "Keine Berechtigung")
    # Nur was die Co-Team-Ansicht zeigt (#1497) - wie _public_user bei den anderen Team-Antworten.
    member_map = {u["id"]: u for u in await db.users.find(
        {"id": {"$in": list({uid for s in squads for uid in s.get("member_ids", [])})}},
        {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1},
    ).to_list(500)}
    game_ids = sorted({squad["game_id"] for squad in squads if squad.get("game_id")})
    games = {row["id"]: row.get("name") for row in await db.games.find(
        {"id": {"$in": game_ids}}, {"_id": 0, "id": 1, "name": 1},
    ).to_list(len(game_ids) or 1)} if game_ids else {}
    for squad in squads:
        squad["members"] = [
            _public_user(member_map[uid]) for uid in squad.get("member_ids", []) if uid in member_map
        ]
        # Der Name zum Spiel - Web und App zeigen ihn statt der Kennung; ein alter Freitext hat keinen.
        if games.get(squad.get("game_id")):
            squad["game"] = games[squad["game_id"]]
    # Was die Staffel verlangt (#2202): Web warnt damit, bevor jemand den Kader unter die Mindestgröße bringt.
    from services import squad_shortage

    demands = await squad_shortage.requirements(db, [squad["id"] for squad in squads if squad.get("id")])
    for squad in squads:
        if squad.get("id") in demands:
            squad["league_requirement"] = demands[squad["id"]]
    return squads


@router.post("/{team_id}/squads")
async def create_squad(team_id: str, body: TeamSquadCreate, me: dict = Depends(get_current_user)):
    db = get_db()
    team = await db.teams.find_one({"id": team_id}, {"_id": 0})
    if not team:
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    if not _can_edit_team(team, me):
        _refuse_edit(team, me, "Keine Berechtigung")
    doc = body.model_dump()
    doc["game_id"] = await _squad_game(db, doc.get("game_id"))
    doc["member_ids"] = _validate_squad_members(team, doc.get("member_ids") or [])
    requested_roles = {field: doc.pop(field) for field in SQUAD_ROLE_FIELDS}
    roles = _squad_roles({}, requested_roles, doc["member_ids"], team)
    # Rollen nur, wenn vergeben - ein Co-Team ohne sie hat die Felder nicht (Index ``sparse``).
    doc.update({field: value for field, value in roles.items() if value})
    doc.update({
        "id": new_id(),
        "team_id": team_id,
        "created_by": me["id"],
        "created_at": now_utc().isoformat(),
        "updated_at": now_utc().isoformat(),
    })
    await db.team_squads.insert_one(doc)
    doc.pop("_id", None)
    await _after_squad_roles(db, team, doc, {}, roles, me)
    return doc


@router.put("/{team_id}/squads/{squad_id}")
@router.patch("/{team_id}/squads/{squad_id}")
async def update_squad(team_id: str, squad_id: str, body: TeamSquadUpdate, me: dict = Depends(get_current_user)):
    db = get_db()
    team = await db.teams.find_one({"id": team_id}, {"_id": 0})
    if not team:
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    if not await _may_change_squad(db, team, squad_id, me):
        await _refuse_squad(db, team, squad_id, me, "Keine Berechtigung")
    nullable_fields = {"description", "game_id", "member_ids", *SQUAD_ROLE_FIELDS}
    raw = body.model_dump(exclude_unset=True)
    updates = {k: v for k, v in raw.items() if v is not None or k in nullable_fields}
    current = await db.team_squads.find_one({"id": squad_id, "team_id": team_id}, {"_id": 0})
    if not current:
        raise HTTPException(status_code=404, detail="Co-Team nicht gefunden")
    if "game_id" in updates:
        updates["game_id"] = await _squad_game(db, updates["game_id"], current.get("game_id"))
        if (updates["game_id"] or None) != (current.get("game_id") or None):
            # Zugeteilt wurde es für das Spiel der Staffel - das bleibt, bis die Staffel vorbei ist. Innerhalb desselben
            # Hauptspiels (etwa ein alter Freitext wird zur richtigen Version) darf es sich ändern.
            from services.squad_registration import active_league_registrations

            active = await _staffel_without_this_game(db, updates["game_id"], await active_league_registrations(db, squad_id))
            if active:
                raise HTTPException(status_code=409, detail=f"Das Co-Team spielt in {active.get('tournament_title') or 'einer Liga-Staffel'} "
                                                            "– das Spiel lässt sich erst ändern, wenn die Staffel beendet ist.")
    if "member_ids" in updates:
        updates["member_ids"] = _validate_squad_members(team, updates.get("member_ids") or [])
    requested_roles = {field: updates.pop(field) for field in SQUAD_ROLE_FIELDS if field in updates}
    roles = _squad_roles(current, requested_roles, updates.get("member_ids", current.get("member_ids") or []), team)
    unset = {field: "" for field, value in roles.items() if not value and current.get(field)}
    updates.update({field: value for field, value in roles.items() if value})
    updates["updated_at"] = now_utc().isoformat()
    change = {"$set": updates, **({"$unset": unset} if unset else {})}
    # Spielberechtigung (#2204): Neue im Kader prüft die Season - unter derselben Sperre wie das Zuteilen, damit eine Person auch
    # bei gleichzeitigen Aufnahmen nur in einem Co-Team landet. Abgänge bleiben frei.
    joining = [uid for uid in updates.get("member_ids") or [] if uid not in (current.get("member_ids") or [])]
    seasons = await league_eligibility.open_seasons_of_squad(db, squad_id) if joining else []
    try:
        async with league_eligibility.squad_change_lock(db, [season for season, _tournament in seasons]):
            await league_eligibility.check_roster_addition(db, seasons, squad_id, joining, len(updates.get("member_ids") or []))
            res = await db.team_squads.update_one(_unchanged_squad(current), change)
    except league_eligibility.EligibilityError as refusal:
        raise HTTPException(status_code=refusal.status_code, detail=refusal.detail) from None
    except MutationLockBusy:
        raise HTTPException(status_code=409, detail=SQUAD_CHANGED_MEANWHILE) from None
    if res.matched_count == 0:
        raise HTTPException(status_code=409, detail=SQUAD_CHANGED_MEANWHILE)
    fresh = await db.team_squads.find_one({"id": squad_id}, {"_id": 0})
    await _after_squad_roles(db, team, fresh or current, current, roles, me)
    added = [uid for uid in (fresh or {}).get("member_ids") or [] if uid not in (current.get("member_ids") or [])]
    gone = [uid for uid in current.get("member_ids") or [] if uid not in ((fresh or {}).get("member_ids") or [])]
    in_staffel = bool(await _squad_staffeln(db, squad_id))
    if in_staffel and (added or gone):
        await _audit_squad_roster(db, team_id, me["id"], squad_id, added, gone)
    # Griff von außen in ein Co-Team einer Staffel (#2203): steht im Protokoll, mit den Feldern, nicht den Werten. Die Teamleitung erfährt es (#2204).
    if not _leads_team(team, me) and in_staffel:
        await _team_audit(db, "league.squad.edit", team_id, me["id"], {"squad_id": squad_id, "fields": sorted(raw)})
        await _tell_squad_edited(db, team, current, fresh or current, me, fields=sorted(raw))
    # Liga-Kader (#2108): wer neu ins Co-Team kommt, während es in einer Staffel spielt, kommt in den Kader der Season.
    if added:
        await league_roster.on_squad_members_added(db, fresh, added, me.get("id"))
    # Abgänge bleiben möglich (#2202) - reicht der Kader nicht mehr für die Staffel, gibt es eine Warnung.
    if set(current.get("member_ids") or []) - set((fresh or {}).get("member_ids") or []):
        from services import squad_shortage

        await squad_shortage.warn_after_departure(db, [current])
    return fresh


async def _squad_or_404(db, team_id: str, squad_id: str) -> tuple[dict, dict]:
    team = await db.teams.find_one({"id": team_id}, {"_id": 0})
    squad = await db.team_squads.find_one({"id": squad_id, "team_id": team_id}, {"_id": 0}) if team else None
    if not squad:
        raise HTTPException(status_code=404, detail="Co-Team nicht gefunden")
    return team, squad


@router.get("/{team_id}/squads/{squad_id}/eligibility")
async def squad_eligibility(team_id: str, squad_id: str, me: dict = Depends(get_current_user)):
    """Spielberechtigung im Co-Team (#2204): für Teamleitung, Liga-Leitung mit „Kader prüfen“, Captain und Vertreter. Nie ein Geburtsdatum."""
    from services import league_rules, league_transfers

    db = get_db()
    team, squad = await _squad_or_404(db, team_id, squad_id)
    can_edit = await _may_change_squad(db, team, squad_id, me)
    if not can_edit and me["id"] not in {squad.get("captain_id"), squad.get("vice_captain_id")}:
        raise HTTPException(status_code=403, detail="Das sehen Teamleitung, Captain und Vertreter.")
    # Regelwerk mit Zustimmungsstand (#2269): die Route reicht es herein, der Service importiert nicht nach oben.
    return await league_eligibility.squad_view(db, team, squad, can_edit=can_edit, transfers=league_transfers.for_squad,
                                               rules_doc=league_rules.rules_info)


class SquadTransferBody(BaseModel):
    user_id: str = Field(min_length=1, max_length=100)


@router.post("/{team_id}/squads/{squad_id}/transfers")
async def request_squad_transfer(team_id: str, squad_id: str, body: SquadTransferBody, me: dict = Depends(get_current_user)):
    """Einen Transfer ins Co-Team beantragen (#2204): darf, wer den Kader ändern darf; die Liga-Leitung entscheidet."""
    from services import league_transfers

    db = get_db()
    team, squad = await _squad_or_404(db, team_id, squad_id)
    if not await _may_change_squad(db, team, squad_id, me):
        await _refuse_squad(db, team, squad_id, me, "Keine Berechtigung")
    try:
        return await league_transfers.request(db, team, squad, body.user_id, me)
    except league_eligibility.EligibilityError as refusal:
        raise HTTPException(status_code=refusal.status_code, detail=refusal.detail) from None


@router.get("/{team_id}/squads/{squad_id}/transfers")
async def list_squad_transfers(team_id: str, squad_id: str, me: dict = Depends(get_current_user)):
    from services import league_transfers

    db = get_db()
    team, _squad = await _squad_or_404(db, team_id, squad_id)
    if not await _may_change_squad(db, team, squad_id, me):
        await _refuse_squad(db, team, squad_id, me, "Keine Berechtigung")
    return {"items": await league_transfers.for_squad(db, squad_id)}


@router.delete("/{team_id}/squads/{squad_id}/transfers/{transfer_id}")
async def withdraw_squad_transfer(team_id: str, squad_id: str, transfer_id: str, me: dict = Depends(get_current_user)):
    from services import league_transfers

    db = get_db()
    team, _squad = await _squad_or_404(db, team_id, squad_id)
    if not await _may_change_squad(db, team, squad_id, me):
        await _refuse_squad(db, team, squad_id, me, "Keine Berechtigung")
    try:
        return await league_transfers.withdraw(db, squad_id, transfer_id, me)
    except league_eligibility.EligibilityError as refusal:
        raise HTTPException(status_code=refusal.status_code, detail=refusal.detail) from None


@router.put("/{team_id}/squads/{squad_id}/roles")
async def set_squad_roles(team_id: str, squad_id: str, body: TeamSquadRoles, me: dict = Depends(get_current_user)):
    """Captain und Vertreter eines Co-Teams vergeben (#1649): Hauptteam-Leitung, Co-Leitung oder Admin - mit Protokoll.
    Fehlt ein Feld, bleibt die Rolle; ``null`` nimmt sie weg. Captain und Vertreter geben die **eigene** Rolle selbst ab
    (#2110): nur ihr Feld, nur auf ``null`` - danach vergibt die Teamleitung neu."""
    db = get_db()
    team = await db.teams.find_one({"id": team_id}, {"_id": 0})
    if not team:
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    current = await db.team_squads.find_one({"id": squad_id, "team_id": team_id}, {"_id": 0})
    requested = body.model_dump(exclude_unset=True)
    may_change = await _may_change_squad(db, team, squad_id, me)
    if not may_change and not _resigns_own_role(current, requested, me):
        await _refuse_squad(db, team, squad_id, me, "Captain und Vertreter vergeben Teamleitung und Co-Leitung.")
    if not current:
        raise HTTPException(status_code=404, detail="Co-Team nicht gefunden")
    roles = _squad_roles(current, requested, current.get("member_ids") or [], team)
    unset = {field: "" for field, value in roles.items() if not value and current.get(field)}
    change = {"$set": {**{field: value for field, value in roles.items() if value}, "updated_at": now_utc().isoformat()},
              **({"$unset": unset} if unset else {})}
    res = await db.team_squads.update_one(_unchanged_squad(current), change)
    if res.matched_count == 0:
        raise HTTPException(status_code=409, detail=SQUAD_CHANGED_MEANWHILE)
    fresh = await db.team_squads.find_one({"id": squad_id}, {"_id": 0})
    await _after_squad_roles(db, team, fresh or current, current, roles, me)
    if not may_change:
        await _tell_role_resigned(db, team, fresh or current, requested, me)
    # Griff von außen in ein Co-Team einer Staffel (#2203): wie beim Ändern des Co-Teams, mit den Feldern, nicht den Werten.
    elif not _leads_team(team, me) and await _squad_staffeln(db, squad_id):
        await _team_audit(db, "league.squad.edit", team_id, me["id"], {"squad_id": squad_id, "fields": sorted(requested)})
        await _tell_squad_edited(db, team, current, fresh or current, me, fields=sorted(requested))
    return fresh


def _resigns_own_role(squad: dict | None, requested: dict, me: dict) -> bool:
    """Gibt die Person nur ihre eigene Rolle ab - jedes geschickte Feld ist ihres und wird leer?"""
    if not squad or not requested:
        return False
    return all(field in SQUAD_ROLE_FIELDS and squad.get(field) == me["id"] and not (value or "").strip()
               for field, value in requested.items())


async def _tell_role_resigned(db, team: dict, squad: dict, requested: dict, me: dict) -> None:
    """Rolle abgegeben (#2110): Leitung und Co-Leitung des Hauptteams erfahren es und vergeben neu - bis dahin handelt
    der verbliebene Captain bzw. Vertreter, ohne beide die Teamleitung."""
    labels = " und ".join(SQUAD_ROLE_LABELS[field] for field in SQUAD_ROLE_FIELDS if field in requested)
    leads = {team.get("leader_id"), *(team.get("co_leader_ids") or [])} - {me["id"], None}
    for user_id in sorted(leads):
        try:
            await create_user_notification(
                user_id,
                title=f"Rolle abgegeben: {squad.get('name') or 'Co-Team'}",
                body=f"{_user_label(me)} ist nicht mehr {labels} im Co-Team {squad.get('name') or ''} – bitte die "
                     "Rolle neu vergeben.",
                url=f"/teams/{team['id']}",
                kind="team_role_changed",
                meta={"team_id": team["id"], "squad_id": squad.get("id"), "resigned": sorted(requested)},
            )
        except Exception:  # noqa: BLE001 - die Rolle ist schon abgegeben; eine Nachricht hält das nicht auf
            logger.warning("[teams] Nachricht „Rolle abgegeben“ an %s nicht verschickt", log_safe(user_id), exc_info=True)


@router.delete("/{team_id}/squads/{squad_id}")
async def delete_squad(team_id: str, squad_id: str, me: dict = Depends(get_current_user)):
    db = get_db()
    team = await db.teams.find_one({"id": team_id}, {"_id": 0})
    if not team:
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    if not await _may_change_squad(db, team, squad_id, me):
        await _refuse_squad(db, team, squad_id, me, "Keine Berechtigung")
    # Ein Co-Team, das in einer laufenden Liga-Staffel steht, bleibt (#1649) - erst die Zuteilung zurücknehmen.
    from services.squad_registration import active_league_registration

    active = await active_league_registration(db, squad_id)
    if active:
        title = active.get("tournament_title") or "einer Liga-Staffel"
        raise HTTPException(status_code=409, detail=f"Das Co-Team spielt in {title} – löschen geht erst, wenn die "
                                                    "Turnierleitung die Zuteilung zurückgenommen hat oder die Staffel beendet ist.")
    # Selbstanmeldung (#2205): Ein offener Antrag hängt am Co-Team - erst zurückziehen.
    from services.league_applications import open_application_of

    if await open_application_of(db, squad_id):
        raise HTTPException(status_code=409, detail="Für dieses Co-Team läuft eine Anmeldung in der Liga – bitte sie zuerst zurückziehen.")
    res = await db.team_squads.delete_one({"id": squad_id, "team_id": team_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Co-Team nicht gefunden")
    return {"ok": True}
