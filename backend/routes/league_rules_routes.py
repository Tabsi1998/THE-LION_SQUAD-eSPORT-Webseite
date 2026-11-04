"""Regelwerk der Liga (docs/LIGA.md, #1646): Seite und PDF nach der Sichtbarkeit der Season, Zustimmung der Verantwortlichen, Pflege durch
die Liga-Leitung. Die Logik steht in ``services/league_rules.py``."""
from __future__ import annotations

import io
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from auth import get_current_user, get_optional_user
from database import get_db
from models import new_id, now_utc
from services import league_rules as rules
from services.league_permissions import require_league
from services.league_service import LeagueProblem
from services.rate_limit import enforce_rate_limit

router = APIRouter(prefix="/api/league-rules", tags=["league-rules"])
admin_router = APIRouter(prefix="/api/admin/league-rules", tags=["league-rules-admin"])

# Zuständigkeit „Regeln veröffentlichen“ (#2203). Maßgeblich ist die Liga aus der Adresse, bei einer Season die Liga der gespeicherten Season - nie
# eine Angabe aus dem Inhalt. Ein unbekannter Geltungsbereich hat keine Liga: Der Bereich bekommt von der Route 404, Zuständige 403.
_RULES_RIGHT = {rules.LEAGUE: require_league("rules", param="scope_id"),
                rules.SEASON: require_league("rules", via="season_id", param="scope_id")}
_RULES_RIGHT_NO_SCOPE = require_league("rules", param="kein_geltungsbereich")

BODY_MAX = 200_000
ANNEXES_MAX = 26
NOINDEX = {"X-Robots-Tag": "noindex, nofollow"}
# PDF und Vergleich je Besucher: reichlich fürs Lesen, nicht für einen Lauf durch alle Fassungen. Bursts fängt schon nginx ab.
HEAVY_LIMIT = 60
HEAVY_WINDOW_SECONDS = 60


async def require_rules_editor(request: Request, user: dict = Depends(get_current_user)) -> dict:
    return await _RULES_RIGHT.get(request.path_params.get("scope"), _RULES_RIGHT_NO_SCOPE)(request, user)


class RuleAnnex(BaseModel):
    title: str = Field(default="", max_length=160)
    body_md: str = Field(default="", max_length=BODY_MAX)


class RuleText(BaseModel):
    title: str = Field(default="", max_length=160)
    body_md: str = Field(default="", max_length=BODY_MAX)
    annexes: List[RuleAnnex] = Field(default_factory=list, max_length=ANNEXES_MAX)


class RuleDraftSave(RuleText):
    revision: Optional[int] = Field(default=None, ge=1)


class RuleDraftFrom(BaseModel):
    version_id: Optional[str] = Field(default=None, max_length=64)


class RulePublish(BaseModel):
    revision: int = Field(ge=1)
    valid_from: str = Field(max_length=10)
    change_reason: str = Field(default="", max_length=1000)
    requires_consent: bool = False


class RuleProposalPublish(BaseModel):
    """Den Vorschlag „Daten geändert“ freigeben (#2269): aus der letzten Fassung, mit den Daten von heute."""
    base_version_id: str = Field(max_length=64)
    valid_from: str = Field(max_length=10)
    change_reason: str = Field(default="", max_length=1000)
    requires_consent: bool = False


class RuleConsent(BaseModel):
    version_id: str = Field(max_length=64)
    season_id: str = Field(max_length=64)
    squad_id: str = Field(max_length=64)


async def _call(coroutine):
    try:
        return await coroutine
    except LeagueProblem as problem:
        raise HTTPException(status_code=problem.status, detail=problem.message) from None


async def _audit(db, action: str, me: dict, target_id: str, data: dict | None = None) -> None:
    """Protokoll ``league.rules.*``: wer, was, Kennungen und Zahlen - nie der Text."""
    await db.audit_logs.insert_one({"id": new_id(), "action": action, "actor_id": me.get("id"), "target_id": target_id,
                                    "data": data or {}, "created_at": now_utc().isoformat()})


