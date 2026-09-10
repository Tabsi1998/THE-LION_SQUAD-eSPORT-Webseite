"""PDF exports: participants, matches, standings, check-in, signs and certificates."""

import re
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from typing import Optional, Literal
from datetime import datetime, timezone
import io

from database import get_db
from auth import require_role, get_optional_user
from services.visibility import user_can_see
from services.access_links import validate_access_link
from services.competition_read import load_competition_read_model, observe_structure_read
from pdf_service import (
    pdf_participants, pdf_f1_leaderboard, pdf_matches, pdf_standings, pdf_checkin,
    pdf_station_signs, pdf_qr_sign, pdf_certificate, pdf_certificates,
)

RESULT_EXPORT_STATUSES = {"completed", "results_published", "archived"}
STAFF_EXPORT_ROLES = {"moderator", "tournament_admin", "club_admin", "superadmin"}

pdf_router = APIRouter(prefix="/api/exports", tags=["exports"])


def _pdf_response(data: bytes, filename: str):
    safe_filename = _pdf_filename(filename)
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{safe_filename}"'},
    )


def _pdf_filename_part(*values: str | None, fallback: str = "export") -> str:
    for value in values:
        raw = str(value or "").strip()
        if not raw:
            continue
        safe = re.sub(r"[^A-Za-z0-9._-]+", "_", raw).strip("._-")
        if safe:
            return safe[:90]
    return fallback


def _pdf_filename(filename: str) -> str:
    raw = str(filename or "").strip()
    stem = raw[:-4] if raw.lower().endswith(".pdf") else raw
    return _pdf_filename_part(stem, fallback="export") + ".pdf"


_PDF_SPONSOR_TIER_ORDER = {"main": 0, "platinum": 1, "gold": 2, "silver": 3, "bronze": 4}


def _sponsor_date(value) -> str | None:
    raw = str(value or "").strip()
    return raw[:10] if raw else None


def _sponsor_active_for_pdf(sponsor: dict) -> bool:
    if sponsor.get("is_active") is False or sponsor.get("show_on_pdf") is not True:
        return False
    status = str(sponsor.get("contract_status") or "active").strip().lower()
    if status in {"paused", "cancelled"}:
        return False
    today = datetime.now(timezone.utc).date().isoformat()
    start = _sponsor_date(sponsor.get("contract_start"))
    end = _sponsor_date(sponsor.get("contract_end"))
    return not ((start and start > today) or (end and end < today))


async def _pdf_sponsors(db):
    rows = await db.sponsors.find(
        {"is_active": {"$ne": False}, "show_on_pdf": True},
        {"_id": 0, "name": 1, "logo_url": 1, "link": 1, "tier": 1, "order_index": 1,
         "is_active": 1, "contract_status": 1, "contract_start": 1, "contract_end": 1, "show_on_pdf": 1},
    ).to_list(50)
    rows = [s for s in rows if _sponsor_active_for_pdf(s)]
    rows.sort(key=lambda s: (_PDF_SPONSOR_TIER_ORDER.get(s.get("tier"), 99), s.get("order_index") or 0, s.get("name") or ""))
    return rows


async def _pdf_branding(db):
    branding = await db.settings.find_one(
        {"id": "branding"},
        {
            "_id": 0,
            "logo_url": 1,
            "logo_light_url": 1,
            "logo_dark_url": 1,
            "mascot_url": 1,
            "qr_logo_url": 1,
            "favicon_url": 1,
            "favicon_light_url": 1,
            "favicon_dark_url": 1,
            "domain": 1,
            "site_title": 1,
            "club_name": 1,
        },
    ) or {}
    # PDFs werden auf Papier gedruckt und haben deshalb einen hellen Grund. Ein
    # Logo für dunklen Hintergrund ist meist weiß und dort unsichtbar - also
    # zuerst die helle Variante. Solange die PDFs schwarz waren, galt genau
    # die umgekehrte Reihenfolge; sie stand hier auch so.
    branding["pdf_logo_url"] = (
        branding.get("logo_light_url")
        or branding.get("favicon_light_url")
        or branding.get("logo_url")
        or branding.get("logo_dark_url")
    )
    if not branding.get("logo_url"):
        branding["logo_url"] = branding.get("logo_light_url") or branding.get("logo_dark_url")
    return branding


def _pdf_public_base(branding: dict) -> str:
    base = str((branding or {}).get("domain") or "https://lionsquad.at").strip().rstrip("/")
    if base and not base.startswith(("http://", "https://")):
        base = "https://" + base
    return base or "https://lionsquad.at"


