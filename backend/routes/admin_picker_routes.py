"""Personen, Teams und Sponsoren auswählen (#1354): ein schmaler Weg je Zweck statt der ganzen Kontoliste.

Wer in der Verwaltung eine Person wählt - Fahrer einer Fast Lap, Teilnehmer und Helfer eines Turniers, Personen für
Speziallinks, Vorstandsposten, Einladungen zum Mitgliedsantrag -, sucht hier nach dem Namen. Die Antwort nennt höchstens
zehn Treffer mit Kennung, Name, Bild und einer Zeile Zusammenhang („Mitglied“, „Team Lions Rocket“, „angemeldet“);
E-Mail-Adressen und Rollen gehen nie hinaus, gesucht wird nie nach einer E-Mail-Adresse. Wer welchen Zweck abfragen darf,
steht in ``PURPOSES`` an einer Stelle.

Teams und Sponsoren kommen als kleine Auswahl über eigene Wege - jede Liste lädt für sich, damit ein fehlendes Recht an
einer Stelle nicht die ganze Seite leer lässt.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from auth import get_current_user
from database import get_db
from services.query_filters import safe_regex

router = APIRouter(prefix="/api/admin", tags=["admin-picker"])

MAX_HITS = 10
ACTIVE_MEMBER_STATUSES = ("active", "honorary")

# Zweck → (Beschreibung für Fehlermeldungen). Die Prüfung je Zweck steht in ``_allowed``.
PURPOSES = {
    "tournament": "Teilnehmer und Helfer eines Turniers",
    "fastlap": "Fahrer und Team einer Fast Lap",
    "access_links": "Speziallinks",
    "board": "Vorstandsposten",
    "invite": "Einladungen zum Mitgliedsantrag",
}
MISSING_RIGHT = "Dafür fehlt dir das Recht: {what}."


async def _allowed(purpose: str, me: dict, context_id: str | None) -> bool:
    """Wer welchen Zweck abfragen darf - an genau einer Stelle."""
    from services.permissions import is_tournament_lead, needs_mfa, user_has_area

    if purpose == "tournament":
        # Turnierleitung (Rolle oder Freigabe) und Helfer dieses Turniers mit Organisation, Schiedsrichter oder
        # Ergebnisdienst. Stationsleitung und Stream-Betreuung brauchen keine Personensuche.
        if not context_id:
            return False
        from services.tournament_permissions import PARTICIPANT_STAFF_ROLES, has_tournament_staff_permission

        return await has_tournament_staff_permission(me, context_id, PARTICIPANT_STAFF_ROLES)
    if purpose == "fastlap":
        if not context_id:
            return False
        from routes.f1_routes import F1_RESULT_STAFF_ROLES, _has_f1_staff_permission

        return await _has_f1_staff_permission(me, context_id, F1_RESULT_STAFF_ROLES)
    if purpose == "access_links":
        return is_tournament_lead(me) and not needs_mfa(me)
    if purpose == "board":
        return await user_has_area(me, "club", "system") and not needs_mfa(me)
    if purpose == "invite":
        return await user_has_area(me, "club") and not needs_mfa(me)
    return False


def _name(user: dict) -> str:
    return user.get("display_name") or user.get("username") or "Unbekannt"


def _name_filter(q: str) -> dict:
    pattern = safe_regex(q)
    return {"$or": [{"display_name": {"$regex": pattern, "$options": "i"}}, {"username": {"$regex": pattern, "$options": "i"}}]}


async def _members_among(db, user_ids: list[str]) -> set[str]:
    if not user_ids:
        return set()
    rows = await db.memberships.find(
        {"user_id": {"$in": user_ids}, "member_status": {"$in": list(ACTIVE_MEMBER_STATUSES)}}, {"_id": 0, "user_id": 1},
    ).to_list(len(user_ids) + 5)
    return {row["user_id"] for row in rows if row.get("user_id")}


async def _first_teams(db, user_ids: list[str]) -> dict[str, str]:
    """Je Person der Name eines Teams, in dem sie spielt - für die Zeile Zusammenhang."""
    if not user_ids:
        return {}
    out: dict[str, str] = {}
    async for team in db.teams.find({"member_ids": {"$in": user_ids}}, {"_id": 0, "name": 1, "member_ids": 1}).sort("name", 1):
        for user_id in team.get("member_ids") or []:
            if user_id in user_ids and user_id not in out and team.get("name"):
                out[user_id] = team["name"]
    return out


async def _search_accounts(db, q: str, extra: dict | None = None) -> list[dict]:
    query = {"is_active": {"$ne": False}, "is_banned": {"$ne": True}, **_name_filter(q), **(extra or {})}
    return await db.users.find(query, {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1}).sort(
        "display_name", 1).limit(MAX_HITS).to_list(MAX_HITS)


async def _tournament_hits(db, q: str, tournament_id: str) -> list[dict]:
    users = await _search_accounts(db, q)
    ids = [u["id"] for u in users]
    members = await _members_among(db, ids)
    teams = await _first_teams(db, ids)
    registered = set(await db.tournament_registrations.distinct("user_id", {"tournament_id": tournament_id, "user_id": {"$in": ids}}))
    hits = []
    for user in users:
        parts = []
        if user["id"] in registered:
            parts.append("angemeldet")
        if user["id"] in members:
            parts.append("Mitglied")
        if user["id"] in teams:
            parts.append(f"Team {teams[user['id']]}")
        hits.append({"id": user["id"], "name": _name(user), "avatar_url": user.get("avatar_url"), "context": " · ".join(parts) or "Community"})
    return hits


async def _account_hits(db, q: str) -> list[dict]:
    users = await _search_accounts(db, q)
    ids = [u["id"] for u in users]
    members = await _members_among(db, ids)
    teams = await _first_teams(db, ids)
    hits = []
    for user in users:
        parts = ["Mitglied" if user["id"] in members else "Community"]
        if user["id"] in teams:
            parts.append(f"Team {teams[user['id']]}")
        hits.append({"id": user["id"], "name": _name(user), "avatar_url": user.get("avatar_url"), "context": " · ".join(parts),
                     "is_club_member": user["id"] in members})
    return hits


async def _board_hits(db, q: str) -> list[dict]:
    """Nur Vereinsmitglieder (#1355): Konten mit aktiver Mitgliedschaft - und gepflegte Mitgliederprofile ohne Konto."""
    member_ids = await db.memberships.distinct("user_id", {"member_status": {"$in": list(ACTIVE_MEMBER_STATUSES)}})
    users = await _search_accounts(db, q, {"id": {"$in": [uid for uid in member_ids if uid]}}) if member_ids else []
    hits = [{"id": user["id"], "name": _name(user), "avatar_url": user.get("avatar_url"), "context": "Mitglied", "has_account": True}
            for user in users]
    if len(hits) < MAX_HITS:
        pattern = safe_regex(q)
        profiles = await db.club_member_profiles.find(
            {"is_active": {"$ne": False}, "$and": [
                {"$or": [{"user_id": None}, {"user_id": {"$exists": False}}, {"user_id": ""}]},
                {"$or": [{"display_name": {"$regex": pattern, "$options": "i"}}, {"gamertag": {"$regex": pattern, "$options": "i"}}]},
            ]},
            {"_id": 0, "id": 1, "display_name": 1, "gamertag": 1, "photo_url": 1, "role_title": 1},
        ).sort("display_name", 1).limit(MAX_HITS - len(hits)).to_list(MAX_HITS - len(hits))
        for profile in profiles:
            hits.append({"id": profile["id"], "name": profile.get("display_name") or profile.get("gamertag") or "Mitglied",
                         "avatar_url": profile.get("photo_url"), "context": "Mitgliederprofil ohne Konto", "has_account": False})
    return hits[:MAX_HITS]


async def _invite_hits(db, q: str) -> list[dict]:
    """Einladungen (#1356): Konten ohne aktive Mitgliedschaft; wer schon eingeladen ist, steht mit dem Datum da."""
    member_ids = await db.memberships.distinct("user_id", {"member_status": {"$in": list(ACTIVE_MEMBER_STATUSES)}})
    extra = {"id": {"$nin": [uid for uid in member_ids if uid]}} if member_ids else {}
    users = await _search_accounts(db, q, extra)
    ids = [u["id"] for u in users]
    from services.membership_invitations import OPEN, _expire_open
    from models import now_utc

    await _expire_open(db, now_utc().isoformat())
    open_rows = await db.membership_invitations.find({"user_id": {"$in": ids}, "status": OPEN}, {"_id": 0, "user_id": 1, "created_at": 1}).to_list(len(ids) + 5) if ids else []
    invited = {row["user_id"]: row.get("created_at") for row in open_rows}
    hits = []
    for user in users:
        hit = {"id": user["id"], "name": _name(user), "avatar_url": user.get("avatar_url"), "context": "Community"}
        if user["id"] in invited:
            hit["invited_at"] = invited[user["id"]]
            hit["context"] = "ist schon eingeladen"
        hits.append(hit)
    return hits


@router.get("/people/search")
async def search_people(
    purpose: str = Query(..., max_length=20),
    q: str = Query("", max_length=80),
    context_id: str | None = Query(None, max_length=80),
    me: dict = Depends(get_current_user),
):
    if purpose not in PURPOSES:
        raise HTTPException(400, "Unbekannter Zweck der Personensuche.")
    if not await _allowed(purpose, me, context_id):
        raise HTTPException(403, MISSING_RIGHT.format(what=PURPOSES[purpose]))
    needle = (q or "").strip().lstrip("@")
    # Gesucht wird nur über Namen - eine E-Mail-Adresse findet nichts.
    if not needle or "@" in needle:
        return []
    db = get_db()
    if purpose == "tournament":
        return await _tournament_hits(db, needle, context_id)
    if purpose == "board":
        return await _board_hits(db, needle)
    if purpose == "invite":
        return await _invite_hits(db, needle)
    return await _account_hits(db, needle)


@router.get("/choices/teams")
async def team_choices(tournament_id: str = Query(..., max_length=80), q: str = Query("", max_length=80),
                       me: dict = Depends(get_current_user)):
    """Teams zum Hinzufügen in ein Turnier: Turnierleitung und Helfer dieses Turniers (Organisation, Schiedsrichter,
    Ergebnisdienst). Nur Name, Kürzel, Logo und Größe."""
    if not await _allowed("tournament", me, tournament_id):
        raise HTTPException(403, MISSING_RIGHT.format(what="Teams dieses Turniers"))
    db = get_db()
    query: dict = {}
    if (q or "").strip():
        pattern = safe_regex(q)
        query["$or"] = [{"name": {"$regex": pattern, "$options": "i"}}, {"tag": {"$regex": pattern, "$options": "i"}}]
    teams = await db.teams.find(query, {"_id": 0, "id": 1, "name": 1, "tag": 1, "logo_url": 1, "member_ids": 1}).sort("name", 1).limit(300).to_list(300)
    return [{"id": t["id"], "name": t.get("name") or "", "tag": t.get("tag") or "", "logo_url": t.get("logo_url"),
             "member_count": len(t.get("member_ids") or [])} for t in teams if t.get("id")]


@router.get("/choices/sponsors")
async def sponsor_choices(me: dict = Depends(get_current_user)):
    """Event-Sponsoren: aktive Sponsoren mit dem Haken „Events“ - für alle, die Events bearbeiten (Turnierleitung), dazu
    Redaktion und System. Nur Name und Logo."""
    from services.permissions import needs_mfa, user_has_area

    if not await user_has_area(me, "tournaments", "content", "system") or needs_mfa(me):
        raise HTTPException(403, MISSING_RIGHT.format(what="Event-Sponsoren"))
    db = get_db()
    rows = await db.sponsors.find({"is_active": {"$ne": False}, "show_on_events": True}, {"_id": 0, "id": 1, "name": 1, "logo_url": 1}).sort(
        "name", 1).to_list(200)
    return [{"id": row["id"], "name": row.get("name") or "", "logo_url": row.get("logo_url")} for row in rows if row.get("id")]
