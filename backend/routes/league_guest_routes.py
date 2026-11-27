"""Gastteams (#1665, Nr. 286): die Angabe der Teamleitung und das Kennzeichen der Liga-Leitung. Logik in ``services/league_guests.py``.

| Route | Wer |
| --- | --- |
| ``PUT /api/teams/{team_id}/guest-team`` | Teamleitung und Co-Leitung des Hauptteams: Verein oder Schule, Freigabe des Schulnamens |
| ``PUT /api/admin/leagues/teams/{team_id}/guest-team`` | Liga-Leitung mit „Teams freigeben“ in einer Liga des Teams oder Bereich Ligen; nicht befangen |
| ``PUT /api/admin/leagues/seasons/{season_id}/privacy-release`` | nur Superadmin: Hinweis zum Datenschutz für Gäste freigeben (Nr. 1) |
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from auth import get_current_user
from database import get_db
from models import GuestTeamConfirm, GuestTeamOrg, LeaguePrivacyRelease, new_id, now_utc
from services import league_guests as guests
from services import word_filter
from services.league_applications import PRIVACY_RELEASE
from services.league_permissions import NO_LEAGUE_RIGHT, record_override, refusal, require_no_side_conflict
from services.permissions import is_confirmed_admin_role

router = APIRouter(prefix="/api/teams", tags=["league-guests"])
admin_router = APIRouter(prefix="/api/admin/leagues/teams", tags=["league-guests-admin"])
release_router = APIRouter(prefix="/api/admin/leagues/seasons", tags=["league-guests-admin"])

RELEASE_ONLY_SUPERADMIN = "Den Hinweis zum Datenschutz für Gäste gibt nur der Superadmin frei, nach der rechtlichen Prüfung."
RELEASE_NEEDS_TEXT = "Erst einen Hinweis zum Datenschutz an der Season eintragen, dann freigeben."


async def _team(db, team_id: str) -> dict:
    team = await db.teams.find_one({"id": team_id}, {"_id": 0})
    if not team:
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    return team


async def _audit(db, action: str, team_id: str, actor_id: str | None, data: dict) -> None:
    await db.audit_logs.insert_one({"id": new_id(), "action": action, "target_id": team_id, "actor_id": actor_id, "data": data,
                                    "created_at": now_utc().isoformat()})


def _same(key: str, value):
    """Vergleichswert fürs Protokoll: fehlend und leer sind gleich, die Freigabe ist ja oder nein."""
    return bool(value) if key == "school_name_public" else (value or None)


def _answer(team: dict) -> dict:
    return {"guest_team": guests.details(team), "guest_badge": guests.badge(team)}


@router.put("/{team_id}/guest-team")
async def set_guest_org(team_id: str, body: GuestTeamOrg, me: dict = Depends(get_current_user)):
    """Verein oder Schule (#1665): nur Teamleitung und Co-Leitung - die Freigabe des Schulnamens ist ihre Entscheidung."""
    db = get_db()
    team = await _team(db, team_id)
    if me.get("id") not in {team.get("leader_id"), *(team.get("co_leader_ids") or [])}:
        raise HTTPException(status_code=403, detail=guests.NOT_TEAM_LEAD)
    before = guests.state_of(team)
    try:
        state = guests.org_fields(body.kind, body.name, body.school_name_public, before=before)
    except ValueError as problem:
        raise HTTPException(status_code=422, detail=str(problem)) from None
    if state.get("name") and state["name"] != guests.clean_name(before.get("name")):
        await word_filter.screen_field(db, state["name"], kind="guest_org", user_id=me["id"], ref_id=team_id)
    await guests.save(db, team_id, state)
    # Ins Protokoll nur, was sich geändert hat - der Name selbst gehört zum Team und steht am Team.
    changed = sorted(key for key in ("kind", "name", "school_name_public") if _same(key, before.get(key)) != _same(key, state.get(key)))
    if changed:
        await _audit(db, "team.guest_team.update", team_id, me["id"], {"fields": changed, "kind": state.get("kind"),
                                                                       "school_name_public": state.get("school_name_public")})
    return _answer(await _team(db, team_id))


async def _guest_marker(team_id: str, me: dict = Depends(get_current_user)) -> dict:
    """Wächter vor dem Inhalt der Anfrage (wie ``require_league``): Bereich Ligen oder „Teams freigeben“ in einer Liga des Teams."""
    db = get_db()
    if await guests.may_confirm(db, me, team_id):
        return me
    # Fehlt nur die Zwei-Faktor-Anmeldung, sagt die Absage das - sonst, wer das Kennzeichen setzt.
    has_duty = bool(await db.league_staff.find_one({"user_id": me.get("id")}, {"_id": 1}))
    reason = refusal(me, has_duty)
    raise HTTPException(status_code=403, detail=guests.NO_LEAGUE_TEAM if reason == NO_LEAGUE_RIGHT else reason)


async def _superadmin(me: dict = Depends(get_current_user)) -> dict:
    if not is_confirmed_admin_role(me, ("superadmin",)):
        raise HTTPException(status_code=403, detail=RELEASE_ONLY_SUPERADMIN)
    return me


@admin_router.put("/{team_id}/guest-team")
async def confirm_guest_team(team_id: str, body: GuestTeamConfirm, me: dict = Depends(_guest_marker)):
    """Das Kennzeichen „Gast“ (#1665, Nr. 286): setzt und bestätigt nur die Liga-Leitung, nie die Mitgliedschaft. Über das eigene Team
    entscheidet eine andere Person (Nr. 73), der Superadmin nur als Notausnahme mit Grund."""
    db = get_db()
    team = await _team(db, team_id)
    override = await require_no_side_conflict(db, me, {"user_id": None, "team_id": team_id, "squad_id": None},
                                              conflict_reason=body.conflict_reason)
    state = guests.confirmed_fields(guests.state_of(team), body.confirmed)
    was = guests.is_confirmed(team)
    await guests.save(db, team_id, state)
    season_id = await guests.season_context(db, team_id, body.season_id)
    action = "league.guest_team.confirm" if body.confirmed else "league.guest_team.revoke"
    await _audit(db, action, team_id, me["id"], {"season_id": season_id, "kind": state.get("confirmed_kind"),
                                                 **({"conflict_override": True} if override else {})})
    if override:
        await record_override(db, me, action=f"guest_team_{'confirm' if body.confirmed else 'revoke'}", target_id=team_id, reason=override,
                              season_id=season_id)
    fresh = await _team(db, team_id)
    if body.confirmed or was:
        await guests.tell_team(db, fresh, body.confirmed)
    return _answer(fresh)


@release_router.put("/{season_id}/privacy-release")
async def release_privacy_text(season_id: str, body: LeaguePrivacyRelease, me: dict = Depends(_superadmin)):
    """Hinweis zum Datenschutz für Gäste freigeben (#1665, Nr. 1): nur der Superadmin, nach der rechtlichen Prüfung - genau der Wortlaut,
    der jetzt an der Season steht. Bis dahin sehen Konten ohne Mitgliedschaft den Platzhalter (``league_applications.privacy_text_for``)."""
    db = get_db()
    season = await db.league_seasons.find_one({"id": season_id}, {"_id": 0, "id": 1, "application_privacy_text": 1})
    if not season:
        raise HTTPException(status_code=404, detail="Season nicht gefunden")
    text = season.get("application_privacy_text") or ""
    if body.released and not text:
        raise HTTPException(status_code=422, detail=RELEASE_NEEDS_TEXT)
    now = now_utc().isoformat()
    if body.released:
        await db.league_seasons.update_one({"id": season_id}, {"$set": {PRIVACY_RELEASE: {"text": text, "at": now, "by": me["id"]}}})
    else:
        await db.league_seasons.update_one({"id": season_id}, {"$unset": {PRIVACY_RELEASE: ""}})
    await _audit(db, "league.season.privacy_release", season_id, me["id"], {"season_id": season_id, "released": body.released})
    return {"released": body.released, "at": now if body.released else None}