def _pdf_absolute_url(path_or_url: str, branding: dict) -> str:
    raw = str(path_or_url or "").strip()
    if raw.startswith(("http://", "https://")):
        return raw
    base = _pdf_public_base(branding)
    if not raw.startswith("/"):
        raw = "/" + raw
    return base + raw


def _is_export_staff(user: dict | None) -> bool:
    return bool(user and user.get("role") in STAFF_EXPORT_ROLES)


async def _result_export_allowed(item: dict, user: dict | None) -> bool:
    if _is_export_staff(user):
        return True
    if item.get("status") not in RESULT_EXPORT_STATUSES:
        return False
    if item.get("is_public") is False:
        return False
    return await user_can_see(user, item.get("visibility") or "public")


async def _result_export_allowed_for_request(
    db,
    item: dict,
    user: dict | None,
    access: str | None,
    resource_type: str,
) -> bool:
    if await _result_export_allowed(item, user):
        return True
    if not access or item.get("status") not in RESULT_EXPORT_STATUSES:
        return False
    return bool(await validate_access_link(db, access, resource_type, item.get("id"), user, "view"))


def _certificate_source_from_item(item: dict, subtitle: str) -> dict:
    return {
        "title": item.get("title") or item.get("name") or "THE LION SQUAD",
        "subtitle": subtitle,
        "certificate_image_url": item.get("certificate_image_url"),
        "banner_url": item.get("banner_url") or item.get("share_banner_url"),
        "image_url": item.get("image_url"),
        "seo_image_url": item.get("seo_image_url") or item.get("seo_banner_url"),
    }


def _top_certificate_rows(rows: list[dict], limit: int = 4) -> list[dict]:
    result = []
    for row in rows or []:
        try:
            rank = int(row.get("rank") or 0)
        except (TypeError, ValueError):
            rank = 0
        if 1 <= rank <= limit:
            result.append(row)
    return sorted(result, key=lambda row: int(row.get("rank") or 999))


def _tournament_certificate_metrics(row: dict) -> list[dict]:
    metrics = [
        {"label": "Siege", "value": row.get("won", row.get("wins", 0))},
        {"label": "Niederlagen", "value": row.get("lost", row.get("losses", 0))},
    ]
    if row.get("points") is not None:
        metrics.append({"label": "Punkte", "value": row.get("points")})
    elif row.get("furthest_round") is not None:
        metrics.append({"label": "Runde", "value": row.get("furthest_round")})
    return metrics


def _f1_track_certificate_metrics(row: dict, track: dict | None) -> list[dict]:
    return [
        {"label": "Strecke", "value": (track or {}).get("name") or "Fast Lap"},
        {"label": "Beste Zeit", "value": row.get("time_str") or "—"},
        {"label": "Abstand", "value": row.get("gap_str") or ("Führender" if row.get("rank") == 1 else "—")},
        {"label": "Versuche", "value": row.get("attempts", 0)},
    ]


def _f1_championship_certificate_metrics(row: dict) -> list[dict]:
    return [
        {"label": "Punkte", "value": row.get("points", 0)},
        {"label": "Siege", "value": row.get("wins", 0)},
        {"label": "Rennen", "value": row.get("races", 0)},
    ]


@pdf_router.get("/qr/sign.pdf")
async def pdf_qr_sign_export(
    url: str,
    title: str = "THE LION SQUAD",
    subtitle: str = "",
    eyebrow: str = "QR CODE",
    me: dict = Depends(require_role("moderator")),
):
    db = get_db()
    sponsors = await _pdf_sponsors(db)
    branding = await _pdf_branding(db)
    target_url = _pdf_absolute_url(url, branding)
    return _pdf_response(
        pdf_qr_sign(title, target_url, subtitle=subtitle, eyebrow=eyebrow, pdf_sponsors=sponsors, pdf_branding=branding),
        "qr_schild.pdf",
    )


