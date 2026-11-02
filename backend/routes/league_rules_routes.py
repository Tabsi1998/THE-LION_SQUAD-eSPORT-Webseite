"""Regelwerk der Liga (docs/LIGA.md, #1646): Seite und PDF nach der Sichtbarkeit der Season, Zustimmung der Verantwortlichen, Pflege durch
die Liga-Leitung. Die Logik steht in ``services/league_rules.py``."""
from __future__ import annotations

import asyncio
import io
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from auth import get_current_user, get_optional_user, require_area
from database import get_db
from models import new_id, now_utc
from services import league_rules as rules
from services.league_service import LeagueProblem

router = APIRouter(prefix="/api/league-rules", tags=["league-rules"])
admin_router = APIRouter(prefix="/api/admin/league-rules", tags=["league-rules-admin"])

# Das Recht an einer Stelle. Bis der Bereich „Ligen“ da ist (#2203), gilt der Weg der Liga-Verwaltung.
require_rules_editor = require_area("tournaments")

BODY_MAX = 200_000
ANNEXES_MAX = 26
NOINDEX = {"X-Robots-Tag": "noindex, nofollow"}


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


async def _compare(league: str, season: str | None, base: str, target: str, user: dict | None) -> dict:
    db = get_db()
    league_doc, season_doc = await _call(rules.visible_scope(db, league, season, user))
    return await _call(rules.compare_view(db, league_doc, season_doc, base, target))


async def _pdf(league: str, season: str | None, version_id: str, marks: int, user: dict | None) -> StreamingResponse:
    from pdf_service import pdf_league_rules
    from routes.export_routes import _pdf_branding, _pdf_filename

    db = get_db()
    league_doc, season_doc = await _call(rules.visible_scope(db, league, season, user))
    document = await _call(rules.pdf_document(db, league_doc, season_doc, version_id, marks=bool(marks)))
    branding = await _pdf_branding(db)
    # Lange Regelwerke rechnen spürbar - nicht im Ablauf der übrigen Anfragen.
    data = await asyncio.to_thread(pdf_league_rules, document, branding)
    headers = {"Content-Disposition": f'inline; filename="{_pdf_filename(document["filename"])}"'}
    if not (season_doc or {}).get("visibility") == "public":
        headers.update(NOINDEX)
    return StreamingResponse(io.BytesIO(data), media_type="application/pdf", headers=headers)


@router.get("/leagues/{league_slug}")
async def league_rules_page(league_slug: str, version: Optional[str] = None, user: dict | None = Depends(get_optional_user)):
    """Die Regelseite einer Liga: das liga-weite Regelwerk."""
    return await _page(league_slug, None, version, user)


@router.get("/leagues/{league_slug}/compare")
async def league_rules_compare(league_slug: str, base: str, target: str, user: dict | None = Depends(get_optional_user)):
    return await _compare(league_slug, None, base, target, user)


@router.get("/leagues/{league_slug}/versions/{version_id}/pdf")
async def league_rules_pdf(league_slug: str, version_id: str, marks: int = 1, user: dict | None = Depends(get_optional_user)):
    return await _pdf(league_slug, None, version_id, marks, user)


@router.get("/seasons/{league_slug}/{season_slug}")
async def season_rules_page(league_slug: str, season_slug: str, version: Optional[str] = None,
                            user: dict | None = Depends(get_optional_user)):
    """Die Regelseite einer Season: ihr Regelwerk, sonst das der Liga, sonst der Regeltext."""
    return await _page(league_slug, season_slug, version, user)


@router.get("/seasons/{league_slug}/{season_slug}/compare")
async def season_rules_compare(league_slug: str, season_slug: str, base: str, target: str,
                               user: dict | None = Depends(get_optional_user)):
    return await _compare(league_slug, season_slug, base, target, user)


@router.get("/seasons/{league_slug}/{season_slug}/versions/{version_id}/pdf")
async def season_rules_pdf(league_slug: str, season_slug: str, version_id: str, marks: int = 1,
                           user: dict | None = Depends(get_optional_user)):
    return await _pdf(league_slug, season_slug, version_id, marks, user)


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
async def admin_preview(scope: str, scope_id: str, body: RuleText, _me: dict = Depends(require_rules_editor)):
    return await _call(rules.preview(get_db(), _scope(scope), scope_id, body.model_dump()))


@admin_router.post("/{scope}/{scope_id}/publish")
async def admin_publish(scope: str, scope_id: str, body: RulePublish, me: dict = Depends(require_rules_editor)):
    db = get_db()
    doc = await _call(rules.publish(db, _scope(scope), scope_id, body.model_dump(), me))
    await _audit(db, "league.rules.publish", me, doc["id"], {
        "scope": scope, "scope_id": scope_id, "version": doc["version"], "valid_from": doc["valid_from"],
        "requires_consent": doc["requires_consent"], "blocks": doc["blocks_used"]})
    return doc