# ---------------------------------------------------------------- Öffentlich

async def _page(league: str, season: str | None, version: str | None, user: dict | None) -> dict:
    db = get_db()
    league_doc, season_doc = await _call(rules.visible_scope(db, league, season, user))
    return await _call(rules.page_view(db, league_doc, season_doc, user, version_id=version))


async def _compare(request: Request, league: str, season: str | None, base: str, target: str, user: dict | None) -> dict:
    await enforce_rate_limit(request, "league_rules:heavy", HEAVY_LIMIT, HEAVY_WINDOW_SECONDS)
    db = get_db()
    league_doc, season_doc = await _call(rules.visible_scope(db, league, season, user))
    return await _call(rules.compare_view(db, league_doc, season_doc, base, target))


async def _pdf(request: Request, league: str, season: str | None, version_id: str, marks: int, user: dict | None) -> StreamingResponse:
    from routes.export_routes import _pdf_branding, _pdf_filename

    await enforce_rate_limit(request, "league_rules:heavy", HEAVY_LIMIT, HEAVY_WINDOW_SECONDS)
    db = get_db()
    league_doc, season_doc = await _call(rules.visible_scope(db, league, season, user))
    branding = await _pdf_branding(db)
    data, name = await _call(rules.pdf_file(db, league_doc, season_doc, version_id, marks=bool(marks), branding=branding))
    headers = {"Content-Disposition": f'inline; filename="{_pdf_filename(name)}"'}
    if not (season_doc or {}).get("visibility") == "public":
        headers.update(NOINDEX)
    return StreamingResponse(io.BytesIO(data), media_type="application/pdf", headers=headers)


@router.get("/leagues/{league_slug}")
async def league_rules_page(league_slug: str, version: Optional[str] = None, user: dict | None = Depends(get_optional_user)):
    """Die Regelseite einer Liga: das liga-weite Regelwerk."""
    return await _page(league_slug, None, version, user)


@router.get("/leagues/{league_slug}/compare")
async def league_rules_compare(request: Request, league_slug: str, base: str, target: str, user: dict | None = Depends(get_optional_user)):
    return await _compare(request, league_slug, None, base, target, user)


@router.get("/leagues/{league_slug}/versions/{version_id}/pdf")
async def league_rules_pdf(request: Request, league_slug: str, version_id: str, marks: int = 1, user: dict | None = Depends(get_optional_user)):
    return await _pdf(request, league_slug, None, version_id, marks, user)


@router.get("/seasons/{league_slug}/{season_slug}")
async def season_rules_page(league_slug: str, season_slug: str, version: Optional[str] = None,
                            user: dict | None = Depends(get_optional_user)):
    """Die Regelseite einer Season: ihr Regelwerk, sonst das der Liga, sonst der Regeltext."""
    return await _page(league_slug, season_slug, version, user)


@router.get("/seasons/{league_slug}/{season_slug}/compare")
async def season_rules_compare(request: Request, league_slug: str, season_slug: str, base: str, target: str,
                               user: dict | None = Depends(get_optional_user)):
    return await _compare(request, league_slug, season_slug, base, target, user)


@router.get("/seasons/{league_slug}/{season_slug}/versions/{version_id}/pdf")
async def season_rules_pdf(request: Request, league_slug: str, season_slug: str, version_id: str, marks: int = 1,
                           user: dict | None = Depends(get_optional_user)):
    return await _pdf(request, league_slug, season_slug, version_id, marks, user)


@router.post("/consents")
async def give_consent(body: RuleConsent, me: dict = Depends(get_current_user)):
    """Ein Co-Team stimmt der gültigen Fassung zu. Die Oberfläche der Anmeldung folgt mit #2205."""
    db = get_db()
    doc = await _call(rules.give_consent(db, body.version_id, body.season_id, body.squad_id, me))
    if not doc["replay"]:
        await _audit(db, "league.rules.consent", me, doc["rule_version_id"],
                     {"season_id": doc["season_id"], "squad_id": doc["squad_id"], "version": doc["version"]})
    return {"ok": True, "replay": doc["replay"], "agreed_at": doc["created_at"], "version_id": doc["rule_version_id"]}