@pdf_router.get("/tournaments/{slug_or_id}/participants.pdf")
async def pdf_tournament_participants(slug_or_id: str, me: dict = Depends(require_role("moderator"))):
    db = get_db()
    t = await db.tournaments.find_one({"$or": [{"id": slug_or_id}, {"slug": slug_or_id}]}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404)
    regs = await db.tournament_registrations.find({"tournament_id": t["id"]}, {"_id": 0}).to_list(500)
    team_ids = list({r["team_id"] for r in regs if r.get("team_id")})
    teams = {x["id"]: x for x in await db.teams.find({"id": {"$in": team_ids}}, {"_id": 0}).to_list(500)}
    for r in regs:
        if r.get("team_id"):
            r["team"] = teams.get(r["team_id"], {})
    sponsors = await _pdf_sponsors(db)
    branding = await _pdf_branding(db)
    data = pdf_participants(t, regs, pdf_sponsors=sponsors, pdf_branding=branding)
    file_id = _pdf_filename_part(t.get("slug"), t.get("id"), slug_or_id, fallback="turnier")
    return _pdf_response(data, f"teilnehmer_{file_id}.pdf")


@pdf_router.get("/tournaments/{slug_or_id}/checkin.pdf")
async def pdf_tournament_checkin(slug_or_id: str, me: dict = Depends(require_role("moderator"))):
    db = get_db()
    t = await db.tournaments.find_one({"$or": [{"id": slug_or_id}, {"slug": slug_or_id}]}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404)
    regs = await db.tournament_registrations.find({"tournament_id": t["id"]}, {"_id": 0}).to_list(500)
    sponsors = await _pdf_sponsors(db)
    branding = await _pdf_branding(db)
    file_id = _pdf_filename_part(t.get("slug"), t.get("id"), slug_or_id, fallback="turnier")
    return _pdf_response(pdf_checkin(t, regs, pdf_sponsors=sponsors, pdf_branding=branding), f"checkin_{file_id}.pdf")


@pdf_router.get("/tournaments/{slug_or_id}/registration-qr.pdf")
async def pdf_tournament_registration_qr(slug_or_id: str, me: dict = Depends(require_role("moderator"))):
    db = get_db()
    t = await db.tournaments.find_one({"$or": [{"id": slug_or_id}, {"slug": slug_or_id}]}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404)
    sponsors = await _pdf_sponsors(db)
    branding = await _pdf_branding(db)
    public_id = _pdf_filename_part(t.get("slug"), t.get("id"), slug_or_id, fallback="turnier")
    url = _pdf_absolute_url(f"/tournaments/{public_id}", branding)
    subtitle = "Anmeldung, Check-in und Turnierinfos"
    return _pdf_response(
        pdf_qr_sign(t.get("title") or "Turnier", url, subtitle=subtitle, eyebrow="Turnier-Anmeldung", pdf_sponsors=sponsors, pdf_branding=branding),
        f"anmeldung_qr_{public_id}.pdf",
    )


@pdf_router.get("/tournaments/{slug_or_id}/matches.pdf")
async def pdf_tournament_matches(slug_or_id: str, me: dict = Depends(require_role("moderator"))):
    db = get_db()
    t = await db.tournaments.find_one({"$or": [{"id": slug_or_id}, {"slug": slug_or_id}]}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404)
    read_model = await load_competition_read_model(db, t["id"])
    structure = read_model.structure_snapshot()
    observe_structure_read(structure, surface="match_pdf")
    matches = structure["matches"]
    regs = await db.tournament_registrations.find({"tournament_id": t["id"]}, {"_id": 0}).to_list(500)
    reg_map = {r["id"]: r for r in regs}
    sponsors = await _pdf_sponsors(db)
    branding = await _pdf_branding(db)
    file_id = _pdf_filename_part(t.get("slug"), t.get("id"), slug_or_id, fallback="turnier")
    return _pdf_response(pdf_matches(t, matches, reg_map, pdf_sponsors=sponsors, pdf_branding=branding), f"matches_{file_id}.pdf")


@pdf_router.get("/tournaments/{slug_or_id}/stations.pdf")
async def pdf_tournament_station_signs(
    slug_or_id: str,
    orientation: Literal["portrait", "landscape"] = "portrait",
    me: dict = Depends(require_role("moderator")),
):
    db = get_db()
    t = await db.tournaments.find_one({"$or": [{"id": slug_or_id}, {"slug": slug_or_id}]}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404)
    stations = await db.stations.find({"tournament_id": t["id"]}, {"_id": 0}).sort("name", 1).to_list(500)
    sponsors = await _pdf_sponsors(db)
    branding = await _pdf_branding(db)
    return _pdf_response(
        pdf_station_signs(t, stations, pdf_sponsors=sponsors, pdf_branding=branding, orientation=orientation),
        f"stationen_{orientation}_{_pdf_filename_part(t.get('slug'), t.get('id'), slug_or_id, fallback='turnier')}.pdf",
    )


