"""P0 — Penalty Transparency routes.

Aggregates ALL penalties from Fast Lap (penalty_seconds>0 or is_invalid) and
Tournament Matches (forfeit / disqualified / disputed) into a single user-facing
log so players can see exactly why and when they were penalized.

Endpoints:
  GET /api/penalties/me              — own penalties (auth)
  GET /api/admin/penalties           — all penalties (admin), with filters
  POST /api/penalties/sanctions/{id}/appeal — Einspruch gegen eine Strafe der Liga (E.3), nur Betroffene

Strafen der Liga (E.3, ``competition_sanctions``, docs/LIGA.md „E.3 Strafen“) stehen als ``kind: "league_sanction"`` in beiden
Listen - die eigene und die des Co-Teams, für das die Person verantwortlich ist. Die Moderation der Community bleibt getrennt.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from typing import Optional

from database import get_db
from auth import get_current_user, require_admin
from services import league_sanctions
from services.competition_penalties import load_forfeit_penalties
from services.match_audience import team_penalty_registrations

router = APIRouter(prefix="/api/penalties", tags=["penalties"])
admin_router = APIRouter(prefix="/api/admin/penalties", tags=["penalties-admin"])


def _ms_to_time_str(ms: int | None) -> str:
    if ms is None:
        return "—"
    s = ms / 1000.0
    minutes = int(s // 60)
    seconds = s - minutes * 60
    return f"{minutes}:{seconds:06.3f}" if minutes else f"{seconds:.3f}s"


async def _negative_groups(db) -> dict[str, str]:
    """Die Erfolgsgruppen, die einen Vorfall bedeuten: Code → Name."""
    rows = await db.achievement_groups.find({"is_negative": True}, {"_id": 0, "code": 1, "name": 1}).to_list(200)
    return {row["code"]: row.get("name") or row["code"] for row in rows}


def _team_name(registration: dict) -> str:
    return registration.get("display_name") or registration.get("team_name") or registration.get("squad_name") or "Co-Team"


async def _forfeit_rows(db, forfeits: list[dict], team_names: dict[str, str]) -> list[dict]:
    """Kampflos-Wertungen als Zeilen. ``team_names``: Anmeldung → Name - diese Wertungen sind Teamstrafen eines Co-Teams."""
    tour_ids = list({item["tournament_id"] for item in forfeits if item.get("tournament_id")})
    tours = {t["id"]: t for t in await db.tournaments.find(
        {"id": {"$in": tour_ids}}, {"_id": 0, "id": 1, "title": 1, "slug": 1}).to_list(len(tour_ids) + 10)}
    rows = []
    for item in forfeits:
        t = tours.get(item.get("tournament_id"), {})
        team_name = team_names.get(item.get("registration_id") or "")
        subtitle = f"Match #{item.get('match_label') or ''}"
        rows.append({
            "kind": "match_forfeit",
            "label": "Kampflos verloren",
            "reason": item.get("reason") or "(keine Begründung)",
            "context_title": t.get("title") or "Turnier",
            "context_url": f"/tournaments/{t.get('slug') or t.get('id') or ''}",
            "context_subtitle": f"{subtitle} · {team_name}" if team_name else subtitle,
            "issued_by": item.get("issued_by"),
            "issued_at": item.get("issued_at"),
            "ref_id": item.get("match_id"),
            "tournament_id": item.get("tournament_id"),
            "match_source": item.get("source"),
            "admin_url": f"/admin/tournaments/{item.get('tournament_id')}" if item.get("tournament_id") else "",
            **({"team_penalty": True, "team_name": team_name} if team_name else {}),
        })
    return rows


async def _sanction_rows(db, docs: list[dict]) -> list[dict]:
    """Strafen der Liga (E.3) als Zeilen der Liste: Art, Verstoß, Begründung, Zeitraum, Frist und Stand des Einspruchs."""
    if not docs:
        return []
    names = await league_sanctions.names_for(db, docs)
    season_ids = sorted({doc["season_id"] for doc in docs if doc.get("season_id")})
    seasons = {row["id"]: row for row in await db.league_seasons.find(
        {"id": {"$in": season_ids}}, {"_id": 0, "id": 1, "name": 1, "slug": 1, "league_id": 1}).to_list(len(season_ids) + 1)}
    league_ids = sorted({doc["league_id"] for doc in docs if doc.get("league_id")})
    leagues = {row["id"]: row for row in await db.leagues.find(
        {"id": {"$in": league_ids}}, {"_id": 0, "id": 1, "name": 1, "slug": 1}).to_list(len(league_ids) + 1)}
    rows = []
    for doc in docs:
        view = await league_sanctions.view(db, doc, names)
        season, league = seasons.get(doc.get("season_id")) or {}, leagues.get(doc.get("league_id")) or {}
        team_name = view["squad_name"] if doc.get("target_type") == league_sanctions.SQUAD else None
        rows.append({
            "kind": "league_sanction",
            "label": view["kind_label"],
            "reason": doc.get("reason") or "(keine Begründung)",
            "context_title": " · ".join(part for part in (league.get("name"), season.get("name")) if part) or "Liga",
            "context_url": f"/leagues/{league['slug']}/{season['slug']}" if league.get("slug") and season.get("slug") else "",
            "context_subtitle": " · ".join(part for part in (doc.get("rule_ref"), team_name) if part),
            "issued_by": doc.get("created_by"),
            "issued_at": doc.get("created_at"),
            "ref_id": doc["id"],
            "league_id": doc.get("league_id"),
            "admin_url": f"/admin/leagues/seasons/{doc.get('season_id')}#strafen",
            "sanction": view,
            **({"team_penalty": True, "team_name": team_name} if team_name else {}),
        })
    return rows


async def _attach_issuer_names(db, rows: list[dict]) -> None:
    issuer_ids = list({p["issued_by"] for p in rows if p.get("issued_by")})
    issuers = {u["id"]: u for u in await db.users.find(
        {"id": {"$in": issuer_ids}}, {"_id": 0, "id": 1, "username": 1, "display_name": 1}
    ).to_list(len(issuer_ids) + 10)}
    for p in rows:
        u = issuers.get(p.get("issued_by"), {})
        p["issued_by_name"] = u.get("display_name") or u.get("username") or "Admin"


async def _collect_user_penalties(user_id: str) -> list[dict]:
    """Build a unified penalty timeline for a single user."""
    db = get_db()
    out: list[dict] = []

    # --- Fast Lap penalties / invalid laps ---
    laps = await db.f1_lap_times.find(
        {
            "user_id": user_id,
            "$or": [
                {"penalty_seconds": {"$gt": 0}},
                {"is_invalid": True},
            ],
        },
        {"_id": 0},
    ).sort("created_at", -1).to_list(500)

    track_ids = list({l["track_id"] for l in laps if l.get("track_id")})
    chal_ids = list({l["challenge_id"] for l in laps if l.get("challenge_id")})
    tracks = {t["id"]: t for t in await db.f1_tracks.find(
        {"id": {"$in": track_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(500)}
    chals = {c["id"]: c for c in await db.f1_challenges.find(
        {"id": {"$in": chal_ids}}, {"_id": 0, "id": 1, "title": 1, "slug": 1, "status": 1}).to_list(500)}

    for l in laps:
        chal = chals.get(l.get("challenge_id"), {})
        track = tracks.get(l.get("track_id"), {})
        kind = "lap_invalid" if l.get("is_invalid") else "lap_penalty"
        label = "Runde ungültig" if l.get("is_invalid") else f"+{l.get('penalty_seconds', 0)}s Strafzeit"
        out.append({
            "kind": kind,
            "label": label,
            "reason": l.get("admin_note") or "(keine Begründung hinterlegt)",
            "context_title": chal.get("title") or "Fast Lap",
            "context_url": f"/fastlap/{chal.get('slug') or chal.get('id') or ''}",
            "context_subtitle": track.get("name") or "",
            "raw_time_str": _ms_to_time_str(l.get("time_ms")),
            "penalty_seconds": l.get("penalty_seconds", 0),
            "is_invalid": bool(l.get("is_invalid")),
            # Aussteller ist, wer die Strafe gesetzt hat (#1584) - nicht, wer die Zeit eingetragen hat. Ältere
            # Einträge ohne diesen Vermerk nennen weiter den Ersteller.
            "issued_by": l.get("penalty_set_by") or l.get("created_by"),
            "issued_at": l.get("penalty_set_at") or l.get("updated_at") or l.get("created_at"),
            "ref_id": l.get("id"),
            "admin_url": f"/admin/f1/{l.get('challenge_id')}?track={l.get('track_id')}",
            # Nach der Veröffentlichung geht Zurücknehmen nur mit Begründung (#1584, #2130).
            "results_locked": chal.get("status") in {"results_published", "archived"},
        })

    # --- Tournament forfeits across Legacy and Stage/FFA ---
    regs = await db.tournament_registrations.find(
        {"user_id": user_id}, {"_id": 0, "id": 1, "tournament_id": 1}
    ).to_list(500)
    # Co-Teams (#2201): die Anmeldung hat keine Person - die Teamstrafe sehen Captain, Vertreter und die Hauptteam-Leitung.
    team_names = {reg["id"]: _team_name(reg) for reg in await team_penalty_registrations(db, user_id)}
    reg_ids = [r["id"] for r in regs] + list(team_names)
    if reg_ids:
        forfeits = await load_forfeit_penalties(db, reg_ids, limit=500)
        out.extend(await _forfeit_rows(db, forfeits, team_names))

    # --- Negative achievement awards (admin-issued incidents) ---
    # „Negativ“ steht an der Gruppe, nicht an der Vergabe (#2125). Von Hand eingetragene zählen; was von selbst kommt
    # (Dispute geöffnet, spät eingecheckt), ist ein Fun-Erfolg und keine Strafe.
    groups = await _negative_groups(db)
    neg = await db.user_achievements.find(
        {"user_id": user_id, "group_code": {"$in": sorted(groups)}, "context.manual": True},
        {"_id": 0},
    ).sort("earned_at", -1).to_list(500) if groups else []
    for n in neg:
        context = n.get("context") or {}
        out.append({
            "kind": "incident",
            "label": groups.get(n.get("group_code")) or "Vorfall",
            # Sichtbar ist nur, was „Vorfall eintragen“ ausdrücklich für die Person freigibt; Notizen aus anderen Vergaben sind intern.
            "reason": (context.get("note_visible") and context.get("note")) or "(keine Begründung hinterlegt)",
            "context_title": "Verhalten / Vorfall",
            "context_url": "",
            "context_subtitle": "",
            "issued_by": n.get("awarded_by") or context.get("by"),
            "issued_at": n.get("earned_at"),
            "ref_id": n.get("id"),
            "admin_url": "/admin/achievements?tab=negative",
        })

    # --- Strafen der Liga (E.3): die eigenen und die der Co-Teams, für die die Person verantwortlich ist ---
    out.extend(await _sanction_rows(db, await league_sanctions.for_user(db, user_id)))

    await _attach_issuer_names(db, out)
    out.sort(key=lambda x: x.get("issued_at") or "", reverse=True)
    return out


@router.get("/me")
async def my_penalties(me: dict = Depends(get_current_user)):
    """Authenticated user's own penalty log."""
    items = await _collect_user_penalties(me["id"])
    # Wege in die Verwaltung gehören nicht in die eigene Liste.
    for item in items:
        item.pop("admin_url", None)
        item.pop("results_locked", None)
        item.pop("tournament_id", None)
        item.pop("league_id", None)
    return {"count": len(items), "items": items}


class SanctionAppealBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(max_length=league_sanctions.APPEAL_MAX + 50)


@router.post("/sanctions/{sanction_id}/appeal")
async def appeal_sanction(sanction_id: str, body: SanctionAppealBody, me: dict = Depends(get_current_user)):
    """Einspruch gegen eine Strafe der Liga (E.3, Nr. 41): einmal je Strafe, innerhalb der Frist, nur Betroffene - die Person
    selbst, beim Co-Team Captain, Vertreter und Hauptteam-Leitung. Für alle anderen gibt es die Strafe nicht (404)."""
    db = get_db()
    doc = await db.competition_sanctions.find_one({"id": sanction_id}, {"_id": 0})
    if not doc or me["id"] not in await league_sanctions.affected_user_ids(db, doc):
        raise HTTPException(status_code=404, detail=league_sanctions.NOT_FOUND)
    try:
        doc = await league_sanctions.submit_appeal(db, doc, me, body.text)
    except league_sanctions.SanctionProblem as problem:
        raise HTTPException(status_code=problem.status, detail=problem.message) from None
    await league_sanctions.notify(db, doc, "appeal", actor_id=me["id"])
    return (await _sanction_rows(db, [doc]))[0]["sanction"]


async def _without_foreign_staffeln(db, items: list[dict], me: dict) -> list[dict]:
    """Die Strafen einer Staffel gehören der Liga (#2203): Der Bereich Turnierleitung allein sieht sie im Eingang nicht."""
    from services.league_permissions import staffel_access
    from services.league_scope import ONLY_LEAGUE

    ids = sorted({item.get("tournament_id") for item in items if item.get("tournament_id")})
    staffeln = await db.tournaments.find({"id": {"$in": ids}, **ONLY_LEAGUE}, {"_id": 0, "id": 1, "league_context": 1}).to_list(None) if ids else []
    access = await staffel_access(db, me)
    foreign = {row["id"] for row in staffeln if not access.covers(row)}
    # Strafen der Liga (E.3) tragen ihre Liga selbst - auch ohne Staffel (Sperre einer Person).
    return [item for item in items if item.get("tournament_id") not in foreign
            and (not item.get("league_id") or access.all or item["league_id"] in access.league_ids)]