# ---------------------------------------------------------------- Verwaltung

def _scope(scope: str) -> str:
    if scope not in rules.SCOPES:
        raise HTTPException(status_code=404, detail="Unbekannter Geltungsbereich.")
    return scope


def _chars(body: RuleText) -> dict:
    return {"chars": len(body.body_md) + sum(len(row.body_md) for row in body.annexes), "annexes": len(body.annexes)}


@admin_router.get("/{scope}/{scope_id}")
async def admin_rules(scope: str, scope_id: str, _me: dict = Depends(require_rules_editor)):
    return await _call(rules.admin_view(get_db(), _scope(scope), scope_id))


@admin_router.put("/{scope}/{scope_id}/draft")
async def admin_save_draft(scope: str, scope_id: str, body: RuleDraftSave, me: dict = Depends(require_rules_editor)):
    db = get_db()
    doc = await _call(rules.save_draft(db, _scope(scope), scope_id, body.model_dump(), me))
    await _audit(db, "league.rules.draft", me, doc["id"], {"scope": scope, "scope_id": scope_id, **_chars(body)})
    return doc


@admin_router.post("/{scope}/{scope_id}/draft/from-version")
async def admin_draft_from_version(scope: str, scope_id: str, body: RuleDraftFrom, me: dict = Depends(require_rules_editor)):
    db = get_db()
    doc = await _call(rules.draft_from_version(db, _scope(scope), scope_id, body.version_id, me))
    await _audit(db, "league.rules.draft", me, doc["id"], {"scope": scope, "scope_id": scope_id, "from_version": body.version_id})
    return doc


@admin_router.delete("/{scope}/{scope_id}/draft")
async def admin_discard_draft(scope: str, scope_id: str, me: dict = Depends(require_rules_editor)):
    db = get_db()
    doc = await _call(rules.discard_draft(db, _scope(scope), scope_id))
    await _audit(db, "league.rules.draft_discard", me, doc["id"], {"scope": scope, "scope_id": scope_id})
    return {"ok": True}


@admin_router.post("/{scope}/{scope_id}/preview")
async def admin_preview(scope: str, scope_id: str, body: RuleText, me: dict = Depends(require_rules_editor)):
    return await _call(rules.preview(get_db(), _scope(scope), scope_id, body.model_dump(), me))


@admin_router.post("/{scope}/{scope_id}/publish")
async def admin_publish(scope: str, scope_id: str, body: RulePublish, me: dict = Depends(require_rules_editor)):
    db = get_db()
    doc = await _call(rules.publish(db, _scope(scope), scope_id, body.model_dump(), me))
    await _audit(db, "league.rules.publish", me, doc["id"], {
        "scope": scope, "scope_id": scope_id, "version": doc["version"], "valid_from": doc["valid_from"],
        "requires_consent": doc["requires_consent"], "blocks": doc["blocks_used"], "variables": doc.get("vars_used") or []})
    return doc


@admin_router.post("/{scope}/{scope_id}/proposal/publish")
async def admin_publish_proposal(scope: str, scope_id: str, body: RuleProposalPublish, me: dict = Depends(require_rules_editor)):
    """Regelwerk freigeben (#2269): Der Vorschlag mit den geänderten Daten wird in einem Schritt Entwurf und Fassung."""
    db = get_db()
    doc = await _call(rules.publish_proposal(db, _scope(scope), scope_id, body.model_dump(), me))
    await _audit(db, "league.rules.publish", me, doc["id"], {
        "scope": scope, "scope_id": scope_id, "version": doc["version"], "valid_from": doc["valid_from"], "proposal": True,
        "base_version_id": body.base_version_id, "requires_consent": doc["requires_consent"], "blocks": doc["blocks_used"],
        "variables": doc.get("vars_used") or []})
    return doc