@pdf_router.get("/tournaments/{slug_or_id}/standings.pdf")
async def pdf_tournament_standings(
    slug_or_id: str,
    access: Optional[str] = None,
    user: dict | None = Depends(get_optional_user),
):
    db = get_db()
    t = await db.tournaments.find_one({"$or": [{"id": slug_or_id}, {"slug": slug_or_id}]}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404)
    if not await _result_export_allowed_for_request(db, t, user, access, "tournament"):
        raise HTTPException(status_code=403, detail="Ergebnis-PDF ist erst nach Turnierende öffentlich.")
    # Reuse standings logic
    from routes.tournament_routes import standings as st_fn
    rows = await st_fn(t["id"], access=access, user=user)
    sponsors = await _pdf_sponsors(db)
    branding = await _pdf_branding(db)
    file_id = _pdf_filename_part(t.get("slug"), t.get("id"), slug_or_id, fallback="turnier")
    return _pdf_response(pdf_standings(t, rows, pdf_sponsors=sponsors, pdf_branding=branding), f"standings_{file_id}.pdf")


@pdf_router.get("/tournaments/{slug_or_id}/certificates.pdf")
async def pdf_tournament_certificates(
    slug_or_id: str,
    access: Optional[str] = None,
    user: dict | None = Depends(get_optional_user),
):
    db = get_db()
    t = await db.tournaments.find_one({"$or": [{"id": slug_or_id}, {"slug": slug_or_id}]}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404)
    if not await _result_export_allowed_for_request(db, t, user, access, "tournament"):
        raise HTTPException(status_code=403, detail="Urkunden sind erst nach Turnierende öffentlich.")
    from routes.tournament_routes import standings as st_fn
    rows = _top_certificate_rows(await st_fn(t["id"], access=access, user=user))
    if not rows:
        raise HTTPException(status_code=404, detail="Keine Top-4-Platzierungen für Urkunden gefunden.")
    sponsors = await _pdf_sponsors(db)
    branding = await _pdf_branding(db)
    source = _certificate_source_from_item(t, "Turnier")
    certificates = [
        {
            "source": source,
            "row": row,
            "category": "Gesamtwertung",
            "metrics": _tournament_certificate_metrics(row),
        }
        for row in rows
    ]
    file_id = _pdf_filename_part(t.get("slug"), t.get("id"), slug_or_id, fallback="turnier")
    return _pdf_response(
        pdf_certificates(certificates, pdf_sponsors=sponsors, pdf_branding=branding),
        f"urkunden_{file_id}.pdf",
    )


@pdf_router.get("/tournaments/{slug_or_id}/certificates/{registration_id}.pdf")
async def pdf_tournament_certificate(
    slug_or_id: str,
    registration_id: str,
    access: Optional[str] = None,
    user: dict | None = Depends(get_optional_user),
):
    db = get_db()
    t = await db.tournaments.find_one({"$or": [{"id": slug_or_id}, {"slug": slug_or_id}]}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404)
    if not await _result_export_allowed_for_request(db, t, user, access, "tournament"):
        raise HTTPException(status_code=403, detail="Urkunden sind erst nach Turnierende öffentlich.")
    from routes.tournament_routes import standings as st_fn
    rows = await st_fn(t["id"], access=access, user=user)
    row = next((item for item in rows if item.get("registration_id") == registration_id), None)
    if not row:
        raise HTTPException(status_code=404, detail="Platzierung nicht gefunden.")
    if row not in _top_certificate_rows(rows):
        raise HTTPException(status_code=404, detail="Urkunden werden für die ersten vier Plätze erzeugt.")
    sponsors = await _pdf_sponsors(db)
    branding = await _pdf_branding(db)
    file_id = _pdf_filename_part(t.get("slug"), t.get("id"), slug_or_id, fallback="turnier")
    player_id = _pdf_filename_part(row.get("display_name"), registration_id, fallback="spieler")
    return _pdf_response(
        pdf_certificate(
            _certificate_source_from_item(t, "Turnier"),
            row,
            category="Gesamtwertung",
            metrics=_tournament_certificate_metrics(row),
            pdf_sponsors=sponsors,
            pdf_branding=branding,
        ),
        f"urkunde_{file_id}_{player_id}.pdf",
    )