@admin_router.get("")
async def all_penalties(
    me: dict = Depends(require_admin()),
    user_id: Optional[str] = Query(None),
    kind: Optional[str] = Query(None, description="lap_invalid|lap_penalty|match_forfeit|incident|league_sanction"),
    limit: int = Query(200, le=1000),
):
    """Admin penalty inbox across all users."""
    db = get_db()
    if user_id:
        items = await _collect_user_penalties(user_id)
    else:
        # Get all users that have at least one penalty (penalty laps + forfeit losers + neg awards)
        user_ids: set[str] = set()
        async for l in db.f1_lap_times.find(
            {"$or": [{"penalty_seconds": {"$gt": 0}}, {"is_invalid": True}]},
            {"_id": 0, "user_id": 1},
        ):
            if l.get("user_id"):
                user_ids.add(l["user_id"])
        # forfeit results → registrations → users, for both match stores
        forfeits = await load_forfeit_penalties(db)
        forfeit_registration_ids = sorted({
            item["registration_id"]
            for item in forfeits
            if item.get("registration_id")
        })
        team_names: dict[str, str] = {}
        if forfeit_registration_ids:
            for registration in await db.tournament_registrations.find(
                {"id": {"$in": forfeit_registration_ids}},
                {"_id": 0, "id": 1, "user_id": 1, "squad_id": 1, "display_name": 1, "team_name": 1, "squad_name": 1},
            ).to_list(5000):
                if registration.get("squad_id"):
                    team_names[registration["id"]] = _team_name(registration)
                elif registration.get("user_id"):
                    user_ids.add(registration["user_id"])
        groups = await _negative_groups(db)
        if groups:
            async for a in db.user_achievements.find({"group_code": {"$in": sorted(groups)}, "context.manual": True}, {"_id": 0, "user_id": 1}):
                if a.get("user_id"):
                    user_ids.add(a["user_id"])
        # Strafen der Liga (E.3): Personen hier, Co-Teams unten einmal je Strafe.
        squad_sanctions = []
        async for doc in db.competition_sanctions.find({}, {"_id": 0}):
            if doc.get("target_type") == league_sanctions.SQUAD:
                squad_sanctions.append(doc)
            elif doc.get("user_id"):
                user_ids.add(doc["user_id"])

        items = []
        for uid in user_ids:
            # Eine Teamstrafe steht unten einmal unter dem Co-Team - nicht je verantwortlicher Person (#2201).
            sub = [row for row in await _collect_user_penalties(uid) if not row.get("team_penalty")]
            for s in sub:
                s["user_id"] = uid
            items.extend(sub)
        # enrich user info
        users = {u["id"]: u for u in await db.users.find(
            {"id": {"$in": list(user_ids)}},
            {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1}
        ).to_list(2000)}
        for it in items:
            u = users.get(it.get("user_id"), {})
            it["user_username"] = u.get("username")
            it["user_display_name"] = u.get("display_name") or u.get("username")
            it["user_avatar_url"] = u.get("avatar_url")
        team_rows = await _forfeit_rows(db, [item for item in forfeits if item.get("registration_id") in team_names], team_names)
        team_rows.extend(await _sanction_rows(db, squad_sanctions))
        await _attach_issuer_names(db, team_rows)
        items.extend({**row, "user_id": None, "user_username": None, "user_display_name": None} for row in team_rows)

    items = await _without_foreign_staffeln(db, items, me)
    # Die Zähler auf den Filterknöpfen gelten für alle Einträge - auch wenn gerade ein Filter aktiv ist (#2125).
    counts: dict[str, int] = {"all": len(items)}
    for item in items:
        counts[item.get("kind")] = counts.get(item.get("kind"), 0) + 1
    if kind:
        items = [i for i in items if i.get("kind") == kind]
    items.sort(key=lambda x: x.get("issued_at") or "", reverse=True)
    return {"count": len(items), "counts": counts, "items": items[:limit]}
