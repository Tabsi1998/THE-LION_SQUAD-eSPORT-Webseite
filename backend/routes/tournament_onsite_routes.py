"""Vor-Ort-Zugang (#1592): Einlösen für alle, Verwaltung für die Turnierleitung.

Die Regeln stehen in ``services/onsite_access.py``.
"""
from fastapi import Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from auth import require_admin
from database import get_db
from routes.tournament_common import _audit_tournament_action, _resolve_tid
from routes.tournament_router import router
from services import onsite_access
from services.rate_limit import enforce_rate_limit, release_rate_limit

# Ein Grund für alle Fehlschläge: unbekannt, abgelaufen, erneuert, abgeschaltet - wer rät, erfährt nichts.
NOT_VALID = "Dieser Vor-Ort-Code gilt nicht (mehr). Bitte den QR-Code vor Ort neu scannen."
# Fehlversuche je Anschluss. Vor Ort teilen sich viele Handys eine Adresse - erfolgreiche Scans zählen deshalb nicht.
FAILED_REDEEMS_PER_WINDOW = 20
REDEEM_WINDOW_SECONDS = 15 * 60


class OnsiteRedeem(BaseModel):
    token: str = Field(min_length=1, max_length=128)


class OnsiteSetting(BaseModel):
    # ``None``: zurück zur Vorgabe (an bei Turnieren vor Ort, aus online).
    enabled: bool | None = None


@router.post("/onsite/redeem")
async def redeem_onsite_access(body: OnsiteRedeem, request: Request, response: Response):
    """Den Code aus dem QR-Code gegen eine Freigabe für genau dieses Turnier tauschen (Cookie, nur unter /api)."""
    db = get_db()
    counter = await enforce_rate_limit(request, "onsite:redeem", FAILED_REDEEMS_PER_WINDOW, REDEEM_WINDOW_SECONDS)
    tournament = await onsite_access.tournament_for_token(db, body.token)
    if not tournament:
        raise HTTPException(status_code=404, detail=NOT_VALID)
    await release_rate_limit(counter)
    value, max_age = await onsite_access.pass_cookie_value(db, tournament, request.cookies.get(onsite_access.PASS_COOKIE))
    onsite_access.set_pass_cookie(response, value, max_age)
    return {"tournament": {"id": tournament["id"], "slug": tournament.get("slug"), "title": tournament.get("title")}}


async def _state(db, tournament: dict, token: str) -> dict:
    start, end = onsite_access.window(tournament)
    return {
        "enabled": onsite_access.is_enabled(tournament),
        "default": onsite_access.default_enabled(tournament),
        "explicit": tournament.get("onsite_access_enabled"),
        "open_now": onsite_access.is_open(tournament),
        "window": {"from": start.isoformat() if start else None, "until": end.isoformat() if end else None},
        "path": onsite_access.onsite_path(token),
    }


async def _lead_tournament(tid: str) -> dict:
    db = get_db()
    tid = await _resolve_tid(tid)
    tournament = await db.tournaments.find_one({"id": tid}, {"_id": 0})
    if not tournament:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    return tournament


@router.get("/{tid}/onsite-access")
async def get_onsite_access(tid: str, me: dict = Depends(require_admin())):
    """Für Aushang und Verwaltung: Einstellung, Zeitfenster und die Adresse für den QR-Code."""
    db = get_db()
    tournament = await _lead_tournament(tid)
    return await _state(db, tournament, await onsite_access.ensure_token(db, tournament["id"], me.get("id")))


@router.put("/{tid}/onsite-access")
async def set_onsite_access(tid: str, body: OnsiteSetting, me: dict = Depends(require_admin())):
    db = get_db()
    tournament = await _lead_tournament(tid)
    await db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"onsite_access_enabled": body.enabled}})
    tournament["onsite_access_enabled"] = body.enabled
    await _audit_tournament_action(db, "tournament.onsite_access.set", me.get("id"), tournament["id"],
                                   {"enabled": body.enabled})
    return await _state(db, tournament, await onsite_access.ensure_token(db, tournament["id"], me.get("id")))


@router.post("/{tid}/onsite-access/renew")
async def renew_onsite_access(tid: str, me: dict = Depends(require_admin())):
    """Neuer QR-Code: der alte und alle damit eingelösten Freigaben gelten ab sofort nicht mehr."""
    db = get_db()
    tournament = await _lead_tournament(tid)
    token = await onsite_access.renew_token(db, tournament["id"], me.get("id"))
    await _audit_tournament_action(db, "tournament.onsite_access.renew", me.get("id"), tournament["id"], {})
    return await _state(db, tournament, token)