@pdf_router.get("/f1/{slug_or_id}/leaderboard.pdf")
async def pdf_f1_lb(slug_or_id: str, track_id: Optional[str] = None, access: Optional[str] = None, user: dict | None = Depends(get_optional_user)):
    db = get_db()
    from routes.f1_routes import _get_visible_challenge, leaderboard as f1_lb
    c = await _get_visible_challenge(slug_or_id, user, access=access)
    if not await _result_export_allowed(c, user):
        raise HTTPException(status_code=403, detail="Ergebnis-PDF ist erst nach Challenge-Ende öffentlich.")
    lb = await f1_lb(c["id"], track_id, access, user)
    sponsors = await _pdf_sponsors(db)
    branding = await _pdf_branding(db)
    file_id = _pdf_filename_part(c.get("slug"), c.get("id"), slug_or_id, fallback="f1")
    return _pdf_response(pdf_f1_leaderboard(c, lb.get("track"), lb.get("entries", []), pdf_sponsors=sponsors, pdf_branding=branding),
                          f"f1_{file_id}.pdf")


@pdf_router.get("/f1/{slug_or_id}/certificates.pdf")
async def pdf_f1_certificates(slug_or_id: str, track_id: Optional[str] = None, access: Optional[str] = None, user: dict | None = Depends(get_optional_user)):
    db = get_db()
    from routes.f1_routes import _get_visible_challenge, leaderboard as f1_lb
    c = await _get_visible_challenge(slug_or_id, user, access=access)
    if not await _result_export_allowed(c, user):
        raise HTTPException(status_code=403, detail="Urkunden sind erst nach Challenge-Ende öffentlich.")
    lb = await f1_lb(c["id"], track_id, access, user)
    rows = _top_certificate_rows(lb.get("entries") or [])
    if not rows:
        raise HTTPException(status_code=404, detail="Keine Top-4-Platzierungen für Urkunden gefunden.")
    sponsors = await _pdf_sponsors(db)
    branding = await _pdf_branding(db)
    track = lb.get("track") or {}
    source = _certificate_source_from_item({**c, "image_url": track.get("image_url") or c.get("banner_url")}, "Fast Lap")
    certificates = [
        {
            "source": source,
            "row": row,
            "category": f"Streckenwertung · {track.get('name') or 'Fast Lap'}",
            "metrics": _f1_track_certificate_metrics(row, track),
        }
        for row in rows
    ]
    file_id = _pdf_filename_part(c.get("slug"), c.get("id"), slug_or_id, fallback="f1")
    return _pdf_response(
        pdf_certificates(certificates, pdf_sponsors=sponsors, pdf_branding=branding),
        f"urkunden_f1_{file_id}.pdf",
    )


@pdf_router.get("/f1/{slug_or_id}/certificates/{user_id}.pdf")
async def pdf_f1_certificate(slug_or_id: str, user_id: str, track_id: Optional[str] = None, access: Optional[str] = None, user: dict | None = Depends(get_optional_user)):
    db = get_db()
    from routes.f1_routes import _get_visible_challenge, leaderboard as f1_lb
    c = await _get_visible_challenge(slug_or_id, user, access=access)
    if not await _result_export_allowed(c, user):
        raise HTTPException(status_code=403, detail="Urkunden sind erst nach Challenge-Ende öffentlich.")
    lb = await f1_lb(c["id"], track_id, access, user)
    rows = lb.get("entries") or []
    row = next((item for item in rows if item.get("user_id") == user_id), None)
    if not row:
        raise HTTPException(status_code=404, detail="Platzierung nicht gefunden.")
    if row not in _top_certificate_rows(rows):
        raise HTTPException(status_code=404, detail="Urkunden werden für die ersten vier Plätze erzeugt.")
    sponsors = await _pdf_sponsors(db)
    branding = await _pdf_branding(db)
    track = lb.get("track") or {}
    file_id = _pdf_filename_part(c.get("slug"), c.get("id"), slug_or_id, fallback="f1")
    player_id = _pdf_filename_part(row.get("display_name"), user_id, fallback="fahrer")
    return _pdf_response(
        pdf_certificate(
            _certificate_source_from_item({**c, "image_url": track.get("image_url") or c.get("banner_url")}, "Fast Lap"),
            row,
            category=f"Streckenwertung · {track.get('name') or 'Fast Lap'}",
            metrics=_f1_track_certificate_metrics(row, track),
            pdf_sponsors=sponsors,
            pdf_branding=branding,
        ),
        f"urkunde_f1_{file_id}_{player_id}.pdf",
    )


@pdf_router.get("/f1/{slug_or_id}/championship.pdf")
async def pdf_f1_championship(slug_or_id: str, access: Optional[str] = None, user: dict | None = Depends(get_optional_user)):
    db = get_db()
    from routes.f1_routes import _get_visible_challenge, championship_standings as f1_champ
    c = await _get_visible_challenge(slug_or_id, user, access=access)
    if not await _result_export_allowed(c, user):
        raise HTTPException(status_code=403, detail="Ergebnis-PDF ist erst nach Challenge-Ende öffentlich.")
    cs = await f1_champ(c["id"], access, user)
    # Reuse standings PDF shape
    rows = [{"rank": r["rank"], "display_name": r["display_name"],
             "won": r.get("wins", 0), "lost": (r.get("races", 0) - r.get("wins", 0)),
             "points": r.get("points", 0)} for r in (cs.get("standings") or [])]
    file_id = _pdf_filename_part(c.get("slug"), c.get("id"), slug_or_id, fallback="f1")
    fake_tournament = {"title": (c.get("title") or "F1") + " · Championship", "slug": file_id}
    sponsors = await _pdf_sponsors(db)
    branding = await _pdf_branding(db)
    return _pdf_response(pdf_standings(fake_tournament, rows, pdf_sponsors=sponsors, pdf_branding=branding),
                          f"f1_championship_{file_id}.pdf")


@pdf_router.get("/f1/{slug_or_id}/championship-certificates.pdf")
async def pdf_f1_championship_certificates(slug_or_id: str, access: Optional[str] = None, user: dict | None = Depends(get_optional_user)):
    db = get_db()
    from routes.f1_routes import _get_visible_challenge, championship_standings as f1_champ
    c = await _get_visible_challenge(slug_or_id, user, access=access)
    if not await _result_export_allowed(c, user):
        raise HTTPException(status_code=403, detail="Urkunden sind erst nach Challenge-Ende öffentlich.")
    cs = await f1_champ(c["id"], access, user)
    rows = _top_certificate_rows(cs.get("standings") or [])
    if not rows:
        raise HTTPException(status_code=404, detail="Keine Top-4-Platzierungen für Urkunden gefunden.")
    sponsors = await _pdf_sponsors(db)
    branding = await _pdf_branding(db)
    source = _certificate_source_from_item(c, "Fast Lap Championship")
    certificates = [
        {
            "source": source,
            "row": row,
            "category": "Gesamtwertung",
            "metrics": _f1_championship_certificate_metrics(row),
        }
        for row in rows
    ]
    file_id = _pdf_filename_part(c.get("slug"), c.get("id"), slug_or_id, fallback="f1")
    return _pdf_response(
        pdf_certificates(certificates, pdf_sponsors=sponsors, pdf_branding=branding),
        f"urkunden_f1_championship_{file_id}.pdf",
    )


@pdf_router.get("/f1/{slug_or_id}/championship-certificates/{user_id}.pdf")
async def pdf_f1_championship_certificate(slug_or_id: str, user_id: str, access: Optional[str] = None, user: dict | None = Depends(get_optional_user)):
    db = get_db()
    from routes.f1_routes import _get_visible_challenge, championship_standings as f1_champ
    c = await _get_visible_challenge(slug_or_id, user, access=access)
    if not await _result_export_allowed(c, user):
        raise HTTPException(status_code=403, detail="Urkunden sind erst nach Challenge-Ende öffentlich.")
    cs = await f1_champ(c["id"], access, user)
    rows = cs.get("standings") or []
    row = next((item for item in rows if item.get("user_id") == user_id), None)
    if not row:
        raise HTTPException(status_code=404, detail="Platzierung nicht gefunden.")
    if row not in _top_certificate_rows(rows):
        raise HTTPException(status_code=404, detail="Urkunden werden für die ersten vier Plätze erzeugt.")
    sponsors = await _pdf_sponsors(db)
    branding = await _pdf_branding(db)
    file_id = _pdf_filename_part(c.get("slug"), c.get("id"), slug_or_id, fallback="f1")
    player_id = _pdf_filename_part(row.get("display_name"), user_id, fallback="fahrer")
    return _pdf_response(
        pdf_certificate(
            _certificate_source_from_item(c, "Fast Lap Championship"),
            row,
            category="Gesamtwertung",
            metrics=_f1_championship_certificate_metrics(row),
            pdf_sponsors=sponsors,
            pdf_branding=branding,
        ),
        f"urkunde_f1_championship_{file_id}_{player_id}.pdf",
    )
